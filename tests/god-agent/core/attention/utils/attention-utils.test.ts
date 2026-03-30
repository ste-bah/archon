import { describe, it, expect } from 'vitest';
import {
  softmax2D,
  validateSoftmax,
  hasNaNOrInf,
} from '../../../../../src/god-agent/core/attention/utils/attention-utils.js';

describe('Attention Utils', () => {
  describe('softmax2D', () => {
    describe('basic properties', () => {
      it('should produce rows that sum to 1', () => {
        const scores = new Float32Array([1, 2, 3, 4]);
        const seqLen = 2;
        const result = softmax2D(scores, seqLen);

        // Check row 0
        const row0Sum = result[0] + result[1];
        expect(row0Sum).toBeCloseTo(1.0, 5);

        // Check row 1
        const row1Sum = result[2] + result[3];
        expect(row1Sum).toBeCloseTo(1.0, 5);
      });

      it('should produce values in range [0, 1]', () => {
        const scores = new Float32Array([1, 2, 3, 4]);
        const seqLen = 2;
        const result = softmax2D(scores, seqLen);

        result.forEach(value => {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        });
      });

      it('should produce higher probability for higher scores', () => {
        const scores = new Float32Array([1, 5, 2, 0]);
        const seqLen = 2;
        const result = softmax2D(scores, seqLen);

        // Row 0: [1, 5] -> 5 should have higher probability
        expect(result[1]).toBeGreaterThan(result[0]);
      });

      it('should handle equal scores with uniform distribution', () => {
        const scores = new Float32Array([2, 2, 2, 2]);
        const seqLen = 2;
        const result = softmax2D(scores, seqLen);

        const expected = 0.5;
        result.forEach(value => {
          expect(value).toBeCloseTo(expected, 5);
        });
      });
    });

    describe('numerical stability', () => {
      it('should handle large positive values without overflow', () => {
        const scores = new Float32Array([100, 101, 102, 100]);
        const seqLen = 2;
        const result = softmax2D(scores, seqLen);

        result.forEach(value => {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThan(0);
        });
      });

      it('should handle large negative values without underflow', () => {
        const scores = new Float32Array([-100, -101, -102, -100]);
        const seqLen = 2;
        const result = softmax2D(scores, seqLen);

        result.forEach(value => {
          expect(Number.isFinite(value)).toBe(true);
        });
      });

      it('should handle mixed large positive and negative values', () => {
        const scores = new Float32Array([100, -100, 0, 0]);
        const seqLen = 2;
        const result = softmax2D(scores, seqLen);

        // Large positive should dominate in first row
        expect(result[0]).toBeGreaterThan(0.9);
        expect(result[1]).toBeLessThan(0.1);
      });

      it('should handle very small differences', () => {
        const scores = new Float32Array([1.0, 1.0000001, 1.0, 1.0000002]);
        const seqLen = 2;
        const result = softmax2D(scores, seqLen);

        // Should be nearly uniform in each row
        expect(result[0]).toBeCloseTo(0.5, 2);
        expect(result[1]).toBeCloseTo(0.5, 2);
      });
    });

    describe('masking support', () => {
      it('should handle -Infinity for masked positions', () => {
        const scores = new Float32Array([1, -Infinity, 2, -Infinity]);
        const seqLen = 2;
        const result = softmax2D(scores, seqLen);

        expect(result[1]).toBe(0);
        expect(result[3]).toBe(0);

        // Non-masked should sum to 1
        expect(result[0]).toBeCloseTo(1.0, 5);
        expect(result[2]).toBeCloseTo(1.0, 5);
      });

      it('should handle all-masked row', () => {
        const scores = new Float32Array([-Infinity, -Infinity, 1, 2]);
        const seqLen = 2;
        const result = softmax2D(scores, seqLen);

        // All-masked row gets uniform distribution
        const sum = result[0] + result[1];
        expect(sum).toBeCloseTo(1.0, 5);
      });

      it('should handle single non-masked value', () => {
        const scores = new Float32Array([-Infinity, 5, -Infinity, -Infinity]);
        const seqLen = 2;
        const result = softmax2D(scores, seqLen);

        expect(result[1]).toBeCloseTo(1.0, 5);
        expect(result[0]).toBe(0);
      });
    });

    describe('error handling', () => {
      it('should detect NaN in input', () => {
        const scores = new Float32Array([1, NaN, 3, 4]);
        const seqLen = 2;

        expect(() => softmax2D(scores, seqLen)).toThrow('NaN');
      });

      it('should handle single value', () => {
        const scores = new Float32Array([5]);
        const seqLen = 1;
        const result = softmax2D(scores, seqLen);

        expect(result[0]).toBeCloseTo(1.0, 5);
      });

      it('should validate dimension mismatch', () => {
        const scores = new Float32Array([1, 2, 3]);
        const seqLen = 2;

        expect(() => softmax2D(scores, seqLen)).toThrow('incompatible');
      });
    });

    describe('batched operations', () => {
      it('should process multiple rows independently', () => {
        const scores = new Float32Array([
          1, 2, 3,
          4, 5, 6,
          7, 8, 9,
        ]);
        const seqLen = 3;
        const result = softmax2D(scores, seqLen);

        // Check each row sums to 1
        for (let i = 0; i < seqLen; i++) {
          let rowSum = 0;
          for (let j = 0; j < seqLen; j++) {
            rowSum += result[i * seqLen + j];
          }
          expect(rowSum).toBeCloseTo(1.0, 5);
        }
      });
    });

    describe('attention score patterns', () => {
      it('should create peaked distribution for high variance', () => {
        const scores = new Float32Array([10, 1, 1, 1]);
        const seqLen = 2;
        const result = softmax2D(scores, seqLen);

        // First value in row 0 should dominate
        expect(result[0]).toBeGreaterThan(0.9);
      });

      it('should create flat distribution for low variance', () => {
        const scores = new Float32Array([1, 1.1, 1.2, 1.3]);
        const seqLen = 2;
        const result = softmax2D(scores, seqLen);

        // All values should be relatively close
        result.forEach(value => {
          expect(value).toBeGreaterThan(0.2);
          expect(value).toBeLessThan(0.8);
        });
      });

      it('should handle sumExp === 0 edge case (all exp values underflow)', () => {
        // Create scores that cause all exp values to underflow
        const scores = new Float32Array([
          -1e10, -1e10, // Row 0: all extremely negative
          1, 2,         // Row 1: normal
        ]);

        const weights = softmax2D(scores, 2);

        // Row 0: Should fallback to uniform distribution (1/seqLen)
        expect(weights[0]).toBeCloseTo(0.5, 5);
        expect(weights[1]).toBeCloseTo(0.5, 5);

        // Row 1: Normal softmax
        expect(weights[2] + weights[3]).toBeCloseTo(1.0, 5);
      });
    });
  });

  describe('validateSoftmax', () => {
    describe('valid inputs', () => {
      it('should pass for valid softmax output', () => {
        const probs = new Float32Array([0.1, 0.3, 0.6, 0.25, 0.25, 0.25, 0.25]);
        const seqLen = 2;

        // Manually check: row 0 = [0.1, 0.3, 0.6] but that's 3 elements for seqLen=2
        // Fix: make it consistent
        const validProbs = new Float32Array([0.4, 0.6, 0.25, 0.75]);
        expect(validateSoftmax(validProbs, 2)).toBe(true);
      });

      it('should pass for uniform distribution', () => {
        const probs = new Float32Array([0.5, 0.5, 0.5, 0.5]);
        const seqLen = 2;

        expect(validateSoftmax(probs, seqLen)).toBe(true);
      });

      it('should pass for peaked distribution', () => {
        const probs = new Float32Array([0.98, 0.02, 0.01, 0.99]);
        const seqLen = 2;

        expect(validateSoftmax(probs, seqLen)).toBe(true);
      });
    });

    describe('invalid inputs', () => {
      it('should reject probabilities not summing to 1', () => {
        const probs = new Float32Array([0.3, 0.3, 0.5, 0.5]);
        const seqLen = 2;

        expect(validateSoftmax(probs, seqLen)).toBe(false);
      });

      it('should reject negative probabilities', () => {
        const probs = new Float32Array([0.5, -0.1, 1.1, 0.0]);
        const seqLen = 2;

        expect(validateSoftmax(probs, seqLen)).toBe(false);
      });

      it('should reject probabilities greater than 1', () => {
        const probs = new Float32Array([1.5, -0.5, 0.5, 0.5]);
        const seqLen = 2;

        expect(validateSoftmax(probs, seqLen)).toBe(false);
      });

      it('should reject NaN values', () => {
        const probs = new Float32Array([0.3, NaN, 0.5, 0.5]);
        const seqLen = 2;

        expect(validateSoftmax(probs, seqLen)).toBe(false);
      });

      it('should reject Infinity values', () => {
        const probs = new Float32Array([0.3, Infinity, 0.5, 0.5]);
        const seqLen = 2;

        expect(validateSoftmax(probs, seqLen)).toBe(false);
      });
    });

    describe('tolerance', () => {
      it('should allow small rounding errors in sum', () => {
        const probs = new Float32Array([0.333333, 0.666667, 0.25, 0.75]);
        const seqLen = 2;

        expect(validateSoftmax(probs, seqLen)).toBe(true);
      });

      it('should allow values very close to 0', () => {
        const probs = new Float32Array([0.99999, 0.00001, 1.0, 0.0]);
        const seqLen = 2;

        expect(validateSoftmax(probs, seqLen)).toBe(true);
      });

      it('should allow values very close to 1', () => {
        const probs = new Float32Array([0.999999, 0.000001, 0.5, 0.5]);
        const seqLen = 2;

        expect(validateSoftmax(probs, seqLen)).toBe(true);
      });
    });
  });

  describe('hasNaNOrInf', () => {
    describe('detection', () => {
      it('should detect NaN', () => {
        const values = new Float32Array([1, 2, NaN, 4]);

        expect(hasNaNOrInf(values)).toBe(true);
      });

      it('should detect positive Infinity', () => {
        const values = new Float32Array([1, 2, Infinity, 4]);

        expect(hasNaNOrInf(values)).toBe(true);
      });

      it('should detect negative Infinity', () => {
        const values = new Float32Array([1, 2, -Infinity, 4]);

        expect(hasNaNOrInf(values)).toBe(true);
      });

      it('should detect multiple NaN/Inf values', () => {
        const values = new Float32Array([NaN, Infinity, -Infinity, 1]);

        expect(hasNaNOrInf(values)).toBe(true);
      });

      it('should return false for all finite values', () => {
        const values = new Float32Array([1, 2, 3, 4, -5, 0]);

        expect(hasNaNOrInf(values)).toBe(false);
      });

      it('should return false for large finite values', () => {
        // Use values that fit in Float32 range (max ~3.4e38)
        const values = new Float32Array([1e30, -1e30, 1e-30]);

        expect(hasNaNOrInf(values)).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should handle empty array', () => {
        const values = new Float32Array([]);

        expect(hasNaNOrInf(values)).toBe(false);
      });

      it('should handle single NaN', () => {
        const values = new Float32Array([NaN]);

        expect(hasNaNOrInf(values)).toBe(true);
      });

      it('should handle single finite value', () => {
        const values = new Float32Array([42]);

        expect(hasNaNOrInf(values)).toBe(false);
      });

      it('should handle zeros', () => {
        const values = new Float32Array([0, -0, 0]);

        expect(hasNaNOrInf(values)).toBe(false);
      });
    });
  });

  describe('integration', () => {
    it('should validate softmax output pipeline', () => {
      const scores = new Float32Array([2, 5, 3, 1]);
      const seqLen = 2;

      // Check input is clean
      expect(hasNaNOrInf(scores)).toBe(false);

      // Apply softmax
      const probs = softmax2D(scores, seqLen);

      // Validate output
      expect(validateSoftmax(probs, seqLen)).toBe(true);
      expect(hasNaNOrInf(probs)).toBe(false);
    });

    it('should handle attention score computation end-to-end', () => {
      const rawScores = new Float32Array([0.5, 1.2, 0.8, -0.3]);
      const dK = 64;
      const scaledScores = new Float32Array(
        rawScores.map(s => s / Math.sqrt(dK))
      );

      expect(hasNaNOrInf(scaledScores)).toBe(false);

      const seqLen = 2;
      const attentionWeights = softmax2D(scaledScores, seqLen);

      expect(validateSoftmax(attentionWeights, seqLen)).toBe(true);
      expect(hasNaNOrInf(attentionWeights)).toBe(false);
    });

    it('should handle masked attention', () => {
      const scores = new Float32Array([1, -Infinity, 2, -Infinity]);
      const seqLen = 2;
      const probs = softmax2D(scores, seqLen);

      // Masked positions should be 0
      expect(probs[1]).toBe(0);
      expect(probs[3]).toBe(0);

      // Non-masked positions should be 1
      expect(probs[0]).toBeCloseTo(1.0, 5);
      expect(probs[2]).toBeCloseTo(1.0, 5);

      expect(validateSoftmax(probs, seqLen)).toBe(true);
    });
  });
});
