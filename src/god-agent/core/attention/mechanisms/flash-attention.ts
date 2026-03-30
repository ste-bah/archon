/**
 * Real FlashAttention Implementation with IO-Aware Tiling
 *
 * Reference: Dao et al. 2022 "FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness"
 *
 * Key innovations:
 * - Tiled computation for memory efficiency (fits in SRAM)
 * - Online softmax for numerical stability
 * - Reduced HBM (High Bandwidth Memory) I/O from O(N²) to O(N)
 * - Exact attention (NOT approximate)
 *
 * Algorithm:
 * 1. Divide Q, K, V into blocks that fit in fast memory
 * 2. For each Q block: iterate over K, V blocks
 * 3. Compute block-wise attention with online softmax
 * 4. Track running max and sum for stability
 * 5. Output projection
 *
 * Complexity: O(N² × d) time, O(N × d) memory (vs O(N²) for standard)
 * Parameter Count: 4 × dim²
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
 * Real FlashAttention Implementation
 *
 * Implements IO-aware tiling for memory-efficient exact attention.
 * Reduces HBM I/O while computing identical results to standard attention.
 *
 * @example
 * ```typescript
 * // Create FlashAttention mechanism
 * const attention = new RealFlashAttention({
 *   dimension: 768,
 *   numHeads: 12,
 *   blockSize: 64,  // Tile size for SRAM (configurable)
 *   seed: 42        // Optional: deterministic init for testing
 * });
 *
 * // Single vector attention
 * const query = new Float32Array(768);
 * const output = attention.forward(query, query, query);
 *
 * // Multi-sequence attention
 * const seqLen = 1024;
 * const query = new Float32Array(seqLen * 768);
 * const output = attention.forward(query, query, query, undefined, seqLen);
 *
 * // With causal mask
 * import { createCausalMask } from '../utils/index.js';
 * const mask = createCausalMask(seqLen);
 * const output = attention.forward(query, query, query, mask, seqLen);
 * ```
 */
export class RealFlashAttention implements IAttentionMechanism {
  readonly name = 'flash';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly headDim: number;
  private readonly scale: number;
  private readonly blockSize: number;

  // Weight matrices [dim × dim]
  private readonly wQuery: Float32Array;
  private readonly wKey: Float32Array;
  private readonly wValue: Float32Array;
  private readonly wOutput: Float32Array;

  private readonly rng?: SeededRandom;

  /**
   * Initialize FlashAttention mechanism
   *
   * @param config Configuration options
   * @param config.dimension Model dimension (default: VECTOR_DIM=1536)
   * @param config.numHeads Number of attention heads (default: 12)
   * @param config.blockSize Tile size for SRAM (default: 64, must divide dimension)
   * @param config.seed Random seed for deterministic initialization (optional)
   *
   * @throws Error if dimension not divisible by numHeads or blockSize
   */
  constructor(config?: {
    dimension?: number;
    numHeads?: number;
    blockSize?: number;
    seed?: number;
  }) {
    this.dimension = config?.dimension ?? VECTOR_DIM;
    this.numHeads = config?.numHeads ?? 12;
    this.blockSize = config?.blockSize ?? 64;

    // Validate configuration
    if (this.dimension % this.numHeads !== 0) {
      throw new Error(
        `Dimension ${this.dimension} must be divisible by numHeads ${this.numHeads}`
      );
    }

    // Validate block size for efficient tiling
    if (this.blockSize <= 0 || this.blockSize > this.dimension) {
      throw new Error(
        `Block size ${this.blockSize} must be between 1 and dimension ${this.dimension}`
      );
    }

    this.headDim = this.dimension / this.numHeads;
    this.scale = 1.0 / Math.sqrt(this.headDim);

    // Initialize seeded RNG if seed provided (for testing)
    if (config?.seed !== undefined) {
      this.rng = new SeededRandom(config.seed);
    }

    // Initialize weight matrices using Xavier uniform initialization
    this.wQuery = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wKey = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wValue = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wOutput = xavierUniform(this.dimension, this.dimension, this.rng);
  }

  /**
   * Forward pass: FlashAttention with IO-aware tiling
   *
   * Computes: MultiHead(Q, K, V) = Concat(head₁, ..., headₕ) W^O
   * using tiled computation to minimize HBM I/O.
   *
   * @param query Query vectors [seq_len × dimension] (flattened)
   * @param key Key vectors [seq_len × dimension] (flattened)
   * @param value Value vectors [seq_len × dimension] (flattened)
   * @param mask Attention mask [seq_len × seq_len] (flattened row-major, optional)
   *             Semantics: true=attend, false=mask out (PyTorch convention)
   * @param seqLen Sequence length (optional, inferred from query.length if undefined)
   * @returns Output vectors [seq_len × dimension] (flattened)
   *
   * @throws Error if dimensions incompatible or contain NaN
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
        `Query length ${query.length} incompatible with seqLen=${actualSeqLen}, dim=${this.dimension}` +
        ` (expected ${actualSeqLen * this.dimension})`
      );
    }

    // Validate key/value dimensions match query
    if (query.length !== key.length || query.length !== value.length) {
      throw new Error(
        `Dimension mismatch: Q=${query.length}, K=${key.length}, V=${value.length}`
      );
    }

    // Validate mask dimensions if provided
    if (mask && mask.length !== actualSeqLen * actualSeqLen) {
      throw new Error(
        `Mask length ${mask.length} incompatible with seqLen=${actualSeqLen}` +
        ` (expected ${actualSeqLen * actualSeqLen})`
      );
    }

    // Step 1: Linear projections Q, K, V
    const qProjected = matmul(query, this.wQuery, this.dimension);
    const kProjected = matmul(key, this.wKey, this.dimension);
    const vProjected = matmul(value, this.wValue, this.dimension);

    // Step 2: Multi-head computation with FlashAttention
    const headOutputs: Float32Array[] = [];

    for (let h = 0; h < this.numHeads; h++) {
      const headOutput = this.computeFlashHeadAttention(
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
      throw new Error('Forward pass produced NaN or Inf values');
    }

    return output;
  }

  /**
   * Compute FlashAttention for a single head using IO-aware tiling
   *
   * Algorithm (simplified for TypeScript):
   * 1. Divide Q, K, V into blocks
   * 2. For each Q block Qᵢ:
   *    a. Initialize output Oᵢ = 0, running stats (m, l)
   *    b. For each K, V block (Kⱼ, Vⱼ):
   *       - Compute block scores: Sᵢⱼ = Qᵢ Kⱼᵀ / √d
   *       - Apply mask to Sᵢⱼ
   *       - Update running max: m_new = max(m_old, rowmax(Sᵢⱼ))
   *       - Compute exp with correction: exp(Sᵢⱼ - m_new)
   *       - Update running sum: l_new = l_old * exp(m_old - m_new) + rowsum(exp)
   *       - Update output: Oᵢ = (Oᵢ * l_old * exp(m_old - m_new) + exp(Sᵢⱼ - m_new) Vⱼ) / l_new
   * 3. Return O
   *
   * @param Q Projected query [seq_len × dimension]
   * @param K Projected key [seq_len × dimension]
   * @param V Projected value [seq_len × dimension]
   * @param head Head index
   * @param seqLen Sequence length
   * @param mask Optional attention mask
   * @returns Head output [seq_len × headDim]
   */
  private computeFlashHeadAttention(
    Q: Float32Array,
    K: Float32Array,
    V: Float32Array,
    head: number,
    seqLen: number,
    mask?: boolean[]
  ): Float32Array {
    // Output buffer
    const output = new Float32Array(seqLen * this.headDim);

    // Determine block size for tiling
    const qBlockSize = Math.min(this.blockSize, seqLen);
    const kvBlockSize = Math.min(this.blockSize, seqLen);

    // Process Q blocks
    for (let qStart = 0; qStart < seqLen; qStart += qBlockSize) {
      const qEnd = Math.min(qStart + qBlockSize, seqLen);
      const qSize = qEnd - qStart;

      // Initialize running statistics for this Q block
      // m[i] = running max for row i
      // l[i] = running sum of exp for row i
      const m = new Float32Array(qSize).fill(-Infinity);
      const l = new Float32Array(qSize).fill(0);

      // Output accumulator for this Q block
      const O = new Float32Array(qSize * this.headDim);

      // Process K, V blocks
      for (let kvStart = 0; kvStart < seqLen; kvStart += kvBlockSize) {
        const kvEnd = Math.min(kvStart + kvBlockSize, seqLen);
        const kvSize = kvEnd - kvStart;

        // 1. Compute block scores: S = Q_block @ K_block^T / √d
        const S = new Float32Array(qSize * kvSize);

        for (let i = 0; i < qSize; i++) {
          const qRow = qStart + i;
          const qOffset = qRow * this.dimension + head * this.headDim;

          for (let j = 0; j < kvSize; j++) {
            const kRow = kvStart + j;
            const kOffset = kRow * this.dimension + head * this.headDim;

            // Compute scaled dot product
            let score = 0;
            for (let k = 0; k < this.headDim; k++) {
              score += Q[qOffset + k] * K[kOffset + k];
            }
            S[i * kvSize + j] = score * this.scale;
          }
        }

        // 2. Apply mask if provided
        if (mask) {
          for (let i = 0; i < qSize; i++) {
            const qRow = qStart + i;
            for (let j = 0; j < kvSize; j++) {
              const kRow = kvStart + j;
              const maskIdx = qRow * seqLen + kRow;
              if (!mask[maskIdx]) {
                S[i * kvSize + j] = -Infinity;
              }
            }
          }
        }

        // 3. Online softmax with running statistics
        for (let i = 0; i < qSize; i++) {
          // Find max for this row of S
          let rowMax = -Infinity;
          for (let j = 0; j < kvSize; j++) {
            rowMax = Math.max(rowMax, S[i * kvSize + j]);
          }

          // Update running max
          const mOld = m[i];
          const mNew = Math.max(mOld, rowMax);
          m[i] = mNew;

          // Compute correction factors
          const correctionOld = Math.exp(mOld - mNew);
          const correctionNew = rowMax === -Infinity ? 0 : 1; // Handle all-masked case

          // Compute exp(S - m_new) and sum
          let expSum = 0;
          const expScores = new Float32Array(kvSize);

          for (let j = 0; j < kvSize; j++) {
            const score = S[i * kvSize + j];
            if (score === -Infinity) {
              expScores[j] = 0;
            } else {
              expScores[j] = Math.exp(score - mNew);
              expSum += expScores[j];
            }
          }

          // Update running sum
          const lOld = l[i];
          const lNew = lOld * correctionOld + expSum;
          l[i] = lNew;

          // 4. Update output: O = (O_old * l_old * correction + exp(S - m_new) @ V_block) / l_new
          if (lNew > 0) {
            const scaleFactor = (lOld * correctionOld) / lNew;

            // Scale existing output
            for (let k = 0; k < this.headDim; k++) {
              O[i * this.headDim + k] *= scaleFactor;
            }

            // Add weighted V contribution
            for (let k = 0; k < this.headDim; k++) {
              let vSum = 0;
              for (let j = 0; j < kvSize; j++) {
                const vRow = kvStart + j;
                const vOffset = vRow * this.dimension + head * this.headDim;
                vSum += expScores[j] * V[vOffset + k];
              }
              O[i * this.headDim + k] += vSum / lNew;
            }
          } else {
            // Handle all-masked case: uniform distribution
            for (let k = 0; k < this.headDim; k++) {
              let vSum = 0;
              for (let j = 0; j < kvSize; j++) {
                const vRow = kvStart + j;
                const vOffset = vRow * this.dimension + head * this.headDim;
                vSum += V[vOffset + k];
              }
              O[i * this.headDim + k] = vSum / kvSize;
            }
          }
        }
      }

      // Copy Q block output to final output
      for (let i = 0; i < qSize; i++) {
        const outRow = qStart + i;
        for (let k = 0; k < this.headDim; k++) {
          output[outRow * this.headDim + k] = O[i * this.headDim + k];
        }
      }
    }

    return output;
  }

  /**
   * Concatenate multiple head outputs
   *
   * Transforms: [head₁[seq×d_k], head₂[seq×d_k], ...] → [seq×dim]
   *
   * @param headOutputs Array of head outputs
   * @param seqLen Sequence length
   * @returns Concatenated output [seq_len × dimension]
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

        // Copy head slice to concatenated output
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
   * Parameters: 4 weight matrices (Wq, Wk, Wv, Wo) each of size [dim × dim]
   * Same as standard attention (FlashAttention is optimization, not architectural change)
   *
   * @returns Parameter count = 4 × dim²
   *
   * @example
   * ```typescript
   * const attention = new RealFlashAttention({ dimension: 768 });
   * console.log(attention.getParameterCount()); // 2,359,296
   * ```
   */
  getParameterCount(): number {
    return 4 * this.dimension * this.dimension;
  }
}
