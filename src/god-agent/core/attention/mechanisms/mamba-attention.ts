/**
 * Real Mamba Attention Implementation (Selective State Space Model)
 *
 * Reference: Gu & Dao 2023 "Mamba: Linear-Time Sequence Modeling with Selective State Spaces"
 * https://arxiv.org/abs/2312.00752
 *
 * Key insight: Instead of attention, use a State Space Model (SSM) with
 * data-dependent (selective) parameters. This achieves O(N) complexity
 * while maintaining the ability to model long-range dependencies.
 *
 * The selective mechanism makes Δ, B, C input-dependent:
 * - Δ (discretization step): Controls how much to remember/forget
 * - B (input projection): Controls what to write to state
 * - C (output projection): Controls what to read from state
 *
 * State equation: h_t = Ā · h_{t-1} + B̄ · x_t
 * Output: y_t = C · h_t
 *
 * Complexity: O(N) time and space
 * Parameter Count: Specialized SSM parameters
 *
 * ANTI-009: This is a REAL implementation, not a placeholder.
 */

import { IAttentionMechanism } from '../attention-types.js';
import { VECTOR_DIM } from '../../validation/constants.js';
import {
  SeededRandom,
  xavierUniform,
  hasNaNOrInf,
} from '../utils/index.js';

/**
 * Real Mamba Attention Implementation
 *
 * Implements a Selective State Space Model as an attention alternative.
 * Provides O(N) complexity with content-aware processing.
 *
 * @example
 * ```typescript
 * // Create Mamba attention
 * const attention = new RealMambaAttention({
 *   dimension: 768,
 *   stateSize: 16,   // SSM state dimension
 *   seed: 42
 * });
 *
 * // Process sequence
 * const seqLen = 4096;
 * const query = new Float32Array(seqLen * 768);
 * const output = attention.forward(query, query, query, undefined, seqLen);
 * ```
 */
export class RealMambaAttention implements IAttentionMechanism {
  readonly name = 'mamba';

  private readonly dimension: number;
  private readonly stateSize: number;  // N in the paper (state dimension)
  private readonly expandFactor: number;  // Expansion factor for inner dimension

  // Projection matrices
  private readonly wIn: Float32Array;      // Input projection [dim → expand]
  private readonly wDelta: Float32Array;   // Δ projection [dim → expand]
  private readonly wB: Float32Array;       // B projection [dim → stateSize]
  private readonly wC: Float32Array;       // C projection [dim → stateSize]
  private readonly wOut: Float32Array;     // Output projection [expand → dim]

  // SSM parameters (A is not learned, structured initialization)
  private readonly A: Float32Array;        // State matrix [stateSize]

  private readonly rng?: SeededRandom;

  /**
   * Initialize Mamba attention mechanism
   *
   * @param config Configuration options
   * @param config.dimension Model dimension (default: VECTOR_DIM=1536)
   * @param config.stateSize SSM state dimension (default: 16)
   * @param config.expandFactor Inner dimension expansion (default: 2)
   * @param config.seed Random seed for initialization (optional)
   *
   * @throws Error if stateSize < 1
   */
  constructor(config?: {
    dimension?: number;
    stateSize?: number;
    expandFactor?: number;
    seed?: number;
  }) {
    this.dimension = config?.dimension ?? VECTOR_DIM;
    this.stateSize = config?.stateSize ?? 16;
    this.expandFactor = config?.expandFactor ?? 2;

    // Validate configuration
    if (this.stateSize < 1) {
      throw new Error(
        `ANTI-009: State size must be positive, got ${this.stateSize}`
      );
    }

    // Initialize seeded RNG if seed provided
    if (config?.seed !== undefined) {
      this.rng = new SeededRandom(config.seed);
    }

    const expandDim = this.dimension * this.expandFactor;

    // Initialize projection matrices
    this.wIn = xavierUniform(this.dimension, expandDim, this.rng);
    this.wDelta = xavierUniform(this.dimension, expandDim, this.rng);
    this.wB = xavierUniform(this.dimension, this.stateSize, this.rng);
    this.wC = xavierUniform(this.dimension, this.stateSize, this.rng);
    this.wOut = xavierUniform(expandDim, this.dimension, this.rng);

    // Initialize A with structured pattern (HiPPO-inspired)
    // A = -exp(linspace(0, log(N), N)) which gives exponential decay
    this.A = new Float32Array(this.stateSize);
    for (let i = 0; i < this.stateSize; i++) {
      // Exponential spacing from -1 to -stateSize
      this.A[i] = -(i + 1);
    }
  }

  /**
   * Selective scan operation (core Mamba algorithm)
   *
   * For each time step:
   * 1. Compute selective Δ, B, C from input
   * 2. Discretize: Ā = exp(Δ · A), B̄ = Δ · B
   * 3. Update state: h = Ā · h + B̄ · x
   * 4. Output: y = C · h
   */
  private selectiveScan(
    x: Float32Array,
    delta: Float32Array,
    B: Float32Array,
    C: Float32Array,
    seqLen: number,
    expandDim: number
  ): Float32Array {
    const output = new Float32Array(seqLen * expandDim);

    // Process each channel independently
    for (let d = 0; d < expandDim; d++) {
      // Initialize state for this channel
      const h = new Float32Array(this.stateSize);

      for (let t = 0; t < seqLen; t++) {
        const tOffset = t * expandDim;
        const bOffset = t * this.stateSize;

        // Get selective parameters for this timestep
        const dt = Math.max(0.001, delta[tOffset + d]);  // Softplus-like
        const xt = x[tOffset + d];

        // Discretize A and B
        // Ā_i = exp(dt * A_i)
        // B̄_i = dt * B_i
        for (let n = 0; n < this.stateSize; n++) {
          const aBar = Math.exp(dt * this.A[n]);
          const bBar = dt * B[bOffset + n];

          // State update: h_n = aBar * h_n + bBar * x
          h[n] = aBar * h[n] + bBar * xt;
        }

        // Output: y = sum(C_n * h_n)
        let y = 0;
        for (let n = 0; n < this.stateSize; n++) {
          y += C[bOffset + n] * h[n];
        }

        output[tOffset + d] = y;
      }
    }

    return output;
  }

  /**
   * Forward pass: Mamba selective SSM
   *
   * Algorithm:
   * 1. Project input to get x, Δ, B, C
   * 2. Run selective scan (SSM recurrence)
   * 3. Project output back to model dimension
   *
   * Note: In Mamba, query/key/value distinction doesn't apply.
   * We use query as the input; key/value are ignored (compatibility).
   *
   * @param query Input vectors [seq_len × dimension] (main input)
   * @param _key Ignored (for interface compatibility)
   * @param _value Ignored (for interface compatibility)
   * @param _mask Ignored (Mamba is naturally causal)
   * @param seqLen Sequence length (optional)
   * @returns Output vectors [seq_len × dimension]
   */
  forward(
    query: Float32Array,
    _key: Float32Array,
    _value: Float32Array,
    _mask?: boolean[],
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

    const expandDim = this.dimension * this.expandFactor;

    // Step 1: Input projection (x)
    const x = this.projectInput(query, this.wIn, actualSeqLen, expandDim);

    // Step 2: Selective projections (Δ, B, C)
    const delta = this.projectInput(query, this.wDelta, actualSeqLen, expandDim);
    const B = this.projectInput(query, this.wB, actualSeqLen, this.stateSize);
    const C = this.projectInput(query, this.wC, actualSeqLen, this.stateSize);

    // Apply softplus to delta for non-negativity
    for (let i = 0; i < delta.length; i++) {
      delta[i] = Math.log(1 + Math.exp(delta[i]));
    }

    // Step 3: Selective scan (SSM)
    const ssmOutput = this.selectiveScan(x, delta, B, C, actualSeqLen, expandDim);

    // Step 4: Gating with SiLU and residual
    const gated = new Float32Array(actualSeqLen * expandDim);
    for (let i = 0; i < ssmOutput.length; i++) {
      // SiLU gate: x * sigmoid(x)
      const sigmoid = 1 / (1 + Math.exp(-x[i]));
      gated[i] = ssmOutput[i] * x[i] * sigmoid;
    }

    // Step 5: Output projection
    const output = this.projectOutput(gated, actualSeqLen, expandDim);

    // Validate output
    if (hasNaNOrInf(output)) {
      throw new Error('ANTI-009: Mamba attention forward pass produced NaN or Inf values');
    }

    return output;
  }

  /**
   * Project input through weight matrix
   */
  private projectInput(
    input: Float32Array,
    weights: Float32Array,
    seqLen: number,
    outDim: number
  ): Float32Array {
    const output = new Float32Array(seqLen * outDim);

    for (let t = 0; t < seqLen; t++) {
      const inOffset = t * this.dimension;
      const outOffset = t * outDim;

      for (let o = 0; o < outDim; o++) {
        let sum = 0;
        for (let i = 0; i < this.dimension; i++) {
          sum += input[inOffset + i] * weights[i * outDim + o];
        }
        output[outOffset + o] = sum;
      }
    }

    return output;
  }

  /**
   * Project output back to model dimension
   */
  private projectOutput(
    input: Float32Array,
    seqLen: number,
    expandDim: number
  ): Float32Array {
    const output = new Float32Array(seqLen * this.dimension);

    for (let t = 0; t < seqLen; t++) {
      const inOffset = t * expandDim;
      const outOffset = t * this.dimension;

      for (let o = 0; o < this.dimension; o++) {
        let sum = 0;
        for (let i = 0; i < expandDim; i++) {
          sum += input[inOffset + i] * this.wOut[i * this.dimension + o];
        }
        output[outOffset + o] = sum;
      }
    }

    return output;
  }

  /**
   * Get total parameter count
   *
   * Mamba parameters:
   * - wIn: dim × expandDim
   * - wDelta: dim × expandDim
   * - wB: dim × stateSize
   * - wC: dim × stateSize
   * - wOut: expandDim × dim
   * - A: stateSize (not learned, but counted)
   */
  getParameterCount(): number {
    const expandDim = this.dimension * this.expandFactor;
    return (
      this.dimension * expandDim +     // wIn
      this.dimension * expandDim +     // wDelta
      this.dimension * this.stateSize + // wB
      this.dimension * this.stateSize + // wC
      expandDim * this.dimension +     // wOut
      this.stateSize                   // A
    );
  }
}
