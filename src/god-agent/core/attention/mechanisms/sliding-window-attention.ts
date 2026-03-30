/**
 * Real Sliding Window Attention Implementation
 *
 * Each position attends to a fixed-size sliding window of neighbors.
 * Window slides across the sequence maintaining constant attention span.
 *
 * Use cases:
 * - Long sequence processing with local context
 * - Longformer-style local attention component
 * - Memory-efficient attention for long documents
 *
 * Complexity: O(N × W) where W is window size
 * Parameter Count: 4 × dim²
 *
 * ANTI-009: REAL implementation
 */

import { IAttentionMechanism } from '../attention-types.js';
import { SeededRandom, xavierUniform, matmul, hasNaNOrInf } from '../utils/index.js';

export class RealSlidingWindowAttention implements IAttentionMechanism {
  readonly name = 'sliding-window';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly headDim: number;
  private readonly scale: number;
  private readonly windowSize: number;
  private readonly halfWindow: number;

  // Weight matrices (stored flat: [dim × dim])
  private readonly wQuery: Float32Array;
  private readonly wKey: Float32Array;
  private readonly wValue: Float32Array;
  private readonly wOutput: Float32Array;

  constructor(config?: {
    dimension?: number;
    numHeads?: number;
    windowSize?: number;  // Total window size (default: 64)
    seed?: number;
  }) {
    // Validate and initialize parameters
    this.dimension = config?.dimension ?? 128;
    this.numHeads = config?.numHeads ?? 4;

    if (this.dimension <= 0) {
      throw new Error('dimension must be positive');
    }
    if (this.numHeads <= 0) {
      throw new Error('numHeads must be positive');
    }
    if (this.dimension % this.numHeads !== 0) {
      throw new Error('dimension must be divisible by numHeads');
    }

    this.windowSize = config?.windowSize ?? 64;
    if (this.windowSize <= 0) {
      throw new Error('windowSize must be positive');
    }

    this.halfWindow = Math.floor(this.windowSize / 2);
    this.headDim = this.dimension / this.numHeads;
    this.scale = 1.0 / Math.sqrt(this.headDim);

    // Initialize weight matrices with Xavier initialization
    const seed = config?.seed ?? Date.now();
    const rng = new SeededRandom(seed);

    this.wQuery = xavierUniform(this.dimension, this.dimension, rng);
    this.wKey = xavierUniform(this.dimension, this.dimension, rng);
    this.wValue = xavierUniform(this.dimension, this.dimension, rng);
    this.wOutput = xavierUniform(this.dimension, this.dimension, rng);

    // Validate initialization
    if (hasNaNOrInf(this.wQuery) || hasNaNOrInf(this.wKey) ||
      hasNaNOrInf(this.wValue) || hasNaNOrInf(this.wOutput)) {
      throw new Error('Weight initialization produced NaN or Inf');
    }
  }

  forward(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    mask?: boolean[],
    seqLen?: number
  ): Float32Array {
    // Validate inputs
    if (!query || !key || !value) {
      throw new Error('query, key, and value must be provided');
    }

    const N = seqLen ?? Math.floor(query.length / this.dimension);
    const expectedLen = N * this.dimension;

    if (query.length !== expectedLen || key.length !== expectedLen || value.length !== expectedLen) {
      throw new Error(`Input length mismatch: expected ${expectedLen}, got Q=${query.length}, K=${key.length}, V=${value.length}`);
    }

    if (N === 0) {
      throw new Error('Sequence length cannot be zero');
    }

    // Project Q, K, V: [N × dim] @ [dim × dim] → [N × dim]
    const Q = matmul(query, this.wQuery, this.dimension);
    const K = matmul(key, this.wKey, this.dimension);
    const V = matmul(value, this.wValue, this.dimension);

    // Check for numerical issues
    if (hasNaNOrInf(Q) || hasNaNOrInf(K) || hasNaNOrInf(V)) {
      throw new Error('NaN or Inf detected after projection');
    }

    // Output buffer: [N × dim]
    const output = new Float32Array(N * this.dimension);

    // Process each head independently
    for (let h = 0; h < this.numHeads; h++) {
      const headOffset = h * this.headDim;

      // For each query position
      for (let i = 0; i < N; i++) {
        // Define sliding window: [windowStart, windowEnd)
        const windowStart = Math.max(0, i - this.halfWindow);
        const windowEnd = Math.min(N, i + this.halfWindow + 1);
        const windowLen = windowEnd - windowStart;

        if (windowLen === 0) {
          continue; // Should not happen with valid window size
        }

        // Compute attention scores for window
        const scores = new Float32Array(windowLen);
        let maxScore = -Infinity;

        for (let j = 0; j < windowLen; j++) {
          const kIdx = windowStart + j;
          let score = 0;

          // Dot product: Q[i, h] · K[kIdx, h]
          for (let d = 0; d < this.headDim; d++) {
            const qVal = Q[i * this.dimension + headOffset + d];
            const kVal = K[kIdx * this.dimension + headOffset + d];
            score += qVal * kVal;
          }

          // Apply scaling
          score *= this.scale;

          // Apply mask if provided (mask is [N × N] or can be broadcasted)
          if (mask) {
            const maskIdx = i * N + kIdx;
            if (maskIdx < mask.length && mask[maskIdx] === false) {
              score = -Infinity;
            }
          }

          scores[j] = score;
          maxScore = Math.max(maxScore, score);
        }

        // Stable softmax: exp(score - maxScore)
        let sumExp = 0;
        const epsilon = 1e-10;

        for (let j = 0; j < windowLen; j++) {
          if (scores[j] === -Infinity) {
            scores[j] = 0; // Masked positions get zero weight
          } else {
            scores[j] = Math.exp(scores[j] - maxScore);
            sumExp += scores[j];
          }
        }

        // Normalize (guard against division by zero)
        if (sumExp < epsilon) {
          // All positions masked or zero scores
          for (let j = 0; j < windowLen; j++) {
            scores[j] = 0;
          }
        } else {
          for (let j = 0; j < windowLen; j++) {
            scores[j] /= sumExp;
          }
        }

        // Weighted sum of values: attention_weights · V
        for (let j = 0; j < windowLen; j++) {
          const kIdx = windowStart + j;
          const weight = scores[j];

          for (let d = 0; d < this.headDim; d++) {
            const vVal = V[kIdx * this.dimension + headOffset + d];
            output[i * this.dimension + headOffset + d] += weight * vVal;
          }
        }
      }
    }

    // Check for numerical issues before output projection
    if (hasNaNOrInf(output)) {
      throw new Error('NaN or Inf detected after attention computation');
    }

    // Output projection: [N × dim] @ [dim × dim] → [N × dim]
    const result = matmul(output, this.wOutput, this.dimension);

    // Final validation
    if (hasNaNOrInf(result)) {
      throw new Error('NaN or Inf detected in output');
    }

    return result;
  }

  getParameterCount(): number {
    // 4 weight matrices: Q, K, V, O, each [dim × dim]
    return 4 * this.dimension * this.dimension;
  }
}
