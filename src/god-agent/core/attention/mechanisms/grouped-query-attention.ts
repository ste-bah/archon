/**
 * Real Grouped-Query Attention Implementation
 *
 * Reference: Ainslie et al. 2023 "GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints"
 * https://arxiv.org/abs/2305.13245
 *
 * Key insight: GQA is a generalization between MHA and MQA.
 * - MHA: numKVHeads = numHeads (each Q head has its own K,V)
 * - MQA: numKVHeads = 1 (all Q heads share single K,V)
 * - GQA: numKVHeads = G where 1 < G < numHeads (groups of Q heads share K,V)
 *
 * Trade-off: More KV heads = better quality, fewer KV heads = less memory/compute
 *
 * Memory: KV cache is O(numKVHeads × d × seq) vs O(numHeads × d × seq) for MHA
 *
 * Parameter Count: 2×dim² + 2×numKVHeads×headDim×dim
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
 * Real Grouped-Query Attention Implementation
 *
 * Generalizes between MHA (numKVHeads=numHeads) and MQA (numKVHeads=1).
 * Groups of query heads share common key-value heads.
 *
 * @example
 * ```typescript
 * // Create GQA mechanism with 8 query heads and 2 KV heads
 * // (4 query heads per KV head)
 * const attention = new RealGroupedQueryAttention({
 *   dimension: 768,
 *   numHeads: 8,      // Query heads
 *   numKVHeads: 2,    // KV heads (must divide numHeads)
 *   seed: 42
 * });
 *
 * // Single vector attention
 * const query = new Float32Array(768);
 * const output = attention.forward(query, query, query);
 *
 * // Multi-sequence attention
 * const seqLen = 1024;
 * const query = new Float32Array(seqLen * 768);
 * const output = attention.forward(query, query, query, undefined, seqLen);
 * ```
 */
export class RealGroupedQueryAttention implements IAttentionMechanism {
  readonly name = 'grouped-query';

  private readonly dimension: number;
  private readonly numHeads: number;      // Query heads
  private readonly numKVHeads: number;    // Key-Value heads
  private readonly headsPerGroup: number; // Query heads per KV head
  private readonly headDim: number;
  private readonly scale: number;

  // Query: [dim × dim] - full multi-head projection
  private readonly wQuery: Float32Array;
  // Key: [dim × (numKVHeads × headDim)] - grouped head projection
  private readonly wKey: Float32Array;
  // Value: [dim × (numKVHeads × headDim)] - grouped head projection
  private readonly wValue: Float32Array;
  // Output: [dim × dim] - full multi-head projection
  private readonly wOutput: Float32Array;

  private readonly rng?: SeededRandom;

  /**
   * Initialize Grouped-Query Attention mechanism
   *
   * @param config Configuration options
   * @param config.dimension Model dimension (default: VECTOR_DIM=1536)
   * @param config.numHeads Number of query heads (default: 8)
   * @param config.numKVHeads Number of key-value heads (default: 2)
   * @param config.seed Random seed for deterministic initialization (optional)
   *
   * @throws Error if dimension not divisible by numHeads
   * @throws Error if numHeads not divisible by numKVHeads
   */
  constructor(config?: {
    dimension?: number;
    numHeads?: number;
    numKVHeads?: number;
    seed?: number;
  }) {
    this.dimension = config?.dimension ?? VECTOR_DIM;
    this.numHeads = config?.numHeads ?? 8;
    this.numKVHeads = config?.numKVHeads ?? 2;

    // Validate configuration
    if (this.dimension % this.numHeads !== 0) {
      throw new Error(
        `ANTI-009: Dimension ${this.dimension} must be divisible by numHeads ${this.numHeads}`
      );
    }

    if (this.numHeads % this.numKVHeads !== 0) {
      throw new Error(
        `ANTI-009: numHeads ${this.numHeads} must be divisible by numKVHeads ${this.numKVHeads}`
      );
    }

    this.headDim = this.dimension / this.numHeads;
    this.headsPerGroup = this.numHeads / this.numKVHeads;
    this.scale = 1.0 / Math.sqrt(this.headDim);

    // Initialize seeded RNG if seed provided (for testing)
    if (config?.seed !== undefined) {
      this.rng = new SeededRandom(config.seed);
    }

    // Initialize weight matrices
    // Q: full multi-head [dim × dim]
    this.wQuery = xavierUniform(this.dimension, this.dimension, this.rng);
    // K: grouped heads [dim × (numKVHeads × headDim)]
    this.wKey = xavierUniform(this.dimension, this.numKVHeads * this.headDim, this.rng);
    // V: grouped heads [dim × (numKVHeads × headDim)]
    this.wValue = xavierUniform(this.dimension, this.numKVHeads * this.headDim, this.rng);
    // O: full multi-head [dim × dim]
    this.wOutput = xavierUniform(this.dimension, this.dimension, this.rng);
  }

  /**
   * Forward pass: Grouped-Query Attention
   *
   * Algorithm:
   * 1. Project Q through full multi-head weights → [seq × dim]
   * 2. Project K, V through grouped-head weights → [seq × (numKVHeads × headDim)]
   * 3. For each query head:
   *    - Determine which KV head group it belongs to
   *    - Compute attention scores: Q_h × K_g^T (using group's K)
   *    - Apply softmax (with optional mask)
   *    - Weighted sum with V_g (using group's V)
   * 4. Concatenate heads and project output
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

    // Step 1: Project Q (full multi-head)
    const qProjected = matmul(query, this.wQuery, this.dimension);

    // Step 2: Project K, V (grouped heads)
    const kvDim = this.numKVHeads * this.headDim;
    const kProjected = this.projectGroupedHeads(key, this.wKey, actualSeqLen, kvDim);
    const vProjected = this.projectGroupedHeads(value, this.wValue, actualSeqLen, kvDim);

    // Step 3: Multi-head attention with grouped K,V
    const headOutputs: Float32Array[] = [];

    for (let h = 0; h < this.numHeads; h++) {
      // Determine which KV head group this query head belongs to
      const kvGroup = Math.floor(h / this.headsPerGroup);

      const headOutput = this.computeHeadAttention(
        qProjected,
        kProjected,
        vProjected,
        h,
        kvGroup,
        actualSeqLen,
        mask
      );
      headOutputs.push(headOutput);
    }

    // Step 4: Concatenate heads
    const concatenated = this.concatenateHeads(headOutputs, actualSeqLen);

    // Step 5: Output projection
    const output = matmul(concatenated, this.wOutput, this.dimension);

    // Validate output
    if (hasNaNOrInf(output)) {
      throw new Error('ANTI-009: Grouped-Query attention forward pass produced NaN or Inf values');
    }

    return output;
  }

  /**
   * Project input through grouped-head weight matrix
   *
   * @param input Input [seq × dim]
   * @param weights Weight matrix [dim × kvDim]
   * @param seqLen Sequence length
   * @param kvDim Output dimension (numKVHeads × headDim)
   * @returns Projected [seq × kvDim]
   */
  private projectGroupedHeads(
    input: Float32Array,
    weights: Float32Array,
    seqLen: number,
    kvDim: number
  ): Float32Array {
    const output = new Float32Array(seqLen * kvDim);

    for (let i = 0; i < seqLen; i++) {
      const inputOffset = i * this.dimension;
      const outputOffset = i * kvDim;

      // Matrix-vector multiply: input[dim] × weights[dim×kvDim] → output[kvDim]
      for (let j = 0; j < kvDim; j++) {
        let sum = 0;
        for (let k = 0; k < this.dimension; k++) {
          sum += input[inputOffset + k] * weights[k * kvDim + j];
        }
        output[outputOffset + j] = sum;
      }
    }

    return output;
  }

  /**
   * Compute attention for a single query head with grouped K,V
   *
   * @param Q Full projected queries [seq × dim]
   * @param K Grouped projected keys [seq × (numKVHeads × headDim)]
   * @param V Grouped projected values [seq × (numKVHeads × headDim)]
   * @param qHead Query head index
   * @param kvGroup KV group index (0 to numKVHeads-1)
   * @param seqLen Sequence length
   * @param mask Optional attention mask
   * @returns Head output [seq × headDim]
   */
  private computeHeadAttention(
    Q: Float32Array,
    K: Float32Array,
    V: Float32Array,
    qHead: number,
    kvGroup: number,
    seqLen: number,
    mask?: boolean[]
  ): Float32Array {
    const output = new Float32Array(seqLen * this.headDim);
    const kvDim = this.numKVHeads * this.headDim;

    for (let i = 0; i < seqLen; i++) {
      // Extract query for this head at position i
      const qOffset = i * this.dimension + qHead * this.headDim;

      // Compute attention scores against keys from the group
      const scores = new Float32Array(seqLen);
      let maxScore = -Infinity;

      for (let j = 0; j < seqLen; j++) {
        // Check mask if provided
        if (mask && !mask[i * seqLen + j]) {
          scores[j] = -Infinity;
          continue;
        }

        // Compute dot product: Q_h[i] · K_g[j]
        let score = 0;
        const kOffset = j * kvDim + kvGroup * this.headDim;

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

      // Normalize and compute weighted sum using group's V
      const outOffset = i * this.headDim;

      for (let d = 0; d < this.headDim; d++) {
        let weightedSum = 0;

        for (let j = 0; j < seqLen; j++) {
          const attnWeight = sumExp > 0 ? expScores[j] / sumExp : 0;
          const vOffset = j * kvDim + kvGroup * this.headDim;
          weightedSum += attnWeight * V[vOffset + d];
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
   * GQA parameters:
   * - Q: dim × dim
   * - K: dim × (numKVHeads × headDim)
   * - V: dim × (numKVHeads × headDim)
   * - O: dim × dim
   *
   * Total: 2×dim² + 2×dim×numKVHeads×headDim
   *
   * @returns Parameter count
   */
  getParameterCount(): number {
    return 2 * this.dimension * this.dimension +
      2 * this.dimension * this.numKVHeads * this.headDim;
  }
}
