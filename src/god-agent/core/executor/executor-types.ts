/**
 * Configuration for ClaudeCodeExecutor
 */
export interface IExecutorConfig {
  /** Default timeout in ms (default: 30000) */
  defaultTimeoutMs?: number;
  /** Max task length before truncation (default: 10240) */
  maxTaskLength?: number;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
  /** Working directory (default: process.cwd()) */
  cwd?: string;
  /** Working directory for hooks */
  workingDirectory?: string;
  /** Hook execution timeout in ms */
  hookTimeout?: number;
  /** Maximum retry attempts (default: 2) */
  maxRetries?: number;
  /** Delay between retries in ms (default: 1000) */
  retryDelay?: number;
  /** Enable hook execution */
  enableHooks?: boolean;
  /** Task execution timeout in ms (default: 60000) */
  timeout?: number;
  /** Default agent type for Task tool (default: 'coder') */
  defaultAgentType?: string;
  /** Path to Claude CLI */
  claudeCliPath?: string;
  /** Execution mode: 'live' or 'mock' */
  executionMode?: 'live' | 'mock';
  /** Output format for CLI */
  outputFormat?: 'json' | 'text';
}

/**
 * Default executor configuration
 */
export const DEFAULT_EXECUTOR_CONFIG: IExecutorConfig = {
  defaultTimeoutMs: 30000,
  maxTaskLength: 10240,
  verbose: false,
  cwd: process.cwd(),
  workingDirectory: process.cwd(),
  hookTimeout: 5000,
  maxRetries: 2,
  retryDelay: 1000,
  enableHooks: true,
  timeout: 60000,
  defaultAgentType: 'coder',
  executionMode: 'live',
  outputFormat: 'json',
};

/**
 * Hook execution phase
 */
export type HookPhase = 'pre' | 'post';

/**
 * Result from hook execution
 */
export interface IHookResult {
  /** Whether hook succeeded */
  success: boolean;
  /** Hook output (stdout) */
  output?: string;
  /** Raw stdout */
  stdout?: string;
  /** Raw stderr */
  stderr?: string;
  /** Error message if failed */
  error?: string;
  /** Execution duration in ms */
  duration?: number;
}

/**
 * Internal execution result
 */
export interface IExecutionResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Agent output */
  output: string;
  /** Execution duration in ms */
  duration: number;
  /** Pre-hook result */
  preHookResult?: IHookResult;
  /** Post-hook result */
  postHookResult?: IHookResult;
  /** Error message if failed */
  error?: string;
  /** Number of retries attempted */
  retryCount: number;
}

/**
 * Options for spawning a Claude Task
 */
export interface ITaskSpawnOptions {
  /** Short description for logging */
  description: string;
  /** Full prompt to send */
  prompt: string;
  /** Optional system prompt */
  systemPrompt?: string;
  /** Subagent type for Task tool */
  subagentType: string;
  /** Execution timeout in ms */
  timeout?: number;
}

/**
 * Code execution request
 */
export interface ICodeExecutionRequest {
  /** The task to execute */
  task: string;
  /** Target language (default: 'typescript') */
  language?: string;
  /** Context from ReasoningBank patterns */
  patternContext?: string;
  /** User-provided context */
  userContext?: string;
  /** Additional context string (alternative to userContext) */
  context?: string;
  /** Code examples */
  examples?: string[];
  /** Constraints for generation */
  constraints?: string[];
  /** Override timeout */
  timeoutMs?: number;
  /** Maximum tokens for generation (advisory) */
  maxTokens?: number;
}

/**
 * Code execution result
 */
export interface ICodeExecutionResult {
  /** Generated code */
  code: string;
  /** Target language */
  language: string;
  /** Raw CLI output */
  rawOutput: string;
  /** Estimated quality score 0-1 */
  qualityScore: number;
  /** Execution metadata */
  metadata: IExecutionMetadata;
}

/**
 * Execution metadata
 */
export interface IExecutionMetadata {
  /** Duration in ms */
  durationMs: number;
  /** CLI exit code */
  exitCode: number;
  /** Start timestamp */
  startedAt: Date;
  /** End timestamp */
  completedAt: Date;
  /** CLI version */
  cliVersion: string;
  /** Source of generation (e.g., 'claude-cli') */
  source: string;
  /** Model used (if available) */
  model?: string;
  /** Tokens used (if available) */
  tokensUsed?: number;
  /** Latency in ms (alias for durationMs for compatibility) */
  latencyMs?: number;
}

/**
 * Executor interface
 */
export interface IClaudeCodeExecutor {
  execute(request: ICodeExecutionRequest): Promise<ICodeExecutionResult>;
  isAvailable(): Promise<boolean>;
  getVersion(): Promise<string>;
}
