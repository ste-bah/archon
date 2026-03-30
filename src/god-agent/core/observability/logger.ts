/**
 * Structured Logger
 * TASK-OBS-001 - Observability Stack
 *
 * Provides JSON-formatted structured logging with:
 * - Log levels (DEBUG, INFO, WARN, ERROR, FATAL)
 * - Correlation IDs for request tracking
 * - Contextual metadata (component, operation, user)
 * - Child loggers with inherited context
 */

// ==================== Types ====================

/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
}

/**
 * Log level names for display
 */
export const LogLevelNames: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.FATAL]: 'FATAL',
};

/**
 * Parse log level from string
 */
export function parseLogLevel(level: string): LogLevel {
  const normalized = level.toUpperCase();
  switch (normalized) {
    case 'DEBUG':
      return LogLevel.DEBUG;
    case 'INFO':
      return LogLevel.INFO;
    case 'WARN':
    case 'WARNING':
      return LogLevel.WARN;
    case 'ERROR':
      return LogLevel.ERROR;
    case 'FATAL':
    case 'CRITICAL':
      return LogLevel.FATAL;
    default:
      return LogLevel.INFO;
  }
}

/**
 * Log context with optional fields
 */
export interface LogContext {
  component?: string;
  operation?: string;
  trace_id?: string;
  span_id?: string;
  user_id?: string;
  request_id?: string;
  duration_ms?: number;
  [key: string]: unknown;
}

/**
 * Log entry structure
 */
export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context: LogContext;
}

/**
 * Log output handler interface
 */
export interface LogHandler {
  write(entry: LogEntry): void;
}

// ==================== Default Handlers ====================

/**
 * Console log handler (writes to stdout/stderr)
 */
export class ConsoleLogHandler implements LogHandler {
  private useStderr: boolean;

  constructor(options: { useStderr?: boolean } = {}) {
    this.useStderr = options.useStderr ?? false;
  }

  write(entry: LogEntry): void {
    const output = JSON.stringify(entry);

    if (this.useStderr && (entry.level === 'ERROR' || entry.level === 'FATAL')) {
      console.error(output);
    } else {
      console.log(output);
    }
  }
}

/**
 * In-memory log handler (for testing)
 */
export class MemoryLogHandler implements LogHandler {
  public entries: LogEntry[] = [];
  private maxEntries: number;

  constructor(options: { maxEntries?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 10000;
  }

  write(entry: LogEntry): void {
    this.entries.push(entry);

    // Trim if over max
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  clear(): void {
    this.entries = [];
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  getEntriesByLevel(level: string): LogEntry[] {
    return this.entries.filter(e => e.level === level);
  }

  getEntriesByComponent(component: string): LogEntry[] {
    return this.entries.filter(e => e.context.component === component);
  }

  getEntriesByTraceId(traceId: string): LogEntry[] {
    return this.entries.filter(e => e.context.trace_id === traceId);
  }
}

/**
 * Silent log handler (discards all logs)
 */
export class SilentLogHandler implements LogHandler {
  write(_entry: LogEntry): void {
    // Intentionally empty - discards all logs
  }
}

// ==================== Structured Logger ====================

/**
 * Structured logger with JSON output
 */
export class StructuredLogger {
  private minLevel: LogLevel;
  private context: LogContext;
  private handlers: LogHandler[];

  constructor(
    options: {
      minLevel?: LogLevel;
      context?: LogContext;
      handlers?: LogHandler[];
    } = {}
  ) {
    this.minLevel = options.minLevel ?? LogLevel.INFO;
    this.context = options.context ?? {};
    this.handlers = options.handlers ?? [new ConsoleLogHandler()];
  }

  /**
   * Internal log method
   */
  private log(level: LogLevel, message: string, additionalContext?: LogContext): void {
    if (level < this.minLevel) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevelNames[level],
      message,
      context: { ...this.context, ...additionalContext },
    };

    // Write to all handlers
    for (const handler of this.handlers) {
      try {
        handler.write(entry);
      } catch (error) {
        // Don't let logging errors crash the application
        console.error('Logging error:', error);
      }
    }
  }

  /**
   * Log at DEBUG level
   */
  debug(message: string, context?: LogContext): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * Log at INFO level
   */
  info(message: string, context?: LogContext): void {
    this.log(LogLevel.INFO, message, context);
  }

  /**
   * Log at WARN level
   */
  warn(message: string, context?: LogContext): void {
    this.log(LogLevel.WARN, message, context);
  }

  /**
   * Log at ERROR level
   */
  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const errorContext: LogContext = { ...context };

    if (error instanceof Error) {
      errorContext.error_message = error.message;
      errorContext.error_name = error.name;
      errorContext.error_stack = error.stack;
    } else if (error !== undefined) {
      errorContext.error_message = String(error);
    }

    this.log(LogLevel.ERROR, message, errorContext);
  }

  /**
   * Log at FATAL level
   */
  fatal(message: string, error?: Error | unknown, context?: LogContext): void {
    const errorContext: LogContext = { ...context };

    if (error instanceof Error) {
      errorContext.error_message = error.message;
      errorContext.error_name = error.name;
      errorContext.error_stack = error.stack;
    } else if (error !== undefined) {
      errorContext.error_message = String(error);
    }

    this.log(LogLevel.FATAL, message, errorContext);
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext: LogContext): StructuredLogger {
    return new StructuredLogger({
      minLevel: this.minLevel,
      context: { ...this.context, ...additionalContext },
      handlers: this.handlers,
    });
  }

  /**
   * Set minimum log level
   */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Get current log level
   */
  getLevel(): LogLevel {
    return this.minLevel;
  }

  /**
   * Add a log handler
   */
  addHandler(handler: LogHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Remove all handlers
   */
  clearHandlers(): void {
    this.handlers = [];
  }

  /**
   * Set handlers (replaces existing)
   */
  setHandlers(handlers: LogHandler[]): void {
    this.handlers = handlers;
  }

  /**
   * Get current context
   */
  getContext(): LogContext {
    return { ...this.context };
  }

  /**
   * Update context (merges with existing)
   */
  updateContext(additionalContext: LogContext): void {
    this.context = { ...this.context, ...additionalContext };
  }

  /**
   * Measure and log execution time
   */
  async time<T>(
    operation: string,
    fn: () => Promise<T>,
    context?: LogContext
  ): Promise<T> {
    const startTime = performance.now();

    try {
      const result = await fn();
      const duration = performance.now() - startTime;

      this.info(`${operation} completed`, {
        ...context,
        operation,
        duration_ms: duration,
        status: 'success',
      });

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;

      this.error(`${operation} failed`, error, {
        ...context,
        operation,
        duration_ms: duration,
        status: 'error',
      });

      // INTENTIONAL: transparent rethrow - timing wrapper should not modify errors
      throw error;
    }
  }

  /**
   * Synchronous time measurement
   */
  timeSync<T>(operation: string, fn: () => T, context?: LogContext): T {
    const startTime = performance.now();

    try {
      const result = fn();
      const duration = performance.now() - startTime;

      this.info(`${operation} completed`, {
        ...context,
        operation,
        duration_ms: duration,
        status: 'success',
      });

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;

      this.error(`${operation} failed`, error, {
        ...context,
        operation,
        duration_ms: duration,
        status: 'error',
      });

      // INTENTIONAL: transparent rethrow - timing wrapper should not modify errors
      throw error;
    }
  }
}

// ==================== Global Instance ====================

/**
 * Global logger instance
 */
export const logger = new StructuredLogger({
  minLevel: LogLevel.INFO,
  handlers: [new SilentLogHandler()], // Silent by default in library code
});

// ==================== Utility Functions ====================

/**
 * Create a component-scoped logger
 */
export function createComponentLogger(
  component: string,
  options?: { minLevel?: LogLevel; handlers?: LogHandler[] }
): StructuredLogger {
  return new StructuredLogger({
    minLevel: options?.minLevel ?? LogLevel.INFO,
    context: { component },
    handlers: options?.handlers ?? [new SilentLogHandler()],
  });
}

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Generate a unique correlation ID
 */
export function generateCorrelationId(): string {
  return `corr-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}
