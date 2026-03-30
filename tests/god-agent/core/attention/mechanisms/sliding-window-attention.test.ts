/**
 * Tests for Real Sliding Window Attention
 *
 * Validates:
 * - Correct sliding window behavior
 * - Mathematical correctness (scaling, softmax)
 * - Numerical stability
 * - Edge cases (boundaries, single token, full coverage)
 * - Determinism
 * - Input validation
 * - Parameter counting
 *
 * ANTI-009: REAL tests for REAL implementation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RealSlidingWindowAttention } from '../../../../../src/god-agent/core/attention/mechanisms/sliding-window-attention.js';

describe('RealSlidingWindowAttention', () => {
  const dimension = 64;
  const numHeads = 4;
  const headDim = dimension / numHeads;
  const windowSize = 8;
  const seed = 42;

  let attention: RealSlidingWindowAttention;

  beforeEach(() => {
    attention = new RealSlidingWindowAttention({
      dimension,
      numHeads,
      windowSize,
      seed
    });
  });

  describe('Construction', () => {
    it('should initialize with correct parameters', () => {
      expect(attention.name).toBe('sliding-window');
    });

    it('should reject invalid dimension', () => {
      expect(() => new RealSlidingWindowAttention({
        dimension: 0,
        numHeads,
        windowSize
      })).toThrow('dimension must be positive');

      expect(() => new RealSlidingWindowAttention({
        dimension: -10,
        numHeads,
        windowSize
      })).toThrow('dimension must be positive');
    });

    it('should reject invalid numHeads', () => {
      expect(() => new RealSlidingWindowAttention({
        dimension,
        numHeads: 0,
        windowSize
      })).toThrow('numHeads must be positive');

      expect(() => new RealSlidingWindowAttention({
        dimension,
        numHeads: -2,
        windowSize
      })).toThrow('numHeads must be positive');
    });

    it('should reject dimension not divisible by numHeads', () => {
      expect(() => new RealSlidingWindowAttention({
        dimension: 65,
        numHeads: 4,
        windowSize
      })).toThrow('dimension must be divisible by numHeads');
    });

    it('should reject invalid windowSize', () => {
      expect(() => new RealSlidingWindowAttention({
        dimension,
        numHeads,
        windowSize: 0
      })).toThrow('windowSize must be positive');

      expect(() => new RealSlidingWindowAttention({
        dimension,
        numHeads,
        windowSize: -4
      })).toThrow('windowSize must be positive');
    });

    it('should use default values when config not provided', () => {
      const defaultAttn = new RealSlidingWindowAttention();
      expect(defaultAttn.name).toBe('sliding-window');
      // Should not throw
      const input = new Float32Array(128); // 1 × 128
      const output = defaultAttn.forward(input, input, input, undefined, 1);
      expect(output.length).toBe(128);
    });
  });

  describe('Forward Pass - Core Functionality', () => {
    it('should produce output with correct dimensions', () => {
      const seqLen = 12;
      const inputSize = seqLen * dimension;

      const query = new Float32Array(inputSize);
      const key = new Float32Array(inputSize);
      const value = new Float32Array(inputSize);

      // Fill with non-zero values
      for (let i = 0; i < inputSize; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = Math.sin(i * 0.2 + 1);
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      expect(output.length).toBe(inputSize);
      expect(output).toBeInstanceOf(Float32Array);
    });

    it('should produce non-zero output for non-zero inputs', () => {
      const seqLen = 8;
      const inputSize = seqLen * dimension;

      const query = new Float32Array(inputSize);
      const key = new Float32Array(inputSize);
      const value = new Float32Array(inputSize);

      // Fill with meaningful values
      for (let i = 0; i < inputSize; i++) {
        query[i] = 0.5 + 0.1 * Math.sin(i);
        key[i] = 0.5 + 0.1 * Math.cos(i);
        value[i] = 1.0 + 0.2 * Math.sin(i * 0.5);
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      let hasNonZero = false;
      for (let i = 0; i < output.length; i++) {
        if (Math.abs(output[i]) > 1e-6) {
          hasNonZero = true;
          break;
        }
      }

      expect(hasNonZero).toBe(true);
    });

    it('should produce different outputs for different inputs', () => {
      const seqLen = 6;
      const inputSize = seqLen * dimension;

      // First input
      const query1 = new Float32Array(inputSize);
      const key1 = new Float32Array(inputSize);
      const value1 = new Float32Array(inputSize);

      for (let i = 0; i < inputSize; i++) {
        query1[i] = Math.sin(i * 0.1);
        key1[i] = Math.cos(i * 0.1);
        value1[i] = Math.sin(i * 0.2);
      }

      // Second input (different)
      const query2 = new Float32Array(inputSize);
      const key2 = new Float32Array(inputSize);
      const value2 = new Float32Array(inputSize);

      for (let i = 0; i < inputSize; i++) {
        query2[i] = Math.sin(i * 0.3);
        key2[i] = Math.cos(i * 0.3);
        value2[i] = Math.sin(i * 0.4);
      }

      const output1 = attention.forward(query1, key1, value1, undefined, seqLen);
      const output2 = attention.forward(query2, key2, value2, undefined, seqLen);

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

  describe('Sliding Window Behavior', () => {
    it('should only attend to positions within window', () => {
      const seqLen = 16;
      const inputSize = seqLen * dimension;

      const query = new Float32Array(inputSize);
      const key = new Float32Array(inputSize);
      const value = new Float32Array(inputSize);

      // Set up a pattern where only position 8 has strong signal in value
      for (let i = 0; i < inputSize; i++) {
        query[i] = 0.1;
        key[i] = 0.1;
        value[i] = 0.01;
      }

      // Position 8 has strong value
      for (let d = 0; d < dimension; d++) {
        value[8 * dimension + d] = 10.0;
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      // Positions within window of 8 (halfWindow = 4: positions 4-12) should be affected
      // Positions far from 8 should have minimal influence from position 8

      // Position 0 should NOT be significantly affected by position 8 (distance > halfWindow)
      const pos0Value = output[0 * dimension];
      const pos8Value = output[8 * dimension];

      // Position 8 should have higher magnitude due to its own strong value
      expect(Math.abs(pos8Value)).toBeGreaterThan(Math.abs(pos0Value));
    });

    it('should handle window boundaries correctly', () => {
      const seqLen = 10;
      const inputSize = seqLen * dimension;

      const query = new Float32Array(inputSize);
      const key = new Float32Array(inputSize);
      const value = new Float32Array(inputSize);

      for (let i = 0; i < inputSize; i++) {
        query[i] = 0.5;
        key[i] = 0.5;
        value[i] = 1.0;
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      // Should not crash or produce NaN/Inf at boundaries
      for (let i = 0; i < output.length; i++) {
        expect(isNaN(output[i])).toBe(false);
        expect(isFinite(output[i])).toBe(true);
      }
    });

    it('should have different window coverage at different positions', () => {
      const seqLen = 16;
      const inputSize = seqLen * dimension;

      const query = new Float32Array(inputSize);
      const key = new Float32Array(inputSize);
      const value = new Float32Array(inputSize);

      // Create position-dependent pattern
      for (let i = 0; i < seqLen; i++) {
        for (let d = 0; d < dimension; d++) {
          query[i * dimension + d] = 0.5;
          key[i * dimension + d] = 0.5;
          value[i * dimension + d] = i; // Position-dependent value
        }
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      // First position (edge) and middle position should have different patterns
      const firstPosOutput = output.slice(0, dimension);
      const midPosOutput = output.slice(8 * dimension, 9 * dimension);

      let hasDifference = false;
      for (let d = 0; d < dimension; d++) {
        if (Math.abs(firstPosOutput[d] - midPosOutput[d]) > 1e-3) {
          hasDifference = true;
          break;
        }
      }

      expect(hasDifference).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle single token sequence', () => {
      const seqLen = 1;
      const inputSize = seqLen * dimension;

      const query = new Float32Array(inputSize);
      const key = new Float32Array(inputSize);
      const value = new Float32Array(inputSize);

      for (let i = 0; i < inputSize; i++) {
        query[i] = 0.5;
        key[i] = 0.5;
        value[i] = 1.0;
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      expect(output.length).toBe(inputSize);
      for (let i = 0; i < output.length; i++) {
        expect(isNaN(output[i])).toBe(false);
        expect(isFinite(output[i])).toBe(true);
      }
    });

    it('should handle window larger than sequence', () => {
      const largeWindow = new RealSlidingWindowAttention({
        dimension,
        numHeads,
        windowSize: 100, // Larger than any reasonable sequence
        seed
      });

      const seqLen = 8;
      const inputSize = seqLen * dimension;

      const query = new Float32Array(inputSize);
      const key = new Float32Array(inputSize);
      const value = new Float32Array(inputSize);

      for (let i = 0; i < inputSize; i++) {
        query[i] = 0.5;
        key[i] = 0.5;
        value[i] = 1.0;
      }

      const output = largeWindow.forward(query, key, value, undefined, seqLen);

      expect(output.length).toBe(inputSize);
      for (let i = 0; i < output.length; i++) {
        expect(isNaN(output[i])).toBe(false);
        expect(isFinite(output[i])).toBe(true);
      }
    });

    it('should handle zero inputs gracefully', () => {
      const seqLen = 4;
      const inputSize = seqLen * dimension;

      const query = new Float32Array(inputSize); // All zeros
      const key = new Float32Array(inputSize);
      const value = new Float32Array(inputSize);

      const output = attention.forward(query, key, value, undefined, seqLen);

      expect(output.length).toBe(inputSize);
      for (let i = 0; i < output.length; i++) {
        expect(isNaN(output[i])).toBe(false);
        expect(isFinite(output[i])).toBe(true);
      }
    });

    it('should handle mask correctly', () => {
      const seqLen = 6;
      const inputSize = seqLen * dimension;

      const query = new Float32Array(inputSize);
      const key = new Float32Array(inputSize);
      const value = new Float32Array(inputSize);

      for (let i = 0; i < inputSize; i++) {
        query[i] = 0.5;
        key[i] = 0.5;
        value[i] = 1.0;
      }

      // Create mask that blocks all positions except self-attention
      const mask = new Float32Array(seqLen * seqLen);
      for (let i = 0; i < seqLen; i++) {
        mask[i * seqLen + i] = 1; // Only diagonal (self) is unmasked
      }

      const output = attention.forward(query, key, value, mask, seqLen);

      expect(output.length).toBe(inputSize);
      for (let i = 0; i < output.length; i++) {
        expect(isNaN(output[i])).toBe(false);
        expect(isFinite(output[i])).toBe(true);
      }
    });

    it('should handle fully masked input', () => {
      const seqLen = 4;
      const inputSize = seqLen * dimension;

      const query = new Float32Array(inputSize);
      const key = new Float32Array(inputSize);
      const value = new Float32Array(inputSize);

      for (let i = 0; i < inputSize; i++) {
        query[i] = 0.5;
        key[i] = 0.5;
        value[i] = 1.0;
      }

      // Mask everything
      const mask = new Float32Array(seqLen * seqLen); // All zeros

      const output = attention.forward(query, key, value, mask, seqLen);

      expect(output.length).toBe(inputSize);
      for (let i = 0; i < output.length; i++) {
        expect(isNaN(output[i])).toBe(false);
        expect(isFinite(output[i])).toBe(true);
      }
    });
  });

  describe('Numerical Stability', () => {
    it('should not produce NaN or Inf with normal inputs', () => {
      const seqLen = 10;
      const inputSize = seqLen * dimension;

      const query = new Float32Array(inputSize);
      const key = new Float32Array(inputSize);
      const value = new Float32Array(inputSize);

      for (let i = 0; i < inputSize; i++) {
        query[i] = Math.sin(i * 0.1) * 2;
        key[i] = Math.cos(i * 0.1) * 2;
        value[i] = Math.sin(i * 0.2) * 3;
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      for (let i = 0; i < output.length; i++) {
        expect(isNaN(output[i])).toBe(false);
        expect(isFinite(output[i])).toBe(true);
      }
    });

    it('should handle large values without overflow', () => {
      const seqLen = 6;
      const inputSize = seqLen * dimension;

      const query = new Float32Array(inputSize);
      const key = new Float32Array(inputSize);
      const value = new Float32Array(inputSize);

      for (let i = 0; i < inputSize; i++) {
        query[i] = 10.0;
        key[i] = 10.0;
        value[i] = 100.0;
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      for (let i = 0; i < output.length; i++) {
        expect(isNaN(output[i])).toBe(false);
        expect(isFinite(output[i])).toBe(true);
      }
    });

    it('should handle small values without underflow', () => {
      const seqLen = 6;
      const inputSize = seqLen * dimension;

      const query = new Float32Array(inputSize);
      const key = new Float32Array(inputSize);
      const value = new Float32Array(inputSize);

      for (let i = 0; i < inputSize; i++) {
        query[i] = 1e-5;
        key[i] = 1e-5;
        value[i] = 1e-4;
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      for (let i = 0; i < output.length; i++) {
        expect(isNaN(output[i])).toBe(false);
        expect(isFinite(output[i])).toBe(true);
      }
    });
  });

  describe('Determinism', () => {
    it('should produce identical outputs for identical inputs', () => {
      const seqLen = 8;
      const inputSize = seqLen * dimension;

      const query = new Float32Array(inputSize);
      const key = new Float32Array(inputSize);
      const value = new Float32Array(inputSize);

      for (let i = 0; i < inputSize; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = Math.sin(i * 0.2);
      }

      const output1 = attention.forward(query, key, value, undefined, seqLen);
      const output2 = attention.forward(query, key, value, undefined, seqLen);

      for (let i = 0; i < output1.length; i++) {
        expect(output1[i]).toBe(output2[i]);
      }
    });

    it('should produce identical results with same seed', () => {
      const attn1 = new RealSlidingWindowAttention({
        dimension,
        numHeads,
        windowSize,
        seed: 123
      });
      const attn2 = new RealSlidingWindowAttention({
        dimension,
        numHeads,
        windowSize,
        seed: 123
      });

      const seqLen = 6;
      const inputSize = seqLen * dimension;

      const query = new Float32Array(inputSize);
      const key = new Float32Array(inputSize);
      const value = new Float32Array(inputSize);

      for (let i = 0; i < inputSize; i++) {
        query[i] = 0.5 + 0.1 * i;
        key[i] = 0.5 + 0.1 * i;
        value[i] = 1.0 + 0.2 * i;
      }

      const output1 = attn1.forward(query, key, value, undefined, seqLen);
      const output2 = attn2.forward(query, key, value, undefined, seqLen);

      for (let i = 0; i < output1.length; i++) {
        expect(output1[i]).toBe(output2[i]);
      }
    });
  });

  describe('Input Validation', () => {
    it('should reject null or undefined inputs', () => {
      const seqLen = 4;
      const inputSize = seqLen * dimension;
      const valid = new Float32Array(inputSize);

      expect(() => attention.forward(null as any, valid, valid, undefined, seqLen))
        .toThrow('query, key, and value must be provided');
      expect(() => attention.forward(valid, null as any, valid, undefined, seqLen))
        .toThrow('query, key, and value must be provided');
      expect(() => attention.forward(valid, valid, null as any, undefined, seqLen))
        .toThrow('query, key, and value must be provided');
    });

    it('should reject mismatched input lengths', () => {
      const seqLen = 4;
      const inputSize = seqLen * dimension;

      const query = new Float32Array(inputSize);
      const key = new Float32Array(inputSize);
      const value = new Float32Array(inputSize - 1); // Wrong size

      expect(() => attention.forward(query, key, value, undefined, seqLen))
        .toThrow('Input length mismatch');
    });

    it('should reject zero sequence length', () => {
      const query = new Float32Array(0);
      const key = new Float32Array(0);
      const value = new Float32Array(0);

      expect(() => attention.forward(query, key, value, undefined, 0))
        .toThrow('Sequence length cannot be zero');
    });
  });

  describe('Parameter Count', () => {
    it('should return correct parameter count', () => {
      const expected = 4 * dimension * dimension; // Q, K, V, O matrices
      expect(attention.getParameterCount()).toBe(expected);
    });

    it('should scale parameter count with dimension', () => {
      const smallAttn = new RealSlidingWindowAttention({
        dimension: 32,
        numHeads: 2,
        windowSize: 8
      });
      const largeAttn = new RealSlidingWindowAttention({
        dimension: 128,
        numHeads: 4,
        windowSize: 8
      });

      expect(largeAttn.getParameterCount()).toBeGreaterThan(smallAttn.getParameterCount());
      expect(smallAttn.getParameterCount()).toBe(4 * 32 * 32);
      expect(largeAttn.getParameterCount()).toBe(4 * 128 * 128);
    });
  });
});
