/**
 * Hook Runner
 * TASK-EXE-001 - Execute pre and post hooks as bash commands
 *
 * Runs agent hooks (pre/post) defined in YAML frontmatter.
 * Hooks are non-fatal - failures are logged but don't stop execution.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { parse } from 'shell-quote';
import type { IHookResult, HookPhase } from './executor-types.js';

const execFileAsync = promisify(execFile);

// ==================== Security Constants (RULE-107) ====================

/**
 * Commands that are blocked in hook scripts for security.
 * These commands can cause system damage or privilege escalation.
 */
const BLOCKED_COMMANDS = [
  'rm',
  'sudo',
  'chmod',
  'chown',
  'dd',
  'mkfs',
  'fdisk',
  'kill',
  'killall',
] as const;

/**
 * Dangerous argument patterns that indicate destructive operations.
 * FLAG_PATTERNS must match the token exactly (e.g., -rf, -f).
 * PATH_PATTERNS can match within a token (e.g., /*, ../).
 */
const DANGEROUS_FLAG_PATTERNS = [
  '-rf',
  '-fr',
  '--recursive',
  '--force',
  '-f',
  '-r',
] as const;

const DANGEROUS_PATH_PATTERNS = [
  '/*',
  '../',
] as const;

/**
 * Environment variables allowed to be passed to hooks (RULE-108).
 * This allowlist prevents leaking sensitive values like API keys and secrets.
 * Only safe, non-sensitive system variables are included.
 */
const ENV_ALLOWLIST = [
  'PATH', 'HOME', 'USER', 'SHELL', 'TERM', 'LANG', 'LC_ALL',
  'NODE_ENV', 'TZ', 'PWD', 'TMPDIR', 'TEMP', 'TMP',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
  'COLORTERM', 'FORCE_COLOR', 'NO_COLOR',
] as const;

/**
 * Get filtered environment variables from process.env using allowlist.
 * This prevents sensitive environment variables (API keys, secrets) from
 * being passed to hook scripts.
 *
 * @returns Filtered environment object with only safe variables
 */
function getAllowedEnv(): Record<string, string> {
  const allowed: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) {
      allowed[key] = value;
    }
  }
  return allowed;
}

// ==================== Hook Runner ====================

/**
 * HookRunner
 *
 * Executes pre and post hooks as bash commands.
 * Provides environment variables and timeout handling.
 */
export class HookRunner {
  private workingDirectory: string;
  private timeout: number;
  private verbose: boolean;

  constructor(options: {
    workingDirectory?: string;
    timeout?: number;
    verbose?: boolean;
  } = {}) {
    this.workingDirectory = options.workingDirectory ?? process.cwd();
    this.timeout = options.timeout ?? 10000; // 10 seconds default
    this.verbose = options.verbose ?? false;
  }

  /**
   * Run a hook script
   *
   * @param script - Bash script to execute
   * @param phase - 'pre' or 'post'
   * @param agentName - Name of the agent (for logging and env vars)
   * @param env - Additional environment variables
   * @returns Hook execution result
   */
  async runHook(
    script: string | undefined,
    phase: HookPhase,
    agentName: string,
    env?: Record<string, string>
  ): Promise<IHookResult> {
    const startTime = Date.now();

    // Return success for empty/undefined scripts
    if (!script?.trim()) {
      return {
        success: true,
        stdout: '',
        stderr: '',
        duration: 0,
      };
    }

    try {
      // Build environment - SECURITY: Use allowlisted env vars only (RULE-108)
      // This prevents leaking API keys, secrets, and other sensitive values
      const hookEnv = {
        ...getAllowedEnv(),         // Only safe, non-sensitive vars
        AGENT_NAME: agentName,
        TASK: agentName,
        HOOK_PHASE: phase,
        GOD_AGENT_HOOK: 'true',     // Marker for hook context detection
        ...env,                      // User-provided vars (trusted)
      };

      if (this.verbose) {
        console.log(`[HookRunner] Running ${phase}-hook for ${agentName}`);
      }

      // Execute script - SECURITY: Using execFile with explicit shell: false
      // to prevent command injection (RULE-106). The script is passed as an
      // argument to /bin/bash rather than interpreted by a shell directly.
      const { stdout, stderr } = await execFileAsync('/bin/bash', ['-c', script], {
        cwd: this.workingDirectory,
        timeout: this.timeout,
        env: hookEnv,
        shell: false, // Explicit: no shell interpretation of arguments
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      const duration = Date.now() - startTime;

      if (this.verbose) {
        console.log(`[HookRunner] ${phase}-hook completed in ${duration}ms`);
        if (stdout) console.log(`[HookRunner] stdout: ${stdout.slice(0, 200)}...`);
      }

      return {
        success: true,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        duration,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check for timeout
      const isTimeout = errorMessage.includes('ETIMEDOUT') ||
                        errorMessage.includes('killed') ||
                        duration >= this.timeout;

      if (this.verbose || isTimeout) {
        console.warn(
          `[HookRunner] ${phase}-hook ${isTimeout ? 'timed out' : 'failed'} for ${agentName}: ${errorMessage}`
        );
      }

      return {
        success: false,
        stdout: '',
        stderr: errorMessage,
        duration,
        error: isTimeout ? `Hook timed out after ${this.timeout}ms` : errorMessage,
      };
    }
  }

  /**
   * Run pre-hook for an agent
   */
  async runPreHook(
    script: string | undefined,
    agentName: string,
    env?: Record<string, string>
  ): Promise<IHookResult> {
    return this.runHook(script, 'pre', agentName, env);
  }

  /**
   * Run post-hook for an agent
   */
  async runPostHook(
    script: string | undefined,
    agentName: string,
    env?: Record<string, string>
  ): Promise<IHookResult> {
    return this.runHook(script, 'post', agentName, env);
  }

  /**
   * Validate hook script using shell-quote parser (RULE-107)
   *
   * Uses proper tokenization to detect dangerous commands and patterns,
   * preventing bypass attempts using extra spaces, quotes, or escape sequences.
   *
   * @param script - The hook script to validate
   * @returns Validation result with warnings
   */
  validateHookScript(script: string): { valid: boolean; warnings: string[] } {
    const warnings: string[] = [];

    try {
      // Parse script into tokens using shell-quote (RULE-107 compliance)
      // This properly handles spaces, quotes, escapes, etc.
      const tokens = parse(script);

      for (const token of tokens) {
        // Skip non-string tokens (operators, special shell constructs)
        if (typeof token !== 'string') continue;

        // Normalize token for comparison (handle case variations)
        const normalizedToken = token.toLowerCase();

        // Check for blocked commands
        for (const blockedCmd of BLOCKED_COMMANDS) {
          if (normalizedToken === blockedCmd || normalizedToken.endsWith(`/${blockedCmd}`)) {
            warnings.push(`Blocked command detected: ${token}`);
          }
        }

        // Check for dangerous flag patterns (exact match to avoid false positives)
        for (const flag of DANGEROUS_FLAG_PATTERNS) {
          if (token === flag) {
            warnings.push(`Dangerous flag detected: ${flag}`);
          }
        }

        // Check for dangerous path patterns (substring match for paths)
        for (const pathPattern of DANGEROUS_PATH_PATTERNS) {
          if (token.includes(pathPattern)) {
            warnings.push(`Dangerous path pattern detected: ${pathPattern} in "${token}"`);
          }
        }
      }

      // Additional check for sudo anywhere (including in pipes, subshells, etc.)
      // This is a secondary check because sudo could appear in complex constructs
      if (script.toLowerCase().includes('sudo')) {
        // Avoid duplicate warnings if already detected via tokenization
        const hasSudoWarning = warnings.some(w => w.includes('sudo'));
        if (!hasSudoWarning) {
          warnings.push('Hook uses sudo - may require elevated privileges');
        }
      }

      // Warn if no memorygraph commands (helpful but not blocking)
      if (!script.includes('memorygraph') && !script.includes('echo')) {
        warnings.push('Hook may be missing memorygraph memory commands');
      }

    } catch (parseError) {
      // If shell-quote fails to parse, treat as suspicious
      warnings.push(
        `Script parse error: ${parseError instanceof Error ? parseError.message : 'unknown'}`
      );
    }

    // Script is invalid if any blocked command or dangerous pattern was found
    const hasBlockingIssues = warnings.some(
      w => w.includes('Blocked') || w.includes('Dangerous')
    );

    return {
      valid: !hasBlockingIssues,
      warnings,
    };
  }

  /**
   * Update configuration
   */
  setConfig(options: {
    workingDirectory?: string;
    timeout?: number;
    verbose?: boolean;
  }): void {
    if (options.workingDirectory !== undefined) {
      this.workingDirectory = options.workingDirectory;
    }
    if (options.timeout !== undefined) {
      this.timeout = options.timeout;
    }
    if (options.verbose !== undefined) {
      this.verbose = options.verbose;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): { workingDirectory: string; timeout: number; verbose: boolean } {
    return {
      workingDirectory: this.workingDirectory,
      timeout: this.timeout,
      verbose: this.verbose,
    };
  }
}

// ==================== Factory ====================

/**
 * Create a hook runner with default configuration
 */
export function createHookRunner(options?: {
  workingDirectory?: string;
  timeout?: number;
  verbose?: boolean;
}): HookRunner {
  return new HookRunner(options);
}
