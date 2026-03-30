/**
 * Unit Tests for Distance Metrics
 *
 * TASK-VDB-001: Tests for cosine similarity, Euclidean distance, dot product, Manhattan distance
 *
 * Test coverage targets:
 * - Cosine similarity (identical vectors = 1.0)
 * - Cosine similarity (orthogonal vectors = 0.0)
 * - Cosine similarity (opposite vectors = -1.0)
 * - Euclidean distance (identical = 0)
 * - Dot product calculations
 * - Manhattan distance
 * - Dimension mismatch detection
 * - Helper functions (getMetricFunction, isSimilarityMetric)
 */

import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  euclideanDistance,
  dotProduct,
  manhattanDistance,
  getMetricFunction,
  isSimilarityMetric
} from '../../../../src/god-agent/core/vector-db/distance-metrics';
import { DistanceMetric } from '../../../../src/god-agent/core/vector-db/types';
import { GraphDimensionMismatchError, VECTOR_DIM } from '../../../../src/god-agent/core/validation';
import {
  createRandomNormalizedVector,
  createSimpleNormalizedVector,
  createOrthogonalVectors,
  createIdenticalVectors,
  createOppositeVectors
} from './test-helpers';

describe('Distance Metrics - cosineSimilarity', () => {
  it('should return 1.0 for identical vectors', () => {
    const [a, b] = createIdenticalVectors();
    const similarity = cosineSimilarity(a, b);

    expect(similarity).toBeCloseTo(1.0, 5);
  });

  it('should return 1.0 for same vector (self-similarity)', () => {
    const vector = createRandomNormalizedVector();
    const similarity = cosineSimilarity(vector, vector);

    expect(similarity).toBeCloseTo(1.0, 5);
  });

  it('should return 0.0 for orthogonal vectors', () => {
    const [a, b] = createOrthogonalVectors();
    const similarity = cosineSimilarity(a, b);

    expect(similarity).toBeCloseTo(0.0, 5);
  });

  it('should return -1.0 for opposite vectors', () => {
    const [a, b] = createOppositeVectors();
    const similarity = cosineSimilarity(a, b);

    expect(similarity).toBeCloseTo(-1.0, 5);
  });

  it('should be symmetric (a·b = b·a)', () => {
    const a = createRandomNormalizedVector();
    const b = createRandomNormalizedVector();

    const simAB = cosineSimilarity(a, b);
    const simBA = cosineSimilarity(b, a);

    expect(simAB).toBeCloseTo(simBA, 10);
  });

  it('should return value in range [-1, 1]', () => {
    for (let i = 0; i < 100; i++) {
      const a = createRandomNormalizedVector();
      const b = createRandomNormalizedVector();
      const similarity = cosineSimilarity(a, b);

      expect(similarity).toBeGreaterThanOrEqual(-1.0);
      expect(similarity).toBeLessThanOrEqual(1.0);
    }
  });

  it('should throw for dimension mismatch', () => {
    const a = new Float32Array(768);
    const b = new Float32Array(512);
    a[0] = 1.0;
    b[0] = 1.0;

    expect(() => cosineSimilarity(a, b)).toThrow(GraphDimensionMismatchError);
  });

  it('should handle very small values', () => {
    const a = createSimpleNormalizedVector();
    const b = createSimpleNormalizedVector();

    // Make vectors very similar but not identical
    b[0] = 0.9999999;
    b[1] = Math.sqrt(1 - b[0] * b[0]);

    const similarity = cosineSimilarity(a, b);
    expect(similarity).toBeGreaterThan(0.999);
    expect(similarity).toBeLessThanOrEqual(1.0);
  });

  it('should equal dot product for L2-normalized vectors', () => {
    const a = createRandomNormalizedVector();
    const b = createRandomNormalizedVector();

    const cosine = cosineSimilarity(a, b);
    const dot = dotProduct(a, b);

    expect(cosine).toBeCloseTo(dot, 6);
  });
});

describe('Distance Metrics - euclideanDistance', () => {
  it('should return 0 for identical vectors', () => {
    const [a, b] = createIdenticalVectors();
    const distance = euclideanDistance(a, b);

    expect(distance).toBeCloseTo(0, 5);
  });

  it('should return 0 for same vector (self-distance)', () => {
    const vector = createRandomNormalizedVector();
    const distance = euclideanDistance(vector, vector);

    expect(distance).toBeCloseTo(0, 5);
  });

  it('should calculate correct distance for simple vectors', () => {
    const a = new Float32Array(VECTOR_DIM);
    const b = new Float32Array(VECTOR_DIM);

    a[0] = 0;
    a[1] = 0;
    b[0] = 3;
    b[1] = 4;

    const distance = euclideanDistance(a, b);
    expect(distance).toBeCloseTo(5.0, 5); // 3-4-5 triangle
  });

  it('should be symmetric (d(a,b) = d(b,a))', () => {
    const a = createRandomNormalizedVector();
    const b = createRandomNormalizedVector();

    const distAB = euclideanDistance(a, b);
    const distBA = euclideanDistance(b, a);

    expect(distAB).toBeCloseTo(distBA, 10);
  });

  it('should return positive distance', () => {
    for (let i = 0; i < 50; i++) {
      const a = createRandomNormalizedVector();
      const b = createRandomNormalizedVector();
      const distance = euclideanDistance(a, b);

      expect(distance).toBeGreaterThanOrEqual(0);
    }
  });

  it('should throw for dimension mismatch', () => {
    const a = new Float32Array(768);
    const b = new Float32Array(100);

    expect(() => euclideanDistance(a, b)).toThrow(GraphDimensionMismatchError);
  });

  it('should calculate distance for orthogonal unit vectors', () => {
    const [a, b] = createOrthogonalVectors();
    const distance = euclideanDistance(a, b);

    // For two orthogonal unit vectors: d = sqrt(2)
    expect(distance).toBeCloseTo(Math.sqrt(2), 5);
  });

  it('should satisfy triangle inequality', () => {
    const a = createRandomNormalizedVector();
    const b = createRandomNormalizedVector();
    const c = createRandomNormalizedVector();

    const dAB = euclideanDistance(a, b);
    const dBC = euclideanDistance(b, c);
    const dAC = euclideanDistance(a, c);

    // Triangle inequality: d(a,c) <= d(a,b) + d(b,c)
    expect(dAC).toBeLessThanOrEqual(dAB + dBC + 1e-6);
  });
});

describe('Distance Metrics - dotProduct', () => {
  it('should calculate correct dot product', () => {
    const a = new Float32Array(VECTOR_DIM);
    const b = new Float32Array(VECTOR_DIM);

    a[0] = 3;
    a[1] = 4;
    b[0] = 2;
    b[1] = 1;

    const result = dotProduct(a, b);
    expect(result).toBeCloseTo(10, 5); // 3*2 + 4*1 = 10
  });

  it('should return same value as cosineSimilarity for normalized vectors', () => {
    const a = createRandomNormalizedVector();
    const b = createRandomNormalizedVector();

    const dot = dotProduct(a, b);
    const cosine = cosineSimilarity(a, b);

    expect(dot).toBeCloseTo(cosine, 6);
  });

  it('should be symmetric (a·b = b·a)', () => {
    const a = createRandomNormalizedVector();
    const b = createRandomNormalizedVector();

    const dotAB = dotProduct(a, b);
    const dotBA = dotProduct(b, a);

    expect(dotAB).toBeCloseTo(dotBA, 10);
  });

  it('should return 0 for orthogonal vectors', () => {
    const [a, b] = createOrthogonalVectors();
    const result = dotProduct(a, b);

    expect(result).toBeCloseTo(0, 5);
  });

  it('should return squared norm for identical vectors', () => {
    const vector = createRandomNormalizedVector();
    const result = dotProduct(vector, vector);

    // For L2-normalized vectors, ||v||^2 = 1
    expect(result).toBeCloseTo(1.0, 5);
  });

  it('should throw for dimension mismatch', () => {
    const a = new Float32Array(768);
    const b = new Float32Array(512);

    expect(() => dotProduct(a, b)).toThrow(GraphDimensionMismatchError);
  });

  it('should handle negative values', () => {
    const a = new Float32Array(VECTOR_DIM);
    const b = new Float32Array(VECTOR_DIM);

    a[0] = 1;
    b[0] = -1;

    const result = dotProduct(a, b);
    expect(result).toBeCloseTo(-1.0, 5);
  });
});

describe('Distance Metrics - manhattanDistance', () => {
  it('should return 0 for identical vectors', () => {
    const [a, b] = createIdenticalVectors();
    const distance = manhattanDistance(a, b);

    expect(distance).toBeCloseTo(0, 5);
  });

  it('should calculate correct Manhattan distance', () => {
    const a = new Float32Array(VECTOR_DIM);
    const b = new Float32Array(VECTOR_DIM);

    a[0] = 0;
    a[1] = 0;
    b[0] = 3;
    b[1] = 4;

    const distance = manhattanDistance(a, b);
    expect(distance).toBeCloseTo(7, 5); // |3-0| + |4-0| = 7
  });

  it('should be symmetric (d(a,b) = d(b,a))', () => {
    const a = createRandomNormalizedVector();
    const b = createRandomNormalizedVector();

    const distAB = manhattanDistance(a, b);
    const distBA = manhattanDistance(b, a);

    expect(distAB).toBeCloseTo(distBA, 10);
  });

  it('should return positive distance', () => {
    for (let i = 0; i < 50; i++) {
      const a = createRandomNormalizedVector();
      const b = createRandomNormalizedVector();
      const distance = manhattanDistance(a, b);

      expect(distance).toBeGreaterThanOrEqual(0);
    }
  });

  it('should throw for dimension mismatch', () => {
    const a = new Float32Array(768);
    const b = new Float32Array(100);

    expect(() => manhattanDistance(a, b)).toThrow(GraphDimensionMismatchError);
  });

  it('should handle negative differences', () => {
    const a = new Float32Array(VECTOR_DIM);
    const b = new Float32Array(VECTOR_DIM);

    a[0] = 5;
    b[0] = 2;
    a[1] = -3;
    b[1] = 1;

    const distance = manhattanDistance(a, b);
    expect(distance).toBeCloseTo(7, 5); // |5-2| + |-3-1| = 3 + 4 = 7
  });

  it('should be greater than or equal to Euclidean distance', () => {
    for (let i = 0; i < 20; i++) {
      const a = createRandomNormalizedVector();
      const b = createRandomNormalizedVector();

      const manhattan = manhattanDistance(a, b);
      const euclidean = euclideanDistance(a, b);

      // Manhattan distance >= Euclidean distance (always true)
      expect(manhattan).toBeGreaterThanOrEqual(euclidean - 1e-6);
    }
  });
});

describe('Distance Metrics - getMetricFunction', () => {
  it('should return cosineSimilarity for COSINE metric', () => {
    const fn = getMetricFunction(DistanceMetric.COSINE);
    expect(fn).toBe(cosineSimilarity);
  });

  it('should return euclideanDistance for EUCLIDEAN metric', () => {
    const fn = getMetricFunction(DistanceMetric.EUCLIDEAN);
    expect(fn).toBe(euclideanDistance);
  });

  it('should return dotProduct for DOT metric', () => {
    const fn = getMetricFunction(DistanceMetric.DOT);
    expect(fn).toBe(dotProduct);
  });

  it('should return manhattanDistance for MANHATTAN metric', () => {
    const fn = getMetricFunction(DistanceMetric.MANHATTAN);
    expect(fn).toBe(manhattanDistance);
  });

  it('should throw for unknown metric', () => {
    const unknownMetric = 'invalid' as DistanceMetric;
    expect(() => getMetricFunction(unknownMetric)).toThrow('Unknown distance metric');
  });

  it('should return working functions', () => {
    const a = createRandomNormalizedVector();
    const b = createRandomNormalizedVector();

    const cosineFn = getMetricFunction(DistanceMetric.COSINE);
    const result = cosineFn(a, b);

    expect(typeof result).toBe('number');
    expect(Number.isFinite(result)).toBe(true);
  });
});

describe('Distance Metrics - isSimilarityMetric', () => {
  it('should return true for COSINE metric', () => {
    expect(isSimilarityMetric(DistanceMetric.COSINE)).toBe(true);
  });

  it('should return true for DOT metric', () => {
    expect(isSimilarityMetric(DistanceMetric.DOT)).toBe(true);
  });

  it('should return false for EUCLIDEAN metric', () => {
    expect(isSimilarityMetric(DistanceMetric.EUCLIDEAN)).toBe(false);
  });

  it('should return false for MANHATTAN metric', () => {
    expect(isSimilarityMetric(DistanceMetric.MANHATTAN)).toBe(false);
  });
});

describe('Distance Metrics - Edge Cases', () => {
  it('should handle zero vectors in cosine similarity', () => {
    const zero = new Float32Array(VECTOR_DIM);
    const nonZero = createSimpleNormalizedVector();

    const similarity = cosineSimilarity(zero, nonZero);
    expect(similarity).toBe(0);
  });

  it('should handle zero vectors in euclidean distance', () => {
    const zero = new Float32Array(VECTOR_DIM);
    const nonZero = createSimpleNormalizedVector();

    const distance = euclideanDistance(zero, nonZero);
    expect(distance).toBeCloseTo(1.0, 5);
  });

  it('should handle very small differences', () => {
    const a = createSimpleNormalizedVector();
    const b = new Float32Array(a);
    // Use 1e-6 instead of 1e-10 because Float32 has ~7 decimal digits of precision
    b[0] += 1e-6;

    const distance = euclideanDistance(a, b);
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(1e-5);
  });

  it('should handle all metrics on same vector pair', () => {
    const a = createRandomNormalizedVector();
    const b = createRandomNormalizedVector();

    const cosine = cosineSimilarity(a, b);
    const euclidean = euclideanDistance(a, b);
    const dot = dotProduct(a, b);
    const manhattan = manhattanDistance(a, b);

    expect(Number.isFinite(cosine)).toBe(true);
    expect(Number.isFinite(euclidean)).toBe(true);
    expect(Number.isFinite(dot)).toBe(true);
    expect(Number.isFinite(manhattan)).toBe(true);
  });
});
