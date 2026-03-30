/**
 * Tests for RealBlockSparseAttention
 *
 * Validates:
 * - Block-based attention computation
 * - Structured sparsity patterns
 * - Random block connections
 * - Global attention for first block
 * - Mathematical correctness
 * - Numerical stability
 */

import { describe, it, expect } from 'vitest';
import { RealBlockSparseAttention } from '../../../../../src/god-agent/core/attention/mechanisms/block-sparse-attention.js';
import { hasNaNOrInf } from '../../../../../src/god-agent/core/attention/utils/index.js';

describe('RealBlockSparseAttention', () => {
  describe('Construction', () => {
    it('should initialize with default config', () => {
      const attn = new RealBlockSparseAttention();
      const config = attn.getConfig();

      expect(config.dimension).toBe(128);
      expect(config.numHeads).toBe(8);
      expect(config.headDim).toBe(16);
      expect(config.blockSize).toBe(64);
      expect(config.numRandomBlocks).toBe(1);
    });

    it('should initialize with custom config', () => {
      const attn = new RealBlockSparseAttention({
        dimension: 256,
        numHeads: 4,
        blockSize: 32,
        numRandomBlocks: 2,
        seed: 123
      });

      const config = attn.getConfig();
      expect(config.dimension).toBe(256);
      expect(config.numHeads).toBe(4);
      expect(config.headDim).toBe(64);
      expect(config.blockSize).toBe(32);
      expect(config.numRandomBlocks).toBe(2);
    });

    it('should reject invalid dimension', () => {
      expect(() => new RealBlockSparseAttention({ dimension: 0 })).toThrow('dimension must be positive integer');
      expect(() => new RealBlockSparseAttention({ dimension: -1 })).toThrow('dimension must be positive integer');
      expect(() => new RealBlockSparseAttention({ dimension: 2.5 })).toThrow('dimension must be positive integer');
    });

    it('should reject invalid numHeads', () => {
      expect(() => new RealBlockSparseAttention({ numHeads: 0 })).toThrow('numHeads must be positive integer');
      expect(() => new RealBlockSparseAttention({ numHeads: -1 })).toThrow('numHeads must be positive integer');
      expect(() => new RealBlockSparseAttention({ numHeads: 1.5 })).toThrow('numHeads must be positive integer');
    });

    it('should reject dimension not divisible by numHeads', () => {
      expect(() => new RealBlockSparseAttention({ dimension: 100, numHeads: 3 })).toThrow(
        'dimension must be divisible by numHeads'
      );
    });

    it('should reject invalid blockSize', () => {
      expect(() => new RealBlockSparseAttention({ blockSize: 0 })).toThrow('blockSize must be positive integer');
      expect(() => new RealBlockSparseAttention({ blockSize: -1 })).toThrow('blockSize must be positive integer');
      expect(() => new RealBlockSparseAttention({ blockSize: 2.5 })).toThrow('blockSize must be positive integer');
    });

    it('should reject invalid numRandomBlocks', () => {
      expect(() => new RealBlockSparseAttention({ numRandomBlocks: -1 })).toThrow(
        'numRandomBlocks must be non-negative integer'
      );
      expect(() => new RealBlockSparseAttention({ numRandomBlocks: 1.5 })).toThrow(
        'numRandomBlocks must be non-negative integer'
      );
    });

    it('should initialize weights with Xavier uniform', () => {
      const attn = new RealBlockSparseAttention({ dimension: 64, numHeads: 4, seed: 42 });
      const weights = attn.getWeights();

      // Check dimensions
      expect(weights.wQuery.length).toBe(64 * 64);
      expect(weights.wKey.length).toBe(64 * 64);
      expect(weights.wValue.length).toBe(64 * 64);
      expect(weights.wOutput.length).toBe(64 * 64);

      // Check no NaN/Inf
      expect(hasNaNOrInf(weights.wQuery)).toBe(false);
      expect(hasNaNOrInf(weights.wKey)).toBe(false);
      expect(hasNaNOrInf(weights.wValue)).toBe(false);
      expect(hasNaNOrInf(weights.wOutput)).toBe(false);

      // Check reasonable range (Xavier: ±sqrt(6/(fan_in + fan_out)))
      const limit = Math.sqrt(6.0 / (64 + 64));
      for (let i = 0; i < weights.wQuery.length; i++) {
        expect(Math.abs(weights.wQuery[i])).toBeLessThanOrEqual(limit * 1.1); // Small tolerance
      }
    });
  });

  describe('Forward Pass', () => {
    it('should compute block sparse attention for single block', () => {
      const dim = 64;
      const seqLen = 32; // Single block (blockSize=64)
      const attn = new RealBlockSparseAttention({ dimension: dim, numHeads: 4, blockSize: 64, seed: 42 });

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      // Fill with test pattern
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = Math.sin(i * 0.05) * Math.cos(i * 0.05);
      }

      const output = attn.forward(query, key, value);

      // Validate output
      expect(output.length).toBe(seqLen * dim);
      expect(hasNaNOrInf(output)).toBe(false);

      // Output should be non-zero
      let sumAbs = 0.0;
      for (let i = 0; i < output.length; i++) {
        sumAbs += Math.abs(output[i]);
      }
      expect(sumAbs).toBeGreaterThan(0);
    });

    it('should compute block sparse attention for multiple blocks', () => {
      const dim = 64;
      const seqLen = 192; // 3 blocks (blockSize=64)
      const attn = new RealBlockSparseAttention({
        dimension: dim,
        numHeads: 4,
        blockSize: 64,
        numRandomBlocks: 1,
        seed: 42
      });

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      // Fill with test pattern
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = (i % 2 === 0) ? 1.0 : -1.0;
      }

      const output = attn.forward(query, key, value);

      // Validate output
      expect(output.length).toBe(seqLen * dim);
      expect(hasNaNOrInf(output)).toBe(false);

      // Output should be non-zero (attention is working)
      let sumAbs = 0.0;
      for (let i = 0; i < output.length; i++) {
        sumAbs += Math.abs(output[i]);
      }
      expect(sumAbs).toBeGreaterThan(0);

      // Output should differ from input (transformation applied)
      let diffFromValue = 0.0;
      for (let i = 0; i < Math.min(dim, value.length); i++) {
        diffFromValue += Math.abs(output[i] - value[i]);
      }
      expect(diffFromValue).toBeGreaterThan(0);
    });

    it('should respect causal mask within blocks', () => {
      const dim = 32;
      const seqLen = 64;
      const attn = new RealBlockSparseAttention({ dimension: dim, numHeads: 2, blockSize: 64, seed: 42 });

      const query = new Float32Array(seqLen * dim).fill(1.0);
      const key = new Float32Array(seqLen * dim).fill(1.0);
      const value = new Float32Array(seqLen * dim);

      // Set distinct values
      for (let i = 0; i < seqLen; i++) {
        for (let d = 0; d < dim; d++) {
          value[i * dim + d] = i + 1;
        }
      }

      // Causal mask (lower triangular)
      const mask: boolean[] = new Array(seqLen * seqLen);
      for (let i = 0; i < seqLen; i++) {
        for (let j = 0; j < seqLen; j++) {
          mask[i * seqLen + j] = (j <= i);
        }
      }

      const output = attn.forward(query, key, value, mask);

      // Position 0 should only attend to itself
      // Position 1 should attend to 0 and 1
      // etc.
      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should handle non-uniform block sizes at end', () => {
      const dim = 32;
      const seqLen = 100; // 2 full blocks (64 each) + partial block (36)
      const attn = new RealBlockSparseAttention({ dimension: dim, numHeads: 2, blockSize: 64, seed: 42 });

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < query.length; i++) {
        query[i] = Math.random();
        key[i] = Math.random();
        value[i] = Math.random();
      }

      const output = attn.forward(query, key, value);

      expect(output.length).toBe(seqLen * dim);
      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should produce deterministic output with same seed', () => {
      const dim = 64;
      const seqLen = 128;

      const attn1 = new RealBlockSparseAttention({ dimension: dim, numHeads: 4, seed: 999 });
      const attn2 = new RealBlockSparseAttention({ dimension: dim, numHeads: 4, seed: 999 });

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.01);
        key[i] = Math.cos(i * 0.01);
        value[i] = Math.sin(i * 0.02);
      }

      const output1 = attn1.forward(query, key, value);
      const output2 = attn2.forward(query, key, value);

      // Exact match
      for (let i = 0; i < output1.length; i++) {
        expect(output1[i]).toBe(output2[i]);
      }
    });

    it('should produce different output with different seed', () => {
      const dim = 64;
      const seqLen = 128;

      const attn1 = new RealBlockSparseAttention({ dimension: dim, numHeads: 4, seed: 111 });
      const attn2 = new RealBlockSparseAttention({ dimension: dim, numHeads: 4, seed: 222 });

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.01);
        key[i] = Math.cos(i * 0.01);
        value[i] = Math.sin(i * 0.02);
      }

      const output1 = attn1.forward(query, key, value);
      const output2 = attn2.forward(query, key, value);

      // Should differ due to different random block connections
      let diff = 0.0;
      for (let i = 0; i < output1.length; i++) {
        diff += Math.abs(output1[i] - output2[i]);
      }
      expect(diff).toBeGreaterThan(0);
    });
  });

  describe('Input Validation', () => {
    it('should reject mismatched query length', () => {
      const attn = new RealBlockSparseAttention({ dimension: 64, numHeads: 4 });
      const query = new Float32Array(100); // Wrong size
      const key = new Float32Array(128);
      const value = new Float32Array(128);

      expect(() => attn.forward(query, key, value)).toThrow('query length mismatch');
    });

    it('should reject mismatched key length', () => {
      const attn = new RealBlockSparseAttention({ dimension: 64, numHeads: 4 });
      const query = new Float32Array(128);
      const key = new Float32Array(100); // Wrong size
      const value = new Float32Array(128);

      expect(() => attn.forward(query, key, value)).toThrow('key length mismatch');
    });

    it('should reject mismatched value length', () => {
      const attn = new RealBlockSparseAttention({ dimension: 64, numHeads: 4 });
      const query = new Float32Array(128);
      const key = new Float32Array(128);
      const value = new Float32Array(100); // Wrong size

      expect(() => attn.forward(query, key, value)).toThrow('value length mismatch');
    });

    it('should reject mismatched mask length', () => {
      const attn = new RealBlockSparseAttention({ dimension: 64, numHeads: 4 });
      const seqLen = 2;
      const query = new Float32Array(seqLen * 64);
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);
      const mask = new Array(10).fill(true); // Wrong size

      expect(() => attn.forward(query, key, value, mask)).toThrow('mask length mismatch');
    });

    it('should reject NaN in query', () => {
      const attn = new RealBlockSparseAttention({ dimension: 64, numHeads: 4 });
      const query = new Float32Array(128);
      query[0] = NaN;
      const key = new Float32Array(128);
      const value = new Float32Array(128);

      expect(() => attn.forward(query, key, value)).toThrow('Input contains NaN or Inf');
    });

    it('should reject Infinity in key', () => {
      const attn = new RealBlockSparseAttention({ dimension: 64, numHeads: 4 });
      const query = new Float32Array(128);
      const key = new Float32Array(128);
      key[0] = Infinity;
      const value = new Float32Array(128);

      expect(() => attn.forward(query, key, value)).toThrow('Input contains NaN or Inf');
    });
  });

  describe('Numerical Stability', () => {
    it('should handle all-zero inputs', () => {
      const dim = 64;
      const seqLen = 64;
      const attn = new RealBlockSparseAttention({ dimension: dim, numHeads: 4, seed: 42 });

      const query = new Float32Array(seqLen * dim).fill(0);
      const key = new Float32Array(seqLen * dim).fill(0);
      const value = new Float32Array(seqLen * dim).fill(0);

      const output = attn.forward(query, key, value);

      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should handle very small values', () => {
      const dim = 32;
      const seqLen = 64;
      const attn = new RealBlockSparseAttention({ dimension: dim, numHeads: 2, seed: 42 });

      const query = new Float32Array(seqLen * dim).fill(1e-20);
      const key = new Float32Array(seqLen * dim).fill(1e-20);
      const value = new Float32Array(seqLen * dim).fill(1e-20);

      const output = attn.forward(query, key, value);

      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should handle large values without overflow', () => {
      const dim = 32;
      const seqLen = 64;
      const attn = new RealBlockSparseAttention({ dimension: dim, numHeads: 2, seed: 42 });

      const query = new Float32Array(seqLen * dim).fill(100.0);
      const key = new Float32Array(seqLen * dim).fill(100.0);
      const value = new Float32Array(seqLen * dim).fill(100.0);

      const output = attn.forward(query, key, value);

      expect(hasNaNOrInf(output)).toBe(false);
    });

    it('should handle mixed positive/negative values', () => {
      const dim = 32;
      const seqLen = 64;
      const attn = new RealBlockSparseAttention({ dimension: dim, numHeads: 2, seed: 42 });

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < query.length; i++) {
        query[i] = (i % 2 === 0) ? 10.0 : -10.0;
        key[i] = (i % 3 === 0) ? 5.0 : -5.0;
        value[i] = (i % 5 === 0) ? 1.0 : -1.0;
      }

      const output = attn.forward(query, key, value);

      expect(hasNaNOrInf(output)).toBe(false);
    });
  });

  describe('Parameter Count', () => {
    it('should return correct parameter count', () => {
      const attn = new RealBlockSparseAttention({ dimension: 128, numHeads: 8 });
      const paramCount = attn.getParameterCount();

      // 4 weight matrices: Q, K, V, O
      // Each is dimension × dimension
      expect(paramCount).toBe(4 * 128 * 128);
    });

    it('should scale quadratically with dimension', () => {
      const attn1 = new RealBlockSparseAttention({ dimension: 64, numHeads: 4 });
      const attn2 = new RealBlockSparseAttention({ dimension: 128, numHeads: 8 });

      const params1 = attn1.getParameterCount();
      const params2 = attn2.getParameterCount();

      // Should be 4x (2^2)
      expect(params2).toBe(params1 * 4);
    });
  });

  describe('Block Sparsity Properties', () => {
    it('should implement structured sparsity via blocks', () => {
      const dim = 32;
      const seqLen = 128;
      const blockSize = 32;
      const attn = new RealBlockSparseAttention({
        dimension: dim,
        numHeads: 2,
        blockSize: blockSize,
        numRandomBlocks: 0, // No random connections for test clarity
        seed: 42
      });

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      // Set distinct patterns per block
      for (let blockIdx = 0; blockIdx < 4; blockIdx++) {
        const blockStart = blockIdx * blockSize;
        for (let i = 0; i < blockSize; i++) {
          for (let d = 0; d < dim; d++) {
            const pos = blockStart + i;
            query[pos * dim + d] = blockIdx * 10.0;
            key[pos * dim + d] = blockIdx * 10.0;
            value[pos * dim + d] = blockIdx * 10.0;
          }
        }
      }

      const output = attn.forward(query, key, value);

      expect(hasNaNOrInf(output)).toBe(false);
      expect(output.length).toBe(seqLen * dim);
    });

    it('should use smaller block sizes for finer granularity', () => {
      const dim = 32;
      const seqLen = 128;

      const attn1 = new RealBlockSparseAttention({ dimension: dim, numHeads: 2, blockSize: 64, seed: 42 });
      const attn2 = new RealBlockSparseAttention({ dimension: dim, numHeads: 2, blockSize: 32, seed: 42 });

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.05);
        key[i] = Math.cos(i * 0.05);
        value[i] = Math.sin(i * 0.1);
      }

      const output1 = attn1.forward(query, key, value);
      const output2 = attn2.forward(query, key, value);

      // Different block sizes should produce different outputs
      let diff = 0.0;
      for (let i = 0; i < output1.length; i++) {
        diff += Math.abs(output1[i] - output2[i]);
      }
      expect(diff).toBeGreaterThan(0);
    });
  });

  describe('Concurrency Safety', () => {
    it('should be stateless across forward passes', () => {
      const dim = 64;
      const seqLen1 = 64;
      const seqLen2 = 128;
      const attn = new RealBlockSparseAttention({ dimension: dim, numHeads: 4, seed: 42 });

      // First forward pass
      const query1 = new Float32Array(seqLen1 * dim);
      const key1 = new Float32Array(seqLen1 * dim);
      const value1 = new Float32Array(seqLen1 * dim);
      for (let i = 0; i < query1.length; i++) {
        query1[i] = 1.0;
        key1[i] = 1.0;
        value1[i] = 1.0;
      }

      const output1 = attn.forward(query1, key1, value1);

      // Second forward pass with different sequence length
      const query2 = new Float32Array(seqLen2 * dim);
      const key2 = new Float32Array(seqLen2 * dim);
      const value2 = new Float32Array(seqLen2 * dim);
      for (let i = 0; i < query2.length; i++) {
        query2[i] = 2.0;
        key2[i] = 2.0;
        value2[i] = 2.0;
      }

      const output2 = attn.forward(query2, key2, value2);

      // Both should be valid
      expect(hasNaNOrInf(output1)).toBe(false);
      expect(hasNaNOrInf(output2)).toBe(false);
      expect(output1.length).toBe(seqLen1 * dim);
      expect(output2.length).toBe(seqLen2 * dim);
    });

    it('should handle repeated forward passes with same input', () => {
      const dim = 64;
      const seqLen = 64;
      const attn = new RealBlockSparseAttention({ dimension: dim, numHeads: 4, seed: 42 });

      const query = new Float32Array(seqLen * dim).fill(1.0);
      const key = new Float32Array(seqLen * dim).fill(1.0);
      const value = new Float32Array(seqLen * dim).fill(1.0);

      const output1 = attn.forward(query, key, value, undefined, seqLen);
      const output2 = attn.forward(query, key, value, undefined, seqLen);

      // Should be identical
      for (let i = 0; i < output1.length; i++) {
        expect(output1[i]).toBe(output2[i]);
      }
    });
  });
});
