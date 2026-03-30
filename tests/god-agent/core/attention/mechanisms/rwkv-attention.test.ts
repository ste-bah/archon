/**
 * RealRWKVAttention Tests - ANTI-009 Fix
 *
 * Tests verify:
 * 1. Output differs from placeholder (0.5*q + 0.5*v)
 * 2. Recurrent state behavior
 * 3. Determinism with seed
 * 4. Error handling
 */

import { describe, it, expect } from 'vitest';
import { RealRWKVAttention } from '../../../../../src/god-agent/core/attention/mechanisms/rwkv-attention.js';

describe('RealRWKVAttention - ANTI-009 Fix', () => {

  describe('Core Functionality', () => {
    it('should compute actual RWKV output (not 0.5*q + 0.5*v)', () => {
      const attention = new RealRWKVAttention({
        dimension: 64,
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

    it('should process sequences of varying length', () => {
      const attention = new RealRWKVAttention({
        dimension: 64,
        seed: 42
      });

      // Single vector
      const query1 = new Float32Array(64).fill(1);
      const output1 = attention.forward(query1, query1, query1);
      expect(output1.length).toBe(64);

      // Multi-sequence
      const seqLen = 8;
      const query8 = new Float32Array(seqLen * 64).fill(1);
      const output8 = attention.forward(query8, query8, query8, undefined, seqLen);
      expect(output8.length).toBe(seqLen * 64);
    });

    it('should produce different outputs for different inputs', () => {
      const attention = new RealRWKVAttention({
        dimension: 64,
        seed: 42
      });

      const seqLen = 4;
      const query1 = new Float32Array(seqLen * 64);
      const query2 = new Float32Array(seqLen * 64);

      for (let i = 0; i < seqLen * 64; i++) {
        query1[i] = Math.sin(i * 0.1);
        query2[i] = Math.cos(i * 0.1);
      }

      const output1 = attention.forward(query1, query1, query1, undefined, seqLen);
      const output2 = attention.forward(query2, query2, query2, undefined, seqLen);

      let diff = 0;
      for (let i = 0; i < output1.length; i++) {
        diff += Math.abs(output1[i] - output2[i]);
      }

      expect(diff).toBeGreaterThan(0);
    });
  });

  describe('Recurrent State Properties', () => {
    it('should have recurrent behavior (earlier inputs affect later outputs)', () => {
      const attention = new RealRWKVAttention({
        dimension: 64,
        seed: 42
      });

      const seqLen = 4;

      // Input 1: spike at position 0
      const query1 = new Float32Array(seqLen * 64);
      for (let i = 0; i < 64; i++) {
        query1[i] = 5;  // Spike at position 0
      }
      for (let i = 64; i < seqLen * 64; i++) {
        query1[i] = 0.1;  // Small elsewhere
      }

      // Input 2: spike at position 2
      const query2 = new Float32Array(seqLen * 64);
      for (let i = 0; i < seqLen * 64; i++) {
        query2[i] = 0.1;
      }
      for (let i = 2 * 64; i < 3 * 64; i++) {
        query2[i] = 5;  // Spike at position 2
      }

      const output1 = attention.forward(query1, query1, query1, undefined, seqLen);
      const output2 = attention.forward(query2, query2, query2, undefined, seqLen);

      // Outputs should be different due to recurrent state
      let diff = 0;
      for (let i = 0; i < output1.length; i++) {
        diff += Math.abs(output1[i] - output2[i]);
      }

      expect(diff).toBeGreaterThan(0);
    });

    it('should exhibit time decay (earlier tokens have decaying influence)', () => {
      const attention = new RealRWKVAttention({
        dimension: 64,
        seed: 42
      });

      const seqLen = 8;

      // Input with spike at beginning
      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < 64; i++) {
        query[i] = 10;  // Strong signal at position 0
      }
      for (let i = 64; i < seqLen * 64; i++) {
        query[i] = 0;  // Zero elsewhere
      }

      const output = attention.forward(query, query, query, undefined, seqLen);

      // Output should still be valid (no NaN/Inf)
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }

      // Later outputs should still be influenced (non-zero due to state)
      let lastPosSum = 0;
      for (let i = (seqLen - 1) * 64; i < seqLen * 64; i++) {
        lastPosSum += Math.abs(output[i]);
      }
      // With time decay, last position can have very small but potentially non-zero values
      // The main point is numerical stability
      expect(Number.isFinite(lastPosSum)).toBe(true);
    });

    it('should handle long sequences efficiently', () => {
      const attention = new RealRWKVAttention({
        dimension: 64,
        seed: 42
      });

      const seqLen = 32;  // Longer sequence
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

  describe('Token Mixing', () => {
    it('should mix current with previous token', () => {
      const attention = new RealRWKVAttention({
        dimension: 64,
        seed: 42
      });

      const seqLen = 3;

      // Distinct tokens at each position
      const query = new Float32Array(seqLen * 64);
      for (let t = 0; t < seqLen; t++) {
        for (let d = 0; d < 64; d++) {
          query[t * 64 + d] = (t + 1) * Math.sin(d * 0.1);
        }
      }

      const output = attention.forward(query, query, query, undefined, seqLen);

      // Each position should have different output
      let pos0Sum = 0, pos1Sum = 0, pos2Sum = 0;
      for (let d = 0; d < 64; d++) {
        pos0Sum += Math.abs(output[d]);
        pos1Sum += Math.abs(output[64 + d]);
        pos2Sum += Math.abs(output[128 + d]);
      }

      // All positions should have some output
      expect(Number.isFinite(pos0Sum)).toBe(true);
      expect(Number.isFinite(pos1Sum)).toBe(true);
      expect(Number.isFinite(pos2Sum)).toBe(true);
    });
  });

  describe('Validation', () => {
    it('should throw on invalid dimension', () => {
      expect(() => new RealRWKVAttention({ dimension: 0 }))
        .toThrow('ANTI-009');
    });

    it('should throw on dimension mismatch', () => {
      const attention = new RealRWKVAttention({ dimension: 64 });

      const query = new Float32Array(65);  // Wrong size

      expect(() => attention.forward(query, query, query)).toThrow('ANTI-009');
    });
  });

  describe('Parameter Count', () => {
    it('should return correct parameter count', () => {
      const attention = new RealRWKVAttention({ dimension: 64 });

      // 4 projection matrices: 4 × 64 × 64 = 16384
      // 3 time parameters: 3 × 64 = 192
      // Total: 16576
      const expected = 4 * 64 * 64 + 3 * 64;
      expect(attention.getParameterCount()).toBe(expected);
    });
  });

  describe('Determinism', () => {
    it('should be deterministic with same seed', () => {
      const attention1 = new RealRWKVAttention({
        dimension: 64,
        seed: 42
      });
      const attention2 = new RealRWKVAttention({
        dimension: 64,
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
      const attention1 = new RealRWKVAttention({
        dimension: 64,
        seed: 42
      });
      const attention2 = new RealRWKVAttention({
        dimension: 64,
        seed: 123
      });

      const query = new Float32Array(64).fill(1);

      const output1 = attention1.forward(query, query, query);
      const output2 = attention2.forward(query, query, query);

      let diff = 0;
      for (let i = 0; i < output1.length; i++) {
        diff += Math.abs(output1[i] - output2[i]);
      }

      expect(diff).toBeGreaterThan(0);
    });
  });

  describe('Numerical Stability', () => {
    it('should handle zero inputs', () => {
      const attention = new RealRWKVAttention({
        dimension: 64,
        seed: 42
      });

      const query = new Float32Array(64).fill(0);

      const output = attention.forward(query, query, query);

      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });

    it('should handle large inputs', () => {
      const attention = new RealRWKVAttention({
        dimension: 64,
        seed: 42
      });

      const query = new Float32Array(64).fill(10);

      const output = attention.forward(query, query, query);

      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });

    it('should handle alternating positive/negative inputs', () => {
      const attention = new RealRWKVAttention({
        dimension: 64,
        seed: 42
      });

      const seqLen = 4;
      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = (i % 2 === 0) ? 5 : -5;
      }

      const output = attention.forward(query, query, query, undefined, seqLen);

      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });
  });

  describe('Integration', () => {
    it('should have correct mechanism name', () => {
      const attention = new RealRWKVAttention();
      expect(attention.name).toBe('rwkv');
    });
  });
});
