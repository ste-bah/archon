/**
 * Memory Compressed Attention Implementation
 *
 * Based on Liu et al. 2018 "Generating Wikipedia by Summarizing Long Sequences"
 *
 * Key Innovation: Reduces memory by compressing Key/Value sequences before attention.
 * - Compression via strided pooling or average pooling
 * - Complexity: O(N × (N/c)) where c is compression factor
 * - Use case: Long document processing where full N² attention is too expensive
 *
 * Architecture:
 * 1. Compress K and V sequences by factor c (default 4)
 * 2. Compute attention between full Q and compressed K,V
 * 3. Query attends to compressed memory, not full sequence
 *
 * @module memory-compressed-attention
 */

import type { IAttentionMechanism } from '../attention-types.js';
import { VECTOR_DIM } from '../../validation/constants.js';
import {
  SeededRandom,
  xavierUniform,
  matmul,
  hasNaNOrInf,
} from '../utils/index.js';

export interface MemoryCompressedAttentionConfig {
  dimension?: number;
  numHeads?: number;
  compressionFactor?: number;
  seed?: number;
}

/**
 * Memory Compressed Attention Mechanism
 *
 * Reduces memory by compressing K,V sequences before computing attention.
 * This allows processing longer sequences with reduced memory footprint.
 */
export class RealMemoryCompressedAttention implements IAttentionMechanism {
  readonly name = 'memory-compressed';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly compressionFactor: number;
  private readonly headDim: number;

  // Projection matrices
  private readonly Wq: Float32Array;
  private readonly Wk: Float32Array;
  private readonly Wv: Float32Array;
  private readonly Wo: Float32Array;

  constructor(config: MemoryCompressedAttentionConfig = {}) {
    this.dimension = config.dimension ?? VECTOR_DIM;
    this.numHeads = config.numHeads ?? 12;
    this.compressionFactor = config.compressionFactor ?? 4;

    // Validation
    if (this.dimension % this.numHeads !== 0) {
      throw new Error(
        `ANTI-009: dimension (${this.dimension}) must be divisible by numHeads (${this.numHeads})`
      );
    }

    if (this.compressionFactor < 1) {
      throw new Error(
        `ANTI-009: compressionFactor must be >= 1, got ${this.compressionFactor}`
      );
    }

    this.headDim = this.dimension / this.numHeads;

    const rng = new SeededRandom(config.seed ?? 42);

    // Initialize projection matrices with Xavier initialization
    this.Wq = xavierUniform(this.dimension, this.dimension, rng);
    this.Wk = xavierUniform(this.dimension, this.dimension, rng);
    this.Wv = xavierUniform(this.dimension, this.dimension, rng);
    this.Wo = xavierUniform(this.dimension, this.dimension, rng);
  }

  /**
   * Forward pass: Compute memory-compressed attention
   *
   * @param query - Query tensor [seqLen, dimension]
   * @param key - Key tensor [seqLen, dimension]
   * @param value - Value tensor [seqLen, dimension]
   * @param mask - Optional attention mask
   * @param seqLen - Sequence length (required)
   * @returns Output tensor [seqLen, dimension]
   */
  forward(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    mask?: boolean[],
    seqLen?: number
  ): Float32Array {
    if (seqLen === undefined) {
      throw new Error('ANTI-009: seqLen is required for memory-compressed attention');
    }

    // Validation
    const expectedSize = seqLen * this.dimension;
    if (query.length !== expectedSize) {
      throw new Error(
        `ANTI-009: query size mismatch. Expected ${expectedSize}, got ${query.length}`
      );
    }
    if (key.length !== expectedSize) {
      throw new Error(
        `ANTI-009: key size mismatch. Expected ${expectedSize}, got ${key.length}`
      );
    }
    if (value.length !== expectedSize) {
      throw new Error(
        `ANTI-009: value size mismatch. Expected ${expectedSize}, got ${value.length}`
      );
    }

    if (hasNaNOrInf(query) || hasNaNOrInf(key) || hasNaNOrInf(value)) {
      throw new Error('ANTI-009: Input contains NaN or Inf values');
    }

    // Step 1: Project Q, K, V
    const Q = matmul(query, this.Wq, this.dimension);
    const K = matmul(key, this.Wk, this.dimension);
    const V = matmul(value, this.Wv, this.dimension);

    // Step 2: Compress K and V sequences
    const compressedLen = Math.ceil(seqLen / this.compressionFactor);
    const K_compressed = this.compressSequence(K, seqLen, compressedLen);
    const V_compressed = this.compressSequence(V, seqLen, compressedLen);

    // Step 3: Reshape for multi-head attention
    // Q: [seqLen, numHeads, headDim]
    // K_compressed: [compressedLen, numHeads, headDim]
    // V_compressed: [compressedLen, numHeads, headDim]
    const Q_heads = this.reshapeToHeads(Q, seqLen);
    const K_heads = this.reshapeToHeads(K_compressed, compressedLen);
    const V_heads = this.reshapeToHeads(V_compressed, compressedLen);

    // Step 4: Compute attention for each head
    const output = new Float32Array(seqLen * this.dimension);

    for (let h = 0; h < this.numHeads; h++) {
      // Extract head slices
      const Q_h = this.extractHead(Q_heads, h, seqLen);
      const K_h = this.extractHead(K_heads, h, compressedLen);
      const V_h = this.extractHead(V_heads, h, compressedLen);

      // Compute attention: Q_h @ K_h^T
      const scores = this.computeAttentionScores(Q_h, K_h, seqLen, compressedLen);

      // Apply mask if provided (compress mask to match compressed length)
      if (mask) {
        const compressedMask = this.compressMask(mask, compressedLen);
        this.applyMask(scores, compressedMask, seqLen, compressedLen);
      }

      // Softmax
      this.applySoftmax(scores, seqLen, compressedLen);

      // Weighted sum: scores @ V_h
      const headOutput = this.weightedSum(scores, V_h, seqLen, compressedLen);

      // Copy to output
      this.copyHeadToOutput(headOutput, output, h, seqLen);
    }

    // Step 5: Output projection
    const result = matmul(output, this.Wo, this.dimension);

    if (hasNaNOrInf(result)) {
      throw new Error('ANTI-009: Output contains NaN or Inf values');
    }

    return result;
  }

  /**
   * Compress sequence using average pooling
   *
   * @param seq - Input sequence [seqLen, dimension]
   * @param seqLen - Original sequence length
   * @param compressedLen - Target compressed length
   * @returns Compressed sequence [compressedLen, dimension]
   */
  private compressSequence(
    seq: Float32Array,
    seqLen: number,
    compressedLen: number
  ): Float32Array {
    const compressed = new Float32Array(compressedLen * this.dimension);

    for (let i = 0; i < compressedLen; i++) {
      const startIdx = Math.floor((i * seqLen) / compressedLen);
      const endIdx = Math.min(
        Math.floor(((i + 1) * seqLen) / compressedLen),
        seqLen
      );
      const windowSize = endIdx - startIdx;

      // Average pooling over the window
      for (let d = 0; d < this.dimension; d++) {
        let sum = 0;
        for (let j = startIdx; j < endIdx; j++) {
          sum += seq[j * this.dimension + d];
        }
        compressed[i * this.dimension + d] = sum / windowSize;
      }
    }

    return compressed;
  }

  /**
   * Compress mask to match compressed sequence length
   */
  private compressMask(mask: boolean[], compressedLen: number): boolean[] {
    const seqLen = mask.length;
    const compressed = new Array(compressedLen);

    for (let i = 0; i < compressedLen; i++) {
      const startIdx = Math.floor((i * seqLen) / compressedLen);
      const endIdx = Math.min(
        Math.floor(((i + 1) * seqLen) / compressedLen),
        seqLen
      );

      // Position is valid if any position in the window is valid
      compressed[i] = false;
      for (let j = startIdx; j < endIdx; j++) {
        if (mask[j]) {
          compressed[i] = true;
          break;
        }
      }
    }

    return compressed;
  }

  /**
   * Reshape to multi-head format
   * [seqLen, dimension] -> [seqLen, numHeads, headDim]
   */
  private reshapeToHeads(tensor: Float32Array, seqLen: number): Float32Array {
    const reshaped = new Float32Array(seqLen * this.dimension);

    for (let i = 0; i < seqLen; i++) {
      for (let h = 0; h < this.numHeads; h++) {
        for (let d = 0; d < this.headDim; d++) {
          const srcIdx = i * this.dimension + h * this.headDim + d;
          const dstIdx = i * this.dimension + h * this.headDim + d;
          reshaped[dstIdx] = tensor[srcIdx];
        }
      }
    }

    return reshaped;
  }

  /**
   * Extract single head from multi-head tensor
   */
  private extractHead(
    tensor: Float32Array,
    headIdx: number,
    seqLen: number
  ): Float32Array {
    const head = new Float32Array(seqLen * this.headDim);

    for (let i = 0; i < seqLen; i++) {
      for (let d = 0; d < this.headDim; d++) {
        const srcIdx = i * this.dimension + headIdx * this.headDim + d;
        const dstIdx = i * this.headDim + d;
        head[dstIdx] = tensor[srcIdx];
      }
    }

    return head;
  }

  /**
   * Compute attention scores: Q @ K^T / sqrt(headDim)
   */
  private computeAttentionScores(
    Q: Float32Array,
    K: Float32Array,
    qLen: number,
    kLen: number
  ): Float32Array {
    const scores = new Float32Array(qLen * kLen);
    const scale = 1.0 / Math.sqrt(this.headDim);

    for (let i = 0; i < qLen; i++) {
      for (let j = 0; j < kLen; j++) {
        let sum = 0;
        for (let d = 0; d < this.headDim; d++) {
          sum += Q[i * this.headDim + d] * K[j * this.headDim + d];
        }
        scores[i * kLen + j] = sum * scale;
      }
    }

    return scores;
  }

  /**
   * Apply mask to attention scores
   */
  private applyMask(
    scores: Float32Array,
    mask: boolean[],
    qLen: number,
    kLen: number
  ): void {
    for (let i = 0; i < qLen; i++) {
      for (let j = 0; j < kLen; j++) {
        if (!mask[j]) {
          scores[i * kLen + j] = -1e9;
        }
      }
    }
  }

  /**
   * Apply softmax to attention scores (stable version)
   */
  private applySoftmax(scores: Float32Array, qLen: number, kLen: number): void {
    for (let i = 0; i < qLen; i++) {
      const rowStart = i * kLen;

      // Find max for numerical stability
      let maxScore = -Infinity;
      for (let j = 0; j < kLen; j++) {
        maxScore = Math.max(maxScore, scores[rowStart + j]);
      }

      // Compute exp and sum
      let sum = 0;
      for (let j = 0; j < kLen; j++) {
        const exp = Math.exp(scores[rowStart + j] - maxScore);
        scores[rowStart + j] = exp;
        sum += exp;
      }

      // Normalize
      for (let j = 0; j < kLen; j++) {
        scores[rowStart + j] /= sum;
      }
    }
  }

  /**
   * Compute weighted sum: scores @ V
   */
  private weightedSum(
    scores: Float32Array,
    V: Float32Array,
    qLen: number,
    vLen: number
  ): Float32Array {
    const output = new Float32Array(qLen * this.headDim);

    for (let i = 0; i < qLen; i++) {
      for (let d = 0; d < this.headDim; d++) {
        let sum = 0;
        for (let j = 0; j < vLen; j++) {
          sum += scores[i * vLen + j] * V[j * this.headDim + d];
        }
        output[i * this.headDim + d] = sum;
      }
    }

    return output;
  }

  /**
   * Copy head output to final output tensor
   */
  private copyHeadToOutput(
    headOutput: Float32Array,
    output: Float32Array,
    headIdx: number,
    seqLen: number
  ): void {
    for (let i = 0; i < seqLen; i++) {
      for (let d = 0; d < this.headDim; d++) {
        const srcIdx = i * this.headDim + d;
        const dstIdx = i * this.dimension + headIdx * this.headDim + d;
        output[dstIdx] = headOutput[srcIdx];
      }
    }
  }

  /**
   * Get total number of trainable parameters
   */
  getParameterCount(): number {
    // 4 projection matrices: Wq, Wk, Wv, Wo
    return 4 * this.dimension * this.dimension;
  }
}
