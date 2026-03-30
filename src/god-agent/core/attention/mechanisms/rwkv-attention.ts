/**
 * Real RWKV Attention Implementation
 *
 * Reference: Peng et al. 2023 "RWKV: Reinventing RNNs for the Transformer Era"
 * https://arxiv.org/abs/2305.13048
 *
 * Key insight: RWKV is a linear attention mechanism that combines:
 * - RNN-style recurrence for efficient inference
 * - Transformer-style parallelism for training
 * - Channel mixing and time mixing for expressiveness
 *
 * The RWKV formula (Time Mixing):
 * - r = sigmoid(x · w_r + state_r)  (Receptance)
 * - k = x · w_k                      (Key)
 * - v = x · w_v                      (Value)
 * - wkv = (exp(u + k) · v + state_wkv) / (exp(u + k) + state_num)
 * - output = r ⊙ wkv                 (Gate with receptance)
 *
 * State update:
 * - state_wkv' = exp(w) · state_wkv + exp(k) · v
 * - state_num' = exp(w) · state_num + exp(k)
 *
 * Complexity: O(N) time and space
 * Parameter Count: 4 × dim² + 2 × dim
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
 * Real RWKV Attention Implementation
 *
 * Implements Receptance Weighted Key Value attention with linear complexity.
 * Provides both parallel (training) and sequential (inference) modes.
 *
 * @example
 * ```typescript
 * // Create RWKV attention
 * const attention = new RealRWKVAttention({
 *   dimension: 768,
 *   numLayers: 12,
 *   seed: 42
 * });
 *
 * // Process sequence with O(N) complexity
 * const seqLen = 16384;
 * const query = new Float32Array(seqLen * 768);
 * const output = attention.forward(query, query, query, undefined, seqLen);
 * ```
 */
export class RealRWKVAttention implements IAttentionMechanism {
  readonly name = 'rwkv';

  private readonly dimension: number;

  // Time mixing weights
  private readonly wReceptance: Float32Array;  // [dim × dim]
  private readonly wKey: Float32Array;         // [dim × dim]
  private readonly wValue: Float32Array;       // [dim × dim]
  private readonly wOutput: Float32Array;      // [dim × dim]

  // Time decay and bonus parameters
  private readonly timeDecay: Float32Array;    // [dim] - learned w parameter
  private readonly timeFirst: Float32Array;    // [dim] - learned u parameter

  // Time mixing factors (for token shift)
  private readonly timeMix: Float32Array;      // [dim] - interpolation weight

  private readonly rng?: SeededRandom;

  /**
   * Initialize RWKV attention mechanism
   *
   * @param config Configuration options
   * @param config.dimension Model dimension (default: VECTOR_DIM=1536)
   * @param config.seed Random seed for initialization (optional)
   *
   * @throws Error if dimension < 1
   */
  constructor(config?: {
    dimension?: number;
    seed?: number;
  }) {
    this.dimension = config?.dimension ?? VECTOR_DIM;

    // Validate configuration
    if (this.dimension < 1) {
      throw new Error(
        `ANTI-009: Dimension must be positive, got ${this.dimension}`
      );
    }

    // Initialize seeded RNG if seed provided
    if (config?.seed !== undefined) {
      this.rng = new SeededRandom(config.seed);
    }

    // Initialize projection matrices
    this.wReceptance = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wKey = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wValue = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wOutput = xavierUniform(this.dimension, this.dimension, this.rng);

    // Initialize time decay (w) - negative values for decay
    // Following RWKV paper: initialize with slight negative bias
    this.timeDecay = new Float32Array(this.dimension);
    for (let i = 0; i < this.dimension; i++) {
      // Initialize decay between -5 and -0.5 (exponential decay factors)
      const randomVal = this.rng ? this.rng.next() : Math.random();
      this.timeDecay[i] = -0.5 - 4.5 * randomVal;
    }

    // Initialize time first (u) - bonus for current token
    // Following RWKV paper: initialize near zero
    this.timeFirst = new Float32Array(this.dimension);
    for (let i = 0; i < this.dimension; i++) {
      const randomVal = this.rng ? this.rng.next() : Math.random();
      this.timeFirst[i] = (randomVal - 0.5) * 0.1;
    }

    // Initialize time mixing interpolation weights
    // Controls how much of previous vs current token to use
    this.timeMix = new Float32Array(this.dimension);
    for (let i = 0; i < this.dimension; i++) {
      // Ratio based on position in dimension (channel-wise variation)
      const ratio = i / (this.dimension - 1 || 1);
      // Mix between 0.3 and 0.7 based on dimension position
      this.timeMix[i] = 0.3 + 0.4 * ratio;
    }
  }

  /**
   * Project input through weight matrix
   */
  private project(
    input: Float32Array,
    weights: Float32Array,
    offset: number
  ): Float32Array {
    const output = new Float32Array(this.dimension);

    for (let o = 0; o < this.dimension; o++) {
      let sum = 0;
      for (let i = 0; i < this.dimension; i++) {
        sum += input[offset + i] * weights[i * this.dimension + o];
      }
      output[o] = sum;
    }

    return output;
  }

  /**
   * Sigmoid activation
   */
  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, x))));
  }

  /**
   * RWKV Time Mixing (WKV computation)
   *
   * Computes the weighted key-value aggregation with exponential decay.
   * Uses numerically stable formulation to prevent overflow.
   */
  private computeWKV(
    k: Float32Array,
    v: Float32Array,
    stateWkv: Float32Array,  // [dim]
    stateNum: Float32Array,  // [dim]
    stateMax: Float32Array   // [dim] - for numerical stability
  ): { wkv: Float32Array; newStateWkv: Float32Array; newStateNum: Float32Array; newStateMax: Float32Array } {
    const wkv = new Float32Array(this.dimension);
    const newStateWkv = new Float32Array(this.dimension);
    const newStateNum = new Float32Array(this.dimension);
    const newStateMax = new Float32Array(this.dimension);

    for (let d = 0; d < this.dimension; d++) {
      const u = this.timeFirst[d];  // Current token bonus
      const w = this.timeDecay[d];  // Time decay

      // Current contribution: exp(u + k)
      const curScore = u + k[d];

      // For numerical stability, track max score
      const prevMax = stateMax[d];
      const newMax = Math.max(prevMax + w, curScore);

      // Rescale previous state to new max
      const expPrevScale = Math.exp(prevMax + w - newMax);
      const expCurScale = Math.exp(curScore - newMax);

      // Compute WKV output
      const numerator = stateWkv[d] * expPrevScale + v[d] * expCurScale;
      const denominator = stateNum[d] * expPrevScale + expCurScale;

      wkv[d] = denominator > 1e-30 ? numerator / denominator : 0;

      // Update state for next timestep
      // state' = exp(w) * state + exp(k) * current
      newStateWkv[d] = stateWkv[d] * expPrevScale + v[d] * expCurScale;
      newStateNum[d] = stateNum[d] * expPrevScale + expCurScale;
      newStateMax[d] = newMax;
    }

    return { wkv, newStateWkv, newStateNum, newStateMax };
  }

  /**
   * Forward pass: RWKV Time Mixing
   *
   * Algorithm:
   * 1. Apply token shift (mix current with previous)
   * 2. Compute r, k, v projections
   * 3. Compute WKV (weighted key-value) with recurrence
   * 4. Gate output with receptance
   * 5. Project to output dimension
   *
   * Note: In RWKV, query/key/value are computed internally from input.
   * We use query as the input; key/value parameters are for compatibility.
   *
   * @param query Input vectors [seq_len × dimension] (main input)
   * @param _key Ignored (for interface compatibility)
   * @param _value Ignored (for interface compatibility)
   * @param _mask Ignored (RWKV is naturally causal)
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

    const output = new Float32Array(actualSeqLen * this.dimension);

    // Initialize state
    let stateWkv = new Float32Array(this.dimension);
    let stateNum = new Float32Array(this.dimension);
    let stateMax = new Float32Array(this.dimension).fill(-Infinity);

    // Previous token for time mixing (starts as zeros)
    let prevToken = new Float32Array(this.dimension);

    // Process each timestep
    for (let t = 0; t < actualSeqLen; t++) {
      const inOffset = t * this.dimension;
      const outOffset = t * this.dimension;

      // Get current token
      const currentToken = new Float32Array(this.dimension);
      for (let d = 0; d < this.dimension; d++) {
        currentToken[d] = query[inOffset + d];
      }

      // Step 1: Token shift (mix current with previous)
      const mixed = new Float32Array(this.dimension);
      for (let d = 0; d < this.dimension; d++) {
        mixed[d] = this.timeMix[d] * currentToken[d] +
          (1 - this.timeMix[d]) * prevToken[d];
      }

      // Step 2: Compute r, k, v from mixed input
      const rProj = this.project(mixed, this.wReceptance, 0);
      const kProj = this.project(mixed, this.wKey, 0);
      const vProj = this.project(mixed, this.wValue, 0);

      // Apply sigmoid to receptance
      const r = new Float32Array(this.dimension);
      for (let d = 0; d < this.dimension; d++) {
        r[d] = this.sigmoid(rProj[d]);
      }

      // Step 3: Compute WKV with state update
      const wkvResult =
        this.computeWKV(kProj, vProj, stateWkv, stateNum, stateMax);
      const wkv = wkvResult.wkv;

      // Update state for next timestep (copy values to avoid reassignment)
      for (let d = 0; d < this.dimension; d++) {
        stateWkv[d] = wkvResult.newStateWkv[d];
        stateNum[d] = wkvResult.newStateNum[d];
        stateMax[d] = wkvResult.newStateMax[d];
      }

      // Step 4: Gate with receptance (element-wise)
      const gated = new Float32Array(this.dimension);
      for (let d = 0; d < this.dimension; d++) {
        gated[d] = r[d] * wkv[d];
      }

      // Step 5: Output projection
      const outputToken = this.project(gated, this.wOutput, 0);

      // Store output
      for (let d = 0; d < this.dimension; d++) {
        output[outOffset + d] = outputToken[d];
      }

      // Update previous token for next timestep
      prevToken = currentToken;
    }

    // Validate output
    if (hasNaNOrInf(output)) {
      throw new Error('ANTI-009: RWKV attention forward pass produced NaN or Inf values');
    }

    return output;
  }

  /**
   * Get total parameter count
   *
   * RWKV parameters:
   * - wReceptance: dim × dim
   * - wKey: dim × dim
   * - wValue: dim × dim
   * - wOutput: dim × dim
   * - timeDecay: dim
   * - timeFirst: dim
   * - timeMix: dim
   */
  getParameterCount(): number {
    return (
      4 * this.dimension * this.dimension +  // 4 projection matrices
      3 * this.dimension                      // timeDecay + timeFirst + timeMix
    );
  }
}
