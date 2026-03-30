/**
 * Tests for Synthesizer Attention
 *
 * Validates:
 * - Core synthesized attention functionality
 * - Content-independent pattern generation
 * - Multi-head synthesis
 * - Mask handling
 * - Different sequence lengths
 * - Numerical stability
 * - Determinism
 * - Parameter counting
 * - Edge cases
 */

import { describe, it, expect } from 'vitest';
import { RealSynthesizerAttention } from '../../../../../src/god-agent/core/attention/mechanisms/synthesizer-attention.js';

describe('RealSynthesizerAttention', () => {
  describe('Core Functionality', () => {
    it('should synthesize attention patterns for single head', () => {
      const attention = new RealSynthesizerAttention({
        dimension: 64,
        numHeads: 1,
        maxSeqLen: 16,
        seed: 123,
      });

      const seqLen = 4;
      const dim = 64;

      // Create input tensors
      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      // Fill with test data
      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = Math.sin(i * 0.01);
        key[i] = Math.cos(i * 0.01);
        value[i] = (i % 10) / 10;
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      // Validate output shape
      expect(output.length).toBe(seqLen * dim);

      // Validate no NaN or Inf
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }

      // Output should be different from input (attention applied)
      let hasChange = false;
      for (let i = 0; i < output.length; i++) {
        if (Math.abs(output[i] - value[i]) > 1e-6) {
          hasChange = true;
          break;
        }
      }
      expect(hasChange).toBe(true);
    });

    it('should work with multiple heads', () => {
      const attention = new RealSynthesizerAttention({
        dimension: 128,
        numHeads: 4,
        maxSeqLen: 32,
        seed: 456,
      });

      const seqLen = 8;
      const dim = 128;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = (i % 7) / 7;
        key[i] = (i % 5) / 5;
        value[i] = Math.sin(i * 0.02);
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      expect(output.length).toBe(seqLen * dim);

      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });

    it('should handle different sequence lengths within maxSeqLen', () => {
      const attention = new RealSynthesizerAttention({
        dimension: 64,
        numHeads: 2,
        maxSeqLen: 64,
        seed: 789,
      });

      const dim = 64;
      const sequenceLengths = [2, 8, 16, 32];

      for (const seqLen of sequenceLengths) {
        const query = new Float32Array(seqLen * dim);
        const key = new Float32Array(seqLen * dim);
        const value = new Float32Array(seqLen * dim);

        for (let i = 0; i < seqLen * dim; i++) {
          query[i] = Math.random();
          key[i] = Math.random();
          value[i] = Math.random();
        }

        const output = attention.forward(query, key, value, undefined, seqLen);

        expect(output.length).toBe(seqLen * dim);
        for (let i = 0; i < output.length; i++) {
          expect(Number.isFinite(output[i])).toBe(true);
        }
      }
    });
  });

  describe('Synthesized Pattern Properties', () => {
    it('should generate content-dependent patterns (synthesizer uses input)', () => {
      const attention = new RealSynthesizerAttention({
        dimension: 64,
        numHeads: 1,
        maxSeqLen: 16,
        seed: 111,
      });

      const seqLen = 4;
      const dim = 64;

      // Create two different inputs
      const query1 = new Float32Array(seqLen * dim);
      const value1 = new Float32Array(seqLen * dim);
      const query2 = new Float32Array(seqLen * dim);
      const value2 = new Float32Array(seqLen * dim);

      // Use varied values so attention patterns create observable differences
      for (let i = 0; i < seqLen * dim; i++) {
        query1[i] = Math.sin(i * 0.1);
        value1[i] = (i % 10) / 10; // Varied values
        query2[i] = Math.sin(i * 0.1) * 5.0; // Scaled version - different magnitude
        value2[i] = (i % 10) / 10; // Same varied values
      }

      const output1 = attention.forward(query1, query1, value1, undefined, seqLen);
      const output2 = attention.forward(query2, query2, value2, undefined, seqLen);

      // Outputs should be different (patterns depend on input magnitude via learned network)
      let hasDifference = false;
      for (let i = 0; i < output1.length; i++) {
        if (Math.abs(output1[i] - output2[i]) > 1e-4) {
          hasDifference = true;
          break;
        }
      }
      expect(hasDifference).toBe(true);
    });

    it('should produce valid attention weights (implicitly tested via output)', () => {
      const attention = new RealSynthesizerAttention({
        dimension: 32,
        numHeads: 1,
        maxSeqLen: 8,
        seed: 222,
      });

      const seqLen = 4;
      const dim = 32;

      // Use one-hot values to test attention mixing
      const query = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      // Fill query with varying patterns
      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = Math.sin(i * 0.05);
      }

      // Set values as one-hot position indicators
      for (let i = 0; i < seqLen; i++) {
        value[i * dim + i] = 1.0; // Position indicator
      }

      const output = attention.forward(query, query, value, undefined, seqLen);

      // Output should be a mix (attention applied)
      expect(output.length).toBe(seqLen * dim);

      // Check that mixing occurred (output not sparse)
      let nonZeroCount = 0;
      for (let i = 0; i < output.length; i++) {
        if (Math.abs(output[i]) > 1e-6) {
          nonZeroCount++;
        }
      }
      expect(nonZeroCount).toBeGreaterThan(seqLen); // More than just position indicators
    });
  });

  describe('Mask Handling', () => {
    it('should apply attention mask correctly', () => {
      const attention = new RealSynthesizerAttention({
        dimension: 64,
        numHeads: 1,
        maxSeqLen: 16,
        seed: 333,
      });

      const seqLen = 4;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = (i % 10) / 10;
      }

      // Mask out last position
      const mask = [true, true, true, false];

      const outputMasked = attention.forward(query, key, value, mask, seqLen);
      const outputUnmasked = attention.forward(query, key, value, undefined, seqLen);

      // Outputs should differ
      let hasDifference = false;
      for (let i = 0; i < outputMasked.length; i++) {
        if (Math.abs(outputMasked[i] - outputUnmasked[i]) > 1e-5) {
          hasDifference = true;
          break;
        }
      }
      expect(hasDifference).toBe(true);

      // Both should be valid
      for (let i = 0; i < outputMasked.length; i++) {
        expect(Number.isFinite(outputMasked[i])).toBe(true);
        expect(Number.isFinite(outputUnmasked[i])).toBe(true);
      }
    });

    it('should handle all-masked positions gracefully', () => {
      const attention = new RealSynthesizerAttention({
        dimension: 32,
        numHeads: 1,
        maxSeqLen: 8,
        seed: 444,
      });

      const seqLen = 4;
      const dim = 32;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = 0.5;
        key[i] = 0.5;
        value[i] = 1.0;
      }

      // Mask all positions for first token
      const mask = [false, false, false, false];

      const output = attention.forward(query, key, value, mask, seqLen);

      // Should still produce valid output (uniform fallback)
      expect(output.length).toBe(seqLen * dim);
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });
  });

  describe('Numerical Stability', () => {
    it('should handle large input values', () => {
      const attention = new RealSynthesizerAttention({
        dimension: 64,
        numHeads: 2,
        maxSeqLen: 16,
        seed: 555,
      });

      const seqLen = 4;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = 100 * Math.sin(i * 0.1);
        key[i] = 100 * Math.cos(i * 0.1);
        value[i] = 50 * ((i % 10) / 10);
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      expect(output.length).toBe(seqLen * dim);
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });

    it('should handle small input values', () => {
      const attention = new RealSynthesizerAttention({
        dimension: 64,
        numHeads: 2,
        maxSeqLen: 16,
        seed: 666,
      });

      const seqLen = 4;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = 0.001 * Math.sin(i * 0.1);
        key[i] = 0.001 * Math.cos(i * 0.1);
        value[i] = 0.001 * ((i % 10) / 10);
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      expect(output.length).toBe(seqLen * dim);
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });

    it('should handle zero inputs', () => {
      const attention = new RealSynthesizerAttention({
        dimension: 32,
        numHeads: 1,
        maxSeqLen: 8,
        seed: 777,
      });

      const seqLen = 4;
      const dim = 32;

      const query = new Float32Array(seqLen * dim); // All zeros
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      const output = attention.forward(query, key, value, undefined, seqLen);

      expect(output.length).toBe(seqLen * dim);
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });
  });

  describe('Determinism', () => {
    it('should produce identical outputs with same seed', () => {
      const config = {
        dimension: 64,
        numHeads: 2,
        maxSeqLen: 16,
        seed: 888,
      };

      const attention1 = new RealSynthesizerAttention(config);
      const attention2 = new RealSynthesizerAttention(config);

      const seqLen = 4;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = Math.sin(i * 0.05);
        key[i] = Math.cos(i * 0.05);
        value[i] = (i % 7) / 7;
      }

      const output1 = attention1.forward(query, key, value, undefined, seqLen);
      const output2 = attention2.forward(query, key, value, undefined, seqLen);

      expect(output1.length).toBe(output2.length);
      for (let i = 0; i < output1.length; i++) {
        expect(output1[i]).toBeCloseTo(output2[i], 10);
      }
    });

    it('should produce different outputs with different seeds', () => {
      const attention1 = new RealSynthesizerAttention({
        dimension: 64,
        numHeads: 1,
        maxSeqLen: 16,
        seed: 999,
      });

      const attention2 = new RealSynthesizerAttention({
        dimension: 64,
        numHeads: 1,
        maxSeqLen: 16,
        seed: 1000,
      });

      const seqLen = 4;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = Math.sin(i * 0.05);
        key[i] = Math.cos(i * 0.05);
        value[i] = (i % 7) / 7;
      }

      const output1 = attention1.forward(query, key, value, undefined, seqLen);
      const output2 = attention2.forward(query, key, value, undefined, seqLen);

      let hasDifference = false;
      for (let i = 0; i < output1.length; i++) {
        if (Math.abs(output1[i] - output2[i]) > 1e-5) {
          hasDifference = true;
          break;
        }
      }
      expect(hasDifference).toBe(true);
    });
  });

  describe('Parameter Count', () => {
    it('should correctly calculate parameter count', () => {
      const dimension = 64;
      const numHeads = 2;
      const maxSeqLen = 32;
      const bottleneck = 32;

      const attention = new RealSynthesizerAttention({
        dimension,
        numHeads,
        maxSeqLen,
        bottleneck,
        seed: 1001,
      });

      const headDim = dimension / numHeads;

      // Per head: W1, b1, W2, b2, Wv
      const perHead =
        dimension * bottleneck +       // W1
        bottleneck +                   // b1
        bottleneck * maxSeqLen +       // W2
        maxSeqLen +                    // b2
        dimension * headDim;           // Wv

      // Shared: Wo
      const shared = dimension * dimension;

      const expected = perHead * numHeads + shared;
      const actual = attention.getParameterCount();

      expect(actual).toBe(expected);
    });

    it('should scale parameters with configuration', () => {
      const configs = [
        { dimension: 32, numHeads: 1, maxSeqLen: 16, bottleneck: 16 },
        { dimension: 64, numHeads: 2, maxSeqLen: 32, bottleneck: 32 },
        { dimension: 128, numHeads: 4, maxSeqLen: 64, bottleneck: 64 },
      ];

      const paramCounts = configs.map((config) => {
        const attention = new RealSynthesizerAttention(config);
        return attention.getParameterCount();
      });

      // Larger configs should have more parameters
      expect(paramCounts[1]).toBeGreaterThan(paramCounts[0]);
      expect(paramCounts[2]).toBeGreaterThan(paramCounts[1]);
    });
  });

  describe('Edge Cases and Validation', () => {
    it('should reject sequence length exceeding maxSeqLen', () => {
      const attention = new RealSynthesizerAttention({
        dimension: 64,
        numHeads: 1,
        maxSeqLen: 8,
        seed: 1002,
      });

      const seqLen = 16; // Exceeds maxSeqLen
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      expect(() => {
        attention.forward(query, key, value, undefined, seqLen);
      }).toThrow(/ANTI-009.*maxSeqLen/);
    });

    it('should reject invalid configuration', () => {
      expect(() => {
        new RealSynthesizerAttention({ dimension: 0 });
      }).toThrow(/ANTI-009.*dimension/);

      expect(() => {
        new RealSynthesizerAttention({ dimension: 64, numHeads: 0 });
      }).toThrow(/ANTI-009.*numHeads/);

      expect(() => {
        new RealSynthesizerAttention({ dimension: 65, numHeads: 2 });
      }).toThrow(/ANTI-009.*divisible/);

      expect(() => {
        new RealSynthesizerAttention({ dimension: 64, numHeads: 8, maxSeqLen: 0 });
      }).toThrow(/ANTI-009.*maxSeqLen/);

      expect(() => {
        new RealSynthesizerAttention({ dimension: 64, numHeads: 8, bottleneck: 0 });
      }).toThrow(/ANTI-009.*bottleneck/);
    });

    it('should reject inputs with NaN or Inf', () => {
      const attention = new RealSynthesizerAttention({
        dimension: 32,
        numHeads: 1,
        maxSeqLen: 8,
        seed: 1003,
      });

      const seqLen = 4;
      const dim = 32;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      // Valid input first
      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = 0.5;
        key[i] = 0.5;
        value[i] = 0.5;
      }

      // Inject NaN
      query[0] = NaN;
      expect(() => {
        attention.forward(query, key, value, undefined, seqLen);
      }).toThrow(/ANTI-009.*NaN/);

      // Reset and inject Inf
      query[0] = 0.5;
      value[0] = Infinity;
      expect(() => {
        attention.forward(query, key, value, undefined, seqLen);
      }).toThrow(/ANTI-009.*Inf/);
    });

    it('should reject missing or invalid seqLen', () => {
      const attention = new RealSynthesizerAttention({
        dimension: 32,
        numHeads: 1,
        maxSeqLen: 8,
        seed: 1004,
      });

      const dim = 32;
      const query = new Float32Array(4 * dim);
      const key = new Float32Array(4 * dim);
      const value = new Float32Array(4 * dim);

      expect(() => {
        attention.forward(query, key, value, undefined, undefined as any);
      }).toThrow(/ANTI-009.*seqLen/);

      expect(() => {
        attention.forward(query, key, value, undefined, 0);
      }).toThrow(/ANTI-009.*seqLen/);
    });

    it('should reject mismatched input lengths', () => {
      const attention = new RealSynthesizerAttention({
        dimension: 32,
        numHeads: 1,
        maxSeqLen: 8,
        seed: 1005,
      });

      const seqLen = 4;
      const dim = 32;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array((seqLen - 1) * dim); // Wrong length

      expect(() => {
        attention.forward(query, key, value, undefined, seqLen);
      }).toThrow(/ANTI-009.*value length/);
    });

    it('should reject mismatched mask length', () => {
      const attention = new RealSynthesizerAttention({
        dimension: 32,
        numHeads: 1,
        maxSeqLen: 8,
        seed: 1006,
      });

      const seqLen = 4;
      const dim = 32;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);
      const mask = [true, true, true]; // Wrong length

      expect(() => {
        attention.forward(query, key, value, mask, seqLen);
      }).toThrow(/ANTI-009.*mask length/);
    });
  });

  describe('Different Bottleneck Sizes', () => {
    it('should work with small bottleneck', () => {
      const attention = new RealSynthesizerAttention({
        dimension: 64,
        numHeads: 1,
        maxSeqLen: 16,
        bottleneck: 8,
        seed: 1007,
      });

      const seqLen = 4;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = (i % 5) / 5;
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      expect(output.length).toBe(seqLen * dim);
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });

    it('should work with large bottleneck', () => {
      const attention = new RealSynthesizerAttention({
        dimension: 64,
        numHeads: 1,
        maxSeqLen: 16,
        bottleneck: 128,
        seed: 1008,
      });

      const seqLen = 4;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = (i % 5) / 5;
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      expect(output.length).toBe(seqLen * dim);
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });
  });
});
