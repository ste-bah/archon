/**
 * Matrix Operations for Attention
 *
 * All matrices are stored in row-major (C-style) flattened format.
 *
 * Example 2×3 matrix:
 * ```
 * A = [[a00, a01, a02],
 *      [a10, a11, a12]]
 *
 * Flattened: [a00, a01, a02, a10, a11, a12]
 * Index: A[i,j] → array[i * cols + j]
 * ```
 */

/**
 * Matrix-vector multiplication with support for batched sequences
 *
 * Computes: output = vec × weights^T
 *
 * Supports two modes:
 * 1. Single vector: vec[dim] × weights[dim × dim] → output[dim]
 * 2. Batched: vec[seq_len × dim] × weights[dim × dim] → output[seq_len × dim]
 *
 * @param vec Input vector(s) [seq_len * dim] (flattened)
 * @param weights Weight matrix [dim × dim] (flattened row-major)
 * @param dim Dimension size
 * @returns Output vector(s) [seq_len * dim] (flattened)
 *
 * @throws Error if dimensions incompatible
 *
 * @example
 * ```typescript
 * // Single vector
 * const vec = new Float32Array(768);
 * const weights = xavierUniform(768, 768);
 * const output = matmul(vec, weights, 768);
 *
 * // Batched (3 vectors)
 * const vec = new Float32Array(3 * 768);
 * const output = matmul(vec, weights, 768);
 * ```
 */
export function matmul(
  vec: Float32Array,
  weights: Float32Array,
  dim: number
): Float32Array {
  // Validate dimensions
  if (vec.length % dim !== 0) {
    throw new Error(
      `Vector length ${vec.length} not divisible by dimension ${dim}`
    );
  }

  if (weights.length !== dim * dim) {
    throw new Error(
      `Weight matrix size ${weights.length} incompatible with dimension ${dim}` +
      ` (expected ${dim * dim})`
    );
  }

  const seqLen = vec.length / dim;
  const output = new Float32Array(vec.length);

  // For each sequence position
  for (let seq = 0; seq < seqLen; seq++) {
    const vecOffset = seq * dim;

    // For each output dimension
    for (let i = 0; i < dim; i++) {
      let sum = 0;
      const weightRowOffset = i * dim;

      // Dot product: output[i] = Σ(vec[j] * weights[i,j])
      for (let j = 0; j < dim; j++) {
        sum += vec[vecOffset + j] * weights[weightRowOffset + j];
      }

      output[vecOffset + i] = sum;
    }
  }

  return output;
}

/**
 * Compute dot product of two flattened vectors
 *
 * @param a First vector
 * @param b Second vector
 * @param offset_a Offset in first vector
 * @param offset_b Offset in second vector
 * @param length Number of elements
 * @returns Dot product
 */
export function dotProduct(
  a: Float32Array,
  b: Float32Array,
  offset_a: number,
  offset_b: number,
  length: number
): number {
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += a[offset_a + i] * b[offset_b + i];
  }
  return sum;
}

/**
 * Validate matrix dimensions for multiplication
 *
 * @param vecLen Vector length
 * @param weightLen Weight matrix length
 * @param dim Dimension
 * @returns True if compatible
 */
export function validateMatmulDims(
  vecLen: number,
  weightLen: number,
  dim: number
): boolean {
  return (
    vecLen % dim === 0 &&
    weightLen === dim * dim
  );
}
