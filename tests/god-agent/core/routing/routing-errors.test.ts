/**
 * DAI-003: Routing Error Classes Tests
 *
 * TASK-002: Routing Error Classes
 * Tests verify error construction, context preservation, and cause chain
 *
 * All tests use REAL data (NO MOCKS per user requirement)
 */

import { describe, it, expect } from 'vitest';
import {
  RoutingError,
  TaskAnalysisError,
  CapabilityIndexError,
  RoutingDecisionError,
  LowConfidenceError,
  PipelineGenerationError,
  RoutingLearningError,
  IndexSyncError,
} from '../../../../src/god-agent/core/routing/routing-errors';

describe('RoutingError', () => {
  it('should create base routing error with message prefix', () => {
    const error = new RoutingError('Test error');

    expect(error.message).toBe('[Routing] Test error');
    expect(error.name).toBe('RoutingError');
    expect(error.timestamp).toBeGreaterThan(0);
    expect(error).toBeInstanceOf(Error);
  });

  it('should preserve full context', () => {
    const context = {
      taskId: 'task-123',
      agentKey: 'researcher',
      confidence: 0.85,
    };

    const error = new RoutingError('Context test', context);

    expect(error.taskId).toBe('task-123');
    expect(error.agentKey).toBe('researcher');
    expect(error.confidence).toBe(0.85);
  });

  it('should preserve cause chain', () => {
    const originalError = new Error('Original error');
    const routingError = new RoutingError('Wrapped error', undefined, originalError);

    expect(routingError.cause).toBe(originalError);
    expect((routingError.cause as Error).message).toBe('Original error');
  });

  it('should maintain stack trace', () => {
    const error = new RoutingError('Stack trace test');

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('RoutingError');
  });
});

describe('TaskAnalysisError', () => {
  it('should create task analysis error with task and phase', () => {
    const error = new TaskAnalysisError(
      'Embedding generation failed',
      'Research machine learning techniques',
      'embedding',
      { taskId: 'task-456' }
    );

    expect(error.message).toBe('[Routing] Embedding generation failed');
    expect(error.name).toBe('TaskAnalysisError');
    expect(error.task).toBe('Research machine learning techniques');
    expect(error.phase).toBe('embedding');
    expect(error.taskId).toBe('task-456');
  });

  it('should handle domain-detection phase failure', () => {
    const error = new TaskAnalysisError(
      'Cannot detect domain for task',
      'Do something vague',
      'domain-detection'
    );

    expect(error.phase).toBe('domain-detection');
    expect(error.task).toBe('Do something vague');
  });

  it('should handle complexity-assessment phase failure', () => {
    const error = new TaskAnalysisError(
      'Verb count mismatch',
      'Write tests and deploy and monitor and analyze',
      'complexity-assessment'
    );

    expect(error.phase).toBe('complexity-assessment');
    expect(error.task).toContain('Write tests');
  });

  it('should preserve cause in analysis error', () => {
    const embeddingError = new Error('CUDA out of memory');
    const error = new TaskAnalysisError(
      'Embedding failed',
      'Analyze large dataset',
      'embedding',
      undefined,
      embeddingError
    );

    expect(error.cause).toBe(embeddingError);
    expect((error.cause as Error).message).toBe('CUDA out of memory');
  });
});

describe('CapabilityIndexError', () => {
  it('should create capability index error with operation', () => {
    const error = new CapabilityIndexError(
      'Failed to initialize index',
      'initialize',
      0,
      { taskId: 'task-789' }
    );

    expect(error.message).toBe('[Routing] Failed to initialize index');
    expect(error.name).toBe('CapabilityIndexError');
    expect(error.operation).toBe('initialize');
    expect(error.agentCount).toBe(0);
  });

  it('should track agent count during rebuild', () => {
    const error = new CapabilityIndexError(
      'Index rebuild incomplete',
      'rebuild',
      150
    );

    expect(error.operation).toBe('rebuild');
    expect(error.agentCount).toBe(150);
  });

  it('should handle search operation failure', () => {
    const error = new CapabilityIndexError(
      'Search returned no results',
      'search',
      200,
      { agentKey: 'researcher', confidence: 0.3 }
    );

    expect(error.operation).toBe('search');
    expect(error.agentCount).toBe(200);
    expect(error.agentKey).toBe('researcher');
    expect(error.confidence).toBe(0.3);
  });
});

describe('RoutingDecisionError', () => {
  it('should create routing decision error with stage', () => {
    const error = new RoutingDecisionError(
      'No agents match task domain',
      'agent-scoring',
      5,
      { taskId: 'task-101' }
    );

    expect(error.message).toBe('[Routing] No agents match task domain');
    expect(error.name).toBe('RoutingDecisionError');
    expect(error.stage).toBe('agent-scoring');
    expect(error.candidateCount).toBe(5);
  });

  it('should handle explanation generation failure', () => {
    const error = new RoutingDecisionError(
      'Cannot generate explanation with zero factors',
      'explanation-generation',
      0
    );

    expect(error.stage).toBe('explanation-generation');
    expect(error.candidateCount).toBe(0);
  });

  it('should track candidate count', () => {
    const error = new RoutingDecisionError(
      'Factor calculation overflow',
      'factor-calculation',
      50,
      { agentKey: 'coder', confidence: 0.92 }
    );

    expect(error.candidateCount).toBe(50);
    expect(error.agentKey).toBe('coder');
  });
});

describe('LowConfidenceError', () => {
  it('should create low confidence error with threshold', () => {
    const alternatives = [
      { agentKey: 'researcher', score: 0.65 },
      { agentKey: 'coder', score: 0.60 },
      { agentKey: 'tester', score: 0.55 },
    ];

    const error = new LowConfidenceError(
      'Routing confidence below threshold, confirmation required',
      0.65,
      0.7,
      'researcher',
      alternatives,
      { taskId: 'task-202' }
    );

    expect(error.message).toBe('[Routing] Routing confidence below threshold, confirmation required');
    expect(error.name).toBe('LowConfidenceError');
    expect(error.actualConfidence).toBe(0.65);
    expect(error.threshold).toBe(0.7);
    expect(error.selectedAgent).toBe('researcher');
    expect(error.alternatives).toHaveLength(3);
  });

  it('should preserve confidence in context', () => {
    const error = new LowConfidenceError(
      'Low confidence',
      0.48,
      0.5,
      'backend-dev',
      []
    );

    expect(error.confidence).toBe(0.48);
    expect(error.actualConfidence).toBe(0.48);
    expect(error.agentKey).toBe('backend-dev');
    expect(error.selectedAgent).toBe('backend-dev');
  });

  it('should include alternatives array', () => {
    const alternatives = [
      { agentKey: 'agent-1', score: 0.6 },
      { agentKey: 'agent-2', score: 0.58 },
    ];

    const error = new LowConfidenceError(
      'Multiple candidates with similar scores',
      0.6,
      0.7,
      'agent-1',
      alternatives
    );

    expect(error.alternatives).toEqual(alternatives);
    expect(error.alternatives[0].agentKey).toBe('agent-1');
    expect(error.alternatives[1].score).toBe(0.58);
  });
});

describe('PipelineGenerationError', () => {
  it('should create pipeline generation error with stage', () => {
    const error = new PipelineGenerationError(
      'Failed to segment multi-step task',
      'Research ML then write tests then deploy',
      'segmentation',
      0,
      3,
      { taskId: 'task-303' }
    );

    expect(error.message).toBe('[Routing] Failed to segment multi-step task');
    expect(error.name).toBe('PipelineGenerationError');
    expect(error.task).toBe('Research ML then write tests then deploy');
    expect(error.stage).toBe('segmentation');
    expect(error.completedStages).toBe(0);
    expect(error.totalStages).toBe(3);
  });

  it('should track partial completion', () => {
    const error = new PipelineGenerationError(
      'Routing failed for stage 3',
      'Analyze data then generate report then publish',
      'routing',
      2,
      3
    );

    expect(error.completedStages).toBe(2);
    expect(error.totalStages).toBe(3);
    expect(error.stage).toBe('routing');
  });

  it('should handle validation failure', () => {
    const error = new PipelineGenerationError(
      'Pipeline definition validation failed',
      'Build feature then test',
      'validation',
      2,
      2,
      { agentKey: 'system-architect', confidence: 0.9 }
    );

    expect(error.stage).toBe('validation');
    expect(error.completedStages).toBe(2);
    expect(error.totalStages).toBe(2);
  });
});

describe('RoutingLearningError', () => {
  it('should create routing learning error with operation', () => {
    const error = new RoutingLearningError(
      'Failed to process feedback',
      'feedback-processing',
      150,
      'route-abc-123',
      { taskId: 'task-404', agentKey: 'researcher', confidence: 0.85 }
    );

    expect(error.message).toBe('[Routing] Failed to process feedback');
    expect(error.name).toBe('RoutingLearningError');
    expect(error.operation).toBe('feedback-processing');
    expect(error.executionCount).toBe(150);
    expect(error.routingId).toBe('route-abc-123');
  });

  it('should track execution count for weight updates', () => {
    const error = new RoutingLearningError(
      'Weight update violated EWC++ constraint',
      'weight-update',
      200
    );

    expect(error.operation).toBe('weight-update');
    expect(error.executionCount).toBe(200);
  });

  it('should handle accuracy tracking failure', () => {
    const error = new RoutingLearningError(
      'Accuracy degradation detected',
      'accuracy-tracking',
      500,
      undefined,
      { confidence: 0.68 }
    );

    expect(error.operation).toBe('accuracy-tracking');
    expect(error.executionCount).toBe(500);
    expect(error.confidence).toBe(0.68);
  });

  it('should handle rollback operation', () => {
    const error = new RoutingLearningError(
      'Rollback to previous checkpoint failed',
      'rollback',
      120,
      'route-rollback-1'
    );

    expect(error.operation).toBe('rollback');
    expect(error.routingId).toBe('route-rollback-1');
  });
});

describe('IndexSyncError', () => {
  it('should create index sync error with sync operation', () => {
    const lastSyncTime = Date.now() - 1000 * 60 * 60; // 1 hour ago

    const error = new IndexSyncError(
      'Failed to load agents from registry',
      'registry-load',
      lastSyncTime,
      { taskId: 'task-505' }
    );

    expect(error.message).toBe('[Routing] Failed to load agents from registry');
    expect(error.name).toBe('IndexSyncError');
    expect(error.syncOperation).toBe('registry-load');
    expect(error.lastSyncTime).toBe(lastSyncTime);
    expect(error.timeSinceSync).toBeGreaterThan(0);
    expect(error.isStale).toBe(false);
  });

  it('should detect stale index (> 24h)', () => {
    const lastSyncTime = Date.now() - 1000 * 60 * 60 * 25; // 25 hours ago

    const error = new IndexSyncError(
      'Index is stale, requires rebuild',
      'freshness-check',
      lastSyncTime
    );

    expect(error.isStale).toBe(true);
    expect(error.timeSinceSync).toBeGreaterThan(24 * 60 * 60 * 1000);
  });

  it('should detect fresh index (< 24h)', () => {
    const lastSyncTime = Date.now() - 1000 * 60 * 60 * 2; // 2 hours ago

    const error = new IndexSyncError(
      'Sync operation failed',
      'agent-added',
      lastSyncTime,
      { agentKey: 'new-agent' }
    );

    expect(error.isStale).toBe(false);
    expect(error.timeSinceSync).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it('should handle agent removal sync failure', () => {
    const error = new IndexSyncError(
      'Failed to remove agent from index',
      'agent-removed',
      Date.now() - 1000,
      { agentKey: 'removed-agent' }
    );

    expect(error.syncOperation).toBe('agent-removed');
    expect(error.agentKey).toBe('removed-agent');
  });
});

describe('Error inheritance and cause chain', () => {
  it('should verify all errors extend RoutingError', () => {
    const taskAnalysisError = new TaskAnalysisError('test', 'task', 'embedding');
    const capabilityIndexError = new CapabilityIndexError('test', 'initialize', 0);
    const routingDecisionError = new RoutingDecisionError('test', 'agent-scoring', 5);
    const lowConfidenceError = new LowConfidenceError('test', 0.5, 0.7, 'agent', []);
    const pipelineGenerationError = new PipelineGenerationError('test', 'task', 'segmentation', 0, 3);
    const routingLearningError = new RoutingLearningError('test', 'feedback-processing', 100);
    const indexSyncError = new IndexSyncError('test', 'registry-load', Date.now());

    expect(taskAnalysisError).toBeInstanceOf(RoutingError);
    expect(capabilityIndexError).toBeInstanceOf(RoutingError);
    expect(routingDecisionError).toBeInstanceOf(RoutingError);
    expect(lowConfidenceError).toBeInstanceOf(RoutingError);
    expect(pipelineGenerationError).toBeInstanceOf(RoutingError);
    expect(routingLearningError).toBeInstanceOf(RoutingError);
    expect(indexSyncError).toBeInstanceOf(RoutingError);
  });

  it('should preserve multi-level cause chain', () => {
    const level1Error = new Error('Database connection failed');
    const level2Error = new CapabilityIndexError('Index load failed', 'initialize', 0, undefined, level1Error);
    const level3Error = new RoutingError('System initialization failed', undefined, level2Error);

    expect(level3Error.cause).toBe(level2Error);
    expect((level3Error.cause as CapabilityIndexError).cause).toBe(level1Error);
    expect(((level3Error.cause as CapabilityIndexError).cause as Error).message).toBe('Database connection failed');
  });

  it('should maintain error context through chain', () => {
    const originalError = new Error('Network timeout');
    const indexError = new CapabilityIndexError(
      'Search timeout',
      'search',
      200,
      { taskId: 'task-999', agentKey: 'researcher', confidence: 0.75 },
      originalError
    );

    expect(indexError.taskId).toBe('task-999');
    expect(indexError.agentKey).toBe('researcher');
    expect(indexError.confidence).toBe(0.75);
    expect(indexError.cause).toBe(originalError);
  });
});

describe('Error message formatting', () => {
  it('should verify all errors have [Routing] prefix', () => {
    const errors = [
      new RoutingError('Base error'),
      new TaskAnalysisError('Analysis error', 'task', 'embedding'),
      new CapabilityIndexError('Index error', 'initialize', 0),
      new RoutingDecisionError('Decision error', 'agent-scoring', 5),
      new LowConfidenceError('Low confidence', 0.5, 0.7, 'agent', []),
      new PipelineGenerationError('Pipeline error', 'task', 'segmentation', 0, 3),
      new RoutingLearningError('Learning error', 'feedback-processing', 100),
      new IndexSyncError('Sync error', 'registry-load', Date.now()),
    ];

    errors.forEach(error => {
      expect(error.message).toMatch(/^\[Routing\] /);
    });
  });

  it('should preserve original message after prefix', () => {
    const originalMessage = 'Failed to generate task embedding due to missing model';
    const error = new TaskAnalysisError(originalMessage, 'task', 'embedding');

    expect(error.message).toBe(`[Routing] ${originalMessage}`);
  });
});
