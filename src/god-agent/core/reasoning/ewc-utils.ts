/**
 * Elastic Weight Consolidation (EWC) Utilities
 *
 * Implements EWC regularization to prevent "Catastrophic Forgetting" in continual learning.
 * When the model learns new tasks, EWC prevents it from forgetting previously learned tasks
 * by adding a penalty term to the loss function that penalizes changes to important weights.
 *
 * EWC Formula:
 * L_total = L_task + (lambda/2) * sum_i F_i * (theta_i - theta_i*)^2
 *
 * Where:
 * - L_task = Task-specific loss (e.g., contrastive loss)
 * - lambda = EWC regularization strength (from LORA_PARAMS.ewcLambda)
 * - F_i = Fisher information for parameter i (importance weight)
 * - theta_i = Current parameter value
 * - theta_i* = Optimal parameter value from previous task(s)
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-GNN-008 (EWC Integration)
 *
 * CONSTITUTION COMPLIANCE:
 * - RULE-079: No magic numbers (uses LORA_PARAMS constant)
 * - RULE-028: All feedback persisted
 * - RULE-046: Atomic operations
 *
 * References:
 * - Kirkpatrick et al. "Overcoming catastrophic forgetting in neural networks"
 *   https://arxiv.org/abs/1612.00796
 * - Online EWC: Schwarz et al. "Progress & Compress: A scalable framework for
 *   continual learning" https://arxiv.org/abs/1805.06370
 *
 * @module src/god-agent/core/reasoning/ewc-utils
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { LORA_PARAMS } from '../validation/constants.js';
import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../observability/index.js';
import { withRetrySync } from '../validation/index.js';

const logger = createComponentLogger('EWCRegularizer', {
  minLevel: LogLevel.INFO,
  handlers: [new ConsoleLogHandler()]
});

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Configuration for EWC regularization
 * Implements: TASK-GNN-008 specification
 */
export interface EWCConfig {
  /** Regularization strength (lambda) - from LORA_PARAMS.ewcLambda */
  lambda: number;

  /** Numerical stability epsilon for divisions */
  epsilon: number;

  /** Whether to use online EWC (accumulate Fisher over tasks) */
  online: boolean;

  /** Decay factor for online EWC (gamma in [0, 1]) */
  onlineDecay: number;

  /** Minimum Fisher value to consider a weight important */
  fisherThreshold: number;

  /** Path for persisting Fisher diagonal */
  persistPath: string;
}

/**
 * Result from computing EWC penalty
 */
export interface EWCPenaltyResult {
  /** Total EWC penalty term */
  penalty: number;

  /** Number of parameters with non-zero Fisher */
  importantParams: number;

  /** Total number of parameters */
  totalParams: number;

  /** Computation time in milliseconds */
  computeTimeMs: number;
}

/**
 * Result from computing EWC gradients
 */
export interface EWCGradientResult {
  /** Gradient map per layer */
  gradients: Map<string, Float32Array>;

  /** L2 norm of gradients */
  gradientNorm: number;

  /** Number of parameters affected */
  affectedParams: number;

  /** Computation time in milliseconds */
  computeTimeMs: number;
}

/**
 * Fisher information update result
 */
export interface FisherUpdateResult {
  /** Updated Fisher diagonal */
  fisher: Map<string, Float32Array>;

  /** Number of samples used */
  numSamples: number;

  /** Computation time in milliseconds */
  computeTimeMs: number;
}

/**
 * Serialized Fisher information for persistence
 */
interface SerializedFisher {
  version: string;
  timestamp: string;
  taskCount: number;
  layers: Array<{
    layerId: string;
    fisher: number[];
  }>;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_EWC_CONFIG: EWCConfig = {
  lambda: LORA_PARAMS.ewcLambda,  // 0.1 from constitution
  epsilon: 1e-8,
  online: true,  // Accumulate Fisher over tasks
  onlineDecay: 0.9,  // Decay factor for old Fisher information
  fisherThreshold: 1e-6,  // Minimum Fisher to consider important
  persistPath: '.agentdb/gnn/ewc',
};

const FISHER_VERSION = '1.0.0';

// =============================================================================
// EWCRegularizer Class
// =============================================================================

/**
 * EWCRegularizer - Elastic Weight Consolidation for Continual Learning
 *
 * Prevents catastrophic forgetting by:
 * 1. Computing Fisher information to identify important weights
 * 2. Adding penalty for changing important weights from optimal values
 * 3. Supporting online EWC for multiple sequential tasks
 *
 * Implements: TASK-GNN-008
 *
 * @example
 * ```typescript
 * const ewc = new EWCRegularizer({ lambda: 0.1 });
 *
 * // After training on task A, compute and store Fisher
 * const fisher = ewc.updateFisher(existingFisher, gradients, numSamples);
 *
 * // During training on task B, add EWC penalty
 * const penalty = ewc.computePenalty(currentWeights, optimalWeights, fisher);
 * const totalLoss = taskLoss + penalty;
 *
 * // Get EWC gradients for weight update
 * const ewcGradients = ewc.computeGradients(currentWeights, optimalWeights, fisher);
 * ```
 */
export class EWCRegularizer {
  private readonly config: EWCConfig;
  private taskCount: number = 0;

  /**
   * Create a new EWCRegularizer
   *
   * @param config - Partial configuration (defaults applied)
   */
  constructor(config: Partial<EWCConfig> = {}) {
    this.config = { ...DEFAULT_EWC_CONFIG, ...config };

    // Ensure persist directory exists
    this.ensureDirectories();

    logger.info('EWCRegularizer initialized', {
      lambda: this.config.lambda,
      online: this.config.online,
      onlineDecay: this.config.onlineDecay,
    });
  }

  /**
   * Ensure EWC persistence directories exist
   */
  private ensureDirectories(): void {
    if (!existsSync(this.config.persistPath)) {
      mkdirSync(this.config.persistPath, { recursive: true });
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<EWCConfig> {
    return { ...this.config };
  }

  /**
   * Get the number of tasks trained
   */
  getTaskCount(): number {
    return this.taskCount;
  }

  /**
   * Compute the EWC penalty term
   *
   * Implements: TASK-GNN-008 AC-001
   *
   * Penalty = (lambda/2) * sum_i F_i * (theta_i - theta_i*)^2
   *
   * @param currentWeights - Current model weights
   * @param optimalWeights - Optimal weights from previous task(s)
   * @param fisherDiagonal - Fisher information diagonal
   * @returns EWC penalty result
   */
  computePenalty(
    currentWeights: Map<string, Float32Array>,
    optimalWeights: Map<string, Float32Array>,
    fisherDiagonal: Map<string, Float32Array>
  ): EWCPenaltyResult {
    const startTime = performance.now();

    let penalty = 0;
    let importantParams = 0;
    let totalParams = 0;

    for (const [layerId, currentLayer] of currentWeights) {
      const optimalLayer = optimalWeights.get(layerId);
      const fisherLayer = fisherDiagonal.get(layerId);

      if (!optimalLayer || !fisherLayer) {
        continue;
      }

      const minLen = Math.min(currentLayer.length, optimalLayer.length, fisherLayer.length);

      for (let i = 0; i < minLen; i++) {
        const fisher = fisherLayer[i];
        totalParams++;

        // Only consider parameters with non-negligible Fisher information
        if (fisher > this.config.fisherThreshold) {
          const diff = currentLayer[i] - optimalLayer[i];
          penalty += fisher * diff * diff;
          importantParams++;
        }
      }
    }

    // Scale by lambda/2
    penalty *= this.config.lambda / 2;

    return {
      penalty,
      importantParams,
      totalParams,
      computeTimeMs: performance.now() - startTime,
    };
  }

  /**
   * Compute EWC gradients for weight update
   *
   * Implements: TASK-GNN-008 AC-001
   *
   * Gradient of EWC penalty with respect to theta_i:
   * d(EWC)/d(theta_i) = lambda * F_i * (theta_i - theta_i*)
   *
   * @param currentWeights - Current model weights
   * @param optimalWeights - Optimal weights from previous task(s)
   * @param fisherDiagonal - Fisher information diagonal
   * @returns EWC gradients per layer
   */
  computeGradients(
    currentWeights: Map<string, Float32Array>,
    optimalWeights: Map<string, Float32Array>,
    fisherDiagonal: Map<string, Float32Array>
  ): EWCGradientResult {
    const startTime = performance.now();

    const gradients = new Map<string, Float32Array>();
    let totalNormSq = 0;
    let affectedParams = 0;

    for (const [layerId, currentLayer] of currentWeights) {
      const optimalLayer = optimalWeights.get(layerId);
      const fisherLayer = fisherDiagonal.get(layerId);

      if (!optimalLayer || !fisherLayer) {
        // Return zero gradient for layers without optimal weights or Fisher
        gradients.set(layerId, new Float32Array(currentLayer.length));
        continue;
      }

      const minLen = Math.min(currentLayer.length, optimalLayer.length, fisherLayer.length);
      const layerGradient = new Float32Array(currentLayer.length);

      for (let i = 0; i < minLen; i++) {
        const fisher = fisherLayer[i];

        // Only compute gradient for important parameters
        if (fisher > this.config.fisherThreshold) {
          const diff = currentLayer[i] - optimalLayer[i];
          // Gradient: lambda * F_i * (theta_i - theta_i*)
          const grad = this.config.lambda * fisher * diff;
          layerGradient[i] = grad;
          totalNormSq += grad * grad;
          affectedParams++;
        }
      }

      gradients.set(layerId, layerGradient);
    }

    return {
      gradients,
      gradientNorm: Math.sqrt(totalNormSq),
      affectedParams,
      computeTimeMs: performance.now() - startTime,
    };
  }

  /**
   * Update Fisher information after completing a task
   *
   * Implements: TASK-GNN-008 AC-002
   *
   * Fisher information is approximated by the squared gradients:
   * F_i = E[(d(L)/d(theta_i))^2]
   *
   * For online EWC (when config.online = true):
   * F_new = gamma * F_old + (1 - gamma) * F_task
   *
   * @param existingFisher - Existing Fisher diagonal (from previous tasks)
   * @param taskGradients - Array of gradient samples from the completed task
   * @param numSamples - Number of samples used for gradient computation
   * @returns Updated Fisher diagonal
   */
  updateFisher(
    existingFisher: Map<string, Float32Array>,
    taskGradients: Map<string, Float32Array>[],
    numSamples: number
  ): FisherUpdateResult {
    const startTime = performance.now();

    if (taskGradients.length === 0 || numSamples === 0) {
      logger.warn('No gradients provided for Fisher update');
      return {
        fisher: existingFisher,
        numSamples: 0,
        computeTimeMs: performance.now() - startTime,
      };
    }

    // Compute empirical Fisher from gradient samples
    // F_i = (1/N) * sum_n (g_n,i)^2
    const taskFisher = new Map<string, Float32Array>();

    // Collect all layer IDs from gradients
    const allLayerIds = new Set<string>();
    for (const gradientSample of taskGradients) {
      for (const layerId of gradientSample.keys()) {
        allLayerIds.add(layerId);
      }
    }

    // Compute squared gradient mean for each layer
    for (const layerId of allLayerIds) {
      // Get dimension from first gradient sample
      let dim = 0;
      for (const sample of taskGradients) {
        const grad = sample.get(layerId);
        if (grad) {
          dim = grad.length;
          break;
        }
      }

      if (dim === 0) continue;

      const fisher = new Float32Array(dim);

      // Sum squared gradients
      for (const sample of taskGradients) {
        const grad = sample.get(layerId);
        if (!grad) continue;

        for (let i = 0; i < Math.min(dim, grad.length); i++) {
          fisher[i] += grad[i] * grad[i];
        }
      }

      // Average over samples
      const invN = 1.0 / numSamples;
      for (let i = 0; i < dim; i++) {
        fisher[i] *= invN;
      }

      taskFisher.set(layerId, fisher);
    }

    // Combine with existing Fisher using online EWC
    const updatedFisher = new Map<string, Float32Array>();

    if (this.config.online && existingFisher.size > 0) {
      // Online EWC: F_new = gamma * F_old + (1 - gamma) * F_task
      const gamma = this.config.onlineDecay;
      const oneMinusGamma = 1 - gamma;

      // Process existing Fisher entries
      for (const [layerId, existingLayer] of existingFisher) {
        const taskLayer = taskFisher.get(layerId);
        const combined = new Float32Array(existingLayer.length);

        if (taskLayer) {
          for (let i = 0; i < existingLayer.length; i++) {
            combined[i] = gamma * existingLayer[i];
            if (i < taskLayer.length) {
              combined[i] += oneMinusGamma * taskLayer[i];
            }
          }
        } else {
          // No new Fisher for this layer, keep decayed old Fisher
          for (let i = 0; i < existingLayer.length; i++) {
            combined[i] = gamma * existingLayer[i];
          }
        }

        updatedFisher.set(layerId, combined);
      }

      // Add new layers from task Fisher
      for (const [layerId, taskLayer] of taskFisher) {
        if (!existingFisher.has(layerId)) {
          updatedFisher.set(layerId, taskLayer);
        }
      }
    } else {
      // First task or non-online: just use task Fisher
      for (const [layerId, fisher] of taskFisher) {
        updatedFisher.set(layerId, new Float32Array(fisher));
      }
    }

    this.taskCount++;

    return {
      fisher: updatedFisher,
      numSamples,
      computeTimeMs: performance.now() - startTime,
    };
  }

  /**
   * Convert 2D weight matrix to 1D array for EWC operations
   *
   * @param weights - 2D weight matrix (array of rows)
   * @returns Flattened 1D array
   */
  static flattenWeights(weights: Float32Array[]): Float32Array {
    if (weights.length === 0) return new Float32Array(0);

    const totalLen = weights.reduce((sum, row) => sum + row.length, 0);
    const flat = new Float32Array(totalLen);

    let offset = 0;
    for (const row of weights) {
      flat.set(row, offset);
      offset += row.length;
    }

    return flat;
  }

  /**
   * Convert 1D array back to 2D weight matrix
   *
   * @param flat - Flattened 1D array
   * @param numRows - Number of rows in original matrix
   * @param numCols - Number of columns in original matrix
   * @returns 2D weight matrix
   */
  static unflattenWeights(flat: Float32Array, numRows: number, numCols: number): Float32Array[] {
    const weights: Float32Array[] = [];

    for (let r = 0; r < numRows; r++) {
      const start = r * numCols;
      weights.push(flat.slice(start, start + numCols));
    }

    return weights;
  }

  /**
   * Save Fisher diagonal to disk
   *
   * Implements: TASK-GNN-008 AC-003
   *
   * @param fisher - Fisher diagonal to save
   * @param filename - Optional filename (default: fisher.json)
   */
  async saveFisher(
    fisher: Map<string, Float32Array>,
    filename: string = 'fisher.json'
  ): Promise<void> {
    const filePath = join(this.config.persistPath, filename);
    const dir = dirname(filePath);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const serialized: SerializedFisher = {
      version: FISHER_VERSION,
      timestamp: new Date().toISOString(),
      taskCount: this.taskCount,
      layers: [],
    };

    for (const [layerId, fisherArray] of fisher) {
      serialized.layers.push({
        layerId,
        fisher: Array.from(fisherArray),
      });
    }

    // Write with retry (RULE-072: file operations must retry)
    withRetrySync(
      () => writeFileSync(filePath, JSON.stringify(serialized, null, 2)),
      { operationName: 'EWCRegularizer.saveFisher' }
    );

    logger.info('Fisher diagonal saved', {
      path: filePath,
      layers: fisher.size,
      taskCount: this.taskCount,
    });
  }

  /**
   * Load Fisher diagonal from disk
   *
   * Implements: TASK-GNN-008 AC-003
   *
   * @param filename - Optional filename (default: fisher.json)
   * @returns Loaded Fisher diagonal or null if not found
   */
  async loadFisher(filename: string = 'fisher.json'): Promise<Map<string, Float32Array> | null> {
    const filePath = join(this.config.persistPath, filename);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const serialized = JSON.parse(content) as SerializedFisher;

      // Validate version
      if (serialized.version !== FISHER_VERSION) {
        logger.warn('Fisher version mismatch', {
          expected: FISHER_VERSION,
          actual: serialized.version,
        });
      }

      const fisher = new Map<string, Float32Array>();

      for (const layer of serialized.layers) {
        fisher.set(layer.layerId, new Float32Array(layer.fisher));
      }

      this.taskCount = serialized.taskCount || 0;

      logger.info('Fisher diagonal loaded', {
        path: filePath,
        layers: fisher.size,
        taskCount: this.taskCount,
      });

      return fisher;
    } catch (error) {
      logger.warn('Error loading Fisher diagonal', { error: String(error) });
      return null;
    }
  }

  /**
   * Compute Fisher information estimate from a single batch
   *
   * This is useful for computing Fisher incrementally during training.
   *
   * @param gradients - Gradients from a single batch
   * @returns Fisher estimate for this batch
   */
  computeBatchFisher(gradients: Map<string, Float32Array>): Map<string, Float32Array> {
    const fisher = new Map<string, Float32Array>();

    for (const [layerId, grad] of gradients) {
      const fisherLayer = new Float32Array(grad.length);

      // Fisher ≈ squared gradient
      for (let i = 0; i < grad.length; i++) {
        fisherLayer[i] = grad[i] * grad[i];
      }

      fisher.set(layerId, fisherLayer);
    }

    return fisher;
  }

  /**
   * Apply EWC-weighted update to weights
   *
   * This modifies the weight update to account for EWC:
   * theta_new = theta - lr * (g_task + g_ewc)
   *
   * Where g_ewc = lambda * F * (theta - theta*)
   *
   * @param weightUpdate - Original weight update (from task gradient)
   * @param currentWeights - Current weights
   * @param optimalWeights - Optimal weights from previous task
   * @param fisherDiagonal - Fisher information
   * @returns Combined weight update including EWC
   */
  applyEWCToUpdate(
    weightUpdate: Map<string, Float32Array>,
    currentWeights: Map<string, Float32Array>,
    optimalWeights: Map<string, Float32Array>,
    fisherDiagonal: Map<string, Float32Array>
  ): Map<string, Float32Array> {
    // Get EWC gradients
    const ewcResult = this.computeGradients(currentWeights, optimalWeights, fisherDiagonal);

    // Combine task gradient with EWC gradient
    const combinedUpdate = new Map<string, Float32Array>();

    for (const [layerId, taskUpdate] of weightUpdate) {
      const ewcGrad = ewcResult.gradients.get(layerId);
      const combined = new Float32Array(taskUpdate.length);

      for (let i = 0; i < taskUpdate.length; i++) {
        combined[i] = taskUpdate[i];
        if (ewcGrad && i < ewcGrad.length) {
          combined[i] += ewcGrad[i];
        }
      }

      combinedUpdate.set(layerId, combined);
    }

    // Add EWC gradients for layers not in task update
    for (const [layerId, ewcGrad] of ewcResult.gradients) {
      if (!weightUpdate.has(layerId)) {
        combinedUpdate.set(layerId, new Float32Array(ewcGrad));
      }
    }

    return combinedUpdate;
  }

  /**
   * Get statistics about Fisher information
   *
   * @param fisher - Fisher diagonal
   * @returns Statistics about the Fisher distribution
   */
  getFisherStats(fisher: Map<string, Float32Array>): {
    totalParams: number;
    importantParams: number;
    meanFisher: number;
    maxFisher: number;
    minNonZeroFisher: number;
    layerStats: Map<string, { mean: number; max: number; important: number }>;
  } {
    let totalParams = 0;
    let importantParams = 0;
    let sumFisher = 0;
    let maxFisher = 0;
    let minNonZeroFisher = Infinity;
    const layerStats = new Map<string, { mean: number; max: number; important: number }>();

    for (const [layerId, fisherLayer] of fisher) {
      let layerSum = 0;
      let layerMax = 0;
      let layerImportant = 0;

      for (let i = 0; i < fisherLayer.length; i++) {
        const f = fisherLayer[i];
        totalParams++;
        sumFisher += f;

        if (f > maxFisher) maxFisher = f;
        if (f > this.config.fisherThreshold) {
          importantParams++;
          layerImportant++;
          if (f < minNonZeroFisher) minNonZeroFisher = f;
        }

        layerSum += f;
        if (f > layerMax) layerMax = f;
      }

      layerStats.set(layerId, {
        mean: fisherLayer.length > 0 ? layerSum / fisherLayer.length : 0,
        max: layerMax,
        important: layerImportant,
      });
    }

    return {
      totalParams,
      importantParams,
      meanFisher: totalParams > 0 ? sumFisher / totalParams : 0,
      maxFisher,
      minNonZeroFisher: minNonZeroFisher === Infinity ? 0 : minNonZeroFisher,
      layerStats,
    };
  }

  /**
   * Reset EWC state (for testing or retraining from scratch)
   */
  reset(): void {
    this.taskCount = 0;
    logger.info('EWC state reset');
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an EWCRegularizer with default configuration
 *
 * @param config - Optional partial configuration
 * @returns EWCRegularizer instance
 */
export function createEWCRegularizer(config?: Partial<EWCConfig>): EWCRegularizer {
  return new EWCRegularizer(config);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Compute importance scores for each parameter
 *
 * Normalizes Fisher information to [0, 1] range for visualization/analysis.
 *
 * @param fisher - Fisher diagonal
 * @returns Normalized importance scores
 */
export function computeImportanceScores(
  fisher: Map<string, Float32Array>
): Map<string, Float32Array> {
  // Find global max for normalization
  let maxFisher = 0;
  for (const fisherLayer of fisher.values()) {
    for (let i = 0; i < fisherLayer.length; i++) {
      if (fisherLayer[i] > maxFisher) {
        maxFisher = fisherLayer[i];
      }
    }
  }

  if (maxFisher === 0) {
    // Return all zeros if no Fisher information
    const scores = new Map<string, Float32Array>();
    for (const [layerId, fisherLayer] of fisher) {
      scores.set(layerId, new Float32Array(fisherLayer.length));
    }
    return scores;
  }

  // Normalize to [0, 1]
  const scores = new Map<string, Float32Array>();
  for (const [layerId, fisherLayer] of fisher) {
    const normalized = new Float32Array(fisherLayer.length);
    for (let i = 0; i < fisherLayer.length; i++) {
      normalized[i] = fisherLayer[i] / maxFisher;
    }
    scores.set(layerId, normalized);
  }

  return scores;
}

/**
 * Identify the most important parameters for visualization
 *
 * @param fisher - Fisher diagonal
 * @param topK - Number of top parameters to return
 * @returns Array of { layerId, index, fisher } for top-K parameters
 */
export function getTopImportantParams(
  fisher: Map<string, Float32Array>,
  topK: number = 100
): Array<{ layerId: string; index: number; fisher: number }> {
  const allParams: Array<{ layerId: string; index: number; fisher: number }> = [];

  for (const [layerId, fisherLayer] of fisher) {
    for (let i = 0; i < fisherLayer.length; i++) {
      allParams.push({ layerId, index: i, fisher: fisherLayer[i] });
    }
  }

  // Sort by Fisher (descending)
  allParams.sort((a, b) => b.fisher - a.fisher);

  return allParams.slice(0, topK);
}

/**
 * Compute overlap between two Fisher distributions
 *
 * Useful for analyzing how similar the importance patterns are between tasks.
 *
 * @param fisher1 - First Fisher diagonal
 * @param fisher2 - Second Fisher diagonal
 * @param threshold - Threshold for considering a parameter important
 * @returns Overlap statistics
 */
export function computeFisherOverlap(
  fisher1: Map<string, Float32Array>,
  fisher2: Map<string, Float32Array>,
  threshold: number = 1e-6
): {
  overlapRatio: number;
  fisher1Only: number;
  fisher2Only: number;
  both: number;
} {
  let fisher1Only = 0;
  let fisher2Only = 0;
  let both = 0;

  // Collect all layer IDs
  const allLayerIds = new Set<string>();
  for (const layerId of fisher1.keys()) allLayerIds.add(layerId);
  for (const layerId of fisher2.keys()) allLayerIds.add(layerId);

  for (const layerId of allLayerIds) {
    const f1 = fisher1.get(layerId);
    const f2 = fisher2.get(layerId);

    if (!f1 && !f2) continue;

    const len = Math.max(f1?.length ?? 0, f2?.length ?? 0);

    for (let i = 0; i < len; i++) {
      const v1 = f1 && i < f1.length ? f1[i] : 0;
      const v2 = f2 && i < f2.length ? f2[i] : 0;

      const important1 = v1 > threshold;
      const important2 = v2 > threshold;

      if (important1 && important2) {
        both++;
      } else if (important1) {
        fisher1Only++;
      } else if (important2) {
        fisher2Only++;
      }
    }
  }

  const total = fisher1Only + fisher2Only + both;
  const overlapRatio = total > 0 ? both / total : 0;

  return {
    overlapRatio,
    fisher1Only,
    fisher2Only,
    both,
  };
}
