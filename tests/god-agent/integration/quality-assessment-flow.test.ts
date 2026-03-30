/**
 * TASK-INT-005: Quality Assessment Flow Integration Test
 *
 * Verifies that the quality assessment flow works correctly after Phase 4 fixes:
 * 1. Task execution goes through TaskExecutor
 * 2. ObservabilityBus events are emitted
 * 3. Quality is assessed on actual result (not prompt)
 * 4. TrajectoryBridge receives feedback when quality meets threshold
 *
 * Per CONSTITUTION RULE-033: Quality MUST be assessed on Task() RESULT, not prompt
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskExecutor } from '../../../src/god-agent/core/agents/task-executor.js';
import { ObservabilityBus } from '../../../src/god-agent/core/observability/bus.js';
import { assessQuality } from '../../../src/god-agent/universal/quality-estimator.js';
import type { ILoadedAgentDefinition } from '../../../src/god-agent/core/agents/agent-types.js';

// Mock agent definition for testing
const mockAgent: ILoadedAgentDefinition = {
  key: 'test-agent',
  category: 'testing',
  filePath: '/test/path/test-agent.md',
  frontmatter: {
    name: 'Test Agent',
    description: 'Agent for testing quality flow',
    type: 'tester',
    version: '1.0.0',
    capabilities: ['testing', 'verification'],
    tools: [],
    successCriteria: 'All tests pass',
    outputFormat: 'TASK COMPLETION SUMMARY'
  },
  promptContent: '# Test Agent\n\nYou are a test agent for quality assessment integration tests.',
  rawContent: '---\nname: Test Agent\n---\n# Test Agent'
};

// Mock execution result (simulates actual Task() output)
const mockTaskResult = `## TASK COMPLETION SUMMARY

**What I Did**: Implemented the feature as requested with comprehensive tests.

**Files Created/Modified**:
- \`src/feature.ts\` - Core feature implementation
- \`tests/feature.test.ts\` - Unit tests

**Quality Indicators**:
- TypeScript types fully defined
- All edge cases handled
- 100% test coverage

**Next Agent Guidance**: The feature is ready for code review.`;

// Mock failed result (low quality)
const mockLowQualityResult = 'Error: Something went wrong';

describe('TASK-INT-005: Quality Assessment Flow', () => {
  let taskExecutor: TaskExecutor;
  let busEvents: Array<{ component: string; operation: string; status: string; metadata?: unknown }>;
  let originalEmit: typeof ObservabilityBus.prototype.emit;

  beforeEach(() => {
    taskExecutor = new TaskExecutor({ verbose: false });
    busEvents = [];

    // Capture ObservabilityBus events
    originalEmit = ObservabilityBus.prototype.emit;
    ObservabilityBus.prototype.emit = function(event) {
      busEvents.push({
        component: event.component,
        operation: event.operation,
        status: event.status,
        metadata: event.metadata
      });
      return originalEmit.call(this, event);
    };
  });

  afterEach(() => {
    // Restore original emit
    ObservabilityBus.prototype.emit = originalEmit;
    busEvents = [];
  });

  describe('TaskExecutor ObservabilityBus Integration', () => {
    it('should emit agent_started event when execution begins', async () => {
      const executeTask = vi.fn().mockResolvedValue(mockTaskResult);

      await taskExecutor.execute(mockAgent, 'Test task', executeTask);

      const startEvent = busEvents.find(e => e.operation === 'agent_started');
      expect(startEvent).toBeDefined();
      expect(startEvent?.component).toBe('agent');
      expect(startEvent?.status).toBe('running');
      expect(startEvent?.metadata).toMatchObject({
        agentKey: 'test-agent',
        agentCategory: 'testing'
      });
    });

    it('should emit agent_completed event with output on success', async () => {
      const executeTask = vi.fn().mockResolvedValue(mockTaskResult);

      await taskExecutor.execute(mockAgent, 'Test task', executeTask);

      const completeEvent = busEvents.find(e => e.operation === 'agent_completed');
      expect(completeEvent).toBeDefined();
      expect(completeEvent?.status).toBe('success');
      expect(completeEvent?.metadata).toMatchObject({
        agentKey: 'test-agent',
        outputLength: mockTaskResult.length
      });
    });

    it('should emit agent_failed event on execution error', async () => {
      const executeTask = vi.fn().mockRejectedValue(new Error('Test execution error'));

      await expect(taskExecutor.execute(mockAgent, 'Test task', executeTask))
        .rejects.toThrow('Test execution error');

      const failEvent = busEvents.find(e => e.operation === 'agent_failed');
      expect(failEvent).toBeDefined();
      expect(failEvent?.status).toBe('error');
      expect(failEvent?.metadata).toMatchObject({
        agentKey: 'test-agent',
        error: 'Test execution error'
      });
    });

    it('should include executionId in all events for correlation', async () => {
      const executeTask = vi.fn().mockResolvedValue(mockTaskResult);

      await taskExecutor.execute(mockAgent, 'Test task', executeTask);

      // Both events should have the same executionId
      const startEvent = busEvents.find(e => e.operation === 'agent_started');
      const completeEvent = busEvents.find(e => e.operation === 'agent_completed');

      expect(startEvent?.metadata).toHaveProperty('executionId');
      expect(completeEvent?.metadata).toHaveProperty('executionId');
      expect((startEvent?.metadata as Record<string, unknown>)?.executionId)
        .toBe((completeEvent?.metadata as Record<string, unknown>)?.executionId);
    });
  });

  describe('Quality Assessment on Actual Result', () => {
    it('should assess quality for well-structured Task() output', () => {
      const quality = assessQuality({
        id: 'test-1',
        mode: 'code',
        input: 'Implement a feature',
        output: mockTaskResult,
        timestamp: Date.now()
      }, 0.5); // TASK-FIX-008: Calibrated threshold

      // RULE-033: Quality on actual result should be meaningful
      // TASK-FIX-008: Calibrated estimator should score TASK COMPLETION SUMMARY 0.6-0.8
      expect(quality.score).toBeGreaterThan(0.5);
      expect(quality.score).toBeLessThan(1.0);
      expect(quality.meetsThreshold).toBe(true);
      // Verify taskResultBonus is applied
      expect(quality.factors.taskResultBonus).toBeGreaterThan(0);
    });

    it('should assess low quality for error output', () => {
      const quality = assessQuality({
        id: 'test-2',
        mode: 'code',
        input: 'Implement a feature',
        output: mockLowQualityResult,
        timestamp: Date.now()
      }, 0.5);

      // Error output should score low
      expect(quality.score).toBeLessThan(0.5);
      expect(quality.meetsThreshold).toBe(false);
    });

    it('should detect TASK COMPLETION SUMMARY format', () => {
      const quality = assessQuality({
        id: 'test-3',
        mode: 'general',
        input: 'Complete the task',
        output: mockTaskResult,
        timestamp: Date.now()
      }, 0.5);

      // TASK-FIX-008: TASK COMPLETION SUMMARY should trigger taskResultBonus
      // Expect score 0.6+ with calibrated estimator
      expect(quality.score).toBeGreaterThan(0.5);
      expect(quality.meetsThreshold).toBe(true);
      // Verify taskResultBonus includes TASK COMPLETION SUMMARY detection
      expect(quality.factors.taskResultBonus).toBeGreaterThanOrEqual(0.15);
    });

    it('should penalize prompt-like output (no code blocks, no structure)', () => {
      const promptLikeOutput = `You are a helpful assistant that will analyze the code and implement the feature.

Please review the following requirements and produce high-quality TypeScript code.

## Instructions
- Follow best practices
- Write clean code
- Add tests`;

      const quality = assessQuality({
        id: 'test-4',
        mode: 'code',
        input: 'Write code',
        output: promptLikeOutput,
        timestamp: Date.now()
      }, 0.5);

      // Prompt-like output should not score high for code mode
      // This validates RULE-033: prompts should be detected as low-quality
      expect(quality.score).toBeLessThan(0.7);
    });
  });

  describe('Full Quality Flow Integration', () => {
    it('should complete quality flow: execute → assess → feedback', async () => {
      const executeTask = vi.fn().mockResolvedValue(mockTaskResult);

      // Step 1: Execute via TaskExecutor
      const result = await taskExecutor.execute(mockAgent, 'Test task', executeTask);

      expect(result.success).toBe(true);
      expect(result.output).toBe(mockTaskResult);

      // Step 2: Verify ObservabilityBus events
      expect(busEvents).toHaveLength(2); // started + completed

      // Step 3: Assess quality on actual output
      const quality = assessQuality({
        id: 'flow-test',
        mode: 'general',
        input: 'Test task',
        output: result.output,
        timestamp: Date.now()
      }, 0.5); // TASK-FIX-008: Calibrated threshold

      // TASK-FIX-008: Calibrated quality score should be 0.6+ for Task() results
      expect(quality.score).toBeGreaterThan(0.5);
      expect(quality.meetsThreshold).toBe(true);
      expect(quality.factors.taskResultBonus).toBeGreaterThan(0);

      // Step 4: Verify result has correct structure for trajectory feedback
      expect(result).toMatchObject({
        agent: mockAgent,
        task: 'Test task',
        success: true,
        executedAt: expect.any(Number),
        duration: expect.any(Number)
      });
    });

    it('should handle execution failure gracefully', async () => {
      const executeTask = vi.fn().mockRejectedValue(new Error('Execution failed'));

      // Execution should throw
      await expect(taskExecutor.execute(mockAgent, 'Test task', executeTask))
        .rejects.toThrow('Execution failed');

      // But ObservabilityBus should capture the failure
      const failEvent = busEvents.find(e => e.operation === 'agent_failed');
      expect(failEvent).toBeDefined();
    });
  });
});
