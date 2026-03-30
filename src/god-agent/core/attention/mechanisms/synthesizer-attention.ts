/**
 * Synthesizer Attention Implementation
 *
 * Based on "Synthesizer: Rethinking Self-Attention for Transformer Models" (Tay et al., 2021)
 *
 * Key insight: Attention patterns can be synthesized directly through learned weights
 * rather than computed via Q·K dot products. This is useful when content-based attention
 * isn't necessary and can be more parameter-efficient.
 *
 * Algorithm (Dense Synthesizer):
 * 1. Project input through learned weights: H = ReLU(X · W1)
 * 2. Generate attention logits: A = H · W2
 * 3. Apply softmax: α = softmax(A)
 * 4. Weighted sum of values: output = α · V
 *
 * ANTI-009: All validation errors prefixed with ANTI-009
 */

import type { IAttentionMechanism } from '../attention-types.js';
import { VECTOR_DIM } from '../../validation/constants.js';
import {
  SeededRandom,
  xavierUniform,
  matmul,
  hasNaNOrInf,
} from '../utils/index.js';

export interface SynthesizerAttentionConfig {
  dimension?: number;      // Feature dimension (default: VECTOR_DIM=1536)
  numHeads?: number;       // Number of attention heads (default: 12)
  maxSeqLen?: number;      // Maximum sequence length for learned patterns (default: 512)
  bottleneck?: number;     // Bottleneck dimension (default: dimension / 2)
  seed?: number;           // Random seed for weight initialization
}

/**
 * Dense Synthesizer Attention
 *
 * Learns attention patterns directly through a two-layer network:
 * - W1: [dimension → bottleneck] - First projection
 * - W2: [bottleneck → maxSeqLen] - Second projection to attention logits
 *
 * Features:
 * - Content-independent attention synthesis
 * - Learned attention patterns
 * - More parameter-efficient than full Q·K attention for long sequences
 * - Deterministic with seed
 */
export class RealSynthesizerAttention implements IAttentionMechanism {
  readonly name = 'synthesizer';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly maxSeqLen: number;
  private readonly bottleneck: number;
  private readonly headDim: number;

  // Learned weights for attention synthesis
  // W1: [dimension → bottleneck] per head
  private readonly w1: Float32Array[];
  // W2: [bottleneck → maxSeqLen] per head
  private readonly w2: Float32Array[];
  // Biases
  private readonly b1: Float32Array[];
  private readonly b2: Float32Array[];

  // Value projection weights (still needed)
  private readonly wv: Float32Array[];
  private readonly wo: Float32Array; // Output projection

  private readonly rng: SeededRandom;

  constructor(config: SynthesizerAttentionConfig = {}) {
    this.dimension = config.dimension ?? VECTOR_DIM;
    this.numHeads = config.numHeads ?? 12;
    this.maxSeqLen = config.maxSeqLen ?? 512;
    this.bottleneck = config.bottleneck ?? Math.floor(this.dimension / 2);

    // Validate configuration
    if (this.dimension <= 0 || !Number.isFinite(this.dimension)) {
      throw new Error('ANTI-009: dimension must be positive and finite');
    }
    if (this.numHeads <= 0 || !Number.isInteger(this.numHeads)) {
      throw new Error('ANTI-009: numHeads must be positive integer');
    }
    if (this.dimension % this.numHeads !== 0) {
      throw new Error('ANTI-009: dimension must be divisible by numHeads');
    }
    if (this.maxSeqLen <= 0 || !Number.isInteger(this.maxSeqLen)) {
      throw new Error('ANTI-009: maxSeqLen must be positive integer');
    }
    if (this.bottleneck <= 0 || !Number.isInteger(this.bottleneck)) {
      throw new Error('ANTI-009: bottleneck must be positive integer');
    }

    this.headDim = this.dimension / this.numHeads;
    this.rng = new SeededRandom(config.seed ?? 42);

    // Initialize synthesis network weights
    this.w1 = [];
    this.w2 = [];
    this.b1 = [];
    this.b2 = [];

    for (let h = 0; h < this.numHeads; h++) {
      // W1: [dimension → bottleneck]
      this.w1[h] = xavierUniform(this.dimension, this.bottleneck, this.rng);
      this.b1[h] = new Float32Array(this.bottleneck);

      // W2: [bottleneck → maxSeqLen]
      this.w2[h] = xavierUniform(this.bottleneck, this.maxSeqLen, this.rng);
      this.b2[h] = new Float32Array(this.maxSeqLen);
    }

    // Value projection weights
    this.wv = [];
    for (let h = 0; h < this.numHeads; h++) {
      this.wv[h] = xavierUniform(this.dimension, this.headDim, this.rng);
    }

    // Output projection: [dimension → dimension]
    this.wo = xavierUniform(this.dimension, this.dimension, this.rng);
  }

  /**
   * Forward pass
   *
   * @param query - Input used for attention synthesis (shape: [seqLen * dimension])
   * @param key - Ignored in pure synthesizer (can be same as query)
   * @param value - Values to attend over (shape: [seqLen * dimension])
   * @param mask - Optional attention mask (shape: [seqLen])
   * @param seqLen - Sequence length (required)
   */
  forward(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    mask?: boolean[],
    seqLen?: number
  ): Float32Array {
    // Validate inputs
    if (!seqLen || seqLen <= 0) {
      throw new Error('ANTI-009: seqLen must be provided and positive');
    }
    if (seqLen > this.maxSeqLen) {
      throw new Error(`ANTI-009: seqLen (${seqLen}) exceeds maxSeqLen (${this.maxSeqLen})`);
    }

    const expectedLen = seqLen * this.dimension;
    if (query.length !== expectedLen) {
      throw new Error(`ANTI-009: query length ${query.length} !== expected ${expectedLen}`);
    }
    if (value.length !== expectedLen) {
      throw new Error(`ANTI-009: value length ${value.length} !== expected ${expectedLen}`);
    }

    if (hasNaNOrInf(query)) {
      throw new Error('ANTI-009: query contains NaN or Inf');
    }
    if (hasNaNOrInf(value)) {
      throw new Error('ANTI-009: value contains NaN or Inf');
    }

    if (mask && mask.length !== seqLen) {
      throw new Error(`ANTI-009: mask length ${mask.length} !== seqLen ${seqLen}`);
    }

    // Multi-head output buffers
    const headOutputs: Float32Array[] = [];

    // Process each head
    for (let h = 0; h < this.numHeads; h++) {
      // 1. Synthesize attention patterns
      const attnWeights = this.synthesizeAttention(query, seqLen, h, mask);

      // 2. Project values
      const V = this.projectValues(value, seqLen, h);

      // 3. Apply attention: output = α · V
      const headOutput = this.applyAttention(attnWeights, V, seqLen);
      headOutputs.push(headOutput);
    }

    // 4. Concatenate heads and project
    const concat = this.concatenateHeads(headOutputs, seqLen);
    const output = this.projectOutput(concat, seqLen);

    // Final validation
    if (hasNaNOrInf(output)) {
      throw new Error('ANTI-009: output contains NaN or Inf');
    }

    return output;
  }

  /**
   * Synthesize attention patterns through learned network
   *
   * @param input - Input tensor (shape: [seqLen * dimension])
   * @param seqLen - Sequence length
   * @param headIdx - Head index
   * @param mask - Optional mask
   * @returns Attention weights (shape: [seqLen * seqLen])
   */
  private synthesizeAttention(
    input: Float32Array,
    seqLen: number,
    headIdx: number,
    mask?: boolean[]
  ): Float32Array {
    const w1 = this.w1[headIdx];
    const w2 = this.w2[headIdx];
    const b1 = this.b1[headIdx];
    const b2 = this.b2[headIdx];

    // For each position, synthesize attention logits
    const attnLogits = new Float32Array(seqLen * seqLen);

    for (let i = 0; i < seqLen; i++) {
      // Extract position vector: [dimension]
      const x = new Float32Array(this.dimension);
      for (let d = 0; d < this.dimension; d++) {
        x[d] = input[i * this.dimension + d];
      }

      // H = ReLU(x · W1 + b1): [bottleneck]
      const h = new Float32Array(this.bottleneck);
      for (let j = 0; j < this.bottleneck; j++) {
        let sum = b1[j];
        for (let d = 0; d < this.dimension; d++) {
          sum += x[d] * w1[d * this.bottleneck + j];
        }
        h[j] = Math.max(0, sum); // ReLU
      }

      // A = h · W2 + b2: [maxSeqLen]
      const logits = new Float32Array(this.maxSeqLen);
      for (let j = 0; j < this.maxSeqLen; j++) {
        let sum = b2[j];
        for (let k = 0; k < this.bottleneck; k++) {
          sum += h[k] * w2[k * this.maxSeqLen + j];
        }
        logits[j] = sum;
      }

      // Extract logits for actual sequence length
      const posLogits = logits.slice(0, seqLen);

      // Apply mask if provided
      if (mask) {
        for (let j = 0; j < seqLen; j++) {
          if (!mask[j]) {
            posLogits[j] = -1e9; // Large negative value
          }
        }
      }

      // Stable softmax
      const weights = this.softmax(posLogits);

      // Store in output
      for (let j = 0; j < seqLen; j++) {
        attnLogits[i * seqLen + j] = weights[j];
      }
    }

    return attnLogits;
  }

  /**
   * Stable softmax implementation
   */
  private softmax(logits: Float32Array): Float32Array {
    const n = logits.length;
    const output = new Float32Array(n);

    // Find max for numerical stability
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      if (logits[i] > max) {
        max = logits[i];
      }
    }

    // Compute exp(x - max) and sum
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const exp = Math.exp(logits[i] - max);
      output[i] = exp;
      sum += exp;
    }

    // Normalize
    if (sum > 0) {
      for (let i = 0; i < n; i++) {
        output[i] /= sum;
      }
    } else {
      // Uniform distribution as fallback
      const uniform = 1.0 / n;
      for (let i = 0; i < n; i++) {
        output[i] = uniform;
      }
    }

    return output;
  }

  /**
   * Project values for a single head
   */
  private projectValues(
    value: Float32Array,
    seqLen: number,
    headIdx: number
  ): Float32Array {
    const wv = this.wv[headIdx];
    const V = new Float32Array(seqLen * this.headDim);

    for (let i = 0; i < seqLen; i++) {
      for (let d = 0; d < this.headDim; d++) {
        let sum = 0;
        for (let k = 0; k < this.dimension; k++) {
          sum += value[i * this.dimension + k] * wv[k * this.headDim + d];
        }
        V[i * this.headDim + d] = sum;
      }
    }

    return V;
  }

  /**
   * Apply attention weights to values
   */
  private applyAttention(
    attnWeights: Float32Array,
    V: Float32Array,
    seqLen: number
  ): Float32Array {
    const output = new Float32Array(seqLen * this.headDim);

    for (let i = 0; i < seqLen; i++) {
      for (let d = 0; d < this.headDim; d++) {
        let sum = 0;
        for (let j = 0; j < seqLen; j++) {
          const weight = attnWeights[i * seqLen + j];
          sum += weight * V[j * this.headDim + d];
        }
        output[i * this.headDim + d] = sum;
      }
    }

    return output;
  }

  /**
   * Concatenate multi-head outputs
   */
  private concatenateHeads(
    headOutputs: Float32Array[],
    seqLen: number
  ): Float32Array {
    const concat = new Float32Array(seqLen * this.dimension);

    for (let i = 0; i < seqLen; i++) {
      for (let h = 0; h < this.numHeads; h++) {
        for (let d = 0; d < this.headDim; d++) {
          const srcIdx = i * this.headDim + d;
          const dstIdx = i * this.dimension + h * this.headDim + d;
          concat[dstIdx] = headOutputs[h][srcIdx];
        }
      }
    }

    return concat;
  }

  /**
   * Project concatenated output
   */
  private projectOutput(
    concat: Float32Array,
    seqLen: number
  ): Float32Array {
    const output = new Float32Array(seqLen * this.dimension);

    for (let i = 0; i < seqLen; i++) {
      for (let d = 0; d < this.dimension; d++) {
        let sum = 0;
        for (let k = 0; k < this.dimension; k++) {
          sum += concat[i * this.dimension + k] * this.wo[k * this.dimension + d];
        }
        output[i * this.dimension + d] = sum;
      }
    }

    return output;
  }

  /**
   * Get total parameter count
   *
   * Parameters per head:
   * - W1: dimension * bottleneck
   * - b1: bottleneck
   * - W2: bottleneck * maxSeqLen
   * - b2: maxSeqLen
   * - Wv: dimension * headDim
   *
   * Shared:
   * - Wo: dimension * dimension
   */
  getParameterCount(): number {
    const perHead =
      this.dimension * this.bottleneck +  // W1
      this.bottleneck +                   // b1
      this.bottleneck * this.maxSeqLen +  // W2
      this.maxSeqLen +                    // b2
      this.dimension * this.headDim;      // Wv

    const shared = this.dimension * this.dimension; // Wo

    return perHead * this.numHeads + shared;
  }
}
