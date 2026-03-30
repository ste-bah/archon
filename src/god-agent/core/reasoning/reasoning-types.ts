/**
 * ReasoningBank Type Definitions
 * TASK-RSN-001 - Milestone B
 *
 * Provides unified types for 4 reasoning modes:
 * - pattern-match: Template-based retrieval
 * - causal-inference: Graph-based reasoning
 * - contextual: GNN-enhanced embedding similarity
 * - hybrid: Weighted combination
 *
 * Integration with:
 * - PatternMatcher (TASK-PAT-001)
 * - CausalMemory (TASK-CAUSAL-001)
 * - VectorDB for contextual search
 */

// Import and re-export dependencies from existing modules
import type { PatternResult } from './pattern-types.js';
import type { NodeID } from './causal-types.js';

// Import TaskType as value (it's an enum, not just a type)
import { TaskType } from './pattern-types.js';

// Re-export for convenience
export { TaskType };
export type { PatternResult, NodeID };

/**
 * Reasoning mode enumeration
 *
 * Defines the four reasoning strategies supported by ReasoningBank:
 * - pattern-match: Fast template retrieval (<10ms)
 * - causal-inference: Graph traversal reasoning (<20ms)
 * - contextual: Embedding similarity with optional GNN enhancement (<30ms)
 * - hybrid: Weighted combination of all modes (<30ms without GNN, <100ms with GNN)
 */
export enum ReasoningMode {
  /** Template-based pattern retrieval using PatternMatcher */
  PATTERN_MATCH = 'pattern-match',

  /** Graph-based causal inference using CausalMemory */
  CAUSAL_INFERENCE = 'causal-inference',

  /** Embedding similarity search with optional GNN enhancement */
  CONTEXTUAL = 'contextual',

  /** Weighted combination of pattern, causal, and contextual modes */
  HYBRID = 'hybrid'
}

/**
 * Trajectory identifier for feedback tracking
 *
 * Format: "traj_{timestamp}_{uuid}"
 * Example: "traj_1702568400000_a3f2c8d1-4b5e-6f7a-8b9c-0d1e2f3a4b5c"
 */
export type TrajectoryID = string;

/**
 * Reasoning request parameters
 *
 * Defines the input for a reasoning operation, including query embedding,
 * reasoning mode, and optional parameters for filtering and enhancement.
 */
export interface IReasoningRequest {
  /** Query embedding vector (1536 dimensions, L2-normalized) */
  query: Float32Array;

  /** Optional context embeddings for multi-turn reasoning */
  context?: Float32Array[];

  /** Reasoning mode to use */
  type: ReasoningMode;

  /** Maximum number of results to return (default: 10) */
  maxResults?: number;

  /** Minimum confidence threshold [0, 1] (default: 0.7) */
  confidenceThreshold?: number;

  /** Minimum L-Score threshold [0, 1] (default: 0.5) */
  minLScore?: number;

  /** Apply GNN enhancement to transform 1536D → 1024D (default: false) */
  enhanceWithGNN?: boolean;

  /** Apply Sona learning weights (default: true) */
  applyLearning?: boolean;

  /** Optional task type filter for pattern-match mode */
  taskType?: TaskType;

  /** Optional metadata for tracking */
  metadata?: Record<string, unknown>;
}

/**
 * Pattern match result with L-Score provenance
 *
 * Extends PatternResult with additional provenance information
 */
export interface IPatternMatch {
  /** Pattern identifier */
  patternId: string;

  /** Confidence score [0, 1] = similarity × successRate × sonaWeight */
  confidence: number;

  /** Template text describing the reasoning approach */
  template: string;

  /** Task category */
  taskType: TaskType;

  /** L-Score for provenance tracking [0, 1] */
  lScore: number;

  /** Original similarity score [0, 1] */
  similarity?: number;

  /** Pattern success rate [0, 1] */
  successRate?: number;

  /** Sona weight [0, 1] */
  sonaWeight?: number;
}

/**
 * Causal inference result with L-Score provenance
 *
 * Extends causal inference with additional scoring information
 */
export interface IInferenceResult {
  /** Effect node identifier */
  nodeId: NodeID;

  /** Probability of this effect [0, 1] */
  probability: number;

  /** Confidence in the inference [0, 1] */
  confidence: number;

  /** Causal chain leading to this effect (node IDs) */
  chain: string[];

  /** L-Score for provenance tracking [0, 1] */
  lScore: number;

  /** Number of hops in the causal chain */
  hopCount?: number;

  /** Human-readable explanation */
  explanation?: string;
}

/**
 * Provenance information for reasoning results
 *
 * Tracks the sources and confidence of reasoning outputs using L-Scores
 */
export interface IProvenanceInfo {
  /** L-Scores for each result component */
  lScores: number[];

  /** Total number of sources used */
  totalSources: number;

  /** Combined L-Score [0, 1] = geometric mean of component L-Scores */
  combinedLScore: number;

  /** Source breakdown by type */
  sourceBreakdown?: {
    patterns?: number;
    causal?: number;
    contextual?: number;
  };

  /** Additional provenance metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Reasoning response
 *
 * Comprehensive result from a reasoning operation, including results from
 * multiple modes, provenance information, and optional GNN enhancement.
 */
export interface IReasoningResponse {
  /** Original query embedding */
  query: Float32Array;

  /** Reasoning mode used */
  type: ReasoningMode;

  /** Pattern matching results (if applicable) */
  patterns: IPatternMatch[];

  /** Causal inference results (if applicable) */
  causalInferences: IInferenceResult[];

  /** GNN-enhanced embedding (1024 dimensions) if enhanceWithGNN was true */
  enhancedEmbedding?: Float32Array;

  /** Trajectory ID for feedback tracking */
  trajectoryId: TrajectoryID;

  /** Attention weights from GNN layers (if GNN was applied) */
  attentionWeights?: Float32Array[];

  /** Overall confidence in the reasoning result [0, 1] */
  confidence: number;

  /** Processing time in milliseconds */
  processingTimeMs: number;

  /** Provenance information with L-Scores */
  provenanceInfo: IProvenanceInfo;

  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Learning feedback for trajectory improvement
 *
 * Allows Sona to provide quality ratings for reasoning trajectories,
 * enabling adaptive learning and route optimization.
 */
export interface ILearningFeedback {
  /** Trajectory ID being rated */
  trajectoryId: TrajectoryID;

  /** Verdict on the reasoning result */
  verdict: 'correct' | 'incorrect' | 'neutral';

  /** Optional reasoning about the verdict */
  reasoning?: string;

  /** Learning strength factor [0, 1] (default: 0.1) */
  strength?: number;

  /** Quality rating [0, 1] */
  quality?: number;

  /** Was the result helpful? */
  helpful?: boolean;

  /** Reasoning route quality breakdown */
  route?: {
    /** Pattern match quality [0, 1] */
    patternQuality?: number;

    /** Causal inference quality [0, 1] */
    causalQuality?: number;

    /** Contextual search quality [0, 1] */
    contextualQuality?: number;
  };

  /** Optional context IDs for multi-turn learning */
  contextIds?: string[];

  /** User-provided feedback text */
  feedback?: string;

  /** User-provided feedback text (alias for feedback) */
  userFeedback?: string;

  /** Outcome of the reasoning operation */
  outcome?: string;

  /** Timestamp of feedback */
  timestamp?: number;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Trajectory record for feedback tracking
 *
 * Stores complete reasoning trajectory for later analysis and learning.
 * Used by TrajectoryTracker to enable Sona feedback integration.
 */
export interface TrajectoryRecord {
  /** Unique trajectory identifier */
  id: TrajectoryID;

  /** Timestamp of trajectory creation */
  timestamp: number;

  /** Original reasoning request */
  request: IReasoningRequest;

  /** Reasoning response generated */
  response: IReasoningResponse;

  /** Original query embedding (1536D) */
  embedding: Float32Array;

  /** GNN-enhanced embedding (1024D) if available */
  enhancedEmbedding?: Float32Array;

  /** L-Score for this trajectory [0, 1] */
  lScore?: number;

  /** Verdict from learning feedback */
  verdict?: 'correct' | 'incorrect' | 'neutral';

  /** Reasoning for the verdict */
  verdictReasoning?: string;

  /** Feedback received for this trajectory */
  feedback?: ILearningFeedback;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * GNN (Graph Neural Network) configuration
 *
 * Configuration for the GNN enhancement module that transforms
 * 1536D embeddings to 1024D enhanced representations.
 */
export interface GNNConfig {
  /** Input embedding dimension (fixed: 1536) */
  inputDim: number;

  /** Output embedding dimension (fixed: 1024) */
  outputDim: number;

  /** Number of GNN layers (default: 3) */
  numLayers: number;

  /** Number of attention heads per layer (default: 8) */
  attentionHeads: number;

  /** Dropout rate [0, 1] (default: 0.1) */
  dropout: number;

  /** Maximum number of nodes in attention graph (default: 10) */
  maxNodes: number;

  /** Enable residual connections (default: true) */
  useResidual?: boolean;

  /** Enable layer normalization (default: true) */
  useLayerNorm?: boolean;

  /** Activation function (default: 'relu') */
  activation?: 'relu' | 'gelu' | 'tanh' | 'sigmoid';
}

/**
 * ReasoningBank configuration
 *
 * Top-level configuration for the ReasoningBank system, including
 * GNN settings and mode weights for hybrid reasoning.
 */
export interface ReasoningBankConfig {
  /** Enable GNN enhancement (default: true) */
  enableGNN: boolean;

  /** Default maximum results (default: 10) */
  defaultMaxResults: number;

  /** Default confidence threshold [0, 1] (default: 0.7) */
  defaultConfidenceThreshold: number;

  /** Minimum L-Score threshold [0, 1] (default: 0.5) */
  defaultMinLScore: number;

  /** Weight for pattern-match mode in hybrid [0, 1] (default: 0.3) */
  patternWeight: number;

  /** Weight for causal-inference mode in hybrid [0, 1] (default: 0.3) */
  causalWeight: number;

  /** Weight for contextual mode in hybrid [0, 1] (default: 0.4) */
  contextualWeight: number;

  /** Enable trajectory tracking (default: true) */
  enableTrajectoryTracking: boolean;

  /** Enable automatic mode selection (default: true) */
  enableAutoModeSelection: boolean;

  /** Maximum trajectories to store (default: 1000) */
  maxTrajectories?: number;

  /** Additional configuration options */
  [key: string]: unknown;
}

/**
 * Scores for each reasoning mode (used by ModeSelector)
 */
export interface ModeScores {
  patternMatch: number;
  causalInference: number;
  contextual: number;
}

/**
 * Mode selection result
 *
 * Result from automatic reasoning mode selection based on query characteristics.
 */
export interface ModeSelectionResult {
  /** Selected reasoning mode */
  mode: ReasoningMode;

  /** Confidence in the selection [0, 1] */
  confidence: number;

  /** Scores for each mode */
  scores: ModeScores;

  /** Reasoning for the selection */
  reasoning: string;

  /** Alternative modes considered */
  alternatives?: Array<{
    mode: ReasoningMode;
    score: number;
  }>;
}

/**
 * Performance metrics for reasoning operations
 *
 * Tracks performance across different reasoning modes for monitoring and optimization.
 */
export interface ReasoningMetrics {
  /** Total number of reasoning requests processed */
  totalRequests: number;

  /** Requests by reasoning mode */
  requestsByMode: Map<ReasoningMode, number>;

  /** Average processing time by mode (milliseconds) */
  avgProcessingTime: Map<ReasoningMode, number>;

  /** Average confidence by mode */
  avgConfidence: Map<ReasoningMode, number>;

  /** Average L-Score by mode */
  avgLScore: Map<ReasoningMode, number>;

  /** Number of GNN enhancements performed */
  gnnEnhancementCount: number;

  /** Number of trajectories with feedback */
  trajectoriesWithFeedback: number;

  /** Cache hit rate [0, 1] */
  cacheHitRate?: number;

  /** Error count */
  errorCount?: number;
}

/**
 * Validation result for reasoning inputs/outputs
 *
 * Used to validate embeddings, confidence scores, and L-Scores.
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;

  /** Validation errors (if any) */
  errors: string[];

  /** Validation warnings (if any) */
  warnings: string[];
}

/**
 * Contextual match from vector search
 *
 * Used for contextual reasoning mode results.
 */
export interface IContextualMatch {
  /** Match ID from vector database */
  id: string;

  /** Similarity score [0, 1] */
  similarity: number;

  /** Optional content or metadata */
  content?: string;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * GNN enhancement result
 *
 * Result from GNN enhancement operation.
 */
export interface IGNNEnhancementResult {
  /** Enhanced embedding (1024 dimensions) */
  enhanced: Float32Array;

  /** Original embedding (1536 dimensions) */
  original?: Float32Array;

  /** Enhancement time in milliseconds */
  enhancementTime?: number;

  /** Processing time in milliseconds (alias for enhancementTime) */
  processingTimeMs?: number;

  /** Whether result was cached */
  cached?: boolean;

  /** Number of nodes processed */
  nodeCount?: number;

  /** Number of edges processed */
  edgeCount?: number;
}

// Type aliases for backward compatibility with existing code
export type IModeSelectionResult = ModeSelectionResult;
export type IReasoningBankConfig = ReasoningBankConfig;
export type ITrajectoryRecord = TrajectoryRecord;
export type IReasoningMetrics = ReasoningMetrics;
