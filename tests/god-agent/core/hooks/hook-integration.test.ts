/**
 * Hook Integration Tests
 * TASK-MON-004 - Phase 3 Integration Testing
 *
 * Tests cover:
 * - HookRegistry initialization and validation (RULE-032)
 * - HookExecutor priority-based execution
 * - Task result capture (GAP-LEARN-001)
 * - Quality assessment trigger (RULE-033)
 * - Error isolation across hooks
 * - Hook chain control flow
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getHookRegistry,
  getHookExecutor,
  _resetHookRegistryForTesting,
  _resetHookExecutorForTesting,
  registerRequiredHooks,
  registerPreToolUseHook,
  registerPostToolUseHook,
  setQualityAssessmentCallback,
  getCapturedResult,
  hasCapturedResult,
  getCapturedResultCount,
  _clearCapturedResultsForTesting,
  _clearQualityAssessmentCallbackForTesting,
  DEFAULT_PRIORITIES,
  HookError,
  HookErrorCode,
  QUALITY_THRESHOLDS,
  type IHookContext,
  type IPostToolUseContext
} from '../../../../src/god-agent/core/hooks/index.js';

// ============================================================================
// Test Setup
// ============================================================================

describe('Hook Integration Tests', () => {
  beforeEach(() => {
    // Reset all singletons and state before each test
    _resetHookRegistryForTesting();
    _resetHookExecutorForTesting();
    _clearCapturedResultsForTesting();
    _clearQualityAssessmentCallbackForTesting();
  });

  // ==========================================================================
  // HookRegistry Tests (RULE-032)
  // ==========================================================================

  describe('HookRegistry (RULE-032)', () => {
    it('should throw when initializing without required hooks', () => {
      const registry = getHookRegistry();
      // Don't register required hooks
      expect(() => registry.initialize()).toThrow(/task-result-capture|quality-assessment-trigger/);
    });

    it('should initialize successfully when required hooks are registered', () => {
      registerRequiredHooks();
      const registry = getHookRegistry();
      expect(() => registry.initialize()).not.toThrow();
      expect(registry.isInitialized()).toBe(true);
    });

    it('should prevent registration after initialization (RULE-032)', () => {
      registerRequiredHooks();
      const registry = getHookRegistry();
      registry.initialize();

      expect(() => registerPreToolUseHook({
        id: 'late-hook',
        handler: async () => ({ continue: true })
      })).toThrow(/Cannot register hook.*after initialization/);
    });

    it('should reject duplicate hook IDs', () => {
      registerPreToolUseHook({
        id: 'duplicate-hook',
        handler: async () => ({ continue: true })
      });

      expect(() => registerPreToolUseHook({
        id: 'duplicate-hook',
        handler: async () => ({ continue: true })
      })).toThrow(/already registered/);
    });

    it('should sort hooks by priority (ascending)', () => {
      registerPreToolUseHook({
        id: 'low-priority',
        priority: 90,
        handler: async () => ({ continue: true })
      });
      registerPreToolUseHook({
        id: 'high-priority',
        priority: 10,
        handler: async () => ({ continue: true })
      });
      registerPreToolUseHook({
        id: 'medium-priority',
        priority: 50,
        handler: async () => ({ continue: true })
      });
      registerRequiredHooks();

      const hooks = getHookRegistry().getPreToolUseHooks();
      const ids = hooks.map(h => h.id);
      expect(ids.indexOf('high-priority')).toBeLessThan(ids.indexOf('medium-priority'));
      expect(ids.indexOf('medium-priority')).toBeLessThan(ids.indexOf('low-priority'));
    });

    it('should filter hooks by tool name', () => {
      registerPreToolUseHook({
        id: 'task-specific',
        toolName: 'Task',
        handler: async () => ({ continue: true })
      });
      registerPreToolUseHook({
        id: 'bash-specific',
        toolName: 'Bash',
        handler: async () => ({ continue: true })
      });
      registerPreToolUseHook({
        id: 'all-tools',
        handler: async () => ({ continue: true })
      });
      registerRequiredHooks();

      const taskHooks = getHookRegistry().getPreToolUseHooks('Task');
      const taskIds = taskHooks.map(h => h.id);

      expect(taskIds).toContain('task-specific');
      expect(taskIds).toContain('all-tools');
      expect(taskIds).not.toContain('bash-specific');
    });

    it('should disable and enable hooks', () => {
      registerPreToolUseHook({
        id: 'toggleable-hook',
        handler: async () => ({ continue: true })
      });
      registerRequiredHooks();

      const registry = getHookRegistry();

      // Disable the hook
      const disabled = registry.setHookEnabled('toggleable-hook', false);
      expect(disabled).toBe(true);

      // Verify hook is not returned when disabled
      const hooksWhenDisabled = registry.getPreToolUseHooks();
      expect(hooksWhenDisabled.find(h => h.id === 'toggleable-hook')).toBeUndefined();

      // Re-enable
      registry.setHookEnabled('toggleable-hook', true);
      const hooksWhenEnabled = registry.getPreToolUseHooks();
      expect(hooksWhenEnabled.find(h => h.id === 'toggleable-hook')).toBeDefined();
    });

    it('should provide hook counts', () => {
      registerRequiredHooks();
      registerPreToolUseHook({
        id: 'extra-pre-hook',
        handler: async () => ({ continue: true })
      });

      const registry = getHookRegistry();
      const counts = registry.getHookCount();

      expect(counts.preToolUse).toBeGreaterThan(0);
      expect(counts.postToolUse).toBeGreaterThan(0);
      expect(counts.total).toBe(counts.preToolUse + counts.postToolUse);
    });
  });

  // ==========================================================================
  // HookExecutor Tests
  // ==========================================================================

  describe('HookExecutor', () => {
    it('should execute hooks in priority order', async () => {
      const executionOrder: string[] = [];

      registerPreToolUseHook({
        id: 'third',
        priority: 30,
        handler: async () => {
          executionOrder.push('third');
          return { continue: true };
        }
      });
      registerPreToolUseHook({
        id: 'first',
        priority: 10,
        handler: async () => {
          executionOrder.push('first');
          return { continue: true };
        }
      });
      registerPreToolUseHook({
        id: 'second',
        priority: 20,
        handler: async () => {
          executionOrder.push('second');
          return { continue: true };
        }
      });
      registerRequiredHooks();
      getHookRegistry().initialize();

      const executor = getHookExecutor();
      await executor.executePreToolUseHooks({
        toolName: 'Test',
        toolInput: {},
        sessionId: 'test-session',
        timestamp: Date.now()
      });

      expect(executionOrder).toEqual(['first', 'second', 'third']);
    });

    it('should isolate errors (one hook failure does not stop others)', async () => {
      const executed: string[] = [];

      registerPreToolUseHook({
        id: 'failing-hook',
        priority: 10,
        handler: async () => {
          throw new Error('Intentional hook failure');
        }
      });
      registerPreToolUseHook({
        id: 'succeeding-hook',
        priority: 20,
        handler: async () => {
          executed.push('succeeding');
          return { continue: true };
        }
      });
      registerRequiredHooks();
      getHookRegistry().initialize();

      const executor = getHookExecutor();
      const result = await executor.executePreToolUseHooks({
        toolName: 'Test',
        toolInput: {},
        sessionId: 'test-session',
        timestamp: Date.now()
      });

      // Succeeding hook should have run despite failure of earlier hook
      expect(executed).toContain('succeeding');
      expect(result.allSucceeded).toBe(false);

      // Verify individual results
      const failedResult = result.results.find(r => r.hookId === 'failing-hook');
      const successResult = result.results.find(r => r.hookId === 'succeeding-hook');

      expect(failedResult?.success).toBe(false);
      expect(failedResult?.error).toContain('Intentional hook failure');
      expect(successResult?.success).toBe(true);
    });

    it('should stop chain when hook returns continue=false', async () => {
      const executed: string[] = [];

      registerPreToolUseHook({
        id: 'stopper',
        priority: 10,
        handler: async () => {
          executed.push('stopper');
          return { continue: false, stopReason: 'Intentional stop for testing' };
        }
      });
      registerPreToolUseHook({
        id: 'after-stopper',
        priority: 20,
        handler: async () => {
          executed.push('after-stopper');
          return { continue: true };
        }
      });
      registerRequiredHooks();
      getHookRegistry().initialize();

      const executor = getHookExecutor();
      const result = await executor.executePreToolUseHooks({
        toolName: 'Test',
        toolInput: {},
        sessionId: 'test-session',
        timestamp: Date.now()
      });

      // Only stopper should have executed
      expect(executed).toEqual(['stopper']);
      expect(result.chainStopped).toBe(true);
      expect(result.stoppedByHook).toBe('stopper');
    });

    it('should pass modified input through preToolUse chain', async () => {
      registerPreToolUseHook({
        id: 'modifier-1',
        priority: 10,
        handler: async (ctx) => {
          const input = ctx.toolInput as { value: number };
          return {
            continue: true,
            modifiedInput: { value: input.value + 10 }
          };
        }
      });
      registerPreToolUseHook({
        id: 'modifier-2',
        priority: 20,
        handler: async (ctx) => {
          const input = ctx.toolInput as { value: number };
          return {
            continue: true,
            modifiedInput: { value: input.value * 2 }
          };
        }
      });
      registerRequiredHooks();
      getHookRegistry().initialize();

      const executor = getHookExecutor();
      const result = await executor.executePreToolUseHooks({
        toolName: 'Test',
        toolInput: { value: 5 },
        sessionId: 'test-session',
        timestamp: Date.now()
      });

      // (5 + 10) * 2 = 30
      expect(result.finalInput).toEqual({ value: 30 });
    });

    it('should track timing metrics', async () => {
      registerPreToolUseHook({
        id: 'slow-hook',
        priority: 10,
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { continue: true };
        }
      });
      registerRequiredHooks();
      getHookRegistry().initialize();

      const executor = getHookExecutor();
      const result = await executor.executePreToolUseHooks({
        toolName: 'Test',
        toolInput: {},
        sessionId: 'test-session',
        timestamp: Date.now()
      });

      // Total duration should be at least 10ms
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(10);

      // Individual hook should have timing
      const slowHookResult = result.results.find(r => r.hookId === 'slow-hook');
      expect(slowHookResult?.durationMs).toBeGreaterThanOrEqual(10);
    });

    it('should execute postToolUse hooks with output context', async () => {
      const capturedOutput: unknown[] = [];

      registerPostToolUseHook({
        id: 'output-inspector',
        priority: DEFAULT_PRIORITIES.LOGGING,
        handler: async (ctx: IPostToolUseContext) => {
          capturedOutput.push(ctx.toolOutput);
          return { continue: true };
        }
      });
      registerRequiredHooks();
      getHookRegistry().initialize();

      const executor = getHookExecutor();
      await executor.executePostToolUseHooks({
        toolName: 'Task',
        toolInput: { prompt: 'test' },
        toolOutput: { result: 'test output', success: true },
        sessionId: 'test-session',
        trajectoryId: 'traj-123',
        timestamp: Date.now(),
        executionSuccess: true
      });

      expect(capturedOutput).toHaveLength(1);
      expect(capturedOutput[0]).toEqual({ result: 'test output', success: true });
    });
  });

  // ==========================================================================
  // Task Result Capture Tests (GAP-LEARN-001)
  // ==========================================================================

  describe('Task Result Capture (GAP-LEARN-001)', () => {
    it('should capture Task tool results with trajectory', async () => {
      registerRequiredHooks();
      getHookRegistry().initialize();

      const executor = getHookExecutor();
      const context: IPostToolUseContext = {
        toolName: 'Task',
        toolInput: { prompt: 'Write a test function' },
        toolOutput: { result: 'function test() { return true; }' },
        sessionId: 'test-session',
        trajectoryId: 'traj-12345-abcd1234',
        timestamp: Date.now(),
        executionSuccess: true,
        executionDurationMs: 150
      };

      await executor.executePostToolUseHooks(context);

      expect(hasCapturedResult('traj-12345-abcd1234')).toBe(true);

      const captured = getCapturedResult('traj-12345-abcd1234');
      expect(captured).toBeDefined();
      expect(captured?.toolName).toBe('Task');
      expect(captured?.toolOutput).toEqual({ result: 'function test() { return true; }' });
      expect(captured?.executionSuccess).toBe(true);
    });

    it('should skip capture when no trajectory is active', async () => {
      registerRequiredHooks();
      getHookRegistry().initialize();

      const executor = getHookExecutor();
      await executor.executePostToolUseHooks({
        toolName: 'Task',
        toolInput: { prompt: 'test' },
        toolOutput: { result: 'output' },
        sessionId: 'test-session',
        // No trajectoryId
        timestamp: Date.now(),
        executionSuccess: true
      });

      expect(getCapturedResultCount()).toBe(0);
    });

    it('should capture multiple trajectory results', async () => {
      registerRequiredHooks();
      getHookRegistry().initialize();

      const executor = getHookExecutor();

      // Capture first result
      await executor.executePostToolUseHooks({
        toolName: 'Task',
        toolInput: {},
        toolOutput: { result: 'output-1' },
        sessionId: 'test-session',
        trajectoryId: 'traj-001',
        timestamp: Date.now(),
        executionSuccess: true
      });

      // Capture second result
      await executor.executePostToolUseHooks({
        toolName: 'Task',
        toolInput: {},
        toolOutput: { result: 'output-2' },
        sessionId: 'test-session',
        trajectoryId: 'traj-002',
        timestamp: Date.now(),
        executionSuccess: true
      });

      expect(getCapturedResultCount()).toBe(2);
      expect(getCapturedResult('traj-001')?.toolOutput).toEqual({ result: 'output-1' });
      expect(getCapturedResult('traj-002')?.toolOutput).toEqual({ result: 'output-2' });
    });
  });

  // ==========================================================================
  // Quality Assessment Trigger Tests (RULE-033)
  // ==========================================================================

  describe('Quality Assessment Trigger (RULE-033)', () => {
    it('should trigger quality assessment callback', async () => {
      const mockCallback = vi.fn().mockResolvedValue({
        score: 0.85,
        feedback: 'Good output quality'
      });
      setQualityAssessmentCallback(mockCallback);

      registerRequiredHooks();
      getHookRegistry().initialize();

      const executor = getHookExecutor();
      await executor.executePostToolUseHooks({
        toolName: 'Task',
        toolInput: { prompt: 'Generate code' },
        toolOutput: 'const x = 1;',
        sessionId: 'test-session',
        trajectoryId: 'traj-quality-test',
        timestamp: Date.now(),
        executionSuccess: true,
        executionDurationMs: 100
      });

      expect(mockCallback).toHaveBeenCalledWith(
        'traj-quality-test',
        'const x = 1;',
        expect.objectContaining({
          toolName: 'Task',
          sessionId: 'test-session'
        })
      );
    });

    it('should skip assessment when no callback is registered', async () => {
      // Don't set callback
      registerRequiredHooks();
      getHookRegistry().initialize();

      const executor = getHookExecutor();
      const result = await executor.executePostToolUseHooks({
        toolName: 'Task',
        toolInput: {},
        toolOutput: 'output',
        sessionId: 'test-session',
        trajectoryId: 'traj-no-callback',
        timestamp: Date.now(),
        executionSuccess: true
      });

      // Should complete without error
      expect(result.allSucceeded).toBe(true);
    });

    it('should skip assessment when execution failed', async () => {
      const mockCallback = vi.fn();
      setQualityAssessmentCallback(mockCallback);

      registerRequiredHooks();
      getHookRegistry().initialize();

      const executor = getHookExecutor();
      await executor.executePostToolUseHooks({
        toolName: 'Task',
        toolInput: {},
        toolOutput: { error: 'Failed execution' },
        sessionId: 'test-session',
        trajectoryId: 'traj-failed',
        timestamp: Date.now(),
        executionSuccess: false
      });

      // Callback should not be called for failed executions
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('should pass assessment results in hook metadata', async () => {
      const mockCallback = vi.fn().mockResolvedValue({
        score: 0.75,
        feedback: 'Above threshold',
        breakdown: { accuracy: 0.8, completeness: 0.7 }
      });
      setQualityAssessmentCallback(mockCallback);

      registerRequiredHooks();
      getHookRegistry().initialize();

      const executor = getHookExecutor();
      const result = await executor.executePostToolUseHooks({
        toolName: 'Task',
        toolInput: {},
        toolOutput: 'good output',
        sessionId: 'test-session',
        trajectoryId: 'traj-meta-test',
        timestamp: Date.now(),
        executionSuccess: true
      });

      // Find the quality assessment hook result
      const qaResult = result.results.find(r => r.hookId === 'quality-assessment-trigger');
      expect(qaResult?.success).toBe(true);
      expect(qaResult?.result?.metadata).toBeDefined();
      expect(qaResult?.result?.metadata?.qualityScore).toBe(0.75);
      expect(qaResult?.result?.metadata?.meetsPatternThreshold).toBe(true);
      expect(qaResult?.result?.metadata?.meetsFeedbackThreshold).toBe(true);
    });

    it('should identify scores below thresholds (RULE-035)', async () => {
      const mockCallback = vi.fn().mockResolvedValue({
        score: 0.45,  // Below both thresholds
        feedback: 'Low quality output'
      });
      setQualityAssessmentCallback(mockCallback);

      registerRequiredHooks();
      getHookRegistry().initialize();

      const executor = getHookExecutor();
      const result = await executor.executePostToolUseHooks({
        toolName: 'Task',
        toolInput: {},
        toolOutput: 'poor output',
        sessionId: 'test-session',
        trajectoryId: 'traj-low-quality',
        timestamp: Date.now(),
        executionSuccess: true
      });

      const qaResult = result.results.find(r => r.hookId === 'quality-assessment-trigger');
      expect(qaResult?.result?.metadata?.meetsPatternThreshold).toBe(false);
      expect(qaResult?.result?.metadata?.meetsFeedbackThreshold).toBe(false);
    });

    it('should verify threshold constants match CONSTITUTION', () => {
      expect(QUALITY_THRESHOLDS.FEEDBACK).toBe(0.5);
      expect(QUALITY_THRESHOLDS.PATTERN).toBe(0.7);
    });
  });

  // ==========================================================================
  // Integration Flow Tests
  // ==========================================================================

  describe('Integration Flow', () => {
    it('should execute full hook chain in correct order', async () => {
      const executionLog: string[] = [];
      const mockQualityCallback = vi.fn().mockResolvedValue({ score: 0.8 });
      setQualityAssessmentCallback(mockQualityCallback);

      // Register custom monitoring hook
      registerPostToolUseHook({
        id: 'monitoring-hook',
        priority: DEFAULT_PRIORITIES.LOGGING,  // Priority 30 - before capture (40)
        handler: async () => {
          executionLog.push('monitoring');
          return { continue: true };
        }
      });

      registerRequiredHooks();
      getHookRegistry().initialize();

      const executor = getHookExecutor();
      await executor.executePostToolUseHooks({
        toolName: 'Task',
        toolInput: {},
        toolOutput: 'test output',
        sessionId: 'test-session',
        trajectoryId: 'traj-flow-test',
        timestamp: Date.now(),
        executionSuccess: true
      });

      // Hooks should execute in priority order:
      // monitoring (30) -> task-result-capture (40) -> quality-assessment-trigger (60)
      expect(mockQualityCallback).toHaveBeenCalled();
      expect(hasCapturedResult('traj-flow-test')).toBe(true);
    });

    it('should handle async errors gracefully', async () => {
      const mockCallback = vi.fn().mockRejectedValue(new Error('Assessment service unavailable'));
      setQualityAssessmentCallback(mockCallback);

      registerRequiredHooks();
      getHookRegistry().initialize();

      const executor = getHookExecutor();
      const result = await executor.executePostToolUseHooks({
        toolName: 'Task',
        toolInput: {},
        toolOutput: 'output',
        sessionId: 'test-session',
        trajectoryId: 'traj-error-test',
        timestamp: Date.now(),
        executionSuccess: true
      });

      // Chain should complete despite callback error
      expect(result.results.length).toBeGreaterThan(0);

      // Result capture should still work
      expect(hasCapturedResult('traj-error-test')).toBe(true);
    });

    it('should provide accurate execution statistics', async () => {
      registerRequiredHooks();
      getHookRegistry().initialize();

      const executor = getHookExecutor();
      const result = await executor.executePostToolUseHooks({
        toolName: 'Task',
        toolInput: {},
        toolOutput: 'output',
        sessionId: 'test-session',
        trajectoryId: 'traj-stats-test',
        timestamp: Date.now(),
        executionSuccess: true
      });

      // Should have executed at least the required hooks
      expect(result.results.length).toBeGreaterThanOrEqual(2);

      // Each result should have timing
      for (const hookResult of result.results) {
        expect(hookResult.durationMs).toBeGreaterThanOrEqual(0);
        expect(hookResult.hookId).toBeDefined();
      }

      // Total duration should be sum of individual durations (approximately)
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
