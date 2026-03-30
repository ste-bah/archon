/**
 * Tests for Clustered Attention Mechanism
 */

import { describe, it, expect } from 'vitest';
import { RealClusteredAttention } from '../../../../../src/god-agent/core/attention/mechanisms/clustered-attention.js';

describe('RealClusteredAttention', () => {
  describe('Core Functionality', () => {
    it('should produce non-trivial output (not placeholder)', () => {
      const attention = new RealClusteredAttention({
        dimension: 64,
        numHeads: 4,
        numClusters: 8,
        seed: 42,
      });

      const seqLen = 16;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      // Initialize with distinct patterns
      for (let i = 0; i < seqLen; i++) {
        for (let d = 0; d < dim; d++) {
          query[i * dim + d] = Math.sin((i + 1) * (d + 1) * 0.1);
          key[i * dim + d] = Math.cos((i + 1) * (d + 1) * 0.1);
          value[i * dim + d] = Math.sin((i + 1) * (d + 1) * 0.05);
        }
      }

      const output = attention.forward(query, key, value);

      expect(output.length).toBe(seqLen * dim);

      // Should NOT be 0.5*q + 0.5*v
      let isPlaceholder = true;
      for (let i = 0; i < 100 && i < output.length; i++) {
        const expected = 0.5 * query[i] + 0.5 * value[i];
        if (Math.abs(output[i] - expected) > 0.01) {
          isPlaceholder = false;
          break;
        }
      }
      expect(isPlaceholder).toBe(false);

      // Should be non-zero
      let hasNonZero = false;
      for (let i = 0; i < output.length; i++) {
        if (Math.abs(output[i]) > 1e-6) {
          hasNonZero = true;
          break;
        }
      }
      expect(hasNonZero).toBe(true);
    });

    it('should be affected by key values (not just query)', () => {
      const attention = new RealClusteredAttention({
        dimension: 64,
        numHeads: 4,
        numClusters: 8,
        seed: 42,
      });

      const seqLen = 16;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key1 = new Float32Array(seqLen * dim);
      const key2 = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = Math.sin(i * 0.1);
        key1[i] = Math.cos(i * 0.1);
        key2[i] = Math.sin(i * 0.2); // Different pattern
        value[i] = Math.sin(i * 0.05);
      }

      const output1 = attention.forward(query, key1, value);
      const output2 = attention.forward(query, key2, value);

      // Outputs should differ significantly
      let maxDiff = 0;
      for (let i = 0; i < output1.length; i++) {
        maxDiff = Math.max(maxDiff, Math.abs(output1[i] - output2[i]));
      }
      expect(maxDiff).toBeGreaterThan(0.01);
    });

    it('should produce different patterns with different numClusters', () => {
      const seqLen = 32;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen; i++) {
        for (let d = 0; d < dim; d++) {
          query[i * dim + d] = Math.sin((i + 1) * (d + 1) * 0.1);
          key[i * dim + d] = Math.cos((i + 1) * (d + 1) * 0.1);
          value[i * dim + d] = Math.sin((i + 1) * (d + 1) * 0.05);
        }
      }

      const attention4 = new RealClusteredAttention({
        dimension: dim,
        numHeads: 4,
        numClusters: 4,
        seed: 42,
      });

      const attention16 = new RealClusteredAttention({
        dimension: dim,
        numHeads: 4,
        numClusters: 16,
        seed: 42,
      });

      const output4 = attention4.forward(query, key, value);
      const output16 = attention16.forward(query, key, value);

      // Different clustering should produce different outputs
      let maxDiff = 0;
      for (let i = 0; i < output4.length; i++) {
        maxDiff = Math.max(maxDiff, Math.abs(output4[i] - output16[i]));
      }
      expect(maxDiff).toBeGreaterThan(0.01);
    });
  });

  describe('Clustering Behavior', () => {
    it('should handle numClusters > seqLen gracefully', () => {
      const attention = new RealClusteredAttention({
        dimension: 64,
        numHeads: 4,
        numClusters: 100, // More clusters than sequence length
        seed: 42,
      });

      const seqLen = 8;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = Math.sin(i * 0.05);
      }

      expect(() => {
        attention.forward(query, key, value);
      }).not.toThrow();
    });

    it('should produce consistent clustering with same inputs', () => {
      const attention = new RealClusteredAttention({
        dimension: 64,
        numHeads: 4,
        numClusters: 8,
        seed: 42,
      });

      const seqLen = 16;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = Math.sin(i * 0.05);
      }

      const output1 = attention.forward(query, key, value);
      const output2 = attention.forward(query, key, value);

      // Should be deterministic
      for (let i = 0; i < output1.length; i++) {
        expect(output1[i]).toBeCloseTo(output2[i], 6);
      }
    });
  });

  describe('Output Dimensions', () => {
    it('should return correct output dimensions', () => {
      const attention = new RealClusteredAttention({
        dimension: 128,
        numHeads: 8,
        numClusters: 16,
      });

      const seqLen = 24;
      const dim = 128;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      const output = attention.forward(query, key, value);

      expect(output.length).toBe(seqLen * dim);
    });

    it('should handle varying sequence lengths', () => {
      const attention = new RealClusteredAttention({
        dimension: 64,
        numHeads: 4,
        numClusters: 8,
      });

      const dim = 64;

      for (const seqLen of [4, 8, 16, 32]) {
        const query = new Float32Array(seqLen * dim);
        const key = new Float32Array(seqLen * dim);
        const value = new Float32Array(seqLen * dim);

        const output = attention.forward(query, key, value);
        expect(output.length).toBe(seqLen * dim);
      }
    });
  });

  describe('Validation', () => {
    it('should throw on mismatched input lengths', () => {
      const attention = new RealClusteredAttention({
        dimension: 64,
        numHeads: 4,
        numClusters: 8,
      });

      const query = new Float32Array(64 * 8);
      const key = new Float32Array(64 * 4); // Different length
      const value = new Float32Array(64 * 8);

      expect(() => {
        attention.forward(query, key, value);
      }).toThrow(/ANTI-009/);
    });

    it('should throw on dimension not divisible by numHeads', () => {
      expect(() => {
        new RealClusteredAttention({
          dimension: 65, // Not divisible by 4
          numHeads: 4,
          numClusters: 8,
        });
      }).toThrow(/ANTI-009.*divisible/);
    });

    it('should throw on invalid numClusters', () => {
      expect(() => {
        new RealClusteredAttention({
          dimension: 64,
          numHeads: 4,
          numClusters: 0,
        });
      }).toThrow(/ANTI-009/);
    });

    it('should throw on input length not multiple of dimension', () => {
      const attention = new RealClusteredAttention({
        dimension: 64,
        numHeads: 4,
        numClusters: 8,
      });

      const query = new Float32Array(100); // Not a multiple of 64
      const key = new Float32Array(100);
      const value = new Float32Array(100);

      expect(() => {
        attention.forward(query, key, value);
      }).toThrow(/ANTI-009/);
    });

    it('should throw on seqLen exceeding actual length', () => {
      const attention = new RealClusteredAttention({
        dimension: 64,
        numHeads: 4,
        numClusters: 8,
      });

      const seqLen = 8;
      const query = new Float32Array(seqLen * 64);
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      expect(() => {
        attention.forward(query, key, value, undefined, 16); // seqLen > actual
      }).toThrow(/ANTI-009/);
    });

    it('should throw on mask length mismatch', () => {
      const attention = new RealClusteredAttention({
        dimension: 64,
        numHeads: 4,
        numClusters: 8,
      });

      const seqLen = 8;
      const query = new Float32Array(seqLen * 64);
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);
      const mask = new Array(4).fill(true); // Wrong length

      expect(() => {
        attention.forward(query, key, value, mask);
      }).toThrow(/ANTI-009/);
    });
  });

  describe('Parameter Count', () => {
    it('should return correct parameter count', () => {
      const attention = new RealClusteredAttention({
        dimension: 64,
        numHeads: 4,
        numClusters: 8,
      });

      const count = attention.getParameterCount();
      // 4 projection matrices: Wq, Wk, Wv, Wo (each 64x64)
      expect(count).toBe(4 * 64 * 64);
    });

    it('should scale parameter count with dimension', () => {
      const attention1 = new RealClusteredAttention({
        dimension: 64,
        numHeads: 4,
        numClusters: 8,
      });

      const attention2 = new RealClusteredAttention({
        dimension: 128,
        numHeads: 8,
        numClusters: 16,
      });

      const count1 = attention1.getParameterCount();
      const count2 = attention2.getParameterCount();

      // 128 is 2x larger, so count should be 4x larger (quadratic)
      expect(count2).toBe(count1 * 4);
    });
  });

  describe('Determinism', () => {
    it('should produce same output with same seed', () => {
      const attention1 = new RealClusteredAttention({
        dimension: 64,
        numHeads: 4,
        numClusters: 8,
        seed: 42,
      });

      const attention2 = new RealClusteredAttention({
        dimension: 64,
        numHeads: 4,
        numClusters: 8,
        seed: 42,
      });

      const seqLen = 16;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = Math.sin(i * 0.05);
      }

      const output1 = attention1.forward(query, key, value);
      const output2 = attention2.forward(query, key, value);

      for (let i = 0; i < output1.length; i++) {
        expect(output1[i]).toBeCloseTo(output2[i], 6);
      }
    });

    it('should produce different output with different seeds', () => {
      const attention1 = new RealClusteredAttention({
        dimension: 64,
        numHeads: 4,
        numClusters: 8,
        seed: 42,
      });

      const attention2 = new RealClusteredAttention({
        dimension: 64,
        numHeads: 4,
        numClusters: 8,
        seed: 123,
      });

      const seqLen = 16;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = Math.sin(i * 0.05);
      }

      const output1 = attention1.forward(query, key, value);
      const output2 = attention2.forward(query, key, value);

      let hasDiff = false;
      for (let i = 0; i < output1.length; i++) {
        if (Math.abs(output1[i] - output2[i]) > 1e-6) {
          hasDiff = true;
          break;
        }
      }
      expect(hasDiff).toBe(true);
    });
  });

  describe('Numerical Stability', () => {
    it('should handle zero inputs', () => {
      const attention = new RealClusteredAttention({
        dimension: 64,
        numHeads: 4,
        numClusters: 8,
      });

      const seqLen = 8;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      const output = attention.forward(query, key, value);

      expect(output.length).toBe(seqLen * dim);
      for (let i = 0; i < output.length; i++) {
        expect(isNaN(output[i])).toBe(false);
        expect(isFinite(output[i])).toBe(true);
      }
    });

    it('should handle large inputs without overflow', () => {
      const attention = new RealClusteredAttention({
        dimension: 64,
        numHeads: 4,
        numClusters: 8,
      });

      const seqLen = 8;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = 10.0;
        key[i] = 10.0;
        value[i] = 10.0;
      }

      const output = attention.forward(query, key, value);

      for (let i = 0; i < output.length; i++) {
        expect(isNaN(output[i])).toBe(false);
        expect(isFinite(output[i])).toBe(true);
      }
    });

    it('should handle small inputs without underflow', () => {
      const attention = new RealClusteredAttention({
        dimension: 64,
        numHeads: 4,
        numClusters: 8,
      });

      const seqLen = 8;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = 1e-6;
        key[i] = 1e-6;
        value[i] = 1e-6;
      }

      const output = attention.forward(query, key, value);

      for (let i = 0; i < output.length; i++) {
        expect(isNaN(output[i])).toBe(false);
        expect(isFinite(output[i])).toBe(true);
      }
    });
  });

  describe('Mask Application', () => {
    it('should zero out masked positions', () => {
      const attention = new RealClusteredAttention({
        dimension: 64,
        numHeads: 4,
        numClusters: 8,
      });

      const seqLen = 8;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = Math.sin(i * 0.05);
      }

      const mask = new Array(seqLen).fill(true);
      mask[3] = false; // Mask out position 3

      const output = attention.forward(query, key, value, mask);

      // Position 3 should be all zeros
      for (let d = 0; d < dim; d++) {
        expect(output[3 * dim + d]).toBeCloseTo(0, 6);
      }

      // Other positions should be non-zero
      let hasNonZero = false;
      for (let i = 0; i < seqLen; i++) {
        if (i === 3) continue;
        for (let d = 0; d < dim; d++) {
          if (Math.abs(output[i * dim + d]) > 1e-6) {
            hasNonZero = true;
            break;
          }
        }
      }
      expect(hasNonZero).toBe(true);
    });
  });
});
