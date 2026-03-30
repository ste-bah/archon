/**
 * Tests for Luna (Linear Unified Nested Attention) Mechanism
 *
 * @module tests/attention/mechanisms/luna-attention
 */

import { describe, it, expect } from 'vitest';
import { RealLunaAttention } from '../../../../../src/god-agent/core/attention/mechanisms/luna-attention.js';

describe('RealLunaAttention', () => {
  describe('Construction', () => {
    it('should create with default config', () => {
      const attention = new RealLunaAttention();
      expect(attention.name).toBe('luna');
      expect(attention.getParameterCount()).toBeGreaterThan(0);
    });

    it('should create with custom config', () => {
      const attention = new RealLunaAttention({
        dimension: 512,
        numHeads: 8,
        projectedLength: 32,
        seed: 123,
      });
      expect(attention.name).toBe('luna');

      // Parameter count: packProjection (32*512) + 4 projections (4*512*512)
      const expected = 32 * 512 + 4 * 512 * 512;
      expect(attention.getParameterCount()).toBe(expected);
    });

    it('should reject invalid dimension', () => {
      expect(() => new RealLunaAttention({ dimension: 0 })).toThrow(
        'ANTI-009: dimension must be positive'
      );
      expect(() => new RealLunaAttention({ dimension: -10 })).toThrow(
        'ANTI-009: dimension must be positive'
      );
    });

    it('should reject invalid numHeads', () => {
      expect(() => new RealLunaAttention({ numHeads: 0 })).toThrow(
        'ANTI-009: numHeads must be positive'
      );
      expect(() => new RealLunaAttention({ numHeads: -5 })).toThrow(
        'ANTI-009: numHeads must be positive'
      );
    });

    it('should reject non-divisible dimension', () => {
      expect(() => new RealLunaAttention({ dimension: 100, numHeads: 7 })).toThrow(
        'ANTI-009: dimension must be divisible by numHeads'
      );
    });

    it('should reject invalid projectedLength', () => {
      expect(() => new RealLunaAttention({ projectedLength: 0 })).toThrow(
        'ANTI-009: projectedLength must be positive'
      );
      expect(() => new RealLunaAttention({ projectedLength: -10 })).toThrow(
        'ANTI-009: projectedLength must be positive'
      );
    });
  });

  describe('Forward Pass - Core Functionality', () => {
    it('should process single sequence correctly', () => {
      const attention = new RealLunaAttention({
        dimension: 64,
        numHeads: 4,
        projectedLength: 8,
        seed: 42,
      });

      const seqLen = 16;
      const query = new Float32Array(seqLen * 64);
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      // Initialize with test pattern
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = (i % 2 === 0 ? 1 : -1) * 0.5;
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      expect(output).toBeInstanceOf(Float32Array);
      expect(output.length).toBe(seqLen * 64);
      expect(output.some((x) => x !== 0)).toBe(true);
    });

    it('should handle different sequence lengths', () => {
      const attention = new RealLunaAttention({
        dimension: 128,
        numHeads: 8,
        projectedLength: 16,
        seed: 100,
      });

      for (const seqLen of [4, 8, 16, 32]) {
        const query = new Float32Array(seqLen * 128);
        const key = new Float32Array(seqLen * 128);
        const value = new Float32Array(seqLen * 128);

        for (let i = 0; i < query.length; i++) {
          query[i] = Math.random() - 0.5;
          key[i] = Math.random() - 0.5;
          value[i] = Math.random() - 0.5;
        }

        const output = attention.forward(query, key, value, undefined, seqLen);
        expect(output.length).toBe(seqLen * 128);
      }
    });

    it('should handle projected length larger than sequence', () => {
      const attention = new RealLunaAttention({
        dimension: 64,
        numHeads: 4,
        projectedLength: 64, // Larger than seqLen
        seed: 42,
      });

      const seqLen = 16;
      const query = new Float32Array(seqLen * 64);
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      for (let i = 0; i < query.length; i++) {
        query[i] = (i % 3) * 0.3;
        key[i] = (i % 5) * 0.2;
        value[i] = (i % 7) * 0.1;
      }

      const output = attention.forward(query, key, value, undefined, seqLen);
      expect(output.length).toBe(seqLen * 64);
    });

    it('should handle projected length smaller than sequence', () => {
      const attention = new RealLunaAttention({
        dimension: 64,
        numHeads: 4,
        projectedLength: 4, // Much smaller than seqLen
        seed: 42,
      });

      const seqLen = 64;
      const query = new Float32Array(seqLen * 64);
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.05);
        key[i] = Math.cos(i * 0.05);
        value[i] = Math.tanh(i * 0.01);
      }

      const output = attention.forward(query, key, value, undefined, seqLen);
      expect(output.length).toBe(seqLen * 64);
    });
  });

  describe('Masking', () => {
    it('should apply attention mask correctly', () => {
      const attention = new RealLunaAttention({
        dimension: 64,
        numHeads: 4,
        projectedLength: 8,
        seed: 42,
      });

      const seqLen = 8;
      const query = new Float32Array(seqLen * 64);
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      for (let i = 0; i < query.length; i++) {
        query[i] = Math.random();
        key[i] = Math.random();
        value[i] = i < seqLen * 64 / 2 ? 1.0 : -1.0; // First half positive
      }

      // Mask out second half
      const mask = new Array(seqLen).fill(false);
      for (let i = 0; i < seqLen / 2; i++) {
        mask[i] = true;
      }

      const outputMasked = attention.forward(query, key, value, mask, seqLen);
      const outputUnmasked = attention.forward(query, key, value, undefined, seqLen);

      // Outputs should differ
      let hasDifference = false;
      for (let i = 0; i < outputMasked.length; i++) {
        if (Math.abs(outputMasked[i] - outputUnmasked[i]) > 1e-6) {
          hasDifference = true;
          break;
        }
      }
      expect(hasDifference).toBe(true);
    });

    it('should handle all-masked sequence', () => {
      const attention = new RealLunaAttention({
        dimension: 64,
        numHeads: 4,
        projectedLength: 8,
        seed: 42,
      });

      const seqLen = 8;
      const query = new Float32Array(seqLen * 64).fill(0.5);
      const key = new Float32Array(seqLen * 64).fill(0.3);
      const value = new Float32Array(seqLen * 64).fill(0.7);

      const mask = new Array(seqLen).fill(false);

      const output = attention.forward(query, key, value, mask, seqLen);
      expect(output.length).toBe(seqLen * 64);
      // With all masked, output should be zeros (no attention)
      expect(output.every((x) => Math.abs(x) < 1e-6)).toBe(true);
    });
  });

  describe('Pack and Unpack Behavior', () => {
    it('should compress information during pack stage', () => {
      const attention = new RealLunaAttention({
        dimension: 64,
        numHeads: 4,
        projectedLength: 4, // Very small projection
        seed: 42,
      });

      const seqLen = 32; // Large sequence
      const query = new Float32Array(seqLen * 64);
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      // Create distinct patterns in different parts of sequence
      for (let i = 0; i < seqLen; i++) {
        for (let d = 0; d < 64; d++) {
          const idx = i * 64 + d;
          if (i < seqLen / 2) {
            value[idx] = 1.0; // First half: positive
          } else {
            value[idx] = -1.0; // Second half: negative
          }
          query[idx] = Math.sin((i + d) * 0.1);
          key[idx] = Math.cos((i + d) * 0.1);
        }
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      // Output should be non-trivial (compression happened)
      expect(output.length).toBe(seqLen * 64);
      expect(output.some((x) => Math.abs(x) > 0.01)).toBe(true);
    });

    it('should preserve information with large projected length', () => {
      const attention = new RealLunaAttention({
        dimension: 64,
        numHeads: 4,
        projectedLength: 128, // Larger than sequence
        seed: 42,
      });

      const seqLen = 16;
      const query = new Float32Array(seqLen * 64);
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.2);
        key[i] = Math.cos(i * 0.2);
        value[i] = Math.tanh(i * 0.1);
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      // Should produce valid output
      expect(output.length).toBe(seqLen * 64);
      expect(output.some((x) => Math.abs(x) > 0.001)).toBe(true);
    });
  });

  describe('Validation', () => {
    it('should reject invalid sequence length', () => {
      const attention = new RealLunaAttention({ dimension: 64, numHeads: 4 });
      const query = new Float32Array(0);
      const key = new Float32Array(0);
      const value = new Float32Array(0);

      expect(() => attention.forward(query, key, value, undefined, 0)).toThrow(
        'ANTI-009: sequence length must be positive'
      );
    });

    it('should reject mismatched query length', () => {
      const attention = new RealLunaAttention({ dimension: 64, numHeads: 4 });
      const query = new Float32Array(100); // Wrong size
      const key = new Float32Array(8 * 64);
      const value = new Float32Array(8 * 64);

      expect(() => attention.forward(query, key, value, undefined, 8)).toThrow(
        'ANTI-009: query length mismatch'
      );
    });

    it('should reject mismatched key length', () => {
      const attention = new RealLunaAttention({ dimension: 64, numHeads: 4 });
      const query = new Float32Array(8 * 64);
      const key = new Float32Array(100); // Wrong size
      const value = new Float32Array(8 * 64);

      expect(() => attention.forward(query, key, value, undefined, 8)).toThrow(
        'ANTI-009: key length mismatch'
      );
    });

    it('should reject mismatched value length', () => {
      const attention = new RealLunaAttention({ dimension: 64, numHeads: 4 });
      const query = new Float32Array(8 * 64);
      const key = new Float32Array(8 * 64);
      const value = new Float32Array(100); // Wrong size

      expect(() => attention.forward(query, key, value, undefined, 8)).toThrow(
        'ANTI-009: value length mismatch'
      );
    });

    it('should reject mismatched mask length', () => {
      const attention = new RealLunaAttention({ dimension: 64, numHeads: 4 });
      const query = new Float32Array(8 * 64);
      const key = new Float32Array(8 * 64);
      const value = new Float32Array(8 * 64);
      const mask = new Array(5).fill(true); // Wrong size

      expect(() => attention.forward(query, key, value, mask, 8)).toThrow(
        'ANTI-009: mask length mismatch'
      );
    });
  });

  describe('Numerical Stability', () => {
    it('should handle very small values', () => {
      const attention = new RealLunaAttention({
        dimension: 64,
        numHeads: 4,
        projectedLength: 8,
        seed: 42,
      });

      const seqLen = 8;
      const query = new Float32Array(seqLen * 64).fill(1e-8);
      const key = new Float32Array(seqLen * 64).fill(1e-8);
      const value = new Float32Array(seqLen * 64).fill(1e-8);

      const output = attention.forward(query, key, value, undefined, seqLen);
      expect(output.every((x) => !isNaN(x) && isFinite(x))).toBe(true);
    });

    it('should handle large values', () => {
      const attention = new RealLunaAttention({
        dimension: 64,
        numHeads: 4,
        projectedLength: 8,
        seed: 42,
      });

      const seqLen = 8;
      const query = new Float32Array(seqLen * 64).fill(10.0);
      const key = new Float32Array(seqLen * 64).fill(10.0);
      const value = new Float32Array(seqLen * 64).fill(10.0);

      const output = attention.forward(query, key, value, undefined, seqLen);
      expect(output.every((x) => !isNaN(x) && isFinite(x))).toBe(true);
    });

    it('should handle mixed positive and negative values', () => {
      const attention = new RealLunaAttention({
        dimension: 64,
        numHeads: 4,
        projectedLength: 8,
        seed: 42,
      });

      const seqLen = 8;
      const query = new Float32Array(seqLen * 64);
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      for (let i = 0; i < query.length; i++) {
        query[i] = (i % 2 === 0 ? 1 : -1) * Math.random() * 5;
        key[i] = (i % 3 === 0 ? 1 : -1) * Math.random() * 5;
        value[i] = (i % 5 === 0 ? 1 : -1) * Math.random() * 5;
      }

      const output = attention.forward(query, key, value, undefined, seqLen);
      expect(output.every((x) => !isNaN(x) && isFinite(x))).toBe(true);
    });
  });

  describe('Determinism', () => {
    it('should produce identical results with same seed', () => {
      const attention1 = new RealLunaAttention({
        dimension: 64,
        numHeads: 4,
        projectedLength: 8,
        seed: 999,
      });

      const attention2 = new RealLunaAttention({
        dimension: 64,
        numHeads: 4,
        projectedLength: 8,
        seed: 999,
      });

      const seqLen = 12;
      const query = new Float32Array(seqLen * 64);
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = Math.tan(i * 0.05);
      }

      const output1 = attention1.forward(query, key, value, undefined, seqLen);
      const output2 = attention2.forward(query, key, value, undefined, seqLen);

      for (let i = 0; i < output1.length; i++) {
        expect(output1[i]).toBeCloseTo(output2[i], 10);
      }
    });

    it('should produce different results with different seeds', () => {
      const attention1 = new RealLunaAttention({
        dimension: 64,
        numHeads: 4,
        projectedLength: 8,
        seed: 100,
      });

      const attention2 = new RealLunaAttention({
        dimension: 64,
        numHeads: 4,
        projectedLength: 8,
        seed: 200,
      });

      const seqLen = 12;
      const query = new Float32Array(seqLen * 64);
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = Math.tan(i * 0.05);
      }

      const output1 = attention1.forward(query, key, value, undefined, seqLen);
      const output2 = attention2.forward(query, key, value, undefined, seqLen);

      let hasDifference = false;
      for (let i = 0; i < output1.length; i++) {
        if (Math.abs(output1[i] - output2[i]) > 1e-6) {
          hasDifference = true;
          break;
        }
      }
      expect(hasDifference).toBe(true);
    });
  });

  describe('Parameter Count', () => {
    it('should compute correct parameter count', () => {
      const config = {
        dimension: 768,
        numHeads: 12,
        projectedLength: 64,
      };
      const attention = new RealLunaAttention(config);

      // Pack projection: P × D
      const packParams = config.projectedLength * config.dimension;
      // Q, K, V, O projections: 4 × D × D
      const projParams = 4 * config.dimension * config.dimension;
      const expected = packParams + projParams;

      expect(attention.getParameterCount()).toBe(expected);
    });

    it('should scale parameters with projected length', () => {
      const base = new RealLunaAttention({
        dimension: 512,
        numHeads: 8,
        projectedLength: 32,
      });

      const large = new RealLunaAttention({
        dimension: 512,
        numHeads: 8,
        projectedLength: 128,
      });

      const diff = large.getParameterCount() - base.getParameterCount();
      const expectedDiff = (128 - 32) * 512; // Difference in pack projection only

      expect(diff).toBe(expectedDiff);
    });
  });

  describe('Output Dimensions', () => {
    it('should maintain correct output dimensions', () => {
      const configs = [
        { dimension: 64, numHeads: 4, projectedLength: 8, seqLen: 10 },
        { dimension: 128, numHeads: 8, projectedLength: 16, seqLen: 20 },
        { dimension: 256, numHeads: 16, projectedLength: 32, seqLen: 15 },
        { dimension: 512, numHeads: 8, projectedLength: 64, seqLen: 8 },
      ];

      for (const config of configs) {
        const attention = new RealLunaAttention({
          dimension: config.dimension,
          numHeads: config.numHeads,
          projectedLength: config.projectedLength,
          seed: 42,
        });

        const query = new Float32Array(config.seqLen * config.dimension);
        const key = new Float32Array(config.seqLen * config.dimension);
        const value = new Float32Array(config.seqLen * config.dimension);

        for (let i = 0; i < query.length; i++) {
          query[i] = Math.random() - 0.5;
          key[i] = Math.random() - 0.5;
          value[i] = Math.random() - 0.5;
        }

        const output = attention.forward(query, key, value, undefined, config.seqLen);
        expect(output.length).toBe(config.seqLen * config.dimension);
      }
    });
  });
});
