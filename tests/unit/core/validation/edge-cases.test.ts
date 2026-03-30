/**
 * Edge Case Tests for Vector Validation
 *
 * TASK-VEC-001: Edge case tests for unusual inputs
 *
 * Test scenarios:
 * - Zero vector handling
 * - Near-normalized vectors (just inside/outside tolerance)
 * - NaN/Infinity in various positions
 * - Subnormal floating-point values
 * - Very large/small values
 * - Empty arrays
 * - Single dimension vectors
 */

import { describe, it, expect } from 'vitest';
import {
  VECTOR_DIM,
  L2_NORM_TOLERANCE,
  assertDimensions,
  isL2Normalized,
  normL2,
  calculateNorm,
  validateFiniteValues,
  GraphDimensionMismatchError,
  ZeroVectorError,
  InvalidVectorValueError,
  NotNormalizedError
} from '../../../../src/god-agent/core/validation';

describe('Edge Cases - Zero Vector', () => {
  it('should throw ZeroVectorError when normalizing zero vector', () => {
    const zeroVector = new Float32Array(VECTOR_DIM);
    expect(() => normL2(zeroVector)).toThrow(ZeroVectorError);
  });

  it('should reject zero vector in assertDimensions (not normalized)', () => {
    const zeroVector = new Float32Array(VECTOR_DIM);
    expect(() => assertDimensions(zeroVector)).toThrow(NotNormalizedError);
  });

  it('should report zero vector as not normalized', () => {
    const zeroVector = new Float32Array(VECTOR_DIM);
    expect(isL2Normalized(zeroVector)).toBe(false);
  });

  it('should calculate norm of zero vector as 0', () => {
    const zeroVector = new Float32Array(VECTOR_DIM);
    expect(calculateNorm(zeroVector)).toBe(0);
  });
});

describe('Edge Cases - Near-Normalized Vectors', () => {
  it('should accept vector with norm = 1.0 - (tolerance/2)', () => {
    const vector = new Float32Array(VECTOR_DIM);
    const targetNorm = 1.0 - (L2_NORM_TOLERANCE / 2);
    vector[0] = targetNorm;

    expect(isL2Normalized(vector)).toBe(true);
  });

  it('should accept vector with norm = 1.0 + (tolerance/2)', () => {
    const vector = new Float32Array(VECTOR_DIM);
    const targetNorm = 1.0 + (L2_NORM_TOLERANCE / 2);
    vector[0] = targetNorm;

    expect(isL2Normalized(vector)).toBe(true);
  });

  it('should reject vector with norm = 1.0 - (tolerance * 2)', () => {
    const vector = new Float32Array(VECTOR_DIM);
    const targetNorm = 1.0 - (L2_NORM_TOLERANCE * 2);
    vector[0] = targetNorm;

    expect(isL2Normalized(vector)).toBe(false);
  });

  it('should reject vector with norm = 1.0 + (tolerance * 2)', () => {
    const vector = new Float32Array(VECTOR_DIM);
    const targetNorm = 1.0 + (L2_NORM_TOLERANCE * 2);
    vector[0] = targetNorm;

    expect(isL2Normalized(vector)).toBe(false);
  });

  it('should accept vector exactly at tolerance boundary', () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[0] = 1.0 + L2_NORM_TOLERANCE;

    // Exactly at boundary - should be accepted (<=)
    expect(isL2Normalized(vector, L2_NORM_TOLERANCE)).toBe(true);
  });
});

describe('Edge Cases - NaN at Various Positions', () => {
  it('should detect NaN at position 0', () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[0] = NaN;

    const result = validateFiniteValues(vector);
    expect(result.valid).toBe(false);
    expect(result.invalidPosition).toBe(0);
  });

  it('should detect NaN at last position', () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[767] = NaN;

    const result = validateFiniteValues(vector);
    expect(result.valid).toBe(false);
    expect(result.invalidPosition).toBe(767);
  });

  it('should detect first NaN when multiple exist', () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[100] = NaN;
    vector[200] = NaN;
    vector[300] = NaN;

    const result = validateFiniteValues(vector);
    expect(result.valid).toBe(false);
    expect(result.invalidPosition).toBe(100);  // First one
  });

  it('should throw assertDimensions for NaN even in normalized vector', () => {
    // Create normalized vector, then inject NaN
    const vector = new Float32Array(VECTOR_DIM);
    vector[0] = 1.0;  // Would be normalized
    vector[500] = NaN;  // But has NaN

    expect(() => assertDimensions(vector)).toThrow(InvalidVectorValueError);
  });
});

describe('Edge Cases - Infinity Handling', () => {
  it('should detect positive Infinity', () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[0] = Infinity;

    const result = validateFiniteValues(vector);
    expect(result.valid).toBe(false);
    expect(result.invalidValue).toBe(Infinity);
  });

  it('should detect negative Infinity', () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[0] = -Infinity;

    const result = validateFiniteValues(vector);
    expect(result.valid).toBe(false);
    expect(result.invalidValue).toBe(-Infinity);
  });

  it('should throw assertDimensions for Infinity', () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[0] = Infinity;

    expect(() => assertDimensions(vector)).toThrow(InvalidVectorValueError);
  });
});

describe('Edge Cases - Subnormal Values', () => {
  it('should accept subnormal positive values', () => {
    const vector = new Float32Array(VECTOR_DIM);
    // Subnormal float: smallest positive subnormal is ~1.4e-45
    vector[0] = 1.0;  // Keep normalized
    vector[1] = 1e-40;  // Subnormal

    // Renormalize to make it valid
    const norm = Math.sqrt(1.0 + 1e-80);
    vector[0] /= norm;
    vector[1] /= norm;

    const result = validateFiniteValues(vector);
    expect(result.valid).toBe(true);
  });

  it('should accept subnormal negative values', () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[0] = 1.0;
    vector[1] = -1e-40;

    const norm = Math.sqrt(1.0 + 1e-80);
    vector[0] /= norm;
    vector[1] /= norm;

    const result = validateFiniteValues(vector);
    expect(result.valid).toBe(true);
  });
});

describe('Edge Cases - Large/Small Values', () => {
  it('should handle vector with very large values before normalization', () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[0] = 1e30;
    vector[1] = 1e30;

    const normalized = normL2(vector);
    expect(isL2Normalized(normalized)).toBe(true);
    expect(Number.isFinite(normalized[0])).toBe(true);
  });

  it('should handle vector with very small non-zero values', () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[0] = 1e-30;
    vector[1] = 1e-30;

    const normalized = normL2(vector);
    expect(isL2Normalized(normalized)).toBe(true);
  });

  it('should handle mix of large and small values', () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[0] = 1e10;
    vector[1] = 1e-10;

    const normalized = normL2(vector);
    expect(isL2Normalized(normalized)).toBe(true);
  });
});

describe('Edge Cases - Dimension Boundaries', () => {
  it('should reject empty array', () => {
    const vector = new Float32Array(0);
    expect(() => assertDimensions(vector)).toThrow(GraphDimensionMismatchError);
  });

  it('should reject single element array', () => {
    const vector = new Float32Array(1);
    vector[0] = 1.0;
    expect(() => assertDimensions(vector)).toThrow(GraphDimensionMismatchError);
  });

  it('should reject 769D vector', () => {
    const vector = new Float32Array(769);
    vector[0] = 1.0;
    expect(() => assertDimensions(vector)).toThrow(GraphDimensionMismatchError);
  });

  it('should accept custom dimension if specified', () => {
    const vector = new Float32Array(512);
    vector[0] = 1.0;
    expect(() => assertDimensions(vector, 512)).not.toThrow();
  });
});

describe('Edge Cases - Numerical Precision', () => {
  it('should handle vectors that become normalized due to Float32 precision', () => {
    // Create a vector that's very close to normalized
    const vector = new Float32Array(VECTOR_DIM);
    vector[0] = 0.9999999;
    vector[1] = 0.0001;

    const normalized = normL2(vector);
    expect(isL2Normalized(normalized)).toBe(true);
  });

  it('should maintain precision after normalization', () => {
    const vector = new Float32Array(VECTOR_DIM);
    // Distribute values across many dimensions
    for (let i = 0; i < 100; i++) {
      vector[i] = 0.1;
    }

    const normalized = normL2(vector);
    expect(isL2Normalized(normalized)).toBe(true);
  });
});

describe('Edge Cases - Error Properties', () => {
  it('GraphDimensionMismatchError should have correct properties', () => {
    const vector = new Float32Array(100);
    vector[0] = 1.0;

    try {
      assertDimensions(vector, VECTOR_DIM, 'TestContext');
      expect.fail('Should have thrown');
    } catch (e) {
      const err = e as GraphDimensionMismatchError;
      expect(err.name).toBe('GraphDimensionMismatchError');
      // TASK-VEC-001-008: Updated from 768 to 1536 per REQ-VEC-01
      expect(err.expected).toBe(1536);
      expect(err.actual).toBe(100);
      expect(err.context).toBe('TestContext');
    }
  });

  it('InvalidVectorValueError should have correct properties', () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[50] = NaN;

    try {
      assertDimensions(vector);
      expect.fail('Should have thrown');
    } catch (e) {
      const err = e as InvalidVectorValueError;
      expect(err.name).toBe('InvalidVectorValueError');
      expect(err.position).toBe(50);
      expect(Number.isNaN(err.value)).toBe(true);
    }
  });

  it('ZeroVectorError should have correct name', () => {
    const vector = new Float32Array(VECTOR_DIM);

    try {
      normL2(vector);
      expect.fail('Should have thrown');
    } catch (e) {
      const err = e as ZeroVectorError;
      expect(err.name).toBe('ZeroVectorError');
    }
  });

  it('NotNormalizedError should have correct properties', () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[0] = 2.0;

    try {
      assertDimensions(vector, VECTOR_DIM, 'NormTest');
      expect.fail('Should have thrown');
    } catch (e) {
      const err = e as NotNormalizedError;
      expect(err.name).toBe('NotNormalizedError');
      expect(err.context).toBe('NormTest');
      expect(err.norm).toBeCloseTo(2.0, 5);
    }
  });
});
