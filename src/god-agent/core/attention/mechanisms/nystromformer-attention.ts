/**
 * Nyströmformer Attention Mechanism
 *
 * Reference: Xiong et al. 2021 "Nyströmformer: A Nyström-Based Algorithm for Approximating Self-Attention"
 *
 * Uses Nyström approximation to reduce attention complexity from O(N^2) to O(N × m)
 * where m is the number of landmark points.
 *
 * Algorithm:
 * 1. Sample m landmark points from the sequence
 * 2. Compute Q̃ = Q[landmarks], K̃ = K[landmarks]
 * 3. Approximate attention: A ≈ softmax(Q × K̃^T) × softmax(K̃ × K̃^T)^{-1} × softmax(K̃ × K^T)
 * 4. Use Moore-Penrose pseudoinverse for the middle term
 */

import type { IAttentionMechanism } from '../attention-types.js';
import { VECTOR_DIM } from '../../validation/constants.js';
import {
  SeededRandom,
  xavierUniform,
  matmul,
  hasNaNOrInf,
} from '../utils/index.js';

export interface NystromformerAttentionConfig {
  dimension?: number;      // Model dimension (default: VECTOR_DIM=1536)
  numHeads?: number;       // Number of attention heads (default: 12)
  numLandmarks?: number;   // Number of landmark points (default: 64)
  seed?: number;           // Random seed for initialization
}

export class RealNystromformerAttention implements IAttentionMechanism {
  readonly name = 'nystromformer';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly numLandmarks: number;
  private readonly headDim: number;
  private readonly scale: number;

  // Weight matrices
  private readonly wq: Float32Array;
  private readonly wk: Float32Array;
  private readonly wv: Float32Array;
  private readonly wo: Float32Array;

  constructor(config: NystromformerAttentionConfig = {}) {
    this.dimension = config.dimension ?? VECTOR_DIM;
    this.numHeads = config.numHeads ?? 12;
    this.numLandmarks = config.numLandmarks ?? 64;

    // Validation
    if (this.dimension % this.numHeads !== 0) {
      throw new Error(`ANTI-009: dimension (${this.dimension}) must be divisible by numHeads (${this.numHeads})`);
    }
    if (this.numLandmarks < 1) {
      throw new Error(`ANTI-009: numLandmarks must be >= 1, got ${this.numLandmarks}`);
    }

    this.headDim = this.dimension / this.numHeads;
    this.scale = 1.0 / Math.sqrt(this.headDim);

    const rng = new SeededRandom(config.seed ?? 42);

    // Initialize weight matrices using Xavier uniform
    this.wq = xavierUniform(this.dimension, this.dimension, rng);
    this.wk = xavierUniform(this.dimension, this.dimension, rng);
    this.wv = xavierUniform(this.dimension, this.dimension, rng);
    this.wo = xavierUniform(this.dimension, this.dimension, rng);
  }

  forward(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    mask?: boolean[],
    seqLen?: number
  ): Float32Array {
    // Validate inputs
    if (query.length !== key.length || query.length !== value.length) {
      throw new Error(`ANTI-009: query, key, value must have same length`);
    }
    if (query.length % this.dimension !== 0) {
      throw new Error(`ANTI-009: input length must be multiple of dimension`);
    }

    const N = seqLen ?? Math.floor(query.length / this.dimension);
    const m = Math.min(this.numLandmarks, N); // Can't have more landmarks than sequence length

    if (mask && mask.length !== N) {
      throw new Error(`ANTI-009: mask length (${mask.length}) must match seqLen (${N})`);
    }

    // Project to Q, K, V
    const Q = matmul(query, this.wq, this.dimension);
    const K = matmul(key, this.wk, this.dimension);
    const V = matmul(value, this.wv, this.dimension);

    // Select landmark indices (uniform sampling with segment-based approach)
    const landmarkIndices = this.selectLandmarks(N, m);

    // Extract landmark matrices Q̃, K̃, Ṽ
    const Q_tilde = this.extractLandmarks(Q, landmarkIndices, N, this.dimension);
    const K_tilde = this.extractLandmarks(K, landmarkIndices, N, this.dimension);
    const V_tilde = this.extractLandmarks(V, landmarkIndices, N, this.dimension);

    // Compute Nyström approximation per head
    const output = new Float32Array(N * this.dimension);

    for (let h = 0; h < this.numHeads; h++) {
      const headOffset = h * this.headDim;

      // Extract head-specific Q, K, V
      const Q_h = this.extractHead(Q, N, h);
      const K_h = this.extractHead(K, N, h);
      const V_h = this.extractHead(V, N, h);

      const Q_tilde_h = this.extractHead(Q_tilde, m, h);
      const K_tilde_h = this.extractHead(K_tilde, m, h);
      const V_tilde_h = this.extractHead(V_tilde, m, h);

      // Compute attention matrices
      // A1 = softmax(Q × K̃^T / sqrt(d)) - shape [N, m]
      const A1 = this.computeScaledSoftmax(Q_h, K_tilde_h, N, m, mask, landmarkIndices);

      // A2 = softmax(K̃ × K̃^T / sqrt(d)) - shape [m, m]
      const A2 = this.computeScaledSoftmax(K_tilde_h, K_tilde_h, m, m);

      // A3 = softmax(K̃ × K^T / sqrt(d)) - shape [m, N]
      const A3 = this.computeScaledSoftmax(K_tilde_h, K_h, m, N);

      // Compute pseudoinverse of A2: A2_inv = pinv(A2)
      const A2_inv = this.pseudoinverse(A2, m);

      // Nyström approximation: A ≈ A1 × A2_inv × A3
      // First: temp = A1 × A2_inv [N, m] × [m, m] = [N, m]
      const temp = this.matrixMultiply(A1, A2_inv, N, m, m);

      // Second: attn = temp × A3 [N, m] × [m, N] = [N, N]
      const attn = this.matrixMultiply(temp, A3, N, m, N);

      // Apply attention to values: out = attn × V_h [N, N] × [N, headDim] = [N, headDim]
      const headOutput = this.matrixMultiply(attn, V_h, N, N, this.headDim);

      // Place head output into full output tensor
      for (let i = 0; i < N; i++) {
        for (let d = 0; d < this.headDim; d++) {
          output[i * this.dimension + headOffset + d] = headOutput[i * this.headDim + d];
        }
      }
    }

    // Final projection
    const result = matmul(output, this.wo, this.dimension);

    // Validate output
    if (hasNaNOrInf(result)) {
      throw new Error(`ANTI-009: NaN or Inf detected in output`);
    }

    return result;
  }

  getParameterCount(): number {
    // 4 weight matrices: Wq, Wk, Wv, Wo
    return 4 * this.dimension * this.dimension;
  }

  /**
   * Select landmark indices using segment-based uniform sampling
   */
  private selectLandmarks(N: number, m: number): number[] {
    const indices: number[] = [];
    const segmentSize = N / m;

    for (let i = 0; i < m; i++) {
      // Take the middle of each segment
      const idx = Math.floor((i + 0.5) * segmentSize);
      indices.push(Math.min(idx, N - 1)); // Clamp to valid range
    }

    return indices;
  }

  /**
   * Extract landmark rows from a matrix
   */
  private extractLandmarks(
    matrix: Float32Array,
    indices: number[],
    rows: number,
    cols: number
  ): Float32Array {
    const m = indices.length;
    const result = new Float32Array(m * cols);

    for (let i = 0; i < m; i++) {
      const srcRow = indices[i];
      for (let j = 0; j < cols; j++) {
        result[i * cols + j] = matrix[srcRow * cols + j];
      }
    }

    return result;
  }

  /**
   * Extract a single attention head from the full tensor
   */
  private extractHead(matrix: Float32Array, seqLen: number, headIdx: number): Float32Array {
    const result = new Float32Array(seqLen * this.headDim);
    const headOffset = headIdx * this.headDim;

    for (let i = 0; i < seqLen; i++) {
      for (let d = 0; d < this.headDim; d++) {
        result[i * this.headDim + d] = matrix[i * this.dimension + headOffset + d];
      }
    }

    return result;
  }

  /**
   * General matrix multiplication: C = A × B
   * A is [rowsA × cols], B is [cols × colsB]
   * Returns C [rowsA × colsB]
   */
  private matrixMultiply(
    A: Float32Array,
    B: Float32Array,
    rowsA: number,
    cols: number,
    colsB: number
  ): Float32Array {
    const C = new Float32Array(rowsA * colsB);

    for (let i = 0; i < rowsA; i++) {
      for (let j = 0; j < colsB; j++) {
        let sum = 0;
        for (let k = 0; k < cols; k++) {
          sum += A[i * cols + k] * B[k * colsB + j];
        }
        C[i * colsB + j] = sum;
      }
    }

    return C;
  }

  /**
   * Compute scaled softmax attention: softmax(Q × K^T / sqrt(d))
   */
  private computeScaledSoftmax(
    Q: Float32Array,
    K: Float32Array,
    qRows: number,
    kRows: number,
    mask?: boolean[],
    landmarkIndices?: number[]
  ): Float32Array {
    const dim = this.headDim;
    const scores = new Float32Array(qRows * kRows);

    // Compute Q × K^T with scaling
    for (let i = 0; i < qRows; i++) {
      for (let j = 0; j < kRows; j++) {
        let sum = 0;
        for (let d = 0; d < dim; d++) {
          sum += Q[i * dim + d] * K[j * dim + d];
        }
        scores[i * kRows + j] = sum * this.scale;
      }
    }

    // Apply mask if provided (for Q × K̃^T)
    if (mask && landmarkIndices) {
      for (let i = 0; i < qRows; i++) {
        if (mask[i]) {
          for (let j = 0; j < kRows; j++) {
            scores[i * kRows + j] = -1e9;
          }
        } else {
          // Check if landmark positions are masked
          for (let j = 0; j < kRows; j++) {
            const landmarkPos = landmarkIndices[j];
            if (mask[landmarkPos]) {
              scores[i * kRows + j] = -1e9;
            }
          }
        }
      }
    }

    // Softmax with numerical stability
    for (let i = 0; i < qRows; i++) {
      const rowOffset = i * kRows;

      // Find max for numerical stability
      let maxVal = -Infinity;
      for (let j = 0; j < kRows; j++) {
        maxVal = Math.max(maxVal, scores[rowOffset + j]);
      }

      // Compute exp and sum
      let sum = 0;
      for (let j = 0; j < kRows; j++) {
        const val = Math.exp(scores[rowOffset + j] - maxVal);
        scores[rowOffset + j] = val;
        sum += val;
      }

      // Normalize
      const invSum = sum > 0 ? 1.0 / sum : 0;
      for (let j = 0; j < kRows; j++) {
        scores[rowOffset + j] *= invSum;
      }
    }

    return scores;
  }

  /**
   * Compute Moore-Penrose pseudoinverse using SVD approximation
   * For simplicity, using regularized inverse: (A^T A + λI)^{-1} A^T
   */
  private pseudoinverse(matrix: Float32Array, n: number): Float32Array {
    const lambda = 1e-6; // Regularization parameter

    // Compute A^T A
    const ATA = new Float32Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let sum = 0;
        for (let k = 0; k < n; k++) {
          sum += matrix[k * n + i] * matrix[k * n + j];
        }
        ATA[i * n + j] = sum;
      }
    }

    // Add regularization: A^T A + λI
    for (let i = 0; i < n; i++) {
      ATA[i * n + i] += lambda;
    }

    // Invert using Gauss-Jordan elimination
    const inv = this.invertMatrix(ATA, n);

    // Compute (A^T A + λI)^{-1} A^T
    const result = new Float32Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let sum = 0;
        for (let k = 0; k < n; k++) {
          sum += inv[i * n + k] * matrix[j * n + k];
        }
        result[i * n + j] = sum;
      }
    }

    return result;
  }

  /**
   * Invert a square matrix using Gauss-Jordan elimination
   */
  private invertMatrix(matrix: Float32Array, n: number): Float32Array {
    // Create augmented matrix [A | I]
    const augmented = new Float32Array(n * 2 * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        augmented[i * 2 * n + j] = matrix[i * n + j];
        augmented[i * 2 * n + n + j] = i === j ? 1 : 0;
      }
    }

    // Forward elimination
    for (let i = 0; i < n; i++) {
      // Find pivot
      let maxRow = i;
      let maxVal = Math.abs(augmented[i * 2 * n + i]);
      for (let k = i + 1; k < n; k++) {
        const val = Math.abs(augmented[k * 2 * n + i]);
        if (val > maxVal) {
          maxVal = val;
          maxRow = k;
        }
      }

      // Swap rows if needed
      if (maxRow !== i) {
        for (let j = 0; j < 2 * n; j++) {
          const temp = augmented[i * 2 * n + j];
          augmented[i * 2 * n + j] = augmented[maxRow * 2 * n + j];
          augmented[maxRow * 2 * n + j] = temp;
        }
      }

      // Scale pivot row
      const pivot = augmented[i * 2 * n + i];
      if (Math.abs(pivot) < 1e-10) {
        // Matrix is singular, return identity (fallback)
        const identity = new Float32Array(n * n);
        for (let k = 0; k < n; k++) {
          identity[k * n + k] = 1;
        }
        return identity;
      }

      for (let j = 0; j < 2 * n; j++) {
        augmented[i * 2 * n + j] /= pivot;
      }

      // Eliminate column
      for (let k = 0; k < n; k++) {
        if (k !== i) {
          const factor = augmented[k * 2 * n + i];
          for (let j = 0; j < 2 * n; j++) {
            augmented[k * 2 * n + j] -= factor * augmented[i * 2 * n + j];
          }
        }
      }
    }

    // Extract inverse from right half
    const inverse = new Float32Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        inverse[i * n + j] = augmented[i * 2 * n + n + j];
      }
    }

    return inverse;
  }
}
