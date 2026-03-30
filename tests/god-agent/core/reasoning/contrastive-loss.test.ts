/**
 * Tests for ContrastiveLoss - Margin Ranking Loss for Quality-Guided Embeddings
 *
 * Tests TASK-GNN-007 implementation:
 * - Margin ranking loss computation
 * - Gradient computation (backward pass)
 * - Trajectory pair creation
 * - Hard negative/positive mining
 * - Semi-hard triplet creation
 *
 * CONSTITUTION COMPLIANCE:
 * - RULE-033: Quality on result (tested via quality thresholds)
 * - RULE-035: Thresholds 0.7 (positive), 0.5 (negative)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ContrastiveLoss,
  mineHardNegatives,
  mineHardPositives,
  createSemiHardTriplets,
  POSITIVE_QUALITY_THRESHOLD,
  NEGATIVE_QUALITY_THRESHOLD,
  DEFAULT_MARGIN,
  type TrajectoryPair,
  type ITrajectoryWithFeedback,
  type ContrastiveLossConfig,
} from '../../../../src/god-agent/core/reasoning/contrastive-loss.js';

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a test embedding with specified dimension
 */
function createEmbedding(dim: number, seed: number = 0): Float32Array {
  const embedding = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    // Deterministic pseudo-random values based on seed and index
    embedding[i] = Math.sin(seed * 100 + i) * 0.5;
  }
  return embedding;
}

/**
 * Create a normalized embedding (unit length)
 */
function createNormalizedEmbedding(dim: number, seed: number = 0): Float32Array {
  const embedding = createEmbedding(dim, seed);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    norm += embedding[i] * embedding[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) {
      embedding[i] /= norm;
    }
  }
  return embedding;
}

/**
 * Create a test trajectory pair
 */
function createTestPair(
  dim: number = 128,
  positiveQuality: number = 0.8,
  negativeQuality: number = 0.3
): TrajectoryPair {
  return {
    query: createNormalizedEmbedding(dim, 1),
    positive: createNormalizedEmbedding(dim, 2),
    negative: createNormalizedEmbedding(dim, 3),
    positiveQuality,
    negativeQuality,
  };
}

/**
 * Create test trajectories with varying quality
 */
function createTestTrajectories(dim: number = 128): ITrajectoryWithFeedback[] {
  return [
    // High quality positives (>= 0.7)
    { id: 'traj-1', embedding: createNormalizedEmbedding(dim, 10), quality: 0.9 },
    { id: 'traj-2', embedding: createNormalizedEmbedding(dim, 11), quality: 0.85 },
    { id: 'traj-3', embedding: createNormalizedEmbedding(dim, 12), quality: 0.7 },
    // Neutral (0.5 <= quality < 0.7)
    { id: 'traj-4', embedding: createNormalizedEmbedding(dim, 13), quality: 0.6 },
    { id: 'traj-5', embedding: createNormalizedEmbedding(dim, 14), quality: 0.55 },
    // Low quality negatives (< 0.5)
    { id: 'traj-6', embedding: createNormalizedEmbedding(dim, 15), quality: 0.4 },
    { id: 'traj-7', embedding: createNormalizedEmbedding(dim, 16), quality: 0.2 },
    { id: 'traj-8', embedding: createNormalizedEmbedding(dim, 17), quality: 0.1 },
  ];
}

/**
 * Compute Euclidean distance between two embeddings
 */
function euclideanDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

// =============================================================================
// Tests
// =============================================================================

describe('ContrastiveLoss', () => {
  describe('constructor', () => {
    it('should create with default configuration', () => {
      const loss = new ContrastiveLoss();
      const config = loss.getConfig();

      expect(config.margin).toBe(DEFAULT_MARGIN);
      expect(config.positiveThreshold).toBe(POSITIVE_QUALITY_THRESHOLD);
      expect(config.negativeThreshold).toBe(NEGATIVE_QUALITY_THRESHOLD);
    });

    it('should accept custom configuration', () => {
      const customConfig: Partial<ContrastiveLossConfig> = {
        margin: 0.8,
        positiveThreshold: 0.8,
        negativeThreshold: 0.4,
      };

      const loss = new ContrastiveLoss(customConfig);
      const config = loss.getConfig();

      expect(config.margin).toBe(0.8);
      expect(config.positiveThreshold).toBe(0.8);
      expect(config.negativeThreshold).toBe(0.4);
    });

    it('should throw if positiveThreshold <= negativeThreshold', () => {
      expect(() => new ContrastiveLoss({ positiveThreshold: 0.5, negativeThreshold: 0.5 }))
        .toThrow('Invalid thresholds');

      expect(() => new ContrastiveLoss({ positiveThreshold: 0.4, negativeThreshold: 0.6 }))
        .toThrow('Invalid thresholds');
    });

    it('should throw if margin <= 0', () => {
      expect(() => new ContrastiveLoss({ margin: 0 })).toThrow('Margin must be positive');
      expect(() => new ContrastiveLoss({ margin: -0.5 })).toThrow('Margin must be positive');
    });
  });

  describe('CONSTITUTION RULE-035 Thresholds', () => {
    it('should use 0.7 as positive threshold per RULE-035', () => {
      expect(POSITIVE_QUALITY_THRESHOLD).toBe(0.7);
    });

    it('should use 0.5 as negative threshold per RULE-035', () => {
      expect(NEGATIVE_QUALITY_THRESHOLD).toBe(0.5);
    });
  });

  describe('compute', () => {
    let loss: ContrastiveLoss;

    beforeEach(() => {
      loss = new ContrastiveLoss();
    });

    it('should return 0 for empty pairs array', () => {
      expect(loss.compute([])).toBe(0);
    });

    it('should compute loss for single valid pair', () => {
      const pair = createTestPair();
      const lossValue = loss.compute([pair]);

      // Loss should be non-negative
      expect(lossValue).toBeGreaterThanOrEqual(0);
    });

    it('should return 0 when margin is already satisfied', () => {
      // Create pair where negative is much farther than positive
      const dim = 128;
      const query = createNormalizedEmbedding(dim, 1);
      const positive = createNormalizedEmbedding(dim, 1); // Same as query (distance = 0)
      const negative = new Float32Array(dim).fill(1); // Very different

      const pair: TrajectoryPair = {
        query,
        positive,
        negative,
        positiveQuality: 0.9,
        negativeQuality: 0.2,
      };

      // d(q, pos) = 0, d(q, neg) >> margin, so loss = max(0, 0 - large + margin) = 0
      const lossValue = loss.compute([pair]);
      expect(lossValue).toBe(0);
    });

    it('should have positive loss when positive is farther than negative', () => {
      const dim = 128;
      const query = createNormalizedEmbedding(dim, 1);
      const positive = new Float32Array(dim).fill(1); // Far from query
      const negative = createNormalizedEmbedding(dim, 1); // Same as query

      const pair: TrajectoryPair = {
        query,
        positive,
        negative,
        positiveQuality: 0.9,
        negativeQuality: 0.2,
      };

      // d(q, pos) >> d(q, neg), so loss = d_pos - d_neg + margin > 0
      const lossValue = loss.compute([pair]);
      expect(lossValue).toBeGreaterThan(0);
    });

    it('should average loss over batch', () => {
      const pairs = [
        createTestPair(128, 0.9, 0.2),
        createTestPair(128, 0.8, 0.3),
        createTestPair(128, 0.75, 0.4),
      ];

      const batchLoss = loss.compute(pairs);
      expect(typeof batchLoss).toBe('number');
      expect(Number.isFinite(batchLoss)).toBe(true);
    });

    it('should skip invalid pairs silently', () => {
      const validPair = createTestPair(128, 0.9, 0.2);
      const invalidPair: TrajectoryPair = {
        query: createEmbedding(128),
        positive: createEmbedding(64), // Wrong dimension
        negative: createEmbedding(128),
        positiveQuality: 0.9,
        negativeQuality: 0.2,
      };

      // Should not throw
      const lossValue = loss.compute([validPair, invalidPair]);
      expect(typeof lossValue).toBe('number');
    });
  });

  describe('backward', () => {
    let loss: ContrastiveLoss;

    beforeEach(() => {
      loss = new ContrastiveLoss();
    });

    it('should return zero gradients for empty pairs', () => {
      const result = loss.backward([]);

      expect(result.totalLoss).toBe(0);
      expect(result.activeCount).toBe(0);
      expect(result.batchSize).toBe(0);
      expect(result.tripletGradients).toHaveLength(0);
    });

    it('should compute gradients for active triplets', () => {
      const dim = 128;
      const query = createNormalizedEmbedding(dim, 1);
      const positive = new Float32Array(dim).fill(0.5); // Far from query
      const negative = createNormalizedEmbedding(dim, 1); // Close to query

      const pair: TrajectoryPair = {
        query,
        positive,
        negative,
        positiveQuality: 0.9,
        negativeQuality: 0.2,
      };

      const result = loss.backward([pair]);

      expect(result.totalLoss).toBeGreaterThan(0);
      expect(result.activeCount).toBe(1);
      expect(result.batchSize).toBe(1);
      expect(result.dQuery.length).toBe(dim);
      expect(result.dPositive.length).toBe(dim);
      expect(result.dNegative.length).toBe(dim);
    });

    it('should return zero gradients for satisfied margin', () => {
      const dim = 128;
      const query = createNormalizedEmbedding(dim, 1);
      const positive = createNormalizedEmbedding(dim, 1); // Same as query
      const negative = new Float32Array(dim).fill(1); // Very far

      const pair: TrajectoryPair = {
        query,
        positive,
        negative,
        positiveQuality: 0.9,
        negativeQuality: 0.2,
      };

      const result = loss.backward([pair]);

      expect(result.totalLoss).toBe(0);
      expect(result.activeCount).toBe(0);

      // Gradients should be zero
      const queryGradSum = result.dQuery.reduce((a, b) => a + Math.abs(b), 0);
      const posGradSum = result.dPositive.reduce((a, b) => a + Math.abs(b), 0);
      const negGradSum = result.dNegative.reduce((a, b) => a + Math.abs(b), 0);

      expect(queryGradSum).toBe(0);
      expect(posGradSum).toBe(0);
      expect(negGradSum).toBe(0);
    });

    it('should clip gradients by norm', () => {
      const loss = new ContrastiveLoss({ maxGradientNorm: 0.5 });
      const pairs = [createTestPair(128, 0.9, 0.1)];

      const result = loss.backward(pairs);

      // Check gradient norms are clipped
      const queryNorm = Math.sqrt(result.dQuery.reduce((a, b) => a + b * b, 0));
      const posNorm = Math.sqrt(result.dPositive.reduce((a, b) => a + b * b, 0));
      const negNorm = Math.sqrt(result.dNegative.reduce((a, b) => a + b * b, 0));

      if (queryNorm > 0) expect(queryNorm).toBeLessThanOrEqual(0.5 + 1e-6);
      if (posNorm > 0) expect(posNorm).toBeLessThanOrEqual(0.5 + 1e-6);
      if (negNorm > 0) expect(negNorm).toBeLessThanOrEqual(0.5 + 1e-6);
    });

    it('should provide per-triplet gradient details', () => {
      const pairs = [
        createTestPair(128, 0.9, 0.2),
        createTestPair(128, 0.8, 0.3),
      ];

      const result = loss.backward(pairs);

      expect(result.tripletGradients).toHaveLength(2);
      result.tripletGradients.forEach(grad => {
        expect(grad).toHaveProperty('dQuery');
        expect(grad).toHaveProperty('dPositive');
        expect(grad).toHaveProperty('dNegative');
        expect(grad).toHaveProperty('loss');
        expect(grad).toHaveProperty('active');
      });
    });
  });

  describe('createPairs', () => {
    it('should create pairs from trajectories with correct thresholds', () => {
      const trajectories = createTestTrajectories(128);
      const query = createNormalizedEmbedding(128, 100);

      const pairs = ContrastiveLoss.createPairs(trajectories, query);

      // Should have 3 positives (0.9, 0.85, 0.7) x 3 negatives (0.4, 0.2, 0.1) = 9 pairs
      expect(pairs.length).toBe(9);

      // All pairs should have valid thresholds
      pairs.forEach(pair => {
        expect(pair.positiveQuality).toBeGreaterThanOrEqual(0.7);
        expect(pair.negativeQuality).toBeLessThan(0.5);
      });
    });

    it('should respect custom thresholds', () => {
      const trajectories = createTestTrajectories(128);
      const query = createNormalizedEmbedding(128, 100);

      const pairs = ContrastiveLoss.createPairs(trajectories, query, {
        positiveThreshold: 0.85,
        negativeThreshold: 0.3,
      });

      // Should have 2 positives (0.9, 0.85) x 2 negatives (0.2, 0.1) = 4 pairs
      expect(pairs.length).toBe(4);

      pairs.forEach(pair => {
        expect(pair.positiveQuality).toBeGreaterThanOrEqual(0.85);
        expect(pair.negativeQuality).toBeLessThan(0.3);
      });
    });

    it('should return empty array if no valid pairs', () => {
      const trajectories: ITrajectoryWithFeedback[] = [
        { id: 'traj-1', embedding: createNormalizedEmbedding(128, 1), quality: 0.6 }, // Neither
      ];
      const query = createNormalizedEmbedding(128, 100);

      const pairs = ContrastiveLoss.createPairs(trajectories, query);
      expect(pairs).toHaveLength(0);
    });

    it('should skip trajectories with mismatched dimensions', () => {
      const trajectories: ITrajectoryWithFeedback[] = [
        { id: 'traj-1', embedding: createNormalizedEmbedding(128, 1), quality: 0.9 },
        { id: 'traj-2', embedding: createNormalizedEmbedding(64, 2), quality: 0.2 }, // Wrong dim
      ];
      const query = createNormalizedEmbedding(128, 100);

      const pairs = ContrastiveLoss.createPairs(trajectories, query);
      expect(pairs).toHaveLength(0); // Should skip due to dimension mismatch
    });

    it('should prefer enhancedEmbedding when available', () => {
      const trajectories: ITrajectoryWithFeedback[] = [
        {
          id: 'traj-1',
          embedding: createNormalizedEmbedding(128, 1),
          enhancedEmbedding: createNormalizedEmbedding(128, 100), // Different
          quality: 0.9,
        },
        { id: 'traj-2', embedding: createNormalizedEmbedding(128, 2), quality: 0.2 },
      ];
      const query = createNormalizedEmbedding(128, 50);

      const pairs = ContrastiveLoss.createPairs(trajectories, query);
      expect(pairs).toHaveLength(1);

      // Should use enhanced embedding for positive
      const pair = pairs[0];
      expect(pair.positive).toEqual(createNormalizedEmbedding(128, 100));
    });
  });
});

describe('mineHardNegatives', () => {
  it('should return closest negatives', () => {
    const dim = 128;
    const query = createNormalizedEmbedding(dim, 1);

    const negatives = [
      { embedding: createNormalizedEmbedding(dim, 2), quality: 0.3 },
      { embedding: createNormalizedEmbedding(dim, 1), quality: 0.2 }, // Closest (same as query)
      { embedding: new Float32Array(dim).fill(1), quality: 0.1 }, // Farthest
    ];

    const hardNegs = mineHardNegatives(query, negatives, 2);

    expect(hardNegs).toHaveLength(2);
    // Should be sorted by distance ascending
    expect(hardNegs[0].distance).toBeLessThanOrEqual(hardNegs[1].distance);
    // Closest should be the one with seed=1 (same as query)
    expect(hardNegs[0].index).toBe(1);
  });

  it('should return all negatives if topK > length', () => {
    const dim = 128;
    const query = createNormalizedEmbedding(dim, 1);
    const negatives = [
      { embedding: createNormalizedEmbedding(dim, 2), quality: 0.3 },
    ];

    const hardNegs = mineHardNegatives(query, negatives, 10);
    expect(hardNegs).toHaveLength(1);
  });
});

describe('mineHardPositives', () => {
  it('should return farthest positives', () => {
    const dim = 128;
    const query = createNormalizedEmbedding(dim, 1);

    const positives = [
      { embedding: createNormalizedEmbedding(dim, 2), quality: 0.9 },
      { embedding: createNormalizedEmbedding(dim, 1), quality: 0.8 }, // Closest
      { embedding: new Float32Array(dim).fill(1), quality: 0.85 }, // Farthest
    ];

    const hardPos = mineHardPositives(query, positives, 2);

    expect(hardPos).toHaveLength(2);
    // Should be sorted by distance descending
    expect(hardPos[0].distance).toBeGreaterThanOrEqual(hardPos[1].distance);
    // Farthest should be the one with fill(1)
    expect(hardPos[0].index).toBe(2);
  });
});

describe('createSemiHardTriplets', () => {
  it('should create triplets satisfying semi-hard criterion', () => {
    const dim = 128;
    const query = createNormalizedEmbedding(dim, 1);
    const margin = 0.5;

    const positives: ITrajectoryWithFeedback[] = [
      { id: 'pos-1', embedding: createNormalizedEmbedding(dim, 2), quality: 0.9 },
    ];

    const negatives: ITrajectoryWithFeedback[] = [
      { id: 'neg-1', embedding: createNormalizedEmbedding(dim, 3), quality: 0.2 },
    ];

    const pairs = createSemiHardTriplets(query, positives, negatives, margin);

    pairs.forEach(pair => {
      const distPos = euclideanDistance(query, pair.positive);
      const distNeg = euclideanDistance(query, pair.negative);

      // Semi-hard criterion: d(q, p) < d(q, n) < d(q, p) + margin
      if (pairs.length > 0) {
        expect(distPos).toBeLessThan(distNeg);
        expect(distNeg).toBeLessThan(distPos + margin);
      }
    });
  });

  it('should return empty array if no semi-hard triplets exist', () => {
    const dim = 128;
    const query = createNormalizedEmbedding(dim, 1);

    // Positive very close to query
    const positives: ITrajectoryWithFeedback[] = [
      { id: 'pos-1', embedding: createNormalizedEmbedding(dim, 1), quality: 0.9 },
    ];

    // Negative very far from query
    const negatives: ITrajectoryWithFeedback[] = [
      { id: 'neg-1', embedding: new Float32Array(dim).fill(10), quality: 0.2 },
    ];

    const pairs = createSemiHardTriplets(query, positives, negatives, 0.5);

    // d(q, pos) ~= 0, d(q, neg) >> 0.5, so no semi-hard triplets
    expect(pairs).toHaveLength(0);
  });
});

describe('Integration Tests', () => {
  it('should compute loss and gradients for full workflow', () => {
    const loss = new ContrastiveLoss();
    const trajectories = createTestTrajectories(128);
    const query = createNormalizedEmbedding(128, 100);

    // Create pairs
    const pairs = ContrastiveLoss.createPairs(trajectories, query);
    expect(pairs.length).toBeGreaterThan(0);

    // Compute loss
    const lossValue = loss.compute(pairs);
    expect(typeof lossValue).toBe('number');
    expect(Number.isFinite(lossValue)).toBe(true);

    // Compute gradients
    const gradients = loss.backward(pairs);
    expect(gradients.batchSize).toBe(pairs.length);
    expect(Number.isFinite(gradients.totalLoss)).toBe(true);
  });

  it('should produce consistent loss and gradient values', () => {
    const loss = new ContrastiveLoss({ margin: 0.5 });
    const pair = createTestPair(128, 0.9, 0.2);

    // Compute multiple times
    const loss1 = loss.compute([pair]);
    const loss2 = loss.compute([pair]);

    expect(loss1).toBe(loss2);

    const grad1 = loss.backward([pair]);
    const grad2 = loss.backward([pair]);

    expect(grad1.totalLoss).toBe(grad2.totalLoss);
    expect(Array.from(grad1.dQuery)).toEqual(Array.from(grad2.dQuery));
  });

  it('should handle large batches efficiently', () => {
    const loss = new ContrastiveLoss();
    const pairs: TrajectoryPair[] = [];

    for (let i = 0; i < 100; i++) {
      pairs.push(createTestPair(128, 0.7 + Math.random() * 0.3, Math.random() * 0.5));
    }

    const start = performance.now();
    const lossValue = loss.compute(pairs);
    const gradients = loss.backward(pairs);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100); // Should complete in < 100ms
    expect(Number.isFinite(lossValue)).toBe(true);
    expect(Number.isFinite(gradients.totalLoss)).toBe(true);
  });
});
