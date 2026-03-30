/**
 * Session Start Hook Handler
 *
 * Triggers on Claude Code SessionStart event to:
 * 1. Restore SoNA domain weights from previous session
 * 2. Restore previous session state from .god-agent/sessions/latest.json
 * 3. Build and inject context for seamless session continuation
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-HOOK-001
 *
 * @module scripts/hooks/session-start
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import {
  SessionStartInput,
  SessionStartResponse,
  SessionState,
  EXIT_CODES,
} from './hook-types.js';
import { SonaEngine } from '../../src/god-agent/core/learning/sona-engine.js';
import { ActivityStream } from '../../src/god-agent/observability/index.js';

/** Sessions directory path */
const SESSIONS_DIR = '.god-agent/sessions';
/** Latest session symlink */
const LATEST_SESSION_PATH = `${SESSIONS_DIR}/latest.json`;
/** Default weights file path */
const WEIGHTS_FILE_PATH = '.god-agent/weights/domain-weights.bin';

/**
 * Restore previous session state from disk
 * @returns Previous session state or null if not found
 */
async function restorePreviousSession(): Promise<SessionState | null> {
  try {
    if (!existsSync(LATEST_SESSION_PATH)) {
      return null;
    }
    const content = await fs.readFile(LATEST_SESSION_PATH, 'utf-8');
    return JSON.parse(content) as SessionState;
  } catch {
    // No previous session to restore - this is expected for first run
    return null;
  }
}

/**
 * Build context injection string from previous state and weights
 * @param previousState - Previous session state
 * @param domainWeights - Restored domain weights
 * @returns Context injection XML block or empty string
 */
function buildContextInjection(
  previousState: SessionState | null,
  domainWeights: Record<string, number>
): string {
  const parts: string[] = [];

  // Add domain weights summary (top 5 by weight)
  const weightEntries = Object.entries(domainWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (weightEntries.length > 0) {
    const weightsSummary = weightEntries
      .map(([domain, weight]) => `${domain}: ${(weight * 100).toFixed(0)}%`)
      .join(', ');
    parts.push(`Active domains: ${weightsSummary}`);
  }

  // Add previous session context if available
  if (previousState) {
    // Git state
    if (previousState.git.branch) {
      parts.push(`Git branch: ${previousState.git.branch}`);
    }
    if (previousState.git.uncommittedFiles.length > 0) {
      const fileCount = previousState.git.uncommittedFiles.length;
      parts.push(`Uncommitted changes: ${fileCount} file(s)`);
    }

    // Task state
    if (previousState.tasks.inProgress.length > 0) {
      const tasks = previousState.tasks.inProgress.slice(0, 3).join(', ');
      parts.push(`Tasks in progress: ${tasks}`);
    }

    // Context focus
    if (previousState.context.currentFocus) {
      parts.push(`Current focus: ${previousState.context.currentFocus}`);
    }

    // Key decisions (last 3)
    if (previousState.context.keyDecisions.length > 0) {
      const decisions = previousState.context.keyDecisions.slice(-3).join('; ');
      parts.push(`Recent decisions: ${decisions}`);
    }

    // Recent files (last 5)
    if (previousState.context.recentFiles.length > 0) {
      const files = previousState.context.recentFiles.slice(-5).join(', ');
      parts.push(`Recent files: ${files}`);
    }
  }

  if (parts.length === 0) {
    return '';
  }

  return `<session-restored>
${parts.join('\n')}
</session-restored>`;
}

/**
 * Handle session start event
 * @param input - Session start input from Claude Code
 * @returns Session start response
 */
async function handleSessionStart(
  input: SessionStartInput
): Promise<SessionStartResponse> {
  const startTime = Date.now();

  try {
    // Initialize SoNA engine and load weights
    const sona = new SonaEngine();

    // Try to load weights from file (graceful if not exists)
    let domainWeights: Record<string, number> = {};
    try {
      if (existsSync(WEIGHTS_FILE_PATH)) {
        sona.setWeightsFilePath(WEIGHTS_FILE_PATH);
        await sona.loadWeights();
        // Get routes and convert to domain weights
        const routes = sona.getRoutes();
        for (const route of routes) {
          const weights = await sona.getWeights(route);
          // Use the mean weight as the domain score
          if (weights.length > 0) {
            const mean = weights.reduce((a, b) => a + b, 0) / weights.length;
            domainWeights[route] = mean;
          }
        }
      }
    } catch (weightError) {
      // Log warning but continue - weights are optional
      console.warn('Failed to restore SoNA weights:', weightError);
    }

    // Restore previous session state
    const previousState = await restorePreviousSession();

    // Build context injection
    const contextInjection = buildContextInjection(previousState, domainWeights);

    // Emit observability event using ActivityStream
    try {
      const activityStream = new ActivityStream();
      activityStream.push({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        component: 'general',
        operation: 'session_start_hook',
        status: 'success',
        durationMs: Date.now() - startTime,
        metadata: {
          hookName: 'session-start',
          weightsRestored: Object.keys(domainWeights).length,
          sessionRestored: previousState !== null,
        },
        traceId: input.correlationId,
      });
    } catch {
      // Observability failure should not block hook execution
    }

    const response: SessionStartResponse = {
      success: true,
      correlationId: input.correlationId,
      durationMs: Date.now() - startTime,
      domainWeights,
      contextInjected: contextInjection.length > 0,
    };

    // Add optional fields if context was restored
    if (contextInjection) {
      response.contextInjection = contextInjection;
    }

    if (previousState) {
      response.previousSessionId = previousState.sessionId;
      response.restoredState = {
        gitBranch: previousState.git.branch || undefined,
        uncommittedFileCount: previousState.git.uncommittedFiles.length || undefined,
        tasksInProgress: previousState.tasks.inProgress.length || undefined,
        currentFocus: previousState.context.currentFocus || undefined,
      };
    }

    return response;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    return {
      success: false,
      correlationId: input.correlationId,
      durationMs,
      error: error instanceof Error ? error.message : 'Unknown error',
      domainWeights: {},
      contextInjected: false,
    };
  }
}

/**
 * Execute handler with JSON I/O
 */
async function main(): Promise<void> {
  let input: SessionStartInput;

  try {
    // Read input from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const inputStr = Buffer.concat(chunks).toString('utf-8').trim();

    if (!inputStr) {
      // No input - create default input for testing
      input = {
        correlationId: `test-${Date.now()}`,
        timestamp: new Date().toISOString(),
        eventType: 'SessionStart',
        sessionId: `session-${Date.now()}`,
        workingDirectory: process.cwd(),
        claudeVersion: '1.0.0',
      };
    } else {
      input = JSON.parse(inputStr) as SessionStartInput;
    }

    // Execute handler
    const response = await handleSessionStart(input);

    // Write response to stdout
    console.log(JSON.stringify(response, null, 2));

    process.exit(response.success ? EXIT_CODES.SUCCESS : EXIT_CODES.ERROR);
  } catch (parseError) {
    const errorResponse: SessionStartResponse = {
      success: false,
      correlationId: 'unknown',
      durationMs: 0,
      error: `Failed to parse input: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
      domainWeights: {},
      contextInjected: false,
    };
    console.log(JSON.stringify(errorResponse, null, 2));
    process.exit(EXIT_CODES.VALIDATION_FAILURE);
  }
}

// Execute main
main().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
    domainWeights: {},
    contextInjected: false,
  }));
  process.exit(EXIT_CODES.ERROR);
});
