/**
 * Orchestration Memory System
 *
 * Automated memory coordination for Claude Code orchestrator.
 * Implements automatic context injection, storage, and feedback submission.
 *
 * @module orchestration
 */

// Types
export type {
  IWorkflowState,
  ITaskMemoryEntry,
  IContextInjection,
  IDelegationPattern,
  IAgentRouting,
  IPhaseAgentMapping,
  IQualityEstimate,
  IExtractedFindings,
  IWorkflowRule,
  IStorageResult,
  IOrchestrationMetrics
} from './types.js';

export { WorkflowPhase } from './types.js';

// Constants
export {
  DEFAULT_WORKFLOW_RULES,
  PHASE_AGENT_MAPPING,
  TOKEN_LIMITS,
  DELEGATION_KEYWORDS,
  OPERATION_AGENT_MAPPING,
  PHASE_KEYWORDS,
  MIN_OPERATION_COUNT,
  PHASE_CONFIDENCE_THRESHOLD
} from './constants.js';

// Manager
export {
  OrchestrationMemoryManager,
  type IOrchestrationMemoryConfig,
  type ITaskOptions,
  type ITaskMetadata,
  type IFeedbackMetadata
} from './orchestration-memory-manager.js';
