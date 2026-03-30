/**
 * DAI-003: Intelligent Task Routing Failure Classifier
 *
 * TASK-006: Failure Classifier
 * Constitution: RULE-DAI-003-007 (failure attribution before learning)
 *
 * Classifies routing failures to determine:
 * - Whether routing was wrong (user override → success)
 * - Whether agent failed (internal error, retry succeeded)
 * - Whether task was impossible (multiple agents fail, user abandons)
 * - Whether task had partial success (some stages completed)
 *
 * Provides:
 * - Failure type classification
 * - Confidence scores
 * - Penalization recommendations (routing vs agent)
 * - Recommended actions (retry, escalate, abandon)
 *
 * @module src/god-agent/core/routing/failure-classifier
 */

import type {
  IRoutingFeedback,
  IFailureClassification,
  FailureType,
} from './routing-types.js';

/**
 * Failure classifier for routing feedback
 *
 * Classifies failures to determine attribution:
 * - ROUTING_FAILURE: User override followed by success (routing was wrong)
 * - AGENT_FAILURE: Agent threw internal error, retry might succeed
 * - TASK_IMPOSSIBLE: Multiple agents fail, user abandons
 * - PARTIAL_SUCCESS: Some stages completed, not all
 *
 * Per RULE-DAI-003-007: Failure attribution before learning
 */
export class FailureClassifier {
  /**
   * Classify a failure from routing feedback
   *
   * @param feedback - Routing feedback to classify
   * @returns Failure classification with type, confidence, and recommendations
   */
  public classify(feedback: IRoutingFeedback): IFailureClassification {
    const evidence: string[] = [];
    let failureType: FailureType;
    let penalizeRouting = false;
    let penalizeAgent = false;
    let recommendedAction: IFailureClassification['recommendedAction'];
    let reasoning: string;

    // Detect failure indicators
    const hasUserOverride = this.detectUserOverride(feedback);
    const hasAgentError = this.detectAgentError(feedback);
    const hasTaskImpossible = this.detectTaskImpossible(feedback);
    const hasPartialSuccess = this.detectPartialSuccess(feedback);

    // Count indicators for confidence calculation
    let indicatorCount = 0;

    // Classification logic based on indicators
    if (hasUserOverride && feedback.success) {
      // ROUTING_FAILURE: User changed agent and succeeded
      failureType = 'ROUTING_FAILURE';
      penalizeRouting = true;
      penalizeAgent = false;
      recommendedAction = 'retry_different_agent';
      reasoning = 'User override followed by success indicates routing selected wrong agent';
      evidence.push(`User override from ${feedback.selectedAgent} to ${feedback.userOverrideAgent}`);
      evidence.push('Task succeeded after override');
      indicatorCount = 2;
    } else if (hasAgentError && !feedback.userAbandoned) {
      // AGENT_FAILURE: Agent error, but user didn't abandon (retry might work)
      failureType = 'AGENT_FAILURE';
      penalizeRouting = false;
      penalizeAgent = true;
      recommendedAction = 'retry_same_agent';
      reasoning = 'Agent threw internal error; routing was correct but agent execution failed';
      evidence.push(`Agent error: ${feedback.errorMessage || 'Unknown error'}`);
      if (feedback.errorCode) {
        evidence.push(`Error code: ${feedback.errorCode}`);
      }
      indicatorCount = feedback.errorCode ? 2 : 1;
    } else if (hasTaskImpossible) {
      // TASK_IMPOSSIBLE: User abandoned or multiple failures
      failureType = 'TASK_IMPOSSIBLE';
      penalizeRouting = false;
      penalizeAgent = false;
      recommendedAction = 'abandon';
      reasoning = 'User abandoned task or multiple agents failed; task may be impossible';
      evidence.push('User abandoned task');
      if (feedback.errorMessage) {
        evidence.push(`Error: ${feedback.errorMessage}`);
      }
      if (feedback.executionTimeMs > 60000) {
        evidence.push(`Long execution time: ${feedback.executionTimeMs}ms`);
        indicatorCount++;
      }
      indicatorCount += evidence.length;
    } else if (hasPartialSuccess) {
      // PARTIAL_SUCCESS: Some stages completed in pipeline
      failureType = 'PARTIAL_SUCCESS';
      const successRate = feedback.completedStages! / feedback.totalStages!;

      // Penalize based on success rate
      if (successRate < 0.3) {
        penalizeRouting = true;
        penalizeAgent = false;
        recommendedAction = 'retry_different_agent';
        reasoning = 'Low stage completion rate suggests routing issue';
      } else if (successRate < 0.7) {
        penalizeRouting = false;
        penalizeAgent = true;
        recommendedAction = 'retry_same_agent';
        reasoning = 'Moderate stage completion rate suggests agent execution issue';
      } else {
        penalizeRouting = false;
        penalizeAgent = false;
        recommendedAction = 'escalate';
        reasoning = 'High stage completion rate; task nearly succeeded, escalate for completion';
      }

      evidence.push(`Completed ${feedback.completedStages}/${feedback.totalStages} stages`);
      evidence.push(`Success rate: ${(successRate * 100).toFixed(1)}%`);
      indicatorCount = 2;
    } else {
      // Default: Generic failure
      failureType = 'AGENT_FAILURE';
      penalizeRouting = false;
      penalizeAgent = true;
      recommendedAction = 'retry_same_agent';
      reasoning = 'Generic failure; assume agent execution issue';
      evidence.push('No specific failure indicators detected');
      indicatorCount = 1;
    }

    // Calculate confidence based on evidence count
    const confidence = this.calculateConfidence(indicatorCount);

    return {
      failureType,
      classificationConfidence: confidence,
      penalizeRouting,
      penalizeAgent,
      recommendedAction,
      reasoning,
      evidence,
    };
  }

  /**
   * Detect user override indicator
   *
   * @param feedback - Routing feedback
   * @returns True if user overrode agent selection
   */
  private detectUserOverride(feedback: IRoutingFeedback): boolean {
    return Boolean(
      feedback.userOverrideAgent &&
      feedback.userOverrideAgent !== feedback.selectedAgent
    );
  }

  /**
   * Detect agent error indicator
   *
   * @param feedback - Routing feedback
   * @returns True if agent threw internal error
   */
  private detectAgentError(feedback: IRoutingFeedback): boolean {
    return Boolean(
      !feedback.success &&
      (feedback.errorMessage || feedback.errorCode)
    );
  }

  /**
   * Detect task impossible indicator
   *
   * @param feedback - Routing feedback
   * @returns True if task appears impossible
   */
  private detectTaskImpossible(feedback: IRoutingFeedback): boolean {
    return feedback.userAbandoned;
  }

  /**
   * Detect partial success indicator
   *
   * @param feedback - Routing feedback
   * @returns True if some stages completed (for pipelines)
   */
  private detectPartialSuccess(feedback: IRoutingFeedback): boolean {
    return Boolean(
      !feedback.success &&
      feedback.completedStages !== undefined &&
      feedback.totalStages !== undefined &&
      feedback.completedStages > 0 &&
      feedback.completedStages < feedback.totalStages
    );
  }

  /**
   * Calculate confidence score based on evidence indicators
   *
   * @param indicators - Number of evidence indicators
   * @returns Confidence score (0-1)
   */
  private calculateConfidence(indicators: number): number {
    // Confidence increases with more indicators
    // 1 indicator = 0.5
    // 2 indicators = 0.75
    // 3+ indicators = 0.9
    if (indicators >= 3) {
      return 0.9;
    } else if (indicators === 2) {
      return 0.75;
    } else if (indicators === 1) {
      return 0.5;
    } else {
      return 0.3;
    }
  }
}
