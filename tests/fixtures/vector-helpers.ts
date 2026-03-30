/**
 * Vector Test Helpers
 * TASK-VEC-001-008: Centralized vector generation utilities for tests
 *
 * All test files should use these helpers instead of hardcoding dimensions.
 * The VECTOR_DIM constant is the single source of truth for embedding dimensions.
 *
 * @example
 * ```typescript
 * import { createTestEmbedding, VECTOR_DIM } from '../../fixtures/vector-helpers.js';
 *
 * const embedding = createTestEmbedding(); // 1536D normalized
 * const embedding2 = createTestEmbedding(42); // Seeded for reproducibility
 * ```
 */

import { VECTOR_DIM } from '../../src/god-agent/core/validation/constants.js';

// Re-export VECTOR_DIM for convenience
export { VECTOR_DIM };

/**
 * Create a normalized test embedding with deterministic values
 * @param seed - Optional seed for reproducibility (default: 0)
 * @returns L2-normalized Float32Array of VECTOR_DIM dimensions
 */
export function createTestEmbedding(seed: number = 0): Float32Array {
  const arr = new Float32Array(VECTOR_DIM);
  let sumSq = 0;

  // Simple seeded pseudo-random for reproducibility
  let x = Math.sin(seed + 1) * 10000;
  for (let i = 0; i < VECTOR_DIM; i++) {
    x = Math.sin(x) * 10000;
    arr[i] = (x - Math.floor(x)) * 2 - 1; // Range [-1, 1]
    sumSq += arr[i] * arr[i];
  }

  // L2 normalize
  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < VECTOR_DIM; i++) {
      arr[i] /= norm;
    }
  }

  return arr;
}

/**
 * Create a batch of test embeddings
 * @param count - Number of embeddings to create
 * @param startSeed - Starting seed value
 * @returns Array of L2-normalized Float32Arrays
 */
export function createTestEmbeddingBatch(count: number, startSeed: number = 0): Float32Array[] {
  return Array.from({ length: count }, (_, i) => createTestEmbedding(startSeed + i));
}

/**
 * Create a zero embedding (all zeros)
 * @returns Float32Array of VECTOR_DIM zeros
 */
export function createZeroEmbedding(): Float32Array {
  return new Float32Array(VECTOR_DIM);
}

/**
 * Create a uniform embedding (all same value)
 * @param value - Value to fill with
 * @returns Float32Array of VECTOR_DIM with all values set to value
 */
export function createUniformEmbedding(value: number): Float32Array {
  const arr = new Float32Array(VECTOR_DIM);
  arr.fill(value);
  return arr;
}

/**
 * Create a unit vector (1.0 at first position, zeros elsewhere)
 * @returns L2-normalized unit vector
 */
export function createUnitEmbedding(): Float32Array {
  const arr = new Float32Array(VECTOR_DIM);
  arr[0] = 1.0;
  return arr;
}

/**
 * Create embedding with custom dimension (for testing dimension mismatch errors)
 * @param dim - Custom dimension
 * @param seed - Optional seed
 * @returns L2-normalized Float32Array of specified dimensions
 */
export function createEmbeddingWithDim(dim: number, seed: number = 0): Float32Array {
  const arr = new Float32Array(dim);
  let sumSq = 0;

  let x = Math.sin(seed + 1) * 10000;
  for (let i = 0; i < dim; i++) {
    x = Math.sin(x) * 10000;
    arr[i] = (x - Math.floor(x)) * 2 - 1;
    sumSq += arr[i] * arr[i];
  }

  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) {
      arr[i] /= norm;
    }
  }

  return arr;
}

/**
 * Create a random embedding using Math.random() (non-deterministic)
 * @returns L2-normalized Float32Array
 */
export function createRandomEmbedding(): Float32Array {
  const arr = new Float32Array(VECTOR_DIM);
  let sumSq = 0;

  for (let i = 0; i < VECTOR_DIM; i++) {
    arr[i] = Math.random() * 2 - 1;
    sumSq += arr[i] * arr[i];
  }

  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < VECTOR_DIM; i++) {
      arr[i] /= norm;
    }
  }

  return arr;
}

/**
 * Create embedding as number array (for APIs that expect number[])
 * @param seed - Optional seed
 * @returns L2-normalized number array
 */
export function createTestEmbeddingArray(seed: number = 0): number[] {
  return Array.from(createTestEmbedding(seed));
}

/**
 * Calculate L2 norm of a vector
 * @param v - Input vector
 * @returns L2 norm value
 */
export function computeL2Norm(v: Float32Array | number[]): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i] * v[i];
  }
  return Math.sqrt(sum);
}

/**
 * Calculate cosine similarity between two vectors
 * @param a - First vector
 * @param b - Second vector
 * @returns Cosine similarity value (-1 to 1)
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Verify a vector is L2 normalized (norm within tolerance of 1.0)
 * @param v - Vector to check
 * @param tolerance - Allowed deviation from 1.0 (default: 1e-6)
 * @returns True if normalized
 */
export function isL2Normalized(v: Float32Array | number[], tolerance: number = 1e-6): boolean {
  const norm = computeL2Norm(v);
  return Math.abs(norm - 1.0) < tolerance;
}
