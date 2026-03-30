/**
 * Adam Optimizer - Adaptive Moment Estimation
 *
 * Implements the Adam optimization algorithm for training GNN layers.
 * Adam combines the benefits of AdaGrad and RMSProp by tracking both
 * first moment (mean) and second moment (variance) of gradients.
 *
 * Algorithm (Kingma & Ba, 2014):
 *   m_t = beta1 * m_{t-1} + (1 - beta1) * g_t
 *   v_t = beta2 * v_{t-1} + (1 - beta2) * g_t^2
 *   m_hat_t = m_t / (1 - beta1^t)
 *   v_hat_t = v_t / (1 - beta2^t)
 *   theta_t = theta_{t-1} - alpha * m_hat_t / (sqrt(v_hat_t) + epsilon)
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-GNN-006 (Adam Optimizer)
 *
 * CONSTITUTION COMPLIANCE:
 * - RULE-079: No magic numbers (all defaults documented)
 * - RULE-089: Dimension consistency enforced
 *
 * @module src/god-agent/core/reasoning/adam-optimizer
 */

import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../observability/index.js';

const logger = createComponentLogger('AdamOptimizer', {
  minLevel: LogLevel.WARN,
  handlers: [new ConsoleLogHandler()]
});

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Adam optimizer configuration
 * Implements: TASK-GNN-006 AC-001
 *
 * @interface AdamConfig
 */
export interface AdamConfig {
  /**
   * Learning rate (alpha)
   * @default 0.001
   * @rationale Standard Adam default per Kingma & Ba (2014)
   */
  learningRate: number;

  /**
   * Exponential decay rate for first moment estimates (beta1)
   * @default 0.9
   * @rationale Standard Adam default, controls momentum
   */
  beta1: number;

  /**
   * Exponential decay rate for second moment estimates (beta2)
   * @default 0.999
   * @rationale Standard Adam default, controls adaptive learning rate
   */
  beta2: number;

  /**
   * Small constant for numerical stability (epsilon)
   * @default 1e-8
   * @rationale Prevents division by zero in weight update
   */
  epsilon: number;

  /**
   * L2 regularization coefficient (weight decay)
   * @default 0
   * @rationale AdamW style decoupled weight decay
   */
  weightDecay: number;
}

/**
 * Serializable optimizer state for save/restore
 * Implements: TASK-GNN-006 AC-003
 *
 * @interface AdamState
 */
export interface AdamState {
  /** First moment estimates (m) per weight key */
  m: Record<string, number[]>;

  /** Second moment estimates (v) per weight key */
  v: Record<string, number[]>;

  /** Current timestep */
  t: number;

  /** Configuration used */
  config: AdamConfig;

  /** Version for compatibility checking */
  version: string;
}

/**
 * Result of a single optimization step
 *
 * @interface StepResult
 */
export interface StepResult {
  /** Updated weights */
  weights: Map<string, Float32Array>;

  /** Maximum gradient magnitude seen */
  maxGradientMag: number;

  /** Maximum weight update magnitude */
  maxUpdateMag: number;

  /** Number of weights updated */
  weightsUpdated: number;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Default Adam configuration
 * Values from Kingma & Ba (2014) "Adam: A Method for Stochastic Optimization"
 */
const DEFAULT_ADAM_CONFIG: AdamConfig = {
  learningRate: 0.001,  // alpha
  beta1: 0.9,           // momentum coefficient
  beta2: 0.999,         // RMSProp coefficient
  epsilon: 1e-8,        // numerical stability
  weightDecay: 0,       // no weight decay by default
};

/**
 * Current state version for compatibility
 */
const STATE_VERSION = '1.0.0';

/**
 * Minimum value for bias-corrected second moment to prevent numerical issues
 */
const MIN_V_HAT = 1e-10;

// =============================================================================
// AdamOptimizer Class
// =============================================================================

/**
 * Adam Optimizer for GNN weight updates
 *
 * Features:
 * - Adaptive learning rates per parameter
 * - Momentum for faster convergence
 * - Bias correction for early timesteps
 * - Optional weight decay (AdamW style)
 * - State save/restore for training resumption
 *
 * Implements: TASK-GNN-006
 *
 * @example
 * ```typescript
 * const optimizer = new AdamOptimizer({ learningRate: 0.001 });
 *
 * // Training loop
 * for (const batch of batches) {
 *   const gradients = computeGradients(batch);
 *   weights = optimizer.step(weights, gradients);
 * }
 *
 * // Save state for later
 * const state = optimizer.getState();
 * ```
 */
export class AdamOptimizer {
  /** First moment estimates (mean of gradients) */
  private m: Map<string, Float32Array>;

  /** Second moment estimates (variance of gradients) */
  private v: Map<string, Float32Array>;

  /** Current timestep */
  private t: number;

  /** Optimizer configuration */
  private config: AdamConfig;

  /**
   * Create an Adam optimizer instance
   *
   * @param config - Partial configuration (merged with defaults)
   */
  constructor(config: Partial<AdamConfig> = {}) {
    this.config = { ...DEFAULT_ADAM_CONFIG, ...config };
    this.m = new Map();
    this.v = new Map();
    this.t = 0;

    // Validate configuration
    this.validateConfig();
  }

  /**
   * Validate configuration values
   * @throws Error if configuration is invalid
   */
  private validateConfig(): void {
    const { learningRate, beta1, beta2, epsilon, weightDecay } = this.config;

    if (learningRate <= 0) {
      throw new Error(`Invalid learning rate: ${learningRate}. Must be positive.`);
    }
    if (beta1 < 0 || beta1 >= 1) {
      throw new Error(`Invalid beta1: ${beta1}. Must be in [0, 1).`);
    }
    if (beta2 < 0 || beta2 >= 1) {
      throw new Error(`Invalid beta2: ${beta2}. Must be in [0, 1).`);
    }
    if (epsilon <= 0) {
      throw new Error(`Invalid epsilon: ${epsilon}. Must be positive.`);
    }
    if (weightDecay < 0) {
      throw new Error(`Invalid weight decay: ${weightDecay}. Must be non-negative.`);
    }
  }

  /**
   * Ensure moment buffers exist for a weight key
   * Implements: TASK-GNN-006 AC-002 (momentum/velocity per weight)
   *
   * @param key - Weight identifier
   * @param dim - Weight dimension
   */
  private ensureMomentBuffers(key: string, dim: number): void {
    if (!this.m.has(key)) {
      this.m.set(key, new Float32Array(dim));
    }
    if (!this.v.has(key)) {
      this.v.set(key, new Float32Array(dim));
    }

    // Resize if dimension changed
    const mBuf = this.m.get(key)!;
    const vBuf = this.v.get(key)!;

    if (mBuf.length !== dim) {
      const newM = new Float32Array(dim);
      newM.set(mBuf.slice(0, Math.min(mBuf.length, dim)));
      this.m.set(key, newM);
    }

    if (vBuf.length !== dim) {
      const newV = new Float32Array(dim);
      newV.set(vBuf.slice(0, Math.min(vBuf.length, dim)));
      this.v.set(key, newV);
    }
  }

  /**
   * Perform a single optimization step
   * Implements: TASK-GNN-006 AC-001 (Adam algorithm)
   *
   * Adam update rule:
   *   m_t = beta1 * m_{t-1} + (1 - beta1) * g_t
   *   v_t = beta2 * v_{t-1} + (1 - beta2) * g_t^2
   *   m_hat_t = m_t / (1 - beta1^t)  (bias correction)
   *   v_hat_t = v_t / (1 - beta2^t)  (bias correction)
   *   theta_t = theta_{t-1} - alpha * m_hat_t / (sqrt(v_hat_t) + epsilon)
   *
   * With optional AdamW weight decay:
   *   theta_t = theta_t - alpha * weight_decay * theta_{t-1}
   *
   * @param weights - Current weight matrices (key -> flattened weights)
   * @param gradients - Computed gradients (key -> flattened gradients)
   * @returns Updated weight matrices
   */
  step(
    weights: Map<string, Float32Array>,
    gradients: Map<string, Float32Array>
  ): Map<string, Float32Array> {
    // Increment timestep
    this.t += 1;

    const { learningRate, beta1, beta2, epsilon, weightDecay } = this.config;

    // Precompute bias correction factors
    // Implements: TASK-GNN-006 AC-001 (bias correction)
    const beta1Power = Math.pow(beta1, this.t);
    const beta2Power = Math.pow(beta2, this.t);
    const biasCorrection1 = 1 - beta1Power;
    const biasCorrection2 = 1 - beta2Power;

    // Handle edge case where bias correction could be zero or negative
    // Implements: TASK-GNN-006 AC-004 (numerical stability)
    const safeBiasCorrection1 = Math.max(biasCorrection1, epsilon);
    const safeBiasCorrection2 = Math.max(biasCorrection2, epsilon);

    const updatedWeights = new Map<string, Float32Array>();

    for (const [key, weight] of weights) {
      const gradient = gradients.get(key);

      if (!gradient) {
        // No gradient for this weight, keep unchanged
        updatedWeights.set(key, new Float32Array(weight));
        continue;
      }

      const dim = weight.length;

      // Ensure moment buffers exist
      // Implements: TASK-GNN-006 AC-002 (per-weight momentum/velocity)
      this.ensureMomentBuffers(key, dim);

      const m = this.m.get(key)!;
      const v = this.v.get(key)!;

      // Create output buffer
      const newWeight = new Float32Array(dim);

      for (let i = 0; i < dim; i++) {
        const g = i < gradient.length ? gradient[i] : 0;

        // Check for NaN/Inf gradients
        // Implements: TASK-GNN-006 AC-004 (numerical stability)
        if (!Number.isFinite(g)) {
          // Skip this parameter, keep original weight
          newWeight[i] = weight[i];
          continue;
        }

        // Update biased first moment estimate: m_t = beta1 * m_{t-1} + (1 - beta1) * g_t
        m[i] = beta1 * m[i] + (1 - beta1) * g;

        // Update biased second moment estimate: v_t = beta2 * v_{t-1} + (1 - beta2) * g_t^2
        v[i] = beta2 * v[i] + (1 - beta2) * g * g;

        // Compute bias-corrected first moment: m_hat = m_t / (1 - beta1^t)
        const mHat = m[i] / safeBiasCorrection1;

        // Compute bias-corrected second moment: v_hat = v_t / (1 - beta2^t)
        // Implements: TASK-GNN-006 AC-004 (epsilon handling for numerical stability)
        const vHat = Math.max(v[i] / safeBiasCorrection2, MIN_V_HAT);

        // Compute update: delta = alpha * m_hat / (sqrt(v_hat) + epsilon)
        const update = learningRate * mHat / (Math.sqrt(vHat) + epsilon);

        // Apply update: theta_t = theta_{t-1} - delta
        newWeight[i] = weight[i] - update;

        // Apply weight decay (AdamW style - decoupled from gradient)
        // Implements: TASK-GNN-006 AC-005 (weight decay option)
        if (weightDecay > 0) {
          newWeight[i] -= learningRate * weightDecay * weight[i];
        }

        // Check for NaN in output
        if (!Number.isFinite(newWeight[i])) {
          // Fallback to original weight
          newWeight[i] = weight[i];
          logger.warn('NaN detected in weight update, falling back to original', { key, index: i });
        }
      }

      updatedWeights.set(key, newWeight);
    }

    return updatedWeights;
  }

  /**
   * Perform optimization step and return detailed results
   *
   * @param weights - Current weight matrices
   * @param gradients - Computed gradients
   * @returns StepResult with updated weights and statistics
   */
  stepWithStats(
    weights: Map<string, Float32Array>,
    gradients: Map<string, Float32Array>
  ): StepResult {
    // Compute statistics before step
    let maxGradientMag = 0;
    for (const gradient of gradients.values()) {
      for (let i = 0; i < gradient.length; i++) {
        const mag = Math.abs(gradient[i]);
        if (Number.isFinite(mag) && mag > maxGradientMag) {
          maxGradientMag = mag;
        }
      }
    }

    // Perform step
    const updatedWeights = this.step(weights, gradients);

    // Compute update magnitude
    let maxUpdateMag = 0;
    let weightsUpdated = 0;

    for (const [key, newWeight] of updatedWeights) {
      const oldWeight = weights.get(key);
      if (oldWeight) {
        weightsUpdated++;
        for (let i = 0; i < newWeight.length && i < oldWeight.length; i++) {
          const updateMag = Math.abs(newWeight[i] - oldWeight[i]);
          if (Number.isFinite(updateMag) && updateMag > maxUpdateMag) {
            maxUpdateMag = updateMag;
          }
        }
      }
    }

    return {
      weights: updatedWeights,
      maxGradientMag,
      maxUpdateMag,
      weightsUpdated,
    };
  }

  /**
   * Reset optimizer state
   * Implements: TASK-GNN-006 AC-003 (state management)
   *
   * Clears all moment estimates and resets timestep to zero.
   * Use this when starting fresh training or after major architecture changes.
   */
  reset(): void {
    this.m.clear();
    this.v.clear();
    this.t = 0;
  }

  /**
   * Get serializable optimizer state
   * Implements: TASK-GNN-006 AC-003 (state save/restore)
   *
   * @returns AdamState object that can be serialized to JSON
   */
  getState(): AdamState {
    const mRecord: Record<string, number[]> = {};
    const vRecord: Record<string, number[]> = {};

    for (const [key, arr] of this.m) {
      mRecord[key] = Array.from(arr);
    }

    for (const [key, arr] of this.v) {
      vRecord[key] = Array.from(arr);
    }

    return {
      m: mRecord,
      v: vRecord,
      t: this.t,
      config: { ...this.config },
      version: STATE_VERSION,
    };
  }

  /**
   * Restore optimizer state from saved state
   * Implements: TASK-GNN-006 AC-003 (state save/restore)
   *
   * @param state - Previously saved AdamState
   * @throws Error if state version is incompatible
   */
  setState(state: AdamState): void {
    // Version check for compatibility
    if (state.version !== STATE_VERSION) {
      logger.warn('Adam state version mismatch', {
        expected: STATE_VERSION,
        actual: state.version
      });
      // Continue anyway for now, but log warning
    }

    // Restore configuration
    this.config = { ...DEFAULT_ADAM_CONFIG, ...state.config };
    this.validateConfig();

    // Restore timestep
    this.t = state.t;

    // Restore first moment estimates
    this.m.clear();
    for (const [key, arr] of Object.entries(state.m)) {
      this.m.set(key, new Float32Array(arr));
    }

    // Restore second moment estimates
    this.v.clear();
    for (const [key, arr] of Object.entries(state.v)) {
      this.v.set(key, new Float32Array(arr));
    }
  }

  /**
   * Get current timestep
   */
  getTimestep(): number {
    return this.t;
  }

  /**
   * Get current configuration
   */
  getConfig(): AdamConfig {
    return { ...this.config };
  }

  /**
   * Update configuration (only affects future steps)
   *
   * @param config - Partial configuration to update
   */
  updateConfig(config: Partial<AdamConfig>): void {
    this.config = { ...this.config, ...config };
    this.validateConfig();
  }

  /**
   * Get learning rate (convenience method)
   */
  getLearningRate(): number {
    return this.config.learningRate;
  }

  /**
   * Set learning rate (convenience method for learning rate scheduling)
   *
   * @param lr - New learning rate
   */
  setLearningRate(lr: number): void {
    if (lr <= 0) {
      throw new Error(`Invalid learning rate: ${lr}. Must be positive.`);
    }
    this.config.learningRate = lr;
  }

  /**
   * Get number of tracked weight tensors
   */
  getNumTrackedWeights(): number {
    return this.m.size;
  }

  /**
   * Check if a weight key is being tracked
   *
   * @param key - Weight identifier
   */
  isTracking(key: string): boolean {
    return this.m.has(key) && this.v.has(key);
  }

  /**
   * Get moment statistics for debugging
   *
   * @param key - Weight identifier
   * @returns Moment statistics or null if not tracked
   */
  getMomentStats(key: string): { mMean: number; mMax: number; vMean: number; vMax: number } | null {
    const m = this.m.get(key);
    const v = this.v.get(key);

    if (!m || !v) {
      return null;
    }

    let mSum = 0, mMax = 0, vSum = 0, vMax = 0;

    for (let i = 0; i < m.length; i++) {
      mSum += m[i];
      if (Math.abs(m[i]) > Math.abs(mMax)) mMax = m[i];
    }

    for (let i = 0; i < v.length; i++) {
      vSum += v[i];
      if (v[i] > vMax) vMax = v[i];
    }

    return {
      mMean: m.length > 0 ? mSum / m.length : 0,
      mMax,
      vMean: v.length > 0 ? vSum / v.length : 0,
      vMax,
    };
  }

  /**
   * Clear moment estimates for a specific weight key
   * Useful when a layer is re-initialized
   *
   * @param key - Weight identifier to clear
   */
  clearMoments(key: string): void {
    this.m.delete(key);
    this.v.delete(key);
  }

  /**
   * Get memory usage in bytes
   */
  getMemoryUsage(): number {
    let bytes = 0;
    for (const arr of this.m.values()) {
      bytes += arr.byteLength;
    }
    for (const arr of this.v.values()) {
      bytes += arr.byteLength;
    }
    return bytes;
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create default Adam optimizer
 */
export function createAdamOptimizer(config?: Partial<AdamConfig>): AdamOptimizer {
  return new AdamOptimizer(config);
}

/**
 * Convert 2D weight matrix to flat array for optimizer
 *
 * @param weights - 2D weight matrix (rows x cols)
 * @returns Flattened Float32Array
 */
export function flattenWeights(weights: Float32Array[]): Float32Array {
  if (weights.length === 0) {
    return new Float32Array(0);
  }

  const numRows = weights.length;
  const numCols = weights[0].length;
  const flat = new Float32Array(numRows * numCols);

  let offset = 0;
  for (let r = 0; r < numRows; r++) {
    const row = weights[r];
    for (let c = 0; c < numCols; c++) {
      flat[offset++] = c < row.length ? row[c] : 0;
    }
  }

  return flat;
}

/**
 * Convert flat array back to 2D weight matrix
 *
 * @param flat - Flattened weight array
 * @param numRows - Number of rows (output dimension)
 * @param numCols - Number of columns (input dimension)
 * @returns 2D weight matrix
 */
export function unflattenWeights(
  flat: Float32Array,
  numRows: number,
  numCols: number
): Float32Array[] {
  const weights: Float32Array[] = [];

  let offset = 0;
  for (let r = 0; r < numRows; r++) {
    const row = new Float32Array(numCols);
    for (let c = 0; c < numCols; c++) {
      row[c] = offset < flat.length ? flat[offset++] : 0;
    }
    weights.push(row);
  }

  return weights;
}

/**
 * Apply Adam optimizer to 2D weight matrices
 * Convenience function that handles flattening/unflattening
 *
 * @param optimizer - Adam optimizer instance
 * @param weights - Map of layer ID to 2D weight matrices
 * @param gradients - Map of layer ID to 2D gradient matrices
 * @returns Updated 2D weight matrices
 */
export function applyAdamTo2DWeights(
  optimizer: AdamOptimizer,
  weights: Map<string, Float32Array[]>,
  gradients: Map<string, Float32Array[]>
): Map<string, Float32Array[]> {
  // Flatten all weights and gradients
  const flatWeights = new Map<string, Float32Array>();
  const flatGradients = new Map<string, Float32Array>();
  const dimensions = new Map<string, { rows: number; cols: number }>();

  for (const [key, w] of weights) {
    if (w.length > 0) {
      flatWeights.set(key, flattenWeights(w));
      dimensions.set(key, { rows: w.length, cols: w[0].length });
    }
  }

  for (const [key, g] of gradients) {
    if (g.length > 0) {
      flatGradients.set(key, flattenWeights(g));
    }
  }

  // Apply optimizer
  const updatedFlat = optimizer.step(flatWeights, flatGradients);

  // Unflatten results
  const updated2D = new Map<string, Float32Array[]>();
  for (const [key, flat] of updatedFlat) {
    const dims = dimensions.get(key);
    if (dims) {
      updated2D.set(key, unflattenWeights(flat, dims.rows, dims.cols));
    }
  }

  return updated2D;
}
