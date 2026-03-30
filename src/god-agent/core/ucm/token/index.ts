/**
 * Token Management Module
 * Exports all token-related services for UCM
 *
 * CONSTITUTION RULES: RULE-001 to RULE-006, RULE-007, RULE-008,
 * RULE-017, RULE-018, RULE-020, RULE-041, RULE-042, RULE-043, RULE-044, RULE-051
 */

// Token Estimation Services
export { WordCounter } from './word-counter.js';
export { ContentClassifier } from './content-classifier.js';
export { TokenEstimationService } from './token-estimation-service.js';

// Budget Management Services (SPRINT 2)
export { TokenBudgetManager } from './token-budget-manager.js';
export { UsageTracker } from './usage-tracker.js';
export { SummarizationTrigger } from './summarization-trigger.js';

// Re-export types for convenience
export type {
  IWordCounter,
  IContentClassifier,
  ITokenEstimator,
  ITokenEstimate,
  ITokenBreakdown,
  IEstimationHints
} from '../types.js';

export { ContentType, TOKEN_RATIOS } from '../types.js';

// Budget Management Types
export type {
  IBudgetAllocation,
  ITierBudget,
  IBudgetStatus
} from './token-budget-manager.js';

export type {
  IUsageRecord,
  IAgentUsage,
  IPhaseUsage,
  IUsageSnapshot,
  IWarningEvent
} from './usage-tracker.js';

export type {
  ITriggerReason,
  ISummarizationDecision,
  ISummarizationContext
} from './summarization-trigger.js';
