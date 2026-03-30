/**
 * MockExecutor - Test double for TaskExecutor
 * TASK-FIX-007 - Enables unit testing without LLM calls
 *
 * Implements: NFR-TEST-001, REQ-CONST-003
 *
 * This mock allows tests to:
 * 1. Configure predetermined responses for specific prompts
 * 2. Verify execution was called (not just prompt pass-through)
 * 3. Inspect call history for assertions
 * 4. Test error scenarios
 */

import type {
  ITaskExecutor,
  IExecutionResult,
  IExecutionMetadata,
  IExecutorConfig
} from '../../src/god-agent/core/execution/types.js';
import type { IObservabilityBus } from '../../src/god-agent/core/observability/bus.js';

/**
 * Mock response configuration
 */
export interface IMockResponse {
  /** The response content to return */
  content: string;
  /** Optional delay in milliseconds */
  delayMs?: number;
  /** Whether to throw an error instead */
  shouldError?: boolean;
  /** Error message if shouldError is true */
  errorMessage?: string;
}

/**
 * Call log entry for test assertions
 */
export interface IMockCallLogEntry {
  /** The prompt that was executed */
  prompt: string;
  /** The agent type used */
  agent: string;
  /** Timestamp of the call */
  timestamp: number;
  /** The response returned */
  response: string;
  /** Whether execution succeeded */
  success: boolean;
}

/**
 * MockExecutor configuration
 */
export interface IMockExecutorConfig extends IExecutorConfig {
  /** Default response when no pattern matches */
  defaultResponse?: string;
}

/**
 * MockExecutor
 *
 * Test double for ClaudeCodeExecutor that:
 * - Returns configurable responses based on prompt patterns
 * - Logs all calls for test assertions
 * - Emits events to ObservabilityBus (if provided)
 * - Supports error simulation
 */
export class MockExecutor implements ITaskExecutor {
  private readonly bus: IObservabilityBus | null;
  private readonly defaultAgent: string;
  private readonly defaultResponse: string;

  /** Map of prompt patterns to responses */
  private readonly responses: Map<string, IMockResponse> = new Map();

  /** Log of all execution calls */
  private readonly callLog: IMockCallLogEntry[] = [];

  /** Execution counter for unique IDs */
  private executionCount: number = 0;

  constructor(config: IMockExecutorConfig = {}) {
    this.bus = config.observabilityBus ?? null;
    this.defaultAgent = config.defaultAgent ?? 'mock';
    this.defaultResponse = config.defaultResponse ?? 'Mock response';
  }

  // ===========================================================================
  // Response Configuration
  // ===========================================================================

  /**
   * Set a response for a specific prompt (exact match)
   */
  setResponse(prompt: string, response: string): void {
    this.responses.set(prompt, { content: response });
  }

  /**
   * Set a detailed response configuration
   */
  setResponseConfig(prompt: string, config: IMockResponse): void {
    this.responses.set(prompt, config);
  }

  /**
   * Set response for prompts containing a substring
   */
  setResponseForSubstring(substring: string, response: string): void {
    this.responses.set(`__SUBSTR__${substring}`, { content: response });
  }

  /**
   * Set response to simulate an error
   */
  setErrorResponse(prompt: string, errorMessage: string): void {
    this.responses.set(prompt, {
      content: '',
      shouldError: true,
      errorMessage
    });
  }

  /**
   * Clear all configured responses
   */
  clearResponses(): void {
    this.responses.clear();
  }

  // ===========================================================================
  // ITaskExecutor Implementation
  // ===========================================================================

  /**
   * Execute a prompt and return mock response
   */
  async execute(prompt: string, agent?: string): Promise<IExecutionResult> {
    const executionId = this.generateExecutionId();
    const agentType = agent ?? this.defaultAgent;
    const startTime = Date.now();

    // Emit start event if bus available
    this.emitStartEvent(executionId, prompt, agentType, startTime);

    // Find matching response
    const responseConfig = this.findResponse(prompt);

    // Handle delay simulation
    if (responseConfig.delayMs) {
      await this.delay(responseConfig.delayMs);
    }

    // Handle error simulation
    if (responseConfig.shouldError) {
      const error = new Error(responseConfig.errorMessage ?? 'Mock error');

      this.logCall(prompt, agentType, '', false);
      this.emitCompleteEvent(executionId, prompt, '', agentType, Date.now() - startTime, false, responseConfig.errorMessage);

      throw error;
    }

    const response = responseConfig.content;
    const executionTimeMs = Date.now() - startTime;

    // Log the call
    this.logCall(prompt, agentType, response, true);

    // Emit complete event
    this.emitCompleteEvent(executionId, prompt, response, agentType, executionTimeMs, true);

    // Create metadata
    const metadata: IExecutionMetadata = {
      executionId,
      agent: agentType,
      executionTimeMs,
      tokenCount: Math.ceil((prompt.length + response.length) / 4),
      model: 'mock',
      success: true
    };

    return { content: response, metadata };
  }

  // ===========================================================================
  // Test Utilities
  // ===========================================================================

  /**
   * Get the call log for assertions
   */
  getCallLog(): IMockCallLogEntry[] {
    return [...this.callLog];
  }

  /**
   * Get the number of times execute was called
   */
  getCallCount(): number {
    return this.callLog.length;
  }

  /**
   * Check if execute was called with a specific prompt
   */
  wasCalledWith(prompt: string): boolean {
    return this.callLog.some(entry => entry.prompt === prompt);
  }

  /**
   * Check if execute was called with a prompt containing substring
   */
  wasCalledWithContaining(substring: string): boolean {
    return this.callLog.some(entry => entry.prompt.includes(substring));
  }

  /**
   * Get the last call entry
   */
  getLastCall(): IMockCallLogEntry | undefined {
    return this.callLog[this.callLog.length - 1];
  }

  /**
   * Get calls for a specific agent type
   */
  getCallsForAgent(agent: string): IMockCallLogEntry[] {
    return this.callLog.filter(entry => entry.agent === agent);
  }

  /**
   * Reset the mock (clears call log but keeps responses)
   */
  reset(): void {
    this.callLog.length = 0;
    this.executionCount = 0;
  }

  /**
   * Full reset (clears everything)
   */
  resetAll(): void {
    this.reset();
    this.clearResponses();
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private generateExecutionId(): string {
    this.executionCount++;
    return `mock_exec_${this.executionCount}`;
  }

  private findResponse(prompt: string): IMockResponse {
    // Check exact match first
    if (this.responses.has(prompt)) {
      return this.responses.get(prompt)!;
    }

    // Check substring matches
    for (const [key, value] of this.responses) {
      if (key.startsWith('__SUBSTR__')) {
        const substring = key.slice(10);
        if (prompt.includes(substring)) {
          return value;
        }
      }
    }

    // Return default
    return { content: this.defaultResponse };
  }

  private logCall(prompt: string, agent: string, response: string, success: boolean): void {
    this.callLog.push({
      prompt,
      agent,
      timestamp: Date.now(),
      response,
      success
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private emitStartEvent(
    executionId: string,
    prompt: string,
    agent: string,
    timestamp: number
  ): void {
    if (!this.bus) return;

    this.bus.emit({
      component: 'agent',
      operation: 'execution:start',
      status: 'running',
      metadata: {
        executionId,
        prompt,
        promptLength: prompt.length,
        agent,
        timestamp
      }
    });
  }

  private emitCompleteEvent(
    executionId: string,
    prompt: string,
    output: string,
    agent: string,
    executionTimeMs: number,
    success: boolean,
    error?: string
  ): void {
    if (!this.bus) return;

    this.bus.emit({
      component: 'agent',
      operation: 'execution:complete',
      status: success ? 'success' : 'error',
      durationMs: executionTimeMs,
      metadata: {
        executionId,
        prompt,
        output,
        outputLength: output.length,
        agent,
        executionTimeMs,
        success,
        error,
        timestamp: Date.now()
      }
    });
  }
}

/**
 * Factory function to create a MockExecutor
 */
export function createMockExecutor(config?: IMockExecutorConfig): MockExecutor {
  return new MockExecutor(config);
}

/**
 * Create a pre-configured mock for common testing scenarios
 */
export function createTestExecutor(responses?: Record<string, string>): MockExecutor {
  const mock = new MockExecutor({
    defaultResponse: 'Default test response'
  });

  if (responses) {
    for (const [prompt, response] of Object.entries(responses)) {
      mock.setResponse(prompt, response);
    }
  }

  return mock;
}
