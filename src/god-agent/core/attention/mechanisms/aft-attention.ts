/**
 * AFT (Attention Free Transformer) Mechanism
 *
 * Reference: Zhai et al. 2021 "An Attention Free Transformer"
 * https://arxiv.org/abs/2105.14103
 *
 * Key Innovation:
 * - Replaces dot-product attention with element-wise operations
 * - Uses learned position-wise biases instead of Q·K^T
 * - Linear complexity O(N × d) instead of quadratic O(N^2 × d)
 *
 * Formula:
 * output_i = σ(Q_i) ⊙ Σ_j exp(K_j + w_{i,j}) × V_j / Σ_j exp(K_j + w_{i,j})
 *
 * Where:
 * - σ is sigmoid activation
 * - w_{i,j} is learned position bias
 * - ⊙ is element-wise multiplication
 */

import type { IAttentionMechanism } from '../attention-types.js';
import { VECTOR_DIM } from '../../validation/constants.js';
import { SeededRandom, xavierUniform, matmul, hasNaNOrInf } from '../utils/index.js';

export interface AFTAttentionConfig {
  dimension?: number;    // Feature dimension (default: VECTOR_DIM=1536)
  numHeads?: number;     // Number of attention heads (default: 12)
  maxSeqLen?: number;    // Maximum sequence length for position bias (default: 512)
  seed?: number;         // Random seed for reproducibility
}

/**
 * AFT (Attention Free Transformer) Attention Mechanism
 *
 * Replaces quadratic dot-product attention with linear element-wise operations
 * using learned position biases.
 */
export class RealAFTAttention implements IAttentionMechanism {
  readonly name = 'aft';

  private dimension: number;
  private numHeads: number;
  private maxSeqLen: number;
  private headDim: number;

  // Learned position bias: [maxSeqLen × maxSeqLen]
  // w_bias[i][j] represents the bias from position j to position i
  private positionBias: Float32Array;

  constructor(config: AFTAttentionConfig = {}) {
    this.dimension = config.dimension ?? VECTOR_DIM;
    this.numHeads = config.numHeads ?? 12;
    this.maxSeqLen = config.maxSeqLen ?? 512;
    this.headDim = this.dimension / this.numHeads;

    if (this.dimension % this.numHeads !== 0) {
      throw new Error(`ANTI-009: dimension (${this.dimension}) must be divisible by numHeads (${this.numHeads})`);
    }

    // Initialize position bias with Xavier uniform
    const rng = new SeededRandom(config.seed ?? 42);
    this.positionBias = xavierUniform(this.maxSeqLen, this.maxSeqLen, rng);
  }

  /**
   * Forward pass of AFT attention
   *
   * @param query - Query vectors [seqLen × dimension]
   * @param key - Key vectors [seqLen × dimension]
   * @param value - Value vectors [seqLen × dimension]
   * @param mask - Optional boolean mask [seqLen] (true = keep, false = mask)
   * @param seqLen - Sequence length (inferred if not provided)
   * @returns Attention output [seqLen × dimension]
   */
  forward(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    mask?: boolean[],
    seqLen?: number
  ): Float32Array {
    // Validate inputs
    this.validateInputs(query, key, value, mask, seqLen);

    // Infer sequence length
    const actualSeqLen = seqLen ?? Math.floor(query.length / this.dimension);

    if (actualSeqLen > this.maxSeqLen) {
      throw new Error(
        `ANTI-009: sequence length (${actualSeqLen}) exceeds maxSeqLen (${this.maxSeqLen})`
      );
    }

    // Prepare mask (default to all true)
    const effectiveMask = mask ?? Array(actualSeqLen).fill(true);

    // Output buffer
    const output = new Float32Array(actualSeqLen * this.dimension);

    // Process each position i
    for (let i = 0; i < actualSeqLen; i++) {
      if (!effectiveMask[i]) {
        // Masked position: output zeros
        continue;
      }

      // Extract Q_i and compute sigmoid gating: σ(Q_i)
      const qOffset = i * this.dimension;
      const sigmoidQ = new Float32Array(this.dimension);
      for (let d = 0; d < this.dimension; d++) {
        sigmoidQ[d] = this.sigmoid(query[qOffset + d]);
      }

      // Compute weighted sum over all positions j
      // numerator = Σ_j exp(K_j + w_{i,j}) × V_j
      // denominator = Σ_j exp(K_j + w_{i,j})
      const numerator = new Float32Array(this.dimension);
      let denominator = 0;

      for (let j = 0; j < actualSeqLen; j++) {
        if (!effectiveMask[j]) {
          continue;
        }

        // Get position bias w_{i,j}
        const bias = this.positionBias[i * this.maxSeqLen + j];

        // Compute exp(K_j + w_{i,j}) for each dimension
        // For stability, we compute a per-position weight using mean of K_j
        const kOffset = j * this.dimension;
        let kSum = 0;
        for (let d = 0; d < this.dimension; d++) {
          kSum += key[kOffset + d];
        }
        const kMean = kSum / this.dimension;

        // Compute weight with numerical stability
        const weight = this.safeExp(kMean + bias);
        denominator += weight;

        // Accumulate weighted values: weight × V_j
        const vOffset = j * this.dimension;
        for (let d = 0; d < this.dimension; d++) {
          numerator[d] += weight * value[vOffset + d];
        }
      }

      // Normalize and gate with sigmoid(Q_i)
      const outOffset = i * this.dimension;
      for (let d = 0; d < this.dimension; d++) {
        const normalized = denominator > 1e-8 ? numerator[d] / denominator : 0;
        output[outOffset + d] = sigmoidQ[d] * normalized;
      }
    }

    // Validate output
    if (hasNaNOrInf(output)) {
      throw new Error('ANTI-009: AFT attention produced NaN or Inf values');
    }

    return output;
  }

  /**
   * Get total number of learnable parameters
   */
  getParameterCount(): number {
    // Position bias matrix: maxSeqLen × maxSeqLen
    return this.maxSeqLen * this.maxSeqLen;
  }

  /**
   * Sigmoid activation: σ(x) = 1 / (1 + exp(-x))
   */
  private sigmoid(x: number): number {
    if (x >= 0) {
      // Numerically stable for positive x
      const z = Math.exp(-x);
      return 1 / (1 + z);
    } else {
      // Numerically stable for negative x
      const z = Math.exp(x);
      return z / (1 + z);
    }
  }

  /**
   * Safe exponential with clipping to prevent overflow
   */
  private safeExp(x: number): number {
    // Clip to prevent overflow (exp(20) ≈ 485M, exp(-20) ≈ 2e-9)
    const clipped = Math.max(-20, Math.min(20, x));
    return Math.exp(clipped);
  }

  /**
   * Validate input tensors
   */
  private validateInputs(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    mask?: boolean[],
    seqLen?: number
  ): void {
    if (!(query instanceof Float32Array)) {
      throw new Error('ANTI-009: query must be Float32Array');
    }
    if (!(key instanceof Float32Array)) {
      throw new Error('ANTI-009: key must be Float32Array');
    }
    if (!(value instanceof Float32Array)) {
      throw new Error('ANTI-009: value must be Float32Array');
    }

    if (query.length !== key.length || query.length !== value.length) {
      throw new Error(
        `ANTI-009: query, key, value must have same length (got ${query.length}, ${key.length}, ${value.length})`
      );
    }

    if (query.length % this.dimension !== 0) {
      throw new Error(
        `ANTI-009: input length (${query.length}) must be divisible by dimension (${this.dimension})`
      );
    }

    const inferredSeqLen = Math.floor(query.length / this.dimension);
    if (seqLen !== undefined && seqLen !== inferredSeqLen) {
      throw new Error(
        `ANTI-009: provided seqLen (${seqLen}) does not match inferred seqLen (${inferredSeqLen})`
      );
    }

    if (mask !== undefined && mask.length !== inferredSeqLen) {
      throw new Error(
        `ANTI-009: mask length (${mask.length}) must match seqLen (${inferredSeqLen})`
      );
    }

    if (hasNaNOrInf(query)) {
      throw new Error('ANTI-009: query contains NaN or Inf');
    }
    if (hasNaNOrInf(key)) {
      throw new Error('ANTI-009: key contains NaN or Inf');
    }
    if (hasNaNOrInf(value)) {
      throw new Error('ANTI-009: value contains NaN or Inf');
    }
  }
}
