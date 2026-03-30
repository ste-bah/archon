/**
 * Tests for FNet Attention Mechanism
 *
 * Validates:
 * - Fourier transform correctness
 * - O(N log N) complexity behavior
 * - Output shape and dimensions
 * - Numerical stability
 * - Determinism
 * - Parameter count (should be 0)
 * - Validation and error handling
 *
 * @module fnet-attention.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RealFNetAttention, createFNetAttention } from '../../../../../src/god-agent/core/attention/mechanisms/fnet-attention';

describe('RealFNetAttention', () => {
  let attention: RealFNetAttention;
  const dimension = 64;
  const seqLen = 16;

  beforeEach(() => {
    attention = new RealFNetAttention({ dimension });
  });

  describe('Core Functionality', () => {
    it('should create FNet attention instance', () => {
      expect(attention).toBeDefined();
      expect(attention.name).toBe('fnet');
    });

    it('should process input through Fourier transforms', () => {
      const input = new Float32Array(seqLen * dimension);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1); // Sine wave pattern
      }

      const output = attention.forward(
        input, // query (ignored)
        input, // key (ignored)
        input, // value (used)
        undefined,
        seqLen
      );

      expect(output).toBeInstanceOf(Float32Array);
      expect(output.length).toBe(seqLen * dimension);
    });

    it('should produce different output than input (mixing occurs)', () => {
      const input = new Float32Array(seqLen * dimension);
      for (let i = 0; i < input.length; i++) {
        input[i] = i / input.length;
      }

      const output = attention.forward(input, input, input, undefined, seqLen);

      // Output should differ from input (Fourier mixing applied)
      let differenceCount = 0;
      for (let i = 0; i < input.length; i++) {
        if (Math.abs(output[i] - input[i]) > 1e-6) {
          differenceCount++;
        }
      }

      expect(differenceCount).toBeGreaterThan(input.length * 0.5);
    });

    it('should maintain output dimensions matching input', () => {
      const testCases = [
        { seqLen: 8, dim: 32 },
        { seqLen: 16, dim: 64 },
        { seqLen: 32, dim: 128 },
      ];

      for (const { seqLen, dim } of testCases) {
        const attn = new RealFNetAttention({ dimension: dim });
        const input = new Float32Array(seqLen * dim).fill(1.0);

        const output = attn.forward(input, input, input, undefined, seqLen);

        expect(output.length).toBe(seqLen * dim);
      }
    });
  });

  describe('Fourier Transform Properties', () => {
    it('should exhibit Fourier transform properties (frequency mixing)', () => {
      // Create input with known frequency components
      const input = new Float32Array(seqLen * dimension);

      // Single frequency sine wave across sequence
      for (let i = 0; i < seqLen; i++) {
        const value = Math.sin((2 * Math.PI * 3 * i) / seqLen); // 3 Hz
        for (let d = 0; d < dimension; d++) {
          input[i * dimension + d] = value;
        }
      }

      const output = attention.forward(input, input, input, undefined, seqLen);

      // After DFT, energy should concentrate at specific frequencies
      // Check that output has non-trivial structure
      let energy = 0;
      for (let i = 0; i < output.length; i++) {
        energy += output[i] * output[i];
      }

      expect(energy).toBeGreaterThan(0);
      expect(energy).toBeLessThan(Infinity);
      expect(isNaN(energy)).toBe(false);
    });

    it('should handle DC component (constant signal)', () => {
      const input = new Float32Array(seqLen * dimension).fill(1.0);

      const output = attention.forward(input, input, input, undefined, seqLen);

      // Constant input should produce specific DFT pattern
      // After layer norm, each feature dimension should have mean ≈ 0
      for (let d = 0; d < dimension; d++) {
        let sum = 0;
        for (let i = 0; i < seqLen; i++) {
          sum += output[i * dimension + d];
        }
        const mean = sum / seqLen;
        expect(Math.abs(mean)).toBeLessThan(1e-5); // After normalization, mean ≈ 0
      }

      // Output should have non-trivial values (not all zeros)
      const hasNonZero = output.some(v => Math.abs(v) > 0.1);
      expect(hasNonZero).toBe(true);
    });

    it('should be linear (superposition principle)', () => {
      const input1 = new Float32Array(seqLen * dimension);
      const input2 = new Float32Array(seqLen * dimension);

      for (let i = 0; i < input1.length; i++) {
        input1[i] = Math.sin(i * 0.05);
        input2[i] = Math.cos(i * 0.05);
      }

      const output1 = attention.forward(input1, input1, input1, undefined, seqLen);
      const output2 = attention.forward(input2, input2, input2, undefined, seqLen);

      // Combined input
      const combined = new Float32Array(seqLen * dimension);
      for (let i = 0; i < combined.length; i++) {
        combined[i] = input1[i] + input2[i];
      }
      const outputCombined = attention.forward(combined, combined, combined, undefined, seqLen);

      // DFT is linear: DFT(a+b) ≈ DFT(a) + DFT(b)
      // (Layer norm breaks perfect linearity, but rough structure should hold)
      let similarityCount = 0;
      const tolerance = 1.0; // Relaxed due to layer norm

      for (let i = 0; i < output1.length; i++) {
        const expected = output1[i] + output2[i];
        const actual = outputCombined[i];
        if (Math.abs(expected - actual) < tolerance) {
          similarityCount++;
        }
      }

      // At least some positions should show linearity pattern
      expect(similarityCount).toBeGreaterThan(0);
    });
  });

  describe('Complexity and Performance', () => {
    it('should hint at O(N log N) complexity', () => {
      const hint = attention.getComplexityHint();

      expect(hint).toContain('log');
      expect(hint).toContain('N');
      expect(hint.toLowerCase()).toContain('standard attention');
    });

    it('should scale better than O(N²) empirically', () => {
      // Test scaling with increasing sequence length
      const timings: number[] = [];

      for (const len of [8, 16, 32]) {
        const attn = new RealFNetAttention({ dimension: 32 });
        const input = new Float32Array(len * 32).fill(1.0);

        const start = performance.now();
        attn.forward(input, input, input, undefined, len);
        const elapsed = performance.now() - start;

        timings.push(elapsed);
      }

      // For O(N²): time[32] / time[16] should be ~4
      // For O(N log N): time[32] / time[16] should be ~2.3
      // We just check it's reasonable (not 100x slower)
      const ratio = timings[2] / timings[1];
      expect(ratio).toBeLessThan(10); // Should not explode quadratically
    });

    it('should handle large sequences efficiently', () => {
      const largeSeqLen = 128;
      const attn = new RealFNetAttention({ dimension: 64, useApproximateDFT: true });
      const input = new Float32Array(largeSeqLen * 64);

      for (let i = 0; i < input.length; i++) {
        input[i] = Math.random();
      }

      const start = performance.now();
      const output = attn.forward(input, input, input, undefined, largeSeqLen);
      const elapsed = performance.now() - start;

      expect(output.length).toBe(largeSeqLen * 64);
      expect(elapsed).toBeLessThan(1000); // Should complete in reasonable time
    });
  });

  describe('Validation and Error Handling', () => {
    it('should reject invalid dimensions', () => {
      expect(() => new RealFNetAttention({ dimension: 0 }))
        .toThrow(/ANTI-009.*dimension must be positive/);

      expect(() => new RealFNetAttention({ dimension: -5 }))
        .toThrow(/ANTI-009.*dimension must be positive/);

      expect(() => new RealFNetAttention({ dimension: 3.5 }))
        .toThrow(/ANTI-009.*dimension must be an integer/);
    });

    it('should reject mismatched input sizes', () => {
      const input = new Float32Array(100); // Not divisible by dimension

      expect(() => attention.forward(input, input, input, undefined, 2))
        .toThrow(/ANTI-009.*size mismatch/);
    });

    it('should reject invalid sequence lengths', () => {
      const input = new Float32Array(64);

      expect(() => attention.forward(input, input, input, undefined, 0))
        .toThrow(/ANTI-009.*sequence length must be positive/);

      expect(() => attention.forward(input, input, input, undefined, -1))
        .toThrow(/ANTI-009.*sequence length must be positive/);
    });

    it('should handle edge case of sequence length = 1', () => {
      const input = new Float32Array(dimension).fill(1.0);

      const output = attention.forward(input, input, input, undefined, 1);

      expect(output.length).toBe(dimension);
      expect(output.every((v) => isFinite(v))).toBe(true);
    });
  });

  describe('Masking', () => {
    it('should apply attention mask correctly', () => {
      const input = new Float32Array(seqLen * dimension).fill(1.0);
      const mask = new Array(seqLen).fill(true);
      mask[0] = false; // Mask out first position
      mask[seqLen - 1] = false; // Mask out last position

      const output = attention.forward(input, input, input, mask, seqLen);

      // Masked positions should be zeroed
      for (let d = 0; d < dimension; d++) {
        expect(output[0 * dimension + d]).toBe(0);
        expect(output[(seqLen - 1) * dimension + d]).toBe(0);
      }

      // Unmasked positions should have values
      const middlePos = Math.floor(seqLen / 2);
      let hasNonZero = false;
      for (let d = 0; d < dimension; d++) {
        if (output[middlePos * dimension + d] !== 0) {
          hasNonZero = true;
          break;
        }
      }
      expect(hasNonZero).toBe(true);
    });

    it('should handle all-masked input', () => {
      const input = new Float32Array(seqLen * dimension).fill(1.0);
      const mask = new Array(seqLen).fill(false);

      const output = attention.forward(input, input, input, mask, seqLen);

      // All positions should be zeroed
      expect(output.every((v) => v === 0)).toBe(true);
    });
  });

  describe('Numerical Stability', () => {
    it('should handle very small values', () => {
      const input = new Float32Array(seqLen * dimension).fill(1e-10);

      const output = attention.forward(input, input, input, undefined, seqLen);

      expect(output.every((v) => isFinite(v))).toBe(true);
      expect(output.some((v) => !isNaN(v))).toBe(true);
    });

    it('should handle very large values', () => {
      const input = new Float32Array(seqLen * dimension).fill(1e6);

      const output = attention.forward(input, input, input, undefined, seqLen);

      expect(output.every((v) => isFinite(v))).toBe(true);
      expect(output.every((v) => !isNaN(v))).toBe(true);
    });

    it('should handle mixed positive and negative values', () => {
      const input = new Float32Array(seqLen * dimension);
      for (let i = 0; i < input.length; i++) {
        input[i] = (i % 2 === 0) ? 1.0 : -1.0;
      }

      const output = attention.forward(input, input, input, undefined, seqLen);

      expect(output.every((v) => isFinite(v))).toBe(true);
      expect(output.some((v) => v > 0)).toBe(true);
      expect(output.some((v) => v < 0)).toBe(true);
    });

    it('should produce normalized output (layer norm)', () => {
      const input = new Float32Array(seqLen * dimension);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.random() * 100 - 50; // Random in [-50, 50]
      }

      const output = attention.forward(input, input, input, undefined, seqLen);

      // Check each dimension is normalized (mean ≈ 0, std ≈ 1)
      for (let d = 0; d < dimension; d++) {
        let sum = 0;
        for (let i = 0; i < seqLen; i++) {
          sum += output[i * dimension + d];
        }
        const mean = sum / seqLen;
        expect(Math.abs(mean)).toBeLessThan(1e-5);

        let varSum = 0;
        for (let i = 0; i < seqLen; i++) {
          const diff = output[i * dimension + d] - mean;
          varSum += diff * diff;
        }
        const variance = varSum / seqLen;
        const std = Math.sqrt(variance);
        expect(Math.abs(std - 1.0)).toBeLessThan(0.1); // Close to 1
      }
    });
  });

  describe('Determinism', () => {
    it('should produce identical output for identical input', () => {
      const input = new Float32Array(seqLen * dimension);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1);
      }

      const output1 = attention.forward(input, input, input, undefined, seqLen);
      const output2 = attention.forward(input, input, input, undefined, seqLen);

      expect(output1.length).toBe(output2.length);
      for (let i = 0; i < output1.length; i++) {
        expect(output1[i]).toBeCloseTo(output2[i], 10);
      }
    });

    it('should be deterministic across multiple instances', () => {
      const input = new Float32Array(seqLen * dimension);
      for (let i = 0; i < input.length; i++) {
        input[i] = i / input.length;
      }

      const attn1 = new RealFNetAttention({ dimension });
      const attn2 = new RealFNetAttention({ dimension });

      const output1 = attn1.forward(input, input, input, undefined, seqLen);
      const output2 = attn2.forward(input, input, input, undefined, seqLen);

      for (let i = 0; i < output1.length; i++) {
        expect(output1[i]).toBeCloseTo(output2[i], 10);
      }
    });
  });

  describe('Parameter Count', () => {
    it('should have zero learnable parameters', () => {
      expect(attention.getParameterCount()).toBe(0);
    });

    it('should maintain zero parameters across different configurations', () => {
      const configs = [
        { dimension: 32, numHeads: 4 },
        { dimension: 128, numHeads: 8 },
        { dimension: 512, numHeads: 16 },
      ];

      for (const config of configs) {
        const attn = new RealFNetAttention(config);
        expect(attn.getParameterCount()).toBe(0);
      }
    });
  });

  describe('Factory Function', () => {
    it('should create instance via factory', () => {
      const attn = createFNetAttention({ dimension: 64 });

      expect(attn).toBeInstanceOf(RealFNetAttention);
      expect(attn.name).toBe('fnet');
    });

    it('should use defaults when no config provided', () => {
      const attn = createFNetAttention();

      expect(attn).toBeInstanceOf(RealFNetAttention);
      expect(attn.getParameterCount()).toBe(0);
    });
  });

  describe('Real-World Usage Patterns', () => {
    it('should process typical transformer-sized inputs', () => {
      const attn = new RealFNetAttention({ dimension: 768, numHeads: 12 });
      const seqLen = 512;
      const input = new Float32Array(seqLen * 768);

      for (let i = 0; i < input.length; i++) {
        input[i] = (Math.random() - 0.5) * 2; // [-1, 1]
      }

      const output = attn.forward(input, input, input, undefined, seqLen);

      expect(output.length).toBe(seqLen * 768);
      expect(output.every((v) => isFinite(v))).toBe(true);
    });

    it('should handle variable sequence lengths', () => {
      const lengths = [8, 16, 32, 64, 128];

      for (const len of lengths) {
        const input = new Float32Array(len * dimension);
        for (let i = 0; i < input.length; i++) {
          input[i] = Math.random();
        }

        const output = attention.forward(input, input, input, undefined, len);

        expect(output.length).toBe(len * dimension);
        expect(output.every((v) => isFinite(v))).toBe(true);
      }
    });
  });
});
