/**
 * Compact Inject Hook Handler
 *
 * Triggers on Notification (compact) event to query current session state
 * and summarize context for injection into compacted prompts.
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-HOOK-007
 *
 * @module scripts/hooks/compact-inject
 */

import {
  NotificationInput,
  CompactInjectResponse,
  EXIT_CODES,
} from './hook-types.js';
import { ActivityStream } from '../../src/god-agent/observability/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';

const execAsync = promisify(exec);

interface TodoItem {
  content: string;
  status: 'in_progress' | 'pending' | 'completed';
}

/**
 * Parse input from stdin
 */
async function readInput(): Promise<NotificationInput | null> {
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
    return JSON.parse(input) as NotificationInput;
  } catch {
    return null;
  }
}

/**
 * Get current git state
 */
async function getCurrentGitState(): Promise<{
  branch: string;
  uncommittedFiles: string[];
}> {
  try {
    const [branchResult, statusResult] = await Promise.all([
      execAsync('git branch --show-current'),
      execAsync('git status --porcelain'),
    ]);
    return {
      branch: branchResult.stdout.trim(),
      uncommittedFiles: statusResult.stdout.split('\n').filter(Boolean),
    };
  } catch {
    return { branch: 'unknown', uncommittedFiles: [] };
  }
}

/**
 * Get current task state from todos
 */
async function getCurrentTaskState(): Promise<{
  inProgress: string[];
  pending: string[];
}> {
  try {
    const todoPath = '.claude/todos.json';
    const content = await fs.readFile(todoPath, 'utf-8');
    const todos = JSON.parse(content) as TodoItem[];
    return {
      inProgress: todos
        .filter((t) => t.status === 'in_progress')
        .map((t) => t.content),
      pending: todos
        .filter((t) => t.status === 'pending')
        .map((t) => t.content),
    };
  } catch {
    return { inProgress: [], pending: [] };
  }
}

/**
 * Get simulated SoNA session summary
 * In full implementation, this would call SoNAEngine
 */
async function getSessionSummary(): Promise<{
  summary: string;
  weights: Record<string, number>;
}> {
  // Simplified session summary
  // Full implementation would use SoNAEngine.getInstance()
  return {
    summary: 'Working on Phase 5 hook implementation',
    weights: {
      typescript: 0.85,
      hooks: 0.78,
      testing: 0.72,
      observability: 0.65,
    },
  };
}

/**
 * Handle compact inject hook
 */
async function handleCompactInject(
  input: NotificationInput
): Promise<CompactInjectResponse> {
  const startTime = Date.now();

  // Only process compact notifications
  if (input.notificationType !== 'compact') {
    return {
      success: true,
      correlationId: input.correlationId,
      durationMs: Date.now() - startTime,
      activePatterns: 0,
    };
  }

  // Parallel fetch of all state sources
  const [sessionData, gitState, taskState] = await Promise.all([
    getSessionSummary(),
    getCurrentGitState(),
    getCurrentTaskState(),
  ]);

  const activePatterns = Object.keys(sessionData.weights).length;

  // Build comprehensive context injection
  const parts: string[] = [];

  // Session summary
  if (sessionData.summary) {
    parts.push(`Summary: ${sessionData.summary}`);
  }

  // Domain weights (top 5)
  const weightsSummary = Object.entries(sessionData.weights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([domain, weight]) => `${domain}: ${(weight * 100).toFixed(0)}%`)
    .join(', ');

  if (weightsSummary) {
    parts.push(`Active domains: ${weightsSummary}`);
  }

  // Git state
  if (gitState.branch) {
    parts.push(`Git branch: ${gitState.branch}`);
  }
  if (gitState.uncommittedFiles.length > 0) {
    parts.push(`Uncommitted: ${gitState.uncommittedFiles.length} file(s)`);
  }

  // Task state
  if (taskState.inProgress.length > 0) {
    parts.push(`In progress: ${taskState.inProgress.slice(0, 3).join(', ')}`);
  }
  if (taskState.pending.length > 0) {
    parts.push(`Pending tasks: ${taskState.pending.length}`);
  }

  // Build injection block
  let contextInjection: string | undefined;
  if (parts.length > 0) {
    contextInjection = `<session-context>\n${parts.join('\n')}\n</session-context>`;
  }

  // Emit observability event
  try {
    const bus = await ActivityStream.getInstance();
    await bus.emit({
      type: 'hook.executed',
      correlationId: input.correlationId,
      payload: {
        hookName: 'compact-inject',
        success: true,
        durationMs: Date.now() - startTime,
        hasSessionSummary: !!sessionData.summary,
        activePatterns,
        uncommittedFiles: gitState.uncommittedFiles.length,
        tasksInProgress: taskState.inProgress.length,
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
    sessionSummary: sessionData.summary,
    activePatterns,
    gitState: {
      branch: gitState.branch,
      uncommittedCount: gitState.uncommittedFiles.length,
    },
    taskState: {
      inProgress: taskState.inProgress.length,
      pending: taskState.pending.length,
    },
  };
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    const input = await readInput();

    if (!input) {
      const response: CompactInjectResponse = {
        success: true,
        correlationId: 'no-input',
        durationMs: 0,
        activePatterns: 0,
      };
      console.log(JSON.stringify(response));
      process.exit(EXIT_CODES.SUCCESS);
      return;
    }

    const response = await handleCompactInject(input);
    console.log(JSON.stringify(response));
    process.exit(EXIT_CODES.SUCCESS);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    const response: CompactInjectResponse = {
      success: false,
      correlationId: 'error',
      durationMs: 0,
      error: errorMessage,
      activePatterns: 0,
    };
    console.log(JSON.stringify(response));
    process.exit(EXIT_CODES.ERROR);
  }
}

main();
