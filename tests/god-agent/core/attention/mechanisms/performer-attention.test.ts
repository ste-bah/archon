/**
 * RealPerformerAttention Tests - ANTI-009 Fix
 *
 * Tests verify:
 * 1. Output differs from placeholder (0.5*q + 0.5*v)
 * 2. FAVOR+ random feature approximation
 * 3. Determinism with seed
 * 4. Error handling
 */

import { describe, it, expect } from 'vitest';
import { RealPerformerAttention } from '../../../../../src/god-agent/core/attention/mechanisms/performer-attention.js';

describe('RealPerformerAttention - ANTI-009 Fix', () => {

  describe('Core Functionality', () => {
    it('should compute actual attention (not 0.5*q + 0.5*v)', () => {
      const attention = new RealPerformerAttention({
        dimension: 64,
        numHeads: 4,
        numFeatures: 32,
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
      const attention = new RealPerformerAttention({
        dimension: 64,
        numHeads: 4,
        numFeatures: 32,
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
      const attention = new RealPerformerAttention({
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

  describe('FAVOR+ Properties', () => {
    it('should produce different results with different numFeatures', () => {
      const attention1 = new RealPerformerAttention({
        dimension: 64,
        numHeads: 4,
        numFeatures: 16,
        seed: 42
      });

      const attention2 = new RealPerformerAttention({
        dimension: 64,
        numHeads: 4,
        numFeatures: 64,
        seed: 42
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

    it('should handle long sequences efficiently', () => {
      const attention = new RealPerformerAttention({
        dimension: 64,
        numHeads: 4,
        numFeatures: 32,
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

  describe('Validation', () => {
    it('should throw on invalid dimension/numHeads', () => {
      expect(() => new RealPerformerAttention({ dimension: 65, numHeads: 8 }))
        .toThrow('ANTI-009');
    });

    it('should throw on dimension mismatch', () => {
      const attention = new RealPerformerAttention({ dimension: 64, numHeads: 4 });

      const query = new Float32Array(64);
      const key = new Float32Array(128);
      const value = new Float32Array(64);

      expect(() => attention.forward(query, key, value)).toThrow('ANTI-009');
    });
  });

  describe('Parameter Count', () => {
    it('should return correct parameter count', () => {
      const attention = new RealPerformerAttention({
        dimension: 64,
        numHeads: 4,
        numFeatures: 32
      });

      // 4 projection matrices: 4 × 64 × 64 = 16384
      // Random features: 16 (headDim) × 32 = 512
      const expected = 4 * 64 * 64 + 16 * 32;
      expect(attention.getParameterCount()).toBe(expected);
    });
  });

  describe('Determinism', () => {
    it('should be deterministic with same seed', () => {
      const attention1 = new RealPerformerAttention({
        dimension: 64,
        numHeads: 4,
        numFeatures: 32,
        seed: 42
      });
      const attention2 = new RealPerformerAttention({
        dimension: 64,
        numHeads: 4,
        numFeatures: 32,
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
      const attention1 = new RealPerformerAttention({
        dimension: 64,
        numHeads: 4,
        numFeatures: 32,
        seed: 42
      });
      const attention2 = new RealPerformerAttention({
        dimension: 64,
        numHeads: 4,
        numFeatures: 32,
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
      const attention = new RealPerformerAttention({
        dimension: 64,
        numHeads: 4,
        numFeatures: 32,
        seed: 42
      });

      const query = new Float32Array(64).fill(0);

      const output = attention.forward(query, query, query);

      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });

    it('should handle small inputs', () => {
      const attention = new RealPerformerAttention({
        dimension: 64,
        numHeads: 4,
        numFeatures: 32,
        seed: 42
      });

      const query = new Float32Array(64).fill(0.001);

      const output = attention.forward(query, query, query);

      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });
  });

  describe('Integration', () => {
    it('should have correct mechanism name', () => {
      const attention = new RealPerformerAttention();
      expect(attention.name).toBe('performer');
    });
  });
});
