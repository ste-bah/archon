/**
 * Real Linformer Attention Implementation
 *
 * Reference: Wang et al. 2020 "Linformer: Self-Attention with Linear Complexity"
 * https://arxiv.org/abs/2006.04768
 *
 * Key insight: Approximate the full N×N attention matrix with a low-rank
 * projection, reducing complexity from O(N²) to O(N×k) where k << N.
 *
 * The key observation is that the attention matrix is often low-rank,
 * so we can project K and V to a lower dimension:
 *
 * Original: softmax(Q·K^T/√d)·V
 * Linformer: softmax(Q·(E·K)^T/√d)·(F·V)
 *
 * Where E, F ∈ ℝ^{k×N} are learned projections that compress the sequence.
 *
 * Complexity: O(N × k × d) where k is the projected dimension
 * Parameter Count: 4 × dim² + 2 × k × dim (projection matrices)
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
 * Real Linformer Attention Implementation
 *
 * Implements low-rank self-attention for O(N) complexity.
 *
 * @example
 * ```typescript
 * // Create Linformer attention
 * const attention = new RealLinformerAttention({
 *   dimension: 768,
 *   numHeads: 8,
 *   projectedDim: 256,  // k - projected sequence length
 *   maxSeqLen: 4096,
 *   seed: 42
 * });
 *
 * // Process long sequence efficiently
 * const seqLen = 4096;
 * const query = new Float32Array(seqLen * 768);
 * const output = attention.forward(query, query, query, undefined, seqLen);
 * ```
 */
export class RealLinformerAttention implements IAttentionMechanism {
  readonly name = 'linformer';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly headDim: number;
  private readonly projectedDim: number;  // k - projection dimension
  private readonly maxSeqLen: number;
  private readonly scale: number;

  // Weight matrices [dim × dim]
  private readonly wQuery: Float32Array;
  private readonly wKey: Float32Array;
  private readonly wValue: Float32Array;
  private readonly wOutput: Float32Array;

  // Projection matrices for K and V [projectedDim × maxSeqLen]
  private readonly projE: Float32Array;  // Key projection
  private readonly projF: Float32Array;  // Value projection

  private readonly rng?: SeededRandom;

  /**
   * Initialize Linformer attention mechanism
   *
   * @param config Configuration options
   * @param config.dimension Model dimension (default: VECTOR_DIM=1536)
   * @param config.numHeads Number of attention heads (default: 8)
   * @param config.projectedDim Projected sequence dimension k (default: 256)
   * @param config.maxSeqLen Maximum sequence length (default: 512)
   * @param config.seed Random seed for initialization (optional)
   *
   * @throws Error if dimension not divisible by numHeads
   * @throws Error if projectedDim > maxSeqLen
   */
  constructor(config?: {
    dimension?: number;
    numHeads?: number;
    projectedDim?: number;
    maxSeqLen?: number;
    seed?: number;
  }) {
    this.dimension = config?.dimension ?? VECTOR_DIM;
    this.numHeads = config?.numHeads ?? 8;
    this.maxSeqLen = config?.maxSeqLen ?? 512;
    this.projectedDim = config?.projectedDim ?? Math.min(256, this.maxSeqLen);

    // Validate configuration
    if (this.dimension % this.numHeads !== 0) {
      throw new Error(
        `ANTI-009: Dimension ${this.dimension} must be divisible by numHeads ${this.numHeads}`
      );
    }

    if (this.projectedDim > this.maxSeqLen) {
      throw new Error(
        `ANTI-009: projectedDim ${this.projectedDim} cannot exceed maxSeqLen ${this.maxSeqLen}`
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

    // Initialize projection matrices
    this.projE = xavierUniform(this.maxSeqLen, this.projectedDim, this.rng);
    this.projF = xavierUniform(this.maxSeqLen, this.projectedDim, this.rng);
  }

  /**
   * Project sequence through low-rank projection matrix
   * [seqLen × dim] × [seqLen × k]^T = [k × dim]
   */
  private projectSequence(
    input: Float32Array,
    proj: Float32Array,
    seqLen: number,
    dim: number
  ): Float32Array {
    const output = new Float32Array(this.projectedDim * dim);

    // For each projected position k
    for (let k = 0; k < this.projectedDim; k++) {
      // Weighted sum over sequence positions
      for (let d = 0; d < dim; d++) {
        let sum = 0;
        for (let t = 0; t < seqLen; t++) {
          // proj[t, k] × input[t, d]
          sum += proj[t * this.projectedDim + k] * input[t * dim + d];
        }
        output[k * dim + d] = sum;
      }
    }

    return output;
  }

  /**
   * Forward pass: Linformer low-rank attention
   *
   * Algorithm:
   * 1. Project Q, K, V through linear transformations
   * 2. Project K, V through low-rank projections (E, F)
   * 3. Compute attention: softmax(Q·(E·K)^T/√d)·(F·V)
   * 4. Project output
   *
   * @param query Query vectors [seq_len × dimension]
   * @param key Key vectors [seq_len × dimension]
   * @param value Value vectors [seq_len × dimension]
   * @param mask Optional attention mask (ignored in low-rank approximation)
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

    if (actualSeqLen > this.maxSeqLen) {
      throw new Error(
        `ANTI-009: Sequence length ${actualSeqLen} exceeds maxSeqLen ${this.maxSeqLen}`
      );
    }

    // Step 1: Project Q, K, V
    const qProjected = matmul(query, this.wQuery, this.dimension);
    const kProjected = matmul(key, this.wKey, this.dimension);
    const vProjected = matmul(value, this.wValue, this.dimension);

    // Step 2: Multi-head Linformer attention
    const headOutputs: Float32Array[] = [];

    for (let h = 0; h < this.numHeads; h++) {
      const headOutput = this.computeHeadLinformerAttention(
        qProjected,
        kProjected,
        vProjected,
        h,
        actualSeqLen
      );
      headOutputs.push(headOutput);
    }

    // Step 3: Concatenate heads
    const concatenated = this.concatenateHeads(headOutputs, actualSeqLen);

    // Step 4: Output projection
    const output = matmul(concatenated, this.wOutput, this.dimension);

    // Validate output
    if (hasNaNOrInf(output)) {
      throw new Error('ANTI-009: Linformer attention forward pass produced NaN or Inf values');
    }

    return output;
  }

  /**
   * Compute Linformer attention for a single head
   */
  private computeHeadLinformerAttention(
    Q: Float32Array,
    K: Float32Array,
    V: Float32Array,
    head: number,
    seqLen: number
  ): Float32Array {
    const output = new Float32Array(seqLen * this.headDim);

    // Extract head's K and V
    const headK = new Float32Array(seqLen * this.headDim);
    const headV = new Float32Array(seqLen * this.headDim);

    for (let t = 0; t < seqLen; t++) {
      for (let d = 0; d < this.headDim; d++) {
        headK[t * this.headDim + d] = K[t * this.dimension + head * this.headDim + d];
        headV[t * this.headDim + d] = V[t * this.dimension + head * this.headDim + d];
      }
    }

    // Project K and V through low-rank projections
    // [seqLen × headDim] -> [projectedDim × headDim]
    const projectedK = this.projectSequence(headK, this.projE, seqLen, this.headDim);
    const projectedV = this.projectSequence(headV, this.projF, seqLen, this.headDim);

    // Compute attention for each query position
    for (let i = 0; i < seqLen; i++) {
      const qOffset = i * this.dimension + head * this.headDim;
      const outOffset = i * this.headDim;

      // Compute attention scores against projected K
      const scores = new Float32Array(this.projectedDim);
      let maxScore = -Infinity;

      for (let k = 0; k < this.projectedDim; k++) {
        let score = 0;
        for (let d = 0; d < this.headDim; d++) {
          score += Q[qOffset + d] * projectedK[k * this.headDim + d];
        }
        scores[k] = score * this.scale;
        if (scores[k] > maxScore) {
          maxScore = scores[k];
        }
      }

      // Softmax with numerical stability
      let sumExp = 0;
      const expScores = new Float32Array(this.projectedDim);

      for (let k = 0; k < this.projectedDim; k++) {
        expScores[k] = Math.exp(scores[k] - maxScore);
        sumExp += expScores[k];
      }

      // Compute weighted sum of projected values
      for (let d = 0; d < this.headDim; d++) {
        let weightedSum = 0;
        for (let k = 0; k < this.projectedDim; k++) {
          const attnWeight = sumExp > 0 ? expScores[k] / sumExp : 0;
          weightedSum += attnWeight * projectedV[k * this.headDim + d];
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
   * Linformer: 4 × dim² + 2 × maxSeqLen × projectedDim
   */
  getParameterCount(): number {
    return (
      4 * this.dimension * this.dimension +
      2 * this.maxSeqLen * this.projectedDim
    );
  }
}
