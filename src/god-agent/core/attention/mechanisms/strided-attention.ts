/**
 * Real Strided Attention Implementation
 *
 * Reference: Sparse Transformer (Child et al. 2019)
 *
 * Combines local window attention with strided global attention.
 * Each position attends to nearby positions AND every stride-th position.
 *
 * Use cases:
 * - Long sequence processing
 * - Sparse Transformer architectures
 * - Image generation (when sequences represent pixels)
 *
 * Complexity: O(N × (W + N/S)) where W is window, S is stride
 * Parameter Count: 4 × dim²
 *
 * ANTI-009: REAL implementation
 */

import { IAttentionMechanism } from '../attention-types.js';
import { SeededRandom, xavierUniform, matmul, hasNaNOrInf } from '../utils/index.js';

export class RealStridedAttention implements IAttentionMechanism {
  readonly name = 'strided';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly headDim: number;
  private readonly scale: number;
  private readonly stride: number;
  private readonly windowSize: number;

  // Weight matrices (all Float32Array for performance)
  private readonly wQuery: Float32Array;
  private readonly wKey: Float32Array;
  private readonly wValue: Float32Array;
  private readonly wOutput: Float32Array;

  constructor(config?: {
    dimension?: number;
    numHeads?: number;
    stride?: number;
    windowSize?: number;
    seed?: number;
  }) {
    // Validate and set configuration
    this.dimension = config?.dimension ?? 64;
    this.numHeads = config?.numHeads ?? 1;
    this.stride = config?.stride ?? 8;
    this.windowSize = config?.windowSize ?? 8;

    // Validate parameters
    if (this.dimension <= 0 || !Number.isInteger(this.dimension)) {
      throw new Error(`Invalid dimension: ${this.dimension}`);
    }
    if (this.numHeads <= 0 || !Number.isInteger(this.numHeads)) {
      throw new Error(`Invalid numHeads: ${this.numHeads}`);
    }
    if (this.dimension % this.numHeads !== 0) {
      throw new Error(`dimension (${this.dimension}) must be divisible by numHeads (${this.numHeads})`);
    }
    if (this.stride <= 0 || !Number.isInteger(this.stride)) {
      throw new Error(`Invalid stride: ${this.stride}`);
    }
    if (this.windowSize <= 0 || !Number.isInteger(this.windowSize)) {
      throw new Error(`Invalid windowSize: ${this.windowSize}`);
    }

    this.headDim = this.dimension / this.numHeads;
    this.scale = 1.0 / Math.sqrt(this.headDim);

    // Initialize weight matrices with Xavier uniform
    const seed = config?.seed ?? Date.now();
    const rng = new SeededRandom(seed);

    this.wQuery = xavierUniform(this.dimension, this.dimension, rng);
    this.wKey = xavierUniform(this.dimension, this.dimension, rng);
    this.wValue = xavierUniform(this.dimension, this.dimension, rng);
    this.wOutput = xavierUniform(this.dimension, this.dimension, rng);
  }

  forward(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    mask?: boolean[],
    seqLen?: number
  ): Float32Array {
    // Infer sequence length
    const N = seqLen ?? Math.floor(query.length / this.dimension);

    // Validate inputs
    if (query.length !== N * this.dimension) {
      throw new Error(`Query length ${query.length} doesn't match N=${N} × dim=${this.dimension}`);
    }
    if (key.length !== N * this.dimension) {
      throw new Error(`Key length ${key.length} doesn't match N=${N} × dim=${this.dimension}`);
    }
    if (value.length !== N * this.dimension) {
      throw new Error(`Value length ${value.length} doesn't match N=${N} × dim=${this.dimension}`);
    }
    if (hasNaNOrInf(query)) {
      throw new Error('Query contains NaN or Infinity');
    }
    if (hasNaNOrInf(key)) {
      throw new Error('Key contains NaN or Infinity');
    }
    if (hasNaNOrInf(value)) {
      throw new Error('Value contains NaN or Infinity');
    }

    // Project inputs
    const Q = matmul(query, this.wQuery, this.dimension);
    const K = matmul(key, this.wKey, this.dimension);
    const V = matmul(value, this.wValue, this.dimension);

    // Pre-allocate output buffer
    const attended = new Float32Array(N * this.dimension);

    // Process each head
    for (let h = 0; h < this.numHeads; h++) {
      const headOffset = h * this.headDim;

      // Process each query position
      for (let i = 0; i < N; i++) {
        // Determine attended positions for position i
        const attendedPositions = this.getAttendedPositions(i, N);
        const numAttended = attendedPositions.length;

        if (numAttended === 0) {
          // If no positions to attend (shouldn't happen), output zeros
          continue;
        }

        // Allocate buffers for this position
        const scores = new Float32Array(numAttended);

        // Compute attention scores: Q[i] · K[j]ᵀ / √d for attended positions
        for (let idx = 0; idx < numAttended; idx++) {
          const j = attendedPositions[idx];
          let dotProduct = 0.0;

          for (let d = 0; d < this.headDim; d++) {
            const qIdx = i * this.dimension + headOffset + d;
            const kIdx = j * this.dimension + headOffset + d;
            dotProduct += Q[qIdx] * K[kIdx];
          }

          scores[idx] = dotProduct * this.scale;

          // Apply mask if provided
          if (mask && mask[i * N + j] === false) {
            scores[idx] = -Infinity;
          }
        }

        // Stable softmax
        let maxScore = -Infinity;
        for (let idx = 0; idx < numAttended; idx++) {
          if (scores[idx] > maxScore && scores[idx] !== -Infinity) {
            maxScore = scores[idx];
          }
        }

        // Handle case where all scores are -Infinity
        if (!isFinite(maxScore)) {
          maxScore = 0;
        }

        // Compute exp and sum
        const expScores = new Float32Array(numAttended);
        let sumExp = 0.0;
        for (let idx = 0; idx < numAttended; idx++) {
          if (scores[idx] === -Infinity) {
            expScores[idx] = 0.0;
          } else {
            expScores[idx] = Math.exp(scores[idx] - maxScore);
            sumExp += expScores[idx];
          }
        }

        // Normalize (with epsilon guard)
        const epsilon = 1e-9;
        sumExp = Math.max(sumExp, epsilon);

        for (let idx = 0; idx < numAttended; idx++) {
          expScores[idx] /= sumExp;
        }

        // Weighted sum of values
        for (let d = 0; d < this.headDim; d++) {
          let weighted = 0.0;

          for (let idx = 0; idx < numAttended; idx++) {
            const j = attendedPositions[idx];
            const vIdx = j * this.dimension + headOffset + d;
            weighted += expScores[idx] * V[vIdx];
          }

          const outIdx = i * this.dimension + headOffset + d;
          attended[outIdx] = weighted;
        }
      }
    }

    // Output projection
    const output = matmul(attended, this.wOutput, this.dimension);

    // Validate output
    if (hasNaNOrInf(output)) {
      throw new Error('Output contains NaN or Infinity');
    }

    return output;
  }

  /**
   * Determine which positions position i should attend to
   *
   * Combines:
   * - Local window: positions within [i - windowSize/2, i + windowSize/2]
   * - Strided positions: all j where j % stride == 0
   *
   * @param i Current position
   * @param N Total sequence length
   * @returns Sorted array of unique attended positions
   */
  private getAttendedPositions(i: number, N: number): number[] {
    const positions = new Set<number>();

    // Add local window positions
    const halfWindow = Math.floor(this.windowSize / 2);
    const windowStart = Math.max(0, i - halfWindow);
    const windowEnd = Math.min(N - 1, i + halfWindow);

    for (let j = windowStart; j <= windowEnd; j++) {
      positions.add(j);
    }

    // Add strided positions
    for (let j = 0; j < N; j += this.stride) {
      positions.add(j);
    }

    // Convert to sorted array
    return Array.from(positions).sort((a, b) => a - b);
  }

  getParameterCount(): number {
    // 4 weight matrices: Q, K, V, O
    return 4 * this.dimension * this.dimension;
  }
}
