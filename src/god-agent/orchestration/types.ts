/**
 * Orchestration Memory System - Core Type Definitions
 *
 * Implements: TASK-ORC-001 (TECH-ORC-001 lines 116-404)
 *
 * @module orchestration/types
 */

/**
 * Workflow phases enum
 */
export enum WorkflowPhase {
  PLANNING = 'planning',
  SPECIFICATION = 'specification',
  IMPLEMENTATION = 'implementation',
  TESTING = 'testing',
  REVIEW = 'review',
  AUDIT = 'audit',
  GENERAL = 'general-purpose'
}

/**
 * Workflow state persisted across sessions
 */
export interface IWorkflowState {
  /** Unique workflow identifier */
  id: string;
  /** Workflow name or description */
  name: string;
  /** Array of completed phase names */
  completedPhases: string[];
  /** Array of pending task IDs */
  pendingTasks: string[];
  /** Domains where knowledge was stored */
  storedDomains: string[];
  /** Current workflow phase */
  currentPhase: string;
  /** Workflow start timestamp */
  startedAt: number;
  /** Last activity timestamp */
  lastActivityAt: number;
  /** Workflow status */
  status: 'active' | 'paused' | 'completed' | 'failed';
  /** Optional metadata */
  metadata?: Record<string, any>;
}

/**
 * Task memory entry stored in InteractionStore
 */
export interface ITaskMemoryEntry {
  /** Unique entry ID */
  id: string;
  /** Workflow ID this task belongs to */
  workflowId: string;
  /** Task ID or description */
  taskId: string;
  /** Agent type that executed the task */
  agentType: string;
  /** Domain for knowledge categorization */
  domain: string;
  /** Tags for filtering */
  tags: string[];
  /** Category (e.g., 'schema', 'implementation', 'decision') */
  category: string;
  /** Extracted findings content */
  content: string;
  /** Quality score (0-1) */
  quality: number;
  /** Task execution timestamp */
  timestamp: number;
  /** Task duration in milliseconds */
  durationMs: number;
  /** Success indicator */
  success: boolean;
  /** Optional error details */
  error?: string;
}

/**
 * Context injection result
 */
export interface IContextInjection {
  /** Original prompt */
  originalPrompt: string;
  /** Enhanced prompt with context */
  enhancedPrompt: string;
  /** Number of context entries injected */
  contextEntryCount: number;
  /** Total tokens in context section */
  contextTokens: number;
  /** Domains queried for context */
  domainsQueried: string[];
  /** Tags used for filtering */
  tagsUsed: string[];
  /** Whether context limit was exceeded */
  contextLimitExceeded: boolean;
  /** Timestamp of injection */
  timestamp: number;
}

/**
 * Pattern for delegation detection
 */
export interface IDelegationPattern {
  /** Pattern ID */
  id: string;
  /** Detected operation sequence */
  operationSequence: string[];
  /** Operation count */
  operationCount: number;
  /** Suggested agent type */
  suggestedAgent: string;
  /** Confidence in suggestion (0-1) */
  confidence: number;
  /** Whether orchestrator delegated */
  delegated: boolean;
  /** Orchestrator's choice (if different) */
  orchestratorChoice?: string;
  /** Detection timestamp */
  timestamp: number;
  /** Whether pattern triggered prompt */
  promptDisplayed: boolean;
}

/**
 * Agent routing decision
 */
export interface IAgentRouting {
  /** Task description */
  taskDescription: string;
  /** Detected workflow phase */
  detectedPhase: WorkflowPhase;
  /** Suggested agent type */
  suggestedAgent: string;
  /** Confidence in phase detection (0-1) */
  phaseConfidence: number;
  /** Whether suggestion was overridden */
  overridden: boolean;
  /** Actual agent used */
  actualAgent: string;
  /** Reason for override */
  overrideReason?: string;
  /** Routing timestamp */
  timestamp: number;
}

/**
 * Phase to agent mapping
 */
export interface IPhaseAgentMapping {
  phase: WorkflowPhase;
  primaryAgent: string;
  fallbackAgents: string[];
  description: string;
}

/**
 * Quality estimate for feedback
 */
export interface IQualityEstimate {
  /** Quality score (0-1) */
  quality: number;
  /** Outcome classification */
  outcome: 'positive' | 'negative' | 'neutral';
  /** Indicators used for estimation */
  indicators: {
    hasCompletionMarkers: boolean;
    hasErrors: boolean;
    hasExpectedDeliverables: boolean;
    outputLengthAdequate: boolean;
  };
  /** Reasoning for estimate */
  reasoning: string;
  /** Estimation timestamp */
  timestamp: number;
}

/**
 * Extracted findings from task output
 */
export interface IExtractedFindings {
  /** Code blocks with language tags */
  codeBlocks: Array<{
    language: string;
    code: string;
    description?: string;
  }>;
  /** Schema definitions */
  schemas: Array<{
    type: string;
    name: string;
    definition: string;
  }>;
  /** API contracts */
  apiContracts: Array<{
    method: string;
    path: string;
    description: string;
    contract: string;
  }>;
  /** Architectural decisions */
  decisions: Array<{
    topic: string;
    decision: string;
    reasoning: string;
  }>;
  /** Implementation summaries */
  summaries: string[];
  /** Test results */
  testResults: Array<{
    testSuite: string;
    passed: number;
    failed: number;
    details: string;
  }>;
  /** File paths mentioned */
  filePaths: string[];
  /** Error messages */
  errors: string[];
}

/**
 * Workflow guide rule
 */
export interface IWorkflowRule {
  /** Rule ID */
  id: string;
  /** Rule description */
  description: string;
  /** Required prerequisite phase */
  requires: WorkflowPhase;
  /** Phase that depends on prerequisite */
  dependentPhase: WorkflowPhase;
  /** Severity if violated */
  severity: 'error' | 'warning' | 'info';
  /** Error message if violated */
  violationMessage: string;
}

/**
 * Storage result
 */
export interface IStorageResult {
  /** Whether storage succeeded */
  success: boolean;
  /** Domain where stored */
  domain: string;
  /** Tags applied */
  tags: string[];
  /** Category */
  category: string;
  /** Content size in bytes */
  contentSize: number;
  /** Entry ID */
  entryId: string;
  /** Error if failed */
  error?: string;
}

/**
 * Metrics for observability
 */
export interface IOrchestrationMetrics {
  /** Total storage operations */
  storageCount: number;
  /** Total retrieval operations */
  retrievalCount: number;
  /** Total feedback submissions */
  feedbackCount: number;
  /** Successful task completion rate */
  successRate: number;
  /** Average quality score */
  averageQuality: number;
  /** Total context injections */
  contextInjectionsCount: number;
  /** Average context tokens */
  averageContextTokens: number;
  /** Delegation prompts displayed */
  delegationPromptsCount: number;
  /** Delegation acceptance rate */
  delegationAcceptanceRate: number;
  /** Phase detection accuracy */
  phaseDetectionAccuracy: number;
  /** Session start timestamp */
  sessionStartedAt: number;
  /** Last activity timestamp */
  lastActivityAt: number;
}
