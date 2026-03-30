/**
 * Unit Tests for Vector Validation Utilities
 *
 * TASK-VEC-001: Comprehensive tests for assertDimensions, isL2Normalized, normL2
 * TASK-VEC-001-008: Updated from 768D to 1536D per REQ-VEC-01
 *
 * Test coverage targets:
 * - assertDimensions() accepts valid 1536D L2-normalized vectors
 * - assertDimensions() throws for wrong dimensions (767D, 768D - legacy)
 * - assertDimensions() throws for non-normalized vectors
 * - assertDimensions() throws for NaN at any position
 * - assertDimensions() throws for Infinity at any position
 * - isL2Normalized() returns true for vectors with norm within 1e-6 of 1.0
 * - isL2Normalized() returns false for vectors outside tolerance
 * - normL2() correctly normalizes [3, 4, 0, ..., 0] to [0.6, 0.8, 0, ..., 0]
 * - normL2() throws ZeroVectorError for zero vector
 */

import { describe, it, expect } from 'vitest';
import {
  VECTOR_DIM,
  L2_NORM_TOLERANCE,
  assertDimensions,
  assertDimensionsOnly,
  isL2Normalized,
  normL2,
  calculateNorm,
  validateFiniteValues,
  createValidatedVector,
  cosineSimilarity,
  euclideanDistance,
  GraphDimensionMismatchError,
  ZeroVectorError,
  InvalidVectorValueError,
  NotNormalizedError
} from '../../../../src/god-agent/core/validation';

/**
 * Helper function to create a random L2-normalized 1536D vector
 * TASK-VEC-001-008: Updated from 768D to 1536D
 */
function createRandomNormalizedVector(dim: number = VECTOR_DIM): Float32Array {
  const vector = new Float32Array(dim);
  let sumOfSquares = 0;

  // Generate random values
  for (let i = 0; i < dim; i++) {
    vector[i] = Math.random() - 0.5;
    sumOfSquares += vector[i] * vector[i];
  }

  // Normalize
  const norm = Math.sqrt(sumOfSquares);
  for (let i = 0; i < dim; i++) {
    vector[i] /= norm;
  }

  return vector;
}

/**
 * Helper to create a simple normalized vector for predictable testing
 */
function createSimpleNormalizedVector(): Float32Array {
  const vector = new Float32Array(VECTOR_DIM);
  // Create [1, 0, 0, ..., 0] which is already normalized
  vector[0] = 1.0;
  return vector;
}

describe('Vector Validation - Constants', () => {
  it('should have VECTOR_DIM set to 1536', () => {
    // TASK-VEC-001-008: Updated from 768D to 1536D per REQ-VEC-01
    expect(VECTOR_DIM).toBe(1536);
  });

  it('should have L2_NORM_TOLERANCE set to 1e-6', () => {
    expect(L2_NORM_TOLERANCE).toBe(1e-6);
  });
});

describe('Vector Validation - calculateNorm', () => {
  it('should calculate norm of unit vector as 1.0', () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[0] = 1.0;
    expect(calculateNorm(vector)).toBeCloseTo(1.0, 6);
  });

  it('should calculate norm of [3, 4, 0, ...] as 5.0', () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[0] = 3.0;
    vector[1] = 4.0;
    expect(calculateNorm(vector)).toBeCloseTo(5.0, 6);
  });

  it('should calculate norm of zero vector as 0', () => {
    const vector = new Float32Array(VECTOR_DIM);
    expect(calculateNorm(vector)).toBe(0);
  });
});

describe('Vector Validation - isL2Normalized', () => {
  it('should return true for vector with norm exactly 1.0', () => {
    const vector = createSimpleNormalizedVector();
    expect(isL2Normalized(vector)).toBe(true);
  });

  it('should return true for random normalized vector', () => {
    const vector = createRandomNormalizedVector();
    expect(isL2Normalized(vector)).toBe(true);
  });

  it('should return true for vector with norm within tolerance', () => {
    const vector = createSimpleNormalizedVector();
    // Slightly perturb to be just within tolerance
    vector[0] = 1.0 + (L2_NORM_TOLERANCE * 0.5);
    expect(isL2Normalized(vector, L2_NORM_TOLERANCE)).toBe(true);
  });

  it('should return false for non-normalized vector', () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[0] = 3.0;
    vector[1] = 4.0;
    expect(isL2Normalized(vector)).toBe(false);
  });

  it('should return false for zero vector', () => {
    const vector = new Float32Array(VECTOR_DIM);
    expect(isL2Normalized(vector)).toBe(false);
  });

  it('should respect custom epsilon parameter', () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[0] = 0.9;  // norm = 0.9, deviation = 0.1

    expect(isL2Normalized(vector, 0.05)).toBe(false);
    expect(isL2Normalized(vector, 0.15)).toBe(true);
  });
});

describe('Vector Validation - normL2', () => {
  it('should normalize [3, 4, 0, ...] to [0.6, 0.8, 0, ...]', () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[0] = 3.0;
    vector[1] = 4.0;

    const normalized = normL2(vector);

    expect(normalized[0]).toBeCloseTo(0.6, 5);
    expect(normalized[1]).toBeCloseTo(0.8, 5);
    expect(isL2Normalized(normalized)).toBe(true);
  });

  it('should return a new array when inPlace is false', () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[0] = 3.0;
    vector[1] = 4.0;
    const original0 = vector[0];

    const normalized = normL2(vector, false);

    expect(vector[0]).toBe(original0);
    expect(normalized).not.toBe(vector);
  });

  it('should modify original array when inPlace is true', () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[0] = 3.0;
    vector[1] = 4.0;

    const normalized = normL2(vector, true);

    expect(normalized).toBe(vector);
    expect(vector[0]).toBeCloseTo(0.6, 5);
  });

  it('should throw ZeroVectorError for zero vector', () => {
    const vector = new Float32Array(VECTOR_DIM);

    expect(() => normL2(vector)).toThrow(ZeroVectorError);
    // Use partial matching for zero vector error messages
    expect(() => normL2(vector)).toThrow(/zero vector|normalize.*zero/i);
  });

  it('should produce a vector with norm 1.0', () => {
    const vector = createRandomNormalizedVector();
    // Unnormalize it
    for (let i = 0; i < vector.length; i++) {
      vector[i] *= 2.5;
    }

    const normalized = normL2(vector);
    expect(calculateNorm(normalized)).toBeCloseTo(1.0, 6);
  });
});

describe('Vector Validation - validateFiniteValues', () => {
  it('should return valid: true for normal vector', () => {
    const vector = createRandomNormalizedVector();
    const result = validateFiniteValues(vector);
    expect(result.valid).toBe(true);
  });

  it('should detect NaN at first position', () => {
    const vector = createSimpleNormalizedVector();
    vector[0] = NaN;

    const result = validateFiniteValues(vector);
    expect(result.valid).toBe(false);
    expect(result.invalidPosition).toBe(0);
    expect(Number.isNaN(result.invalidValue)).toBe(true);
  });

  it('should detect NaN at middle position', () => {
    const vector = createSimpleNormalizedVector();
    vector[384] = NaN;

    const result = validateFiniteValues(vector);
    expect(result.valid).toBe(false);
    expect(result.invalidPosition).toBe(384);
  });

  it('should detect Infinity', () => {
    const vector = createSimpleNormalizedVector();
    vector[100] = Infinity;

    const result = validateFiniteValues(vector);
    expect(result.valid).toBe(false);
    expect(result.invalidPosition).toBe(100);
    expect(result.invalidValue).toBe(Infinity);
  });

  it('should detect negative Infinity', () => {
    const vector = createSimpleNormalizedVector();
    vector[200] = -Infinity;

    const result = validateFiniteValues(vector);
    expect(result.valid).toBe(false);
    expect(result.invalidPosition).toBe(200);
    expect(result.invalidValue).toBe(-Infinity);
  });
});

describe('Vector Validation - assertDimensions', () => {
  it('should accept valid 1536D L2-normalized vector', () => {
    // TASK-VEC-001-008: Updated from 768D to 1536D
    const vector = createRandomNormalizedVector();
    expect(() => assertDimensions(vector)).not.toThrow();
  });

  it('should accept valid 1536D vector with explicit context', () => {
    // TASK-VEC-001-008: Updated from 768D to 1536D
    const vector = createRandomNormalizedVector();
    expect(() => assertDimensions(vector, VECTOR_DIM, 'VectorDB.insert')).not.toThrow();
  });

  it('should throw GraphDimensionMismatchError for 1535D vector', () => {
    // TASK-VEC-001-008: Updated test for 1536D standard
    const vector = new Float32Array(1535);
    vector[0] = 1.0;  // Make it "normalized" for its dimension

    expect(() => assertDimensions(vector)).toThrow(GraphDimensionMismatchError);
    // Use flexible matching pattern for dimension error messages
    expect(() => assertDimensions(vector)).toThrow(/Expected \d+D, got \d+D/);
  });

  it('should throw GraphDimensionMismatchError for 768D vector', () => {
    // TASK-VEC-001-008: 768D is now invalid (was previously valid)
    const vector = new Float32Array(768);
    vector[0] = 1.0;

    expect(() => assertDimensions(vector)).toThrow(GraphDimensionMismatchError);
    // Use flexible matching pattern for dimension error messages
    expect(() => assertDimensions(vector)).toThrow(/Expected \d+D, got \d+D/);
  });

  it('should throw NotNormalizedError for non-normalized vector', () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[0] = 2.0;  // Not normalized

    expect(() => assertDimensions(vector)).toThrow(NotNormalizedError);
    // Use partial matching for normalization errors
    expect(() => assertDimensions(vector)).toThrow(/not L2-normalized|L2.*norm/i);
  });

  it('should throw InvalidVectorValueError for NaN at position 0', () => {
    const vector = createSimpleNormalizedVector();
    vector[0] = NaN;

    expect(() => assertDimensions(vector)).toThrow(InvalidVectorValueError);
    expect(() => assertDimensions(vector)).toThrow('position 0');
  });

  it('should throw InvalidVectorValueError for NaN at position 767', () => {
    const vector = createSimpleNormalizedVector();
    vector[767] = NaN;

    expect(() => assertDimensions(vector)).toThrow(InvalidVectorValueError);
    expect(() => assertDimensions(vector)).toThrow('position 767');
  });

  it('should throw InvalidVectorValueError for Infinity', () => {
    const vector = createSimpleNormalizedVector();
    vector[100] = Infinity;

    expect(() => assertDimensions(vector)).toThrow(InvalidVectorValueError);
  });

  it('should include context in error message', () => {
    const vector = new Float32Array(100);
    vector[0] = 1.0;

    try {
      assertDimensions(vector, VECTOR_DIM, 'PatternMatcher.store');
      expect.fail('Should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('PatternMatcher.store');
    }
  });

  it('should accept custom expected dimension', () => {
    const vector = new Float32Array(512);
    vector[0] = 1.0;

    expect(() => assertDimensions(vector, 512, 'Custom')).not.toThrow();
  });
});

describe('Vector Validation - assertDimensionsOnly', () => {
  it('should accept valid dimensions without normalization check', () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[0] = 2.0;  // Not normalized, but should pass

    expect(() => assertDimensionsOnly(vector)).not.toThrow();
  });

  it('should throw for wrong dimensions', () => {
    const vector = new Float32Array(100);
    expect(() => assertDimensionsOnly(vector)).toThrow(GraphDimensionMismatchError);
  });

  it('should throw for NaN values', () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[50] = NaN;
    expect(() => assertDimensionsOnly(vector)).toThrow(InvalidVectorValueError);
  });
});

describe('Vector Validation - createValidatedVector', () => {
  it('should create normalized vector from array', () => {
    const values = new Array(VECTOR_DIM).fill(0);
    values[0] = 3;
    values[1] = 4;

    const vector = createValidatedVector(values);

    expect(vector).toBeInstanceOf(Float32Array);
    expect(vector.length).toBe(VECTOR_DIM);
    expect(isL2Normalized(vector)).toBe(true);
    expect(vector[0]).toBeCloseTo(0.6, 5);
  });

  it('should throw for wrong dimensions', () => {
    const values = new Array(100).fill(1);
    expect(() => createValidatedVector(values)).toThrow(GraphDimensionMismatchError);
  });

  it('should throw for zero vector', () => {
    const values = new Array(VECTOR_DIM).fill(0);
    expect(() => createValidatedVector(values)).toThrow(ZeroVectorError);
  });
});

describe('Vector Validation - cosineSimilarity', () => {
  it('should return 1.0 for identical vectors', () => {
    const vector = createRandomNormalizedVector();
    expect(cosineSimilarity(vector, vector)).toBeCloseTo(1.0, 5);
  });

  it('should return 0.0 for orthogonal vectors', () => {
    const a = new Float32Array(VECTOR_DIM);
    const b = new Float32Array(VECTOR_DIM);
    a[0] = 1.0;
    b[1] = 1.0;

    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it('should return -1.0 for opposite vectors', () => {
    const a = new Float32Array(VECTOR_DIM);
    const b = new Float32Array(VECTOR_DIM);
    a[0] = 1.0;
    b[0] = -1.0;

    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it('should throw for dimension mismatch', () => {
    const a = new Float32Array(768);
    const b = new Float32Array(512);
    expect(() => cosineSimilarity(a, b)).toThrow(GraphDimensionMismatchError);
  });
});

describe('Vector Validation - euclideanDistance', () => {
  it('should return 0 for identical vectors', () => {
    const vector = createRandomNormalizedVector();
    expect(euclideanDistance(vector, vector)).toBeCloseTo(0, 5);
  });

  it('should calculate correct distance for simple vectors', () => {
    const a = new Float32Array(VECTOR_DIM);
    const b = new Float32Array(VECTOR_DIM);
    a[0] = 0;
    b[0] = 3;
    a[1] = 0;
    b[1] = 4;

    expect(euclideanDistance(a, b)).toBeCloseTo(5.0, 5);
  });

  it('should throw for dimension mismatch', () => {
    const a = new Float32Array(768);
    const b = new Float32Array(100);
    expect(() => euclideanDistance(a, b)).toThrow(GraphDimensionMismatchError);
  });
});
