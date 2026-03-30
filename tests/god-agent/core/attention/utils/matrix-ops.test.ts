import { describe, it, expect } from 'vitest';
import {
  matmul,
  dotProduct,
  validateMatmulDims,
} from '../../../../../src/god-agent/core/attention/utils/matrix-ops.js';

describe('Matrix Operations', () => {
  describe('matmul', () => {
    describe('basic operations', () => {
      it('should compute simple 2x2 matrix-vector product', () => {
        // Matrix: [1, 2]  Vector: [5]
        //         [3, 4]          [6]
        // Result: [1*5 + 2*6, 3*5 + 4*6] = [17, 39]
        const weights = new Float32Array([1, 2, 3, 4]);
        const vector = new Float32Array([5, 6]);
        const result = matmul(vector, weights, 2);

        expect(result.length).toBe(2);
        expect(result[0]).toBeCloseTo(17, 5);
        expect(result[1]).toBeCloseTo(39, 5);
      });

      it('should handle identity matrix', () => {
        const weights = new Float32Array([
          1, 0, 0,
          0, 1, 0,
          0, 0, 1,
        ]);
        const vector = new Float32Array([2, 3, 4]);
        const result = matmul(vector, weights, 3);

        expect(Array.from(result)).toEqual([2, 3, 4]);
      });

      it('should handle zero matrix', () => {
        const weights = new Float32Array(9).fill(0);
        const vector = new Float32Array([1, 2, 3]);
        const result = matmul(vector, weights, 3);

        expect(Array.from(result)).toEqual([0, 0, 0]);
      });

      it('should handle zero vector', () => {
        const weights = new Float32Array([1, 2, 3, 4]);
        const vector = new Float32Array([0, 0]);
        const result = matmul(vector, weights, 2);

        expect(Array.from(result)).toEqual([0, 0]);
      });
    });

    describe('batched operations', () => {
      it('should handle batched vectors', () => {
        const weights = new Float32Array([1, 2, 3, 4]);
        // 2 vectors of dim 2: [1, 0] and [0, 1]
        const vectors = new Float32Array([1, 0, 0, 1]);
        const result = matmul(vectors, weights, 2);

        expect(result.length).toBe(4);
        // First vector result
        expect(result[0]).toBeCloseTo(1, 5);
        expect(result[1]).toBeCloseTo(3, 5);
        // Second vector result
        expect(result[2]).toBeCloseTo(2, 5);
        expect(result[3]).toBeCloseTo(4, 5);
      });
    });

    describe('dimension validation', () => {
      it('should validate vector dimension compatibility', () => {
        const weights = new Float32Array([1, 2, 3, 4]);
        const vector = new Float32Array([1, 2, 3]); // Wrong size

        expect(() => matmul(vector, weights, 2)).toThrow('dimension');
      });

      it('should validate matrix dimensions', () => {
        const weights = new Float32Array([1, 2, 3]); // Wrong size
        const vector = new Float32Array([1, 2]);

        expect(() => matmul(vector, weights, 2)).toThrow('dimension');
      });
    });

    describe('numerical stability', () => {
      it('should handle large values without overflow', () => {
        const weights = new Float32Array([1e5, 1e5, 1e5, 1e5]);
        const vector = new Float32Array([1e5, 1e5]);
        const result = matmul(vector, weights, 2);

        expect(Number.isFinite(result[0])).toBe(true);
        expect(Number.isFinite(result[1])).toBe(true);
      });

      it('should handle small values without underflow', () => {
        const weights = new Float32Array([1e-10, 1e-10, 1e-10, 1e-10]);
        const vector = new Float32Array([1e-10, 1e-10]);
        const result = matmul(vector, weights, 2);

        expect(result[0]).toBeGreaterThan(0);
        expect(result[1]).toBeGreaterThan(0);
      });

      it('should handle mixed positive and negative values', () => {
        const weights = new Float32Array([1, -2, -3, 4]);
        const vector = new Float32Array([5, -6]);
        const result = matmul(vector, weights, 2);

        expect(result[0]).toBeCloseTo(17, 5);  // 1*5 + (-2)*(-6) = 5 + 12
        expect(result[1]).toBeCloseTo(-39, 5); // -3*5 + 4*(-6) = -15 - 24
      });
    });
  });

  describe('dotProduct', () => {
    describe('basic operations', () => {
      it('should compute simple dot product', () => {
        const v1 = new Float32Array([1, 2, 3]);
        const v2 = new Float32Array([4, 5, 6]);

        // 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
        const result = dotProduct(v1, v2, 0, 0, 3);
        expect(result).toBeCloseTo(32, 5);
      });

      it('should handle orthogonal vectors', () => {
        const v1 = new Float32Array([1, 0, 0]);
        const v2 = new Float32Array([0, 1, 0]);

        const result = dotProduct(v1, v2, 0, 0, 3);
        expect(result).toBeCloseTo(0, 5);
      });

      it('should handle parallel vectors', () => {
        const v1 = new Float32Array([2, 4, 6]);
        const v2 = new Float32Array([1, 2, 3]);

        const result = dotProduct(v1, v2, 0, 0, 3);
        expect(result).toBeCloseTo(28, 5);
      });

      it('should handle zero vectors', () => {
        const v1 = new Float32Array([0, 0, 0]);
        const v2 = new Float32Array([1, 2, 3]);

        const result = dotProduct(v1, v2, 0, 0, 3);
        expect(result).toBe(0);
      });
    });

    describe('with offsets', () => {
      it('should compute dot product with start offset', () => {
        const v1 = new Float32Array([0, 0, 1, 2, 3]);
        const v2 = new Float32Array([4, 5, 6]);

        const result = dotProduct(v1, v2, 2, 0, 3);
        expect(result).toBeCloseTo(32, 5);
      });

      it('should compute dot product with both offsets', () => {
        const v1 = new Float32Array([0, 0, 1, 2, 3]);
        const v2 = new Float32Array([0, 4, 5, 6]);

        const result = dotProduct(v1, v2, 2, 1, 3);
        expect(result).toBeCloseTo(32, 5);
      });

      it('should handle offset at vector boundary', () => {
        const v1 = new Float32Array([1, 2, 3, 4]);
        const v2 = new Float32Array([5, 6]);

        const result = dotProduct(v1, v2, 2, 0, 2);
        expect(result).toBeCloseTo(39, 5); // 3*5 + 4*6
      });
    });

    describe('numerical properties', () => {
      it('should be commutative', () => {
        const v1 = new Float32Array([1, 2, 3]);
        const v2 = new Float32Array([4, 5, 6]);

        const result1 = dotProduct(v1, v2, 0, 0, 3);
        const result2 = dotProduct(v2, v1, 0, 0, 3);

        expect(result1).toBeCloseTo(result2, 5);
      });

      it('should handle negative values', () => {
        const v1 = new Float32Array([1, -2, 3]);
        const v2 = new Float32Array([-4, 5, -6]);

        const result = dotProduct(v1, v2, 0, 0, 3);
        expect(result).toBeCloseTo(-32, 5);
      });

      it('should handle large values', () => {
        const v1 = new Float32Array([1e5, 1e5, 1e5]);
        const v2 = new Float32Array([1e5, 1e5, 1e5]);

        const result = dotProduct(v1, v2, 0, 0, 3);
        expect(Number.isFinite(result)).toBe(true);
      });

      it('should handle small values', () => {
        const v1 = new Float32Array([1e-10, 1e-10, 1e-10]);
        const v2 = new Float32Array([1e-10, 1e-10, 1e-10]);

        const result = dotProduct(v1, v2, 0, 0, 3);
        expect(result).toBeGreaterThan(0);
        expect(Number.isFinite(result)).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should handle single-element vectors', () => {
        const v1 = new Float32Array([5]);
        const v2 = new Float32Array([3]);

        const result = dotProduct(v1, v2, 0, 0, 1);
        expect(result).toBe(15);
      });

      it('should handle long vectors', () => {
        const size = 1000;
        const v1 = new Float32Array(size).fill(1);
        const v2 = new Float32Array(size).fill(2);

        const result = dotProduct(v1, v2, 0, 0, size);
        expect(result).toBe(size * 2);
      });
    });
  });

  describe('validateMatmulDims', () => {
    it('should validate correct dimensions', () => {
      expect(validateMatmulDims(64, 64 * 64, 64)).toBe(true);
    });

    it('should reject incorrect vector length', () => {
      expect(validateMatmulDims(65, 64 * 64, 64)).toBe(false);
    });

    it('should reject incorrect weight length', () => {
      expect(validateMatmulDims(64, 100, 64)).toBe(false);
    });
  });

  describe('integration', () => {
    it('should use matrix-vector multiply for attention projections', () => {
      const dModel = 512;
      const dK = 64;
      const weights = new Float32Array(dK * dK).fill(0.01);
      const input = new Float32Array(dK).fill(1);

      const query = matmul(input, weights, dK);

      expect(query.length).toBe(dK);
      query.forEach(val => expect(Number.isFinite(val)).toBe(true));
    });

    it('should use dot product for attention scores', () => {
      const dK = 64;
      const query = new Float32Array(dK).fill(0.1);
      const key = new Float32Array(dK).fill(0.2);

      const score = dotProduct(query, key, 0, 0, dK);

      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeGreaterThan(0);
    });
  });
});
