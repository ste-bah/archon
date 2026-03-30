/**
 * RealCrossAttention Tests - ANTI-009 Fix
 *
 * Tests verify:
 * 1. Output differs from placeholder (0.5*q + 0.5*v)
 * 2. Cross-attention behavior (query/context separation)
 * 3. Determinism with seed
 * 4. Error handling
 */

import { describe, it, expect } from 'vitest';
import { RealCrossAttention } from '../../../../../src/god-agent/core/attention/mechanisms/cross-attention.js';

describe('RealCrossAttention - ANTI-009 Fix', () => {

  describe('Core Functionality', () => {
    it('should compute actual attention (not 0.5*q + 0.5*v)', () => {
      const attention = new RealCrossAttention({
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
      const attention = new RealCrossAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const queryLen = 2;
      const contextLen = 4;
      const query = new Float32Array(queryLen * 64);
      const value = new Float32Array(contextLen * 64);

      for (let i = 0; i < queryLen * 64; i++) {
        query[i] = Math.sin(i * 0.1);
      }
      for (let i = 0; i < contextLen * 64; i++) {
        value[i] = Math.cos(i * 0.1);
      }

      const key1 = new Float32Array(contextLen * 64);
      for (let i = 0; i < contextLen * 64; i++) {
        key1[i] = i < 64 ? 2 : 0.1;
      }

      const key2 = new Float32Array(contextLen * 64);
      for (let i = 0; i < contextLen * 64; i++) {
        key2[i] = (i >= 64 && i < 128) ? 2 : 0.1;
      }

      const output1 = attention.forward(query, key1, value, undefined, queryLen);
      const output2 = attention.forward(query, key2, value, undefined, queryLen);

      let diff = 0;
      for (let i = 0; i < output1.length; i++) {
        diff += Math.abs(output1[i] - output2[i]);
      }

      expect(diff).toBeGreaterThan(0);
    });

    it('should produce correct output dimensions', () => {
      const attention = new RealCrossAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      // Single position query, single position context
      const query1 = new Float32Array(64).fill(1);
      const key1 = new Float32Array(64).fill(1);
      const output1 = attention.forward(query1, key1, key1);
      expect(output1.length).toBe(64);

      // Query length != context length
      const queryLen = 4;
      const contextLen = 8;
      const query = new Float32Array(queryLen * 64).fill(1);
      const context = new Float32Array(contextLen * 64).fill(1);
      const output = attention.forward(query, context, context, undefined, queryLen);
      expect(output.length).toBe(queryLen * 64);  // Output matches query length
    });
  });

  describe('Cross Attention Properties', () => {
    it('should support different query and context lengths', () => {
      const attention = new RealCrossAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const queryLen = 2;
      const contextLen = 8;

      const query = new Float32Array(queryLen * 64);
      const key = new Float32Array(contextLen * 64);
      const value = new Float32Array(contextLen * 64);

      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
      }
      for (let i = 0; i < key.length; i++) {
        key[i] = Math.cos(i * 0.05);
        value[i] = Math.sin(i * 0.05);
      }

      const output = attention.forward(query, key, value, undefined, queryLen);

      expect(output.length).toBe(queryLen * 64);
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });

    it('should attend only to unmasked context positions', () => {
      const attention = new RealCrossAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const queryLen = 1;
      const contextLen = 4;

      const query = new Float32Array(queryLen * 64).fill(1);
      const key = new Float32Array(contextLen * 64);
      const value = new Float32Array(contextLen * 64);

      // Different values at each context position
      for (let t = 0; t < contextLen; t++) {
        for (let d = 0; d < 64; d++) {
          key[t * 64 + d] = 1.0;
          value[t * 64 + d] = t + 1;  // Values 1, 2, 3, 4
        }
      }

      // Mask: only position 0 visible
      const mask1 = [true, false, false, false];
      const output1 = attention.forward(query, key, value, mask1, queryLen);

      // Mask: only position 3 visible
      const mask2 = [false, false, false, true];
      const output2 = attention.forward(query, key, value, mask2, queryLen);

      // Outputs should differ based on which context position is attended to
      let diff = 0;
      for (let i = 0; i < output1.length; i++) {
        diff += Math.abs(output1[i] - output2[i]);
      }

      expect(diff).toBeGreaterThan(0);
    });

    it('should handle encoder-decoder style attention', () => {
      // Simulating: decoder query attends to encoder context
      const attention = new RealCrossAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const decoderLen = 10;
      const encoderLen = 20;

      const decoderQuery = new Float32Array(decoderLen * 64);
      const encoderKey = new Float32Array(encoderLen * 64);
      const encoderValue = new Float32Array(encoderLen * 64);

      for (let i = 0; i < decoderQuery.length; i++) {
        decoderQuery[i] = Math.sin(i * 0.1);
      }
      for (let i = 0; i < encoderKey.length; i++) {
        encoderKey[i] = Math.cos(i * 0.05);
        encoderValue[i] = Math.tan(i * 0.02);
      }

      const output = attention.forward(
        decoderQuery,
        encoderKey,
        encoderValue,
        undefined,
        decoderLen
      );

      expect(output.length).toBe(decoderLen * 64);
    });
  });

  describe('Validation', () => {
    it('should throw on invalid dimension/numHeads', () => {
      expect(() => new RealCrossAttention({ dimension: 65, numHeads: 8 }))
        .toThrow('ANTI-009');
    });

    it('should throw on key/value length mismatch', () => {
      const attention = new RealCrossAttention({ dimension: 64, numHeads: 4 });

      const query = new Float32Array(64);
      const key = new Float32Array(128);
      const value = new Float32Array(64);

      expect(() => attention.forward(query, key, value)).toThrow('ANTI-009');
    });
  });

  describe('Parameter Count', () => {
    it('should return correct parameter count', () => {
      const attention = new RealCrossAttention({
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
      const attention1 = new RealCrossAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });
      const attention2 = new RealCrossAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const queryLen = 2;
      const contextLen = 4;
      const query = new Float32Array(queryLen * 64);
      const context = new Float32Array(contextLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
      }
      for (let i = 0; i < context.length; i++) {
        context[i] = Math.cos(i * 0.1);
      }

      const output1 = attention1.forward(query, context, context, undefined, queryLen);
      const output2 = attention2.forward(query, context, context, undefined, queryLen);

      for (let i = 0; i < output1.length; i++) {
        expect(output1[i]).toBe(output2[i]);
      }
    });

    it('should be non-deterministic with different seeds', () => {
      const attention1 = new RealCrossAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });
      const attention2 = new RealCrossAttention({
        dimension: 64,
        numHeads: 4,
        seed: 123
      });

      const queryLen = 2;
      const contextLen = 4;
      const query = new Float32Array(queryLen * 64);
      const context = new Float32Array(contextLen * 64);
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
      }
      for (let i = 0; i < context.length; i++) {
        context[i] = Math.cos(i * 0.1);
      }

      const output1 = attention1.forward(query, context, context, undefined, queryLen);
      const output2 = attention2.forward(query, context, context, undefined, queryLen);

      let diff = 0;
      for (let i = 0; i < output1.length; i++) {
        diff += Math.abs(output1[i] - output2[i]);
      }

      expect(diff).toBeGreaterThan(0);
    });
  });

  describe('Numerical Stability', () => {
    it('should handle zero inputs', () => {
      const attention = new RealCrossAttention({
        dimension: 64,
        numHeads: 4,
        seed: 42
      });

      const query = new Float32Array(64).fill(0);
      const context = new Float32Array(128).fill(0);

      const output = attention.forward(query, context, context);

      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });
  });

  describe('Integration', () => {
    it('should have correct mechanism name', () => {
      const attention = new RealCrossAttention();
      expect(attention.name).toBe('cross');
    });
  });
});
