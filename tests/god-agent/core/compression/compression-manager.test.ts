/**
 * Compression Manager Tests
 * TASK-CMP-001 - 5-Tier Compression Lifecycle
 * TASK-VEC-001-008 - Updated to use VECTOR_DIM (1536D)
 *
 * Tests:
 * - Float16 encoding/decoding
 * - PQ8/PQ4 compression
 * - Binary quantization
 * - Tier transitions
 * - Heat score management
 * - Memory statistics
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CompressionManager,
  CompressionTier,
  TIER_CONFIGS,
  TIER_HIERARCHY,
  CompressionError,
  TierTransitionError,
  getTierForHeatScore,
  isValidTransition,
  getNextTier,
  calculateBytesForTier,
  float32ToFloat16,
  float16ToFloat32,
  encodeFloat16,
  decodeFloat16,
  trainPQCodebook,
  encodePQ8,
  decodePQ8,
  encodePQ4,
  decodePQ4,
  trainBinaryThresholds,
  encodeBinary,
  decodeBinary,
  calculateReconstructionError,
  cosineSimilarityCompression,
} from '../../../../src/god-agent/core/compression/index.js';
import { VECTOR_DIM } from '../../../../src/god-agent/core/validation/constants.js';

// ==================== Helper Functions ====================

/**
 * Generate random test vector
 * TASK-VEC-001-008: Updated to use VECTOR_DIM (1536)
 */
function generateRandomVector(dim: number = VECTOR_DIM): Float32Array {
  const vector = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    vector[i] = (Math.random() - 0.5) * 2; // Range [-1, 1]
  }
  return vector;
}

/**
 * Generate multiple training vectors
 * TASK-VEC-001-008: Updated to use VECTOR_DIM (1536)
 */
function generateTrainingData(count: number, dim: number = VECTOR_DIM): Float32Array[] {
  return Array.from({ length: count }, () => generateRandomVector(dim));
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ==================== Type Definitions Tests ====================

describe('CompressionTier', () => {
  it('should have correct tier values', () => {
    expect(CompressionTier.HOT).toBe('hot');
    expect(CompressionTier.WARM).toBe('warm');
    expect(CompressionTier.COOL).toBe('cool');
    expect(CompressionTier.COLD).toBe('cold');
    expect(CompressionTier.FROZEN).toBe('frozen');
  });

  it('should have correct tier hierarchy order', () => {
    expect(TIER_HIERARCHY).toEqual([
      CompressionTier.HOT,
      CompressionTier.WARM,
      CompressionTier.COOL,
      CompressionTier.COLD,
      CompressionTier.FROZEN,
    ]);
  });
});

describe('TIER_CONFIGS', () => {
  it('should have configs for all tiers', () => {
    for (const tier of TIER_HIERARCHY) {
      expect(TIER_CONFIGS[tier]).toBeDefined();
      expect(TIER_CONFIGS[tier].tier).toBe(tier);
    }
  });

  it('should have correct compression ratios', () => {
    expect(TIER_CONFIGS[CompressionTier.HOT].compressionRatio).toBe(1);
    expect(TIER_CONFIGS[CompressionTier.WARM].compressionRatio).toBe(2);
    expect(TIER_CONFIGS[CompressionTier.COOL].compressionRatio).toBe(8);
    expect(TIER_CONFIGS[CompressionTier.COLD].compressionRatio).toBe(16);
    expect(TIER_CONFIGS[CompressionTier.FROZEN].compressionRatio).toBe(32);
  });

  it('should have correct bytes per vector for 1536D', () => {
    // TASK-VEC-001-008: Updated for 1536D vectors (4 bytes * 1536 = 6144 for HOT)
    expect(TIER_CONFIGS[CompressionTier.HOT].bytesPerVector).toBe(6144);
    expect(TIER_CONFIGS[CompressionTier.WARM].bytesPerVector).toBe(3072);
    expect(TIER_CONFIGS[CompressionTier.COOL].bytesPerVector).toBe(768);
    expect(TIER_CONFIGS[CompressionTier.COLD].bytesPerVector).toBe(384);
    expect(TIER_CONFIGS[CompressionTier.FROZEN].bytesPerVector).toBe(192);
  });

  it('should have heat score ranges that span [0, 1]', () => {
    // Hot tier should be at the top
    expect(TIER_CONFIGS[CompressionTier.HOT].maxHeatScore).toBe(1.0);
    // Frozen tier should be at the bottom
    expect(TIER_CONFIGS[CompressionTier.FROZEN].minHeatScore).toBe(0);
  });
});

// ==================== Utility Functions Tests ====================

describe('getTierForHeatScore', () => {
  it('should return HOT for high heat scores', () => {
    expect(getTierForHeatScore(1.0)).toBe(CompressionTier.HOT);
    expect(getTierForHeatScore(0.9)).toBe(CompressionTier.HOT);
    expect(getTierForHeatScore(0.8)).toBe(CompressionTier.HOT);
  });

  it('should return WARM for moderate heat scores', () => {
    expect(getTierForHeatScore(0.7)).toBe(CompressionTier.WARM);
    expect(getTierForHeatScore(0.5)).toBe(CompressionTier.WARM);
    expect(getTierForHeatScore(0.4)).toBe(CompressionTier.WARM);
  });

  it('should return COOL for lower heat scores', () => {
    expect(getTierForHeatScore(0.3)).toBe(CompressionTier.COOL);
    expect(getTierForHeatScore(0.2)).toBe(CompressionTier.COOL);
    expect(getTierForHeatScore(0.1)).toBe(CompressionTier.COOL);
  });

  it('should return COLD for low heat scores', () => {
    expect(getTierForHeatScore(0.05)).toBe(CompressionTier.COLD);
    expect(getTierForHeatScore(0.02)).toBe(CompressionTier.COLD);
    expect(getTierForHeatScore(0.01)).toBe(CompressionTier.COLD);
  });

  it('should return FROZEN for very low heat scores', () => {
    expect(getTierForHeatScore(0.005)).toBe(CompressionTier.FROZEN);
    expect(getTierForHeatScore(0.0)).toBe(CompressionTier.FROZEN);
  });
});

describe('isValidTransition', () => {
  it('should allow forward transitions', () => {
    expect(isValidTransition(CompressionTier.HOT, CompressionTier.WARM)).toBe(true);
    expect(isValidTransition(CompressionTier.HOT, CompressionTier.COOL)).toBe(true);
    expect(isValidTransition(CompressionTier.WARM, CompressionTier.FROZEN)).toBe(true);
  });

  it('should reject backward transitions', () => {
    expect(isValidTransition(CompressionTier.WARM, CompressionTier.HOT)).toBe(false);
    expect(isValidTransition(CompressionTier.FROZEN, CompressionTier.HOT)).toBe(false);
    expect(isValidTransition(CompressionTier.COLD, CompressionTier.COOL)).toBe(false);
  });

  it('should reject same-tier transitions', () => {
    expect(isValidTransition(CompressionTier.HOT, CompressionTier.HOT)).toBe(false);
    expect(isValidTransition(CompressionTier.COLD, CompressionTier.COLD)).toBe(false);
  });
});

describe('getNextTier', () => {
  it('should return next tier in hierarchy', () => {
    expect(getNextTier(CompressionTier.HOT)).toBe(CompressionTier.WARM);
    expect(getNextTier(CompressionTier.WARM)).toBe(CompressionTier.COOL);
    expect(getNextTier(CompressionTier.COOL)).toBe(CompressionTier.COLD);
    expect(getNextTier(CompressionTier.COLD)).toBe(CompressionTier.FROZEN);
  });

  it('should return null for FROZEN tier', () => {
    expect(getNextTier(CompressionTier.FROZEN)).toBeNull();
  });
});

describe('calculateBytesForTier', () => {
  it('should calculate correct bytes for 1536D vectors', () => {
    // TASK-VEC-001-008: Updated for 1536D vectors (4 bytes * 1536 = 6144 for HOT)
    expect(calculateBytesForTier(CompressionTier.HOT, 1)).toBe(6144);
    expect(calculateBytesForTier(CompressionTier.HOT, 1000)).toBe(6144000);
    expect(calculateBytesForTier(CompressionTier.FROZEN, 1000)).toBe(192000);
  });
});

// ==================== Float16 Codec Tests ====================

describe('Float16 Codec', () => {
  describe('float32ToFloat16 / float16ToFloat32', () => {
    it('should roundtrip zero', () => {
      const half = float32ToFloat16(0);
      expect(float16ToFloat32(half)).toBe(0);
    });

    it('should roundtrip positive numbers', () => {
      const values = [0.5, 1.0, 1.5, 2.0, 100.0];
      for (const val of values) {
        const half = float32ToFloat16(val);
        const recovered = float16ToFloat32(half);
        expect(Math.abs(recovered - val)).toBeLessThan(val * 0.01); // <1% error
      }
    });

    it('should roundtrip negative numbers', () => {
      const half = float32ToFloat16(-1.0);
      expect(float16ToFloat32(half)).toBeCloseTo(-1.0, 2);
    });

    it('should handle small numbers', () => {
      const half = float32ToFloat16(0.001);
      const recovered = float16ToFloat32(half);
      expect(Math.abs(recovered - 0.001)).toBeLessThan(0.0001);
    });
  });

  describe('encodeFloat16 / decodeFloat16', () => {
    it('should encode and decode vector', () => {
      const original = new Float32Array([1.0, 0.5, -0.5, 0.0, 2.0]);
      const encoded = encodeFloat16(original);
      const decoded = decodeFloat16(encoded);

      expect(decoded.length).toBe(original.length);
      for (let i = 0; i < original.length; i++) {
        expect(decoded[i]).toBeCloseTo(original[i], 1);
      }
    });

    it('should halve memory size', () => {
      // TASK-VEC-001-008: Updated to use VECTOR_DIM
      const original = new Float32Array(VECTOR_DIM);
      const encoded = encodeFloat16(original);
      expect(encoded.byteLength).toBe(original.byteLength / 2);
    });

    it('should maintain high cosine similarity', () => {
      // TASK-VEC-001-008: Updated to use VECTOR_DIM
      const original = generateRandomVector(VECTOR_DIM);
      const encoded = encodeFloat16(original);
      const decoded = decodeFloat16(encoded);

      const similarity = cosineSim(original, decoded);
      expect(similarity).toBeGreaterThan(0.999); // Very high similarity (Float16 has some quantization)
    });
  });
});

// ==================== Product Quantization Tests ====================

describe('Product Quantization', () => {
  let trainingData: Float32Array[];
  let pq8Codebook: ReturnType<typeof trainPQCodebook>;
  let pq4Codebook: ReturnType<typeof trainPQCodebook>;
  // TASK-VEC-001-008: Use 192 subvectors for 1536D (1536/192 = 8 dims per subvector)
  const NUM_SUBVECTORS = 192;

  beforeEach(() => {
    // Generate training data with VECTOR_DIM
    trainingData = generateTrainingData(200, VECTOR_DIM);
    pq8Codebook = trainPQCodebook(trainingData, NUM_SUBVECTORS, 256, 5);
    pq4Codebook = trainPQCodebook(trainingData, NUM_SUBVECTORS, 16, 5);
  });

  describe('trainPQCodebook', () => {
    it('should train PQ8 codebook with correct structure', () => {
      expect(pq8Codebook.numSubvectors).toBe(NUM_SUBVECTORS);
      expect(pq8Codebook.numCentroids).toBe(256);
      expect(pq8Codebook.centroids.length).toBe(NUM_SUBVECTORS);
      expect(pq8Codebook.trainingSize).toBe(200);
    });

    it('should train PQ4 codebook with correct structure', () => {
      expect(pq4Codebook.numSubvectors).toBe(NUM_SUBVECTORS);
      expect(pq4Codebook.numCentroids).toBe(16);
      expect(pq4Codebook.centroids.length).toBe(NUM_SUBVECTORS);
    });

    it('should throw error for empty training data', () => {
      expect(() => trainPQCodebook([], NUM_SUBVECTORS, 256, 5)).toThrow('Cannot train codebook with empty vectors');
    });
  });

  describe('PQ8 encoding/decoding', () => {
    it('should encode to correct size', () => {
      const vector = generateRandomVector(VECTOR_DIM);
      const encoded = encodePQ8(vector, pq8Codebook);
      expect(encoded.length).toBe(NUM_SUBVECTORS); // 192 subvectors, 1 byte each
    });

    it('should maintain reasonable similarity after roundtrip', () => {
      const original = generateRandomVector(VECTOR_DIM);
      const encoded = encodePQ8(original, pq8Codebook);
      const decoded = decodePQ8(encoded, pq8Codebook, VECTOR_DIM);

      const similarity = cosineSim(original, decoded);
      expect(similarity).toBeGreaterThan(0.7); // PQ has some error
    });

    it('should achieve ~8x compression', () => {
      // TASK-VEC-001-008: 1536D * 4 bytes = 6144 bytes, 8x = 768 bytes
      const original = new Float32Array(VECTOR_DIM); // 6144 bytes
      const encoded = encodePQ8(original, pq8Codebook);
      expect(encoded.byteLength).toBeLessThanOrEqual(768); // ~8x compression
    });
  });

  describe('PQ4 encoding/decoding', () => {
    it('should encode to correct size (packed)', () => {
      const vector = generateRandomVector(VECTOR_DIM);
      const encoded = encodePQ4(vector, pq4Codebook);
      expect(encoded.length).toBe(NUM_SUBVECTORS / 2); // 192 subvectors / 2 (4-bit packed) = 96
    });

    it('should maintain reasonable similarity after roundtrip', () => {
      const original = generateRandomVector(VECTOR_DIM);
      const encoded = encodePQ4(original, pq4Codebook);
      const decoded = decodePQ4(encoded, pq4Codebook, VECTOR_DIM);

      const similarity = cosineSim(original, decoded);
      expect(similarity).toBeGreaterThan(0.5); // PQ4 has more error
    });

    it('should achieve ~16x compression', () => {
      // TASK-VEC-001-008: 1536D * 4 bytes = 6144 bytes, 16x = 384 bytes
      const original = new Float32Array(VECTOR_DIM); // 6144 bytes
      const encoded = encodePQ4(original, pq4Codebook);
      expect(encoded.byteLength).toBeLessThanOrEqual(384); // ~16x compression
    });
  });
});

// ==================== Binary Quantization Tests ====================

describe('Binary Quantization', () => {
  let trainingData: Float32Array[];
  let thresholds: ReturnType<typeof trainBinaryThresholds>;

  beforeEach(() => {
    // TASK-VEC-001-008: Use VECTOR_DIM (1536)
    trainingData = generateTrainingData(100, VECTOR_DIM);
    thresholds = trainBinaryThresholds(trainingData);
  });

  describe('trainBinaryThresholds', () => {
    it('should train with correct dimension', () => {
      // TASK-VEC-001-008: Updated for 1536D
      expect(thresholds.thresholds.length).toBe(VECTOR_DIM);
      expect(thresholds.trainingSize).toBe(100);
    });

    it('should throw error for empty training data', () => {
      expect(() => trainBinaryThresholds([])).toThrow('Cannot train thresholds with empty vectors');
    });
  });

  describe('encodeBinary / decodeBinary', () => {
    it('should encode to correct size', () => {
      const vector = generateRandomVector(VECTOR_DIM);
      const encoded = encodeBinary(vector, thresholds);
      // TASK-VEC-001-008: 1536 bits / 8 = 192 bytes
      expect(encoded.length).toBe(192);
    });

    it('should achieve 32x compression', () => {
      // TASK-VEC-001-008: 1536D * 4 bytes = 6144 bytes, 32x = 192 bytes
      const original = new Float32Array(VECTOR_DIM); // 6144 bytes
      const encoded = encodeBinary(original, thresholds);
      expect(encoded.byteLength).toBe(192); // 32x compression
    });

    it('should decode to same dimension', () => {
      const original = generateRandomVector(VECTOR_DIM);
      const encoded = encodeBinary(original, thresholds);
      const decoded = decodeBinary(encoded, thresholds);
      expect(decoded.length).toBe(VECTOR_DIM);
    });

    it('should preserve sign patterns roughly', () => {
      const original = generateRandomVector(VECTOR_DIM);
      const encoded = encodeBinary(original, thresholds);
      const decoded = decodeBinary(encoded, thresholds);

      // Check that many signs are preserved
      let sameSign = 0;
      for (let i = 0; i < VECTOR_DIM; i++) {
        if ((original[i] > thresholds.thresholds[i]) === (decoded[i] > thresholds.thresholds[i])) {
          sameSign++;
        }
      }
      expect(sameSign / VECTOR_DIM).toBeGreaterThan(0.9); // Most signs preserved
    });
  });
});

// ==================== Error Measurement Tests ====================

describe('Error Measurement', () => {
  describe('calculateReconstructionError', () => {
    it('should return 0 for identical vectors', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM
      const v = generateRandomVector(VECTOR_DIM);
      expect(calculateReconstructionError(v, v)).toBe(0);
    });

    it('should return positive for different vectors', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM
      const a = generateRandomVector(VECTOR_DIM);
      const b = generateRandomVector(VECTOR_DIM);
      expect(calculateReconstructionError(a, b)).toBeGreaterThan(0);
    });

    it('should throw for mismatched dimensions', () => {
      const a = new Float32Array(10);
      const b = new Float32Array(20);
      // Use flexible matching pattern for dimension error messages
      expect(() => calculateReconstructionError(a, b)).toThrow(/[Dd]imension mismatch/);
    });
  });

  describe('cosineSimilarityCompression', () => {
    it('should return 1 for identical vectors', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM
      const v = generateRandomVector(VECTOR_DIM);
      expect(cosineSimilarityCompression(v, v)).toBeCloseTo(1.0, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([0, 1, 0]);
      expect(cosineSimilarityCompression(a, b)).toBeCloseTo(0, 5);
    });

    it('should return -1 for opposite vectors', () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([-1, 0, 0]);
      expect(cosineSimilarityCompression(a, b)).toBeCloseTo(-1.0, 5);
    });
  });
});

// ==================== CompressionManager Tests ====================

describe('CompressionManager', () => {
  let manager: CompressionManager;

  beforeEach(() => {
    manager = new CompressionManager({ autoTransition: false, verbose: false });
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('Basic Operations', () => {
    it('should store and retrieve vectors', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM
      const vector = generateRandomVector(VECTOR_DIM);
      manager.store('test-1', vector);

      const retrieved = manager.retrieve('test-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.length).toBe(VECTOR_DIM);
    });

    it('should return exact values at HOT tier', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM
      const vector = generateRandomVector(VECTOR_DIM);
      manager.store('test-1', vector);

      const retrieved = manager.retrieve('test-1')!;
      for (let i = 0; i < vector.length; i++) {
        expect(retrieved[i]).toBe(vector[i]);
      }
    });

    it('should return null for non-existent vectors', () => {
      expect(manager.retrieve('non-existent')).toBeNull();
    });

    it('should check existence correctly', () => {
      const vector = generateRandomVector(VECTOR_DIM);
      manager.store('test-1', vector);

      expect(manager.has('test-1')).toBe(true);
      expect(manager.has('test-2')).toBe(false);
    });

    it('should delete vectors', () => {
      const vector = generateRandomVector(VECTOR_DIM);
      manager.store('test-1', vector);

      expect(manager.delete('test-1')).toBe(true);
      expect(manager.has('test-1')).toBe(false);
      expect(manager.delete('test-1')).toBe(false);
    });

    it('should track size correctly', () => {
      expect(manager.size).toBe(0);

      manager.store('test-1', generateRandomVector(VECTOR_DIM));
      expect(manager.size).toBe(1);

      manager.store('test-2', generateRandomVector(VECTOR_DIM));
      expect(manager.size).toBe(2);

      manager.delete('test-1');
      expect(manager.size).toBe(1);
    });
  });

  describe('Dimension Validation', () => {
    it('should reject wrong dimension vectors', () => {
      const wrongDim = new Float32Array(256);
      expect(() => manager.store('test-1', wrongDim)).toThrow(CompressionError);
      // Use flexible matching pattern for dimension error messages
      expect(() => manager.store('test-1', wrongDim)).toThrow(/[Dd]imension mismatch/);
    });

    it('should accept correct dimension vectors', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM
      const correctDim = generateRandomVector(VECTOR_DIM);
      expect(() => manager.store('test-1', correctDim)).not.toThrow();
    });
  });

  describe('Tier Management', () => {
    it('should start at HOT tier', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM
      manager.store('test-1', generateRandomVector(VECTOR_DIM));
      expect(manager.getTier('test-1')).toBe(CompressionTier.HOT);
    });

    it('should return null tier for non-existent vector', () => {
      expect(manager.getTier('non-existent')).toBeNull();
    });

    it('should allow forward tier transitions', () => {
      // First train codebooks with VECTOR_DIM
      const trainingData = generateTrainingData(150, VECTOR_DIM);
      manager.forceTrainCodebooks(trainingData);

      manager.store('test-1', generateRandomVector(VECTOR_DIM));

      // Transition forward
      manager.transitionTier('test-1', CompressionTier.WARM);
      expect(manager.getTier('test-1')).toBe(CompressionTier.WARM);
    });

    it('should reject backward tier transitions', () => {
      const trainingData = generateTrainingData(150, VECTOR_DIM);
      manager.forceTrainCodebooks(trainingData);

      manager.store('test-1', generateRandomVector(VECTOR_DIM));
      manager.transitionTier('test-1', CompressionTier.WARM);

      expect(() => manager.transitionTier('test-1', CompressionTier.HOT))
        .toThrow(TierTransitionError);
    });

    it('should throw for non-existent vector transition', () => {
      expect(() => manager.transitionTier('non-existent', CompressionTier.WARM))
        .toThrow(CompressionError);
    });
  });

  describe('Tier Transitions with Codebooks', () => {
    beforeEach(() => {
      // Train codebooks for all tests in this block with VECTOR_DIM
      const trainingData = generateTrainingData(150, VECTOR_DIM);
      manager.forceTrainCodebooks(trainingData);
    });

    it('should transition to WARM with Float16', () => {
      const original = generateRandomVector(VECTOR_DIM);
      manager.store('test-1', original);
      manager.transitionTier('test-1', CompressionTier.WARM);

      const retrieved = manager.retrieve('test-1')!;
      const similarity = cosineSim(original, retrieved);
      expect(similarity).toBeGreaterThan(0.999);
    });

    it('should transition to COOL with PQ8', () => {
      const original = generateRandomVector(VECTOR_DIM);
      manager.store('test-1', original);
      manager.transitionTier('test-1', CompressionTier.COOL);

      const retrieved = manager.retrieve('test-1')!;
      const similarity = cosineSim(original, retrieved);
      // TASK-VEC-001-008: Adjusted threshold for 1536D vectors
      // PQ8 quality decreases with higher dimensions
      expect(similarity).toBeGreaterThan(0.5);
    });

    it('should transition to COLD with PQ4', () => {
      const original = generateRandomVector(VECTOR_DIM);
      manager.store('test-1', original);
      manager.transitionTier('test-1', CompressionTier.COLD);

      const retrieved = manager.retrieve('test-1')!;
      const similarity = cosineSim(original, retrieved);
      // TASK-VEC-001-008: Adjusted threshold for 1536D vectors
      // PQ4 quality decreases with higher dimensions
      expect(similarity).toBeGreaterThan(0.3);
    });

    it('should transition to FROZEN with binary', () => {
      const original = generateRandomVector(VECTOR_DIM);
      manager.store('test-1', original);
      manager.transitionTier('test-1', CompressionTier.FROZEN);

      const retrieved = manager.retrieve('test-1')!;
      expect(retrieved.length).toBe(VECTOR_DIM);
    });

    it('should allow multi-step transitions', () => {
      manager.store('test-1', generateRandomVector(VECTOR_DIM));

      manager.transitionTier('test-1', CompressionTier.WARM);
      manager.transitionTier('test-1', CompressionTier.COOL);
      manager.transitionTier('test-1', CompressionTier.COLD);
      manager.transitionTier('test-1', CompressionTier.FROZEN);

      expect(manager.getTier('test-1')).toBe(CompressionTier.FROZEN);
    });
  });

  describe('Access Record Tracking', () => {
    it('should create access record on store', () => {
      manager.store('test-1', generateRandomVector(VECTOR_DIM));

      const record = manager.getAccessRecord('test-1');
      expect(record).not.toBeNull();
      expect(record!.vectorId).toBe('test-1');
      expect(record!.tier).toBe(CompressionTier.HOT);
      expect(record!.totalAccesses).toBe(1);
      expect(record!.heatScore).toBe(1.0);
    });

    it('should update access count on retrieval', () => {
      manager.store('test-1', generateRandomVector(VECTOR_DIM));

      manager.retrieve('test-1');
      manager.retrieve('test-1');
      manager.retrieve('test-1');

      const record = manager.getAccessRecord('test-1');
      expect(record!.totalAccesses).toBe(4); // 1 store + 3 retrieves
    });

    it('should return null for non-existent vector', () => {
      expect(manager.getAccessRecord('non-existent')).toBeNull();
    });
  });

  describe('Heat Score Decay', () => {
    it('should decay heat scores', () => {
      manager.store('test-1', generateRandomVector(VECTOR_DIM));

      // Fast-forward time by mocking
      vi.useFakeTimers();
      vi.advanceTimersByTime(3600000); // 1 hour

      manager.decayHeatScores();

      const record = manager.getAccessRecord('test-1');
      expect(record!.heatScore).toBeLessThan(1.0);

      vi.useRealTimers();
    });

    it('should keep heat score high with recent access', () => {
      manager.store('test-1', generateRandomVector(VECTOR_DIM));
      manager.retrieve('test-1'); // Recent access

      manager.decayHeatScores();

      const record = manager.getAccessRecord('test-1');
      expect(record!.heatScore).toBeGreaterThan(0.5);
    });
  });

  describe('Memory Statistics', () => {
    it('should report correct stats for empty manager', () => {
      const stats = manager.getMemoryStats();
      expect(stats.totalVectors).toBe(0);
      expect(stats.totalBytes).toBe(0);
    });

    it('should report correct stats for HOT vectors', () => {
      manager.store('test-1', generateRandomVector(VECTOR_DIM));
      manager.store('test-2', generateRandomVector(VECTOR_DIM));

      const stats = manager.getMemoryStats();
      expect(stats.totalVectors).toBe(2);
      expect(stats.byTier[CompressionTier.HOT]).toBe(2);
      // TASK-VEC-001-008: 2 * 1536 * 4 = 12288 bytes for 1536D
      expect(stats.totalBytes).toBe(12288);
    });

    it('should show compression savings after tier transition', () => {
      const trainingData = generateTrainingData(150, VECTOR_DIM);
      manager.forceTrainCodebooks(trainingData);

      manager.store('test-1', generateRandomVector(VECTOR_DIM));
      manager.transitionTier('test-1', CompressionTier.FROZEN);

      const stats = manager.getMemoryStats();
      expect(stats.bytesSaved).toBeGreaterThan(0);
      expect(stats.compressionRatio).toBeGreaterThan(1);
    });
  });

  describe('Tier Distribution', () => {
    it('should track tier distribution', () => {
      const trainingData = generateTrainingData(150, VECTOR_DIM);
      manager.forceTrainCodebooks(trainingData);

      manager.store('test-1', generateRandomVector(VECTOR_DIM));
      manager.store('test-2', generateRandomVector(VECTOR_DIM));
      manager.store('test-3', generateRandomVector(VECTOR_DIM));

      manager.transitionTier('test-2', CompressionTier.WARM);
      manager.transitionTier('test-3', CompressionTier.COOL);

      const distribution = manager.getTierDistribution();
      expect(distribution.get(CompressionTier.HOT)).toBe(1);
      expect(distribution.get(CompressionTier.WARM)).toBe(1);
      expect(distribution.get(CompressionTier.COOL)).toBe(1);
    });
  });

  describe('Codebook Training', () => {
    it('should not be trained initially', () => {
      expect(manager.areCodebooksTrained()).toBe(false);
    });

    it('should train when enough data is available', () => {
      // Add vectors to training buffer
      for (let i = 0; i < 100; i++) {
        manager.store(`test-${i}`, generateRandomVector(VECTOR_DIM));
      }

      manager.trainCodebooks();
      expect(manager.areCodebooksTrained()).toBe(true);
    });

    it('should not train with insufficient data', () => {
      manager.store('test-1', generateRandomVector(VECTOR_DIM));
      manager.trainCodebooks();
      expect(manager.areCodebooksTrained()).toBe(false);
    });

    it('should throw when transitioning without trained codebook', () => {
      manager.store('test-1', generateRandomVector(VECTOR_DIM));

      expect(() => manager.transitionTier('test-1', CompressionTier.COOL))
        .toThrow(CompressionError);
      expect(() => manager.transitionTier('test-1', CompressionTier.COOL))
        .toThrow('codebook not trained');
    });
  });

  describe('Auto Transition', () => {
    it('should check and transition based on heat scores', () => {
      const trainingData = generateTrainingData(150, VECTOR_DIM);
      manager.forceTrainCodebooks(trainingData);

      manager.store('test-1', generateRandomVector(VECTOR_DIM));

      // Manually set low heat score
      const record = manager.getAccessRecord('test-1')!;
      record.heatScore = 0.05; // Should be COLD tier

      const transitioned = manager.checkTransitions();
      expect(transitioned).toBe(1);
      expect(manager.getTier('test-1')).toBe(CompressionTier.COLD);
    });

    it('should not transition if already at correct tier', () => {
      const trainingData = generateTrainingData(150, VECTOR_DIM);
      manager.forceTrainCodebooks(trainingData);

      manager.store('test-1', generateRandomVector(VECTOR_DIM));
      // Heat score is 1.0, should stay at HOT

      const transitioned = manager.checkTransitions();
      expect(transitioned).toBe(0);
    });
  });

  describe('Clear and Dispose', () => {
    it('should clear all data', () => {
      manager.store('test-1', generateRandomVector(VECTOR_DIM));
      manager.store('test-2', generateRandomVector(VECTOR_DIM));

      manager.clear();

      expect(manager.size).toBe(0);
      expect(manager.has('test-1')).toBe(false);
    });

    it('should dispose cleanly', () => {
      manager.store('test-1', generateRandomVector(VECTOR_DIM));
      expect(() => manager.dispose()).not.toThrow();
    });
  });

  describe('Custom Configuration', () => {
    it('should accept custom dimension', () => {
      const customManager = new CompressionManager({ dimension: 256 });

      expect(() => customManager.store('test-1', generateRandomVector(256))).not.toThrow();
      // TASK-VEC-001-008: 1536 is now default, so 1536 should fail for 256D manager
      expect(() => customManager.store('test-2', generateRandomVector(VECTOR_DIM))).toThrow();

      customManager.dispose();
    });

    it('should use default config values', () => {
      const defaultManager = new CompressionManager();
      // Just verify it creates without error
      expect(defaultManager).toBeInstanceOf(CompressionManager);
      defaultManager.dispose();
    });
  });

  describe('Vector ID Operations', () => {
    it('should get all vector IDs', () => {
      manager.store('a', generateRandomVector(VECTOR_DIM));
      manager.store('b', generateRandomVector(VECTOR_DIM));
      manager.store('c', generateRandomVector(VECTOR_DIM));

      const ids = manager.getAllVectorIds();
      expect(ids).toHaveLength(3);
      expect(ids).toContain('a');
      expect(ids).toContain('b');
      expect(ids).toContain('c');
    });
  });
});

// ==================== Error Classes Tests ====================

describe('Error Classes', () => {
  describe('CompressionError', () => {
    it('should have correct properties', () => {
      const error = new CompressionError('test message', 'INVALID_TIER');
      expect(error.message).toBe('test message');
      expect(error.code).toBe('INVALID_TIER');
      expect(error.name).toBe('CompressionError');
    });
  });

  describe('TierTransitionError', () => {
    it('should have correct message format', () => {
      const error = new TierTransitionError(CompressionTier.WARM, CompressionTier.HOT);
      expect(error.fromTier).toBe(CompressionTier.WARM);
      expect(error.toTier).toBe(CompressionTier.HOT);
      expect(error.message).toContain('warm');
      expect(error.message).toContain('hot');
      expect(error.name).toBe('TierTransitionError');
    });
  });
});

// ==================== Performance Tests ====================

describe('Performance', () => {
  it('should compress 1000 vectors in reasonable time', () => {
    const manager = new CompressionManager({ autoTransition: false });
    // TASK-VEC-001-008: Use VECTOR_DIM
    const trainingData = generateTrainingData(150, VECTOR_DIM);
    manager.forceTrainCodebooks(trainingData);

    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      manager.store(`perf-${i}`, generateRandomVector(VECTOR_DIM));
    }
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5000); // 5 seconds for 1000 vectors
    manager.dispose();
  });

  it('should achieve target memory reduction', () => {
    const manager = new CompressionManager({ autoTransition: false });
    // TASK-VEC-001-008: Use VECTOR_DIM
    const trainingData = generateTrainingData(150, VECTOR_DIM);
    manager.forceTrainCodebooks(trainingData);

    // Store and transition to various tiers
    for (let i = 0; i < 100; i++) {
      manager.store(`tier-${i}`, generateRandomVector(VECTOR_DIM));
      if (i < 20) {
        // 20% HOT - do nothing
      } else if (i < 40) {
        manager.transitionTier(`tier-${i}`, CompressionTier.WARM);
      } else if (i < 60) {
        manager.transitionTier(`tier-${i}`, CompressionTier.COOL);
      } else if (i < 80) {
        manager.transitionTier(`tier-${i}`, CompressionTier.COLD);
      } else {
        manager.transitionTier(`tier-${i}`, CompressionTier.FROZEN);
      }
    }

    const stats = manager.getMemoryStats();
    expect(stats.compressionRatio).toBeGreaterThan(2); // At least 2x compression

    manager.dispose();
  });
});
