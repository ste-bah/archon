/**
 * Attention Utility Functions
 *
 * Provides softmax, normalization, and other attention-specific operations.
 */

/**
 * Numerically stable row-wise softmax
 *
 * Formula: softmax(x_i) = exp(x_i - max(x)) / Σⱼ exp(x_j - max(x))
 *
 * Max subtraction prevents overflow/underflow:
 * - Without: exp(1000) = Infinity
 * - With: exp(1000 - 1000) = exp(0) = 1
 *
 * @param scores Flattened score matrix [seq_len × seq_len] (row-major)
 * @param seqLen Sequence length
 * @returns Normalized weights [seq_len × seq_len] where each row sums to 1
 *
 * @throws Error if scores contain NaN
 *
 * @example
 * ```typescript
 * const scores = new Float32Array([1, 2, 3, 4]);
 * const weights = softmax2D(scores, 2);
 * // Row 0: [exp(1-2)/Z, exp(2-2)/Z]
 * // Row 1: [exp(3-4)/Z, exp(4-4)/Z]
 * ```
 */
export function softmax2D(scores: Float32Array, seqLen: number): Float32Array {
  const result = new Float32Array(scores.length);

  // Validate input
  if (scores.length !== seqLen * seqLen) {
    throw new Error(
      `Score length ${scores.length} incompatible with seqLen ${seqLen}`
    );
  }

  // Row-wise softmax
  for (let i = 0; i < seqLen; i++) {
    const rowStart = i * seqLen;

    // Step 1: Find max for numerical stability
    let maxScore = -Infinity;
    for (let j = 0; j < seqLen; j++) {
      const score = scores[rowStart + j];
      if (isNaN(score)) {
        throw new Error(`NaN detected in scores at position ${rowStart + j}`);
      }
      maxScore = Math.max(maxScore, score);
    }

    // Handle all -Infinity case (all masked)
    if (!isFinite(maxScore)) {
      // Uniform distribution over non-masked positions
      for (let j = 0; j < seqLen; j++) {
        result[rowStart + j] = 1.0 / seqLen;
      }
      continue;
    }

    // Step 2: Compute exp(x - max) and sum
    let sumExp = 0;
    for (let j = 0; j < seqLen; j++) {
      const score = scores[rowStart + j];

      // Handle -Infinity (masked position)
      if (score === -Infinity) {
        result[rowStart + j] = 0;
      } else {
        const exp = Math.exp(score - maxScore);
        result[rowStart + j] = exp;
        sumExp += exp;
      }
    }

    // Step 3: Normalize
    if (sumExp > 0) {
      for (let j = 0; j < seqLen; j++) {
        result[rowStart + j] /= sumExp;
      }
    } else {
      // Fallback: uniform distribution
      for (let j = 0; j < seqLen; j++) {
        result[rowStart + j] = 1.0 / seqLen;
      }
    }
  }

  return result;
}

/**
 * Validate softmax output (debugging utility)
 *
 * Checks:
 * - Each row sums to 1.0 (±tolerance)
 * - All values in [0, 1]
 * - No NaN/Inf
 *
 * @param weights Softmax output
 * @param seqLen Sequence length
 * @param tolerance Acceptable deviation from 1.0
 * @returns True if valid
 */
export function validateSoftmax(
  weights: Float32Array,
  seqLen: number,
  tolerance: number = 1e-6
): boolean {
  if (weights.length !== seqLen * seqLen) {
    return false;
  }

  for (let i = 0; i < seqLen; i++) {
    const rowStart = i * seqLen;
    let rowSum = 0;

    for (let j = 0; j < seqLen; j++) {
      const w = weights[rowStart + j];

      // Check range [0, 1]
      if (w < 0 || w > 1 || !isFinite(w)) {
        return false;
      }

      rowSum += w;
    }

    // Check row sums to 1
    if (Math.abs(rowSum - 1.0) > tolerance) {
      return false;
    }
  }

  return true;
}

/**
 * Check for NaN or Infinity in array
 *
 * @param arr Array to check
 * @returns True if contains NaN or Inf
 */
export function hasNaNOrInf(arr: Float32Array): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (!isFinite(arr[i])) {
      return true;
    }
  }
  return false;
}
