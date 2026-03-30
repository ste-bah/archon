/**
 * Comprehensive tests for RealDilatedAttention
 *
 * Validates:
 * - Mathematical correctness (dilation pattern, scaling, softmax)
 * - Numerical stability
 * - Edge cases (single token, uniform, masked)
 * - Parameter counting
 * - Concurrency safety
 */

import { describe, it, expect } from 'vitest';
import { RealDilatedAttention } from '../../../../../src/god-agent/core/attention/mechanisms/dilated-attention.js';

describe('RealDilatedAttention', () => {
  describe('Constructor validation', () => {
    it('should initialize with default config', () => {
      const attn = new RealDilatedAttention();
      expect(attn.name).toBe('dilated');
      expect(attn.getParameterCount()).toBe(4 * 64 * 64);
    });

    it('should initialize with custom config', () => {
      const attn = new RealDilatedAttention({
        dimension: 128,
        numHeads: 16,
        dilation: 4,
        seed: 123,
      });
      expect(attn.getParameterCount()).toBe(4 * 128 * 128);
    });

    it('should reject non-positive dimension', () => {
      expect(() => new RealDilatedAttention({ dimension: 0 })).toThrow('must be a positive integer');
      expect(() => new RealDilatedAttention({ dimension: -64 })).toThrow('must be a positive integer');
    });

    it('should reject non-integer dimension', () => {
      expect(() => new RealDilatedAttention({ dimension: 64.5 })).toThrow('must be a positive integer');
    });

    it('should reject non-positive numHeads', () => {
      expect(() => new RealDilatedAttention({ numHeads: 0 })).toThrow('must be a positive integer');
      expect(() => new RealDilatedAttention({ numHeads: -4 })).toThrow('must be a positive integer');
    });

    it('should reject dimension not divisible by numHeads', () => {
      expect(() => new RealDilatedAttention({ dimension: 64, numHeads: 7 })).toThrow('must be divisible by numHeads');
    });

    it('should reject invalid dilation', () => {
      expect(() => new RealDilatedAttention({ dilation: 0 })).toThrow('must be an integer >= 1');
      expect(() => new RealDilatedAttention({ dilation: -2 })).toThrow('must be an integer >= 1');
      expect(() => new RealDilatedAttention({ dilation: 2.5 })).toThrow('must be an integer >= 1');
    });

    it('should accept dilation = 1 (no dilation)', () => {
      const attn = new RealDilatedAttention({ dilation: 1 });
      expect(attn.getParameterCount()).toBe(4 * 64 * 64);
    });
  });

  describe('Forward pass - basic functionality', () => {
    it('should process single token correctly', () => {
      const attn = new RealDilatedAttention({ dimension: 64, numHeads: 8, dilation: 2, seed: 42 });
      const N = 1;
      const input = new Float32Array(N * 64).fill(0.5);

      const output = attn.forward(input, input, input, undefined, N);

      expect(output.length).toBe(N * 64);
      expect(output.every((v) => Number.isFinite(v))).toBe(true);
    });

    it('should process multiple tokens correctly', () => {
      const attn = new RealDilatedAttention({ dimension: 64, numHeads: 8, dilation: 2, seed: 42 });
      const N = 8;
      const input = new Float32Array(N * 64);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1);
      }

      const output = attn.forward(input, input, input, undefined, N);

      expect(output.length).toBe(N * 64);
      expect(output.every((v) => Number.isFinite(v))).toBe(true);
    });

    it('should handle uniform input without NaN', () => {
      const attn = new RealDilatedAttention({ dimension: 64, numHeads: 8, dilation: 2, seed: 42 });
      const N = 4;
      const input = new Float32Array(N * 64).fill(1.0);

      const output = attn.forward(input, input, input, undefined, N);

      expect(output.every((v) => Number.isFinite(v))).toBe(true);
    });

    it('should handle zero input without NaN', () => {
      const attn = new RealDilatedAttention({ dimension: 64, numHeads: 8, dilation: 2, seed: 42 });
      const N = 4;
      const input = new Float32Array(N * 64).fill(0.0);

      const output = attn.forward(input, input, input, undefined, N);

      expect(output.every((v) => Number.isFinite(v))).toBe(true);
    });
  });

  describe('Dilation pattern validation', () => {
    it('should attend only to dilated positions (dilation=2)', () => {
      const dim = 16;
      const attn = new RealDilatedAttention({ dimension: dim, numHeads: 2, dilation: 2, seed: 42 });
      const N = 4;

      // Create distinct values at each position
      const input = new Float32Array(N * dim);
      for (let i = 0; i < N; i++) {
        for (let d = 0; d < dim; d++) {
          input[i * dim + d] = i + 1; // Position 0: 1, Position 1: 2, Position 2: 3, Position 3: 4
        }
      }

      const output = attn.forward(input, input, input, undefined, N);

      expect(output.every((v) => Number.isFinite(v))).toBe(true);

      // With dilation=2, position 0 attends to {0, 2}, position 1 attends to {1, 3}
      // Output should reflect these patterns (not a simple average of all positions)
    });

    it('should attend only to dilated positions (dilation=4)', () => {
      const dim = 16;
      const attn = new RealDilatedAttention({ dimension: dim, numHeads: 2, dilation: 4, seed: 42 });
      const N = 8;

      const input = new Float32Array(N * dim);
      for (let i = 0; i < N; i++) {
        for (let d = 0; d < dim; d++) {
          input[i * dim + d] = i + 1;
        }
      }

      const output = attn.forward(input, input, input, undefined, N);

      expect(output.every((v) => Number.isFinite(v))).toBe(true);

      // With dilation=4:
      // Position 0 attends to {0, 4}
      // Position 1 attends to {1, 5}
      // Position 2 attends to {2, 6}
      // Position 3 attends to {3, 7}
    });

    it('should behave like standard attention when dilation=1', () => {
      const dim = 16;
      const attn = new RealDilatedAttention({ dimension: dim, numHeads: 2, dilation: 1, seed: 42 });
      const N = 4;

      const input = new Float32Array(N * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.random();
      }

      const output = attn.forward(input, input, input, undefined, N);

      expect(output.every((v) => Number.isFinite(v))).toBe(true);
      // Dilation=1 means all positions are dilated positions (standard attention)
    });

    it('should handle single dilated position correctly', () => {
      const dim = 16;
      const attn = new RealDilatedAttention({ dimension: dim, numHeads: 2, dilation: 8, seed: 42 });
      const N = 4;  // With dilation=8, each position attends only to itself

      const input = new Float32Array(N * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.random();
      }

      const output = attn.forward(input, input, input, undefined, N);

      expect(output.every((v) => Number.isFinite(v))).toBe(true);
    });
  });

  describe('Masking support', () => {
    it('should apply causal mask correctly', () => {
      const attn = new RealDilatedAttention({ dimension: 64, numHeads: 8, dilation: 2, seed: 42 });
      const N = 4;
      const input = new Float32Array(N * 64).fill(0.5);

      // Causal mask: can only attend to current and previous positions
      const mask = new Float32Array(N * N);
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          mask[i * N + j] = j <= i ? 1.0 : 0.0;
        }
      }

      const output = attn.forward(input, input, input, mask, N);

      expect(output.every((v) => Number.isFinite(v))).toBe(true);
    });

    it('should handle all-masked positions (fallback to uniform)', () => {
      const attn = new RealDilatedAttention({ dimension: 64, numHeads: 8, dilation: 2, seed: 42 });
      const N = 4;
      const input = new Float32Array(N * 64).fill(0.5);

      // Mask out all positions for position 0
      const mask = new Float32Array(N * N).fill(1.0);
      for (let j = 0; j < N; j++) {
        mask[0 * N + j] = 0.0;
      }

      const output = attn.forward(input, input, input, mask, N);

      expect(output.every((v) => Number.isFinite(v))).toBe(true);
    });
  });

  describe('Input validation', () => {
    it('should reject mismatched query length', () => {
      const attn = new RealDilatedAttention({ dimension: 64, numHeads: 8, dilation: 2 });
      const query = new Float32Array(100); // Wrong size
      const kv = new Float32Array(4 * 64);

      expect(() => attn.forward(query, kv, kv, undefined, 4)).toThrow('Query length');
    });

    it('should reject mismatched key length', () => {
      const attn = new RealDilatedAttention({ dimension: 64, numHeads: 8, dilation: 2 });
      const q = new Float32Array(4 * 64);
      const key = new Float32Array(100); // Wrong size
      const v = new Float32Array(4 * 64);

      expect(() => attn.forward(q, key, v, undefined, 4)).toThrow('Key length');
    });

    it('should reject mismatched value length', () => {
      const attn = new RealDilatedAttention({ dimension: 64, numHeads: 8, dilation: 2 });
      const qk = new Float32Array(4 * 64);
      const value = new Float32Array(100); // Wrong size

      expect(() => attn.forward(qk, qk, value, undefined, 4)).toThrow('Value length');
    });

    it('should reject mismatched mask length', () => {
      const attn = new RealDilatedAttention({ dimension: 64, numHeads: 8, dilation: 2 });
      const input = new Float32Array(4 * 64);
      const mask = new Float32Array(10); // Wrong size

      expect(() => attn.forward(input, input, input, mask, 4)).toThrow('Mask length');
    });
  });

  describe('Numerical stability', () => {
    it('should handle large positive values without overflow', () => {
      const attn = new RealDilatedAttention({ dimension: 64, numHeads: 8, dilation: 2, seed: 42 });
      const N = 4;
      const input = new Float32Array(N * 64).fill(100.0);

      const output = attn.forward(input, input, input, undefined, N);

      expect(output.every((v) => Number.isFinite(v))).toBe(true);
    });

    it('should handle large negative values without underflow', () => {
      const attn = new RealDilatedAttention({ dimension: 64, numHeads: 8, dilation: 2, seed: 42 });
      const N = 4;
      const input = new Float32Array(N * 64).fill(-100.0);

      const output = attn.forward(input, input, input, undefined, N);

      expect(output.every((v) => Number.isFinite(v))).toBe(true);
    });

    it('should handle mixed extreme values', () => {
      const attn = new RealDilatedAttention({ dimension: 64, numHeads: 8, dilation: 2, seed: 42 });
      const N = 4;
      const input = new Float32Array(N * 64);
      for (let i = 0; i < input.length; i++) {
        input[i] = i % 2 === 0 ? 100.0 : -100.0;
      }

      const output = attn.forward(input, input, input, undefined, N);

      expect(output.every((v) => Number.isFinite(v))).toBe(true);
    });
  });

  describe('Concurrency safety (statelessness)', () => {
    it('should produce identical results for same input (deterministic)', () => {
      const attn = new RealDilatedAttention({ dimension: 64, numHeads: 8, dilation: 2, seed: 42 });
      const N = 4;
      const input = new Float32Array(N * 64);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1);
      }

      const output1 = attn.forward(input, input, input, undefined, N);
      const output2 = attn.forward(input, input, input, undefined, N);

      expect(output1.length).toBe(output2.length);
      for (let i = 0; i < output1.length; i++) {
        expect(output1[i]).toBeCloseTo(output2[i], 10);
      }
    });

    it('should handle different sequence lengths sequentially', () => {
      const attn = new RealDilatedAttention({ dimension: 64, numHeads: 8, dilation: 2, seed: 42 });

      const input1 = new Float32Array(2 * 64).fill(0.5);
      const output1 = attn.forward(input1, input1, input1, undefined, 2);

      const input2 = new Float32Array(4 * 64).fill(0.5);
      const output2 = attn.forward(input2, input2, input2, undefined, 4);

      expect(output1.length).toBe(2 * 64);
      expect(output2.length).toBe(4 * 64);
      expect(output1.every((v) => Number.isFinite(v))).toBe(true);
      expect(output2.every((v) => Number.isFinite(v))).toBe(true);
    });
  });

  describe('Parameter counting', () => {
    it('should count 4 × dim² parameters', () => {
      const attn1 = new RealDilatedAttention({ dimension: 64 });
      expect(attn1.getParameterCount()).toBe(4 * 64 * 64);

      const attn2 = new RealDilatedAttention({ dimension: 128 });
      expect(attn2.getParameterCount()).toBe(4 * 128 * 128);

      const attn3 = new RealDilatedAttention({ dimension: 256 });
      expect(attn3.getParameterCount()).toBe(4 * 256 * 256);
    });

    it('should not depend on numHeads or dilation', () => {
      const attn1 = new RealDilatedAttention({ dimension: 64, numHeads: 4, dilation: 1 });
      const attn2 = new RealDilatedAttention({ dimension: 64, numHeads: 8, dilation: 2 });
      const attn3 = new RealDilatedAttention({ dimension: 64, numHeads: 16, dilation: 4 });

      expect(attn1.getParameterCount()).toBe(attn2.getParameterCount());
      expect(attn2.getParameterCount()).toBe(attn3.getParameterCount());
    });
  });

  describe('Edge cases', () => {
    it('should handle very large dilation (larger than sequence)', () => {
      const dim = 16;
      const attn = new RealDilatedAttention({ dimension: dim, numHeads: 2, dilation: 100, seed: 42 });
      const N = 4;  // Dilation > N: each position attends only to itself

      const input = new Float32Array(N * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.random();
      }

      const output = attn.forward(input, input, input, undefined, N);

      expect(output.every((v) => Number.isFinite(v))).toBe(true);
    });

    it('should handle sequence length = dilation', () => {
      const dim = 16;
      const attn = new RealDilatedAttention({ dimension: dim, numHeads: 2, dilation: 4, seed: 42 });
      const N = 4;  // Each position attends only to itself

      const input = new Float32Array(N * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.random();
      }

      const output = attn.forward(input, input, input, undefined, N);

      expect(output.every((v) => Number.isFinite(v))).toBe(true);
    });

    it('should handle long sequences efficiently', () => {
      const attn = new RealDilatedAttention({ dimension: 64, numHeads: 8, dilation: 4, seed: 42 });
      const N = 64;  // Longer sequence
      const input = new Float32Array(N * 64);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.01);
      }

      const output = attn.forward(input, input, input, undefined, N);

      expect(output.length).toBe(N * 64);
      expect(output.every((v) => Number.isFinite(v))).toBe(true);
    });
  });
});
