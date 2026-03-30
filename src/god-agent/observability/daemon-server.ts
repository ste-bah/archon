/**
 * DaemonServer - Observability Daemon Process
 *
 * Implements the observability daemon process that:
 * 1. Initializes all observability components
 * 2. Starts Unix socket server for God Agent communication
 * 3. Starts Express HTTP server for dashboard
 * 4. Handles graceful shutdown on SIGTERM/SIGINT
 *
 * @module observability/daemon-server
 * @see TASK-OBS-009-DAEMON-CLI.md
 * @see SPEC-OBS-001-CORE.md
 */

import * as fs from 'fs';
import * as path from 'path';
import { ActivityStream } from './activity-stream.js';
import { AgentExecutionTracker } from './agent-tracker.js';
import { PipelineTracker } from './pipeline-tracker.js';
import { RoutingHistory } from './routing-history.js';
import { EventStore } from './event-store.js';
import { SSEBroadcaster } from './sse-broadcaster.js';
import { SocketServer } from './socket-server.js';
import { ExpressServer, IServerDependencies } from './express-server.js';
import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../core/observability/index.js';

const daemonLogger = createComponentLogger('DaemonServer', {
  minLevel: LogLevel.WARN,
  handlers: [new ConsoleLogHandler({ useStderr: true })]
});

// =============================================================================
// Constants
// =============================================================================

const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '.';
const GOD_AGENT_DIR = path.join(HOME_DIR, '.god-agent');
const PID_FILE = path.join(GOD_AGENT_DIR, 'daemon.pid');

// =============================================================================
// Interfaces
// =============================================================================

/**
 * Daemon server configuration
 */
export interface IDaemonServerConfig {
  /** HTTP port (default: 3847) */
  port?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * DaemonServer interface
 * Implements [REQ-OBS-12]: Daemon lifecycle management
 */
export interface IDaemonServer {
  /**
   * Start the daemon server
   * @param port HTTP port to listen on
   * @returns Promise resolving when server is started
   */
  start(port: number): Promise<void>;

  /**
   * Stop the daemon server
   * @returns Promise resolving when server is stopped
   */
  stop(): Promise<void>;

  /**
   * Get the current port
   * @returns Port number or 0 if not started
   */
  getPort(): number;

  /**
   * Check if server is running
   * @returns True if running
   */
  isRunning(): boolean;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Ensure .god-agent directory exists
 * Implements [REQ-OBS-12]: Runtime files in ~/.god-agent/
 */
function ensureGodAgentDir(): void {
  if (!fs.existsSync(GOD_AGENT_DIR)) {
    fs.mkdirSync(GOD_AGENT_DIR, { recursive: true });
  }
}

/**
 * Write PID file
 * Implements [REQ-OBS-12]: PID file management
 */
export function writePidFile(pid: number): void {
  ensureGodAgentDir();
  fs.writeFileSync(PID_FILE, pid.toString(), 'utf-8');
}

/**
 * Remove PID file
 */
export function removePidFile(): void {
  if (fs.existsSync(PID_FILE)) {
    fs.unlinkSync(PID_FILE);
  }
}

/**
 * Read PID from file
 * @returns PID or null if file doesn't exist
 */
export function readPidFile(): number | null {
  if (!fs.existsSync(PID_FILE)) {
    return null;
  }
  const pidStr = fs.readFileSync(PID_FILE, 'utf-8').trim();
  const pid = parseInt(pidStr, 10);
  return isNaN(pid) ? null : pid;
}

/**
 * Check if process is running
 * @param pid Process ID to check
 * @returns True if process exists
 */
export function isProcessRunning(pid: number): boolean {
  try {
    // Signal 0 checks if process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * DaemonServer implementation
 *
 * Implements:
 * - [REQ-OBS-12]: Daemon lifecycle management
 * - [RULE-OBS-007]: Startup time < 2 seconds
 * - [RULE-OBS-003]: Graceful shutdown
 */
export class DaemonServer implements IDaemonServer {
  private components: IServerDependencies | null = null;
  private expressServer: ExpressServer | null = null;
  private socketServer: SocketServer | null = null;
  private port: number = 0;
  private verbose: boolean;
  private running: boolean = false;

  /**
   * Create a new DaemonServer
   * @param config Optional configuration
   */
  constructor(config: IDaemonServerConfig = {}) {
    this.verbose = config.verbose ?? false;
  }

  /**
   * Start the daemon server
   * Implements [REQ-OBS-12]: Complete startup sequence
   */
  async start(port: number): Promise<void> {
    const startTime = Date.now();

    if (this.running) {
      throw new Error('Daemon is already running');
    }

    this.log('[Daemon] Starting...');

    // Track whether we've marked as running
    let markedRunning = false;

    try {
      // 1. Ensure directories exist
      ensureGodAgentDir();

      // 2. Initialize components
      this.log('[Daemon] Initializing components...');
      const activityStream = new ActivityStream();
      const eventStore = new EventStore();
      const sseBroadcaster = new SSEBroadcaster();

      this.components = {
        activityStream,
        agentTracker: new AgentExecutionTracker(activityStream),
        pipelineTracker: new PipelineTracker(activityStream),
        routingHistory: new RoutingHistory(activityStream),
        eventStore,
        sseBroadcaster,
      };

      // 3. Start Unix socket server
      this.log('[Daemon] Starting socket server...');
      this.socketServer = new SocketServer(this.components, { verbose: this.verbose });
      await this.socketServer.start();

      // 4. Start Express server
      this.log('[Daemon] Starting HTTP server...');
      this.expressServer = new ExpressServer(this.components, { verbose: this.verbose });
      await this.expressServer.start(port);
      this.port = port;

      // 5. Write PID file
      writePidFile(process.pid);

      // 6. Setup signal handlers
      this.setupSignalHandlers();

      // Mark as running ONLY after successful startup
      this.running = true;
      markedRunning = true;

      const duration = Date.now() - startTime;

      this.log(`[Daemon] Started in ${duration}ms`);
      this.log(`[Daemon] PID: ${process.pid}`);
      this.log(`[Daemon] Dashboard: http://localhost:${port}`);
      this.log(`[Daemon] Socket: ${this.socketServer.getSocketPath()}`);

      // Verify startup time budget (< 2 seconds per RULE-OBS-007)
      if (duration > 2000) {
        daemonLogger.warn('Startup time exceeds budget', { durationMs: duration, budgetMs: 2000 });
      }
    } catch (error) {
      this.log(`[Daemon] Startup failed: ${error}`);
      // Ensure running flag is false
      this.running = false;
      // Cleanup on failure
      await this.cleanup();
      throw error;
    }
  }

  /**
   * Stop the daemon server
   * Implements [REQ-OBS-12]: Graceful shutdown
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.log('[Daemon] Stopping...');
    this.running = false;

    await this.cleanup();

    this.log('[Daemon] Stopped');
  }

  /**
   * Cleanup all resources
   */
  private async cleanup(): Promise<void> {
    // Stop Express server
    if (this.expressServer) {
      try {
        await this.expressServer.stop();
      } catch (error) {
        this.log(`[Daemon] Error stopping Express server: ${error}`);
      }
      this.expressServer = null;
    }

    // Stop Unix socket server
    if (this.socketServer) {
      try {
        await this.socketServer.stop();
      } catch (error) {
        this.log(`[Daemon] Error stopping socket server: ${error}`);
      }
      this.socketServer = null;
    }

    // Close AgentExecutionTracker (SQLite)
    if (this.components?.agentTracker) {
      try {
        const tracker = this.components.agentTracker as unknown as { close?: () => void };
        if (typeof tracker.close === 'function') {
          tracker.close();
        }
      } catch (error) {
        this.log(`[Daemon] Error closing AgentExecutionTracker: ${error}`);
      }
    }

    // Close EventStore
    if (this.components?.eventStore) {
      try {
        await this.components.eventStore.close();
      } catch (error) {
        this.log(`[Daemon] Error closing EventStore: ${error}`);
      }
    }

    // Shutdown SSE broadcaster
    if (this.components?.sseBroadcaster) {
      try {
        this.components.sseBroadcaster.shutdown();
      } catch (error) {
        this.log(`[Daemon] Error shutting down SSE broadcaster: ${error}`);
      }
    }

    // Remove PID file
    removePidFile();

    this.components = null;
    this.port = 0;
  }

  /**
   * Setup signal handlers for graceful shutdown
   * Implements [REQ-OBS-12]: Handle SIGTERM and SIGINT
   */
  private setupSignalHandlers(): void {
    // Only setup signal handlers if not already setup
    // This prevents EventEmitter memory leak warnings in tests
    if ((process as any)._godAgentSignalHandlersSetup) {
      return;
    }
    (process as any)._godAgentSignalHandlersSetup = true;

    const handleShutdown = async (signal: string) => {
      this.log(`[Daemon] Received ${signal}, shutting down gracefully...`);
      try {
        await this.stop();
        process.exit(0);
      } catch (error) {
        this.log(`[Daemon] Error during shutdown: ${error}`);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
  }

  /**
   * Get the current port
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Log message if verbose mode enabled
   */
  private log(message: string): void {
    if (this.verbose || process.env.DAEMON_VERBOSE === 'true') {
      console.log(message);
    }
  }
}

// =============================================================================
// Main Entry Point (for direct execution)
// =============================================================================

/**
 * Start daemon if executed directly
 */
async function main(): Promise<void> {
  const port = parseInt(process.env.PORT || '3847', 10);
  const server = new DaemonServer({ verbose: true });

  try {
    await server.start(port);
    // Keep process alive
    await new Promise(() => {}); // Never resolves
  } catch (error) {
    daemonLogger.error('Failed to start daemon', error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  }
}

// Execute if run directly (ESM compatible check)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((error) => {
    daemonLogger.fatal('Fatal error', error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  });
}
