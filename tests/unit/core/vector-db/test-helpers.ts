/**
 * Test Helper Utilities for VectorDB Tests
 *
 * TASK-VDB-001: Shared utilities for generating test vectors and data
 */

import { VECTOR_DIM } from '../../../../src/god-agent/core/validation';

/**
 * Create a random L2-normalized vector
 */
export function createRandomNormalizedVector(dim: number = VECTOR_DIM): Float32Array {
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
 * Create a simple normalized vector [1, 0, 0, ..., 0]
 */
export function createSimpleNormalizedVector(dim: number = VECTOR_DIM): Float32Array {
  const vector = new Float32Array(dim);
  vector[0] = 1.0;
  return vector;
}

/**
 * Create a batch of random normalized vectors
 */
export function createBatchVectors(count: number, dim: number = VECTOR_DIM): Float32Array[] {
  const vectors: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    vectors.push(createRandomNormalizedVector(dim));
  }
  return vectors;
}

/**
 * Create a vector with specific values at certain positions
 */
export function createVectorWithValues(
  dim: number = VECTOR_DIM,
  values: { [index: number]: number }
): Float32Array {
  const vector = new Float32Array(dim);

  // Set specified values
  for (const [index, value] of Object.entries(values)) {
    vector[Number(index)] = value;
  }

  // Normalize
  let sumOfSquares = 0;
  for (let i = 0; i < dim; i++) {
    sumOfSquares += vector[i] * vector[i];
  }

  const norm = Math.sqrt(sumOfSquares);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) {
      vector[i] /= norm;
    }
  }

  return vector;
}

/**
 * Create orthogonal vectors (perpendicular, cosine similarity = 0)
 */
export function createOrthogonalVectors(dim: number = VECTOR_DIM): [Float32Array, Float32Array] {
  const a = new Float32Array(dim);
  const b = new Float32Array(dim);

  a[0] = 1.0;
  b[1] = 1.0;

  return [a, b];
}

/**
 * Create identical vectors
 */
export function createIdenticalVectors(dim: number = VECTOR_DIM): [Float32Array, Float32Array] {
  const vector = createRandomNormalizedVector(dim);
  return [vector, new Float32Array(vector)];
}

/**
 * Create opposite vectors (cosine similarity = -1)
 */
export function createOppositeVectors(dim: number = VECTOR_DIM): [Float32Array, Float32Array] {
  const a = new Float32Array(dim);
  const b = new Float32Array(dim);

  a[0] = 1.0;
  b[0] = -1.0;

  return [a, b];
}

/**
 * Assert that a vector is approximately normalized
 */
export function expectNormalized(vector: Float32Array, tolerance: number = 1e-6): void {
  let sumOfSquares = 0;
  for (let i = 0; i < vector.length; i++) {
    sumOfSquares += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sumOfSquares);
  expect(Math.abs(norm - 1.0)).toBeLessThan(tolerance);
}

/**
 * Assert that two vectors are equal within tolerance
 */
export function expectVectorsEqual(
  a: Float32Array,
  b: Float32Array,
  tolerance: number = 1e-6
): void {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    expect(Math.abs(a[i] - b[i])).toBeLessThan(tolerance);
  }
}
