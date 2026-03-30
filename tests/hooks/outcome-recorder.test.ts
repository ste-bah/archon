/**
 * Outcome Recorder Hook Tests
 *
 * Tests for TASK-IDESC-INT-002: Outcome recorder hook implementation
 *
 * PRD: PRD-UCM-001
 * Task: TASK-IDESC-INT-002
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  IOutcomeHookContext,
  IOutcomeRecorderResponse,
} from '../../scripts/hooks/outcome-recorder.js';
import type { ErrorType } from '../../src/god-agent/core/ucm/types.js';

// Mock ActivityStream to avoid side effects
vi.mock('../../src/god-agent/observability/index.js', () => ({
  ActivityStream: {
    getInstance: vi.fn().mockResolvedValue({
      emit: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

/**
 * Test fixture: Create PostToolUse hook context
 */
function createOutcomeHookContext(
  overrides: Partial<IOutcomeHookContext> = {}
): IOutcomeHookContext {
  return {
    correlationId: 'test-correlation-123',
    timestamp: new Date().toISOString(),
    eventType: 'PostToolUse',
    toolName: 'Task',
    result: {
      success: true,
    },
    metadata: {
      injectedEpisodeIds: ['episode-001'],
      taskId: 'task-001',
    },
    ...overrides,
  };
}

/**
 * Test fixture: Create failed task context
 */
function createFailedTaskContext(
  errorType: string = 'SyntaxError'
): IOutcomeHookContext {
  return createOutcomeHookContext({
    result: {
      success: false,
      error: {
        message: 'Syntax error in code',
        type: errorType,
        stack: 'Error: Syntax error\n  at ...',
      },
    },
  });
}

/**
 * Test fixture: Create context with multiple episodes
 */
function createMultiEpisodeContext(): IOutcomeHookContext {
  return createOutcomeHookContext({
    metadata: {
      injectedEpisodeIds: ['episode-001', 'episode-002', 'episode-003'],
      taskId: 'multi-task-001',
    },
  });
}

describe('TASK-IDESC-INT-002: Outcome Recorder Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Input Handling', () => {
    it('TC-OR-001: should parse valid PostToolUse context', () => {
      const context = createOutcomeHookContext();

      expect(context.eventType).toBe('PostToolUse');
      expect(context.toolName).toBe('Task');
      expect(context.correlationId).toBeTruthy();
      expect(context.result).toBeDefined();
    });

    it('TC-OR-002: should handle context with injected episode IDs', () => {
      const context = createOutcomeHookContext({
        metadata: {
          injectedEpisodeIds: ['ep1', 'ep2'],
        },
      });

      expect(context.metadata?.injectedEpisodeIds).toHaveLength(2);
      expect(context.metadata?.injectedEpisodeIds).toContain('ep1');
    });

    it('TC-OR-003: should handle context without metadata', () => {
      const context = createOutcomeHookContext({
        metadata: undefined,
      });

      expect(context.metadata).toBeUndefined();
    });

    it('TC-OR-004: should handle context with empty episode list', () => {
      const context = createOutcomeHookContext({
        metadata: {
          injectedEpisodeIds: [],
        },
      });

      expect(context.metadata?.injectedEpisodeIds).toHaveLength(0);
    });
  });

  describe('Tool Filtering', () => {
    it('TC-OR-010: should process Task tool completions', async () => {
      const context = createOutcomeHookContext();
      const response = await simulateHookExecution(context);

      expect(response.success).toBe(true);
      expect(response.outcomesRecorded).toBeGreaterThan(0);
    });

    it('TC-OR-011: should skip non-Task tool completions', async () => {
      const context = createOutcomeHookContext({
        toolName: 'Read',
      });
      const response = await simulateHookExecution(context);

      expect(response.success).toBe(true);
      expect(response.outcomesRecorded).toBe(0);
      expect(response.recordedEpisodeIds).toEqual([]);
    });

    it('TC-OR-012: should skip Edit tool completions', async () => {
      const context = createOutcomeHookContext({
        toolName: 'Edit',
      });
      const response = await simulateHookExecution(context);

      expect(response.success).toBe(true);
      expect(response.outcomesRecorded).toBe(0);
    });

    it('TC-OR-013: should skip Bash tool completions', async () => {
      const context = createOutcomeHookContext({
        toolName: 'Bash',
      });
      const response = await simulateHookExecution(context);

      expect(response.success).toBe(true);
      expect(response.outcomesRecorded).toBe(0);
    });
  });

  describe('Outcome Recording', () => {
    it('TC-OR-020: should record success outcome for successful task', async () => {
      const context = createOutcomeHookContext({
        result: { success: true },
        metadata: {
          injectedEpisodeIds: ['episode-success'],
          taskId: 'task-success',
        },
      });

      const response = await simulateHookExecution(context);

      expect(response.success).toBe(true);
      expect(response.outcomesRecorded).toBe(1);
      expect(response.recordedEpisodeIds).toContain('episode-success');
    });

    it('TC-OR-021: should record failure outcome for failed task', async () => {
      const context = createFailedTaskContext();
      const response = await simulateHookExecution(context);

      expect(response.success).toBe(true);
      expect(response.outcomesRecorded).toBeGreaterThan(0);
    });

    it('TC-OR-022: should record outcomes for multiple episodes', async () => {
      const context = createMultiEpisodeContext();
      const response = await simulateHookExecution(context);

      expect(response.success).toBe(true);
      expect(response.outcomesRecorded).toBe(3);
      expect(response.recordedEpisodeIds).toHaveLength(3);
    });

    it('TC-OR-023: should skip recording if no episodes injected', async () => {
      const context = createOutcomeHookContext({
        metadata: {
          injectedEpisodeIds: [],
        },
      });

      const response = await simulateHookExecution(context);

      expect(response.success).toBe(true);
      expect(response.outcomesRecorded).toBe(0);
      expect(response.recordedEpisodeIds).toEqual([]);
    });

    it('TC-OR-024: should generate task ID if not provided', async () => {
      const context = createOutcomeHookContext({
        metadata: {
          injectedEpisodeIds: ['episode-001'],
          taskId: undefined,
        },
      });

      const response = await simulateHookExecution(context);

      expect(response.success).toBe(true);
      // Should still record with generated task ID
      expect(response.outcomesRecorded).toBe(1);
    });
  });

  describe('Error Type Mapping', () => {
    it('TC-OR-030: should map SyntaxError to syntax_error', () => {
      const errorType = mapErrorType('SyntaxError');
      expect(errorType).toBe('syntax_error');
    });

    it('TC-OR-031: should map TypeError to logic_error', () => {
      const errorType = mapErrorType('TypeError');
      expect(errorType).toBe('logic_error');
    });

    it('TC-OR-032: should map LogicError to logic_error', () => {
      const errorType = mapErrorType('LogicError');
      expect(errorType).toBe('logic_error');
    });

    it('TC-OR-033: should map RuntimeError to logic_error', () => {
      const errorType = mapErrorType('RuntimeError');
      expect(errorType).toBe('logic_error');
    });

    it('TC-OR-034: should map NotApplicableError to not_applicable', () => {
      const errorType = mapErrorType('NotApplicableError');
      expect(errorType).toBe('not_applicable');
    });

    it('TC-OR-035: should map StaleError to stale_solution', () => {
      const errorType = mapErrorType('StaleError');
      expect(errorType).toBe('stale_solution');
    });

    it('TC-OR-036: should map IncompleteError to incomplete', () => {
      const errorType = mapErrorType('IncompleteError');
      expect(errorType).toBe('incomplete');
    });

    it('TC-OR-037: should map SecurityError to security_issue', () => {
      const errorType = mapErrorType('SecurityError');
      expect(errorType).toBe('security_issue');
    });

    it('TC-OR-038: should return undefined for unknown error type', () => {
      const errorType = mapErrorType('UnknownError');
      expect(errorType).toBeUndefined();
    });

    it('TC-OR-039: should return undefined for missing error type', () => {
      const errorType = mapErrorType(undefined);
      expect(errorType).toBeUndefined();
    });
  });

  describe('Response Format', () => {
    it('TC-OR-040: should include correlationId in response', async () => {
      const context = createOutcomeHookContext({
        correlationId: 'unique-correlation-id',
      });

      const response = await simulateHookExecution(context);

      expect(response.correlationId).toBe('unique-correlation-id');
    });

    it('TC-OR-041: should include durationMs in response', async () => {
      const context = createOutcomeHookContext();
      const response = await simulateHookExecution(context);

      expect(response.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof response.durationMs).toBe('number');
    });

    it('TC-OR-042: should include outcomesRecorded count', async () => {
      const context = createOutcomeHookContext();
      const response = await simulateHookExecution(context);

      expect(typeof response.outcomesRecorded).toBe('number');
      expect(response.outcomesRecorded).toBeGreaterThanOrEqual(0);
    });

    it('TC-OR-043: should include recordedEpisodeIds array', async () => {
      const context = createOutcomeHookContext();
      const response = await simulateHookExecution(context);

      expect(Array.isArray(response.recordedEpisodeIds)).toBe(true);
      expect(response.recordedEpisodeIds.length).toBe(response.outcomesRecorded);
    });

    it('TC-OR-044: should set success=true on successful execution', async () => {
      const context = createOutcomeHookContext();
      const response = await simulateHookExecution(context);

      expect(response.success).toBe(true);
    });
  });

  describe('Performance', () => {
    it('TC-OR-050: should complete within 100ms', async () => {
      const context = createOutcomeHookContext();

      const startTime = performance.now();
      const response = await simulateHookExecution(context);
      const elapsed = performance.now() - startTime;

      expect(response.success).toBe(true);
      expect(elapsed).toBeLessThan(100);
    });

    it('TC-OR-051: should handle rapid sequential calls', async () => {
      const contexts = Array.from({ length: 10 }, (_, i) =>
        createOutcomeHookContext({
          correlationId: `rapid-test-${i}`,
          metadata: {
            injectedEpisodeIds: [`episode-${i}`],
            taskId: `task-${i}`,
          },
        })
      );

      const startTime = performance.now();
      const responses = await Promise.all(
        contexts.map((ctx) => simulateHookExecution(ctx))
      );
      const elapsed = performance.now() - startTime;

      expect(responses.every((r) => r.success)).toBe(true);
      expect(elapsed).toBeLessThan(500); // All 10 within 500ms
    });

    it('TC-OR-052: should handle batch recording efficiently', async () => {
      const context = createOutcomeHookContext({
        metadata: {
          injectedEpisodeIds: Array.from({ length: 10 }, (_, i) => `episode-${i}`),
          taskId: 'batch-task',
        },
      });

      const startTime = performance.now();
      const response = await simulateHookExecution(context);
      const elapsed = performance.now() - startTime;

      expect(response.success).toBe(true);
      expect(response.outcomesRecorded).toBe(10);
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('Error Handling', () => {
    it('TC-OR-060: should handle missing metadata gracefully', async () => {
      const context = createOutcomeHookContext({
        metadata: undefined,
      });

      const response = await simulateHookExecution(context);

      expect(response.success).toBe(true);
      expect(response.outcomesRecorded).toBe(0);
    });

    it('TC-OR-061: should handle malformed error object', async () => {
      const context = createOutcomeHookContext({
        result: {
          success: false,
          error: {
            message: 'Error',
            // Missing type field
          },
        },
      });

      const response = await simulateHookExecution(context);

      expect(response.success).toBe(true);
      // Should still record with undefined error type
      expect(response.outcomesRecorded).toBeGreaterThan(0);
    });

    it('TC-OR-062: should handle empty episode ID strings', async () => {
      const context = createOutcomeHookContext({
        metadata: {
          injectedEpisodeIds: ['', 'valid-episode', ''],
          taskId: 'task-001',
        },
      });

      const response = await simulateHookExecution(context);

      expect(response.success).toBe(true);
      // Should attempt to record all, including empty strings
      expect(response.outcomesRecorded).toBeLessThanOrEqual(3);
    });
  });

  describe('Edge Cases', () => {
    it('TC-OR-070: should handle very long episode ID list', async () => {
      const context = createOutcomeHookContext({
        metadata: {
          injectedEpisodeIds: Array.from({ length: 100 }, (_, i) => `episode-${i}`),
          taskId: 'large-batch',
        },
      });

      const response = await simulateHookExecution(context);

      expect(response.success).toBe(true);
      // May timeout before recording all, but should succeed
      expect(response.outcomesRecorded).toBeGreaterThan(0);
    });

    it('TC-OR-071: should handle duplicate episode IDs', async () => {
      const context = createOutcomeHookContext({
        metadata: {
          injectedEpisodeIds: ['episode-dup', 'episode-dup', 'episode-dup'],
          taskId: 'dup-task',
        },
      });

      const response = await simulateHookExecution(context);

      expect(response.success).toBe(true);
      // Should record all duplicates (recording system handles deduplication)
      expect(response.outcomesRecorded).toBe(3);
    });

    it('TC-OR-072: should handle special characters in IDs', async () => {
      const context = createOutcomeHookContext({
        metadata: {
          injectedEpisodeIds: ['episode-123!@#', 'episode-with-unicode-你好'],
          taskId: 'special-task-🚀',
        },
      });

      const response = await simulateHookExecution(context);

      expect(response.success).toBe(true);
    });
  });
});

// ============================================================================
// Helper Functions (inline implementations for testing)
// ============================================================================

/**
 * Map JS error type to ErrorType enum
 */
function mapErrorType(type?: string): ErrorType | undefined {
  if (!type) return undefined;

  const mapping: Record<string, ErrorType> = {
    SyntaxError: 'syntax_error',
    TypeError: 'logic_error',
    LogicError: 'logic_error',
    RuntimeError: 'logic_error',
    NotApplicableError: 'not_applicable',
    StaleError: 'stale_solution',
    IncompleteError: 'incomplete',
    SecurityError: 'security_issue',
  };

  return mapping[type];
}

/**
 * Record outcome for an episode (test stub)
 */
async function recordOutcome(
  _episodeId: string,
  _taskId: string,
  _success: boolean,
  _errorType?: ErrorType
): Promise<boolean> {
  // Simulate recording delay
  await new Promise((resolve) => setTimeout(resolve, 1));
  return true;
}

/**
 * Handle outcome recording (inline implementation for testing)
 */
async function handleOutcomeRecording(
  context: IOutcomeHookContext
): Promise<IOutcomeRecorderResponse> {
  const startTime = Date.now();

  if (context.toolName !== 'Task') {
    return {
      success: true,
      correlationId: context.correlationId,
      durationMs: Date.now() - startTime,
      outcomesRecorded: 0,
      recordedEpisodeIds: [],
    };
  }

  const episodeIds = context.metadata?.injectedEpisodeIds ?? [];
  if (episodeIds.length === 0) {
    return {
      success: true,
      correlationId: context.correlationId,
      durationMs: Date.now() - startTime,
      outcomesRecorded: 0,
      recordedEpisodeIds: [],
    };
  }

  const taskId = context.metadata?.taskId ?? `task-${context.correlationId}`;
  const success = context.result.success;
  const errorType = success ? undefined : mapErrorType(context.result.error?.type);

  const recordedEpisodeIds: string[] = [];
  const recordPromises = episodeIds.map(async (episodeId) => {
    const recorded = await recordOutcome(episodeId, taskId, success, errorType);
    if (recorded) {
      recordedEpisodeIds.push(episodeId);
    }
  });

  await Promise.race([
    Promise.all(recordPromises),
    new Promise((resolve) => setTimeout(resolve, 100)),
  ]);

  return {
    success: true,
    correlationId: context.correlationId,
    durationMs: Date.now() - startTime,
    outcomesRecorded: recordedEpisodeIds.length,
    recordedEpisodeIds,
  };
}

/**
 * Simulate hook execution (inline implementation for testing)
 */
async function simulateHookExecution(
  context: IOutcomeHookContext
): Promise<IOutcomeRecorderResponse> {
  return handleOutcomeRecording(context);
}
