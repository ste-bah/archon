/**
 * Hook Handlers Module
 * TASK-HOOK-003, TASK-HOOK-004
 *
 * Exports and registers all required hook handlers.
 *
 * CONSTITUTION COMPLIANCE:
 * - REQ-CONST-003: Auto-injection into ALL Task() spawns
 * - RULE-032: All hooks registered at daemon startup
 * - RULE-033: Quality assessed on Task() result, NOT prompt
 * - RULE-035: Uses thresholds 0.5 (feedback), 0.7 (pattern)
 * - RULE-036: Capture actual execution output
 */

// ============================================================================
// Task Result Capture Hook Exports
// ============================================================================

export {
  // Registration function
  registerTaskResultCaptureHook,

  // Result access functions
  getCapturedResult,
  hasCapturedResult,
  getCapturedResultCount,
  getCapturedTrajectoryIds,
  clearCapturedResult,

  // Testing utilities
  _clearCapturedResultsForTesting,

  // Types
  type ICapturedResult
} from './task-result-capture.js';

// ============================================================================
// Quality Assessment Trigger Hook Exports
// ============================================================================

export {
  // Registration function
  registerQualityAssessmentTriggerHook,

  // Callback management
  setQualityAssessmentCallback,
  hasQualityAssessmentCallback,

  // Learning feedback callback (TASK-HOOK-009)
  setLearningFeedbackCallback,
  hasLearningFeedbackCallback,

  // Constants
  QUALITY_THRESHOLDS,

  // Testing utilities
  _clearQualityAssessmentCallbackForTesting,
  _clearLearningFeedbackCallbackForTesting,

  // Types
  type QualityAssessmentCallback,
  type IQualityAssessment,
  type LearningFeedbackCallback
} from './quality-assessment-trigger.js';

// ============================================================================
// Auto-Injection Hook Exports
// ============================================================================

export {
  // Registration function
  registerAutoInjectionHook,

  // Service getter setters (for late binding during daemon init)
  setDescServiceGetter,
  setSonaEngineGetter,

  // Testing utilities
  _resetAutoInjectionForTesting,

  // Types
  type IDescServiceLike,
  type ISonaEngineLike
} from './auto-injection.js';

// ============================================================================
// Combined Registration
// ============================================================================

import { registerTaskResultCaptureHook } from './task-result-capture.js';
import { registerQualityAssessmentTriggerHook } from './quality-assessment-trigger.js';
import { registerAutoInjectionHook } from './auto-injection.js';

/**
 * Register all required hooks
 *
 * Call this during daemon startup BEFORE HookRegistry.initialize().
 * This ensures all REQUIRED_HOOKS are registered per RULE-032.
 *
 * Registration order (by priority):
 * 1. auto-injection (priority 20 - INJECTION)
 * 2. task-result-capture (priority 40 - CAPTURE)
 * 3. quality-assessment-trigger (priority 60 - POST_PROCESS)
 *
 * @example
 * ```typescript
 * import { registerRequiredHooks, getHookRegistry } from './core/hooks';
 *
 * // During daemon startup
 * registerRequiredHooks();
 * getHookRegistry().initialize();  // Validates required hooks
 * ```
 */
export function registerRequiredHooks(): void {
  // preToolUse hooks (in priority order)
  registerAutoInjectionHook();  // priority 20 - INJECTION

  // postToolUse hooks (in priority order)
  registerTaskResultCaptureHook();          // priority 40 - CAPTURE
  registerQualityAssessmentTriggerHook();   // priority 60 - POST_PROCESS
}
