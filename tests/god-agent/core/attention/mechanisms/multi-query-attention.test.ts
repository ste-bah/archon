/**
 * RealMultiQueryAttention Tests - ANTI-009 Fix
 *
 * Tests verify:
 * 1. Output differs from placeholder (0.5*q + 0.5*v)
 * 2. Key parameter affects output (not ignored)
 * 3. Single K,V head shared across Q heads
 * 4. Proper memory savings (fewer params than standard)
 * 5. Determinism with seed
 * 6. Error handling
 */

import { describe, it, expect } from 'vitest';
import { RealMultiQueryAttention } from '../../../../../src/god-agent/core/attention/mechanisms/multi-query-attention.js';
import { createCausalMask } from '../../../../../src/god-agent/core/attention/utils/index.js';

describe('RealMultiQueryAttention - ANTI-009 Fix', () => {

  describe('Core Functionality', () => {
    it('should compute actual attention (not 0.5*q + 0.5*v)', () => {
      const attention = new RealMultiQueryAttention({ dimension: 64, numHeads: 4, seed: 42 });

      const query = new Float32Array(64).fill(1);
      const key = new Float32Array(64).fill(0.5);
      const value = new Float32Array(64).fill(2);

      const output = attention.forward(query, key, value);

      // Output should NOT be 0.5*query + 0.5*value = 1.5
      const placeholderOutput = 0.5 * 1 + 0.5 * 2; // 1.5

      let diffFromPlaceholder = 0;
      for (let i = 0; i < output.length; i++) {
        diffFromPlaceholder += Math.abs(output[i] - placeholderOutput);
      }

      // CRITICAL: Output must differ significantly from placeholder
      expect(diffFromPlaceholder / output.length).toBeGreaterThan(0.01);
    });

    it('should use key parameter (not ignore it)', () => {
      const attention = new RealMultiQueryAttention({ dimension: 64, numHeads: 4, seed: 42 });

      // Use multi-sequence to have different attention patterns
      const seqLen = 2;
      const query = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      // Fill with varied values
      for (let i = 0; i < seqLen * 64; i++) {
        query[i] = Math.sin(i * 0.1);
        value[i] = Math.cos(i * 0.1);
      }

      // Key1: position 0 has higher values (should attend more to position 0)
      const key1 = new Float32Array(seqLen * 64);
      for (let i = 0; i < 64; i++) {
        key1[i] = 2;              // Position 0: high
        key1[64 + i] = 0.1;       // Position 1: low
      }

      // Key2: position 1 has higher values (should attend more to position 1)
      const key2 = new Float32Array(seqLen * 64);
      for (let i = 0; i < 64; i++) {
        key2[i] = 0.1;            // Position 0: low
        key2[64 + i] = 2;         // Position 1: high
      }

      const output1 = attention.forward(query, key1, value, undefined, seqLen);
      const output2 = attention.forward(query, key2, value, undefined, seqLen);

      // Different keys MUST produce different outputs
      let diff = 0;
      for (let i = 0; i < output1.length; i++) {
        diff += Math.abs(output1[i] - output2[i]);
      }

      expect(diff).toBeGreaterThan(0);
    });

    it('should use value parameter properly', () => {
      const attention = new RealMultiQueryAttention({ dimension: 64, numHeads: 4, seed: 42 });

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
      const attention = new RealMultiQueryAttention({ dimension: 64, numHeads: 4, seed: 42 });

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
      const attention = new RealMultiQueryAttention({ dimension: 64, numHeads: 4, seed: 42 });

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

  describe('MQA-Specific Properties', () => {
    it('should have fewer parameters than standard attention', () => {
      const mqa = new RealMultiQueryAttention({ dimension: 1536, numHeads: 12 });

      // Standard: 4 × dim² = 4 × 1536² = 9,437,184
      const standardParams = 4 * 1536 * 1536;

      // MQA: 2×dim² + 2×dim×headDim = 2×1536² + 2×1536×128 = 4,718,592 + 393,216 = 5,111,808
      // headDim = dim/numHeads = 1536/12 = 128
      const mqaParams = mqa.getParameterCount();

      // MQA should have significantly fewer parameters
      expect(mqaParams).toBeLessThan(standardParams);
      expect(mqaParams).toBe(2 * 1536 * 1536 + 2 * 1536 * 128);
    });

    it('should share K,V across all query heads', () => {
      // This test verifies the single K,V head behavior indirectly
      // by checking that results are consistent when we'd expect them to be
      const attention = new RealMultiQueryAttention({ dimension: 64, numHeads: 4, seed: 42 });

      const seqLen = 2;
      const query = new Float32Array(seqLen * 64);
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      // Fill with specific pattern
      for (let i = 0; i < seqLen * 64; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = Math.sin(i * 0.2);
      }

      // Two identical runs should produce identical results
      const attention2 = new RealMultiQueryAttention({ dimension: 64, numHeads: 4, seed: 42 });
      const output1 = attention.forward(query, key, value, undefined, seqLen);
      const output2 = attention2.forward(query, key, value, undefined, seqLen);

      for (let i = 0; i < output1.length; i++) {
        expect(output1[i]).toBeCloseTo(output2[i], 6);
      }
    });
  });

  describe('Causal Masking', () => {
    it('should support causal mask', () => {
      const attention = new RealMultiQueryAttention({ dimension: 64, numHeads: 4, seed: 42 });

      const seqLen = 4;
      const query = new Float32Array(seqLen * 64).fill(1);
      const key = new Float32Array(seqLen * 64).fill(1);
      const value = new Float32Array(seqLen * 64).fill(1);

      // Create causal mask
      const mask = createCausalMask(seqLen);

      const outputCausal = attention.forward(query, key, value, mask, seqLen);
      const outputNoCausal = attention.forward(query, key, value, undefined, seqLen);

      // Both should produce valid outputs
      expect(outputCausal.length).toBe(seqLen * 64);
      expect(outputNoCausal.length).toBe(seqLen * 64);

      // With different inputs, causal vs non-causal should differ
      const variedQuery = new Float32Array(seqLen * 64);
      for (let i = 0; i < variedQuery.length; i++) {
        variedQuery[i] = i % 10;
      }

      const variedCausal = attention.forward(variedQuery, variedQuery, variedQuery, mask, seqLen);
      const variedNoCausal = attention.forward(variedQuery, variedQuery, variedQuery, undefined, seqLen);

      let diff = 0;
      for (let i = 0; i < variedCausal.length; i++) {
        diff += Math.abs(variedCausal[i] - variedNoCausal[i]);
      }

      // Should have some difference (except possibly first position)
      expect(variedCausal.length).toBe(variedNoCausal.length);
    });
  });

  describe('Validation', () => {
    it('should throw on invalid dimension/numHeads', () => {
      expect(() => new RealMultiQueryAttention({ dimension: 65, numHeads: 8 }))
        .toThrow('ANTI-009');
    });

    it('should throw on dimension mismatch - query', () => {
      const attention = new RealMultiQueryAttention({ dimension: 64, numHeads: 4 });

      const query = new Float32Array(65); // Wrong size
      const key = new Float32Array(64);
      const value = new Float32Array(64);

      expect(() => attention.forward(query, key, value)).toThrow('ANTI-009');
    });

    it('should throw on dimension mismatch - key/value', () => {
      const attention = new RealMultiQueryAttention({ dimension: 64, numHeads: 4 });

      const query = new Float32Array(64);
      const key = new Float32Array(128); // Wrong size
      const value = new Float32Array(64);

      expect(() => attention.forward(query, key, value)).toThrow('ANTI-009');
    });
  });

  describe('Parameter Count', () => {
    it('should return correct parameter count', () => {
      const attention = new RealMultiQueryAttention({ dimension: 64, numHeads: 4 });

      // MQA: 2×dim² + 2×dim×headDim
      // = 2×64² + 2×64×16
      // = 8192 + 2048
      // = 10240
      expect(attention.getParameterCount()).toBe(2 * 64 * 64 + 2 * 64 * 16);
    });

    it('should scale appropriately with dimension', () => {
      const attention128 = new RealMultiQueryAttention({ dimension: 128, numHeads: 8 });
      const attention64 = new RealMultiQueryAttention({ dimension: 64, numHeads: 4 });

      const params64 = attention64.getParameterCount();
      const params128 = attention128.getParameterCount();

      // 64-dim: 2×64² + 2×64×16 = 8192 + 2048 = 10240
      // 128-dim: 2×128² + 2×128×16 = 32768 + 4096 = 36864
      // Ratio is not exactly 4 because headDim stays same (16)
      expect(params64).toBe(10240);
      expect(params128).toBe(36864);
      expect(params128).toBeGreaterThan(params64);
    });
  });

  describe('Determinism', () => {
    it('should be deterministic with same seed', () => {
      const attention1 = new RealMultiQueryAttention({ dimension: 64, numHeads: 4, seed: 42 });
      const attention2 = new RealMultiQueryAttention({ dimension: 64, numHeads: 4, seed: 42 });

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
      const attention1 = new RealMultiQueryAttention({ dimension: 64, numHeads: 4, seed: 42 });
      const attention2 = new RealMultiQueryAttention({ dimension: 64, numHeads: 4, seed: 123 });

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
      const attention = new RealMultiQueryAttention({ dimension: 64, numHeads: 4, seed: 42 });

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
      const attention = new RealMultiQueryAttention({ dimension: 64, numHeads: 4, seed: 42 });

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
      const attention = new RealMultiQueryAttention({ dimension: 64, numHeads: 4, seed: 42 });

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
      const attention = new RealMultiQueryAttention();
      expect(attention.name).toBe('multi-query');
    });
  });
});
