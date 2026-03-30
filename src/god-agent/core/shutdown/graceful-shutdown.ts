/**
 * Graceful Shutdown Handler
 * TASK-ERR-005 - Implement graceful shutdown handlers
 *
 * Constitution: RULE-073 (All components MUST register graceful shutdown handlers)
 *
 * Features:
 * - 5-second timeout per shutdown handler (HARD LIMIT)
 * - SIGTERM and SIGINT signal handling
 * - Uncaught exception handling
 * - Flush all pending writes before exit
 * - Ordered shutdown with logging
 *
 * Components requiring shutdown:
 * - EpisodeStore: store.close() for HNSW index and SQLite
 * - WeightManager: manager.createCheckpoint() for recovery
 * - GraphDB: db.clear() for cleanup
 * - DualEmbeddingStore: store.flush() then store.close()
 * - DaemonServer: Stop listening, close connections
 * - SonaEngine: Flush trajectory buffers
 */

import { logger, createComponentLogger, type StructuredLogger } from '../observability/index.js';

// ============================================================================
// Constants
// ============================================================================

/** Default timeout per handler in milliseconds (Constitution: 5 seconds HARD LIMIT) */
export const DEFAULT_HANDLER_TIMEOUT_MS = 5000;

/** Maximum time for entire shutdown sequence */
export const MAX_SHUTDOWN_TIME_MS = 30000;

/** Minimum time between shutdown attempts to prevent rapid re-entry */
export const SHUTDOWN_DEBOUNCE_MS = 100;

// ============================================================================
// Types
// ============================================================================

/**
 * Priority levels for shutdown handlers
 * Higher priority handlers run first (e.g., flush before close)
 */
export enum ShutdownPriority {
  /** Critical operations that must run first (e.g., checkpoint creation) */
  CRITICAL = 100,
  /** High priority (e.g., flush pending writes) */
  HIGH = 75,
  /** Normal priority (e.g., close connections) */
  NORMAL = 50,
  /** Low priority (e.g., cleanup temp files) */
  LOW = 25,
  /** Final cleanup operations */
  CLEANUP = 0,
}

/**
 * Shutdown handler function signature
 */
export type ShutdownHandlerFn = () => Promise<void>;

/**
 * Registered shutdown handler with metadata
 */
export interface IShutdownHandler {
  /** Unique name for this handler */
  name: string;
  /** The async function to execute during shutdown */
  handler: ShutdownHandlerFn;
  /** Priority level (higher runs first) */
  priority: ShutdownPriority;
  /** Optional timeout override (default: 5000ms) */
  timeoutMs?: number;
  /** Component this handler belongs to */
  component?: string;
}

/**
 * Result of executing a shutdown handler
 */
export interface IShutdownHandlerResult {
  name: string;
  success: boolean;
  durationMs: number;
  error?: Error;
  timedOut: boolean;
}

/**
 * Reason for shutdown
 */
export type ShutdownReason =
  | 'SIGTERM'
  | 'SIGINT'
  | 'SIGHUP'
  | 'uncaughtException'
  | 'unhandledRejection'
  | 'manual'
  | 'error';

/**
 * Shutdown event emitted during the shutdown process
 */
export interface IShutdownEvent {
  reason: ShutdownReason;
  timestamp: number;
  handlers: IShutdownHandlerResult[];
  totalDurationMs: number;
  success: boolean;
}

/**
 * Configuration options for GracefulShutdown
 */
export interface IGracefulShutdownConfig {
  /** Default timeout per handler in ms (default: 5000) */
  defaultTimeoutMs?: number;
  /** Maximum total shutdown time in ms (default: 30000) */
  maxShutdownTimeMs?: number;
  /** Custom logger instance */
  logger?: StructuredLogger;
  /** Exit process after shutdown (default: true) */
  exitOnComplete?: boolean;
  /** Exit code on success (default: 0) */
  successExitCode?: number;
  /** Exit code on failure (default: 1) */
  failureExitCode?: number;
  /** Register process signal handlers automatically (default: true) */
  registerSignalHandlers?: boolean;
}

// ============================================================================
// Errors
// ============================================================================

/**
 * Error thrown when a shutdown handler times out
 */
export class ShutdownTimeoutError extends Error {
  constructor(
    public readonly handlerName: string,
    public readonly timeoutMs: number
  ) {
    super(`Shutdown handler '${handlerName}' timed out after ${timeoutMs}ms`);
    this.name = 'ShutdownTimeoutError';
  }
}

/**
 * Error thrown when shutdown is already in progress
 */
export class ShutdownInProgressError extends Error {
  constructor() {
    super('Shutdown is already in progress');
    this.name = 'ShutdownInProgressError';
  }
}

// ============================================================================
// GracefulShutdown Class
// ============================================================================

/**
 * GracefulShutdown - Manages ordered shutdown of all registered components
 *
 * Usage:
 * ```typescript
 * const shutdown = new GracefulShutdown();
 *
 * // Register handlers
 * shutdown.register('database', async () => {
 *   await db.checkpoint();
 *   await db.close();
 * }, ShutdownPriority.CRITICAL);
 *
 * shutdown.register('cache', async () => {
 *   await cache.flush();
 * }, ShutdownPriority.HIGH);
 *
 * // Handlers are called automatically on SIGTERM/SIGINT
 * // Or manually:
 * await shutdown.shutdown('manual');
 * ```
 */
export class GracefulShutdown {
  private readonly handlers: Map<string, IShutdownHandler> = new Map();
  private readonly config: Required<IGracefulShutdownConfig>;
  private readonly log: StructuredLogger;
  private isShuttingDown: boolean = false;
  private lastShutdownAttempt: number = 0;
  private shutdownPromise: Promise<IShutdownEvent> | null = null;
  private signalHandlersRegistered: boolean = false;

  constructor(config: IGracefulShutdownConfig = {}) {
    this.config = {
      defaultTimeoutMs: config.defaultTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS,
      maxShutdownTimeMs: config.maxShutdownTimeMs ?? MAX_SHUTDOWN_TIME_MS,
      logger: config.logger ?? createComponentLogger('GracefulShutdown'),
      exitOnComplete: config.exitOnComplete ?? true,
      successExitCode: config.successExitCode ?? 0,
      failureExitCode: config.failureExitCode ?? 1,
      registerSignalHandlers: config.registerSignalHandlers ?? true,
    };
    this.log = this.config.logger;

    if (this.config.registerSignalHandlers) {
      this.registerSignalHandlers();
    }
  }

  /**
   * Register a shutdown handler
   *
   * @param name - Unique identifier for this handler
   * @param handler - Async function to execute during shutdown
   * @param priority - Execution priority (higher runs first)
   * @param options - Additional options
   * @throws Error if handler with same name already exists
   */
  register(
    name: string,
    handler: ShutdownHandlerFn,
    priority: ShutdownPriority = ShutdownPriority.NORMAL,
    options?: { timeoutMs?: number; component?: string }
  ): void {
    if (this.handlers.has(name)) {
      throw new Error(`Shutdown handler '${name}' is already registered`);
    }

    if (this.isShuttingDown) {
      this.log.warn('Cannot register handler during shutdown', { name });
      return;
    }

    this.handlers.set(name, {
      name,
      handler,
      priority,
      timeoutMs: options?.timeoutMs,
      component: options?.component,
    });

    this.log.debug('Registered shutdown handler', {
      name,
      priority,
      component: options?.component,
    });
  }

  /**
   * Unregister a shutdown handler
   *
   * @param name - Name of handler to remove
   * @returns true if handler was removed, false if not found
   */
  unregister(name: string): boolean {
    if (this.isShuttingDown) {
      this.log.warn('Cannot unregister handler during shutdown', { name });
      return false;
    }

    const removed = this.handlers.delete(name);
    if (removed) {
      this.log.debug('Unregistered shutdown handler', { name });
    }
    return removed;
  }

  /**
   * Check if a handler is registered
   */
  hasHandler(name: string): boolean {
    return this.handlers.has(name);
  }

  /**
   * Get count of registered handlers
   */
  get handlerCount(): number {
    return this.handlers.size;
  }

  /**
   * Check if shutdown is in progress
   */
  get shuttingDown(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Get list of registered handler names
   */
  getHandlerNames(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Execute graceful shutdown
   *
   * Runs all registered handlers in priority order, with timeout enforcement.
   * Handlers at same priority level run in parallel.
   *
   * @param reason - Reason for shutdown
   * @returns Shutdown event with results
   */
  async shutdown(reason: ShutdownReason = 'manual'): Promise<IShutdownEvent> {
    const now = Date.now();

    // Debounce rapid shutdown attempts
    if (now - this.lastShutdownAttempt < SHUTDOWN_DEBOUNCE_MS) {
      if (this.shutdownPromise) {
        return this.shutdownPromise;
      }
    }
    this.lastShutdownAttempt = now;

    // If already shutting down, return existing promise
    if (this.isShuttingDown && this.shutdownPromise) {
      this.log.debug('Shutdown already in progress, waiting for completion');
      return this.shutdownPromise;
    }

    this.isShuttingDown = true;
    this.shutdownPromise = this.executeShutdown(reason);

    try {
      return await this.shutdownPromise;
    } finally {
      this.shutdownPromise = null;
    }
  }

  /**
   * Internal shutdown execution
   */
  private async executeShutdown(reason: ShutdownReason): Promise<IShutdownEvent> {
    const startTime = Date.now();
    const results: IShutdownHandlerResult[] = [];

    this.log.info('Graceful shutdown initiated', {
      reason,
      handlerCount: this.handlers.size,
    });

    // Sort handlers by priority (highest first)
    const sortedHandlers = Array.from(this.handlers.values()).sort(
      (a, b) => b.priority - a.priority
    );

    // Group handlers by priority for parallel execution within groups
    const priorityGroups = new Map<ShutdownPriority, IShutdownHandler[]>();
    for (const handler of sortedHandlers) {
      const group = priorityGroups.get(handler.priority) ?? [];
      group.push(handler);
      priorityGroups.set(handler.priority, group);
    }

    // Execute each priority group in order
    const priorities = Array.from(priorityGroups.keys()).sort((a, b) => b - a);

    for (const priority of priorities) {
      const group = priorityGroups.get(priority)!;
      const priorityName = ShutdownPriority[priority] || `P${priority}`;

      this.log.debug(`Executing ${priorityName} priority handlers`, {
        count: group.length,
        handlers: group.map(h => h.name),
      });

      // Execute handlers in this priority group in parallel
      const groupResults = await Promise.all(
        group.map(handler => this.executeHandler(handler))
      );

      results.push(...groupResults);

      // Check if we've exceeded max shutdown time
      if (Date.now() - startTime > this.config.maxShutdownTimeMs) {
        this.log.error('Maximum shutdown time exceeded, aborting remaining handlers', {
          elapsedMs: Date.now() - startTime,
          maxMs: this.config.maxShutdownTimeMs,
        });
        break;
      }
    }

    const totalDurationMs = Date.now() - startTime;
    const success = results.every(r => r.success);

    const event: IShutdownEvent = {
      reason,
      timestamp: startTime,
      handlers: results,
      totalDurationMs,
      success,
    };

    this.log.info('Graceful shutdown complete', {
      reason,
      success,
      totalDurationMs,
      handlerResults: results.map(r => ({
        name: r.name,
        success: r.success,
        durationMs: r.durationMs,
        timedOut: r.timedOut,
      })),
    });

    // Exit process if configured
    if (this.config.exitOnComplete) {
      const exitCode = success ? this.config.successExitCode : this.config.failureExitCode;
      this.log.info('Exiting process', { exitCode });
      process.exit(exitCode);
    }

    return event;
  }

  /**
   * Execute a single handler with timeout
   */
  private async executeHandler(handler: IShutdownHandler): Promise<IShutdownHandlerResult> {
    const startTime = Date.now();
    const timeoutMs = handler.timeoutMs ?? this.config.defaultTimeoutMs;

    this.log.debug(`Executing shutdown handler: ${handler.name}`, {
      timeoutMs,
      component: handler.component,
    });

    try {
      // Race between handler and timeout
      await Promise.race([
        handler.handler(),
        this.createTimeout(handler.name, timeoutMs),
      ]);

      const durationMs = Date.now() - startTime;
      this.log.info(`Handler completed: ${handler.name}`, { durationMs });

      return {
        name: handler.name,
        success: true,
        durationMs,
        timedOut: false,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const timedOut = error instanceof ShutdownTimeoutError;

      this.log.error(`Handler failed: ${handler.name}`, {
        durationMs,
        timedOut,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        name: handler.name,
        success: false,
        durationMs,
        error: error instanceof Error ? error : new Error(String(error)),
        timedOut,
      };
    }
  }

  /**
   * Create a timeout promise that rejects after the specified time
   */
  private createTimeout(handlerName: string, timeoutMs: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new ShutdownTimeoutError(handlerName, timeoutMs));
      }, timeoutMs);
    });
  }

  /**
   * Register process signal handlers
   */
  private registerSignalHandlers(): void {
    if (this.signalHandlersRegistered) {
      return;
    }

    // SIGTERM - Standard termination signal
    process.on('SIGTERM', () => {
      this.log.info('Received SIGTERM signal');
      this.shutdown('SIGTERM').catch(err => {
        this.log.error('Shutdown failed', { error: err });
        process.exit(1);
      });
    });

    // SIGINT - Ctrl+C
    process.on('SIGINT', () => {
      this.log.info('Received SIGINT signal');
      this.shutdown('SIGINT').catch(err => {
        this.log.error('Shutdown failed', { error: err });
        process.exit(1);
      });
    });

    // Uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      this.log.error('Uncaught exception, initiating shutdown', {
        error: error.message,
        stack: error.stack,
      });
      this.shutdown('uncaughtException').catch(err => {
        this.log.error('Shutdown failed after uncaught exception', { error: err });
        process.exit(1);
      });
    });

    // Unhandled promise rejections
    process.on('unhandledRejection', (reason: unknown) => {
      this.log.error('Unhandled promise rejection, initiating shutdown', {
        reason: reason instanceof Error ? reason.message : String(reason),
      });
      this.shutdown('unhandledRejection').catch(err => {
        this.log.error('Shutdown failed after unhandled rejection', { error: err });
        process.exit(1);
      });
    });

    this.signalHandlersRegistered = true;
    this.log.debug('Signal handlers registered', {
      signals: ['SIGTERM', 'SIGINT', 'uncaughtException', 'unhandledRejection'],
    });
  }

  /**
   * Remove all signal handlers (useful for testing)
   */
  removeSignalHandlers(): void {
    // Note: Cannot reliably remove specific handlers, but can mark as unregistered
    this.signalHandlersRegistered = false;
    this.log.debug('Signal handlers marked as unregistered');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalShutdownInstance: GracefulShutdown | null = null;

/**
 * Get or create the global shutdown handler instance
 */
export function getGracefulShutdown(config?: IGracefulShutdownConfig): GracefulShutdown {
  if (!globalShutdownInstance) {
    globalShutdownInstance = new GracefulShutdown(config);
  }
  return globalShutdownInstance;
}

/**
 * Register a handler with the global shutdown instance
 */
export function registerShutdownHandler(
  name: string,
  handler: ShutdownHandlerFn,
  priority: ShutdownPriority = ShutdownPriority.NORMAL,
  options?: { timeoutMs?: number; component?: string }
): void {
  getGracefulShutdown().register(name, handler, priority, options);
}

/**
 * Initiate graceful shutdown using the global instance
 */
export function initiateShutdown(reason: ShutdownReason = 'manual'): Promise<IShutdownEvent> {
  return getGracefulShutdown().shutdown(reason);
}

/**
 * Reset the global shutdown instance (for testing)
 */
export function resetGracefulShutdown(): void {
  if (globalShutdownInstance) {
    globalShutdownInstance.removeSignalHandlers();
    globalShutdownInstance = null;
  }
}

// ============================================================================
// Component Shutdown Handler Factory
// ============================================================================

/**
 * Interface for components that support graceful shutdown
 */
export interface IShutdownable {
  close?(): Promise<void>;
  flush?(): Promise<void>;
  checkpoint?(): Promise<void>;
  stop?(): Promise<void>;
}

/**
 * Create and register shutdown handlers for common component patterns
 *
 * @param name - Handler name
 * @param component - Component implementing shutdown methods
 * @param options - Registration options
 */
export function registerComponentShutdown(
  name: string,
  component: IShutdownable,
  options?: {
    priority?: ShutdownPriority;
    timeoutMs?: number;
    flushFirst?: boolean;
    checkpointFirst?: boolean;
  }
): void {
  const shutdown = getGracefulShutdown();
  const priority = options?.priority ?? ShutdownPriority.NORMAL;

  const handler: ShutdownHandlerFn = async () => {
    // Checkpoint first if requested and available
    if (options?.checkpointFirst && component.checkpoint) {
      await component.checkpoint();
    }

    // Flush first if requested and available
    if (options?.flushFirst && component.flush) {
      await component.flush();
    }

    // Stop if available
    if (component.stop) {
      await component.stop();
    }

    // Close if available
    if (component.close) {
      await component.close();
    }
  };

  shutdown.register(name, handler, priority, {
    timeoutMs: options?.timeoutMs,
    component: name,
  });
}

// ============================================================================
// Predefined Component Handlers
// ============================================================================

/**
 * Register shutdown handler for database connection
 * Checkpoints and closes SQLite database
 */
export function registerDatabaseShutdown(
  name: string,
  connection: { checkpoint(): void; close(): void },
  priority: ShutdownPriority = ShutdownPriority.CRITICAL
): void {
  registerShutdownHandler(
    name,
    async () => {
      connection.checkpoint();
      connection.close();
    },
    priority,
    { component: 'database' }
  );
}

/**
 * Register shutdown handler for SonaEngine
 * Creates checkpoint for weight recovery
 */
export function registerSonaEngineShutdown(
  name: string,
  engine: { createCheckpoint(reason: string): Promise<string> },
  priority: ShutdownPriority = ShutdownPriority.CRITICAL
): void {
  registerShutdownHandler(
    name,
    async () => {
      await engine.createCheckpoint('shutdown');
    },
    priority,
    { component: 'sona-engine' }
  );
}

/**
 * Register shutdown handler for GraphDB
 * Clears graph and releases resources
 */
export function registerGraphDBShutdown(
  name: string,
  db: { clear(): Promise<void> },
  priority: ShutdownPriority = ShutdownPriority.HIGH
): void {
  registerShutdownHandler(
    name,
    async () => {
      await db.clear();
    },
    priority,
    { component: 'graph-db' }
  );
}

/**
 * Register shutdown handler for embedding store
 * Flushes and closes the store
 */
export function registerEmbeddingStoreShutdown(
  name: string,
  store: { flush?(): Promise<void>; close(): Promise<void> },
  priority: ShutdownPriority = ShutdownPriority.HIGH
): void {
  registerShutdownHandler(
    name,
    async () => {
      if (store.flush) {
        await store.flush();
      }
      await store.close();
    },
    priority,
    { component: 'embedding-store' }
  );
}

/**
 * Register shutdown handler for server (HTTP/Socket)
 * Stops accepting connections and closes existing ones
 */
export function registerServerShutdown(
  name: string,
  server: { stop?(): Promise<void>; close?(): Promise<void> },
  priority: ShutdownPriority = ShutdownPriority.NORMAL
): void {
  registerShutdownHandler(
    name,
    async () => {
      if (server.stop) {
        await server.stop();
      } else if (server.close) {
        await server.close();
      }
    },
    priority,
    { component: 'server' }
  );
}
