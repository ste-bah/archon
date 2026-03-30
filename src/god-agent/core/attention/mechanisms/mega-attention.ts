/**
 * MEGA (Moving Average Equipped Gated Attention)
 *
 * Reference: Ma et al. 2022 "MEGA: Moving Average Equipped Gated Attention"
 *
 * Combines Exponential Moving Average (EMA) with single-head gated attention:
 * - EMA provides efficient local context modeling: h_t = α × x_t + (1-α) × h_{t-1}
 * - Single-head attention captures global dependencies
 * - Gating mechanism blends local (EMA) and global (attention) features
 *
 * Complexity: O(N × d) for EMA + O(N²) for attention
 * Use case: Long sequences requiring both local smoothing and global context
 */

import type { IAttentionMechanism } from '../attention-types.js';
import { VECTOR_DIM } from '../../validation/constants.js';
import {
  SeededRandom,
  xavierUniform,
  matmul,
  hasNaNOrInf,
} from '../utils/index.js';

export interface MegaAttentionConfig {
  dimension?: number;      // Hidden dimension (default: VECTOR_DIM=1536)
  numHeads?: number;       // Number of heads (default: 1, MEGA uses single-head)
  emaAlpha?: number;       // EMA decay factor (default: 0.9, range: 0-1)
  seed?: number;           // Random seed for reproducibility
}

export class RealMegaAttention implements IAttentionMechanism {
  readonly name = 'mega';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly emaAlpha: number;
  private readonly headDim: number;

  // Learnable parameters
  private readonly W_q: Float32Array;  // Query projection
  private readonly W_k: Float32Array;  // Key projection
  private readonly W_v: Float32Array;  // Value projection
  private readonly W_o: Float32Array;  // Output projection
  private readonly W_gate: Float32Array; // Gate projection
  private readonly b_gate: Float32Array; // Gate bias

  // EMA state (persistent across forward passes in same sequence)
  private emaState: Float32Array | null = null;

  constructor(config?: MegaAttentionConfig) {
    this.dimension = config?.dimension ?? VECTOR_DIM;
    this.numHeads = config?.numHeads ?? 1;
    this.emaAlpha = config?.emaAlpha ?? 0.9;

    // Validation
    if (this.dimension <= 0 || !Number.isInteger(this.dimension)) {
      throw new Error('ANTI-009: dimension must be positive integer');
    }
    if (this.numHeads <= 0 || !Number.isInteger(this.numHeads)) {
      throw new Error('ANTI-009: numHeads must be positive integer');
    }
    if (this.dimension % this.numHeads !== 0) {
      throw new Error('ANTI-009: dimension must be divisible by numHeads');
    }
    if (this.emaAlpha < 0 || this.emaAlpha > 1) {
      throw new Error('ANTI-009: emaAlpha must be in range [0, 1]');
    }

    this.headDim = this.dimension / this.numHeads;

    const rng = new SeededRandom(config?.seed ?? 42);

    // Initialize projection matrices (Xavier/Glorot uniform)
    this.W_q = xavierUniform(this.dimension, this.dimension, rng);
    this.W_k = xavierUniform(this.dimension, this.dimension, rng);
    this.W_v = xavierUniform(this.dimension, this.dimension, rng);
    this.W_o = xavierUniform(this.dimension, this.dimension, rng);

    // Initialize gate parameters
    this.W_gate = xavierUniform(this.dimension, this.dimension, rng);
    this.b_gate = new Float32Array(this.dimension); // Zero-initialized bias
  }

  /**
   * Forward pass: EMA + Single-head Attention + Gating
   *
   * @param query - Query tensor (flattened, length seqLen * dimension)
   * @param key - Key tensor (flattened, length seqLen * dimension)
   * @param value - Value tensor (flattened, length seqLen * dimension)
   * @param mask - Optional attention mask (length seqLen)
   * @param seqLen - Sequence length (required)
   * @returns Output tensor (flattened, length seqLen * dimension)
   */
  forward(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    mask?: boolean[],
    seqLen?: number
  ): Float32Array {
    // Validation
    if (!seqLen || seqLen <= 0) {
      throw new Error('ANTI-009: seqLen is required and must be positive');
    }
    if (query.length !== seqLen * this.dimension) {
      throw new Error('ANTI-009: query length must equal seqLen * dimension');
    }
    if (key.length !== seqLen * this.dimension) {
      throw new Error('ANTI-009: key length must equal seqLen * dimension');
    }
    if (value.length !== seqLen * this.dimension) {
      throw new Error('ANTI-009: value length must equal seqLen * dimension');
    }
    if (mask && mask.length !== seqLen) {
      throw new Error('ANTI-009: mask length must equal seqLen');
    }
    if (hasNaNOrInf(query) || hasNaNOrInf(key) || hasNaNOrInf(value)) {
      throw new Error('ANTI-009: input contains NaN or Inf');
    }

    // Step 1: Apply EMA to input (use query as input)
    const emaOutput = this.applyEMA(query, seqLen);

    // Step 2: Apply single-head attention to EMA output
    const attentionOutput = this.applySingleHeadAttention(
      emaOutput,
      emaOutput,
      emaOutput,
      mask,
      seqLen
    );

    // Step 3: Compute gate values
    const gate = this.computeGate(query, seqLen);

    // Step 4: Blend EMA and attention outputs using gate
    const output = new Float32Array(seqLen * this.dimension);
    for (let i = 0; i < seqLen * this.dimension; i++) {
      const g = gate[i];
      output[i] = g * attentionOutput[i] + (1 - g) * emaOutput[i];
    }

    // Validation
    if (hasNaNOrInf(output)) {
      throw new Error('ANTI-009: output contains NaN or Inf');
    }

    return output;
  }

  /**
   * Apply Exponential Moving Average
   * h_t = α × x_t + (1-α) × h_{t-1}
   */
  private applyEMA(input: Float32Array, seqLen: number): Float32Array {
    const output = new Float32Array(seqLen * this.dimension);

    // Initialize or reset EMA state
    if (!this.emaState || this.emaState.length !== this.dimension) {
      this.emaState = new Float32Array(this.dimension); // Zero-initialized
    }

    const alpha = this.emaAlpha;
    const oneMinusAlpha = 1 - alpha;

    // Sequential scan through time steps
    for (let t = 0; t < seqLen; t++) {
      const offset = t * this.dimension;

      for (let d = 0; d < this.dimension; d++) {
        // Update EMA state: h_t = α × x_t + (1-α) × h_{t-1}
        this.emaState[d] = alpha * input[offset + d] + oneMinusAlpha * this.emaState[d];
        output[offset + d] = this.emaState[d];
      }
    }

    return output;
  }

  /**
   * Apply single-head attention (scaled dot-product)
   */
  private applySingleHeadAttention(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    mask: boolean[] | undefined,
    seqLen: number
  ): Float32Array {
    // Project Q, K, V
    const Q = matmul(query, this.W_q, this.dimension);
    const K = matmul(key, this.W_k, this.dimension);
    const V = matmul(value, this.W_v, this.dimension);

    // Compute attention scores: Q × K^T / sqrt(d_k)
    const scale = 1 / Math.sqrt(this.dimension);
    const scores = new Float32Array(seqLen * seqLen);

    for (let i = 0; i < seqLen; i++) {
      for (let j = 0; j < seqLen; j++) {
        let sum = 0;
        for (let k = 0; k < this.dimension; k++) {
          sum += Q[i * this.dimension + k] * K[j * this.dimension + k];
        }
        scores[i * seqLen + j] = sum * scale;
      }
    }

    // Apply mask (set masked positions to -Infinity before softmax)
    if (mask) {
      for (let i = 0; i < seqLen; i++) {
        for (let j = 0; j < seqLen; j++) {
          if (!mask[j]) {
            scores[i * seqLen + j] = -Infinity;
          }
        }
      }
    }

    // Apply softmax to each row
    const attention = this.softmax2D(scores, seqLen, seqLen);

    // Multiply attention weights by V
    const contextVectors = new Float32Array(seqLen * this.dimension);
    for (let i = 0; i < seqLen; i++) {
      for (let d = 0; d < this.dimension; d++) {
        let sum = 0;
        for (let j = 0; j < seqLen; j++) {
          sum += attention[i * seqLen + j] * V[j * this.dimension + d];
        }
        contextVectors[i * this.dimension + d] = sum;
      }
    }

    // Project output
    return matmul(contextVectors, this.W_o, this.dimension);
  }

  /**
   * Compute gate values: sigmoid(W_gate × x + b_gate)
   */
  private computeGate(input: Float32Array, seqLen: number): Float32Array {
    // Linear projection
    const logits = matmul(input, this.W_gate, this.dimension);

    // Add bias and apply sigmoid
    const gate = new Float32Array(seqLen * this.dimension);
    for (let i = 0; i < seqLen * this.dimension; i++) {
      gate[i] = this.sigmoid(logits[i] + this.b_gate[i % this.dimension]);
    }

    return gate;
  }

  /**
   * Softmax over 2D matrix (row-wise)
   */
  private softmax2D(logits: Float32Array, rows: number, cols: number): Float32Array {
    const output = new Float32Array(rows * cols);

    for (let i = 0; i < rows; i++) {
      const rowOffset = i * cols;

      // Find max for numerical stability
      let maxVal = -Infinity;
      for (let j = 0; j < cols; j++) {
        const val = logits[rowOffset + j];
        if (val > maxVal) maxVal = val;
      }

      // Compute exp(x - max) and sum
      let sumExp = 0;
      for (let j = 0; j < cols; j++) {
        const expVal = Math.exp(logits[rowOffset + j] - maxVal);
        output[rowOffset + j] = expVal;
        sumExp += expVal;
      }

      // Normalize
      for (let j = 0; j < cols; j++) {
        output[rowOffset + j] /= sumExp;
      }
    }

    return output;
  }

  /**
   * Sigmoid activation: 1 / (1 + exp(-x))
   */
  private sigmoid(x: number): number {
    if (x >= 0) {
      const z = Math.exp(-x);
      return 1 / (1 + z);
    } else {
      const z = Math.exp(x);
      return z / (1 + z);
    }
  }

  /**
   * Reset EMA state (call between independent sequences)
   */
  resetState(): void {
    this.emaState = null;
  }

  /**
   * Count learnable parameters
   */
  getParameterCount(): number {
    // 4 projection matrices: W_q, W_k, W_v, W_o (each dimension × dimension)
    const projectionParams = 4 * this.dimension * this.dimension;

    // Gate parameters: W_gate (dimension × dimension) + b_gate (dimension)
    const gateParams = this.dimension * this.dimension + this.dimension;

    return projectionParams + gateParams;
  }
}
