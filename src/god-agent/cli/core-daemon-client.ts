/**
 * Core Daemon Client for God Agent
 * Provides JSON-RPC 2.0 communication with the core God Agent daemon
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: DAEMON-002
 *
 * Features auto-start: if daemon is not running, automatically starts it.
 * Implements RULE-106 (spawn not exec) and RULE-108 (env allowlist).
 */

import * as net from 'net';
import * as fs from 'fs';
import { spawn } from 'child_process'; // Implements RULE-106: spawn not exec
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../core/observability/index.js';

const logger = createComponentLogger('CoreDaemonClient', {
  minLevel: LogLevel.INFO,
  handlers: [new ConsoleLogHandler({ useStderr: true })]
});

// Implements DAEMON-002: Socket path from daemon-types.ts
const DEFAULT_SOCKET_PATH = '/tmp/godagent-db.sock';
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DAEMON_START_TIMEOUT = 5000; // 5 seconds to wait for daemon to start

/**
 * JSON-RPC 2.0 request structure
 */
interface RPCRequest {
  jsonrpc: '2.0';
  method: string;
  params: unknown;
  id: number;
}

/**
 * JSON-RPC 2.0 response structure
 */
interface RPCResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  id: number;
}

/**
 * Health check result from daemon
 */
interface HealthCheckResult {
  status: string;
  timestamp: number;
}

/**
 * Status result from daemon
 */
interface StatusResult {
  uptime: number;
  memory: NodeJS.MemoryUsage;
  services: string[];
}

/**
 * Core Daemon Client
 *
 * Implements DAEMON-002: Auto-start functionality for core daemon
 * Implements RULE-091: JSDoc on all public methods
 * Implements RULE-106: Uses spawn() not exec()
 * Implements RULE-108: Allowlisted environment variables
 */
export class CoreDaemonClient {
  private socketPath: string;
  private timeout: number;
  private requestId: number = 0;
  private autoStartAttempted: boolean = false;
  private autoStart: boolean;

  /**
   * Create a new CoreDaemonClient
   *
   * Implements DAEMON-002: Client initialization
   *
   * @param options - Configuration options
   * @param options.socketPath - Path to Unix socket (default: /tmp/godagent-db.sock)
   * @param options.timeout - Request timeout in milliseconds (default: 30000)
   * @param options.autoStart - Whether to auto-start daemon if not running (default: false)
   */
  constructor(options?: { socketPath?: string; timeout?: number; autoStart?: boolean }) {
    this.socketPath = options?.socketPath || DEFAULT_SOCKET_PATH;
    this.timeout = options?.timeout || DEFAULT_TIMEOUT;
    this.autoStart = options?.autoStart ?? false;
  }

  /**
   * Check if daemon socket exists
   *
   * Implements DAEMON-002: Socket existence check
   * Implements RULE-069: Try/catch with context
   *
   * @returns True if socket file exists
   */
  private socketExists(): boolean {
    try {
      return fs.existsSync(this.socketPath);
    } catch (error) {
      // INTENTIONAL: Socket existence check failure means socket is not accessible - return false
      // Implements RULE-070: Error context logging
      logger.debug('Socket existence check failed', {
        socketPath: this.socketPath,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Start the core daemon in background
   *
   * Implements DAEMON-002: Auto-start daemon functionality
   * Implements RULE-106: Uses spawn() not exec() for security
   * Implements RULE-108: Allowlisted environment variables only
   * Implements RULE-069: Try/catch with error context
   *
   * @returns True if daemon started successfully
   */
  private async startDaemon(): Promise<boolean> {
    if (this.autoStartAttempted) {
      return false; // Only try once per client instance
    }
    this.autoStartAttempted = true;

    try {
      // Find the daemon-cli.ts path relative to this file
      // Implements DAEMON-002: Daemon path resolution
      const currentFile = fileURLToPath(import.meta.url);
      const currentDir = dirname(currentFile);
      // core-daemon-client.ts is in src/god-agent/cli/
      // daemon-cli.ts is in src/god-agent/core/daemon/
      const daemonPath = join(currentDir, '..', 'core', 'daemon', 'daemon-cli.ts');

      logger.info('Auto-starting core daemon', { daemonPath });

      // Implements RULE-108: Allowlisted environment variables only (not full process.env)
      const allowedEnv: Record<string, string> = {
        PATH: process.env.PATH || '',
        HOME: process.env.HOME || '',
        NODE_ENV: process.env.NODE_ENV || 'production',
        // Only pass essential environment variables
      };

      // Implements RULE-106: spawn not exec - prevents command injection
      const child = spawn('npx', ['tsx', daemonPath, 'start'], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        env: allowedEnv, // Implements RULE-108: Allowlisted env vars
      });

      // Unref so parent can exit independently
      child.unref();

      // Wait for socket to appear
      // Implements DAEMON-002: Socket readiness detection
      const startTime = Date.now();
      while (Date.now() - startTime < DAEMON_START_TIMEOUT) {
        await new Promise((r) => setTimeout(r, 200));
        if (this.socketExists()) {
          logger.info('Core daemon started successfully');
          return true;
        }
      }

      logger.warn('Core daemon did not start within timeout', {
        timeout: DAEMON_START_TIMEOUT,
        socketPath: this.socketPath
      });
      return false;
    } catch (error) {
      // Implements RULE-069: Try/catch with context logging
      // Implements RULE-070: Error context
      logger.error('Failed to start core daemon', {
        error: error instanceof Error ? error : new Error(String(error)),
        context: { socketPath: this.socketPath }
      });
      return false;
    }
  }

  /**
   * Ensure daemon is running, start if needed
   *
   * Implements DAEMON-002: Daemon availability guarantee
   *
   * @returns True if daemon is running or was started successfully
   */
  private async ensureDaemonRunning(): Promise<boolean> {
    if (this.socketExists()) {
      return true;
    }
    if (!this.autoStart) {
      return false;
    }
    return this.startDaemon();
  }

  /**
   * Call core daemon via JSON-RPC over Unix socket
   *
   * Implements DAEMON-002: JSON-RPC 2.0 communication
   * Implements RULE-069: Try/catch error handling
   *
   * Auto-starts daemon if not running
   *
   * @param method - RPC method name (e.g., 'health.check')
   * @param params - Method parameters
   * @returns Promise resolving to method result
   * @throws Error if RPC call fails
   */
  private async call<T>(method: string, params: unknown): Promise<T> {
    // Ensure daemon is running before attempting connection
    // Implements DAEMON-002: Auto-start integration
    await this.ensureDaemonRunning();

    return new Promise((resolve, reject) => {
      const socket = net.connect(this.socketPath);
      const request: RPCRequest = {
        jsonrpc: '2.0',
        method,
        params,
        id: ++this.requestId,
      };

      let responseBuffer = '';
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Core daemon timeout calling ${method}`));
      }, this.timeout);

      socket.on('connect', () => {
        socket.write(JSON.stringify(request) + '\n');
      });

      socket.on('data', (data) => {
        responseBuffer += data.toString();

        // Check if we have a complete JSON response
        try {
          const response: RPCResponse = JSON.parse(responseBuffer);
          clearTimeout(timeout);
          socket.end();

          if (response.error) {
            reject(new Error(`Core RPC Error [${response.error.code}]: ${response.error.message}`));
          } else {
            resolve(response.result as T);
          }
        } catch {
          // INTENTIONAL: Incomplete JSON, wait for more data - streaming RPC response pattern
          // This is expected behavior for chunked socket data
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        // Implements RULE-070: Error context logging
        logger.error('Core daemon connection error', {
          error: err,
          context: { method, socketPath: this.socketPath }
        });
        reject(new Error(`Core daemon connection error: ${err.message}`));
      });

      socket.on('timeout', () => {
        clearTimeout(timeout);
        socket.destroy();
        reject(new Error(`Core socket timeout calling ${method}`));
      });
    });
  }

  /**
   * Check if core daemon is healthy
   *
   * Implements DAEMON-002: Health check method
   * Implements RULE-091: JSDoc on public methods
   *
   * @returns True if daemon is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      const result = await this.call<HealthCheckResult>('health.check', {});
      return result?.status === 'ok';
    } catch (error) {
      // INTENTIONAL: Health check failure means daemon is unavailable - false is correct response
      logger.debug('Health check failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Get detailed health status
   *
   * Implements DAEMON-002: Health check method
   * Implements RULE-091: JSDoc on public methods
   *
   * @returns Health check result or null if unavailable
   */
  async healthCheck(): Promise<HealthCheckResult | null> {
    try {
      return await this.call<HealthCheckResult>('health.check', {});
    } catch (error) {
      // INTENTIONAL: Health check call failure means daemon unavailable - null is correct response
      logger.debug('Health check call failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Get daemon status and metrics
   *
   * Implements DAEMON-002: Status method
   * Implements RULE-091: JSDoc on public methods
   *
   * @returns Status result with uptime, memory, and services
   */
  async getStatus(): Promise<StatusResult | null> {
    try {
      return await this.call<StatusResult>('status.get', {});
    } catch (error) {
      // Implements RULE-070: Error context logging
      logger.error('Status check failed', {
        error: error instanceof Error ? error : new Error(String(error)),
        context: { socketPath: this.socketPath }
      });
      return null;
    }
  }

  /**
   * Call a custom RPC method
   *
   * Implements DAEMON-002: Generic RPC method
   * Implements RULE-091: JSDoc on public methods
   *
   * @param method - RPC method name
   * @param params - Method parameters
   * @returns Promise resolving to method result
   */
  async callMethod<T>(method: string, params: unknown): Promise<T> {
    return this.call<T>(method, params);
  }
}

// Implements DAEMON-002: Singleton pattern
let defaultClient: CoreDaemonClient | null = null;

/**
 * Get the default CoreDaemonClient singleton
 *
 * Implements DAEMON-002: Singleton accessor
 * Implements RULE-091: JSDoc on public methods
 *
 * @returns The default CoreDaemonClient instance
 */
export function getCoreDaemonClient(): CoreDaemonClient {
  if (!defaultClient) {
    defaultClient = new CoreDaemonClient();
  }
  return defaultClient;
}

/**
 * Reset the default CoreDaemonClient singleton
 *
 * Implements DAEMON-002: Singleton reset for testing
 * Implements RULE-091: JSDoc on public methods
 *
 * Used primarily for testing to ensure clean state
 */
export function resetCoreDaemonClient(): void {
  defaultClient = null;
}
