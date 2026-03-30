/**
 * Real Differential Attention Implementation
 *
 * Reference: Ye et al. 2024 "Differential Transformer"
 * https://arxiv.org/abs/2410.05258
 *
 * Key insight: Use differential attention to cancel out noise and
 * enhance signal by computing the difference between two softmax
 * attention patterns.
 *
 * DiffAttn formula:
 *   DiffAttn(Q, K, V) = (softmax(Q₁K₁ᵀ) - λ·softmax(Q₂K₂ᵀ)) V
 *
 * Where:
 * - Q, K are split into two halves: Q₁, Q₂ and K₁, K₂
 * - λ is a learnable scalar initialized to 0.8
 * - The difference cancels common noise patterns
 *
 * Benefits:
 * - Better noise suppression
 * - Improved sparse attention patterns
 * - Enhanced signal-to-noise ratio
 *
 * Complexity: O(N²) same as standard attention
 * Parameter Count: 4 × dim² + 1 (lambda)
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
 * Real Differential Attention Implementation
 *
 * Implements differential attention for enhanced noise cancellation
 * and improved attention patterns.
 *
 * @example
 * ```typescript
 * // Create Differential attention
 * const attention = new RealDifferentialAttention({
 *   dimension: 768,
 *   numHeads: 8,
 *   lambda: 0.8,  // Subtraction coefficient
 *   seed: 42
 * });
 *
 * // Process sequence with noise cancellation
 * const seqLen = 512;
 * const query = new Float32Array(seqLen * 768);
 * const output = attention.forward(query, query, query, undefined, seqLen);
 * ```
 */
export class RealDifferentialAttention implements IAttentionMechanism {
  readonly name = 'differential';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly headDim: number;
  private readonly halfHeadDim: number;
  private readonly scale: number;
  private lambda: number;  // Learnable subtraction coefficient

  // Weight matrices [dim × dim]
  private readonly wQuery: Float32Array;
  private readonly wKey: Float32Array;
  private readonly wValue: Float32Array;
  private readonly wOutput: Float32Array;

  private readonly rng?: SeededRandom;

  /**
   * Initialize Differential attention mechanism
   *
   * @param config Configuration options
   * @param config.dimension Model dimension (default: VECTOR_DIM=1536)
   * @param config.numHeads Number of attention heads (default: 8)
   * @param config.lambda Initial subtraction coefficient (default: 0.8)
   * @param config.seed Random seed for initialization (optional)
   *
   * @throws Error if dimension not divisible by numHeads
   * @throws Error if headDim is not even (needed for Q/K split)
   */
  constructor(config?: {
    dimension?: number;
    numHeads?: number;
    lambda?: number;
    seed?: number;
  }) {
    this.dimension = config?.dimension ?? VECTOR_DIM;
    this.numHeads = config?.numHeads ?? 8;
    this.lambda = config?.lambda ?? 0.8;

    // Validate configuration
    if (this.dimension % this.numHeads !== 0) {
      throw new Error(
        `ANTI-009: Dimension ${this.dimension} must be divisible by numHeads ${this.numHeads}`
      );
    }

    this.headDim = this.dimension / this.numHeads;

    if (this.headDim % 2 !== 0) {
      throw new Error(
        `ANTI-009: headDim ${this.headDim} must be even for differential attention Q/K split`
      );
    }

    this.halfHeadDim = this.headDim / 2;
    this.scale = 1.0 / Math.sqrt(this.halfHeadDim);

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
   * Forward pass: Differential attention
   *
   * Algorithm:
   * 1. Project Q, K, V through linear transformations
   * 2. Split Q, K into two halves
   * 3. Compute two attention patterns
   * 4. Subtract weighted second from first
   * 5. Apply to values
   *
   * @param query Query vectors [seq_len × dimension]
   * @param key Key vectors [seq_len × dimension]
   * @param value Value vectors [seq_len × dimension]
   * @param mask Optional attention mask
   * @param seqLen Sequence length (optional)
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

    // Step 2: Multi-head differential attention
    const headOutputs: Float32Array[] = [];

    for (let h = 0; h < this.numHeads; h++) {
      const headOutput = this.computeHeadDifferentialAttention(
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
      throw new Error('ANTI-009: Differential attention forward pass produced NaN or Inf values');
    }

    return output;
  }

  /**
   * Compute differential attention for a single head
   *
   * DiffAttn = (softmax(Q₁K₁ᵀ) - λ·softmax(Q₂K₂ᵀ)) V
   */
  private computeHeadDifferentialAttention(
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

      // Compute attention scores for both halves
      const scores1 = new Float32Array(seqLen);
      const scores2 = new Float32Array(seqLen);
      let maxScore1 = -Infinity;
      let maxScore2 = -Infinity;

      for (let j = 0; j < seqLen; j++) {
        // Check mask
        if (mask && !mask[j]) {
          scores1[j] = -Infinity;
          scores2[j] = -Infinity;
          continue;
        }

        const kOffset = j * this.dimension + head * this.headDim;

        // Q₁·K₁ (first half)
        let score1 = 0;
        for (let d = 0; d < this.halfHeadDim; d++) {
          score1 += Q[qOffset + d] * K[kOffset + d];
        }
        scores1[j] = score1 * this.scale;
        if (scores1[j] > maxScore1) maxScore1 = scores1[j];

        // Q₂·K₂ (second half)
        let score2 = 0;
        for (let d = this.halfHeadDim; d < this.headDim; d++) {
          score2 += Q[qOffset + d] * K[kOffset + d];
        }
        scores2[j] = score2 * this.scale;
        if (scores2[j] > maxScore2) maxScore2 = scores2[j];
      }

      // Compute softmax for both patterns
      let sumExp1 = 0;
      let sumExp2 = 0;
      const expScores1 = new Float32Array(seqLen);
      const expScores2 = new Float32Array(seqLen);

      for (let j = 0; j < seqLen; j++) {
        if (scores1[j] === -Infinity) {
          expScores1[j] = 0;
        } else {
          expScores1[j] = Math.exp(scores1[j] - maxScore1);
          sumExp1 += expScores1[j];
        }

        if (scores2[j] === -Infinity) {
          expScores2[j] = 0;
        } else {
          expScores2[j] = Math.exp(scores2[j] - maxScore2);
          sumExp2 += expScores2[j];
        }
      }

      // Compute differential attention weights and apply to values
      for (let d = 0; d < this.headDim; d++) {
        let weightedSum = 0;
        for (let j = 0; j < seqLen; j++) {
          const vOffset = j * this.dimension + head * this.headDim;

          // Differential weight: attn1 - λ·attn2
          const attn1 = sumExp1 > 0 ? expScores1[j] / sumExp1 : 0;
          const attn2 = sumExp2 > 0 ? expScores2[j] / sumExp2 : 0;
          const diffWeight = attn1 - this.lambda * attn2;

          weightedSum += diffWeight * V[vOffset + d];
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
   * Differential: 4 × dim² + 1 (lambda)
   */
  getParameterCount(): number {
    return 4 * this.dimension * this.dimension + 1;
  }
}
