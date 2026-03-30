/**
 * Task Context Hook Handler
 *
 * Triggers on PreToolUse (Task tool) to query the search system
 * for relevant patterns and inject context into the prompt.
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-HOOK-003
 *
 * @module scripts/hooks/task-context
 */

import {
  PreToolUseInput,
  TaskContextResponse,
  PatternMatchResult,
  EXIT_CODES,
} from './hook-types.js';
import { ActivityStream } from '../../src/god-agent/observability/index.js';

/** Minimum confidence threshold for patterns */
const MIN_CONFIDENCE = 0.5;
/** Maximum number of patterns to return */
const MAX_PATTERNS = 5;
/** Pattern search timeout in ms */
const SEARCH_TIMEOUT_MS = 400;

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
 * Extract task description from tool input
 */
function extractTaskDescription(toolInput: Record<string, unknown>): string {
  // Try common parameter names for Task tool
  const descriptionKeys = ['prompt', 'description', 'task', 'message', 'content'];

  for (const key of descriptionKeys) {
    const value = toolInput[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  // Fallback: stringify the first string value found
  for (const value of Object.values(toolInput)) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return '';
}

/**
 * Search for relevant patterns using text-based matching
 * This is a simplified implementation for the hook - full search uses UnifiedSearch
 */
async function searchPatterns(
  taskDescription: string,
  _timeoutMs: number
): Promise<PatternMatchResult[]> {
  // For hooks, we do a lightweight pattern search
  // The full UnifiedSearch requires embedding which is too heavy for 500ms hook timeout

  // Extract keywords from task description
  const keywords = taskDescription
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 10);

  if (keywords.length === 0) {
    return [];
  }

  // Built-in patterns for common task types
  // These are lightweight patterns for quick context injection
  const commonPatterns: PatternMatchResult[] = [
    {
      pattern: 'Use TypeScript strict mode with explicit types',
      similarity: 0.0,
      source: 'constitution',
      taskType: 'coder',
    },
    {
      pattern: 'Follow TDD: write tests before implementation',
      similarity: 0.0,
      source: 'constitution',
      taskType: 'tester',
    },
    {
      pattern: 'Keep files under 500 lines per constitution',
      similarity: 0.0,
      source: 'constitution',
      taskType: 'coder',
    },
    {
      pattern: 'Use Vitest for testing with no inline mocks',
      similarity: 0.0,
      source: 'constitution',
      taskType: 'tester',
    },
    {
      pattern: 'Document public APIs with JSDoc comments',
      similarity: 0.0,
      source: 'best-practices',
      taskType: 'coder',
    },
    {
      pattern: 'Handle errors gracefully with typed error responses',
      similarity: 0.0,
      source: 'best-practices',
      taskType: 'backend-dev',
    },
    {
      pattern: 'Use async/await for asynchronous operations',
      similarity: 0.0,
      source: 'best-practices',
      taskType: 'coder',
    },
    {
      pattern: 'Prefer composition over inheritance',
      similarity: 0.0,
      source: 'architecture',
      taskType: 'system-architect',
    },
  ];

  // Score patterns by keyword matching
  const scored = commonPatterns.map((p) => {
    const patternWords = p.pattern.toLowerCase().split(/\s+/);
    const matchCount = keywords.filter((kw) =>
      patternWords.some((pw) => pw.includes(kw) || kw.includes(pw))
    ).length;
    const similarity = matchCount / Math.max(keywords.length, 1);
    return { ...p, similarity };
  });

  // Filter by minimum confidence and sort by similarity
  return scored
    .filter((p) => p.similarity >= MIN_CONFIDENCE)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, MAX_PATTERNS);
}

/**
 * Format patterns as XML context injection
 */
function formatContextInjection(patterns: PatternMatchResult[]): string {
  if (patterns.length === 0) {
    return '';
  }

  const patternLines = patterns
    .map(
      (p) =>
        `- ${p.pattern} (${Math.round(p.similarity * 100)}% match, source: ${p.source})`
    )
    .join('\n');

  return `\n<relevant-patterns>\n${patternLines}\n</relevant-patterns>\n`;
}

/**
 * Handle task context hook
 */
async function handleTaskContext(
  input: PreToolUseInput
): Promise<TaskContextResponse> {
  const startTime = Date.now();

  // Only process Task tool invocations
  if (input.toolName !== 'Task') {
    return {
      success: true,
      correlationId: input.correlationId,
      durationMs: Date.now() - startTime,
      patternsFound: 0,
      confidenceScores: [],
    };
  }

  // Extract task description
  const taskDescription =
    input.taskDescription || extractTaskDescription(input.toolInput);

  if (!taskDescription) {
    return {
      success: true,
      correlationId: input.correlationId,
      durationMs: Date.now() - startTime,
      patternsFound: 0,
      confidenceScores: [],
    };
  }

  // Search for relevant patterns
  const patterns = await searchPatterns(taskDescription, SEARCH_TIMEOUT_MS);

  // Build context injection
  const contextInjection =
    patterns.length > 0 ? formatContextInjection(patterns) : undefined;

  // Emit observability event
  try {
    const bus = await ActivityStream.getInstance();
    await bus.emit({
      type: 'hook.executed',
      correlationId: input.correlationId,
      payload: {
        hookName: 'task-context',
        success: true,
        durationMs: Date.now() - startTime,
        patternsFound: patterns.length,
        topConfidence: patterns[0]?.similarity ?? 0,
      },
    });
  } catch {
    // Observability failure shouldn't fail the hook
  }

  return {
    success: true,
    correlationId: input.correlationId,
    durationMs: Date.now() - startTime,
    contextInjection,
    patternsFound: patterns.length,
    confidenceScores: patterns.map((p) => p.similarity),
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
      const response: TaskContextResponse = {
        success: true,
        correlationId: 'no-input',
        durationMs: 0,
        patternsFound: 0,
        confidenceScores: [],
      };
      console.log(JSON.stringify(response));
      process.exit(EXIT_CODES.SUCCESS);
      return;
    }

    const response = await handleTaskContext(input);
    console.log(JSON.stringify(response));
    process.exit(EXIT_CODES.SUCCESS);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    const response: TaskContextResponse = {
      success: false,
      correlationId: 'error',
      durationMs: 0,
      error: errorMessage,
      patternsFound: 0,
      confidenceScores: [],
    };
    console.log(JSON.stringify(response));
    process.exit(EXIT_CODES.ERROR);
  }
}

main();
