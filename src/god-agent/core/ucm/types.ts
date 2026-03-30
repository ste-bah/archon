/**
 * UCM Core Types
 * Universal Context Management System Type Definitions
 *
 * CONSTITUTION RULES: RULE-001 to RULE-075
 */

// ============================================================================
// Token Estimation Types (RULE-001 to RULE-006)
// ============================================================================

/**
 * Content type for token estimation
 * RULE-001: prose = 1.3 tokens/word
 * RULE-002: code = 1.5 tokens/word
 * RULE-003: tables = 2.0 tokens/word
 * RULE-004: citations = 1.4 tokens/word
 * RULE-006: default = 1.3 tokens/word
 */
export enum ContentType {
  PROSE = 'prose',
  CODE = 'code',
  TABLE = 'table',
  CITATION = 'citation',
  MIXED = 'mixed'
}

/**
 * Token ratio constants (immutable per CONSTITUTION)
 */
export const TOKEN_RATIOS: Readonly<Record<ContentType, number>> = {
  [ContentType.PROSE]: 1.3,
  [ContentType.CODE]: 1.5,
  [ContentType.TABLE]: 2.0,
  [ContentType.CITATION]: 1.4,
  [ContentType.MIXED]: 1.3  // Default ratio
} as const;

/**
 * Token breakdown by content type
 */
export interface ITokenBreakdown {
  contentType: ContentType;
  wordCount: number;
  tokenCount: number;
  percentage: number;
}

/**
 * Token estimation result
 * RULE-020: Accuracy ±5%
 */
export interface ITokenEstimate {
  tokens: number;
  confidence: number;
  contentType: ContentType;
  breakdown?: ITokenBreakdown[];
  wordCount: number;
  estimatedLatencyMs: number;
}

/**
 * Estimation hints for content classification
 */
export interface IEstimationHints {
  hasCode?: boolean;
  hasTables?: boolean;
  hasCitations?: boolean;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Chunking configuration (RULE-064: symmetric)
 * Implements: REQ-CHUNK-001 to REQ-CHUNK-006
 */
export interface IChunkingConfig {
  maxChars: number;      // Default: 2000
  minChars: number;      // Default: 200 - Minimum chunk size to prevent tiny chunks [REQ-CHUNK-002]
  overlap: number;       // Default: 300
  maxChunks: number;     // Default: 25
  breakPatterns: BreakPattern[];
  protectedPatterns: RegExp[];
}

export interface BreakPattern {
  priority: number;
  pattern: RegExp;
  name: string;
}

/**
 * Token defaults configuration
 */
export interface ITokenDefaults {
  contextWindow: number;
  tokensPerWord: number;
  summarizationThreshold: number;
  warningThreshold: number;
}

/**
 * Summarization configuration
 * RULE-043: Budget allocation
 */
export interface ISummarizationConfig {
  maxTokens: number;            // Default: 200
  citationsBudget: number;      // 40%
  keyFindingsBudget: number;    // 30%
  methodologyBudget: number;    // 15%
  resultsBudget: number;        // 15%
  preserveStructure: boolean;
}

/**
 * Progressive writing configuration
 * RULE-008: 15,000 tokens per output
 */
export interface IProgressiveConfig {
  maxOutputTokens: number;      // 15,000
  chunkOverlap: number;         // 500
  continuationMarker: string;
}

/**
 * Universal Context Management Configuration
 */
export interface IUniversalContextConfig {
  daemon: {
    socketPath: string;           // Default: /tmp/godagent-db.sock
    autoStart: boolean;           // Default: true
    healthCheckInterval: number;  // Default: 30000ms
    startupTimeout: number;       // Default: 3000ms
  };

  desc: {
    enabled: boolean;             // Default: true
    threshold: number;            // Default: 0.80
    maxEpisodes: number;          // Default: 2
    injectOnTask: boolean;        // Default: true
    chunkConfig: IChunkingConfig;
  };

  recovery: {
    enabled: boolean;             // Default: true
    autoRecover: boolean;         // Default: true
    descFallback: boolean;        // Default: true
    descFallbackThreshold: number; // Default: 0.85
  };

  embedding: {
    mode: 'http-proxy';           // HTTP Proxy to external service
    httpEndpoint: string;         // Default: 'http://127.0.0.1:8000/embed'
    model: string;                // Default: 'gte-Qwen2-1.5B-instruct'
    dimension: number;            // Default: 1536
    batchSize: number;            // Default: 64
    timeout: number;              // Default: 30000ms
  };

  workflow: {
    autoDetect: boolean;          // Default: true
    default: string;              // Default: 'general'
    adapters: string[];           // Default: ['phd-pipeline', 'code-review', 'general']
  };

  tokenManagement: {
    defaults: ITokenDefaults;
    summarization: ISummarizationConfig;
    progressiveWriting: IProgressiveConfig;
  };
}

// ============================================================================
// Workflow Types
// ============================================================================

/**
 * Task context for workflow detection
 */
export interface ITaskContext {
  agentId?: string;
  pipelineName?: string;
  phase?: string;
  task?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Token configuration for workflow
 */
export interface ITokenConfig {
  contextWindow?: number;
  tokensPerWord: number;
  summarizationThreshold?: number;
  warningThreshold?: number;
  averageWordLength?: number;
  safetyMargin?: number;
}

/**
 * Pinning strategy for workflow
 */
export interface IPinningStrategy {
  type: 'manual' | 'cross-reference' | 'file-based' | 'topic-based' | 'priority-based';
  maxPinnedTokens?: number;
  autoPin: boolean;
  autoPinThreshold?: number;
  threshold?: number;
  maxPinnedItems?: number;
  filePatterns?: string[];
}

/**
 * Phase-specific settings
 * RULE-010 to RULE-014: Rolling window sizes
 */
export interface IPhaseSettings {
  windowSize: number;
  maxActiveTokens?: number;
  summarizationBudget?: number;
  name?: string;
  focusAreas?: string[];
  compressionEnabled?: boolean;
  compressionRatio?: number;
  priorityBoost?: number;
}

/**
 * Workflow adapter interface
 */
export interface IWorkflowAdapter {
  name: string;
  detect(context: ITaskContext): boolean;
  getTokenConfig(context?: ITaskContext): ITokenConfig;
  getPinningStrategy(context?: ITaskContext): IPinningStrategy;
  getWindowSize(phaseOrContext?: string | ITaskContext): number;
  getPhaseSettings(phaseOrContext: string | ITaskContext): IPhaseSettings;
}

// ============================================================================
// DESC Episode Types (RULE-063 to RULE-070)
// ============================================================================

/**
 * Episode input for storage
 */
export interface IEpisodeInput {
  queryText: string;
  answerText: string;
  metadata?: Record<string, unknown>;
}

/**
 * Stored episode with embeddings
 */
export interface IStoredEpisode {
  episodeId: string;
  queryText: string;
  answerText: string;
  queryChunkEmbeddings: Float32Array[];
  answerChunkEmbeddings: Float32Array[];
  queryChunkCount: number;
  answerChunkCount: number;
  createdAt: Date;
  metadata?: Record<string, unknown>;
  /** ReasoningBank trajectory ID if linked (TASK-IDESC-RB-001) */
  trajectoryId?: string;
  /** Summarized reasoning trace from ReasoningBank (TASK-IDESC-RB-001) */
  reasoningTrace?: string;
  /** Timestamp when trajectory linkage was established (TASK-IDESC-RB-001) */
  trajectoryLinkedAt?: Date;
}

/**
 * Trajectory link for ReasoningBank integration
 * TASK-IDESC-RB-001: Link episodes to trajectories
 */
export interface ITrajectoryLink {
  /** Episode identifier */
  episodeId: string;
  /** ReasoningBank trajectory identifier */
  trajectoryId: string;
  /** Summarized reasoning trace for context injection */
  reasoningTrace: string;
  /** When the linkage was established */
  linkedAt: Date;
  /** Confidence score of the linkage (0-1) */
  confidence?: number;
  /** Additional metadata about the link */
  metadata?: Record<string, unknown>;
}

/**
 * Retrieval result
 * RULE-067: Chunk-level match, episode-level return
 */
export interface IRetrievalResult {
  episodeId: string;
  answerText: string;
  maxSimilarity: number;
  matchedChunkType: 'query' | 'answer';
  matchedChunkIndex: number;
  searchChunkIndex: number;
  metadata?: Record<string, unknown>;
  tokenCount?: number;
  content?: string;
  agentId?: string;
  similarity?: number;
}

/**
 * Retrieval options
 */
export interface IRetrievalOptions {
  threshold?: number;
  maxResults?: number;
  includeQueryMatch?: boolean;
  includeAnswerMatch?: boolean;
}

// ============================================================================
// Recovery Types (RULE-055 to RULE-062)
// ============================================================================

/**
 * Reconstructed context after compaction recovery
 */
export interface IPinnedAgent {
  agentId: string;
  content: string;
  pinnedAt: number;
  priority: number;
}

export interface IActiveWindow {
  agentStates: Array<{ agentId: string; state: unknown }>;
  taskQueue: string[];
  pinnedContextIds: string[];
  estimatedTokens: number;
}

export interface IArchivedSummary {
  id: string;
  timestamp: number;
  content: string;
  agentId?: string;
}

export interface IDependencyNode {
  agentId: string;
  dependencies: Set<string>;
  dependents: Set<string>;
  depth: number;
}

export interface IReconstructedContext {
  pinnedAgents: Map<string, string> | IPinnedAgent[];
  activeWindow: string[] | IActiveWindow;
  archivedSummaries: Map<string, string> | IArchivedSummary[];
  dependencyGraph: Map<string, Set<string>> | Map<string, IDependencyNode>;
  pipelinePhase: string;
  lastCompletedAgent: string;
  metrics: IRecoveryMetrics;
  timestamp?: number;
}

/**
 * Recovery metrics
 */
export interface IRecoveryMetrics {
  detectedAt?: Date;
  completedAt?: Date;
  agentsRecovered: number;
  tokensReconstructed: number;
  completeness: number;
  failedKeys?: string[];
  descFallbackUsed?: boolean;
  fallbacksUsed?: number;
  unrecoverableItems?: Array<{
    type: string;
    id: string;
    reason: string;
    timestamp: number;
  }>;
}

/**
 * Unrecoverable item information
 */
export interface IUnrecoverableItem {
  agentId: string;
  memoryKey: string;
  reason: 'key_not_found' | 'corrupted' | 'expired' | 'desc_fallback_failed';
  fallback: string;
}

// ============================================================================
// Hook Types
// ============================================================================

/**
 * PreToolUse input from Claude Code
 */
export interface IPreToolUseInput {
  tool_name: string;
  tool_input: {
    prompt?: string;
    subagent_type?: string;
    description?: string;
    [key: string]: unknown;
  };
  session_id: string;
}

/**
 * Hook output for context modification
 */
export interface IPreToolUseOutput {
  decision: 'allow' | 'block';
  reason?: string;
  modify_tool_input?: {
    prompt?: string;
  };
}

/**
 * Session restore hook input
 */
export interface ISessionRestoreInput {
  session_id: string;
  conversation_summary?: string;
}

/**
 * Session restore hook output
 */
export interface ISessionRestoreOutput {
  context_recovered: boolean;
  agents_recovered: number;
  tokens_reconstructed: number;
  recovery_completeness: number;
}

// ============================================================================
// Range Type for Chunking
// ============================================================================

export interface IRange {
  start: number;
  end: number;
}

/**
 * Chunk with position metadata for reconstruction
 * Implements: REQ-CHUNK-003 (offset tracking for reconstruction)
 */
export interface IChunkWithPosition {
  /** Chunk text content */
  text: string;
  /** Start character offset in original text (0-indexed) */
  start: number;
  /** End character offset in original text (exclusive) */
  end: number;
  /** Chunk index (0-indexed) */
  index: number;
  /** Estimated token count for this chunk */
  estimatedTokens?: number;
}

// ============================================================================
// Service Interfaces
// ============================================================================

export interface ISymmetricChunker {
  /** Chunk text and return only the text content */
  chunk(text: string): Promise<string[]>;
  /** Chunk text and return chunks with position metadata [REQ-CHUNK-003] */
  chunkWithPositions(text: string): Promise<IChunkWithPosition[]>;
}

export interface IEpisodeRetriever {
  retrieve(
    queryChunks: string[],
    queryEmbeddings: Float32Array[],
    options?: IRetrievalOptions
  ): Promise<IRetrievalResult[]>;
}

export interface ICompactionDetector {
  detectCompaction(conversationContext: string): boolean;
  getCompactionTimestamp(): Date | number | null;
  isInRecoveryMode(): boolean;
}

export interface IMemoryReconstructor {
  reconstructContext(): Promise<IReconstructedContext>;
}

export interface IEmbeddingProvider {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  isAvailable(): Promise<boolean>;
}

export interface IDualEmbeddingStore {
  storeEpisode(input: IEpisodeInput, queryEmbeddings: Float32Array[], answerEmbeddings: Float32Array[]): Promise<string>;
  getEpisode(episodeId: string): Promise<IStoredEpisode | null>;
  getAllEpisodes(): Promise<IStoredEpisode[]>;
  deleteEpisode(episodeId: string): Promise<void>;
}

export interface IWordCounter {
  count(text: string): number;
}

export interface IContentClassifier {
  classify(text: string): ContentType;
  classifyDetailed(text: string): ITokenBreakdown[];
}

export interface ITokenEstimator {
  estimate(text: string, hints?: IEstimationHints): ITokenEstimate;
}

// ============================================================================
// Injection Filter Types (Safety for DESC)
// ============================================================================

/**
 * Workflow category for context-aware filtering
 */
export enum WorkflowCategory {
  RESEARCH = 'research',
  CODING = 'coding',
  GENERAL = 'general'
}

/**
 * Episode with recency decay metadata
 */
export interface IEpisodeWithDecay extends IStoredEpisode {
  recencyWeight: number;
  ageInDays: number;
}

/**
 * Injection filter decision
 */
export interface IInjectionDecision {
  inject: boolean;
  reason: string;
  adjustedScore: number;
  category: WorkflowCategory;
}

/**
 * Injection filter interface
 */
export interface IInjectionFilter {
  /**
   * Apply recency decay based on episode age
   * @param episode - Episode to apply decay to
   * @returns Recency weight (0-1)
   */
  applyRecencyDecay(episode: IStoredEpisode, category: WorkflowCategory): number;

  /**
   * Check if episode content type matches task context
   * @param episodeMetadata - Episode metadata
   * @param taskContext - Task context
   * @returns True if content types match
   */
  isContentTypeMatch(episodeMetadata: Record<string, unknown>, taskContext: ITaskContext): boolean;

  /**
   * Check if episode file context is relevant
   * @param episodeMetadata - Episode metadata
   * @param taskContext - Task context
   * @returns True if file contexts are relevant
   */
  isFileContextRelevant(episodeMetadata: Record<string, unknown>, taskContext: ITaskContext): boolean;

  /**
   * Determine if an episode should be injected
   * @param episode - Episode to evaluate
   * @param similarity - Similarity score
   * @param taskContext - Task context
   * @returns Injection decision
   */
  shouldInject(
    episode: IStoredEpisode,
    similarity: number,
    taskContext: ITaskContext
  ): IInjectionDecision;

  /**
   * Detect workflow category from task context
   * @param taskContext - Task context
   * @returns Workflow category
   */
  detectWorkflowCategory(taskContext: ITaskContext): WorkflowCategory;
}

// ============================================================================
// IDESC-001: Intelligent DESC v2 Types
// TASK-IDESC-INFRA-002: Define Outcome Types and Interfaces
// Implements: REQ-IDESC-001, REQ-IDESC-002
// ============================================================================

/**
 * Error types for outcome recording
 * Implements: REQ-IDESC-004 (negative examples)
 */
export enum ErrorType {
  SYNTAX_ERROR = 'syntax_error',
  LOGIC_ERROR = 'logic_error',
  NOT_APPLICABLE = 'not_applicable',
  STALE_SOLUTION = 'stale_solution',
  INCOMPLETE = 'incomplete',
  SECURITY_ISSUE = 'security_issue'
}

/**
 * Confidence level for injection decisions
 * Implements: REQ-IDESC-006, REQ-IDESC-007, REQ-IDESC-008
 */
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Outcome record for an episode injection
 * Implements: REQ-IDESC-001
 */
export interface IOutcome {
  /** Unique outcome identifier (UUID) */
  outcomeId: string;
  /** Episode that was injected */
  episodeId: string;
  /** Task/session that used this episode */
  taskId: string;
  /** Whether the injection helped or failed */
  success: boolean;
  /** Type of error if failed */
  errorType?: ErrorType;
  /** Additional context about the outcome */
  details?: Record<string, unknown>;
  /** When the outcome was recorded */
  recordedAt: Date;
}

/**
 * Parameters for recording an outcome (without auto-generated fields)
 */
export type IOutcomeInput = Omit<IOutcome, 'outcomeId' | 'recordedAt'>;

/**
 * Episode statistics with computed success rate
 * Implements: REQ-IDESC-002 (minimum 3 samples)
 */
export interface IEpisodeStats {
  /** Episode identifier */
  episodeId: string;
  /** Total number of outcomes recorded */
  outcomeCount: number;
  /** Number of successful outcomes */
  successCount: number;
  /** Number of failed outcomes */
  failureCount: number;
  /** Success rate (null if outcomeCount < 3 per REQ-IDESC-002) */
  successRate: number | null;
  /** Most recent outcome timestamp */
  lastOutcomeAt: Date | null;
}

/**
 * Outcome storage interface
 * Implements: REQ-IDESC-001, NFR-IDESC-001 (<10ms recording)
 */
export interface IOutcomeStorage {
  /**
   * Record an outcome for an episode
   * @param outcome - Outcome to record
   * @returns Outcome ID on success
   * Performance: <10ms p95 (NFR-IDESC-001)
   */
  recordOutcome(outcome: IOutcomeInput): Promise<string>;

  /**
   * Get all outcomes for an episode
   * @param episodeId - Episode to get outcomes for
   * @returns List of outcomes (newest first)
   */
  getOutcomes(episodeId: string): Promise<IOutcome[]>;

  /**
   * Get success rate for an episode
   * @param episodeId - Episode to get rate for
   * @returns Success rate (0-1) or null if outcomeCount < 3
   */
  getSuccessRate(episodeId: string): Promise<number | null>;

  /**
   * Get outcome count for an episode
   * @param episodeId - Episode to count outcomes for
   * @returns Number of outcomes
   */
  getOutcomeCount(episodeId: string): Promise<number>;

  /**
   * Get episode statistics
   * @param episodeId - Episode to get stats for
   * @returns Pre-computed statistics
   */
  getEpisodeStats(episodeId: string): Promise<IEpisodeStats>;

  /**
   * Get failure outcomes for an episode
   * @param episodeId - Episode to get failures for
   * @param limit - Maximum number of failures to return
   * @returns List of failure outcomes (newest first)
   */
  getFailures(episodeId: string, limit?: number): Promise<IOutcome[]>;
}

/**
 * Warning configuration for negative examples
 * Implements: REQ-IDESC-003, REQ-IDESC-004
 */
export interface IWarningConfig {
  /** Success rate threshold below which to warn (default: 0.5) */
  warningThreshold: number;
  /** Minimum outcomes required to generate warning (default: 3) */
  minimumOutcomes: number;
}

/**
 * Warning message for negative examples
 * Implements: REQ-IDESC-004, AC-IDESC-001b
 */
export interface IWarningMessage {
  /** Episode being warned about */
  episodeId: string;
  /** Current success rate */
  successRate: number;
  /** Total outcomes recorded */
  totalOutcomes: number;
  /** Number of failures */
  failureCount: number;
  /** Recent failure details */
  recentFailures: Array<{
    errorType: ErrorType;
    details: string;
    timestamp: Date;
  }>;
  /** Formatted warning text for injection */
  warningText: string;
}

/**
 * Enhanced injection decision with outcome awareness
 * Implements: REQ-IDESC-005, REQ-IDESC-006, REQ-IDESC-007, REQ-IDESC-008
 */
export interface IEnhancedInjectionDecision extends IInjectionDecision {
  /** Confidence level based on similarity, success rate, and recency */
  confidence: ConfidenceLevel;
  /** Success rate (null if insufficient data) */
  successRate: number | null;
  /** Number of outcomes for this episode */
  outcomeCount: number;
  /** Warning messages for low-success episodes */
  warnings: string[];
  /** ReasoningBank trajectory ID if linked */
  trajectoryId?: string;
  /** Reasoning trace summary if available */
  reasoningTrace?: string;
}

/**
 * Episode with outcome metadata
 * Extends IStoredEpisode with outcome statistics
 */
export interface IEpisodeWithOutcomes extends IStoredEpisode {
  /** Number of outcomes for this episode */
  outcomeCount: number;
  /** Success rate (null if < 3 outcomes) */
  successRate: number | null;
  /** Most recent outcome timestamp */
  lastOutcomeAt: Date | null;
}

/**
 * Enhanced retrieval result with warning support
 * Implements: TASK-IDESC-NEG-003
 */
export interface IEnhancedRetrievalResult extends IRetrievalResult {
  /** Warning message if episode has low success rate */
  warning?: IWarningMessage;
  /** Whether this episode should be deprioritized */
  deprioritized: boolean;
  /** Success rate (null if insufficient data) */
  successRate: number | null;
  /** Number of outcomes recorded */
  outcomeCount: number;
}

/**
 * Negative example provider configuration
 */
export interface INegativeExampleConfig {
  /** Minimum outcomes required for warning (default: 3) */
  minimumOutcomes: number;
  /** Success rate threshold for warning (default: 0.50) */
  warningThreshold: number;
  /** Deprioritization penalty factor (default: 0.9) */
  deprioritizationFactor: number;
}

/**
 * Threshold change record for audit log
 * Implements: GUARD-IDESC-006
 */
export interface IThresholdChange {
  /** Unique change identifier */
  changeId: string;
  /** Workflow category affected */
  category: WorkflowCategory;
  /** Previous threshold value */
  oldValue: number;
  /** New threshold value */
  newValue: number;
  /** Reason for the change */
  changeReason: string;
  /** When the change was made */
  changedAt: Date;
  /** Source of the change */
  changedBy: 'active_learning' | 'manual' | 'system';
}

/**
 * Confidence calculator interface
 * Implements: REQ-IDESC-006, REQ-IDESC-007, REQ-IDESC-008
 */
export interface IConfidenceCalculator {
  /**
   * Calculate confidence level for an injection
   * @param similarity - Similarity score (0-1)
   * @param successRate - Success rate (0-1 or null)
   * @param outcomeCount - Number of outcomes
   * @param episodeCreatedAt - When episode was created
   * @param category - Workflow category
   * @returns Confidence level
   */
  calculate(
    similarity: number,
    successRate: number | null,
    outcomeCount: number,
    episodeCreatedAt: Date,
    category: WorkflowCategory
  ): ConfidenceLevel;
}

/**
 * Alert for injection quality degradation
 * Implements: REQ-IDESC-012, AC-IDESC-005d
 */
export interface IAlert {
  /** Alert type */
  type: 'INJECTION_QUALITY_DEGRADATION';
  /** Alert severity */
  severity: 'WARNING' | 'CRITICAL';
  /** Workflow category affected */
  category: WorkflowCategory;
  /** Current false positive rate */
  falsePositiveRate: number;
  /** Threshold that was exceeded */
  threshold: number;
  /** Alert message */
  message: string;
  /** When alert was generated */
  timestamp: Date;
  /** Recent failure outcomes for context */
  recentFailures?: IOutcome[];
}

/**
 * Configuration for alert system
 * Implements: REQ-IDESC-012
 */
export interface IAlertConfig {
  /** FPR threshold for WARNING alerts (default: 0.02 = 2%) */
  fprThreshold: number;
  /** Cooldown period between alerts (default: 3600000 = 1 hour) */
  cooldownMs: number;
  /** FPR threshold for CRITICAL alerts (default: 0.05 = 5%) */
  criticalThreshold: number;
  /** Include recent failures in alerts (default: true) */
  includeRecentFailures: boolean;
  /** Max number of recent failures to include (default: 5) */
  maxRecentFailures: number;
}

// Re-export from context module for convenience
export type { IComposedContext } from "./context/context-composition-engine.js";
