/**
 * God Agent Reasoning Module
 *
 * Implements:
 * - TASK-PAT-001 (Pattern Matching System)
 * - TASK-CAUSAL-001 (CausalMemory System)
 * - TASK-RSN-001 (ReasoningBank Unified API)
 *
 * Provides:
 * - Template-based retrieval of successful reasoning patterns
 * - Hypergraph-based causal reasoning with multi-cause support
 * - Unified reasoning interface with 4 modes (pattern-match, causal-inference, contextual, hybrid)
 * - GNN-enhanced embeddings (1536D → 1024D)
 * - Trajectory tracking for Sona feedback
 *
 * Performance targets:
 * - Pattern retrieval: <5ms for k=100
 * - Confidence scoring: <1ms per pattern
 * - Cycle detection: <5ms per check
 * - 5-hop traversal: <15ms
 * - Link addition: <2ms
 * - Pattern-match mode: <10ms
 * - Causal-inference mode: <20ms
 * - Contextual mode: <30ms
 * - GNN enhancement: <100ms for 50 nodes
 */

// ===== PATTERN MATCHING SYSTEM =====

// Main PatternMatcher class
export { PatternMatcher } from './pattern-matcher.js';

// Pattern storage
export { PatternStore } from './pattern-store.js';

// Confidence scoring utilities
export {
  calculateConfidence,
  calibrateConfidence,
  rankPatterns,
  filterPatterns,
  batchCalculateConfidence,
  createPatternResult
} from './confidence-scorer.js';

// Pattern enum (value export)
export { TaskType } from './pattern-types.js';

// Pattern type definitions (type-only exports for ESM compatibility)
export type {
  Pattern,
  PatternQuery,
  PatternResult,
  PatternStats,
  CreatePatternParams,
  UpdateSuccessParams,
  PruneParams,
  PruneResult
} from './pattern-types.js';

// ===== CAUSAL MEMORY SYSTEM =====

// Main CausalMemory class
export { CausalMemory } from './causal-memory.js';
export type { CausalMemoryConfig } from './causal-memory.js';

// Core components
export { CausalHypergraph } from './causal-hypergraph.js';
export { CausalTraversal } from './causal-traversal.js';
export { CycleDetector } from './cycle-detector.js';

// Causal type definitions
export type {
  NodeID,
  NodeType,
  TraversalDirection,
  CausalNode,
  CausalLink,
  CausalChain,
  TraversalOptions,
  InferenceResult,
  CauseFindingResult,
  AddCausalLinkParams,
  CausalGraphStats,
  SerializedCausalGraph,
  CycleCheckResult,
} from './causal-types.js';

// ===== REASONING BANK UNIFIED API (TASK-RSN-001) =====

// Main ReasoningBank class
export { ReasoningBank } from './reasoning-bank.js';

// GNN Enhancement
export { GNNEnhancer } from './gnn-enhancer.js';
export type {
  TrajectoryGraph,
  TrajectoryNode,
  TrajectoryEdge,
  LayerActivationCache,
  ForwardResult,
} from './gnn-enhancer.js';

// Weight Management (TASK-GNN-001, TASK-GNN-003)
export { WeightManager } from './weight-manager.js';
export type {
  IWeightConfig,
  IWeightMetadata,
  ICheckpointConfig,
  IWeightValidationResult,
} from './weight-manager.js';

// Graph Attention Functions (TASK-GNN-002)
export {
  softmax,
  attentionScore,
  weightedAggregate,
  computeNeighborAttention,
} from './gnn-math.js';

// GNN Backpropagation Functions (TASK-GNN-001)
export {
  project_backward,
  softmax_backward,
  attention_backward,
  aggregate_backward,
  relu_backward,
  leaky_relu_backward,
  tanh_backward,
  sigmoid_backward,
  activation_backward,
  layer_backward,
  clipGradient,
  isGradientValid,
  accumulateGradient,
  accumulateWeightGradients,
  createWeightGradientAccumulator,
} from './gnn-backprop.js';

export type {
  GradientResult,
  AttentionGradients,
  GradientConfig,
} from './gnn-backprop.js';

// Adam Optimizer (TASK-GNN-006)
export {
  AdamOptimizer,
  createAdamOptimizer,
  flattenWeights,
  unflattenWeights,
  applyAdamTo2DWeights,
} from './adam-optimizer.js';

export type {
  AdamConfig,
  AdamState,
  StepResult,
} from './adam-optimizer.js';

// Trajectory Tracking
export { TrajectoryTracker } from './trajectory-tracker.js';
export type { TrajectoryTrackerConfig, TrajectoryStats } from './trajectory-tracker.js';

// Mode Selection
export { ModeSelector } from './mode-selector.js';
export type { ModeSelectorConfig } from './mode-selector.js';

// ReasoningBank type definitions
export {
  ReasoningMode
} from './reasoning-types.js';

export type {
  IReasoningRequest,
  IReasoningResponse,
  IPatternMatch,
  IInferenceResult,
  IProvenanceInfo,
  ILearningFeedback,
  TrajectoryRecord,
  TrajectoryID,
  GNNConfig,
  ReasoningBankConfig,
  ModeScores,
  ModeSelectionResult,
  ReasoningMetrics,
  ValidationResult,
  IContextualMatch,
  IGNNEnhancementResult
} from './reasoning-types.js';

// ===== PROVENANCE STORE (TASK-PRV-001) =====

// Main ProvenanceStore class
export { ProvenanceStore } from './provenance-store.js';
export type { ProvenanceStoreConfig } from './provenance-store.js';

// Provenance utilities
export {
  generateSourceID,
  generateProvenanceID,
  isValidSourceID,
  isValidProvenanceID,
  validateSourceInput,
  validateProvenanceInput,
  validateDerivationStep,
  geometricMean,
  arithmeticMean,
  depthFactor,
  calculateLScore,
  getThresholdForDomain,
  validateLScore,
  validateEmbedding,
  DEFAULT_LSCORE_THRESHOLD,
  DOMAIN_THRESHOLDS
} from './provenance-utils.js';

// Provenance type definitions
export {
  LScoreRejectionError,
  ProvenanceValidationError
} from './provenance-types.js';

export type {
  SourceID,
  ProvenanceID,
  OperationType,
  SourceType,
  ISourceLocation,
  ISourceInput,
  ISource,
  IDerivationStep,
  IProvenanceInput,
  IProvenance,
  ISourceReference,
  ICitationPath,
  ITraversalOptions,
  ILScoreThreshold,
  ILScoreResult,
  ISerializedSource,
  ISerializedProvenance
} from './provenance-types.js';

// ===== SHADOW VECTOR SEARCH (TASK-SHA-001) =====

// Main ShadowVectorSearch class
export { ShadowVectorSearch, MockVectorStore } from './shadow-vector-search.js';
export type { IVectorStore, IVectorSearchResult } from './shadow-vector-search.js';

// Shadow vector utilities
export {
  createShadowVector,
  cosineSimilarity,
  isL2Normalized,
  normalizeL2,
  classifyDocument,
  determineEvidenceType,
  calculateCredibility,
  determineVerdict,
  calculateVerdictConfidence,
  calculateRefutationStrength,
  sortByRefutationStrength,
  filterByThreshold,
} from './shadow-utils.js';

// Shadow vector type definitions
export {
  ShadowVectorError,
  DEFAULT_CLASSIFICATION_THRESHOLDS,
  DEFAULT_SHADOW_CONFIG,
} from './shadow-types.js';

export type {
  DocumentID,
  ShadowSearchType,
  ValidationVerdict,
  EvidenceType,
  IShadowSearchOptions,
  IShadowFilters,
  IContradiction,
  ISupportingEvidence,
  IValidationReport,
  IShadowVectorConfig,
  IShadowSearchResult,
  IClassificationThresholds,
} from './shadow-types.js';

// ===== CONTRASTIVE LOSS (TASK-GNN-007) =====

// Contrastive Loss class and utilities
export {
  ContrastiveLoss,
  mineHardNegatives,
  mineHardPositives,
  createSemiHardTriplets,
  POSITIVE_QUALITY_THRESHOLD,
  NEGATIVE_QUALITY_THRESHOLD,
  DEFAULT_MARGIN,
} from './contrastive-loss.js';

// Contrastive Loss type definitions
export type {
  ContrastiveLossConfig,
  TrajectoryPair,
  TripletGradient,
  GradientBatch,
  ITrajectoryWithFeedback,
} from './contrastive-loss.js';

// ===== TRAINING HISTORY (TASK-GNN-004) =====

// Main TrainingHistoryManager class
export { TrainingHistoryManager } from './training-history.js';
export type { TrainingRecord, ITrainingStats } from './training-history.js';

// ===== GNN TRAINER (TASK-GNN-005) =====

// Main GNNTrainer class
export { GNNTrainer, createGNNTrainer } from './gnn-trainer.js';
export type {
  TrainingConfig,
  TrainingResult,
  EpochResult,
  ValidationResult as GNNValidationResult,
  TrainingDataset,
  TrainerCheckpoint,
} from './gnn-trainer.js';

// ===== TRAINING TRIGGER (TASK-GNN-009) =====

// Main TrainingTriggerController class
export { TrainingTriggerController, createTrainingTriggerController } from './training-trigger.js';
export type {
  TriggerConfig,
  TriggerStats,
  TriggerResult,
} from './training-trigger.js';

// ===== EWC REGULARIZATION (TASK-GNN-008) =====

// Main EWCRegularizer class
export { EWCRegularizer, createEWCRegularizer } from './ewc-utils.js';

// EWC utility functions
export {
  computeImportanceScores,
  getTopImportantParams,
  computeFisherOverlap,
} from './ewc-utils.js';

// EWC type definitions
export type {
  EWCConfig,
  EWCPenaltyResult,
  EWCGradientResult,
  FisherUpdateResult,
} from './ewc-utils.js';

// ===== BACKGROUND TRAINER (TASK-GNN-010) =====

// Main BackgroundTrainer class
export { BackgroundTrainer, createBackgroundTrainer } from './background-trainer.js';

// Background trainer type definitions
export type {
  BackgroundTrainerConfig,
  TrainingProgress,
  TrainingPhase,
  BackgroundTrainingResult,
  BackgroundTrainerEvents,
  WorkerMessage,
} from './background-trainer.js';

// Training Worker (for Worker Thread implementation)
export { TrainingWorker } from './training-worker.js';
