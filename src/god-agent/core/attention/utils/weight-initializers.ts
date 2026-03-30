/**
 * Weight Initialization Utilities
 *
 * Implements Xavier/Glorot uniform initialization for neural network weights.
 *
 * Reference: Glorot & Bengio 2010
 * "Understanding the difficulty of training deep feedforward neural networks"
 */

import { SeededRandom } from './seeded-random.js';

/**
 * Initialize weight matrix using Xavier/Glorot UNIFORM distribution
 *
 * Formula: W ~ U(-limit, limit)
 * where limit = √(6 / (fan_in + fan_out))
 *
 * IMPORTANT: This is UNIFORM distribution, NOT Gaussian.
 *
 * @param fanIn Input dimension
 * @param fanOut Output dimension
 * @param rng Optional seeded RNG for deterministic initialization
 * @returns Weight matrix [fanOut × fanIn] with Xavier uniform initialization
 *
 * @example
 * ```typescript
 * // Random initialization
 * const weights = xavierUniform(768, 768);
 *
 * // Deterministic initialization (for testing)
 * const rng = new SeededRandom(42);
 * const weights = xavierUniform(768, 768, rng);
 * ```
 */
export function xavierUniform(
  fanIn: number,
  fanOut: number,
  rng?: SeededRandom
): Float32Array {
  if (fanIn <= 0 || fanOut <= 0) {
    throw new Error(`Invalid dimensions: fanIn=${fanIn}, fanOut=${fanOut}`);
  }

  const size = fanIn * fanOut;
  const weights = new Float32Array(size);

  // Xavier uniform: limit = √(6 / (fan_in + fan_out))
  const limit = Math.sqrt(6.0 / (fanIn + fanOut));

  for (let i = 0; i < size; i++) {
    // Uniform random in [-limit, limit]
    const randomValue = rng ? rng.next() : Math.random();
    weights[i] = (randomValue * 2 - 1) * limit;
  }

  return weights;
}

/**
 * Compute expected variance for Xavier initialization
 *
 * Theoretical variance: Var(W) = 2 / (fan_in + fan_out)
 *
 * @param fanIn Input dimension
 * @param fanOut Output dimension
 * @returns Expected variance
 */
export function xavierVariance(fanIn: number, fanOut: number): number {
  return 2.0 / (fanIn + fanOut);
}

/**
 * Validate that weights have Xavier-like properties
 *
 * @param weights Weight matrix
 * @param fanIn Input dimension
 * @param fanOut Output dimension
 * @param tolerance Tolerance for statistical checks
 * @returns True if weights pass validation
 */
export function validateXavierWeights(
  weights: Float32Array,
  fanIn: number,
  fanOut: number,
  tolerance: number = 0.1
): boolean {
  const size = fanIn * fanOut;

  if (weights.length !== size) {
    return false;
  }

  // Check mean ≈ 0
  const mean = weights.reduce((sum, w) => sum + w, 0) / size;
  if (Math.abs(mean) > tolerance) {
    return false;
  }

  // Check variance ≈ 2/(fan_in + fan_out)
  const expectedVar = xavierVariance(fanIn, fanOut);
  const variance = weights.reduce((sum, w) => sum + (w - mean) ** 2, 0) / size;
  const varRatio = variance / expectedVar;

  // Allow 50% tolerance for variance (due to sampling)
  return varRatio > 0.5 && varRatio < 1.5;
}
