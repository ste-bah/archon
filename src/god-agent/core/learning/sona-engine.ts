/**
 * Sona Engine
 * TASK-SON-001 - Trajectory Tracking and Weight Management
 * TASK-SON-002 - LoRA-Style Weight Updates and Persistence
 *
 * Implements trajectory-based learning for pattern weight adaptation.
 * Enables 10-30% improvement on repeated task types without retraining.
 *
 * Performance targets:
 * - createTrajectory(): <1ms
 * - getWeight(): <1ms
 * - getWeights(): <5ms
 * - provideFeedback(): <15ms
 */

import { writeFile, readFile, rename, mkdir, readdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { getObservabilityBus } from '../observability/bus.js';
import type {
  TrajectoryID,
  PatternID,
  Route,
  Weight,
  RouteWeights,
  WeightStorage,
  ITrajectory,
  ITrajectoryInput,
  ISonaConfig,
  ILearningMetrics,
  IDriftMetrics,
  DriftStatus,
  ISerializedTrajectory,
  ISerializedRouteWeights,
  ISerializedSonaState,
  FisherInformationStorage,
  IWeightUpdateResult,
  IWeightFileMetadata,
  ISerializedFisherEntry,
  CheckpointReason,
  ICheckpointFull,
  ISerializedCheckpoint,
  IReasoningStep,
  IRlmContext,
} from './sona-types.js';
import { EmbeddingProviderFactory } from '../memory/embedding-provider.js';
import type { IEmbeddingProvider } from '../memory/types.js';
import {
  TrajectoryValidationError,
  FeedbackValidationError,
  WeightPersistenceError,
  RollbackLoopError,
  CheckpointError,
} from './sona-types.js';
import { TrajectoryStreamManager } from './trajectory-stream-manager.js';
import type { ITrajectoryStreamConfig, IRollbackState } from '../types/trajectory-streaming-types.js';
import {
  generateTrajectoryID,
  generateCheckpointID,
  validateTrajectoryInput,
  validateAndApplyConfig,
  type ValidatedSonaConfig,
  DEFAULT_INITIAL_WEIGHT,
  clampWeight,
  cosineSimilarity,
  arithmeticMean,
  validateFeedbackQuality,
  calculateReward,
  calculateGradient,
  calculateWeightUpdate,
  updateFisherInformation,
  crc32,
  DEFAULT_FISHER_INFORMATION,
  FISHER_DECAY_RATE,
  AUTO_SAVE_THROTTLE_MS,
  AUTO_PATTERN_QUALITY_THRESHOLD,
  WEIGHT_FILE_VERSION,
} from './sona-utils.js';
import { VECTOR_DIM } from '../validation/constants.js';

// ============================================================
// DATABASE PERSISTENCE IMPORTS (TASK-PERSIST-004)
// RULE-008: ALL learning data MUST be stored in SQLite
// ============================================================
import type { IDatabaseConnection } from '../database/connection.js';
import { TrajectoryMetadataDAO, type ITrajectoryMetadataInput } from '../database/dao/trajectory-metadata-dao.js';
import { PatternDAO, type IPatternInput } from '../database/dao/pattern-dao.js';
import { LearningFeedbackDAO, type ILearningFeedbackInput } from '../database/dao/learning-feedback-dao.js';

/**
 * Simple mutex for weight update concurrency control
 */
class SimpleMutex {
  private locked = false;
  private queue: Array<() => void> = [];

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (!this.locked) {
          this.locked = true;
          resolve(() => this.release());
        } else {
          this.queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }

  private release(): void {
    this.locked = false;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }
}

/**
 * Sona Engine - Trajectory-Based Learning
 *
 * Manages trajectories and pattern weights for adaptive learning.
 * Supports EWC++ regularized weight updates with Fisher Information.
 * Includes drift detection and automatic rollback (TASK-SON-003).
 */
/**
 * Pattern interface for learned reusable patterns
 */
interface Pattern {
  id: string;
  sourceTrajectory: TrajectoryID;
  embedding: Float32Array;
  quality: number;
  steps: IReasoningStep[];
  createdAt: number;
  usageCount: number;
  taskType?: string;
  template?: string;
  successRate?: number;
  sonaWeight?: number;
  updatedAt?: Date;
  metadata?: {
    domain?: string;
    description?: string;
    tags?: string[];
    stepCount?: number;
    compressionRatio?: string;
  };
}

export class SonaEngine {
  private trajectories: Map<TrajectoryID, ITrajectory> = new Map();
  private weights: WeightStorage = new Map();
  private fisherInformation: FisherInformationStorage = new Map();
  private patterns: Map<string, Pattern> = new Map();
  private config: ValidatedSonaConfig;
  private initialized: boolean = false;
  private embeddingProvider!: IEmbeddingProvider;

  // FIX: Callback for pattern creation to connect to PatternStore
  private patternCreatedCallback?: (pattern: Pattern) => Promise<void>;

  // Weight update state (TASK-SON-002)
  private weightUpdateMutex = new SimpleMutex();
  private lastAutoSave: number = 0;
  private weightsFilePath: string = '.agentdb/sona/sona_weights.bin';

  // Drift detection and checkpointing state (TASK-SON-003)
  private baselineWeights: WeightStorage = new Map();
  private checkpoints: Map<string, ICheckpointFull> = new Map();
  private checkpointsDir: string = '.agentdb/universal/checkpoints';
  private rollbackCount: number = 0;
  private lastRollbackTime: number = 0;
  private static readonly ROLLBACK_WINDOW_MS = 300000; // 5 minutes
  private static readonly MAX_ROLLBACKS_IN_WINDOW = 3;

  // Trajectory streaming state (TECH-TRJ-001)
  private streamManager?: TrajectoryStreamManager;
  private rollbackState: IRollbackState = {
    lastRollbackCheckpointId: null,
    lastRollbackAt: null,
    rollbackCount: 0
  };
  private baselineCheckpointIds: Set<string> = new Set();

  // ============================================================
  // DATABASE PERSISTENCE (TASK-PERSIST-004)
  // RULE-008: ALL learning data MUST be stored in SQLite
  // RULE-074: Map as primary storage is FORBIDDEN in production
  // ============================================================
  private databaseConnection?: IDatabaseConnection;
  private trajectoryMetadataDAO?: TrajectoryMetadataDAO;
  private patternDAO?: PatternDAO;
  private learningFeedbackDAO?: LearningFeedbackDAO;
  private persistenceEnabled: boolean = false;

  /**
   * Map RLM context to feedback input format
   * Extracts relay-race memory handoff fields for persistence
   */
  private mapRlmContextToFeedback(rlmContext?: IRlmContext): {
    rlmInjectionSuccess?: boolean;
    rlmSourceAgent?: string;
    rlmSourceStepIndex?: number;
    rlmSourceDomain?: string;
  } {
    return {
      rlmInjectionSuccess: rlmContext?.injectionSuccess,
      rlmSourceAgent: rlmContext?.sourceAgentKey,
      rlmSourceStepIndex: rlmContext?.sourceStepIndex,
      rlmSourceDomain: rlmContext?.sourceDomain,
    };
  }

  // Metrics tracking
  private metrics: ILearningMetrics = {
    totalTrajectories: 0,
    trajectoriesByRoute: {},
    averageQualityByRoute: {},
    improvementPercentage: {},
    patternsCreated: 0,
    patternsPruned: 0,
    currentDrift: 0,
    checkpointsCreated: 0,
    rollbacksTriggered: 0,
    lastUpdated: Date.now(),
  };

  constructor(config: ISonaConfig = {}) {
    this.config = validateAndApplyConfig(config);
    // Apply checkpointsDir from config if provided
    if (config.checkpointsDir) {
      this.checkpointsDir = config.checkpointsDir;
    }

    // ============================================================
    // DATABASE PERSISTENCE INITIALIZATION (TASK-PERSIST-004)
    // RULE-008: ALL learning data MUST be stored in SQLite
    // ============================================================
    if (config.databaseConnection) {
      this.databaseConnection = config.databaseConnection;
      this.trajectoryMetadataDAO = new TrajectoryMetadataDAO(config.databaseConnection);
      this.patternDAO = new PatternDAO(config.databaseConnection);
      this.learningFeedbackDAO = new LearningFeedbackDAO(config.databaseConnection);
      this.persistenceEnabled = true;
    } else if (process.env.SONA_REQUIRE_PERSISTENCE === 'true') {
      // RULE-074: In production, Map as primary storage is FORBIDDEN
      throw new Error(
        'CONSTITUTION VIOLATION (RULE-074): SonaEngine requires database persistence in production. ' +
        'Use createProductionSonaEngine() factory or provide databaseConnection in config. ' +
        'Set SONA_REQUIRE_PERSISTENCE=false only for testing.'
      );
    }
  }

  /**
   * Check if database persistence is enabled
   * @returns True if DAOs are initialized and ready
   */
  isPersistenceEnabled(): boolean {
    return this.persistenceEnabled;
  }

  /**
   * Get database statistics for observability
   * @returns DAO statistics or null if persistence is disabled
   */
  getDatabaseStats(): {
    trajectoryMetadata: ReturnType<TrajectoryMetadataDAO['getStats']>;
    patterns: ReturnType<PatternDAO['getStats']>;
    feedback: ReturnType<LearningFeedbackDAO['getStats']>;
  } | null {
    if (!this.persistenceEnabled) return null;

    return {
      trajectoryMetadata: this.trajectoryMetadataDAO!.getStats(),
      patterns: this.patternDAO!.getStats(),
      feedback: this.learningFeedbackDAO!.getStats()
    };
  }

  /**
   * Initialize the Sona Engine
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    // Initialize embedding provider (SPEC-EMB-002)
    this.embeddingProvider = await EmbeddingProviderFactory.getProvider();
    this.initialized = true;
  }

  /**
   * Enable trajectory streaming to disk (TECH-TRJ-001)
   *
   * @param config - Optional streaming configuration
   */
  async enableStreaming(config?: Partial<ITrajectoryStreamConfig>): Promise<void> {
    this.streamManager = new TrajectoryStreamManager(config ?? {});
    await this.streamManager.initialize();
    console.log('[SonaEngine] Trajectory streaming enabled');
  }

  /**
   * Set the weights file path for persistence
   */
  setWeightsFilePath(path: string): void {
    this.weightsFilePath = path;
  }

  /**
   * FIX: Set callback for pattern creation notifications
   * This connects SonaEngine patterns to PatternStore for reasoning
   *
   * @param callback - Function to call when a pattern is created
   */
  onPatternCreated(callback: (pattern: Pattern) => Promise<void>): void {
    this.patternCreatedCallback = callback;
  }

  /**
   * Create a new trajectory for a reasoning path
   *
   * @param route - Task type (e.g., "reasoning.causal")
   * @param patterns - Pattern IDs used in this trajectory
   * @param context - Context IDs that influenced the outcome
   * @returns Generated TrajectoryID
   * @throws TrajectoryValidationError if validation fails
   */
  createTrajectory(route: Route, patterns: PatternID[], context: string[] = []): TrajectoryID {
    const startTime = performance.now();

    // 1. Validate input
    const input: ITrajectoryInput = { route, patterns, context };
    validateTrajectoryInput(input);

    // 2. Generate unique TrajectoryID
    const trajectoryId = generateTrajectoryID();

    // 3. Create ITrajectory object
    const trajectory: ITrajectory = {
      id: trajectoryId,
      route,
      patterns: [...patterns], // Copy to prevent mutation
      context: [...context],
      createdAt: Date.now(),
      steps: input.steps ? [...input.steps] : undefined,
    };

    // 4. Store in memory map
    this.trajectories.set(trajectoryId, trajectory);

    // 4.5. FIX: Stream to disk if enabled (fire-and-forget for sync method)
    if (this.streamManager) {
      this.streamManager.addTrajectory(trajectory).catch(error => {
        console.warn(`[SonaEngine] Failed to stream trajectory ${trajectoryId}:`, error);
      });
    }

    // 4.6. DATABASE PERSISTENCE (FIX: was missing from createTrajectory)
    // RULE-008: ALL trajectory data MUST be stored in SQLite
    if (this.persistenceEnabled && this.trajectoryMetadataDAO) {
      try {
        const metadataInput: ITrajectoryMetadataInput = {
          id: trajectoryId,
          filePath: `.agentdb/sona/trajectories/${trajectoryId}.bin`,
          fileOffset: 0,
          fileLength: 0,
          route,
          stepCount: patterns.length,
          createdAt: trajectory.createdAt,
          status: 'active'
        };
        this.trajectoryMetadataDAO.insert(metadataInput);
      } catch (error) {
        console.warn(`[SonaEngine] Failed to persist trajectory metadata ${trajectoryId}:`, error);
      }
    }

    // 5. Initialize route weights if first trajectory for this route
    if (!this.weights.has(route)) {
      this.weights.set(route, new Map<PatternID, Weight>());
    }

    // 6. Initialize weights for new patterns (default: 0.0)
    const routeWeights = this.weights.get(route)!;
    for (const patternId of patterns) {
      if (!routeWeights.has(patternId)) {
        routeWeights.set(patternId, DEFAULT_INITIAL_WEIGHT);
      }
    }

    // 7. Update metrics
    this.metrics.totalTrajectories++;
    this.metrics.trajectoriesByRoute[route] = (this.metrics.trajectoriesByRoute[route] || 0) + 1;
    this.metrics.lastUpdated = Date.now();

    // 8. Track performance
    if (this.config.trackPerformance) {
      const elapsed = performance.now() - startTime;
      if (elapsed > 1) {
        console.warn(`SonaEngine.createTrajectory() took ${elapsed.toFixed(2)}ms, exceeds 1ms target`);
      }
    }

    // 9. Reset rollback state if progressed (TECH-TRJ-001)
    this.resetRollbackStateIfProgressed();

    // 10. Emit observability event (TASK-OBS-003)
    const bus = getObservabilityBus();
    const elapsedMs = performance.now() - startTime;
    bus.emit({
      component: 'sona',
      operation: 'sona_trajectory_created',
      status: 'success',
      durationMs: elapsedMs,
      metadata: {
        trajectoryId,
        route,
        patternCount: patterns.length,
        contextCount: context.length,
        totalTrajectories: this.metrics.totalTrajectories,
      },
    });

    return trajectoryId;
  }

  /**
   * Create a trajectory with a specific ID (for bridging with TrajectoryTracker)
   *
   * Same as createTrajectory but accepts an existing trajectory ID.
   * Used when syncing trajectories from ReasoningBank's TrajectoryTracker.
   *
   * @param trajectoryId - Existing trajectory ID to use
   * @param route - Task type (e.g., "reasoning.causal")
   * @param patterns - Pattern IDs used in this trajectory
   * @param context - Context IDs that influenced the outcome
   * @throws TrajectoryValidationError if validation fails
   */
  createTrajectoryWithId(
    trajectoryId: TrajectoryID,
    route: Route,
    patterns: PatternID[],
    context: string[] = []
  ): void {
    // Skip if trajectory already exists
    if (this.trajectories.has(trajectoryId)) {
      return;
    }

    // Validate input
    const input: ITrajectoryInput = { route, patterns, context };
    validateTrajectoryInput(input);

    // Create ITrajectory object with provided ID
    const trajectory: ITrajectory = {
      id: trajectoryId,
      route,
      patterns: [...patterns],
      context: [...context],
      createdAt: Date.now(),
      steps: input.steps ? [...input.steps] : undefined,
    };

    // Store in memory map
    this.trajectories.set(trajectoryId, trajectory);

    // FIX: Stream to disk if enabled (fire-and-forget for sync method)
    if (this.streamManager) {
      this.streamManager.addTrajectory(trajectory).catch(error => {
        console.warn(`[SonaEngine] Failed to stream trajectory ${trajectoryId}:`, error);
      });
    }

    // ============================================================
    // DATABASE PERSISTENCE (TASK-PERSIST-005)
    // RULE-008: ALL trajectory data MUST be stored in SQLite
    // ============================================================
    if (this.persistenceEnabled && this.trajectoryMetadataDAO) {
      try {
        const metadataInput: ITrajectoryMetadataInput = {
          id: trajectoryId,
          filePath: `.agentdb/sona/trajectories/${trajectoryId}.bin`,
          fileOffset: 0, // Will be updated by stream manager
          fileLength: 0, // Will be updated on completion
          route,
          stepCount: patterns.length,
          createdAt: trajectory.createdAt,
          status: 'active'
        };
        this.trajectoryMetadataDAO.insert(metadataInput);
      } catch (error) {
        // Log but don't fail - in-memory storage still works
        console.warn(`[SonaEngine] Failed to persist trajectory metadata ${trajectoryId}:`, error);
      }
    }

    // Initialize route weights if first trajectory for this route
    if (!this.weights.has(route)) {
      this.weights.set(route, new Map<PatternID, Weight>());
    }

    // Initialize weights for new patterns (default: 0.0)
    const routeWeights = this.weights.get(route)!;
    for (const patternId of patterns) {
      if (!routeWeights.has(patternId)) {
        routeWeights.set(patternId, DEFAULT_INITIAL_WEIGHT);
      }
    }

    // Update metrics
    this.metrics.totalTrajectories++;
    this.metrics.trajectoriesByRoute[route] = (this.metrics.trajectoriesByRoute[route] || 0) + 1;
    this.metrics.lastUpdated = Date.now();

    // Emit observability event (TASK-OBS-003)
    const bus = getObservabilityBus();
    bus.emit({
      component: 'sona',
      operation: 'sona_trajectory_created',
      status: 'success',
      metadata: {
        trajectoryId,
        route,
        patternCount: patterns.length,
        contextCount: context.length,
        totalTrajectories: this.metrics.totalTrajectories,
        bridged: true, // Indicates this was bridged from TrajectoryTracker
      },
    });
  }

  /**
   * Link a pattern to an existing trajectory.
   * Updates both the in-memory trajectory and the DB (via PatternDAO).
   *
   * Implements: FIX-TRAJ-PATTERN-001 (trajectory-pattern link gap)
   *
   * @param trajectoryId - Trajectory to link the pattern to
   * @param patternId - Pattern ID to add
   */
  addPatternToTrajectory(trajectoryId: TrajectoryID, patternId: PatternID): void {
    const trajectory = this.trajectories.get(trajectoryId);
    if (!trajectory) {
      console.warn(`[SonaEngine] addPatternToTrajectory: trajectory ${trajectoryId} not found in memory`);
      return;
    }
    if (!trajectory.patterns.includes(patternId)) {
      trajectory.patterns.push(patternId);
    }
    // Persist link in DB so getTrajectoryFromStorage can reconstruct it
    if (this.patternDAO) {
      try {
        this.patternDAO.addTrajectoryId(patternId, trajectoryId);
      } catch (err) {
        console.warn(`[SonaEngine] Failed to persist pattern-trajectory link: ${err}`);
      }
    }
  }

  /**
   * Get weight for a single pattern in a route
   *
   * @param patternId - Pattern ID to get weight for
   * @param route - Task type/route
   * @returns Weight value (0.0 if not found)
   */
  async getWeight(patternId: PatternID, route: Route): Promise<Weight> {
    // 1. Check if route exists
    const routeWeights = this.weights.get(route);
    if (!routeWeights) {
      return DEFAULT_INITIAL_WEIGHT;
    }

    // 2. Check if pattern weight exists
    const weight = routeWeights.get(patternId);
    if (weight === undefined) {
      return DEFAULT_INITIAL_WEIGHT;
    }

    return weight;
  }

  /**
   * Get all weights for a route as Float32Array
   *
   * @param route - Task type/route
   * @returns Float32Array of weights (empty if route not found)
   */
  async getWeights(route: Route): Promise<Float32Array> {
    // 1. Check if route exists
    const routeWeights = this.weights.get(route);
    if (!routeWeights) {
      return new Float32Array(0);
    }

    // 2. Convert Map to Float32Array
    const weightsArray = new Float32Array(routeWeights.size);
    let i = 0;
    for (const weight of routeWeights.values()) {
      weightsArray[i++] = weight;
    }

    return weightsArray;
  }

  /**
   * Get weights with pattern ID mapping for a route
   *
   * @param route - Task type/route
   * @returns Array of {patternId, weight} pairs
   */
  async getWeightsWithIds(route: Route): Promise<Array<{ patternId: PatternID; weight: Weight }>> {
    const routeWeights = this.weights.get(route);
    if (!routeWeights) {
      return [];
    }

    const result: Array<{ patternId: PatternID; weight: Weight }> = [];
    for (const [patternId, weight] of routeWeights) {
      result.push({ patternId, weight });
    }
    return result;
  }

  /**
   * Set weight for a pattern (for testing and manual adjustment)
   *
   * @param patternId - Pattern ID
   * @param route - Task type/route
   * @param weight - Weight value (-1 to 1)
   */
  setWeight(patternId: PatternID, route: Route, weight: Weight): void {
    // Ensure route exists
    if (!this.weights.has(route)) {
      this.weights.set(route, new Map<PatternID, Weight>());
    }

    // Clamp and set weight
    const routeWeights = this.weights.get(route)!;
    routeWeights.set(patternId, clampWeight(weight));
  }

  /**
   * Get a trajectory by ID
   * Implements: REQ-TRAJ-001 (SQLite fallback), REQ-TRAJ-002 (cache on load)
   * Constitution: RULE-008 (SQLite primary storage)
   *
   * @param trajectoryId - Trajectory ID
   * @returns ITrajectory or null if not found
   */
  getTrajectory(trajectoryId: TrajectoryID): ITrajectory | null {
    // Implements [REQ-TRAJ-001]: Check memory cache first
    const cached = this.trajectories.get(trajectoryId);
    if (cached) {
      return cached;
    }
    // Implements [REQ-TRAJ-001]: Fallback to SQLite if not in memory
    const fromStorage = this.getTrajectoryFromStorage(trajectoryId);
    if (fromStorage) {
      // Implements [REQ-TRAJ-002]: Cache loaded trajectory in memory
      this.trajectories.set(trajectoryId, fromStorage);
    }
    return fromStorage;
  }

  /**
   * Check if trajectory exists in persistent storage (SQLite)
   * Implements: REQ-TRAJ-006
   * Constitution: RULE-008 (SQLite primary storage), RULE-069 (try/catch)
   *
   * @param trajectoryId - Trajectory ID to check
   * @returns true if trajectory exists in database
   */
  hasTrajectoryInStorage(trajectoryId: TrajectoryID): boolean {
    // Implements [REQ-TRAJ-006]: Check SQLite for trajectory existence
    if (!this.persistenceEnabled || !this.trajectoryMetadataDAO) {
      return false;
    }
    try {
      return this.trajectoryMetadataDAO.exists(trajectoryId);
    } catch (error) {
      // Implements [RULE-070]: Log error with context before returning
      console.warn(`[SonaEngine] hasTrajectoryInStorage failed for ${trajectoryId}:`, error);
      return false;
    }
  }

  /**
   * Load trajectory from persistent storage (SQLite)
   * Implements: REQ-TRAJ-006, REQ-TRAJ-008
   * Constitution: RULE-008 (SQLite primary storage), RULE-069 (try/catch)
   *
   * @param trajectoryId - Trajectory ID to load
   * @returns ITrajectory or null if not found
   */
  getTrajectoryFromStorage(trajectoryId: TrajectoryID): ITrajectory | null {
    // Implements [REQ-TRAJ-006]: Load trajectory from SQLite
    if (!this.persistenceEnabled || !this.trajectoryMetadataDAO) {
      return null;
    }
    try {
      const metadata = this.trajectoryMetadataDAO.findById(trajectoryId);
      if (!metadata) {
        return null;
      }
      // Implements [REQ-TRAJ-008]: Map SQLite metadata fields to ITrajectory
      // FIX-TRAJ-PATTERN-001: Reverse-lookup patterns linked to this trajectory
      let patternIds: string[] = [];
      if (this.patternDAO) {
        try {
          patternIds = this.patternDAO.findPatternIdsByTrajectoryId(metadata.id);
        } catch {
          // Non-fatal: if pattern lookup fails, proceed with empty array
        }
      }
      const trajectory: ITrajectory = {
        id: metadata.id,
        route: metadata.route as Route,
        patterns: patternIds,
        context: [],  // Context not stored in trajectory_metadata
        createdAt: metadata.createdAt,
        quality: metadata.qualityScore, // Include quality score from database
      };
      return trajectory;
    } catch (error) {
      // Implements [RULE-070]: Log error with context before returning
      console.warn(`[SonaEngine] getTrajectoryFromStorage failed for ${trajectoryId}:`, error);
      return null;
    }
  }

  /**
   * List all trajectories, optionally filtered by route
   *
   * @param route - Optional route filter
   * @returns Array of trajectories
   */
  listTrajectories(route?: Route): ITrajectory[] {
    const allTrajectories = Array.from(this.trajectories.values());
    if (route) {
      return allTrajectories.filter(t => t.route === route);
    }
    return allTrajectories;
  }

  /**
   * Get trajectory count, optionally filtered by route
   *
   * @param route - Optional route filter
   * @returns Number of trajectories
   */
  getTrajectoryCount(route?: Route): number {
    if (route) {
      return this.listTrajectories(route).length;
    }
    return this.trajectories.size;
  }

  /**
   * Get all routes with initialized weights
   *
   * @returns Array of route strings
   */
  getRoutes(): Route[] {
    return Array.from(this.weights.keys());
  }

  /**
   * Get number of patterns for a route
   *
   * @param route - Task type/route
   * @returns Number of patterns with weights
   */
  getPatternCount(route: Route): number {
    const routeWeights = this.weights.get(route);
    return routeWeights ? routeWeights.size : 0;
  }

  /**
   * Check if a route has been initialized
   *
   * @param route - Task type/route
   * @returns true if route exists
   */
  hasRoute(route: Route): boolean {
    return this.weights.has(route);
  }

  /**
   * Get learning metrics
   *
   * @returns Current learning metrics
   */
  getMetrics(): ILearningMetrics {
    // Calculate average quality per route
    for (const route of this.getRoutes()) {
      const routeTrajectories = this.listTrajectories(route);
      const qualityScores = routeTrajectories
        .filter(t => t.quality !== undefined)
        .map(t => t.quality!);

      if (qualityScores.length > 0) {
        this.metrics.averageQualityByRoute[route] = arithmeticMean(qualityScores);
      }
    }

    return { ...this.metrics };
  }

  /**
   * Calculate drift from baseline weights
   *
   * @param baselineWeights - Baseline weight vector
   * @returns Drift metrics
   */
  calculateDrift(baselineWeights: Float32Array): IDriftMetrics {
    // Get current weights as flat array
    const currentWeights = this.getAllWeightsFlat();

    // Handle size mismatch
    if (currentWeights.length !== baselineWeights.length) {
      // Expand or contract baseline to match current
      const adjustedBaseline = new Float32Array(currentWeights.length);
      for (let i = 0; i < adjustedBaseline.length; i++) {
        adjustedBaseline[i] = i < baselineWeights.length ? baselineWeights[i] : 0;
      }

      return this.computeDriftMetrics(currentWeights, adjustedBaseline);
    }

    return this.computeDriftMetrics(currentWeights, baselineWeights);
  }

  /**
   * Compute drift metrics from two weight vectors
   */
  private computeDriftMetrics(current: Float32Array, baseline: Float32Array): IDriftMetrics {
    const similarity = cosineSimilarity(current, baseline);
    const drift = 1 - similarity;

    let status: DriftStatus = 'NORMAL';
    if (drift > this.config.driftRejectThreshold) {
      status = 'REJECT';
    } else if (drift > this.config.driftAlertThreshold) {
      status = 'ALERT';
    }

    this.metrics.currentDrift = drift;

    return {
      currentWeights: current,
      baselineWeights: baseline,
      drift,
      alertThreshold: this.config.driftAlertThreshold,
      rejectThreshold: this.config.driftRejectThreshold,
      timestamp: Date.now(),
      status,
    };
  }

  /**
   * Get all weights as a flat Float32Array
   */
  private getAllWeightsFlat(): Float32Array {
    let totalSize = 0;
    for (const routeWeights of this.weights.values()) {
      totalSize += routeWeights.size;
    }

    const flat = new Float32Array(totalSize);
    let i = 0;
    for (const routeWeights of this.weights.values()) {
      for (const weight of routeWeights.values()) {
        flat[i++] = weight;
      }
    }

    return flat;
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.trajectories.clear();
    this.weights.clear();
    this.fisherInformation.clear();
    this.metrics = {
      totalTrajectories: 0,
      trajectoriesByRoute: {},
      averageQualityByRoute: {},
      improvementPercentage: {},
      patternsCreated: 0,
      patternsPruned: 0,
      currentDrift: 0,
      checkpointsCreated: 0,
      rollbacksTriggered: 0,
      lastUpdated: Date.now(),
    };
  }

  // ==================== TASK-SON-002: Weight Update Methods ====================

  /**
   * Provide feedback for a trajectory and update pattern weights
   *
   * @param trajectoryId - Trajectory ID to provide feedback for
   * @param quality - Quality score (0-1)
   * @param options - Optional parameters for weight updates
   * @returns Weight update result
   * @throws FeedbackValidationError if validation fails
   */
  async provideFeedback(
    trajectoryId: TrajectoryID,
    quality: number,
    options: {
      lScore?: number;
      similarities?: Map<PatternID, number>;
      skipAutoSave?: boolean;
      /** RLM context for relay-race memory handoff tracking */
      rlmContext?: IRlmContext;
    } = {}
  ): Promise<IWeightUpdateResult> {
    const startTime = performance.now();

    // 1. Validate quality
    validateFeedbackQuality(quality);

    // 2. Retrieve trajectory (with SQLite fallback per FIX-PLAN.md)
    let trajectory = this.getTrajectory(trajectoryId);

    // FIX: Create trajectory on-demand for hook-generated IDs (TRAJECTORY-ORPHAN-FIX)
    // Hook-generated trajectories (from post-task.ts, god-agent-save.sh) are never
    // registered in SonaEngine, causing 100% feedback failure. Create them on-demand.
    if (!trajectory && trajectoryId.startsWith('hook-')) {
      console.log(
        `[SonaEngine] Creating on-demand trajectory for hook ID: ${trajectoryId}`
      );

      // Create trajectory with default route for hook-based auto-learning
      const hookRoute = 'auto-learning.hook' as Route;
      this.createTrajectoryWithId(
        trajectoryId,
        hookRoute,
        [], // Empty patterns - will be auto-created if quality > threshold
        ['auto-learning-hook', `created-on-demand-${Date.now()}`]
      );

      // Retrieve the newly created trajectory
      trajectory = this.getTrajectory(trajectoryId);
    }

    // Also handle session-end trajectories from god-agent-save.sh
    if (!trajectory && trajectoryId.startsWith('session-end-')) {
      console.log(
        `[SonaEngine] Creating on-demand trajectory for session-end ID: ${trajectoryId}`
      );

      const sessionRoute = 'auto-learning.session-end' as Route;
      this.createTrajectoryWithId(
        trajectoryId,
        sessionRoute,
        [],
        ['session-end-hook', `created-on-demand-${Date.now()}`]
      );

      trajectory = this.getTrajectory(trajectoryId);
    }

    if (!trajectory) {
      throw new FeedbackValidationError(`Trajectory ${trajectoryId} not found`);
    }

    // 3. If empty patterns, still try auto-pattern creation for high-quality trajectories
    // FIX: This was previously an early return that skipped auto-pattern creation entirely
    // The chicken-and-egg problem: trajectories with no patterns never got to create patterns
    if (trajectory.patterns.length === 0) {
      trajectory.quality = quality;

      // Still attempt auto-pattern creation for high-quality empty-pattern trajectories
      let patternAutoCreated = false;
      if (quality > AUTO_PATTERN_QUALITY_THRESHOLD) {
        try {
          const patternId = await this.createPatternFromTrajectory(trajectory);
          if (patternId) {
            console.log(
              `[SonaEngine] Auto-created pattern ${patternId} from high-quality trajectory ` +
              `${trajectoryId} (no prior patterns - bootstrap)`
            );
            patternAutoCreated = true;
          }
        } catch (error) {
          console.warn('[SonaEngine] Pattern auto-creation failed (empty patterns):', error);
        }
      }

      // ============================================================
      // DATABASE PERSISTENCE FOR EMPTY-PATTERN TRAJECTORIES
      // FIX: This was the bug causing all 598 trajectories to have NULL quality
      // RULE-008: ALL learning feedback MUST be stored in SQLite
      // ============================================================
      if (this.persistenceEnabled && this.trajectoryMetadataDAO) {
        try {
          const status = quality >= 0.5 ? 'completed' : 'failed';
          this.trajectoryMetadataDAO.updateStatus(trajectoryId, status, Date.now());
          this.trajectoryMetadataDAO.updateQuality(trajectoryId, quality);
        } catch (error) {
          console.warn(`[SonaEngine] Failed to persist quality for empty-pattern trajectory ${trajectoryId}:`, error);
        }
      }

      // Also persist learning feedback record for empty-pattern trajectories
      if (this.persistenceEnabled && this.learningFeedbackDAO) {
        try {
          const feedbackId = `fb-${trajectoryId}-${Date.now()}`;
          const feedbackInput: ILearningFeedbackInput = {
            id: feedbackId,
            trajectoryId,
            quality,
            outcome: quality >= 0.5 ? (quality >= 0.8 ? 'positive' : 'neutral') : 'negative',
            taskType: trajectory.route,
            agentId: 'sona-engine',
            resultLength: trajectory.steps?.length ?? 0,
            hasCodeBlocks: false,
            createdAt: Date.now(),
            ...this.mapRlmContextToFeedback(options.rlmContext)
          };
          this.learningFeedbackDAO.insert(feedbackInput);
        } catch (error) {
          console.warn(`[SonaEngine] Failed to persist feedback for empty-pattern trajectory ${trajectoryId}:`, error);
        }
      }

      const elapsedMs = performance.now() - startTime;

      // Emit observability event for feedback on empty-pattern trajectory (TASK-OBS-003)
      const bus = getObservabilityBus();
      bus.emit({
        component: 'sona',
        operation: 'sona_feedback_received',
        status: 'success',
        durationMs: elapsedMs,
        metadata: {
          trajectoryId,
          quality,
          route: trajectory.route,
          patternsUpdated: 0,
          reward: 0,
          patternAutoCreated,
          emptyPatterns: true,
        },
      });

      return {
        trajectoryId,
        patternsUpdated: 0,
        reward: 0,
        patternAutoCreated,
        elapsedMs,
      };
    }

    // 4. Acquire weight update lock
    const release = await this.weightUpdateMutex.acquire();

    try {
      // 5. Get L-Score (use provided or default to 1.0)
      const lScore = options.lScore ?? 1.0;

      // 6. Calculate trajectory success rate
      const trajectorySuccessRate = this.calculateTrajectorySuccessRate(trajectory.route);

      // 7. Ensure route weights and Fisher Information maps exist
      if (!this.weights.has(trajectory.route)) {
        this.weights.set(trajectory.route, new Map<PatternID, Weight>());
      }
      const routeWeights = this.weights.get(trajectory.route)!;
      const routeFisher = this.ensureFisherMap(trajectory.route);

      // 8. Update weights for each pattern
      let patternsUpdated = 0;
      for (const patternId of trajectory.patterns) {
        // Get similarity (from options or default)
        const similarity = options.similarities?.get(patternId) ?? 0.8;

        // Calculate reward
        const reward = calculateReward(quality, lScore, trajectorySuccessRate);

        // Calculate gradient (centered around 0.5)
        const gradient = calculateGradient(reward, similarity);

        // Get Fisher Information (importance)
        const importance = routeFisher.get(patternId) ?? DEFAULT_FISHER_INFORMATION;

        // Calculate weight update with EWC++ regularization
        const weightChange = calculateWeightUpdate(
          gradient,
          this.config.learningRate,
          this.config.regularization,
          importance
        );

        // Get current weight
        const currentWeight = routeWeights.get(patternId) ?? DEFAULT_INITIAL_WEIGHT;

        // Apply update
        let newWeight = currentWeight + weightChange;

        // Clamp to [-1, 1] range
        newWeight = clampWeight(newWeight);

        // NaN/Infinity detection
        if (!Number.isFinite(newWeight)) {
          console.warn(`NaN/Infinity detected in weight update for pattern ${patternId}, skipping`);
          continue;
        }

        // Store updated weight
        routeWeights.set(patternId, newWeight);

        // Update Fisher Information (exponential moving average of squared gradients)
        const newImportance = updateFisherInformation(importance, gradient, FISHER_DECAY_RATE);
        routeFisher.set(patternId, newImportance);

        patternsUpdated++;
      }

      // 9. Calculate cumulative reward for trajectory
      const trajectoryReward = calculateReward(quality, lScore, trajectorySuccessRate);
      trajectory.quality = quality;
      trajectory.reward = trajectoryReward;

      // 10. Auto-create pattern if quality > 0.8
      // FIX: Removed trajectory.patterns.length > 0 requirement to bootstrap learning
      // High-quality trajectories should create patterns even without existing patterns
      // This fixes the chicken-and-egg problem where patterns couldn't be created
      // because no patterns existed to match against
      let patternAutoCreated = false;
      if (quality > AUTO_PATTERN_QUALITY_THRESHOLD) {
        // Set flag to indicate pattern auto-creation was triggered
        patternAutoCreated = true;

        // Attempt to create pattern (may fail if embedding provider not initialized)
        try {
          const patternId = await this.createPatternFromTrajectory(trajectory);
          if (patternId) {
            console.log(`[SonaEngine] Auto-created pattern ${patternId} from high-quality trajectory ${trajectoryId}`);
          }
        } catch (error) {
          console.warn('[SonaEngine] Pattern auto-creation failed:', error);
        }
      }

      // 11. Auto-save weights (throttled)
      if (!options.skipAutoSave) {
        const now = Date.now();
        if (now - this.lastAutoSave > AUTO_SAVE_THROTTLE_MS) {
          try {
            await this.saveWeights();
            this.lastAutoSave = now;
          } catch (error) {
            console.warn('Auto-save failed:', error);
          }
        }
      }

      // 12. Update metrics
      this.metrics.lastUpdated = Date.now();

      // ============================================================
      // DATABASE PERSISTENCE (TASK-PERSIST-006)
      // RULE-008: ALL learning feedback MUST be stored in SQLite
      // ============================================================
      if (this.persistenceEnabled && this.learningFeedbackDAO) {
        try {
          const feedbackId = `fb-${trajectoryId}-${Date.now()}`;
          const feedbackInput: ILearningFeedbackInput = {
            id: feedbackId,
            trajectoryId,
            quality,
            outcome: quality >= 0.5 ? (quality >= 0.8 ? 'positive' : 'neutral') : 'negative',
            taskType: trajectory.route,
            agentId: 'sona-engine', // Will be overridden by caller if available
            resultLength: trajectory.steps?.length ?? 0,
            hasCodeBlocks: false,
            createdAt: Date.now(),
            ...this.mapRlmContextToFeedback(options.rlmContext)
          };
          this.learningFeedbackDAO.insert(feedbackInput);

          // Update trajectory status if completed
          if (this.trajectoryMetadataDAO) {
            const status = quality >= 0.5 ? 'completed' : 'failed';
            this.trajectoryMetadataDAO.updateStatus(trajectoryId, status, Date.now());
            this.trajectoryMetadataDAO.updateQuality(trajectoryId, quality);
          }
        } catch (error) {
          // Log but don't fail - in-memory operations still complete
          console.warn(`[SonaEngine] Failed to persist feedback for ${trajectoryId}:`, error);
        }
      }

      // ============================================================
      // BUG-1 FIX: Wire PatternDAO incrementSuccess/incrementFailure
      // Update pattern success/failure counts based on feedback quality
      // Success threshold: quality >= 0.7
      // ============================================================
      if (this.persistenceEnabled && this.patternDAO) {
        const SUCCESS_THRESHOLD = 0.7;
        for (const patternId of trajectory.patterns) {
          try {
            if (quality >= SUCCESS_THRESHOLD) {
              this.patternDAO.incrementSuccess(patternId);
            } else {
              this.patternDAO.incrementFailure(patternId);
            }
          } catch (error) {
            // Log but don't fail - pattern may not exist in DB yet
            console.warn(`[SonaEngine] Failed to update pattern ${patternId} counts:`, error);
          }
        }
      }

      // 13. Check performance target
      const elapsedMs = performance.now() - startTime;
      if (this.config.trackPerformance && elapsedMs > 15) {
        console.warn(`provideFeedback() took ${elapsedMs.toFixed(2)}ms, exceeds 15ms target`);
      }

      // 14. Emit observability events (TASK-OBS-003)
      const bus = getObservabilityBus();

      // Emit feedback received event
      bus.emit({
        component: 'sona',
        operation: 'sona_feedback_received',
        status: 'success',
        durationMs: elapsedMs,
        metadata: {
          trajectoryId,
          quality,
          route: trajectory.route,
          patternsUpdated,
          reward: trajectoryReward,
          patternAutoCreated,
          lScore: options.lScore ?? 1.0,
        },
      });

      // Emit weight update event if patterns were updated
      if (patternsUpdated > 0) {
        bus.emit({
          component: 'sona',
          operation: 'sona_weight_update',
          status: 'success',
          durationMs: elapsedMs,
          metadata: {
            trajectoryId,
            route: trajectory.route,
            patternsUpdated,
            averageWeight: this.calculateAverageRouteWeight(trajectory.route),
            learningRate: this.config.learningRate,
            regularization: this.config.regularization,
          },
        });
      }

      return {
        trajectoryId,
        patternsUpdated,
        reward: trajectoryReward,
        patternAutoCreated,
        elapsedMs,
      };
    } finally {
      release(); // Release mutex
    }
  }

  /**
   * Calculate average weight for a route (for observability)
   */
  private calculateAverageRouteWeight(route: Route): number {
    const routeWeights = this.weights.get(route);
    if (!routeWeights || routeWeights.size === 0) {
      return 0;
    }
    let sum = 0;
    for (const weight of routeWeights.values()) {
      sum += weight;
    }
    return sum / routeWeights.size;
  }

  /**
   * Ensure Fisher Information map exists for a route
   */
  private ensureFisherMap(route: Route): Map<PatternID, number> {
    if (!this.fisherInformation.has(route)) {
      this.fisherInformation.set(route, new Map<PatternID, number>());
    }
    return this.fisherInformation.get(route)!;
  }

  /**
   * Calculate trajectory success rate for a route
   * (Historical average quality for this route)
   */
  private calculateTrajectorySuccessRate(route: Route): number {
    const routeTrajectories = this.listTrajectories(route);
    const qualityScores = routeTrajectories
      .filter(t => t.quality !== undefined)
      .map(t => t.quality!);

    if (qualityScores.length === 0) {
      return 0.5; // Default success rate
    }

    return arithmeticMean(qualityScores);
  }

  /**
   * Get Fisher Information for a pattern
   */
  getFisherInformation(patternId: PatternID, route: Route): number {
    const routeFisher = this.fisherInformation.get(route);
    if (!routeFisher) {
      return DEFAULT_FISHER_INFORMATION;
    }
    return routeFisher.get(patternId) ?? DEFAULT_FISHER_INFORMATION;
  }

  /**
   * Set Fisher Information for a pattern (for testing)
   */
  setFisherInformation(patternId: PatternID, route: Route, importance: number): void {
    const routeFisher = this.ensureFisherMap(route);
    routeFisher.set(patternId, importance);
  }

  // ==================== Binary Weight Persistence ====================

  /**
   * Save weights to binary file
   *
   * @param path - Optional file path (uses default if not provided)
   */
  async saveWeights(path?: string): Promise<void> {
    const targetPath = path ?? this.weightsFilePath;

    try {
      // 1. Flush trajectory stream manager to prevent data loss (TRAJ-001 fix)
      if (this.streamManager) {
        await this.streamManager.flush();
      }

      // 2. Ensure directory exists
      const dir = dirname(targetPath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      // 3. Serialize weights to binary format
      const serialized = this.serializeWeightsBinary();

      // 4. Write to temp file + rename (atomic write)
      const tempPath = `${targetPath}.tmp`;
      await writeFile(tempPath, serialized);
      await rename(tempPath, targetPath);
    } catch (error) {
      throw new WeightPersistenceError('save', (error as Error).message);
    }
  }

  /**
   * Load weights from binary file
   *
   * @param path - File path to load from
   */
  async loadWeights(path?: string): Promise<void> {
    const targetPath = path ?? this.weightsFilePath;

    // 1. Check if file exists
    if (!existsSync(targetPath)) {
      console.warn(`Weights file ${targetPath} not found, initializing with defaults`);
      return;
    }

    try {
      // 2. Read binary file
      const buffer = await readFile(targetPath);

      // 3. Deserialize
      this.deserializeWeightsBinary(buffer);
    } catch (error) {
      throw new WeightPersistenceError('load', (error as Error).message);
    }
  }

  /**
   * Serialize weights to binary format
   * Format: [version(4), metadataLen(4), metadata(JSON), weights(Float32), fisher(Float32), checksum(4)]
   */
  private serializeWeightsBinary(): Buffer {
    // 1. Build pattern mapping
    const patternMapping: Array<{ route: Route; patternId: PatternID }> = [];
    for (const [route, routeWeights] of this.weights.entries()) {
      for (const patternId of routeWeights.keys()) {
        patternMapping.push({ route, patternId });
      }
    }

    // 2. Prepare metadata
    const metadata: IWeightFileMetadata = {
      version: WEIGHT_FILE_VERSION,
      routes: Array.from(this.weights.keys()),
      patternCounts: Object.fromEntries(
        Array.from(this.weights.entries()).map(([route, weights]) => [route, weights.size])
      ),
      timestamp: Date.now(),
      patternMapping,
    };
    const metadataJson = JSON.stringify(metadata);
    const metadataBuffer = Buffer.from(metadataJson, 'utf-8');

    // 3. Serialize weights
    const weightsData: number[] = [];
    for (const { route, patternId } of patternMapping) {
      const routeWeights = this.weights.get(route);
      const weight = routeWeights?.get(patternId) ?? DEFAULT_INITIAL_WEIGHT;
      weightsData.push(weight);
    }

    const weightsBuffer = Buffer.allocUnsafe(weightsData.length * 4);
    for (let i = 0; i < weightsData.length; i++) {
      weightsBuffer.writeFloatLE(weightsData[i], i * 4);
    }

    // 4. Serialize Fisher Information
    const fisherData: number[] = [];
    for (const { route, patternId } of patternMapping) {
      const routeFisher = this.fisherInformation.get(route);
      const importance = routeFisher?.get(patternId) ?? DEFAULT_FISHER_INFORMATION;
      fisherData.push(importance);
    }

    const fisherBuffer = Buffer.allocUnsafe(fisherData.length * 4);
    for (let i = 0; i < fisherData.length; i++) {
      fisherBuffer.writeFloatLE(fisherData[i], i * 4);
    }

    // 5. Assemble buffer (without checksum)
    const versionBuffer = Buffer.allocUnsafe(4);
    versionBuffer.writeUInt32LE(WEIGHT_FILE_VERSION, 0);

    const metadataLengthBuffer = Buffer.allocUnsafe(4);
    metadataLengthBuffer.writeUInt32LE(metadataBuffer.length, 0);

    const dataBuffer = Buffer.concat([
      versionBuffer,
      metadataLengthBuffer,
      metadataBuffer,
      weightsBuffer,
      fisherBuffer,
    ]);

    // 6. Calculate checksum
    const checksum = crc32(dataBuffer);
    const checksumBuffer = Buffer.allocUnsafe(4);
    checksumBuffer.writeUInt32LE(checksum, 0);

    return Buffer.concat([dataBuffer, checksumBuffer]);
  }

  /**
   * Deserialize weights from binary format
   */
  private deserializeWeightsBinary(buffer: Buffer): void {
    // 1. Parse version
    const version = buffer.readUInt32LE(0);
    if (version !== WEIGHT_FILE_VERSION) {
      throw new Error(`Unsupported weights file version: ${version}`);
    }

    // 2. Parse metadata
    const metadataLength = buffer.readUInt32LE(4);
    const metadataBuffer = buffer.subarray(8, 8 + metadataLength);
    const metadata: IWeightFileMetadata = JSON.parse(metadataBuffer.toString('utf-8'));

    if (!metadata.patternMapping) {
      throw new Error('Weight file missing pattern mapping');
    }

    // 3. Calculate expected sizes
    const patternCount = metadata.patternMapping.length;
    const weightsStart = 8 + metadataLength;
    const weightsEnd = weightsStart + (patternCount * 4);
    const fisherEnd = weightsEnd + (patternCount * 4);
    const checksumStart = fisherEnd;

    // 4. Verify checksum
    const storedChecksum = buffer.readUInt32LE(checksumStart);
    const calculatedChecksum = crc32(buffer.subarray(0, checksumStart));
    if (storedChecksum !== calculatedChecksum) {
      throw new Error(`Checksum mismatch: stored=${storedChecksum}, calculated=${calculatedChecksum}`);
    }

    // 5. Parse weights
    const weightsBuffer = buffer.subarray(weightsStart, weightsEnd);
    const fisherBuffer = buffer.subarray(weightsEnd, fisherEnd);

    // 6. Clear existing data
    this.weights.clear();
    this.fisherInformation.clear();

    // 7. Reconstruct weight maps
    for (let i = 0; i < patternCount; i++) {
      const { route, patternId } = metadata.patternMapping[i];
      const weight = weightsBuffer.readFloatLE(i * 4);
      const fisher = fisherBuffer.readFloatLE(i * 4);

      // Ensure route map exists
      if (!this.weights.has(route)) {
        this.weights.set(route, new Map<PatternID, Weight>());
      }
      if (!this.fisherInformation.has(route)) {
        this.fisherInformation.set(route, new Map<PatternID, number>());
      }

      this.weights.get(route)!.set(patternId, weight);
      this.fisherInformation.get(route)!.set(patternId, fisher);
    }
  }

  /**
   * Export state for persistence
   */
  toJSON(): ISerializedSonaState {
    // Serialize trajectories
    const trajectories: ISerializedTrajectory[] = Array.from(this.trajectories.values()).map(t => ({
      id: t.id,
      route: t.route,
      patterns: t.patterns,
      context: t.context,
      createdAt: t.createdAt,
      quality: t.quality,
      reward: t.reward,
    }));

    // Serialize weights
    const weights: ISerializedRouteWeights[] = [];
    for (const [route, routeWeights] of this.weights) {
      const weightEntries = Array.from(routeWeights.entries()).map(([patternId, weight]) => ({
        patternId,
        weight,
      }));
      weights.push({ route, weights: weightEntries });
    }

    return {
      version: '1.0.0',
      trajectories,
      weights,
      timestamp: Date.now(),
    };
  }

  /**
   * Import state from persistence
   */
  fromJSON(data: ISerializedSonaState): void {
    this.clear();

    // Import trajectories
    for (const t of data.trajectories) {
      const trajectory: ITrajectory = {
        id: t.id,
        route: t.route,
        patterns: t.patterns,
        context: t.context,
        createdAt: t.createdAt,
        quality: t.quality,
        reward: t.reward,
      };
      this.trajectories.set(t.id, trajectory);
    }

    // Import weights
    for (const rw of data.weights) {
      const routeWeights: RouteWeights = new Map();
      for (const entry of rw.weights) {
        routeWeights.set(entry.patternId, entry.weight);
      }
      this.weights.set(rw.route, routeWeights);
    }

    // Update metrics
    this.metrics.totalTrajectories = this.trajectories.size;
    for (const route of this.weights.keys()) {
      this.metrics.trajectoriesByRoute[route] = this.listTrajectories(route).length;
    }
    this.metrics.lastUpdated = Date.now();
  }

  /**
   * Get statistics about the Sona Engine
   */
  getStats(): {
    trajectoryCount: number;
    routeCount: number;
    totalPatterns: number;
    avgPatternsPerRoute: number;
  } {
    const routes = this.getRoutes();
    let totalPatterns = 0;
    for (const route of routes) {
      totalPatterns += this.getPatternCount(route);
    }

    return {
      trajectoryCount: this.trajectories.size,
      routeCount: routes.length,
      totalPatterns,
      avgPatternsPerRoute: routes.length > 0 ? totalPatterns / routes.length : 0,
    };
  }

  /**
   * Get feedback health diagnostics (TRAJECTORY-ORPHAN-FIX diagnostic)
   *
   * Checks the health of the feedback system, specifically tracking:
   * - Hook-generated trajectories created on-demand
   * - Session-end trajectories created on-demand
   * - Overall feedback success rate
   *
   * @returns Feedback health metrics
   */
  getFeedbackHealth(): {
    totalTrajectories: number;
    hookTrajectories: number;
    sessionEndTrajectories: number;
    onDemandCreatedCount: number;
    feedbackSuccessRate: number;
    status: 'healthy' | 'degraded' | 'critical';
    recommendations: string[];
  } {
    let hookTrajectories = 0;
    let sessionEndTrajectories = 0;
    let onDemandCreated = 0;

    // Count trajectory types
    for (const [id, trajectory] of this.trajectories) {
      if (id.startsWith('hook-')) {
        hookTrajectories++;
        // Check if created on-demand via context
        if (trajectory.context?.some(c => c.startsWith('created-on-demand-'))) {
          onDemandCreated++;
        }
      } else if (id.startsWith('session-end-')) {
        sessionEndTrajectories++;
        if (trajectory.context?.some(c => c.startsWith('created-on-demand-'))) {
          onDemandCreated++;
        }
      }
    }

    // Calculate feedback success rate from database
    let feedbackSuccessRate = 0;
    if (this.persistenceEnabled && this.learningFeedbackDAO) {
      const stats = this.learningFeedbackDAO.getStats();
      const positiveCount = stats.outcomeBreakdown?.positive ?? 0;
      const neutralCount = stats.outcomeBreakdown?.neutral ?? 0;
      const negativeCount = stats.outcomeBreakdown?.negative ?? 0;
      const total = positiveCount + neutralCount + negativeCount;
      if (total > 0) {
        feedbackSuccessRate = (positiveCount + neutralCount) / total;
      }
    }

    // Determine health status
    const recommendations: string[] = [];
    let status: 'healthy' | 'degraded' | 'critical' = 'healthy';

    if (feedbackSuccessRate < 0.5) {
      status = 'critical';
      recommendations.push('Feedback success rate below 50% - check trajectory registration');
    } else if (feedbackSuccessRate < 0.7) {
      status = 'degraded';
      recommendations.push('Feedback success rate below 70% - review learning parameters');
    }

    if (onDemandCreated > 0 && hookTrajectories > 0) {
      const onDemandRatio = onDemandCreated / (hookTrajectories + sessionEndTrajectories);
      if (onDemandRatio > 0.9) {
        recommendations.push(
          'High on-demand trajectory creation - consider pre-registering trajectories in post-task hook'
        );
      }
    }

    return {
      totalTrajectories: this.trajectories.size,
      hookTrajectories,
      sessionEndTrajectories,
      onDemandCreatedCount: onDemandCreated,
      feedbackSuccessRate,
      status,
      recommendations,
    };
  }

  // ==================== TASK-SON-003: Drift Detection and Checkpointing ====================

  /**
   * Set the checkpoints directory path
   */
  setCheckpointsDir(path: string): void {
    this.checkpointsDir = path;
  }

  /**
   * Set baseline weights (for drift comparison)
   */
  setBaselineWeights(weights?: WeightStorage): void {
    if (weights) {
      this.baselineWeights = this.deepCopyWeights(weights);
    } else {
      // Use current weights as baseline
      this.baselineWeights = this.deepCopyWeights(this.weights);
    }
  }

  /**
   * Check drift from baseline weights
   *
   * @param autoRollback - If true, automatically rollback when drift > reject threshold
   * @returns Drift metrics
   */
  async checkDrift(autoRollback: boolean = true): Promise<IDriftMetrics> {
    const startTime = performance.now();

    // 1. Flatten current weights to single vector
    const currentWeightsVector = this.flattenWeightsToVector(this.weights);

    // 2. If baseline empty, initialize from current
    if (this.baselineWeights.size === 0) {
      this.baselineWeights = this.deepCopyWeights(this.weights);
      const result: IDriftMetrics = {
        currentWeights: currentWeightsVector,
        baselineWeights: currentWeightsVector,
        drift: 0.0,
        alertThreshold: this.config.driftAlertThreshold,
        rejectThreshold: this.config.driftRejectThreshold,
        timestamp: Date.now(),
        status: 'NORMAL',
      };
      return result;
    }

    // 3. Flatten baseline weights
    const baselineWeightsVector = this.flattenWeightsToVector(this.baselineWeights);

    // 4. Handle size mismatch (new patterns added)
    let adjustedBaseline = baselineWeightsVector;
    if (currentWeightsVector.length !== baselineWeightsVector.length) {
      adjustedBaseline = new Float32Array(currentWeightsVector.length);
      for (let i = 0; i < adjustedBaseline.length; i++) {
        adjustedBaseline[i] = i < baselineWeightsVector.length ? baselineWeightsVector[i] : 0;
      }
    }

    // 5. Calculate cosine similarity and drift
    const similarity = cosineSimilarity(currentWeightsVector, adjustedBaseline);
    const drift = 1 - similarity;

    // 6. Determine status
    let status: DriftStatus = 'NORMAL';
    if (drift > this.config.driftRejectThreshold) {
      status = 'REJECT';
      console.warn(`Drift REJECT: ${drift.toFixed(4)} > ${this.config.driftRejectThreshold} threshold`);

      // Auto-rollback if enabled
      if (autoRollback) {
        await this.rollbackToCheckpoint();
      }
    } else if (drift > this.config.driftAlertThreshold) {
      status = 'ALERT';
      console.warn(`Drift ALERT: ${drift.toFixed(4)} > ${this.config.driftAlertThreshold} threshold`);
    }

    // 7. Update metrics
    this.metrics.currentDrift = drift;

    // 8. Get most recent checkpoint ID
    const checkpointId = this.getMostRecentCheckpointId();

    // 9. Check performance target
    const elapsedMs = performance.now() - startTime;
    if (this.config.trackPerformance && elapsedMs > 5) {
      console.warn(`checkDrift() took ${elapsedMs.toFixed(2)}ms, exceeds 5ms target`);
    }

    // 10. Emit observability event for drift detection (TASK-OBS-003)
    const bus = getObservabilityBus();
    bus.emit({
      component: 'sona',
      operation: 'sona_drift_detected',
      status: status === 'REJECT' ? 'error' : status === 'ALERT' ? 'warning' : 'success',
      durationMs: elapsedMs,
      metadata: {
        drift,
        status,
        alertThreshold: this.config.driftAlertThreshold,
        rejectThreshold: this.config.driftRejectThreshold,
        checkpointId,
        autoRollback,
        vectorDimension: currentWeightsVector.length,
        similarity,
      },
    });

    return {
      currentWeights: currentWeightsVector,
      baselineWeights: adjustedBaseline,
      drift,
      alertThreshold: this.config.driftAlertThreshold,
      rejectThreshold: this.config.driftRejectThreshold,
      timestamp: Date.now(),
      checkpointId,
      status,
    };
  }

  /**
   * Create a checkpoint of current weights
   *
   * @param reason - Reason for creating checkpoint
   * @param markAsBaseline - Optional flag to mark checkpoint as baseline (TECH-TRJ-001)
   * @returns Checkpoint ID
   */
  async createCheckpoint(reason: CheckpointReason = 'manual', markAsBaseline?: boolean): Promise<string> {
    const startTime = performance.now();

    // 1. Generate checkpoint ID
    const checkpointId = generateCheckpointID();

    // 2. Calculate current drift (without auto-rollback)
    const driftMetrics = await this.checkDrift(false);

    // 3. Determine if this should be a baseline (TECH-TRJ-001)
    const isBaseline = markAsBaseline ?? this.shouldAutoMarkAsBaseline();

    // 4. Deep copy weights and Fisher Information
    const weightSnapshot = this.deepCopyWeights(this.weights);
    const fisherSnapshot = this.deepCopyWeights(this.fisherInformation);

    // 5. Calculate metadata
    const trajectoriesProcessed = this.trajectories.size;
    const trajectoriesWithQuality = Array.from(this.trajectories.values())
      .filter(t => t.quality !== undefined);
    const averageQuality = trajectoriesWithQuality.length > 0
      ? trajectoriesWithQuality.reduce((sum, t) => sum + (t.quality || 0), 0) / trajectoriesWithQuality.length
      : 0;

    // 6. Create checkpoint object
    const checkpoint: ICheckpointFull = {
      id: checkpointId,
      weights: weightSnapshot,
      fisherInformation: fisherSnapshot,
      timestamp: Date.now(),
      drift: driftMetrics.drift,
      metadata: {
        trajectoriesProcessed,
        averageQuality,
        reason,
      },
    };

    // 7. Store in memory
    this.checkpoints.set(checkpointId, checkpoint);

    // 8. Track baseline if marked (TECH-TRJ-001)
    if (isBaseline) {
      this.baselineCheckpointIds.add(checkpointId);
      console.log(`[SonaEngine] Created BASELINE checkpoint ${checkpointId}`);
    }

    // 9. Persist to disk
    await this.saveCheckpoint(checkpoint);

    // 10. Prune old checkpoints
    await this.pruneCheckpoints();

    // 11. Update metrics
    this.metrics.checkpointsCreated++;

    // 12. Reset rollback state if progressed (TECH-TRJ-001)
    this.resetRollbackStateIfProgressed();

    // 13. Check performance target
    const elapsedMs = performance.now() - startTime;
    if (this.config.trackPerformance && elapsedMs > 50) {
      console.warn(`createCheckpoint() took ${elapsedMs.toFixed(2)}ms, exceeds 50ms target`);
    }

    // 14. Emit observability event for checkpoint creation (TASK-OBS-003)
    const bus = getObservabilityBus();
    bus.emit({
      component: 'sona',
      operation: 'sona_checkpoint_created',
      status: 'success',
      durationMs: elapsedMs,
      metadata: {
        checkpointId,
        reason,
        isBaseline,
        drift: driftMetrics.drift,
        trajectoriesProcessed,
        averageQuality,
        totalCheckpoints: this.checkpoints.size,
        totalCheckpointsCreated: this.metrics.checkpointsCreated,
      },
    });

    return checkpointId;
  }

  /**
   * Rollback weights to a checkpoint
   *
   * @param checkpointId - Specific checkpoint ID (uses most recent if not provided)
   * @throws RollbackLoopError if too many rollbacks in short time or attempting to rollback to same checkpoint without progress (TECH-TRJ-001)
   */
  async rollbackToCheckpoint(checkpointId?: string): Promise<void> {
    const startTime = performance.now();
    const targetId = checkpointId ?? this.getMostRecentCheckpointId();

    // Note: targetId can be undefined if no checkpoints exist - this is handled later

    // 1. CRITICAL-004: Check for rollback loop BEFORE executing rollback (TECH-TRJ-001)
    if (targetId && this.streamManager && this.rollbackState.lastRollbackCheckpointId === targetId) {
      // Check if we've progressed past this checkpoint since last rollback
      const hasProgressed = await this.hasProgressedPastCheckpoint(targetId);

      if (!hasProgressed) {
        // This is a loop - rolling back to same checkpoint without progress
        throw new RollbackLoopError(
          this.rollbackState.rollbackCount,
          Date.now() - (this.rollbackState.lastRollbackAt ?? 0)
        );
      }

      // Progressed past checkpoint, reset state and allow rollback
      console.log(`[SonaEngine] Allowing re-rollback to ${targetId} - learning progressed past checkpoint`);
    }

    // 2. Detect rollback loop (original logic)
    const now = Date.now();
    if (now - this.lastRollbackTime < SonaEngine.ROLLBACK_WINDOW_MS) {
      this.rollbackCount++;
      if (this.rollbackCount >= SonaEngine.MAX_ROLLBACKS_IN_WINDOW) {
        throw new RollbackLoopError(this.rollbackCount, SonaEngine.ROLLBACK_WINDOW_MS);
      }
    } else {
      this.rollbackCount = 1;
    }
    this.lastRollbackTime = now;

    // 3. Get checkpoint to restore
    let checkpoint: ICheckpointFull | undefined;
    if (targetId) {
      checkpoint = this.checkpoints.get(targetId);
    } else {
      checkpoint = this.getMostRecentCheckpoint();
    }

    if (!checkpoint) {
      // No checkpoint available, restore to baseline (0.5 for all weights)
      console.warn('No checkpoint available for rollback, restoring to baseline');
      if (this.baselineWeights.size > 0) {
        this.weights = this.deepCopyWeights(this.baselineWeights);
        this.fisherInformation.clear();
      } else {
        // If no baseline, reset all weights to default (0.5)
        for (const [route, routeWeights] of this.weights.entries()) {
          for (const patternId of routeWeights.keys()) {
            routeWeights.set(patternId, DEFAULT_INITIAL_WEIGHT);
          }
        }
      }

      // Save restored weights to disk
      await this.saveWeights();

      // Update metrics
      this.metrics.rollbacksTriggered++;

      // Emit observability event for baseline rollback (TASK-OBS-003)
      const elapsedMs = performance.now() - startTime;
      const bus = getObservabilityBus();
      bus.emit({
        component: 'sona',
        operation: 'sona_rollback_triggered',
        status: 'warning',
        durationMs: elapsedMs,
        metadata: {
          checkpointId: null,
          rollbackType: 'baseline',
          reason: 'no_checkpoint_available',
          rollbackCount: this.metrics.rollbacksTriggered,
        },
      });

      return;
    }

    // 4. Record this rollback in stream manager (TECH-TRJ-001)
    if (this.streamManager && targetId) {
      await this.streamManager.recordRollback(targetId);
    }

    // 5. Update local rollback state (TECH-TRJ-001)
    this.rollbackState = {
      lastRollbackCheckpointId: targetId ?? null,
      lastRollbackAt: Date.now(),
      rollbackCount: this.rollbackState.rollbackCount + 1
    };

    // 6. Restore weights and Fisher Information
    this.weights = this.deepCopyWeights(checkpoint.weights);
    this.fisherInformation = this.deepCopyWeights(checkpoint.fisherInformation);

    // 7. Save restored weights to disk
    await this.saveWeights();

    // 8. Update metrics
    this.metrics.rollbacksTriggered++;

    // 9. Check performance target
    const elapsedMs = performance.now() - startTime;
    if (this.config.trackPerformance && elapsedMs > 100) {
      console.warn(`rollbackToCheckpoint() took ${elapsedMs.toFixed(2)}ms, exceeds 100ms target`);
    }

    // 10. Emit observability event for rollback (TASK-OBS-003)
    const bus = getObservabilityBus();
    bus.emit({
      component: 'sona',
      operation: 'sona_rollback_triggered',
      status: 'success',
      durationMs: elapsedMs,
      metadata: {
        checkpointId: checkpoint.id,
        checkpointTimestamp: checkpoint.timestamp,
        checkpointDrift: checkpoint.drift,
        checkpointReason: checkpoint.metadata.reason,
        rollbackCount: this.metrics.rollbacksTriggered,
        rollbackType: 'checkpoint',
      },
    });

    console.info(`Weights rolled back to checkpoint: ${checkpoint.id}`);
  }

  /**
   * Get checkpoint by ID
   */
  getCheckpoint(checkpointId: string): ICheckpointFull | undefined {
    return this.checkpoints.get(checkpointId);
  }

  /**
   * List all checkpoints
   */
  listCheckpoints(): ICheckpointFull[] {
    return Array.from(this.checkpoints.values())
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get checkpoint count
   */
  getCheckpointCount(): number {
    return this.checkpoints.size;
  }

  // ==================== Checkpoint Persistence ====================

  /**
   * Save a checkpoint to disk
   */
  private async saveCheckpoint(checkpoint: ICheckpointFull): Promise<void> {
    try {
      // Ensure directory exists
      if (!existsSync(this.checkpointsDir)) {
        await mkdir(this.checkpointsDir, { recursive: true });
      }

      // Serialize checkpoint
      const serialized = this.serializeCheckpoint(checkpoint);
      const filePath = join(this.checkpointsDir, `${checkpoint.id}.json`);

      await writeFile(filePath, JSON.stringify(serialized, null, 2));
    } catch (error) {
      throw new CheckpointError('save', (error as Error).message);
    }
  }

  /**
   * Load a checkpoint from disk
   */
  async loadCheckpoint(checkpointId: string): Promise<ICheckpointFull | undefined> {
    const filePath = join(this.checkpointsDir, `${checkpointId}.json`);

    if (!existsSync(filePath)) {
      return undefined;
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const serialized: ISerializedCheckpoint = JSON.parse(content);
      return this.deserializeCheckpoint(serialized);
    } catch (error) {
      throw new CheckpointError('load', (error as Error).message);
    }
  }

  /**
   * Load all checkpoints from disk
   */
  async loadAllCheckpoints(): Promise<void> {
    if (!existsSync(this.checkpointsDir)) {
      return;
    }

    try {
      const files = await readdir(this.checkpointsDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const checkpointId = file.replace('.json', '');
          const checkpoint = await this.loadCheckpoint(checkpointId);
          if (checkpoint) {
            this.checkpoints.set(checkpoint.id, checkpoint);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load checkpoints:', error);
    }
  }

  /**
   * Prune old checkpoints (keep last N)
   */
  private async pruneCheckpoints(): Promise<void> {
    const maxCheckpoints = this.config.maxCheckpoints;
    if (this.checkpoints.size <= maxCheckpoints) {
      return;
    }

    // Sort by timestamp (oldest first)
    const sorted = Array.from(this.checkpoints.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    // Remove oldest checkpoints
    const toRemove = sorted.slice(0, sorted.length - maxCheckpoints);
    for (const checkpoint of toRemove) {
      this.checkpoints.delete(checkpoint.id);

      // Delete file
      const filePath = join(this.checkpointsDir, `${checkpoint.id}.json`);
      try {
        if (existsSync(filePath)) {
          await unlink(filePath);
        }
      } catch {
        // INTENTIONAL: Checkpoint file deletion errors are non-critical during cleanup
      }
    }
  }

  // ==================== Checkpoint Serialization ====================

  /**
   * Serialize checkpoint for persistence
   */
  private serializeCheckpoint(checkpoint: ICheckpointFull): ISerializedCheckpoint {
    const weights: ISerializedCheckpoint['weights'] = [];
    for (const [route, routeWeights] of checkpoint.weights) {
      weights.push({
        route,
        patterns: Array.from(routeWeights.entries()).map(([id, weight]) => ({ id, weight })),
      });
    }

    const fisherInformation: ISerializedCheckpoint['fisherInformation'] = [];
    for (const [route, routeFisher] of checkpoint.fisherInformation) {
      fisherInformation.push({
        route,
        patterns: Array.from(routeFisher.entries()).map(([id, importance]) => ({ id, importance })),
      });
    }

    return {
      id: checkpoint.id,
      weights,
      fisherInformation,
      timestamp: checkpoint.timestamp,
      drift: checkpoint.drift,
      metadata: checkpoint.metadata,
    };
  }

  /**
   * Deserialize checkpoint from persistence
   */
  private deserializeCheckpoint(serialized: ISerializedCheckpoint): ICheckpointFull {
    const weights: WeightStorage = new Map();
    for (const { route, patterns } of serialized.weights) {
      const routeWeights = new Map<PatternID, Weight>();
      for (const { id, weight } of patterns) {
        routeWeights.set(id, weight);
      }
      weights.set(route, routeWeights);
    }

    const fisherInformation: FisherInformationStorage = new Map();
    for (const { route, patterns } of serialized.fisherInformation) {
      const routeFisher = new Map<PatternID, number>();
      for (const { id, importance } of patterns) {
        routeFisher.set(id, importance);
      }
      fisherInformation.set(route, routeFisher);
    }

    return {
      id: serialized.id,
      weights,
      fisherInformation,
      timestamp: serialized.timestamp,
      drift: serialized.drift,
      metadata: serialized.metadata,
    };
  }

  // ==================== Utility Methods ====================

  /**
   * Flatten weights map to Float32Array
   */
  private flattenWeightsToVector(weights: WeightStorage): Float32Array {
    const allWeights: number[] = [];
    for (const routeWeights of weights.values()) {
      for (const weight of routeWeights.values()) {
        allWeights.push(weight);
      }
    }
    return new Float32Array(allWeights);
  }

  /**
   * Deep copy weights map
   */
  private deepCopyWeights<T>(weights: Map<Route, Map<PatternID, T>>): Map<Route, Map<PatternID, T>> {
    const copy = new Map<Route, Map<PatternID, T>>();
    for (const [route, routeWeights] of weights.entries()) {
      const routeCopy = new Map<PatternID, T>();
      for (const [patternId, value] of routeWeights.entries()) {
        routeCopy.set(patternId, value);
      }
      copy.set(route, routeCopy);
    }
    return copy;
  }

  /**
   * Get the most recent checkpoint
   */
  private getMostRecentCheckpoint(): ICheckpointFull | undefined {
    if (this.checkpoints.size === 0) {
      return undefined;
    }

    let mostRecent: ICheckpointFull | undefined;
    for (const checkpoint of this.checkpoints.values()) {
      if (!mostRecent || checkpoint.timestamp > mostRecent.timestamp) {
        mostRecent = checkpoint;
      }
    }
    return mostRecent;
  }

  /**
   * Get the most recent checkpoint ID
   */
  private getMostRecentCheckpointId(): string | undefined {
    const mostRecent = this.getMostRecentCheckpoint();
    return mostRecent?.id;
  }

  /**
   * Reset rollback counter (for testing)
   */
  resetRollbackCounter(): void {
    this.rollbackCount = 0;
    this.lastRollbackTime = 0;
  }

  // ==================== Pattern Auto-Creation ====================

  /**
   * Create a reusable pattern from a high-quality trajectory
   * SPEC-SON-001: Now uses real steps from trajectory
   *
   * @param trajectory - High-quality trajectory to convert to pattern
   * @returns Pattern ID if created, null otherwise
   */
  private async createPatternFromTrajectory(trajectory: ITrajectory): Promise<string | null> {
    // Validate trajectory has steps (log warning but continue if missing)
    if (!trajectory.steps || trajectory.steps.length === 0) {
      console.warn(`[SonaEngine] Trajectory ${trajectory.id} has no steps for pattern creation`);
      // Still create pattern but log warning
    }

    // Only create patterns from high-quality trajectories
    if (!trajectory.quality || trajectory.quality < AUTO_PATTERN_QUALITY_THRESHOLD) {
      return null;
    }

    try {
      // Generate pattern embedding from trajectory
      const patternEmbedding = await this.generatePatternEmbedding(trajectory);

      // Compress steps for storage efficiency
      const compressedSteps = this.compressStepsForPattern(trajectory.steps || []);

      // Generate human-readable description
      const description = this.generatePatternDescription(trajectory);

      // Extract domain and tags
      const domain = this.inferDomain(trajectory.route);
      const tags = this.extractTags(trajectory);

      // Create pattern metadata
      const pattern: Pattern = {
        id: `pattern_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        sourceTrajectory: trajectory.id,
        embedding: patternEmbedding,
        quality: trajectory.quality,
        steps: compressedSteps, // ✅ Real steps, not empty array
        createdAt: Date.now(),
        usageCount: 0,
        taskType: 'learning',
        template: description,
        successRate: trajectory.quality,
        sonaWeight: trajectory.quality,
        updatedAt: new Date(),
        metadata: {
          domain,
          description,
          tags,
          stepCount: compressedSteps.length,
          compressionRatio: trajectory.steps
            ? (compressedSteps.length / trajectory.steps.length).toFixed(2)
            : '0',
        },
      };

      // Store in patterns map
      this.patterns.set(pattern.id, pattern);

      // ============================================================
      // DATABASE PERSISTENCE (TASK-PERSIST-007)
      // RULE-008: ALL pattern data MUST be stored in SQLite
      // ============================================================
      if (this.persistenceEnabled && this.patternDAO) {
        try {
          const patternInput: IPatternInput = {
            id: pattern.id,
            name: `pattern-${trajectory.route}-${Date.now()}`,
            context: JSON.stringify({
              sourceTrajectory: trajectory.id,
              route: trajectory.route,
              domain
            }),
            action: pattern.template || description,
            outcome: trajectory.quality >= 0.8 ? 'success' : 'partial',
            embedding: patternEmbedding,
            weight: pattern.sonaWeight ?? 0.5,
            trajectoryIds: [trajectory.id],
            agentId: 'sona-engine',
            taskType: trajectory.route,
            createdAt: pattern.createdAt,
            tags: tags
          };
          this.patternDAO.insert(patternInput);
        } catch (error) {
          // Log but don't fail - in-memory storage still works
          console.warn(`[SonaEngine] Failed to persist pattern ${pattern.id}:`, error);
        }
      }

      // Update metrics
      this.metrics.patternsCreated++;

      // FIX: Notify callback to add pattern to PatternStore for reasoning
      if (this.patternCreatedCallback) {
        try {
          await this.patternCreatedCallback(pattern);
          console.info(`[SonaEngine] Pattern ${pattern.id} synced to PatternStore`);
        } catch (callbackError) {
          console.warn(`[SonaEngine] Failed to sync pattern to PatternStore:`, callbackError);
        }
      }

      console.info(
        `[SonaEngine] Created pattern ${pattern.id} from trajectory ${trajectory.id} ` +
        `(quality: ${trajectory.quality.toFixed(3)}, steps: ${compressedSteps.length})`
      );

      // Emit observability event for pattern learned (TASK-OBS-003)
      const bus = getObservabilityBus();
      bus.emit({
        component: 'sona',
        operation: 'sona_pattern_learned',
        status: 'success',
        metadata: {
          patternId: pattern.id,
          sourceTrajectory: trajectory.id,
          route: trajectory.route,
          quality: trajectory.quality,
          stepCount: compressedSteps.length,
          domain,
          tags,
          totalPatternsCreated: this.metrics.patternsCreated,
        },
      });

      return pattern.id;
    } catch (error) {
      console.warn('[SonaEngine] Failed to create pattern from trajectory:', error);

      // Emit error event (TASK-OBS-003)
      const bus = getObservabilityBus();
      bus.emit({
        component: 'sona',
        operation: 'sona_pattern_learned',
        status: 'error',
        metadata: {
          trajectoryId: trajectory.id,
          route: trajectory.route,
          error: error instanceof Error ? error.message : String(error),
        },
      });

      return null;
    }
  }

  /**
   * Compress steps for storage efficiency
   * SPEC-SON-001
   */
  private compressStepsForPattern(steps: IReasoningStep[]): IReasoningStep[] {
    const maxStepsInPattern = 50; // Limit steps per pattern
    const maxResultLength = 500; // Truncate results

    // If too many steps, sample important ones
    let selectedSteps = steps;
    if (steps.length > maxStepsInPattern) {
      // Keep first, last, and sample middle
      const middle = steps.slice(1, -1);
      const sampleRate = Math.floor(middle.length / (maxStepsInPattern - 2));
      const sampledMiddle = middle.filter((_, i) => i % sampleRate === 0);
      selectedSteps = [steps[0], ...sampledMiddle.slice(0, maxStepsInPattern - 2), steps[steps.length - 1]];
    }

    return selectedSteps.map(step => {
      // FIX: Handle undefined result
      const result = step.result ?? '';
      const resultLength = result.length;

      return {
        stepId: step.stepId,
        action: step.action,
        actionParams: this.compressParams(step.actionParams),
        result: resultLength > maxResultLength
          ? result.slice(0, maxResultLength) + '...'
          : result,
        confidence: step.confidence ?? 0.5,
        timestamp: step.timestamp,
        resultRef: resultLength > maxResultLength
          ? { type: 'memory' as const, id: `${step.stepId}_full` }
          : step.resultRef,
        metadata: {
          duration: step.metadata?.duration,
          patternId: step.metadata?.patternId,
        },
      };
    });
  }

  /**
   * Compress action parameters
   */
  private compressParams(params: Record<string, unknown> | undefined | null): Record<string, unknown> {
    // FIX: Handle undefined/null params
    if (!params) {
      return {};
    }

    const compressed: Record<string, unknown> = {};
    const maxValueLength = 200;
    const maxArrayLength = 10;

    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string' && value.length > maxValueLength) {
        compressed[key] = value.slice(0, maxValueLength) + '...';
      } else if (Array.isArray(value) && value.length > maxArrayLength) {
        compressed[key] = value.slice(0, maxArrayLength);
      } else {
        compressed[key] = value;
      }
    }

    return compressed;
  }

  /**
   * Generate human-readable pattern description
   */
  private generatePatternDescription(trajectory: ITrajectory): string {
    if (!trajectory.steps || trajectory.steps.length === 0) {
      return `Pattern from route ${trajectory.route}`;
    }

    const actions = trajectory.steps.map(s => s.action);
    const uniqueActions = [...new Set(actions)];

    if (uniqueActions.length <= 3) {
      return `Pattern: ${uniqueActions.join(' → ')} (${trajectory.steps.length} steps)`;
    }

    return `Pattern: ${uniqueActions.slice(0, 3).join(' → ')}... (${trajectory.steps.length} steps)`;
  }

  /**
   * Infer domain from trajectory route
   */
  private inferDomain(route: string): string {
    const parts = route.split('.');
    return parts[0] || 'general';
  }

  /**
   * Extract tags from trajectory
   */
  private extractTags(trajectory: ITrajectory): string[] {
    const tags = new Set<string>();

    // Add route components as tags
    trajectory.route.split('.').forEach(part => tags.add(part));

    // Add action types as tags
    trajectory.steps?.forEach(step => {
      tags.add(step.action);
    });

    // Add quality tier
    if (trajectory.quality) {
      if (trajectory.quality >= 0.9) tags.add('high-quality');
      else if (trajectory.quality >= 0.7) tags.add('good-quality');
    }

    return Array.from(tags);
  }

  /**
   * Generate embedding for a trajectory pattern
   *
   * @param trajectory - Trajectory to generate embedding from
   * @returns Pattern embedding as Float32Array
   */
  private async generatePatternEmbedding(trajectory: ITrajectory): Promise<Float32Array> {
    // Get route weights for this trajectory
    const routeWeights = this.weights.get(trajectory.route);

    if (!routeWeights) {
      // No weights available, return default embedding
      return new Float32Array(VECTOR_DIM).fill(0);
    }

    // Create weighted embedding from pattern weights
    const result = new Float32Array(VECTOR_DIM);
    let totalWeight = 0;

    for (const patternId of trajectory.patterns) {
      const weight = routeWeights.get(patternId) ?? DEFAULT_INITIAL_WEIGHT;

      // Use real semantic embedding from provider (SPEC-EMB-002)
      const patternHash = await this.hashStringToFloat32Array(patternId);

      for (let i = 0; i < VECTOR_DIM; i++) {
        result[i] += patternHash[i] * Math.abs(weight);
      }
      totalWeight += Math.abs(weight);
    }

    // Normalize by total weight
    if (totalWeight > 0) {
      for (let i = 0; i < VECTOR_DIM; i++) {
        result[i] /= totalWeight;
      }
    }

    // Normalize to unit length
    const norm = Math.sqrt(result.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < VECTOR_DIM; i++) {
        result[i] /= norm;
      }
    }

    return result;
  }

  /**
   * Generate semantic embedding for a string using the real embedding provider (SPEC-EMB-002)
   *
   * @param str - String to embed
   * @returns Float32Array of length VECTOR_DIM (1536) with semantic embedding
   */
  private async hashStringToFloat32Array(str: string): Promise<Float32Array> {
    // Use real embedding provider (LocalEmbeddingProvider with all-mpnet-base-v2)
    return this.embeddingProvider.embed(str);
  }

  /**
   * Get all created patterns
   *
   * @returns Array of patterns
   */
  getPatterns(): Pattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Get pattern by ID
   *
   * @param patternId - Pattern ID
   * @returns Pattern or undefined
   */
  getPatternById(patternId: string): Pattern | undefined {
    return this.patterns.get(patternId);
  }

  /**
   * Get pattern count
   *
   * @returns Number of patterns
   */
  getPatternStorageCount(): number {
    return this.patterns.size;
  }

  // ==================== TECH-TRJ-001: Trajectory Streaming Methods ====================

  /**
   * Get current rollback state (TECH-TRJ-001)
   *
   * @returns Rollback state information
   */
  getRollbackState(): IRollbackState {
    return { ...this.rollbackState };
  }

  /**
   * Check if learning has progressed past a checkpoint (TECH-TRJ-001)
   *
   * Progress is defined as:
   * 1. New trajectories created since checkpoint
   * 2. New checkpoint created since last rollback
   * 3. Weight changes above threshold since checkpoint
   *
   * @param checkpointId - Checkpoint to check progress against
   * @returns true if learning has progressed past checkpoint
   */
  private async hasProgressedPastCheckpoint(checkpointId: string): Promise<boolean> {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) return false;

    const lastRollbackTime = this.rollbackState.lastRollbackAt ?? 0;

    // Check 1: New trajectories since last rollback?
    const recentTrajectories = Array.from(this.trajectories.values())
      .filter(t => t.createdAt > lastRollbackTime);

    if (recentTrajectories.length > 0) {
      // Learning happened - new trajectories created
      return true;
    }

    // Check 2: New checkpoint created since last rollback?
    const checkpoints = this.listCheckpoints();
    const newerCheckpoints = checkpoints.filter(c => c.timestamp > lastRollbackTime);

    if (newerCheckpoints.length > 0) {
      // Progress saved - new checkpoint created
      return true;
    }

    // Check 3: Significant weight changes?
    const weightDiff = this.calculateWeightDifference(checkpoint.weights, this.weights);
    if (weightDiff > 0.01) { // 1% threshold
      return true;
    }

    // No progress detected
    return false;
  }

  /**
   * Calculate weight difference between two weight storages (TECH-TRJ-001)
   *
   * @param weights1 - First weight storage
   * @param weights2 - Second weight storage
   * @returns Normalized difference (0 = identical, 1 = completely different)
   */
  private calculateWeightDifference(weights1: WeightStorage, weights2: WeightStorage): number {
    const vec1 = this.flattenWeightsToVector(weights1);
    const vec2 = this.flattenWeightsToVector(weights2);

    // Handle size mismatch
    const maxLen = Math.max(vec1.length, vec2.length);
    if (maxLen === 0) return 0;

    let sumSquaredDiff = 0;
    for (let i = 0; i < maxLen; i++) {
      const v1 = i < vec1.length ? vec1[i] : 0;
      const v2 = i < vec2.length ? vec2[i] : 0;
      sumSquaredDiff += (v1 - v2) ** 2;
    }

    return Math.sqrt(sumSquaredDiff / maxLen);
  }

  /**
   * Determine if a checkpoint should be automatically marked as baseline (TECH-TRJ-001)
   *
   * @returns true if checkpoint should be marked as baseline
   */
  private shouldAutoMarkAsBaseline(): boolean {
    const existingCheckpoints = this.listCheckpoints();

    // Rule 1: First checkpoint ever created
    if (existingCheckpoints.length === 0) {
      return true;
    }

    // Rule 2: No baseline exists yet
    const hasBaseline = existingCheckpoints.length > 0 && this.baselineCheckpointIds.size > 0;
    if (!hasBaseline) {
      return true;
    }

    // Rule 3: Every 10th checkpoint
    const totalCheckpoints = existingCheckpoints.length + 1;
    if (totalCheckpoints % 10 === 0) {
      return true;
    }

    return false;
  }

  /**
   * Reset rollback state when learning makes progress (TECH-TRJ-001)
   *
   * Called automatically when:
   * 1. New trajectory is created (indicates progress)
   * 2. New checkpoint is created (indicates progress worth saving)
   */
  private resetRollbackStateIfProgressed(): void {
    // Only reset if we have a last rollback to check against
    if (!this.rollbackState.lastRollbackCheckpointId) {
      return;
    }

    // Keep rollbackCount for metrics, but clear the loop detection state
    this.rollbackState = {
      lastRollbackCheckpointId: null,
      lastRollbackAt: null,
      rollbackCount: this.rollbackState.rollbackCount
    };
  }

  // ==================== Quality Sync and Pattern Conversion Methods ====================

  /**
   * Sync quality scores from learning_feedback table to trajectory_metadata
   *
   * This method bridges the gap between feedback events (which contain quality scores)
   * and trajectory metadata (which stores quality for pattern creation eligibility).
   *
   * Implements: TASK-QUALITY-SYNC
   * - Queries learning_feedback for records with trajectory_id and quality
   * - Updates corresponding trajectory_metadata.quality_score via DAO
   * - Handles errors gracefully, continuing on individual failures
   *
   * @returns Object with count of synced records and any errors encountered
   */
  async syncQualityFromEvents(): Promise<{
    synced: number;
    errors: string[];
  }> {
    const result = {
      synced: 0,
      errors: [] as string[]
    };

    // Requires persistence to be enabled
    if (!this.persistenceEnabled || !this.learningFeedbackDAO || !this.trajectoryMetadataDAO) {
      result.errors.push('Database persistence not enabled. Cannot sync quality scores.');
      console.warn('[SonaEngine] syncQualityFromEvents: Persistence not enabled');
      return result;
    }

    try {
      // Get all feedback records (both processed and unprocessed)
      // We need to query directly since DAO only has findUnprocessed
      const feedbackStats = this.learningFeedbackDAO.getStats();
      console.info(
        `[SonaEngine] syncQualityFromEvents: Found ${feedbackStats.feedbackCount} total feedback records`
      );

      // Query all feedback with trajectory IDs using raw SQL
      // LearningFeedbackDAO doesn't expose findAll, so we need direct query
      if (!this.databaseConnection) {
        result.errors.push('Database connection not available');
        return result;
      }

      const stmt = this.databaseConnection.prepare(`
        SELECT DISTINCT trajectory_id, quality
        FROM learning_feedback
        WHERE trajectory_id IS NOT NULL
        ORDER BY created_at DESC
      `);

      const feedbackRecords = stmt.all() as Array<{
        trajectory_id: string;
        quality: number;
      }>;

      console.info(
        `[SonaEngine] syncQualityFromEvents: Processing ${feedbackRecords.length} feedback records`
      );

      // Track which trajectories we've already updated (use most recent quality)
      const updatedTrajectories = new Set<string>();

      for (const record of feedbackRecords) {
        const { trajectory_id: trajectoryId, quality } = record;

        // Skip if we've already updated this trajectory (first record is most recent)
        if (updatedTrajectories.has(trajectoryId)) {
          continue;
        }

        try {
          // Check if trajectory exists in metadata
          const metadata = this.trajectoryMetadataDAO.findById(trajectoryId);
          if (!metadata) {
            // Trajectory might exist in memory but not yet persisted to metadata
            console.debug(
              `[SonaEngine] syncQualityFromEvents: Trajectory ${trajectoryId} not found in metadata`
            );
            continue;
          }

          // Skip if quality is already set and matches
          if (metadata.qualityScore !== undefined && Math.abs(metadata.qualityScore - quality) < 0.001) {
            updatedTrajectories.add(trajectoryId);
            continue;
          }

          // Update quality score in metadata
          this.trajectoryMetadataDAO.updateQuality(trajectoryId, quality);
          updatedTrajectories.add(trajectoryId);
          result.synced++;

          console.debug(
            `[SonaEngine] syncQualityFromEvents: Updated trajectory ${trajectoryId} quality to ${quality.toFixed(3)}`
          );
        } catch (error) {
          const errorMsg = `Failed to update trajectory ${trajectoryId}: ${error instanceof Error ? error.message : String(error)}`;
          result.errors.push(errorMsg);
          console.warn(`[SonaEngine] syncQualityFromEvents: ${errorMsg}`);
          // Continue processing other records
        }
      }

      console.info(
        `[SonaEngine] syncQualityFromEvents: Completed. Synced ${result.synced} trajectories, ${result.errors.length} errors`
      );

      // Emit observability event
      const bus = getObservabilityBus();
      bus.emit({
        component: 'sona',
        operation: 'sona_quality_sync',
        status: result.errors.length === 0 ? 'success' : 'warning',
        metadata: {
          synced: result.synced,
          errorCount: result.errors.length,
          totalFeedbackRecords: feedbackRecords.length
        }
      });

      return result;
    } catch (error) {
      const errorMsg = `syncQualityFromEvents failed: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(errorMsg);
      console.error(`[SonaEngine] ${errorMsg}`);

      // Emit error event
      const bus = getObservabilityBus();
      bus.emit({
        component: 'sona',
        operation: 'sona_quality_sync',
        status: 'error',
        metadata: {
          error: errorMsg
        }
      });

      return result;
    }
  }

  /**
   * Convert high-quality trajectories to reusable patterns
   *
   * Queries trajectory_metadata for trajectories with quality >= threshold,
   * then calls createPatternFromTrajectory for each eligible trajectory.
   *
   * Implements: TASK-PATTERN-CONVERT
   * - Default threshold is AUTO_PATTERN_QUALITY_THRESHOLD (0.8) for pattern creation
   * - Supports dry-run mode for previewing without creating
   * - Skips trajectories that already have patterns
   * - Limits conversions per batch to prevent overwhelming the system
   *
   * @param options - Configuration options for conversion
   * @returns Statistics about the conversion process
   */
  async convertHighQualityTrajectoriesToPatterns(options?: {
    qualityThreshold?: number;
    dryRun?: boolean;
    maxConversions?: number;
  }): Promise<{
    totalTrajectories: number;
    eligibleTrajectories: number;
    patternsCreated: number;
    errors: string[];
  }> {
    const qualityThreshold = options?.qualityThreshold ?? AUTO_PATTERN_QUALITY_THRESHOLD;
    const dryRun = options?.dryRun ?? false;
    const maxConversions = options?.maxConversions ?? 100;

    const result = {
      totalTrajectories: 0,
      eligibleTrajectories: 0,
      patternsCreated: 0,
      errors: [] as string[]
    };

    // Requires persistence to be enabled
    if (!this.persistenceEnabled || !this.trajectoryMetadataDAO) {
      result.errors.push('Database persistence not enabled. Cannot query trajectories.');
      console.warn('[SonaEngine] convertHighQualityTrajectoriesToPatterns: Persistence not enabled');
      return result;
    }

    // Ensure engine is initialized for pattern creation
    if (!this.initialized) {
      try {
        await this.initialize();
      } catch (error) {
        result.errors.push(`Failed to initialize engine: ${error instanceof Error ? error.message : String(error)}`);
        return result;
      }
    }

    try {
      // Get total trajectory count
      result.totalTrajectories = this.trajectoryMetadataDAO.count();

      // Query trajectories with quality >= threshold
      const eligibleMetadata = this.trajectoryMetadataDAO.findByMinQuality(qualityThreshold);
      result.eligibleTrajectories = eligibleMetadata.length;

      console.info(
        `[SonaEngine] convertHighQualityTrajectoriesToPatterns: Found ${result.eligibleTrajectories} ` +
        `eligible trajectories (threshold: ${qualityThreshold}, total: ${result.totalTrajectories})`
      );

      if (dryRun) {
        console.info('[SonaEngine] convertHighQualityTrajectoriesToPatterns: Dry run - no patterns will be created');

        // Emit observability event for dry run
        const bus = getObservabilityBus();
        bus.emit({
          component: 'sona',
          operation: 'sona_pattern_conversion_preview',
          status: 'success',
          metadata: {
            totalTrajectories: result.totalTrajectories,
            eligibleTrajectories: result.eligibleTrajectories,
            qualityThreshold,
            dryRun: true
          }
        });

        return result;
      }

      // Get existing patterns to check for duplicates
      const existingPatternTrajectoryIds = new Set<string>();
      for (const pattern of this.patterns.values()) {
        existingPatternTrajectoryIds.add(pattern.sourceTrajectory);
      }

      // Also check DAO for persisted patterns
      if (this.patternDAO) {
        const persistedPatterns = this.patternDAO.findActive();
        for (const pattern of persistedPatterns) {
          for (const trajId of pattern.trajectoryIds) {
            existingPatternTrajectoryIds.add(trajId);
          }
        }
      }

      let conversions = 0;

      for (const metadata of eligibleMetadata) {
        // Check conversion limit
        if (conversions >= maxConversions) {
          console.info(
            `[SonaEngine] convertHighQualityTrajectoriesToPatterns: Reached max conversions limit (${maxConversions})`
          );
          break;
        }

        // Skip if pattern already exists for this trajectory
        if (existingPatternTrajectoryIds.has(metadata.id)) {
          console.debug(
            `[SonaEngine] convertHighQualityTrajectoriesToPatterns: Skipping ${metadata.id} - pattern already exists`
          );
          continue;
        }

        try {
          // Load full trajectory data
          const trajectory = this.getTrajectory(metadata.id);
          if (!trajectory) {
            result.errors.push(`Trajectory ${metadata.id} not found in storage`);
            continue;
          }

          // Create pattern from trajectory
          const patternId = await this.createPatternFromTrajectory(trajectory);

          if (patternId) {
            result.patternsCreated++;
            conversions++;
            existingPatternTrajectoryIds.add(metadata.id);

            console.info(
              `[SonaEngine] convertHighQualityTrajectoriesToPatterns: Created pattern ${patternId} ` +
              `from trajectory ${metadata.id} (quality: ${metadata.qualityScore?.toFixed(3)})`
            );
          }
        } catch (error) {
          const errorMsg = `Failed to create pattern from trajectory ${metadata.id}: ${error instanceof Error ? error.message : String(error)}`;
          result.errors.push(errorMsg);
          console.warn(`[SonaEngine] convertHighQualityTrajectoriesToPatterns: ${errorMsg}`);
          // Continue processing other trajectories
        }
      }

      console.info(
        `[SonaEngine] convertHighQualityTrajectoriesToPatterns: Completed. ` +
        `Created ${result.patternsCreated} patterns, ${result.errors.length} errors`
      );

      // Emit observability event
      const bus = getObservabilityBus();
      bus.emit({
        component: 'sona',
        operation: 'sona_pattern_conversion',
        status: result.errors.length === 0 ? 'success' : 'warning',
        metadata: {
          totalTrajectories: result.totalTrajectories,
          eligibleTrajectories: result.eligibleTrajectories,
          patternsCreated: result.patternsCreated,
          errorCount: result.errors.length,
          qualityThreshold,
          maxConversions
        }
      });

      return result;
    } catch (error) {
      const errorMsg = `convertHighQualityTrajectoriesToPatterns failed: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(errorMsg);
      console.error(`[SonaEngine] ${errorMsg}`);

      // Emit error event
      const bus = getObservabilityBus();
      bus.emit({
        component: 'sona',
        operation: 'sona_pattern_conversion',
        status: 'error',
        metadata: {
          error: errorMsg,
          qualityThreshold
        }
      });

      return result;
    }
  }

  // ==================== BATCH LEARNING: Process Unprocessed Feedback ====================

  /**
   * Process unprocessed feedback records for batch learning.
   *
   * Retrieves unprocessed feedback from SQLite, updates pattern success/failure counts,
   * creates patterns from exceptional feedback (quality >= AUTO_PATTERN_QUALITY_THRESHOLD = 0.8),
   * and marks records as processed.
   *
   * Implements: TASK-BATCH-LEARN-001
   * - RULE-008: ALL learning data MUST be stored in SQLite
   * - ERR-001: No silent failures - log all errors
   * - Uses LearningFeedbackDAO.findUnprocessed() and markProcessed()
   *
   * @param limit - Maximum records to process per batch (default: 100)
   * @returns Processing statistics including processed count, patterns created, and errors
   *
   * @example
   * ```typescript
   * const engine = createProductionSonaEngine();
   * const stats = await engine.processUnprocessedFeedback(50);
   * console.log(`Processed ${stats.processed} records, created ${stats.patternsCreated} patterns`);
   * ```
   */
  async processUnprocessedFeedback(limit: number = 100): Promise<{
    processed: number;
    patternsCreated: number;
    errors: number;
    details: Array<{
      feedbackId: string;
      trajectoryId: string;
      quality: number;
      status: 'processed' | 'pattern_created' | 'skipped' | 'error';
      reason?: string;
    }>;
  }> {
    const startTime = performance.now();

    // Early return if persistence is not enabled
    if (!this.persistenceEnabled || !this.learningFeedbackDAO) {
      console.warn('[SonaEngine] processUnprocessedFeedback: Persistence not enabled, skipping batch processing');
      return { processed: 0, patternsCreated: 0, errors: 0, details: [] };
    }

    const stats = {
      processed: 0,
      patternsCreated: 0,
      errors: 0,
      details: [] as Array<{
        feedbackId: string;
        trajectoryId: string;
        quality: number;
        status: 'processed' | 'pattern_created' | 'skipped' | 'error';
        reason?: string;
      }>
    };

    try {
      // 1. Retrieve unprocessed feedback records (FIFO order - oldest first)
      const unprocessed = this.learningFeedbackDAO.findUnprocessed(limit);

      if (unprocessed.length === 0) {
        console.info('[SonaEngine] processUnprocessedFeedback: No unprocessed feedback records found');
        return stats;
      }

      console.info(`[SonaEngine] processUnprocessedFeedback: Processing ${unprocessed.length} feedback records`);

      // 2. Build set of existing pattern source trajectories for duplicate detection
      const existingPatternTrajectoryIds = new Set<string>();
      for (const pattern of this.patterns.values()) {
        existingPatternTrajectoryIds.add(pattern.sourceTrajectory);
      }

      // 3. Process each feedback record
      for (const feedback of unprocessed) {
        try {
          // 3a. Validate feedback has required fields
          if (!feedback.trajectoryId) {
            stats.details.push({
              feedbackId: feedback.id,
              trajectoryId: 'unknown',
              quality: feedback.quality,
              status: 'skipped',
              reason: 'Missing trajectory ID'
            });
            // Still mark as processed to prevent infinite retry
            this.learningFeedbackDAO.markProcessed(feedback.id);
            stats.processed++;
            continue;
          }

          // 3b. Get trajectory for pattern creation
          const trajectory = this.getTrajectory(feedback.trajectoryId);

          // 3c. Update weights for positive high-quality feedback (quality >= 0.6)
          // and increment pattern success/failure counts
          if (trajectory) {
            // Update trajectory quality if this feedback is higher
            if (trajectory.quality === undefined || trajectory.quality < feedback.quality) {
              trajectory.quality = feedback.quality;
            }

            // BUG-FIX: Wire pattern success/failure counters in batch processing
            // This was missing - patterns existed but success_count was always 0
            const SUCCESS_THRESHOLD = 0.7;
            if (this.patternDAO && trajectory.patterns.length > 0) {
              for (const patternId of trajectory.patterns) {
                try {
                  if (feedback.quality >= SUCCESS_THRESHOLD && feedback.outcome === 'positive') {
                    this.patternDAO.incrementSuccess(patternId);
                  } else if (feedback.quality < SUCCESS_THRESHOLD || feedback.outcome === 'negative') {
                    this.patternDAO.incrementFailure(patternId);
                  }
                } catch (err) {
                  // Log but don't fail - pattern may not exist in DB yet
                  console.warn(`[SonaEngine] processUnprocessedFeedback: Failed to update pattern ${patternId} counts:`, err);
                }
              }
            }
          }

          // 3d. Create pattern from exceptional feedback (quality >= AUTO_PATTERN_QUALITY_THRESHOLD)
          // BUG-FIX: Was hardcoded 0.85, now uses the constant (0.8)
          let patternCreated = false;
          if (feedback.quality >= AUTO_PATTERN_QUALITY_THRESHOLD && trajectory) {
            // Check if pattern already exists for this trajectory
            const patternAlreadyExists = existingPatternTrajectoryIds.has(feedback.trajectoryId);

            if (!patternAlreadyExists) {
              // Ensure trajectory has quality set for pattern creation
              if (trajectory.quality === undefined) {
                trajectory.quality = feedback.quality;
              }

              try {
                const patternId = await this.createPatternFromTrajectory(trajectory);
                if (patternId) {
                  patternCreated = true;
                  stats.patternsCreated++;
                  existingPatternTrajectoryIds.add(feedback.trajectoryId);
                  console.info(
                    `[SonaEngine] processUnprocessedFeedback: Created pattern ${patternId} ` +
                    `from feedback ${feedback.id} (quality: ${feedback.quality.toFixed(3)})`
                  );
                }
              } catch (patternError) {
                console.warn(
                  `[SonaEngine] processUnprocessedFeedback: Failed to create pattern from ` +
                  `feedback ${feedback.id}:`,
                  patternError
                );
              }
            }
          }

          // 3e. Mark feedback as processed
          this.learningFeedbackDAO.markProcessed(feedback.id);
          stats.processed++;

          stats.details.push({
            feedbackId: feedback.id,
            trajectoryId: feedback.trajectoryId,
            quality: feedback.quality,
            status: patternCreated ? 'pattern_created' : 'processed',
          });

        } catch (error) {
          // ERR-001: Log error, don't silently fail
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.warn(
            `[SonaEngine] processUnprocessedFeedback: Failed to process feedback ${feedback.id}:`,
            errorMsg
          );
          stats.errors++;
          stats.details.push({
            feedbackId: feedback.id,
            trajectoryId: feedback.trajectoryId || 'unknown',
            quality: feedback.quality,
            status: 'error',
            reason: errorMsg
          });
        }
      }

      // 4. Emit observability event
      const elapsedMs = performance.now() - startTime;
      const bus = getObservabilityBus();
      bus.emit({
        component: 'sona',
        operation: 'sona_batch_feedback_processed',
        status: stats.errors === 0 ? 'success' : 'warning',
        durationMs: elapsedMs,
        metadata: {
          processed: stats.processed,
          patternsCreated: stats.patternsCreated,
          errors: stats.errors,
          limit,
          totalUnprocessed: unprocessed.length
        }
      });

      console.info(
        `[SonaEngine] processUnprocessedFeedback: Completed in ${elapsedMs.toFixed(2)}ms. ` +
        `Processed: ${stats.processed}, Patterns: ${stats.patternsCreated}, Errors: ${stats.errors}`
      );

    } catch (error) {
      // ERR-001: Log batch processing failure
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[SonaEngine] processUnprocessedFeedback: Batch processing failed:', errorMsg);

      // Emit error event
      const bus = getObservabilityBus();
      bus.emit({
        component: 'sona',
        operation: 'sona_batch_feedback_processed',
        status: 'error',
        metadata: {
          error: errorMsg,
          processed: stats.processed,
          patternsCreated: stats.patternsCreated,
          errors: stats.errors
        }
      });
    }

    return stats;
  }

  /**
   * Get count of unprocessed feedback records awaiting batch learning.
   *
   * @returns Number of unprocessed records, or 0 if persistence is disabled
   */
  getUnprocessedFeedbackCount(): number {
    if (!this.persistenceEnabled || !this.learningFeedbackDAO) {
      return 0;
    }
    return this.learningFeedbackDAO.countUnprocessed();
  }
}

// ============================================================
// PRODUCTION FACTORY FUNCTION (TASK-PERSIST-004)
// ============================================================

import { getDatabaseConnection } from '../database/connection.js';

/**
 * Create a SonaEngine with database persistence REQUIRED
 *
 * RULE-008: ALL learning data MUST be stored in SQLite
 * RULE-074: Map as primary storage is FORBIDDEN in production
 *
 * This factory function ensures the SonaEngine is properly configured
 * with SQLite persistence. Use this in production code.
 *
 * @param config - Optional SonaConfig (database connection will be added)
 * @param dbPath - Optional database path (defaults to .god-agent/learning.db)
 * @returns SonaEngine with persistence enabled
 *
 * @example
 * ```typescript
 * // Production usage
 * const engine = createProductionSonaEngine();
 *
 * // With custom config
 * const engine = createProductionSonaEngine({
 *   learningRate: 0.02,
 *   trackPerformance: true
 * });
 * ```
 */
export function createProductionSonaEngine(
  config: Omit<ISonaConfig, 'databaseConnection'> = {},
  dbPath?: string
): SonaEngine {
  const databaseConnection = getDatabaseConnection(dbPath);

  return new SonaEngine({
    ...config,
    databaseConnection
  });
}
