/**
 * Database Retry Logic with Exponential Backoff
 *
 * Implements: TASK-ERR-004, RULE-072
 * Constitution: "Database operations MUST retry on failure (max 3 attempts)"
 *
 * Provides:
 * - withRetry utility for wrapping database operations
 * - Exponential backoff: 100ms, 200ms, 400ms
 * - Structured logging of retry attempts
 * - Context preservation in error chains
 *
 * @module src/god-agent/core/validation/retry
 */

import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../observability/index.js';

const logger = createComponentLogger('DatabaseRetry', {
  minLevel: LogLevel.WARN,
  handlers: [new ConsoleLogHandler()]
});

/**
 * Configuration options for retry behavior
 * Implements: TASK-ERR-004 AC-005 (exponential backoff)
 */
export interface IRetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Base delay in milliseconds for exponential backoff (default: 100) */
  baseDelay?: number;
  /** Human-readable name for the operation (for logging) */
  operationName: string;
  /** Optional callback invoked before each retry attempt */
  onRetry?: (attempt: number, delay: number, error: Error) => void;
}

/**
 * Error thrown when all retry attempts are exhausted
 * Implements: TASK-ERR-003 (error context with cause)
 */
export class RetryExhaustedError extends Error {
  /** Number of attempts made before giving up */
  public readonly attempts: number;
  /** Name of the operation that failed */
  public readonly operationName: string;
  /** The last error that caused the failure */
  public readonly lastError: Error;

  constructor(
    operationName: string,
    attempts: number,
    lastError: Error
  ) {
    super(`${operationName} failed after ${attempts} attempts: ${lastError.message}`);
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
    this.operationName = operationName;
    this.lastError = lastError;

    // Preserve error chain per TASK-ERR-003
    this.cause = lastError;

    Object.setPrototypeOf(this, RetryExhaustedError.prototype);
  }
}

/**
 * Sleep utility for exponential backoff delays
 *
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wrap an async operation with retry logic and exponential backoff
 *
 * Implements: TASK-ERR-004, RULE-072
 * - Default 3 attempts with exponential backoff: 100ms, 200ms, 400ms
 * - Logs each retry attempt with structured logger
 * - Preserves error chain with cause linking
 *
 * @param operation - Async function to execute
 * @param options - Retry configuration options
 * @returns Result of the operation
 * @throws {RetryExhaustedError} When all retry attempts fail
 *
 * @example
 * ```typescript
 * // Wrap a SQLite insert operation
 * await withRetry(
 *   () => this.insertStmt.run(params),
 *   { operationName: 'SQLite insert episode' }
 * );
 *
 * // Wrap an HNSW index operation
 * await withRetry(
 *   () => this.vectorBackend.insert(id, embedding),
 *   { operationName: 'HNSW index insert', maxAttempts: 3 }
 * );
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T> | T,
  options: IRetryOptions
): Promise<T> {
  const { maxAttempts = 3, baseDelay = 100, operationName, onRetry } = options;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxAttempts) {
        // Exponential backoff: 100ms, 200ms, 400ms, ...
        const delay = baseDelay * Math.pow(2, attempt - 1);

        // Log retry attempt with structured logger per TASK-ERR-002
        logger.warn(`${operationName} failed, retrying`, {
          attempt,
          maxAttempts,
          delay,
          error: lastError.message
        });

        // Optional callback before retry
        if (onRetry) {
          onRetry(attempt, delay, lastError);
        }

        await sleep(delay);
      }
    }
  }

  // All attempts exhausted - throw with context per TASK-ERR-003
  throw new RetryExhaustedError(operationName, maxAttempts, lastError!);
}

/**
 * Wrap a synchronous operation with retry logic
 *
 * Similar to withRetry but for synchronous operations.
 * Note: Uses synchronous sleep which blocks the event loop.
 * Prefer withRetry for async operations.
 *
 * @param operation - Synchronous function to execute
 * @param options - Retry configuration options
 * @returns Result of the operation
 * @throws {RetryExhaustedError} When all retry attempts fail
 */
export function withRetrySync<T>(
  operation: () => T,
  options: IRetryOptions
): T {
  const { maxAttempts = 3, baseDelay = 100, operationName, onRetry } = options;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxAttempts) {
        // Exponential backoff: 100ms, 200ms, 400ms, ...
        const delay = baseDelay * Math.pow(2, attempt - 1);

        // Log retry attempt with structured logger per TASK-ERR-002
        logger.warn(`${operationName} failed, retrying`, {
          attempt,
          maxAttempts,
          delay,
          error: lastError.message
        });

        // Optional callback before retry
        if (onRetry) {
          onRetry(attempt, delay, lastError);
        }

        // Synchronous sleep (blocks event loop)
        const start = Date.now();
        while (Date.now() - start < delay) {
          // Busy wait - use sparingly
        }
      }
    }
  }

  // All attempts exhausted - throw with context per TASK-ERR-003
  throw new RetryExhaustedError(operationName, maxAttempts, lastError!);
}
