import { describe, it, expect } from 'vitest';
import {
  xavierUniform,
  validateXavierWeights,
  xavierVariance,
} from '../../../../../src/god-agent/core/attention/utils/weight-initializers.js';
import { SeededRandom } from '../../../../../src/god-agent/core/attention/utils/seeded-random.js';

describe('Weight Initializers', () => {
  describe('xavierUniform', () => {
    describe('dimensions', () => {
      it('should create matrix with correct dimensions', () => {
        const fanIn = 64;
        const fanOut = 128;
        const weights = xavierUniform(fanIn, fanOut);

        expect(weights.length).toBe(fanIn * fanOut);
      });

      it('should handle square matrices', () => {
        const size = 100;
        const weights = xavierUniform(size, size);

        expect(weights.length).toBe(size * size);
      });

      it('should handle small dimensions', () => {
        const weights = xavierUniform(2, 3);
        expect(weights.length).toBe(6);
      });

      it('should validate input dimensions', () => {
        expect(() => xavierUniform(0, 10)).toThrow();
        expect(() => xavierUniform(10, 0)).toThrow();
        expect(() => xavierUniform(-5, 10)).toThrow();
      });
    });

    describe('value range', () => {
      it('should initialize weights in valid range', () => {
        const fanIn = 64;
        const fanOut = 128;
        const weights = xavierUniform(fanIn, fanOut);

        // Xavier limit: sqrt(6 / (fanIn + fanOut))
        const limit = Math.sqrt(6 / (fanIn + fanOut));

        weights.forEach(weight => {
          expect(weight).toBeGreaterThanOrEqual(-limit);
          expect(weight).toBeLessThanOrEqual(limit);
        });
      });

      it('should have smaller range for larger fan-in/fan-out', () => {
        const small = xavierUniform(10, 10);
        const large = xavierUniform(100, 100);

        const smallMax = Math.max(...small.map(Math.abs));
        const largeMax = Math.max(...large.map(Math.abs));

        // Larger dimensions should have smaller weights
        expect(largeMax).toBeLessThan(smallMax);
      });
    });

    describe('statistical properties', () => {
      it('should have mean approximately 0', () => {
        const fanIn = 128;
        const fanOut = 256;
        const weights = xavierUniform(fanIn, fanOut);

        const mean = weights.reduce((sum, w) => sum + w, 0) / weights.length;

        // Mean should be close to 0 (within 0.05)
        expect(Math.abs(mean)).toBeLessThan(0.05);
      });

      it('should have variance matching theoretical value', () => {
        const fanIn = 128;
        const fanOut = 128;
        const weights = xavierUniform(fanIn, fanOut);

        // Calculate sample variance
        const mean = weights.reduce((sum, w) => sum + w, 0) / weights.length;
        const variance = weights.reduce((sum, w) => sum + Math.pow(w - mean, 2), 0) / weights.length;

        // Theoretical variance: 2 / (fanIn + fanOut)
        const theoreticalVariance = 2 / (fanIn + fanOut);

        // Allow 30% tolerance due to finite sample
        expect(variance).toBeGreaterThan(theoreticalVariance * 0.7);
        expect(variance).toBeLessThan(theoreticalVariance * 1.3);
      });

      it('should have approximately symmetric distribution', () => {
        const weights = xavierUniform(100, 100);

        const positive = weights.filter(w => w > 0).length;
        const negative = weights.filter(w => w < 0).length;

        // Should be roughly equal (within 20%)
        const ratio = positive / negative;
        expect(ratio).toBeGreaterThan(0.8);
        expect(ratio).toBeLessThan(1.2);
      });
    });

    describe('deterministic behavior', () => {
      it('should be deterministic with same seed', () => {
        const rng1 = new SeededRandom(42);
        const rng2 = new SeededRandom(42);
        const weights1 = xavierUniform(64, 128, rng1);
        const weights2 = xavierUniform(64, 128, rng2);

        expect(weights1).toEqual(weights2);
      });

      it('should produce different weights with different seeds', () => {
        const rng1 = new SeededRandom(42);
        const rng2 = new SeededRandom(123);
        const weights1 = xavierUniform(64, 128, rng1);
        const weights2 = xavierUniform(64, 128, rng2);

        expect(weights1).not.toEqual(weights2);
      });

      it('should produce different weights without seed', () => {
        const weights1 = xavierUniform(64, 128);
        const weights2 = xavierUniform(64, 128);

        // Without seed, should use different random values
        expect(weights1).not.toEqual(weights2);
      });
    });
  });

  describe('validateXavierWeights', () => {
    describe('valid weights', () => {
      it('should pass for properly initialized weights', () => {
        const fanIn = 64;
        const fanOut = 128;
        const weights = xavierUniform(fanIn, fanOut);

        expect(validateXavierWeights(weights, fanIn, fanOut)).toBe(true);
      });

      it('should pass for weights at boundary', () => {
        const fanIn = 10;
        const fanOut = 10;
        const rng = new SeededRandom(42);

        // Use actual xavier initialization for a small matrix
        const weights = xavierUniform(fanIn, fanOut, rng);

        expect(validateXavierWeights(weights, fanIn, fanOut)).toBe(true);
      });
    });

    describe('invalid weights', () => {
      it('should reject weights with wrong dimensions', () => {
        const weights = xavierUniform(64, 128);

        expect(validateXavierWeights(weights, 32, 64)).toBe(false);
      });

      it('should reject weights exceeding range', () => {
        const fanIn = 10;
        const fanOut = 10;
        const limit = Math.sqrt(6 / (fanIn + fanOut));

        const weights = new Float32Array([limit * 2, 0, 0, 0]);

        expect(validateXavierWeights(weights, 2, 2)).toBe(false);
      });

      it('should reject weights with NaN', () => {
        const weights = new Float32Array([0.1, NaN, 0.2, 0.3]);

        expect(validateXavierWeights(weights, 2, 2)).toBe(false);
      });

      it('should reject weights with Infinity', () => {
        const weights = new Float32Array([0.1, Infinity, 0.2, 0.3]);

        expect(validateXavierWeights(weights, 2, 2)).toBe(false);
      });

      it('should reject empty weights array', () => {
        const weights = new Float32Array([]);

        expect(validateXavierWeights(weights, 0, 10)).toBe(false);
      });
    });

    describe('statistical validation', () => {
      it('should fail if mean deviates significantly', () => {
        // Create weights with high mean (all positive)
        const weights = new Float32Array(100).fill(0.5);

        // Should fail validation (mean too high)
        expect(validateXavierWeights(weights, 10, 10)).toBe(false);
      });

      it('should pass for zero-mean weights', () => {
        const fanIn = 32;
        const fanOut = 32;
        const rng = new SeededRandom(42);

        // Use actual xavier initialization which should have near-zero mean
        const weights = xavierUniform(fanIn, fanOut, rng);

        expect(validateXavierWeights(weights, fanIn, fanOut)).toBe(true);
      });
    });
  });

  describe('integration', () => {
    it('should initialize and validate multiple weight matrices', () => {
      const configs = [
        { fanIn: 32, fanOut: 64 },
        { fanIn: 64, fanOut: 128 },
        { fanIn: 128, fanOut: 256 },
      ];

      const rng = new SeededRandom(42);
      configs.forEach(({ fanIn, fanOut }) => {
        const weights = xavierUniform(fanIn, fanOut, rng);
        expect(validateXavierWeights(weights, fanIn, fanOut)).toBe(true);
      });
    });

    it('should handle attention head dimensions', () => {
      // Typical attention head: dModel=512, dK=64, numHeads=8
      const dModel = 512;
      const dK = 64;

      const wQ = xavierUniform(dModel, dK);
      const wK = xavierUniform(dModel, dK);
      const wV = xavierUniform(dModel, dK);

      expect(validateXavierWeights(wQ, dModel, dK)).toBe(true);
      expect(validateXavierWeights(wK, dModel, dK)).toBe(true);
      expect(validateXavierWeights(wV, dModel, dK)).toBe(true);
    });
  });
});
