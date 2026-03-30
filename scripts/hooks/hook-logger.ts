/**
 * Claude Code Hooks - Logger Utility
 *
 * Implements: TECH-HKS-001 (logging requirements)
 * Constitution: GUARD-HKS-001, GUARD-HKS-006, GUARD-HKS-008
 *
 * Log format: [YYYY-MM-DD HH:mm:ss] [pre-task|post-task] LEVEL: message {json_context}
 *
 * CRITICAL: All errors logged with full context BEFORE propagating (GUARD-HKS-001)
 * CRITICAL: No sensitive data in logs (GUARD-HKS-006)
 *
 * @module scripts/hooks/hook-logger
 */

import type { IHookLogger, IHookError, ExitCode } from './hook-types.js';
import { EXIT_CODES } from './hook-types.js';

/**
 * Patterns for sensitive data redaction
 */
const SENSITIVE_PATTERNS = [
  /[a-zA-Z0-9_-]{32,}/g,  // Likely API keys/tokens
  /sk-[a-zA-Z0-9]{20,}/g,  // OpenAI-style keys
  /Bearer\s+[a-zA-Z0-9._-]+/gi,  // Bearer tokens
  /password['":\s]*['""]?[^'"\s,}]+/gi,  // Passwords
  /secret['":\s]*['""]?[^'"\s,}]+/gi,  // Secrets
  /api[_-]?key['":\s]*['""]?[^'"\s,}]+/gi,  // API keys
];

/**
 * Redact sensitive data from a string
 * Implements: SEC-HKS-001, GUARD-HKS-006
 */
function redactSensitive(input: string): string {
  let result = input;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

/**
 * Redact sensitive data from an object recursively
 */
function redactObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return redactSensitive(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => redactObject(item));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // Redact known sensitive field names
      if (/password|secret|token|key|credential/i.test(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactObject(value);
      }
    }
    return result;
  }

  return obj;
}

/**
 * Format timestamp for logging
 */
function formatTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/**
 * Format context object for logging
 */
function formatContext(context: Record<string, unknown> | undefined): string {
  if (!context || Object.keys(context).length === 0) {
    return '';
  }
  return ' ' + JSON.stringify(redactObject(context));
}

/**
 * Log levels
 */
type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

/**
 * Create a hook logger instance
 *
 * @param phase - Hook phase (pre-task or post-task)
 * @param verbose - Enable DEBUG level logging
 * @returns Logger instance
 */
export function createHookLogger(phase: 'pre-task' | 'post-task', verbose: boolean = false): IHookLogger {
  const log = (level: LogLevel, message: string, context?: Record<string, unknown>): void => {
    // Skip DEBUG unless verbose is enabled
    if (level === 'DEBUG' && !verbose) {
      return;
    }

    const timestamp = formatTimestamp();
    const contextStr = formatContext(context);
    const logLine = `[${timestamp}] [${phase}] ${level}: ${message}${contextStr}`;

    // Use appropriate console method
    switch (level) {
      case 'ERROR':
        console.error(logLine);
        break;
      case 'WARN':
        console.warn(logLine);
        break;
      case 'INFO':
        console.log(logLine);
        break;
      case 'DEBUG':
        console.log(logLine);
        break;
    }
  };

  return {
    error: (message: string, context?: Record<string, unknown>) => log('ERROR', message, context),
    warn: (message: string, context?: Record<string, unknown>) => log('WARN', message, context),
    info: (message: string, context?: Record<string, unknown>) => log('INFO', message, context),
    debug: (message: string, context?: Record<string, unknown>) => log('DEBUG', message, context),
  };
}

/**
 * Log a hook error with full context before propagation
 *
 * Implements: GUARD-HKS-001 (every catch block must log with ERROR level)
 *
 * @param hookError - Structured error context
 */
export function logHookError(hookError: IHookError): void {
  const logger = createHookLogger(hookError.phase, true);

  const errorContext = {
    operation: hookError.operation,
    error: {
      message: hookError.error.message,
      name: hookError.error.name,
      stack: hookError.error.stack,
    },
    context: redactObject(hookError.context),
    timestamp: new Date(hookError.timestamp).toISOString(),
    exitCode: hookError.exitCode,
  };

  logger.error(`${hookError.operation} failed`, errorContext as Record<string, unknown>);
}

/**
 * Create a structured hook error
 *
 * @param phase - Hook phase
 * @param operation - Operation that failed
 * @param error - Original error
 * @param context - Additional context
 * @param exitCode - Exit code to use
 * @returns Structured hook error
 */
export function createHookError(
  phase: 'pre-task' | 'post-task',
  operation: string,
  error: Error,
  context: Record<string, unknown> = {},
  exitCode: ExitCode = EXIT_CODES.ERROR
): IHookError {
  return {
    phase,
    operation,
    error,
    context,
    timestamp: Date.now(),
    exitCode: exitCode === EXIT_CODES.SUCCESS ? EXIT_CODES.ERROR : exitCode as 1 | 2 | 3,
  };
}

/**
 * Log and exit with error
 *
 * Implements: AP-003 (no silent failures)
 *
 * @param hookError - Structured error context
 */
export function logErrorAndExit(hookError: IHookError): never {
  logHookError(hookError);
  process.exit(hookError.exitCode);
}
