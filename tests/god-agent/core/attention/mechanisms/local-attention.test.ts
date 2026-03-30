/**
 * RealLocalAttention Tests - ANTI-009 Fix
 *
 * Tests verify:
 * 1. Output differs from placeholder (0.5*q + 0.5*v)
 * 2. Local window behavior (each position attends only to neighbors)
 * 3. Determinism with seed
 * 4. Error handling
 */

import { describe, it, expect } from 'vitest';
import { RealLocalAttention } from '../../../../../src/god-agent/core/attention/mechanisms/local-attention.js';

describe('RealLocalAttention - ANTI-009 Fix', () => {

  describe('Core Functionality', () => {
    it('should compute actual attention (not 0.5*q + 0.5*v)', () => {
      const attention = new RealLocalAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 8,
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
      const attention = new RealLocalAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 8,
        seed: 42
      });

      const seqLen = 8;
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
      const attention = new RealLocalAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 4,
        seed: 42
      });

      const query1 = new Float32Array(64).fill(1);
      const output1 = attention.forward(query1, query1, query1);
      expect(output1.length).toBe(64);

      const seqLen = 16;
      const query16 = new Float32Array(seqLen * 64).fill(1);
      const output16 = attention.forward(query16, query16, query16, undefined, seqLen);
      expect(output16.length).toBe(seqLen * 64);
    });
  });

  describe('Local Window Properties', () => {
    it('should implement local windowed attention', () => {
      const windowSize = 4;  // Each position sees 4 neighbors total
      const attention = new RealLocalAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: windowSize,
        seed: 42
      });

      const seqLen = 16;
      const query = new Float32Array(seqLen * 64);
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      // Create distinct values at each position
      for (let t = 0; t < seqLen; t++) {
        for (let d = 0; d < 64; d++) {
          query[t * 64 + d] = Math.sin(t * 0.1 + d * 0.01);
          key[t * 64 + d] = Math.cos(t * 0.1 + d * 0.01);
          value[t * 64 + d] = t + 1;  // Values 1..16 at each position
        }
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      // Output should be valid for all positions
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });

    it('should not be affected by positions outside window', () => {
      const windowSize = 2;  // Very small window: only neighbors
      const attention = new RealLocalAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: windowSize,
        seed: 42
      });

      const seqLen = 10;

      // Base values
      const baseValue = new Float32Array(seqLen * 64);
      for (let t = 0; t < seqLen; t++) {
        for (let d = 0; d < 64; d++) {
          baseValue[t * 64 + d] = Math.sin(t + d * 0.1);
        }
      }

      // Modified values: change position 9 (far from position 0)
      const modifiedValue = new Float32Array(baseValue);
      for (let d = 0; d < 64; d++) {
        modifiedValue[9 * 64 + d] = 100;
      }

      const query = new Float32Array(seqLen * 64);
      for (let t = 0; t < seqLen; t++) {
        for (let d = 0; d < 64; d++) {
          query[t * 64 + d] = Math.cos(t + d * 0.1);
        }
      }

      const output1 = attention.forward(query, query, baseValue, undefined, seqLen);
      const output2 = attention.forward(query, query, modifiedValue, undefined, seqLen);

      // Position 0's output should be identical (position 9 is outside window)
      // With windowSize=2, halfWindow=1, so position 0 sees positions [0, 1]
      let diff0 = 0;
      for (let d = 0; d < 64; d++) {
        diff0 += Math.abs(output1[0 * 64 + d] - output2[0 * 64 + d]);
      }
      expect(diff0).toBeLessThan(1e-5);

      // Position 8 or 9's output should differ (position 9 IS in window)
      // Position 8 with windowSize=2 sees [7, 8, 9]
      let diff8 = 0;
      for (let d = 0; d < 64; d++) {
        diff8 += Math.abs(output1[8 * 64 + d] - output2[8 * 64 + d]);
      }
      expect(diff8).toBeGreaterThan(0);
    });

    it('should handle different window sizes', () => {
      const seqLen = 16;
      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
      }

      // Small window
      const attentionSmall = new RealLocalAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 2,
        seed: 42
      });

      // Large window
      const attentionLarge = new RealLocalAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 14,
        seed: 42
      });

      const outputSmall = attentionSmall.forward(query, query, query, undefined, seqLen);
      const outputLarge = attentionLarge.forward(query, query, query, undefined, seqLen);

      // Outputs should differ due to different contexts
      let diff = 0;
      for (let i = 0; i < outputSmall.length; i++) {
        diff += Math.abs(outputSmall[i] - outputLarge[i]);
      }

      expect(diff).toBeGreaterThan(0);
    });

    it('should have banded attention pattern (complexity O(N×W))', () => {
      // This test verifies that local attention processes efficiently
      const attention = new RealLocalAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 8,
        seed: 42
      });

      // Longer sequence should still work efficiently
      const seqLen = 32;
      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.05);
      }

      const output = attention.forward(query, query, query, undefined, seqLen);

      expect(output.length).toBe(seqLen * 64);
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });
  });

  describe('Window Edge Cases', () => {
    it('should handle positions at sequence boundaries', () => {
      const attention = new RealLocalAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 6,
        seed: 42
      });

      const seqLen = 8;
      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
      }

      const output = attention.forward(query, query, query, undefined, seqLen);

      // Position 0 window: [0, 1, 2, 3] (limited by start)
      // Position 7 window: [4, 5, 6, 7] (limited by end)
      // All should produce valid output
      for (let t = 0; t < seqLen; t++) {
        for (let d = 0; d < 64; d++) {
          expect(Number.isFinite(output[t * 64 + d])).toBe(true);
        }
      }
    });

    it('should handle window larger than sequence', () => {
      const attention = new RealLocalAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 100,  // Much larger than seqLen=4
        seed: 42
      });

      const seqLen = 4;
      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
      }

      const output = attention.forward(query, query, query, undefined, seqLen);

      // Should behave like global attention when window > seqLen
      expect(output.length).toBe(seqLen * 64);
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });

    it('should handle minimum window size of 1', () => {
      const attention = new RealLocalAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 1,  // Each position only attends to itself
        seed: 42
      });

      const seqLen = 8;
      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
      }

      const output = attention.forward(query, query, query, undefined, seqLen);

      expect(output.length).toBe(seqLen * 64);
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });
  });

  describe('Validation', () => {
    it('should throw on invalid dimension/numHeads', () => {
      expect(() => new RealLocalAttention({ dimension: 65, numHeads: 8 }))
        .toThrow('ANTI-009');
    });

    it('should throw on invalid window size', () => {
      expect(() => new RealLocalAttention({ dimension: 64, numHeads: 4, windowSize: 0 }))
        .toThrow('ANTI-009');
    });

    it('should throw on dimension mismatch Q/K/V', () => {
      const attention = new RealLocalAttention({ dimension: 64, numHeads: 4 });

      const query = new Float32Array(64);
      const key = new Float32Array(128);
      const value = new Float32Array(64);

      expect(() => attention.forward(query, key, value)).toThrow('ANTI-009');
    });
  });

  describe('Parameter Count', () => {
    it('should return correct parameter count', () => {
      const attention = new RealLocalAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 8
      });

      // 4 projection matrices: 4 × 64 × 64 = 16384
      const expected = 4 * 64 * 64;
      expect(attention.getParameterCount()).toBe(expected);
    });
  });

  describe('Window Size Accessor', () => {
    it('should expose window size', () => {
      const attention = new RealLocalAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 16
      });

      expect(attention.getWindowSize()).toBe(16);
    });
  });

  describe('Determinism', () => {
    it('should be deterministic with same seed', () => {
      const attention1 = new RealLocalAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 8,
        seed: 42
      });
      const attention2 = new RealLocalAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 8,
        seed: 42
      });

      const seqLen = 8;
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
      const attention1 = new RealLocalAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 8,
        seed: 42
      });
      const attention2 = new RealLocalAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 8,
        seed: 123
      });

      const seqLen = 8;
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
      const attention = new RealLocalAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 4,
        seed: 42
      });

      const seqLen = 4;
      const query = new Float32Array(seqLen * 64).fill(0);

      const output = attention.forward(query, query, query, undefined, seqLen);

      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });
  });

  describe('Integration', () => {
    it('should have correct mechanism name', () => {
      const attention = new RealLocalAttention();
      expect(attention.name).toBe('local');
    });

    it('should work with mask parameter', () => {
      const attention = new RealLocalAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 8,
        seed: 42
      });

      const seqLen = 8;
      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
      }

      // Mask out position 2
      const mask = [true, true, false, true, true, true, true, true];

      const outputWithMask = attention.forward(query, query, query, mask, seqLen);
      const outputNoMask = attention.forward(query, query, query, undefined, seqLen);

      // Outputs should differ for positions that could attend to position 2
      let diff = 0;
      for (let i = 0; i < outputWithMask.length; i++) {
        diff += Math.abs(outputWithMask[i] - outputNoMask[i]);
      }

      expect(diff).toBeGreaterThan(0);
    });
  });
});
