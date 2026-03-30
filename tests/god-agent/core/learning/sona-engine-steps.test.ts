/**
 * SonaEngine Integration Tests with StepCaptureService
 * SPEC-SON-001 - Trajectory Creation with Captured Steps
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SonaEngine } from '../../../../src/god-agent/core/learning/sona-engine.js';
import { StepCaptureService } from '../../../../src/god-agent/core/learning/step-capture-service.js';
import type { IReasoningStep } from '../../../../src/god-agent/core/learning/sona-types.js';

describe('SPEC-SON-001: SonaEngine + StepCaptureService Integration', () => {
  let sonaEngine: SonaEngine;
  let stepCapture: StepCaptureService;

  beforeEach(() => {
    sonaEngine = new SonaEngine({
      alpha: 0.1,
      gamma: 0.95,
      epsilon: 0.1,
    });
    stepCapture = new StepCaptureService({ verbose: false });
  });

  describe('Trajectory Creation with Steps', () => {
    it('should capture steps during trajectory execution', async () => {
      const trajectoryId = 'traj_001';
      stepCapture.beginCapture(trajectoryId);

      // Simulate reasoning steps during trajectory execution
      stepCapture.captureStep({
        action: 'query_vectordb',
        actionParams: { query: 'neural networks', limit: 10 },
        result: 'Found 10 relevant documents',
        confidence: 0.9,
      });

      stepCapture.captureStep({
        action: 'similarity_search',
        actionParams: { threshold: 0.8 },
        result: 'Matched 3 similar patterns',
        confidence: 0.85,
      });

      stepCapture.captureStep({
        action: 'code_generation',
        actionParams: { template: 'pytorch' },
        result: 'Generated model code',
        confidence: 0.95,
      });

      const steps = stepCapture.endCapture(trajectoryId);

      expect(steps).toHaveLength(3);
      expect(steps[0].action).toBe('query_vectordb');
      expect(steps[1].action).toBe('similarity_search');
      expect(steps[2].action).toBe('code_generation');

      // Verify step metadata
      expect(steps[0].confidence).toBe(0.9);
      expect(steps[1].confidence).toBe(0.85);
      expect(steps[2].confidence).toBe(0.95);

      // Verify step IDs are unique
      const stepIds = steps.map(s => s.stepId);
      expect(new Set(stepIds).size).toBe(3);
    });

    it('should create trajectory with steps in SonaEngine', () => {
      const route = '/research/neural-networks';
      const patterns = ['pattern_query', 'pattern_search', 'pattern_generate'];

      // Create trajectory first
      const trajectoryId = sonaEngine.createTrajectory(route, patterns, ['context1', 'context2']);

      // Then capture steps for that trajectory
      stepCapture.beginCapture(trajectoryId);

      stepCapture.captureStep({
        action: 'query_vectordb',
        actionParams: { query: 'test' },
        result: 'results',
        confidence: 0.8,
      });

      const steps = stepCapture.endCapture(trajectoryId);

      expect(steps).toHaveLength(1);
      expect(steps[0].action).toBe('query_vectordb');

      // Verify trajectory exists in SonaEngine
      const trajectory = sonaEngine.getTrajectory(trajectoryId);
      expect(trajectory).toBeDefined();
      expect(trajectory?.route).toBe(route);
      expect(trajectory?.patterns).toEqual(patterns);
    });

    it('should handle empty steps array', () => {
      const trajectoryId = 'traj_empty';
      stepCapture.beginCapture(trajectoryId);
      const steps = stepCapture.endCapture(trajectoryId);

      expect(steps).toHaveLength(0);
      expect(steps).toEqual([]);
    });
  });

  describe('Step Metadata and Timing', () => {
    it('should capture timing metadata with captureWithTiming', async () => {
      const trajectoryId = 'traj_timing';
      stepCapture.beginCapture(trajectoryId);

      await stepCapture.captureWithTiming(
        'pattern_match',
        { pattern: 'test_pattern' },
        async () => {
          await new Promise(r => setTimeout(r, 100));
          return { matched: true, score: 0.92 };
        }
      );

      const steps = stepCapture.endCapture(trajectoryId);

      expect(steps).toHaveLength(1);
      expect(steps[0].action).toBe('pattern_match');
      expect(steps[0].metadata).toBeDefined();
      expect(steps[0].metadata?.duration).toBeGreaterThanOrEqual(90);
    });

    it('should capture error metadata on failure', async () => {
      const trajectoryId = 'traj_error';
      stepCapture.beginCapture(trajectoryId);

      try {
        await stepCapture.captureWithTiming(
          'query_vectordb',
          { query: 'failing' },
          async () => {
            throw new Error('DB connection failed');
          }
        );
      } catch {
        // Expected error
      }

      const steps = stepCapture.endCapture(trajectoryId);

      expect(steps).toHaveLength(1);
      expect(steps[0].result).toContain('Error');
      expect(steps[0].confidence).toBe(0);
      expect(steps[0].metadata?.error).toBe('DB connection failed');
    });
  });

  describe('Complex Step Sequences', () => {
    it('should handle multi-step reasoning sequences', async () => {
      const trajectoryId = 'traj_complex';
      stepCapture.beginCapture(trajectoryId);

      // Complex reasoning sequence
      const actions = [
        { action: 'query_vectordb', params: { query: 'start' }, confidence: 0.9 },
        { action: 'embedding_generation', params: { text: 'embed' }, confidence: 0.85 },
        { action: 'similarity_search', params: { vector: [] }, confidence: 0.8 },
        { action: 'analogical_mapping', params: { source: 'A', target: 'B' }, confidence: 0.75 },
        { action: 'causal_inference', params: { cause: 'X', effect: 'Y' }, confidence: 0.7 },
        { action: 'pattern_match', params: { pattern: 'final' }, confidence: 0.85 },
        { action: 'validation', params: { validate: true }, confidence: 0.9 },
      ] as const;

      for (const { action, params, confidence } of actions) {
        stepCapture.captureStep({
          action,
          actionParams: params,
          result: `result_${action}`,
          confidence,
        });
      }

      const steps = stepCapture.endCapture(trajectoryId);

      expect(steps).toHaveLength(7);

      // Verify sequence order
      for (let i = 0; i < actions.length; i++) {
        expect(steps[i].action).toBe(actions[i].action);
        expect(steps[i].confidence).toBe(actions[i].confidence);
      }
    });

    it('should handle steps with recovery patterns', async () => {
      const trajectoryId = 'traj_recovery';
      stepCapture.beginCapture(trajectoryId);

      // Successful step
      stepCapture.captureStep({
        action: 'query_vectordb',
        actionParams: { query: 'test' },
        result: 'success',
        confidence: 0.9,
      });

      // Failed step
      try {
        await stepCapture.captureWithTiming(
          'pattern_match',
          { pattern: 'failing' },
          async () => {
            throw new Error('Pattern match failed');
          }
        );
      } catch {
        // Expected
      }

      // Recovery step
      stepCapture.captureStep({
        action: 'validation',
        actionParams: { fallback: true },
        result: 'recovered',
        confidence: 0.7,
      });

      const steps = stepCapture.endCapture(trajectoryId);

      expect(steps).toHaveLength(3);
      expect(steps[0].confidence).toBe(0.9); // Success
      expect(steps[1].confidence).toBe(0); // Error
      expect(steps[1].metadata?.error).toBeDefined();
      expect(steps[2].confidence).toBe(0.7); // Recovery
    });
  });

  describe('Integration with SonaEngine Trajectories', () => {
    it('should track steps for multiple SonaEngine trajectories', () => {
      const route1 = '/task/research';
      const route2 = '/task/implementation';

      // Create two trajectories
      const trajId1 = sonaEngine.createTrajectory(route1, ['pattern1', 'pattern2']);
      const trajId2 = sonaEngine.createTrajectory(route2, ['pattern3', 'pattern4']);

      // Capture steps for first trajectory
      stepCapture.beginCapture(trajId1);
      stepCapture.captureStep({
        action: 'query_vectordb',
        actionParams: {},
        result: 'research results',
        confidence: 0.85,
      });
      const steps1 = stepCapture.endCapture(trajId1);

      // Capture steps for second trajectory
      stepCapture.beginCapture(trajId2);
      stepCapture.captureStep({
        action: 'code_generation',
        actionParams: {},
        result: 'implementation code',
        confidence: 0.9,
      });
      const steps2 = stepCapture.endCapture(trajId2);

      expect(steps1).toHaveLength(1);
      expect(steps2).toHaveLength(1);
      expect(steps1[0].action).toBe('query_vectordb');
      expect(steps2[0].action).toBe('code_generation');

      // Verify both trajectories exist in SonaEngine
      expect(sonaEngine.getTrajectory(trajId1)).toBeDefined();
      expect(sonaEngine.getTrajectory(trajId2)).toBeDefined();
    });

    it('should provide statistics about captured steps', () => {
      stepCapture.beginCapture('traj_stats_1');
      stepCapture.captureStep({
        action: 'query_vectordb',
        actionParams: {},
        result: 'result',
        confidence: 0.8,
      });
      stepCapture.endCapture('traj_stats_1');

      stepCapture.beginCapture('traj_stats_2');
      stepCapture.captureStep({
        action: 'pattern_match',
        actionParams: {},
        result: 'result',
        confidence: 0.7,
      });
      stepCapture.captureStep({
        action: 'validation',
        actionParams: {},
        result: 'result',
        confidence: 0.9,
      });
      stepCapture.endCapture('traj_stats_2');

      const stats = stepCapture.getStats();

      expect(stats.totalStepsCaptured).toBe(0); // All captures ended, buffers cleared
      expect(stats.activeCaptures).toBe(0);
    });
  });

  describe('All ReasoningStepAction Types Integration', () => {
    it('should support all action types in trajectory steps', () => {
      const allActions = [
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
      ] as const;

      const trajectoryId = 'traj_all_actions';
      stepCapture.beginCapture(trajectoryId);

      allActions.forEach(action => {
        stepCapture.captureStep({
          action,
          actionParams: { type: action },
          result: `Result for ${action}`,
          confidence: 0.8,
        });
      });

      const steps = stepCapture.endCapture(trajectoryId);

      expect(steps).toHaveLength(allActions.length);
      steps.forEach((step, i) => {
        expect(step.action).toBe(allActions[i]);
      });
    });
  });
});
