/**
 * Task Executor Types
 * TASK-FIX-006 - ClaudeCodeExecutor Foundation
 *
 * Implements: REQ-CONST-003 (internal execution pattern)
 * Constitution: RULE-033 (quality on result), RULE-076 (dependency injection)
 */

import type { IObservabilityBus } from '../observability/bus.js';

/**
 * Execution result from TaskExecutor
 */
export interface IExecutionResult {
  /** The actual LLM output content */
  content: string;
  /** Execution metadata */
  metadata: IExecutionMetadata;
}

/**
 * Execution metadata
 */
export interface IExecutionMetadata {
  /** Unique execution ID */
  executionId: string;
  /** Agent used for execution */
  agent: string;
  /** Execution time in milliseconds */
  executionTimeMs: number;
  /** Approximate token count (if available) */
  tokenCount?: number;
  /** Model used */
  model?: string;
  /** Success status */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * TaskExecutor interface
 * All executors must implement this interface
 */
export interface ITaskExecutor {
  /**
   * Execute a prompt and return the LLM response
   * @param prompt - The prompt to execute
   * @param agent - Optional agent type (e.g., 'coder', 'researcher')
   * @returns Execution result with content and metadata
   */
  execute(prompt: string, agent?: string): Promise<IExecutionResult>;
}

/**
 * Executor configuration
 */
export interface IExecutorConfig {
  /** ObservabilityBus for event emission (optional) */
  observabilityBus?: IObservabilityBus;
  /** Default agent if none specified */
  defaultAgent?: string;
  /** Execution timeout in milliseconds */
  timeoutMs?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Execution events emitted to ObservabilityBus
 */
export interface IExecutionStartEvent {
  executionId: string;
  prompt: string;
  promptLength: number;
  agent: string;
  timestamp: number;
}

export interface IExecutionCompleteEvent {
  executionId: string;
  prompt: string;
  output: string;
  outputLength: number;
  agent: string;
  executionTimeMs: number;
  success: boolean;
  error?: string;
  timestamp: number;
}
