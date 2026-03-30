/**
 * Real Multi-Query Attention Implementation
 *
 * Reference: Shazeer 2019 "Fast Transformer Decoding: One Write-Head is All You Need"
 * https://arxiv.org/abs/1911.02150
 *
 * Key Innovation: SHARED K,V projections across ALL heads
 * - Standard MHA: numHeads × (Wq, Wk, Wv) + Wo
 * - Multi-Query: numHeads × Wq + 1 × Wk + 1 × Wv + Wo
 *
 * Benefits:
 * - Reduces KV cache memory by numHeads× during inference
 * - 46% fewer parameters (dim=768, heads=12)
 * - Faster decoding with minimal quality loss
 *
 * Formula:
 * MQA(Q, K, V) = Concat(head_1, ..., head_h) × Wo
 * where head_i = Attention(Q × Wq_i, K × Wk_shared, V × Wv_shared)
 *
 * Parameter Count: (numHeads + 2) × dim × headDim + dim²
 *
 * ANTI-009: REAL implementation with proper shared projections
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
 * Real Multi-Query Attention Implementation
 *
 * Uses single shared K,V head across all query heads for memory efficiency.
 *
 * @example
 * ```typescript
 * // Create MQA mechanism
 * const attention = new RealMultiQueryAttention({
 *   dimension: 768,
 *   numHeads: 8,
 *   seed: 42  // Optional: deterministic init for testing
 * });
 *
 * // Single vector attention
 * const query = new Float32Array(768);
 * const output = attention.forward(query, query, query);
 *
 * // Multi-sequence attention (memory efficient!)
 * const seqLen = 1024;
 * const query = new Float32Array(seqLen * 768);
 * const output = attention.forward(query, query, query, undefined, seqLen);
 * ```
 */
export class RealMultiQueryAttention implements IAttentionMechanism {
  readonly name = 'multi-query';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly headDim: number;
  private readonly scale: number;

  // Per-head query projections [numHeads][dim × headDim]
  private readonly wQueries: Float32Array[];
  // SHARED key projection [dim × headDim] - single head
  private readonly wKey: Float32Array;
  // SHARED value projection [dim × headDim] - single head
  private readonly wValue: Float32Array;
  // Output: [dim × dim] - full multi-head projection
  private readonly wOutput: Float32Array;

  private readonly rng?: SeededRandom;

  /**
   * Initialize Multi-Query Attention mechanism
   *
   * @param config Configuration options
   * @param config.dimension Model dimension (default: VECTOR_DIM=1536)
   * @param config.numHeads Number of query heads (default: 8)
   * @param config.seed Random seed for deterministic initialization (optional)
   *
   * @throws Error if dimension not divisible by numHeads
   */
  constructor(config?: {
    dimension?: number;
    numHeads?: number;
    seed?: number;
  }) {
    this.dimension = config?.dimension ?? VECTOR_DIM;
    this.numHeads = config?.numHeads ?? 8;

    // Validate configuration
    if (this.dimension % this.numHeads !== 0) {
      throw new Error(
        `ANTI-009: Dimension ${this.dimension} must be divisible by numHeads ${this.numHeads}`
      );
    }

    this.headDim = this.dimension / this.numHeads;
    this.scale = 1.0 / Math.sqrt(this.headDim);

    // Initialize seeded RNG if seed provided (for testing)
    if (config?.seed !== undefined) {
      this.rng = new SeededRandom(config.seed);
    }

    // Initialize weight matrices
    // Q: per-head projections [numHeads][dim × headDim]
    this.wQueries = [];
    for (let h = 0; h < this.numHeads; h++) {
      this.wQueries.push(xavierUniform(this.dimension, this.headDim, this.rng));
    }
    // K: SHARED single head [dim × headDim]
    this.wKey = xavierUniform(this.dimension, this.headDim, this.rng);
    // V: SHARED single head [dim × headDim]
    this.wValue = xavierUniform(this.dimension, this.headDim, this.rng);
    // O: full multi-head [dim × dim]
    this.wOutput = xavierUniform(this.dimension, this.dimension, this.rng);
  }

  /**
   * Forward pass: Multi-Query Attention
   *
   * Algorithm:
   * 1. Project K, V through SHARED single-head weights → [seq × headDim]
   * 2. For each query head:
   *    - Project Q through per-head weights → [seq × headDim]
   *    - Compute attention scores: Q_h × K^T (shared K)
   *    - Apply softmax (with optional mask)
   *    - Weighted sum with V (shared V)
   * 3. Concatenate heads and project output
   *
   * @param query Query vectors [seq_len × dimension]
   * @param key Key vectors [seq_len × dimension]
   * @param value Value vectors [seq_len × dimension]
   * @param mask Attention mask [seq_len × seq_len] (optional)
   * @param seqLen Sequence length (optional)
   * @returns Output vectors [seq_len × dimension]
   *
   * @throws Error if dimensions incompatible or contain NaN
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

    // Validate query length
    if (query.length !== actualSeqLen * this.dimension) {
      throw new Error(
        `ANTI-009: Query length ${query.length} incompatible with seqLen=${actualSeqLen}, dim=${this.dimension}`
      );
    }

    // Validate key/value dimensions match query
    if (query.length !== key.length || query.length !== value.length) {
      throw new Error(
        `ANTI-009: Dimension mismatch: Q=${query.length}, K=${key.length}, V=${value.length}`
      );
    }

    // Step 1: Project K, V ONCE (shared across all heads - MQA core!)
    const kProjected = this.projectSingleHead(key, this.wKey, actualSeqLen);
    const vProjected = this.projectSingleHead(value, this.wValue, actualSeqLen);

    // Step 2: Multi-head attention with per-head Q, shared K,V
    const headOutputs: Float32Array[] = [];

    for (let h = 0; h < this.numHeads; h++) {
      // Project Q for this head
      const qProjected = this.projectSingleHead(query, this.wQueries[h], actualSeqLen);

      // Compute attention with shared K,V
      const headOutput = this.computeHeadAttention(
        qProjected,
        kProjected,
        vProjected,
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
      throw new Error('ANTI-009: Multi-Query attention forward pass produced NaN or Inf values');
    }

    return output;
  }

  /**
   * Project input through single-head weight matrix
   *
   * @param input Input [seq × dim]
   * @param weights Weight matrix [dim × headDim]
   * @param seqLen Sequence length
   * @returns Projected [seq × headDim]
   */
  private projectSingleHead(
    input: Float32Array,
    weights: Float32Array,
    seqLen: number
  ): Float32Array {
    const output = new Float32Array(seqLen * this.headDim);

    for (let i = 0; i < seqLen; i++) {
      const inputOffset = i * this.dimension;
      const outputOffset = i * this.headDim;

      // Matrix-vector multiply: input[dim] × weights[dim×headDim] → output[headDim]
      for (let j = 0; j < this.headDim; j++) {
        let sum = 0;
        for (let k = 0; k < this.dimension; k++) {
          sum += input[inputOffset + k] * weights[k * this.headDim + j];
        }
        output[outputOffset + j] = sum;
      }
    }

    return output;
  }

  /**
   * Compute attention for a single query head with shared K,V
   *
   * @param Q Projected queries for this head [seq × headDim]
   * @param K Shared projected keys [seq × headDim]
   * @param V Shared projected values [seq × headDim]
   * @param seqLen Sequence length
   * @param mask Optional attention mask
   * @returns Head output [seq × headDim]
   */
  private computeHeadAttention(
    Q: Float32Array,
    K: Float32Array,
    V: Float32Array,
    seqLen: number,
    mask?: boolean[]
  ): Float32Array {
    const output = new Float32Array(seqLen * this.headDim);

    for (let i = 0; i < seqLen; i++) {
      // Query for position i
      const qOffset = i * this.headDim;

      // Compute attention scores against all keys
      const scores = new Float32Array(seqLen);
      let maxScore = -Infinity;

      for (let j = 0; j < seqLen; j++) {
        // Check mask if provided
        if (mask && !mask[i * seqLen + j]) {
          scores[j] = -Infinity;
          continue;
        }

        // Compute dot product: Q[i] · K[j]
        let score = 0;
        const kOffset = j * this.headDim;

        for (let d = 0; d < this.headDim; d++) {
          score += Q[qOffset + d] * K[kOffset + d];
        }

        scores[j] = score * this.scale;
        if (scores[j] > maxScore) {
          maxScore = scores[j];
        }
      }

      // Softmax with numerical stability
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

      // Normalize and compute weighted sum
      const outOffset = i * this.headDim;

      for (let d = 0; d < this.headDim; d++) {
        let weightedSum = 0;

        for (let j = 0; j < seqLen; j++) {
          const attnWeight = sumExp > 0 ? expScores[j] / sumExp : 0;
          weightedSum += attnWeight * V[j * this.headDim + d];
        }

        output[outOffset + d] = weightedSum;
      }
    }

    return output;
  }

  /**
   * Concatenate multiple head outputs
   *
   * @param headOutputs Array of head outputs [seq × headDim]
   * @param seqLen Sequence length
   * @returns Concatenated output [seq × dim]
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
   * MQA has fewer parameters than standard attention:
   * - Q: numHeads × (dim × headDim) per-head projections
   * - K: dim × headDim (SHARED single head)
   * - V: dim × headDim (SHARED single head)
   * - O: dim × dim
   *
   * Total: (numHeads + 2) × dim × headDim + dim²
   *
   * For dim=768, numHeads=12, headDim=64:
   * - Standard MHA: 4 × 768² = 2,359,296
   * - MQA: (12+2) × 768 × 64 + 768² = 1,277,952 (46% fewer)
   *
   * @returns Parameter count
   */
  getParameterCount(): number {
    const queryParams = this.numHeads * this.dimension * this.headDim;
    const keyParams = this.dimension * this.headDim;
    const valueParams = this.dimension * this.headDim;
    const outputParams = this.dimension * this.dimension;

    return queryParams + keyParams + valueParams + outputParams;
  }
}
