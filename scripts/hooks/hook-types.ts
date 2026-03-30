/**
 * Claude Code Hooks - Type Definitions
 *
 * Implements: TECH-HKS-001 (data_models section)
 * Constitution: constitution.md
 *
 * CRITICAL: No 'any' types - all types explicitly defined (GUARD-HKS-007)
 *
 * @module scripts/hooks/hook-types
 */

import type { KnowledgeEntry } from '../../src/god-agent/universal/universal-agent.js';

// Re-export KnowledgeEntry for convenience
export type { KnowledgeEntry };

/**
 * Exit codes per constitution (error_handling section)
 */
export const EXIT_CODES = {
  SUCCESS: 0,
  ERROR: 1,
  VALIDATION_FAILURE: 2,
  TIMEOUT: 3
} as const;

export type ExitCode = typeof EXIT_CODES[keyof typeof EXIT_CODES];

/**
 * Configuration for hook execution behavior
 * Implements: TECH-HKS-001 IHookConfig model
 */
export interface IHookConfig {
  /** Maximum execution time for pre-task hook in milliseconds */
  preTaskTimeoutMs: number;
  /** Maximum execution time for post-task hook in milliseconds */
  postTaskTimeoutMs: number;
  /** Domains to query for context injection */
  memoryDomains: string[];
  /** Maximum context tokens to inject (truncate if exceeded) */
  maxContextSize: number;
  /** Maximum retry attempts for failed operations */
  retryAttempts: number;
  /** Base delay between retry attempts (exponential backoff) */
  retryDelayMs: number;
  /** Enable DEBUG level logging */
  verbose: boolean;
  /** InteractionStore database path */
  memoryDbPath: string;
}

/**
 * Default configuration values
 */
export const DEFAULT_HOOK_CONFIG: IHookConfig = {
  preTaskTimeoutMs: 5000,
  postTaskTimeoutMs: 5000,
  memoryDomains: ['project/*'],
  maxContextSize: 10000,
  retryAttempts: 3,
  retryDelayMs: 1000,
  verbose: false,
  memoryDbPath: '.agentdb/universal/session-knowledge.json'
};

/**
 * Context for pre-task hook execution
 * Implements: TECH-HKS-001 IPreTaskContext model
 */
export interface IPreTaskContext {
  /** Original Task() prompt before enhancement */
  originalPrompt: string;
  /** Detected agent type from prompt patterns */
  agentType: string;
  /** Workflow identifier for context grouping */
  workflowId: string;
  /** Memory domain to query (e.g., "project/api") */
  domain: string;
  /** Filter tags for memory query */
  tags: string[];
  /** Retrieved knowledge entries from InteractionStore */
  injectedContext: KnowledgeEntry[];
  /** Final prompt with injected context */
  enhancedPrompt: string;
  /** Hook execution start timestamp for performance tracking */
  startTime: number;
}

/**
 * Context for post-task hook execution
 * Implements: TECH-HKS-001 IPostTaskContext model
 */
export interface IPostTaskContext {
  /** Raw Task() output string */
  taskOutput: string;
  /** Parsed TASK COMPLETION SUMMARY or null if extraction failed */
  extractedSummary: ITaskSummary | null;
  /** InteractionStore entry ID if storage succeeded, null otherwise */
  storedEntryId: string | null;
  /** Whether ReasoningBank feedback was submitted successfully */
  feedbackSubmitted: boolean;
  /** Estimated quality score (0-1) */
  feedbackQuality: number;
  /** Total hook execution time in milliseconds */
  duration: number;
}

/**
 * Extracted task completion summary structure
 * Implements: TECH-HKS-001 ITaskSummary model
 */
export interface ITaskSummary {
  /** 1-2 sentence summary of task completion */
  whatIDid: string;
  /** Array of file paths created during task */
  filesCreated: string[];
  /** Array of file paths modified during task */
  filesModified: string[];
  /** Array of memory storage entries with domain/tags/content */
  interactionStoreEntries: IStoreEntry[];
  /** Feedback data if present in output */
  reasoningBankFeedback: IFeedbackEntry | null;
  /** Guidance for future agents querying this task's findings */
  nextAgentGuidance: string;
}

/**
 * InteractionStore entry metadata from task summary
 * Implements: TECH-HKS-001 IStoreEntry model
 */
export interface IStoreEntry {
  /** Memory domain (e.g., "project/api") */
  domain: string;
  /** Filter tags for future queries */
  tags: string[];
  /** Human-readable description of what was stored */
  description: string;
}

/**
 * ReasoningBank feedback metadata from task summary
 * Implements: TECH-HKS-001 IFeedbackEntry model
 */
export interface IFeedbackEntry {
  /** Unique trajectory identifier */
  trajectoryId: string;
  /** Quality score (0-1) */
  quality: number;
  /** Binary outcome classification */
  outcome: 'positive' | 'negative';
}

/**
 * Error context for logging and diagnostics
 * Implements: TECH-HKS-001 IHookError model
 */
export interface IHookError {
  /** Hook phase where error occurred */
  phase: 'pre-task' | 'post-task';
  /** Operation that failed (e.g., "context-injection", "storage") */
  operation: string;
  /** Original error object with message and stack */
  error: Error;
  /** Additional context for debugging (e.g., domain, tags, prompt size) */
  context: Record<string, unknown>;
  /** Error timestamp (Date.now()) */
  timestamp: number;
  /** Exit code: 1=error, 2=validation, 3=timeout */
  exitCode: 1 | 2 | 3;
}

/**
 * Learning feedback interface for ReasoningBank
 */
export interface ILearningFeedback {
  /** Unique trajectory identifier */
  trajectoryId: string;
  /** Quality score (0-1) */
  quality: number;
  /** User feedback text */
  userFeedback: string;
  /** Outcome classification */
  outcome: 'positive' | 'negative' | 'neutral';
}

/**
 * Feedback queue entry for retry logic
 */
export interface IFeedbackQueueEntry {
  /** Unique trajectory identifier */
  trajectoryId: string;
  /** Quality score (0-1) */
  quality: number;
  /** Outcome classification */
  outcome: 'positive' | 'negative' | 'neutral';
  /** Additional metadata */
  metadata: Record<string, unknown>;
  /** Number of retry attempts */
  attempts: number;
  /** Last retry attempt timestamp */
  lastAttempt: number;
  /** Entry creation timestamp */
  createdAt: number;
}

/**
 * Agent type detection patterns
 * Implements: TECH-HKS-001 detectAgentType function
 */
export const AGENT_TYPE_PATTERNS: Record<string, RegExp[]> = {
  'backend-dev': [/backend/i, /api/i, /endpoint/i, /server/i, /database/i, /schema/i],
  'coder': [/frontend/i, /ui/i, /component/i, /react/i, /vue/i, /angular/i, /css/i],
  'tester': [/test/i, /integration/i, /e2e/i, /spec/i, /coverage/i, /assert/i],
  'system-architect': [/architecture/i, /design/i, /system/i, /diagram/i, /pattern/i],
  'reviewer': [/review/i, /audit/i, /validate/i, /verify/i, /check/i, /inspect/i]
};

/**
 * Logger interface for hook logging
 */
export interface IHookLogger {
  error(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

/**
 * Validation error for input validation failures
 */
export class ValidationError extends Error {
  public readonly exitCode = EXIT_CODES.VALIDATION_FAILURE;
  public readonly patterns: string[];

  constructor(message: string, patterns: string[] = []) {
    super(message);
    this.name = 'ValidationError';
    this.patterns = patterns;
  }
}

/**
 * Timeout error for hook execution timeout
 */
export class TimeoutError extends Error {
  public readonly exitCode = EXIT_CODES.TIMEOUT;
  public readonly elapsed: number;
  public readonly partialState: Record<string, unknown>;

  constructor(message: string, elapsed: number, partialState: Record<string, unknown> = {}) {
    super(message);
    this.name = 'TimeoutError';
    this.elapsed = elapsed;
    this.partialState = partialState;
  }
}

/**
 * Storage error for InteractionStore failures
 */
export class StorageError extends Error {
  public readonly exitCode = EXIT_CODES.ERROR;
  public readonly entryData: Record<string, unknown>;

  constructor(message: string, entryData: Record<string, unknown> = {}) {
    super(message);
    this.name = 'StorageError';
    this.entryData = entryData;
  }
}

/**
 * Configuration error for invalid hook configuration
 */
export class ConfigurationError extends Error {
  public readonly exitCode = EXIT_CODES.VALIDATION_FAILURE;
  public readonly missing: string[];
  public readonly invalid: Record<string, { value: unknown; reason: string }>;

  constructor(
    message: string,
    missing: string[] = [],
    invalid: Record<string, { value: unknown; reason: string }> = {}
  ) {
    super(message);
    this.name = 'ConfigurationError';
    this.missing = missing;
    this.invalid = invalid;
  }
}

// ============================================================================
// Session Hook Types (PRD-GOD-AGENT-001)
// ============================================================================

/**
 * Base hook response interface
 */
export interface HookResponse {
  success: boolean;
  correlationId: string;
  durationMs: number;
  error?: string;
}

/**
 * Session start hook input from Claude Code
 * Implements: TECH-HOOK-001 SessionStartInput
 */
export interface SessionStartInput {
  /** Correlation ID for tracing */
  correlationId: string;
  /** Event timestamp */
  timestamp: string;
  /** Event type (always "SessionStart") */
  eventType: 'SessionStart';
  /** Unique session identifier */
  sessionId: string;
  /** Working directory path */
  workingDirectory: string;
  /** Claude Code version */
  claudeVersion: string;
}

/**
 * Session state structure for persistence
 */
export interface SessionState {
  /** Session identifier */
  sessionId: string;
  /** Session timestamp */
  timestamp: string;
  /** Git state information */
  git: {
    branch: string;
    uncommittedFiles: string[];
    diffSummary: string;
  };
  /** Task state information */
  tasks: {
    inProgress: string[];
    completed: string[];
    pending: string[];
  };
  /** Context information */
  context: {
    recentFiles: string[];
    currentFocus: string;
    keyDecisions: string[];
  };
}

/**
 * Session start hook response
 * Implements: TECH-HOOK-001 SessionStartResponse
 */
export interface SessionStartResponse extends HookResponse {
  /** Restored domain weights */
  domainWeights: Record<string, number>;
  /** Whether context was injected */
  contextInjected: boolean;
  /** The actual injection text */
  contextInjection?: string;
  /** ID of restored session */
  previousSessionId?: string;
  /** Summary of restored state */
  restoredState?: {
    gitBranch?: string;
    uncommittedFileCount?: number;
    tasksInProgress?: number;
    currentFocus?: string;
  };
}

/**
 * Session end hook input from Claude Code
 * Implements: TECH-HOOK-001 SessionEndInput
 */
export interface SessionEndInput {
  /** Correlation ID for tracing */
  correlationId: string;
  /** Event timestamp */
  timestamp: string;
  /** Event type (always "SessionEnd") */
  eventType: 'SessionEnd';
  /** Unique session identifier */
  sessionId: string;
  /** Working directory path */
  workingDirectory: string;
  /** Session duration in ms */
  durationMs: number;
}

/**
 * Session end hook response
 * Implements: TECH-HOOK-001 SessionEndResponse
 */
export interface SessionEndResponse extends HookResponse {
  /** Whether weights were persisted */
  weightsPersisted: boolean;
  /** Whether session state was saved */
  stateSaved: boolean;
  /** Path to saved session state */
  statePath?: string;
}


// ============================================================================
// PreToolUse Hook Types (TASK-HOOK-003)
// ============================================================================

/**
 * PreToolUse hook input from Claude Code
 * Implements: TASK-HOOK-003 PreToolUseInput
 */
export interface PreToolUseInput {
  /** Correlation ID for tracing */
  correlationId: string;
  /** Event timestamp */
  timestamp: string;
  /** Event type (always "PreToolUse") */
  eventType: 'PreToolUse';
  /** Name of the tool being invoked */
  toolName: string;
  /** Tool input parameters */
  toolInput: Record<string, unknown>;
  /** Task description extracted from tool input */
  taskDescription?: string;
}

/**
 * Task context hook response
 * Implements: TASK-HOOK-003 TaskContextResponse
 */
export interface TaskContextResponse extends HookResponse {
  /** XML-formatted context injection for Claude */
  contextInjection?: string;
  /** Number of patterns found */
  patternsFound: number;
  /** Confidence scores for found patterns */
  confidenceScores: number[];
}

/**
 * Pattern match result for context injection
 */
export interface PatternMatchResult {
  /** Pattern description */
  pattern: string;
  /** Similarity score (0-1) */
  similarity: number;
  /** Source of the pattern */
  source: string;
  /** Task type the pattern applies to */
  taskType?: string;
}


// ============================================================================
// Causal Check Hook Types (TASK-HOOK-004)
// ============================================================================

/**
 * Causal pattern from GraphDB
 */
export interface CausalPattern {
  /** Unique pattern identifier */
  patternId: string;
  /** Original command that was executed */
  command: string;
  /** Outcome of the command */
  outcome: 'success' | 'failure';
  /** Similarity score to the query command */
  similarity: number;
  /** Context/error message from the outcome */
  context: string;
}

/**
 * Past failure record for response
 */
export interface PastFailure {
  /** Command that failed */
  command: string;
  /** Outcome/error description */
  outcome: string;
  /** Similarity to current command */
  similarity: number;
}

/**
 * Causal check hook response
 * Implements: TASK-HOOK-004 CausalCheckResponse
 */
export interface CausalCheckResponse extends HookResponse {
  /** Whether the command should proceed */
  shouldProceed: boolean;
  /** Warning message if risky */
  warning?: string;
  /** Past failures with similar commands */
  pastFailures: PastFailure[];
}


// ============================================================================
// Subagent Hook Types (TASK-HOOK-005, TASK-HOOK-006)
// ============================================================================

/**
 * Subagent stop input from Claude Code
 * Implements: TASK-HOOK-005, TASK-HOOK-006 SubagentStopInput
 */
export interface SubagentStopInput {
  /** Correlation ID for tracing */
  correlationId: string;
  /** Event timestamp */
  timestamp: string;
  /** Event type (always "SubagentStop") */
  eventType: 'SubagentStop';
  /** Type of agent that completed */
  agentType: string;
  /** Task description the agent worked on */
  taskDescription: string;
  /** Execution result */
  result: 'success' | 'failure' | 'partial';
  /** Summary of the agent's output */
  outputSummary: string;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Quality score (0-1), optional */
  qualityScore?: number;
}

/**
 * Subagent learn hook response
 * Implements: TASK-HOOK-005 SubagentLearnResponse
 */
export interface SubagentLearnResponse extends HookResponse {
  /** Created trajectory ID */
  trajectoryId?: string;
  /** Whether weights were updated */
  weightsUpdated: boolean;
}

/**
 * Agent complete hook response
 * Implements: TASK-HOOK-006 AgentCompleteResponse
 */
export interface AgentCompleteResponse extends HookResponse {
  /** Created hyperedge ID (if quality threshold met) */
  hyperedgeId?: string;
  /** Whether quality threshold was met */
  qualityThresholdMet: boolean;
}

// ============================================================================
// Notification Hook Types (TASK-HOOK-007, TASK-HOOK-008)
// ============================================================================

/**
 * Notification input from Claude Code
 * Implements: TASK-HOOK-007, TASK-HOOK-008 NotificationInput
 */
export interface NotificationInput {
  /** Correlation ID for tracing */
  correlationId: string;
  /** Event timestamp */
  timestamp: string;
  /** Event type (always "Notification") */
  eventType: 'Notification';
  /** Notification type */
  notificationType: 'compact' | 'feedback' | 'error' | 'info';
  /** Notification message */
  message: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Compact inject hook response
 * Implements: TASK-HOOK-007 CompactInjectResponse
 */
export interface CompactInjectResponse extends HookResponse {
  /** Context injection XML block */
  contextInjection?: string;
  /** Session summary text */
  sessionSummary?: string;
  /** Number of active patterns */
  activePatterns: number;
  /** Git state information */
  gitState?: {
    branch: string;
    uncommittedCount: number;
  };
  /** Task state information */
  taskState?: {
    inProgress: number;
    pending: number;
  };
}

/**
 * Sentiment type for feedback
 */
export type Sentiment = 'positive' | 'negative' | 'neutral';

/**
 * Session feedback hook response
 * Implements: TASK-HOOK-008 SessionFeedbackResponse
 */
export interface SessionFeedbackResponse extends HookResponse {
  /** Analyzed sentiment */
  sentiment: Sentiment;
  /** Weight changes applied */
  weightDelta: Record<string, number>;
  /** Whether feedback was processed */
  feedbackProcessed: boolean;
}
