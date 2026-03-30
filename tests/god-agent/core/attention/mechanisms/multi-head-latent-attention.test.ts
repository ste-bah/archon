/**
 * Tests for Multi-Head Latent Attention Mechanism
 *
 * @module attention/mechanisms/multi-head-latent-attention.test
 */

import { describe, it, expect } from 'vitest';
import { RealMultiHeadLatentAttention } from '../../../../../src/god-agent/core/attention/mechanisms/multi-head-latent-attention.js';

describe('RealMultiHeadLatentAttention', () => {
  describe('Core Functionality', () => {
    it('should initialize with default configuration', () => {
      const attention = new RealMultiHeadLatentAttention();
      expect(attention.name).toBe('multi-head-latent');
      expect(attention.getParameterCount()).toBeGreaterThan(0);
    });

    it('should initialize with custom configuration', () => {
      const attention = new RealMultiHeadLatentAttention({
        dimension: 512,
        numHeads: 8,
        numLatents: 32,
        seed: 123
      });
      expect(attention.getParameterCount()).toBeGreaterThan(0);
    });

    it('should perform forward pass with valid inputs', () => {
      const attention = new RealMultiHeadLatentAttention({
        dimension: 64,
        numHeads: 4,
        numLatents: 8,
        seed: 42
      });

      const seqLen = 10;
      const query = new Float32Array(seqLen * 64); // Unused in latent mode
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      // Initialize with some values
      for (let i = 0; i < key.length; i++) {
        key[i] = Math.sin(i * 0.1);
        value[i] = Math.cos(i * 0.1);
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      // Output should be [numLatents × dimension] = [8 × 64]
      expect(output.length).toBe(8 * 64);
      expect(output).toBeInstanceOf(Float32Array);
    });
  });

  describe('Latent Behavior', () => {
    it('should produce fixed-size output regardless of input length', () => {
      const attention = new RealMultiHeadLatentAttention({
        dimension: 64,
        numHeads: 4,
        numLatents: 16,
        seed: 42
      });

      // Test with different sequence lengths
      const seqLengths = [5, 10, 20, 50];
      const outputs: Float32Array[] = [];

      for (const seqLen of seqLengths) {
        const query = new Float32Array(seqLen * 64);
        const key = new Float32Array(seqLen * 64);
        const value = new Float32Array(seqLen * 64);

        for (let i = 0; i < key.length; i++) {
          key[i] = Math.sin(i * 0.1);
          value[i] = Math.cos(i * 0.1);
        }

        const output = attention.forward(query, key, value, undefined, seqLen);
        outputs.push(output);

        // All outputs should be same size [numLatents × dimension]
        expect(output.length).toBe(16 * 64);
      }

      // Verify all outputs have same length
      const firstLen = outputs[0].length;
      for (const output of outputs) {
        expect(output.length).toBe(firstLen);
      }
    });

    it('should compress variable-length inputs to fixed latent space', () => {
      const attention = new RealMultiHeadLatentAttention({
        dimension: 128,
        numHeads: 8,
        numLatents: 32,
        seed: 42
      });

      const shortSeq = 8;
      const longSeq = 64;

      // Short sequence
      const shortKey = new Float32Array(shortSeq * 128);
      const shortValue = new Float32Array(shortSeq * 128);
      for (let i = 0; i < shortKey.length; i++) {
        shortKey[i] = Math.random();
        shortValue[i] = Math.random();
      }

      // Long sequence
      const longKey = new Float32Array(longSeq * 128);
      const longValue = new Float32Array(longSeq * 128);
      for (let i = 0; i < longKey.length; i++) {
        longKey[i] = Math.random();
        longValue[i] = Math.random();
      }

      const shortOutput = attention.forward(
        new Float32Array(shortSeq * 128),
        shortKey,
        shortValue,
        undefined,
        shortSeq
      );

      const longOutput = attention.forward(
        new Float32Array(longSeq * 128),
        longKey,
        longValue,
        undefined,
        longSeq
      );

      // Both compress to same fixed size
      expect(shortOutput.length).toBe(32 * 128);
      expect(longOutput.length).toBe(32 * 128);
    });

    it('should use learned latent queries (query input ignored)', () => {
      const attention = new RealMultiHeadLatentAttention({
        dimension: 64,
        numHeads: 4,
        numLatents: 8,
        seed: 42
      });

      const seqLen = 10;
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      for (let i = 0; i < key.length; i++) {
        key[i] = Math.sin(i * 0.1);
        value[i] = Math.cos(i * 0.1);
      }

      // Different query inputs should produce same output
      // (since latent queries are learned, not derived from input)
      const query1 = new Float32Array(seqLen * 64).fill(1.0);
      const query2 = new Float32Array(seqLen * 64).fill(2.0);

      const output1 = attention.forward(query1, key, value, undefined, seqLen);
      const output2 = attention.forward(query2, key, value, undefined, seqLen);

      // Outputs should be identical (query is ignored)
      expect(output1.length).toBe(output2.length);
      for (let i = 0; i < output1.length; i++) {
        expect(output1[i]).toBeCloseTo(output2[i], 5);
      }
    });
  });

  describe('Different Latent Configurations', () => {
    it('should work with small number of latents', () => {
      const attention = new RealMultiHeadLatentAttention({
        dimension: 64,
        numHeads: 4,
        numLatents: 4, // Very small
        seed: 42
      });

      const seqLen = 20;
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      for (let i = 0; i < key.length; i++) {
        key[i] = Math.sin(i * 0.1);
        value[i] = Math.cos(i * 0.1);
      }

      const output = attention.forward(
        new Float32Array(seqLen * 64),
        key,
        value,
        undefined,
        seqLen
      );

      expect(output.length).toBe(4 * 64);
    });

    it('should work with large number of latents', () => {
      const attention = new RealMultiHeadLatentAttention({
        dimension: 64,
        numHeads: 4,
        numLatents: 128, // Many latents
        seed: 42
      });

      const seqLen = 10;
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      for (let i = 0; i < key.length; i++) {
        key[i] = Math.sin(i * 0.1);
        value[i] = Math.cos(i * 0.1);
      }

      const output = attention.forward(
        new Float32Array(seqLen * 64),
        key,
        value,
        undefined,
        seqLen
      );

      expect(output.length).toBe(128 * 64);
    });

    it('should handle latents equal to sequence length', () => {
      const attention = new RealMultiHeadLatentAttention({
        dimension: 64,
        numHeads: 4,
        numLatents: 10, // Same as seqLen
        seed: 42
      });

      const seqLen = 10;
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      for (let i = 0; i < key.length; i++) {
        key[i] = Math.sin(i * 0.1);
        value[i] = Math.cos(i * 0.1);
      }

      const output = attention.forward(
        new Float32Array(seqLen * 64),
        key,
        value,
        undefined,
        seqLen
      );

      expect(output.length).toBe(10 * 64);
    });
  });

  describe('Masking', () => {
    it('should respect attention mask', () => {
      const attention = new RealMultiHeadLatentAttention({
        dimension: 64,
        numHeads: 4,
        numLatents: 8,
        seed: 42
      });

      const seqLen = 10;
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      for (let i = 0; i < key.length; i++) {
        key[i] = Math.sin(i * 0.1);
        value[i] = Math.cos(i * 0.1);
      }

      // Mask out second half
      const mask = new Array(seqLen).fill(true);
      for (let i = 5; i < 10; i++) {
        mask[i] = false;
      }

      const outputMasked = attention.forward(
        new Float32Array(seqLen * 64),
        key,
        value,
        mask,
        seqLen
      );

      const outputUnmasked = attention.forward(
        new Float32Array(seqLen * 64),
        key,
        value,
        undefined,
        seqLen
      );

      // Outputs should differ due to masking
      expect(outputMasked.length).toBe(outputUnmasked.length);
      let hasDifference = false;
      for (let i = 0; i < outputMasked.length; i++) {
        if (Math.abs(outputMasked[i] - outputUnmasked[i]) > 1e-5) {
          hasDifference = true;
          break;
        }
      }
      expect(hasDifference).toBe(true);
    });

    it('should handle all-masked input', () => {
      const attention = new RealMultiHeadLatentAttention({
        dimension: 64,
        numHeads: 4,
        numLatents: 8,
        seed: 42
      });

      const seqLen = 10;
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      for (let i = 0; i < key.length; i++) {
        key[i] = Math.sin(i * 0.1);
        value[i] = Math.cos(i * 0.1);
      }

      const mask = new Array(seqLen).fill(false);

      const output = attention.forward(
        new Float32Array(seqLen * 64),
        key,
        value,
        mask,
        seqLen
      );

      expect(output.length).toBe(8 * 64);
      // Output should be zeros or very small values
      let maxAbs = 0;
      for (let i = 0; i < output.length; i++) {
        maxAbs = Math.max(maxAbs, Math.abs(output[i]));
      }
      expect(maxAbs).toBeLessThan(1e-5);
    });
  });

  describe('Validation', () => {
    it('should reject invalid dimension', () => {
      expect(() => {
        new RealMultiHeadLatentAttention({ dimension: 0 });
      }).toThrow('ANTI-009: dimension must be positive');

      expect(() => {
        new RealMultiHeadLatentAttention({ dimension: -1 });
      }).toThrow('ANTI-009: dimension must be positive');
    });

    it('should reject invalid numHeads', () => {
      expect(() => {
        new RealMultiHeadLatentAttention({ numHeads: 0 });
      }).toThrow('ANTI-009: numHeads must be positive');

      expect(() => {
        new RealMultiHeadLatentAttention({ numHeads: -1 });
      }).toThrow('ANTI-009: numHeads must be positive');
    });

    it('should reject invalid numLatents', () => {
      expect(() => {
        new RealMultiHeadLatentAttention({ numLatents: 0 });
      }).toThrow('ANTI-009: numLatents must be positive');

      expect(() => {
        new RealMultiHeadLatentAttention({ numLatents: -1 });
      }).toThrow('ANTI-009: numLatents must be positive');
    });

    it('should reject dimension not divisible by numHeads', () => {
      expect(() => {
        new RealMultiHeadLatentAttention({ dimension: 100, numHeads: 7 });
      }).toThrow('ANTI-009: dimension must be divisible by numHeads');
    });

    it('should reject empty key', () => {
      const attention = new RealMultiHeadLatentAttention({
        dimension: 64,
        numHeads: 4,
        numLatents: 8
      });

      expect(() => {
        attention.forward(
          new Float32Array(64),
          new Float32Array(0),
          new Float32Array(64),
          undefined,
          1
        );
      }).toThrow('ANTI-009: key cannot be empty');
    });

    it('should reject empty value', () => {
      const attention = new RealMultiHeadLatentAttention({
        dimension: 64,
        numHeads: 4,
        numLatents: 8
      });

      expect(() => {
        attention.forward(
          new Float32Array(64),
          new Float32Array(64),
          new Float32Array(0),
          undefined,
          1
        );
      }).toThrow('ANTI-009: value cannot be empty');
    });

    it('should reject mismatched key and value lengths', () => {
      const attention = new RealMultiHeadLatentAttention({
        dimension: 64,
        numHeads: 4,
        numLatents: 8
      });

      expect(() => {
        attention.forward(
          new Float32Array(64),
          new Float32Array(128),
          new Float32Array(64),
          undefined,
          2
        );
      }).toThrow('ANTI-009: key and value must have same length');
    });

    it('should reject incorrect mask length', () => {
      const attention = new RealMultiHeadLatentAttention({
        dimension: 64,
        numHeads: 4,
        numLatents: 8
      });

      const seqLen = 10;
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);
      const wrongMask = new Array(5).fill(true); // Wrong length

      expect(() => {
        attention.forward(
          new Float32Array(seqLen * 64),
          key,
          value,
          wrongMask,
          seqLen
        );
      }).toThrow('ANTI-009: mask length must match sequence length');
    });
  });

  describe('Parameter Count', () => {
    it('should calculate correct parameter count', () => {
      const attention = new RealMultiHeadLatentAttention({
        dimension: 64,
        numHeads: 4,
        numLatents: 8,
        seed: 42
      });

      const paramCount = attention.getParameterCount();

      // Latent queries: 8 × 64 = 512
      // Wq, Wk, Wv, Wo: 4 × (64 × 64) = 16384
      // Total: 512 + 16384 = 16896
      expect(paramCount).toBe(16896);
    });

    it('should scale parameter count with configuration', () => {
      const small = new RealMultiHeadLatentAttention({
        dimension: 32,
        numHeads: 2,
        numLatents: 4
      });

      const large = new RealMultiHeadLatentAttention({
        dimension: 128,
        numHeads: 8,
        numLatents: 32
      });

      expect(large.getParameterCount()).toBeGreaterThan(
        small.getParameterCount()
      );
    });

    it('should include latent queries in parameter count', () => {
      const noLatents = new RealMultiHeadLatentAttention({
        dimension: 64,
        numHeads: 4,
        numLatents: 1 // Minimal latents
      });

      const manyLatents = new RealMultiHeadLatentAttention({
        dimension: 64,
        numHeads: 4,
        numLatents: 64 // Many latents
      });

      // Difference should be due to latent queries
      const diff = manyLatents.getParameterCount() - noLatents.getParameterCount();
      const expectedDiff = (64 - 1) * 64; // numLatents difference × dimension
      expect(diff).toBe(expectedDiff);
    });
  });

  describe('Determinism', () => {
    it('should produce deterministic outputs with same seed', () => {
      const attention1 = new RealMultiHeadLatentAttention({
        dimension: 64,
        numHeads: 4,
        numLatents: 8,
        seed: 42
      });

      const attention2 = new RealMultiHeadLatentAttention({
        dimension: 64,
        numHeads: 4,
        numLatents: 8,
        seed: 42
      });

      const seqLen = 10;
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      for (let i = 0; i < key.length; i++) {
        key[i] = Math.sin(i * 0.1);
        value[i] = Math.cos(i * 0.1);
      }

      const output1 = attention1.forward(
        new Float32Array(seqLen * 64),
        key,
        value,
        undefined,
        seqLen
      );

      const output2 = attention2.forward(
        new Float32Array(seqLen * 64),
        key,
        value,
        undefined,
        seqLen
      );

      expect(output1.length).toBe(output2.length);
      for (let i = 0; i < output1.length; i++) {
        expect(output1[i]).toBeCloseTo(output2[i], 5);
      }
    });

    it('should produce different outputs with different seeds', () => {
      const attention1 = new RealMultiHeadLatentAttention({
        dimension: 64,
        numHeads: 4,
        numLatents: 8,
        seed: 42
      });

      const attention2 = new RealMultiHeadLatentAttention({
        dimension: 64,
        numHeads: 4,
        numLatents: 8,
        seed: 123
      });

      const seqLen = 10;
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      for (let i = 0; i < key.length; i++) {
        key[i] = Math.sin(i * 0.1);
        value[i] = Math.cos(i * 0.1);
      }

      const output1 = attention1.forward(
        new Float32Array(seqLen * 64),
        key,
        value,
        undefined,
        seqLen
      );

      const output2 = attention2.forward(
        new Float32Array(seqLen * 64),
        key,
        value,
        undefined,
        seqLen
      );

      // Outputs should differ
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

  describe('Numerical Stability', () => {
    it('should handle large values without overflow', () => {
      const attention = new RealMultiHeadLatentAttention({
        dimension: 64,
        numHeads: 4,
        numLatents: 8,
        seed: 42
      });

      const seqLen = 10;
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      // Large values
      for (let i = 0; i < key.length; i++) {
        key[i] = 1000.0 * Math.sin(i * 0.1);
        value[i] = 1000.0 * Math.cos(i * 0.1);
      }

      const output = attention.forward(
        new Float32Array(seqLen * 64),
        key,
        value,
        undefined,
        seqLen
      );

      // Should not have NaN or Inf
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });

    it('should handle small values without underflow', () => {
      const attention = new RealMultiHeadLatentAttention({
        dimension: 64,
        numHeads: 4,
        numLatents: 8,
        seed: 42
      });

      const seqLen = 10;
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      // Small values
      for (let i = 0; i < key.length; i++) {
        key[i] = 0.001 * Math.sin(i * 0.1);
        value[i] = 0.001 * Math.cos(i * 0.1);
      }

      const output = attention.forward(
        new Float32Array(seqLen * 64),
        key,
        value,
        undefined,
        seqLen
      );

      // Should produce valid output
      expect(output.length).toBe(8 * 64);
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });

    it('should handle mixed positive and negative values', () => {
      const attention = new RealMultiHeadLatentAttention({
        dimension: 64,
        numHeads: 4,
        numLatents: 8,
        seed: 42
      });

      const seqLen = 10;
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      // Mixed values
      for (let i = 0; i < key.length; i++) {
        key[i] = i % 2 === 0 ? Math.sin(i * 0.1) : -Math.sin(i * 0.1);
        value[i] = i % 2 === 0 ? Math.cos(i * 0.1) : -Math.cos(i * 0.1);
      }

      const output = attention.forward(
        new Float32Array(seqLen * 64),
        key,
        value,
        undefined,
        seqLen
      );

      expect(output.length).toBe(8 * 64);
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });
  });
});
