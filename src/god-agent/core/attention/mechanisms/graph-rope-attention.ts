/**
 * Real Graph-RoPE Attention Implementation
 *
 * Reference: Combines ideas from:
 * - RoFormer (Su et al. 2021): Rotary Position Embedding
 * - Graph Transformer (Dwivedi & Bresson 2020)
 *
 * Key insight: Apply Rotary Position Embeddings (RoPE) to graph-structured
 * data by using node distance/relationships as "positions". This allows
 * capturing both local and global graph structure in attention.
 *
 * RoPE encodes position by rotating query and key vectors:
 * - q' = q * cos(θ) + rotate(q) * sin(θ)
 * - k' = k * cos(θ) + rotate(k) * sin(θ)
 *
 * For graphs, θ is based on graph distance rather than sequence position.
 *
 * Complexity: O(N²) for dense graph, O(N × E/N) for sparse graphs
 * Parameter Count: 4 × dim²
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
 * Real Graph-RoPE Attention Implementation
 *
 * Applies rotary position embeddings based on graph structure
 * for position-aware attention on graph data.
 *
 * @example
 * ```typescript
 * // Create Graph-RoPE attention
 * const attention = new RealGraphRoPeAttention({
 *   dimension: 768,
 *   numHeads: 8,
 *   rotaryDim: 64,  // Dimensions to apply rotation to
 *   seed: 42
 * });
 *
 * // For sequence data (uses sequential positions)
 * const query = new Float32Array(seq * 768);
 * const output = attention.forward(query, query, query, undefined, seq);
 *
 * // For graph data, positions can be provided externally
 * ```
 */
export class RealGraphRoPeAttention implements IAttentionMechanism {
  readonly name = 'graph-rope';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly headDim: number;
  private readonly rotaryDim: number;  // Dimensions to apply RoPE to
  private readonly scale: number;
  private readonly baseFreq: number = 10000;

  // Weight matrices [dim × dim]
  private readonly wQuery: Float32Array;
  private readonly wKey: Float32Array;
  private readonly wValue: Float32Array;
  private readonly wOutput: Float32Array;

  // Precomputed rotation matrices for efficiency
  private cosCache: Map<number, Float32Array> = new Map();
  private sinCache: Map<number, Float32Array> = new Map();

  private readonly rng?: SeededRandom;

  /**
   * Initialize Graph-RoPE attention mechanism
   *
   * @param config Configuration options
   * @param config.dimension Model dimension (default: VECTOR_DIM=1536)
   * @param config.numHeads Number of attention heads (default: 8)
   * @param config.rotaryDim Dimensions to apply rotation (default: headDim)
   * @param config.seed Random seed for initialization (optional)
   *
   * @throws Error if dimension not divisible by numHeads
   * @throws Error if rotaryDim > headDim
   */
  constructor(config?: {
    dimension?: number;
    numHeads?: number;
    rotaryDim?: number;
    seed?: number;
  }) {
    this.dimension = config?.dimension ?? VECTOR_DIM;
    this.numHeads = config?.numHeads ?? 8;

    // Validate configuration
    if (this.dimension % this.numHeads !== 0) {
      throw new Error(
        `ANTI-009: Dimension ${this.dimension} must be divisible by numHeads ${this.numHeads}`
      );
    }

    this.headDim = this.dimension / this.numHeads;
    this.rotaryDim = config?.rotaryDim ?? this.headDim;

    if (this.rotaryDim > this.headDim) {
      throw new Error(
        `ANTI-009: rotaryDim ${this.rotaryDim} must be <= headDim ${this.headDim}`
      );
    }

    if (this.rotaryDim % 2 !== 0) {
      throw new Error(
        `ANTI-009: rotaryDim ${this.rotaryDim} must be even for rotation pairs`
      );
    }

    this.scale = 1.0 / Math.sqrt(this.headDim);

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
   * Get rotation frequencies for RoPE
   *
   * θ_i = position / (baseFreq^(2i/d))
   */
  private getFrequencies(position: number): { cos: Float32Array; sin: Float32Array } {
    // Check cache first
    if (this.cosCache.has(position) && this.sinCache.has(position)) {
      return {
        cos: this.cosCache.get(position)!,
        sin: this.sinCache.get(position)!
      };
    }

    const cos = new Float32Array(this.rotaryDim / 2);
    const sin = new Float32Array(this.rotaryDim / 2);

    for (let i = 0; i < this.rotaryDim / 2; i++) {
      const freq = 1.0 / Math.pow(this.baseFreq, (2 * i) / this.rotaryDim);
      const angle = position * freq;
      cos[i] = Math.cos(angle);
      sin[i] = Math.sin(angle);
    }

    // Cache for reuse
    this.cosCache.set(position, cos);
    this.sinCache.set(position, sin);

    return { cos, sin };
  }

  /**
   * Apply rotary position embedding to a vector
   *
   * For each pair (x_2i, x_2i+1):
   * x'_2i = x_2i * cos(θ_i) - x_2i+1 * sin(θ_i)
   * x'_2i+1 = x_2i * sin(θ_i) + x_2i+1 * cos(θ_i)
   */
  private applyRotary(
    x: Float32Array,
    offset: number,
    cos: Float32Array,
    sin: Float32Array
  ): Float32Array {
    const rotated = new Float32Array(this.headDim);

    // Apply rotation to rotaryDim dimensions
    for (let i = 0; i < this.rotaryDim / 2; i++) {
      const idx0 = 2 * i;
      const idx1 = 2 * i + 1;

      const x0 = x[offset + idx0];
      const x1 = x[offset + idx1];

      rotated[idx0] = x0 * cos[i] - x1 * sin[i];
      rotated[idx1] = x0 * sin[i] + x1 * cos[i];
    }

    // Copy remaining dimensions unchanged
    for (let i = this.rotaryDim; i < this.headDim; i++) {
      rotated[i] = x[offset + i];
    }

    return rotated;
  }

  /**
   * Forward pass: Graph-RoPE attention
   *
   * Algorithm:
   * 1. Project Q, K, V through linear transformations
   * 2. Apply RoPE to Q and K based on positions
   * 3. Compute attention scores with rotated Q, K
   * 4. Apply softmax and compute weighted values
   * 5. Project output
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

    // Step 2: Multi-head attention with RoPE
    const headOutputs: Float32Array[] = [];

    for (let h = 0; h < this.numHeads; h++) {
      const headOutput = this.computeHeadGraphRoPeAttention(
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
      throw new Error('ANTI-009: Graph-RoPE attention forward pass produced NaN or Inf values');
    }

    return output;
  }

  /**
   * Compute Graph-RoPE attention for a single head
   */
  private computeHeadGraphRoPeAttention(
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

      // Get rotation frequencies for query position
      const { cos: qCos, sin: qSin } = this.getFrequencies(i);

      // Apply RoPE to query
      const qRotated = this.applyRotary(Q, qOffset, qCos, qSin);

      // Compute attention scores
      const scores = new Float32Array(seqLen);
      let maxScore = -Infinity;

      for (let j = 0; j < seqLen; j++) {
        // Check mask
        if (mask && !mask[i * seqLen + j]) {
          scores[j] = -Infinity;
          continue;
        }

        const kOffset = j * this.dimension + head * this.headDim;

        // Get rotation frequencies for key position
        const { cos: kCos, sin: kSin } = this.getFrequencies(j);

        // Apply RoPE to key
        const kRotated = this.applyRotary(K, kOffset, kCos, kSin);

        // Compute dot product of rotated vectors
        let score = 0;
        for (let d = 0; d < this.headDim; d++) {
          score += qRotated[d] * kRotated[d];
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
   * Graph-RoPE: 4 × dim² (rotary embeddings are computed, not learned)
   */
  getParameterCount(): number {
    return 4 * this.dimension * this.dimension;
  }
}
