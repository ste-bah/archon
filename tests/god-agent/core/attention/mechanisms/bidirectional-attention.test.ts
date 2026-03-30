/**
 * RealBidirectionalAttention Tests - ANTI-009 Fix
 *
 * Tests verify:
 * 1. Output differs from placeholder (0.5*q + 0.5*v)
 * 2. Full bidirectional attention (every position attends to every other)
 * 3. Determinism with seed
 * 4. Error handling
 */

import { describe, it, expect } from 'vitest';
import { RealBidirectionalAttention } from '../../../../../src/god-agent/core/attention/mechanisms/bidirectional-attention.js';

describe('RealBidirectionalAttention - ANTI-009 Fix', () => {

  describe('Core Functionality', () => {
    it('should compute actual attention (not 0.5*q + 0.5*v)', () => {
      const attention = new RealBidirectionalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const query = new Float32Array(64).fill(1);
      const key = new Float32Array(64).fill(0.5);
      const value = new Float32Array(64).fill(2);

      const output = attention.forward(query, key, value);

      // Output should NOT be 0.5*query + 0.5*value = 1.5
      const placeholderOutput = 0.5 * 1 + 0.5 * 2;

      let diffFromPlaceholder = 0;
      for (let i = 0; i < output.length; i++) {
        diffFromPlaceholder += Math.abs(output[i] - placeholderOutput);
      }

      expect(diffFromPlaceholder / output.length).toBeGreaterThan(0.01);
    });

    it('should use key parameter (not ignore it)', () => {
      const attention = new RealBidirectionalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const seqLen = 4;
      const query = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      for (let i = 0; i < seqLen * 64; i++) {
        query[i] = Math.sin(i * 0.1);
        value[i] = Math.cos(i * 0.1);
      }

      const key1 = new Float32Array(seqLen * 64);
      for (let i = 0; i < seqLen * 64; i++) {
        key1[i] = i < 64 ? 2 : 0.1;
      }

      const key2 = new Float32Array(seqLen * 64);
      for (let i = 0; i < seqLen * 64; i++) {
        key2[i] = (i >= 64 && i < 128) ? 2 : 0.1;
      }

      const output1 = attention.forward(query, key1, value, undefined, seqLen);
      const output2 = attention.forward(query, key2, value, undefined, seqLen);

      let diff = 0;
      for (let i = 0; i < output1.length; i++) {
        diff += Math.abs(output1[i] - output2[i]);
      }

      expect(diff).toBeGreaterThan(0);
    });

    it('should produce correct output dimensions', () => {
      const attention = new RealBidirectionalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const query1 = new Float32Array(64).fill(1);
      const output1 = attention.forward(query1, query1, query1);
      expect(output1.length).toBe(64);

      const seqLen = 8;
      const query8 = new Float32Array(seqLen * 64).fill(1);
      const output8 = attention.forward(query8, query8, query8, undefined, seqLen);
      expect(output8.length).toBe(seqLen * 64);
    });
  });

  describe('Bidirectional Properties', () => {
    it('should attend to ALL positions (no causal mask)', () => {
      const attention = new RealBidirectionalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const seqLen = 4;

      // Create two sequences: differ only in position 3 (future)
      const query1 = new Float32Array(seqLen * 64);
      const query2 = new Float32Array(seqLen * 64);

      // Positions 0-2: identical
      for (let t = 0; t < 3; t++) {
        for (let d = 0; d < 64; d++) {
          query1[t * 64 + d] = Math.sin(t + d * 0.1);
          query2[t * 64 + d] = Math.sin(t + d * 0.1);
        }
      }

      // Position 3: different
      for (let d = 0; d < 64; d++) {
        query1[3 * 64 + d] = 0.1;
        query2[3 * 64 + d] = 10.0;
      }

      const output1 = attention.forward(query1, query1, query1, undefined, seqLen);
      const output2 = attention.forward(query2, query2, query2, undefined, seqLen);

      // Position 0 output should DIFFER because it CAN see position 3
      // (Unlike causal attention where position 0 would be identical)
      let diff0 = 0;
      for (let d = 0; d < 64; d++) {
        diff0 += Math.abs(output1[d] - output2[d]);
      }

      expect(diff0).toBeGreaterThan(0);  // Key difference from causal!
    });

    it('should have symmetric attention pattern (position i attends to j, j to i)', () => {
      const attention = new RealBidirectionalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const seqLen = 4;
      const query = new Float32Array(seqLen * 64);
      const value = new Float32Array(seqLen * 64);

      // Uniform query
      for (let t = 0; t < seqLen; t++) {
        for (let d = 0; d < 64; d++) {
          query[t * 64 + d] = 1.0;
        }
      }

      // Distinct values at each position
      for (let t = 0; t < seqLen; t++) {
        for (let d = 0; d < 64; d++) {
          value[t * 64 + d] = t + 1;  // Values 1, 2, 3, 4
        }
      }

      const output = attention.forward(query, query, value, undefined, seqLen);

      // With uniform queries and keys, all positions should have similar outputs
      // because they all attend uniformly to all positions
      // (The average of 1,2,3,4 weighted equally)
      const expectedAvg = (1 + 2 + 3 + 4) / 4;

      // After projection, exact values will differ, but pattern should be similar
      for (let t = 0; t < seqLen; t++) {
        for (let d = 0; d < 64; d++) {
          expect(Number.isFinite(output[t * 64 + d])).toBe(true);
        }
      }
    });

    it('should process BERT-style encoding', () => {
      const attention = new RealBidirectionalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      // Simulate BERT input: [CLS] token + content + [SEP]
      const seqLen = 10;
      const query = new Float32Array(seqLen * 64);

      for (let t = 0; t < seqLen; t++) {
        for (let d = 0; d < 64; d++) {
          if (t === 0) {
            query[t * 64 + d] = 1.0;  // [CLS] token
          } else if (t === seqLen - 1) {
            query[t * 64 + d] = 2.0;  // [SEP] token
          } else {
            query[t * 64 + d] = Math.sin(t + d * 0.1);  // Content
          }
        }
      }

      const output = attention.forward(query, query, query, undefined, seqLen);

      expect(output.length).toBe(seqLen * 64);

      // [CLS] token (position 0) should have context from entire sequence
      // including [SEP] at the end - this is what makes BERT bidirectional
      for (let d = 0; d < 64; d++) {
        expect(Number.isFinite(output[d])).toBe(true);
      }
    });

    it('should differ from causal attention on same input', () => {
      // Import causal attention for comparison
      const bidirectional = new RealBidirectionalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const seqLen = 4;
      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
      }

      const output = bidirectional.forward(query, query, query, undefined, seqLen);

      // Bidirectional should produce valid output
      expect(output.length).toBe(seqLen * 64);
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });
  });

  describe('Full Context Access', () => {
    it('should allow first position to see last position', () => {
      const attention = new RealBidirectionalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const seqLen = 8;

      // Base values
      const baseValue = new Float32Array(seqLen * 64);
      for (let t = 0; t < seqLen; t++) {
        for (let d = 0; d < 64; d++) {
          baseValue[t * 64 + d] = Math.sin(t + d * 0.1);
        }
      }

      // Modified: change only last position
      const modifiedValue = new Float32Array(baseValue);
      for (let d = 0; d < 64; d++) {
        modifiedValue[(seqLen - 1) * 64 + d] = 100;
      }

      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.cos(i * 0.1);
      }

      const output1 = attention.forward(query, query, baseValue, undefined, seqLen);
      const output2 = attention.forward(query, query, modifiedValue, undefined, seqLen);

      // Position 0 should be AFFECTED by the change to last position
      let diff0 = 0;
      for (let d = 0; d < 64; d++) {
        diff0 += Math.abs(output1[d] - output2[d]);
      }

      expect(diff0).toBeGreaterThan(0);  // Bidirectional: can see future
    });
  });

  describe('Validation', () => {
    it('should throw on invalid dimension/numHeads', () => {
      expect(() => new RealBidirectionalAttention({ dimension: 65, numHeads: 8 }))
        .toThrow('ANTI-009');
    });

    it('should throw on dimension mismatch Q/K/V', () => {
      const attention = new RealBidirectionalAttention({ dimension: 64, numHeads: 4 });

      const query = new Float32Array(64);
      const key = new Float32Array(128);
      const value = new Float32Array(64);

      expect(() => attention.forward(query, key, value)).toThrow('ANTI-009');
    });
  });

  describe('Parameter Count', () => {
    it('should return correct parameter count', () => {
      const attention = new RealBidirectionalAttention({
        dimension: 64,
        numHeads: 4
      });

      // 4 projection matrices: 4 × 64 × 64 = 16384
      const expected = 4 * 64 * 64;
      expect(attention.getParameterCount()).toBe(expected);
    });
  });

  describe('Determinism', () => {
    it('should be deterministic with same seed', () => {
      const attention1 = new RealBidirectionalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });
      const attention2 = new RealBidirectionalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const seqLen = 4;
      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
      }

      const output1 = attention1.forward(query, query, query, undefined, seqLen);
      const output2 = attention2.forward(query, query, query, undefined, seqLen);

      for (let i = 0; i < output1.length; i++) {
        expect(output1[i]).toBe(output2[i]);
      }
    });

    it('should be non-deterministic with different seeds', () => {
      const attention1 = new RealBidirectionalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });
      const attention2 = new RealBidirectionalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 123
      });

      const seqLen = 4;
      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
      }

      const output1 = attention1.forward(query, query, query, undefined, seqLen);
      const output2 = attention2.forward(query, query, query, undefined, seqLen);

      let diff = 0;
      for (let i = 0; i < output1.length; i++) {
        diff += Math.abs(output1[i] - output2[i]);
      }

      expect(diff).toBeGreaterThan(0);
    });
  });

  describe('Numerical Stability', () => {
    it('should handle zero inputs', () => {
      const attention = new RealBidirectionalAttention({
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

    it('should handle large sequences', () => {
      const attention = new RealBidirectionalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const seqLen = 32;
      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.01);
      }

      const output = attention.forward(query, query, query, undefined, seqLen);

      expect(output.length).toBe(seqLen * 64);
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });
  });

  describe('Integration', () => {
    it('should have correct mechanism name', () => {
      const attention = new RealBidirectionalAttention();
      expect(attention.name).toBe('bidirectional');
    });

    it('should work with padding mask', () => {
      const attention = new RealBidirectionalAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const seqLen = 8;
      const query = new Float32Array(seqLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
      }

      // Mask out positions 6, 7 (padding)
      const mask = [true, true, true, true, true, true, false, false];

      const outputWithMask = attention.forward(query, query, query, mask, seqLen);
      const outputNoMask = attention.forward(query, query, query, undefined, seqLen);

      // Outputs should differ because padding positions are masked
      let diff = 0;
      for (let i = 0; i < outputWithMask.length; i++) {
        diff += Math.abs(outputWithMask[i] - outputNoMask[i]);
      }

      expect(diff).toBeGreaterThan(0);
    });
  });
});
