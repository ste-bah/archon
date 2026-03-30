/**
 * Real Axial Attention Implementation
 *
 * Reference: Axial Attention in Multidimensional Transformers (Ho et al. 2019)
 *
 * Factorizes 2D attention into row and column attention.
 * Reduces O(N²) to O(N√N) by attending along axes separately.
 *
 * For 1D sequences, reshapes to √N × √N grid internally.
 *
 * Use cases:
 * - Image processing
 * - 2D sequence modeling
 * - Vision Transformers
 *
 * Complexity: O(N × √N) = O(N^1.5)
 * Parameter Count: 4 × dim² (shared for both axes)
 *
 * ANTI-009: REAL implementation
 */

import { IAttentionMechanism } from '../attention-types.js';
import { VECTOR_DIM } from '../../validation/constants.js';
import { SeededRandom, xavierUniform, matmul, hasNaNOrInf } from '../utils/index.js';

export class RealAxialAttention implements IAttentionMechanism {
  readonly name = 'axial';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly headDim: number;
  private readonly scale: number;
  private readonly axisSize: number;  // Size of one axis (sqrt of seqLen)

  // Shared weight matrices for both row and column attention
  private readonly wQuery: Float32Array;
  private readonly wKey: Float32Array;
  private readonly wValue: Float32Array;
  private readonly wOutput: Float32Array;

  constructor(config?: {
    dimension?: number;
    numHeads?: number;
    axisSize?: number;   // √N for reshaping (default: inferred)
    seed?: number;
  }) {
    this.dimension = config?.dimension ?? VECTOR_DIM;
    this.numHeads = config?.numHeads ?? 4;

    // Validate heads divide dimension evenly
    if (this.dimension % this.numHeads !== 0) {
      throw new Error(`dimension (${this.dimension}) must be divisible by numHeads (${this.numHeads})`);
    }

    this.headDim = this.dimension / this.numHeads;
    this.scale = 1.0 / Math.sqrt(this.headDim);
    this.axisSize = config?.axisSize ?? 0;  // 0 means infer from sequence length

    const seed = config?.seed ?? 42;
    const rng = new SeededRandom(seed);

    // Initialize weight matrices with Xavier uniform
    this.wQuery = xavierUniform(this.dimension, this.dimension, rng);
    this.wKey = xavierUniform(this.dimension, this.dimension, rng);
    this.wValue = xavierUniform(this.dimension, this.dimension, rng);
    this.wOutput = xavierUniform(this.dimension, this.dimension, rng);
  }

  forward(
    query: Float32Array,
    key?: Float32Array,
    value?: Float32Array,
    mask?: boolean[],
    seqLen?: number
  ): Float32Array {
    // Use query for all if not provided (self-attention)
    const k = key ?? query;
    const v = value ?? query;
    const actualSeqLen = seqLen ?? Math.floor(query.length / this.dimension);

    // Validate input dimensions
    if (query.length !== actualSeqLen * this.dimension) {
      throw new Error(`query length ${query.length} != seqLen * dimension (${actualSeqLen} * ${this.dimension})`);
    }
    if (k.length !== actualSeqLen * this.dimension) {
      throw new Error(`key length ${k.length} != seqLen * dimension`);
    }
    if (v.length !== actualSeqLen * this.dimension) {
      throw new Error(`value length ${v.length} != seqLen * dimension`);
    }

    // Determine grid dimensions
    const axisSize = this.axisSize > 0 ? this.axisSize : Math.ceil(Math.sqrt(actualSeqLen));
    const height = axisSize;
    const width = Math.ceil(actualSeqLen / axisSize);
    const gridSize = height * width;

    // Pad input if necessary
    let paddedQuery = query;
    let paddedKey = k;
    let paddedValue = v;

    if (actualSeqLen < gridSize) {
      paddedQuery = this.padSequence(query, actualSeqLen, gridSize);
      paddedKey = this.padSequence(k, actualSeqLen, gridSize);
      paddedValue = this.padSequence(v, actualSeqLen, gridSize);
    }

    // Project to Q, K, V
    const Q = matmul(paddedQuery, this.wQuery, this.dimension);
    const K = matmul(paddedKey, this.wKey, this.dimension);
    const V = matmul(paddedValue, this.wValue, this.dimension);

    // Perform row attention
    const rowAttnOutput = this.performAxisAttention(Q, K, V, height, width, 'row', mask, actualSeqLen);

    // Perform column attention on the row attention output
    const colAttnOutput = this.performAxisAttention(
      rowAttnOutput, rowAttnOutput, rowAttnOutput,
      height, width, 'column', mask, actualSeqLen
    );

    // Project output
    const output = matmul(colAttnOutput, this.wOutput, this.dimension);

    // Unpad if necessary
    if (actualSeqLen < gridSize) {
      return output.slice(0, actualSeqLen * this.dimension);
    }

    return output;
  }

  /**
   * Perform attention along one axis (row or column)
   */
  private performAxisAttention(
    Q: Float32Array,
    K: Float32Array,
    V: Float32Array,
    height: number,
    width: number,
    axis: 'row' | 'column',
    mask?: boolean[],
    originalSeqLen?: number
  ): Float32Array {
    const gridSize = height * width;
    const output = new Float32Array(gridSize * this.dimension);

    // Temporary buffers for multi-head attention
    const scoresBuffer = new Float32Array(
      axis === 'row' ? width : height
    );
    const attnWeightsBuffer = new Float32Array(scoresBuffer.length);
    const headOutputBuffer = new Float32Array(this.headDim);

    if (axis === 'row') {
      // Row attention: each position attends within its row
      for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
          const posIdx = r * width + c;

          // Skip padded positions
          if (originalSeqLen !== undefined && posIdx >= originalSeqLen) {
            continue;
          }

          // Multi-head attention within the row
          for (let h = 0; h < this.numHeads; h++) {
            const headOffset = h * this.headDim;

            // Compute attention scores for this row
            scoresBuffer.fill(-Infinity);

            for (let col = 0; col < width; col++) {
              const keyIdx = r * width + col;

              // Apply mask or skip padded positions
              if (originalSeqLen !== undefined && keyIdx >= originalSeqLen) {
                continue;
              }
              if (mask && mask[posIdx * gridSize + keyIdx] === false) {
                continue;
              }

              // Compute dot product between query and key for this head
              let score = 0;
              for (let d = 0; d < this.headDim; d++) {
                const qVal = Q[posIdx * this.dimension + headOffset + d];
                const kVal = K[keyIdx * this.dimension + headOffset + d];
                score += qVal * kVal;
              }

              scoresBuffer[col] = score * this.scale;
            }

            // Stable softmax
            this.softmax(scoresBuffer, attnWeightsBuffer);

            // Compute weighted sum of values
            headOutputBuffer.fill(0);
            for (let col = 0; col < width; col++) {
              const valueIdx = r * width + col;
              if (originalSeqLen !== undefined && valueIdx >= originalSeqLen) {
                continue;
              }

              const weight = attnWeightsBuffer[col];
              if (!isFinite(weight)) continue;

              for (let d = 0; d < this.headDim; d++) {
                headOutputBuffer[d] += weight * V[valueIdx * this.dimension + headOffset + d];
              }
            }

            // Copy to output
            for (let d = 0; d < this.headDim; d++) {
              output[posIdx * this.dimension + headOffset + d] = headOutputBuffer[d];
            }
          }
        }
      }
    } else {
      // Column attention: each position attends within its column
      for (let c = 0; c < width; c++) {
        for (let r = 0; r < height; r++) {
          const posIdx = r * width + c;

          // Skip padded positions
          if (originalSeqLen !== undefined && posIdx >= originalSeqLen) {
            continue;
          }

          // Multi-head attention within the column
          for (let h = 0; h < this.numHeads; h++) {
            const headOffset = h * this.headDim;

            // Compute attention scores for this column
            scoresBuffer.fill(-Infinity);

            for (let row = 0; row < height; row++) {
              const keyIdx = row * width + c;

              // Apply mask or skip padded positions
              if (originalSeqLen !== undefined && keyIdx >= originalSeqLen) {
                continue;
              }
              if (mask && mask[posIdx * gridSize + keyIdx] === false) {
                continue;
              }

              // Compute dot product between query and key for this head
              let score = 0;
              for (let d = 0; d < this.headDim; d++) {
                const qVal = Q[posIdx * this.dimension + headOffset + d];
                const kVal = K[keyIdx * this.dimension + headOffset + d];
                score += qVal * kVal;
              }

              scoresBuffer[row] = score * this.scale;
            }

            // Stable softmax
            this.softmax(scoresBuffer, attnWeightsBuffer);

            // Compute weighted sum of values
            headOutputBuffer.fill(0);
            for (let row = 0; row < height; row++) {
              const valueIdx = row * width + c;
              if (originalSeqLen !== undefined && valueIdx >= originalSeqLen) {
                continue;
              }

              const weight = attnWeightsBuffer[row];
              if (!isFinite(weight)) continue;

              for (let d = 0; d < this.headDim; d++) {
                headOutputBuffer[d] += weight * V[valueIdx * this.dimension + headOffset + d];
              }
            }

            // Copy to output
            for (let d = 0; d < this.headDim; d++) {
              output[posIdx * this.dimension + headOffset + d] = headOutputBuffer[d];
            }
          }
        }
      }
    }

    return output;
  }

  /**
   * Stable softmax with max subtraction and epsilon guard
   */
  private softmax(scores: Float32Array, output: Float32Array): void {
    const epsilon = 1e-10;

    // Find max for numerical stability
    let max = -Infinity;
    for (let i = 0; i < scores.length; i++) {
      if (isFinite(scores[i]) && scores[i] > max) {
        max = scores[i];
      }
    }

    // Handle all -Infinity case
    if (!isFinite(max)) {
      output.fill(0);
      return;
    }

    // Compute exp and sum
    let sum = 0;
    for (let i = 0; i < scores.length; i++) {
      if (isFinite(scores[i])) {
        output[i] = Math.exp(scores[i] - max);
        sum += output[i];
      } else {
        output[i] = 0;
      }
    }

    // Normalize
    if (sum > epsilon) {
      for (let i = 0; i < output.length; i++) {
        output[i] /= sum;
      }
    } else {
      // Uniform distribution if sum is too small
      const uniform = 1.0 / scores.length;
      output.fill(uniform);
    }
  }

  /**
   * Pad sequence to target length with zeros
   */
  private padSequence(seq: Float32Array, currentLen: number, targetLen: number): Float32Array {
    const padded = new Float32Array(targetLen * this.dimension);
    padded.set(seq);
    return padded;
  }

  getParameterCount(): number {
    // 4 weight matrices: Q, K, V, Output
    return 4 * this.dimension * this.dimension;
  }
}
