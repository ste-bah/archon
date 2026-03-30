/**
 * TrainingTriggerController - Autonomic Training Trigger System
 *
 * Implements threshold-based triggers for GNN training:
 * 1. Sample Density: At least 50 new feedback pairs (COLD_START_THRESHOLD)
 * 2. Graceful Exit: During GodAgent.shutdown
 *
 * Features:
 * - Automatic training when sample threshold is reached
 * - Cooldown period to prevent excessive training
 * - Buffer persistence for restart recovery
 * - Stats and monitoring capabilities
 *
 * Implements: TASK-GNN-009
 * PRD: PRD-GOD-AGENT-001
 *
 * CONSTITUTION COMPLIANCE:
 * - RULE-028: All feedback persisted
 * - RULE-046: Atomic operations
 * - RULE-079: No magic numbers (uses COLD_START_THRESHOLD)
 *
 * @module src/god-agent/core/reasoning/training-trigger
 */

import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../observability/index.js';
import { COLD_START_THRESHOLD } from '../validation/constants.js';
import type { GNNTrainer, TrainingDataset, EpochResult } from './gnn-trainer.js';
import type { ITrajectoryWithFeedback } from './contrastive-loss.js';

const logger = createComponentLogger('TrainingTrigger', {
  minLevel: LogLevel.INFO,
  handlers: [new ConsoleLogHandler()]
});

// =============================================================================
// Constants
// =============================================================================

/**
 * Default cooldown period between training runs (5 minutes)
 * @rationale Prevents excessive training from rapid feedback bursts
 */
const DEFAULT_COOLDOWN_MS = 300000; // 5 minutes

/**
 * Default maximum pending samples before force-triggering
 * @rationale Prevents unbounded memory growth while waiting for training
 */
const DEFAULT_MAX_PENDING_SAMPLES = 500;

/**
 * Buffer persistence filename
 * @rationale Allows recovery of pending training data after restart
 */
const BUFFER_PERSISTENCE_FILENAME = 'training_buffer.json';

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Configuration for TrainingTriggerController
 * Implements: TASK-GNN-009 specification
 */
export interface TriggerConfig {
  /** Minimum samples before training triggers (default: COLD_START_THRESHOLD = 50) */
  minSamples: number;

  /** Cooldown period between training runs in milliseconds (default: 300000 = 5 minutes) */
  cooldownMs: number;

  /** Maximum pending samples before force-triggering (default: 500) */
  maxPendingSamples: number;

  /** Enable buffer persistence to disk (default: true) */
  enablePersistence: boolean;

  /** Directory for buffer persistence (default: '.agentdb/training') */
  persistenceDir: string;

  /** Auto-trigger check interval in milliseconds (default: 60000 = 1 minute) */
  autoCheckIntervalMs: number;
}

/**
 * Statistics about training trigger state
 */
export interface TriggerStats {
  /** Number of trajectories in the buffer */
  bufferSize: number;

  /** Samples until next training trigger */
  samplesToNextTrigger: number;

  /** Time until cooldown expires (0 if not in cooldown) */
  cooldownRemainingMs: number;

  /** Whether currently in cooldown period */
  inCooldown: boolean;

  /** Total training runs since creation */
  totalTrainingRuns: number;

  /** Last training timestamp (0 if never trained) */
  lastTrainingTime: number;

  /** Total trajectories processed since creation */
  totalTrajectoriesProcessed: number;

  /** Average training loss from last run */
  lastTrainingLoss: number;

  /** Whether training is currently in progress */
  trainingInProgress: boolean;
}

/**
 * Result from a training trigger attempt
 */
export interface TriggerResult {
  /** Whether training was triggered */
  triggered: boolean;

  /** Reason for trigger/no-trigger */
  reason: string;

  /** Training results if triggered */
  epochResults?: EpochResult[];

  /** Final loss after training */
  finalLoss?: number;

  /** Training duration in milliseconds */
  trainingDurationMs?: number;
}

/**
 * Serializable buffer state for persistence
 */
interface SerializedBuffer {
  /** Version for compatibility checks */
  version: string;

  /** Timestamp of serialization */
  timestamp: number;

  /** Serialized trajectories */
  trajectories: Array<{
    id: string;
    embedding: number[];
    enhancedEmbedding?: number[];
    quality: number;
  }>;

  /** Stats snapshot */
  stats: {
    totalTrainingRuns: number;
    totalTrajectoriesProcessed: number;
    lastTrainingTime: number;
    lastTrainingLoss: number;
  };
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: TriggerConfig = {
  minSamples: COLD_START_THRESHOLD,
  cooldownMs: DEFAULT_COOLDOWN_MS,
  maxPendingSamples: DEFAULT_MAX_PENDING_SAMPLES,
  enablePersistence: true,
  persistenceDir: '.agentdb/training',
  autoCheckIntervalMs: 60000, // 1 minute
};

const BUFFER_VERSION = '1.0.0';

// =============================================================================
// TrainingTriggerController Class
// =============================================================================

/**
 * TrainingTriggerController - Autonomic trigger system for GNN training
 *
 * Monitors incoming feedback trajectories and triggers training when:
 * 1. Buffer reaches minSamples (default: 50 per COLD_START_THRESHOLD)
 * 2. Buffer exceeds maxPendingSamples (force trigger)
 * 3. forceTraining() is called (e.g., during shutdown)
 *
 * Implements cooldown period to prevent excessive training.
 *
 * Implements: TASK-GNN-009
 *
 * @example
 * ```typescript
 * const trigger = new TrainingTriggerController(trainer, {
 *   minSamples: 50,
 *   cooldownMs: 300000
 * });
 *
 * // Add trajectories as feedback comes in
 * trigger.addTrajectory(trajectory);
 *
 * // Check if training should happen
 * if (trigger.shouldTrigger()) {
 *   await trigger.checkAndTrain();
 * }
 *
 * // Force training on shutdown
 * await trigger.forceTraining();
 * ```
 */
export class TrainingTriggerController {
  private readonly config: TriggerConfig;
  private readonly trainer: GNNTrainer;
  private trajectoryBuffer: ITrajectoryWithFeedback[] = [];
  private lastTrainingTime: number = 0;
  private totalTrainingRuns: number = 0;
  private totalTrajectoriesProcessed: number = 0;
  private lastTrainingLoss: number = 0;
  private trainingInProgress: boolean = false;
  private autoCheckTimer?: NodeJS.Timeout;

  /**
   * Create a new TrainingTriggerController
   *
   * @param trainer - GNNTrainer instance for executing training
   * @param config - Optional configuration overrides
   */
  constructor(trainer: GNNTrainer, config?: Partial<TriggerConfig>) {
    this.trainer = trainer;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Validate configuration
    if (this.config.minSamples < 1) {
      throw new Error('minSamples must be at least 1');
    }
    if (this.config.cooldownMs < 0) {
      throw new Error('cooldownMs cannot be negative');
    }
    if (this.config.maxPendingSamples < this.config.minSamples) {
      throw new Error('maxPendingSamples must be >= minSamples');
    }

    logger.info('TrainingTriggerController initialized', {
      minSamples: this.config.minSamples,
      cooldownMs: this.config.cooldownMs,
      maxPendingSamples: this.config.maxPendingSamples,
      enablePersistence: this.config.enablePersistence,
    });

    // Attempt to load persisted buffer
    this.loadBufferFromDisk().catch(error => {
      logger.debug('No persisted buffer to load', { error: String(error) });
    });

    // Start auto-check timer
    this.startAutoCheck();
  }

  /**
   * Add a trajectory to the buffer
   *
   * Implements: AC-001 (training triggers at 50 samples)
   *
   * @param trajectory - Trajectory with quality feedback to add
   */
  addTrajectory(trajectory: ITrajectoryWithFeedback): void {
    // Validate trajectory
    if (!trajectory.id || trajectory.quality === undefined) {
      logger.warn('Invalid trajectory skipped', { id: trajectory.id });
      return;
    }

    // Add to buffer
    this.trajectoryBuffer.push(trajectory);
    this.totalTrajectoriesProcessed++;

    logger.debug('Trajectory added to buffer', {
      id: trajectory.id,
      quality: trajectory.quality,
      bufferSize: this.trajectoryBuffer.length,
    });

    // Persist buffer if enabled
    if (this.config.enablePersistence) {
      this.persistBufferToDisk().catch(error => {
        logger.warn('Buffer persistence failed', { error: String(error) });
      });
    }

    // Check if we should auto-trigger due to max pending
    if (this.trajectoryBuffer.length >= this.config.maxPendingSamples) {
      logger.info('Max pending samples reached, triggering training');
      this.checkAndTrain().catch(error => {
        logger.error('Auto-triggered training failed', { error: String(error) });
      });
    }
  }

  /**
   * Check if training should trigger based on current state
   *
   * Implements: AC-001, AC-002
   *
   * @returns true if training should be triggered
   */
  shouldTrigger(): boolean {
    // Don't trigger if training is already in progress
    if (this.trainingInProgress) {
      return false;
    }

    // Check cooldown (AC-002)
    const now = Date.now();
    const cooldownExpiry = this.lastTrainingTime + this.config.cooldownMs;
    if (now < cooldownExpiry) {
      return false;
    }

    // Check sample threshold (AC-001)
    if (this.trajectoryBuffer.length >= this.config.minSamples) {
      return true;
    }

    return false;
  }

  /**
   * Check conditions and run training if appropriate
   *
   * Implements: AC-001, AC-002
   *
   * @returns Result indicating whether training was triggered and outcomes
   */
  async checkAndTrain(): Promise<TriggerResult> {
    // Check if already training
    if (this.trainingInProgress) {
      return {
        triggered: false,
        reason: 'Training already in progress',
      };
    }

    // Check cooldown
    const now = Date.now();
    const cooldownExpiry = this.lastTrainingTime + this.config.cooldownMs;
    if (now < cooldownExpiry) {
      return {
        triggered: false,
        reason: `In cooldown period (${Math.ceil((cooldownExpiry - now) / 1000)}s remaining)`,
      };
    }

    // Check buffer size
    if (this.trajectoryBuffer.length < this.config.minSamples) {
      return {
        triggered: false,
        reason: `Insufficient samples (${this.trajectoryBuffer.length}/${this.config.minSamples})`,
      };
    }

    // Run training
    return this.executeTraining('threshold');
  }

  /**
   * Force training regardless of thresholds (for shutdown)
   *
   * Implements: AC-003 (shutdown triggers final training epoch)
   */
  async forceTraining(): Promise<TriggerResult> {
    // Check if buffer is empty
    if (this.trajectoryBuffer.length === 0) {
      return {
        triggered: false,
        reason: 'Buffer is empty, nothing to train',
      };
    }

    // Wait for any in-progress training to complete
    if (this.trainingInProgress) {
      logger.info('Waiting for in-progress training to complete before force training');
      // Simple polling wait (in production, use proper async coordination)
      let waitCount = 0;
      while (this.trainingInProgress && waitCount < 60) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        waitCount++;
      }

      if (this.trainingInProgress) {
        return {
          triggered: false,
          reason: 'Timed out waiting for in-progress training',
        };
      }
    }

    // Execute training
    return this.executeTraining('force');
  }

  /**
   * Get current trigger statistics
   *
   * Implements: AC-005 (stats available for monitoring)
   *
   * @returns Current trigger state statistics
   */
  getStats(): TriggerStats {
    const now = Date.now();
    const cooldownExpiry = this.lastTrainingTime + this.config.cooldownMs;
    const cooldownRemainingMs = Math.max(0, cooldownExpiry - now);

    return {
      bufferSize: this.trajectoryBuffer.length,
      samplesToNextTrigger: Math.max(0, this.config.minSamples - this.trajectoryBuffer.length),
      cooldownRemainingMs,
      inCooldown: cooldownRemainingMs > 0,
      totalTrainingRuns: this.totalTrainingRuns,
      lastTrainingTime: this.lastTrainingTime,
      totalTrajectoriesProcessed: this.totalTrajectoriesProcessed,
      lastTrainingLoss: this.lastTrainingLoss,
      trainingInProgress: this.trainingInProgress,
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<TriggerConfig> {
    return { ...this.config };
  }

  /**
   * Get current buffer size
   */
  getBufferSize(): number {
    return this.trajectoryBuffer.length;
  }

  /**
   * Clear the trajectory buffer
   */
  clearBuffer(): void {
    this.trajectoryBuffer = [];
    logger.info('Training buffer cleared');

    if (this.config.enablePersistence) {
      this.clearPersistedBuffer().catch(error => {
        logger.warn('Failed to clear persisted buffer', { error: String(error) });
      });
    }
  }

  /**
   * Stop the auto-check timer and cleanup
   */
  destroy(): void {
    if (this.autoCheckTimer) {
      clearInterval(this.autoCheckTimer);
      this.autoCheckTimer = undefined;
    }

    // Persist final buffer state
    if (this.config.enablePersistence) {
      this.persistBufferToDisk().catch(error => {
        logger.warn('Final buffer persistence failed', { error: String(error) });
      });
    }

    logger.info('TrainingTriggerController destroyed');
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  /**
   * Execute training with the current buffer
   *
   * @param triggerType - Type of trigger ('threshold' or 'force')
   * @returns Training result
   */
  private async executeTraining(triggerType: 'threshold' | 'force'): Promise<TriggerResult> {
    const startTime = performance.now();
    this.trainingInProgress = true;

    try {
      logger.info('Starting training', {
        triggerType,
        bufferSize: this.trajectoryBuffer.length,
      });

      // Create training dataset from buffer
      const dataset = this.createTrainingDataset();

      if (dataset.training.length === 0) {
        this.trainingInProgress = false;
        return {
          triggered: false,
          reason: 'No valid training data in buffer',
        };
      }

      // Run training
      const epochResults = await this.trainer.train(dataset);

      // Update state
      const trainingDurationMs = performance.now() - startTime;
      this.lastTrainingTime = Date.now();
      this.totalTrainingRuns++;

      // Calculate final loss
      const finalLoss = epochResults.length > 0
        ? epochResults[epochResults.length - 1].trainingLoss
        : 0;
      this.lastTrainingLoss = finalLoss;

      // Clear buffer after successful training
      this.trajectoryBuffer = [];

      logger.info('Training completed', {
        triggerType,
        epochs: epochResults.length,
        finalLoss: finalLoss.toFixed(6),
        durationMs: trainingDurationMs.toFixed(1),
      });

      // Clear persisted buffer
      if (this.config.enablePersistence) {
        await this.clearPersistedBuffer();
      }

      this.trainingInProgress = false;

      return {
        triggered: true,
        reason: triggerType === 'force' ? 'Force triggered' : 'Threshold reached',
        epochResults,
        finalLoss,
        trainingDurationMs,
      };
    } catch (error) {
      this.trainingInProgress = false;
      logger.error('Training failed', { error: String(error) });

      return {
        triggered: true,
        reason: `Training failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Create a training dataset from the buffer
   */
  private createTrainingDataset(): TrainingDataset {
    // Filter valid trajectories
    const validTrajectories = this.trajectoryBuffer.filter(t =>
      t.embedding && t.embedding.length > 0 && t.quality !== undefined
    );

    // Create query embeddings (use centroids or first embeddings)
    const queries = validTrajectories.length > 0
      ? [this.computeCentroid(validTrajectories.map(t => t.enhancedEmbedding ?? t.embedding))]
      : [];

    return {
      training: validTrajectories,
      queries,
    };
  }

  /**
   * Compute centroid of embeddings
   */
  private computeCentroid(embeddings: Float32Array[]): Float32Array {
    if (embeddings.length === 0) {
      return new Float32Array(0);
    }

    const dim = embeddings[0].length;
    const centroid = new Float32Array(dim);

    for (const emb of embeddings) {
      for (let i = 0; i < Math.min(dim, emb.length); i++) {
        centroid[i] += emb[i];
      }
    }

    // Normalize
    const n = embeddings.length;
    for (let i = 0; i < dim; i++) {
      centroid[i] /= n;
    }

    return centroid;
  }

  /**
   * Start auto-check timer
   */
  private startAutoCheck(): void {
    this.autoCheckTimer = setInterval(() => {
      if (this.shouldTrigger()) {
        this.checkAndTrain().catch(error => {
          logger.error('Auto-check training failed', { error: String(error) });
        });
      }
    }, this.config.autoCheckIntervalMs);
  }

  /**
   * Persist buffer to disk for restart recovery
   *
   * Implements: AC-004 (buffer persists to disk)
   */
  private async persistBufferToDisk(): Promise<void> {
    const { writeFileSync, mkdirSync, existsSync } = await import('fs');
    const { join } = await import('path');

    // Ensure directory exists
    if (!existsSync(this.config.persistenceDir)) {
      mkdirSync(this.config.persistenceDir, { recursive: true });
    }

    const filepath = join(this.config.persistenceDir, BUFFER_PERSISTENCE_FILENAME);

    // Serialize buffer
    const serialized: SerializedBuffer = {
      version: BUFFER_VERSION,
      timestamp: Date.now(),
      trajectories: this.trajectoryBuffer.map(t => ({
        id: t.id,
        embedding: Array.from(t.embedding),
        enhancedEmbedding: t.enhancedEmbedding ? Array.from(t.enhancedEmbedding) : undefined,
        quality: t.quality,
      })),
      stats: {
        totalTrainingRuns: this.totalTrainingRuns,
        totalTrajectoriesProcessed: this.totalTrajectoriesProcessed,
        lastTrainingTime: this.lastTrainingTime,
        lastTrainingLoss: this.lastTrainingLoss,
      },
    };

    writeFileSync(filepath, JSON.stringify(serialized, null, 2));
    logger.debug('Buffer persisted to disk', { filepath, trajectoryCount: this.trajectoryBuffer.length });
  }

  /**
   * Load buffer from disk on startup
   *
   * Implements: AC-004 (buffer persists for restart recovery)
   */
  private async loadBufferFromDisk(): Promise<void> {
    const { readFileSync, existsSync } = await import('fs');
    const { join } = await import('path');

    const filepath = join(this.config.persistenceDir, BUFFER_PERSISTENCE_FILENAME);

    if (!existsSync(filepath)) {
      return;
    }

    const content = readFileSync(filepath, 'utf-8');
    const serialized = JSON.parse(content) as SerializedBuffer;

    // Version check
    if (serialized.version !== BUFFER_VERSION) {
      logger.warn('Buffer version mismatch, skipping load', {
        expected: BUFFER_VERSION,
        actual: serialized.version,
      });
      return;
    }

    // Restore trajectories
    this.trajectoryBuffer = serialized.trajectories.map(t => ({
      id: t.id,
      embedding: new Float32Array(t.embedding),
      enhancedEmbedding: t.enhancedEmbedding ? new Float32Array(t.enhancedEmbedding) : undefined,
      quality: t.quality,
    }));

    // Restore stats
    this.totalTrainingRuns = serialized.stats.totalTrainingRuns;
    this.totalTrajectoriesProcessed = serialized.stats.totalTrajectoriesProcessed;
    this.lastTrainingTime = serialized.stats.lastTrainingTime;
    this.lastTrainingLoss = serialized.stats.lastTrainingLoss;

    logger.info('Buffer loaded from disk', {
      trajectoryCount: this.trajectoryBuffer.length,
      totalTrainingRuns: this.totalTrainingRuns,
    });
  }

  /**
   * Clear persisted buffer from disk
   */
  private async clearPersistedBuffer(): Promise<void> {
    const { unlinkSync, existsSync } = await import('fs');
    const { join } = await import('path');

    const filepath = join(this.config.persistenceDir, BUFFER_PERSISTENCE_FILENAME);

    if (existsSync(filepath)) {
      unlinkSync(filepath);
      logger.debug('Persisted buffer cleared', { filepath });
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a TrainingTriggerController with default configuration
 *
 * @param trainer - GNNTrainer instance
 * @param config - Optional configuration overrides
 * @returns Configured TrainingTriggerController
 */
export function createTrainingTriggerController(
  trainer: GNNTrainer,
  config?: Partial<TriggerConfig>
): TrainingTriggerController {
  return new TrainingTriggerController(trainer, config);
}
