/**
 * Multi-Head Latent Attention Mechanism
 *
 * Based on DeepMind's Perceiver architecture concept.
 * Uses learned latent queries to compress variable-length inputs
 * into fixed-size representations.
 *
 * Algorithm:
 * 1. Maintain learned latent array L [numLatents × dimension]
 * 2. Cross-attention: output = Attention(L, input, input)
 * 3. Latent queries attend to all input positions
 * 4. Output is fixed-size regardless of input length
 *
 * Complexity: O(L × N) where L = latent size (fixed, small)
 *
 * @module attention/mechanisms/multi-head-latent-attention
 */

import type { IAttentionMechanism } from '../attention-types.js';
import { VECTOR_DIM } from '../../validation/constants.js';
import { SeededRandom, xavierUniform, matmul, hasNaNOrInf } from '../utils/index.js';

export interface MultiHeadLatentAttentionConfig {
  dimension?: number;      // Model dimension (default: VECTOR_DIM=1536)
  numHeads?: number;       // Number of attention heads (default: 12)
  numLatents?: number;     // Number of latent queries (default: 64)
  seed?: number;          // Random seed for initialization
}

export class RealMultiHeadLatentAttention implements IAttentionMechanism {
  readonly name = 'multi-head-latent';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly numLatents: number;
  private readonly headDim: number;
  private readonly seed: number;

  // Learned latent queries [numLatents × dimension]
  private readonly latentQueries: Float32Array;

  // Projection weights
  private readonly Wq: Float32Array; // [dimension × dimension]
  private readonly Wk: Float32Array; // [dimension × dimension]
  private readonly Wv: Float32Array; // [dimension × dimension]
  private readonly Wo: Float32Array; // [dimension × dimension]

  constructor(config: MultiHeadLatentAttentionConfig = {}) {
    this.dimension = config.dimension ?? VECTOR_DIM;
    this.numHeads = config.numHeads ?? 12;
    this.numLatents = config.numLatents ?? 64;
    this.seed = config.seed ?? 42;

    // Validate configuration
    if (this.dimension <= 0) {
      throw new Error('ANTI-009: dimension must be positive');
    }
    if (this.numHeads <= 0) {
      throw new Error('ANTI-009: numHeads must be positive');
    }
    if (this.numLatents <= 0) {
      throw new Error('ANTI-009: numLatents must be positive');
    }
    if (this.dimension % this.numHeads !== 0) {
      throw new Error('ANTI-009: dimension must be divisible by numHeads');
    }

    this.headDim = this.dimension / this.numHeads;

    const rng = new SeededRandom(this.seed);

    // Initialize learned latent queries
    this.latentQueries = xavierUniform(
      this.numLatents,
      this.dimension,
      rng
    );

    // Initialize projection weights
    this.Wq = xavierUniform(this.dimension, this.dimension, rng);
    this.Wk = xavierUniform(this.dimension, this.dimension, rng);
    this.Wv = xavierUniform(this.dimension, this.dimension, rng);
    this.Wo = xavierUniform(this.dimension, this.dimension, rng);
  }

  /**
   * Forward pass: cross-attention from latent queries to input
   *
   * @param query - Unused in pure latent mode (latent queries are learned)
   * @param key - Input sequence to attend to [seqLen × dimension]
   * @param value - Input sequence values [seqLen × dimension]
   * @param mask - Optional attention mask [seqLen]
   * @param seqLen - Sequence length
   * @returns Fixed-size output [numLatents × dimension]
   */
  forward(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    mask?: boolean[],
    seqLen?: number
  ): Float32Array {
    // Validate inputs
    if (!key || key.length === 0) {
      throw new Error('ANTI-009: key cannot be empty');
    }
    if (!value || value.length === 0) {
      throw new Error('ANTI-009: value cannot be empty');
    }
    if (key.length !== value.length) {
      throw new Error('ANTI-009: key and value must have same length');
    }

    // Infer sequence length from key/value
    const inferredSeqLen = seqLen ?? Math.floor(key.length / this.dimension);
    if (inferredSeqLen <= 0) {
      throw new Error('ANTI-009: invalid sequence length');
    }
    if (key.length !== inferredSeqLen * this.dimension) {
      throw new Error('ANTI-009: key length must be seqLen × dimension');
    }
    if (value.length !== inferredSeqLen * this.dimension) {
      throw new Error('ANTI-009: value length must be seqLen × dimension');
    }

    // Validate mask if provided
    if (mask && mask.length !== inferredSeqLen) {
      throw new Error('ANTI-009: mask length must match sequence length');
    }

    // Project latent queries: Q = latentQueries × Wq [numLatents × dimension]
    const Q = matmul(this.latentQueries, this.Wq, this.dimension);

    // Project keys: K = key × Wk [seqLen × dimension]
    const K = matmul(key, this.Wk, this.dimension);

    // Project values: V = value × Wv [seqLen × dimension]
    const V = matmul(value, this.Wv, this.dimension);

    // Reshape for multi-head attention
    // Q: [numLatents × numHeads × headDim]
    // K: [seqLen × numHeads × headDim]
    // V: [seqLen × numHeads × headDim]

    // Compute multi-head attention
    const output = new Float32Array(this.numLatents * this.dimension);

    for (let h = 0; h < this.numHeads; h++) {
      // Compute attention scores for this head
      // scores[i][j] = Q[i,h] · K[j,h]^T / sqrt(headDim)
      const scores = new Float32Array(this.numLatents * inferredSeqLen);
      const scale = 1.0 / Math.sqrt(this.headDim);

      for (let i = 0; i < this.numLatents; i++) {
        for (let j = 0; j < inferredSeqLen; j++) {
          let dot = 0.0;
          for (let d = 0; d < this.headDim; d++) {
            const qIdx = i * this.dimension + h * this.headDim + d;
            const kIdx = j * this.dimension + h * this.headDim + d;
            dot += Q[qIdx] * K[kIdx];
          }
          scores[i * inferredSeqLen + j] = dot * scale;
        }
      }

      // Apply softmax with masking (per latent query)
      for (let i = 0; i < this.numLatents; i++) {
        const rowStart = i * inferredSeqLen;

        // Find max for numerical stability
        let maxScore = -Infinity;
        for (let j = 0; j < inferredSeqLen; j++) {
          if (!mask || mask[j]) {
            maxScore = Math.max(maxScore, scores[rowStart + j]);
          }
        }

        // Compute exp and sum
        let sum = 0.0;
        for (let j = 0; j < inferredSeqLen; j++) {
          if (mask && !mask[j]) {
            scores[rowStart + j] = 0.0;
          } else {
            scores[rowStart + j] = Math.exp(scores[rowStart + j] - maxScore);
            sum += scores[rowStart + j];
          }
        }

        // Normalize
        if (sum > 0) {
          for (let j = 0; j < inferredSeqLen; j++) {
            scores[rowStart + j] /= sum;
          }
        }
      }

      // Apply attention to values: output[i] = Σ_j scores[i][j] * V[j,h]
      for (let i = 0; i < this.numLatents; i++) {
        for (let d = 0; d < this.headDim; d++) {
          let sum = 0.0;
          for (let j = 0; j < inferredSeqLen; j++) {
            const score = scores[i * inferredSeqLen + j];
            const vIdx = j * this.dimension + h * this.headDim + d;
            sum += score * V[vIdx];
          }
          const outIdx = i * this.dimension + h * this.headDim + d;
          output[outIdx] = sum;
        }
      }
    }

    // Project output: final = output × Wo [numLatents × dimension]
    const final = matmul(output, this.Wo, this.dimension);

    // Validate output
    if (hasNaNOrInf(final)) {
      throw new Error('ANTI-009: attention output contains NaN or Inf');
    }

    return final;
  }

  /**
   * Get total trainable parameter count
   */
  getParameterCount(): number {
    // Latent queries: numLatents × dimension
    const latentParams = this.numLatents * this.dimension;

    // Projection matrices: 4 × (dimension × dimension)
    const projectionParams = 4 * this.dimension * this.dimension;

    return latentParams + projectionParams;
  }
}
