/**
 * Sona Engine Types
 * TASK-SON-001 - Trajectory-Based Learning Type Definitions
 *
 * Defines types for trajectory tracking, weight management,
 * and learning metrics in the Sona Engine.
 */

// ==================== ID Types ====================

/** Trajectory identifier (format: "traj-{timestamp}-{random}") */
export type TrajectoryID = string;

/** Pattern identifier from PatternMatcher */
export type PatternID = string;

/** Route/task type (e.g., "reasoning.causal", "coding.debug") */
export type Route = string;

// ==================== Trajectory Interfaces ====================

/**
 * Trajectory record - tracks a reasoning path through the system
 */
export interface ITrajectory {
  /** Unique trajectory identifier */
  id: TrajectoryID;
  /** Task type/route (e.g., "reasoning.causal") */
  route: Route;
  /** Pattern IDs used in this trajectory */
  patterns: PatternID[];
  /** Context IDs that influenced the outcome */
  context: string[];
  /** Creation timestamp (ms since epoch) */
  createdAt: number;
  /** Quality score (0-1), set when feedback provided */
  quality?: number;
  /** Calculated reward for weight update */
  reward?: number;
  /** Reasoning steps captured during trajectory execution (SPEC-SON-001) */
  steps?: IReasoningStep[];
}

/**
 * Input for creating a trajectory
 */
export interface ITrajectoryInput {
  /** Task type/route */
  route: Route;
  /** Pattern IDs used */
  patterns: PatternID[];
  /** Context IDs */
  context: string[];
  /** Optional reasoning steps (SPEC-SON-001) */
  steps?: IReasoningStep[];
}

// ==================== Weight Types ====================

/**
 * Weight value for a pattern in a route
 * Range: [-1.0, 1.0]
 */
export type Weight = number;

/**
 * Route-specific weight map
 * Maps PatternID -> Weight
 */
export type RouteWeights = Map<PatternID, Weight>;

/**
 * Global weight storage
 * Maps Route -> RouteWeights
 */
export type WeightStorage = Map<Route, RouteWeights>;

/**
 * Weight update parameters (for TASK-SON-002)
 */
export interface IWeightUpdateParams {
  /** Pattern being updated */
  patternId: PatternID;
  /** Trajectory quality (0-1) */
  quality: number;
  /** Provenance L-Score */
  lScore: number;
  /** Historical success rate for this pattern */
  trajectorySuccessRate: number;
  /** Pattern match similarity */
  similarity: number;
  /** Fisher Information (importance) */
  importance: number;
  /** Learning rate (default 0.01) */
  learningRate: number;
  /** EWC++ regularization strength (default 0.1) */
  regularization: number;
}

// ==================== Learning Metrics ====================

/**
 * Learning metrics for monitoring
 */
export interface ILearningMetrics {
  /** Total trajectories created */
  totalTrajectories: number;
  /** Trajectories per route */
  trajectoriesByRoute: Record<Route, number>;
  /** Average quality per route */
  averageQualityByRoute: Record<Route, number>;
  /** Improvement percentage per route (baseline vs current) */
  improvementPercentage: Record<Route, number>;
  /** Patterns auto-created from high-quality trajectories */
  patternsCreated: number;
  /** Patterns pruned due to low performance */
  patternsPruned: number;
  /** Current drift score */
  currentDrift: number;
  /** Checkpoints created */
  checkpointsCreated: number;
  /** Rollbacks triggered */
  rollbacksTriggered: number;
  /** Last update timestamp */
  lastUpdated: number;
}

// ==================== Drift Detection ====================

/** Drift status levels */
export type DriftStatus = 'NORMAL' | 'ALERT' | 'REJECT';

/**
 * Drift detection metrics
 */
export interface IDriftMetrics {
  /** Current weight vector (for comparison) */
  currentWeights: Float32Array;
  /** Baseline centroid weights */
  baselineWeights: Float32Array;
  /** Drift score (cosine distance, 0-1) */
  drift: number;
  /** Alert threshold (default 0.3) */
  alertThreshold: number;
  /** Reject threshold (default 0.5) */
  rejectThreshold: number;
  /** Measurement timestamp */
  timestamp: number;
  /** Most recent checkpoint ID */
  checkpointId?: string;
  /** Current status */
  status: DriftStatus;
}

// ==================== Checkpoint Types ====================

/**
 * Weight checkpoint for rollback
 */
export interface ICheckpoint {
  /** Unique checkpoint ID */
  id: string;
  /** Snapshot of weights at checkpoint time */
  weights: WeightStorage;
  /** Checkpoint timestamp */
  timestamp: number;
  /** Drift score at checkpoint */
  drift: number;
  /** Checkpoint metadata */
  metadata: {
    /** Trajectories processed before checkpoint */
    trajectoriesProcessed: number;
    /** Average quality at checkpoint */
    averageQuality: number;
    /** Reason for checkpoint */
    reason?: 'manual' | 'auto' | 'pre-update';
  };
}

// ==================== Configuration ====================

/**
 * Sona Engine configuration
 */
export interface ISonaConfig {
  /** Learning rate (0.001 - 0.1, default 0.01) */
  learningRate?: number;
  /** EWC++ regularization strength (0.01 - 1.0, default 0.1) */
  regularization?: number;
  /** Drift alert threshold (default 0.3) */
  driftAlertThreshold?: number;
  /** Drift reject threshold (default 0.5) */
  driftRejectThreshold?: number;
  /** Auto-save interval in ms (default 100) */
  autoSaveInterval?: number;
  /** Enable performance tracking */
  trackPerformance?: boolean;
  /** Maximum checkpoints to keep */
  maxCheckpoints?: number;
  /** Directory for checkpoint storage (default: .agentdb/universal/checkpoints) */
  checkpointsDir?: string;
  /**
   * Database connection for SQLite persistence (TASK-PERSIST-004)
   *
   * RULE-008: ALL learning data MUST be stored in SQLite
   * RULE-074: Map as primary storage is FORBIDDEN
   *
   * When provided, SonaEngine will persist all trajectories, feedback, and patterns
   * to SQLite via the corresponding DAOs.
   *
   * Use createProductionSonaEngine() factory to enforce this in production.
   */
  databaseConnection?: import('../database/connection.js').IDatabaseConnection;
}

// ==================== Error Types ====================

/**
 * Error thrown when trajectory validation fails
 */
export class TrajectoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrajectoryValidationError';
  }
}

/**
 * Error thrown when weight update fails
 */
export class WeightUpdateError extends Error {
  constructor(
    public readonly patternId: PatternID,
    message: string
  ) {
    super(`Weight update failed for pattern ${patternId}: ${message}`);
    this.name = 'WeightUpdateError';
  }
}

/**
 * Error thrown when drift exceeds threshold
 */
export class DriftExceededError extends Error {
  constructor(
    public readonly drift: number,
    public readonly threshold: number
  ) {
    super(`Drift ${drift.toFixed(3)} exceeds threshold ${threshold}`);
    this.name = 'DriftExceededError';
  }
}

// ==================== Serialization ====================

/**
 * Serialized trajectory for persistence
 */
export interface ISerializedTrajectory {
  id: TrajectoryID;
  route: Route;
  patterns: PatternID[];
  context: string[];
  createdAt: number;
  quality?: number;
  reward?: number;
}

/**
 * Serialized weight entry
 */
export interface ISerializedWeightEntry {
  patternId: PatternID;
  weight: Weight;
}

/**
 * Serialized route weights
 */
export interface ISerializedRouteWeights {
  route: Route;
  weights: ISerializedWeightEntry[];
}

/**
 * Serialized Sona state for persistence
 */
export interface ISerializedSonaState {
  version: string;
  trajectories: ISerializedTrajectory[];
  weights: ISerializedRouteWeights[];
  checksum?: string;
  timestamp: number;
}

// ==================== Weight Update Types (TASK-SON-002) ====================

/**
 * Fisher Information storage for EWC++ regularization
 * Maps Route -> (PatternID -> importance)
 */
export type FisherInformationStorage = Map<Route, Map<PatternID, number>>;

/**
 * RLM (Relay Race Memory) context for learning feedback.
 * Tracks context injection success and source agent metadata.
 *
 * This interface captures relay-race memory handoff metadata to enable
 * learning from inter-agent context propagation patterns.
 */
export interface IRlmContext {
  /** Whether RLM injection was successful */
  injectionSuccess: boolean;
  /** Source agent key that produced the injected output */
  sourceAgentKey?: string;
  /** Source step index in the pipeline */
  sourceStepIndex?: number;
  /** Memory domain from which output was retrieved */
  sourceDomain?: string;
}

/**
 * Feedback input for weight updates
 */
export interface IFeedbackInput {
  /** Trajectory ID to provide feedback for */
  trajectoryId: TrajectoryID;
  /** Quality score (0-1) */
  quality: number;
  /** Optional L-Score override (otherwise retrieved from provenance) */
  lScore?: number;
  /** Optional similarity scores per pattern */
  similarities?: Map<PatternID, number>;
  /** Optional RLM context for relay-race memory handoff tracking */
  rlmContext?: IRlmContext;
}

/**
 * Result of weight update operation
 */
export interface IWeightUpdateResult {
  /** Trajectory ID that was updated */
  trajectoryId: TrajectoryID;
  /** Number of patterns updated */
  patternsUpdated: number;
  /** Calculated reward */
  reward: number;
  /** Whether pattern was auto-created */
  patternAutoCreated: boolean;
  /** Time taken in ms */
  elapsedMs: number;
}

/**
 * Binary weight file metadata
 */
export interface IWeightFileMetadata {
  /** File format version */
  version: number;
  /** Routes in the file */
  routes: Route[];
  /** Pattern counts per route */
  patternCounts: Record<Route, number>;
  /** Timestamp of serialization */
  timestamp: number;
  /** Pattern ID mapping for deserialization */
  patternMapping?: Array<{ route: Route; patternId: PatternID }>;
}

/**
 * Serialized Fisher Information entry
 */
export interface ISerializedFisherEntry {
  route: Route;
  entries: Array<{ patternId: PatternID; importance: number }>;
}

/**
 * Error thrown when feedback validation fails
 */
export class FeedbackValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedbackValidationError';
  }
}

/**
 * Error thrown when weight persistence fails
 */
export class WeightPersistenceError extends Error {
  constructor(
    public readonly operation: 'save' | 'load',
    message: string
  ) {
    super(`Weight ${operation} failed: ${message}`);
    this.name = 'WeightPersistenceError';
  }
}

// ==================== Drift Detection Types (TASK-SON-003) ====================

/**
 * Checkpoint reason types
 */
export type CheckpointReason = 'manual' | 'auto' | 'pre-update';

/**
 * Extended checkpoint interface for TASK-SON-003
 */
export interface ICheckpointFull {
  /** Unique checkpoint ID */
  id: string;
  /** Full weight snapshot */
  weights: Map<Route, Map<PatternID, Weight>>;
  /** Fisher Information snapshot */
  fisherInformation: Map<Route, Map<PatternID, number>>;
  /** Checkpoint timestamp */
  timestamp: number;
  /** Drift score at checkpoint */
  drift: number;
  /** Checkpoint metadata */
  metadata: {
    /** Trajectories processed before checkpoint */
    trajectoriesProcessed: number;
    /** Average quality at checkpoint */
    averageQuality: number;
    /** Reason for checkpoint */
    reason: CheckpointReason;
  };
}

/**
 * Serialized checkpoint for persistence
 */
export interface ISerializedCheckpoint {
  id: string;
  weights: Array<{ route: Route; patterns: Array<{ id: PatternID; weight: Weight }> }>;
  fisherInformation: Array<{ route: Route; patterns: Array<{ id: PatternID; importance: number }> }>;
  timestamp: number;
  drift: number;
  metadata: {
    trajectoriesProcessed: number;
    averageQuality: number;
    reason: CheckpointReason;
  };
}

/**
 * Error thrown when rollback loop is detected
 */
export class RollbackLoopError extends Error {
  constructor(
    public readonly rollbackCount: number,
    public readonly timeWindowMs: number
  ) {
    super(`Rollback loop detected: ${rollbackCount} rollbacks in ${timeWindowMs}ms`);
    this.name = 'RollbackLoopError';
  }
}

/**
 * Error thrown when checkpoint operation fails
 */
export class CheckpointError extends Error {
  constructor(
    public readonly operation: 'create' | 'rollback' | 'load' | 'save',
    message: string
  ) {
    super(`Checkpoint ${operation} failed: ${message}`);
    this.name = 'CheckpointError';
  }
}

// ==================== SonaEngine Interface (RULE-031) ====================

/**
 * ISonaEngine - Interface for SonaEngine dependency injection
 *
 * Per CONSTITUTION RULE-031: TrajectoryTracker MUST receive injected SonaEngine reference.
 * Systems MUST be connected, not independent.
 *
 * This interface defines the minimum contract for SonaEngine integration.
 * Implements: RULE-031
 */
export interface ISonaEngine {
  /**
   * Create a trajectory with a specific ID (for bridging with TrajectoryTracker)
   *
   * @param trajectoryId - Existing trajectory ID to use
   * @param route - Task type (e.g., "reasoning.causal")
   * @param patterns - Pattern IDs used in this trajectory
   * @param context - Context IDs that influenced the outcome
   */
  createTrajectoryWithId(
    trajectoryId: TrajectoryID,
    route: Route,
    patterns: PatternID[],
    context?: string[]
  ): void;

  /**
   * Provide feedback for a trajectory and update pattern weights
   *
   * @param trajectoryId - Trajectory ID to provide feedback for
   * @param quality - Quality score (0-1)
   * @param options - Optional parameters for weight updates
   */
  provideFeedback(
    trajectoryId: TrajectoryID,
    quality: number,
    options?: {
      lScore?: number;
      similarities?: Map<PatternID, number>;
      skipAutoSave?: boolean;
      rlmContext?: IRlmContext;
    }
  ): Promise<IWeightUpdateResult>;

  /**
   * Get weight for a single pattern in a route
   *
   * @param patternId - Pattern ID to get weight for
   * @param route - Task type/route
   * @returns Weight value (0.0 if not found)
   */
  getWeight(patternId: PatternID, route: Route): Promise<Weight>;

  /**
   * Get a trajectory by ID
   *
   * @param trajectoryId - Trajectory ID
   * @returns ITrajectory or null if not found
   */
  getTrajectory(trajectoryId: TrajectoryID): ITrajectory | null;

  /**
   * Check if a trajectory exists in persistent storage (SQLite)
   * Used for cross-session feedback when trajectory not in memory
   * Implements: REQ-TRAJ-006
   *
   * @param trajectoryId - Trajectory ID to check
   * @returns true if trajectory exists in database
   */
  hasTrajectoryInStorage(trajectoryId: TrajectoryID): boolean;

  /**
   * Load trajectory from persistent storage (SQLite)
   * Used when trajectory not in memory but exists in database
   * Implements: REQ-TRAJ-006
   *
   * @param trajectoryId - Trajectory ID to load
   * @returns ITrajectory or null if not found
   */
  getTrajectoryFromStorage(trajectoryId: TrajectoryID): ITrajectory | null;
}

// ==================== Reasoning Step Types (SPEC-SON-001) ====================

/**
 * A single step in a reasoning trajectory
 * Captures what action was taken and what resulted
 * SPEC-SON-001
 */
export interface IReasoningStep {
  /** Unique step ID within trajectory */
  stepId: string;

  /** Action type (e.g., "query_vectordb", "causal_inference", "pattern_match") */
  action: ReasoningStepAction;

  /** Action parameters (truncated for storage) */
  actionParams: Record<string, unknown>;

  /** Result of the action (truncated for large outputs) */
  result: string;

  /** Full result reference (for large outputs) */
  resultRef?: {
    type: 'reasoningbank' | 'vectordb' | 'memory';
    id: string;
  };

  /** Confidence score for this step (0-1) */
  confidence: number;

  /** Timestamp when step executed (ms since epoch) */
  timestamp: number;

  /** Optional metadata */
  metadata?: {
    /** Pattern ID if this step used a pattern */
    patternId?: string;
    /** Duration in ms */
    duration?: number;
    /** Token count for LLM calls */
    tokens?: number;
    /** Error if step failed */
    error?: string;
    /** Source trajectory for replay */
    replayedFrom?: string;
  };
}

/**
 * Valid reasoning step action types
 */
export type ReasoningStepAction =
  | 'query_vectordb'
  | 'query_reasoningbank'
  | 'causal_inference'
  | 'pattern_match'
  | 'embedding_generation'
  | 'similarity_search'
  | 'analogical_mapping'
  | 'temporal_analysis'
  | 'code_generation'
  | 'validation'
  | 'custom';

/**
 * Configuration for step capture
 */
export interface IStepCaptureConfig {
  /** Maximum result size before truncation (default: 1000) */
  maxResultSize?: number;
  /** Maximum steps per trajectory (default: 100) */
  maxSteps?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}
