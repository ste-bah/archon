/**
 * Base error class for Claude Code executor errors
 */
export abstract class ClaudeCodeError extends Error {
  abstract readonly code: string;
  abstract readonly remediation: string[];
  context?: Record<string, unknown>;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Get formatted error for logging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      remediation: this.remediation,
      context: this.context
    };
  }
}

/**
 * Thrown when Claude Code CLI is not found
 */
export class ClaudeCodeUnavailableError extends ClaudeCodeError {
  readonly code = 'CLI_UNAVAILABLE';
  readonly remediation = [
    'Install Claude Code CLI: npm install -g @anthropic/claude-code',
    'Verify installation: claude --version',
    'Ensure claude is in your PATH'
  ];

  constructor(message = 'Claude Code CLI not found in PATH') {
    super(message);
  }
}

/**
 * Thrown when CLI execution times out
 */
export class ClaudeCodeTimeoutError extends ClaudeCodeError {
  readonly code = 'CLI_TIMEOUT';
  readonly remediation = [
    'Increase timeout via config.timeoutMs',
    'Simplify the task description',
    'Check network connectivity',
    'Check Claude Code CLI status: claude doctor'
  ];

  constructor(
    public readonly timeoutMs: number,
    public readonly partialOutput?: string
  ) {
    super(`Claude Code CLI execution timed out after ${timeoutMs}ms`);
    this.context = { timeoutMs, partialOutput };
  }
}

/**
 * Thrown when CLI returns non-zero exit code
 */
export class ClaudeCodeExecutionError extends ClaudeCodeError {
  readonly code = 'CLI_EXECUTION_FAILED';
  readonly remediation = [
    'Check stderr output for details',
    'Verify Claude Code is authenticated: claude auth status',
    'Check API rate limits',
    'Try running the command manually for debugging'
  ];

  constructor(
    public readonly exitCode: number,
    public readonly stderr: string,
    public readonly stdout?: string
  ) {
    super(`Claude Code CLI failed with exit code ${exitCode}`);
    this.context = { exitCode, stderr, stdout };
  }
}

/**
 * Thrown when CLI output cannot be parsed
 */
export class ClaudeCodeParseError extends ClaudeCodeError {
  readonly code = 'CLI_PARSE_FAILED';
  readonly remediation = [
    'Check CLI output format: claude --output-format json ...',
    'Report this as a bug if the format changed'
  ];

  constructor(message: string, public readonly rawOutput: string) {
    super(message);
    this.context = { rawOutput };
  }
}
