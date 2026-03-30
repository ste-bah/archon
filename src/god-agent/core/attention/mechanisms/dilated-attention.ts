/**
 * Real Dilated Attention Implementation
 *
 * Reference: Inspired by dilated convolutions (WaveNet, etc.)
 *
 * Attends to positions at regular intervals (dilation factor).
 * Efficiently captures long-range dependencies.
 *
 * Use cases:
 * - Long sequence modeling
 * - Hierarchical attention (multi-scale)
 * - Audio/speech processing
 *
 * Complexity: O(N × N/D) where D is dilation factor
 * Parameter Count: 4 × dim²
 *
 * ANTI-009: REAL implementation
 */

import { IAttentionMechanism } from '../attention-types.js';
import { SeededRandom, xavierUniform, matmul, hasNaNOrInf } from '../utils/index.js';

export class RealDilatedAttention implements IAttentionMechanism {
  readonly name = 'dilated';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly headDim: number;
  private readonly scale: number;
  private readonly dilation: number;  // Dilation factor (default: 2)

  // Weight matrices (stored as flat arrays: row-major)
  private readonly wQuery: Float32Array;
  private readonly wKey: Float32Array;
  private readonly wValue: Float32Array;
  private readonly wOutput: Float32Array;

  constructor(config?: {
    dimension?: number;
    numHeads?: number;
    dilation?: number;  // Dilation factor (default: 2)
    seed?: number;
  }) {
    this.dimension = config?.dimension ?? 64;
    this.numHeads = config?.numHeads ?? 8;
    this.dilation = config?.dilation ?? 2;

    // Validation
    if (this.dimension <= 0 || !Number.isInteger(this.dimension)) {
      throw new Error(`Dimension must be a positive integer, got ${this.dimension}`);
    }
    if (this.numHeads <= 0 || !Number.isInteger(this.numHeads)) {
      throw new Error(`numHeads must be a positive integer, got ${this.numHeads}`);
    }
    if (this.dimension % this.numHeads !== 0) {
      throw new Error(`Dimension ${this.dimension} must be divisible by numHeads ${this.numHeads}`);
    }
    if (this.dilation < 1 || !Number.isInteger(this.dilation)) {
      throw new Error(`Dilation must be an integer >= 1, got ${this.dilation}`);
    }

    this.headDim = this.dimension / this.numHeads;
    this.scale = 1.0 / Math.sqrt(this.headDim);

    const seed = config?.seed ?? 42;
    const rng = new SeededRandom(seed);

    // Initialize weight matrices with Xavier uniform
    this.wQuery = xavierUniform(this.dimension, this.dimension, rng);
    this.wKey = xavierUniform(this.dimension, this.dimension, rng);
    this.wValue = xavierUniform(this.dimension, this.dimension, rng);
    this.wOutput = xavierUniform(this.dimension, this.dimension, rng);

    // Validate initialization
    if (hasNaNOrInf(this.wQuery) || hasNaNOrInf(this.wKey) ||
      hasNaNOrInf(this.wValue) || hasNaNOrInf(this.wOutput)) {
      throw new Error('Weight initialization produced NaN or Inf values');
    }
  }

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
    if (query.length !== N * this.dimension) {
      throw new Error(`Query length ${query.length} inconsistent with seqLen ${N} and dimension ${this.dimension}`);
    }
    if (key.length !== N * this.dimension) {
      throw new Error(`Key length ${key.length} inconsistent with seqLen ${N}`);
    }
    if (value.length !== N * this.dimension) {
      throw new Error(`Value length ${value.length} inconsistent with seqLen ${N}`);
    }
    if (mask && mask.length !== N * N) {
      throw new Error(`Mask length ${mask.length} inconsistent with seqLen ${N}`);
    }

    // Project Q, K, V
    const Q = matmul(query, this.wQuery, this.dimension);
    const K = matmul(key, this.wKey, this.dimension);
    const V = matmul(value, this.wValue, this.dimension);

    // Validate projections
    if (hasNaNOrInf(Q) || hasNaNOrInf(K) || hasNaNOrInf(V)) {
      throw new Error('NaN or Inf detected after QKV projection');
    }

    // Output buffer
    const output = new Float32Array(N * this.dimension);

    // Buffers for attention computation
    const scores = new Float32Array(N);  // Max size, but we'll only use dilated positions
    const weights = new Float32Array(N);

    // For each position i
    for (let i = 0; i < N; i++) {
      const iModDilation = i % this.dilation;

      // Compute dilated positions: j where j % dilation == i % dilation
      const dilatedPositions: number[] = [];
      for (let j = 0; j < N; j++) {
        if (j % this.dilation === iModDilation) {
          dilatedPositions.push(j);
        }
      }

      const numDilated = dilatedPositions.length;

      // For each head
      for (let h = 0; h < this.numHeads; h++) {
        const headOffset = h * this.headDim;

        // Compute attention scores for dilated positions only
        let maxScore = -Infinity;
        for (let dIdx = 0; dIdx < numDilated; dIdx++) {
          const j = dilatedPositions[dIdx];

          // Dot product Q[i] · K[j]
          let dotProduct = 0.0;
          for (let d = 0; d < this.headDim; d++) {
            const qIdx = i * this.dimension + headOffset + d;
            const kIdx = j * this.dimension + headOffset + d;
            dotProduct += Q[qIdx] * K[kIdx];
          }

          // Scale by 1/sqrt(headDim)
          let score = dotProduct * this.scale;

          // Apply mask if provided
          if (mask) {
            const maskValue = mask[i * N + j];
            if (maskValue === false) {
              score = -Infinity;
            }
          }

          scores[dIdx] = score;
          maxScore = Math.max(maxScore, score);
        }

        // Numerically stable softmax over dilated positions
        let sumExp = 0.0;
        for (let dIdx = 0; dIdx < numDilated; dIdx++) {
          const expScore = scores[dIdx] === -Infinity ? 0.0 : Math.exp(scores[dIdx] - maxScore);
          weights[dIdx] = expScore;
          sumExp += expScore;
        }

        // Normalize with epsilon guard
        const epsilon = 1e-10;
        const invSum = sumExp > epsilon ? 1.0 / sumExp : 0.0;
        for (let dIdx = 0; dIdx < numDilated; dIdx++) {
          weights[dIdx] *= invSum;
        }

        // Validate weights
        if (hasNaNOrInf(weights.subarray(0, numDilated))) {
          throw new Error(`NaN or Inf in attention weights at position ${i}, head ${h}`);
        }

        // Weighted sum of values at dilated positions
        for (let d = 0; d < this.headDim; d++) {
          let sum = 0.0;
          for (let dIdx = 0; dIdx < numDilated; dIdx++) {
            const j = dilatedPositions[dIdx];
            const vIdx = j * this.dimension + headOffset + d;
            sum += weights[dIdx] * V[vIdx];
          }
          const outIdx = i * this.dimension + headOffset + d;
          output[outIdx] = sum;
        }
      }
    }

    // Validate pre-projection output
    if (hasNaNOrInf(output)) {
      throw new Error('NaN or Inf in attention output before final projection');
    }

    // Final output projection
    const finalOutput = matmul(output, this.wOutput, this.dimension);

    // Final validation
    if (hasNaNOrInf(finalOutput)) {
      throw new Error('NaN or Inf in final attention output');
    }

    return finalOutput;
  }

  getParameterCount(): number {
    return 4 * this.dimension * this.dimension;
  }
}
