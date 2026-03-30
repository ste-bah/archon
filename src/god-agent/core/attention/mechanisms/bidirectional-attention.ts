/**
 * Real Bidirectional Attention Implementation
 *
 * Reference: Devlin et al. 2019 "BERT: Pre-training of Deep Bidirectional Transformers"
 * https://arxiv.org/abs/1810.04805
 *
 * Key insight: Bidirectional attention allows each position to attend to
 * ALL other positions in the sequence (both left and right context).
 * This is the standard self-attention used in encoder models like BERT.
 *
 * Bidirectional Attention formula:
 *   BiAttn(Q, K, V) = softmax(Q·Kᵀ / √d) · V
 *
 * Unlike causal attention, there is no mask preventing attention to future
 * positions. Every position can attend to every other position.
 *
 * Use cases:
 * - BERT-style encoders
 * - Masked language modeling
 * - Sentence classification
 * - Named entity recognition
 * - Question answering (context encoding)
 *
 * Complexity: O(N²)
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
 * Real Bidirectional Attention Implementation
 *
 * Implements full self-attention where each position can attend to
 * all other positions (both past and future).
 *
 * @example
 * ```typescript
 * // Create Bidirectional attention for BERT-style encoding
 * const attention = new RealBidirectionalAttention({
 *   dimension: 768,
 *   numHeads: 12,
 *   seed: 42
 * });
 *
 * // Process sequence with full context
 * const seqLen = 512;
 * const query = new Float32Array(seqLen * 768);
 * const output = attention.forward(query, query, query, undefined, seqLen);
 * // Every position attends to every other position
 * ```
 */
export class RealBidirectionalAttention implements IAttentionMechanism {
  readonly name = 'bidirectional';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly headDim: number;
  private readonly scale: number;

  // Weight matrices [dim × dim]
  private readonly wQuery: Float32Array;
  private readonly wKey: Float32Array;
  private readonly wValue: Float32Array;
  private readonly wOutput: Float32Array;

  private readonly rng?: SeededRandom;

  /**
   * Initialize Bidirectional attention mechanism
   *
   * @param config Configuration options
   * @param config.dimension Model dimension (default: VECTOR_DIM=1536)
   * @param config.numHeads Number of attention heads (default: 12)
   * @param config.seed Random seed for initialization (optional)
   *
   * @throws Error if dimension not divisible by numHeads
   */
  constructor(config?: {
    dimension?: number;
    numHeads?: number;
    seed?: number;
  }) {
    this.dimension = config?.dimension ?? VECTOR_DIM;
    this.numHeads = config?.numHeads ?? 12;

    // Validate configuration
    if (this.dimension % this.numHeads !== 0) {
      throw new Error(
        `ANTI-009: Dimension ${this.dimension} must be divisible by numHeads ${this.numHeads}`
      );
    }

    this.headDim = this.dimension / this.numHeads;
    this.scale = 1.0 / Math.sqrt(this.headDim);

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
   * Forward pass: Bidirectional (full) attention
   *
   * Algorithm:
   * 1. Project Q, K, V through linear transformations
   * 2. For each head, compute scaled dot-product attention (NO causal mask)
   * 3. Each position attends to all other positions
   * 4. Softmax over all positions
   * 5. Weighted sum of values
   * 6. Concatenate heads and project output
   *
   * @param query Query vectors [seq_len × dimension]
   * @param key Key vectors [seq_len × dimension]
   * @param value Value vectors [seq_len × dimension]
   * @param mask Optional attention mask (e.g., padding mask)
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

    // Step 2: Multi-head bidirectional attention
    const headOutputs: Float32Array[] = [];

    for (let h = 0; h < this.numHeads; h++) {
      const headOutput = this.computeHeadBidirectionalAttention(
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
      throw new Error('ANTI-009: Bidirectional attention forward pass produced NaN or Inf values');
    }

    return output;
  }

  /**
   * Compute bidirectional attention for a single head
   *
   * Unlike causal attention, there is NO positional mask.
   * Every position i attends to every position j (full N×N attention).
   */
  private computeHeadBidirectionalAttention(
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

      // Compute attention scores over ALL positions (bidirectional)
      const scores = new Float32Array(seqLen);
      let maxScore = -Infinity;

      for (let j = 0; j < seqLen; j++) {
        // Only apply padding mask, no causal mask
        if (mask && !mask[j]) {
          scores[j] = -Infinity;
          continue;
        }

        const kOffset = j * this.dimension + head * this.headDim;

        // Q·K dot product with scaling
        let score = 0;
        for (let d = 0; d < this.headDim; d++) {
          score += Q[qOffset + d] * K[kOffset + d];
        }
        scores[j] = score * this.scale;
        if (scores[j] > maxScore) maxScore = scores[j];
      }

      // Stable softmax over ALL positions
      let sumExp = 0;
      const expScores = new Float32Array(seqLen);

      for (let j = 0; j < seqLen; j++) {
        if (scores[j] === -Infinity) {
          expScores[j] = 0;
        } else {
          expScores[j] = Math.exp(scores[j] - maxScore);
          sumExp += expScores[j];
        }
      }

      // Weighted sum of values from ALL positions
      for (let d = 0; d < this.headDim; d++) {
        let weightedSum = 0;
        for (let j = 0; j < seqLen; j++) {
          if (mask && !mask[j]) continue;

          const vOffset = j * this.dimension + head * this.headDim;
          const attnWeight = sumExp > 0 ? expScores[j] / sumExp : 0;
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
   * Get total parameter count
   *
   * Bidirectional Attention: 4 × dim² (same as standard MHA)
   */
  getParameterCount(): number {
    return 4 * this.dimension * this.dimension;
  }
}
