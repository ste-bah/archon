/**
 * Execution Module Index
 * TASK-FIX-006 - Task Executor System
 *
 * Exports executor types, interfaces, and implementations
 */

// Types
export type {
  ITaskExecutor,
  IExecutionResult,
  IExecutionMetadata,
  IExecutorConfig,
  IExecutionStartEvent,
  IExecutionCompleteEvent
} from './types.js';

// Implementations
export {
  ClaudeCodeExecutor,
  createClaudeCodeExecutor
} from './claude-code-executor.js';
