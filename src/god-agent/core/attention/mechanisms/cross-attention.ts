/**
 * Real Cross Attention Implementation
 *
 * Reference: Vaswani et al. 2017 "Attention Is All You Need"
 * https://arxiv.org/abs/1706.03762 (Section 3.2.3)
 *
 * Key insight: Cross attention allows a decoder to attend to encoder outputs,
 * enabling information flow between different sequences or modalities.
 *
 * Cross Attention formula:
 *   CrossAttn(Q_dec, K_enc, V_enc) = softmax(Q_dec · K_enc^T / √d) · V_enc
 *
 * Where:
 * - Q comes from decoder (query sequence)
 * - K, V come from encoder (context sequence)
 *
 * Use cases:
 * - Encoder-decoder models (translation, summarization)
 * - Vision-language models (image captioning)
 * - Multi-modal fusion
 *
 * Complexity: O(N_q × N_kv) where N_q is query length, N_kv is context length
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
 * Real Cross Attention Implementation
 *
 * Implements encoder-decoder cross attention for information flow
 * between different sequences.
 *
 * @example
 * ```typescript
 * // Create Cross attention
 * const attention = new RealCrossAttention({
 *   dimension: 768,
 *   numHeads: 8,
 *   seed: 42
 * });
 *
 * // Decoder attending to encoder outputs
 * const decoderLen = 32;
 * const encoderLen = 128;
 * const query = new Float32Array(decoderLen * 768);   // From decoder
 * const key = new Float32Array(encoderLen * 768);     // From encoder
 * const value = new Float32Array(encoderLen * 768);   // From encoder
 * const output = attention.forward(query, key, value);
 * ```
 */
export class RealCrossAttention implements IAttentionMechanism {
  readonly name = 'cross';

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
   * Initialize Cross attention mechanism
   *
   * @param config Configuration options
   * @param config.dimension Model dimension (default: VECTOR_DIM=1536)
   * @param config.numHeads Number of attention heads (default: 8)
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
    this.numHeads = config?.numHeads ?? 8;

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

    // Initialize weight matrices
    this.wQuery = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wKey = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wValue = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wOutput = xavierUniform(this.dimension, this.dimension, this.rng);
  }

  /**
   * Forward pass: Cross attention
   *
   * Unlike self-attention, Q comes from one sequence while K,V come from another.
   * This allows attending from decoder to encoder outputs.
   *
   * @param query Query vectors [query_len × dimension] - from decoder
   * @param key Key vectors [context_len × dimension] - from encoder
   * @param value Value vectors [context_len × dimension] - from encoder
   * @param mask Optional attention mask for context positions
   * @param seqLen Query sequence length (optional, inferred from query)
   * @returns Output vectors [query_len × dimension]
   */
  forward(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    mask?: boolean[],
    seqLen?: number
  ): Float32Array {
    // Step 0: Infer sequence lengths
    const queryLen = seqLen ?? Math.floor(query.length / this.dimension);
    const contextLen = Math.floor(key.length / this.dimension);

    // Validate dimensions
    if (query.length !== queryLen * this.dimension) {
      throw new Error(
        `ANTI-009: Query length ${query.length} incompatible with queryLen=${queryLen}, dim=${this.dimension}`
      );
    }

    if (key.length !== value.length) {
      throw new Error(
        `ANTI-009: Key/Value length mismatch: K=${key.length}, V=${value.length}`
      );
    }

    if (key.length !== contextLen * this.dimension) {
      throw new Error(
        `ANTI-009: Key length ${key.length} incompatible with contextLen=${contextLen}, dim=${this.dimension}`
      );
    }

    // Step 1: Project Q, K, V
    const qProjected = matmul(query, this.wQuery, this.dimension);
    const kProjected = matmul(key, this.wKey, this.dimension);
    const vProjected = matmul(value, this.wValue, this.dimension);

    // Step 2: Multi-head cross attention
    const headOutputs: Float32Array[] = [];

    for (let h = 0; h < this.numHeads; h++) {
      const headOutput = this.computeHeadCrossAttention(
        qProjected,
        kProjected,
        vProjected,
        h,
        queryLen,
        contextLen,
        mask
      );
      headOutputs.push(headOutput);
    }

    // Step 3: Concatenate heads
    const concatenated = this.concatenateHeads(headOutputs, queryLen);

    // Step 4: Output projection
    const output = matmul(concatenated, this.wOutput, this.dimension);

    // Validate output
    if (hasNaNOrInf(output)) {
      throw new Error('ANTI-009: Cross attention forward pass produced NaN or Inf values');
    }

    return output;
  }

  /**
   * Compute cross attention for a single head
   *
   * Each query position attends to all context (encoder) positions
   */
  private computeHeadCrossAttention(
    Q: Float32Array,
    K: Float32Array,
    V: Float32Array,
    head: number,
    queryLen: number,
    contextLen: number,
    mask?: boolean[]
  ): Float32Array {
    const output = new Float32Array(queryLen * this.headDim);

    // For each query position
    for (let i = 0; i < queryLen; i++) {
      const qOffset = i * this.dimension + head * this.headDim;
      const outOffset = i * this.headDim;

      // Compute attention scores over all context positions
      const scores = new Float32Array(contextLen);
      let maxScore = -Infinity;

      for (let j = 0; j < contextLen; j++) {
        // Check mask (for encoder padding)
        if (mask && !mask[j]) {
          scores[j] = -Infinity;
          continue;
        }

        const kOffset = j * this.dimension + head * this.headDim;

        // Q·K dot product
        let score = 0;
        for (let d = 0; d < this.headDim; d++) {
          score += Q[qOffset + d] * K[kOffset + d];
        }
        scores[j] = score * this.scale;
        if (scores[j] > maxScore) maxScore = scores[j];
      }

      // Softmax with numerical stability
      let sumExp = 0;
      const expScores = new Float32Array(contextLen);

      for (let j = 0; j < contextLen; j++) {
        if (scores[j] === -Infinity) {
          expScores[j] = 0;
        } else {
          expScores[j] = Math.exp(scores[j] - maxScore);
          sumExp += expScores[j];
        }
      }

      // Weighted sum of values
      for (let d = 0; d < this.headDim; d++) {
        let weightedSum = 0;
        for (let j = 0; j < contextLen; j++) {
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
   * Cross Attention: 4 × dim²
   */
  getParameterCount(): number {
    return 4 * this.dimension * this.dimension;
  }
}
