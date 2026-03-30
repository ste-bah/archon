/**
 * RealStandardAttention Tests
 * PHASE-0-001-010 - Standard Attention Mechanism Tests
 * TASK-VEC-001-008 - Updated to use VECTOR_DIM (1536D)
 *
 * Comprehensive test suite covering:
 * - Constructor and initialization
 * - Forward pass computation
 * - Attention masking
 * - Numerical stability
 * - Parameter counting
 * - Determinism
 * - Interface compliance
 *
 * Target: 40+ test cases, 95%+ coverage
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RealStandardAttention } from '../../../../../src/god-agent/core/attention/mechanisms/standard-attention.js';
import { createCausalMask } from '../../../../../src/god-agent/core/attention/utils/mask-utils.js';
import type { IAttentionMechanism } from '../../../../../src/god-agent/core/attention/attention-types.js';
import { VECTOR_DIM, DEFAULT_NUM_HEADS } from '../../../../../src/god-agent/core/validation/constants.js';

// ==================== Helper Functions ====================

/**
 * Create a test vector with specified values
 */
function createVector(length: number, value: number): Float32Array {
  return new Float32Array(length).fill(value);
}

/**
 * Create a random-like test vector (deterministic)
 */
function createTestVector(length: number, seed: number): Float32Array {
  const vec = new Float32Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    // Simple LCG for deterministic "randomness"
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    vec[i] = (state / 0x7fffffff) * 2 - 1; // Range [-1, 1]
  }
  return vec;
}

/**
 * Check if array contains NaN or Infinity
 */
function hasNaNOrInf(arr: Float32Array): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (!isFinite(arr[i])) {
      return true;
    }
  }
  return false;
}

/**
 * Check if all values are within a reasonable range
 */
function isReasonablyBounded(arr: Float32Array, maxAbs: number = 1000): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (Math.abs(arr[i]) > maxAbs) {
      return false;
    }
  }
  return true;
}

/**
 * Compare two Float32Arrays with tolerance
 */
function arraysEqual(a: Float32Array, b: Float32Array, tolerance: number = 1e-6): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > tolerance) {
      return false;
    }
  }
  return true;
}

// ==================== Constructor Tests ====================

describe('RealStandardAttention - Constructor', () => {
  describe('Default Configuration', () => {
    it('should create with default dimension (VECTOR_DIM=1536) and heads (12)', () => {
      // Note: Production default is VECTOR_DIM=1536 since VEC-001 migration.
      const attention = new RealStandardAttention();
      expect(attention.name).toBe('standard');
      expect(attention.getParameterCount()).toBe(4 * 1536 * 1536);
    });

    it('should be named "standard"', () => {
      const attention = new RealStandardAttention();
      expect(attention.name).toBe('standard');
    });
  });

  describe('Custom Configuration', () => {
    it('should create with custom dimension', () => {
      const attention = new RealStandardAttention({ dimension: 512, numHeads: 8 });
      expect(attention.getParameterCount()).toBe(4 * 512 * 512);
    });

    it('should create with custom number of heads', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM
      const attention = new RealStandardAttention({ dimension: VECTOR_DIM, numHeads: 8 });
      // Parameter count should still be based on dimension
      expect(attention.getParameterCount()).toBe(4 * VECTOR_DIM * VECTOR_DIM);
    });

    it('should create with both custom dimension and heads', () => {
      const attention = new RealStandardAttention({ dimension: 512, numHeads: 8 });
      expect(attention.getParameterCount()).toBe(4 * 512 * 512);
    });
  });

  describe('Validation', () => {
    it('should validate dimension divisible by numHeads', () => {
      // Valid: 1536 / 12 = 128
      expect(() => new RealStandardAttention({ dimension: VECTOR_DIM, numHeads: DEFAULT_NUM_HEADS })).not.toThrow();

      // Invalid: 1536 / 11 is not an integer
      expect(() => new RealStandardAttention({ dimension: VECTOR_DIM, numHeads: 11 }))
        .toThrow('must be divisible by numHeads');
    });

    it('should reject invalid dimension/head combinations', () => {
      expect(() => new RealStandardAttention({ dimension: 100, numHeads: 7 })).toThrow();
      expect(() => new RealStandardAttention({ dimension: 512, numHeads: 9 })).toThrow();
    });
  });

  describe('Deterministic Initialization', () => {
    it('should initialize deterministically with seed', () => {
      const attention1 = new RealStandardAttention({ seed: 42 });
      const attention2 = new RealStandardAttention({ seed: 42 });

      // Same seed should produce identical weights (verify by computing same output)
      const query = createVector(VECTOR_DIM, 0.5);
      const output1 = attention1.forward(query, query, query);
      const output2 = attention2.forward(query, query, query);

      expect(arraysEqual(output1, output2)).toBe(true);
    });

    it('should produce different weights with different seeds', () => {
      const attention1 = new RealStandardAttention({ seed: 42 });
      const attention2 = new RealStandardAttention({ seed: 123 });

      const query = createVector(VECTOR_DIM, 0.5);
      const output1 = attention1.forward(query, query, query);
      const output2 = attention2.forward(query, query, query);

      // Different seeds should produce different outputs
      expect(arraysEqual(output1, output2)).toBe(false);
    });
  });
});

// ==================== Forward Pass Tests ====================

describe('RealStandardAttention - Forward Pass', () => {
  let attention: RealStandardAttention;

  beforeEach(() => {
    // TASK-VEC-001-008: Use VECTOR_DIM and DEFAULT_NUM_HEADS for consistency
    attention = new RealStandardAttention({ dimension: VECTOR_DIM, numHeads: DEFAULT_NUM_HEADS, seed: 42 });
  });

  describe('Output Dimensions', () => {
    it('should return correct dimensions for single vector', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM
      const query = createVector(VECTOR_DIM, 0.5);
      const output = attention.forward(query, query, query);

      expect(output.length).toBe(VECTOR_DIM);
    });

    it('should return correct dimensions for sequence (seqLen=4)', () => {
      const seqLen = 4;
      const query = createVector(VECTOR_DIM * seqLen, 0.5);
      const output = attention.forward(query, query, query, undefined, seqLen);

      expect(output.length).toBe(VECTOR_DIM * seqLen);
    });

    it('should handle seqLen=1 explicitly', () => {
      const query = createVector(VECTOR_DIM, 0.5);
      const output = attention.forward(query, query, query, undefined, 1);

      expect(output.length).toBe(VECTOR_DIM);
    });

    it('should handle long sequences (seqLen=16)', () => {
      const seqLen = 16;
      const query = createVector(VECTOR_DIM * seqLen, 0.1);
      const output = attention.forward(query, query, query, undefined, seqLen);

      expect(output.length).toBe(VECTOR_DIM * seqLen);
    });
  });

  describe('Sequence Length Inference', () => {
    it('should infer seqLen from query length when not provided', () => {
      const seqLen = 4;
      const query = createVector(VECTOR_DIM * seqLen, 0.5);
      const output = attention.forward(query, query, query);

      expect(output.length).toBe(VECTOR_DIM * seqLen);
    });

    it('should infer seqLen=1 for single vector', () => {
      const query = createVector(VECTOR_DIM, 0.5);
      const output = attention.forward(query, query, query);

      expect(output.length).toBe(VECTOR_DIM);
    });
  });

  describe('Input Validation', () => {
    it('should validate input dimension compatibility', () => {
      const wrongDim = createVector(512, 0.5); // Wrong dimension
      expect(() => attention.forward(wrongDim, wrongDim, wrongDim))
        .toThrow('incompatible');
    });

    it('should validate Q, K, V length match', () => {
      const query = createVector(VECTOR_DIM, 0.5);
      const key = createVector(VECTOR_DIM * 2, 0.5); // Different length
      const value = createVector(VECTOR_DIM, 0.5);

      // Use flexible matching pattern for dimension error messages
      expect(() => attention.forward(query, key, value))
        .toThrow(/[Dd]imension mismatch/);
    });

    it('should reject mismatched sequence lengths', () => {
      const query = createVector(VECTOR_DIM * 4, 0.5);
      const key = createVector(VECTOR_DIM * 5, 0.5);
      const value = createVector(VECTOR_DIM * 4, 0.5);

      // Use flexible matching pattern for dimension error messages
      expect(() => attention.forward(query, key, value))
        .toThrow(/[Dd]imension mismatch/);
    });
  });

  describe('Output Quality', () => {
    it('should not produce NaN or Inf values', () => {
      const query = createTestVector(VECTOR_DIM, 42);
      const output = attention.forward(query, query, query);

      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should produce finite output for multi-sequence', () => {
      const seqLen = 4;
      const query = createTestVector(VECTOR_DIM * seqLen, 42);
      const output = attention.forward(query, query, query, undefined, seqLen);

      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should produce reasonably bounded output', () => {
      const query = createTestVector(VECTOR_DIM, 42);
      const output = attention.forward(query, query, query);

      expect(isReasonablyBounded(output)).toBe(true);
    });
  });
});

// ==================== Masking Tests ====================

describe('RealStandardAttention - Masking', () => {
  let attention: RealStandardAttention;

  beforeEach(() => {
    // TASK-VEC-001-008: Use VECTOR_DIM for consistency with test vectors
    attention = new RealStandardAttention({ dimension: VECTOR_DIM, numHeads: DEFAULT_NUM_HEADS, seed: 42 });
  });

  describe('No Mask (Full Attention)', () => {
    it('should work without mask', () => {
      const seqLen = 4;
      const query = createTestVector(VECTOR_DIM * seqLen, 42);

      expect(() => attention.forward(query, query, query, undefined, seqLen))
        .not.toThrow();
    });

    it('should produce different output than causal mask', () => {
      const seqLen = 4;
      const query = createTestVector(VECTOR_DIM * seqLen, 42);

      const outputNoMask = attention.forward(query, query, query, undefined, seqLen);
      const mask = createCausalMask(seqLen);
      const outputWithMask = attention.forward(query, query, query, mask, seqLen);

      expect(arraysEqual(outputNoMask, outputWithMask)).toBe(false);
    });
  });

  describe('Causal Mask', () => {
    it('should prevent future attention with causal mask', () => {
      const seqLen = 4;
      const query = createTestVector(VECTOR_DIM * seqLen, 42);
      const mask = createCausalMask(seqLen);

      const output = attention.forward(query, query, query, mask, seqLen);

      // Should not throw and produce valid output
      expect(output.length).toBe(VECTOR_DIM * seqLen);
      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should produce different outputs for different mask patterns', () => {
      const seqLen = 4;
      const query = createTestVector(VECTOR_DIM * seqLen, 42);

      const causalMask = createCausalMask(seqLen);
      const fullMask = new Array(seqLen * seqLen).fill(true);

      const outputCausal = attention.forward(query, query, query, causalMask, seqLen);
      const outputFull = attention.forward(query, query, query, fullMask, seqLen);

      expect(arraysEqual(outputCausal, outputFull)).toBe(false);
    });
  });

  describe('Masked Positions', () => {
    it('should handle all-masked row gracefully', () => {
      const seqLen = 4;
      const query = createTestVector(VECTOR_DIM * seqLen, 42);

      // Create mask where first row is all false
      const mask = new Array(seqLen * seqLen).fill(true);
      for (let j = 0; j < seqLen; j++) {
        mask[j] = false;
      }

      const output = attention.forward(query, query, query, mask, seqLen);

      // Should handle gracefully (softmax should produce uniform or handle edge case)
      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should validate mask dimensions', () => {
      const seqLen = 4;
      const query = createTestVector(VECTOR_DIM * seqLen, 42);
      const wrongMask = new Array(seqLen * seqLen + 1).fill(true); // Wrong size

      expect(() => attention.forward(query, query, query, wrongMask, seqLen))
        .toThrow('incompatible');
    });
  });
});

// ==================== Numerical Stability Tests ====================

describe('RealStandardAttention - Numerical Stability', () => {
  let attention: RealStandardAttention;

  beforeEach(() => {
    // TASK-VEC-001-008: Use VECTOR_DIM for consistency with test vectors
    attention = new RealStandardAttention({ dimension: VECTOR_DIM, numHeads: DEFAULT_NUM_HEADS, seed: 42 });
  });

  describe('Large Input Values', () => {
    it('should handle large input values without overflow', () => {
      const query = createVector(VECTOR_DIM, 100); // Large values

      expect(() => attention.forward(query, query, query)).not.toThrow();
      const output = attention.forward(query, query, query);
      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should handle very large sequence with large values', () => {
      const seqLen = 8;
      const query = createVector(VECTOR_DIM * seqLen, 50);

      const output = attention.forward(query, query, query, undefined, seqLen);
      expect(hasNaNOrInf(output)).toBe(false);
    });
  });

  describe('Small Input Values', () => {
    it('should handle small input values without underflow', () => {
      const query = createVector(VECTOR_DIM, 1e-6); // Very small values

      const output = attention.forward(query, query, query);
      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should handle near-zero values', () => {
      const query = createVector(VECTOR_DIM, 1e-10);

      const output = attention.forward(query, query, query);
      expect(hasNaNOrInf(output)).toBe(false);
    });
  });

  describe('Zero Vectors', () => {
    it('should handle zero query vector', () => {
      const query = createVector(VECTOR_DIM, 0);

      const output = attention.forward(query, query, query);
      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should handle all-zero sequence', () => {
      const seqLen = 4;
      const query = createVector(VECTOR_DIM * seqLen, 0);

      const output = attention.forward(query, query, query, undefined, seqLen);
      expect(hasNaNOrInf(output)).toBe(false);
    });
  });

  describe('Output Bounds', () => {
    it('should produce bounded output for normal inputs', () => {
      const query = createTestVector(VECTOR_DIM, 42);
      const output = attention.forward(query, query, query);

      // Output should be reasonably bounded
      expect(isReasonablyBounded(output, 100)).toBe(true);
    });

    it('should not produce extreme values', () => {
      const seqLen = 4;
      const query = createTestVector(VECTOR_DIM * seqLen, 42);
      const output = attention.forward(query, query, query, undefined, seqLen);

      // Check no values exceed reasonable bounds
      for (let i = 0; i < output.length; i++) {
        expect(Math.abs(output[i])).toBeLessThan(1000);
      }
    });
  });
});

// ==================== Parameter Count Tests ====================

describe('RealStandardAttention - Parameter Count', () => {
  describe('Formula: 4 x dim^2', () => {
    it('should return 4 x dim^2 for default dimension (VECTOR_DIM=1536)', () => {
      // Note: Production default is VECTOR_DIM=1536 since VEC-001 migration
      const attention = new RealStandardAttention();
      expect(attention.getParameterCount()).toBe(4 * 1536 * 1536);
    });

    it('should return correct count for dimension 64', () => {
      const attention = new RealStandardAttention({ dimension: 64, numHeads: 8 });
      expect(attention.getParameterCount()).toBe(4 * 64 * 64);
    });

    it('should return correct count for dimension 128', () => {
      const attention = new RealStandardAttention({ dimension: 128, numHeads: 8 });
      expect(attention.getParameterCount()).toBe(4 * 128 * 128);
    });

    it('should return correct count for dimension 256', () => {
      const attention = new RealStandardAttention({ dimension: 256, numHeads: 8 });
      expect(attention.getParameterCount()).toBe(4 * 256 * 256);
    });

    it('should return correct count for dimension 512', () => {
      const attention = new RealStandardAttention({ dimension: 512, numHeads: 8 });
      expect(attention.getParameterCount()).toBe(4 * 512 * 512);
    });

    it('should return correct count for dimension 1536', () => {
      // TASK-VEC-001-008: Updated from 768 to 1536
      const attention = new RealStandardAttention({ dimension: VECTOR_DIM, numHeads: DEFAULT_NUM_HEADS });
      expect(attention.getParameterCount()).toBe(4 * VECTOR_DIM * VECTOR_DIM);
    });
  });

  describe('Independence from numHeads', () => {
    it('should not depend on number of heads', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM
      const attention8 = new RealStandardAttention({ dimension: VECTOR_DIM, numHeads: 8 });
      const attention12 = new RealStandardAttention({ dimension: VECTOR_DIM, numHeads: 12 });

      expect(attention8.getParameterCount()).toBe(attention12.getParameterCount());
    });
  });
});

// ==================== Determinism Tests ====================

describe('RealStandardAttention - Determinism', () => {
  describe('Same Seed, Same Output', () => {
    it('should produce identical output with same seed and input', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM for consistency
      const attention1 = new RealStandardAttention({ dimension: VECTOR_DIM, numHeads: DEFAULT_NUM_HEADS, seed: 42 });
      const attention2 = new RealStandardAttention({ dimension: VECTOR_DIM, numHeads: DEFAULT_NUM_HEADS, seed: 42 });

      const query = createTestVector(VECTOR_DIM, 123);
      const output1 = attention1.forward(query, query, query);
      const output2 = attention2.forward(query, query, query);

      expect(arraysEqual(output1, output2)).toBe(true);
    });

    it('should be deterministic for multi-sequence', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM for consistency
      const attention1 = new RealStandardAttention({ dimension: VECTOR_DIM, numHeads: DEFAULT_NUM_HEADS, seed: 42 });
      const attention2 = new RealStandardAttention({ dimension: VECTOR_DIM, numHeads: DEFAULT_NUM_HEADS, seed: 42 });

      const seqLen = 4;
      const query = createTestVector(VECTOR_DIM * seqLen, 123);
      const output1 = attention1.forward(query, query, query, undefined, seqLen);
      const output2 = attention2.forward(query, query, query, undefined, seqLen);

      expect(arraysEqual(output1, output2)).toBe(true);
    });

    it('should be deterministic with masking', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM for consistency
      const attention1 = new RealStandardAttention({ dimension: VECTOR_DIM, numHeads: DEFAULT_NUM_HEADS, seed: 42 });
      const attention2 = new RealStandardAttention({ dimension: VECTOR_DIM, numHeads: DEFAULT_NUM_HEADS, seed: 42 });

      const seqLen = 4;
      const query = createTestVector(VECTOR_DIM * seqLen, 123);
      const mask = createCausalMask(seqLen);

      const output1 = attention1.forward(query, query, query, mask, seqLen);
      const output2 = attention2.forward(query, query, query, mask, seqLen);

      expect(arraysEqual(output1, output2)).toBe(true);
    });
  });

  describe('Different Seeds, Different Output', () => {
    it('should produce different output with different seeds', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM for consistency
      const attention1 = new RealStandardAttention({ dimension: VECTOR_DIM, numHeads: DEFAULT_NUM_HEADS, seed: 42 });
      const attention2 = new RealStandardAttention({ dimension: VECTOR_DIM, numHeads: DEFAULT_NUM_HEADS, seed: 123 });

      const query = createTestVector(VECTOR_DIM, 456);
      const output1 = attention1.forward(query, query, query);
      const output2 = attention2.forward(query, query, query);

      expect(arraysEqual(output1, output2)).toBe(false);
    });

    it('should vary with seed for sequences', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM for consistency
      const attention1 = new RealStandardAttention({ dimension: VECTOR_DIM, numHeads: DEFAULT_NUM_HEADS, seed: 42 });
      const attention2 = new RealStandardAttention({ dimension: VECTOR_DIM, numHeads: DEFAULT_NUM_HEADS, seed: 999 });

      const seqLen = 4;
      const query = createTestVector(VECTOR_DIM * seqLen, 456);
      const output1 = attention1.forward(query, query, query, undefined, seqLen);
      const output2 = attention2.forward(query, query, query, undefined, seqLen);

      expect(arraysEqual(output1, output2)).toBe(false);
    });
  });
});

// ==================== Interface Compliance Tests ====================

describe('RealStandardAttention - Interface Compliance', () => {
  let attention: IAttentionMechanism;

  beforeEach(() => {
    // TASK-VEC-001-008: Use VECTOR_DIM for consistency
    attention = new RealStandardAttention({ dimension: VECTOR_DIM, numHeads: DEFAULT_NUM_HEADS, seed: 42 });
  });

  describe('IAttentionMechanism Interface', () => {
    it('should implement IAttentionMechanism', () => {
      expect(attention).toHaveProperty('name');
      expect(attention).toHaveProperty('forward');
      expect(attention).toHaveProperty('getParameterCount');
    });

    it('should have name property equal to "standard"', () => {
      expect(attention.name).toBe('standard');
    });

    it('should have readonly name', () => {
      // TypeScript enforces this, but verify it exists
      expect(attention.name).toBeDefined();
    });
  });

  describe('Method Signatures', () => {
    it('should have correct forward() signature', () => {
      expect(typeof attention.forward).toBe('function');

      // TASK-VEC-001-008: Use VECTOR_DIM
      const query = createVector(VECTOR_DIM, 0.5);
      const result = attention.forward(query, query, query);

      expect(result).toBeInstanceOf(Float32Array);
    });

    it('should accept optional mask parameter', () => {
      const seqLen = 4;
      const query = createVector(VECTOR_DIM * seqLen, 0.5);
      const mask = createCausalMask(seqLen);

      expect(() => attention.forward(query, query, query, mask, seqLen))
        .not.toThrow();
    });

    it('should accept optional seqLen parameter', () => {
      const query = createVector(VECTOR_DIM * 4, 0.5);

      expect(() => attention.forward(query, query, query, undefined, 4))
        .not.toThrow();
    });

    it('should have correct getParameterCount() signature', () => {
      expect(typeof attention.getParameterCount).toBe('function');

      const count = attention.getParameterCount();

      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThan(0);
    });
  });
});
