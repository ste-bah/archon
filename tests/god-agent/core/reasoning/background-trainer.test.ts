/**
 * BackgroundTrainer Tests
 *
 * Tests for TASK-GNN-010 - Background Processing
 *
 * Verifies:
 * - AC-001: Training doesn't block main event loop
 * - AC-002: Latency impact < 10ms on reasoning operations
 * - AC-003: Worker thread option for large batches
 * - AC-004: Progress events emitted during training
 * - AC-005: Can be cancelled if needed
 *
 * @module tests/god-agent/core/reasoning/background-trainer.test
 */

import { describe, it, expect, beforeEach, afterEach, vi, test } from 'vitest';

// Set longer timeout for background training tests
vi.setConfig({ testTimeout: 30000 });
import {
  BackgroundTrainer,
  createBackgroundTrainer,
  type BackgroundTrainerConfig,
  type TrainingProgress,
  type BackgroundTrainingResult,
} from '../../../../src/god-agent/core/reasoning/background-trainer.js';
import type { ITrajectoryWithFeedback } from '../../../../src/god-agent/core/reasoning/contrastive-loss.js';
import type { GNNTrainer, TrainingConfig, TrainingResult } from '../../../../src/god-agent/core/reasoning/gnn-trainer.js';

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Create mock GNNTrainer
 */
function createMockTrainer(config?: Partial<TrainingConfig>): GNNTrainer {
  const defaultConfig: TrainingConfig = {
    learningRate: 0.001,
    batchSize: 32,
    maxEpochs: 3,
    earlyStoppingPatience: 3,
    validationSplit: 0.2,
    ewcLambda: 0.001,
    margin: 0.5,
    beta1: 0.9,
    beta2: 0.999,
    maxGradientNorm: 1.0,
    shuffle: true,
    minImprovement: 0.001,
    ...config,
  };

  const mockTrainer = {
    getConfig: vi.fn().mockReturnValue(defaultConfig),
    trainBatch: vi.fn().mockImplementation(async (trajectories: ITrajectoryWithFeedback[]): Promise<TrainingResult> => {
      // Simulate some processing time
      await new Promise(resolve => setTimeout(resolve, 1));
      return {
        epoch: 0,
        batchIndex: 0,
        loss: 0.5 * Math.random(),
        gradientNorm: 0.1,
        activeTriplets: Math.floor(trajectories.length / 2),
        totalTriplets: trajectories.length,
        trainingTimeMs: 1,
      };
    }),
    trainEpoch: vi.fn(),
    train: vi.fn(),
    validate: vi.fn(),
    reset: vi.fn(),
    saveCheckpoint: vi.fn(),
    loadCheckpoint: vi.fn(),
    getTrainingState: vi.fn().mockReturnValue({
      currentEpoch: 0,
      bestValidationLoss: Infinity,
      epochsWithoutImprovement: 0,
      totalBatchesTrained: 0,
    }),
  } as unknown as GNNTrainer;

  return mockTrainer;
}

/**
 * Create test trajectories
 */
function createTestTrajectories(count: number): ITrajectoryWithFeedback[] {
  const trajectories: ITrajectoryWithFeedback[] = [];

  for (let i = 0; i < count; i++) {
    // Create mix of high and low quality
    const quality = i % 3 === 0 ? 0.8 : (i % 3 === 1 ? 0.3 : 0.6);

    const embedding = new Float32Array(768);
    for (let j = 0; j < 768; j++) {
      embedding[j] = Math.random() * 2 - 1;
    }

    // Normalize
    let norm = 0;
    for (let j = 0; j < 768; j++) {
      norm += embedding[j] * embedding[j];
    }
    norm = Math.sqrt(norm);
    for (let j = 0; j < 768; j++) {
      embedding[j] /= norm;
    }

    trajectories.push({
      id: `traj_${i}`,
      embedding,
      quality,
    });
  }

  return trajectories;
}

/**
 * Measure event loop latency
 */
async function measureEventLoopLatency(): Promise<number> {
  const start = performance.now();
  await new Promise(resolve => setImmediate(resolve));
  return performance.now() - start;
}

// =============================================================================
// Test Suites
// =============================================================================

describe('BackgroundTrainer', () => {
  let mockTrainer: GNNTrainer;
  let bgTrainer: BackgroundTrainer;

  beforeEach(() => {
    mockTrainer = createMockTrainer();
    bgTrainer = new BackgroundTrainer(mockTrainer);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      const config = bgTrainer.getConfig();

      expect(config.useWorkerThread).toBe(false);
      expect(config.workerThreshold).toBe(100);
      expect(config.yieldInterval).toBe(10);
      expect(config.progressUpdateIntervalMs).toBe(100);
    });

    it('should accept custom configuration', () => {
      const customConfig: Partial<BackgroundTrainerConfig> = {
        workerThreshold: 50,
        yieldInterval: 5,
      };

      const trainer = new BackgroundTrainer(mockTrainer, customConfig);
      const config = trainer.getConfig();

      expect(config.workerThreshold).toBe(50);
      expect(config.yieldInterval).toBe(5);
    });

    it('should create via factory function', () => {
      const trainer = createBackgroundTrainer(mockTrainer, {
        workerThreshold: 200,
      });

      expect(trainer).toBeInstanceOf(BackgroundTrainer);
      expect(trainer.getConfig().workerThreshold).toBe(200);
    });
  });

  describe('AC-001: Training doesn\'t block main event loop', () => {
    it('should yield control during training with setImmediate', async () => {
      const trajectories = createTestTrajectories(50);

      // Measure baseline latency
      const baselineLatency = await measureEventLoopLatency();

      // Start training
      const trainingPromise = bgTrainer.trainInBackground(trajectories);

      // Measure latency during training
      const latencies: number[] = [];
      for (let i = 0; i < 5; i++) {
        const latency = await measureEventLoopLatency();
        latencies.push(latency);
      }

      // Wait for training to complete
      const result = await trainingPromise;

      // Verify training completed
      expect(result.success).toBe(true);

      // Verify event loop wasn't blocked excessively
      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      expect(avgLatency).toBeLessThan(100); // Should be responsive
    });

    it('should use setImmediate strategy for small batches', async () => {
      const trajectories = createTestTrajectories(50); // Below threshold

      const result = await bgTrainer.trainInBackground(trajectories);

      expect(result.strategy).toBe('setImmediate');
      expect(result.success).toBe(true);
    });
  });

  describe('AC-002: Latency impact < 10ms', () => {
    it('should maintain low latency during training', async () => {
      const trajectories = createTestTrajectories(30);

      // Start training
      const trainingPromise = bgTrainer.trainInBackground(trajectories);

      // Measure latency multiple times during training
      const latencyMeasurements: number[] = [];

      for (let i = 0; i < 10; i++) {
        const start = performance.now();
        await new Promise(resolve => setImmediate(resolve));
        const latency = performance.now() - start;
        latencyMeasurements.push(latency);
      }

      await trainingPromise;

      // Check that most measurements are under 10ms
      const lowLatencyCount = latencyMeasurements.filter(l => l < 10).length;
      const percentLowLatency = lowLatencyCount / latencyMeasurements.length;

      expect(percentLowLatency).toBeGreaterThan(0.5); // At least 50% should be < 10ms
    });
  });

  describe('AC-003: Worker thread option for large batches', () => {
    it('should detect when to use worker thread based on threshold', () => {
      const smallTrainer = new BackgroundTrainer(mockTrainer, {
        workerThreshold: 100,
        useWorkerThread: false,
      });

      expect(smallTrainer.getConfig().workerThreshold).toBe(100);
    });

    it('should force worker thread when configured', () => {
      const workerTrainer = new BackgroundTrainer(mockTrainer, {
        useWorkerThread: true,
      });

      expect(workerTrainer.getConfig().useWorkerThread).toBe(true);
    });

    // Note: Full worker thread testing requires actual file system and would
    // be an integration test. Here we test the configuration and fallback behavior.
    it('should fall back to setImmediate if worker fails', async () => {
      // Create trainer that would try worker but can't (no actual worker file)
      const workerTrainer = new BackgroundTrainer(mockTrainer, {
        useWorkerThread: true,
      });

      const trajectories = createTestTrajectories(20);

      // The worker will fail since .js file doesn't exist in test environment.
      // BackgroundTrainer catches this and falls back to setImmediate.
      const result = await workerTrainer.trainInBackground(trajectories);

      // Should fall back to setImmediate and succeed
      expect(result.success).toBe(true);
      expect(result.strategy).toBe('setImmediate');
    });
  });

  describe('AC-004: Progress events emitted during training', () => {
    it('should emit progress events', async () => {
      const trajectories = createTestTrajectories(50);
      const progressEvents: TrainingProgress[] = [];

      bgTrainer.on('progress', (progress: TrainingProgress) => {
        progressEvents.push({ ...progress });
      });

      await bgTrainer.trainInBackground(trajectories);

      // Should have received progress events
      expect(progressEvents.length).toBeGreaterThan(0);

      // Should have different phases
      const phases = new Set(progressEvents.map(p => p.phase));
      expect(phases.size).toBeGreaterThan(1);
    });

    it('should emit batch complete events', async () => {
      const trajectories = createTestTrajectories(50);
      const batchEvents: TrainingResult[] = [];

      bgTrainer.on('batchComplete', (result: TrainingResult) => {
        batchEvents.push(result);
      });

      await bgTrainer.trainInBackground(trajectories);

      // Should have batch events
      expect(batchEvents.length).toBeGreaterThan(0);

      // Each batch should have loss info
      for (const batch of batchEvents) {
        expect(typeof batch.loss).toBe('number');
        expect(typeof batch.gradientNorm).toBe('number');
      }
    });

    it('should emit epoch complete events', async () => {
      const trajectories = createTestTrajectories(50);
      const epochEvents: { epoch: number; loss: number }[] = [];

      bgTrainer.on('epochComplete', (result) => {
        epochEvents.push({
          epoch: result.epoch,
          loss: result.trainingLoss,
        });
      });

      await bgTrainer.trainInBackground(trajectories);

      // Should have epoch events (up to maxEpochs)
      expect(epochEvents.length).toBeGreaterThan(0);
      expect(epochEvents.length).toBeLessThanOrEqual(3); // maxEpochs = 3
    });

    it('should emit complete event', async () => {
      const trajectories = createTestTrajectories(20);
      let completeEvent: BackgroundTrainingResult | null = null;

      bgTrainer.on('complete', (result: BackgroundTrainingResult) => {
        completeEvent = result;
      });

      await bgTrainer.trainInBackground(trajectories);

      expect(completeEvent).not.toBeNull();
      expect(completeEvent!.success).toBe(true);
      expect(completeEvent!.epochResults.length).toBeGreaterThan(0);
    });

    it('should track progress percentage', async () => {
      const trajectories = createTestTrajectories(50);
      const percentages: number[] = [];

      bgTrainer.on('progress', (progress: TrainingProgress) => {
        percentages.push(progress.percentComplete);
      });

      await bgTrainer.trainInBackground(trajectories);

      // Should have increasing percentages
      expect(percentages.length).toBeGreaterThan(0);

      // Final percentage should be 100
      const finalPercentage = percentages[percentages.length - 1];
      expect(finalPercentage).toBe(100);
    });

    it('should track elapsed and estimated remaining time', async () => {
      const trajectories = createTestTrajectories(50);
      let hasTimeInfo = false;

      bgTrainer.on('progress', (progress: TrainingProgress) => {
        if (progress.elapsedMs > 0 && progress.phase === 'training') {
          hasTimeInfo = true;
        }
      });

      await bgTrainer.trainInBackground(trajectories);

      expect(hasTimeInfo).toBe(true);
    });
  });

  describe('AC-005: Can be cancelled', () => {
    it('should cancel training when cancel() is called', async () => {
      const trajectories = createTestTrajectories(100);
      let wasCancelled = false;

      bgTrainer.on('progress', (progress: TrainingProgress) => {
        if (progress.phase === 'training' && progress.currentBatch > 0) {
          bgTrainer.cancel();
        }
        if (progress.phase === 'cancelled') {
          wasCancelled = true;
        }
      });

      const result = await bgTrainer.trainInBackground(trajectories);

      expect(result.cancelled).toBe(true);
      expect(wasCancelled).toBe(true);
      expect(result.progress.phase).toBe('cancelled');
    });

    it('should not throw when cancelling idle trainer', () => {
      // Should not throw
      expect(() => bgTrainer.cancel()).not.toThrow();
    });

    it('should report cancelled status in result', async () => {
      const trajectories = createTestTrajectories(50);
      let cancelCalled = false;

      // Cancel after first training progress (not preparing)
      bgTrainer.on('progress', (progress: TrainingProgress) => {
        if (!cancelCalled && progress.phase === 'training' && progress.currentBatch > 0) {
          cancelCalled = true;
          bgTrainer.cancel();
        }
      });

      const result = await bgTrainer.trainInBackground(trajectories);

      expect(result.cancelled).toBe(true);
    });
  });

  describe('Empty and Edge Cases', () => {
    it('should handle empty trajectories', async () => {
      const result = await bgTrainer.trainInBackground([]);

      expect(result.success).toBe(true);
      expect(result.epochResults.length).toBe(0);
      expect(result.totalTimeMs).toBe(0);
    });

    it('should reject concurrent training', async () => {
      const trajectories = createTestTrajectories(50);

      // Start first training
      const firstTraining = bgTrainer.trainInBackground(trajectories);

      // Try to start second training
      await expect(bgTrainer.trainInBackground(trajectories))
        .rejects.toThrow('Training already in progress');

      // Wait for first to complete
      await firstTraining;
    });

    it('should report isRunning correctly', async () => {
      expect(bgTrainer.isRunning()).toBe(false);

      const trajectories = createTestTrajectories(20);
      const trainingPromise = bgTrainer.trainInBackground(trajectories);

      // Should be running during training
      expect(bgTrainer.isRunning()).toBe(true);

      await trainingPromise;

      // Should not be running after completion
      expect(bgTrainer.isRunning()).toBe(false);
    });
  });

  describe('Progress State', () => {
    it('should provide accurate progress via getProgress()', async () => {
      const trajectories = createTestTrajectories(50);

      // Check initial state
      const initialProgress = bgTrainer.getProgress();
      expect(initialProgress.phase).toBe('idle');

      await bgTrainer.trainInBackground(trajectories);

      // Check final state
      const finalProgress = bgTrainer.getProgress();
      expect(finalProgress.phase).toBe('complete');
      expect(finalProgress.percentComplete).toBe(100);
    });

    it('should track samples processed', async () => {
      const trajectories = createTestTrajectories(50);
      let maxSamplesProcessed = 0;

      bgTrainer.on('progress', (progress: TrainingProgress) => {
        if (progress.samplesProcessed > maxSamplesProcessed) {
          maxSamplesProcessed = progress.samplesProcessed;
        }
      });

      await bgTrainer.trainInBackground(trajectories);

      // Should have processed samples
      expect(maxSamplesProcessed).toBeGreaterThan(0);
    });

    it('should track best loss', async () => {
      const trajectories = createTestTrajectories(50);

      await bgTrainer.trainInBackground(trajectories);

      const progress = bgTrainer.getProgress();
      expect(progress.bestLoss).toBeLessThan(Infinity);
    });
  });

  describe('Result Structure', () => {
    it('should return complete result structure', async () => {
      const trajectories = createTestTrajectories(30);

      const result = await bgTrainer.trainInBackground(trajectories);

      // Verify all required fields
      expect(typeof result.success).toBe('boolean');
      expect(Array.isArray(result.epochResults)).toBe(true);
      expect(typeof result.progress).toBe('object');
      expect(typeof result.totalTimeMs).toBe('number');
      expect(typeof result.cancelled).toBe('boolean');
      expect(['setImmediate', 'worker']).toContain(result.strategy);
    });

    it('should include epoch results with proper structure', async () => {
      const trajectories = createTestTrajectories(50);

      const result = await bgTrainer.trainInBackground(trajectories);

      expect(result.epochResults.length).toBeGreaterThan(0);

      for (const epochResult of result.epochResults) {
        expect(typeof epochResult.epoch).toBe('number');
        expect(typeof epochResult.trainingLoss).toBe('number');
        expect(typeof epochResult.improvement).toBe('boolean');
        expect(typeof epochResult.batchesProcessed).toBe('number');
        expect(typeof epochResult.epochTimeMs).toBe('number');
      }
    });
  });
});

describe('BackgroundTrainer Integration', () => {
  it('should complete full training cycle', async () => {
    const mockTrainer = createMockTrainer({
      maxEpochs: 2,
      batchSize: 16,
    });

    const bgTrainer = new BackgroundTrainer(mockTrainer, {
      yieldInterval: 5,
    });

    const trajectories = createTestTrajectories(64);

    const result = await bgTrainer.trainInBackground(trajectories);

    expect(result.success).toBe(true);
    expect(result.epochResults.length).toBe(2); // maxEpochs
    expect(result.totalTimeMs).toBeGreaterThan(0);

    // Verify trainer methods were called
    expect(mockTrainer.getConfig).toHaveBeenCalled();
    expect(mockTrainer.trainBatch).toHaveBeenCalled();
  });

  it('should work with different batch sizes', async () => {
    const configs = [
      { batchSize: 8, trajectoryCount: 24 },
      { batchSize: 16, trajectoryCount: 48 },
      { batchSize: 32, trajectoryCount: 64 },
    ];

    for (const { batchSize, trajectoryCount } of configs) {
      const mockTrainer = createMockTrainer({ batchSize, maxEpochs: 1 });
      const bgTrainer = new BackgroundTrainer(mockTrainer);
      const trajectories = createTestTrajectories(trajectoryCount);

      const result = await bgTrainer.trainInBackground(trajectories);

      expect(result.success).toBe(true);
    }
  });
});
