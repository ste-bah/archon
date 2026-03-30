/**
 * DAI-002: Pipeline Error Classes Tests
 * TASK-001: Unit tests for pipeline-errors.ts
 *
 * RULE-002: No Mock Data in Tests
 * - Uses real error scenarios
 * - No mock implementations
 * - Tests with actual error context
 */

import { describe, it, expect } from 'vitest';
import {
  PipelineError,
  PipelineDefinitionError,
  PipelineExecutionError,
  MemoryCoordinationError,
  QualityGateError,
  PipelineTimeoutError,
  AgentSelectionError,
  isPipelineError,
  isPipelineDefinitionError,
  isPipelineExecutionError,
  isMemoryCoordinationError,
  isQualityGateError,
  isPipelineTimeoutError,
  isAgentSelectionError,
  createMissingFieldError,
  createInvalidAgentError,
  wrapAsPipelineExecutionError,
} from '../../../../src/god-agent/core/pipeline/pipeline-errors.js';

// ==================== PipelineDefinitionError Tests ====================

describe('PipelineDefinitionError', () => {
  it('should create error with message only', () => {
    const error = new PipelineDefinitionError('Pipeline name is required');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(PipelineError);
    expect(error).toBeInstanceOf(PipelineDefinitionError);
    expect(error.name).toBe('PipelineDefinitionError');
    expect(error.message).toBe('[PipelineDefinition] Pipeline name is required');
    expect(error.context).toEqual({});
  });

  it('should create error with full context', () => {
    const error = new PipelineDefinitionError('Invalid agent configuration', {
      pipelineName: 'feature-implementation',
      invalidField: 'agents[0].outputDomain',
      details: { received: undefined, expected: 'string' },
    });

    expect(error.message).toContain('Invalid agent configuration');
    expect(error.context.pipelineName).toBe('feature-implementation');
    expect(error.context.invalidField).toBe('agents[0].outputDomain');
    expect(error.context.details).toEqual({ received: undefined, expected: 'string' });
  });

  it('should format detailed string with context', () => {
    const error = new PipelineDefinitionError('Missing required field', {
      pipelineName: 'test-pipeline',
      invalidField: 'name',
    });

    const detailed = error.toDetailedString();
    expect(detailed).toContain('PipelineDefinitionError');
    expect(detailed).toContain('Missing required field');
    expect(detailed).toContain('test-pipeline');
    expect(detailed).toContain('Context:');
    expect(detailed).toContain('Stack:');
  });
});

// ==================== PipelineExecutionError Tests ====================

describe('PipelineExecutionError', () => {
  it('should create error with required context', () => {
    const error = new PipelineExecutionError('Agent returned empty output', {
      pipelineId: 'pip_1702915200000_abc12345',
      pipelineName: 'feature-auth',
      agentKey: 'backend-dev',
      stepIndex: 2,
    });

    expect(error.name).toBe('PipelineExecutionError');
    expect(error.message).toContain('pip_1702915200000_abc12345');
    expect(error.message).toContain('Step 2');
    expect(error.message).toContain('backend-dev');
    expect(error.message).toContain('Agent returned empty output');
    expect(error.context.pipelineId).toBe('pip_1702915200000_abc12345');
    expect(error.context.agentKey).toBe('backend-dev');
    expect(error.completedStepCount).toBe(0);
  });

  it('should include partial results in context', () => {
    const partialResults = [
      {
        stepIndex: 0,
        agentKey: 'planner',
        output: { plan: 'implementation plan' },
        quality: 0.85,
        duration: 5000,
        memoryDomain: 'project/plans',
        memoryTags: ['plan', 'auth'],
        trajectoryId: 'trj_step_0',
      },
      {
        stepIndex: 1,
        agentKey: 'researcher',
        output: { research: 'best practices' },
        quality: 0.9,
        duration: 8000,
        memoryDomain: 'project/research',
        memoryTags: ['research', 'auth'],
        trajectoryId: 'trj_step_1',
      },
    ];

    const error = new PipelineExecutionError('Timeout during execution', {
      pipelineId: 'pip_123',
      pipelineName: 'feature-pipeline',
      agentKey: 'coder',
      stepIndex: 2,
      partialResults,
    });

    expect(error.completedStepCount).toBe(2);
    expect(error.context.partialResults).toHaveLength(2);
    expect(error.context.partialResults![0].agentKey).toBe('planner');
    expect(error.context.partialResults![1].agentKey).toBe('researcher');
  });

  it('should preserve cause chain', () => {
    const originalError = new Error('Database connection lost');
    const error = new PipelineExecutionError('Storage failed', {
      pipelineId: 'pip_456',
      pipelineName: 'test-pipeline',
      agentKey: 'backend-dev',
      stepIndex: 1,
      cause: originalError,
    });

    expect(error.cause).toBe(originalError);
    expect(error.context.cause).toBe(originalError);
    expect((error.cause as Error).message).toBe('Database connection lost');
  });
});

// ==================== MemoryCoordinationError Tests ====================

describe('MemoryCoordinationError', () => {
  it('should create store operation error', () => {
    const error = new MemoryCoordinationError('Failed to store output: disk full', {
      pipelineId: 'pip_789',
      stepIndex: 3,
      domain: 'project/implementations',
      operation: 'store',
    });

    expect(error.name).toBe('MemoryCoordinationError');
    expect(error.message).toContain('Memory store failed');
    expect(error.message).toContain('step 3');
    expect(error.message).toContain('disk full');
    expect(error.context.operation).toBe('store');
    expect(error.context.domain).toBe('project/implementations');
  });

  it('should create retrieve operation error', () => {
    const error = new MemoryCoordinationError('No data found for domain', {
      pipelineId: 'pip_abc',
      stepIndex: 2,
      domain: 'project/specs',
      operation: 'retrieve',
    });

    expect(error.message).toContain('Memory retrieve failed');
    expect(error.context.operation).toBe('retrieve');
  });

  it('should preserve underlying cause', () => {
    const dbError = new Error('Connection timeout');
    const error = new MemoryCoordinationError('Database error', {
      pipelineId: 'pip_def',
      stepIndex: 1,
      domain: 'project/plans',
      operation: 'store',
      cause: dbError,
    });

    expect(error.cause).toBe(dbError);
    expect(error.context.cause).toBe(dbError);
  });
});

// ==================== QualityGateError Tests ====================

describe('QualityGateError', () => {
  it('should create quality gate failure error', () => {
    const error = new QualityGateError({
      pipelineId: 'pip_quality',
      stepIndex: 2,
      agentKey: 'coder',
      actualQuality: 0.45,
      requiredQuality: 0.7,
    });

    expect(error.name).toBe('QualityGateError');
    expect(error.message).toContain('Quality gate failed');
    expect(error.message).toContain('step 2');
    expect(error.message).toContain('coder');
    expect(error.message).toContain('0.45');
    expect(error.message).toContain('0.7');
  });

  it('should calculate quality deficit correctly', () => {
    const error = new QualityGateError({
      pipelineId: 'pip_qg',
      stepIndex: 1,
      agentKey: 'researcher',
      actualQuality: 0.55,
      requiredQuality: 0.8,
    });

    expect(error.qualityDeficit).toBeCloseTo(0.25, 5);
  });

  it('should handle zero quality', () => {
    const error = new QualityGateError({
      pipelineId: 'pip_zero',
      stepIndex: 0,
      agentKey: 'planner',
      actualQuality: 0,
      requiredQuality: 0.7,
    });

    expect(error.context.actualQuality).toBe(0);
    expect(error.qualityDeficit).toBe(0.7);
  });

  it('should format quality values properly in message', () => {
    const error = new QualityGateError({
      pipelineId: 'pip_fmt',
      stepIndex: 1,
      agentKey: 'reviewer',
      actualQuality: 0.333333,
      requiredQuality: 0.5,
    });

    // Should format to 2 decimal places
    expect(error.message).toContain('0.33');
  });
});

// ==================== PipelineTimeoutError Tests ====================

describe('PipelineTimeoutError', () => {
  it('should create step timeout error', () => {
    const error = new PipelineTimeoutError({
      pipelineId: 'pip_timeout',
      stepIndex: 2,
      agentKey: 'researcher',
      timeout: 300000,
      elapsed: 305000,
      scope: 'step',
    });

    expect(error.name).toBe('PipelineTimeoutError');
    expect(error.message).toContain('Step 2');
    expect(error.message).toContain('researcher');
    expect(error.message).toContain('timed out');
    expect(error.message).toContain('305000ms');
    expect(error.message).toContain('300000ms');
    expect(error.context.scope).toBe('step');
  });

  it('should create pipeline timeout error', () => {
    const error = new PipelineTimeoutError({
      pipelineId: 'pip_overall',
      timeout: 1800000,
      elapsed: 1850000,
      scope: 'pipeline',
    });

    expect(error.message).toContain('Pipeline');
    expect(error.message).not.toContain('Step');
    expect(error.context.scope).toBe('pipeline');
    expect(error.context.stepIndex).toBeUndefined();
    expect(error.context.agentKey).toBeUndefined();
  });

  it('should calculate time over limit', () => {
    const error = new PipelineTimeoutError({
      pipelineId: 'pip_over',
      stepIndex: 1,
      agentKey: 'coder',
      timeout: 60000,
      elapsed: 75000,
      scope: 'step',
    });

    expect(error.timeOverLimit).toBe(15000);
  });

  it('should track completed steps before timeout', () => {
    const partialResults = [
      {
        stepIndex: 0,
        agentKey: 'planner',
        output: 'plan output',
        quality: 0.8,
        duration: 10000,
        memoryDomain: 'project/plans',
        memoryTags: ['plan'],
        trajectoryId: 'trj_0',
      },
    ];

    const error = new PipelineTimeoutError({
      pipelineId: 'pip_partial',
      stepIndex: 1,
      agentKey: 'coder',
      timeout: 300000,
      elapsed: 310000,
      scope: 'step',
      partialResults,
    });

    expect(error.completedStepCount).toBe(1);
    expect(error.context.partialResults).toHaveLength(1);
  });
});

// ==================== AgentSelectionError Tests ====================

describe('AgentSelectionError', () => {
  it('should create agent selection error', () => {
    const error = new AgentSelectionError('No suitable agent found', {
      pipelineId: 'pip_sel',
      stepIndex: 1,
      taskDescription: 'Implement quantum computing algorithm',
    });

    expect(error.name).toBe('AgentSelectionError');
    expect(error.message).toContain('Agent selection failed');
    expect(error.message).toContain('step 1');
    expect(error.context.taskDescription).toBe('Implement quantum computing algorithm');
  });

  it('should include searched categories', () => {
    const error = new AgentSelectionError('No matching agent in registry', {
      pipelineId: 'pip_cat',
      stepIndex: 2,
      taskDescription: 'Deploy to production',
      searchedCategories: ['devops', 'coder', 'system-architect'],
    });

    expect(error.context.searchedCategories).toEqual(['devops', 'coder', 'system-architect']);
  });
});

// ==================== Type Guard Tests ====================

describe('Type Guards', () => {
  it('should identify PipelineError instances', () => {
    const defError = new PipelineDefinitionError('test');
    const execError = new PipelineExecutionError('test', {
      pipelineId: 'pip',
      pipelineName: 'test',
      agentKey: 'agent',
      stepIndex: 0,
    });
    const memError = new MemoryCoordinationError('test', {
      pipelineId: 'pip',
      stepIndex: 0,
      operation: 'store',
    });
    const qualityError = new QualityGateError({
      pipelineId: 'pip',
      stepIndex: 0,
      agentKey: 'agent',
      actualQuality: 0.5,
      requiredQuality: 0.7,
    });
    const timeoutError = new PipelineTimeoutError({
      pipelineId: 'pip',
      timeout: 1000,
      elapsed: 2000,
      scope: 'pipeline',
    });
    const selectionError = new AgentSelectionError('test', {
      pipelineId: 'pip',
      stepIndex: 0,
      taskDescription: 'test task',
    });

    // All should be PipelineError
    expect(isPipelineError(defError)).toBe(true);
    expect(isPipelineError(execError)).toBe(true);
    expect(isPipelineError(memError)).toBe(true);
    expect(isPipelineError(qualityError)).toBe(true);
    expect(isPipelineError(timeoutError)).toBe(true);
    expect(isPipelineError(selectionError)).toBe(true);

    // Specific type guards
    expect(isPipelineDefinitionError(defError)).toBe(true);
    expect(isPipelineDefinitionError(execError)).toBe(false);

    expect(isPipelineExecutionError(execError)).toBe(true);
    expect(isPipelineExecutionError(defError)).toBe(false);

    expect(isMemoryCoordinationError(memError)).toBe(true);
    expect(isMemoryCoordinationError(defError)).toBe(false);

    expect(isQualityGateError(qualityError)).toBe(true);
    expect(isQualityGateError(defError)).toBe(false);

    expect(isPipelineTimeoutError(timeoutError)).toBe(true);
    expect(isPipelineTimeoutError(defError)).toBe(false);

    expect(isAgentSelectionError(selectionError)).toBe(true);
    expect(isAgentSelectionError(defError)).toBe(false);

    // Non-pipeline errors
    expect(isPipelineError(new Error('regular error'))).toBe(false);
    expect(isPipelineError(null)).toBe(false);
    expect(isPipelineError(undefined)).toBe(false);
    expect(isPipelineError('string error')).toBe(false);
  });
});

// ==================== Factory Function Tests ====================

describe('Error Factory Functions', () => {
  describe('createMissingFieldError', () => {
    it('should create error for missing pipeline name', () => {
      const error = createMissingFieldError('my-pipeline', 'name');

      expect(error).toBeInstanceOf(PipelineDefinitionError);
      expect(error.message).toContain("'name'");
      expect(error.message).toContain('missing or empty');
      expect(error.context.pipelineName).toBe('my-pipeline');
      expect(error.context.invalidField).toBe('name');
    });

    it('should create error for missing agents', () => {
      const error = createMissingFieldError('feature-pipeline', 'agents');

      expect(error.context.invalidField).toBe('agents');
    });
  });

  describe('createInvalidAgentError', () => {
    it('should create error for invalid agent configuration', () => {
      const error = createInvalidAgentError(
        'test-pipeline',
        2,
        'outputDomain is required'
      );

      expect(error).toBeInstanceOf(PipelineDefinitionError);
      expect(error.message).toContain('Step 2');
      expect(error.message).toContain('outputDomain is required');
      expect(error.context.pipelineName).toBe('test-pipeline');
      expect(error.context.invalidField).toBe('agents[2]');
    });
  });

  describe('wrapAsPipelineExecutionError', () => {
    it('should wrap Error instance', () => {
      const original = new Error('Connection failed');
      const wrapped = wrapAsPipelineExecutionError(original, {
        pipelineId: 'pip_wrap',
        pipelineName: 'test',
        agentKey: 'backend-dev',
        stepIndex: 1,
      });

      expect(wrapped).toBeInstanceOf(PipelineExecutionError);
      expect(wrapped.message).toContain('Connection failed');
      expect(wrapped.context.cause).toBe(original);
    });

    it('should wrap string error', () => {
      const wrapped = wrapAsPipelineExecutionError('Something went wrong', {
        pipelineId: 'pip_str',
        pipelineName: 'test',
        agentKey: 'coder',
        stepIndex: 0,
      });

      expect(wrapped.message).toContain('Something went wrong');
      expect(wrapped.context.cause).toBeInstanceOf(Error);
      expect(wrapped.context.cause!.message).toBe('Something went wrong');
    });

    it('should wrap unknown error type', () => {
      const wrapped = wrapAsPipelineExecutionError({ code: 500 }, {
        pipelineId: 'pip_obj',
        pipelineName: 'test',
        agentKey: 'analyst',
        stepIndex: 2,
      });

      expect(wrapped.message).toContain('[object Object]');
    });
  });
});

// ==================== Inheritance Chain Tests ====================

describe('Error Inheritance', () => {
  it('should have correct prototype chain', () => {
    const error = new PipelineDefinitionError('test');

    expect(error instanceof PipelineDefinitionError).toBe(true);
    expect(error instanceof PipelineError).toBe(true);
    expect(error instanceof Error).toBe(true);
    expect(Object.getPrototypeOf(error).constructor).toBe(PipelineDefinitionError);
  });

  it('should work with try/catch', () => {
    try {
      throw new QualityGateError({
        pipelineId: 'pip_catch',
        stepIndex: 1,
        agentKey: 'reviewer',
        actualQuality: 0.3,
        requiredQuality: 0.7,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(QualityGateError);
      expect(error).toBeInstanceOf(PipelineError);
      if (isQualityGateError(error)) {
        expect(error.qualityDeficit).toBeCloseTo(0.4, 5);
      }
    }
  });
});
