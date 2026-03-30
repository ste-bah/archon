/**
 * Memory Engine Error Classes
 */

// Re-export OrphanNodeError from graph-db
export { OrphanNodeError } from '../graph-db/index.js';

/**
 * Error thrown when storage transaction fails
 */
export class StorageTransactionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'StorageTransactionError';

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, StorageTransactionError);
    }
  }
}

/**
 * Error thrown when namespace validation fails
 */
export class NamespaceValidationError extends Error {
  constructor(
    message: string,
    public readonly namespace: string
  ) {
    super(message);
    this.name = 'NamespaceValidationError';

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, NamespaceValidationError);
    }
  }
}
