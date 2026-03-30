/**
 * Contrastive Quality Loss for Trajectory Learning
 *
 * Implements margin ranking loss to guide the embedding space based on
 * user quality scores. High-quality trajectories are pulled closer to queries,
 * low-quality trajectories are pushed further away.
 *
 * Loss Function:
 * L = max(0, d(Q, T_pos) - d(Q, T_neg) + margin)
 *
 * Where:
 * - Q = Query embedding
 * - T_pos = High-quality trajectory (quality >= 0.7 per RULE-035)
 * - T_neg = Low-quality trajectory (quality < 0.5 per RULE-035)
 * - d = Euclidean distance
 * - margin = Configurable (default 0.5)
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-GNN-007
 *
 * CONSTITUTION COMPLIANCE:
 * - RULE-033: Quality assessed on result, not prompt
 * - RULE-035: Thresholds 0.7 (positive), 0.5 (negative)
 * - RULE-079: No magic numbers (uses CONSTITUTION constants)
 *
 * @module src/god-agent/core/reasoning/contrastive-loss
 */

import { VECTOR_DIM } from '../validation/constants.js';
import { clipGradient, isGradientValid } from './gnn-backprop.js';
import type { TrajectoryRecord, ILearningFeedback } from './reasoning-types.js';

// =============================================================================
// Constants per CONSTITUTION RULE-035
// =============================================================================

/**
 * Quality threshold for positive samples (high quality)
 * Per CONSTITUTION RULE-035: pattern threshold = 0.7
 */
export const POSITIVE_QUALITY_THRESHOLD = 0.7;

/**
 * Quality threshold for negative samples (low quality)
 * Per CONSTITUTION RULE-035: feedback threshold = 0.5
 */
export const NEGATIVE_QUALITY_THRESHOLD = 0.5;

/**
 * Default margin for margin ranking loss
 * @rationale Empirically tuned for embedding space separation
 */
export const DEFAULT_MARGIN = 0.5;

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Configuration for ContrastiveLoss
 * Implements: TASK-GNN-007 specification
 */
export interface ContrastiveLossConfig {
  /** Margin for ranking loss (default: 0.5) */
  margin: number;

  /** Quality threshold for positive samples (default: 0.7 per RULE-035) */
  positiveThreshold: number;

  /** Quality threshold for negative samples (default: 0.5 per RULE-035) */
  negativeThreshold: number;

  /** Maximum gradient norm for clipping (default: 1.0) */
  maxGradientNorm: number;

  /** Epsilon for numerical stability (default: 1e-8) */
  epsilon: number;
}

/**
 * A triplet of query, positive, and negative embeddings
 * Used for contrastive learning
 */
export interface TrajectoryPair {
  /** Query embedding (1536D) */
  query: Float32Array;

  /** High-quality trajectory embedding (quality >= 0.7) */
  positive: Float32Array;

  /** Low-quality trajectory embedding (quality < 0.5) */
  negative: Float32Array;

  /** Quality score of positive trajectory [0, 1] */
  positiveQuality: number;

  /** Quality score of negative trajectory [0, 1] */
  negativeQuality: number;
}

/**
 * Gradient information for a single triplet
 */
export interface TripletGradient {
  /** Gradient with respect to query embedding */
  dQuery: Float32Array;

  /** Gradient with respect to positive embedding */
  dPositive: Float32Array;

  /** Gradient with respect to negative embedding */
  dNegative: Float32Array;

  /** Loss value for this triplet */
  loss: number;

  /** Whether the triplet contributed to the loss (loss > 0) */
  active: boolean;
}

/**
 * Batch of gradients from multiple triplets
 */
export interface GradientBatch {
  /** Accumulated gradient for query embeddings */
  dQuery: Float32Array;

  /** Accumulated gradient for positive embeddings */
  dPositive: Float32Array;

  /** Accumulated gradient for negative embeddings */
  dNegative: Float32Array;

  /** Total loss over the batch */
  totalLoss: number;

  /** Number of active triplets (loss > 0) */
  activeCount: number;

  /** Number of triplets in the batch */
  batchSize: number;

  /** Individual triplet gradients (for detailed analysis) */
  tripletGradients: TripletGradient[];
}

/**
 * Interface for trajectory with quality feedback
 * Adapts TrajectoryRecord for contrastive learning
 */
export interface ITrajectoryWithFeedback {
  /** Unique trajectory ID */
  id: string;

  /** Trajectory embedding (base or enhanced) */
  embedding: Float32Array;

  /** Enhanced embedding if available */
  enhancedEmbedding?: Float32Array;

  /** Quality score from feedback [0, 1] */
  quality: number;

  /** Original feedback data */
  feedback?: ILearningFeedback;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: ContrastiveLossConfig = {
  margin: DEFAULT_MARGIN,
  positiveThreshold: POSITIVE_QUALITY_THRESHOLD,
  negativeThreshold: NEGATIVE_QUALITY_THRESHOLD,
  maxGradientNorm: 1.0,
  epsilon: 1e-8,
};

// =============================================================================
// ContrastiveLoss Class
// =============================================================================

/**
 * ContrastiveLoss - Margin Ranking Loss for Quality-Guided Embeddings
 *
 * This class implements contrastive learning to shape the embedding space
 * based on user quality feedback. The goal is to:
 * 1. Pull high-quality trajectories closer to similar queries
 * 2. Push low-quality trajectories further from similar queries
 *
 * The loss function is:
 * L = max(0, d(Q, T_pos) - d(Q, T_neg) + margin)
 *
 * Where d is Euclidean distance. When the loss is positive (i.e., the
 * negative sample is too close or the positive sample is too far), gradients
 * are computed to correct this.
 *
 * Implements: TASK-GNN-007
 * Constitution: RULE-033, RULE-035
 */
export class ContrastiveLoss {
  private readonly config: ContrastiveLossConfig;

  /**
   * Create a new ContrastiveLoss instance
   *
   * @param config - Partial configuration (defaults applied)
   */
  constructor(config: Partial<ContrastiveLossConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Validate thresholds
    if (this.config.positiveThreshold <= this.config.negativeThreshold) {
      throw new Error(
        `Invalid thresholds: positiveThreshold (${this.config.positiveThreshold}) ` +
        `must be greater than negativeThreshold (${this.config.negativeThreshold})`
      );
    }

    if (this.config.margin <= 0) {
      throw new Error(`Margin must be positive, got: ${this.config.margin}`);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<ContrastiveLossConfig> {
    return { ...this.config };
  }

  /**
   * Compute the total contrastive loss over a batch of triplets
   *
   * Loss formula: L = (1/N) * sum_i max(0, d(Q_i, P_i) - d(Q_i, N_i) + margin)
   *
   * @param pairs - Array of trajectory triplets
   * @returns Average loss over the batch
   */
  compute(pairs: TrajectoryPair[]): number {
    if (pairs.length === 0) {
      return 0;
    }

    let totalLoss = 0;

    for (const pair of pairs) {
      // Validate pair embeddings
      if (!this.validatePair(pair)) {
        continue;
      }

      // Compute Euclidean distances
      const distPositive = this.euclideanDistance(pair.query, pair.positive);
      const distNegative = this.euclideanDistance(pair.query, pair.negative);

      // Margin ranking loss: max(0, d_pos - d_neg + margin)
      const loss = Math.max(0, distPositive - distNegative + this.config.margin);
      totalLoss += loss;
    }

    // Return average loss
    return totalLoss / pairs.length;
  }

  /**
   * Compute gradients for all triplets in the batch (backward pass)
   *
   * The gradient flow for margin ranking loss is:
   * - If loss > 0 (triplet is active):
   *   - dL/d(query) = (query - positive)/d_pos - (query - negative)/d_neg
   *   - dL/d(positive) = -(query - positive)/d_pos
   *   - dL/d(negative) = (query - negative)/d_neg
   * - If loss <= 0 (margin satisfied):
   *   - All gradients are zero
   *
   * Mathematical derivation:
   * L = max(0, ||Q - P|| - ||Q - N|| + m)
   *
   * For d = ||x - y|| = sqrt(sum((x_i - y_i)^2)):
   * dd/dx_i = (x_i - y_i) / ||x - y||
   *
   * @param pairs - Array of trajectory triplets
   * @returns GradientBatch with accumulated gradients and per-triplet details
   */
  backward(pairs: TrajectoryPair[]): GradientBatch {
    const dim = pairs.length > 0 ? pairs[0].query.length : VECTOR_DIM;

    // Initialize accumulated gradients
    const dQuery = new Float32Array(dim);
    const dPositive = new Float32Array(dim);
    const dNegative = new Float32Array(dim);

    const tripletGradients: TripletGradient[] = [];
    let totalLoss = 0;
    let activeCount = 0;

    for (const pair of pairs) {
      // Validate pair
      if (!this.validatePair(pair)) {
        // Add zero gradient for invalid pair
        tripletGradients.push({
          dQuery: new Float32Array(dim),
          dPositive: new Float32Array(dim),
          dNegative: new Float32Array(dim),
          loss: 0,
          active: false,
        });
        continue;
      }

      const tripletGrad = this.computeTripletGradient(pair);
      tripletGradients.push(tripletGrad);

      totalLoss += tripletGrad.loss;

      if (tripletGrad.active) {
        activeCount++;

        // Accumulate gradients
        for (let i = 0; i < dim && i < tripletGrad.dQuery.length; i++) {
          dQuery[i] += tripletGrad.dQuery[i];
          dPositive[i] += tripletGrad.dPositive[i];
          dNegative[i] += tripletGrad.dNegative[i];
        }
      }
    }

    // Average gradients over batch
    const batchSize = pairs.length;
    if (batchSize > 0) {
      for (let i = 0; i < dim; i++) {
        dQuery[i] /= batchSize;
        dPositive[i] /= batchSize;
        dNegative[i] /= batchSize;
      }
    }

    // Clip gradients for stability
    const clippedDQuery = clipGradient(dQuery, this.config.maxGradientNorm);
    const clippedDPositive = clipGradient(dPositive, this.config.maxGradientNorm);
    const clippedDNegative = clipGradient(dNegative, this.config.maxGradientNorm);

    return {
      dQuery: clippedDQuery,
      dPositive: clippedDPositive,
      dNegative: clippedDNegative,
      totalLoss,
      activeCount,
      batchSize,
      tripletGradients,
    };
  }

  /**
   * Create trajectory pairs from a collection of trajectories and a query
   *
   * This is a static factory method that:
   * 1. Separates trajectories into positive (quality >= 0.7) and negative (quality < 0.5)
   * 2. Creates all valid pairs of (query, positive, negative)
   *
   * Per CONSTITUTION RULE-035:
   * - Positive threshold: 0.7
   * - Negative threshold: 0.5
   *
   * @param trajectories - Array of trajectories with quality feedback
   * @param queryEmbedding - Query embedding to compare against
   * @param config - Optional configuration for thresholds
   * @returns Array of trajectory pairs for contrastive learning
   */
  static createPairs(
    trajectories: ITrajectoryWithFeedback[],
    queryEmbedding: Float32Array,
    config: Partial<ContrastiveLossConfig> = {}
  ): TrajectoryPair[] {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    // Separate trajectories by quality
    const positives: ITrajectoryWithFeedback[] = [];
    const negatives: ITrajectoryWithFeedback[] = [];

    for (const traj of trajectories) {
      if (traj.quality >= cfg.positiveThreshold) {
        positives.push(traj);
      } else if (traj.quality < cfg.negativeThreshold) {
        negatives.push(traj);
      }
      // Trajectories with quality in [0.5, 0.7) are neither positive nor negative
    }

    // Create all pairs
    const pairs: TrajectoryPair[] = [];

    for (const positive of positives) {
      for (const negative of negatives) {
        const posEmbedding = positive.enhancedEmbedding ?? positive.embedding;
        const negEmbedding = negative.enhancedEmbedding ?? negative.embedding;

        // Skip if embeddings have mismatched dimensions
        if (posEmbedding.length !== queryEmbedding.length ||
            negEmbedding.length !== queryEmbedding.length) {
          continue;
        }

        pairs.push({
          query: queryEmbedding,
          positive: posEmbedding,
          negative: negEmbedding,
          positiveQuality: positive.quality,
          negativeQuality: negative.quality,
        });
      }
    }

    return pairs;
  }

  /**
   * Create pairs from TrajectoryRecord objects (adapts the interface)
   *
   * @param records - Array of trajectory records with feedback
   * @param queryEmbedding - Query embedding
   * @param config - Optional configuration
   * @returns Array of trajectory pairs
   */
  static createPairsFromRecords(
    records: TrajectoryRecord[],
    queryEmbedding: Float32Array,
    config: Partial<ContrastiveLossConfig> = {}
  ): TrajectoryPair[] {
    // Convert TrajectoryRecord to ITrajectoryWithFeedback
    const trajectories: ITrajectoryWithFeedback[] = records
      .filter(r => r.feedback?.quality !== undefined)
      .map(r => ({
        id: r.id,
        embedding: r.embedding,
        enhancedEmbedding: r.enhancedEmbedding,
        quality: r.feedback!.quality!,
        feedback: r.feedback,
      }));

    return ContrastiveLoss.createPairs(trajectories, queryEmbedding, config);
  }

  /**
   * Compute gradient for a single triplet
   *
   * @param pair - The trajectory triplet
   * @returns TripletGradient with gradients and loss
   */
  private computeTripletGradient(pair: TrajectoryPair): TripletGradient {
    const dim = pair.query.length;
    const epsilon = this.config.epsilon;

    // Compute distances
    const distPositive = this.euclideanDistance(pair.query, pair.positive);
    const distNegative = this.euclideanDistance(pair.query, pair.negative);

    // Compute loss
    const loss = Math.max(0, distPositive - distNegative + this.config.margin);

    // If loss is zero, triplet doesn't contribute to gradient
    if (loss <= 0) {
      return {
        dQuery: new Float32Array(dim),
        dPositive: new Float32Array(dim),
        dNegative: new Float32Array(dim),
        loss: 0,
        active: false,
      };
    }

    // Compute gradients
    // d(||x - y||)/dx = (x - y) / ||x - y||

    const dQuery = new Float32Array(dim);
    const dPositive = new Float32Array(dim);
    const dNegative = new Float32Array(dim);

    // Safe division factors
    const invDistPos = distPositive > epsilon ? 1 / distPositive : 0;
    const invDistNeg = distNegative > epsilon ? 1 / distNegative : 0;

    for (let i = 0; i < dim; i++) {
      const diffPos = pair.query[i] - pair.positive[i];
      const diffNeg = pair.query[i] - pair.negative[i];

      // dL/d(query) = d(d_pos)/d(query) - d(d_neg)/d(query)
      //             = (query - positive)/d_pos - (query - negative)/d_neg
      dQuery[i] = diffPos * invDistPos - diffNeg * invDistNeg;

      // dL/d(positive) = d(d_pos)/d(positive)
      //                = -(query - positive)/d_pos
      dPositive[i] = -diffPos * invDistPos;

      // dL/d(negative) = -d(d_neg)/d(negative)
      //                = (query - negative)/d_neg
      dNegative[i] = diffNeg * invDistNeg;
    }

    // Validate gradients
    const validQuery = isGradientValid(dQuery);
    const validPositive = isGradientValid(dPositive);
    const validNegative = isGradientValid(dNegative);

    if (!validQuery || !validPositive || !validNegative) {
      // Return zero gradients if any are invalid
      return {
        dQuery: new Float32Array(dim),
        dPositive: new Float32Array(dim),
        dNegative: new Float32Array(dim),
        loss,
        active: false,
      };
    }

    return {
      dQuery,
      dPositive,
      dNegative,
      loss,
      active: true,
    };
  }

  /**
   * Compute Euclidean distance between two embeddings
   *
   * @param a - First embedding
   * @param b - Second embedding
   * @returns Euclidean distance
   */
  private euclideanDistance(a: Float32Array, b: Float32Array): number {
    const minLen = Math.min(a.length, b.length);
    let sum = 0;

    for (let i = 0; i < minLen; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }

    return Math.sqrt(sum);
  }

  /**
   * Validate a trajectory pair
   *
   * @param pair - The pair to validate
   * @returns true if valid
   */
  private validatePair(pair: TrajectoryPair): boolean {
    // Check embedding lengths match
    if (pair.query.length !== pair.positive.length ||
        pair.query.length !== pair.negative.length) {
      return false;
    }

    // Check quality scores are valid per CONSTITUTION RULE-035
    if (pair.positiveQuality < this.config.positiveThreshold) {
      return false;
    }

    if (pair.negativeQuality >= this.config.negativeThreshold) {
      return false;
    }

    // Check embeddings are not empty
    if (pair.query.length === 0) {
      return false;
    }

    return true;
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Compute hard negative mining scores
 *
 * Hard negatives are low-quality trajectories that are close to the query.
 * These provide the most informative gradients for learning.
 *
 * @param query - Query embedding
 * @param negatives - Array of negative trajectory embeddings with quality
 * @param topK - Number of hard negatives to return
 * @returns Array of (index, distance) pairs sorted by distance (ascending)
 */
export function mineHardNegatives(
  query: Float32Array,
  negatives: Array<{ embedding: Float32Array; quality: number }>,
  topK: number = 5
): Array<{ index: number; distance: number; quality: number }> {
  // Compute distances to all negatives
  const scored = negatives.map((neg, index) => {
    let sum = 0;
    const minLen = Math.min(query.length, neg.embedding.length);
    for (let i = 0; i < minLen; i++) {
      const diff = query[i] - neg.embedding[i];
      sum += diff * diff;
    }
    return {
      index,
      distance: Math.sqrt(sum),
      quality: neg.quality,
    };
  });

  // Sort by distance (ascending) - closest negatives are hardest
  scored.sort((a, b) => a.distance - b.distance);

  return scored.slice(0, topK);
}

/**
 * Compute hard positive mining scores
 *
 * Hard positives are high-quality trajectories that are far from the query.
 * These help expand the positive region of the embedding space.
 *
 * @param query - Query embedding
 * @param positives - Array of positive trajectory embeddings with quality
 * @param topK - Number of hard positives to return
 * @returns Array of (index, distance) pairs sorted by distance (descending)
 */
export function mineHardPositives(
  query: Float32Array,
  positives: Array<{ embedding: Float32Array; quality: number }>,
  topK: number = 5
): Array<{ index: number; distance: number; quality: number }> {
  // Compute distances to all positives
  const scored = positives.map((pos, index) => {
    let sum = 0;
    const minLen = Math.min(query.length, pos.embedding.length);
    for (let i = 0; i < minLen; i++) {
      const diff = query[i] - pos.embedding[i];
      sum += diff * diff;
    }
    return {
      index,
      distance: Math.sqrt(sum),
      quality: pos.quality,
    };
  });

  // Sort by distance (descending) - farthest positives are hardest
  scored.sort((a, b) => b.distance - a.distance);

  return scored.slice(0, topK);
}

/**
 * Create hard triplets using semi-hard mining strategy
 *
 * Semi-hard triplets satisfy: d(q, p) < d(q, n) < d(q, p) + margin
 * These provide stable gradients without being too easy or too hard.
 *
 * @param query - Query embedding
 * @param positives - Array of positive trajectories
 * @param negatives - Array of negative trajectories
 * @param margin - Margin for semi-hard selection
 * @returns Array of trajectory pairs that satisfy semi-hard criterion
 */
export function createSemiHardTriplets(
  query: Float32Array,
  positives: ITrajectoryWithFeedback[],
  negatives: ITrajectoryWithFeedback[],
  margin: number = DEFAULT_MARGIN
): TrajectoryPair[] {
  const pairs: TrajectoryPair[] = [];

  for (const pos of positives) {
    const posEmb = pos.enhancedEmbedding ?? pos.embedding;
    const distPos = euclideanDistance(query, posEmb);

    for (const neg of negatives) {
      const negEmb = neg.enhancedEmbedding ?? neg.embedding;
      const distNeg = euclideanDistance(query, negEmb);

      // Semi-hard criterion: d(q, p) < d(q, n) < d(q, p) + margin
      if (distPos < distNeg && distNeg < distPos + margin) {
        pairs.push({
          query,
          positive: posEmb,
          negative: negEmb,
          positiveQuality: pos.quality,
          negativeQuality: neg.quality,
        });
      }
    }
  }

  return pairs;
}

/**
 * Standalone Euclidean distance function
 */
function euclideanDistance(a: Float32Array, b: Float32Array): number {
  const minLen = Math.min(a.length, b.length);
  let sum = 0;

  for (let i = 0; i < minLen; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }

  return Math.sqrt(sum);
}
