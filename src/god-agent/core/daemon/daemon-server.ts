/**
 * Daemon Server - Unix socket IPC server
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-DAEMON-001, TASK-DAEMON-003 (Integration)
 *
 * Provides IPC access to God Agent services via Unix socket.
 * Services are wired to real storage backends (EpisodeStore, GraphDB)
 * for persistent episodic memory and hyperedge storage.
 *
 * Constitution Compliance:
 * - RULE-008: Stores persist to SQLite/disk
 * - RULE-011: Episodes stored in SQLite
 *
 * @module src/god-agent/core/daemon/daemon-server
 */

import { createServer, Server, Socket } from 'net';
import { existsSync, unlinkSync } from 'fs';
import { EventEmitter } from 'events';
import type {
  DaemonConfig,
  ClientConnection,
  DaemonStats,
  RegisteredService,
  ServiceHandler,
  DaemonState,
  DaemonEvent,
  JsonRpcRequest,
  JsonRpcResponse,
} from './daemon-types.js';
import {
  DEFAULT_DAEMON_CONFIG,
  GRACEFUL_SHUTDOWN_TIMEOUT_MS,
  ClientRejectionReason,
  DaemonErrorCode,
  createDaemonError,
  generateClientId,
  JSON_RPC_ERROR_CODES,
} from './daemon-types.js';
import { VECTOR_DIM } from '../validation/constants.js';
import { EpisodeStore } from '../episode/episode-store.js';
import { GraphDB } from '../graph-db/graph-db.js';
import { FallbackGraph } from '../graph-db/fallback-graph.js';
import { createEpisodeService, createHyperedgeService } from './services/index.js';
import type { ServiceHandler as RegistryServiceHandler } from './service-registry.js';
import {
  registerRequiredHooks,
  getHookRegistry,
  setDescServiceGetter,
  setSonaEngineGetter,
  setQualityAssessmentCallback,
  type QualityAssessmentCallback,
  type IQualityAssessment,
  QUALITY_THRESHOLDS
} from '../hooks/index.js';
import { assessQuality, type QualityInteraction } from '../../universal/quality-estimator.js';

/**
 * Adapt a service-registry ServiceHandler (object with methods Map)
 * to daemon-types ServiceHandler (function signature)
 *
 * This bridges the new service factory pattern with the existing daemon infrastructure.
 */
function adaptServiceHandler(registryHandler: RegistryServiceHandler): ServiceHandler {
  return async (method: string, params: unknown): Promise<unknown> => {
    const methodFn = registryHandler.methods.get(method);
    if (!methodFn) {
      throw new Error(`Method not found: ${method}`);
    }
    return methodFn(params);
  };
}

/**
 * Extended daemon configuration with storage options
 */
export interface DaemonServerConfig extends Partial<Omit<DaemonConfig, 'socketPath'>> {
  /** Directory for persistent storage (default: .god-agent) */
  storageDir?: string;
  /** Enable verbose logging for store operations */
  verbose?: boolean;
  /** Expected embedding dimension for GraphDB (default: VECTOR_DIM = 1536) */
  embeddingDimension?: number;
  /** Data directory for GraphDB (default: .agentdb/graphs) */
  graphDataDir?: string;
}

/**
 * Default storage configuration
 */
const DEFAULT_STORAGE_CONFIG = {
  storageDir: '.god-agent',
  verbose: false,
  embeddingDimension: VECTOR_DIM,
  graphDataDir: '.agentdb/graphs',
};

/**
 * Daemon Server manages Unix socket connections for IPC
 *
 * Integrates with real storage backends:
 * - EpisodeStore: SQLite + HNSW for episodic memory
 * - GraphDB: Hypergraph database with temporal features
 */
export class DaemonServer extends EventEmitter {
  private readonly config: DaemonConfig;
  private readonly storageConfig: typeof DEFAULT_STORAGE_CONFIG;
  private server: Server | null = null;
  private clients: Map<string, ClientConnection> = new Map();
  private services: Map<string, RegisteredService> = new Map();
  private state: DaemonState = 'stopped';
  private startedAt: number = 0;
  private totalRequests: number = 0;
  private keepAliveTimers: Map<string, NodeJS.Timeout> = new Map();

  /** Message buffers per client for partial message handling - TASK-DAEMON-002 */
  private messageBuffers: Map<string, string> = new Map();

  // Storage backends (initialized in start())
  private episodeStore: EpisodeStore | null = null;
  private graphDb: GraphDB | null = null;

  /**
   * Create a new daemon server
   *
   * @param socketPath - Path to Unix socket file (default: /tmp/godagent-db.sock)
   * @param options - Optional configuration overrides including storage options
   */
  constructor(
    socketPath: string = DEFAULT_DAEMON_CONFIG.socketPath,
    options?: DaemonServerConfig
  ) {
    super();
    this.config = {
      ...DEFAULT_DAEMON_CONFIG,
      maxClients: options?.maxClients ?? DEFAULT_DAEMON_CONFIG.maxClients,
      keepAliveTimeout: options?.keepAliveTimeout ?? DEFAULT_DAEMON_CONFIG.keepAliveTimeout,
      socketPath,
    };
    this.storageConfig = {
      ...DEFAULT_STORAGE_CONFIG,
      storageDir: options?.storageDir ?? DEFAULT_STORAGE_CONFIG.storageDir,
      verbose: options?.verbose ?? DEFAULT_STORAGE_CONFIG.verbose,
      embeddingDimension: options?.embeddingDimension ?? DEFAULT_STORAGE_CONFIG.embeddingDimension,
      graphDataDir: options?.graphDataDir ?? DEFAULT_STORAGE_CONFIG.graphDataDir,
    };
  }

  /**
   * Start the daemon server
   *
   * Initializes storage backends (EpisodeStore, GraphDB) and registers
   * real services with dependency injection before starting the socket server.
   *
   * @throws DaemonError if server cannot start
   */
  async start(): Promise<void> {
    if (this.state !== 'stopped') {
      throw createDaemonError(
        DaemonErrorCode.UNKNOWN,
        `Cannot start server in ${this.state} state`
      );
    }

    this.state = 'starting';

    // Initialize storage backends BEFORE starting socket server
    try {
      await this.initializeStores();
      this.registerCoreServices();
    } catch (error) {
      this.state = 'stopped';
      throw createDaemonError(
        DaemonErrorCode.UNKNOWN,
        `Failed to initialize storage backends: ${error instanceof Error ? error.message : String(error)}`,
        { originalError: error }
      );
    }

    // RULE-032: Register all required hooks at daemon startup
    // Implements: GAP-HOOK-001, REQ-HOOK-001
    try {
      registerRequiredHooks();
      getHookRegistry().initialize();

      // TASK-HOOK-007: Wire service getters for DESC auto-injection
      // Core daemon doesn't have DescService or SonaEngine - those are in UCM daemon
      // Set null getters so hooks know services aren't available
      setDescServiceGetter(() => null);
      setSonaEngineGetter(() => null);

      // TASK-HOOK-009: Wire quality assessment callback
      // RULE-035: All agent results MUST be assessed for quality with 0.5 threshold
      // RULE-036: Task hook outputs MUST include quality assessment scores
      const qualityCallback: QualityAssessmentCallback = async (
        trajectoryId: string,
        output: unknown,
        metadata?: Record<string, unknown>
      ): Promise<IQualityAssessment> => {
        // Convert output to string for quality assessment
        const outputStr = typeof output === 'string'
          ? output
          : JSON.stringify(output, null, 2);

        // Build QualityInteraction for assessQuality
        const interaction: QualityInteraction = {
          id: trajectoryId,
          mode: (metadata?.taskType as any) ?? 'general',
          input: (metadata?.toolInput as string) ?? '',
          output: outputStr,
          timestamp: Date.now(),
          metadata: metadata,
        };

        // Use the quality estimator to assess output quality
        const assessment = assessQuality(interaction, QUALITY_THRESHOLDS.FEEDBACK);

        if (this.storageConfig.verbose) {
          console.log(`[CoreDaemon] Quality assessment for ${trajectoryId}:`, {
            score: assessment.score.toFixed(3),
            meetsThreshold: assessment.meetsThreshold,
            qualifiesForPattern: assessment.qualifiesForPattern,
          });
        }

        return {
          score: assessment.score,
          feedback: assessment.meetsThreshold
            ? undefined
            : `Quality ${assessment.score.toFixed(2)} below threshold ${QUALITY_THRESHOLDS.FEEDBACK}`,
          breakdown: assessment.factors,
        };
      };

      setQualityAssessmentCallback(qualityCallback);

      if (this.storageConfig.verbose) {
        console.log('[DaemonServer] Hooks registered and initialized');
        console.log('[DaemonServer] DESC/SonaEngine not available in core daemon');
        console.log('[DaemonServer] Quality assessment callback wired (TASK-HOOK-009)');
      }
    } catch (error) {
      this.state = 'stopped';
      throw createDaemonError(
        DaemonErrorCode.UNKNOWN,
        `Failed to initialize hooks: ${error instanceof Error ? error.message : String(error)}`,
        { originalError: error }
      );
    }

    // Clean up existing socket file if present
    if (existsSync(this.config.socketPath)) {
      try {
        unlinkSync(this.config.socketPath);
      } catch (error) {
        this.state = 'stopped';
        throw createDaemonError(
          DaemonErrorCode.PERMISSION_DENIED,
          `Cannot remove existing socket file: ${this.config.socketPath}`,
          { originalError: error }
        );
      }
    }

    return new Promise<void>((resolve, reject) => {
      this.server = createServer((socket) => this.handleConnection(socket));

      this.server.on('error', (error: NodeJS.ErrnoException) => {
        this.state = 'stopped';
        if (error.code === 'EADDRINUSE') {
          reject(
            createDaemonError(
              DaemonErrorCode.SOCKET_EXISTS,
              `Socket already in use: ${this.config.socketPath}`
            )
          );
        } else if (error.code === 'EACCES') {
          reject(
            createDaemonError(
              DaemonErrorCode.PERMISSION_DENIED,
              `Permission denied for socket: ${this.config.socketPath}`
            )
          );
        } else {
          reject(
            createDaemonError(
              DaemonErrorCode.UNKNOWN,
              `Server error: ${error.message}`,
              { originalError: error }
            )
          );
        }
      });

      this.server.listen(this.config.socketPath, () => {
        this.state = 'running';
        this.startedAt = Date.now();
        this.emitEvent('start', {
          socketPath: this.config.socketPath,
          registeredServices: Array.from(this.services.keys()),
        });
        resolve();
      });
    });
  }

  /**
   * Initialize storage backends for real service delegation
   *
   * Creates and initializes:
   * - EpisodeStore: SQLite + HNSW for episodic memory (RULE-011)
   * - GraphDB: Hypergraph with FallbackGraph backend (RULE-008)
   */
  private async initializeStores(): Promise<void> {
    // Initialize EpisodeStore with persistence configuration
    this.episodeStore = new EpisodeStore({
      storageDir: this.storageConfig.storageDir,
      verbose: this.storageConfig.verbose,
    });

    // Initialize GraphDB with FallbackGraph backend
    const fallbackGraph = new FallbackGraph(
      this.storageConfig.graphDataDir,
      5000, // lock timeout
      true  // enable persistence
    );

    this.graphDb = new GraphDB(fallbackGraph, {
      dataDir: this.storageConfig.graphDataDir,
      enablePersistence: true,
      validateDimensions: true,
      expectedDimensions: this.storageConfig.embeddingDimension,
    });

    // Initialize GraphDB (loads persisted data)
    await this.graphDb.initialize();

    if (this.storageConfig.verbose) {
      console.log('[DaemonServer] Storage backends initialized');
      console.log(`  - EpisodeStore: ${this.storageConfig.storageDir}`);
      console.log(`  - GraphDB: ${this.storageConfig.graphDataDir}`);
    }
  }

  /**
   * Register core services with injected storage backends
   *
   * Services are wired to real stores for actual data persistence:
   * - episode: EpisodeService -> EpisodeStore (SQLite + HNSW)
   * - hyperedge: HyperedgeService -> GraphDB (FallbackGraph)
   *
   * Uses adaptServiceHandler to convert service-registry format to daemon-types format.
   */
  private registerCoreServices(): void {
    if (!this.episodeStore || !this.graphDb) {
      throw new Error('Storage backends must be initialized before registering services');
    }

    // Register EpisodeService with real EpisodeStore delegation
    // Adapt from service-registry ServiceHandler to daemon-types ServiceHandler
    const episodeRegistryHandler = createEpisodeService(this.episodeStore);
    const episodeHandler = adaptServiceHandler(episodeRegistryHandler);
    this.registerService('episode', episodeHandler, [
      'create', 'query', 'link', 'stats', 'get', 'delete', 'getLinks', 'update', 'save'
    ]);

    // Register HyperedgeService with real GraphDB delegation
    const hyperedgeRegistryHandler = createHyperedgeService(this.graphDb);
    const hyperedgeHandler = adaptServiceHandler(hyperedgeRegistryHandler);
    this.registerService('hyperedge', hyperedgeHandler, [
      'create', 'createTemporal', 'query', 'expand', 'stats', 'get'
    ]);

    if (this.storageConfig.verbose) {
      console.log('[DaemonServer] Core services registered:');
      console.log('  - episode (9 methods)');
      console.log('  - hyperedge (6 methods)');
    }
  }

  /**
   * Stop the daemon server gracefully
   *
   * Notifies all clients, waits for in-flight requests, closes storage backends,
   * then closes the socket server.
   */
  async stop(): Promise<void> {
    if (this.state !== 'running') {
      return;
    }

    this.state = 'stopping';

    // Notify all clients of shutdown
    for (const client of this.clients.values()) {
      this.notifyClientShutdown(client);
    }

    // Wait for graceful shutdown or timeout
    await this.waitForShutdown();

    // Close all remaining connections
    for (const [clientId] of this.clients) {
      this.removeConnection(clientId);
    }

    // Close storage backends (save data before shutdown)
    await this.closeStores();

    // Close server
    return new Promise<void>((resolve) => {
      if (this.server) {
        this.server.close(() => {
          // Remove socket file
          if (existsSync(this.config.socketPath)) {
            try {
              unlinkSync(this.config.socketPath);
            } catch {
              // INTENTIONAL: Socket file cleanup errors are safe to ignore during shutdown
            }
          }

          this.server = null;
          this.state = 'stopped';
          this.emitEvent('stop', {
            uptime: Date.now() - this.startedAt,
            totalRequests: this.totalRequests,
          });
          resolve();
        });
      } else {
        this.state = 'stopped';
        resolve();
      }
    });
  }

  /**
   * Close storage backends and persist data
   *
   * Ensures all data is saved before server shutdown.
   */
  private async closeStores(): Promise<void> {
    try {
      // Save and close EpisodeStore
      if (this.episodeStore) {
        await this.episodeStore.close();
        this.episodeStore = null;
        if (this.storageConfig.verbose) {
          console.log('[DaemonServer] EpisodeStore closed');
        }
      }

      // GraphDB persists via FallbackGraph automatically
      // Just clear the reference
      if (this.graphDb) {
        this.graphDb = null;
        if (this.storageConfig.verbose) {
          console.log('[DaemonServer] GraphDB closed');
        }
      }
    } catch (error) {
      // Log but don't throw - we're shutting down
      console.error('[DaemonServer] Error closing stores:', error);
    }
  }

  /**
   * Register a service handler
   *
   * @param name - Service name
   * @param handler - Handler function for service calls
   * @param methods - List of supported methods
   */
  registerService(
    name: string,
    handler: ServiceHandler,
    methods: string[] = []
  ): void {
    this.services.set(name, { name, handler, methods });
  }

  /**
   * Unregister a service
   *
   * @param name - Service name to remove
   */
  unregisterService(name: string): boolean {
    return this.services.delete(name);
  }

  /**
   * Get registered service by name
   */
  getService(name: string): RegisteredService | undefined {
    return this.services.get(name);
  }

  /**
   * Get all registered services
   */
  getServices(): RegisteredService[] {
    return Array.from(this.services.values());
  }

  /**
   * Handle new client connection
   */
  private handleConnection(socket: Socket): void {
    // Check max clients limit
    if (this.clients.size >= this.config.maxClients) {
      this.rejectConnection(socket, ClientRejectionReason.MAX_CLIENTS_EXCEEDED);
      return;
    }

    // Check if server is shutting down
    if (this.state === 'stopping') {
      this.rejectConnection(socket, ClientRejectionReason.SERVER_SHUTTING_DOWN);
      return;
    }

    const clientId = generateClientId();
    const connection: ClientConnection = {
      id: clientId,
      socket,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
    };

    this.clients.set(clientId, connection);

    // Set up keepalive timeout
    this.resetKeepAliveTimer(clientId);

    // Handle socket events
    socket.on('data', (data) => this.handleData(clientId, data));
    socket.on('close', () => this.handleClose(clientId));
    socket.on('error', (error) => this.handleError(clientId, error));

    this.emitEvent('client_connect', { clientId });
  }

  /**
   * Reject a connection with reason
   */
  private rejectConnection(socket: Socket, reason: ClientRejectionReason): void {
    const message = JSON.stringify({
      error: {
        code: -32000,
        message: `Connection rejected: ${reason}`,
      },
    });
    socket.write(message);
    socket.end();
    this.emitEvent('client_rejected', { reason });
  }

  /**
   * Handle incoming data from client
   * Implements JSON-RPC 2.0 message parsing and routing
   *
   * TASK-DAEMON-002: Core RPC handler implementation
   */
  private handleData(clientId: string, data: Buffer): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Update activity tracking
    client.lastActivity = Date.now();
    this.totalRequests++;
    this.resetKeepAliveTimer(clientId);

    // Get or create message buffer for this client
    let buffer = this.messageBuffers.get(clientId) ?? '';
    buffer += data.toString();

    // Process complete messages (newline-delimited JSON)
    const messages = buffer.split('\n');
    this.messageBuffers.set(clientId, messages.pop() ?? '');

    for (const message of messages) {
      if (message.trim()) {
        this.processMessage(client.socket, message.trim());
      }
    }
  }

  /**
   * Process a single JSON-RPC message
   * TASK-DAEMON-002
   */
  private async processMessage(socket: Socket, message: string): Promise<void> {
    let request: unknown;

    try {
      request = JSON.parse(message);
    } catch {
      this.sendResponse(socket, {
        jsonrpc: '2.0',
        error: {
          code: JSON_RPC_ERROR_CODES.PARSE_ERROR,
          message: 'Parse error: Invalid JSON',
        },
        id: null,
      });
      return;
    }

    // Validate JSON-RPC 2.0 format
    if (!this.isValidRequest(request)) {
      this.sendResponse(socket, {
        jsonrpc: '2.0',
        error: {
          code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
          message: 'Invalid Request: Missing required fields',
        },
        id: (request as Record<string, unknown>)?.id as string | number | null ?? null,
      });
      return;
    }

    // Route to service handler
    const response = await this.routeRequest(request);
    this.sendResponse(socket, response);
  }

  /**
   * Validate JSON-RPC 2.0 request format
   * TASK-DAEMON-002
   */
  private isValidRequest(request: unknown): request is JsonRpcRequest {
    const req = request as Record<string, unknown>;
    return (
      typeof req === 'object' &&
      req !== null &&
      req.jsonrpc === '2.0' &&
      typeof req.method === 'string' &&
      req.method.length > 0
    );
  }

  /**
   * Route request to appropriate service handler
   * TASK-DAEMON-002
   */
  private async routeRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { method, params, id } = request;

    // Handle built-in health methods
    if (method === 'health.status') {
      return {
        jsonrpc: '2.0',
        result: {
          status: 'healthy',
          state: this.state,
          ...this.getStats(),
          services: Array.from(this.services.keys()),
        },
        id,
      };
    }

    if (method === 'health.ping') {
      return {
        jsonrpc: '2.0',
        result: { pong: true, timestamp: Date.now() },
        id,
      };
    }

    // Extract service name from method (format: "service.method")
    const parts = method.split('.');
    if (parts.length < 2) {
      return {
        jsonrpc: '2.0',
        error: {
          code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
          message: `Invalid method format: ${method}. Expected "service.method"`,
        },
        id,
      };
    }

    const serviceName = parts[0];
    const serviceMethod = parts.slice(1).join('.');

    // Find service handler
    const service = this.services.get(serviceName);
    if (!service) {
      return {
        jsonrpc: '2.0',
        error: {
          code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
          message: `Service not found: ${serviceName}`,
        },
        id,
      };
    }

    // Execute handler
    try {
      const result = await service.handler(serviceMethod, params);
      return {
        jsonrpc: '2.0',
        result,
        id,
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        error: {
          code: JSON_RPC_ERROR_CODES.HANDLER_ERROR,
          message: `Handler error: ${error instanceof Error ? error.message : String(error)}`,
          data: { service: serviceName, method: serviceMethod },
        },
        id,
      };
    }
  }

  /**
   * Send JSON-RPC response to client
   * TASK-DAEMON-002
   */
  private sendResponse(socket: Socket, response: JsonRpcResponse): void {
    try {
      const message = JSON.stringify(response) + '\n';
      socket.write(message);
    } catch (error) {
      // Log but don't throw - socket may be closed
      if (this.storageConfig.verbose) {
        console.error('[DaemonServer] Failed to send response:', error);
      }
    }
  }

  /**
   * Handle client disconnect
   */
  private handleClose(clientId: string): void {
    this.removeConnection(clientId);
  }

  /**
   * Handle socket error
   */
  private handleError(clientId: string, error: Error): void {
    // Use safeEmitError to avoid uncaught errors when no listener is registered
    this.safeEmitError({ clientId, error: error.message });
    this.removeConnection(clientId);
  }

  /**
   * Safely emit error event (won't throw if no listener)
   */
  private safeEmitError(data: Record<string, unknown>): void {
    const event: DaemonEvent = {
      type: 'error',
      timestamp: Date.now(),
      data,
    };
    // Only emit 'error' if there are listeners to prevent unhandled error exceptions
    if (this.listenerCount('error') > 0) {
      this.emit('error', event);
    }
    // Always emit through 'event' channel for monitoring
    this.emit('event', event);
  }

  /**
   * Remove a client connection
   */
  removeConnection(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Clear keepalive timer
    const timer = this.keepAliveTimers.get(clientId);
    if (timer) {
      clearTimeout(timer);
      this.keepAliveTimers.delete(clientId);
    }

    // Clean up message buffer - TASK-DAEMON-002
    this.messageBuffers.delete(clientId);

    // Close socket if still open
    if (!client.socket.destroyed) {
      client.socket.destroy();
    }

    this.clients.delete(clientId);
    this.emitEvent('client_disconnect', { clientId });
  }

  /**
   * Reset keepalive timer for client
   */
  private resetKeepAliveTimer(clientId: string): void {
    // Clear existing timer
    const existingTimer = this.keepAliveTimers.get(clientId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.removeConnection(clientId);
    }, this.config.keepAliveTimeout);

    this.keepAliveTimers.set(clientId, timer);
  }

  /**
   * Notify client of server shutdown
   */
  private notifyClientShutdown(client: ClientConnection): void {
    try {
      const message = JSON.stringify({
        notification: 'shutdown',
        message: 'Server is shutting down',
      });
      client.socket.write(message);
    } catch {
      // INTENTIONAL: Write errors during shutdown are expected for disconnected clients
    }
  }

  /**
   * Wait for graceful shutdown
   */
  private async waitForShutdown(): Promise<void> {
    return new Promise<void>((resolve) => {
      const startTime = Date.now();

      const checkClients = () => {
        // Check if all clients disconnected or timeout
        if (
          this.clients.size === 0 ||
          Date.now() - startTime >= GRACEFUL_SHUTDOWN_TIMEOUT_MS
        ) {
          resolve();
        } else {
          setTimeout(checkClients, 100);
        }
      };

      checkClients();
    });
  }

  /**
   * Emit a daemon event
   */
  private emitEvent(
    type: DaemonEvent['type'],
    data?: Record<string, unknown>
  ): void {
    const event: DaemonEvent = {
      type,
      timestamp: Date.now(),
      data,
    };
    this.emit(type, event);
    this.emit('event', event);
  }

  /**
   * Get daemon statistics
   */
  getStats(): DaemonStats {
    return {
      activeConnections: this.clients.size,
      totalRequests: this.totalRequests,
      uptime: this.state === 'running' ? Date.now() - this.startedAt : 0,
      startedAt: this.startedAt,
    };
  }

  /**
   * Get current daemon state
   */
  getState(): DaemonState {
    return this.state;
  }

  /**
   * Get client connection info
   */
  getClient(clientId: string): ClientConnection | undefined {
    return this.clients.get(clientId);
  }

  /**
   * Get all connected clients
   */
  getClients(): ClientConnection[] {
    return Array.from(this.clients.values());
  }

  /**
   * Get configuration
   */
  getConfig(): DaemonConfig {
    return { ...this.config };
  }

  /**
   * Get storage configuration
   */
  getStorageConfig(): typeof DEFAULT_STORAGE_CONFIG {
    return { ...this.storageConfig };
  }

  /**
   * Get EpisodeStore instance (for advanced usage/testing)
   *
   * @returns EpisodeStore instance or null if not initialized
   */
  getEpisodeStore(): EpisodeStore | null {
    return this.episodeStore;
  }

  /**
   * Get GraphDB instance (for advanced usage/testing)
   *
   * @returns GraphDB instance or null if not initialized
   */
  getGraphDb(): GraphDB | null {
    return this.graphDb;
  }
}
