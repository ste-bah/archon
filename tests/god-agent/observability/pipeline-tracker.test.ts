/**
 * PipelineTracker Test Suite
 *
 * Comprehensive tests for pipeline execution tracking.
 *
 * @module tests/observability/pipeline-tracker
 * @see TASK-OBS-004-PIPELINE-TRACKER.md
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PipelineTracker,
  type IPipelineStart,
  type IStepStart,
  type IStepResult,
  type IPipelineResult,
  ActivityStream,
  type IActivityEvent,
} from '../../../src/god-agent/observability';

describe('PipelineTracker', () => {
  let tracker: PipelineTracker;
  let activityStream: ActivityStream;
  let events: IActivityEvent[];

  beforeEach(() => {
    activityStream = new ActivityStream();
    tracker = new PipelineTracker(activityStream);
    events = [];

    // Subscribe to events
    activityStream.subscribe((event) => {
      events.push(event);
    });
  });

  // ===========================================================================
  // Test Cases from TASK-OBS-004
  // ===========================================================================

  describe('TC-004-01: startPipeline() with 5 steps', () => {
    it('should initialize pipeline with progress = 0, totalSteps = 5', () => {
      const pipelineConfig: IPipelineStart = {
        name: 'test-pipeline',
        steps: ['step1', 'step2', 'step3', 'step4', 'step5'],
        taskType: 'test',
      };

      const pipelineId = tracker.startPipeline(pipelineConfig);

      // Verify pipeline ID format
      expect(pipelineId).toMatch(/^pipe_test-pipeline_\d+_[a-z0-9]+$/);

      // Verify pipeline status
      const pipeline = tracker.getById(pipelineId);
      expect(pipeline).toBeDefined();
      expect(pipeline?.name).toBe('test-pipeline');
      expect(pipeline?.status).toBe('running');
      expect(pipeline?.totalSteps).toBe(5);
      expect(pipeline?.completedSteps).toBe(0);
      expect(pipeline?.progress).toBe(0);
      expect(pipeline?.steps).toHaveLength(5);

      // Verify all steps are pending
      pipeline?.steps.forEach((step, index) => {
        expect(step.name).toBe(`step${index + 1}`);
        expect(step.status).toBe('pending');
        expect(step.id).toBe('');  // Not started yet
      });
    });
  });

  describe('TC-004-02: Complete 2 of 5 steps', () => {
    it('should update progress to 40% after completing 2 steps', () => {
      // Start pipeline
      const pipelineConfig: IPipelineStart = {
        name: 'progress-test',
        steps: ['step1', 'step2', 'step3', 'step4', 'step5'],
        taskType: 'test',
      };
      const pipelineId = tracker.startPipeline(pipelineConfig);

      // Start and complete step 1
      const step1Id = tracker.startStep(pipelineId, { name: 'step1', agentType: 'agent1' });
      tracker.completeStep(pipelineId, step1Id, { output: 'result1' });

      // Verify progress after 1 step
      let pipeline = tracker.getById(pipelineId);
      expect(pipeline?.completedSteps).toBe(1);
      expect(pipeline?.progress).toBe(20);

      // Start and complete step 2
      const step2Id = tracker.startStep(pipelineId, { name: 'step2', agentType: 'agent2' });
      tracker.completeStep(pipelineId, step2Id, { output: 'result2' });

      // Verify progress after 2 steps
      pipeline = tracker.getById(pipelineId);
      expect(pipeline?.completedSteps).toBe(2);
      expect(pipeline?.progress).toBe(40);
    });

    it('should track step status transitions correctly', () => {
      const pipelineConfig: IPipelineStart = {
        name: 'status-test',
        steps: ['step1', 'step2'],
        taskType: 'test',
      };
      const pipelineId = tracker.startPipeline(pipelineConfig);

      // Initial state: both pending
      let pipeline = tracker.getById(pipelineId);
      expect(pipeline?.steps[0].status).toBe('pending');
      expect(pipeline?.steps[1].status).toBe('pending');

      // Start step 1: pending → running
      const step1Id = tracker.startStep(pipelineId, { name: 'step1' });
      pipeline = tracker.getById(pipelineId);
      expect(pipeline?.steps[0].status).toBe('running');
      expect(pipeline?.steps[0].id).toBe(step1Id);
      expect(pipeline?.steps[1].status).toBe('pending');

      // Complete step 1: running → success
      tracker.completeStep(pipelineId, step1Id, {});
      pipeline = tracker.getById(pipelineId);
      expect(pipeline?.steps[0].status).toBe('success');
      expect(pipeline?.steps[1].status).toBe('pending');
    });
  });

  describe('TC-004-03: failStep() sets step error', () => {
    it('should set step status to error and capture error message', () => {
      // Start pipeline
      const pipelineConfig: IPipelineStart = {
        name: 'error-test',
        steps: ['step1', 'step2'],
        taskType: 'test',
      };
      const pipelineId = tracker.startPipeline(pipelineConfig);

      // Start step 1
      const step1Id = tracker.startStep(pipelineId, { name: 'step1' });

      // Fail step 1
      const error = new Error('Network timeout');
      tracker.failStep(pipelineId, step1Id, error);

      // Verify step status
      const pipeline = tracker.getById(pipelineId);
      expect(pipeline?.steps[0].status).toBe('error');
      expect(pipeline?.steps[0].error).toBe('Network timeout');
      expect(pipeline?.steps[0].endTime).toBeDefined();
      expect(pipeline?.steps[0].durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('TC-004-04: completePipeline() calculates total duration', () => {
    it('should set endTime and complete pipeline', () => {
      const pipelineConfig: IPipelineStart = {
        name: 'complete-test',
        steps: ['step1', 'step2'],
        taskType: 'test',
      };
      const pipelineId = tracker.startPipeline(pipelineConfig);

      // Complete all steps
      const step1Id = tracker.startStep(pipelineId, { name: 'step1' });
      tracker.completeStep(pipelineId, step1Id, {});

      const step2Id = tracker.startStep(pipelineId, { name: 'step2' });
      tracker.completeStep(pipelineId, step2Id, {});

      // Complete pipeline
      const result: IPipelineResult = {
        output: { success: true },
        totalDurationMs: 5000,
      };
      tracker.completePipeline(pipelineId, result);

      // Verify pipeline moved to completed
      expect(tracker.getActive()).toHaveLength(0);

      // Verify pipeline status
      const pipeline = tracker.getById(pipelineId);
      expect(pipeline?.status).toBe('success');
      expect(pipeline?.endTime).toBeDefined();
      expect(pipeline?.currentStep).toBeUndefined();
    });
  });

  describe('TC-004-05: getActive() returns running pipelines', () => {
    it('should return only active pipelines', () => {
      // Create 3 pipelines
      const pipe1Id = tracker.startPipeline({
        name: 'pipe1',
        steps: ['s1'],
        taskType: 'test',
      });

      const pipe2Id = tracker.startPipeline({
        name: 'pipe2',
        steps: ['s1'],
        taskType: 'test',
      });

      const pipe3Id = tracker.startPipeline({
        name: 'pipe3',
        steps: ['s1'],
        taskType: 'test',
      });

      // All should be active
      expect(tracker.getActive()).toHaveLength(3);

      // Complete pipe2
      const step2Id = tracker.startStep(pipe2Id, { name: 's1' });
      tracker.completeStep(pipe2Id, step2Id, {});
      tracker.completePipeline(pipe2Id, { output: {}, totalDurationMs: 1000 });

      // Should have 2 active
      const active = tracker.getActive();
      expect(active).toHaveLength(2);
      expect(active.map((p) => p.id)).toContain(pipe1Id);
      expect(active.map((p) => p.id)).toContain(pipe3Id);
      expect(active.map((p) => p.id)).not.toContain(pipe2Id);
    });

    it('should filter by status correctly', () => {
      const pipelineId = tracker.startPipeline({
        name: 'test',
        steps: ['s1'],
        taskType: 'test',
      });

      const active = tracker.getActive();
      expect(active).toHaveLength(1);
      expect(active[0].status).toBe('running');
    });
  });

  describe('TC-004-06: Step timing accurate', () => {
    it('should calculate step duration correctly', async () => {
      const pipelineConfig: IPipelineStart = {
        name: 'timing-test',
        steps: ['step1'],
        taskType: 'test',
      };
      const pipelineId = tracker.startPipeline(pipelineConfig);

      // Start step
      const stepId = tracker.startStep(pipelineId, { name: 'step1' });

      // Wait 50ms
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Complete step
      tracker.completeStep(pipelineId, stepId, {});

      // Verify duration
      const pipeline = tracker.getById(pipelineId);
      const step = pipeline?.steps[0];
      expect(step?.durationMs).toBeGreaterThanOrEqual(50);
      expect(step?.durationMs).toBeLessThan(200);  // Reasonable upper bound
      expect(step?.startTime).toBeDefined();
      expect(step?.endTime).toBeDefined();
      expect(step?.endTime! - step?.startTime!).toBe(step?.durationMs);
    });
  });

  describe('TC-004-07: 21st completion evicts oldest', () => {
    it('should maintain max 20 completed pipelines', () => {
      // Create and complete 21 pipelines
      const pipelineIds: string[] = [];

      for (let i = 0; i < 21; i++) {
        const pipelineId = tracker.startPipeline({
          name: `pipe${i}`,
          steps: ['step1'],
          taskType: 'test',
        });
        pipelineIds.push(pipelineId);

        const stepId = tracker.startStep(pipelineId, { name: 'step1' });
        tracker.completeStep(pipelineId, stepId, {});
        tracker.completePipeline(pipelineId, { output: {}, totalDurationMs: 100 });
      }

      // Verify stats
      const stats = tracker.getStats();
      expect(stats.activeCount).toBe(0);
      expect(stats.completedCount).toBe(20);
      expect(stats.maxCompleted).toBe(20);

      // First pipeline should be evicted
      const firstPipeline = tracker.getById(pipelineIds[0]);
      expect(firstPipeline).toBeNull();

      // Second pipeline should still exist
      const secondPipeline = tracker.getById(pipelineIds[1]);
      expect(secondPipeline).toBeDefined();

      // Last pipeline should exist
      const lastPipeline = tracker.getById(pipelineIds[20]);
      expect(lastPipeline).toBeDefined();
    });
  });

  // ===========================================================================
  // Additional Coverage Tests
  // ===========================================================================

  describe('Error Handling', () => {
    it('should handle unknown pipeline ID gracefully', () => {
      // PipelineTracker uses structured logger (ConsoleLogHandler) which outputs JSON via console.log
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      tracker.startStep('unknown-pipeline-id', { name: 'step1' });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('unknown pipeline')
      );

      consoleSpy.mockRestore();
    });

    it('should handle unknown step ID gracefully', () => {
      // PipelineTracker uses structured logger (ConsoleLogHandler) which outputs JSON via console.log
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const pipelineId = tracker.startPipeline({
        name: 'test',
        steps: ['step1'],
        taskType: 'test',
      });

      tracker.completeStep(pipelineId, 'unknown-step-id', {});

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('not found in pipeline')
      );

      consoleSpy.mockRestore();
    });

    it('should handle failPipeline correctly', () => {
      const pipelineId = tracker.startPipeline({
        name: 'test',
        steps: ['step1'],
        taskType: 'test',
      });

      const error = new Error('Pipeline failed');
      tracker.failPipeline(pipelineId, error);

      const pipeline = tracker.getById(pipelineId);
      expect(pipeline?.status).toBe('error');
      expect(pipeline?.endTime).toBeDefined();
    });
  });

  describe('Pipeline ID Format', () => {
    it('should generate correct pipeline ID format', () => {
      const pipelineId = tracker.startPipeline({
        name: 'research-pipeline',
        steps: ['step1'],
        taskType: 'research',
      });

      expect(pipelineId).toMatch(/^pipe_research-pipeline_\d+_[a-z0-9]{6}$/);
    });
  });

  describe('Step ID Format', () => {
    it('should generate correct step ID format', () => {
      const pipelineId = tracker.startPipeline({
        name: 'test',
        steps: ['step1', 'step2'],
        taskType: 'test',
      });

      const step1Id = tracker.startStep(pipelineId, { name: 'step1' });
      expect(step1Id).toMatch(new RegExp(`^step_${pipelineId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_0_[a-z0-9]{6}$`));

      tracker.completeStep(pipelineId, step1Id, {});

      const step2Id = tracker.startStep(pipelineId, { name: 'step2' });
      expect(step2Id).toMatch(new RegExp(`^step_${pipelineId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_1_[a-z0-9]{6}$`));
    });
  });

  describe('Progress Calculation', () => {
    it('should calculate progress correctly for all steps', () => {
      const pipelineId = tracker.startPipeline({
        name: 'test',
        steps: ['s1', 's2', 's3', 's4'],
        taskType: 'test',
      });

      // 0% initially
      let pipeline = tracker.getById(pipelineId);
      expect(pipeline?.progress).toBe(0);

      // Complete step 1: 25%
      let stepId = tracker.startStep(pipelineId, { name: 's1' });
      tracker.completeStep(pipelineId, stepId, {});
      pipeline = tracker.getById(pipelineId);
      expect(pipeline?.progress).toBe(25);

      // Complete step 2: 50%
      stepId = tracker.startStep(pipelineId, { name: 's2' });
      tracker.completeStep(pipelineId, stepId, {});
      pipeline = tracker.getById(pipelineId);
      expect(pipeline?.progress).toBe(50);

      // Complete step 3: 75%
      stepId = tracker.startStep(pipelineId, { name: 's3' });
      tracker.completeStep(pipelineId, stepId, {});
      pipeline = tracker.getById(pipelineId);
      expect(pipeline?.progress).toBe(75);

      // Complete step 4: 100%
      stepId = tracker.startStep(pipelineId, { name: 's4' });
      tracker.completeStep(pipelineId, stepId, {});
      pipeline = tracker.getById(pipelineId);
      expect(pipeline?.progress).toBe(100);
    });
  });

  describe('Current Step Tracking', () => {
    it('should update currentStep as pipeline progresses', () => {
      const pipelineId = tracker.startPipeline({
        name: 'test',
        steps: ['s1', 's2', 's3'],
        taskType: 'test',
      });

      // No current step initially
      let pipeline = tracker.getById(pipelineId);
      expect(pipeline?.currentStep).toBeUndefined();

      // Start step 1
      let stepId = tracker.startStep(pipelineId, { name: 's1' });
      pipeline = tracker.getById(pipelineId);
      expect(pipeline?.currentStep).toBe('s1');

      // Complete step 1, start step 2
      tracker.completeStep(pipelineId, stepId, {});
      stepId = tracker.startStep(pipelineId, { name: 's2' });
      pipeline = tracker.getById(pipelineId);
      expect(pipeline?.currentStep).toBe('s2');

      // Complete all steps
      tracker.completeStep(pipelineId, stepId, {});
      stepId = tracker.startStep(pipelineId, { name: 's3' });
      tracker.completeStep(pipelineId, stepId, {});
      pipeline = tracker.getById(pipelineId);
      expect(pipeline?.currentStep).toBeUndefined();
    });
  });

  describe('getStats()', () => {
    it('should return correct statistics', () => {
      // Initial state
      let stats = tracker.getStats();
      expect(stats.activeCount).toBe(0);
      expect(stats.completedCount).toBe(0);
      expect(stats.maxCompleted).toBe(20);

      // Add 2 active pipelines
      const pipe1 = tracker.startPipeline({
        name: 'pipe1',
        steps: ['s1'],
        taskType: 'test',
      });

      tracker.startPipeline({
        name: 'pipe2',
        steps: ['s1'],
        taskType: 'test',
      });

      stats = tracker.getStats();
      expect(stats.activeCount).toBe(2);
      expect(stats.completedCount).toBe(0);

      // Complete one
      const stepId = tracker.startStep(pipe1, { name: 's1' });
      tracker.completeStep(pipe1, stepId, {});
      tracker.completePipeline(pipe1, { output: {}, totalDurationMs: 100 });

      stats = tracker.getStats();
      expect(stats.activeCount).toBe(1);
      expect(stats.completedCount).toBe(1);
    });
  });
});
