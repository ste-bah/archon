/**
 * Hook Execution Engine
 * TASK-HOOK-002 - Hook Execution Engine
 *
 * Executes preToolUse and postToolUse hooks in priority order.
 * Implements error isolation - one hook failure does NOT stop other hooks.
 *
 * CONSTITUTION COMPLIANCE:
 * - RULE-032: All hooks MUST be registered at daemon startup (registry handles this)
 * - Logs execution metrics for observability
 *
 * Per TASKS-PHASE3.md specification:
 * - Execute hooks in priority order (already sorted by registry)
 * - Track timing for each hook execution
 * - Handle input modification chain for preToolUse hooks
 * - Stop chain only when hook returns continue: false
 * - Error isolation: hook failures don't stop chain
 */

import { getHookRegistry } from './hook-registry.js';
import {
  IHookContext,
  IPostToolUseContext,
  IHookResult,
  IHookExecutor,
  IHookChainResult,
  IHookExecutionResult,
  AnyHook
} from './types.js';
import { createComponentLogger, type StructuredLogger } from '../observability/logger.js';

// ============================================================================
// Hook Executor Implementation
// ============================================================================

/**
 * HookExecutor
 *
 * Executes hook chains for preToolUse and postToolUse events.
 *
 * Key behaviors:
 * - Hooks execute in priority order (ascending)
 * - Error isolation: failed hooks don't stop chain
 * - Chain stops only when hook returns continue: false
 * - Input modification flows through preToolUse chain
 * - Metrics tracked for each execution
 *
 * Usage:
 * ```typescript
 * const executor = getHookExecutor();
 * const result = await executor.executePreToolUseHooks(context);
 * if (result.chainStopped) {
 *   // A hook prevented tool execution
 * }
 * ```
 */
export class HookExecutor implements IHookExecutor {
  /** Logger instance for observability */
  private readonly logger: StructuredLogger;

  constructor() {
    this.logger = createComponentLogger('HookExecutor');
  }

  // ==========================================================================
  // Pre-Tool-Use Hook Execution
  // ==========================================================================

  /**
   * Execute pre-tool-use hooks for the given context
   *
   * Hooks execute in priority order. Each hook may:
   * - Modify the input (passed to subsequent hooks)
   * - Stop the chain (return continue: false)
   * - Fail (recorded but doesn't stop chain)
   *
   * @param context - Hook execution context
   * @returns Chain execution result including final modified input
   */
  async executePreToolUseHooks(context: IHookContext): Promise<IHookChainResult> {
    const chainStartTime = performance.now();

    // Get hooks from registry (already sorted by priority)
    const hooks = getHookRegistry().getPreToolUseHooks(context.toolName);

    this.logger.debug('Executing preToolUse hook chain', {
      toolName: context.toolName,
      sessionId: context.sessionId,
      hookCount: hooks.length,
      hookIds: hooks.map(h => h.id)
    });

    // Initialize chain state
    const results: IHookExecutionResult[] = [];
    let chainStopped = false;
    let stoppedByHook: string | undefined;
    let currentInput = context.toolInput;

    // Execute each hook in priority order
    for (const hook of hooks) {
      // Create modified context with current input
      const hookContext: IHookContext = {
        ...context,
        toolInput: currentInput
      };

      // Execute hook with error isolation
      const executionResult = await this.executeHookWithIsolation(hook, hookContext);
      results.push(executionResult);

      // Update input if hook modified it (only on success)
      if (executionResult.success && executionResult.result?.modifiedInput !== undefined) {
        currentInput = executionResult.result.modifiedInput;
        this.logger.debug('Hook modified input', {
          hookId: hook.id,
          hasModifiedInput: true
        });
      }

      // Check if chain should stop
      if (executionResult.success && executionResult.result?.continue === false) {
        chainStopped = true;
        stoppedByHook = hook.id;
        this.logger.info('Hook chain stopped by hook', {
          hookId: hook.id,
          stopReason: executionResult.result.stopReason,
          executedHooks: results.length
        });
        break;
      }
    }

    const totalDurationMs = performance.now() - chainStartTime;
    const allSucceeded = results.every(r => r.success);

    // Log chain completion metrics
    this.logger.info('PreToolUse hook chain completed', {
      toolName: context.toolName,
      sessionId: context.sessionId,
      hooksExecuted: results.length,
      totalHooks: hooks.length,
      allSucceeded,
      chainStopped,
      stoppedByHook,
      totalDurationMs: Math.round(totalDurationMs * 100) / 100,
      hookResults: results.map(r => ({
        hookId: r.hookId,
        success: r.success,
        durationMs: r.durationMs,
        error: r.error
      }))
    });

    return {
      results,
      allSucceeded,
      chainStopped,
      stoppedByHook,
      totalDurationMs,
      finalInput: currentInput
    };
  }

  // ==========================================================================
  // Post-Tool-Use Hook Execution
  // ==========================================================================

  /**
   * Execute post-tool-use hooks for the given context
   *
   * Hooks execute in priority order. Each hook may:
   * - Stop the chain (return continue: false)
   * - Fail (recorded but doesn't stop chain)
   *
   * Note: Post-tool-use hooks do NOT modify input (tool already executed)
   *
   * @param context - Post-tool-use hook context (includes toolOutput)
   * @returns Chain execution result
   */
  async executePostToolUseHooks(context: IPostToolUseContext): Promise<IHookChainResult> {
    const chainStartTime = performance.now();

    // Get hooks from registry (already sorted by priority)
    const hooks = getHookRegistry().getPostToolUseHooks(context.toolName);

    this.logger.debug('Executing postToolUse hook chain', {
      toolName: context.toolName,
      sessionId: context.sessionId,
      hookCount: hooks.length,
      hookIds: hooks.map(h => h.id),
      executionSuccess: context.executionSuccess
    });

    // Initialize chain state
    const results: IHookExecutionResult[] = [];
    let chainStopped = false;
    let stoppedByHook: string | undefined;

    // Execute each hook in priority order
    for (const hook of hooks) {
      // Execute hook with error isolation
      const executionResult = await this.executeHookWithIsolation(hook, context);
      results.push(executionResult);

      // Check if chain should stop
      if (executionResult.success && executionResult.result?.continue === false) {
        chainStopped = true;
        stoppedByHook = hook.id;
        this.logger.info('Hook chain stopped by hook', {
          hookId: hook.id,
          stopReason: executionResult.result.stopReason,
          executedHooks: results.length
        });
        break;
      }
    }

    const totalDurationMs = performance.now() - chainStartTime;
    const allSucceeded = results.every(r => r.success);

    // Log chain completion metrics
    this.logger.info('PostToolUse hook chain completed', {
      toolName: context.toolName,
      sessionId: context.sessionId,
      hooksExecuted: results.length,
      totalHooks: hooks.length,
      allSucceeded,
      chainStopped,
      stoppedByHook,
      totalDurationMs: Math.round(totalDurationMs * 100) / 100,
      hookResults: results.map(r => ({
        hookId: r.hookId,
        success: r.success,
        durationMs: r.durationMs,
        error: r.error
      }))
    });

    return {
      results,
      allSucceeded,
      chainStopped,
      stoppedByHook,
      totalDurationMs
      // Note: No finalInput for postToolUse (tool already executed)
    };
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Execute a single hook with error isolation
   *
   * CRITICAL: Errors are caught and recorded, NOT re-thrown.
   * This ensures one failing hook doesn't break the entire chain.
   *
   * @param hook - Hook to execute
   * @param context - Execution context
   * @returns Execution result (always succeeds at the executor level)
   */
  private async executeHookWithIsolation(
    hook: AnyHook,
    context: IHookContext | IPostToolUseContext
  ): Promise<IHookExecutionResult> {
    const startTime = performance.now();

    try {
      // Execute the hook handler
      const result: IHookResult = await hook.handler(context);
      const durationMs = performance.now() - startTime;

      this.logger.debug('Hook executed successfully', {
        hookId: hook.id,
        hookType: hook.type,
        continue: result.continue,
        hasModifiedInput: result.modifiedInput !== undefined,
        durationMs: Math.round(durationMs * 100) / 100
      });

      return {
        hookId: hook.id,
        success: true,
        durationMs,
        result
      };
    } catch (error) {
      // CRITICAL: Catch and record error, do NOT re-throw
      const durationMs = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error('Hook execution failed', {
        hookId: hook.id,
        hookType: hook.type,
        error: errorMessage,
        durationMs: Math.round(durationMs * 100) / 100,
        stack: error instanceof Error ? error.stack : undefined
      });

      return {
        hookId: hook.id,
        success: false,
        durationMs,
        error: errorMessage
      };
    }
  }

  // ==========================================================================
  // Testing Support
  // ==========================================================================

  /**
   * Execute a single hook directly (for testing)
   * Bypasses registry lookup
   *
   * WARNING: Only for testing purposes
   */
  async _executeHookDirectlyForTesting(
    hook: AnyHook,
    context: IHookContext | IPostToolUseContext
  ): Promise<IHookExecutionResult> {
    return this.executeHookWithIsolation(hook, context);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/** Singleton instance of HookExecutor */
let executorInstance: HookExecutor | null = null;

/**
 * Get the singleton HookExecutor instance
 *
 * @returns HookExecutor singleton
 */
export function getHookExecutor(): HookExecutor {
  if (!executorInstance) {
    executorInstance = new HookExecutor();
  }
  return executorInstance;
}

/**
 * Reset the singleton instance (for testing only)
 */
export function _resetHookExecutorForTesting(): void {
  executorInstance = null;
}
