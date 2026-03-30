/**
 * Hooks Module Index
 * TASK-HOOK-001 - Hook Registration Service
 *
 * Exports hook registry, types, and helper functions.
 *
 * Usage:
 * ```typescript
 * import {
 *   getHookRegistry,
 *   registerPreToolUseHook,
 *   registerPostToolUseHook,
 *   IHook,
 *   HookError
 * } from './core/hooks';
 * ```
 */

// ============================================================================
// Type Exports
// ============================================================================

export {
  // Hook types
  type HookType,
  type HookPriority,

  // Context types
  type IHookContext,
  type IPostToolUseContext,

  // Result types
  type IHookResult,
  type IHookExecutionResult,
  type IHookChainResult,

  // Handler types
  type HookHandler,
  type PreToolUseHandler,
  type PostToolUseHandler,

  // Definition types
  type IHook,
  type IPreToolUseHook,
  type IPostToolUseHook,

  // Registration types
  type IHookRegistrationOptions,
  type IHookInput,

  // Interface types
  type IHookRegistry,
  type IHookExecutor,
  type AnyHook,

  // Constants
  REQUIRED_HOOKS,
  DEFAULT_PRIORITIES,

  // Error types
  HookErrorCode,
  HookError
} from './types.js';

// ============================================================================
// Registry Exports
// ============================================================================

export {
  // Registry class
  HookRegistry,

  // Singleton accessor
  getHookRegistry,

  // Helper registration functions
  registerPreToolUseHook,
  registerPostToolUseHook,

  // Testing utilities (should only be used in tests)
  _resetHookRegistryForTesting
} from './hook-registry.js';

// ============================================================================
// Executor Exports
// ============================================================================

export {
  // Executor class
  HookExecutor,

  // Singleton accessor
  getHookExecutor,

  // Testing utilities (should only be used in tests)
  _resetHookExecutorForTesting
} from './hook-executor.js';

// ============================================================================
// Handler Exports
// ============================================================================

export {
  // Combined registration function
  registerRequiredHooks,

  // Task result capture hook
  registerTaskResultCaptureHook,
  getCapturedResult,
  hasCapturedResult,
  getCapturedResultCount,
  getCapturedTrajectoryIds,
  clearCapturedResult,
  _clearCapturedResultsForTesting,
  type ICapturedResult,

  // Quality assessment trigger hook
  registerQualityAssessmentTriggerHook,
  setQualityAssessmentCallback,
  hasQualityAssessmentCallback,
  QUALITY_THRESHOLDS,
  _clearQualityAssessmentCallbackForTesting,
  type QualityAssessmentCallback,
  type IQualityAssessment,

  // Learning feedback callback (TASK-HOOK-009)
  setLearningFeedbackCallback,
  hasLearningFeedbackCallback,
  _clearLearningFeedbackCallbackForTesting,
  type LearningFeedbackCallback,

  // Auto-injection hook (TASK-HOOK-004)
  registerAutoInjectionHook,
  setDescServiceGetter,
  setSonaEngineGetter,
  _resetAutoInjectionForTesting,
  type IDescServiceLike,
  type ISonaEngineLike
} from './handlers/index.js';
