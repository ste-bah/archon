#!/usr/bin/env npx tsx
/**
 * Claude Code Hooks - Pre-Task Hook
 *
 * Implements: TECH-HKS-001 Pre-Task Hook Component
 * Constitution: REQ-HKS-001, REQ-HKS-002, REQ-HKS-003, REQ-HKS-004, REQ-HKS-010, REQ-HKS-011, REQ-HKS-021
 *
 * Entry point for pre-task hook called by .claude/hooks/pre-task.sh
 *
 * Exit codes:
 *   0: Success (enhanced prompt on stdout)
 *   1: Error (InteractionStore/OrchestrationMemoryManager failures)
 *   2: Validation failure (invalid input, directory traversal)
 *   3: Timeout (execution exceeded limit)
 *
 * @module scripts/hooks/pre-task
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { InteractionStore } from '../../src/god-agent/universal/interaction-store.js';
import { ContextInjector } from './context-injector.js';
import { handlePreTask as trackPipelineStep } from './pipeline-event-emitter.js';
import {
  type IHookConfig,
  DEFAULT_HOOK_CONFIG,
  AGENT_TYPE_PATTERNS,
  EXIT_CODES,
  ValidationError,
  TimeoutError,
  ConfigurationError
} from './hook-types.js';
import { createHookLogger, createHookError, logErrorAndExit } from './hook-logger.js';

// ==================== Constants ====================

const CONFIG_FILE_PATH = '.claude/hooks/config.json';
const PROJECT_ROOT = process.cwd();

// ==================== Configuration Loading ====================

/**
 * Load hook configuration from file and environment
 *
 * Implements: REQ-HKS-014, REQ-HKS-015
 */
async function loadConfiguration(): Promise<IHookConfig> {
  const config: IHookConfig = { ...DEFAULT_HOOK_CONFIG };

  // Try reading config file
  try {
    const configPath = path.join(PROJECT_ROOT, CONFIG_FILE_PATH);
    const data = await fs.readFile(configPath, 'utf-8');
    const fileConfig = JSON.parse(data);

    // Merge file config with defaults
    if (fileConfig.performance?.preTaskBudgetMs) {
      config.preTaskTimeoutMs = fileConfig.performance.preTaskBudgetMs;
    }
    if (fileConfig.performance?.postTaskBudgetMs) {
      config.postTaskTimeoutMs = fileConfig.performance.postTaskBudgetMs;
    }
    if (fileConfig.memory?.domains) {
      config.memoryDomains = fileConfig.memory.domains;
    }
    if (fileConfig.memory?.maxContextSize) {
      config.maxContextSize = fileConfig.memory.maxContextSize;
    }
    if (fileConfig.logging?.level === 'DEBUG') {
      config.verbose = true;
    }
  } catch (error) {
    // Config file missing or corrupt - use defaults
    // This is non-fatal per FM-HKS-007
  }

  // Apply environment variable overrides (highest priority)
  if (process.env.HOOKS_TIMEOUT_MS) {
    config.preTaskTimeoutMs = parseInt(process.env.HOOKS_TIMEOUT_MS, 10);
    config.postTaskTimeoutMs = parseInt(process.env.HOOKS_TIMEOUT_MS, 10);
  }
  if (process.env.HOOKS_VERBOSE === 'true') {
    config.verbose = true;
  }
  if (process.env.HOOKS_MEMORY_DB_PATH) {
    config.memoryDbPath = process.env.HOOKS_MEMORY_DB_PATH;
  }
  if (process.env.HOOKS_RETRY_ATTEMPTS) {
    config.retryAttempts = parseInt(process.env.HOOKS_RETRY_ATTEMPTS, 10);
  }
  if (process.env.HOOKS_RETRY_DELAY_MS) {
    config.retryDelayMs = parseInt(process.env.HOOKS_RETRY_DELAY_MS, 10);
  }

  return config;
}

// ==================== Input Parsing ====================

/**
 * Parse Task() prompt from arguments or stdin
 *
 * When called by Claude Code's Task tool, stdin may not be available.
 * In that case, return empty string to allow hook to proceed without context injection.
 */
async function parsePrompt(): Promise<string> {
  // Check command line argument first
  if (process.argv[2]) {
    return process.argv[2];
  }

  // Check environment variable (Claude Code may set this)
  if (process.env.CLAUDE_TASK_PROMPT) {
    return process.env.CLAUDE_TASK_PROMPT;
  }

  // If stdin is TTY (interactive), return empty - no prompt available
  if (process.stdin.isTTY) {
    return '';
  }

  // Try to read from stdin with a short timeout
  return new Promise((resolve) => {
    let data = '';
    let resolved = false;

    const finish = (result: string) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      finish(data.trim());
    });
    process.stdin.on('error', () => {
      finish('');
    });

    // Short timeout - if no stdin data within 500ms, proceed without it
    setTimeout(() => {
      finish(data.trim());
    }, 500);
  });
}

// ==================== Validation ====================

/**
 * Validate prompt for security issues
 *
 * Implements: REQ-HKS-021, SEC-HKS-002, SEC-HKS-003
 */
function validatePrompt(prompt: string): void {
  const violations: string[] = [];

  // Length check (max 200KB before context injection)
  const maxBytes = 200 * 1024;
  if (Buffer.byteLength(prompt, 'utf-8') > maxBytes) {
    violations.push(`Prompt exceeds ${maxBytes} bytes`);
  }

  // Directory traversal check - only flag dangerous traversal, not code import paths
  // Allow: '../file.js', '../../module/index.ts' (legitimate relative imports in code)
  // Block: '../../../etc/passwd', '..\\..\\Windows\\System32' (actual traversal attacks)
  // Pattern: 3+ levels of traversal OR traversal to system directories
  const dangerousTraversalPattern = /(?:\.\.[\\/]){3,}|\.\.[\\/](?:\.\.[\\/])*(?:etc|var|usr|root|Windows|System32)/i;
  if (dangerousTraversalPattern.test(prompt)) {
    violations.push('Dangerous directory traversal pattern detected');
  }

  // Absolute path check (truly dangerous system paths only)
  // Note: /home/ is allowed since projects typically live there
  // Only block sensitive system directories
  const dangerousPathPattern = /(?:\/(?:etc|usr\/(?:bin|sbin)|var\/(?:log|run)|root)\/|[A-Z]:\\(?:Windows|System32))/g;
  const dangerousMatches = prompt.match(dangerousPathPattern);
  if (dangerousMatches) {
    violations.push(`Potentially dangerous system paths: ${dangerousMatches.join(', ')}`);
  }

  // SQL injection patterns (basic)
  const sqlPatterns = /(?:;--|'\s*OR\s+'1'\s*=\s*'1|UNION\s+SELECT)/gi;
  if (sqlPatterns.test(prompt)) {
    violations.push('SQL injection pattern detected');
  }

  if (violations.length > 0) {
    throw new ValidationError(`Prompt validation failed: ${violations.join('; ')}`, violations);
  }
}

// ==================== Agent Type Detection ====================

/**
 * Detect agent type from prompt patterns
 *
 * Implements: REQ-HKS-003
 */
function detectAgentType(prompt: string): string {
  const promptLower = prompt.toLowerCase();

  for (const [agentType, patterns] of Object.entries(AGENT_TYPE_PATTERNS)) {
    if (patterns.some(pattern => pattern.test(promptLower))) {
      return agentType;
    }
  }

  return 'coder'; // Default fallback
}

// ==================== Domain/Tags Extraction ====================

/**
 * Extract domain and tags from prompt
 */
function extractDomainTags(prompt: string): { domain: string; tags: string[] } {
  // Look for explicit domain in prompt
  const domainMatch = prompt.match(/Domain:\s*['"`]?([^'"`\n,]+)['"`]?/i);

  // Look for explicit tags
  const tagsMatch = prompt.match(/Tags:\s*\[?['"`]?([^'\]`\n]+)['"`]?\]?/i);

  let domain = 'project/general';
  const tags: string[] = [];

  if (domainMatch) {
    domain = domainMatch[1].trim();
    if (!domain.startsWith('project/')) {
      domain = `project/${domain}`;
    }
  } else {
    // Infer from context
    if (/\bapi\b/i.test(prompt)) domain = 'project/api';
    else if (/\bfrontend\b/i.test(prompt)) domain = 'project/frontend';
    else if (/\bdatabase\b|\bschema\b/i.test(prompt)) domain = 'project/database';
    else if (/\btest\b/i.test(prompt)) domain = 'project/tests';
  }

  if (tagsMatch) {
    const tagsStr = tagsMatch[1];
    const parsedTags = tagsStr
      .replace(/['"]/g, '')
      .split(/,\s*/)
      .map(t => t.trim())
      .filter(t => t.length > 0 && t.length <= 50);
    tags.push(...parsedTags);
  }

  return { domain, tags };
}

// ==================== Timeout Wrapper ====================

/**
 * Execute async function with timeout
 *
 * Implements: REQ-HKS-016, REQ-HKS-017
 */
async function executeWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T> {
  const startTime = Date.now();

  return Promise.race([
    fn(),
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        const elapsed = Date.now() - startTime;
        reject(new TimeoutError(
          `${operationName} timed out after ${elapsed}ms`,
          elapsed,
          { operation: operationName, startTime }
        ));
      }, timeoutMs);
    })
  ]);
}

// ==================== InteractionStore Initialization ====================

/**
 * Initialize InteractionStore with retry
 */
async function initInteractionStore(config: IHookConfig, logger: ReturnType<typeof createHookLogger>): Promise<InteractionStore> {
  const storageDir = path.dirname(path.join(PROJECT_ROOT, config.memoryDbPath));

  const store = new InteractionStore({ storageDir });

  // Try to load existing data with retry
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await store.load();
      logger.debug('InteractionStore loaded', { storageDir, attempt });
      return store;
    } catch (error) {
      lastError = error as Error;
      logger.warn('InteractionStore load failed, retrying', {
        attempt,
        error: lastError.message
      });

      // Wait 1s before retry
      if (attempt < 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  // Both attempts failed - throw error (NO fallback per AP-001)
  throw lastError || new Error('InteractionStore initialization failed');
}

// ==================== Main Entry Point ====================

/**
 * Pre-task hook main function
 */
async function main(): Promise<void> {
  const startTime = Date.now();

  // 1. Load configuration
  const config = await loadConfiguration();
  const logger = createHookLogger('pre-task', config.verbose);

  logger.info('Pre-task hook started');

  try {
    // 2. Parse Task() prompt
    const prompt = await parsePrompt();
    logger.debug('Prompt parsed', { promptLength: prompt.length });

    // 2.5. Early exit if no prompt available (Claude Code Task tool doesn't pipe stdin)
    if (!prompt || prompt.trim() === '') {
      logger.info('No prompt provided, skipping context injection');
      process.exit(EXIT_CODES.SUCCESS);
    }

    // 3. Validate prompt
    validatePrompt(prompt);
    logger.debug('Prompt validated');

    // 4. Detect agent type
    const agentType = detectAgentType(prompt);
    logger.debug('Agent type detected', { agentType });

    // 4.5. Track pipeline step if in pipeline context (non-blocking)
    trackPipelineStep(prompt).catch(err => {
      logger.debug('Pipeline tracking skipped', { error: (err as Error).message });
    });

    // 5. Extract domain/tags
    const { domain, tags } = extractDomainTags(prompt);
    logger.debug('Domain/tags extracted', { domain, tags });

    // 6. Initialize InteractionStore with timeout
    const interactionStore = await executeWithTimeout(
      () => initInteractionStore(config, logger),
      config.preTaskTimeoutMs,
      'InteractionStore initialization'
    );

    // 7. Create ContextInjector
    const contextInjector = new ContextInjector(interactionStore, config);

    // 8. Inject context with timeout
    const result = await executeWithTimeout(
      () => contextInjector.inject(prompt, domain, tags),
      config.preTaskTimeoutMs - (Date.now() - startTime),
      'Context injection'
    );

    logger.debug('Context injection complete', {
      entryCount: result.entryCount,
      tokenCount: result.tokenCount,
      wasTruncated: result.wasTruncated
    });

    // 9. Output enhanced prompt to stdout
    process.stdout.write(result.enhancedPrompt);

    // 10. Log performance metrics
    const duration = Date.now() - startTime;
    logger.info('Pre-task hook completed', {
      duration,
      agentType,
      domain,
      contextEntries: result.entryCount,
      contextTokens: result.tokenCount
    });

    // Exit successfully
    process.exit(EXIT_CODES.SUCCESS);

  } catch (error) {
    const hookError = createHookError(
      'pre-task',
      error instanceof TimeoutError ? 'timeout' :
      error instanceof ValidationError ? 'validation' :
      error instanceof ConfigurationError ? 'configuration' :
      'execution',
      error as Error,
      {
        duration: Date.now() - startTime
      },
      error instanceof TimeoutError ? EXIT_CODES.TIMEOUT :
      error instanceof ValidationError ? EXIT_CODES.VALIDATION_FAILURE :
      error instanceof ConfigurationError ? EXIT_CODES.VALIDATION_FAILURE :
      EXIT_CODES.ERROR
    );

    // Log error and exit (never returns)
    logErrorAndExit(hookError);
  }
}

// Run main
main().catch(error => {
  // Final catch - should never reach here
  console.error('[pre-task] FATAL: Unhandled error:', error);
  process.exit(EXIT_CODES.ERROR);
});
