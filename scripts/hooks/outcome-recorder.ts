#!/usr/bin/env node
/**
 * IDESC-001: Intelligent DESC v2 - Outcome Recorder Hook
 * TASK-IDESC-OUT-004: Implement Outcome Recording Hook
 *
 * PostToolUse hook for Task tool
 *
 * Automatically records success/failure outcomes for episodes that were
 * injected into task prompts via DESC.
 *
 * Implements: AC-IDESC-003b, AC-IDESC-003c
 * Constitution: GUARD-IDESC-005 (graceful degradation - async, non-blocking)
 */

import * as net from 'net';
import * as readline from 'readline';

// ============================================================================
// Types
// ============================================================================

interface PostToolUseInput {
  tool_name: string;
  tool_input: {
    prompt?: string;
    subagent_type?: string;
    description?: string;
    [key: string]: unknown;
  };
  tool_output?: string;
  tool_error?: string;
  duration_ms?: number;
  session_id: string;
}

interface HookOutput {
  continue: boolean;
  message?: string;
}

interface RPCRequest {
  jsonrpc: '2.0';
  method: string;
  params: unknown;
  id: number;
}

interface RPCResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
  id: number;
}

// ============================================================================
// Constants
// ============================================================================

const SOCKET_PATH = process.env.UCM_DAEMON_SOCKET || '/tmp/godagent-ucm.sock';
const RECORD_TIMEOUT = 5000; // 5 seconds

// Regex to extract episode IDs from injected prior solutions
const EPISODE_ID_REGEX = /<prior_solution[^>]*episode_id="([^"]+)"/g;
const EPISODE_ID_ATTR_REGEX = /episode_id="([^"]+)"/;
const CONTEXT_MARKER_REGEX = /## Context: Similar Prior Solutions/;

// Failure patterns for success detection
const FAILURE_PATTERNS = [
  /\berror\b/i,
  /\bexception\b/i,
  /\bfailed\b/i,
  /\bcould not\b/i,
  /\bcannot\b/i,
  /\bsyntax error\b/i,
  /\btype error\b/i,
  /\bruntime error\b/i,
  /\bsegmentation fault\b/i,
  /\bstack trace\b/i,
  /\btraceback\b/i,
  /\bunexpected\b.*\btoken\b/i,
  /\bundefined\b.*\breference\b/i,
  /\bnot found\b/i,
  /\binvalid\b.*\bargument\b/i
];

// Success patterns (override failure patterns if present)
const SUCCESS_PATTERNS = [
  /\bsuccess\b/i,
  /\bcompleted\b.*\bsuccessfully\b/i,
  /\bpassed\b.*\btests\b/i,
  /\ball tests pass\b/i,
  /\btask complete\b/i,
  /\bimplementation complete\b/i
];

// Error type detection patterns
const ERROR_TYPE_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /syntax error/i, type: 'syntax_error' },
  { pattern: /type error|typescript/i, type: 'syntax_error' },
  { pattern: /logic error|incorrect.*result|wrong.*output/i, type: 'logic_error' },
  { pattern: /not applicable|irrelevant|doesn't apply/i, type: 'not_applicable' },
  { pattern: /outdated|stale|deprecated|version/i, type: 'stale_solution' },
  { pattern: /incomplete|partial|missing/i, type: 'incomplete' },
  { pattern: /security|vulnerability|unsafe|injection/i, type: 'security_issue' }
];

// ============================================================================
// Daemon Communication
// ============================================================================

/**
 * Call UCM daemon via JSON-RPC over Unix socket
 * Non-blocking - returns immediately on connection failure
 */
async function callDaemon(method: string, params: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(SOCKET_PATH);
    const request: RPCRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id: Date.now()
    };

    let responseBuffer = '';
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timeout calling ${method}`));
    }, RECORD_TIMEOUT);

    socket.on('connect', () => {
      socket.write(JSON.stringify(request) + '\n');
    });

    socket.on('data', (data) => {
      responseBuffer += data.toString();

      try {
        const response: RPCResponse = JSON.parse(responseBuffer);
        clearTimeout(timeout);
        socket.end();

        if (response.error) {
          reject(new Error(`RPC Error: ${response.error.message}`));
        } else {
          resolve(response.result);
        }
      } catch {
        // Incomplete JSON, wait for more data
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    socket.on('timeout', () => {
      clearTimeout(timeout);
      socket.destroy();
      reject(new Error(`Socket timeout calling ${method}`));
    });
  });
}

// ============================================================================
// Episode Extraction
// ============================================================================

/**
 * Extract episode IDs from injected prior solutions in prompt
 */
function extractEpisodeIds(prompt: string): string[] {
  const episodeIds: string[] = [];

  // Check if the prompt has injected context
  if (!CONTEXT_MARKER_REGEX.test(prompt)) {
    return episodeIds;
  }

  // Extract episode IDs from prior_solution tags
  const matches = prompt.matchAll(EPISODE_ID_REGEX);
  for (const match of matches) {
    if (match[1]) {
      episodeIds.push(match[1]);
    }
  }

  // Also check for episode_id attributes without the full tag
  const attrMatches = prompt.matchAll(/\bepisode_id="([^"]+)"/g);
  for (const match of attrMatches) {
    if (match[1] && !episodeIds.includes(match[1])) {
      episodeIds.push(match[1]);
    }
  }

  return episodeIds;
}

// ============================================================================
// Success Detection
// ============================================================================

/**
 * Detect if task output indicates success or failure
 */
function detectSuccess(output: string): boolean {
  // If output is empty or very short, assume success (no errors reported)
  if (!output || output.length < 10) {
    return true;
  }

  // Check for explicit success patterns first
  for (const pattern of SUCCESS_PATTERNS) {
    if (pattern.test(output)) {
      return true;
    }
  }

  // Check for failure patterns
  for (const pattern of FAILURE_PATTERNS) {
    if (pattern.test(output)) {
      return false;
    }
  }

  // Default to success if no failure patterns found
  return true;
}

/**
 * Detect error type from output
 */
function detectErrorType(output: string): string | undefined {
  for (const { pattern, type } of ERROR_TYPE_PATTERNS) {
    if (pattern.test(output)) {
      return type;
    }
  }
  return 'logic_error'; // Default error type
}

// ============================================================================
// Outcome Recording
// ============================================================================

/**
 * Record outcome for a single episode
 * Non-blocking - logs errors but doesn't throw
 */
async function recordOutcome(
  episodeId: string,
  taskId: string,
  success: boolean,
  errorType?: string,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    await callDaemon('outcome.recordOutcome', {
      episodeId,
      taskId,
      success,
      errorType,
      details
    });
    console.error(`[Outcome-Recorder] Recorded outcome for ${episodeId}: ${success ? 'SUCCESS' : 'FAILURE'}`);
  } catch (error) {
    // GUARD-IDESC-005: Graceful degradation - log but don't fail
    console.error(`[Outcome-Recorder] Failed to record outcome for ${episodeId}:`, error);
  }
}

/**
 * Process task completion and record outcomes
 */
async function processTaskCompletion(input: PostToolUseInput): Promise<void> {
  const prompt = input.tool_input.prompt || '';
  const output = input.tool_output || '';
  const error = input.tool_error;
  const taskId = input.session_id || `task-${Date.now()}`;

  // Extract episode IDs from the prompt
  const episodeIds = extractEpisodeIds(prompt);

  if (episodeIds.length === 0) {
    console.error('[Outcome-Recorder] No injected episodes found in prompt');
    return;
  }

  console.error(`[Outcome-Recorder] Found ${episodeIds.length} injected episode(s)`);

  // Determine success/failure
  const success = !error && detectSuccess(output);
  const errorType = success ? undefined : detectErrorType(error || output);

  // Prepare details (truncate output to avoid large payloads)
  const details: Record<string, unknown> = {
    agentType: input.tool_input.subagent_type,
    description: input.tool_input.description,
    durationMs: input.duration_ms,
    outputSnippet: output.substring(0, 500),
    hadError: !!error
  };

  // Record outcome for each injected episode (in parallel)
  const recordPromises = episodeIds.map(episodeId =>
    recordOutcome(episodeId, taskId, success, errorType, details)
  );

  // Wait for all recordings (but don't block on failures)
  await Promise.allSettled(recordPromises);
}

// ============================================================================
// Main Hook Entry Point
// ============================================================================

async function main(): Promise<void> {
  // Read input from stdin
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false
  });

  let inputData = '';

  for await (const line of rl) {
    inputData += line;
  }

  let input: PostToolUseInput;

  try {
    input = JSON.parse(inputData);
  } catch (error) {
    console.error('[Outcome-Recorder] Failed to parse input:', error);
    // Output default response
    const output: HookOutput = { continue: true };
    console.log(JSON.stringify(output));
    return;
  }

  // Only process Task tool completions
  if (input.tool_name !== 'Task') {
    const output: HookOutput = { continue: true };
    console.log(JSON.stringify(output));
    return;
  }

  // Process task completion asynchronously
  // Don't await - we want this to be non-blocking
  processTaskCompletion(input).catch(error => {
    console.error('[Outcome-Recorder] Error processing task completion:', error);
  });

  // Always allow continuation
  const output: HookOutput = {
    continue: true,
    message: 'Outcome recording initiated'
  };
  console.log(JSON.stringify(output));
}

// Run the hook
main().catch(error => {
  console.error('[Outcome-Recorder] Fatal error:', error);
  // Ensure we always output valid JSON
  console.log(JSON.stringify({ continue: true }));
  process.exit(0); // Exit cleanly to not block Claude Code
});
