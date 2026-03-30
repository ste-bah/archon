/**
 * Real Hyperbolic Attention Implementation
 *
 * Reference: Gulcehre et al. 2019 "Hyperbolic Attention Networks"
 * https://arxiv.org/abs/1805.09786
 *
 * Key insight: Embed attention in hyperbolic space to better capture
 * hierarchical relationships. Hyperbolic geometry can represent tree-like
 * structures more efficiently than Euclidean space.
 *
 * Uses the Poincaré ball model:
 * - Points lie within a unit ball
 * - Distance grows exponentially toward the boundary
 * - Hierarchies are naturally represented (root at center, leaves at boundary)
 *
 * Complexity: O(N²) (same as standard attention)
 * Parameter Count: 4 × dim² + curvature parameter
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
 * Real Hyperbolic Attention Implementation
 *
 * Projects queries and keys into hyperbolic space (Poincaré ball),
 * computes attention based on hyperbolic distance.
 *
 * @example
 * ```typescript
 * // Create Hyperbolic attention for hierarchical data
 * const attention = new RealHyperbolicAttention({
 *   dimension: 768,
 *   numHeads: 8,
 *   curvature: -1.0,  // Negative curvature for hyperbolic space
 *   seed: 42
 * });
 *
 * // Process hierarchical data
 * const query = new Float32Array(768);
 * const output = attention.forward(query, query, query);
 * ```
 */
export class RealHyperbolicAttention implements IAttentionMechanism {
  readonly name = 'hyperbolic';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly headDim: number;
  private readonly curvature: number;  // Negative for hyperbolic space
  private readonly eps: number = 1e-5;

  // Weight matrices [dim × dim]
  private readonly wQuery: Float32Array;
  private readonly wKey: Float32Array;
  private readonly wValue: Float32Array;
  private readonly wOutput: Float32Array;

  private readonly rng?: SeededRandom;

  /**
   * Initialize Hyperbolic attention mechanism
   *
   * @param config Configuration options
   * @param config.dimension Model dimension (default: VECTOR_DIM=1536)
   * @param config.numHeads Number of attention heads (default: 8)
   * @param config.curvature Curvature of hyperbolic space (default: -1.0)
   * @param config.seed Random seed for initialization (optional)
   *
   * @throws Error if dimension not divisible by numHeads
   * @throws Error if curvature is non-negative
   */
  constructor(config?: {
    dimension?: number;
    numHeads?: number;
    curvature?: number;
    seed?: number;
  }) {
    this.dimension = config?.dimension ?? VECTOR_DIM;
    this.numHeads = config?.numHeads ?? 8;
    this.curvature = config?.curvature ?? -1.0;

    // Validate configuration
    if (this.dimension % this.numHeads !== 0) {
      throw new Error(
        `ANTI-009: Dimension ${this.dimension} must be divisible by numHeads ${this.numHeads}`
      );
    }

    if (this.curvature >= 0) {
      throw new Error(
        `ANTI-009: Curvature must be negative for hyperbolic space, got ${this.curvature}`
      );
    }

    this.headDim = this.dimension / this.numHeads;

    // Initialize seeded RNG if seed provided
    if (config?.seed !== undefined) {
      this.rng = new SeededRandom(config.seed);
    }

    // Initialize weight matrices
    this.wQuery = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wKey = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wValue = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wOutput = xavierUniform(this.dimension, this.dimension, this.rng);
  }

  /**
   * Project point onto Poincaré ball
   *
   * Ensures the point lies within the unit ball by clamping norm.
   * This is necessary to maintain valid hyperbolic coordinates.
   */
  private projectToPoincare(x: Float32Array, offset: number, length: number): Float32Array {
    const projected = new Float32Array(length);
    let normSq = 0;

    for (let i = 0; i < length; i++) {
      projected[i] = x[offset + i];
      normSq += projected[i] * projected[i];
    }

    const norm = Math.sqrt(normSq);
    const maxNorm = 1.0 - this.eps;

    if (norm > maxNorm) {
      const scale = maxNorm / norm;
      for (let i = 0; i < length; i++) {
        projected[i] *= scale;
      }
    }

    return projected;
  }

  /**
   * Compute hyperbolic distance in Poincaré ball
   *
   * d(x, y) = (2/√|c|) * arctanh(√|c| * ||−x ⊕ y||)
   *
   * where ⊕ is Möbius addition and c is curvature.
   *
   * For simplicity, we use the squared distance formula:
   * d²(x, y) = (2/|c|) * arcosh²(1 + 2|c| * ||x-y||² / ((1-|c|*||x||²)(1-|c|*||y||²)))
   */
  private hyperbolicDistance(x: Float32Array, y: Float32Array): number {
    const c = Math.abs(this.curvature);
    const sqrtC = Math.sqrt(c);

    // Compute norms
    let normXSq = 0, normYSq = 0, diffNormSq = 0;
    for (let i = 0; i < x.length; i++) {
      normXSq += x[i] * x[i];
      normYSq += y[i] * y[i];
      const diff = x[i] - y[i];
      diffNormSq += diff * diff;
    }

    // Compute denominator terms
    const denomX = Math.max(this.eps, 1 - c * normXSq);
    const denomY = Math.max(this.eps, 1 - c * normYSq);

    // Compute argument of arcosh
    const arg = 1 + 2 * c * diffNormSq / (denomX * denomY);

    // arcosh(x) = ln(x + sqrt(x² - 1))
    const arcosh = Math.log(arg + Math.sqrt(Math.max(0, arg * arg - 1)));

    // Distance
    return (2 / sqrtC) * arcosh;
  }

  /**
   * Forward pass: Hyperbolic attention
   *
   * Algorithm:
   * 1. Project Q, K, V through linear transformations
   * 2. Project Q, K onto Poincaré ball
   * 3. Compute attention scores using hyperbolic distance
   * 4. Apply softmax (with temperature from distance)
   * 5. Compute weighted values (in Euclidean space)
   * 6. Project output
   *
   * @param query Query vectors [seq_len × dimension]
   * @param key Key vectors [seq_len × dimension]
   * @param value Value vectors [seq_len × dimension]
   * @param mask Optional attention mask
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

    // Validate query length
    if (query.length !== actualSeqLen * this.dimension) {
      throw new Error(
        `ANTI-009: Query length ${query.length} incompatible with seqLen=${actualSeqLen}, dim=${this.dimension}`
      );
    }

    // Validate key/value dimensions
    if (query.length !== key.length || query.length !== value.length) {
      throw new Error(
        `ANTI-009: Dimension mismatch: Q=${query.length}, K=${key.length}, V=${value.length}`
      );
    }

    // Step 1: Project Q, K, V
    const qProjected = matmul(query, this.wQuery, this.dimension);
    const kProjected = matmul(key, this.wKey, this.dimension);
    const vProjected = matmul(value, this.wValue, this.dimension);

    // Step 2: Multi-head attention computation
    const headOutputs: Float32Array[] = [];

    for (let h = 0; h < this.numHeads; h++) {
      const headOutput = this.computeHeadHyperbolicAttention(
        qProjected,
        kProjected,
        vProjected,
        h,
        actualSeqLen,
        mask
      );
      headOutputs.push(headOutput);
    }

    // Step 3: Concatenate heads
    const concatenated = this.concatenateHeads(headOutputs, actualSeqLen);

    // Step 4: Output projection
    const output = matmul(concatenated, this.wOutput, this.dimension);

    // Validate output
    if (hasNaNOrInf(output)) {
      throw new Error('ANTI-009: Hyperbolic attention forward pass produced NaN or Inf values');
    }

    return output;
  }

  /**
   * Compute hyperbolic attention for a single head
   */
  private computeHeadHyperbolicAttention(
    Q: Float32Array,
    K: Float32Array,
    V: Float32Array,
    head: number,
    seqLen: number,
    mask?: boolean[]
  ): Float32Array {
    const output = new Float32Array(seqLen * this.headDim);

    for (let i = 0; i < seqLen; i++) {
      const qOffset = i * this.dimension + head * this.headDim;
      const outOffset = i * this.headDim;

      // Project query to Poincaré ball
      const qHyper = this.projectToPoincare(Q, qOffset, this.headDim);

      // Compute attention scores using hyperbolic distance
      const scores = new Float32Array(seqLen);
      let maxScore = -Infinity;

      for (let j = 0; j < seqLen; j++) {
        // Check mask
        if (mask && !mask[i * seqLen + j]) {
          scores[j] = -Infinity;
          continue;
        }

        const kOffset = j * this.dimension + head * this.headDim;

        // Project key to Poincaré ball
        const kHyper = this.projectToPoincare(K, kOffset, this.headDim);

        // Compute hyperbolic distance
        const dist = this.hyperbolicDistance(qHyper, kHyper);

        // Convert distance to similarity (negative distance)
        // Closer points = higher attention
        scores[j] = -dist;

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

      // Compute weighted sum of values (in Euclidean space)
      for (let d = 0; d < this.headDim; d++) {
        let weightedSum = 0;

        for (let j = 0; j < seqLen; j++) {
          const attnWeight = sumExp > 0 ? expScores[j] / sumExp : 0;
          const vOffset = j * this.dimension + head * this.headDim;
          weightedSum += attnWeight * V[vOffset + d];
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
   * Hyperbolic attention: 4 × dim² (curvature is not learned here)
   */
  getParameterCount(): number {
    return 4 * this.dimension * this.dimension;
  }
}
