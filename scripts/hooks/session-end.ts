/**
 * Session End Hook Handler
 *
 * Triggers on Claude Code Stop event to:
 * 1. Persist SoNA domain weights
 * 2. Capture and save session state for restoration
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-HOOK-002
 *
 * @module scripts/hooks/session-end
 */

import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import {
  SessionEndInput,
  SessionEndResponse,
  SessionState,
  EXIT_CODES,
} from './hook-types.js';
import { SonaEngine } from '../../src/god-agent/core/learning/sona-engine.js';
import { ActivityStream } from '../../src/god-agent/observability/index.js';

const exec = promisify(execCallback);

/** Sessions directory path */
const SESSIONS_DIR = '.god-agent/sessions';
/** Weights directory path */
const WEIGHTS_DIR = '.god-agent/weights';
/** Default weights file path */
const WEIGHTS_FILE_PATH = `${WEIGHTS_DIR}/domain-weights.bin`;

/**
 * Ensure required directories exist
 */
function ensureDirectories(): void {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
  if (!existsSync(WEIGHTS_DIR)) {
    mkdirSync(WEIGHTS_DIR, { recursive: true });
  }
}

/**
 * Execute a shell command safely with timeout
 * @param command - Command to execute
 * @param timeout - Timeout in ms (default 100ms)
 * @returns Command stdout or empty string on error
 */
async function safeExec(command: string, timeout = 100): Promise<string> {
  try {
    const { stdout } = await exec(command, { timeout });
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * Read current todo state (simplified - no external file dependency)
 * In a full implementation, this would read from a todo tracking file
 */
async function readTodoState(): Promise<SessionState['tasks']> {
  // Return empty state - actual implementation would read from todo tracking
  return {
    inProgress: [],
    completed: [],
    pending: [],
  };
}

/**
 * Read current working context
 * In a full implementation, this would track recently accessed files
 */
async function readWorkingContext(): Promise<SessionState['context']> {
  // Return empty context - actual implementation would track file access
  return {
    recentFiles: [],
    currentFocus: '',
    keyDecisions: [],
  };
}

/**
 * Capture current session state
 * @param sessionId - Session identifier
 * @returns Captured session state
 */
async function captureSessionState(sessionId: string): Promise<SessionState> {
  // Capture git state (with individual error handling)
  const [gitBranch, gitStatus, gitDiff] = await Promise.all([
    safeExec('git branch --show-current'),
    safeExec('git status --porcelain'),
    safeExec('git diff --stat | head -20'),
  ]);

  // Parse uncommitted files
  const uncommittedFiles = gitStatus
    .split('\n')
    .filter(Boolean)
    .slice(0, 20); // Limit to 20 files

  // Read task and context state
  const [tasks, context] = await Promise.all([
    readTodoState(),
    readWorkingContext(),
  ]);

  return {
    sessionId,
    timestamp: new Date().toISOString(),
    git: {
      branch: gitBranch,
      uncommittedFiles,
      diffSummary: gitDiff.substring(0, 500), // Limit to 500 chars
    },
    tasks,
    context,
  };
}

/**
 * Persist session state to disk
 * @param state - Session state to persist
 */
async function persistSessionState(state: SessionState): Promise<string> {
  ensureDirectories();

  const sessionPath = `${SESSIONS_DIR}/${state.sessionId}.json`;
  const latestPath = `${SESSIONS_DIR}/latest.json`;
  const content = JSON.stringify(state, null, 2);

  // Write session file and latest symlink
  await Promise.all([
    fs.writeFile(sessionPath, content, 'utf-8'),
    fs.writeFile(latestPath, content, 'utf-8'),
  ]);

  return sessionPath;
}

/**
 * Handle session end event
 * @param input - Session end input from Claude Code
 * @returns Session end response
 */
async function handleSessionEnd(
  input: SessionEndInput
): Promise<SessionEndResponse> {
  const startTime = Date.now();

  try {
    ensureDirectories();

    // Initialize SoNA engine and save weights
    const sona = new SonaEngine();
    let weightsPersisted = false;

    try {
      sona.setWeightsFilePath(WEIGHTS_FILE_PATH);
      await sona.saveWeights();
      weightsPersisted = true;
    } catch (weightError) {
      // Log warning but continue - weights persistence is optional
      console.warn('Failed to persist SoNA weights:', weightError);
    }

    // Capture and persist session state
    const sessionState = await captureSessionState(input.sessionId);
    const statePath = await persistSessionState(sessionState);

    // Emit observability event
    try {
      const activityStream = new ActivityStream();
      activityStream.push({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        component: 'general',
        operation: 'session_end_hook',
        status: 'success',
        durationMs: Date.now() - startTime,
        metadata: {
          hookName: 'session-end',
          weightsPersisted,
          sessionDurationMs: input.durationMs,
        },
        traceId: input.correlationId,
      });
    } catch {
      // Observability failure should not block hook execution
    }

    return {
      success: true,
      correlationId: input.correlationId,
      durationMs: Date.now() - startTime,
      weightsPersisted,
      stateSaved: true,
      statePath,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    return {
      success: false,
      correlationId: input.correlationId,
      durationMs,
      error: error instanceof Error ? error.message : 'Unknown error',
      weightsPersisted: false,
      stateSaved: false,
    };
  }
}

/**
 * Execute handler with JSON I/O
 */
async function main(): Promise<void> {
  let input: SessionEndInput;

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
        eventType: 'SessionEnd',
        sessionId: `session-${Date.now()}`,
        workingDirectory: process.cwd(),
        durationMs: 0,
      };
    } else {
      input = JSON.parse(inputStr) as SessionEndInput;
    }

    // Execute handler
    const response = await handleSessionEnd(input);

    // Write response to stdout
    console.log(JSON.stringify(response, null, 2));

    process.exit(response.success ? EXIT_CODES.SUCCESS : EXIT_CODES.ERROR);
  } catch (parseError) {
    const errorResponse: SessionEndResponse = {
      success: false,
      correlationId: 'unknown',
      durationMs: 0,
      error: `Failed to parse input: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
      weightsPersisted: false,
      stateSaved: false,
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
    weightsPersisted: false,
    stateSaved: false,
  }));
  process.exit(EXIT_CODES.ERROR);
});
