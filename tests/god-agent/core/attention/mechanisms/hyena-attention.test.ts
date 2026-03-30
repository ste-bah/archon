/**
 * RealHyenaAttention Tests - ANTI-009 Fix
 *
 * Tests verify:
 * 1. Output differs from placeholder (0.5*q + 0.5*v)
 * 2. Convolution-based attention behavior
 * 3. Determinism with seed
 * 4. Error handling
 */

import { describe, it, expect } from 'vitest';
import { RealHyenaAttention } from '../../../../../src/god-agent/core/attention/mechanisms/hyena-attention.js';

describe('RealHyenaAttention - ANTI-009 Fix', () => {

  describe('Core Functionality', () => {
    it('should compute actual attention (not 0.5*q + 0.5*v)', () => {
      const attention = new RealHyenaAttention({
        dimension: 64,
        numHeads: 4,
        order: 2,
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
      const attention = new RealHyenaAttention({
        dimension: 64,
        numHeads: 4,
        order: 2,
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
      const attention = new RealHyenaAttention({
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

  describe('Hyena Properties', () => {
    it('should produce different results with different order', () => {
      const attention1 = new RealHyenaAttention({
        dimension: 64,
        numHeads: 4,
        order: 1,
        seed: 42
      });

      const attention2 = new RealHyenaAttention({
        dimension: 64,
        numHeads: 4,
        order: 3,
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

    it('should exhibit convolutional behavior', () => {
      // Hyena uses convolutions - test that output shows position-dependent patterns
      const attention = new RealHyenaAttention({
        dimension: 64,
        numHeads: 4,
        order: 2,
        seed: 42
      });

      const seqLen = 8;
      // Create input with a spike at one position
      const query = new Float32Array(seqLen * 64).fill(0);
      // Put spike at position 2
      for (let d = 0; d < 64; d++) {
        query[2 * 64 + d] = 1.0;
      }

      const output = attention.forward(query, query, query, undefined, seqLen);

      // Due to convolution, response should spread beyond position 2
      // Check that positions after the spike have non-zero values
      let hasResponse = false;
      for (let t = 3; t < seqLen; t++) {
        for (let d = 0; d < 64; d++) {
          if (Math.abs(output[t * 64 + d]) > 1e-6) {
            hasResponse = true;
            break;
          }
        }
      }

      expect(hasResponse).toBe(true);
    });

    it('should apply implicit long convolutions', () => {
      const attention = new RealHyenaAttention({
        dimension: 64,
        numHeads: 4,
        order: 2,
        filterSize: 32,
        seed: 42
      });

      const seqLen = 16;
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
      expect(() => new RealHyenaAttention({ dimension: 65, numHeads: 8 }))
        .toThrow('ANTI-009');
    });

    it('should throw on dimension mismatch', () => {
      const attention = new RealHyenaAttention({ dimension: 64, numHeads: 4 });

      const query = new Float32Array(64);
      const key = new Float32Array(128);
      const value = new Float32Array(64);

      expect(() => attention.forward(query, key, value)).toThrow('ANTI-009');
    });
  });

  describe('Parameter Count', () => {
    it('should return correct parameter count', () => {
      const attention = new RealHyenaAttention({
        dimension: 64,
        numHeads: 4,
        order: 2,
        filterSize: 32
      });

      // 4 projection matrices: 4 × 64 × 64 = 16384
      // Short filter: 3 × 16 = 48
      // MLP1: 16 × 32 = 512
      // MLP2: 32 × 16 = 512
      // Decay rates: 16
      const expected = 4 * 64 * 64 + 3 * 16 + 16 * 32 + 32 * 16 + 16;
      expect(attention.getParameterCount()).toBe(expected);
    });
  });

  describe('Determinism', () => {
    it('should be deterministic with same seed', () => {
      const attention1 = new RealHyenaAttention({
        dimension: 64,
        numHeads: 4,
        order: 2,
        seed: 42
      });
      const attention2 = new RealHyenaAttention({
        dimension: 64,
        numHeads: 4,
        order: 2,
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
      const attention1 = new RealHyenaAttention({
        dimension: 64,
        numHeads: 4,
        order: 2,
        seed: 42
      });
      const attention2 = new RealHyenaAttention({
        dimension: 64,
        numHeads: 4,
        order: 2,
        seed: 123
      });

      // Use varied inputs to ensure seed differences manifest
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
      const attention = new RealHyenaAttention({
        dimension: 64,
        numHeads: 4,
        order: 2,
        seed: 42
      });

      const query = new Float32Array(64).fill(0);

      const output = attention.forward(query, query, query);

      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });

    it('should handle small inputs', () => {
      const attention = new RealHyenaAttention({
        dimension: 64,
        numHeads: 4,
        order: 2,
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
      const attention = new RealHyenaAttention();
      expect(attention.name).toBe('hyena');
    });
  });
});
