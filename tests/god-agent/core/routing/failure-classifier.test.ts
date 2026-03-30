/**
 * Tests for FailureClassifier
 *
 * TASK-006: Failure Classifier Tests
 * Constitution: RULE-DAI-003-007
 *
 * Tests all 4 failure types:
 * - ROUTING_FAILURE: User override → success
 * - AGENT_FAILURE: Agent error, retry might work
 * - TASK_IMPOSSIBLE: User abandons
 * - PARTIAL_SUCCESS: Some stages completed
 *
 * NO MOCKS - use real feedback objects
 */

import { describe, it, expect } from 'vitest';
import { FailureClassifier } from '../../../../src/god-agent/core/routing/failure-classifier.js';
import type { IRoutingFeedback } from '../../../../src/god-agent/core/routing/routing-types.js';

describe('FailureClassifier', () => {
  const classifier = new FailureClassifier();

  // ==================== ROUTING_FAILURE Tests ====================

  describe('ROUTING_FAILURE classification', () => {
    it('should classify user override followed by success as ROUTING_FAILURE', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-001',
        task: 'Write a research paper',
        selectedAgent: 'coder',
        success: true,
        executionTimeMs: 5000,
        userOverrideAgent: 'researcher',
        userAbandoned: false,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.failureType).toBe('ROUTING_FAILURE');
      expect(result.penalizeRouting).toBe(true);
      expect(result.penalizeAgent).toBe(false);
      expect(result.recommendedAction).toBe('retry_different_agent');
      expect(result.classificationConfidence).toBeGreaterThanOrEqual(0.7);
      expect(result.evidence).toContain('User override from coder to researcher');
      expect(result.evidence).toContain('Task succeeded after override');
    });

    it('should have high confidence with user override evidence', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-002',
        task: 'Design system architecture',
        selectedAgent: 'tester',
        success: true,
        executionTimeMs: 3000,
        userOverrideAgent: 'system-architect',
        userAbandoned: false,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.classificationConfidence).toBe(0.75);
      expect(result.evidence.length).toBeGreaterThanOrEqual(2);
    });

    it('should include reasoning for routing failure', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-003',
        task: 'Analyze performance',
        selectedAgent: 'coder',
        success: true,
        executionTimeMs: 4000,
        userOverrideAgent: 'perf-analyzer',
        userAbandoned: false,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.reasoning).toContain('User override followed by success');
      expect(result.reasoning).toContain('routing selected wrong agent');
    });
  });

  // ==================== AGENT_FAILURE Tests ====================

  describe('AGENT_FAILURE classification', () => {
    it('should classify agent error as AGENT_FAILURE', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-004',
        task: 'Implement feature',
        selectedAgent: 'coder',
        success: false,
        executionTimeMs: 2000,
        errorMessage: 'Internal server error',
        errorCode: 'AGENT_500',
        userAbandoned: false,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.failureType).toBe('AGENT_FAILURE');
      expect(result.penalizeRouting).toBe(false);
      expect(result.penalizeAgent).toBe(true);
      expect(result.recommendedAction).toBe('retry_same_agent');
      expect(result.evidence).toContain('Agent error: Internal server error');
      expect(result.evidence).toContain('Error code: AGENT_500');
    });

    it('should classify agent error without code as AGENT_FAILURE', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-005',
        task: 'Write tests',
        selectedAgent: 'tester',
        success: false,
        executionTimeMs: 1500,
        errorMessage: 'Timeout while executing',
        userAbandoned: false,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.failureType).toBe('AGENT_FAILURE');
      expect(result.classificationConfidence).toBe(0.5);
      expect(result.evidence).toContain('Agent error: Timeout while executing');
    });

    it('should have higher confidence with error code', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-006',
        task: 'Deploy application',
        selectedAgent: 'backend-dev',
        success: false,
        executionTimeMs: 3000,
        errorMessage: 'Deployment failed',
        errorCode: 'DEPLOY_ERROR',
        userAbandoned: false,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.classificationConfidence).toBe(0.75);
      expect(result.evidence.length).toBe(2);
    });

    it('should include reasoning for agent failure', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-007',
        task: 'Review code',
        selectedAgent: 'reviewer',
        success: false,
        executionTimeMs: 2000,
        errorMessage: 'Parser error',
        userAbandoned: false,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.reasoning).toContain('Agent threw internal error');
      expect(result.reasoning).toContain('routing was correct but agent execution failed');
    });
  });

  // ==================== TASK_IMPOSSIBLE Tests ====================

  describe('TASK_IMPOSSIBLE classification', () => {
    it('should classify user abandoned task as TASK_IMPOSSIBLE', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-008',
        task: 'Impossible task',
        selectedAgent: 'coder',
        success: false,
        executionTimeMs: 10000,
        userAbandoned: true,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.failureType).toBe('TASK_IMPOSSIBLE');
      expect(result.penalizeRouting).toBe(false);
      expect(result.penalizeAgent).toBe(false);
      expect(result.recommendedAction).toBe('abandon');
      expect(result.evidence).toContain('User abandoned task');
    });

    it('should include error message in evidence if present', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-009',
        task: 'Cannot complete this',
        selectedAgent: 'researcher',
        success: false,
        executionTimeMs: 5000,
        errorMessage: 'Task requirements are contradictory',
        userAbandoned: true,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.evidence).toContain('User abandoned task');
      expect(result.evidence).toContain('Error: Task requirements are contradictory');
    });

    it('should include long execution time in evidence', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-010',
        task: 'Complex impossible task',
        selectedAgent: 'coder',
        success: false,
        executionTimeMs: 75000,
        userAbandoned: true,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.evidence).toContain('Long execution time: 75000ms');
      expect(result.classificationConfidence).toBeGreaterThanOrEqual(0.75);
    });

    it('should include reasoning for task impossible', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-011',
        task: 'Unfeasible requirement',
        selectedAgent: 'system-architect',
        success: false,
        executionTimeMs: 8000,
        userAbandoned: true,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.reasoning).toContain('User abandoned task');
      expect(result.reasoning).toContain('task may be impossible');
    });
  });

  // ==================== PARTIAL_SUCCESS Tests ====================

  describe('PARTIAL_SUCCESS classification', () => {
    it('should classify low completion rate as routing issue', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-012',
        task: 'Multi-stage pipeline',
        selectedAgent: 'coder',
        success: false,
        executionTimeMs: 15000,
        completedStages: 1,
        totalStages: 5,
        userAbandoned: false,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.failureType).toBe('PARTIAL_SUCCESS');
      expect(result.penalizeRouting).toBe(true);
      expect(result.penalizeAgent).toBe(false);
      expect(result.recommendedAction).toBe('retry_different_agent');
      expect(result.reasoning).toContain('Low stage completion rate');
      expect(result.evidence).toContain('Completed 1/5 stages');
      expect(result.evidence).toContain('Success rate: 20.0%');
    });

    it('should classify moderate completion rate as agent issue', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-013',
        task: 'Complex workflow',
        selectedAgent: 'backend-dev',
        success: false,
        executionTimeMs: 20000,
        completedStages: 4,
        totalStages: 8,
        userAbandoned: false,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.failureType).toBe('PARTIAL_SUCCESS');
      expect(result.penalizeRouting).toBe(false);
      expect(result.penalizeAgent).toBe(true);
      expect(result.recommendedAction).toBe('retry_same_agent');
      expect(result.reasoning).toContain('Moderate stage completion rate');
      expect(result.evidence).toContain('Completed 4/8 stages');
      expect(result.evidence).toContain('Success rate: 50.0%');
    });

    it('should classify high completion rate as escalate', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-014',
        task: 'Nearly complete pipeline',
        selectedAgent: 'researcher',
        success: false,
        executionTimeMs: 25000,
        completedStages: 8,
        totalStages: 10,
        userAbandoned: false,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.failureType).toBe('PARTIAL_SUCCESS');
      expect(result.penalizeRouting).toBe(false);
      expect(result.penalizeAgent).toBe(false);
      expect(result.recommendedAction).toBe('escalate');
      expect(result.reasoning).toContain('High stage completion rate');
      expect(result.reasoning).toContain('task nearly succeeded');
      expect(result.evidence).toContain('Completed 8/10 stages');
      expect(result.evidence).toContain('Success rate: 80.0%');
    });

    it('should have confidence of 0.75 for partial success', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-015',
        task: 'Pipeline task',
        selectedAgent: 'coder',
        success: false,
        executionTimeMs: 10000,
        completedStages: 3,
        totalStages: 6,
        userAbandoned: false,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.classificationConfidence).toBe(0.75);
      expect(result.evidence.length).toBe(2);
    });
  });

  // ==================== Edge Cases & Default Behavior ====================

  describe('edge cases and default behavior', () => {
    it('should default to AGENT_FAILURE for generic failure', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-016',
        task: 'Generic task',
        selectedAgent: 'coder',
        success: false,
        executionTimeMs: 5000,
        userAbandoned: false,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.failureType).toBe('AGENT_FAILURE');
      expect(result.penalizeAgent).toBe(true);
      expect(result.recommendedAction).toBe('retry_same_agent');
      expect(result.classificationConfidence).toBe(0.5);
      expect(result.evidence).toContain('No specific failure indicators detected');
    });

    it('should not classify as routing failure if override but failed', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-017',
        task: 'Task with override',
        selectedAgent: 'coder',
        success: false,
        executionTimeMs: 3000,
        userOverrideAgent: 'researcher',
        userAbandoned: false,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.failureType).not.toBe('ROUTING_FAILURE');
    });

    it('should handle zero completed stages correctly', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-018',
        task: 'Pipeline with zero completion',
        selectedAgent: 'coder',
        success: false,
        executionTimeMs: 2000,
        completedStages: 0,
        totalStages: 5,
        userAbandoned: false,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.failureType).not.toBe('PARTIAL_SUCCESS');
    });

    it('should handle all stages completed but success=false', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-019',
        task: 'All stages done but failed',
        selectedAgent: 'coder',
        success: false,
        executionTimeMs: 10000,
        completedStages: 5,
        totalStages: 5,
        userAbandoned: false,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.failureType).not.toBe('PARTIAL_SUCCESS');
    });

    it('should prioritize user abandoned over other indicators', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-020',
        task: 'Abandoned with error',
        selectedAgent: 'coder',
        success: false,
        executionTimeMs: 5000,
        errorMessage: 'Some error',
        errorCode: 'ERR_001',
        userAbandoned: true,
        completedStages: 2,
        totalStages: 5,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.failureType).toBe('TASK_IMPOSSIBLE');
    });
  });

  // ==================== Confidence Calculation Tests ====================

  describe('confidence calculation', () => {
    it('should return 0.9 for 3+ indicators', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-021',
        task: 'Long abandoned task',
        selectedAgent: 'coder',
        success: false,
        executionTimeMs: 80000,
        errorMessage: 'Task failed',
        userAbandoned: true,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.classificationConfidence).toBe(0.9);
    });

    it('should return 0.75 for 2 indicators', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-022',
        task: 'Override success',
        selectedAgent: 'coder',
        success: true,
        executionTimeMs: 3000,
        userOverrideAgent: 'researcher',
        userAbandoned: false,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.classificationConfidence).toBe(0.75);
    });

    it('should return 0.5 for 1 indicator', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-023',
        task: 'Single indicator',
        selectedAgent: 'coder',
        success: false,
        executionTimeMs: 3000,
        errorMessage: 'Error occurred',
        userAbandoned: false,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.classificationConfidence).toBe(0.5);
    });
  });

  // ==================== Penalization Logic Tests ====================

  describe('penalization logic', () => {
    it('should penalize routing only for ROUTING_FAILURE', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-024',
        task: 'Override task',
        selectedAgent: 'coder',
        success: true,
        executionTimeMs: 2000,
        userOverrideAgent: 'researcher',
        userAbandoned: false,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.penalizeRouting).toBe(true);
      expect(result.penalizeAgent).toBe(false);
    });

    it('should penalize agent only for AGENT_FAILURE', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-025',
        task: 'Agent error task',
        selectedAgent: 'coder',
        success: false,
        executionTimeMs: 2000,
        errorMessage: 'Internal error',
        userAbandoned: false,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.penalizeRouting).toBe(false);
      expect(result.penalizeAgent).toBe(true);
    });

    it('should penalize neither for TASK_IMPOSSIBLE', () => {
      const feedback: IRoutingFeedback = {
        routingId: 'route-026',
        task: 'Impossible',
        selectedAgent: 'coder',
        success: false,
        executionTimeMs: 5000,
        userAbandoned: true,
        feedbackAt: Date.now(),
      };

      const result = classifier.classify(feedback);

      expect(result.penalizeRouting).toBe(false);
      expect(result.penalizeAgent).toBe(false);
    });

    it('should penalize based on completion rate for PARTIAL_SUCCESS', () => {
      const lowCompletion: IRoutingFeedback = {
        routingId: 'route-027',
        task: 'Low completion',
        selectedAgent: 'coder',
        success: false,
        executionTimeMs: 10000,
        completedStages: 1,
        totalStages: 10,
        userAbandoned: false,
        feedbackAt: Date.now(),
      };

      const lowResult = classifier.classify(lowCompletion);
      expect(lowResult.penalizeRouting).toBe(true);
      expect(lowResult.penalizeAgent).toBe(false);

      const moderateCompletion: IRoutingFeedback = {
        routingId: 'route-028',
        task: 'Moderate completion',
        selectedAgent: 'coder',
        success: false,
        executionTimeMs: 10000,
        completedStages: 5,
        totalStages: 10,
        userAbandoned: false,
        feedbackAt: Date.now(),
      };

      const moderateResult = classifier.classify(moderateCompletion);
      expect(moderateResult.penalizeRouting).toBe(false);
      expect(moderateResult.penalizeAgent).toBe(true);

      const highCompletion: IRoutingFeedback = {
        routingId: 'route-029',
        task: 'High completion',
        selectedAgent: 'coder',
        success: false,
        executionTimeMs: 10000,
        completedStages: 9,
        totalStages: 10,
        userAbandoned: false,
        feedbackAt: Date.now(),
      };

      const highResult = classifier.classify(highCompletion);
      expect(highResult.penalizeRouting).toBe(false);
      expect(highResult.penalizeAgent).toBe(false);
    });
  });
});
