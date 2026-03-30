/**
 * God Agent Vector Validation Utilities
 *
 * Core validation functions that enforce the 1536-dimensional, L2-normalized,
 * finite-valued vector contract across the entire God Agent system.
 *
 * Implements: REQ-VEC-01, REQ-VEC-02, REQ-VEC-03, REQ-VEC-04
 * Referenced by: TASK-VEC-001
 *
 * Per constitution.md:
 * - VEC-01: ALL vectors MUST be exactly 1536 dimensions
 * - VEC-02: ALL vectors MUST be L2-normalized before storage
 * - VEC-03: NO NaN or Infinity values permitted in vectors
 * - VEC-04: Dimension validation required at ALL insertion boundaries
 */

import { VECTOR_DIM, L2_NORM_TOLERANCE } from './constants.js';
import {
  GraphDimensionMismatchError,
  ZeroVectorError,
  InvalidVectorValueError,
  NotNormalizedError
} from './errors.js';

/**
 * Calculate L2 norm (Euclidean length) of a vector
 *
 * @param vector - Float32Array to calculate norm of
 * @returns L2 norm value
 */
export function calculateNorm(vector: Float32Array): number {
  let sumOfSquares = 0;
  for (let i = 0; i < vector.length; i++) {
    sumOfSquares += vector[i] * vector[i];
  }
  return Math.sqrt(sumOfSquares);
}

/**
 * Check if a vector is L2-normalized (norm within tolerance of 1.0)
 *
 * @param vector - Float32Array to check
 * @param epsilon - Tolerance for deviation from 1.0 (default: 1e-6)
 * @returns true if vector is L2-normalized within tolerance
 */
export function isL2Normalized(
  vector: Float32Array,
  epsilon: number = L2_NORM_TOLERANCE
): boolean {
  const norm = calculateNorm(vector);
  const deviation = Math.abs(norm - 1.0);
  return deviation <= epsilon;
}

/**
 * Check if all values in a vector are finite (no NaN or Infinity)
 *
 * @param vector - Float32Array to validate
 * @returns Object with valid flag and first invalid position/value if any
 */
export function validateFiniteValues(vector: Float32Array): {
  valid: boolean;
  invalidPosition?: number;
  invalidValue?: number;
} {
  for (let i = 0; i < vector.length; i++) {
    if (!Number.isFinite(vector[i])) {
      return { valid: false, invalidPosition: i, invalidValue: vector[i] };
    }
  }
  return { valid: true };
}

/**
 * L2 normalize a vector in-place or return new normalized copy
 *
 * @param vector - Float32Array to normalize
 * @param inPlace - If true, modifies original vector; if false, returns new array
 * @returns Normalized vector (same array if inPlace, new array otherwise)
 * @throws ZeroVectorError if vector has zero magnitude
 */
export function normL2(vector: Float32Array, inPlace: boolean = false): Float32Array {
  const norm = calculateNorm(vector);

  if (norm === 0) {
    throw new ZeroVectorError('Cannot normalize zero vector; L2 norm is 0');
  }

  const result = inPlace ? vector : new Float32Array(vector.length);
  const invNorm = 1.0 / norm;

  for (let i = 0; i < vector.length; i++) {
    result[i] = vector[i] * invNorm;
  }

  return result;
}

/**
 * Comprehensive vector validation at insertion boundaries
 *
 * Validates that a vector:
 * 1. Has exactly the expected dimensions (default: 1536)
 * 2. Is L2-normalized (norm within tolerance of 1.0)
 * 3. Contains only finite values (no NaN or Infinity)
 *
 * Per constitution.md VEC-04: This function MUST be called at ALL insertion
 * boundaries (VectorDB, PatternMatcher, Hyperedge creation)
 *
 * @param vector - Float32Array to validate
 * @param expected - Expected dimension count (default: 1536)
 * @param context - Context string for error messages (e.g., "VectorDB.insert")
 * @throws GraphDimensionMismatchError if dimensions don't match
 * @throws NotNormalizedError if vector is not L2-normalized
 * @throws InvalidVectorValueError if vector contains NaN or Infinity
 */
export function assertDimensions(
  vector: Float32Array,
  expected: number = VECTOR_DIM,
  context: string = 'Vector validation'
): void {
  // Step 1: Validate dimension count (VEC-01)
  if (vector.length !== expected) {
    throw new GraphDimensionMismatchError(expected, vector.length, context);
  }

  // Step 2: Validate finite values first (VEC-03)
  // Do this before norm calculation to catch NaN/Infinity early
  const finiteCheck = validateFiniteValues(vector);
  if (!finiteCheck.valid) {
    throw new InvalidVectorValueError(
      finiteCheck.invalidPosition!,
      finiteCheck.invalidValue!,
      context
    );
  }

  // Step 3: Validate L2 normalization (VEC-02)
  if (!isL2Normalized(vector)) {
    const norm = calculateNorm(vector);
    throw new NotNormalizedError(norm, context);
  }
}

/**
 * Validate vector dimensions only (without normalization check)
 * Useful for pre-normalization validation
 *
 * @param vector - Float32Array to validate
 * @param expected - Expected dimension count
 * @param context - Context string for error messages
 * @throws GraphDimensionMismatchError if dimensions don't match
 * @throws InvalidVectorValueError if vector contains NaN or Infinity
 */
export function assertDimensionsOnly(
  vector: Float32Array,
  expected: number = VECTOR_DIM,
  context: string = 'Vector dimension check'
): void {
  if (vector.length !== expected) {
    throw new GraphDimensionMismatchError(expected, vector.length, context);
  }

  const finiteCheck = validateFiniteValues(vector);
  if (!finiteCheck.valid) {
    throw new InvalidVectorValueError(
      finiteCheck.invalidPosition!,
      finiteCheck.invalidValue!,
      context
    );
  }
}

/**
 * Create a validated, normalized vector from raw values
 * Convenience function that validates dimensions, normalizes, and validates again
 *
 * @param values - Raw values (number array or Float32Array)
 * @param context - Context string for error messages
 * @returns Validated, normalized Float32Array
 */
export function createValidatedVector(
  values: number[] | Float32Array,
  context: string = 'Vector creation'
): Float32Array {
  const vector = values instanceof Float32Array
    ? values
    : new Float32Array(values);

  // Validate dimensions
  assertDimensionsOnly(vector, VECTOR_DIM, context);

  // Normalize
  const normalized = normL2(vector, false);

  // Final validation (should always pass, but double-check)
  assertDimensions(normalized, VECTOR_DIM, context);

  return normalized;
}

/**
 * Cosine similarity between two vectors
 * Assumes vectors are already L2-normalized
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Cosine similarity (dot product for normalized vectors)
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new GraphDimensionMismatchError(a.length, b.length, 'Cosine similarity');
  }

  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
  }
  return dotProduct;
}

/**
 * Euclidean distance between two vectors
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Euclidean distance
 */
export function euclideanDistance(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new GraphDimensionMismatchError(a.length, b.length, 'Euclidean distance');
  }

  let sumOfSquares = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sumOfSquares += diff * diff;
  }
  return Math.sqrt(sumOfSquares);
}
