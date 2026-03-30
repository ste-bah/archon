/**
 * DAI-003: Intelligent Task Routing Type Definitions
 *
 * TASK-001: Routing Type Definitions
 * Constitution: RULE-DAI-003-001 through RULE-DAI-003-007
 *
 * Provides types for:
 * - Task analysis and domain detection
 * - Agent capability matching
 * - Routing decisions with explanations
 * - Pipeline generation for multi-step tasks
 * - Cold start configuration
 * - Failure classification
 * - Learning feedback
 *
 * @module src/god-agent/core/routing/routing-types
 */

// ==================== Core Domain Types ====================

/**
 * Task domain categories for routing
 * Used to match tasks with specialized agents
 */
export type TaskDomain =
  | 'research'   // Information gathering, analysis, investigation
  | 'testing'    // Test creation, validation, quality assurance
  | 'code'       // Implementation, refactoring, debugging
  | 'writing'    // Documentation, content creation, reports
  | 'design'     // Architecture, system design, planning
  | 'review';    // Code review, audit, evaluation

/**
 * Task complexity assessment
 * Determined by verb count and multi-step indicators
 */
export type TaskComplexity =
  | 'simple'     // Single verb, straightforward task
  | 'moderate'   // 2-3 verbs, some coordination needed
  | 'complex';   // 4+ verbs, multi-step coordination required

/**
 * Cold start phase for routing behavior
 * Affects weight distribution between keyword and learned matching
 * Per RULE-DAI-003-006: Cold start mode must be explicit
 */
export type ColdStartPhase =
  | 'keyword-only'  // 0-25 executions: Pure keyword matching
  | 'blended'       // 26-100 executions: Keyword + capability
  | 'learned';      // 100+ executions: Full learned routing

/**
 * Failure type for classification
 * Per RULE-DAI-003-007: Failure attribution before learning
 */
export type FailureType =
  | 'ROUTING_FAILURE'   // User override followed by success (routing was wrong)
  | 'AGENT_FAILURE'     // Agent threw internal error, retry succeeded
  | 'TASK_IMPOSSIBLE'   // Multiple agents fail, user abandons
  | 'PARTIAL_SUCCESS';  // Some stages completed, not all

// ==================== Task Analysis ====================

/**
 * Task analysis result
 * Per INT-001: Task analysis returns domain, complexity, embedding
 */
export interface ITaskAnalysis {
  /** Original task description */
  readonly task: string;

  /** Detected primary domain */
  readonly domain: TaskDomain;

  /** Assessed complexity level */
  readonly complexity: TaskComplexity;

  /** Primary verb extracted from task */
  readonly primaryVerb: string;

  /** Additional verbs detected */
  readonly verbs: readonly string[];

  /** Required capabilities inferred from task */
  readonly requiredCapabilities: readonly string[];

  /** Task embedding vector (VECTOR_DIM (1536), L2-normalized) */
  readonly embedding: Float32Array;

  /** Whether task requires multiple steps/stages */
  readonly isMultiStep: boolean;

  /** Explicit agent preference if specified (e.g., "use researcher") */
  readonly preferredAgent?: string;

  /** Expected output artifacts */
  readonly expectedArtifacts: readonly string[];

  /** Analysis timestamp */
  readonly analyzedAt: number;

  /** Analysis duration in milliseconds */
  readonly analysisTimeMs: number;
}

// ==================== Agent Capability ====================

/**
 * Agent capability definition
 * Per INT-002: Capability index stores agent embeddings
 */
export interface IAgentCapability {
  /** Agent key (unique identifier from AgentRegistry) */
  readonly agentKey: string;

  /** Agent display name */
  readonly name: string;

  /** Agent description from markdown */
  readonly description: string;

  /** Primary domains this agent handles */
  readonly domains: readonly TaskDomain[];

  /** Keywords extracted from agent definition */
  readonly keywords: readonly string[];

  /** Tools available to this agent */
  readonly tools: readonly string[];

  /** Capability embedding vector (VECTOR_DIM (1536), L2-normalized) */
  readonly embedding: Float32Array;

  /** Historical success rate (0-1) */
  readonly successRate: number;

  /** Total task count handled */
  readonly taskCount: number;

  /** Last indexed timestamp */
  readonly indexedAt: number;
}

/**
 * Capability match result from index search
 */
export interface ICapabilityMatch {
  /** Agent key */
  readonly agentKey: string;

  /** Agent name */
  readonly name: string;

  /** Cosine similarity score (0-1) */
  readonly similarityScore: number;

  /** Keyword match score (0-1) */
  readonly keywordScore: number;

  /** Domain match indicator */
  readonly domainMatch: boolean;

  /** Combined score (weighted by cold start phase) */
  readonly combinedScore: number;

  /** Agent capability reference */
  readonly capability: IAgentCapability;
}

// ==================== Routing Decision ====================

/**
 * Factor contributing to routing decision
 * Per RULE-DAI-003-001: Every routing result must include explanation
 */
export interface IRoutingFactor {
  /** Factor name (e.g., "capability_match", "keyword_score", "history") */
  readonly name: string;

  /** Factor weight (0-1) */
  readonly weight: number;

  /** Factor score (0-1) */
  readonly score: number;

  /** Human-readable description */
  readonly description: string;
}

/**
 * Routing result with explanation
 * Per RULE-DAI-003-001, RULE-DAI-003-003, RULE-DAI-003-006
 */
export interface IRoutingResult {
  /** Selected agent key */
  readonly selectedAgent: string;

  /** Selected agent name */
  readonly selectedAgentName: string;

  /** Confidence score (0-1) */
  readonly confidence: number;

  /** Whether explicit agent preference was used */
  readonly usedPreference: boolean;

  /** Current cold start phase */
  readonly coldStartPhase: ColdStartPhase;

  /** Whether routing is in cold start mode (< 100 executions) */
  readonly isColdStart: boolean;

  /** Cold start indicator message if applicable */
  readonly coldStartIndicator?: string;

  /** Factors that contributed to the decision */
  readonly factors: readonly IRoutingFactor[];

  /** Human-readable explanation of decision */
  readonly explanation: string;

  /** Alternative agents with scores (up to 3) */
  readonly alternatives: readonly IRoutingAlternative[];

  /** Whether confirmation is required (confidence < 0.7) */
  readonly requiresConfirmation: boolean;

  /** Confirmation level based on confidence */
  readonly confirmationLevel: 'auto' | 'show' | 'confirm' | 'select';

  /** Routing timestamp */
  readonly routedAt: number;

  /** Routing duration in milliseconds */
  readonly routingTimeMs: number;

  /** Unique routing ID for tracking */
  readonly routingId: string;
}

/**
 * Alternative agent option
 */
export interface IRoutingAlternative {
  /** Agent key */
  readonly agentKey: string;

  /** Agent name */
  readonly name: string;

  /** Combined score (0-1) */
  readonly score: number;

  /** Brief reason why this is an alternative */
  readonly reason: string;
}

// ==================== Routing Feedback ====================

/**
 * Feedback for routing decisions
 * Per RULE-DAI-003-002, RULE-DAI-003-007
 */
export interface IRoutingFeedback {
  /** Routing ID this feedback is for */
  readonly routingId: string;

  /** Original task description */
  readonly task: string;

  /** Agent that was selected */
  readonly selectedAgent: string;

  /** Whether the task succeeded */
  readonly success: boolean;

  /** Execution time in milliseconds */
  readonly executionTimeMs: number;

  /** User override agent if user changed selection */
  readonly userOverrideAgent?: string;

  /** Error message if task failed */
  readonly errorMessage?: string;

  /** Error code if task failed */
  readonly errorCode?: string;

  /** Whether user abandoned the task */
  readonly userAbandoned: boolean;

  /** Partial stages completed (for pipeline) */
  readonly completedStages?: number;

  /** Total stages (for pipeline) */
  readonly totalStages?: number;

  /** User-provided quality rating (1-5) */
  readonly userRating?: number;

  /** Feedback timestamp */
  readonly feedbackAt: number;
}

// ==================== Failure Classification ====================

/**
 * Failure classification result
 * Per RULE-DAI-003-007: Failure attribution before learning
 */
export interface IFailureClassification {
  /** Classified failure type */
  readonly failureType: FailureType;

  /** Confidence in classification (0-1) */
  readonly classificationConfidence: number;

  /** Whether routing should be penalized */
  readonly penalizeRouting: boolean;

  /** Whether agent should be penalized */
  readonly penalizeAgent: boolean;

  /** Recommended action */
  readonly recommendedAction: 'retry_same_agent' | 'retry_different_agent' | 'escalate' | 'abandon';

  /** Classification reasoning */
  readonly reasoning: string;

  /** Evidence supporting classification */
  readonly evidence: readonly string[];
}

// ==================== Pipeline Generation ====================

/**
 * Generated pipeline stage
 * Per INT-004: Multi-step task → pipeline stages
 */
export interface IGeneratedStage {
  /** Stage index (0-based) */
  readonly index: number;

  /** Stage name derived from task segment */
  readonly name: string;

  /** Task segment for this stage */
  readonly taskSegment: string;

  /** Primary verb for this stage */
  readonly verb: string;

  /** Routed agent for this stage */
  readonly agentKey: string;

  /** Agent name */
  readonly agentName: string;

  /** Routing confidence for this stage */
  readonly confidence: number;

  /** Output domain for memory coordination */
  readonly outputDomain: string;

  /** Dependencies on previous stages (indices) */
  readonly dependsOn: readonly number[];

  /** Estimated duration in milliseconds */
  readonly estimatedDurationMs: number;
}

/**
 * Generated pipeline from natural language
 * Per INT-004, INT-008
 */
export interface IGeneratedPipeline {
  /** Original task description */
  readonly task: string;

  /** Generated pipeline ID */
  readonly pipelineId: string;

  /** Pipeline name derived from task */
  readonly name: string;

  /** Generated stages */
  readonly stages: readonly IGeneratedStage[];

  /** Total estimated duration in milliseconds */
  readonly estimatedDurationMs: number;

  /** Overall confidence (min of stage confidences) */
  readonly overallConfidence: number;

  /** Whether pipeline requires confirmation */
  readonly requiresConfirmation: boolean;

  /** Generation timestamp */
  readonly generatedAt: number;

  /** Generation duration in milliseconds */
  readonly generationTimeMs: number;
}

// ==================== Cold Start Configuration ====================

/**
 * Cold start configuration
 * Per RULE-DAI-003-006: Cold start mode must be explicit
 */
export interface IColdStartConfig {
  /** Threshold for keyword-only phase (default: 25) */
  readonly keywordOnlyThreshold: number;

  /** Threshold for blended phase end (default: 100) */
  readonly learnedThreshold: number;

  /** Maximum confidence during cold start (default: 0.6) */
  readonly maxColdStartConfidence: number;

  /** Keyword weight in keyword-only phase (default: 1.0) */
  readonly keywordOnlyWeight: number;

  /** Keyword weight in blended phase (default: 0.7) */
  readonly blendedKeywordWeight: number;

  /** Keyword weight in learned phase (default: 0.2) */
  readonly learnedKeywordWeight: number;
}

// ==================== Routing Configuration ====================

/**
 * Routing engine configuration
 */
export interface IRoutingConfig {
  /** Cold start configuration */
  readonly coldStart: IColdStartConfig;

  /** Confidence threshold for auto-execute (default: 0.9) */
  readonly autoExecuteThreshold: number;

  /** Confidence threshold for show decision (default: 0.7) */
  readonly showDecisionThreshold: number;

  /** Confidence threshold for require confirmation (default: 0.5) */
  readonly confirmationThreshold: number;

  /** Maximum alternatives to show (default: 3) */
  readonly maxAlternatives: number;

  /** Maximum pipeline stages (default: 10) */
  readonly maxPipelineStages: number;

  /** Estimated time per stage in milliseconds (default: 30000) */
  readonly estimatedTimePerStageMs: number;

  /** Performance target: routing latency P95 (default: 300) */
  readonly routingLatencyTargetMs: number;

  /** Performance target: analysis latency P95 (default: 150) */
  readonly analysisLatencyTargetMs: number;

  /** Performance target: pipeline generation latency P95 (default: 600) */
  readonly pipelineLatencyTargetMs: number;

  /** EWC++ regularization lambda (default: 0.1) */
  readonly ewcLambda: number;

  /** Maximum weight change per feedback (default: 0.05 = 5%) */
  readonly maxWeightChange: number;

  /** Accuracy window size for monitoring (default: 100) */
  readonly accuracyWindowSize: number;

  /** Accuracy degradation threshold for rollback (default: 0.02 = 2%) */
  readonly accuracyDegradationThreshold: number;

  /** Enable verbose logging (default: false) */
  readonly verbose: boolean;
}

// ==================== Default Configurations ====================

/**
 * Default cold start configuration
 */
export const DEFAULT_COLD_START_CONFIG: IColdStartConfig = {
  keywordOnlyThreshold: 25,
  learnedThreshold: 100,
  maxColdStartConfidence: 0.6,
  keywordOnlyWeight: 1.0,
  blendedKeywordWeight: 0.7,
  learnedKeywordWeight: 0.2,
};

/**
 * Default routing configuration
 */
export const DEFAULT_ROUTING_CONFIG: IRoutingConfig = {
  coldStart: DEFAULT_COLD_START_CONFIG,
  autoExecuteThreshold: 0.9,
  showDecisionThreshold: 0.7,
  confirmationThreshold: 0.5,
  maxAlternatives: 3,
  maxPipelineStages: 10,
  estimatedTimePerStageMs: 30000,
  routingLatencyTargetMs: 300,
  analysisLatencyTargetMs: 150,
  pipelineLatencyTargetMs: 600,
  ewcLambda: 0.1,
  maxWeightChange: 0.05,
  accuracyWindowSize: 100,
  accuracyDegradationThreshold: 0.02,
  verbose: false,
};

// ==================== Capability Index Interface ====================

/**
 * Capability index interface for search operations
 */
export interface ICapabilityIndex {
  /** Initialize the index with agents from registry */
  initialize(): Promise<void>;

  /** Rebuild the index from scratch */
  rebuild(): Promise<void>;

  /** Search for matching agents by embedding */
  search(embedding: Float32Array, limit: number): Promise<ICapabilityMatch[]>;

  /** Search for matching agents by domain */
  searchByDomain(domain: TaskDomain, limit: number): ICapabilityMatch[];

  /** Get last synchronization timestamp */
  getLastSyncTime(): number;

  /** Get total indexed agent count */
  getAgentCount(): number;
}

// ==================== Routing Engine Interface ====================

/**
 * Routing engine interface
 */
export interface IRoutingEngine {
  /** Route a task to an agent */
  route(analysis: ITaskAnalysis): Promise<IRoutingResult>;

  /** Get current execution count */
  getExecutionCount(): number;

  /** Get current cold start phase */
  getColdStartPhase(): ColdStartPhase;
}

// ==================== Pipeline Generator Interface ====================

/**
 * Pipeline generator interface
 */
export interface IPipelineGenerator {
  /** Generate a pipeline from natural language task */
  generate(task: string): Promise<IGeneratedPipeline>;
}

// ==================== Routing Learner Interface ====================

/**
 * Routing learner interface
 */
export interface IRoutingLearner {
  /** Process feedback and update weights */
  processFeedback(feedback: IRoutingFeedback): Promise<void>;

  /** Get current accuracy */
  getCurrentAccuracy(): number;

  /** Get rolling accuracy history */
  getAccuracyHistory(): readonly number[];
}

// ==================== Failure Classifier Interface ====================

/**
 * Failure classifier interface
 */
export interface IFailureClassifier {
  /** Classify a failure from feedback */
  classify(feedback: IRoutingFeedback): IFailureClassification;
}

// ==================== Task Analyzer Interface ====================

/**
 * Task analyzer interface
 */
export interface ITaskAnalyzer {
  /** Analyze a task description */
  analyze(task: string): Promise<ITaskAnalysis>;
}

// ==================== Confirmation Handler Interface ====================

/**
 * Confirmation request for low-confidence routing
 */
export interface IConfirmationRequest {
  /** Routing result that needs confirmation */
  readonly routingResult: IRoutingResult;

  /** Formatted message for user */
  readonly message: string;

  /** Options to present to user */
  readonly options: readonly IConfirmationOption[];

  /** Timeout in milliseconds (0 = no timeout) */
  readonly timeoutMs: number;

  /** Default option if timeout */
  readonly defaultOption: string;
}

/**
 * Confirmation option
 */
export interface IConfirmationOption {
  /** Option key (agent key or 'cancel') */
  readonly key: string;

  /** Display label */
  readonly label: string;

  /** Score if applicable */
  readonly score?: number;

  /** Whether this is the recommended option */
  readonly recommended: boolean;
}

/**
 * Confirmation response from user
 */
export interface IConfirmationResponse {
  /** Selected option key */
  readonly selectedKey: string;

  /** Whether selection was from timeout */
  readonly wasTimeout: boolean;

  /** Whether user cancelled */
  readonly wasCancelled: boolean;

  /** Response timestamp */
  readonly respondedAt: number;
}

/**
 * Confirmation handler interface
 */
export interface IConfirmationHandler {
  /** Request confirmation from user */
  requestConfirmation(routing: IRoutingResult): Promise<IConfirmationResponse>;
}
