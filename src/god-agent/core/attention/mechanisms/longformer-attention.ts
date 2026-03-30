/**
 * Real Longformer Attention Implementation
 *
 * Reference: Beltagy et al. 2020 "Longformer: The Long-Document Transformer"
 * https://arxiv.org/abs/2004.05150
 *
 * Key insight: Combine sliding window attention (local context) with global attention
 * (selected tokens attend to all positions). This achieves O(N × w) complexity where
 * w is the window size, instead of O(N²).
 *
 * Attention Pattern:
 * - Local: Each token attends to w tokens on each side (sliding window)
 * - Global: Selected tokens (e.g., [CLS], special markers) attend to ALL tokens
 *           and are attended to by ALL tokens
 *
 * Complexity: O(N × (w + g)) where w=window size, g=global tokens
 * Parameter Count: 4 × dim² (same as standard attention)
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
 * Real Longformer Attention Implementation
 *
 * Combines sliding window local attention with global attention for
 * efficient long document processing.
 *
 * @example
 * ```typescript
 * // Create Longformer attention with window size 128
 * const attention = new RealLongformerAttention({
 *   dimension: 768,
 *   numHeads: 8,
 *   windowSize: 128,  // Each side
 *   globalIndices: [0],  // First token is global
 *   seed: 42
 * });
 *
 * // Process long sequence
 * const seqLen = 4096;
 * const query = new Float32Array(seqLen * 768);
 * const output = attention.forward(query, query, query, undefined, seqLen);
 * ```
 */
export class RealLongformerAttention implements IAttentionMechanism {
  readonly name = 'longformer';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly headDim: number;
  private readonly windowSize: number;  // One-sided window size
  private readonly globalIndices: Set<number>;
  private readonly scale: number;

  // Weight matrices [dim × dim]
  private readonly wQuery: Float32Array;
  private readonly wKey: Float32Array;
  private readonly wValue: Float32Array;
  private readonly wOutput: Float32Array;

  // Global attention uses separate projections (as per paper)
  private readonly wQueryGlobal: Float32Array;
  private readonly wKeyGlobal: Float32Array;
  private readonly wValueGlobal: Float32Array;

  private readonly rng?: SeededRandom;

  /**
   * Initialize Longformer attention mechanism
   *
   * @param config Configuration options
   * @param config.dimension Model dimension (default: VECTOR_DIM=1536)
   * @param config.numHeads Number of attention heads (default: 8)
   * @param config.windowSize One-sided window size (default: 64)
   * @param config.globalIndices Indices of global attention tokens (default: [0])
   * @param config.seed Random seed for deterministic initialization (optional)
   *
   * @throws Error if dimension not divisible by numHeads
   * @throws Error if windowSize is not positive
   */
  constructor(config?: {
    dimension?: number;
    numHeads?: number;
    windowSize?: number;
    globalIndices?: number[];
    seed?: number;
  }) {
    this.dimension = config?.dimension ?? VECTOR_DIM;
    this.numHeads = config?.numHeads ?? 8;
    this.windowSize = config?.windowSize ?? 64;
    this.globalIndices = new Set(config?.globalIndices ?? [0]);

    // Validate configuration
    if (this.dimension % this.numHeads !== 0) {
      throw new Error(
        `ANTI-009: Dimension ${this.dimension} must be divisible by numHeads ${this.numHeads}`
      );
    }

    if (this.windowSize < 1) {
      throw new Error(
        `ANTI-009: Window size must be positive, got ${this.windowSize}`
      );
    }

    this.headDim = this.dimension / this.numHeads;
    this.scale = 1.0 / Math.sqrt(this.headDim);

    // Initialize seeded RNG if seed provided (for testing)
    if (config?.seed !== undefined) {
      this.rng = new SeededRandom(config.seed);
    }

    // Initialize local attention weight matrices
    this.wQuery = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wKey = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wValue = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wOutput = xavierUniform(this.dimension, this.dimension, this.rng);

    // Initialize global attention weight matrices (separate projections)
    this.wQueryGlobal = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wKeyGlobal = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wValueGlobal = xavierUniform(this.dimension, this.dimension, this.rng);
  }

  /**
   * Forward pass: Longformer attention with sliding window + global
   *
   * Algorithm:
   * 1. Project Q, K, V (local and global projections)
   * 2. For each position:
   *    a. If global token: compute full attention to all positions
   *    b. Else: compute sliding window attention + attend to global tokens
   * 3. Apply softmax and compute weighted values
   * 4. Concatenate heads and project output
   *
   * @param query Query vectors [seq_len × dimension]
   * @param key Key vectors [seq_len × dimension]
   * @param value Value vectors [seq_len × dimension]
   * @param mask Optional attention mask (combined with window pattern)
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

    // Step 1: Project Q, K, V for local attention
    const qLocal = matmul(query, this.wQuery, this.dimension);
    const kLocal = matmul(key, this.wKey, this.dimension);
    const vLocal = matmul(value, this.wValue, this.dimension);

    // Step 2: Project Q, K, V for global attention
    const qGlobal = matmul(query, this.wQueryGlobal, this.dimension);
    const kGlobal = matmul(key, this.wKeyGlobal, this.dimension);
    const vGlobal = matmul(value, this.wValueGlobal, this.dimension);

    // Step 3: Multi-head attention computation
    const headOutputs: Float32Array[] = [];

    for (let h = 0; h < this.numHeads; h++) {
      const headOutput = this.computeHeadLongformerAttention(
        qLocal, kLocal, vLocal,
        qGlobal, kGlobal, vGlobal,
        h,
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
      throw new Error('ANTI-009: Longformer attention forward pass produced NaN or Inf values');
    }

    return output;
  }

  /**
   * Compute Longformer attention for a single head
   *
   * Attention pattern:
   * - Global tokens (in globalIndices): Full attention to all positions
   * - Local tokens: Sliding window + attention to global tokens
   *
   * @param qLocal Local projected queries
   * @param kLocal Local projected keys
   * @param vLocal Local projected values
   * @param qGlobal Global projected queries
   * @param kGlobal Global projected keys
   * @param vGlobal Global projected values
   * @param head Head index
   * @param seqLen Sequence length
   * @param mask Optional attention mask
   * @returns Head output [seq × headDim]
   */
  private computeHeadLongformerAttention(
    qLocal: Float32Array,
    kLocal: Float32Array,
    vLocal: Float32Array,
    qGlobal: Float32Array,
    kGlobal: Float32Array,
    vGlobal: Float32Array,
    head: number,
    seqLen: number,
    mask?: boolean[]
  ): Float32Array {
    const output = new Float32Array(seqLen * this.headDim);

    for (let i = 0; i < seqLen; i++) {
      const isGlobalToken = this.globalIndices.has(i);
      const outOffset = i * this.headDim;

      if (isGlobalToken) {
        // Global token: full attention using global projections
        this.computeGlobalAttention(
          qGlobal, kGlobal, vGlobal,
          i, head, seqLen, mask, output, outOffset
        );
      } else {
        // Local token: sliding window + global tokens
        this.computeLocalAttention(
          qLocal, kLocal, vLocal,
          qGlobal, kGlobal, vGlobal,
          i, head, seqLen, mask, output, outOffset
        );
      }
    }

    return output;
  }

  /**
   * Compute full global attention for a global token
   */
  private computeGlobalAttention(
    qGlobal: Float32Array,
    kGlobal: Float32Array,
    vGlobal: Float32Array,
    position: number,
    head: number,
    seqLen: number,
    mask: boolean[] | undefined,
    output: Float32Array,
    outOffset: number
  ): void {
    const qOffset = position * this.dimension + head * this.headDim;

    // Compute attention scores to all positions
    const scores = new Float32Array(seqLen);
    let maxScore = -Infinity;

    for (let j = 0; j < seqLen; j++) {
      // Check mask
      if (mask && !mask[position * seqLen + j]) {
        scores[j] = -Infinity;
        continue;
      }

      const kOffset = j * this.dimension + head * this.headDim;
      let score = 0;

      for (let d = 0; d < this.headDim; d++) {
        score += qGlobal[qOffset + d] * kGlobal[kOffset + d];
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

    // Compute weighted sum of values
    for (let d = 0; d < this.headDim; d++) {
      let weightedSum = 0;

      for (let j = 0; j < seqLen; j++) {
        const attnWeight = sumExp > 0 ? expScores[j] / sumExp : 0;
        const vOffset = j * this.dimension + head * this.headDim;
        weightedSum += attnWeight * vGlobal[vOffset + d];
      }

      output[outOffset + d] = weightedSum;
    }
  }

  /**
   * Compute local sliding window attention (+ global tokens)
   */
  private computeLocalAttention(
    qLocal: Float32Array,
    kLocal: Float32Array,
    vLocal: Float32Array,
    _qGlobal: Float32Array,
    kGlobal: Float32Array,
    vGlobal: Float32Array,
    position: number,
    head: number,
    seqLen: number,
    mask: boolean[] | undefined,
    output: Float32Array,
    outOffset: number
  ): void {
    const qOffset = position * this.dimension + head * this.headDim;

    // Determine which positions to attend to
    const windowStart = Math.max(0, position - this.windowSize);
    const windowEnd = Math.min(seqLen - 1, position + this.windowSize);

    // Collect all attended positions (window + global)
    const attendedPositions: Array<{
      index: number;
      isGlobal: boolean;
    }> = [];

    // Add window positions
    for (let j = windowStart; j <= windowEnd; j++) {
      if (!this.globalIndices.has(j)) {
        attendedPositions.push({ index: j, isGlobal: false });
      }
    }

    // Add global positions (always attend to them)
    const globalArray = Array.from(this.globalIndices);
    for (let gi = 0; gi < globalArray.length; gi++) {
      const globalIdx = globalArray[gi];
      if (globalIdx < seqLen) {
        attendedPositions.push({ index: globalIdx, isGlobal: true });
      }
    }

    // Compute attention scores
    const scores = new Float32Array(attendedPositions.length);
    let maxScore = -Infinity;

    for (let a = 0; a < attendedPositions.length; a++) {
      const { index: j, isGlobal } = attendedPositions[a];

      // Check mask
      if (mask && !mask[position * seqLen + j]) {
        scores[a] = -Infinity;
        continue;
      }

      // Use appropriate projections
      const k = isGlobal ? kGlobal : kLocal;
      const kOffset = j * this.dimension + head * this.headDim;

      let score = 0;
      for (let d = 0; d < this.headDim; d++) {
        score += qLocal[qOffset + d] * k[kOffset + d];
      }

      scores[a] = score * this.scale;
      if (scores[a] > maxScore) {
        maxScore = scores[a];
      }
    }

    // Softmax with numerical stability
    let sumExp = 0;
    const expScores = new Float32Array(attendedPositions.length);

    for (let a = 0; a < attendedPositions.length; a++) {
      if (scores[a] === -Infinity) {
        expScores[a] = 0;
      } else {
        expScores[a] = Math.exp(scores[a] - maxScore);
        sumExp += expScores[a];
      }
    }

    // Compute weighted sum of values
    for (let d = 0; d < this.headDim; d++) {
      let weightedSum = 0;

      for (let a = 0; a < attendedPositions.length; a++) {
        const { index: j, isGlobal } = attendedPositions[a];
        const attnWeight = sumExp > 0 ? expScores[a] / sumExp : 0;
        const v = isGlobal ? vGlobal : vLocal;
        const vOffset = j * this.dimension + head * this.headDim;
        weightedSum += attnWeight * v[vOffset + d];
      }

      output[outOffset + d] = weightedSum;
    }
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
   * Longformer uses 7 weight matrices:
   * - Local: Wq, Wk, Wv (3 × dim²)
   * - Global: Wq_global, Wk_global, Wv_global (3 × dim²)
   * - Output: Wo (dim²)
   *
   * Total: 7 × dim²
   */
  getParameterCount(): number {
    return 7 * this.dimension * this.dimension;
  }
}
