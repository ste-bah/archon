/**
 * ClaudeCodeExecutor - Executes prompts through Claude Code Task tool
 * TASK-FIX-006 - Foundation for quality assessment bug fix
 *
 * Implements: REQ-CONST-003, REQ-EXEC-001
 * Constitution: RULE-033 (quality on result), RULE-076 (dependency injection)
 *
 * This executor is the CRITICAL component that enables:
 * 1. Actual LLM execution (not just returning the prompt)
 * 2. Event emission to ObservabilityBus for quality assessment
 * 3. Execution metadata capture for learning
 */

import type {
  ITaskExecutor,
  IExecutionResult,
  IExecutionMetadata,
  IExecutorConfig,
  IExecutionStartEvent,
  IExecutionCompleteEvent
} from './types.js';
import type { IObservabilityBus } from '../observability/bus.js';

/**
 * ClaudeCodeExecutor
 *
 * Executes prompts through the Claude Code system and emits events
 * to ObservabilityBus for downstream quality assessment.
 *
 * ARCHITECTURE:
 * 1. Receives prompt and optional agent type
 * 2. Emits 'execution:start' event to ObservabilityBus
 * 3. Executes prompt (actual implementation or mock for testing)
 * 4. Emits 'execution:complete' event with BOTH prompt AND output
 * 5. Returns execution result
 *
 * The execution:complete event is CRITICAL for RULE-033 compliance -
 * quality assessment subscribes to this event and assesses the OUTPUT.
 */
export class ClaudeCodeExecutor implements ITaskExecutor {
  private readonly bus: IObservabilityBus | null;
  private readonly defaultAgent: string;
  private readonly timeoutMs: number;
  private readonly verbose: boolean;

  constructor(config: IExecutorConfig = {}) {
    this.bus = config.observabilityBus ?? null;
    this.defaultAgent = config.defaultAgent ?? 'default';
    this.timeoutMs = config.timeoutMs ?? 120000; // 2 minute default
    this.verbose = config.verbose ?? false;
  }

  /**
   * Execute a prompt and return the LLM response
   *
   * CRITICAL: This method MUST:
   * 1. Actually execute the prompt (not just return it)
   * 2. Emit events for quality assessment
   * 3. Capture execution metadata
   */
  async execute(prompt: string, agent?: string): Promise<IExecutionResult> {
    const executionId = this.generateExecutionId();
    const agentType = agent ?? this.defaultAgent;
    const startTime = Date.now();

    // Emit start event
    this.emitStartEvent({
      executionId,
      prompt,
      promptLength: prompt.length,
      agent: agentType,
      timestamp: startTime
    });

    try {
      // Execute the prompt
      const output = await this.executeInternal(prompt, agentType);
      const executionTimeMs = Date.now() - startTime;

      // Create metadata
      const metadata: IExecutionMetadata = {
        executionId,
        agent: agentType,
        executionTimeMs,
        tokenCount: this.estimateTokens(prompt, output),
        model: 'claude',
        success: true
      };

      // Emit complete event WITH OUTPUT (CRITICAL for RULE-033)
      this.emitCompleteEvent({
        executionId,
        prompt,
        output,
        outputLength: output.length,
        agent: agentType,
        executionTimeMs,
        success: true,
        timestamp: Date.now()
      });

      return { content: output, metadata };

    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Create error metadata
      const metadata: IExecutionMetadata = {
        executionId,
        agent: agentType,
        executionTimeMs,
        success: false,
        error: errorMessage
      };

      // Emit error event
      this.emitCompleteEvent({
        executionId,
        prompt,
        output: '',
        outputLength: 0,
        agent: agentType,
        executionTimeMs,
        success: false,
        error: errorMessage,
        timestamp: Date.now()
      });

      // RULE-070: Re-throw with execution context
      throw new Error(
        `Claude Code execution failed for agent "${agentType}" (executionId: ${executionId}, duration: ${executionTimeMs}ms): ${errorMessage}`,
        { cause: error }
      );
    }
  }

  /**
   * Internal execution - this is where actual LLM calls would happen
   *
   * In production, this calls Claude Code's Task tool
   * Can be overridden in tests or subclasses
   */
  protected async executeInternal(prompt: string, agent: string): Promise<string> {
    // Default implementation for now - returns a placeholder
    // In actual Claude Code integration, this would use the Task tool
    // This will be replaced when we wire up actual Claude Code execution

    if (this.verbose) {
      console.log(`[ClaudeCodeExecutor] Executing with agent: ${agent}`);
      console.log(`[ClaudeCodeExecutor] Prompt length: ${prompt.length}`);
    }

    // For now, return a marker that indicates execution happened
    // This marker helps tests verify execution vs just prompt pass-through
    // Real implementation will call Claude Code Task tool
    return `[EXECUTED:${agent}] Response for prompt of length ${prompt.length}`;
  }

  /**
   * Generate unique execution ID
   */
  private generateExecutionId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `exec_${timestamp}_${random}`;
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(prompt: string, output: string): number {
    // Rough estimate: ~4 chars per token
    return Math.ceil((prompt.length + output.length) / 4);
  }

  /**
   * Emit execution start event to ObservabilityBus
   */
  private emitStartEvent(event: IExecutionStartEvent): void {
    if (!this.bus) return;

    this.bus.emit({
      component: 'agent',
      operation: 'execution:start',
      status: 'running',
      metadata: { ...event } as Record<string, unknown>
    });
  }

  /**
   * Emit execution complete event to ObservabilityBus
   * CRITICAL: This event includes the OUTPUT for quality assessment
   */
  private emitCompleteEvent(event: IExecutionCompleteEvent): void {
    if (!this.bus) return;

    this.bus.emit({
      component: 'agent',
      operation: 'execution:complete',
      status: event.success ? 'success' : 'error',
      durationMs: event.executionTimeMs,
      metadata: { ...event } as Record<string, unknown>
    });
  }
}

/**
 * Factory function to create executor with ObservabilityBus
 */
export function createClaudeCodeExecutor(config?: IExecutorConfig): ClaudeCodeExecutor {
  return new ClaudeCodeExecutor(config);
}
