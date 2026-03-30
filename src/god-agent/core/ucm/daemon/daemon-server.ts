/**
 * UCM Daemon Server (SVC-005)
 * Unix socket JSON-RPC 2.0 server for Universal Context Management
 *
 * FEATURES:
 * - Unix socket IPC at /tmp/godagent-db.sock
 * - JSON-RPC 2.0 request routing
 * - Service registration and lifecycle management
 * - Connection management
 *
 * CONSTITUTION RULES: RULE-051 to RULE-054
 */

import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ContextService } from './context-service.js';
import { DescService } from './desc-service.js';
import { RecoveryService } from './recovery-service.js';
import { HealthService } from './health-service.js';
import { EmbeddingProxy } from '../desc/embedding-proxy.js';
import type { IUniversalContextConfig } from '../types.js';
import { DEFAULT_UCM_CONFIG } from '../config.js';
import {
  registerRequiredHooks,
  getHookRegistry,
  setDescServiceGetter,
  setSonaEngineGetter,
  setQualityAssessmentCallback,
  type QualityAssessmentCallback,
  type IQualityAssessment,
  QUALITY_THRESHOLDS
} from '../../hooks/index.js';
import { assessQuality, type QualityInteraction } from '../../../universal/quality-estimator.js';

/**
 * Default path for DESC persistent storage
 * Uses project directory if available, falls back to user home
 */
function getDefaultDescDbPath(): string {
  // Try to use project-local .god-agent directory
  const projectPath = process.env.GOD_AGENT_PROJECT_PATH ?? process.cwd();
  const projectDbPath = path.join(projectPath, '.god-agent', 'desc.db');

  // Check if .god-agent directory exists or can be created
  const godAgentDir = path.dirname(projectDbPath);
  try {
    if (!fs.existsSync(godAgentDir)) {
      fs.mkdirSync(godAgentDir, { recursive: true });
    }
    return projectDbPath;
  } catch {
    // INTENTIONAL: Project directory not writable - fall back to user home directory
    const homeDbPath = path.join(os.homedir(), '.god-agent', 'desc.db');
    const homeGodAgentDir = path.dirname(homeDbPath);
    if (!fs.existsSync(homeGodAgentDir)) {
      fs.mkdirSync(homeGodAgentDir, { recursive: true });
    }
    return homeDbPath;
  }
}

// ============================================================================
// JSON-RPC 2.0 Types
// ============================================================================

interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params: unknown;
  id: string | number | null;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: JsonRpcError;
  id: string | number | null;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
} as const;

// ============================================================================
// Service Registry
// ============================================================================

type ServiceHandler = {
  handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse>;
};

// ============================================================================
// Daemon Server
// ============================================================================

export class DaemonServer {
  private server: net.Server | null = null;
  private config: IUniversalContextConfig;
  private services: Map<string, ServiceHandler> = new Map();
  private connections: Set<net.Socket> = new Set();
  private running = false;

  // Service instances
  private contextService: ContextService;
  private descService: DescService;
  private recoveryService: RecoveryService;
  private healthService: HealthService;
  private embeddingProxy: EmbeddingProxy;

  constructor(config?: Partial<IUniversalContextConfig>) {
    this.config = { ...DEFAULT_UCM_CONFIG, ...config };

    // Initialize embedding proxy with correct config object
    this.embeddingProxy = new EmbeddingProxy({
      baseUrl: this.config.embedding.httpEndpoint.replace('/embed', ''),
      timeout: this.config.embedding.timeout
    });

    // Initialize services
    // RULE-030: DescService MUST use persistent storage
    const descDbPath = getDefaultDescDbPath();
    console.log(`[DaemonServer] Initializing DescService with persistent storage at: ${descDbPath}`);

    this.contextService = new ContextService();
    this.descService = new DescService({
      dbPath: descDbPath,
      embeddingProxy: this.embeddingProxy
    });
    this.recoveryService = new RecoveryService();
    this.healthService = new HealthService(this.embeddingProxy);

    // Configure health service
    this.healthService.setEmbeddingConfig(
      this.config.embedding.httpEndpoint,
      this.config.embedding.model,
      this.config.embedding.dimension
    );

    // Register services
    this.registerService('context', this.contextService);
    this.registerService('desc', this.descService);
    this.registerService('recovery', this.recoveryService);
    this.registerService('health', this.healthService);

    // RULE-032: Register all required hooks at daemon startup
    // Implements: GAP-HOOK-001, REQ-HOOK-001
    registerRequiredHooks();
    getHookRegistry().initialize();
    console.log('[DaemonServer] Hooks registered and initialized');

    // TASK-HOOK-007: Wire service getters for DESC auto-injection
    // RULE-033: DESC context MUST be injected into every Task-style tool call
    // The getters enable late binding - hooks are registered before services are ready
    setDescServiceGetter(() => this.descService);
    console.log('[DaemonServer] DESC service getter wired for auto-injection');

    // SonaEngine getter - set to null getter since SonaEngine is not initialized in UCM daemon
    // When SonaEngine is integrated, update this to return the actual instance
    setSonaEngineGetter(() => null);
    console.log('[DaemonServer] SonaEngine getter wired (no instance in UCM daemon)');

    // TASK-HOOK-009: Wire quality assessment callback
    // RULE-035: All agent results MUST be assessed for quality with 0.5 threshold
    // RULE-036: Task hook outputs MUST include quality assessment scores
    // This callback implements the quality feedback loop for learning
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

      console.log(`[DaemonServer] Quality assessment for ${trajectoryId}:`, {
        score: assessment.score.toFixed(3),
        meetsThreshold: assessment.meetsThreshold,
        qualifiesForPattern: assessment.qualifiesForPattern,
        threshold: QUALITY_THRESHOLDS.FEEDBACK,
      });

      // Return IQualityAssessment format for the hook
      return {
        score: assessment.score,
        feedback: assessment.meetsThreshold
          ? undefined
          : `Quality ${assessment.score.toFixed(2)} below threshold ${QUALITY_THRESHOLDS.FEEDBACK}`,
        breakdown: assessment.factors,
      };
    };

    setQualityAssessmentCallback(qualityCallback);
    console.log('[DaemonServer] Quality assessment callback wired (TASK-HOOK-009)');
  }

  /**
   * Register a service handler
   */
  private registerService(namespace: string, handler: ServiceHandler): void {
    this.services.set(namespace, handler);
  }

  /**
   * Start the daemon server
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Daemon server already running');
    }

    const socketPath = this.config.daemon.socketPath;

    // Remove existing socket file if it exists
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on('error', (error) => {
        console.error('Daemon server error:', error);
        reject(error);
      });

      this.server.listen(socketPath, () => {
        this.running = true;
        console.log(`UCM Daemon listening on ${socketPath}`);
        resolve();
      });
    });
  }

  /**
   * Stop the daemon server
   */
  async stop(): Promise<void> {
    if (!this.running || !this.server) {
      return;
    }

    // Close all connections
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();

    return new Promise((resolve, reject) => {
      this.server!.close((error) => {
        if (error) {
          reject(error);
        } else {
          this.running = false;

          // Remove socket file
          const socketPath = this.config.daemon.socketPath;
          if (fs.existsSync(socketPath)) {
            fs.unlinkSync(socketPath);
          }

          resolve();
        }
      });
    });
  }

  /**
   * Handle client connection
   */
  private handleConnection(socket: net.Socket): void {
    this.connections.add(socket);

    let buffer = '';

    socket.on('data', async (data) => {
      buffer += data.toString();

      // Process complete JSON-RPC messages (newline-delimited)
      const messages = buffer.split('\n');
      buffer = messages.pop() ?? '';

      for (const message of messages) {
        if (message.trim()) {
          await this.handleMessage(socket, message.trim());
        }
      }
    });

    socket.on('end', () => {
      this.connections.delete(socket);
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error);
      this.connections.delete(socket);
    });
  }

  /**
   * Handle JSON-RPC message
   */
  private async handleMessage(socket: net.Socket, message: string): Promise<void> {
    let request: JsonRpcRequest;

    try {
      request = JSON.parse(message) as JsonRpcRequest;
    } catch (error) {
      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        error: {
          code: ERROR_CODES.PARSE_ERROR,
          message: 'Parse error'
        },
        id: null
      };
      this.sendResponse(socket, response);
      return;
    }

    // Route to appropriate service
    const response = await this.routeRequest(request);
    this.sendResponse(socket, response);
  }

  /**
   * Route request to appropriate service
   */
  private async routeRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { method, id } = request;

    // Extract namespace from method (e.g., "context.estimate" -> "context")
    const parts = method.split('.');
    if (parts.length < 2) {
      return {
        jsonrpc: '2.0',
        error: {
          code: ERROR_CODES.METHOD_NOT_FOUND,
          message: `Invalid method format: ${method}`
        },
        id
      };
    }

    const namespace = parts[0];
    const handler = this.services.get(namespace);

    if (!handler) {
      return {
        jsonrpc: '2.0',
        error: {
          code: ERROR_CODES.METHOD_NOT_FOUND,
          message: `Service not found: ${namespace}`
        },
        id
      };
    }

    // Delegate to service handler
    return handler.handleRequest(request);
  }

  /**
   * Send JSON-RPC response to client
   */
  private sendResponse(socket: net.Socket, response: JsonRpcResponse): void {
    const message = JSON.stringify(response) + '\n';
    socket.write(message);
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get active connection count
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get health service for metrics tracking
   */
  getHealthService(): HealthService {
    return this.healthService;
  }
}

// ============================================================================
// Standalone Daemon Entry Point
// ============================================================================

/**
 * Create and start daemon server
 */
export async function startDaemon(
  config?: Partial<IUniversalContextConfig>
): Promise<DaemonServer> {
  const daemon = new DaemonServer(config);
  await daemon.start();
  return daemon;
}

/**
 * Main entry point when run directly
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  startDaemon()
    .then((daemon) => {
      console.log('UCM Daemon started successfully');

      // Neutralize tsx's internal ESM loader handles to prevent CPU spin.
      process.stdin?.pause();
      if (typeof process.stdin?.unref === 'function') {
        process.stdin.unref();
      }
      const activeHandles = (process as any)._getActiveHandles?.();
      if (Array.isArray(activeHandles)) {
        for (const handle of activeHandles) {
          if (handle instanceof net.Server) continue; // Keep daemon socket alive
          if (typeof handle.unref === 'function') {
            handle.unref();
          }
        }
      }

      // Handle shutdown signals
      process.on('SIGINT', async () => {
        console.log('\nShutting down UCM Daemon...');
        await daemon.stop();
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        console.log('\nShutting down UCM Daemon...');
        await daemon.stop();
        process.exit(0);
      });
    })
    .catch((error) => {
      console.error('Failed to start UCM Daemon:', error);
      process.exit(1);
    });
}
