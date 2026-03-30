/**
 * Real Multi-Head Scaled Dot-Product Attention
 *
 * Reference: Vaswani et al. 2017 "Attention is All You Need"
 *
 * Implements true multi-head attention with:
 * - Scaled dot-product: (Q·K^T) / √d_k
 * - Softmax normalization
 * - Xavier uniform weight initialization
 * - Numerical stability (no NaN/Inf)
 * - Attention masking support
 *
 * Complexity: O(N² × d) time, O(N²) space
 * Parameter Count: 4 × dim²
 */

import { IAttentionMechanism } from '../attention-types.js';
import { VECTOR_DIM } from '../../validation/constants.js';
import {
  SeededRandom,
  xavierUniform,
  matmul,
  softmax2D,
  hasNaNOrInf,
} from '../utils/index.js';

/**
 * Real Standard Attention Implementation
 *
 * @example
 * ```typescript
 * // Create attention mechanism
 * const attention = new RealStandardAttention({
 *   dimension: 768,
 *   numHeads: 12,
 *   seed: 42  // Optional: deterministic init for testing
 * });
 *
 * // Single vector attention
 * const query = new Float32Array(768);
 * const output = attention.forward(query, query, query);
 *
 * // Multi-sequence attention
 * const seqLen = 4;
 * const query = new Float32Array(seqLen * 768);
 * const output = attention.forward(query, query, query, undefined, seqLen);
 *
 * // With causal mask
 * import { createCausalMask } from '../utils/index.js';
 * const mask = createCausalMask(seqLen);
 * const output = attention.forward(query, query, query, mask, seqLen);
 * ```
 */
export class RealStandardAttention implements IAttentionMechanism {
  readonly name = 'standard';

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
   * Initialize standard attention mechanism
   *
   * @param config Configuration options
   * @param config.dimension Model dimension (default: VECTOR_DIM=1536)
   * @param config.numHeads Number of attention heads (default: 12)
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
    this.numHeads = config?.numHeads ?? 12;

    // Validate configuration
    if (this.dimension % this.numHeads !== 0) {
      throw new Error(
        `Dimension ${this.dimension} must be divisible by numHeads ${this.numHeads}`
      );
    }

    this.headDim = this.dimension / this.numHeads;
    this.scale = 1.0 / Math.sqrt(this.headDim);

    // Initialize seeded RNG if seed provided (for testing)
    if (config?.seed !== undefined) {
      this.rng = new SeededRandom(config.seed);
    }

    // Initialize weight matrices using Xavier uniform initialization
    this.wQuery = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wKey = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wValue = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wOutput = xavierUniform(this.dimension, this.dimension, this.rng);
  }

  /**
   * Forward pass: Multi-head attention computation
   *
   * Computes: MultiHead(Q, K, V) = Concat(head₁, ..., headₕ) W^O
   * where head_i = Attention(QW_i^Q, KW_i^K, VW_i^V)
   *
   * @param query Query vectors [seq_len × dimension] (flattened)
   * @param key Key vectors [seq_len × dimension] (flattened)
   * @param value Value vectors [seq_len × dimension] (flattened)
   * @param mask Attention mask [seq_len × seq_len] (flattened row-major, optional)
   *             Semantics: true=attend, false=mask out (PyTorch convention)
   * @param seqLen Sequence length (optional, inferred from query.length if undefined)
   * @returns Output vectors [seq_len × dimension] (flattened)
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
        `Query length ${query.length} incompatible with seqLen=${actualSeqLen}, dim=${this.dimension}` +
        ` (expected ${actualSeqLen * this.dimension})`
      );
    }

    // Validate key/value dimensions match query
    if (query.length !== key.length || query.length !== value.length) {
      throw new Error(
        `Dimension mismatch: Q=${query.length}, K=${key.length}, V=${value.length}`
      );
    }

    // Validate mask dimensions if provided
    if (mask && mask.length !== actualSeqLen * actualSeqLen) {
      throw new Error(
        `Mask length ${mask.length} incompatible with seqLen=${actualSeqLen}` +
        ` (expected ${actualSeqLen * actualSeqLen})`
      );
    }

    // Step 1: Linear projections Q, K, V
    const qProjected = matmul(query, this.wQuery, this.dimension);
    const kProjected = matmul(key, this.wKey, this.dimension);
    const vProjected = matmul(value, this.wValue, this.dimension);

    // Step 2: Multi-head computation
    const headOutputs: Float32Array[] = [];

    for (let h = 0; h < this.numHeads; h++) {
      const headOutput = this.computeHeadAttention(
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
      throw new Error('Forward pass produced NaN or Inf values');
    }

    return output;
  }

  /**
   * Compute attention for a single head
   *
   * Algorithm:
   * 1. Compute scaled dot-product scores: (Q·K^T) / √d_k
   * 2. Apply mask (set masked positions to -Infinity)
   * 3. Apply softmax normalization
   * 4. Compute weighted sum: weights · V
   *
   * @param Q Projected query [seq_len × dimension]
   * @param K Projected key [seq_len × dimension]
   * @param V Projected value [seq_len × dimension]
   * @param head Head index
   * @param seqLen Sequence length
   * @param mask Optional attention mask
   * @returns Head output [seq_len × headDim]
   */
  private computeHeadAttention(
    Q: Float32Array,
    K: Float32Array,
    V: Float32Array,
    head: number,
    seqLen: number,
    mask?: boolean[]
  ): Float32Array {
    // 1. Compute scaled dot-product scores: (Q·K^T) / √d_k
    const scores = new Float32Array(seqLen * seqLen);

    for (let i = 0; i < seqLen; i++) {
      for (let j = 0; j < seqLen; j++) {
        let score = 0;

        // Extract head slices
        const qOffset = i * this.dimension + head * this.headDim;
        const kOffset = j * this.dimension + head * this.headDim;

        // Dot product: Q[i] · K[j]
        for (let k = 0; k < this.headDim; k++) {
          score += Q[qOffset + k] * K[kOffset + k];
        }

        // Apply scaling: score / √d_k
        scores[i * seqLen + j] = score * this.scale;
      }
    }

    // 2. Apply mask (PyTorch convention: true=attend, false=mask out)
    if (mask) {
      for (let i = 0; i < seqLen; i++) {
        for (let j = 0; j < seqLen; j++) {
          const idx = i * seqLen + j;
          if (!mask[idx]) {
            scores[idx] = -Infinity;
          }
        }
      }
    }

    // 3. Softmax normalization (row-wise)
    const attentionWeights = softmax2D(scores, seqLen);

    // 4. Weighted sum: output = attention_weights · V
    const output = new Float32Array(seqLen * this.headDim);

    for (let i = 0; i < seqLen; i++) {
      const vOffset = head * this.headDim;

      for (let k = 0; k < this.headDim; k++) {
        let sum = 0;

        // Compute weighted sum over sequence
        for (let j = 0; j < seqLen; j++) {
          const weight = attentionWeights[i * seqLen + j];
          const vValue = V[j * this.dimension + vOffset + k];
          sum += weight * vValue;
        }

        output[i * this.headDim + k] = sum;
      }
    }

    return output;
  }

  /**
   * Concatenate multiple head outputs
   *
   * Transforms: [head₁[seq×d_k], head₂[seq×d_k], ...] → [seq×dim]
   *
   * @param headOutputs Array of head outputs
   * @param seqLen Sequence length
   * @returns Concatenated output [seq_len × dimension]
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

        // Copy head slice to concatenated output
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
   * Parameters: 4 weight matrices (Wq, Wk, Wv, Wo) each of size [dim × dim]
   *
   * @returns Parameter count = 4 × dim²
   *
   * @example
   * ```typescript
   * const attention = new RealStandardAttention({ dimension: 768 });
   * console.log(attention.getParameterCount()); // 2,359,296
   * ```
   */
  getParameterCount(): number {
    return 4 * this.dimension * this.dimension;
  }
}
