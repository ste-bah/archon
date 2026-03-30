/**
 * Real Retentive Network Attention Implementation
 *
 * Reference: Sun et al. 2023 "Retentive Network: A Successor to Transformer for Large Language Models"
 * https://arxiv.org/abs/2307.08621
 *
 * Key insight: Replace softmax attention with a retention mechanism that
 * supports parallel training and efficient O(1) inference through recurrence.
 *
 * Retention formula:
 *   Retention(X) = (QK^T ⊙ D) V
 *   where D is a decay matrix: D_nm = γ^(n-m) for n >= m, 0 otherwise
 *
 * Key innovations:
 * - Multi-scale retention with different decay rates per head
 * - Parallel mode for training (full matrix)
 * - Recurrent mode for inference (O(1) per step)
 * - Chunk mode for balance
 *
 * This implementation focuses on parallel mode with decay mask.
 *
 * Complexity: O(N²) for training, O(1) for inference (recurrent mode)
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
 * Real Retentive Network Attention Implementation
 *
 * Implements retention mechanism with exponential decay for efficient
 * sequence modeling.
 *
 * @example
 * ```typescript
 * // Create RetNet attention
 * const attention = new RealRetentiveAttention({
 *   dimension: 768,
 *   numHeads: 8,
 *   seed: 42
 * });
 *
 * // Process sequence with retention
 * const seqLen = 1024;
 * const query = new Float32Array(seqLen * 768);
 * const output = attention.forward(query, query, query, undefined, seqLen);
 * ```
 */
export class RealRetentiveAttention implements IAttentionMechanism {
  readonly name = 'retentive';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly headDim: number;
  private readonly gammas: Float32Array;  // Per-head decay rates

  // Weight matrices [dim × dim]
  private readonly wQuery: Float32Array;
  private readonly wKey: Float32Array;
  private readonly wValue: Float32Array;
  private readonly wOutput: Float32Array;

  // Group normalization parameters (per head)
  private readonly groupNormGamma: Float32Array;
  private readonly groupNormBeta: Float32Array;

  private readonly rng?: SeededRandom;

  /**
   * Initialize Retentive attention mechanism
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

    // Initialize seeded RNG if seed provided
    if (config?.seed !== undefined) {
      this.rng = new SeededRandom(config.seed);
    }

    // Initialize multi-scale gamma (decay rates) per head
    // From paper: γ = 1 - 2^(-5 - h) for h = 0..H-1
    this.gammas = new Float32Array(this.numHeads);
    for (let h = 0; h < this.numHeads; h++) {
      this.gammas[h] = 1 - Math.pow(2, -5 - h);
    }

    // Initialize weight matrices
    this.wQuery = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wKey = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wValue = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wOutput = xavierUniform(this.dimension, this.dimension, this.rng);

    // Initialize group normalization parameters
    this.groupNormGamma = new Float32Array(this.headDim);
    this.groupNormBeta = new Float32Array(this.headDim);
    for (let d = 0; d < this.headDim; d++) {
      this.groupNormGamma[d] = 1.0;
      this.groupNormBeta[d] = 0.0;
    }
  }

  /**
   * Apply group normalization to head output
   */
  private groupNorm(x: Float32Array, offset: number, length: number): void {
    // Compute mean and variance
    let mean = 0;
    for (let i = 0; i < length; i++) {
      mean += x[offset + i];
    }
    mean /= length;

    let variance = 0;
    for (let i = 0; i < length; i++) {
      const diff = x[offset + i] - mean;
      variance += diff * diff;
    }
    variance /= length;

    // Normalize
    const std = Math.sqrt(variance + 1e-6);
    for (let i = 0; i < length; i++) {
      x[offset + i] = this.groupNormGamma[i % this.headDim] *
        (x[offset + i] - mean) / std + this.groupNormBeta[i % this.headDim];
    }
  }

  /**
   * Forward pass: Retentive Network attention (parallel mode)
   *
   * Algorithm:
   * 1. Project Q, K, V through linear transformations
   * 2. For each head, compute retention with decay mask
   * 3. Apply group normalization
   * 4. Project output
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

    // Step 2: Multi-head retention
    const headOutputs: Float32Array[] = [];

    for (let h = 0; h < this.numHeads; h++) {
      const headOutput = this.computeHeadRetention(
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
      throw new Error('ANTI-009: Retentive attention forward pass produced NaN or Inf values');
    }

    return output;
  }

  /**
   * Compute retention for a single head
   *
   * Retention(X) = (QK^T ⊙ D) V
   * where D_nm = γ^(n-m) for n >= m, 0 otherwise (causal)
   */
  private computeHeadRetention(
    Q: Float32Array,
    K: Float32Array,
    V: Float32Array,
    head: number,
    seqLen: number,
    mask?: boolean[]
  ): Float32Array {
    const output = new Float32Array(seqLen * this.headDim);
    const gamma = this.gammas[head];

    // For each query position
    for (let n = 0; n < seqLen; n++) {
      const qOffset = n * this.dimension + head * this.headDim;
      const outOffset = n * this.headDim;

      // Compute retention scores with exponential decay (causal)
      // Only attend to positions m <= n
      let sumWeights = 0;

      for (let m = 0; m <= n; m++) {
        // Check mask
        if (mask && !mask[m]) continue;

        const kOffset = m * this.dimension + head * this.headDim;

        // Compute Q·K dot product
        let score = 0;
        for (let d = 0; d < this.headDim; d++) {
          score += Q[qOffset + d] * K[kOffset + d];
        }

        // Apply exponential decay: γ^(n-m)
        const decay = Math.pow(gamma, n - m);
        const weight = score * decay;
        sumWeights += Math.abs(weight);

        // Accumulate weighted value
        const vOffset = m * this.dimension + head * this.headDim;
        for (let d = 0; d < this.headDim; d++) {
          output[outOffset + d] += weight * V[vOffset + d];
        }
      }

      // Normalize by sum of absolute weights (stability)
      if (sumWeights > 0) {
        for (let d = 0; d < this.headDim; d++) {
          output[outOffset + d] /= sumWeights;
        }
      }
    }

    // Apply group normalization
    for (let n = 0; n < seqLen; n++) {
      this.groupNorm(output, n * this.headDim, this.headDim);
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
   * RetNet: 4 × dim² + 2 × headDim (group norm)
   */
  getParameterCount(): number {
    return (
      4 * this.dimension * this.dimension +
      2 * this.headDim  // group norm gamma and beta
    );
  }
}
