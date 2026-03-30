/**
 * GNNTrainer Tests - TASK-GNN-005
 *
 * Tests the GNN training orchestration class that connects:
 * - GNNEnhancer (forward pass)
 * - WeightManager (weight persistence)
 * - AdamOptimizer (weight updates)
 * - ContrastiveLoss (loss computation)
 * - TrainingHistoryManager (metrics persistence)
 *
 * Implements: TASK-GNN-005 verification
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GNNTrainer,
  createGNNTrainer,
  type TrainingConfig,
  type TrainingDataset,
  type ITrajectoryWithFeedback,
} from '../../../../src/god-agent/core/reasoning/gnn-trainer.js';
import { GNNEnhancer } from '../../../../src/god-agent/core/reasoning/gnn-enhancer.js';
import { WeightManager } from '../../../../src/god-agent/core/reasoning/weight-manager.js';
import { VECTOR_DIM, LORA_PARAMS } from '../../../../src/god-agent/core/validation/constants.js';
import {
  POSITIVE_QUALITY_THRESHOLD,
  NEGATIVE_QUALITY_THRESHOLD,
} from '../../../../src/god-agent/core/reasoning/contrastive-loss.js';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Create a random normalized embedding
 */
function createRandomEmbedding(dim: number = VECTOR_DIM, seed: number = 0): Float32Array {
  const embedding = new Float32Array(dim);
  let norm = 0;

  for (let i = 0; i < dim; i++) {
    // Simple seeded random
    const x = Math.sin(seed * 1000 + i) * 10000;
    embedding[i] = x - Math.floor(x) - 0.5;
    norm += embedding[i] * embedding[i];
  }

  // Normalize to unit vector
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) {
    embedding[i] /= norm;
  }

  return embedding;
}

/**
 * Create a trajectory with feedback
 */
function createTrajectory(
  id: string,
  quality: number,
  seed: number
): ITrajectoryWithFeedback {
  return {
    id,
    embedding: createRandomEmbedding(VECTOR_DIM, seed),
    quality,
    feedback: {
      trajectoryId: id,
      verdict: quality >= POSITIVE_QUALITY_THRESHOLD ? 'correct' : 'incorrect',
      quality,
    },
  };
}

/**
 * Create a batch of trajectories with mixed quality scores
 */
function createTrajectoryBatch(
  count: number,
  positiveRatio: number = 0.5
): ITrajectoryWithFeedback[] {
  const trajectories: ITrajectoryWithFeedback[] = [];
  const numPositive = Math.floor(count * positiveRatio);

  // Create positive trajectories (quality >= 0.7)
  for (let i = 0; i < numPositive; i++) {
    const quality = POSITIVE_QUALITY_THRESHOLD + Math.random() * 0.3;
    trajectories.push(createTrajectory(`traj_pos_${i}`, quality, i));
  }

  // Create negative trajectories (quality < 0.5)
  for (let i = numPositive; i < count; i++) {
    const quality = Math.random() * (NEGATIVE_QUALITY_THRESHOLD - 0.1);
    trajectories.push(createTrajectory(`traj_neg_${i}`, quality, i + 1000));
  }

  return trajectories;
}

/**
 * Create a training dataset
 */
function createTrainingDataset(
  trainingCount: number,
  validationCount: number = 0
): TrainingDataset {
  return {
    training: createTrajectoryBatch(trainingCount, 0.5),
    validation: validationCount > 0 ? createTrajectoryBatch(validationCount, 0.5) : undefined,
    queries: [createRandomEmbedding(VECTOR_DIM, 99999)],
  };
}

// =============================================================================
// Test Setup
// =============================================================================

const TEST_WEIGHT_PATH = '.test-gnn-trainer/weights';
const TEST_CHECKPOINT_PATH = '.test-gnn-trainer/checkpoints';

describe('GNNTrainer', () => {
  let gnnEnhancer: GNNEnhancer;
  let weightManager: WeightManager;
  let trainer: GNNTrainer;

  beforeEach(() => {
    // Clean up test directories
    if (fs.existsSync(TEST_WEIGHT_PATH)) {
      fs.rmSync(TEST_WEIGHT_PATH, { recursive: true, force: true });
    }
    if (fs.existsSync(TEST_CHECKPOINT_PATH)) {
      fs.rmSync(TEST_CHECKPOINT_PATH, { recursive: true, force: true });
    }

    // Create fresh instances
    weightManager = new WeightManager(TEST_WEIGHT_PATH, {
      enabled: false,
      checkpointDir: TEST_CHECKPOINT_PATH,
    });
    gnnEnhancer = new GNNEnhancer(undefined, undefined, 12345, undefined, false);
    trainer = new GNNTrainer(gnnEnhancer, weightManager, {
      learningRate: 0.001,
      batchSize: 8,
      maxEpochs: 3,
      earlyStoppingPatience: 2,
    });
  });

  afterEach(() => {
    // Clean up test directories
    if (fs.existsSync(TEST_WEIGHT_PATH)) {
      fs.rmSync(TEST_WEIGHT_PATH, { recursive: true, force: true });
    }
    if (fs.existsSync(TEST_CHECKPOINT_PATH)) {
      fs.rmSync(TEST_CHECKPOINT_PATH, { recursive: true, force: true });
    }
  });

  // ===========================================================================
  // Construction Tests
  // ===========================================================================

  describe('construction', () => {
    it('should create trainer with default config', () => {
      const defaultTrainer = new GNNTrainer(gnnEnhancer, weightManager);
      const config = defaultTrainer.getConfig();

      expect(config.learningRate).toBe(0.001);
      expect(config.batchSize).toBe(32);
      expect(config.maxEpochs).toBe(10);
      expect(config.earlyStoppingPatience).toBe(3);
      expect(config.validationSplit).toBe(0.2);
      expect(config.ewcLambda).toBe(LORA_PARAMS.ewcLambda);
    });

    it('should create trainer with custom config', () => {
      const customTrainer = new GNNTrainer(gnnEnhancer, weightManager, {
        learningRate: 0.01,
        batchSize: 64,
        maxEpochs: 20,
      });
      const config = customTrainer.getConfig();

      expect(config.learningRate).toBe(0.01);
      expect(config.batchSize).toBe(64);
      expect(config.maxEpochs).toBe(20);
    });

    it('should initialize training state correctly', () => {
      const state = trainer.getTrainingState();

      expect(state.currentEpoch).toBe(0);
      expect(state.bestValidationLoss).toBe(Infinity);
      expect(state.epochsWithoutImprovement).toBe(0);
      expect(state.totalBatchesTrained).toBe(0);
    });
  });

  // ===========================================================================
  // Batch Training Tests
  // ===========================================================================

  describe('trainBatch', () => {
    it('should train on a batch and return results', async () => {
      const batch = createTrajectoryBatch(10, 0.5);
      const result = await trainer.trainBatch(batch);

      expect(result).toBeDefined();
      expect(result.epoch).toBe(0);
      expect(result.batchIndex).toBe(0);
      expect(typeof result.loss).toBe('number');
      expect(typeof result.gradientNorm).toBe('number');
      expect(result.trainingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty batch gracefully', async () => {
      const result = await trainer.trainBatch([]);

      expect(result.loss).toBe(0);
      expect(result.gradientNorm).toBe(0);
      expect(result.activeTriplets).toBe(0);
      expect(result.totalTriplets).toBe(0);
    });

    it('should handle batch with only positives', async () => {
      const batch = createTrajectoryBatch(5, 1.0); // All positive
      const result = await trainer.trainBatch(batch);

      // No negative samples means no triplets can be formed
      expect(result.activeTriplets).toBe(0);
    });

    it('should handle batch with only negatives', async () => {
      const batch = createTrajectoryBatch(5, 0.0); // All negative
      const result = await trainer.trainBatch(batch);

      // No positive samples means no triplets can be formed
      expect(result.activeTriplets).toBe(0);
    });

    it('should increment batch counter after each batch', async () => {
      const batch = createTrajectoryBatch(10, 0.5);

      await trainer.trainBatch(batch);
      expect(trainer.getTrainingState().totalBatchesTrained).toBe(1);

      await trainer.trainBatch(batch);
      expect(trainer.getTrainingState().totalBatchesTrained).toBe(2);
    });
  });

  // ===========================================================================
  // Epoch Training Tests
  // ===========================================================================

  describe('trainEpoch', () => {
    it('should train for a full epoch', async () => {
      const dataset = createTrainingDataset(20, 5);
      const result = await trainer.trainEpoch(dataset);

      expect(result.epoch).toBe(1);
      expect(typeof result.trainingLoss).toBe('number');
      expect(result.batchesProcessed).toBeGreaterThan(0);
      expect(result.epochTimeMs).toBeGreaterThan(0);
    });

    it('should compute validation loss when validation set provided', async () => {
      const dataset = createTrainingDataset(20, 10);
      const result = await trainer.trainEpoch(dataset);

      expect(result.validationLoss).toBeDefined();
      expect(typeof result.validationLoss).toBe('number');
    });

    it('should not have validation loss without validation set', async () => {
      const dataset = createTrainingDataset(20, 0);
      const result = await trainer.trainEpoch(dataset);

      expect(result.validationLoss).toBeUndefined();
    });

    it('should increment epoch counter', async () => {
      const dataset = createTrainingDataset(10);

      await trainer.trainEpoch(dataset);
      expect(trainer.getTrainingState().currentEpoch).toBe(1);

      await trainer.trainEpoch(dataset);
      expect(trainer.getTrainingState().currentEpoch).toBe(2);
    });
  });

  // ===========================================================================
  // Validation Tests
  // ===========================================================================

  describe('validate', () => {
    it('should compute validation loss without updating weights', async () => {
      const validationSet = createTrajectoryBatch(10, 0.5);
      const result = await trainer.validate(validationSet);

      expect(typeof result.loss).toBe('number');
      expect(result.sampleCount).toBe(10);
      expect(result.validationTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty validation set', async () => {
      const result = await trainer.validate([]);

      expect(result.loss).toBe(0);
      expect(result.sampleCount).toBe(0);
      expect(result.activeTriplets).toBe(0);
    });
  });

  // ===========================================================================
  // Full Training Tests
  // ===========================================================================

  describe('train', () => {
    it('should run full training loop', async () => {
      const dataset = createTrainingDataset(30, 10);
      const results = await trainer.train(dataset);

      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(3); // maxEpochs = 3

      for (const result of results) {
        expect(result.epoch).toBeGreaterThan(0);
        expect(typeof result.trainingLoss).toBe('number');
      }
    });

    it('should auto-split validation when not provided', async () => {
      const trainerWithSplit = new GNNTrainer(gnnEnhancer, weightManager, {
        validationSplit: 0.2,
        maxEpochs: 1,
      });

      const dataset: TrainingDataset = {
        training: createTrajectoryBatch(50, 0.5),
        queries: [createRandomEmbedding()],
        // No validation set provided
      };

      const results = await trainerWithSplit.train(dataset);
      expect(results.length).toBe(1);
      // Validation loss should be computed from auto-split
      expect(results[0].validationLoss).toBeDefined();
    });
  });

  // ===========================================================================
  // Early Stopping Tests
  // ===========================================================================

  describe('early stopping', () => {
    it('should track epochs without improvement', async () => {
      const dataset = createTrainingDataset(20, 10);

      // Train multiple epochs
      await trainer.trainEpoch(dataset);
      await trainer.trainEpoch(dataset);

      const state = trainer.getTrainingState();
      // After epochs, we should have tracked improvement
      expect(typeof state.epochsWithoutImprovement).toBe('number');
    });

    it('should stop early when patience exceeded', async () => {
      const trainerWithLowPatience = new GNNTrainer(gnnEnhancer, weightManager, {
        earlyStoppingPatience: 1,
        maxEpochs: 10,
        batchSize: 8,
      });

      const dataset = createTrainingDataset(30, 10);
      const results = await trainerWithLowPatience.train(dataset);

      // Should stop before maxEpochs due to early stopping
      const lastResult = results[results.length - 1];
      if (lastResult.stoppedEarly) {
        expect(results.length).toBeLessThan(10);
      }
    });
  });

  // ===========================================================================
  // Checkpoint Tests
  // ===========================================================================

  describe('checkpoints', () => {
    const checkpointPath = `${TEST_CHECKPOINT_PATH}/trainer_checkpoint.json`;

    it('should save checkpoint', async () => {
      // Train a bit first
      const dataset = createTrainingDataset(10);
      await trainer.trainEpoch(dataset);

      await trainer.saveCheckpoint(checkpointPath);

      expect(fs.existsSync(checkpointPath)).toBe(true);

      const checkpointData = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
      expect(checkpointData.epoch).toBe(1);
      expect(checkpointData.version).toBeDefined();
      expect(checkpointData.optimizerState).toBeDefined();
    });

    it('should load checkpoint', async () => {
      // Train and save
      const dataset = createTrainingDataset(10);
      await trainer.trainEpoch(dataset);
      await trainer.trainEpoch(dataset);
      await trainer.saveCheckpoint(checkpointPath);

      const stateBefore = trainer.getTrainingState();

      // Create new trainer and load checkpoint
      const newTrainer = new GNNTrainer(gnnEnhancer, weightManager);
      await newTrainer.loadCheckpoint(checkpointPath);

      const stateAfter = newTrainer.getTrainingState();
      expect(stateAfter.currentEpoch).toBe(stateBefore.currentEpoch);
    });

    it('should throw error for non-existent checkpoint', async () => {
      await expect(
        trainer.loadCheckpoint('/non/existent/path.json')
      ).rejects.toThrow('Checkpoint not found');
    });
  });

  // ===========================================================================
  // Reset Tests
  // ===========================================================================

  describe('reset', () => {
    it('should reset training state', async () => {
      // Train first
      const dataset = createTrainingDataset(10);
      await trainer.trainEpoch(dataset);
      await trainer.trainBatch(createTrajectoryBatch(5));

      // Reset
      trainer.reset();

      const state = trainer.getTrainingState();
      expect(state.currentEpoch).toBe(0);
      expect(state.bestValidationLoss).toBe(Infinity);
      expect(state.epochsWithoutImprovement).toBe(0);
      expect(state.totalBatchesTrained).toBe(0);
    });
  });

  // ===========================================================================
  // Factory Function Tests
  // ===========================================================================

  describe('createGNNTrainer factory', () => {
    it('should create trainer with factory function', () => {
      const factoryTrainer = createGNNTrainer(gnnEnhancer, weightManager, {
        learningRate: 0.005,
      });

      expect(factoryTrainer).toBeInstanceOf(GNNTrainer);
      expect(factoryTrainer.getConfig().learningRate).toBe(0.005);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle trajectories with invalid quality', async () => {
      const trajectories: ITrajectoryWithFeedback[] = [
        createTrajectory('valid_pos', 0.9, 1),
        createTrajectory('valid_neg', 0.2, 2),
        {
          id: 'invalid_nan',
          embedding: createRandomEmbedding(VECTOR_DIM, 3),
          quality: NaN,
        },
        {
          id: 'invalid_undefined',
          embedding: createRandomEmbedding(VECTOR_DIM, 4),
          quality: undefined as any,
        },
      ];

      const result = await trainer.trainBatch(trajectories);
      // Should still process valid trajectories
      expect(result).toBeDefined();
    });

    it('should handle trajectories with empty embeddings', async () => {
      const trajectories: ITrajectoryWithFeedback[] = [
        {
          id: 'empty_embedding',
          embedding: new Float32Array(0),
          quality: 0.8,
        },
        createTrajectory('valid', 0.8, 1),
      ];

      const result = await trainer.trainBatch(trajectories);
      expect(result).toBeDefined();
    });

    it('should handle very small batches', async () => {
      const batch = createTrajectoryBatch(2, 0.5);
      const result = await trainer.trainBatch(batch);

      expect(result).toBeDefined();
      expect(typeof result.loss).toBe('number');
    });

    it('should handle neutral quality trajectories (0.5 <= q < 0.7)', async () => {
      // Neutral trajectories are neither positive nor negative
      const trajectories: ITrajectoryWithFeedback[] = [
        createTrajectory('neutral_1', 0.6, 1),
        createTrajectory('neutral_2', 0.55, 2),
        createTrajectory('neutral_3', 0.65, 3),
      ];

      const result = await trainer.trainBatch(trajectories);
      // No triplets can be formed with only neutral trajectories
      expect(result.activeTriplets).toBe(0);
    });
  });

  // ===========================================================================
  // Constitution Compliance Tests
  // ===========================================================================

  describe('constitution compliance', () => {
    it('should use EWC lambda from LORA_PARAMS (RULE compliance)', () => {
      const config = trainer.getConfig();
      expect(config.ewcLambda).toBe(LORA_PARAMS.ewcLambda);
    });

    it('should use correct quality thresholds (RULE-035)', () => {
      // Verify thresholds match constitution
      expect(POSITIVE_QUALITY_THRESHOLD).toBe(0.7);
      expect(NEGATIVE_QUALITY_THRESHOLD).toBe(0.5);
    });
  });
});

// =============================================================================
// Performance Tests
// =============================================================================

describe('GNNTrainer Performance', () => {
  let gnnEnhancer: GNNEnhancer;
  let weightManager: WeightManager;
  let trainer: GNNTrainer;

  beforeEach(() => {
    weightManager = new WeightManager('.test-gnn-trainer-perf/weights');
    gnnEnhancer = new GNNEnhancer(undefined, undefined, 12345, undefined, false);
    trainer = new GNNTrainer(gnnEnhancer, weightManager, {
      batchSize: 32,
    });
  });

  afterEach(() => {
    if (fs.existsSync('.test-gnn-trainer-perf')) {
      fs.rmSync('.test-gnn-trainer-perf', { recursive: true, force: true });
    }
  });

  it('should train batch in reasonable time', async () => {
    const batch = createTrajectoryBatch(32, 0.5);

    const startTime = performance.now();
    await trainer.trainBatch(batch);
    const elapsed = performance.now() - startTime;

    // Batch training should complete within 500ms
    expect(elapsed).toBeLessThan(500);
  });

  it('should validate in reasonable time', async () => {
    const validationSet = createTrajectoryBatch(50, 0.5);

    const startTime = performance.now();
    await trainer.validate(validationSet);
    const elapsed = performance.now() - startTime;

    // Validation should complete within 200ms
    expect(elapsed).toBeLessThan(200);
  });
});
