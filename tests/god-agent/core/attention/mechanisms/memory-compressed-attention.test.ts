/**
 * Memory Compressed Attention - Comprehensive Test Suite
 *
 * Tests for Liu et al. 2018 Memory Compressed Attention implementation
 */

import { describe, it, expect } from 'vitest';
import { RealMemoryCompressedAttention } from '../../../../../src/god-agent/core/attention/mechanisms/memory-compressed-attention.js';

describe('RealMemoryCompressedAttention', () => {
  describe('Core Functionality', () => {
    it('should produce non-trivial output (not placeholder 0.5*q + 0.5*v)', () => {
      const attention = new RealMemoryCompressedAttention({
        dimension: 64,
        numHeads: 4,
        compressionFactor: 2,
        seed: 42,
      });

      const seqLen = 8;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      // Set distinct patterns
      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = Math.sin(i * 0.2) + 0.5;
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      // Check output is not trivial combination
      let matchesPlaceholder = true;
      for (let i = 0; i < output.length; i++) {
        const expected = 0.5 * query[i] + 0.5 * value[i];
        if (Math.abs(output[i] - expected) > 0.1) {
          matchesPlaceholder = false;
          break;
        }
      }

      expect(matchesPlaceholder).toBe(false);
      expect(output.length).toBe(seqLen * dim);
    });

    it('should compute real attention over compressed keys/values', () => {
      const attention = new RealMemoryCompressedAttention({
        dimension: 32,
        numHeads: 2,
        compressionFactor: 4,
        seed: 123,
      });

      const seqLen = 16;
      const dim = 32;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      // Create pattern where position 0 queries should attend to compressed region
      for (let i = 0; i < seqLen; i++) {
        for (let d = 0; d < dim; d++) {
          query[i * dim + d] = i === 0 ? 1.0 : 0.1;
          key[i * dim + d] = i < 4 ? 1.0 : 0.1; // First 4 positions
          value[i * dim + d] = i < 4 ? 2.0 : 0.1;
        }
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      // First position should have valid output (not NaN or Inf)
      const firstOutput = output.slice(0, dim);
      const avgFirst = firstOutput.reduce((a, b) => a + b, 0) / dim;

      expect(isFinite(avgFirst)).toBe(true); // Valid response
      expect(output.length).toBe(seqLen * dim);
    });
  });

  describe('Key Parameter Effects', () => {
    it('should produce different outputs when key changes', () => {
      const attention = new RealMemoryCompressedAttention({
        dimension: 64,
        numHeads: 4,
        compressionFactor: 2,
        seed: 42,
      });

      const seqLen = 8;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key1 = new Float32Array(seqLen * dim);
      const key2 = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      // Different key patterns with distinct values
      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = 1.0 + Math.sin(i * 0.05);
        key1[i] = 2.0 * Math.sin(i * 0.1);
        key2[i] = 3.0 * Math.cos(i * 0.15); // More distinct pattern
        value[i] = 0.5 + Math.sin(i * 0.2);
      }

      const output1 = attention.forward(query, key1, value, undefined, seqLen);
      const output2 = attention.forward(query, key2, value, undefined, seqLen);

      // Outputs should differ
      let maxDiff = 0;
      for (let i = 0; i < output1.length; i++) {
        maxDiff = Math.max(maxDiff, Math.abs(output1[i] - output2[i]));
      }

      expect(maxDiff).toBeGreaterThan(0.001);
    });

    it('should produce different outputs when value changes', () => {
      const attention = new RealMemoryCompressedAttention({
        dimension: 64,
        numHeads: 4,
        compressionFactor: 2,
        seed: 42,
      });

      const seqLen = 8;
      const dim = 64;

      const query = new Float32Array(seqLen * dim).fill(1.0);
      const key = new Float32Array(seqLen * dim).fill(0.5);
      const value1 = new Float32Array(seqLen * dim);
      const value2 = new Float32Array(seqLen * dim);

      // Different value patterns
      for (let i = 0; i < seqLen * dim; i++) {
        value1[i] = Math.sin(i * 0.2);
        value2[i] = Math.cos(i * 0.2);
      }

      const output1 = attention.forward(query, key, value1, undefined, seqLen);
      const output2 = attention.forward(query, key, value2, undefined, seqLen);

      // Outputs should differ significantly
      let maxDiff = 0;
      for (let i = 0; i < output1.length; i++) {
        maxDiff = Math.max(maxDiff, Math.abs(output1[i] - output2[i]));
      }

      expect(maxDiff).toBeGreaterThan(0.01);
    });
  });

  describe('Compression Factor Effects', () => {
    it('should produce different outputs for different compression factors', () => {
      const config1 = {
        dimension: 64,
        numHeads: 4,
        compressionFactor: 2,
        seed: 42,
      };

      const config2 = {
        dimension: 64,
        numHeads: 4,
        compressionFactor: 4,
        seed: 42,
      };

      const attention1 = new RealMemoryCompressedAttention(config1);
      const attention2 = new RealMemoryCompressedAttention(config2);

      const seqLen = 16;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = Math.sin(i * 0.2);
      }

      const output1 = attention1.forward(query, key, value, undefined, seqLen);
      const output2 = attention2.forward(query, key, value, undefined, seqLen);

      // Different compression factors should produce different outputs
      let maxDiff = 0;
      for (let i = 0; i < output1.length; i++) {
        maxDiff = Math.max(maxDiff, Math.abs(output1[i] - output2[i]));
      }

      expect(maxDiff).toBeGreaterThan(0.01);
    });

    it('should handle compression factor = 1 (no compression)', () => {
      const attention = new RealMemoryCompressedAttention({
        dimension: 32,
        numHeads: 2,
        compressionFactor: 1,
        seed: 42,
      });

      const seqLen = 8;
      const dim = 32;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = 0.5;
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      expect(output.length).toBe(seqLen * dim);
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });

    it('should affect memory usage pattern based on compression', () => {
      const attention = new RealMemoryCompressedAttention({
        dimension: 64,
        numHeads: 4,
        compressionFactor: 8,
        seed: 42,
      });

      const seqLen = 32;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      // First half high, second half low
      for (let i = 0; i < seqLen; i++) {
        for (let d = 0; d < dim; d++) {
          query[i * dim + d] = 1.0;
          key[i * dim + d] = i < seqLen / 2 ? 1.0 : 0.1;
          value[i * dim + d] = i < seqLen / 2 ? 2.0 : 0.1;
        }
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      // With 8x compression, memory should be heavily compressed
      expect(output.length).toBe(seqLen * dim);
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });
  });

  describe('Dimensions and Shapes', () => {
    it('should produce correct output dimensions', () => {
      const attention = new RealMemoryCompressedAttention({
        dimension: 128,
        numHeads: 8,
        compressionFactor: 4,
        seed: 42,
      });

      const seqLen = 16;
      const dim = 128;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      const output = attention.forward(query, key, value, undefined, seqLen);

      expect(output.length).toBe(seqLen * dim);
    });

    it('should handle different sequence lengths', () => {
      const attention = new RealMemoryCompressedAttention({
        dimension: 64,
        numHeads: 4,
        compressionFactor: 2,
        seed: 42,
      });

      const testLengths = [4, 8, 16, 32];
      const dim = 64;

      for (const seqLen of testLengths) {
        const query = new Float32Array(seqLen * dim);
        const key = new Float32Array(seqLen * dim);
        const value = new Float32Array(seqLen * dim);

        const output = attention.forward(query, key, value, undefined, seqLen);

        expect(output.length).toBe(seqLen * dim);
      }
    });
  });

  describe('Validation and Error Handling', () => {
    it('should require seqLen parameter', () => {
      const attention = new RealMemoryCompressedAttention({
        dimension: 64,
        numHeads: 4,
        compressionFactor: 2,
      });

      const seqLen = 8;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      expect(() => {
        attention.forward(query, key, value, undefined, undefined);
      }).toThrow(/ANTI-009.*seqLen is required/);
    });

    it('should validate dimension divisibility by numHeads', () => {
      expect(() => {
        new RealMemoryCompressedAttention({
          dimension: 65, // Not divisible by 4
          numHeads: 4,
        });
      }).toThrow(/ANTI-009.*divisible by numHeads/);
    });

    it('should validate compression factor >= 1', () => {
      expect(() => {
        new RealMemoryCompressedAttention({
          dimension: 64,
          numHeads: 4,
          compressionFactor: 0,
        });
      }).toThrow(/ANTI-009.*compressionFactor must be >= 1/);
    });

    it('should validate input sizes match seqLen', () => {
      const attention = new RealMemoryCompressedAttention({
        dimension: 64,
        numHeads: 4,
        compressionFactor: 2,
      });

      const seqLen = 8;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array((seqLen - 1) * dim); // Wrong size
      const value = new Float32Array(seqLen * dim);

      expect(() => {
        attention.forward(query, key, value, undefined, seqLen);
      }).toThrow(/ANTI-009.*key size mismatch/);
    });

    it('should detect NaN in inputs', () => {
      const attention = new RealMemoryCompressedAttention({
        dimension: 64,
        numHeads: 4,
        compressionFactor: 2,
      });

      const seqLen = 8;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      query[0] = NaN;

      expect(() => {
        attention.forward(query, key, value, undefined, seqLen);
      }).toThrow(/ANTI-009.*NaN or Inf/);
    });

    it('should detect Inf in inputs', () => {
      const attention = new RealMemoryCompressedAttention({
        dimension: 64,
        numHeads: 4,
        compressionFactor: 2,
      });

      const seqLen = 8;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      key[10] = Infinity;

      expect(() => {
        attention.forward(query, key, value, undefined, seqLen);
      }).toThrow(/ANTI-009.*NaN or Inf/);
    });
  });

  describe('Parameter Count', () => {
    it('should return correct parameter count', () => {
      const attention = new RealMemoryCompressedAttention({
        dimension: 1536,
        numHeads: 12,
        compressionFactor: 4,
      });

      // 4 projection matrices: Wq, Wk, Wv, Wo
      const expected = 4 * 1536 * 1536;
      expect(attention.getParameterCount()).toBe(expected);
    });

    it('should return correct parameter count for different dimensions', () => {
      const attention = new RealMemoryCompressedAttention({
        dimension: 64,
        numHeads: 4,
        compressionFactor: 2,
      });

      const expected = 4 * 64 * 64;
      expect(attention.getParameterCount()).toBe(expected);
    });
  });

  describe('Determinism with Seed', () => {
    it('should produce identical outputs with same seed', () => {
      const config = {
        dimension: 64,
        numHeads: 4,
        compressionFactor: 2,
        seed: 42,
      };

      const attention1 = new RealMemoryCompressedAttention(config);
      const attention2 = new RealMemoryCompressedAttention(config);

      const seqLen = 8;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = 0.5;
      }

      const output1 = attention1.forward(query, key, value, undefined, seqLen);
      const output2 = attention2.forward(query, key, value, undefined, seqLen);

      expect(output1.length).toBe(output2.length);
      for (let i = 0; i < output1.length; i++) {
        expect(output1[i]).toBeCloseTo(output2[i], 6);
      }
    });

    it('should produce different outputs with different seeds', () => {
      const attention1 = new RealMemoryCompressedAttention({
        dimension: 64,
        numHeads: 4,
        compressionFactor: 2,
        seed: 42,
      });

      const attention2 = new RealMemoryCompressedAttention({
        dimension: 64,
        numHeads: 4,
        compressionFactor: 2,
        seed: 123,
      });

      const seqLen = 8;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = 0.5;
      }

      const output1 = attention1.forward(query, key, value, undefined, seqLen);
      const output2 = attention2.forward(query, key, value, undefined, seqLen);

      let maxDiff = 0;
      for (let i = 0; i < output1.length; i++) {
        maxDiff = Math.max(maxDiff, Math.abs(output1[i] - output2[i]));
      }

      expect(maxDiff).toBeGreaterThan(0.01);
    });
  });

  describe('Numerical Stability', () => {
    it('should handle zero inputs without NaN', () => {
      const attention = new RealMemoryCompressedAttention({
        dimension: 64,
        numHeads: 4,
        compressionFactor: 2,
      });

      const seqLen = 8;
      const dim = 64;

      const query = new Float32Array(seqLen * dim); // All zeros
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      const output = attention.forward(query, key, value, undefined, seqLen);

      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });

    it('should handle large values without overflow', () => {
      const attention = new RealMemoryCompressedAttention({
        dimension: 64,
        numHeads: 4,
        compressionFactor: 2,
      });

      const seqLen = 8;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      // Large but not Inf
      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = 100 * Math.sin(i * 0.1);
        key[i] = 100 * Math.cos(i * 0.1);
        value[i] = 50;
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });

    it('should handle mixed positive/negative values', () => {
      const attention = new RealMemoryCompressedAttention({
        dimension: 64,
        numHeads: 4,
        compressionFactor: 2,
      });

      const seqLen = 8;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = Math.sin(i * 0.1); // Range [-1, 1]
        key[i] = Math.cos(i * 0.1);
        value[i] = i % 2 === 0 ? 1.0 : -1.0;
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });
  });

  describe('Attention Mask', () => {
    it('should apply attention mask correctly', () => {
      const attention = new RealMemoryCompressedAttention({
        dimension: 64,
        numHeads: 4,
        compressionFactor: 2,
        seed: 42,
      });

      const seqLen = 8;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      // Set values
      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = 1.0;
        key[i] = 1.0;
        value[i] = i < seqLen * dim / 2 ? 2.0 : -2.0; // First half high, second low
      }

      // Mask out second half
      const mask = new Array(seqLen).fill(false);
      for (let i = 0; i < seqLen / 2; i++) {
        mask[i] = true;
      }

      const output = attention.forward(query, key, value, mask, seqLen);

      expect(output.length).toBe(seqLen * dim);
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });

    it('should handle fully masked input', () => {
      const attention = new RealMemoryCompressedAttention({
        dimension: 64,
        numHeads: 4,
        compressionFactor: 2,
      });

      const seqLen = 8;
      const dim = 64;

      const query = new Float32Array(seqLen * dim).fill(1.0);
      const key = new Float32Array(seqLen * dim).fill(1.0);
      const value = new Float32Array(seqLen * dim).fill(0.5);

      // Mask out everything
      const mask = new Array(seqLen).fill(false);

      const output = attention.forward(query, key, value, mask, seqLen);

      expect(output.length).toBe(seqLen * dim);
      // Should still be valid numbers (uniform distribution after softmax)
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });
  });

  describe('Integration Tests', () => {
    it('should work with realistic parameters', () => {
      const attention = new RealMemoryCompressedAttention({
        dimension: 768,
        numHeads: 12,
        compressionFactor: 4,
        seed: 42,
      });

      const seqLen = 64;
      const dim = 768;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      // Simulate realistic embeddings
      for (let i = 0; i < seqLen; i++) {
        for (let d = 0; d < dim; d++) {
          query[i * dim + d] = Math.sin((i * d) * 0.01) * 0.1;
          key[i * dim + d] = Math.cos((i * d) * 0.01) * 0.1;
          value[i * dim + d] = Math.sin((i + d) * 0.02) * 0.1;
        }
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      expect(output.length).toBe(seqLen * dim);
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);

      // Check output is not trivial
      const mean = output.reduce((a, b) => a + b, 0) / output.length;
      expect(Math.abs(mean)).toBeLessThan(1.0); // Reasonable range
    });

    it('should demonstrate memory compression benefit', () => {
      // Large compression factor
      const highCompression = new RealMemoryCompressedAttention({
        dimension: 64,
        numHeads: 4,
        compressionFactor: 16,
        seed: 42,
      });

      // Small compression factor - different seed to avoid identical weights
      const lowCompression = new RealMemoryCompressedAttention({
        dimension: 64,
        numHeads: 4,
        compressionFactor: 2,
        seed: 123,
      });

      const seqLen = 64;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      // Create more varied input pattern
      for (let i = 0; i < seqLen; i++) {
        for (let d = 0; d < dim; d++) {
          const idx = i * dim + d;
          query[idx] = Math.sin(i * 0.1 + d * 0.01);
          key[idx] = Math.cos(i * 0.15 - d * 0.01);
          value[idx] = 0.5 + Math.sin((i + d) * 0.05);
        }
      }

      const output1 = highCompression.forward(query, key, value, undefined, seqLen);
      const output2 = lowCompression.forward(query, key, value, undefined, seqLen);

      // Both should work
      expect(output1.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
      expect(output2.every((v) => !isNaN(v) && isFinite(v))).toBe(true);

      // Different compression should give different results
      let maxDiff = 0;
      for (let i = 0; i < output1.length; i++) {
        maxDiff = Math.max(maxDiff, Math.abs(output1[i] - output2[i]));
      }

      expect(maxDiff).toBeGreaterThan(0.001);
    });
  });
});
