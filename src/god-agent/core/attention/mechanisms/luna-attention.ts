/**
 * Luna (Linear Unified Nested Attention) Mechanism
 *
 * Reference: Ma et al. 2021 "Luna: Linear Unified Nested Attention"
 *
 * Key Innovation:
 * - Uses fixed-length projected context (P) to achieve linear complexity
 * - Two-stage attention: pack sequence into P, then unpack back to sequence
 * - Complexity: O(N × P) where P << N (e.g., P=64, N=1024)
 *
 * Algorithm:
 * 1. Pack: P = softmax(Wp × X) × X  [N → P projection]
 * 2. Unpack: output = softmax(X × P^T) × P [P → N attention]
 *
 * @module attention/mechanisms/luna-attention
 */

import type { IAttentionMechanism } from '../attention-types.js';
import { VECTOR_DIM } from '../../validation/constants.js';
import {
  SeededRandom,
  xavierUniform,
  matmul,
  hasNaNOrInf,
} from '../utils/index.js';

/**
 * Configuration for Luna Attention
 */
export interface LunaAttentionConfig {
  /** Model dimension (default: VECTOR_DIM=1536) */
  dimension?: number;
  /** Number of attention heads (default: 12) */
  numHeads?: number;
  /** Projected context length P (default: 64) */
  projectedLength?: number;
  /** Random seed for reproducibility */
  seed?: number;
}

/**
 * Real Luna Attention Implementation
 *
 * Implements packed attention with linear complexity O(N × P).
 * Uses fixed-length projected context to compress sequence information.
 */
export class RealLunaAttention implements IAttentionMechanism {
  readonly name = 'luna';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly headDim: number;
  private readonly projectedLength: number;
  private readonly scale: number;

  // Projection weights: [projectedLength, dimension]
  private readonly packProjection: Float32Array;

  // Multi-head projection weights
  private readonly wq: Float32Array; // [dimension, dimension]
  private readonly wk: Float32Array; // [dimension, dimension]
  private readonly wv: Float32Array; // [dimension, dimension]
  private readonly wo: Float32Array; // [dimension, dimension]

  constructor(config: LunaAttentionConfig = {}) {
    this.dimension = config.dimension ?? VECTOR_DIM;
    this.numHeads = config.numHeads ?? 12;
    this.projectedLength = config.projectedLength ?? 64;

    // Validate configuration
    if (this.dimension <= 0) {
      throw new Error('ANTI-009: dimension must be positive');
    }
    if (this.numHeads <= 0) {
      throw new Error('ANTI-009: numHeads must be positive');
    }
    if (this.dimension % this.numHeads !== 0) {
      throw new Error('ANTI-009: dimension must be divisible by numHeads');
    }
    if (this.projectedLength <= 0) {
      throw new Error('ANTI-009: projectedLength must be positive');
    }

    this.headDim = this.dimension / this.numHeads;
    this.scale = 1.0 / Math.sqrt(this.headDim);

    const rng = new SeededRandom(config.seed ?? 42);

    // Initialize pack projection weights
    this.packProjection = xavierUniform(
      this.projectedLength,
      this.dimension,
      rng
    );

    // Initialize multi-head projection weights
    this.wq = xavierUniform(this.dimension, this.dimension, rng);
    this.wk = xavierUniform(this.dimension, this.dimension, rng);
    this.wv = xavierUniform(this.dimension, this.dimension, rng);
    this.wo = xavierUniform(this.dimension, this.dimension, rng);

    // Validate all weights
    if (hasNaNOrInf(this.packProjection)) {
      throw new Error('ANTI-009: packProjection contains NaN or Inf');
    }
    if (hasNaNOrInf(this.wq)) {
      throw new Error('ANTI-009: wq contains NaN or Inf');
    }
    if (hasNaNOrInf(this.wk)) {
      throw new Error('ANTI-009: wk contains NaN or Inf');
    }
    if (hasNaNOrInf(this.wv)) {
      throw new Error('ANTI-009: wv contains NaN or Inf');
    }
    if (hasNaNOrInf(this.wo)) {
      throw new Error('ANTI-009: wo contains NaN or Inf');
    }
  }

  /**
   * Forward pass: Luna two-stage attention
   *
   * Stage 1 (Pack): Project sequence to fixed-length context
   * Stage 2 (Unpack): Attend from sequence to packed context
   *
   * @param query - Query vectors [seqLen * dimension]
   * @param key - Key vectors [seqLen * dimension]
   * @param value - Value vectors [seqLen * dimension]
   * @param mask - Optional attention mask [seqLen]
   * @param seqLen - Sequence length
   * @returns Attention output [seqLen * dimension]
   */
  forward(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    mask?: boolean[],
    seqLen?: number
  ): Float32Array {
    // Infer sequence length
    const N = seqLen ?? Math.floor(query.length / this.dimension);

    // Validation
    if (N <= 0) {
      throw new Error('ANTI-009: sequence length must be positive');
    }
    if (query.length !== N * this.dimension) {
      throw new Error('ANTI-009: query length mismatch');
    }
    if (key.length !== N * this.dimension) {
      throw new Error('ANTI-009: key length mismatch');
    }
    if (value.length !== N * this.dimension) {
      throw new Error('ANTI-009: value length mismatch');
    }
    if (mask && mask.length !== N) {
      throw new Error('ANTI-009: mask length mismatch');
    }

    // Project Q, K, V
    const Q = matmul(query, this.wq, this.dimension);
    const K = matmul(key, this.wk, this.dimension);
    const V = matmul(value, this.wv, this.dimension);

    // Stage 1: Pack - Project sequence to fixed-length context
    // P = softmax(Wp × K) × V
    // Wp: [P, D], K: [N, D] → scores: [P, N]
    const packScores = this.computePackScores(K, N, mask);
    const packed = this.applyPackScores(packScores, V, N);

    // Stage 2: Unpack - Attend from query to packed context
    // output = softmax(Q × P^T) × P
    // Q: [N, D], P: [P, D] → scores: [N, P]
    const unpackScores = this.computeUnpackScores(Q, packed, N);
    const attended = this.applyUnpackScores(unpackScores, packed, N);

    // Output projection
    const output = matmul(attended, this.wo, this.dimension);

    // Validation
    if (hasNaNOrInf(output)) {
      throw new Error('ANTI-009: output contains NaN or Inf');
    }

    return output;
  }

  /**
   * Compute pack scores: Wp × K → [P, N]
   *
   * @param K - Key matrix [N, D]
   * @param N - Sequence length
   * @param mask - Optional mask [N]
   * @returns Pack attention scores [P, N]
   */
  private computePackScores(
    K: Float32Array,
    N: number,
    mask?: boolean[]
  ): Float32Array {
    const P = this.projectedLength;
    const D = this.dimension;
    const scores = new Float32Array(P * N);

    // Multi-head pack scoring
    for (let h = 0; h < this.numHeads; h++) {
      const headOffset = h * this.headDim;

      for (let p = 0; p < P; p++) {
        for (let n = 0; n < N; n++) {
          let score = 0;

          // Dot product: packProjection[p] · K[n] (for this head)
          for (let d = 0; d < this.headDim; d++) {
            const packIdx = p * D + headOffset + d;
            const keyIdx = n * D + headOffset + d;
            score += this.packProjection[packIdx] * K[keyIdx];
          }

          scores[p * N + n] += score * this.scale;
        }
      }
    }

    // Apply softmax per row (per projected position)
    for (let p = 0; p < P; p++) {
      this.softmaxInPlace(scores, p * N, N, mask);
    }

    return scores;
  }

  /**
   * Apply pack scores to values: scores × V → [P, D]
   *
   * @param scores - Pack scores [P, N]
   * @param V - Value matrix [N, D]
   * @param N - Sequence length
   * @returns Packed context [P, D]
   */
  private applyPackScores(
    scores: Float32Array,
    V: Float32Array,
    N: number
  ): Float32Array {
    const P = this.projectedLength;
    const D = this.dimension;
    const packed = new Float32Array(P * D);

    // Weighted sum: packed[p] = Σ scores[p,n] * V[n]
    for (let p = 0; p < P; p++) {
      for (let n = 0; n < N; n++) {
        const score = scores[p * N + n];
        for (let d = 0; d < D; d++) {
          packed[p * D + d] += score * V[n * D + d];
        }
      }
    }

    return packed;
  }

  /**
   * Compute unpack scores: Q × P^T → [N, P]
   *
   * @param Q - Query matrix [N, D]
   * @param P - Packed context [P, D]
   * @param N - Sequence length
   * @returns Unpack attention scores [N, P]
   */
  private computeUnpackScores(
    Q: Float32Array,
    P: Float32Array,
    N: number
  ): Float32Array {
    const projLen = this.projectedLength;
    const D = this.dimension;
    const scores = new Float32Array(N * projLen);

    // Multi-head unpack scoring
    for (let h = 0; h < this.numHeads; h++) {
      const headOffset = h * this.headDim;

      for (let n = 0; n < N; n++) {
        for (let p = 0; p < projLen; p++) {
          let score = 0;

          // Dot product: Q[n] · P[p] (for this head)
          for (let d = 0; d < this.headDim; d++) {
            const queryIdx = n * D + headOffset + d;
            const packIdx = p * D + headOffset + d;
            score += Q[queryIdx] * P[packIdx];
          }

          scores[n * projLen + p] += score * this.scale;
        }
      }
    }

    // Apply softmax per row (per query position)
    for (let n = 0; n < N; n++) {
      this.softmaxInPlace(scores, n * projLen, projLen);
    }

    return scores;
  }

  /**
   * Apply unpack scores to packed context: scores × P → [N, D]
   *
   * @param scores - Unpack scores [N, P]
   * @param P - Packed context [P, D]
   * @param N - Sequence length
   * @returns Attended output [N, D]
   */
  private applyUnpackScores(
    scores: Float32Array,
    P: Float32Array,
    N: number
  ): Float32Array {
    const projLen = this.projectedLength;
    const D = this.dimension;
    const output = new Float32Array(N * D);

    // Weighted sum: output[n] = Σ scores[n,p] * P[p]
    for (let n = 0; n < N; n++) {
      for (let p = 0; p < projLen; p++) {
        const score = scores[n * projLen + p];
        for (let d = 0; d < D; d++) {
          output[n * D + d] += score * P[p * D + d];
        }
      }
    }

    return output;
  }

  /**
   * In-place stable softmax with optional masking
   *
   * @param arr - Array to apply softmax to
   * @param offset - Starting offset in array
   * @param length - Number of elements
   * @param mask - Optional mask (false = -Inf)
   */
  private softmaxInPlace(
    arr: Float32Array,
    offset: number,
    length: number,
    mask?: boolean[]
  ): void {
    // Find max for numerical stability
    let max = -Infinity;
    for (let i = 0; i < length; i++) {
      if (!mask || mask[i]) {
        max = Math.max(max, arr[offset + i]);
      }
    }

    // Compute exp and sum
    let sum = 0;
    for (let i = 0; i < length; i++) {
      if (mask && !mask[i]) {
        arr[offset + i] = 0;
      } else {
        const exp = Math.exp(arr[offset + i] - max);
        arr[offset + i] = exp;
        sum += exp;
      }
    }

    // Normalize
    const invSum = sum > 0 ? 1.0 / sum : 0;
    for (let i = 0; i < length; i++) {
      arr[offset + i] *= invSum;
    }
  }

  /**
   * Get total parameter count
   *
   * @returns Number of trainable parameters
   */
  getParameterCount(): number {
    const packParams = this.projectedLength * this.dimension;
    const projParams = 4 * this.dimension * this.dimension; // Q, K, V, O
    return packParams + projParams;
  }
}
