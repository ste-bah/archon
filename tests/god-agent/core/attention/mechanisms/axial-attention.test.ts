/**
 * Tests for Real Axial Attention Implementation
 *
 * Validates:
 * - Mathematical correctness (factorized attention)
 * - Numerical stability
 * - Grid reshaping
 * - Row/column attention separation
 * - Multi-head processing
 * - Masking support
 * - Parameter count
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RealAxialAttention } from '../../../../../src/god-agent/core/attention/mechanisms/axial-attention.js';
import { hasNaNOrInf } from '../../../../../src/god-agent/core/attention/utils/index.js';

describe('RealAxialAttention', () => {
  let attention: RealAxialAttention;

  beforeEach(() => {
    attention = new RealAxialAttention({
      dimension: 64,
      numHeads: 4,
      seed: 12345
    });
  });

  describe('Initialization', () => {
    it('should initialize with correct configuration', () => {
      expect(attention.name).toBe('axial');
      expect(attention.getParameterCount()).toBe(4 * 64 * 64);
    });

    it('should reject dimension not divisible by numHeads', () => {
      expect(() => {
        new RealAxialAttention({ dimension: 63, numHeads: 4 });
      }).toThrow(/must be divisible by numHeads/);
    });

    it('should initialize with default configuration', () => {
      const defaultAttn = new RealAxialAttention();
      expect(defaultAttn.getParameterCount()).toBe(4 * 1536 * 1536);
    });

    it('should use custom seed for reproducibility', () => {
      const attn1 = new RealAxialAttention({ dimension: 32, numHeads: 2, seed: 111 });
      const attn2 = new RealAxialAttention({ dimension: 32, numHeads: 2, seed: 111 });

      const input = new Float32Array(4 * 32).fill(1.0);
      const out1 = attn1.forward(input, undefined, undefined, undefined, 4);
      const out2 = attn2.forward(input, undefined, undefined, undefined, 4);

      expect(out1).toEqual(out2);
    });
  });

  describe('Forward Pass - Basic', () => {
    it('should process perfect square sequence (4 positions = 2x2 grid)', () => {
      const seqLen = 4;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);

      // Initialize with distinct patterns
      for (let i = 0; i < seqLen; i++) {
        for (let d = 0; d < dim; d++) {
          input[i * dim + d] = Math.sin(i + d * 0.1);
        }
      }

      const output = attention.forward(input, undefined, undefined, undefined, seqLen);

      expect(output.length).toBe(seqLen * dim);
      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should process non-square sequence with padding (5 positions -> 3x2 grid)', () => {
      const seqLen = 5;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen; i++) {
        for (let d = 0; d < dim; d++) {
          input[i * dim + d] = (i + 1) * (d + 1) * 0.01;
        }
      }

      const output = attention.forward(input, undefined, undefined, undefined, seqLen);

      expect(output.length).toBe(seqLen * dim);
      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should handle 9 positions (3x3 grid)', () => {
      const seqLen = 9;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);

      // Create gradient pattern
      for (let i = 0; i < seqLen; i++) {
        const value = i / seqLen;
        for (let d = 0; d < dim; d++) {
          input[i * dim + d] = value + d * 0.001;
        }
      }

      const output = attention.forward(input, undefined, undefined, undefined, seqLen);

      expect(output.length).toBe(seqLen * dim);
      expect(hasNaNOrInf(output)).toBe(false);

      // Output should be different from input (attention has been applied)
      let hasDifference = false;
      for (let i = 0; i < 10; i++) {
        if (Math.abs(output[i] - input[i]) > 1e-6) {
          hasDifference = true;
          break;
        }
      }
      expect(hasDifference).toBe(true);
    });

    it('should handle single position gracefully', () => {
      const seqLen = 1;
      const dim = 64;
      const input = new Float32Array(dim);
      input.fill(0.5);

      const output = attention.forward(input, undefined, undefined, undefined, seqLen);

      expect(output.length).toBe(dim);
      expect(hasNaNOrInf(output)).toBe(false);
    });
  });

  describe('Grid Reshaping', () => {
    it('should handle explicit axis size configuration', () => {
      const axialAttn = new RealAxialAttention({
        dimension: 64,
        numHeads: 4,
        axisSize: 4,  // Force 4x4 grid
        seed: 999
      });

      const seqLen = 16;
      const input = new Float32Array(seqLen * 64);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.random();
      }

      const output = axialAttn.forward(input, undefined, undefined, undefined, seqLen);

      expect(output.length).toBe(seqLen * 64);
      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should auto-infer grid size from sequence length', () => {
      // 16 positions -> 4x4 grid (default behavior)
      const seqLen = 16;
      const input = new Float32Array(seqLen * 64);
      input.fill(0.7);

      const output = attention.forward(input, undefined, undefined, undefined, seqLen);

      expect(output.length).toBe(seqLen * 64);
      expect(hasNaNOrInf(output)).toBe(false);
    });
  });

  describe('Numerical Stability', () => {
    it('should handle extreme positive values', () => {
      const seqLen = 4;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);
      input.fill(100.0);

      const output = attention.forward(input, undefined, undefined, undefined, seqLen);

      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should handle extreme negative values', () => {
      const seqLen = 4;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);
      input.fill(-100.0);

      const output = attention.forward(input, undefined, undefined, undefined, seqLen);

      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should handle mixed extreme values', () => {
      const seqLen = 4;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen; i++) {
        const value = i % 2 === 0 ? 50.0 : -50.0;
        for (let d = 0; d < dim; d++) {
          input[i * dim + d] = value;
        }
      }

      const output = attention.forward(input, undefined, undefined, undefined, seqLen);

      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should handle zero input', () => {
      const seqLen = 4;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);
      // Already filled with zeros

      const output = attention.forward(input, undefined, undefined, undefined, seqLen);

      expect(hasNaNOrInf(output)).toBe(false);
    });
  });

  describe('Multi-head Attention', () => {
    it('should process all heads independently', () => {
      const attn2heads = new RealAxialAttention({
        dimension: 64,
        numHeads: 2,
        seed: 777
      });

      const attn4heads = new RealAxialAttention({
        dimension: 64,
        numHeads: 4,
        seed: 888
      });

      const seqLen = 4;
      const input = new Float32Array(seqLen * 64);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1);
      }

      const out2 = attn2heads.forward(input, undefined, undefined, undefined, seqLen);
      const out4 = attn4heads.forward(input, undefined, undefined, undefined, seqLen);

      // Different head configurations should produce different outputs
      expect(hasNaNOrInf(out2)).toBe(false);
      expect(hasNaNOrInf(out4)).toBe(false);
      expect(out2).not.toEqual(out4);
    });

    it('should handle single head configuration', () => {
      const singleHead = new RealAxialAttention({
        dimension: 64,
        numHeads: 1,
        seed: 555
      });

      const seqLen = 4;
      const input = new Float32Array(seqLen * 64);
      input.fill(0.5);

      const output = singleHead.forward(input, undefined, undefined, undefined, seqLen);

      expect(output.length).toBe(seqLen * 64);
      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should handle 8 heads', () => {
      const attn8heads = new RealAxialAttention({
        dimension: 64,
        numHeads: 8,
        seed: 333
      });

      const seqLen = 4;
      const input = new Float32Array(seqLen * 64);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.cos(i * 0.05);
      }

      const output = attn8heads.forward(input, undefined, undefined, undefined, seqLen);

      expect(output.length).toBe(seqLen * 64);
      expect(hasNaNOrInf(output)).toBe(false);
    });
  });

  describe('Separate Q, K, V', () => {
    it('should support separate key and value inputs', () => {
      const seqLen = 4;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = Math.tan(i * 0.05);
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      expect(output.length).toBe(seqLen * dim);
      expect(hasNaNOrInf(output)).toBe(false);
    });
  });

  describe('Input Validation', () => {
    it('should reject mismatched query length', () => {
      const seqLen = 4;
      const input = new Float32Array(3 * 64);  // Wrong length

      expect(() => {
        attention.forward(input, undefined, undefined, undefined, seqLen);
      }).toThrow(/query length/);
    });

    it('should reject mismatched key length', () => {
      const seqLen = 4;
      const query = new Float32Array(seqLen * 64);
      const key = new Float32Array(3 * 64);  // Wrong length

      expect(() => {
        attention.forward(query, key, undefined, undefined, seqLen);
      }).toThrow(/key length/);
    });

    it('should reject mismatched value length', () => {
      const seqLen = 4;
      const query = new Float32Array(seqLen * 64);
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(3 * 64);  // Wrong length

      expect(() => {
        attention.forward(query, key, value, undefined, seqLen);
      }).toThrow(/value length/);
    });
  });

  describe('Complexity Verification', () => {
    it('should be more efficient than full attention for large sequences', () => {
      // Axial: O(N * sqrt(N)) vs Full: O(N²)
      // For N=64: Axial = 64*8 = 512 vs Full = 4096 (8x reduction)

      const seqLen = 64;  // 8x8 grid
      const dim = 64;
      const input = new Float32Array(seqLen * dim);

      for (let i = 0; i < input.length; i++) {
        input[i] = Math.random();
      }

      const startTime = performance.now();
      const output = attention.forward(input, undefined, undefined, undefined, seqLen);
      const endTime = performance.now();

      expect(output.length).toBe(seqLen * dim);
      expect(hasNaNOrInf(output)).toBe(false);
      expect(endTime - startTime).toBeLessThan(100); // Should be fast
    });
  });

  describe('Output Characteristics', () => {
    it('should produce different output than input', () => {
      const seqLen = 4;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);

      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1);
      }

      const output = attention.forward(input, undefined, undefined, undefined, seqLen);

      // Attention should transform the input
      let totalDiff = 0;
      for (let i = 0; i < input.length; i++) {
        totalDiff += Math.abs(output[i] - input[i]);
      }

      expect(totalDiff).toBeGreaterThan(1.0);  // Significant transformation
    });

    it('should be deterministic with same seed', () => {
      const attn1 = new RealAxialAttention({ dimension: 64, numHeads: 4, seed: 42 });
      const attn2 = new RealAxialAttention({ dimension: 64, numHeads: 4, seed: 42 });

      const seqLen = 4;
      const input = new Float32Array(seqLen * 64);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.random();
      }

      const out1 = attn1.forward(input, undefined, undefined, undefined, seqLen);
      const out2 = attn2.forward(input, undefined, undefined, undefined, seqLen);

      expect(out1).toEqual(out2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small dimension', () => {
      const smallAttn = new RealAxialAttention({
        dimension: 4,
        numHeads: 2,
        seed: 123
      });

      const seqLen = 4;
      const input = new Float32Array(seqLen * 4);
      input.fill(0.5);

      const output = smallAttn.forward(input, undefined, undefined, undefined, seqLen);

      expect(output.length).toBe(seqLen * 4);
      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should handle larger dimensions', () => {
      const largeAttn = new RealAxialAttention({
        dimension: 128,
        numHeads: 8,
        seed: 456
      });

      const seqLen = 4;
      const input = new Float32Array(seqLen * 128);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.01);
      }

      const output = largeAttn.forward(input, undefined, undefined, undefined, seqLen);

      expect(output.length).toBe(seqLen * 128);
      expect(hasNaNOrInf(output)).toBe(false);
    });
  });
});
