/**
 * RealCausalAttention Tests - ANTI-009 Fix
 *
 * Tests verify:
 * 1. Output differs from placeholder (0.5*q + 0.5*v)
 * 2. Causal mask behavior (position i attends only to 0..i)
 * 3. Determinism with seed
 * 4. Error handling
 */

import { describe, it, expect } from 'vitest';
import { RealCausalAttention } from '../../../../../src/god-agent/core/attention/mechanisms/causal-attention.js';

describe('RealCausalAttention - ANTI-009 Fix', () => {

  describe('Core Functionality', () => {
    it('should compute actual attention (not 0.5*q + 0.5*v)', () => {
      const attention = new RealCausalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const query = new Float32Array(64).fill(1);
      const key = new Float32Array(64).fill(0.5);
      const value = new Float32Array(64).fill(2);

      const output = attention.forward(query, key, value);

      // Output should NOT be 0.5*query + 0.5*value = 1.5
      const placeholderOutput = 0.5 * 1 + 0.5 * 2;

      let diffFromPlaceholder = 0;
      for (let i = 0; i < output.length; i++) {
        diffFromPlaceholder += Math.abs(output[i] - placeholderOutput);
      }

      expect(diffFromPlaceholder / output.length).toBeGreaterThan(0.01);
    });

    it('should use key parameter (not ignore it)', () => {
      const attention = new RealCausalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const seqLen = 4;
      const query = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      for (let i = 0; i < seqLen * 64; i++) {
        query[i] = Math.sin(i * 0.1);
        value[i] = Math.cos(i * 0.1);
      }

      const key1 = new Float32Array(seqLen * 64);
      for (let i = 0; i < seqLen * 64; i++) {
        key1[i] = i < 64 ? 2 : 0.1;
      }

      const key2 = new Float32Array(seqLen * 64);
      for (let i = 0; i < seqLen * 64; i++) {
        key2[i] = (i >= 64 && i < 128) ? 2 : 0.1;
      }

      const output1 = attention.forward(query, key1, value, undefined, seqLen);
      const output2 = attention.forward(query, key2, value, undefined, seqLen);

      let diff = 0;
      for (let i = 0; i < output1.length; i++) {
        diff += Math.abs(output1[i] - output2[i]);
      }

      expect(diff).toBeGreaterThan(0);
    });

    it('should produce correct output dimensions', () => {
      const attention = new RealCausalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const query1 = new Float32Array(64).fill(1);
      const output1 = attention.forward(query1, query1, query1);
      expect(output1.length).toBe(64);

      const seqLen = 8;
      const query8 = new Float32Array(seqLen * 64).fill(1);
      const output8 = attention.forward(query8, query8, query8, undefined, seqLen);
      expect(output8.length).toBe(seqLen * 64);
    });
  });

  describe('Causal Mask Properties', () => {
    it('should implement causal masking (position i attends to 0..i only)', () => {
      const attention = new RealCausalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const seqLen = 4;
      const query = new Float32Array(seqLen * 64);
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      // Create distinct values at each position
      for (let t = 0; t < seqLen; t++) {
        for (let d = 0; d < 64; d++) {
          query[t * 64 + d] = 1.0;  // Uniform query
          key[t * 64 + d] = 1.0;    // Uniform key
          value[t * 64 + d] = t + 1;  // Values: 1, 2, 3, 4 at each position
        }
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      // Position 0: can only attend to position 0 -> should be influenced only by value 1
      // Position 3: can attend to positions 0,1,2,3 -> should be influenced by values 1,2,3,4

      // Extract outputs for position 0 and position 3
      const output0 = new Float32Array(64);
      const output3 = new Float32Array(64);
      for (let d = 0; d < 64; d++) {
        output0[d] = output[0 * 64 + d];
        output3[d] = output[3 * 64 + d];
      }

      // These should differ because position 3 has access to more context
      let diff = 0;
      for (let d = 0; d < 64; d++) {
        diff += Math.abs(output0[d] - output3[d]);
      }

      expect(diff).toBeGreaterThan(0);
    });

    it('should ensure position 0 output depends only on position 0 input', () => {
      const attention = new RealCausalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const seqLen = 4;

      // Create two sequences with different future values but same position 0
      const query1 = new Float32Array(seqLen * 64);
      const query2 = new Float32Array(seqLen * 64);

      // Position 0: identical
      for (let d = 0; d < 64; d++) {
        query1[d] = Math.sin(d * 0.1);
        query2[d] = Math.sin(d * 0.1);
      }

      // Positions 1-3: different
      for (let t = 1; t < seqLen; t++) {
        for (let d = 0; d < 64; d++) {
          query1[t * 64 + d] = 0.1;  // Small values
          query2[t * 64 + d] = 10.0;  // Large values
        }
      }

      const output1 = attention.forward(query1, query1, query1, undefined, seqLen);
      const output2 = attention.forward(query2, query2, query2, undefined, seqLen);

      // Position 0 output should be IDENTICAL because causal mask blocks future positions
      const pos0_diff = [];
      for (let d = 0; d < 64; d++) {
        pos0_diff.push(Math.abs(output1[d] - output2[d]));
      }

      const totalDiff = pos0_diff.reduce((a, b) => a + b, 0);
      expect(totalDiff).toBeLessThan(1e-5);  // Should be essentially zero
    });

    it('should handle autoregressive generation pattern', () => {
      const attention = new RealCausalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      // Simulate incremental generation: process longer sequences
      const query1 = new Float32Array(64);
      const query2 = new Float32Array(128);
      const query4 = new Float32Array(256);

      for (let i = 0; i < 64; i++) {
        query1[i] = Math.sin(i * 0.1);
        query2[i] = Math.sin(i * 0.1);
        query4[i] = Math.sin(i * 0.1);
      }
      for (let i = 64; i < 128; i++) {
        query2[i] = Math.cos(i * 0.1);
        query4[i] = Math.cos(i * 0.1);
      }
      for (let i = 128; i < 256; i++) {
        query4[i] = Math.tan(i * 0.02);
      }

      const output1 = attention.forward(query1, query1, query1, undefined, 1);
      const output2 = attention.forward(query2, query2, query2, undefined, 2);
      const output4 = attention.forward(query4, query4, query4, undefined, 4);

      // All outputs should be valid
      expect(output1.length).toBe(64);
      expect(output2.length).toBe(128);
      expect(output4.length).toBe(256);

      // All should produce finite values
      for (const output of [output1, output2, output4]) {
        for (let i = 0; i < output.length; i++) {
          expect(Number.isFinite(output[i])).toBe(true);
        }
      }
    });
  });

  describe('Lower Triangular Pattern', () => {
    it('should create lower-triangular attention pattern', () => {
      // This test verifies the causal mask by checking that
      // changing future values doesn't affect earlier outputs
      const attention = new RealCausalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const seqLen = 4;

      // Base values
      const baseValue = new Float32Array(seqLen * 64);
      for (let i = 0; i < baseValue.length; i++) {
        baseValue[i] = Math.sin(i * 0.1);
      }

      // Modified values: change only position 3
      const modifiedValue = new Float32Array(baseValue);
      for (let d = 0; d < 64; d++) {
        modifiedValue[3 * 64 + d] = 100;  // Very different value
      }

      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.cos(i * 0.1);
      }

      const output1 = attention.forward(query, query, baseValue, undefined, seqLen);
      const output2 = attention.forward(query, query, modifiedValue, undefined, seqLen);

      // Positions 0, 1, 2 should be IDENTICAL (can't see position 3)
      for (let t = 0; t < 3; t++) {
        for (let d = 0; d < 64; d++) {
          expect(Math.abs(output1[t * 64 + d] - output2[t * 64 + d])).toBeLessThan(1e-5);
        }
      }

      // Position 3 should be DIFFERENT (can see modified position 3)
      let diff3 = 0;
      for (let d = 0; d < 64; d++) {
        diff3 += Math.abs(output1[3 * 64 + d] - output2[3 * 64 + d]);
      }
      expect(diff3).toBeGreaterThan(0);
    });
  });

  describe('Validation', () => {
    it('should throw on invalid dimension/numHeads', () => {
      expect(() => new RealCausalAttention({ dimension: 65, numHeads: 8 }))
        .toThrow('ANTI-009');
    });

    it('should throw on dimension mismatch Q/K/V', () => {
      const attention = new RealCausalAttention({ dimension: 64, numHeads: 4 });

      const query = new Float32Array(64);
      const key = new Float32Array(128);
      const value = new Float32Array(64);

      expect(() => attention.forward(query, key, value)).toThrow('ANTI-009');
    });

    it('should throw on invalid seqLen', () => {
      const attention = new RealCausalAttention({ dimension: 64, numHeads: 4 });

      const query = new Float32Array(100);  // Not divisible by 64

      expect(() => attention.forward(query, query, query, undefined, 2)).toThrow('ANTI-009');
    });
  });

  describe('Parameter Count', () => {
    it('should return correct parameter count', () => {
      const attention = new RealCausalAttention({
        dimension: 64,
        numHeads: 4
      });

      // 4 projection matrices: 4 × 64 × 64 = 16384
      const expected = 4 * 64 * 64;
      expect(attention.getParameterCount()).toBe(expected);
    });
  });

  describe('Determinism', () => {
    it('should be deterministic with same seed', () => {
      const attention1 = new RealCausalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });
      const attention2 = new RealCausalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const seqLen = 4;
      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
      }

      const output1 = attention1.forward(query, query, query, undefined, seqLen);
      const output2 = attention2.forward(query, query, query, undefined, seqLen);

      for (let i = 0; i < output1.length; i++) {
        expect(output1[i]).toBe(output2[i]);
      }
    });

    it('should be non-deterministic with different seeds', () => {
      const attention1 = new RealCausalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });
      const attention2 = new RealCausalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 123
      });

      const seqLen = 4;
      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
      }

      const output1 = attention1.forward(query, query, query, undefined, seqLen);
      const output2 = attention2.forward(query, query, query, undefined, seqLen);

      let diff = 0;
      for (let i = 0; i < output1.length; i++) {
        diff += Math.abs(output1[i] - output2[i]);
      }

      expect(diff).toBeGreaterThan(0);
    });
  });

  describe('Numerical Stability', () => {
    it('should handle zero inputs', () => {
      const attention = new RealCausalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const query = new Float32Array(64).fill(0);

      const output = attention.forward(query, query, query);

      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });

    it('should handle large sequences', () => {
      const attention = new RealCausalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const seqLen = 32;  // Reasonable test size
      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.01);
      }

      const output = attention.forward(query, query, query, undefined, seqLen);

      expect(output.length).toBe(seqLen * 64);
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });
  });

  describe('Integration', () => {
    it('should have correct mechanism name', () => {
      const attention = new RealCausalAttention();
      expect(attention.name).toBe('causal');
    });

    it('should work with additional mask combined with causal', () => {
      const attention = new RealCausalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const seqLen = 4;
      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
      }

      // Mask out position 1
      const mask = [true, false, true, true];

      const outputWithMask = attention.forward(query, query, query, mask, seqLen);
      const outputNoMask = attention.forward(query, query, query, undefined, seqLen);

      // Outputs should differ because position 1 is masked
      let diff = 0;
      for (let i = 0; i < outputWithMask.length; i++) {
        diff += Math.abs(outputWithMask[i] - outputNoMask[i]);
      }

      expect(diff).toBeGreaterThan(0);
    });
  });
});
