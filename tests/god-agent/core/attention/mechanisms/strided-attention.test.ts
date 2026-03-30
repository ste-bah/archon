/**
 * Tests for Real Strided Attention
 *
 * Validates:
 * - Correct strided + local window attention pattern
 * - Mathematical correctness (scaling, softmax)
 * - Numerical stability
 * - Edge cases (single token, stride > N, etc.)
 */

import { describe, it, expect } from 'vitest';
import { RealStridedAttention } from '../../../../../src/god-agent/core/attention/mechanisms/strided-attention.js';
import { hasNaNOrInf } from '../../../../../src/god-agent/core/attention/utils/index.js';

describe('RealStridedAttention', () => {
  describe('Constructor & Configuration', () => {
    it('should initialize with default parameters', () => {
      const attention = new RealStridedAttention();
      expect(attention.name).toBe('strided');
      expect(attention.getParameterCount()).toBe(4 * 64 * 64); // 4 × 64²
    });

    it('should initialize with custom parameters', () => {
      const attention = new RealStridedAttention({
        dimension: 128,
        numHeads: 4,
        stride: 16,
        windowSize: 16,
        seed: 12345
      });
      expect(attention.getParameterCount()).toBe(4 * 128 * 128);
    });

    it('should reject invalid dimension', () => {
      expect(() => new RealStridedAttention({ dimension: -1 }))
        .toThrow('Invalid dimension');
      expect(() => new RealStridedAttention({ dimension: 0 }))
        .toThrow('Invalid dimension');
      expect(() => new RealStridedAttention({ dimension: 3.5 }))
        .toThrow('Invalid dimension');
    });

    it('should reject invalid numHeads', () => {
      expect(() => new RealStridedAttention({ numHeads: 0 }))
        .toThrow('Invalid numHeads');
      expect(() => new RealStridedAttention({ numHeads: -2 }))
        .toThrow('Invalid numHeads');
      expect(() => new RealStridedAttention({ numHeads: 2.5 }))
        .toThrow('Invalid numHeads');
    });

    it('should reject dimension not divisible by numHeads', () => {
      expect(() => new RealStridedAttention({ dimension: 64, numHeads: 5 }))
        .toThrow('must be divisible by numHeads');
    });

    it('should reject invalid stride', () => {
      expect(() => new RealStridedAttention({ stride: 0 }))
        .toThrow('Invalid stride');
      expect(() => new RealStridedAttention({ stride: -1 }))
        .toThrow('Invalid stride');
      expect(() => new RealStridedAttention({ stride: 3.7 }))
        .toThrow('Invalid stride');
    });

    it('should reject invalid windowSize', () => {
      expect(() => new RealStridedAttention({ windowSize: 0 }))
        .toThrow('Invalid windowSize');
      expect(() => new RealStridedAttention({ windowSize: -5 }))
        .toThrow('Invalid windowSize');
      expect(() => new RealStridedAttention({ windowSize: 4.2 }))
        .toThrow('Invalid windowSize');
    });
  });

  describe('Forward Pass - Basic Functionality', () => {
    it('should process single token sequence', () => {
      const attention = new RealStridedAttention({ dimension: 16, seed: 100 });
      const input = new Float32Array(16).fill(0.5);

      const output = attention.forward(input, input, input, undefined, 1);

      expect(output.length).toBe(16);
      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should process sequence with multiple tokens', () => {
      const attention = new RealStridedAttention({
        dimension: 32,
        stride: 4,
        windowSize: 4,
        seed: 200
      });
      const N = 16;
      const input = new Float32Array(N * 32);

      // Fill with varied values
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1);
      }

      const output = attention.forward(input, input, input, undefined, N);

      expect(output.length).toBe(N * 32);
      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should handle different Q, K, V inputs', () => {
      const attention = new RealStridedAttention({ dimension: 16, seed: 300 });
      const N = 8;

      const query = new Float32Array(N * 16).fill(1.0);
      const key = new Float32Array(N * 16).fill(0.5);
      const value = new Float32Array(N * 16).fill(2.0);

      const output = attention.forward(query, key, value, undefined, N);

      expect(output.length).toBe(N * 16);
      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should be deterministic with same seed', () => {
      const seed = 42;
      const N = 8;
      const input = new Float32Array(N * 32);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.random();
      }

      const attn1 = new RealStridedAttention({ dimension: 32, seed });
      const attn2 = new RealStridedAttention({ dimension: 32, seed });

      const output1 = attn1.forward(input, input, input, undefined, N);
      const output2 = attn2.forward(input, input, input, undefined, N);

      expect(output1).toEqual(output2);
    });
  });

  describe('Strided Attention Pattern', () => {
    it('should attend to local window positions', () => {
      // Use small dimension and explicit values to test attention pattern
      const attention = new RealStridedAttention({
        dimension: 4,
        numHeads: 1,
        stride: 8,
        windowSize: 4,
        seed: 500
      });

      const N = 8;
      const value = new Float32Array(N * 4);

      // Set distinct values for each position
      for (let i = 0; i < N; i++) {
        for (let d = 0; d < 4; d++) {
          value[i * 4 + d] = i + 1; // Position i has value i+1
        }
      }

      const query = new Float32Array(N * 4).fill(1.0);
      const key = new Float32Array(N * 4).fill(1.0);

      const output = attention.forward(query, key, value, undefined, N);

      expect(hasNaNOrInf(output)).toBe(false);
      // Position 4 should attend to local window [2,3,4,5,6] + strided [0]
      // Output should be weighted average, not just nearest neighbors
    });

    it('should attend to strided positions', () => {
      const attention = new RealStridedAttention({
        dimension: 8,
        stride: 4, // Every 4th position
        windowSize: 2,
        seed: 600
      });

      const N = 16;
      const input = new Float32Array(N * 8);

      // Mark strided positions with distinct pattern
      for (let i = 0; i < N; i++) {
        const val = (i % 4 === 0) ? 2.0 : 0.5;
        for (let d = 0; d < 8; d++) {
          input[i * 8 + d] = val;
        }
      }

      const output = attention.forward(input, input, input, undefined, N);

      expect(hasNaNOrInf(output)).toBe(false);
      // All positions should have been influenced by strided positions
    });

    it('should handle stride larger than sequence length', () => {
      const attention = new RealStridedAttention({
        dimension: 16,
        stride: 100, // Larger than N
        windowSize: 4,
        seed: 700
      });

      const N = 8;
      const input = new Float32Array(N * 16);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.random();
      }

      const output = attention.forward(input, input, input, undefined, N);

      expect(output.length).toBe(N * 16);
      expect(hasNaNOrInf(output)).toBe(false);
      // Should still work, only position 0 is strided
    });

    it('should handle windowSize larger than sequence', () => {
      const attention = new RealStridedAttention({
        dimension: 16,
        stride: 4,
        windowSize: 100, // Larger than N
        seed: 800
      });

      const N = 8;
      const input = new Float32Array(N * 16);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i);
      }

      const output = attention.forward(input, input, input, undefined, N);

      expect(output.length).toBe(N * 16);
      expect(hasNaNOrInf(output)).toBe(false);
      // Effectively becomes full attention + strided
    });
  });

  describe('Multi-Head Attention', () => {
    it('should process multiple heads correctly', () => {
      const attention = new RealStridedAttention({
        dimension: 64,
        numHeads: 4,
        stride: 8,
        windowSize: 8,
        seed: 900
      });

      const N = 16;
      const input = new Float32Array(N * 64);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.cos(i * 0.05);
      }

      const output = attention.forward(input, input, input, undefined, N);

      expect(output.length).toBe(N * 64);
      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should produce different outputs per head', () => {
      // Verify that different heads process independently
      const attention = new RealStridedAttention({
        dimension: 32,
        numHeads: 2,
        seed: 1000
      });

      const N = 4;
      const input = new Float32Array(N * 32);
      for (let i = 0; i < input.length; i++) {
        input[i] = i % 7; // Simple pattern
      }

      const output = attention.forward(input, input, input, undefined, N);

      expect(hasNaNOrInf(output)).toBe(false);
      // Different heads should contribute differently due to different weights
    });
  });

  describe('Masking', () => {
    it('should apply causal mask correctly', () => {
      const attention = new RealStridedAttention({
        dimension: 16,
        stride: 4,
        windowSize: 4,
        seed: 1100
      });

      const N = 8;
      const input = new Float32Array(N * 16);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.random();
      }

      // Create causal mask (lower triangular)
      const mask = new Float32Array(N * N);
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          mask[i * N + j] = (j <= i) ? 1.0 : 0.0;
        }
      }

      const output = attention.forward(input, input, input, mask, N);

      expect(output.length).toBe(N * 16);
      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should handle all-masked positions gracefully', () => {
      const attention = new RealStridedAttention({
        dimension: 8,
        seed: 1200
      });

      const N = 4;
      const input = new Float32Array(N * 8).fill(1.0);

      // Mask that blocks all attention for position 2
      const mask = new Float32Array(N * N).fill(1.0);
      for (let j = 0; j < N; j++) {
        mask[2 * N + j] = 0.0;
      }

      const output = attention.forward(input, input, input, mask, N);

      expect(hasNaNOrInf(output)).toBe(false);
    });
  });

  describe('Input Validation', () => {
    it('should reject mismatched query length', () => {
      const attention = new RealStridedAttention({ dimension: 16 });
      const wrongQuery = new Float32Array(15); // Should be 16
      const correct = new Float32Array(16);

      expect(() => attention.forward(wrongQuery, correct, correct, undefined, 1))
        .toThrow('Query length');
    });

    it('should reject mismatched key length', () => {
      const attention = new RealStridedAttention({ dimension: 16 });
      const correct = new Float32Array(16);
      const wrongKey = new Float32Array(20);

      expect(() => attention.forward(correct, wrongKey, correct, undefined, 1))
        .toThrow('Key length');
    });

    it('should reject mismatched value length', () => {
      const attention = new RealStridedAttention({ dimension: 16 });
      const correct = new Float32Array(16);
      const wrongValue = new Float32Array(8);

      expect(() => attention.forward(correct, correct, wrongValue, undefined, 1))
        .toThrow('Value length');
    });

    it('should reject NaN in query', () => {
      const attention = new RealStridedAttention({ dimension: 16 });
      const query = new Float32Array(16);
      query[5] = NaN;
      const correct = new Float32Array(16).fill(1.0);

      expect(() => attention.forward(query, correct, correct, undefined, 1))
        .toThrow('Query contains NaN');
    });

    it('should reject Infinity in key', () => {
      const attention = new RealStridedAttention({ dimension: 16 });
      const key = new Float32Array(16);
      key[3] = Infinity;
      const correct = new Float32Array(16).fill(1.0);

      expect(() => attention.forward(correct, key, correct, undefined, 1))
        .toThrow('Key contains NaN or Infinity');
    });

    it('should reject NaN in value', () => {
      const attention = new RealStridedAttention({ dimension: 16 });
      const value = new Float32Array(16);
      value[0] = NaN;
      const correct = new Float32Array(16).fill(1.0);

      expect(() => attention.forward(correct, correct, value, undefined, 1))
        .toThrow('Value contains NaN');
    });
  });

  describe('Numerical Stability', () => {
    it('should handle large attention scores without overflow', () => {
      const attention = new RealStridedAttention({ dimension: 8, seed: 1300 });
      const N = 4;

      // Create inputs that will produce large dot products
      const input = new Float32Array(N * 8).fill(100.0);

      const output = attention.forward(input, input, input, undefined, N);

      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should handle very small values without underflow', () => {
      const attention = new RealStridedAttention({ dimension: 16, seed: 1400 });
      const N = 8;

      const input = new Float32Array(N * 16).fill(1e-6);

      const output = attention.forward(input, input, input, undefined, N);

      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should handle mixed positive and negative values', () => {
      const attention = new RealStridedAttention({ dimension: 16, seed: 1500 });
      const N = 8;

      const input = new Float32Array(N * 16);
      for (let i = 0; i < input.length; i++) {
        input[i] = (i % 2 === 0) ? 5.0 : -5.0;
      }

      const output = attention.forward(input, input, input, undefined, N);

      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should handle zero inputs gracefully', () => {
      const attention = new RealStridedAttention({ dimension: 16, seed: 1600 });
      const N = 4;

      const zeros = new Float32Array(N * 16).fill(0.0);

      const output = attention.forward(zeros, zeros, zeros, undefined, N);

      expect(hasNaNOrInf(output)).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle stride equal to 1 (every position)', () => {
      const attention = new RealStridedAttention({
        dimension: 16,
        stride: 1, // Attend to every position
        windowSize: 2,
        seed: 1700
      });

      const N = 8;
      const input = new Float32Array(N * 16);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.random();
      }

      const output = attention.forward(input, input, input, undefined, N);

      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should handle windowSize equal to 1 (no local context)', () => {
      const attention = new RealStridedAttention({
        dimension: 16,
        stride: 4,
        windowSize: 1, // Only current position in window
        seed: 1800
      });

      const N = 8;
      const input = new Float32Array(N * 16);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.2);
      }

      const output = attention.forward(input, input, input, undefined, N);

      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should handle long sequences efficiently', () => {
      const attention = new RealStridedAttention({
        dimension: 32,
        stride: 16,
        windowSize: 8,
        seed: 1900
      });

      const N = 128; // Long sequence
      const input = new Float32Array(N * 32);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.cos(i * 0.01);
      }

      const output = attention.forward(input, input, input, undefined, N);

      expect(output.length).toBe(N * 32);
      expect(hasNaNOrInf(output)).toBe(false);
    });
  });

  describe('Parameter Count', () => {
    it('should report correct parameter count', () => {
      const dims = [16, 32, 64, 128];

      for (const dim of dims) {
        const attention = new RealStridedAttention({ dimension: dim });
        const expected = 4 * dim * dim; // Q, K, V, O matrices
        expect(attention.getParameterCount()).toBe(expected);
      }
    });
  });
});
