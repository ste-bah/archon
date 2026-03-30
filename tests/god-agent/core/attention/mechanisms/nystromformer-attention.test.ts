/**
 * Tests for Nyströmformer Attention Mechanism
 */

import { describe, it, expect } from 'vitest';
import { RealNystromformerAttention } from '../../../../../src/god-agent/core/attention/mechanisms/nystromformer-attention.js';

describe('RealNystromformerAttention', () => {
  describe('Initialization', () => {
    it('should initialize with default config', () => {
      const attention = new RealNystromformerAttention();
      expect(attention.name).toBe('nystromformer');
      expect(attention.getParameterCount()).toBe(4 * 1536 * 1536);
    });

    it('should initialize with custom config', () => {
      const attention = new RealNystromformerAttention({
        dimension: 512,
        numHeads: 8,
        numLandmarks: 32,
        seed: 123,
      });
      expect(attention.getParameterCount()).toBe(4 * 512 * 512);
    });

    it('should reject dimension not divisible by numHeads', () => {
      expect(() => {
        new RealNystromformerAttention({ dimension: 100, numHeads: 7 });
      }).toThrow('ANTI-009');
    });

    it('should reject invalid numLandmarks', () => {
      expect(() => {
        new RealNystromformerAttention({ numLandmarks: 0 });
      }).toThrow('ANTI-009');
    });
  });

  describe('Forward Pass - Core Functionality', () => {
    it('should process single token', () => {
      const attention = new RealNystromformerAttention({
        dimension: 64,
        numHeads: 4,
        numLandmarks: 8,
        seed: 42,
      });

      const seqLen = 1;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1);
      }

      const output = attention.forward(input, input, input, undefined, seqLen);
      expect(output.length).toBe(seqLen * dim);
      expect(output.some((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });

    it('should process short sequence (N < numLandmarks)', () => {
      const attention = new RealNystromformerAttention({
        dimension: 64,
        numHeads: 4,
        numLandmarks: 32,
        seed: 42,
      });

      const seqLen = 8; // Fewer than 32 landmarks
      const dim = 64;
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1);
      }

      const output = attention.forward(input, input, input, undefined, seqLen);
      expect(output.length).toBe(seqLen * dim);
      expect(output.some((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });

    it('should process medium sequence', () => {
      const attention = new RealNystromformerAttention({
        dimension: 64,
        numHeads: 4,
        numLandmarks: 16,
        seed: 42,
      });

      const seqLen = 32;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1) + Math.cos(i * 0.05);
      }

      const output = attention.forward(input, input, input, undefined, seqLen);
      expect(output.length).toBe(seqLen * dim);
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });

    it('should process long sequence (N > numLandmarks)', () => {
      const attention = new RealNystromformerAttention({
        dimension: 64,
        numHeads: 4,
        numLandmarks: 16,
        seed: 42,
      });

      const seqLen = 128;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1);
      }

      const output = attention.forward(input, input, input, undefined, seqLen);
      expect(output.length).toBe(seqLen * dim);
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });

    it('should handle different Q, K, V inputs', () => {
      const attention = new RealNystromformerAttention({
        dimension: 64,
        numHeads: 4,
        numLandmarks: 8,
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
        value[i] = Math.sin(i * 0.2);
      }

      const output = attention.forward(query, key, value, undefined, seqLen);
      expect(output.length).toBe(seqLen * dim);
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });
  });

  describe('Landmark Behavior', () => {
    it('should use fewer landmarks when numLandmarks < seqLen', () => {
      const attention = new RealNystromformerAttention({
        dimension: 64,
        numHeads: 4,
        numLandmarks: 8,
        seed: 42,
      });

      const seqLen = 32;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1);
      }

      const output = attention.forward(input, input, input, undefined, seqLen);
      expect(output.length).toBe(seqLen * dim);
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });

    it('should cap landmarks at seqLen when numLandmarks > seqLen', () => {
      const attention = new RealNystromformerAttention({
        dimension: 64,
        numHeads: 4,
        numLandmarks: 64,
        seed: 42,
      });

      const seqLen = 8;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1);
      }

      const output = attention.forward(input, input, input, undefined, seqLen);
      expect(output.length).toBe(seqLen * dim);
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });

    it('should work with numLandmarks = 1', () => {
      const attention = new RealNystromformerAttention({
        dimension: 64,
        numHeads: 4,
        numLandmarks: 1,
        seed: 42,
      });

      const seqLen = 16;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1);
      }

      const output = attention.forward(input, input, input, undefined, seqLen);
      expect(output.length).toBe(seqLen * dim);
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });
  });

  describe('Output Dimensions', () => {
    it('should maintain input dimensions', () => {
      const configs = [
        { dimension: 64, numHeads: 4, seqLen: 8 },
        { dimension: 128, numHeads: 8, seqLen: 16 },
        { dimension: 256, numHeads: 16, seqLen: 32 },
      ];

      for (const config of configs) {
        const attention = new RealNystromformerAttention({
          dimension: config.dimension,
          numHeads: config.numHeads,
          numLandmarks: 8,
          seed: 42,
        });

        const input = new Float32Array(config.seqLen * config.dimension);
        for (let i = 0; i < input.length; i++) {
          input[i] = Math.sin(i * 0.1);
        }

        const output = attention.forward(input, input, input, undefined, config.seqLen);
        expect(output.length).toBe(config.seqLen * config.dimension);
      }
    });

    it('should handle varying sequence lengths', () => {
      const attention = new RealNystromformerAttention({
        dimension: 64,
        numHeads: 4,
        numLandmarks: 8,
        seed: 42,
      });

      const seqLengths = [1, 4, 8, 16, 32, 64];

      for (const seqLen of seqLengths) {
        const input = new Float32Array(seqLen * 64);
        for (let i = 0; i < input.length; i++) {
          input[i] = Math.sin(i * 0.1);
        }

        const output = attention.forward(input, input, input, undefined, seqLen);
        expect(output.length).toBe(seqLen * 64);
      }
    });
  });

  describe('Masking', () => {
    it('should apply attention mask correctly', () => {
      const attention = new RealNystromformerAttention({
        dimension: 64,
        numHeads: 4,
        numLandmarks: 8,
        seed: 42,
      });

      const seqLen = 16;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1);
      }

      const mask = new Array(seqLen).fill(false);
      mask[5] = true; // Mask one position

      const output = attention.forward(input, input, input, mask, seqLen);
      expect(output.length).toBe(seqLen * dim);
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });

    it('should handle all-masked input', () => {
      const attention = new RealNystromformerAttention({
        dimension: 64,
        numHeads: 4,
        numLandmarks: 8,
        seed: 42,
      });

      const seqLen = 8;
      const dim = 64;
      const input = new Float32Array(seqLen * dim);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1);
      }

      const mask = new Array(seqLen).fill(true);

      const output = attention.forward(input, input, input, mask, seqLen);
      expect(output.length).toBe(seqLen * dim);
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });
  });

  describe('Validation', () => {
    it('should reject mismatched Q, K, V lengths', () => {
      const attention = new RealNystromformerAttention({
        dimension: 64,
        numHeads: 4,
        numLandmarks: 8,
      });

      const query = new Float32Array(64);
      const key = new Float32Array(128);
      const value = new Float32Array(64);

      expect(() => {
        attention.forward(query, key, value);
      }).toThrow('ANTI-009');
    });

    it('should reject input not multiple of dimension', () => {
      const attention = new RealNystromformerAttention({
        dimension: 64,
        numHeads: 4,
        numLandmarks: 8,
      });

      const input = new Float32Array(100); // Not multiple of 64

      expect(() => {
        attention.forward(input, input, input);
      }).toThrow('ANTI-009');
    });

    it('should reject mismatched mask length', () => {
      const attention = new RealNystromformerAttention({
        dimension: 64,
        numHeads: 4,
        numLandmarks: 8,
      });

      const seqLen = 16;
      const input = new Float32Array(seqLen * 64);
      const mask = new Array(8).fill(false); // Wrong length

      expect(() => {
        attention.forward(input, input, input, mask, seqLen);
      }).toThrow('ANTI-009');
    });
  });

  describe('Parameter Count', () => {
    it('should calculate parameter count correctly', () => {
      const configs = [
        { dimension: 64, expected: 4 * 64 * 64 },
        { dimension: 128, expected: 4 * 128 * 128 },
        { dimension: 256, expected: 4 * 256 * 256 },
        { dimension: 1536, expected: 4 * 1536 * 1536 },
      ];

      for (const config of configs) {
        const attention = new RealNystromformerAttention({
          dimension: config.dimension,
          numHeads: 4,
          numLandmarks: 8,
        });
        expect(attention.getParameterCount()).toBe(config.expected);
      }
    });
  });

  describe('Determinism', () => {
    it('should produce same output with same seed', () => {
      const config = {
        dimension: 64,
        numHeads: 4,
        numLandmarks: 8,
        seed: 12345,
      };

      const attention1 = new RealNystromformerAttention(config);
      const attention2 = new RealNystromformerAttention(config);

      const seqLen = 16;
      const input = new Float32Array(seqLen * 64);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1);
      }

      const output1 = attention1.forward(input, input, input, undefined, seqLen);
      const output2 = attention2.forward(input, input, input, undefined, seqLen);

      for (let i = 0; i < output1.length; i++) {
        expect(output1[i]).toBeCloseTo(output2[i], 6);
      }
    });

    it('should produce different output with different seeds', () => {
      const attention1 = new RealNystromformerAttention({
        dimension: 64,
        numHeads: 4,
        numLandmarks: 8,
        seed: 111,
      });
      const attention2 = new RealNystromformerAttention({
        dimension: 64,
        numHeads: 4,
        numLandmarks: 8,
        seed: 222,
      });

      const seqLen = 16;
      const input = new Float32Array(seqLen * 64);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1);
      }

      const output1 = attention1.forward(input, input, input, undefined, seqLen);
      const output2 = attention2.forward(input, input, input, undefined, seqLen);

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

  describe('Numerical Stability', () => {
    it('should handle large input values', () => {
      const attention = new RealNystromformerAttention({
        dimension: 64,
        numHeads: 4,
        numLandmarks: 8,
        seed: 42,
      });

      const seqLen = 16;
      const input = new Float32Array(seqLen * 64);
      for (let i = 0; i < input.length; i++) {
        input[i] = (Math.random() - 0.5) * 100; // Large values
      }

      const output = attention.forward(input, input, input, undefined, seqLen);
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });

    it('should handle small input values', () => {
      const attention = new RealNystromformerAttention({
        dimension: 64,
        numHeads: 4,
        numLandmarks: 8,
        seed: 42,
      });

      const seqLen = 16;
      const input = new Float32Array(seqLen * 64);
      for (let i = 0; i < input.length; i++) {
        input[i] = (Math.random() - 0.5) * 1e-6; // Small values
      }

      const output = attention.forward(input, input, input, undefined, seqLen);
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });

    it('should handle zero input', () => {
      const attention = new RealNystromformerAttention({
        dimension: 64,
        numHeads: 4,
        numLandmarks: 8,
        seed: 42,
      });

      const seqLen = 16;
      const input = new Float32Array(seqLen * 64); // All zeros

      const output = attention.forward(input, input, input, undefined, seqLen);
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });

    it('should not produce NaN or Inf in normal operation', () => {
      const attention = new RealNystromformerAttention({
        dimension: 64,
        numHeads: 4,
        numLandmarks: 8,
        seed: 42,
      });

      const seqLen = 32;
      const input = new Float32Array(seqLen * 64);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1) * Math.cos(i * 0.05);
      }

      const output = attention.forward(input, input, input, undefined, seqLen);
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle numLandmarks equal to seqLen', () => {
      const attention = new RealNystromformerAttention({
        dimension: 64,
        numHeads: 4,
        numLandmarks: 16,
        seed: 42,
      });

      const seqLen = 16;
      const input = new Float32Array(seqLen * 64);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1);
      }

      const output = attention.forward(input, input, input, undefined, seqLen);
      expect(output.length).toBe(seqLen * 64);
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });

    it('should handle very small numLandmarks', () => {
      const attention = new RealNystromformerAttention({
        dimension: 64,
        numHeads: 4,
        numLandmarks: 2,
        seed: 42,
      });

      const seqLen = 32;
      const input = new Float32Array(seqLen * 64);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1);
      }

      const output = attention.forward(input, input, input, undefined, seqLen);
      expect(output.length).toBe(seqLen * 64);
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });

    it('should handle single head', () => {
      const attention = new RealNystromformerAttention({
        dimension: 64,
        numHeads: 1,
        numLandmarks: 8,
        seed: 42,
      });

      const seqLen = 16;
      const input = new Float32Array(seqLen * 64);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1);
      }

      const output = attention.forward(input, input, input, undefined, seqLen);
      expect(output.length).toBe(seqLen * 64);
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });
  });
});
