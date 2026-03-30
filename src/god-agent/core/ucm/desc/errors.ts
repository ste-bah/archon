/**
 * IDESC-001: Intelligent DESC v2 - Error Classes
 * TASK-IDESC-INFRA-003: Create Error Classes
 * Implements: NFR-IDESC-007 (graceful degradation)
 *
 * Error hierarchy for outcome tracking and intelligent DESC features.
 * Note: These errors extend UCMError directly to allow code property overrides.
 */

import { UCMError } from '../errors.js';

// ============================================================================
// Outcome Recording Errors
// ============================================================================

/**
 * Base error for outcome-related failures
 * All outcome errors are recoverable - they should not block injection
 */
export class OutcomeError extends UCMError {
  readonly code: string = 'UCM_OUTCOME_ERROR';
  readonly recoverable: boolean = true;
}

/**
 * Error recording an outcome
 * Implements: GUARD-IDESC-005 (graceful degradation)
 */
export class OutcomeRecordingError extends OutcomeError {
  override readonly code: string = 'UCM_OUTCOME_RECORDING_ERROR';
  override readonly recoverable: boolean = true;

  constructor(
    message: string,
    public readonly episodeId?: string,
    public readonly taskId?: string,
    cause?: Error
  ) {
    super(message, {
      episodeId,
      taskId,
      cause: cause?.message
    });
  }
}

/**
 * Error when episode does not exist
 */
export class EpisodeNotFoundError extends OutcomeError {
  override readonly code: string = 'UCM_EPISODE_NOT_FOUND';
  override readonly recoverable: boolean = true;

  constructor(episodeId: string) {
    super(`Episode not found: ${episodeId}`, { episodeId });
  }
}

/**
 * Error when outcome data is invalid
 */
export class InvalidOutcomeError extends OutcomeError {
  override readonly code: string = 'UCM_INVALID_OUTCOME';
  override readonly recoverable: boolean = true;

  constructor(reason: string, outcome?: Record<string, unknown>) {
    super(`Invalid outcome: ${reason}`, { reason, outcome });
  }
}

// ============================================================================
// Statistical Validity Errors
// ============================================================================

/**
 * Error when insufficient outcome data for statistical calculations
 * Implements: REQ-IDESC-002 (minimum 3 samples)
 */
export class InsufficientOutcomeDataError extends OutcomeError {
  override readonly code: string = 'UCM_INSUFFICIENT_OUTCOME_DATA';
  override readonly recoverable: boolean = true;

  constructor(
    public readonly episodeId: string,
    public readonly outcomeCount: number,
    public readonly minimumRequired: number = 3
  ) {
    super(
      `Episode ${episodeId} has ${outcomeCount} outcomes, minimum ${minimumRequired} required for statistical validity`,
      { episodeId, outcomeCount, minimumRequired }
    );
  }
}

// ============================================================================
// Confidence Calculation Errors
// ============================================================================

/**
 * Base error for confidence calculation failures
 */
export class ConfidenceError extends UCMError {
  readonly code: string = 'UCM_CONFIDENCE_ERROR';
  readonly recoverable: boolean = true;
}

/**
 * Error calculating confidence level
 */
export class ConfidenceCalculationError extends ConfidenceError {
  override readonly code: string = 'UCM_CONFIDENCE_CALCULATION_ERROR';
  override readonly recoverable: boolean = true;

  constructor(episodeId: string, reason: string, cause?: Error) {
    super(`Failed to calculate confidence for ${episodeId}: ${reason}`, {
      episodeId,
      reason,
      cause: cause?.message
    });
  }
}

// ============================================================================
// Warning Generation Errors
// ============================================================================

/**
 * Base error for warning generation failures
 */
export class WarningError extends UCMError {
  readonly code: string = 'UCM_WARNING_ERROR';
  readonly recoverable: boolean = true;
}

/**
 * Error generating warning message
 */
export class WarningGenerationError extends WarningError {
  override readonly code: string = 'UCM_WARNING_GENERATION_ERROR';
  override readonly recoverable: boolean = true;

  constructor(episodeId: string, reason: string, cause?: Error) {
    super(`Failed to generate warning for ${episodeId}: ${reason}`, {
      episodeId,
      reason,
      cause: cause?.message
    });
  }
}

// ============================================================================
// ReasoningBank Integration Errors
// ============================================================================

/**
 * Base error for ReasoningBank integration failures
 * Implements: GUARD-IDESC-005 (graceful degradation)
 */
export class ReasoningLinkError extends UCMError {
  readonly code: string = 'UCM_REASONING_LINK_ERROR';
  readonly recoverable: boolean = true;
}

/**
 * Error linking to ReasoningBank trajectory
 */
export class TrajectoryLinkError extends ReasoningLinkError {
  override readonly code: string = 'UCM_TRAJECTORY_LINK_ERROR';
  override readonly recoverable: boolean = true;

  constructor(
    public readonly trajectoryId: string,
    reason: string,
    cause?: Error
  ) {
    super(`Failed to link trajectory ${trajectoryId}: ${reason}`, {
      trajectoryId,
      reason,
      cause: cause?.message
    });
  }
}

/**
 * Error when trajectory not found
 */
export class TrajectoryNotFoundError extends ReasoningLinkError {
  override readonly code: string = 'UCM_TRAJECTORY_NOT_FOUND';
  override readonly recoverable: boolean = true;

  constructor(trajectoryId: string) {
    super(`Trajectory not found: ${trajectoryId}`, { trajectoryId });
  }
}

// ============================================================================
// Threshold Adjustment Errors
// ============================================================================

/**
 * Base error for threshold adjustment failures
 */
export class ThresholdError extends UCMError {
  readonly code: string = 'UCM_THRESHOLD_ERROR';
  readonly recoverable: boolean = true;
}

/**
 * Error when threshold change exceeds bounds
 * Implements: GUARD-IDESC-003 (+/-5% per 30 days)
 */
export class ThresholdBoundsError extends ThresholdError {
  override readonly code: string = 'UCM_THRESHOLD_BOUNDS_ERROR';
  override readonly recoverable: boolean = false; // Intentionally not recoverable - this is a guard violation

  constructor(
    public readonly category: string,
    public readonly currentValue: number,
    public readonly proposedValue: number,
    public readonly maxChange: number,
    public readonly periodDays: number
  ) {
    super(
      `GUARD-IDESC-003 violation: Cannot change ${category} threshold from ${currentValue} to ${proposedValue}. Maximum change is ±${maxChange * 100}% per ${periodDays} days`,
      {
        category,
        currentValue,
        proposedValue,
        maxChange,
        periodDays,
        requestedChange: Math.abs(proposedValue - currentValue),
        percentChange: Math.abs((proposedValue - currentValue) / currentValue) * 100
      }
    );
  }
}

/**
 * Error when threshold value is invalid
 */
export class InvalidThresholdError extends ThresholdError {
  override readonly code: string = 'UCM_INVALID_THRESHOLD';
  override readonly recoverable: boolean = false;

  constructor(category: string, value: number, reason: string) {
    super(`Invalid threshold for ${category}: ${value} - ${reason}`, {
      category,
      value,
      reason
    });
  }
}

// ============================================================================
// Active Learning Errors
// ============================================================================

/**
 * Base error for active learning failures
 */
export class ActiveLearningError extends UCMError {
  readonly code: string = 'UCM_ACTIVE_LEARNING_ERROR';
  readonly recoverable: boolean = true;
}

/**
 * Error when learning data is insufficient
 */
export class InsufficientLearningDataError extends ActiveLearningError {
  override readonly code: string = 'UCM_INSUFFICIENT_LEARNING_DATA';
  override readonly recoverable: boolean = true;

  constructor(
    public readonly dataPoints: number,
    public readonly minimumRequired: number
  ) {
    super(
      `Insufficient data for learning: ${dataPoints} data points, minimum ${minimumRequired} required`,
      { dataPoints, minimumRequired }
    );
  }
}

/**
 * Error when learning rate adjustment fails
 */
export class LearningRateError extends ActiveLearningError {
  override readonly code: string = 'UCM_LEARNING_RATE_ERROR';
  override readonly recoverable: boolean = true;

  constructor(reason: string, cause?: Error) {
    super(`Learning rate adjustment failed: ${reason}`, {
      reason,
      cause: cause?.message
    });
  }
}

// ============================================================================
// Type Guards
// ============================================================================

export function isOutcomeError(error: unknown): error is OutcomeError {
  return error instanceof OutcomeError;
}

export function isConfidenceError(error: unknown): error is ConfidenceError {
  return error instanceof ConfidenceError;
}

export function isWarningError(error: unknown): error is WarningError {
  return error instanceof WarningError;
}

export function isReasoningLinkError(error: unknown): error is ReasoningLinkError {
  return error instanceof ReasoningLinkError;
}

export function isThresholdError(error: unknown): error is ThresholdError {
  return error instanceof ThresholdError;
}

export function isActiveLearningError(error: unknown): error is ActiveLearningError {
  return error instanceof ActiveLearningError;
}
