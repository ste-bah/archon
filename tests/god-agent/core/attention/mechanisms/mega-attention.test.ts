/**
 * Tests for MEGA (Moving Average Equipped Gated Attention)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RealMegaAttention } from '../../../../../src/god-agent/core/attention/mechanisms/mega-attention.js';
import type { MegaAttentionConfig } from '../../../../../src/god-agent/core/attention/mechanisms/mega-attention.js';

describe('RealMegaAttention', () => {
  let attention: RealMegaAttention;
  const dimension = 64;
  const seqLen = 8;

  beforeEach(() => {
    attention = new RealMegaAttention({ dimension, seed: 42 });
  });

  describe('Construction', () => {
    it('should construct with default parameters', () => {
      const attn = new RealMegaAttention();
      expect(attn.name).toBe('mega');
      expect(attn.getParameterCount()).toBeGreaterThan(0);
    });

    it('should construct with custom parameters', () => {
      const config: MegaAttentionConfig = {
        dimension: 128,
        numHeads: 1,
        emaAlpha: 0.85,
        seed: 123,
      };
      const attn = new RealMegaAttention(config);
      expect(attn.name).toBe('mega');
      expect(attn.getParameterCount()).toBe(
        4 * 128 * 128 + // W_q, W_k, W_v, W_o
        128 * 128 +     // W_gate
        128             // b_gate
      );
    });

    it('should throw error for invalid dimension', () => {
      expect(() => new RealMegaAttention({ dimension: 0 })).toThrow('ANTI-009');
      expect(() => new RealMegaAttention({ dimension: -1 })).toThrow('ANTI-009');
      expect(() => new RealMegaAttention({ dimension: 3.5 })).toThrow('ANTI-009');
    });

    it('should throw error for invalid numHeads', () => {
      expect(() => new RealMegaAttention({ dimension: 64, numHeads: 0 })).toThrow('ANTI-009');
      expect(() => new RealMegaAttention({ dimension: 64, numHeads: -1 })).toThrow('ANTI-009');
      expect(() => new RealMegaAttention({ dimension: 64, numHeads: 2.5 })).toThrow('ANTI-009');
    });

    it('should throw error for non-divisible dimension', () => {
      expect(() => new RealMegaAttention({ dimension: 65, numHeads: 2 })).toThrow('ANTI-009');
    });

    it('should throw error for invalid emaAlpha', () => {
      expect(() => new RealMegaAttention({ emaAlpha: -0.1 })).toThrow('ANTI-009');
      expect(() => new RealMegaAttention({ emaAlpha: 1.1 })).toThrow('ANTI-009');
    });

    it('should accept boundary emaAlpha values', () => {
      expect(() => new RealMegaAttention({ emaAlpha: 0 })).not.toThrow();
      expect(() => new RealMegaAttention({ emaAlpha: 1 })).not.toThrow();
      expect(() => new RealMegaAttention({ emaAlpha: 0.5 })).not.toThrow();
    });
  });

  describe('Forward Pass', () => {
    it('should compute forward pass with correct output dimensions', () => {
      const query = new Float32Array(seqLen * dimension).fill(0.1);
      const key = new Float32Array(seqLen * dimension).fill(0.2);
      const value = new Float32Array(seqLen * dimension).fill(0.3);

      const output = attention.forward(query, key, value, undefined, seqLen);

      expect(output).toBeInstanceOf(Float32Array);
      expect(output.length).toBe(seqLen * dimension);
    });

    it('should produce non-zero output for non-zero input', () => {
      const query = new Float32Array(seqLen * dimension);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
      }
      const key = query.slice();
      const value = query.slice();

      const output = attention.forward(query, key, value, undefined, seqLen);

      const hasNonZero = Array.from(output).some((v) => Math.abs(v) > 1e-6);
      expect(hasNonZero).toBe(true);
    });

    it('should handle mask correctly', () => {
      const query = new Float32Array(seqLen * dimension).fill(0.1);
      const key = new Float32Array(seqLen * dimension).fill(0.2);
      const value = new Float32Array(seqLen * dimension).fill(0.3);

      // Mask that excludes last 2 positions
      const mask = new Array(seqLen).fill(true);
      mask[seqLen - 1] = false;
      mask[seqLen - 2] = false;

      const output = attention.forward(query, key, value, mask, seqLen);

      expect(output.length).toBe(seqLen * dimension);
      expect(isFinite(output[0])).toBe(true);
    });

    it('should throw error for missing seqLen', () => {
      const query = new Float32Array(seqLen * dimension);
      const key = new Float32Array(seqLen * dimension);
      const value = new Float32Array(seqLen * dimension);

      expect(() => attention.forward(query, key, value)).toThrow('ANTI-009');
    });

    it('should throw error for mismatched query length', () => {
      const query = new Float32Array((seqLen + 1) * dimension);
      const key = new Float32Array(seqLen * dimension);
      const value = new Float32Array(seqLen * dimension);

      expect(() => attention.forward(query, key, value, undefined, seqLen)).toThrow('ANTI-009');
    });

    it('should throw error for mismatched key length', () => {
      const query = new Float32Array(seqLen * dimension);
      const key = new Float32Array((seqLen - 1) * dimension);
      const value = new Float32Array(seqLen * dimension);

      expect(() => attention.forward(query, key, value, undefined, seqLen)).toThrow('ANTI-009');
    });

    it('should throw error for mismatched value length', () => {
      const query = new Float32Array(seqLen * dimension);
      const key = new Float32Array(seqLen * dimension);
      const value = new Float32Array((seqLen + 2) * dimension);

      expect(() => attention.forward(query, key, value, undefined, seqLen)).toThrow('ANTI-009');
    });

    it('should throw error for mismatched mask length', () => {
      const query = new Float32Array(seqLen * dimension);
      const key = new Float32Array(seqLen * dimension);
      const value = new Float32Array(seqLen * dimension);
      const mask = new Array(seqLen + 1).fill(true);

      expect(() => attention.forward(query, key, value, mask, seqLen)).toThrow('ANTI-009');
    });

    it('should throw error for NaN in input', () => {
      const query = new Float32Array(seqLen * dimension);
      query[0] = NaN;
      const key = new Float32Array(seqLen * dimension);
      const value = new Float32Array(seqLen * dimension);

      expect(() => attention.forward(query, key, value, undefined, seqLen)).toThrow('ANTI-009');
    });

    it('should throw error for Infinity in input', () => {
      const query = new Float32Array(seqLen * dimension);
      const key = new Float32Array(seqLen * dimension);
      key[5] = Infinity;
      const value = new Float32Array(seqLen * dimension);

      expect(() => attention.forward(query, key, value, undefined, seqLen)).toThrow('ANTI-009');
    });
  });

  describe('EMA Behavior', () => {
    it('should apply exponential moving average', () => {
      const attn = new RealMegaAttention({ dimension: 4, emaAlpha: 0.9, seed: 42 });
      const seqLen = 3;

      // Simple input: constant values
      const query = new Float32Array(seqLen * 4);
      for (let t = 0; t < seqLen; t++) {
        for (let d = 0; d < 4; d++) {
          query[t * 4 + d] = 1.0; // Constant input
        }
      }
      const key = query.slice();
      const value = query.slice();

      const output1 = attn.forward(query, key, value, undefined, seqLen);

      // Reset and run again
      attn.resetState();
      const output2 = attn.forward(query, key, value, undefined, seqLen);

      // Outputs should be identical after reset
      expect(output1.length).toBe(output2.length);
      for (let i = 0; i < output1.length; i++) {
        expect(Math.abs(output1[i] - output2[i])).toBeLessThan(1e-6);
      }
    });

    it('should show different behavior with different emaAlpha', () => {
      const attn1 = new RealMegaAttention({ dimension: 8, emaAlpha: 0.1, seed: 42 });
      const attn2 = new RealMegaAttention({ dimension: 8, emaAlpha: 0.9, seed: 42 });
      const seqLen = 4;

      const query = new Float32Array(seqLen * 8);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.5);
      }
      const key = query.slice();
      const value = query.slice();

      const output1 = attn1.forward(query, key, value, undefined, seqLen);
      const output2 = attn2.forward(query, key, value, undefined, seqLen);

      // Outputs should differ due to different EMA decay
      let maxDiff = 0;
      for (let i = 0; i < output1.length; i++) {
        maxDiff = Math.max(maxDiff, Math.abs(output1[i] - output2[i]));
      }
      expect(maxDiff).toBeGreaterThan(1e-3);
    });

    it('should maintain state between forward passes', () => {
      const attn = new RealMegaAttention({ dimension: 4, emaAlpha: 0.8, seed: 42 });
      const seqLen = 2;

      const query1 = new Float32Array(seqLen * 4).fill(1.0);
      const key1 = query1.slice();
      const value1 = query1.slice();

      const output1 = attn.forward(query1, key1, value1, undefined, seqLen);

      // Second forward pass (state carries over)
      const query2 = new Float32Array(seqLen * 4).fill(0.5);
      const key2 = query2.slice();
      const value2 = query2.slice();

      const output2 = attn.forward(query2, key2, value2, undefined, seqLen);

      // Reset and run second input again
      attn.resetState();
      const output3 = attn.forward(query2, key2, value2, undefined, seqLen);

      // output2 and output3 should differ (state vs no state)
      let maxDiff = 0;
      for (let i = 0; i < output2.length; i++) {
        maxDiff = Math.max(maxDiff, Math.abs(output2[i] - output3[i]));
      }
      expect(maxDiff).toBeGreaterThan(1e-4);
    });
  });

  describe('Gating Mechanism', () => {
    it('should blend EMA and attention outputs via gating', () => {
      const attn = new RealMegaAttention({ dimension: 16, seed: 42 });
      const seqLen = 4;

      const query = new Float32Array(seqLen * 16);
      for (let i = 0; i < query.length; i++) {
        query[i] = (i % 2 === 0 ? 1 : -1) * 0.1;
      }
      const key = query.slice();
      const value = query.slice();

      const output = attn.forward(query, key, value, undefined, seqLen);

      // Output should be a blend (gating should produce values in (0, 1))
      // Just verify output is finite and reasonable
      expect(output.every((v) => isFinite(v))).toBe(true);
      const absMax = Math.max(...Array.from(output).map(Math.abs));
      expect(absMax).toBeLessThan(100); // Should not explode
    });
  });

  describe('Numerical Stability', () => {
    it('should handle zero input', () => {
      const query = new Float32Array(seqLen * dimension);
      const key = new Float32Array(seqLen * dimension);
      const value = new Float32Array(seqLen * dimension);

      const output = attention.forward(query, key, value, undefined, seqLen);

      expect(output.every((v) => isFinite(v))).toBe(true);
    });

    it('should handle large input values', () => {
      const query = new Float32Array(seqLen * dimension).fill(10.0);
      const key = new Float32Array(seqLen * dimension).fill(10.0);
      const value = new Float32Array(seqLen * dimension).fill(10.0);

      const output = attention.forward(query, key, value, undefined, seqLen);

      expect(output.every((v) => isFinite(v))).toBe(true);
    });

    it('should handle negative input values', () => {
      const query = new Float32Array(seqLen * dimension).fill(-0.5);
      const key = new Float32Array(seqLen * dimension).fill(-0.5);
      const value = new Float32Array(seqLen * dimension).fill(-0.5);

      const output = attention.forward(query, key, value, undefined, seqLen);

      expect(output.every((v) => isFinite(v))).toBe(true);
    });

    it('should handle mixed positive/negative values', () => {
      const query = new Float32Array(seqLen * dimension);
      for (let i = 0; i < query.length; i++) {
        query[i] = (i % 2 === 0 ? 1 : -1) * (i * 0.01);
      }
      const key = query.slice();
      const value = query.slice();

      const output = attention.forward(query, key, value, undefined, seqLen);

      expect(output.every((v) => isFinite(v))).toBe(true);
    });
  });

  describe('Determinism', () => {
    it('should produce identical outputs with same seed', () => {
      const attn1 = new RealMegaAttention({ dimension, seed: 12345 });
      const attn2 = new RealMegaAttention({ dimension, seed: 12345 });

      const query = new Float32Array(seqLen * dimension);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
      }
      const key = query.slice();
      const value = query.slice();

      const output1 = attn1.forward(query, key, value, undefined, seqLen);
      const output2 = attn2.forward(query, key, value, undefined, seqLen);

      expect(output1.length).toBe(output2.length);
      for (let i = 0; i < output1.length; i++) {
        expect(output1[i]).toBeCloseTo(output2[i], 10);
      }
    });

    it('should produce different outputs with different seeds', () => {
      const attn1 = new RealMegaAttention({ dimension, seed: 111 });
      const attn2 = new RealMegaAttention({ dimension, seed: 222 });

      const query = new Float32Array(seqLen * dimension).fill(0.1);
      const key = new Float32Array(seqLen * dimension).fill(0.2);
      const value = new Float32Array(seqLen * dimension).fill(0.3);

      const output1 = attn1.forward(query, key, value, undefined, seqLen);
      const output2 = attn2.forward(query, key, value, undefined, seqLen);

      let maxDiff = 0;
      for (let i = 0; i < output1.length; i++) {
        maxDiff = Math.max(maxDiff, Math.abs(output1[i] - output2[i]));
      }
      expect(maxDiff).toBeGreaterThan(1e-6);
    });
  });

  describe('Parameter Count', () => {
    it('should calculate correct parameter count', () => {
      const dim = 128;
      const attn = new RealMegaAttention({ dimension: dim });

      const expectedParams =
        4 * dim * dim + // W_q, W_k, W_v, W_o
        dim * dim +     // W_gate
        dim;            // b_gate

      expect(attn.getParameterCount()).toBe(expectedParams);
    });

    it('should scale parameter count with dimension', () => {
      const attn32 = new RealMegaAttention({ dimension: 32 });
      const attn64 = new RealMegaAttention({ dimension: 64 });

      const params32 = attn32.getParameterCount();
      const params64 = attn64.getParameterCount();

      // params should scale approximately as O(d²)
      expect(params64).toBeGreaterThan(params32 * 3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle single-token sequence', () => {
      const seqLen = 1;
      const query = new Float32Array(dimension).fill(0.5);
      const key = new Float32Array(dimension).fill(0.5);
      const value = new Float32Array(dimension).fill(0.5);

      const output = attention.forward(query, key, value, undefined, seqLen);

      expect(output.length).toBe(dimension);
      expect(output.every((v) => isFinite(v))).toBe(true);
    });

    it('should handle long sequence', () => {
      const longSeq = 64;
      const query = new Float32Array(longSeq * dimension);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.01);
      }
      const key = query.slice();
      const value = query.slice();

      const output = attention.forward(query, key, value, undefined, longSeq);

      expect(output.length).toBe(longSeq * dimension);
      expect(output.every((v) => isFinite(v))).toBe(true);
    });

    it('should handle all-true mask', () => {
      const query = new Float32Array(seqLen * dimension).fill(0.1);
      const key = new Float32Array(seqLen * dimension).fill(0.2);
      const value = new Float32Array(seqLen * dimension).fill(0.3);
      const mask = new Array(seqLen).fill(true);

      const output = attention.forward(query, key, value, mask, seqLen);

      expect(output.length).toBe(seqLen * dimension);
      expect(output.every((v) => isFinite(v))).toBe(true);
    });

    it('should throw on all-false mask (causes NaN in softmax)', () => {
      const query = new Float32Array(seqLen * dimension).fill(0.1);
      const key = new Float32Array(seqLen * dimension).fill(0.2);
      const value = new Float32Array(seqLen * dimension).fill(0.3);
      const mask = new Array(seqLen).fill(false);

      // All-false mask causes 0/0 in softmax, resulting in NaN
      expect(() => attention.forward(query, key, value, mask, seqLen)).toThrow('ANTI-009');
    });
  });

  describe('Integration', () => {
    it('should work as drop-in replacement for standard attention', () => {
      const attn = new RealMegaAttention({ dimension: 32, seed: 999 });

      const seqLen = 10;
      const query = new Float32Array(seqLen * 32);
      for (let i = 0; i < query.length; i++) {
        query[i] = (Math.random() - 0.5) * 0.2;
      }
      const key = query.slice();
      const value = query.slice();

      const output = attn.forward(query, key, value, undefined, seqLen);

      expect(output).toBeInstanceOf(Float32Array);
      expect(output.length).toBe(seqLen * 32);
      expect(output.every((v) => isFinite(v))).toBe(true);
      expect(attn.name).toBe('mega');
    });
  });
});
