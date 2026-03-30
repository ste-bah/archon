/**
 * Pipeline Test Fixtures
 * ANTI-007: Centralized pipeline test data factories
 *
 * Provides factory functions for creating test pipeline data.
 */

import { vi } from 'vitest';

// ==================== Pipeline Step Fixtures ====================

/**
 * Pipeline step result structure
 */
interface TestPipelineStepResult {
  stepId: string;
  agentType: string;
  status: 'success' | 'failure' | 'skipped';
  output: string;
  durationMs: number;
  timestamp: number;
}

/**
 * Create a test pipeline step result
 */
export function createTestPipelineStepResult(
  overrides?: Partial<TestPipelineStepResult>
): TestPipelineStepResult {
  return {
    stepId: overrides?.stepId ?? `step_${Date.now()}`,
    agentType: overrides?.agentType ?? 'coder',
    status: overrides?.status ?? 'success',
    output: overrides?.output ?? 'Step completed successfully',
    durationMs: overrides?.durationMs ?? 1500,
    timestamp: overrides?.timestamp ?? Date.now(),
  };
}

// ==================== Pipeline Fixtures ====================

/**
 * Pipeline configuration structure
 */
interface TestPipelineConfig {
  id: string;
  name: string;
  steps: Array<{
    agentType: string;
    prompt: string;
    dependsOn?: string[];
  }>;
  createdAt: number;
}

/**
 * Create a test pipeline configuration
 */
export function createTestPipelineConfig(
  overrides?: Partial<TestPipelineConfig>
): TestPipelineConfig {
  return {
    id: overrides?.id ?? `pipeline_${Date.now()}`,
    name: overrides?.name ?? 'Test Pipeline',
    steps: overrides?.steps ?? [
      { agentType: 'researcher', prompt: 'Research the topic' },
      { agentType: 'coder', prompt: 'Implement the feature', dependsOn: ['step_0'] },
      { agentType: 'tester', prompt: 'Write tests', dependsOn: ['step_1'] },
    ],
    createdAt: overrides?.createdAt ?? Date.now(),
  };
}

// ==================== Task Execution Fixtures ====================

/**
 * Task execution function type
 */
type TaskExecutionFunction = (prompt: string, agentType?: string) => Promise<string>;

/**
 * Create a test task execution function
 */
export function createTestTaskExecutor(
  options?: {
    defaultResponse?: string;
    responsesByAgent?: Map<string, string>;
    delayMs?: number;
    shouldFail?: boolean;
    failureError?: Error;
  }
): TaskExecutionFunction {
  const {
    defaultResponse = 'Task completed successfully',
    responsesByAgent = new Map(),
    delayMs = 0,
    shouldFail = false,
    failureError = new Error('Task execution failed'),
  } = options ?? {};

  return vi.fn(async (_prompt: string, agentType?: string): Promise<string> => {
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    if (shouldFail) {
      throw failureError;
    }

    if (agentType && responsesByAgent.has(agentType)) {
      return responsesByAgent.get(agentType)!;
    }

    return defaultResponse;
  });
}

// ==================== Pipeline Result Fixtures ====================

/**
 * Pipeline execution result structure
 */
interface TestPipelineResult {
  pipelineId: string;
  status: 'success' | 'failure' | 'partial';
  steps: TestPipelineStepResult[];
  totalDurationMs: number;
  startedAt: number;
  completedAt: number;
}

/**
 * Create a test pipeline result
 */
export function createTestPipelineResult(
  overrides?: Partial<TestPipelineResult> & {
    stepCount?: number;
    stepOverrides?: Partial<TestPipelineStepResult>;
  }
): TestPipelineResult {
  const { stepCount, stepOverrides, ...rest } = overrides ?? {};

  const now = Date.now();
  const steps =
    rest.steps ??
    (stepCount !== undefined
      ? Array.from({ length: stepCount }, (_, i) =>
          createTestPipelineStepResult({
            ...stepOverrides,
            stepId: `step_${i}`,
            timestamp: now + i * 1000,
          })
        )
      : [createTestPipelineStepResult(stepOverrides)]);

  const totalDuration = steps.reduce((sum, s) => sum + s.durationMs, 0);

  return {
    pipelineId: rest.pipelineId ?? `pipeline_${now}`,
    status: rest.status ?? 'success',
    steps,
    totalDurationMs: rest.totalDurationMs ?? totalDuration,
    startedAt: rest.startedAt ?? now,
    completedAt: rest.completedAt ?? now + totalDuration,
  };
}

// ==================== Pre-built Pipeline Scenarios ====================

/**
 * Pre-built pipeline configurations for common test scenarios
 */
export const TEST_PIPELINES = {
  /**
   * Simple 3-step pipeline
   */
  simple: () =>
    createTestPipelineConfig({
      name: 'Simple Pipeline',
      steps: [
        { agentType: 'researcher', prompt: 'Research' },
        { agentType: 'coder', prompt: 'Implement', dependsOn: ['step_0'] },
        { agentType: 'tester', prompt: 'Test', dependsOn: ['step_1'] },
      ],
    }),

  /**
   * Parallel pipeline (no dependencies)
   */
  parallel: () =>
    createTestPipelineConfig({
      name: 'Parallel Pipeline',
      steps: [
        { agentType: 'researcher', prompt: 'Research A' },
        { agentType: 'researcher', prompt: 'Research B' },
        { agentType: 'researcher', prompt: 'Research C' },
      ],
    }),

  /**
   * Complex pipeline with diamond dependencies
   */
  diamond: () =>
    createTestPipelineConfig({
      name: 'Diamond Pipeline',
      steps: [
        { agentType: 'researcher', prompt: 'Research' },
        { agentType: 'coder', prompt: 'Backend', dependsOn: ['step_0'] },
        { agentType: 'coder', prompt: 'Frontend', dependsOn: ['step_0'] },
        { agentType: 'tester', prompt: 'Integration', dependsOn: ['step_1', 'step_2'] },
      ],
    }),

  /**
   * Single step pipeline
   */
  single: () =>
    createTestPipelineConfig({
      name: 'Single Step',
      steps: [{ agentType: 'coder', prompt: 'Do the thing' }],
    }),
};

/**
 * Pre-built task executors for common scenarios
 */
export const TEST_TASK_EXECUTORS = {
  /**
   * Always succeeds with default response
   */
  success: () => createTestTaskExecutor(),

  /**
   * Always fails
   */
  failing: () =>
    createTestTaskExecutor({
      shouldFail: true,
      failureError: new Error('Task failed'),
    }),

  /**
   * Slow executor (100ms delay)
   */
  slow: () =>
    createTestTaskExecutor({
      delayMs: 100,
    }),

  /**
   * Different responses by agent type
   */
  byAgent: () =>
    createTestTaskExecutor({
      responsesByAgent: new Map([
        ['researcher', 'Research findings...'],
        ['coder', 'Implementation complete...'],
        ['tester', 'All tests pass...'],
        ['reviewer', 'Code review approved...'],
      ]),
    }),
};
