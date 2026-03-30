/**
 * Causal Check Hook Handler
 *
 * Triggers on PreToolUse (Bash tool) to query for historical failure patterns
 * and warn about risky commands before execution.
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-HOOK-004
 *
 * @module scripts/hooks/causal-check
 */

import {
  PreToolUseInput,
  CausalCheckResponse,
  CausalPattern,
  PastFailure,
  EXIT_CODES,
} from './hook-types.js';
import { ActivityStream } from '../../src/god-agent/observability/index.js';

/** Minimum similarity threshold for pattern matching */
const MIN_SIMILARITY = 0.7;
/** Maximum number of past failures to return */
const MAX_FAILURES = 3;
/** Known risky command patterns */
const RISKY_PATTERNS = [
  { pattern: /rm\s+-rf?\s+\//, riskLevel: 0.95, description: 'Recursive delete from root' },
  { pattern: /rm\s+-rf?\s+\*/, riskLevel: 0.9, description: 'Recursive delete all' },
  { pattern: /chmod\s+777/, riskLevel: 0.85, description: 'Overly permissive permissions' },
  { pattern: />\s*\/dev\/sd[a-z]/, riskLevel: 0.95, description: 'Direct disk write' },
  { pattern: /dd\s+if=.*of=\/dev/, riskLevel: 0.95, description: 'Raw disk operation' },
  { pattern: /mkfs/, riskLevel: 0.9, description: 'Filesystem format' },
  { pattern: /:(){ :|:& };:/, riskLevel: 0.99, description: 'Fork bomb' },
  { pattern: /curl.*\|\s*bash/, riskLevel: 0.8, description: 'Pipe to shell' },
  { pattern: /wget.*\|\s*sh/, riskLevel: 0.8, description: 'Download and execute' },
  { pattern: /--force/, riskLevel: 0.6, description: 'Force operation' },
  { pattern: /--no-preserve-root/, riskLevel: 0.99, description: 'No preserve root' },
];

/**
 * Parse input from stdin
 */
async function readInput(): Promise<PreToolUseInput | null> {
  const chunks: string[] = [];

  process.stdin.setEncoding('utf-8');

  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  const input = chunks.join('');
  if (!input || input.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(input) as PreToolUseInput;
  } catch {
    return null;
  }
}

/**
 * Calculate command similarity using Levenshtein distance
 */
function calculateSimilarity(cmd1: string, cmd2: string): number {
  const s1 = cmd1.toLowerCase().trim();
  const s2 = cmd2.toLowerCase().trim();

  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0.0;

  // Simple token-based similarity
  const tokens1 = s1.split(/\s+/);
  const tokens2 = s2.split(/\s+/);

  const commonTokens = tokens1.filter((t) => tokens2.includes(t)).length;
  const totalTokens = Math.max(tokens1.length, tokens2.length);

  return commonTokens / totalTokens;
}

/**
 * Query for causal failure patterns
 * This is a simplified in-memory implementation for the hook
 * Full implementation would query GraphDB
 */
async function queryCausalPatterns(command: string): Promise<CausalPattern[]> {
  const patterns: CausalPattern[] = [];

  // Check against known risky patterns
  for (const risky of RISKY_PATTERNS) {
    if (risky.pattern.test(command)) {
      patterns.push({
        patternId: `risky-${Date.now()}`,
        command: risky.pattern.toString(),
        outcome: 'failure',
        similarity: risky.riskLevel,
        context: risky.description,
      });
    }
  }

  // Historical failure patterns (would come from GraphDB in full implementation)
  const historicalFailures = [
    {
      command: 'npm install',
      context: 'EACCES permission denied',
      similarity: 0.0,
    },
    {
      command: 'git push --force',
      context: 'Overwrote remote history',
      similarity: 0.0,
    },
    {
      command: 'rm -rf node_modules',
      context: 'Deleted with active file handles',
      similarity: 0.0,
    },
  ];

  // Calculate similarity for historical failures
  for (const failure of historicalFailures) {
    const similarity = calculateSimilarity(command, failure.command);
    if (similarity > 0.3) {
      patterns.push({
        patternId: `hist-${Date.now()}`,
        command: failure.command,
        outcome: 'failure',
        similarity,
        context: failure.context,
      });
    }
  }

  return patterns;
}

/**
 * Handle causal check hook
 */
async function handleCausalCheck(
  input: PreToolUseInput
): Promise<CausalCheckResponse> {
  const startTime = Date.now();

  // Only process Bash tool invocations
  if (input.toolName !== 'Bash') {
    return {
      success: true,
      correlationId: input.correlationId,
      durationMs: Date.now() - startTime,
      shouldProceed: true,
      pastFailures: [],
    };
  }

  // Extract command from tool input
  const command =
    (input.toolInput as { command?: string })?.command ?? '';

  if (!command) {
    return {
      success: true,
      correlationId: input.correlationId,
      durationMs: Date.now() - startTime,
      shouldProceed: true,
      pastFailures: [],
    };
  }

  // Query for causal failure patterns
  const patterns = await queryCausalPatterns(command);

  // Filter for failure patterns with high similarity
  const failurePatterns = patterns
    .filter((p) => p.outcome === 'failure' && p.similarity >= MIN_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, MAX_FAILURES);

  // Determine if command should proceed
  const shouldProceed = failurePatterns.length === 0;

  // Build warning if risky
  let warning: string | undefined;
  if (!shouldProceed) {
    const topRisk = failurePatterns[0];
    warning = `Warning: Similar commands have caused issues before. ${topRisk.context}. Found ${failurePatterns.length} risk pattern(s).`;
  }

  // Build past failures response
  const pastFailures: PastFailure[] = failurePatterns.map((p) => ({
    command: p.command,
    outcome: p.context,
    similarity: p.similarity,
  }));

  // Emit observability event
  try {
    const bus = await ActivityStream.getInstance();
    await bus.emit({
      type: 'hook.executed',
      correlationId: input.correlationId,
      payload: {
        hookName: 'causal-check',
        success: true,
        durationMs: Date.now() - startTime,
        command: command.substring(0, 100),
        failuresFound: failurePatterns.length,
        shouldProceed,
      },
    });
  } catch {
    // Observability failure shouldn't fail the hook
  }

  return {
    success: true,
    correlationId: input.correlationId,
    durationMs: Date.now() - startTime,
    shouldProceed,
    warning,
    pastFailures,
  };
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    const input = await readInput();

    if (!input) {
      // No input - return empty success response
      const response: CausalCheckResponse = {
        success: true,
        correlationId: 'no-input',
        durationMs: 0,
        shouldProceed: true,
        pastFailures: [],
      };
      console.log(JSON.stringify(response));
      process.exit(EXIT_CODES.SUCCESS);
      return;
    }

    const response = await handleCausalCheck(input);
    console.log(JSON.stringify(response));
    process.exit(EXIT_CODES.SUCCESS);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    const response: CausalCheckResponse = {
      success: false,
      correlationId: 'error',
      durationMs: 0,
      error: errorMessage,
      shouldProceed: true, // Default to proceed on error
      pastFailures: [],
    };
    console.log(JSON.stringify(response));
    process.exit(EXIT_CODES.ERROR);
  }
}

main();
