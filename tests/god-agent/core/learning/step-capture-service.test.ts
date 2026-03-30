/**
 * StepCaptureService Tests
 * SPEC-SON-001 - Trajectory Steps Extraction
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  StepCaptureService,
  getGlobalStepCapture,
  resetGlobalStepCapture
} from '../../../../src/god-agent/core/learning/step-capture-service.js';
import type { IReasoningStep, ReasoningStepAction } from '../../../../src/god-agent/core/learning/sona-types.js';

describe('SPEC-SON-001: StepCaptureService', () => {
  let service: StepCaptureService;

  beforeEach(() => {
    service = new StepCaptureService({ verbose: false });
  });

  afterEach(() => {
    service.clear();
  });

  describe('Basic Step Capture', () => {
    it('should capture a single step', () => {
      service.beginCapture('traj_001');

      service.captureStep({
        action: 'query_vectordb',
        actionParams: { query: 'test query', limit: 10 },
        result: 'Found 5 results',
        confidence: 0.85,
      });

      const steps = service.endCapture('traj_001');

      expect(steps).toHaveLength(1);
      expect(steps[0].action).toBe('query_vectordb');
      expect(steps[0].stepId).toMatch(/^step_1_/);
      expect(steps[0].timestamp).toBeGreaterThan(0);
      expect(steps[0].confidence).toBe(0.85);
    });

    it('should capture multiple steps in sequence', () => {
      service.beginCapture('traj_002');

      service.captureStep({
        action: 'query_vectordb',
        actionParams: { query: 'search' },
        result: 'results',
        confidence: 0.9,
      });

      service.captureStep({
        action: 'pattern_match',
        actionParams: { pattern: 'pattern_123' },
        result: 'matched',
        confidence: 0.8,
      });

      service.captureStep({
        action: 'causal_inference',
        actionParams: { cause: 'A', effect: 'B' },
        result: 'inference complete',
        confidence: 0.7,
      });

      const steps = service.endCapture('traj_002');

      expect(steps).toHaveLength(3);
      expect(steps[0].action).toBe('query_vectordb');
      expect(steps[1].action).toBe('pattern_match');
      expect(steps[2].action).toBe('causal_inference');
    });

    it('should generate unique step IDs', () => {
      service.beginCapture('traj_003');

      for (let i = 0; i < 5; i++) {
        service.captureStep({
          action: 'query_vectordb',
          actionParams: {},
          result: 'result',
          confidence: 0.8,
        });
      }

      const steps = service.endCapture('traj_003');
      const stepIds = steps.map(s => s.stepId);
      const uniqueIds = new Set(stepIds);

      expect(uniqueIds.size).toBe(5);
    });
  });

  describe('Result Compression', () => {
    it('should truncate large results', () => {
      service.beginCapture('traj_truncate');

      const largeResult = 'x'.repeat(2000);
      service.captureStep({
        action: 'query_vectordb',
        actionParams: {},
        result: largeResult,
        confidence: 0.9,
      });

      const steps = service.endCapture('traj_truncate');

      expect(steps[0].result.length).toBeLessThan(1200);
      expect(steps[0].result).toContain('[truncated');
      expect(steps[0].resultRef).toBeDefined();
      expect(steps[0].resultRef?.type).toBe('memory');
    });

    it('should not truncate small results', () => {
      service.beginCapture('traj_small');

      const smallResult = 'Small result';
      service.captureStep({
        action: 'query_vectordb',
        actionParams: {},
        result: smallResult,
        confidence: 0.9,
      });

      const steps = service.endCapture('traj_small');

      expect(steps[0].result).toBe(smallResult);
      expect(steps[0].resultRef).toBeUndefined();
    });
  });

  describe('Step Limits', () => {
    it('should enforce max steps limit', () => {
      const limitedService = new StepCaptureService({ maxSteps: 5 });
      limitedService.beginCapture('traj_limited');

      for (let i = 0; i < 10; i++) {
        limitedService.captureStep({
          action: 'query_vectordb',
          actionParams: {},
          result: `result_${i}`,
          confidence: 0.8,
        });
      }

      const steps = limitedService.endCapture('traj_limited');
      expect(steps).toHaveLength(5);
    });
  });

  describe('Multiple Trajectories', () => {
    it('should handle multiple trajectory captures', () => {
      service.beginCapture('traj_a');
      service.captureStep({
        action: 'query_vectordb',
        actionParams: {},
        result: 'result_a',
        confidence: 0.9,
      });

      service.beginCapture('traj_b');
      service.captureStep({
        action: 'pattern_match',
        actionParams: {},
        result: 'result_b',
        confidence: 0.8,
      });

      // Both trajectories should have active captures
      expect(service.hasActiveCapture('traj_a')).toBe(true);
      expect(service.hasActiveCapture('traj_b')).toBe(true);

      // End captures and verify steps
      const stepsA = service.endCapture('traj_a');
      const stepsB = service.endCapture('traj_b');

      expect(stepsA).toHaveLength(1);
      expect(stepsB).toHaveLength(1);
      expect(stepsA[0].action).toBe('query_vectordb');
      expect(stepsB[0].action).toBe('pattern_match');
    });

    it('should track active captures in stats', () => {
      service.beginCapture('traj_1');
      service.beginCapture('traj_2');
      service.beginCapture('traj_3');

      const stats = service.getStats();
      expect(stats.activeCaptures).toBe(3);
    });
  });

  describe('captureWithTiming', () => {
    it('should capture step with duration', async () => {
      service.beginCapture('traj_timed');

      const result = await service.captureWithTiming(
        'query_vectordb',
        { query: 'test' },
        async () => {
          await new Promise(r => setTimeout(r, 50)); // 50ms delay
          return ['result1', 'result2'];
        }
      );

      const steps = service.endCapture('traj_timed');

      expect(result).toEqual(['result1', 'result2']);
      expect(steps).toHaveLength(1);
      expect(steps[0].metadata?.duration).toBeGreaterThanOrEqual(40);
    });

    it('should capture error on failure', async () => {
      service.beginCapture('traj_error');

      try {
        await service.captureWithTiming(
          'query_vectordb',
          { query: 'failing' },
          async () => {
            throw new Error('DB connection failed');
          }
        );
      } catch {
        // Expected
      }

      const steps = service.endCapture('traj_error');

      expect(steps).toHaveLength(1);
      expect(steps[0].result).toContain('Error');
      expect(steps[0].confidence).toBe(0);
      expect(steps[0].metadata?.error).toBeDefined();
    });
  });

  describe('Global Singleton', () => {
    afterEach(() => {
      resetGlobalStepCapture();
    });

    it('should return same instance', () => {
      const instance1 = getGlobalStepCapture();
      const instance2 = getGlobalStepCapture();
      expect(instance1).toBe(instance2);
    });

    it('should reset global instance', () => {
      const instance1 = getGlobalStepCapture();
      resetGlobalStepCapture();
      const instance2 = getGlobalStepCapture();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('Confidence Estimation', () => {
    it('should estimate confidence based on result type', async () => {
      service.beginCapture('traj_confidence');

      // Array result
      await service.captureWithTiming('query_vectordb', {}, async () => [1, 2, 3, 4, 5]);

      // Object result
      await service.captureWithTiming('pattern_match', {}, async () => ({ key: 'value' }));

      // Empty result
      await service.captureWithTiming('similarity_search', {}, async () => []);

      const steps = service.endCapture('traj_confidence');

      expect(steps[0].confidence).toBeGreaterThan(0.5); // Array with items
      expect(steps[1].confidence).toBeGreaterThan(0.5); // Object with keys
      expect(steps[2].confidence).toBeLessThan(0.5); // Empty array
    });
  });
});

describe('All ReasoningStepAction Types', () => {
  const allActions: ReasoningStepAction[] = [
    'query_vectordb',
    'query_reasoningbank',
    'causal_inference',
    'pattern_match',
    'embedding_generation',
    'similarity_search',
    'analogical_mapping',
    'temporal_analysis',
    'code_generation',
    'validation',
    'custom',
  ];

  it('should accept all defined action types', () => {
    const service = new StepCaptureService();
    service.beginCapture('traj_actions');

    allActions.forEach(action => {
      service.captureStep({
        action,
        actionParams: { type: action },
        result: `Result for ${action}`,
        confidence: 0.8,
      });
    });

    const steps = service.endCapture('traj_actions');
    expect(steps).toHaveLength(allActions.length);

    steps.forEach((step, i) => {
      expect(step.action).toBe(allActions[i]);
    });
  });
});
