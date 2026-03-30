/**
 * Set Transformer Attention Implementation
 *
 * Based on "Set Transformer: A Framework for Attention-based Permutation-Invariant Neural Networks"
 * (Lee et al. 2019)
 *
 * Key Features:
 * - Uses inducing points to reduce O(N²) complexity to O(N×m + m²)
 * - Permutation invariant - order of inputs doesn't matter
 * - Efficient for large sets with no sequential structure
 * - ISAB (Induced Set Attention Block) architecture
 *
 * Algorithm:
 * 1. Learn m inducing points I (trainable parameters)
 * 2. H = MAB(I, X) - inducing points attend to input
 * 3. output = MAB(X, H) - input attends to inducing points
 *
 * where MAB is a Multi-head Attention Block
 */

import type { IAttentionMechanism } from '../attention-types.js';
import { VECTOR_DIM } from '../../validation/constants.js';
import {
  SeededRandom,
  xavierUniform,
  matmul,
  hasNaNOrInf,
} from '../utils/index.js';

export interface SetTransformerConfig {
  dimension?: number;         // Embedding dimension (default: VECTOR_DIM=1536)
  numHeads?: number;          // Number of attention heads (default: 12)
  numInducingPoints?: number; // Number of inducing points m (default: 32)
  seed?: number;              // Random seed for initialization
}

/**
 * Multi-head Attention Block (MAB)
 *
 * Computes: Attention(Q_proj, K_proj, V_proj) + residual
 * Where Q comes from first input, K/V from second input
 */
class MultiheadAttentionBlock {
  private queryProj: Float32Array;
  private keyProj: Float32Array;
  private valueProj: Float32Array;
  private outputProj: Float32Array;

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly headDim: number;

  constructor(
    dimension: number,
    numHeads: number,
    rng: SeededRandom
  ) {
    this.dimension = dimension;
    this.numHeads = numHeads;
    this.headDim = Math.floor(dimension / numHeads);

    // Initialize projection matrices with Xavier uniform
    this.queryProj = xavierUniform(dimension, dimension, rng);
    this.keyProj = xavierUniform(dimension, dimension, rng);
    this.valueProj = xavierUniform(dimension, dimension, rng);
    this.outputProj = xavierUniform(dimension, dimension, rng);
  }

  /**
   * Forward pass of MAB
   *
   * @param queries - Query vectors (seqLenQ × dimension)
   * @param keysValues - Key/Value vectors (seqLenKV × dimension)
   * @returns Attention output (seqLenQ × dimension)
   */
  forward(
    queries: Float32Array,
    keysValues: Float32Array,
    seqLenQ: number,
    seqLenKV: number
  ): Float32Array {
    // Project inputs
    const Q = matmul(queries, this.queryProj, this.dimension);
    const K = matmul(keysValues, this.keyProj, this.dimension);
    const V = matmul(keysValues, this.valueProj, this.dimension);

    // Multi-head attention
    const attended = this.multiheadAttention(Q, K, V, seqLenQ, seqLenKV);

    // Output projection
    const output = matmul(attended, this.outputProj, this.dimension);

    // Residual connection (add queries)
    for (let i = 0; i < seqLenQ * this.dimension; i++) {
      output[i] += queries[i];
    }

    return output;
  }

  private multiheadAttention(
    Q: Float32Array,
    K: Float32Array,
    V: Float32Array,
    seqLenQ: number,
    seqLenKV: number
  ): Float32Array {
    const output = new Float32Array(seqLenQ * this.dimension);
    const scale = 1.0 / Math.sqrt(this.headDim);

    // Process each head independently
    for (let h = 0; h < this.numHeads; h++) {
      const headOffset = h * this.headDim;

      // Compute attention scores for this head
      const scores = new Float32Array(seqLenQ * seqLenKV);

      for (let i = 0; i < seqLenQ; i++) {
        for (let j = 0; j < seqLenKV; j++) {
          let score = 0;
          for (let d = 0; d < this.headDim; d++) {
            const qIdx = i * this.dimension + headOffset + d;
            const kIdx = j * this.dimension + headOffset + d;
            score += Q[qIdx] * K[kIdx];
          }
          scores[i * seqLenKV + j] = score * scale;
        }
      }

      // Apply softmax (with numerical stability)
      for (let i = 0; i < seqLenQ; i++) {
        const rowOffset = i * seqLenKV;

        // Find max for stability
        let maxScore = -Infinity;
        for (let j = 0; j < seqLenKV; j++) {
          maxScore = Math.max(maxScore, scores[rowOffset + j]);
        }

        // Exp and sum
        let sum = 0;
        for (let j = 0; j < seqLenKV; j++) {
          const idx = rowOffset + j;
          scores[idx] = Math.exp(scores[idx] - maxScore);
          sum += scores[idx];
        }

        // Normalize
        if (sum > 0) {
          for (let j = 0; j < seqLenKV; j++) {
            scores[rowOffset + j] /= sum;
          }
        }
      }

      // Apply attention to values
      for (let i = 0; i < seqLenQ; i++) {
        for (let d = 0; d < this.headDim; d++) {
          let attended = 0;
          for (let j = 0; j < seqLenKV; j++) {
            const weight = scores[i * seqLenKV + j];
            const vIdx = j * this.dimension + headOffset + d;
            attended += weight * V[vIdx];
          }
          output[i * this.dimension + headOffset + d] = attended;
        }
      }
    }

    return output;
  }

  getParameterCount(): number {
    return (
      this.queryProj.length +
      this.keyProj.length +
      this.valueProj.length +
      this.outputProj.length
    );
  }
}

/**
 * Set Transformer Attention using Induced Set Attention Blocks (ISAB)
 *
 * Efficient attention for sets with no inherent ordering.
 * Complexity: O(N×m + m²) instead of O(N²)
 */
export class RealSetTransformerAttention implements IAttentionMechanism {
  readonly name = 'set-transformer';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly numInducingPoints: number;

  private readonly inducingPoints: Float32Array;
  private readonly mab1: MultiheadAttentionBlock; // I → X
  private readonly mab2: MultiheadAttentionBlock; // X → H

  constructor(config: SetTransformerConfig = {}) {
    this.dimension = config.dimension ?? VECTOR_DIM;
    this.numHeads = config.numHeads ?? 12;
    this.numInducingPoints = config.numInducingPoints ?? 32;

    // Validation
    if (this.dimension <= 0) {
      throw new Error('ANTI-009: dimension must be positive');
    }
    if (this.numHeads <= 0) {
      throw new Error('ANTI-009: numHeads must be positive');
    }
    if (this.dimension % this.numHeads !== 0) {
      throw new Error('ANTI-009: dimension must be divisible by numHeads');
    }
    if (this.numInducingPoints <= 0) {
      throw new Error('ANTI-009: numInducingPoints must be positive');
    }

    const rng = new SeededRandom(config.seed ?? 42);

    // Initialize inducing points (m × dimension)
    this.inducingPoints = xavierUniform(
      this.numInducingPoints,
      this.dimension,
      rng
    );

    // Initialize attention blocks
    this.mab1 = new MultiheadAttentionBlock(this.dimension, this.numHeads, rng);
    this.mab2 = new MultiheadAttentionBlock(this.dimension, this.numHeads, rng);
  }

  /**
   * Forward pass: ISAB(X) = MAB(X, MAB(I, X))
   *
   * @param query - Input embeddings (flattened seqLen × dimension)
   * @param key - Ignored (uses query for set processing)
   * @param value - Ignored (uses query for set processing)
   * @param mask - Optional attention mask
   * @param seqLen - Sequence length (required)
   * @returns Transformed embeddings (seqLen × dimension)
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

    const expectedLength = seqLen * this.dimension;
    if (query.length !== expectedLength) {
      throw new Error(
        `ANTI-009: query length ${query.length} must equal seqLen × dimension (${expectedLength})`
      );
    }

    if (hasNaNOrInf(query)) {
      throw new Error('ANTI-009: query contains NaN or Inf');
    }

    // For set transformer, we process the input as a set
    // Key and value are ignored - we use query for everything
    const input = query;

    // Step 1: H = MAB(I, X)
    // Inducing points attend to input
    const H = this.mab1.forward(
      this.inducingPoints,
      input,
      this.numInducingPoints,
      seqLen
    );

    // Step 2: Output = MAB(X, H)
    // Input attends to the compressed representation
    const output = this.mab2.forward(
      input,
      H,
      seqLen,
      this.numInducingPoints
    );

    // Apply mask if provided
    if (mask) {
      if (mask.length !== seqLen) {
        throw new Error(
          `ANTI-009: mask length ${mask.length} must equal seqLen (${seqLen})`
        );
      }

      for (let i = 0; i < seqLen; i++) {
        if (!mask[i]) {
          // Zero out masked positions
          for (let d = 0; d < this.dimension; d++) {
            output[i * this.dimension + d] = 0;
          }
        }
      }
    }

    // Validate output
    if (hasNaNOrInf(output)) {
      throw new Error('ANTI-009: output contains NaN or Inf');
    }

    return output;
  }

  /**
   * Get total number of trainable parameters
   *
   * Includes:
   * - Inducing points: m × d
   * - MAB1 parameters: 4 × d²
   * - MAB2 parameters: 4 × d²
   */
  getParameterCount(): number {
    return (
      this.inducingPoints.length +
      this.mab1.getParameterCount() +
      this.mab2.getParameterCount()
    );
  }
}

export default RealSetTransformerAttention;
