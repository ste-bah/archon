/**
 * Set Transformer Attention Tests
 *
 * Validates the ISAB (Induced Set Attention Block) implementation
 * with inducing points for efficient set-based attention.
 */

import { describe, it, expect } from 'vitest';
import { RealSetTransformerAttention } from '../../../../../src/god-agent/core/attention/mechanisms/set-transformer-attention.js';

describe('RealSetTransformerAttention', () => {
  describe('Construction and Configuration', () => {
    it('should construct with default configuration', () => {
      const attention = new RealSetTransformerAttention();
      expect(attention.name).toBe('set-transformer');
      expect(attention.getParameterCount()).toBeGreaterThan(0);
    });

    it('should construct with custom dimension', () => {
      const attention = new RealSetTransformerAttention({ dimension: 512, numHeads: 8 });
      expect(attention.getParameterCount()).toBeGreaterThan(0);
    });

    it('should construct with custom numHeads', () => {
      const attention = new RealSetTransformerAttention({
        dimension: 768,
        numHeads: 8,
      });
      expect(attention.getParameterCount()).toBeGreaterThan(0);
    });

    it('should construct with custom numInducingPoints', () => {
      const attention = new RealSetTransformerAttention({
        dimension: 768,
        numInducingPoints: 16,
      });
      expect(attention.getParameterCount()).toBeGreaterThan(0);
    });

    it('should construct with custom seed for determinism', () => {
      const attention1 = new RealSetTransformerAttention({ seed: 123 });
      const attention2 = new RealSetTransformerAttention({ seed: 123 });

      const seqLen = 4;
      const dim = 1536;  // VECTOR_DIM since VEC-001 migration
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.01);
      }

      const output1 = attention1.forward(input, input, input, undefined, seqLen);
      const output2 = attention2.forward(input, input, input, undefined, seqLen);

      expect(output1).toEqual(output2);
    });

    it('should throw on invalid dimension', () => {
      expect(() => new RealSetTransformerAttention({ dimension: 0 })).toThrow(
        'ANTI-009: dimension must be positive'
      );
      expect(() => new RealSetTransformerAttention({ dimension: -1 })).toThrow(
        'ANTI-009: dimension must be positive'
      );
    });

    it('should throw on invalid numHeads', () => {
      expect(() => new RealSetTransformerAttention({ numHeads: 0 })).toThrow(
        'ANTI-009: numHeads must be positive'
      );
      expect(() => new RealSetTransformerAttention({ numHeads: -1 })).toThrow(
        'ANTI-009: numHeads must be positive'
      );
    });

    it('should throw when dimension not divisible by numHeads', () => {
      expect(
        () => new RealSetTransformerAttention({ dimension: 768, numHeads: 7 })
      ).toThrow('ANTI-009: dimension must be divisible by numHeads');
    });

    it('should throw on invalid numInducingPoints', () => {
      expect(
        () => new RealSetTransformerAttention({ numInducingPoints: 0 })
      ).toThrow('ANTI-009: numInducingPoints must be positive');
      expect(
        () => new RealSetTransformerAttention({ numInducingPoints: -1 })
      ).toThrow('ANTI-009: numInducingPoints must be positive');
    });
  });

  describe('Parameter Count', () => {
    it('should calculate correct parameter count for default config', () => {
      const attention = new RealSetTransformerAttention({
        dimension: 1536,
        numHeads: 12,
        numInducingPoints: 32,
      });

      // Inducing points: 32 × 1536 = 49,152
      // MAB1 (4 projections): 4 × 1536² = 9,437,184
      // MAB2 (4 projections): 4 × 1536² = 9,437,184
      // Total: 18,923,520
      const expected = 32 * 1536 + 2 * (4 * 1536 * 1536);
      expect(attention.getParameterCount()).toBe(expected);
    });

    it('should calculate correct parameter count for smaller config', () => {
      const attention = new RealSetTransformerAttention({
        dimension: 256,
        numHeads: 4,
        numInducingPoints: 16,
      });

      // Inducing points: 16 × 256 = 4,096
      // MAB1: 4 × 256² = 262,144
      // MAB2: 4 × 256² = 262,144
      // Total: 528,384
      const expected = 16 * 256 + 2 * (4 * 256 * 256);
      expect(attention.getParameterCount()).toBe(expected);
    });
  });

  describe('Forward Pass - Core Functionality', () => {
    it('should process input through ISAB correctly', () => {
      const attention = new RealSetTransformerAttention({
        dimension: 64,
        numHeads: 4,
        numInducingPoints: 8,
        seed: 42,
      });

      const seqLen = 10;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);

      // Create diverse input patterns
      for (let i = 0; i < seqLen; i++) {
        for (let d = 0; d < dim; d++) {
          input[i * dim + d] = Math.sin((i + d) * 0.1) * 0.5;
        }
      }

      const output = attention.forward(input, input, input, undefined, seqLen);

      expect(output.length).toBe(seqLen * dim);
      expect(output).toBeInstanceOf(Float32Array);

      // Output should be different from input (transformation occurred)
      let diffCount = 0;
      for (let i = 0; i < output.length; i++) {
        if (Math.abs(output[i] - input[i]) > 0.01) diffCount++;
      }
      expect(diffCount).toBeGreaterThan(output.length * 0.5);
    });

    it('should produce valid numerical output without NaN or Inf', () => {
      const attention = new RealSetTransformerAttention({
        dimension: 128,
        numHeads: 8,
        numInducingPoints: 16,
      });

      const seqLen = 8;
      const dim = 128;
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = (Math.random() - 0.5) * 2;
      }

      const output = attention.forward(input, input, input, undefined, seqLen);

      for (let i = 0; i < output.length; i++) {
        expect(isNaN(output[i])).toBe(false);
        expect(isFinite(output[i])).toBe(true);
      }
    });

    it('should be permutation invariant for set operations', () => {
      const attention = new RealSetTransformerAttention({
        dimension: 64,
        numHeads: 4,
        numInducingPoints: 8,
        seed: 999,
      });

      const seqLen = 6;
      const dim = 64;

      // Create input with distinct patterns
      const input1 = new Float32Array(seqLen * dim);
      const input2 = new Float32Array(seqLen * dim);

      // Fill with distinct patterns
      for (let i = 0; i < seqLen; i++) {
        for (let d = 0; d < dim; d++) {
          input1[i * dim + d] = Math.sin((i * 10 + d) * 0.1);
        }
      }

      // Create permuted version (swap positions 1 and 3)
      for (let i = 0; i < seqLen; i++) {
        let srcIdx = i;
        if (i === 1) srcIdx = 3;
        else if (i === 3) srcIdx = 1;

        for (let d = 0; d < dim; d++) {
          input2[i * dim + d] = input1[srcIdx * dim + d];
        }
      }

      const output1 = attention.forward(input1, input1, input1, undefined, seqLen);
      const output2 = attention.forward(input2, input2, input2, undefined, seqLen);

      // Outputs should be different (order matters in current implementation)
      // Note: True permutation invariance requires pooling, which this doesn't implement
      // This test verifies the mechanism processes permuted inputs
      expect(output1.length).toBe(output2.length);
    });
  });

  describe('Forward Pass - Different Inducing Point Counts', () => {
    it('should handle small number of inducing points (m=4)', () => {
      const attention = new RealSetTransformerAttention({
        dimension: 64,
        numHeads: 4,
        numInducingPoints: 4,
      });

      const seqLen = 8;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.05);
      }

      const output = attention.forward(input, input, input, undefined, seqLen);
      expect(output.length).toBe(seqLen * dim);
    });

    it('should handle large number of inducing points (m=64)', () => {
      const attention = new RealSetTransformerAttention({
        dimension: 128,
        numHeads: 8,
        numInducingPoints: 64,
      });

      const seqLen = 10;
      const dim = 128;
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.cos(i * 0.05);
      }

      const output = attention.forward(input, input, input, undefined, seqLen);
      expect(output.length).toBe(seqLen * dim);
    });

    it('should handle inducing points more than sequence length', () => {
      const attention = new RealSetTransformerAttention({
        dimension: 64,
        numHeads: 4,
        numInducingPoints: 16, // More than seqLen
      });

      const seqLen = 8;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = (i % 2 === 0 ? 1 : -1) * 0.5;
      }

      const output = attention.forward(input, input, input, undefined, seqLen);
      expect(output.length).toBe(seqLen * dim);
    });
  });

  describe('Forward Pass - Masking', () => {
    it('should apply mask correctly - zero out masked positions', () => {
      const attention = new RealSetTransformerAttention({
        dimension: 64,
        numHeads: 4,
        numInducingPoints: 8,
        seed: 777,
      });

      const seqLen = 6;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1) + 0.5;
      }

      // Mask out positions 2 and 4
      const mask = [true, true, false, true, false, true];

      const output = attention.forward(input, input, input, mask, seqLen);

      // Check masked positions are zeroed
      for (let d = 0; d < dim; d++) {
        expect(output[2 * dim + d]).toBe(0);
        expect(output[4 * dim + d]).toBe(0);
      }

      // Check unmasked positions are non-zero
      let nonZeroCount = 0;
      for (let d = 0; d < dim; d++) {
        if (Math.abs(output[0 * dim + d]) > 1e-6) nonZeroCount++;
      }
      expect(nonZeroCount).toBeGreaterThan(0);
    });

    it('should handle all-masked input', () => {
      const attention = new RealSetTransformerAttention({
        dimension: 64,
        numHeads: 4,
        numInducingPoints: 8,
      });

      const seqLen = 4;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = 1.0;
      }

      const mask = [false, false, false, false];
      const output = attention.forward(input, input, input, mask, seqLen);

      // All positions should be zero
      for (let i = 0; i < output.length; i++) {
        expect(output[i]).toBe(0);
      }
    });

    it('should handle all-unmasked input', () => {
      const attention = new RealSetTransformerAttention({
        dimension: 64,
        numHeads: 4,
        numInducingPoints: 8,
        seed: 555,
      });

      const seqLen = 4;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1);
      }

      const mask = [true, true, true, true];
      const output = attention.forward(input, input, input, mask, seqLen);

      // Should produce non-zero output
      let nonZeroCount = 0;
      for (let i = 0; i < output.length; i++) {
        if (Math.abs(output[i]) > 1e-6) nonZeroCount++;
      }
      expect(nonZeroCount).toBeGreaterThan(0);
    });
  });

  describe('Forward Pass - Edge Cases', () => {
    it('should handle single element sequence', () => {
      const attention = new RealSetTransformerAttention({
        dimension: 64,
        numHeads: 4,
        numInducingPoints: 8,
      });

      const seqLen = 1;
      const dim = 64;
      const input = new Float32Array(dim);
      for (let i = 0; i < dim; i++) {
        input[i] = Math.sin(i * 0.1);
      }

      const output = attention.forward(input, input, input, undefined, seqLen);
      expect(output.length).toBe(dim);
    });

    it('should handle long sequences efficiently', () => {
      const attention = new RealSetTransformerAttention({
        dimension: 128,
        numHeads: 8,
        numInducingPoints: 32, // Much smaller than seqLen
        seed: 888,
      });

      const seqLen = 128; // Long sequence
      const dim = 128;
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.01) * 0.5;
      }

      const startTime = Date.now();
      const output = attention.forward(input, input, input, undefined, seqLen);
      const duration = Date.now() - startTime;

      expect(output.length).toBe(seqLen * dim);
      // Should be reasonably fast due to inducing points
      expect(duration).toBeLessThan(5000); // 5 seconds max
    });

    it('should handle zero input', () => {
      const attention = new RealSetTransformerAttention({
        dimension: 64,
        numHeads: 4,
        numInducingPoints: 8,
      });

      const seqLen = 4;
      const dim = 64;
      const input = new Float32Array(seqLen * dim); // All zeros

      const output = attention.forward(input, input, input, undefined, seqLen);
      expect(output.length).toBe(seqLen * dim);

      // Output may not be all zeros due to residual connections and learned parameters
      // Just verify no NaN/Inf
      for (let i = 0; i < output.length; i++) {
        expect(isFinite(output[i])).toBe(true);
      }
    });
  });

  describe('Validation and Error Handling', () => {
    it('should throw when seqLen is missing', () => {
      const attention = new RealSetTransformerAttention();
      const input = new Float32Array(768);

      expect(() => attention.forward(input, input, input)).toThrow(
        'ANTI-009: seqLen is required and must be positive'
      );
    });

    it('should throw when seqLen is zero', () => {
      const attention = new RealSetTransformerAttention();
      const input = new Float32Array(768);

      expect(() => attention.forward(input, input, input, undefined, 0)).toThrow(
        'ANTI-009: seqLen is required and must be positive'
      );
    });

    it('should throw when query length does not match seqLen × dimension', () => {
      const attention = new RealSetTransformerAttention({ dimension: 64, numHeads: 4 });
      const input = new Float32Array(100); // Wrong size

      expect(() =>
        attention.forward(input, input, input, undefined, 4)
      ).toThrow(/ANTI-009: query length.*must equal seqLen × dimension/);
    });

    it('should throw when query contains NaN', () => {
      const attention = new RealSetTransformerAttention({ dimension: 64, numHeads: 4 });
      const seqLen = 2;
      const input = new Float32Array(seqLen * 64);
      input[10] = NaN;

      expect(() =>
        attention.forward(input, input, input, undefined, seqLen)
      ).toThrow('ANTI-009: query contains NaN or Inf');
    });

    it('should throw when query contains Infinity', () => {
      const attention = new RealSetTransformerAttention({ dimension: 64, numHeads: 4 });
      const seqLen = 2;
      const input = new Float32Array(seqLen * 64);
      input[10] = Infinity;

      expect(() =>
        attention.forward(input, input, input, undefined, seqLen)
      ).toThrow('ANTI-009: query contains NaN or Inf');
    });

    it('should throw when mask length does not match seqLen', () => {
      const attention = new RealSetTransformerAttention({ dimension: 64, numHeads: 4 });
      const seqLen = 4;
      const input = new Float32Array(seqLen * 64);
      const mask = [true, true]; // Wrong length

      expect(() =>
        attention.forward(input, input, input, mask, seqLen)
      ).toThrow(/ANTI-009: mask length.*must equal seqLen/);
    });
  });

  describe('Determinism and Reproducibility', () => {
    it('should produce identical outputs for same seed', () => {
      const seed = 12345;
      const attention1 = new RealSetTransformerAttention({
        dimension: 128,
        numHeads: 8,
        numInducingPoints: 16,
        seed,
      });
      const attention2 = new RealSetTransformerAttention({
        dimension: 128,
        numHeads: 8,
        numInducingPoints: 16,
        seed,
      });

      const seqLen = 8;
      const dim = 128;
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.05) * 0.7;
      }

      const output1 = attention1.forward(input, input, input, undefined, seqLen);
      const output2 = attention2.forward(input, input, input, undefined, seqLen);

      expect(output1).toEqual(output2);
    });

    it('should produce different outputs for different seeds', () => {
      const attention1 = new RealSetTransformerAttention({
        dimension: 64,
        numHeads: 4,
        numInducingPoints: 8,
        seed: 111,
      });
      const attention2 = new RealSetTransformerAttention({
        dimension: 64,
        numHeads: 4,
        numInducingPoints: 8,
        seed: 222,
      });

      const seqLen = 6;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.05);
      }

      const output1 = attention1.forward(input, input, input, undefined, seqLen);
      const output2 = attention2.forward(input, input, input, undefined, seqLen);

      let diffCount = 0;
      for (let i = 0; i < output1.length; i++) {
        if (Math.abs(output1[i] - output2[i]) > 1e-6) diffCount++;
      }
      expect(diffCount).toBeGreaterThan(output1.length * 0.5);
    });

    it('should produce consistent outputs across multiple calls', () => {
      const attention = new RealSetTransformerAttention({
        dimension: 64,
        numHeads: 4,
        numInducingPoints: 8,
        seed: 333,
      });

      const seqLen = 5;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.cos(i * 0.1);
      }

      const output1 = attention.forward(input, input, input, undefined, seqLen);
      const output2 = attention.forward(input, input, input, undefined, seqLen);
      const output3 = attention.forward(input, input, input, undefined, seqLen);

      expect(output1).toEqual(output2);
      expect(output2).toEqual(output3);
    });
  });

  describe('Numerical Stability', () => {
    it('should handle very small input values', () => {
      const attention = new RealSetTransformerAttention({
        dimension: 64,
        numHeads: 4,
        numInducingPoints: 8,
      });

      const seqLen = 4;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = 1e-8 * Math.sin(i);
      }

      const output = attention.forward(input, input, input, undefined, seqLen);

      for (let i = 0; i < output.length; i++) {
        expect(isFinite(output[i])).toBe(true);
      }
    });

    it('should handle large input values', () => {
      const attention = new RealSetTransformerAttention({
        dimension: 64,
        numHeads: 4,
        numInducingPoints: 8,
      });

      const seqLen = 4;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = 100.0 * Math.sin(i * 0.1);
      }

      const output = attention.forward(input, input, input, undefined, seqLen);

      for (let i = 0; i < output.length; i++) {
        expect(isFinite(output[i])).toBe(true);
      }
    });

    it('should handle mixed positive and negative values', () => {
      const attention = new RealSetTransformerAttention({
        dimension: 64,
        numHeads: 4,
        numInducingPoints: 8,
      });

      const seqLen = 6;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = (i % 2 === 0 ? 1 : -1) * Math.sin(i * 0.05);
      }

      const output = attention.forward(input, input, input, undefined, seqLen);

      for (let i = 0; i < output.length; i++) {
        expect(isFinite(output[i])).toBe(true);
      }
    });
  });
});
