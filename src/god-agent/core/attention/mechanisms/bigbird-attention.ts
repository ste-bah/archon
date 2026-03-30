/**
 * Real BigBird Attention Implementation
 *
 * Reference: Zaheer et al. 2020 "Big Bird: Transformers for Longer Sequences"
 * https://arxiv.org/abs/2007.14062
 *
 * Key insight: Combine three attention patterns for O(N) complexity:
 * 1. Random attention: Each token attends to r random tokens
 * 2. Window attention: Each token attends to w/2 tokens on each side
 * 3. Global attention: Selected tokens attend to/from all positions
 *
 * The combination of these patterns approximates full attention while
 * maintaining linear complexity.
 *
 * Complexity: O(N × (r + w + g)) where r=random, w=window, g=global
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
 * Real BigBird Attention Implementation
 *
 * Combines random, window, and global attention patterns for
 * efficient long sequence processing.
 *
 * @example
 * ```typescript
 * // Create BigBird attention
 * const attention = new RealBigBirdAttention({
 *   dimension: 768,
 *   numHeads: 8,
 *   windowSize: 64,    // Local window
 *   numRandomBlocks: 3, // Random attention blocks
 *   globalIndices: [0], // Global tokens
 *   seed: 42
 * });
 *
 * // Process long sequence
 * const seqLen = 4096;
 * const query = new Float32Array(seqLen * 768);
 * const output = attention.forward(query, query, query, undefined, seqLen);
 * ```
 */
export class RealBigBirdAttention implements IAttentionMechanism {
  readonly name = 'bigbird';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly headDim: number;
  private readonly windowSize: number;
  private readonly numRandomBlocks: number;
  private readonly globalIndices: Set<number>;
  private readonly scale: number;

  // Weight matrices [dim × dim]
  private readonly wQuery: Float32Array;
  private readonly wKey: Float32Array;
  private readonly wValue: Float32Array;
  private readonly wOutput: Float32Array;

  private readonly rng: SeededRandom;

  /**
   * Initialize BigBird attention mechanism
   *
   * @param config Configuration options
   * @param config.dimension Model dimension (default: VECTOR_DIM=1536)
   * @param config.numHeads Number of attention heads (default: 8)
   * @param config.windowSize One-sided window size (default: 64)
   * @param config.numRandomBlocks Number of random attention blocks (default: 3)
   * @param config.globalIndices Indices of global attention tokens (default: [0])
   * @param config.seed Random seed for initialization and random patterns
   *
   * @throws Error if dimension not divisible by numHeads
   */
  constructor(config?: {
    dimension?: number;
    numHeads?: number;
    windowSize?: number;
    numRandomBlocks?: number;
    globalIndices?: number[];
    seed?: number;
  }) {
    this.dimension = config?.dimension ?? VECTOR_DIM;
    this.numHeads = config?.numHeads ?? 8;
    this.windowSize = config?.windowSize ?? 64;
    this.numRandomBlocks = config?.numRandomBlocks ?? 3;
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

    if (this.numRandomBlocks < 0) {
      throw new Error(
        `ANTI-009: Number of random blocks must be non-negative, got ${this.numRandomBlocks}`
      );
    }

    this.headDim = this.dimension / this.numHeads;
    this.scale = 1.0 / Math.sqrt(this.headDim);

    // Initialize seeded RNG (always needed for random attention pattern)
    this.rng = new SeededRandom(config?.seed ?? 42);

    // Initialize weight matrices
    this.wQuery = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wKey = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wValue = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wOutput = xavierUniform(this.dimension, this.dimension, this.rng);
  }

  /**
   * Forward pass: BigBird attention with random + window + global patterns
   *
   * Algorithm:
   * 1. Project Q, K, V through learned weight matrices
   * 2. For each position, determine attention pattern:
   *    - Global tokens: attend to all
   *    - Others: window + random + global tokens
   * 3. Apply softmax and compute weighted values
   * 4. Concatenate heads and project output
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

    // Validate key/value dimensions match query
    if (query.length !== key.length || query.length !== value.length) {
      throw new Error(
        `ANTI-009: Dimension mismatch: Q=${query.length}, K=${key.length}, V=${value.length}`
      );
    }

    // Step 1: Project Q, K, V
    const qProjected = matmul(query, this.wQuery, this.dimension);
    const kProjected = matmul(key, this.wKey, this.dimension);
    const vProjected = matmul(value, this.wValue, this.dimension);

    // Step 2: Generate random attention patterns (once per sequence)
    const randomPatterns = this.generateRandomPatterns(actualSeqLen);

    // Step 3: Multi-head attention computation
    const headOutputs: Float32Array[] = [];

    for (let h = 0; h < this.numHeads; h++) {
      const headOutput = this.computeHeadBigBirdAttention(
        qProjected,
        kProjected,
        vProjected,
        h,
        actualSeqLen,
        randomPatterns,
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
      throw new Error('ANTI-009: BigBird attention forward pass produced NaN or Inf values');
    }

    return output;
  }

  /**
   * Generate random attention patterns for each position
   *
   * For each position i, generates numRandomBlocks random positions
   * that i will attend to (excluding window and global positions).
   */
  private generateRandomPatterns(seqLen: number): Map<number, Set<number>> {
    const patterns = new Map<number, Set<number>>();

    for (let i = 0; i < seqLen; i++) {
      const randomPositions = new Set<number>();

      // Get positions already covered by window
      const windowStart = Math.max(0, i - this.windowSize);
      const windowEnd = Math.min(seqLen - 1, i + this.windowSize);
      const windowPositions = new Set<number>();
      for (let w = windowStart; w <= windowEnd; w++) {
        windowPositions.add(w);
      }

      // Add random positions (avoiding window and global)
      const candidates: number[] = [];
      for (let j = 0; j < seqLen; j++) {
        if (!windowPositions.has(j) && !this.globalIndices.has(j)) {
          candidates.push(j);
        }
      }

      // Shuffle and take first numRandomBlocks
      for (let r = 0; r < Math.min(this.numRandomBlocks, candidates.length); r++) {
        const idx = Math.floor(this.rng.next() * candidates.length);
        randomPositions.add(candidates[idx]);
        candidates.splice(idx, 1);
      }

      patterns.set(i, randomPositions);
    }

    return patterns;
  }

  /**
   * Compute BigBird attention for a single head
   */
  private computeHeadBigBirdAttention(
    Q: Float32Array,
    K: Float32Array,
    V: Float32Array,
    head: number,
    seqLen: number,
    randomPatterns: Map<number, Set<number>>,
    mask?: boolean[]
  ): Float32Array {
    const output = new Float32Array(seqLen * this.headDim);

    for (let i = 0; i < seqLen; i++) {
      const qOffset = i * this.dimension + head * this.headDim;
      const outOffset = i * this.headDim;

      // Determine which positions to attend to
      const attendedPositions: number[] = [];

      if (this.globalIndices.has(i)) {
        // Global token: attend to all positions
        for (let j = 0; j < seqLen; j++) {
          attendedPositions.push(j);
        }
      } else {
        // Non-global token: window + random + global

        // Window positions
        const windowStart = Math.max(0, i - this.windowSize);
        const windowEnd = Math.min(seqLen - 1, i + this.windowSize);
        for (let j = windowStart; j <= windowEnd; j++) {
          attendedPositions.push(j);
        }

        // Random positions
        const randomPos = randomPatterns.get(i) || new Set<number>();
        const randomPosArray = Array.from(randomPos);
        for (let ri = 0; ri < randomPosArray.length; ri++) {
          const j = randomPosArray[ri];
          if (!attendedPositions.includes(j)) {
            attendedPositions.push(j);
          }
        }

        // Global positions
        const globalArray = Array.from(this.globalIndices);
        for (let gi = 0; gi < globalArray.length; gi++) {
          const g = globalArray[gi];
          if (g < seqLen && !attendedPositions.includes(g)) {
            attendedPositions.push(g);
          }
        }
      }

      // Compute attention scores for attended positions
      const scores = new Float32Array(attendedPositions.length);
      let maxScore = -Infinity;

      for (let a = 0; a < attendedPositions.length; a++) {
        const j = attendedPositions[a];

        // Check mask
        if (mask && !mask[i * seqLen + j]) {
          scores[a] = -Infinity;
          continue;
        }

        const kOffset = j * this.dimension + head * this.headDim;
        let score = 0;

        for (let d = 0; d < this.headDim; d++) {
          score += Q[qOffset + d] * K[kOffset + d];
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
          const j = attendedPositions[a];
          const attnWeight = sumExp > 0 ? expScores[a] / sumExp : 0;
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
   * BigBird uses standard 4 weight matrices: 4 × dim²
   */
  getParameterCount(): number {
    return 4 * this.dimension * this.dimension;
  }
}
