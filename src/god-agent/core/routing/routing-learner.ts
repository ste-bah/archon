/**
 * DAI-003: Intelligent Task Routing Learner
 *
 * TASK-009: Routing Learner
 * Constitution: RULE-DAI-003-002 (EWC++ regularization), RULE-DAI-003-007 (failure attribution)
 *
 * Learns from routing outcomes with EWC++ regularization to prevent catastrophic forgetting.
 * Tracks accuracy across a rolling 100-task window and automatically rolls back if degradation
 * exceeds 2%.
 *
 * Key features:
 * - EWC++ regularization with lambda = 0.1
 * - Maximum 5% weight change per update
 * - Failure attribution via FailureClassifier
 * - Skip routing penalty for AGENT_FAILURE and TASK_IMPOSSIBLE
 * - Rolling 100-task accuracy window
 * - Auto-rollback on degradation > 2%
 * - Checkpoint/restore for weight rollback
 * - ReasoningBank integration for continuous learning
 *
 * @module src/god-agent/core/routing/routing-learner
 */

import type {
  IRoutingFeedback,
  IRoutingLearner,
  IRoutingConfig,
} from './routing-types.js';
import { FailureClassifier } from './failure-classifier.js';
import { RoutingLearningError } from './routing-errors.js';
import type { ReasoningBank } from '../reasoning/reasoning-bank.js';
import type { ILearningFeedback } from '../reasoning/reasoning-types.js';

/**
 * Configuration for RoutingLearner
 */
export interface IRoutingLearnerConfig {
  /** Failure classifier (creates one if not provided) */
  readonly failureClassifier?: FailureClassifier;

  /** Routing configuration (uses defaults if not provided) */
  readonly routingConfig?: Partial<IRoutingConfig>;

  /** ReasoningBank for feedback submission (optional) */
  readonly reasoningBank?: ReasoningBank;

  /** Enable verbose logging (default: false) */
  readonly verbose?: boolean;
}

/**
 * Weight checkpoint for rollback
 */
interface WeightCheckpoint {
  readonly weights: Map<string, number>;
  readonly importance: Map<string, number>;
  readonly accuracy: number;
  readonly timestamp: number;
}

/**
 * Default routing configuration values
 */
const DEFAULT_ROUTING_CONFIG: IRoutingConfig = {
  ewcLambda: 0.1,
  maxWeightChange: 0.05, // 5%
  accuracyWindowSize: 100,
  accuracyDegradationThreshold: 0.02, // 2%
  coldStart: {
    keywordOnlyThreshold: 25,
    learnedThreshold: 100,
    maxColdStartConfidence: 0.6,
    keywordOnlyWeight: 1.0,
    blendedKeywordWeight: 0.7,
    learnedKeywordWeight: 0.2,
  },
  autoExecuteThreshold: 0.9,
  showDecisionThreshold: 0.7,
  confirmationThreshold: 0.5,
  maxAlternatives: 3,
  maxPipelineStages: 10,
  estimatedTimePerStageMs: 30000,
  routingLatencyTargetMs: 300,
  analysisLatencyTargetMs: 150,
  pipelineLatencyTargetMs: 600,
  verbose: false,
};

/**
 * Routing learner with EWC++ regularization
 *
 * Learns from routing outcomes while preventing catastrophic forgetting.
 * Uses Elastic Weight Consolidation Plus Plus (EWC++) to constrain weight
 * updates based on their importance (Fisher information).
 *
 * Per RULE-DAI-003-002: EWC++ with lambda=0.1, max 5% weight change
 * Per RULE-DAI-003-007: Failure attribution before learning
 */
export class RoutingLearner implements IRoutingLearner {
  private readonly failureClassifier: FailureClassifier;
  private readonly config: IRoutingConfig;
  private readonly reasoningBank?: ReasoningBank;
  private readonly verbose: boolean;

  // Weight storage
  private agentWeights: Map<string, number>;
  private agentImportance: Map<string, number>;

  // Accuracy tracking (rolling window of 100)
  private accuracyHistory: number[];
  private totalFeedback: number;
  private successfulRoutes: number;

  // Checkpointing for rollback
  private checkpoint: WeightCheckpoint | null;

  /**
   * Create a routing learner
   *
   * @param config - Learner configuration
   */
  constructor(config: IRoutingLearnerConfig = {}) {
    this.failureClassifier = config.failureClassifier ?? new FailureClassifier();
    this.config = {
      ...DEFAULT_ROUTING_CONFIG,
      ...config.routingConfig,
    };
    this.reasoningBank = config.reasoningBank;
    this.verbose = config.verbose ?? false;

    // Initialize weight maps
    this.agentWeights = new Map();
    this.agentImportance = new Map();

    // Initialize accuracy tracking
    this.accuracyHistory = [];
    this.totalFeedback = 0;
    this.successfulRoutes = 0;

    // No checkpoint initially
    this.checkpoint = null;

    if (this.verbose) {
      console.log('[RoutingLearner] Initialized with EWC++ regularization');
      console.log(`[RoutingLearner] Config: lambda=${this.config.ewcLambda}, maxChange=${this.config.maxWeightChange}`);
    }
  }

  /**
   * Process feedback and update weights
   *
   * Per RULE-DAI-003-002: EWC++ regularization with max 5% change
   * Per RULE-DAI-003-007: Failure attribution before learning
   *
   * @param feedback - Routing feedback to process
   */
  async processFeedback(feedback: IRoutingFeedback): Promise<void> {
    try {
      // Create checkpoint BEFORE any updates
      this.createCheckpoint();

      // Classify failure (RULE-DAI-003-007: Failure attribution BEFORE learning)
      const classification = this.failureClassifier.classify(feedback);

      if (this.verbose) {
        console.log(`[RoutingLearner] Processing feedback for ${feedback.selectedAgent}`);
        console.log(`[RoutingLearner] Classification: ${classification.failureType} (confidence: ${classification.classificationConfidence})`);
        console.log(`[RoutingLearner] Penalize routing: ${classification.penalizeRouting}, agent: ${classification.penalizeAgent}`);
      }

      // Decide whether to update routing weights
      const shouldUpdateRouting = feedback.success || classification.penalizeRouting;

      if (shouldUpdateRouting) {
        // Calculate reward
        const reward = this.calculateReward(feedback);

        if (this.verbose) {
          console.log(`[RoutingLearner] Reward: ${reward.toFixed(3)}`);
        }

        // Update weights with EWC++ regularization
        this.updateWeights(feedback.selectedAgent, reward);

        // Update importance (Fisher information approximation)
        this.updateImportance(feedback.selectedAgent, reward);

        // Update accuracy history
        this.updateAccuracyHistory(feedback);

        // Detect accuracy degradation
        if (this.detectAccuracyDegradation()) {
          if (this.verbose) {
            console.log('[RoutingLearner] Accuracy degradation detected! Rolling back weights...');
          }
          this.rollbackWeights();
        }
      } else {
        // Still update accuracy history but don't change weights
        this.updateAccuracyHistory(feedback);

        if (this.verbose) {
          console.log('[RoutingLearner] Skipping routing weight update (AGENT_FAILURE or TASK_IMPOSSIBLE)');
        }
      }

      // Log agent reliability regardless of weight update
      this.logAgentReliability(feedback.selectedAgent, feedback.success);

      // Submit feedback to ReasoningBank for continuous learning
      if (this.reasoningBank) {
        await this.submitToReasoningBank(feedback, classification);
      }

      // Increment total feedback counter
      this.totalFeedback++;

    } catch (error) {
      throw new RoutingLearningError(
        `Failed to process feedback: ${error instanceof Error ? error.message : String(error)}`,
        'feedback-processing',
        this.totalFeedback,
        feedback.routingId,
        { agentKey: feedback.selectedAgent },
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get current accuracy across rolling window
   *
   * @returns Accuracy (0-1) or 0 if no feedback yet
   */
  getCurrentAccuracy(): number {
    if (this.accuracyHistory.length === 0) {
      return 0;
    }

    const successCount = this.accuracyHistory.reduce((sum, val) => sum + val, 0);
    return successCount / this.accuracyHistory.length;
  }

  /**
   * Get rolling accuracy history
   *
   * @returns Readonly array of accuracy values (1 = success, 0 = failure)
   */
  getAccuracyHistory(): readonly number[] {
    return [...this.accuracyHistory];
  }

  // ==================== Private Helper Methods ====================

  /**
   * Calculate reward from feedback
   *
   * Base reward: +1 for success, -1 for failure
   * Adjusted by user rating if available
   * Penalized if user overrode agent selection
   *
   * @param feedback - Routing feedback
   * @returns Reward value (typically -1 to +1)
   */
  private calculateReward(feedback: IRoutingFeedback): number {
    // Base reward
    let reward = feedback.success ? 1.0 : -1.0;

    // Adjust for user rating if available
    if (feedback.userRating !== undefined) {
      // Scale by user rating (1-5 scale normalized to 0-1)
      const ratingFactor = feedback.userRating / 5.0;
      reward *= ratingFactor;
    }

    // Penalize if user overrode agent selection and then succeeded
    // This indicates routing selected the wrong agent
    if (feedback.userOverrideAgent && feedback.success) {
      reward = -0.5; // Negative reward for wrong initial selection
    }

    return reward;
  }

  /**
   * Update weights with EWC++ regularization
   *
   * EWC++ prevents catastrophic forgetting by:
   * 1. Computing raw update from reward
   * 2. Applying penalty based on importance (Fisher information)
   * 3. Clamping to max 5% change per update
   *
   * Per RULE-DAI-003-002: lambda=0.1, max 5% change
   *
   * @param agentKey - Agent key to update
   * @param reward - Calculated reward
   */
  private updateWeights(agentKey: string, reward: number): void {
    const currentWeight = this.getWeight(agentKey);
    const importance = this.getImportance(agentKey);
    const learningRate = 0.1;

    // Get checkpoint weight for EWC++ calculation
    const checkpointWeight = this.checkpoint?.weights.get(agentKey) ?? currentWeight;

    // Raw update
    const rawDelta = learningRate * reward;

    // EWC++ penalty (prevents catastrophic forgetting)
    // Higher importance = more resistance to change
    const ewcPenalty = this.config.ewcLambda * importance * (currentWeight - checkpointWeight);
    const effectiveDelta = rawDelta - ewcPenalty;

    // Clamp to max 5% change (RULE-DAI-003-002)
    const clampedDelta = Math.max(
      -this.config.maxWeightChange,
      Math.min(this.config.maxWeightChange, effectiveDelta)
    );

    // Update weight (keep in [0, 1] range)
    const newWeight = Math.max(0, Math.min(1, currentWeight + clampedDelta));

    this.setWeight(agentKey, newWeight);

    if (this.verbose) {
      console.log(`[RoutingLearner] Weight update for ${agentKey}: ${currentWeight.toFixed(3)} -> ${newWeight.toFixed(3)} (delta: ${clampedDelta.toFixed(3)})`);
    }
  }

  /**
   * Update importance (Fisher information approximation)
   *
   * Importance increases with each task, representing how critical
   * this weight is to maintaining performance. Higher importance
   * means more resistance to weight changes (via EWC++ penalty).
   *
   * @param agentKey - Agent key to update
   * @param reward - Calculated reward (magnitude indicates importance)
   */
  private updateImportance(agentKey: string, reward: number): void {
    const currentImportance = this.getImportance(agentKey);

    // Fisher information approximation: gradient squared
    // Higher reward magnitude = more important weight
    const gradient = Math.abs(reward);
    const newImportance = currentImportance + gradient * gradient;

    this.agentImportance.set(agentKey, newImportance);

    if (this.verbose) {
      console.log(`[RoutingLearner] Importance update for ${agentKey}: ${currentImportance.toFixed(3)} -> ${newImportance.toFixed(3)}`);
    }
  }

  /**
   * Update accuracy history with new feedback
   *
   * Maintains rolling window of last 100 tasks
   *
   * @param feedback - Routing feedback
   */
  private updateAccuracyHistory(feedback: IRoutingFeedback): void {
    // Add new result (1 for success, 0 for failure)
    this.accuracyHistory.push(feedback.success ? 1 : 0);

    // Keep only last N entries
    if (this.accuracyHistory.length > this.config.accuracyWindowSize) {
      this.accuracyHistory.shift();
    }

    // Track total successes
    if (feedback.success) {
      this.successfulRoutes++;
    }
  }

  /**
   * Detect accuracy degradation compared to checkpoint
   *
   * Per RULE-DAI-003-002: Rollback if degradation > 2%
   *
   * @returns True if accuracy degraded beyond threshold
   */
  private detectAccuracyDegradation(): boolean {
    if (!this.checkpoint) {
      return false; // No checkpoint to compare against
    }

    if (this.accuracyHistory.length < 10) {
      return false; // Need minimum data for reliable comparison
    }

    const currentAccuracy = this.getCurrentAccuracy();
    const checkpointAccuracy = this.checkpoint.accuracy;
    const degradation = checkpointAccuracy - currentAccuracy;

    const hasDegraded = degradation > this.config.accuracyDegradationThreshold;

    if (this.verbose && hasDegraded) {
      console.log(`[RoutingLearner] Degradation detected: ${checkpointAccuracy.toFixed(3)} -> ${currentAccuracy.toFixed(3)} (delta: ${degradation.toFixed(3)})`);
    }

    return hasDegraded;
  }

  /**
   * Rollback weights to checkpoint
   *
   * Restores weights and importance but keeps accuracy history
   * (we need to track the bad outcomes to prevent repeating them)
   */
  private rollbackWeights(): void {
    if (!this.checkpoint) {
      if (this.verbose) {
        console.log('[RoutingLearner] No checkpoint available for rollback');
      }
      return;
    }

    // Restore weights and importance
    this.agentWeights = new Map(this.checkpoint.weights);
    this.agentImportance = new Map(this.checkpoint.importance);

    // Keep accuracy history (don't rollback)
    // We need to know about the bad outcomes

    if (this.verbose) {
      console.log('[RoutingLearner] Rolled back to checkpoint');
    }
  }

  /**
   * Create checkpoint before weight updates
   *
   * Captures current state for potential rollback
   */
  private createCheckpoint(): void {
    this.checkpoint = {
      weights: new Map(this.agentWeights),
      importance: new Map(this.agentImportance),
      accuracy: this.getCurrentAccuracy(),
      timestamp: Date.now(),
    };

    if (this.verbose) {
      console.log(`[RoutingLearner] Checkpoint created (accuracy: ${this.checkpoint.accuracy.toFixed(3)})`);
    }
  }

  /**
   * Get weight for agent (default: 0.5)
   *
   * @param agentKey - Agent key
   * @returns Weight value (0-1)
   */
  private getWeight(agentKey: string): number {
    return this.agentWeights.get(agentKey) ?? 0.5;
  }

  /**
   * Set weight for agent
   *
   * @param agentKey - Agent key
   * @param weight - Weight value (0-1)
   */
  private setWeight(agentKey: string, weight: number): void {
    this.agentWeights.set(agentKey, weight);
  }

  /**
   * Get importance for agent (default: 0.1)
   *
   * @param agentKey - Agent key
   * @returns Importance value (>= 0)
   */
  private getImportance(agentKey: string): number {
    return this.agentImportance.get(agentKey) ?? 0.1;
  }

  /**
   * Log agent reliability (for monitoring)
   *
   * @param agentKey - Agent key
   * @param success - Whether task succeeded
   */
  private logAgentReliability(agentKey: string, success: boolean): void {
    if (this.verbose) {
      const weight = this.getWeight(agentKey);
      const importance = this.getImportance(agentKey);
      console.log(`[RoutingLearner] Agent ${agentKey} reliability: weight=${weight.toFixed(3)}, importance=${importance.toFixed(3)}, success=${success}`);
    }
  }

  /**
   * Submit feedback to ReasoningBank for continuous learning
   *
   * @param feedback - Routing feedback
   * @param classification - Failure classification
   */
  private async submitToReasoningBank(
    feedback: IRoutingFeedback,
    classification: ReturnType<FailureClassifier['classify']>
  ): Promise<void> {
    if (!this.reasoningBank) {
      return;
    }

    try {
      // Calculate quality score (0-1)
      const quality = feedback.success ? 1.0 : 0.0;

      // Map success to verdict
      const verdict = feedback.success ? 'correct' : 'incorrect';

      // Create learning feedback for ReasoningBank
      const learningFeedback: ILearningFeedback = {
        trajectoryId: feedback.routingId,
        verdict,
        quality,
        reasoning: classification.reasoning,
        helpful: feedback.success,
      };

      await this.reasoningBank.provideFeedback(learningFeedback);

      if (this.verbose) {
        console.log(`[RoutingLearner] Submitted feedback to ReasoningBank: ${verdict} (quality: ${quality})`);
      }
    } catch (error) {
      // Don't fail the entire feedback process if ReasoningBank submission fails
      if (this.verbose) {
        console.warn('[RoutingLearner] Failed to submit to ReasoningBank:', error);
      }
    }
  }
}
