// Types
export type {
  IExecutorConfig,
  ICodeExecutionRequest,
  ICodeExecutionResult,
  IExecutionMetadata,
  IClaudeCodeExecutor
} from './executor-types.js';

// Errors
export {
  ClaudeCodeError,
  ClaudeCodeUnavailableError,
  ClaudeCodeTimeoutError,
  ClaudeCodeExecutionError,
  ClaudeCodeParseError
} from './executor-errors.js';

// Main class
export { ClaudeCodeExecutor } from './claude-code-executor.js';

// Task executor (for orchestration)
// NOTE: ClaudeTaskExecutor temporarily commented out due to missing types
// TODO: Add missing types (IHookResult, IExecutionResult, ITaskSpawnOptions, DEFAULT_EXECUTOR_CONFIG)
// export { ClaudeTaskExecutor } from './claude-task-executor.js';

// Utilities
export { buildPrompt, buildSystemPrompt } from './prompt-builder.js';
