/**
 * Memory Server Error Classes
 * MEM-001 - Typed error classes for multi-process memory system
 *
 * All errors include:
 * - Error code for IPC protocol
 * - Context for debugging
 * - Actionable error messages
 */

import type { MemoryErrorCode, IMemoryErrorInfo } from '../types/memory-types.js';

// ==================== Base Error ====================

/**
 * Base class for all memory server errors
 */
export abstract class MemoryError extends Error {
  /** Error code for IPC protocol */
  abstract readonly code: MemoryErrorCode;

  /** Additional error context */
  readonly context: Record<string, unknown>;

  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;
    Error.captureStackTrace?.(this, this.constructor);
  }

  /**
   * Convert to IPC error info structure
   */
  toErrorInfo(): IMemoryErrorInfo {
    return {
      code: this.code,
      message: this.message,
      context: this.context,
    };
  }

  /**
   * Create structured log entry
   */
  toLogEntry(): Record<string, unknown> {
    return {
      error: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      stack: this.stack,
    };
  }
}

// ==================== Request Errors ====================

/**
 * Thrown when request message is malformed
 */
export class InvalidRequestError extends MemoryError {
  readonly code = 'INVALID_REQUEST' as const;

  constructor(message: string, context: Record<string, unknown> = {}) {
    super(`Invalid request: ${message}`, context);
  }
}

/**
 * Thrown when method name is not recognized
 */
export class UnknownMethodError extends MemoryError {
  readonly code = 'UNKNOWN_METHOD' as const;

  constructor(method: string) {
    super(`Unknown method: ${method}`, { method });
  }
}

/**
 * Thrown when request parameters fail validation
 */
export class ValidationError extends MemoryError {
  readonly code = 'VALIDATION_ERROR' as const;

  constructor(message: string, context: Record<string, unknown> = {}) {
    super(`Validation failed: ${message}`, context);
  }
}

// ==================== Server Errors ====================

/**
 * Thrown when storage operation fails
 */
export class StorageError extends MemoryError {
  readonly code = 'STORAGE_ERROR' as const;

  constructor(operation: string, reason: string, context: Record<string, unknown> = {}) {
    super(`Storage error during ${operation}: ${reason}`, { operation, ...context });
  }
}

/**
 * Thrown when server is shutting down and rejecting requests
 */
export class ServerShuttingDownError extends MemoryError {
  readonly code = 'SERVER_SHUTTING_DOWN' as const;

  constructor() {
    super('Server is shutting down, request rejected');
  }
}

/**
 * Thrown when operation times out
 */
export class TimeoutError extends MemoryError {
  readonly code = 'TIMEOUT' as const;

  constructor(operation: string, timeoutMs: number) {
    super(`Operation timed out after ${timeoutMs}ms: ${operation}`, { operation, timeoutMs });
  }
}

/**
 * Thrown when server has reached maximum connections
 */
export class MaxConnectionsError extends MemoryError {
  readonly code = 'MAX_CONNECTIONS' as const;

  constructor(currentConnections: number, maxConnections: number) {
    super(
      `Maximum connections reached (${currentConnections}/${maxConnections}). Try again later.`,
      { currentConnections, maxConnections }
    );
  }
}

// ==================== Client Errors ====================

/**
 * Thrown when server is not running
 */
export class ServerNotRunningError extends MemoryError {
  readonly code = 'SERVER_NOT_RUNNING' as const;

  constructor(address?: string) {
    super(
      address
        ? `Memory server not running at ${address}`
        : 'Memory server not running. Start with MemoryServer.start()',
      { address }
    );
  }
}

/**
 * Thrown when connection to server is lost
 */
export class ServerDisconnectedError extends MemoryError {
  readonly code = 'SERVER_DISCONNECTED' as const;

  constructor(reason?: string) {
    super(
      reason
        ? `Disconnected from memory server: ${reason}`
        : 'Disconnected from memory server',
      { reason }
    );
  }
}

// ==================== Factory Functions ====================

/**
 * Create error from IPC error info
 */
export function errorFromInfo(info: IMemoryErrorInfo): MemoryError {
  const context = info.context ?? {};

  switch (info.code) {
    case 'INVALID_REQUEST':
      return new InvalidRequestError(info.message, context);
    case 'UNKNOWN_METHOD':
      return new UnknownMethodError((context.method as string) ?? 'unknown');
    case 'VALIDATION_ERROR':
      return new ValidationError(info.message, context);
    case 'STORAGE_ERROR':
      return new StorageError(
        (context.operation as string) ?? 'unknown',
        info.message,
        context
      );
    case 'SERVER_SHUTTING_DOWN':
      return new ServerShuttingDownError();
    case 'TIMEOUT':
      return new TimeoutError(
        (context.operation as string) ?? 'unknown',
        (context.timeoutMs as number) ?? 0
      );
    case 'MAX_CONNECTIONS':
      return new MaxConnectionsError(
        (context.currentConnections as number) ?? 0,
        (context.maxConnections as number) ?? 0
      );
    case 'SERVER_NOT_RUNNING':
      return new ServerNotRunningError(context.address as string);
    case 'SERVER_DISCONNECTED':
      return new ServerDisconnectedError(context.reason as string);
    default:
      // Should never happen, but TypeScript needs exhaustive check
      return new InvalidRequestError(`Unknown error code: ${info.code}`, context);
  }
}

/**
 * Check if an error is a MemoryError
 */
export function isMemoryError(error: unknown): error is MemoryError {
  return error instanceof MemoryError;
}

/**
 * Wrap unknown error as MemoryError
 */
export function wrapError(error: unknown, operation: string): MemoryError {
  if (isMemoryError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new StorageError(operation, error.message, {
      originalError: error.name,
      originalStack: error.stack,
    });
  }

  return new StorageError(operation, String(error));
}
