/**
 * Memory Server
 * MEM-001 - Single daemon process owning all .agentdb/ file operations
 *
 * Architecture:
 * - Listens on Unix socket (Linux/macOS) or HTTP localhost (Windows)
 * - Handles concurrent client connections
 * - Owns all file I/O to .agentdb directory
 * - Provides graceful shutdown
 */

import { createServer, Server, Socket } from 'net';
import { createServer as createHttpServer, IncomingMessage, ServerResponse, Server as HttpServer } from 'http';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type {
  IMemoryServerConfig,
  IPidFileContent,
  ServerState,
  IServerStatus,
  IStorageStats,
  IKnowledgeEntry,
  IStoreKnowledgeParams,
  IGetKnowledgeByDomainParams,
  IGetKnowledgeByTagsParams,
  IDeleteKnowledgeParams,
  IProvideFeedbackParams,
  IProvideFeedbackResult,
  IQueryPatternsParams,
  IQueryPatternsResult,
  IPingResult,
  IMemoryRequest,
  IMemoryResponse,
  MemoryMethod,
} from '../types/memory-types.js';
import {
  DEFAULT_SOCKET_PATH,
  DEFAULT_HTTP_PORT,
  DEFAULT_MAX_CONNECTIONS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  MEMORY_SERVER_VERSION,
} from '../types/memory-types.js';
import {
  MemoryError,
  ServerShuttingDownError,
  MaxConnectionsError,
  StorageError,
  UnknownMethodError,
  wrapError,
} from './memory-errors.js';
import {
  MessageBuffer,
  serializeMessage,
  parseMessage,
  isRequest,
  isValidMethod,
  validateParams,
  createSuccessResponse,
  createErrorResponse,
} from './memory-protocol.js';

// ==================== Constants ====================

const PID_FILE_NAME = 'memory-server.pid';
const KNOWLEDGE_FILE = 'session-knowledge.json';
const FEEDBACK_FILE = 'feedback-log.json';

// ==================== Types ====================

interface ClientConnection {
  id: string;
  socket: Socket;
  buffer: MessageBuffer;
  connectedAt: number;
}

interface FeedbackEntry {
  trajectoryId: string;
  quality: number;
  outcome: 'positive' | 'negative' | 'neutral';
  userFeedback?: string;
  timestamp: number;
}

// ==================== Memory Server Class ====================

export class MemoryServer {
  private readonly config: Required<IMemoryServerConfig>;
  private state: ServerState = 'stopped';
  private server: Server | HttpServer | null = null;
  private clients: Map<string, ClientConnection> = new Map();
  private startedAt: number = 0;
  private totalRequests: number = 0;

  // In-memory storage (synced to disk)
  private knowledge: Map<string, IKnowledgeEntry> = new Map();
  private feedbackLog: FeedbackEntry[] = [];
  private dirty: boolean = false;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<IMemoryServerConfig> = {}) {
    this.config = {
      socketPath: config.socketPath ?? DEFAULT_SOCKET_PATH,
      httpPort: config.httpPort ?? DEFAULT_HTTP_PORT,
      maxConnections: config.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
      requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      agentDbPath: config.agentDbPath ?? path.join(process.cwd(), '.agentdb'),
      verbose: config.verbose ?? false,
    };
  }

  // ==================== Lifecycle ====================

  /**
   * Start the memory server
   */
  async start(): Promise<string> {
    if (this.state !== 'stopped') {
      throw new Error(`Cannot start server in state: ${this.state}`);
    }

    this.state = 'starting';
    this.log('info', 'Starting memory server...');

    // Check for existing server
    const existingAddress = await this.checkExistingServer();
    if (existingAddress) {
      this.state = 'stopped';
      this.log('info', `Server already running at ${existingAddress}`);
      return existingAddress;
    }

    // Ensure storage directory exists
    await this.ensureStorageDir();

    // Load existing data
    await this.loadData();

    // Start server
    const address = await this.startServer();

    // Write PID file
    await this.writePidFile(address);

    // Start periodic save
    this.startPeriodicSave();

    this.state = 'ready';
    this.startedAt = Date.now();
    this.log('info', `Memory server ready at ${address}`);

    return address;
  }

  /**
   * Stop the memory server gracefully
   */
  async stop(): Promise<void> {
    if (this.state === 'stopped' || this.state === 'shutting_down') {
      return;
    }

    this.state = 'shutting_down';
    this.log('info', 'Shutting down memory server...');

    // Stop accepting new connections
    if (this.server) {
      this.server.close();
    }

    // Wait for in-flight requests (max 5 seconds)
    const shutdownStart = Date.now();
    while (this.clients.size > 0 && Date.now() - shutdownStart < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Force close remaining connections
    for (const client of this.clients.values()) {
      client.socket.destroy();
    }
    this.clients.clear();

    // Stop periodic save
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }

    // Final save
    await this.saveData();

    // Remove PID file
    await this.removePidFile();

    this.server = null;
    this.state = 'stopped';
    this.log('info', 'Memory server stopped');
  }

  /**
   * Get current server state
   */
  getState(): ServerState {
    return this.state;
  }

  // ==================== Server Startup ====================

  private async checkExistingServer(): Promise<string | null> {
    const pidPath = path.join(this.config.agentDbPath, PID_FILE_NAME);

    try {
      const content = await fs.readFile(pidPath, 'utf-8');
      const pidFile: IPidFileContent = JSON.parse(content);

      // Check if process is still running
      try {
        process.kill(pidFile.pid, 0);
        // Process exists, verify it's responding
        // For now, trust the PID file
        return pidFile.address;
      } catch {
        // INTENTIONAL: Process not running, clean up stale PID file
        await fs.unlink(pidPath);
        return null;
      }
    } catch {
      // INTENTIONAL: No PID file - server not started yet
      return null;
    }
  }

  private async startServer(): Promise<string> {
    // Try Unix socket first (Linux/macOS)
    if (process.platform !== 'win32') {
      try {
        // Clean up stale socket
        try {
          await fs.unlink(this.config.socketPath);
        } catch {
          // INTENTIONAL: Socket doesn't exist, that's fine - nothing to clean up
        }

        const server = createServer((socket) => this.handleConnection(socket));

        await new Promise<void>((resolve, reject) => {
          server.on('error', reject);
          server.listen(this.config.socketPath, () => {
            server.removeListener('error', reject);
            resolve();
          });
        });

        // Set socket permissions (owner only)
        await fs.chmod(this.config.socketPath, 0o700);

        this.server = server;
        return `unix:${this.config.socketPath}`;
      } catch (error) {
        this.log('warn', `Unix socket failed, falling back to HTTP: ${error}`);
      }
    }

    // Fallback to HTTP localhost
    const httpServer = createHttpServer((req, res) => this.handleHttpRequest(req, res));

    await new Promise<void>((resolve, reject) => {
      httpServer.on('error', reject);
      httpServer.listen(this.config.httpPort, '127.0.0.1', () => {
        httpServer.removeListener('error', reject);
        resolve();
      });
    });

    this.server = httpServer;
    return `http://127.0.0.1:${this.config.httpPort}`;
  }

  // ==================== Connection Handling ====================

  private handleConnection(socket: Socket): void {
    if (this.state === 'shutting_down') {
      socket.destroy();
      return;
    }

    if (this.clients.size >= this.config.maxConnections) {
      const error = new MaxConnectionsError(this.clients.size, this.config.maxConnections);
      socket.write(
        serializeMessage(createErrorResponse('connection', error.toErrorInfo()))
      );
      socket.destroy();
      return;
    }

    const clientId = randomUUID();
    const client: ClientConnection = {
      id: clientId,
      socket,
      buffer: new MessageBuffer(),
      connectedAt: Date.now(),
    };

    this.clients.set(clientId, client);
    this.log('debug', `Client connected: ${clientId}`);

    socket.on('data', (data) => this.handleData(client, data.toString()));
    socket.on('close', () => this.handleDisconnect(client));
    socket.on('error', (error) => {
      this.log('warn', `Client error: ${clientId}`, { error: error.message });
      this.handleDisconnect(client);
    });
  }

  private handleDisconnect(client: ClientConnection): void {
    this.clients.delete(client.id);
    this.log('debug', `Client disconnected: ${client.id}`);
  }

  private async handleData(client: ClientConnection, data: string): Promise<void> {
    try {
      const messages = client.buffer.push(data);

      for (const message of messages) {
        if (isRequest(message)) {
          await this.handleRequest(client, message);
        }
      }
    } catch (error) {
      if (error instanceof MemoryError) {
        client.socket.write(
          serializeMessage(createErrorResponse('unknown', error.toErrorInfo()))
        );
      } else {
        this.log('error', 'Failed to process data', { error });
      }
    }
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.state === 'shutting_down') {
      res.writeHead(503);
      res.end(JSON.stringify({ error: 'Server shutting down' }));
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', async () => {
      try {
        const message = parseMessage(body);
        if (!isRequest(message)) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Expected request message' }));
          return;
        }

        this.totalRequests++;
        const response = await this.processRequest(message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (error) {
        res.writeHead(400);
        if (error instanceof MemoryError) {
          res.end(JSON.stringify(createErrorResponse('http', error.toErrorInfo())));
        } else {
          res.end(JSON.stringify({ error: String(error) }));
        }
      }
    });
  }

  // ==================== Request Handling ====================

  private async handleRequest(client: ClientConnection, request: IMemoryRequest): Promise<void> {
    this.totalRequests++;

    const response = await this.processRequest(request);
    client.socket.write(serializeMessage(response));
  }

  private async processRequest(request: IMemoryRequest): Promise<IMemoryResponse> {
    if (this.state === 'shutting_down') {
      return createErrorResponse(request.id, new ServerShuttingDownError().toErrorInfo());
    }

    try {
      if (!isValidMethod(request.method)) {
        throw new UnknownMethodError(request.method);
      }

      validateParams(request.method, request.params);

      const result = await this.executeMethod(request.method, request.params);
      return createSuccessResponse(request.id, result);
    } catch (error) {
      if (error instanceof MemoryError) {
        return createErrorResponse(request.id, error.toErrorInfo());
      }
      const wrapped = wrapError(error, request.method);
      return createErrorResponse(request.id, wrapped.toErrorInfo());
    }
  }

  private async executeMethod(method: MemoryMethod, params: unknown): Promise<unknown> {
    switch (method) {
      case 'storeKnowledge':
        return this.handleStoreKnowledge(params as IStoreKnowledgeParams);
      case 'getKnowledgeByDomain':
        return this.handleGetKnowledgeByDomain(params as IGetKnowledgeByDomainParams);
      case 'getKnowledgeByTags':
        return this.handleGetKnowledgeByTags(params as IGetKnowledgeByTagsParams);
      case 'deleteKnowledge':
        return this.handleDeleteKnowledge(params as IDeleteKnowledgeParams);
      case 'provideFeedback':
        return this.handleProvideFeedback(params as IProvideFeedbackParams);
      case 'queryPatterns':
        return this.handleQueryPatterns(params as IQueryPatternsParams);
      case 'getStatus':
        return this.handleGetStatus();
      case 'ping':
        return this.handlePing();
      default:
        throw new UnknownMethodError(method);
    }
  }

  // ==================== Method Handlers (TASK-MEM-005) ====================

  private async handleStoreKnowledge(params: IStoreKnowledgeParams): Promise<IKnowledgeEntry> {
    const now = Date.now();
    const entry: IKnowledgeEntry = {
      id: randomUUID(),
      content: params.content,
      category: params.category,
      domain: params.domain,
      tags: params.tags ?? [],
      quality: params.quality ?? 1.0,
      usageCount: 0,
      lastUsed: now,
      createdAt: now,
    };

    this.knowledge.set(entry.id, entry);
    this.markDirty();

    this.log('debug', `Stored knowledge: ${entry.id}`, { domain: entry.domain });
    return entry;
  }

  private handleGetKnowledgeByDomain(params: IGetKnowledgeByDomainParams): IKnowledgeEntry[] {
    const results: IKnowledgeEntry[] = [];
    const limit = params.limit ?? 100;

    for (const entry of this.knowledge.values()) {
      if (entry.domain === params.domain || entry.domain.startsWith(`${params.domain}/`)) {
        results.push(entry);
        if (results.length >= limit) break;
      }
    }

    // Update usage stats
    for (const entry of results) {
      entry.usageCount++;
      entry.lastUsed = Date.now();
    }
    if (results.length > 0) this.markDirty();

    return results;
  }

  private handleGetKnowledgeByTags(params: IGetKnowledgeByTagsParams): IKnowledgeEntry[] {
    const results: IKnowledgeEntry[] = [];
    const limit = params.limit ?? 100;
    const tagsSet = new Set(params.tags);

    for (const entry of this.knowledge.values()) {
      // Check if entry has ALL requested tags (using tagsSet for O(1) lookup)
      if (Array.from(tagsSet).every((tag) => entry.tags.includes(tag))) {
        results.push(entry);
        if (results.length >= limit) break;
      }
    }

    // Update usage stats
    for (const entry of results) {
      entry.usageCount++;
      entry.lastUsed = Date.now();
    }
    if (results.length > 0) this.markDirty();

    return results;
  }

  private handleDeleteKnowledge(params: IDeleteKnowledgeParams): { deleted: boolean } {
    const deleted = this.knowledge.delete(params.id);
    if (deleted) this.markDirty();
    return { deleted };
  }

  private async handleProvideFeedback(
    params: IProvideFeedbackParams
  ): Promise<IProvideFeedbackResult> {
    const entry: FeedbackEntry = {
      trajectoryId: params.trajectoryId,
      quality: params.quality,
      outcome: params.outcome,
      userFeedback: params.userFeedback,
      timestamp: Date.now(),
    };

    this.feedbackLog.push(entry);
    this.markDirty();

    this.log('debug', `Feedback stored for trajectory: ${params.trajectoryId}`);

    return {
      stored: true,
      trajectoryId: params.trajectoryId,
      newQuality: params.quality,
    };
  }

  private handleQueryPatterns(params: IQueryPatternsParams): IQueryPatternsResult {
    const startTime = Date.now();

    // Simple pattern matching based on content search
    // In production, this would use vector similarity
    const query = typeof params.query === 'string' ? params.query.toLowerCase() : '';
    const maxResults = params.maxResults ?? 10;
    const threshold = params.confidenceThreshold ?? 0.5;

    const patterns: Array<{
      id: string;
      confidence: number;
      content: string;
      metadata?: Record<string, unknown>;
    }> = [];

    if (typeof params.query === 'string') {
      for (const entry of this.knowledge.values()) {
        const contentLower = entry.content.toLowerCase();
        const domainLower = entry.domain.toLowerCase();

        // Simple relevance scoring
        let score = 0;
        if (contentLower.includes(query)) score += 0.6;
        if (domainLower.includes(query)) score += 0.3;
        if (entry.tags.some((t) => t.toLowerCase().includes(query))) score += 0.1;

        if (score >= threshold) {
          patterns.push({
            id: entry.id,
            confidence: Math.min(score, 1.0),
            content: entry.content,
            metadata: { domain: entry.domain, category: entry.category },
          });
        }

        if (patterns.length >= maxResults) break;
      }
    }

    // Sort by confidence
    patterns.sort((a, b) => b.confidence - a.confidence);

    return {
      patterns: patterns.slice(0, maxResults),
      totalMatches: patterns.length,
      queryTimeMs: Date.now() - startTime,
    };
  }

  private handleGetStatus(): IServerStatus {
    const memUsage = process.memoryUsage();

    return {
      state: this.state,
      connectedClients: this.clients.size,
      uptimeMs: this.startedAt > 0 ? Date.now() - this.startedAt : 0,
      totalRequests: this.totalRequests,
      memoryUsageBytes: memUsage.heapUsed,
      storage: this.getStorageStats(),
    };
  }

  private handlePing(): IPingResult {
    return {
      pong: true,
      timestamp: Date.now(),
      version: MEMORY_SERVER_VERSION,
    };
  }

  private getStorageStats(): IStorageStats {
    let totalSize = 0;
    for (const entry of this.knowledge.values()) {
      totalSize += entry.content.length;
    }

    return {
      knowledgeCount: this.knowledge.size,
      patternCount: 0, // Would come from VectorDB
      trajectoryCount: this.feedbackLog.length,
      sizeBytes: totalSize,
    };
  }

  // ==================== Storage ====================

  private async ensureStorageDir(): Promise<void> {
    await fs.mkdir(this.config.agentDbPath, { recursive: true });
    await fs.mkdir(path.join(this.config.agentDbPath, 'universal'), { recursive: true });
  }

  private async loadData(): Promise<void> {
    // Load knowledge
    const knowledgePath = path.join(
      this.config.agentDbPath,
      'universal',
      KNOWLEDGE_FILE
    );
    try {
      const content = await fs.readFile(knowledgePath, 'utf-8');
      const entries: IKnowledgeEntry[] = JSON.parse(content);
      for (const entry of entries) {
        this.knowledge.set(entry.id, entry);
      }
      this.log('info', `Loaded ${this.knowledge.size} knowledge entries`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.log('warn', 'Failed to load knowledge', { error });
      }
    }

    // Load feedback log
    const feedbackPath = path.join(this.config.agentDbPath, 'universal', FEEDBACK_FILE);
    try {
      const content = await fs.readFile(feedbackPath, 'utf-8');
      this.feedbackLog = JSON.parse(content);
      this.log('info', `Loaded ${this.feedbackLog.length} feedback entries`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.log('warn', 'Failed to load feedback', { error });
      }
    }
  }

  private async saveData(): Promise<void> {
    if (!this.dirty) return;

    try {
      // Save knowledge (atomic write)
      const knowledgePath = path.join(
        this.config.agentDbPath,
        'universal',
        KNOWLEDGE_FILE
      );
      const knowledgeTmp = `${knowledgePath}.tmp`;
      const knowledgeData = Array.from(this.knowledge.values());
      await fs.writeFile(knowledgeTmp, JSON.stringify(knowledgeData, null, 2));
      await fs.rename(knowledgeTmp, knowledgePath);

      // Save feedback (atomic write)
      const feedbackPath = path.join(
        this.config.agentDbPath,
        'universal',
        FEEDBACK_FILE
      );
      const feedbackTmp = `${feedbackPath}.tmp`;
      await fs.writeFile(feedbackTmp, JSON.stringify(this.feedbackLog, null, 2));
      await fs.rename(feedbackTmp, feedbackPath);

      this.dirty = false;
      this.log('debug', 'Data saved to disk');
    } catch (error) {
      this.log('error', 'Failed to save data', { error });
      throw new StorageError('save', String(error));
    }
  }

  private markDirty(): void {
    this.dirty = true;
  }

  private startPeriodicSave(): void {
    // Save every 10 seconds if dirty
    this.saveTimer = setInterval(() => {
      if (this.dirty) {
        this.saveData().catch((error) => {
          this.log('error', 'Periodic save failed', { error });
        });
      }
    }, 10000);
  }

  // ==================== PID File ====================

  private async writePidFile(address: string): Promise<void> {
    const pidPath = path.join(this.config.agentDbPath, PID_FILE_NAME);
    const content: IPidFileContent = {
      pid: process.pid,
      address,
      startedAt: Date.now(),
      version: MEMORY_SERVER_VERSION,
    };

    await fs.writeFile(pidPath, JSON.stringify(content, null, 2));
    this.log('debug', 'PID file written');
  }

  private async removePidFile(): Promise<void> {
    const pidPath = path.join(this.config.agentDbPath, PID_FILE_NAME);
    try {
      await fs.unlink(pidPath);
      this.log('debug', 'PID file removed');
    } catch {
      // INTENTIONAL: PID file may already be gone - safe to ignore during cleanup
    }
  }

  // ==================== Logging ====================

  private log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    context?: Record<string, unknown>
  ): void {
    if (level === 'debug' && !this.config.verbose) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      component: 'MemoryServer',
      message,
      ...context,
    };

    if (level === 'error') {
      console.error(JSON.stringify(entry));
    } else if (level === 'warn') {
      console.warn(JSON.stringify(entry));
    } else {
      console.log(JSON.stringify(entry));
    }
  }
}

// ==================== Singleton Access ====================

let serverInstance: MemoryServer | null = null;

/**
 * Get or create the singleton server instance
 */
export function getMemoryServer(config?: Partial<IMemoryServerConfig>): MemoryServer {
  if (!serverInstance) {
    serverInstance = new MemoryServer(config);
  }
  return serverInstance;
}

/**
 * Start the memory server (creates singleton if needed)
 */
export async function startMemoryServer(
  config?: Partial<IMemoryServerConfig>
): Promise<string> {
  const server = getMemoryServer(config);
  return server.start();
}

/**
 * Stop the memory server
 */
export async function stopMemoryServer(): Promise<void> {
  if (serverInstance) {
    await serverInstance.stop();
    serverInstance = null;
  }
}
