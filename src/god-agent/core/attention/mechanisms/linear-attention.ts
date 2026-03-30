/**
 * Real Linear Attention Implementation
 *
 * Reference: Katharopoulos et al. 2020 "Transformers are RNNs:
 * Fast Autoregressive Transformers with Linear Attention"
 * https://arxiv.org/abs/2006.16236
 *
 * Key insight: Replace softmax(QK^T) with φ(Q)φ(K)^T where φ is a feature map.
 * This allows O(N) complexity via associativity: (φ(Q)φ(K)^T)V = φ(Q)(φ(K)^TV)
 *
 * Complexity: O(N × d²) time, O(d²) space (vs O(N² × d) time, O(N²) space for standard)
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
 * Real Linear Attention Implementation
 *
 * @example
 * ```typescript
 * // Create linear attention mechanism
 * const attention = new RealLinearAttention({
 *   dimension: 768,
 *   numHeads: 8,
 *   seed: 42  // Optional: deterministic init for testing
 * });
 *
 * // Single vector attention
 * const query = new Float32Array(768);
 * const output = attention.forward(query, query, query);
 *
 * // Multi-sequence attention (O(N) complexity!)
 * const seqLen = 4;
 * const query = new Float32Array(seqLen * 768);
 * const output = attention.forward(query, query, query, undefined, seqLen);
 * ```
 */
export class RealLinearAttention implements IAttentionMechanism {
  readonly name = 'linear';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly headDim: number;
  private readonly eps: number = 1e-6;

  // Weight matrices [dim × dim]
  private readonly wQuery: Float32Array;
  private readonly wKey: Float32Array;
  private readonly wValue: Float32Array;
  private readonly wOutput: Float32Array;

  private readonly rng?: SeededRandom;

  /**
   * Initialize linear attention mechanism
   *
   * @param config Configuration options
   * @param config.dimension Model dimension (default: VECTOR_DIM=1536)
   * @param config.numHeads Number of attention heads (default: 8)
   * @param config.seed Random seed for deterministic initialization (optional)
   *
   * @throws Error if dimension not divisible by numHeads
   */
  constructor(config?: {
    dimension?: number;
    numHeads?: number;
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
   * ELU feature map: φ(x) = elu(x) + 1
   *
   * Ensures non-negative values for valid attention-like behavior.
   * The +1 ensures φ(x) > 0 for all x, which is required for the
   * kernel interpretation to hold.
   *
   * @param x Input value
   * @returns φ(x) = x + 1 if x > 0, else exp(x)
   */
  private featureMap(x: number): number {
    // ELU(x) + 1 = (x > 0 ? x : exp(x) - 1) + 1 = (x > 0 ? x + 1 : exp(x))
    return x > 0 ? x + 1 : Math.exp(x);
  }

  /**
   * Forward pass: Linear attention with O(N) complexity
   *
   * Algorithm:
   * 1. Project Q, K, V through learned weight matrices
   * 2. Apply feature map φ to Q and K
   * 3. For each head, compute:
   *    - S = φ(K)^T × V (key-value outer product, accumulated)
   *    - Z = sum(φ(K)) (normalizer)
   *    - output = (φ(Q) × S) / (φ(Q) · Z + ε)
   * 4. Concatenate heads and project output
   *
   * @param query Query vectors [seq_len × dimension] (flattened)
   * @param key Key vectors [seq_len × dimension] (flattened)
   * @param value Value vectors [seq_len × dimension] (flattened)
   * @param mask Attention mask [seq_len × seq_len] (optional, for compatibility)
   *             Note: Causal masking in linear attention requires cumulative computation
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
        `ANTI-009: Query length ${query.length} incompatible with seqLen=${actualSeqLen}, dim=${this.dimension}` +
        ` (expected ${actualSeqLen * this.dimension})`
      );
    }

    // Validate key/value dimensions match query
    if (query.length !== key.length || query.length !== value.length) {
      throw new Error(
        `ANTI-009: Dimension mismatch: Q=${query.length}, K=${key.length}, V=${value.length}`
      );
    }

    // Step 1: Linear projections Q, K, V
    const qProjected = matmul(query, this.wQuery, this.dimension);
    const kProjected = matmul(key, this.wKey, this.dimension);
    const vProjected = matmul(value, this.wValue, this.dimension);

    // Step 2: Apply feature map to Q and K
    const qFeature = new Float32Array(qProjected.length);
    const kFeature = new Float32Array(kProjected.length);

    for (let i = 0; i < qProjected.length; i++) {
      qFeature[i] = this.featureMap(qProjected[i]);
      kFeature[i] = this.featureMap(kProjected[i]);
    }

    // Step 3: Multi-head linear attention computation
    const headOutputs: Float32Array[] = [];

    for (let h = 0; h < this.numHeads; h++) {
      const headOutput = this.computeHeadLinearAttention(
        qFeature,
        kFeature,
        vProjected,
        h,
        actualSeqLen,
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
      throw new Error('ANTI-009: Linear attention forward pass produced NaN or Inf values');
    }

    return output;
  }

  /**
   * Compute linear attention for a single head
   *
   * Key insight: Instead of computing attention weights explicitly (O(N²)),
   * we use the associative property of matrix multiplication:
   *
   * Standard: output = softmax(QK^T) × V  [O(N²)]
   * Linear:   output = φ(Q) × (φ(K)^T × V) / (φ(Q) · sum(φ(K)))  [O(N)]
   *
   * For causal attention, we compute cumulative sums incrementally.
   *
   * @param qFeature Feature-mapped query [seq_len × dimension]
   * @param kFeature Feature-mapped key [seq_len × dimension]
   * @param V Projected value [seq_len × dimension]
   * @param head Head index
   * @param seqLen Sequence length
   * @param mask Optional attention mask (for causal computation)
   * @returns Head output [seq_len × headDim]
   */
  private computeHeadLinearAttention(
    qFeature: Float32Array,
    kFeature: Float32Array,
    V: Float32Array,
    head: number,
    seqLen: number,
    mask?: boolean[]
  ): Float32Array {
    const output = new Float32Array(seqLen * this.headDim);

    // Determine if we need causal (cumulative) computation
    const isCausal = mask !== undefined && this.isCausalMask(mask, seqLen);

    if (isCausal) {
      // Causal linear attention: compute cumulative S and Z
      // S_i = sum_{j<=i} φ(k_j) ⊗ v_j (outer product accumulated)
      // Z_i = sum_{j<=i} φ(k_j)
      // output_i = (φ(q_i) × S_i) / (φ(q_i) · Z_i + ε)

      // S: accumulated key-value outer product [headDim × headDim]
      const S = new Float32Array(this.headDim * this.headDim);
      // Z: accumulated key sum [headDim]
      const Z = new Float32Array(this.headDim);

      for (let i = 0; i < seqLen; i++) {
        const kOffset = i * this.dimension + head * this.headDim;
        const vOffset = i * this.dimension + head * this.headDim;
        const qOffset = i * this.dimension + head * this.headDim;
        const outOffset = i * this.headDim;

        // Update S and Z with current key-value
        for (let j = 0; j < this.headDim; j++) {
          const kVal = kFeature[kOffset + j];
          Z[j] += kVal;

          for (let k = 0; k < this.headDim; k++) {
            S[j * this.headDim + k] += kVal * V[vOffset + k];
          }
        }

        // Compute normalization factor: φ(q_i) · Z
        let normFactor = this.eps;
        for (let j = 0; j < this.headDim; j++) {
          normFactor += qFeature[qOffset + j] * Z[j];
        }

        // Compute output: (φ(q_i) × S) / normFactor
        for (let k = 0; k < this.headDim; k++) {
          let sum = 0;
          for (let j = 0; j < this.headDim; j++) {
            sum += qFeature[qOffset + j] * S[j * this.headDim + k];
          }
          output[outOffset + k] = sum / normFactor;
        }
      }
    } else {
      // Non-causal (bidirectional) linear attention
      // Compute global S and Z first, then apply to all positions

      // S: global key-value outer product [headDim × headDim]
      const S = new Float32Array(this.headDim * this.headDim);
      // Z: global key sum [headDim]
      const Z = new Float32Array(this.headDim);

      // Accumulate S and Z over all positions
      for (let i = 0; i < seqLen; i++) {
        const kOffset = i * this.dimension + head * this.headDim;
        const vOffset = i * this.dimension + head * this.headDim;

        // Check mask if provided (non-causal masking)
        const shouldInclude = !mask || this.checkMaskRow(mask, i, seqLen);

        if (shouldInclude) {
          for (let j = 0; j < this.headDim; j++) {
            const kVal = kFeature[kOffset + j];
            Z[j] += kVal;

            for (let k = 0; k < this.headDim; k++) {
              S[j * this.headDim + k] += kVal * V[vOffset + k];
            }
          }
        }
      }

      // Compute output for each position
      for (let i = 0; i < seqLen; i++) {
        const qOffset = i * this.dimension + head * this.headDim;
        const outOffset = i * this.headDim;

        // Compute normalization factor: φ(q_i) · Z
        let normFactor = this.eps;
        for (let j = 0; j < this.headDim; j++) {
          normFactor += qFeature[qOffset + j] * Z[j];
        }

        // Compute output: (φ(q_i) × S) / normFactor
        for (let k = 0; k < this.headDim; k++) {
          let sum = 0;
          for (let j = 0; j < this.headDim; j++) {
            sum += qFeature[qOffset + j] * S[j * this.headDim + k];
          }
          output[outOffset + k] = sum / normFactor;
        }
      }
    }

    return output;
  }

  /**
   * Check if mask is a causal (lower triangular) mask
   */
  private isCausalMask(mask: boolean[], seqLen: number): boolean {
    for (let i = 0; i < seqLen; i++) {
      for (let j = 0; j < seqLen; j++) {
        const expected = j <= i; // Causal: can only attend to past and current
        const actual = mask[i * seqLen + j];
        if (actual !== expected) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Check if any position in the mask row is attended
   */
  private checkMaskRow(mask: boolean[], row: number, seqLen: number): boolean {
    for (let j = 0; j < seqLen; j++) {
      if (mask[row * seqLen + j]) {
        return true;
      }
    }
    return false;
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
   *
   * @returns Parameter count = 4 × dim²
   */
  getParameterCount(): number {
    return 4 * this.dimension * this.dimension;
  }
}
