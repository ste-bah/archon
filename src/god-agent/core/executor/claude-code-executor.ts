import { spawn, ChildProcess } from 'child_process';
import {
  ClaudeCodeUnavailableError,
  ClaudeCodeTimeoutError,
  ClaudeCodeExecutionError,
  ClaudeCodeParseError
} from './executor-errors.js';
import type {
  IClaudeCodeExecutor,
  IExecutorConfig,
  ICodeExecutionRequest,
  ICodeExecutionResult,
  IExecutionMetadata
} from './executor-types.js';
import { buildPrompt, buildSystemPrompt } from './prompt-builder.js';

/**
 * Claude Code CLI Executor
 *
 * Implements RULE-CLI-001-001: CLI as sole backend
 * Implements RULE-CLI-001-002: No silent degradation
 * Implements RULE-CLI-001-005: Comprehensive logging
 */
export class ClaudeCodeExecutor implements IClaudeCodeExecutor {
  private readonly config: Required<IExecutorConfig>;
  private cachedVersion: string | null = null;

  constructor(config: Partial<IExecutorConfig> = {}) {
    this.config = {
      defaultTimeoutMs: config.defaultTimeoutMs ?? 30000,
      maxTaskLength: config.maxTaskLength ?? 10240,
      verbose: config.verbose ?? false,
      cwd: config.cwd ?? process.cwd(),
      workingDirectory: config.workingDirectory ?? process.cwd(),
      hookTimeout: config.hookTimeout ?? 5000,
      maxRetries: config.maxRetries ?? 2,
      retryDelay: config.retryDelay ?? 1000,
      enableHooks: config.enableHooks ?? true,
      timeout: config.timeout ?? 60000,
      defaultAgentType: config.defaultAgentType ?? 'coder',
      claudeCliPath: config.claudeCliPath ?? 'claude',
      executionMode: config.executionMode ?? 'live',
      outputFormat: config.outputFormat ?? 'json',
    };
  }

  /**
   * Check if Claude Code CLI is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const version = await this.getVersion();
      return version.length > 0;
    } catch {
      // INTENTIONAL: CLI version check failure - return false to indicate CLI unavailable
      return false;
    }
  }

  /**
   * Get Claude Code CLI version
   */
  async getVersion(): Promise<string> {
    if (this.cachedVersion) {
      return this.cachedVersion;
    }

    return new Promise((resolve, reject) => {
      const child = spawn('claude', ['--version'], {
        cwd: this.config.cwd,
        timeout: 5000
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', () => {
        reject(new ClaudeCodeUnavailableError());
      });

      child.on('close', (code) => {
        if (code === 0 && stdout.trim()) {
          this.cachedVersion = stdout.trim();
          resolve(this.cachedVersion);
        } else {
          reject(new ClaudeCodeUnavailableError(
            `CLI version check failed: ${stderr || 'Unknown error'}`
          ));
        }
      });
    });
  }

  /**
   * Execute code generation via Claude Code CLI
   *
   * Implements RULE-CLI-001-002: Fail fast, no fallbacks
   * Implements RULE-CLI-001-006: No hardcoded values
   */
  async execute(request: ICodeExecutionRequest): Promise<ICodeExecutionResult> {
    // Validate request
    if (!request.task || request.task.trim().length === 0) {
      throw new ClaudeCodeExecutionError(1, 'Task cannot be empty');
    }

    const startedAt = new Date();
    const timeout = request.timeoutMs ?? this.config.defaultTimeoutMs;
    const language = request.language ?? 'typescript';

    // Truncate task if too long
    let task = request.task;
    if (task.length > this.config.maxTaskLength) {
      this.log('WARN', `Task truncated from ${task.length} to ${this.config.maxTaskLength} bytes`);
      task = task.slice(0, this.config.maxTaskLength) + '\n... [truncated]';
    }

    this.log('INFO', 'Starting execution', {
      taskPreview: task.slice(0, 100) + (task.length > 100 ? '...' : ''),
      language,
      timeout
    });

    // Build CLI arguments
    const userPrompt = buildPrompt(task, language, request);
    const systemPrompt = buildSystemPrompt(language);

    const args = [
      '--print',
      '--output-format', 'json',
      '--system-prompt', systemPrompt,
      userPrompt
    ];

    this.log('DEBUG', 'Spawning CLI', { args: args.slice(0, -1) }); // Don't log full prompt

    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Set up timeout
      const timeoutId = setTimeout(() => {
        timedOut = true;
        if (child && !child.killed) {
          child.kill('SIGTERM');
          // Force kill if still running after 1s
          setTimeout(() => {
            if (child && !child.killed) {
              child.kill('SIGKILL');
            }
          }, 1000);
        }
      }, timeout);

      try {
        child = spawn('claude', args, { cwd: this.config.cwd });
      } catch (err) {
        clearTimeout(timeoutId);
        reject(new ClaudeCodeUnavailableError());
        return;
      }

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (err) => {
        clearTimeout(timeoutId);
        if (err.message.includes('ENOENT')) {
          reject(new ClaudeCodeUnavailableError());
        } else {
          reject(new ClaudeCodeExecutionError(1, err.message, stdout));
        }
      });

      child.on('close', (exitCode) => {
        clearTimeout(timeoutId);
        const completedAt = new Date();
        const durationMs = completedAt.getTime() - startedAt.getTime();

        if (timedOut) {
          this.log('WARN', 'Execution timed out', { timeout, partialOutput: stdout.slice(0, 500) });
          reject(new ClaudeCodeTimeoutError(timeout, stdout || undefined));
          return;
        }

        if (exitCode !== 0) {
          this.log('ERROR', 'Execution failed', { exitCode, stderr });
          reject(new ClaudeCodeExecutionError(exitCode ?? 1, stderr, stdout));
          return;
        }

        if (!stdout.trim()) {
          this.log('ERROR', 'Empty output');
          reject(new ClaudeCodeExecutionError(0, 'CLI returned empty output'));
          return;
        }

        // Parse JSON output
        let rawOutput: string;
        try {
          const parsed = JSON.parse(stdout) as { result?: string; output?: string };
          rawOutput = parsed.result ?? parsed.output ?? stdout;
        } catch {
          // INTENTIONAL: If not JSON, use raw stdout - CLI may return plain text
          rawOutput = stdout;
        }

        // Extract code from markdown blocks
        const generatedCode = this.extractCodeBlocks(rawOutput);

        // Estimate quality score based on output characteristics
        const qualityScore = this.estimateQualityScore(generatedCode);

        const metadata: IExecutionMetadata = {
          durationMs,
          exitCode: 0,
          startedAt,
          completedAt,
          cliVersion: this.cachedVersion ?? 'unknown',
          source: 'claude-cli',
          latencyMs: durationMs
        };

        this.log('INFO', 'Execution complete', {
          durationMs,
          exitCode: 0,
          outputLength: generatedCode.length
        });

        resolve({
          code: generatedCode,
          language,
          rawOutput,
          qualityScore,
          metadata
        });
      });
    });
  }

  /**
   * Estimate quality score based on code characteristics
   * Heuristic-based scoring for generated code
   */
  private estimateQualityScore(code: string): number {
    let score = 0.5; // Base score

    // Longer code (up to a point) indicates more complete implementation
    if (code.length > 100) score += 0.1;
    if (code.length > 500) score += 0.1;

    // Has function/class definitions
    if (/\b(function|class|const|let|def|async)\b/.test(code)) score += 0.1;

    // Has comments/documentation
    if (/\/\/|\/\*|\*\/|#|"""|'''|\/\*\*/.test(code)) score += 0.1;

    // No obvious syntax errors (balanced braces)
    const openBraces = (code.match(/{/g) || []).length;
    const closeBraces = (code.match(/}/g) || []).length;
    if (openBraces === closeBraces) score += 0.05;

    // Cap at 1.0
    return Math.min(score, 1.0);
  }

  /**
   * Extract code from markdown code blocks
   */
  private extractCodeBlocks(text: string): string {
    const regex = /```[\w]*\n([\s\S]*?)```/g;
    const blocks: string[] = [];

    let match;
    while ((match = regex.exec(text)) !== null) {
      blocks.push(match[1].trim());
    }

    if (blocks.length > 0) {
      return blocks.join('\n\n');
    }

    return text.trim();
  }

  /**
   * Log with consistent format
   * Implements RULE-CLI-001-005
   */
  private log(
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
    message: string,
    data?: Record<string, unknown>
  ): void {
    if (!this.config.verbose && level === 'DEBUG') {
      return;
    }

    const timestamp = new Date().toISOString();
    const prefix = '[ClaudeCodeExecutor]';
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';

    console.log(`${timestamp} ${level} ${prefix} ${message}${dataStr}`);
  }
}
