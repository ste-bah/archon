/**
 * RealSparseTransformerAttention Tests - ANTI-009 Fix
 *
 * Tests verify:
 * 1. Output differs from placeholder (0.5*q + 0.5*v)
 * 2. Strided attention pattern works
 * 3. Local attention pattern works
 * 4. Determinism with seed
 * 5. Error handling
 */

import { describe, it, expect } from 'vitest';
import { RealSparseTransformerAttention } from '../../../../../src/god-agent/core/attention/mechanisms/sparse-transformer-attention.js';
import { createCausalMask } from '../../../../../src/god-agent/core/attention/utils/index.js';

describe('RealSparseTransformerAttention - ANTI-009 Fix', () => {

  describe('Core Functionality', () => {
    it('should compute actual attention (not 0.5*q + 0.5*v)', () => {
      const attention = new RealSparseTransformerAttention({
        dimension: 64,
        numHeads: 4,
        stride: 4,
        localSize: 4,
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
      const attention = new RealSparseTransformerAttention({
        dimension: 64,
        numHeads: 4,
        stride: 4,
        localSize: 4,
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
      for (let i = 0; i < 64; i++) {
        key1[i] = 2;
      }
      for (let i = 64; i < seqLen * 64; i++) {
        key1[i] = 0.1;
      }

      const key2 = new Float32Array(seqLen * 64);
      for (let i = 0; i < 64; i++) {
        key2[i] = 0.1;
      }
      for (let i = 64; i < 128; i++) {
        key2[i] = 2;
      }
      for (let i = 128; i < seqLen * 64; i++) {
        key2[i] = 0.1;
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
      const attention = new RealSparseTransformerAttention({
        dimension: 64,
        numHeads: 4,
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

  describe('Sparse Pattern Behavior', () => {
    it('should produce different results with different stride', () => {
      const attention1 = new RealSparseTransformerAttention({
        dimension: 64,
        numHeads: 4,
        stride: 2,
        localSize: 2,
        seed: 42
      });

      const attention2 = new RealSparseTransformerAttention({
        dimension: 64,
        numHeads: 4,
        stride: 8,
        localSize: 2,
        seed: 42
      });

      const seqLen = 16;
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

    it('should produce different results with different local size', () => {
      const attention1 = new RealSparseTransformerAttention({
        dimension: 64,
        numHeads: 4,
        stride: 4,
        localSize: 2,
        seed: 42
      });

      const attention2 = new RealSparseTransformerAttention({
        dimension: 64,
        numHeads: 4,
        stride: 4,
        localSize: 8,
        seed: 42
      });

      const seqLen = 16;
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
      const attention = new RealSparseTransformerAttention({
        dimension: 64,
        numHeads: 4,
        stride: 8,
        localSize: 8,
        seed: 42
      });

      const seqLen = 64;  // Longer sequence
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

  describe('Masking', () => {
    it('should support causal mask', () => {
      const attention = new RealSparseTransformerAttention({
        dimension: 64,
        numHeads: 4,
        stride: 4,
        localSize: 4,
        seed: 42
      });

      const seqLen = 8;
      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
      }

      const mask = createCausalMask(seqLen);

      const outputCausal = attention.forward(query, query, query, mask, seqLen);
      const outputNoCausal = attention.forward(query, query, query, undefined, seqLen);

      expect(outputCausal.length).toBe(seqLen * 64);
      expect(outputNoCausal.length).toBe(seqLen * 64);
    });
  });

  describe('Validation', () => {
    it('should throw on invalid dimension/numHeads', () => {
      expect(() => new RealSparseTransformerAttention({ dimension: 65, numHeads: 8 }))
        .toThrow('ANTI-009');
    });

    it('should throw on invalid stride', () => {
      expect(() => new RealSparseTransformerAttention({ stride: 0 }))
        .toThrow('ANTI-009');
    });

    it('should throw on invalid local size', () => {
      expect(() => new RealSparseTransformerAttention({ localSize: 0 }))
        .toThrow('ANTI-009');
    });

    it('should throw on dimension mismatch', () => {
      const attention = new RealSparseTransformerAttention({ dimension: 64, numHeads: 4 });

      const query = new Float32Array(64);
      const key = new Float32Array(128);
      const value = new Float32Array(64);

      expect(() => attention.forward(query, key, value)).toThrow('ANTI-009');
    });
  });

  describe('Parameter Count', () => {
    it('should return correct parameter count', () => {
      const attention = new RealSparseTransformerAttention({ dimension: 64, numHeads: 4 });

      // Standard: 4×dim²
      expect(attention.getParameterCount()).toBe(4 * 64 * 64);
    });
  });

  describe('Determinism', () => {
    it('should be deterministic with same seed', () => {
      const attention1 = new RealSparseTransformerAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });
      const attention2 = new RealSparseTransformerAttention({
        dimension: 64,
        numHeads: 4,
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
      const attention1 = new RealSparseTransformerAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });
      const attention2 = new RealSparseTransformerAttention({
        dimension: 64,
        numHeads: 4,
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
      const attention = new RealSparseTransformerAttention({
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

    it('should handle large inputs', () => {
      const attention = new RealSparseTransformerAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const query = new Float32Array(64).fill(100);

      const output = attention.forward(query, query, query);

      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });
  });

  describe('Integration', () => {
    it('should have correct mechanism name', () => {
      const attention = new RealSparseTransformerAttention();
      expect(attention.name).toBe('sparse-transformer');
    });
  });
});
