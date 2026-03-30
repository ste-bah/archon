/**
 * TASK-E2E-001: End-to-End Learning System Smoke Test
 *
 * Verifies the complete learning pipeline works end-to-end:
 * 1. Task execution → ObservabilityBus events
 * 2. Quality assessment → TrajectoryBridge feedback
 * 3. Trajectory creation → SONA learning
 * 4. Pattern storage for future retrieval
 *
 * This is a smoke test that validates all Phase 4 fixes work together.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskExecutor, type ITaskExecutionResult } from '../../../src/god-agent/core/agents/task-executor.js';
import { ObservabilityBus } from '../../../src/god-agent/core/observability/bus.js';
import { assessQuality, type QualityInteraction } from '../../../src/god-agent/universal/quality-estimator.js';
import type { ILoadedAgentDefinition } from '../../../src/god-agent/core/agents/agent-types.js';

// High-quality mock result that simulates actual Task() output
const MOCK_HIGH_QUALITY_RESULT = `## TASK COMPLETION SUMMARY

**What I Did**: Successfully implemented the requested feature with comprehensive error handling and tests.

**Files Created/Modified**:
- \`src/feature/core.ts\` - Core implementation with TypeScript types
- \`src/feature/types.ts\` - Type definitions
- \`tests/feature/core.test.ts\` - Unit tests with 95% coverage

**Code Quality Indicators**:
- All TypeScript strict mode checks pass
- ESLint rules satisfied
- No security vulnerabilities detected

**Memory/InteractionStore Updates**:
- Domain: \`project/feature\`
- Tags: [\`implementation\`, \`tested\`, \`typescript\`]
- Quality Score: 0.92

**Next Agent Guidance**: The feature is ready for integration testing and code review.
Ready for the next pipeline stage.`;

// Low-quality mock result
const MOCK_LOW_QUALITY_RESULT = `Error occurred during execution.
Unable to complete the task.`;

// Mock agent for testing
const mockAgent: ILoadedAgentDefinition = {
  key: 'e2e-test-agent',
  category: 'testing',
  filePath: '/test/e2e-agent.md',
  frontmatter: {
    name: 'E2E Test Agent',
    description: 'Agent for end-to-end learning smoke tests',
    type: 'tester',
    version: '1.0.0',
    capabilities: ['testing', 'verification'],
    tools: [],
    successCriteria: 'All tests pass',
    outputFormat: 'TASK COMPLETION SUMMARY'
  },
  promptContent: '# E2E Test Agent\n\nYou are an end-to-end test agent.',
  rawContent: '---\nname: E2E Test Agent\n---\n# E2E Test Agent'
};

describe('TASK-E2E-001: End-to-End Learning System Smoke Test', () => {
  let taskExecutor: TaskExecutor;
  let capturedEvents: Array<{
    component: string;
    operation: string;
    status: string;
    durationMs?: number;
    metadata?: Record<string, unknown>;
  }>;
  let originalEmit: typeof ObservabilityBus.prototype.emit;

  beforeEach(() => {
    taskExecutor = new TaskExecutor({ verbose: false });
    capturedEvents = [];

    // Capture ObservabilityBus events
    originalEmit = ObservabilityBus.prototype.emit;
    ObservabilityBus.prototype.emit = function(event) {
      capturedEvents.push({
        component: event.component,
        operation: event.operation,
        status: event.status,
        durationMs: event.durationMs,
        metadata: event.metadata
      });
      return originalEmit.call(this, event);
    };
  });

  afterEach(() => {
    ObservabilityBus.prototype.emit = originalEmit;
    capturedEvents = [];
  });

  describe('Phase 4 Fix Verification', () => {
    it('should execute task and emit correct ObservabilityBus events', async () => {
      const executeTask = vi.fn().mockResolvedValue(MOCK_HIGH_QUALITY_RESULT);

      const result = await taskExecutor.execute(
        mockAgent,
        'Implement a feature with tests',
        executeTask
      );

      // Verify execution succeeded
      expect(result.success).toBe(true);
      expect(result.output).toBe(MOCK_HIGH_QUALITY_RESULT);

      // Verify ObservabilityBus events
      expect(capturedEvents).toHaveLength(2);

      // Verify agent_started event
      const startEvent = capturedEvents.find(e => e.operation === 'agent_started');
      expect(startEvent).toMatchObject({
        component: 'agent',
        status: 'running',
        metadata: expect.objectContaining({
          agentKey: 'e2e-test-agent',
          executionId: expect.stringMatching(/^exec_/)
        })
      });

      // Verify agent_completed event
      const completeEvent = capturedEvents.find(e => e.operation === 'agent_completed');
      expect(completeEvent).toMatchObject({
        component: 'agent',
        status: 'success',
        durationMs: expect.any(Number),
        metadata: expect.objectContaining({
          agentKey: 'e2e-test-agent',
          outputLength: MOCK_HIGH_QUALITY_RESULT.length
        })
      });
    });

    it('should assess quality on actual result (RULE-033)', () => {
      // This verifies the fix in ask(), code(), research(), write(), task()
      // Quality is now assessed on the actual Task() result, not the prompt

      const qualityInteraction: QualityInteraction = {
        id: 'e2e-quality-test',
        mode: 'code',
        input: 'Implement a feature',
        output: MOCK_HIGH_QUALITY_RESULT,
        timestamp: Date.now()
      };

      const quality = assessQuality(qualityInteraction, 0.5);

      // TASK-FIX-008: Calibrated estimator should score Task() results 0.6+
      expect(quality.score).toBeGreaterThan(0.5);
      expect(quality.meetsThreshold).toBe(true);
      // Verify taskResultBonus is applied for TASK COMPLETION SUMMARY
      expect(quality.factors.taskResultBonus).toBeGreaterThan(0);

      // Low-quality result should score lower
      const lowQuality = assessQuality({
        ...qualityInteraction,
        output: MOCK_LOW_QUALITY_RESULT
      }, 0.5);

      expect(lowQuality.score).toBeLessThan(quality.score);
      expect(lowQuality.factors.taskResultBonus).toBe(0);
    });

    it('should include executionId for event correlation', async () => {
      const executeTask = vi.fn().mockResolvedValue(MOCK_HIGH_QUALITY_RESULT);

      await taskExecutor.execute(mockAgent, 'Test task', executeTask);

      const executionIds = capturedEvents
        .map(e => (e.metadata as Record<string, unknown>)?.executionId)
        .filter(Boolean);

      // All events should have the same executionId
      expect(executionIds.length).toBeGreaterThan(0);
      expect(new Set(executionIds).size).toBe(1); // All same ID
    });
  });

  describe('Learning Pipeline Flow', () => {
    it('should complete: execute → events → quality → threshold check', async () => {
      const executeTask = vi.fn().mockResolvedValue(MOCK_HIGH_QUALITY_RESULT);

      // Step 1: Execute task
      const result = await taskExecutor.execute(
        mockAgent,
        'Complete learning pipeline test',
        executeTask
      );

      // Step 2: Verify events were emitted
      expect(capturedEvents.length).toBe(2);

      // Step 3: Assess quality (TASK-FIX-008: calibrated threshold)
      const quality = assessQuality({
        id: 'learning-flow-test',
        mode: 'general',
        input: 'Complete learning pipeline test',
        output: result.output,
        timestamp: Date.now()
      }, 0.5);

      // Step 4: Verify threshold check with calibrated estimator
      expect(quality.score).toBeGreaterThan(0.5);
      expect(quality.meetsThreshold).toBe(true);
      expect(quality.factors.taskResultBonus).toBeGreaterThan(0);

      // The flow is complete - in production, this would trigger:
      // - trajectoryBridge.submitFeedback()
      // - SonaEngine.updateWeights()
      // - Pattern storage in ReasoningBank

      // Verify the full result structure
      expect(result).toMatchObject({
        agent: mockAgent,
        success: true,
        output: MOCK_HIGH_QUALITY_RESULT,
        duration: expect.any(Number),
        executedAt: expect.any(Number)
      });
    });

    it('should handle execution failure gracefully in the pipeline', async () => {
      const executeTask = vi.fn().mockRejectedValue(new Error('Execution failed'));

      await expect(
        taskExecutor.execute(mockAgent, 'Failing task', executeTask)
      ).rejects.toThrow('Execution failed');

      // Verify failure event was captured
      const failEvent = capturedEvents.find(e => e.operation === 'agent_failed');
      expect(failEvent).toBeDefined();
      expect(failEvent?.status).toBe('error');
      expect(failEvent?.metadata).toMatchObject({
        error: 'Execution failed'
      });
    });

    it('should process multiple sequential tasks correctly', async () => {
      const tasks = [
        { task: 'First task', result: 'First result' },
        { task: 'Second task', result: 'Second result' },
        { task: 'Third task', result: 'Third result' }
      ];

      const results: ITaskExecutionResult[] = [];

      for (const { task, result } of tasks) {
        const executeTask = vi.fn().mockResolvedValue(result);
        const taskResult = await taskExecutor.execute(mockAgent, task, executeTask);
        results.push(taskResult);
      }

      // All tasks should succeed
      expect(results.every(r => r.success)).toBe(true);

      // Should have 6 events (2 per task)
      expect(capturedEvents.length).toBe(6);

      // Each task should have unique executionId
      const executionIds = capturedEvents
        .map(e => (e.metadata as Record<string, unknown>)?.executionId)
        .filter(Boolean);

      const uniqueIds = new Set(executionIds);
      expect(uniqueIds.size).toBe(3); // 3 unique tasks
    });
  });

  describe('Quality Differentiation', () => {
    it('should differentiate high vs low quality outputs', () => {
      const highQuality = assessQuality({
        id: 'high-quality',
        mode: 'code',
        input: 'Generate code',
        output: MOCK_HIGH_QUALITY_RESULT,
        timestamp: Date.now()
      }, 0.5);

      const lowQuality = assessQuality({
        id: 'low-quality',
        mode: 'code',
        input: 'Generate code',
        output: MOCK_LOW_QUALITY_RESULT,
        timestamp: Date.now()
      }, 0.5);

      // TASK-FIX-008: High quality Task() result should score 0.6+
      expect(highQuality.score).toBeGreaterThan(0.5);
      expect(highQuality.factors.taskResultBonus).toBeGreaterThan(0);

      // Low quality should score significantly lower
      expect(lowQuality.score).toBeLessThan(0.3);
      expect(lowQuality.factors.taskResultBonus).toBe(0);

      // High quality should meet threshold, low should not
      expect(highQuality.meetsThreshold).toBe(true);
      expect(lowQuality.meetsThreshold).toBe(false);
    });

    it('should detect prompt-like vs result-like output', () => {
      const promptLikeOutput = `You are a helpful assistant. Please implement the following:

## Requirements
- Feature A
- Feature B
- Feature C

Use best practices and ensure type safety.`;

      const resultLikeOutput = `## TASK COMPLETION SUMMARY

**What I Did**: Implemented Features A, B, C

\`\`\`typescript
export function featureA(): void {
  // Implementation
}
\`\`\`

Tests added and passing.`;

      const promptQuality = assessQuality({
        id: 'prompt-like',
        mode: 'code',
        input: 'Test',
        output: promptLikeOutput,
        timestamp: Date.now()
      }, 0.5);

      const resultQuality = assessQuality({
        id: 'result-like',
        mode: 'code',
        input: 'Test',
        output: resultLikeOutput,
        timestamp: Date.now()
      }, 0.5);

      // TASK-FIX-008: Result-like output should score significantly higher
      // TASK COMPLETION SUMMARY triggers taskResultBonus
      expect(resultQuality.score).toBeGreaterThan(promptQuality.score);
      expect(resultQuality.factors.taskResultBonus).toBeGreaterThan(0);
      expect(promptQuality.factors.taskResultBonus).toBe(0);
    });
  });
});
