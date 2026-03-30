/**
 * Real Local Attention Implementation
 *
 * Reference: Longformer (Beltagy et al. 2020) "Longformer: The Long-Document Transformer"
 * https://arxiv.org/abs/2004.05150
 *
 * Key insight: Local attention restricts each position to attend only to
 * a fixed-size window of neighboring positions. This reduces complexity
 * from O(N²) to O(N × W) where W is the window size.
 *
 * Local Attention formula:
 *   LocalAttn(Q, K, V)[i] = softmax(Q[i] · K[i-w:i+w]ᵀ / √d) · V[i-w:i+w]
 *
 * Where w is the half-window size and each position only attends to
 * positions within distance w (both left and right).
 *
 * Use cases:
 * - Long document processing
 * - Efficient sequence modeling
 * - When local context is most important
 * - Combined with global attention (Longformer pattern)
 *
 * Complexity: O(N × W) where W is window size
 * Parameter Count: 4 × dim²
 *
 * ANTI-009: This is a REAL implementation, not a placeholder.
 */

import { IAttentionMechanism } from '../attention-types.js';
import { VECTOR_DIM } from '../../validation/constants.js';
import {
  SeededRandom,
  xavierUniform,
  matmul,
  hasNaNOrInf,
} from '../utils/index.js';

/**
 * Real Local Attention Implementation
 *
 * Implements windowed attention where each position attends only to
 * its local neighborhood within a fixed window size.
 *
 * @example
 * ```typescript
 * // Create Local attention with window size 128
 * const attention = new RealLocalAttention({
 *   dimension: 768,
 *   numHeads: 12,
 *   windowSize: 128,  // Each position attends to 128 positions total
 *   seed: 42
 * });
 *
 * // Process long sequence efficiently
 * const seqLen = 4096;
 * const query = new Float32Array(seqLen * 768);
 * const output = attention.forward(query, query, query, undefined, seqLen);
 * // Complexity: O(4096 × 128) instead of O(4096²)
 * ```
 */
export class RealLocalAttention implements IAttentionMechanism {
  readonly name = 'local';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly headDim: number;
  private readonly scale: number;
  private readonly windowSize: number;  // Total window size (positions attended to)
  private readonly halfWindow: number;  // Half window for left/right

  // Weight matrices [dim × dim]
  private readonly wQuery: Float32Array;
  private readonly wKey: Float32Array;
  private readonly wValue: Float32Array;
  private readonly wOutput: Float32Array;

  private readonly rng?: SeededRandom;

  /**
   * Initialize Local attention mechanism
   *
   * @param config Configuration options
   * @param config.dimension Model dimension (default: VECTOR_DIM=1536)
   * @param config.numHeads Number of attention heads (default: 12)
   * @param config.windowSize Total window size (default: 64)
   * @param config.seed Random seed for initialization (optional)
   *
   * @throws Error if dimension not divisible by numHeads
   */
  constructor(config?: {
    dimension?: number;
    numHeads?: number;
    windowSize?: number;
    seed?: number;
  }) {
    this.dimension = config?.dimension ?? VECTOR_DIM;
    this.numHeads = config?.numHeads ?? 12;
    this.windowSize = config?.windowSize ?? 64;

    // Validate configuration
    if (this.dimension % this.numHeads !== 0) {
      throw new Error(
        `ANTI-009: Dimension ${this.dimension} must be divisible by numHeads ${this.numHeads}`
      );
    }

    if (this.windowSize < 1) {
      throw new Error(
        `ANTI-009: Window size must be at least 1, got ${this.windowSize}`
      );
    }

    this.headDim = this.dimension / this.numHeads;
    this.scale = 1.0 / Math.sqrt(this.headDim);
    this.halfWindow = Math.floor(this.windowSize / 2);

    // Initialize seeded RNG if seed provided
    if (config?.seed !== undefined) {
      this.rng = new SeededRandom(config.seed);
    }

    // Initialize weight matrices with Xavier/Glorot uniform
    this.wQuery = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wKey = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wValue = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wOutput = xavierUniform(this.dimension, this.dimension, this.rng);
  }

  /**
   * Forward pass: Local (windowed) attention
   *
   * Algorithm:
   * 1. Project Q, K, V through linear transformations
   * 2. For each position, compute attention only within local window
   * 3. Window boundaries: [max(0, i-halfWindow), min(seqLen, i+halfWindow+1)]
   * 4. Apply softmax over window positions
   * 5. Weighted sum of values in window
   * 6. Concatenate heads and project output
   *
   * @param query Query vectors [seq_len × dimension]
   * @param key Key vectors [seq_len × dimension]
   * @param value Value vectors [seq_len × dimension]
   * @param mask Optional attention mask
   * @param seqLen Sequence length (optional, inferred from query)
   * @returns Output vectors [seq_len × dimension]
   */
  forward(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    mask?: boolean[],
    seqLen?: number
  ): Float32Array {
    // Step 0: Infer and validate sequence length
    const actualSeqLen = seqLen ?? Math.floor(query.length / this.dimension);

    // Validate dimensions
    if (query.length !== actualSeqLen * this.dimension) {
      throw new Error(
        `ANTI-009: Query length ${query.length} incompatible with seqLen=${actualSeqLen}, dim=${this.dimension}`
      );
    }

    if (query.length !== key.length || query.length !== value.length) {
      throw new Error(
        `ANTI-009: Dimension mismatch: Q=${query.length}, K=${key.length}, V=${value.length}`
      );
    }

    // Step 1: Project Q, K, V
    const qProjected = matmul(query, this.wQuery, this.dimension);
    const kProjected = matmul(key, this.wKey, this.dimension);
    const vProjected = matmul(value, this.wValue, this.dimension);

    // Step 2: Multi-head local attention
    const headOutputs: Float32Array[] = [];

    for (let h = 0; h < this.numHeads; h++) {
      const headOutput = this.computeHeadLocalAttention(
        qProjected,
        kProjected,
        vProjected,
        h,
        actualSeqLen,
        mask
      );
      headOutputs.push(headOutput);
    }

    // Step 3: Concatenate heads
    const concatenated = this.concatenateHeads(headOutputs, actualSeqLen);

    // Step 4: Output projection
    const output = matmul(concatenated, this.wOutput, this.dimension);

    // Validate output
    if (hasNaNOrInf(output)) {
      throw new Error('ANTI-009: Local attention forward pass produced NaN or Inf values');
    }

    return output;
  }

  /**
   * Compute local attention for a single head
   *
   * Each position i attends only to positions in window:
   *   [max(0, i - halfWindow), min(seqLen-1, i + halfWindow)]
   *
   * This creates a banded attention pattern instead of full N×N.
   */
  private computeHeadLocalAttention(
    Q: Float32Array,
    K: Float32Array,
    V: Float32Array,
    head: number,
    seqLen: number,
    mask?: boolean[]
  ): Float32Array {
    const output = new Float32Array(seqLen * this.headDim);

    // For each query position
    for (let i = 0; i < seqLen; i++) {
      const qOffset = i * this.dimension + head * this.headDim;
      const outOffset = i * this.headDim;

      // Compute window boundaries
      const windowStart = Math.max(0, i - this.halfWindow);
      const windowEnd = Math.min(seqLen, i + this.halfWindow + 1);
      const windowLen = windowEnd - windowStart;

      // Compute attention scores only within window
      const scores = new Float32Array(windowLen);
      let maxScore = -Infinity;

      for (let wi = 0; wi < windowLen; wi++) {
        const j = windowStart + wi;

        // Check mask
        if (mask && !mask[j]) {
          scores[wi] = -Infinity;
          continue;
        }

        const kOffset = j * this.dimension + head * this.headDim;

        // Q·K dot product with scaling
        let score = 0;
        for (let d = 0; d < this.headDim; d++) {
          score += Q[qOffset + d] * K[kOffset + d];
        }
        scores[wi] = score * this.scale;
        if (scores[wi] > maxScore) maxScore = scores[wi];
      }

      // Stable softmax over window
      let sumExp = 0;
      const expScores = new Float32Array(windowLen);

      for (let wi = 0; wi < windowLen; wi++) {
        if (scores[wi] === -Infinity) {
          expScores[wi] = 0;
        } else {
          expScores[wi] = Math.exp(scores[wi] - maxScore);
          sumExp += expScores[wi];
        }
      }

      // Weighted sum of values within window
      for (let d = 0; d < this.headDim; d++) {
        let weightedSum = 0;
        for (let wi = 0; wi < windowLen; wi++) {
          const j = windowStart + wi;
          if (mask && !mask[j]) continue;

          const vOffset = j * this.dimension + head * this.headDim;
          const attnWeight = sumExp > 0 ? expScores[wi] / sumExp : 0;
          weightedSum += attnWeight * V[vOffset + d];
        }
        output[outOffset + d] = weightedSum;
      }
    }

    return output;
  }

  /**
   * Concatenate multiple head outputs
   */
  private concatenateHeads(
    headOutputs: Float32Array[],
    seqLen: number
  ): Float32Array {
    const concatenated = new Float32Array(seqLen * this.dimension);

    for (let i = 0; i < seqLen; i++) {
      for (let h = 0; h < this.numHeads; h++) {
        const headOutput = headOutputs[h];
        const srcOffset = i * this.headDim;
        const dstOffset = i * this.dimension + h * this.headDim;

        for (let k = 0; k < this.headDim; k++) {
          concatenated[dstOffset + k] = headOutput[srcOffset + k];
        }
      }
    }

    return concatenated;
  }

  /**
   * Get the configured window size
   */
  getWindowSize(): number {
    return this.windowSize;
  }

  /**
   * Get total parameter count
   *
   * Local Attention: 4 × dim² (same as standard MHA)
   */
  getParameterCount(): number {
    return 4 * this.dimension * this.dimension;
  }
}
