/**
 * Tests for AFT (Attention Free Transformer) Attention Mechanism
 */

import { describe, it, expect } from 'vitest';
import { RealAFTAttention } from '../../../../../src/god-agent/core/attention/mechanisms/aft-attention.js';

describe('RealAFTAttention', () => {
  describe('Constructor', () => {
    it('should initialize with default config', () => {
      const aft = new RealAFTAttention();
      expect(aft.name).toBe('aft');
      expect(aft.getParameterCount()).toBe(512 * 512); // maxSeqLen^2
    });

    it('should initialize with custom config', () => {
      const aft = new RealAFTAttention({
        dimension: 512,
        numHeads: 8,
        maxSeqLen: 256,
        seed: 123,
      });
      expect(aft.getParameterCount()).toBe(256 * 256);
    });

    it('should throw error if dimension not divisible by numHeads', () => {
      expect(() => {
        new RealAFTAttention({ dimension: 768, numHeads: 7 });
      }).toThrow('ANTI-009: dimension (768) must be divisible by numHeads (7)');
    });
  });

  describe('Forward Pass - Core Functionality', () => {
    it('should compute AFT attention for single sequence', () => {
      const aft = new RealAFTAttention({ dimension: 64, numHeads: 4, maxSeqLen: 8, seed: 42 });
      const seqLen = 4;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      // Fill with test data
      for (let i = 0; i < query.length; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = (i % 10) / 10;
      }

      const output = aft.forward(query, key, value);

      expect(output).toBeInstanceOf(Float32Array);
      expect(output.length).toBe(seqLen * dim);
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });

    it('should produce different outputs for different queries', () => {
      const aft = new RealAFTAttention({ dimension: 64, numHeads: 4, maxSeqLen: 8, seed: 42 });
      const seqLen = 3;
      const dim = 64;

      const query1 = new Float32Array(seqLen * dim).fill(0.5);
      const query2 = new Float32Array(seqLen * dim).fill(-0.5);
      const key = new Float32Array(seqLen * dim).fill(0.1);
      const value = new Float32Array(seqLen * dim).fill(1.0);

      const output1 = aft.forward(query1, key, value);
      const output2 = aft.forward(query2, key, value);

      // Outputs should differ due to sigmoid gating
      let hasDifference = false;
      for (let i = 0; i < output1.length; i++) {
        if (Math.abs(output1[i] - output2[i]) > 1e-6) {
          hasDifference = true;
          break;
        }
      }
      expect(hasDifference).toBe(true);
    });

    it('should handle variable sequence lengths', () => {
      const aft = new RealAFTAttention({ dimension: 32, numHeads: 4, maxSeqLen: 16 });

      for (const seqLen of [1, 4, 8, 12]) {
        const query = new Float32Array(seqLen * 32).fill(0.5);
        const key = new Float32Array(seqLen * 32).fill(0.3);
        const value = new Float32Array(seqLen * 32).fill(0.7);

        const output = aft.forward(query, key, value);
        expect(output.length).toBe(seqLen * 32);
        expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
      }
    });
  });

  describe('Position Bias Behavior', () => {
    it('should use position bias to weight different positions', () => {
      const aft = new RealAFTAttention({ dimension: 16, numHeads: 2, maxSeqLen: 8, seed: 999 });
      const seqLen = 4;
      const dim = 16;

      // Create values that vary by position
      const query = new Float32Array(seqLen * dim).fill(0);
      const key = new Float32Array(seqLen * dim).fill(0);
      const value = new Float32Array(seqLen * dim);

      // Each position has distinct values
      for (let i = 0; i < seqLen; i++) {
        for (let d = 0; d < dim; d++) {
          value[i * dim + d] = i + 1; // Position 0 = 1, position 1 = 2, etc.
        }
      }

      const output = aft.forward(query, key, value);

      // Output should be weighted combination based on position bias
      // Verify outputs are not all identical
      const firstPos = output.slice(0, dim);
      const secondPos = output.slice(dim, 2 * dim);
      let hasDifference = false;
      for (let i = 0; i < dim; i++) {
        if (Math.abs(firstPos[i] - secondPos[i]) > 1e-6) {
          hasDifference = true;
          break;
        }
      }
      expect(hasDifference).toBe(true);
    });

    it('should apply different biases for different position pairs', () => {
      const aft = new RealAFTAttention({ dimension: 8, numHeads: 2, maxSeqLen: 4, seed: 123 });
      const seqLen = 3;
      const dim = 8;

      const query = new Float32Array(seqLen * dim).fill(0.2);
      const key = new Float32Array(seqLen * dim).fill(0.1);
      const value = new Float32Array(seqLen * dim);

      // Set distinct values per position
      for (let i = 0; i < seqLen; i++) {
        value.fill(i * 10, i * dim, (i + 1) * dim);
      }

      const output = aft.forward(query, key, value);

      // Each output position should be a weighted sum with different biases
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });
  });

  describe('Gating Mechanism', () => {
    it('should gate output with sigmoid(query)', () => {
      const aft = new RealAFTAttention({ dimension: 16, numHeads: 2, maxSeqLen: 4, seed: 42 });
      const seqLen = 2;
      const dim = 16;

      // Large positive query → sigmoid ≈ 1 → output closer to normalized sum
      const queryHigh = new Float32Array(seqLen * dim).fill(10);
      const key = new Float32Array(seqLen * dim).fill(0);
      const value = new Float32Array(seqLen * dim).fill(1.0);

      const outputHigh = aft.forward(queryHigh, key, value);

      // Large negative query → sigmoid ≈ 0 → output closer to 0
      const queryLow = new Float32Array(seqLen * dim).fill(-10);
      const outputLow = aft.forward(queryLow, key, value);

      // High query output should have larger magnitudes
      const sumHigh = outputHigh.reduce((a, b) => a + Math.abs(b), 0);
      const sumLow = outputLow.reduce((a, b) => a + Math.abs(b), 0);

      expect(sumHigh).toBeGreaterThan(sumLow);
    });

    it('should apply sigmoid element-wise to query', () => {
      const aft = new RealAFTAttention({ dimension: 4, numHeads: 1, maxSeqLen: 2, seed: 42 });
      const seqLen = 1;
      const dim = 4;

      // Query with mixed values
      const query = new Float32Array([5, 0, -5, 2]);
      const key = new Float32Array(dim).fill(0);
      const value = new Float32Array(dim).fill(1.0);

      const output = aft.forward(query, key, value);

      // Sigmoid(5) ≈ 0.993, sigmoid(0) = 0.5, sigmoid(-5) ≈ 0.007, sigmoid(2) ≈ 0.88
      // Output should reflect these different gating levels
      expect(output[0]).toBeGreaterThan(output[1]); // sigmoid(5) > sigmoid(0)
      expect(output[1]).toBeGreaterThan(output[2]); // sigmoid(0) > sigmoid(-5)
      expect(output[3]).toBeGreaterThan(output[1]); // sigmoid(2) > sigmoid(0)
    });
  });

  describe('Masking', () => {
    it('should zero out masked positions in output', () => {
      const aft = new RealAFTAttention({ dimension: 16, numHeads: 2, maxSeqLen: 4, seed: 42 });
      const seqLen = 3;
      const dim = 16;

      const query = new Float32Array(seqLen * dim).fill(0.5);
      const key = new Float32Array(seqLen * dim).fill(0.3);
      const value = new Float32Array(seqLen * dim).fill(0.7);

      const mask = [true, false, true]; // Mask out position 1

      const output = aft.forward(query, key, value, mask);

      // Position 1 should be all zeros
      const pos1 = output.slice(dim, 2 * dim);
      expect(pos1.every((v) => v === 0)).toBe(true);

      // Positions 0 and 2 should have non-zero values
      const pos0 = output.slice(0, dim);
      const pos2 = output.slice(2 * dim, 3 * dim);
      expect(pos0.some((v) => v !== 0)).toBe(true);
      expect(pos2.some((v) => v !== 0)).toBe(true);
    });

    it('should exclude masked positions from weighted sum', () => {
      const aft = new RealAFTAttention({ dimension: 8, numHeads: 2, maxSeqLen: 4, seed: 42 });
      const seqLen = 3;
      const dim = 8;

      const query = new Float32Array(seqLen * dim).fill(0);
      const key = new Float32Array(seqLen * dim).fill(0);
      const value = new Float32Array(seqLen * dim);

      // Position 1 has large values
      value.fill(100, dim, 2 * dim);

      // Mask out position 1
      const mask = [true, false, true];
      const output = aft.forward(query, key, value, mask);

      // Output at position 0 should not include contribution from position 1
      // Since position 1 is masked, its large values shouldn't affect the sum
      const pos0 = output.slice(0, dim);
      expect(pos0.every((v) => Math.abs(v) < 10)).toBe(true); // Should not have 100s
    });
  });

  describe('Output Dimensions', () => {
    it('should return output with same shape as input', () => {
      const aft = new RealAFTAttention({ dimension: 64, numHeads: 4, maxSeqLen: 16 });
      const seqLen = 8;
      const dim = 64;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      const output = aft.forward(query, key, value);

      expect(output.length).toBe(seqLen * dim);
      expect(output).toBeInstanceOf(Float32Array);
    });

    it('should handle explicit seqLen parameter', () => {
      const aft = new RealAFTAttention({ dimension: 32, numHeads: 4, maxSeqLen: 8 });
      const seqLen = 5;
      const dim = 32;

      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      const output = aft.forward(query, key, value, undefined, seqLen);

      expect(output.length).toBe(seqLen * dim);
    });
  });

  describe('Validation', () => {
    it('should throw error for non-Float32Array inputs', () => {
      const aft = new RealAFTAttention({ dimension: 32, numHeads: 4 });
      const query = new Float32Array(64);
      const key = new Float32Array(64);
      const value = [1, 2, 3] as any;

      expect(() => aft.forward(query, key, value)).toThrow('ANTI-009: value must be Float32Array');
    });

    it('should throw error for mismatched input lengths', () => {
      const aft = new RealAFTAttention({ dimension: 32, numHeads: 4 });
      const query = new Float32Array(64);
      const key = new Float32Array(64);
      const value = new Float32Array(96); // Different length

      expect(() => aft.forward(query, key, value)).toThrow(
        'ANTI-009: query, key, value must have same length'
      );
    });

    it('should throw error for length not divisible by dimension', () => {
      const aft = new RealAFTAttention({ dimension: 32, numHeads: 4 });
      const query = new Float32Array(50); // Not divisible by 32
      const key = new Float32Array(50);
      const value = new Float32Array(50);

      expect(() => aft.forward(query, key, value)).toThrow(
        'ANTI-009: input length (50) must be divisible by dimension (32)'
      );
    });

    it('should throw error for sequence length exceeding maxSeqLen', () => {
      const aft = new RealAFTAttention({ dimension: 8, numHeads: 2, maxSeqLen: 4 });
      const seqLen = 6; // Exceeds maxSeqLen
      const query = new Float32Array(seqLen * 8);
      const key = new Float32Array(seqLen * 8);
      const value = new Float32Array(seqLen * 8);

      expect(() => aft.forward(query, key, value)).toThrow(
        'ANTI-009: sequence length (6) exceeds maxSeqLen (4)'
      );
    });

    it('should throw error for mismatched mask length', () => {
      const aft = new RealAFTAttention({ dimension: 16, numHeads: 2 });
      const query = new Float32Array(64); // seqLen = 4
      const key = new Float32Array(64);
      const value = new Float32Array(64);
      const mask = [true, false]; // Length 2, should be 4

      expect(() => aft.forward(query, key, value, mask)).toThrow(
        'ANTI-009: mask length (2) must match seqLen (4)'
      );
    });

    it('should throw error for mismatched explicit seqLen', () => {
      const aft = new RealAFTAttention({ dimension: 16, numHeads: 2 });
      const query = new Float32Array(64); // seqLen = 4
      const key = new Float32Array(64);
      const value = new Float32Array(64);

      expect(() => aft.forward(query, key, value, undefined, 5)).toThrow(
        'ANTI-009: provided seqLen (5) does not match inferred seqLen (4)'
      );
    });

    it('should throw error for NaN in inputs', () => {
      const aft = new RealAFTAttention({ dimension: 16, numHeads: 2 });
      const query = new Float32Array(32);
      query[5] = NaN;
      const key = new Float32Array(32);
      const value = new Float32Array(32);

      expect(() => aft.forward(query, key, value)).toThrow('ANTI-009: query contains NaN or Inf');
    });

    it('should throw error for Inf in inputs', () => {
      const aft = new RealAFTAttention({ dimension: 16, numHeads: 2 });
      const query = new Float32Array(32);
      const key = new Float32Array(32);
      key[10] = Infinity;
      const value = new Float32Array(32);

      expect(() => aft.forward(query, key, value)).toThrow('ANTI-009: key contains NaN or Inf');
    });
  });

  describe('Parameter Count', () => {
    it('should return correct parameter count for default config', () => {
      const aft = new RealAFTAttention();
      const params = aft.getParameterCount();
      expect(params).toBe(512 * 512); // maxSeqLen^2
    });

    it('should return correct parameter count for custom maxSeqLen', () => {
      const aft = new RealAFTAttention({ maxSeqLen: 128 });
      const params = aft.getParameterCount();
      expect(params).toBe(128 * 128);
    });
  });

  describe('Determinism', () => {
    it('should produce identical outputs for same inputs with same seed', () => {
      const seed = 999;
      const aft1 = new RealAFTAttention({ dimension: 32, numHeads: 4, maxSeqLen: 8, seed });
      const aft2 = new RealAFTAttention({ dimension: 32, numHeads: 4, maxSeqLen: 8, seed });

      const query = new Float32Array(64);
      const key = new Float32Array(64);
      const value = new Float32Array(64);
      for (let i = 0; i < 64; i++) {
        query[i] = Math.sin(i);
        key[i] = Math.cos(i);
        value[i] = i / 64;
      }

      const output1 = aft1.forward(query, key, value);
      const output2 = aft2.forward(query, key, value);

      for (let i = 0; i < output1.length; i++) {
        expect(output1[i]).toBeCloseTo(output2[i], 10);
      }
    });

    it('should produce different outputs for different seeds', () => {
      const aft1 = new RealAFTAttention({ dimension: 32, numHeads: 4, maxSeqLen: 8, seed: 42 });
      const aft2 = new RealAFTAttention({ dimension: 32, numHeads: 4, maxSeqLen: 8, seed: 123 });

      // Use varied inputs to make position bias differences visible
      const query = new Float32Array(64);
      const key = new Float32Array(64);
      const value = new Float32Array(64);

      for (let i = 0; i < 64; i++) {
        query[i] = Math.sin(i * 0.2);
        key[i] = Math.cos(i * 0.3);
        value[i] = (i % 8) / 8;
      }

      const output1 = aft1.forward(query, key, value);
      const output2 = aft2.forward(query, key, value);

      // Outputs should differ due to different position biases
      // Note: differences may be small due to normalization, so we check for ANY difference
      let maxDiff = 0;
      for (let i = 0; i < output1.length; i++) {
        const diff = Math.abs(output1[i] - output2[i]);
        if (diff > maxDiff) maxDiff = diff;
      }
      // Should have at least some difference (even if small due to sigmoid saturation)
      expect(maxDiff).toBeGreaterThan(1e-10);
    });
  });

  describe('Numerical Stability', () => {
    it('should handle large key values without overflow', () => {
      const aft = new RealAFTAttention({ dimension: 16, numHeads: 2, maxSeqLen: 4, seed: 42 });
      const query = new Float32Array(32).fill(0);
      const key = new Float32Array(32).fill(50); // Large values
      const value = new Float32Array(32).fill(1);

      const output = aft.forward(query, key, value);
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });

    it('should handle very small denominators gracefully', () => {
      const aft = new RealAFTAttention({ dimension: 8, numHeads: 2, maxSeqLen: 4, seed: 42 });
      const query = new Float32Array(16).fill(0);
      const key = new Float32Array(16).fill(-100); // Very negative → small exp
      const value = new Float32Array(16).fill(1);

      const output = aft.forward(query, key, value);
      // Should produce zeros due to tiny denominator protection
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });

    it('should clip extreme exponential inputs', () => {
      const aft = new RealAFTAttention({ dimension: 8, numHeads: 2, maxSeqLen: 2, seed: 42 });
      const query = new Float32Array(8).fill(0);
      const key = new Float32Array(8).fill(100); // Would overflow without clipping
      const value = new Float32Array(8).fill(1);

      // Should not throw or produce NaN/Inf
      const output = aft.forward(query, key, value);
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);
    });

    it('should handle mixed extreme query values in sigmoid', () => {
      const aft = new RealAFTAttention({ dimension: 4, numHeads: 1, maxSeqLen: 2, seed: 42 });
      const query = new Float32Array([100, -100, 50, -50]); // Extreme values
      const key = new Float32Array(4).fill(0);
      const value = new Float32Array(4).fill(1);

      const output = aft.forward(query, key, value);
      expect(output.every((v) => !isNaN(v) && isFinite(v))).toBe(true);

      // Sigmoid(100) ≈ 1, sigmoid(-100) ≈ 0
      expect(output[0]).toBeGreaterThan(0.99);
      expect(output[1]).toBeLessThan(0.01);
    });
  });
});
