/**
 * TrainingTriggerController Unit Tests
 *
 * Tests for TASK-GNN-009 implementation:
 * - AC-001: Training triggers at 50 samples (COLD_START_THRESHOLD)
 * - AC-002: Cooldown prevents excessive training
 * - AC-003: Shutdown triggers final training epoch
 * - AC-004: Buffer persists to disk for restart recovery
 * - AC-005: Stats available for monitoring
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TrainingTriggerController } from '../../../../src/god-agent/core/reasoning/training-trigger.js';
import { COLD_START_THRESHOLD } from '../../../../src/god-agent/core/validation/constants.js';
import type { GNNTrainer, TrainingDataset, EpochResult } from '../../../../src/god-agent/core/reasoning/gnn-trainer.js';
import type { ITrajectoryWithFeedback } from '../../../../src/god-agent/core/reasoning/contrastive-loss.js';

// Mock GNNTrainer
const createMockTrainer = (): GNNTrainer => {
  return {
    train: vi.fn().mockResolvedValue([
      {
        epoch: 1,
        trainingLoss: 0.5,
        validationLoss: 0.45,
        improvement: true,
        stoppedEarly: false,
        batchesProcessed: 5,
        epochTimeMs: 100,
        avgGradientNorm: 0.1,
      },
      {
        epoch: 2,
        trainingLoss: 0.3,
        validationLoss: 0.28,
        improvement: true,
        stoppedEarly: false,
        batchesProcessed: 5,
        epochTimeMs: 90,
        avgGradientNorm: 0.08,
      },
    ] as EpochResult[]),
    trainBatch: vi.fn(),
    trainEpoch: vi.fn(),
    getConfig: vi.fn(),
    getTrainingState: vi.fn(),
    reset: vi.fn(),
  } as unknown as GNNTrainer;
};

// Create a mock trajectory with feedback
const createMockTrajectory = (id: string, quality: number): ITrajectoryWithFeedback => {
  const embedding = new Float32Array(1536);
  for (let i = 0; i < 1536; i++) {
    embedding[i] = Math.random();
  }
  return {
    id,
    embedding,
    quality,
  };
};

describe('TrainingTriggerController', () => {
  let trigger: TrainingTriggerController;
  let mockTrainer: GNNTrainer;

  beforeEach(() => {
    mockTrainer = createMockTrainer();
    trigger = new TrainingTriggerController(mockTrainer, {
      minSamples: 5, // Lower for testing
      cooldownMs: 1000, // 1 second for testing
      maxPendingSamples: 20,
      enablePersistence: false, // Disable for unit tests
      autoCheckIntervalMs: 60000, // Long interval to prevent auto-checks during tests
    });
  });

  afterEach(() => {
    trigger.destroy();
  });

  describe('Configuration', () => {
    it('should initialize with custom configuration', () => {
      const config = trigger.getConfig();
      expect(config.minSamples).toBe(5);
      expect(config.cooldownMs).toBe(1000);
      expect(config.maxPendingSamples).toBe(20);
    });

    it('should use COLD_START_THRESHOLD as default minSamples', () => {
      const defaultTrigger = new TrainingTriggerController(mockTrainer, {
        enablePersistence: false,
        autoCheckIntervalMs: 60000,
      });
      expect(defaultTrigger.getConfig().minSamples).toBe(COLD_START_THRESHOLD);
      defaultTrigger.destroy();
    });

    it('should throw error for invalid minSamples', () => {
      expect(() => new TrainingTriggerController(mockTrainer, { minSamples: 0 }))
        .toThrow('minSamples must be at least 1');
    });

    it('should throw error for negative cooldownMs', () => {
      expect(() => new TrainingTriggerController(mockTrainer, { cooldownMs: -1 }))
        .toThrow('cooldownMs cannot be negative');
    });

    it('should throw error if maxPendingSamples < minSamples', () => {
      expect(() => new TrainingTriggerController(mockTrainer, { minSamples: 10, maxPendingSamples: 5 }))
        .toThrow('maxPendingSamples must be >= minSamples');
    });
  });

  describe('AC-001: Training triggers at threshold', () => {
    it('should not trigger when buffer is below threshold', () => {
      // Add fewer than threshold samples
      for (let i = 0; i < 3; i++) {
        trigger.addTrajectory(createMockTrajectory(`traj_${i}`, 0.8));
      }

      expect(trigger.shouldTrigger()).toBe(false);
      expect(trigger.getStats().samplesToNextTrigger).toBe(2);
    });

    it('should trigger when buffer reaches threshold', () => {
      // Add exactly threshold samples
      for (let i = 0; i < 5; i++) {
        trigger.addTrajectory(createMockTrajectory(`traj_${i}`, 0.8));
      }

      expect(trigger.shouldTrigger()).toBe(true);
      expect(trigger.getStats().samplesToNextTrigger).toBe(0);
    });

    it('should run training when checkAndTrain is called at threshold', async () => {
      // Add threshold samples
      for (let i = 0; i < 5; i++) {
        trigger.addTrajectory(createMockTrajectory(`traj_${i}`, 0.8));
      }

      const result = await trigger.checkAndTrain();

      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('Threshold reached');
      expect(result.epochResults).toHaveLength(2);
      expect(result.finalLoss).toBe(0.3);
      expect(mockTrainer.train).toHaveBeenCalledTimes(1);
    });

    it('should clear buffer after successful training', async () => {
      for (let i = 0; i < 5; i++) {
        trigger.addTrajectory(createMockTrajectory(`traj_${i}`, 0.8));
      }

      await trigger.checkAndTrain();

      expect(trigger.getBufferSize()).toBe(0);
      expect(trigger.getStats().bufferSize).toBe(0);
    });
  });

  describe('AC-002: Cooldown prevents excessive training', () => {
    it('should not trigger during cooldown period', async () => {
      // First training
      for (let i = 0; i < 5; i++) {
        trigger.addTrajectory(createMockTrajectory(`traj_${i}`, 0.8));
      }
      await trigger.checkAndTrain();

      // Add more samples immediately
      for (let i = 0; i < 5; i++) {
        trigger.addTrajectory(createMockTrajectory(`traj_second_${i}`, 0.8));
      }

      // Should not trigger due to cooldown
      expect(trigger.shouldTrigger()).toBe(false);
      expect(trigger.getStats().inCooldown).toBe(true);
      expect(trigger.getStats().cooldownRemainingMs).toBeGreaterThan(0);
    });

    it('should include cooldown reason in checkAndTrain result', async () => {
      // First training
      for (let i = 0; i < 5; i++) {
        trigger.addTrajectory(createMockTrajectory(`traj_${i}`, 0.8));
      }
      await trigger.checkAndTrain();

      // Add more and try again
      for (let i = 0; i < 5; i++) {
        trigger.addTrajectory(createMockTrajectory(`traj_second_${i}`, 0.8));
      }

      const result = await trigger.checkAndTrain();
      expect(result.triggered).toBe(false);
      expect(result.reason).toContain('cooldown');
    });

    it('should trigger after cooldown expires', async () => {
      // Create trigger with very short cooldown
      const shortCooldownTrigger = new TrainingTriggerController(mockTrainer, {
        minSamples: 3,
        cooldownMs: 50, // 50ms cooldown
        enablePersistence: false,
        autoCheckIntervalMs: 60000,
      });

      try {
        // First training
        for (let i = 0; i < 3; i++) {
          shortCooldownTrigger.addTrajectory(createMockTrajectory(`traj_${i}`, 0.8));
        }
        await shortCooldownTrigger.checkAndTrain();

        // Wait for cooldown
        await new Promise(resolve => setTimeout(resolve, 100));

        // Add more samples
        for (let i = 0; i < 3; i++) {
          shortCooldownTrigger.addTrajectory(createMockTrajectory(`traj_second_${i}`, 0.8));
        }

        expect(shortCooldownTrigger.shouldTrigger()).toBe(true);
      } finally {
        shortCooldownTrigger.destroy();
      }
    });
  });

  describe('AC-003: Shutdown triggers final training', () => {
    it('should force training on forceTraining call', async () => {
      // Add fewer than threshold samples
      for (let i = 0; i < 3; i++) {
        trigger.addTrajectory(createMockTrajectory(`traj_${i}`, 0.8));
      }

      // Should not normally trigger
      expect(trigger.shouldTrigger()).toBe(false);

      // Force training
      const result = await trigger.forceTraining();

      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('Force triggered');
      expect(mockTrainer.train).toHaveBeenCalledTimes(1);
    });

    it('should not force training on empty buffer', async () => {
      const result = await trigger.forceTraining();

      expect(result.triggered).toBe(false);
      expect(result.reason).toBe('Buffer is empty, nothing to train');
    });

    it('should force training even during cooldown', async () => {
      // First training
      for (let i = 0; i < 5; i++) {
        trigger.addTrajectory(createMockTrajectory(`traj_${i}`, 0.8));
      }
      await trigger.checkAndTrain();

      // Add more samples (in cooldown)
      for (let i = 0; i < 3; i++) {
        trigger.addTrajectory(createMockTrajectory(`traj_force_${i}`, 0.8));
      }

      // Should be in cooldown
      expect(trigger.getStats().inCooldown).toBe(true);

      // Force training should still work
      const result = await trigger.forceTraining();
      expect(result.triggered).toBe(true);
      expect(mockTrainer.train).toHaveBeenCalledTimes(2);
    });
  });

  describe('AC-005: Stats available for monitoring', () => {
    it('should track buffer size correctly', () => {
      expect(trigger.getStats().bufferSize).toBe(0);

      trigger.addTrajectory(createMockTrajectory('traj_1', 0.8));
      expect(trigger.getStats().bufferSize).toBe(1);

      trigger.addTrajectory(createMockTrajectory('traj_2', 0.7));
      expect(trigger.getStats().bufferSize).toBe(2);
    });

    it('should track total trajectories processed', async () => {
      expect(trigger.getStats().totalTrajectoriesProcessed).toBe(0);

      for (let i = 0; i < 5; i++) {
        trigger.addTrajectory(createMockTrajectory(`traj_${i}`, 0.8));
      }
      expect(trigger.getStats().totalTrajectoriesProcessed).toBe(5);

      // Training should clear buffer but preserve total count
      await trigger.checkAndTrain();
      expect(trigger.getStats().totalTrajectoriesProcessed).toBe(5);

      // Add more
      trigger.addTrajectory(createMockTrajectory('traj_new', 0.9));
      expect(trigger.getStats().totalTrajectoriesProcessed).toBe(6);
    });

    it('should track training runs', async () => {
      expect(trigger.getStats().totalTrainingRuns).toBe(0);

      for (let i = 0; i < 5; i++) {
        trigger.addTrajectory(createMockTrajectory(`traj_${i}`, 0.8));
      }
      await trigger.checkAndTrain();

      expect(trigger.getStats().totalTrainingRuns).toBe(1);
      expect(trigger.getStats().lastTrainingTime).toBeGreaterThan(0);
      expect(trigger.getStats().lastTrainingLoss).toBe(0.3);
    });

    it('should report training in progress', async () => {
      // Create a slow trainer
      const slowTrainer = {
        train: vi.fn().mockImplementation(async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return [{
            epoch: 1,
            trainingLoss: 0.5,
            validationLoss: 0.45,
            improvement: true,
            stoppedEarly: false,
            batchesProcessed: 5,
            epochTimeMs: 100,
            avgGradientNorm: 0.1,
          }];
        }),
      } as unknown as GNNTrainer;

      const slowTrigger = new TrainingTriggerController(slowTrainer, {
        minSamples: 3,
        enablePersistence: false,
        autoCheckIntervalMs: 60000,
      });

      try {
        for (let i = 0; i < 3; i++) {
          slowTrigger.addTrajectory(createMockTrajectory(`traj_${i}`, 0.8));
        }

        // Start training but don't await
        const trainingPromise = slowTrigger.checkAndTrain();

        // Check status during training
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(slowTrigger.getStats().trainingInProgress).toBe(true);

        // Wait for completion
        await trainingPromise;
        expect(slowTrigger.getStats().trainingInProgress).toBe(false);
      } finally {
        slowTrigger.destroy();
      }
    });

    it('should calculate samplesToNextTrigger correctly', () => {
      expect(trigger.getStats().samplesToNextTrigger).toBe(5);

      trigger.addTrajectory(createMockTrajectory('traj_1', 0.8));
      expect(trigger.getStats().samplesToNextTrigger).toBe(4);

      trigger.addTrajectory(createMockTrajectory('traj_2', 0.8));
      expect(trigger.getStats().samplesToNextTrigger).toBe(3);
    });
  });

  describe('Buffer Management', () => {
    it('should skip invalid trajectories', () => {
      // Missing id
      trigger.addTrajectory({ id: '', embedding: new Float32Array(1536), quality: 0.8 });
      expect(trigger.getBufferSize()).toBe(0);

      // Missing quality
      trigger.addTrajectory({ id: 'traj_1', embedding: new Float32Array(1536), quality: undefined as any });
      expect(trigger.getBufferSize()).toBe(0);

      // Valid trajectory
      trigger.addTrajectory(createMockTrajectory('traj_valid', 0.8));
      expect(trigger.getBufferSize()).toBe(1);
    });

    it('should clear buffer manually', () => {
      for (let i = 0; i < 3; i++) {
        trigger.addTrajectory(createMockTrajectory(`traj_${i}`, 0.8));
      }
      expect(trigger.getBufferSize()).toBe(3);

      trigger.clearBuffer();
      expect(trigger.getBufferSize()).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle training errors gracefully', async () => {
      const failingTrainer = {
        train: vi.fn().mockRejectedValue(new Error('Training failed')),
      } as unknown as GNNTrainer;

      const errorTrigger = new TrainingTriggerController(failingTrainer, {
        minSamples: 3,
        enablePersistence: false,
        autoCheckIntervalMs: 60000,
      });

      try {
        for (let i = 0; i < 3; i++) {
          errorTrigger.addTrajectory(createMockTrajectory(`traj_${i}`, 0.8));
        }

        const result = await errorTrigger.checkAndTrain();

        expect(result.triggered).toBe(true);
        expect(result.reason).toContain('Training failed');
      } finally {
        errorTrigger.destroy();
      }
    });
  });
});
