/**
 * DAI-003: Intelligent Task Routing Module
 *
 * Provides:
 * - Task analysis and domain detection
 * - Agent capability indexing and matching
 * - Explainable routing decisions
 * - Multi-step pipeline generation
 * - Cold start handling
 * - EWC++ learning from feedback
 * - Failure classification
 * - Low-confidence confirmation flow
 *
 * Constitution: RULE-DAI-003-001 through RULE-DAI-003-007
 *
 * @module src/god-agent/core/routing
 */

// ===== TYPE DEFINITIONS (TASK-001) =====

export {
  // Core domain types
  type TaskDomain,
  type TaskComplexity,
  type ColdStartPhase,
  type FailureType,
  // Task analysis
  type ITaskAnalysis,
  // Agent capability
  type IAgentCapability,
  type ICapabilityMatch,
  // Routing decision
  type IRoutingFactor,
  type IRoutingResult,
  type IRoutingAlternative,
  // Routing feedback
  type IRoutingFeedback,
  // Failure classification
  type IFailureClassification,
  // Pipeline generation
  type IGeneratedStage,
  type IGeneratedPipeline,
  // Configuration
  type IColdStartConfig,
  type IRoutingConfig,
  // Interface definitions
  type ICapabilityIndex,
  type IRoutingEngine,
  type IPipelineGenerator,
  type IRoutingLearner,
  type IFailureClassifier,
  type ITaskAnalyzer,
  // Confirmation types
  type IConfirmationRequest,
  type IConfirmationOption,
  type IConfirmationResponse,
  type IConfirmationHandler,
  // Default configurations
  DEFAULT_COLD_START_CONFIG,
  DEFAULT_ROUTING_CONFIG,
} from './routing-types.js';

// ===== UTILITIES (to be kept from routing-utils.js) =====

export {
  cosineSimilarity,
  normalizeL2,
  softmax,
  relu,
  sigmoid,
  tanh,
  matVecMul,
  addBias,
  reluVector,
  calculateConfidence,
  calculateUncertainty,
  calculateScore,
  rankByScore,
  topK,
  isWithinWindow,
  timeUntilExpiry,
  xavierInit,
  zeroInit,
  initFromEmbeddings,
} from './routing-utils.js';

// ===== COMPONENTS =====

// TASK-002: Routing Errors ✓
export {
  RoutingError,
  TaskAnalysisError,
  CapabilityIndexError,
  IndexSyncError,
  PipelineGenerationError,
  ConfirmationTimeoutError,
} from './routing-errors.js';

// TASK-003: Cold Start Configuration ✓
export {
  getColdStartPhase,
  getColdStartWeights,
  formatColdStartIndicator,
  defaultColdStartConfig,
} from './cold-start-config.js';

// TASK-004: Task Analyzer ✓
export { TaskAnalyzer, type ITaskAnalyzerConfig } from './task-analyzer.js';

// TASK-005: Capability Index ✓
export { CapabilityIndex, type ICapabilityIndexConfig } from './capability-index.js';

// TASK-006: Failure Classifier ✓
export { FailureClassifier } from './failure-classifier.js';

// TASK-007: Routing Engine ✓
export { RoutingEngine, type IRoutingEngineConfig } from './routing-engine.js';

// TASK-008: Pipeline Generator ✓
export { PipelineGenerator, type IPipelineGeneratorConfig } from './pipeline-generator.js';

// TASK-009: Routing Learner ✓
export { RoutingLearner, type IRoutingLearnerConfig } from './routing-learner.js';

// TASK-010: Confirmation Handler ✓
export { ConfirmationHandler, type IConfirmationHandlerConfig } from './confirmation-handler.js';
