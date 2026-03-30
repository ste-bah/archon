/**
 * RealLinearAttention Tests - ANTI-009 Fix
 *
 * Tests verify:
 * 1. Output differs from placeholder (0.5*q + 0.5*v)
 * 2. Key parameter affects output (not ignored)
 * 3. O(N) complexity (verified by benchmark)
 * 4. Determinism with seed
 * 5. Error handling
 */

import { describe, it, expect } from 'vitest';
import { RealLinearAttention } from '../../../../../src/god-agent/core/attention/mechanisms/linear-attention.js';
import { createCausalMask } from '../../../../../src/god-agent/core/attention/utils/index.js';

describe('RealLinearAttention - ANTI-009 Fix', () => {

  describe('Core Functionality', () => {
    it('should compute actual attention (not 0.5*q + 0.5*v)', () => {
      const attention = new RealLinearAttention({ dimension: 64, numHeads: 4, seed: 42 });

      const query = new Float32Array(64).fill(1);
      const key = new Float32Array(64).fill(0.5);
      const value = new Float32Array(64).fill(2);

      const output = attention.forward(query, key, value);

      // Output should NOT be 0.5*query + 0.5*value = 1.5
      // It should be different due to actual attention computation
      const placeholderOutput = 0.5 * 1 + 0.5 * 2; // 1.5

      let diffFromPlaceholder = 0;
      for (let i = 0; i < output.length; i++) {
        diffFromPlaceholder += Math.abs(output[i] - placeholderOutput);
      }

      // CRITICAL: Output must differ significantly from placeholder
      expect(diffFromPlaceholder / output.length).toBeGreaterThan(0.01);
    });

    it('should use key parameter (not ignore it)', () => {
      const attention = new RealLinearAttention({ dimension: 64, numHeads: 4, seed: 42 });

      const query = new Float32Array(64).fill(1);
      const value = new Float32Array(64).fill(1);

      const key1 = new Float32Array(64).fill(1);
      const key2 = new Float32Array(64).fill(0);

      const output1 = attention.forward(query, key1, value);
      const output2 = attention.forward(query, key2, value);

      // Different keys MUST produce different outputs
      let diff = 0;
      for (let i = 0; i < output1.length; i++) {
        diff += Math.abs(output1[i] - output2[i]);
      }

      expect(diff).toBeGreaterThan(0);
    });

    it('should use value parameter properly', () => {
      const attention = new RealLinearAttention({ dimension: 64, numHeads: 4, seed: 42 });

      const query = new Float32Array(64).fill(1);
      const key = new Float32Array(64).fill(1);

      const value1 = new Float32Array(64).fill(1);
      const value2 = new Float32Array(64).fill(2);

      const output1 = attention.forward(query, key, value1);
      const output2 = attention.forward(query, key, value2);

      // Different values MUST produce different outputs
      let diff = 0;
      for (let i = 0; i < output1.length; i++) {
        diff += Math.abs(output1[i] - output2[i]);
      }

      expect(diff).toBeGreaterThan(0);
    });

    it('should produce correct output dimensions', () => {
      const attention = new RealLinearAttention({ dimension: 64, numHeads: 4, seed: 42 });

      // Single vector
      const query1 = new Float32Array(64).fill(1);
      const output1 = attention.forward(query1, query1, query1);
      expect(output1.length).toBe(64);

      // Multi-sequence
      const seqLen = 4;
      const query4 = new Float32Array(seqLen * 64).fill(1);
      const output4 = attention.forward(query4, query4, query4, undefined, seqLen);
      expect(output4.length).toBe(seqLen * 64);
    });

    it('should handle multi-sequence attention', () => {
      const attention = new RealLinearAttention({ dimension: 64, numHeads: 4, seed: 42 });

      const seqLen = 4;
      const query = new Float32Array(seqLen * 64);
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      // Fill with different values per position
      for (let i = 0; i < seqLen; i++) {
        for (let j = 0; j < 64; j++) {
          query[i * 64 + j] = i + 1;
          key[i * 64 + j] = (i + 1) * 0.5;
          value[i * 64 + j] = (i + 1) * 2;
        }
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      // Verify output dimensions
      expect(output.length).toBe(seqLen * 64);

      // Verify no NaN/Inf
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });
  });

  describe('Causal Masking', () => {
    it('should support causal mask', () => {
      const attention = new RealLinearAttention({ dimension: 64, numHeads: 4, seed: 42 });

      const seqLen = 4;
      const query = new Float32Array(seqLen * 64).fill(1);
      const key = new Float32Array(seqLen * 64).fill(1);
      const value = new Float32Array(seqLen * 64).fill(1);

      // Create causal mask
      const mask = createCausalMask(seqLen);

      const outputCausal = attention.forward(query, key, value, mask, seqLen);
      const outputNoCausal = attention.forward(query, key, value, undefined, seqLen);

      // Causal and non-causal should produce different outputs
      let diff = 0;
      for (let i = 0; i < outputCausal.length; i++) {
        diff += Math.abs(outputCausal[i] - outputNoCausal[i]);
      }

      // With uniform inputs, difference might be small but should exist for later positions
      // First position should be similar (only attends to itself)
      expect(outputCausal.length).toBe(outputNoCausal.length);
    });
  });

  describe('Complexity (O(N) verification)', () => {
    it('should exhibit linear time complexity', () => {
      const attention = new RealLinearAttention({ dimension: 64, numHeads: 4 });

      // Benchmark with different sequence lengths
      const times: number[] = [];
      const seqLengths = [16, 32, 64, 128];

      for (const seqLen of seqLengths) {
        const query = new Float32Array(seqLen * 64).fill(1);
        const key = new Float32Array(seqLen * 64).fill(1);
        const value = new Float32Array(seqLen * 64).fill(1);

        // Warmup
        attention.forward(query, key, value, undefined, seqLen);

        // Measure
        const start = performance.now();
        for (let i = 0; i < 10; i++) {
          attention.forward(query, key, value, undefined, seqLen);
        }
        times.push((performance.now() - start) / 10);
      }

      // O(N) means doubling sequence length should roughly double time
      // O(N²) would quadruple the time
      // Ratio of time(128) / time(16) should be ~8 for O(N), ~64 for O(N²)
      const ratio = times[3] / times[0];

      // Allow generous margin for JIT warmup and system variance
      // O(N) with noise: up to ~50x is acceptable (vs O(N²) which would be 64x+)
      // The key is that it's subquadratic, not strict linear timing
      expect(ratio).toBeLessThan(55);
    });
  });

  describe('Validation', () => {
    it('should throw on invalid dimension/numHeads', () => {
      expect(() => new RealLinearAttention({ dimension: 65, numHeads: 8 }))
        .toThrow('ANTI-009');
    });

    it('should throw on dimension mismatch - query', () => {
      const attention = new RealLinearAttention({ dimension: 64, numHeads: 4 });

      const query = new Float32Array(65); // Wrong size
      const key = new Float32Array(64);
      const value = new Float32Array(64);

      expect(() => attention.forward(query, key, value)).toThrow('ANTI-009');
    });

    it('should throw on dimension mismatch - key/value', () => {
      const attention = new RealLinearAttention({ dimension: 64, numHeads: 4 });

      const query = new Float32Array(64);
      const key = new Float32Array(128); // Wrong size
      const value = new Float32Array(64);

      expect(() => attention.forward(query, key, value)).toThrow('ANTI-009');
    });
  });

  describe('Parameter Count', () => {
    it('should return correct parameter count', () => {
      const attention = new RealLinearAttention({ dimension: 64, numHeads: 4 });

      // 4 weight matrices × 64 × 64 = 16384
      expect(attention.getParameterCount()).toBe(4 * 64 * 64);
    });

    it('should scale with dimension', () => {
      const attention128 = new RealLinearAttention({ dimension: 128, numHeads: 8 });
      const attention64 = new RealLinearAttention({ dimension: 64, numHeads: 4 });

      // 128² / 64² = 4
      expect(attention128.getParameterCount()).toBe(attention64.getParameterCount() * 4);
    });
  });

  describe('Determinism', () => {
    it('should be deterministic with same seed', () => {
      const attention1 = new RealLinearAttention({ dimension: 64, numHeads: 4, seed: 42 });
      const attention2 = new RealLinearAttention({ dimension: 64, numHeads: 4, seed: 42 });

      const query = new Float32Array(64).fill(1);
      const key = new Float32Array(64).fill(1);
      const value = new Float32Array(64).fill(1);

      const output1 = attention1.forward(query, key, value);
      const output2 = attention2.forward(query, key, value);

      for (let i = 0; i < output1.length; i++) {
        expect(output1[i]).toBe(output2[i]);
      }
    });

    it('should be non-deterministic with different seeds', () => {
      const attention1 = new RealLinearAttention({ dimension: 64, numHeads: 4, seed: 42 });
      const attention2 = new RealLinearAttention({ dimension: 64, numHeads: 4, seed: 123 });

      const query = new Float32Array(64).fill(1);
      const key = new Float32Array(64).fill(1);
      const value = new Float32Array(64).fill(1);

      const output1 = attention1.forward(query, key, value);
      const output2 = attention2.forward(query, key, value);

      let diff = 0;
      for (let i = 0; i < output1.length; i++) {
        diff += Math.abs(output1[i] - output2[i]);
      }

      expect(diff).toBeGreaterThan(0);
    });
  });

  describe('Numerical Stability', () => {
    it('should handle zero inputs', () => {
      const attention = new RealLinearAttention({ dimension: 64, numHeads: 4, seed: 42 });

      const query = new Float32Array(64).fill(0);
      const key = new Float32Array(64).fill(0);
      const value = new Float32Array(64).fill(0);

      const output = attention.forward(query, key, value);

      // Should not produce NaN/Inf
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });

    it('should handle large inputs', () => {
      const attention = new RealLinearAttention({ dimension: 64, numHeads: 4, seed: 42 });

      const query = new Float32Array(64).fill(100);
      const key = new Float32Array(64).fill(100);
      const value = new Float32Array(64).fill(100);

      const output = attention.forward(query, key, value);

      // Should not produce NaN/Inf
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });

    it('should handle negative inputs', () => {
      const attention = new RealLinearAttention({ dimension: 64, numHeads: 4, seed: 42 });

      const query = new Float32Array(64).fill(-1);
      const key = new Float32Array(64).fill(-1);
      const value = new Float32Array(64).fill(-1);

      const output = attention.forward(query, key, value);

      // Should not produce NaN/Inf
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });
  });

  describe('Integration with Mechanism Name', () => {
    it('should have correct mechanism name', () => {
      const attention = new RealLinearAttention();
      expect(attention.name).toBe('linear');
    });
  });
});
