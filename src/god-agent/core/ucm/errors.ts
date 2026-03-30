/**
 * UCM Error Hierarchy
 * Universal Context Management System Error Classes
 *
 * CONSTITUTION: All errors must be catchable and recoverable
 */

/**
 * Base UCM error class
 */
export abstract class UCMError extends Error {
  abstract readonly code: string;
  abstract readonly recoverable: boolean;
  readonly timestamp: Date;
  readonly context?: Record<string, unknown>;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date();
    this.context = context;
    Error.captureStackTrace?.(this, this.constructor);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
      timestamp: this.timestamp.toISOString(),
      context: this.context
    };
  }
}

// ============================================================================
// Daemon Errors
// ============================================================================

export class DaemonError extends UCMError {
  readonly code: string = 'UCM_DAEMON_ERROR';
  readonly recoverable = true;
}

export class ServiceError extends DaemonError {
  readonly code = 'UCM_SERVICE_ERROR';
  readonly recoverable = true;
  readonly details?: unknown;

  constructor(
    public readonly errorCode: number,
    message: string,
    details?: unknown
  ) {
    super(message, { errorCode, details });
    this.details = details;
  }
}

export class DaemonUnavailableError extends DaemonError {
  readonly code = 'UCM_DAEMON_UNAVAILABLE';
  readonly recoverable = true;

  constructor(socketPath: string, cause?: Error) {
    super(`UCM Daemon unavailable at ${socketPath}`, {
      socketPath,
      cause: cause?.message
    });
  }
}

export class DaemonStartupError extends DaemonError {
  readonly code = 'UCM_DAEMON_STARTUP_FAILED';
  readonly recoverable = true;

  constructor(timeoutMs: number, cause?: Error) {
    super(`UCM Daemon failed to start within ${timeoutMs}ms`, {
      timeoutMs,
      cause: cause?.message
    });
  }
}

export class DaemonIPCError extends DaemonError {
  readonly code = 'UCM_DAEMON_IPC_ERROR';
  readonly recoverable = true;

  constructor(method: string, cause?: Error) {
    super(`IPC call failed: ${method}`, {
      method,
      cause: cause?.message
    });
  }
}

// ============================================================================
// Embedding Errors
// ============================================================================

export class EmbeddingError extends UCMError {
  readonly code: string = 'UCM_EMBEDDING_ERROR';
  readonly recoverable = true;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
  }
}

export class EmbeddingServiceUnavailableError extends EmbeddingError {
  readonly code = 'UCM_EMBEDDING_SERVICE_UNAVAILABLE';
  readonly recoverable = true;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
  }
}

export class EmbeddingTimeoutError extends EmbeddingError {
  readonly code = 'UCM_EMBEDDING_TIMEOUT';
  readonly recoverable = true;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
  }
}

export class EmbeddingBatchError extends EmbeddingError {
  readonly code = 'UCM_EMBEDDING_BATCH_ERROR';
  readonly recoverable = true;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
  }
}

// ============================================================================
// DESC Errors
// ============================================================================

export class DESCError extends UCMError {
  readonly code: string = 'UCM_DESC_ERROR';
  readonly recoverable = true;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
  }
}

export class DESCRetrievalError extends DESCError {
  readonly code = 'UCM_DESC_RETRIEVAL_ERROR';
  readonly recoverable = true;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
  }
}

export class DESCStorageError extends DESCError {
  readonly code = 'UCM_DESC_STORAGE_ERROR';
  readonly recoverable = true;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
  }
}

export class DESCChunkingError extends DESCError {
  readonly code = 'UCM_DESC_CHUNKING_ERROR';
  readonly recoverable = true;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
  }
}

// ============================================================================
// Recovery Errors
// ============================================================================

export class RecoveryError extends UCMError {
  readonly code: string = 'UCM_RECOVERY_ERROR';
  readonly recoverable = true;
}

export class CompactionDetectionError extends RecoveryError {
  readonly code = 'UCM_COMPACTION_DETECTION_ERROR';
  readonly recoverable = true;

  constructor(cause?: Error) {
    super('Failed to detect compaction event', {
      cause: cause?.message
    });
  }
}

export class ContextReconstructionError extends RecoveryError {
  readonly code = 'UCM_CONTEXT_RECONSTRUCTION_ERROR';
  readonly recoverable = true;

  constructor(
    agentsRecovered: number,
    totalAgents: number,
    failedKeys: string[],
    cause?: Error
  ) {
    super(
      `Context reconstruction incomplete: ${agentsRecovered}/${totalAgents} agents recovered`,
      {
        agentsRecovered,
        totalAgents,
        failedKeys,
        cause: cause?.message
      }
    );
  }
}

export class MemoryRetrievalError extends RecoveryError {
  readonly code = 'UCM_MEMORY_RETRIEVAL_ERROR';
  readonly recoverable = true;

  constructor(key: string, cause?: Error) {
    super(`Failed to retrieve memory: ${key}`, {
      key,
      cause: cause?.message
    });
  }
}

// ============================================================================
// Token Estimation Errors
// ============================================================================

export class TokenEstimationError extends UCMError {
  readonly code: string = 'UCM_TOKEN_ESTIMATION_ERROR';
  readonly recoverable = true;
}

export class ContentClassificationError extends TokenEstimationError {
  readonly code = 'UCM_CONTENT_CLASSIFICATION_ERROR';
  readonly recoverable = true;

  constructor(textLength: number, cause?: Error) {
    super(`Failed to classify content of length ${textLength}`, {
      textLength,
      cause: cause?.message
    });
  }
}

// ============================================================================
// Configuration Errors
// ============================================================================

export class ConfigurationError extends UCMError {
  readonly code: string = 'UCM_CONFIGURATION_ERROR';
  readonly recoverable = false;
}

export class InvalidConfigError extends ConfigurationError {
  readonly code = 'UCM_INVALID_CONFIG';
  readonly recoverable = false;

  constructor(field: string, value: unknown, expected: string) {
    super(`Invalid configuration: ${field}`, {
      field,
      value,
      expected
    });
  }
}

export class MissingConfigError extends ConfigurationError {
  readonly code = 'UCM_MISSING_CONFIG';
  readonly recoverable = false;

  constructor(field: string, details?: string) {
    super(
      details
        ? `Missing required configuration: ${field}. ${details}`
        : `Missing required configuration: ${field}`,
      { field }
    );
  }
}

// ============================================================================
// Workflow Adapter Errors
// ============================================================================

export class WorkflowAdapterError extends UCMError {
  readonly code: string = 'UCM_WORKFLOW_ADAPTER_ERROR';
  readonly recoverable = true;
}

export class AdapterNotFoundError extends WorkflowAdapterError {
  readonly code = 'UCM_ADAPTER_NOT_FOUND';
  readonly recoverable = true;

  constructor(adapterName: string) {
    super(`Workflow adapter not found: ${adapterName}`, {
      adapterName
    });
  }
}

export class AdapterDetectionError extends WorkflowAdapterError {
  readonly code = 'UCM_ADAPTER_DETECTION_ERROR';
  readonly recoverable = true;

  constructor(context: Record<string, unknown>, cause?: Error) {
    super('Failed to detect appropriate workflow adapter', {
      context,
      cause: cause?.message
    });
  }
}

// ============================================================================
// Budget Errors
// ============================================================================

export class BudgetError extends UCMError {
  readonly code: string = 'UCM_BUDGET_ERROR';
  readonly recoverable = true;
}

export class BudgetExceededError extends BudgetError {
  readonly code = 'UCM_BUDGET_EXCEEDED';
  readonly recoverable = true;

  constructor(current: number, limit: number, category: string) {
    super(`Token budget exceeded for ${category}: ${current}/${limit}`, {
      current,
      limit,
      category
    });
  }
}

export class BudgetAllocationError extends BudgetError {
  readonly code = 'UCM_BUDGET_ALLOCATION_ERROR';
  readonly recoverable = true;

  constructor(requested: number, available: number, cause?: Error) {
    super(`Cannot allocate ${requested} tokens, only ${available} available`, {
      requested,
      available,
      cause: cause?.message
    });
  }
}

// ============================================================================
// Error Type Guards
// ============================================================================

export function isUCMError(error: unknown): error is UCMError {
  return error instanceof UCMError;
}

export function isDaemonError(error: unknown): error is DaemonError {
  return error instanceof DaemonError;
}

export function isEmbeddingError(error: unknown): error is EmbeddingError {
  return error instanceof EmbeddingError;
}

export function isDESCError(error: unknown): error is DESCError {
  return error instanceof DESCError;
}

export function isRecoveryError(error: unknown): error is RecoveryError {
  return error instanceof RecoveryError;
}

export function isRecoverableError(error: unknown): boolean {
  if (isUCMError(error)) {
    return error.recoverable;
  }
  return false;
}
