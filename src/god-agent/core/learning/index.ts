/**
 * God Agent Learning Module
 * TASK-SON-001 - Sona Engine (Trajectory-Based Learning)
 * TASK-SON-002 - LoRA Weight Updates and Persistence
 *
 * Provides:
 * - Trajectory tracking for reasoning paths
 * - Weight management for pattern adaptation
 * - Route-based weight organization
 * - Learning metrics and drift detection
 * - EWC++ regularized weight updates
 * - Binary weight persistence
 *
 * Performance targets:
 * - createTrajectory(): <1ms
 * - getWeight(): <1ms
 * - getWeights(): <5ms
 * - provideFeedback(): <15ms
 */

// ===== SONA ENGINE =====

// Main SonaEngine class
export { SonaEngine, createProductionSonaEngine } from './sona-engine.js';

// ===== TYPES =====

// Error types
export {
  TrajectoryValidationError,
  WeightUpdateError,
  DriftExceededError,
  FeedbackValidationError,
  WeightPersistenceError,
  // TASK-SON-003 errors
  RollbackLoopError,
  CheckpointError,
} from './sona-types.js';

// Type definitions
export type {
  TrajectoryID,
  PatternID,
  Route,
  Weight,
  RouteWeights,
  WeightStorage,
  ITrajectory,
  ITrajectoryInput,
  IWeightUpdateParams,
  ILearningMetrics,
  DriftStatus,
  IDriftMetrics,
  ICheckpoint,
  ISonaConfig,
  ISonaConfig as SonaEngineConfig, // Alias for compatibility
  ISerializedTrajectory,
  ISerializedRouteWeights,
  ISerializedSonaState,
  // TASK-SON-002 types
  FisherInformationStorage,
  IFeedbackInput,
  IWeightUpdateResult,
  IWeightFileMetadata,
  ISerializedFisherEntry,
  // TASK-SON-003 types
  CheckpointReason,
  ICheckpointFull,
  ISerializedCheckpoint,
  // SPEC-SON-001 types
  IReasoningStep,
  ReasoningStepAction,
  IStepCaptureConfig,
  // RULE-031 interface for dependency injection
  ISonaEngine,
} from './sona-types.js';

// ===== STEP CAPTURE SERVICE (SPEC-SON-001) =====

export { StepCaptureService, getGlobalStepCapture, resetGlobalStepCapture } from './step-capture-service.js';
export type { TrajectoryID as StepCaptureTrajectoryID } from './step-capture-service.js';

// ===== UTILITIES =====

export {
  // ID generation
  generateTrajectoryID,
  isValidTrajectoryID,
  generateCheckpointID,
  isValidCheckpointID,

  // Validation
  validateRoute,
  validateTrajectoryInput,
  validateQuality,
  validateLearningRate,
  validateRegularization,
  validateAndApplyConfig,
  validateFeedbackQuality,

  // Weight operations
  clampWeight,
  isValidWeight,
  cosineSimilarity,
  calculateDrift,

  // Statistics
  arithmeticMean,
  standardDeviation,

  // Weight update formula components
  calculateReward,
  calculateGradient,
  calculateWeightUpdate,
  updateFisherInformation,
  calculateSuccessRate,

  // Binary serialization
  crc32,

  // Constants
  DEFAULT_LEARNING_RATE,
  DEFAULT_REGULARIZATION,
  DEFAULT_DRIFT_ALERT_THRESHOLD,
  DEFAULT_DRIFT_REJECT_THRESHOLD,
  DEFAULT_AUTO_SAVE_INTERVAL,
  DEFAULT_MAX_CHECKPOINTS,
  DEFAULT_INITIAL_WEIGHT,
  WEIGHT_MIN,
  WEIGHT_MAX,
  // TASK-SON-002 constants
  DEFAULT_FISHER_INFORMATION,
  FISHER_DECAY_RATE,
  AUTO_SAVE_THROTTLE_MS,
  AUTO_PATTERN_QUALITY_THRESHOLD,
  WEIGHT_FILE_VERSION,
} from './sona-utils.js';
