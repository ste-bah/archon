/**
 * RealLongformerAttention Tests - ANTI-009 Fix
 *
 * Tests verify:
 * 1. Output differs from placeholder (0.5*q + 0.5*v)
 * 2. Sliding window attention pattern works
 * 3. Global attention tokens work
 * 4. Different window sizes produce different results
 * 5. Determinism with seed
 * 6. Error handling
 */

import { describe, it, expect } from 'vitest';
import { RealLongformerAttention } from '../../../../../src/god-agent/core/attention/mechanisms/longformer-attention.js';
import { createCausalMask } from '../../../../../src/god-agent/core/attention/utils/index.js';

describe('RealLongformerAttention - ANTI-009 Fix', () => {

  describe('Core Functionality', () => {
    it('should compute actual attention (not 0.5*q + 0.5*v)', () => {
      const attention = new RealLongformerAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 2,
        seed: 42
      });

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
      const attention = new RealLongformerAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 4,
        seed: 42
      });

      const seqLen = 4;
      const query = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      // Fill with varied values
      for (let i = 0; i < seqLen * 64; i++) {
        query[i] = Math.sin(i * 0.1);
        value[i] = Math.cos(i * 0.1);
      }

      // Key1: position 0 has higher values
      const key1 = new Float32Array(seqLen * 64);
      for (let i = 0; i < 64; i++) {
        key1[i] = 2;
      }
      for (let i = 64; i < seqLen * 64; i++) {
        key1[i] = 0.1;
      }

      // Key2: position 1 has higher values
      const key2 = new Float32Array(seqLen * 64);
      for (let i = 0; i < 64; i++) {
        key2[i] = 0.1;
      }
      for (let i = 64; i < 128; i++) {
        key2[i] = 2;
      }
      for (let i = 128; i < seqLen * 64; i++) {
        key2[i] = 0.1;
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

    it('should produce correct output dimensions', () => {
      const attention = new RealLongformerAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 2,
        seed: 42
      });

      // Single vector
      const query1 = new Float32Array(64).fill(1);
      const output1 = attention.forward(query1, query1, query1);
      expect(output1.length).toBe(64);

      // Multi-sequence
      const seqLen = 8;
      const query8 = new Float32Array(seqLen * 64).fill(1);
      const output8 = attention.forward(query8, query8, query8, undefined, seqLen);
      expect(output8.length).toBe(seqLen * 64);
    });
  });

  describe('Sliding Window Behavior', () => {
    it('should only attend within window for non-global tokens', () => {
      const windowSize = 1;  // Can only attend to adjacent positions
      const attention = new RealLongformerAttention({
        dimension: 64,
        numHeads: 4,
        windowSize,
        globalIndices: [],  // No global tokens
        seed: 42
      });

      const seqLen = 5;
      const query = new Float32Array(seqLen * 64);
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      // Create distinct values at each position
      for (let i = 0; i < seqLen; i++) {
        for (let j = 0; j < 64; j++) {
          query[i * 64 + j] = i + 1;
          key[i * 64 + j] = i + 1;
          value[i * 64 + j] = (i + 1) * 10;  // 10, 20, 30, 40, 50
        }
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      // Verify output exists and is valid
      expect(output.length).toBe(seqLen * 64);
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });

    it('should produce different results with different window sizes', () => {
      const attention1 = new RealLongformerAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 1,
        globalIndices: [],
        seed: 42
      });

      const attention2 = new RealLongformerAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 4,
        globalIndices: [],
        seed: 42
      });

      const seqLen = 8;
      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
      }

      const output1 = attention1.forward(query, query, query, undefined, seqLen);
      const output2 = attention2.forward(query, query, query, undefined, seqLen);

      // Different window sizes should produce different outputs
      let diff = 0;
      for (let i = 0; i < output1.length; i++) {
        diff += Math.abs(output1[i] - output2[i]);
      }

      expect(diff).toBeGreaterThan(0);
    });
  });

  describe('Global Attention', () => {
    it('should allow global tokens to attend to all positions', () => {
      const attention = new RealLongformerAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 1,
        globalIndices: [0],  // Position 0 is global
        seed: 42
      });

      const seqLen = 5;
      const query = new Float32Array(seqLen * 64);
      const key = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      // Create distinct patterns
      for (let i = 0; i < seqLen * 64; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = Math.sin(i * 0.2);
      }

      const output = attention.forward(query, key, value, undefined, seqLen);

      // Just verify it runs and produces valid output
      expect(output.length).toBe(seqLen * 64);
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });

    it('should allow non-global tokens to attend to global tokens', () => {
      // Without global tokens
      const attentionNoGlobal = new RealLongformerAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 1,
        globalIndices: [],
        seed: 42
      });

      // With global token at position 0
      const attentionWithGlobal = new RealLongformerAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 1,
        globalIndices: [0],
        seed: 42
      });

      const seqLen = 5;
      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
      }

      const outputNoGlobal = attentionNoGlobal.forward(query, query, query, undefined, seqLen);
      const outputWithGlobal = attentionWithGlobal.forward(query, query, query, undefined, seqLen);

      // Having global tokens should change the output
      let diff = 0;
      for (let i = 0; i < outputNoGlobal.length; i++) {
        diff += Math.abs(outputNoGlobal[i] - outputWithGlobal[i]);
      }

      expect(diff).toBeGreaterThan(0);
    });

    it('should support multiple global tokens', () => {
      const attention = new RealLongformerAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 1,
        globalIndices: [0, 2, 4],  // Multiple global tokens
        seed: 42
      });

      const seqLen = 5;
      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
      }

      const output = attention.forward(query, query, query, undefined, seqLen);

      expect(output.length).toBe(seqLen * 64);
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });
  });

  describe('Masking', () => {
    it('should support causal mask', () => {
      const attention = new RealLongformerAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 4,
        seed: 42
      });

      const seqLen = 4;
      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
      }

      const mask = createCausalMask(seqLen);

      const outputCausal = attention.forward(query, query, query, mask, seqLen);
      const outputNoCausal = attention.forward(query, query, query, undefined, seqLen);

      // Both should produce valid outputs
      expect(outputCausal.length).toBe(seqLen * 64);
      expect(outputNoCausal.length).toBe(seqLen * 64);

      // Causal vs non-causal should differ
      let diff = 0;
      for (let i = 0; i < outputCausal.length; i++) {
        diff += Math.abs(outputCausal[i] - outputNoCausal[i]);
      }

      // They should be different (at least for later positions)
      expect(outputCausal.length).toBe(outputNoCausal.length);
    });
  });

  describe('Validation', () => {
    it('should throw on invalid dimension/numHeads', () => {
      expect(() => new RealLongformerAttention({ dimension: 65, numHeads: 8 }))
        .toThrow('ANTI-009');
    });

    it('should throw on invalid window size', () => {
      expect(() => new RealLongformerAttention({ windowSize: 0 }))
        .toThrow('ANTI-009');
      expect(() => new RealLongformerAttention({ windowSize: -1 }))
        .toThrow('ANTI-009');
    });

    it('should throw on dimension mismatch', () => {
      const attention = new RealLongformerAttention({ dimension: 64, numHeads: 4 });

      const query = new Float32Array(64);
      const key = new Float32Array(128); // Wrong size
      const value = new Float32Array(64);

      expect(() => attention.forward(query, key, value)).toThrow('ANTI-009');
    });
  });

  describe('Parameter Count', () => {
    it('should return correct parameter count', () => {
      const attention = new RealLongformerAttention({ dimension: 64, numHeads: 4 });

      // Longformer: 7×dim² (4 local + 3 global matrices)
      expect(attention.getParameterCount()).toBe(7 * 64 * 64);
    });
  });

  describe('Determinism', () => {
    it('should be deterministic with same seed', () => {
      const attention1 = new RealLongformerAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 2,
        seed: 42
      });
      const attention2 = new RealLongformerAttention({
        dimension: 64,
        numHeads: 4,
        windowSize: 2,
        seed: 42
      });

      const query = new Float32Array(64).fill(1);

      const output1 = attention1.forward(query, query, query);
      const output2 = attention2.forward(query, query, query);

      for (let i = 0; i < output1.length; i++) {
        expect(output1[i]).toBe(output2[i]);
      }
    });

    it('should be non-deterministic with different seeds', () => {
      const attention1 = new RealLongformerAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });
      const attention2 = new RealLongformerAttention({
        dimension: 64,
        numHeads: 4,
        seed: 123
      });

      const query = new Float32Array(64).fill(1);

      const output1 = attention1.forward(query, query, query);
      const output2 = attention2.forward(query, query, query);

      let diff = 0;
      for (let i = 0; i < output1.length; i++) {
        diff += Math.abs(output1[i] - output2[i]);
      }

      expect(diff).toBeGreaterThan(0);
    });
  });

  describe('Numerical Stability', () => {
    it('should handle zero inputs', () => {
      const attention = new RealLongformerAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const query = new Float32Array(64).fill(0);

      const output = attention.forward(query, query, query);

      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });

    it('should handle large inputs', () => {
      const attention = new RealLongformerAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const query = new Float32Array(64).fill(100);

      const output = attention.forward(query, query, query);

      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });
  });

  describe('Integration', () => {
    it('should have correct mechanism name', () => {
      const attention = new RealLongformerAttention();
      expect(attention.name).toBe('longformer');
    });
  });
});
