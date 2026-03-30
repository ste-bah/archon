#!/usr/bin/env node
/**
 * UCM DESC Injector Hook (HOOK-001)
 * PreToolUse hook for Task tool
 *
 * Connects to UCM daemon via Unix socket to retrieve similar prior solutions
 * and inject them into the task prompt for enhanced context.
 */

import * as net from 'net';
import * as readline from 'readline';
import { PhdPipelineAdapter } from '../../src/god-agent/core/ucm/adapters/phd-pipeline-adapter.js';

interface HookInput {
  tool_name: string;
  tool_input: {
    prompt: string;
    subagent_type?: string;
    [key: string]: any;
  };
  session_id: string;
}

interface HookOutput {
  decision: 'allow' | 'deny';
  reason: string;
  modify_tool_input?: {
    prompt: string;
    [key: string]: any;
  };
}

interface RPCRequest {
  jsonrpc: '2.0';
  method: string;
  params: any;
  id: number;
}

interface RPCResponse {
  jsonrpc: '2.0';
  result?: any;
  error?: {
    code: number;
    message: string;
  };
  id: number;
}

const SOCKET_PATH = '/tmp/godagent-ucm.sock';
const RETRIEVE_TIMEOUT = 2000; // 2 seconds
const DEFAULT_WINDOW_SIZE = 3; // RULE-010

// Singleton adapter instance for phase detection
const phdAdapter = new PhdPipelineAdapter();

/**
 * Get rolling window size for current phase per CONSTITUTION rules
 * RULE-010: Default 3
 * RULE-011: Planning 2
 * RULE-012: Research 3
 * RULE-013: Writing 5
 * RULE-014: QA 10
 *
 * @param phase - Current pipeline phase (string or number)
 * @param agentType - Optional agent type for fallback detection
 * @param task - Optional task description for fallback detection
 * @returns Rolling window size
 */
function getWindowSizeForPhase(
  phase?: string,
  agentType?: string,
  task?: string
): number {
  // First try using PhdPipelineAdapter for consistent phase detection
  const context = {
    phase: phase || '',
    agentId: agentType || '',
    task: task || ''
  };

  // If adapter detects PhD pipeline, use its window size logic
  if (phdAdapter.detect(context)) {
    return phdAdapter.getWindowSize(context);
  }

  // Fallback to inline logic for non-PhD contexts or direct phase values
  const normalizedPhase = (phase || '').toLowerCase();

  switch (normalizedPhase) {
    // RULE-011: Planning phase
    case 'planning':
    case 'foundation':
    case '1':
      return 2;

    // RULE-012: Research/Discovery phase
    case 'research':
    case 'discovery':
    case '2':
    case '3':
      return 3;

    // RULE-013: Writing/Synthesis phase
    case 'writing':
    case 'synthesis':
    case '6':
      return 5;

    // RULE-014: QA/Review phase
    case 'qa':
    case 'review':
    case 'quality':
    case '7':
      return 10;

    // RULE-010: Default
    default:
      return DEFAULT_WINDOW_SIZE;
  }
}

/**
 * Call UCM daemon via JSON-RPC over Unix socket
 */
async function callDaemon(method: string, params: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(SOCKET_PATH);
    const request: RPCRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id: Date.now(),
    };

    let responseBuffer = '';
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timeout calling ${method}`));
    }, RETRIEVE_TIMEOUT);

    socket.on('connect', () => {
      socket.write(JSON.stringify(request) + '\n');
    });

    socket.on('data', (data) => {
      responseBuffer += data.toString();

      // Check if we have a complete JSON response
      try {
        const response: RPCResponse = JSON.parse(responseBuffer);
        clearTimeout(timeout);
        socket.end();

        if (response.error) {
          reject(new Error(`RPC Error: ${response.error.message}`));
        } else {
          resolve(response.result);
        }
      } catch (e) {
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

/**
 * Retrieve similar prior solutions from DESC with task context
 *
 * @param query - The search query
 * @param agentType - Optional agent type for context
 * @param taskContext - Optional task context with metadata
 * @param topK - Maximum number of episodes to retrieve (phase-aware window size)
 */
async function retrieveSimilarSolutions(
  query: string,
  agentType?: string,
  taskContext?: any,
  topK: number = DEFAULT_WINDOW_SIZE
): Promise<any[]> {
  try {
    const result = await callDaemon('desc.retrieve', {
      query,
      agentType,
      topK,
      threshold: 0.7, // Minimum similarity score (will be adjusted by filter)
      taskContext: taskContext || {
        agentId: agentType,
        task: query
      }
    });

    return result?.episodes || [];
  } catch (error) {
    console.error('[UCM-DESC-Injector] Error retrieving solutions:', error);
    return [];
  }
}

/**
 * Inject similar solutions into prompt with task context
 *
 * @param originalPrompt - The original task prompt
 * @param agentType - Optional agent type for context
 * @param taskContext - Optional task context with metadata
 * @param maxEpisodes - Maximum episodes to retrieve (phase-aware window size)
 */
async function injectSolutions(
  originalPrompt: string,
  agentType?: string,
  taskContext?: any,
  maxEpisodes: number = DEFAULT_WINDOW_SIZE
): Promise<{ prompt: string; filtered: number; total: number }> {
  try {
    const result = await callDaemon('desc.inject', {
      prompt: originalPrompt,
      agentType,
      maxEpisodes, // Fixed: was maxSolutions (wrong param name)
      taskContext: taskContext || {
        agentId: agentType,
        task: originalPrompt
      }
    });

    return {
      prompt: result?.augmentedPrompt || originalPrompt,
      filtered: result?.filteredCount || 0,
      total: result?.totalFound || 0
    };
  } catch (error) {
    console.error('[UCM-DESC-Injector] Error injecting solutions:', error);
    return {
      prompt: originalPrompt,
      filtered: 0,
      total: 0
    };
  }
}

/**
 * Format similar solutions for prompt injection
 */
function formatSolutionsForPrompt(prompt: string, solutions: any[]): string {
  if (solutions.length === 0) {
    return prompt;
  }

  const solutionsContext = solutions
    .map((sol, idx) => {
      return `
### Prior Solution ${idx + 1} (Similarity: ${(sol.score * 100).toFixed(1)}%)
**Task**: ${sol.task || 'N/A'}
**Agent**: ${sol.agentType || 'N/A'}
**Approach**: ${sol.approach || sol.summary || 'N/A'}
**Outcome**: ${sol.outcome || 'Success'}
${sol.codeSnippet ? `\n**Code Example**:\n\`\`\`\n${sol.codeSnippet}\n\`\`\`\n` : ''}
`;
    })
    .join('\n');

  return `${prompt}

---

## Context: Similar Prior Solutions

The UCM system found ${solutions.length} similar task(s) that may help:
${solutionsContext}

**Note**: Use these solutions as reference, but adapt them to the current specific requirements.

---
`;
}

/**
 * Main hook logic
 */
async function processHook(input: HookInput): Promise<HookOutput> {
  // Only process Task tool calls
  if (input.tool_name !== 'Task') {
    return {
      decision: 'allow',
      reason: 'Not a Task tool call',
    };
  }

  const { prompt, subagent_type } = input.tool_input;

  if (!prompt || typeof prompt !== 'string') {
    return {
      decision: 'allow',
      reason: 'No prompt to augment',
    };
  }

  try {
    // Check if daemon is available
    const healthCheck = await callDaemon('health.check', {});
    // Accept 'healthy' or 'degraded' (degraded = embedding service down but other services work)
    if (!healthCheck?.status || healthCheck.status === 'unhealthy') {
      console.error('[UCM-DESC-Injector] UCM daemon unhealthy, skipping injection');
      return {
        decision: 'allow',
        reason: 'UCM daemon unavailable',
      };
    }

    // Extract phase from tool_input for phase-aware window sizing
    // Phase can come from direct property or nested in metadata
    const phase = input.tool_input.phase ||
                  input.tool_input.metadata?.phase ||
                  input.tool_input.pipelinePhase ||
                  '';

    // Get phase-aware window size per CONSTITUTION RULE-010 to RULE-014
    const windowSize = getWindowSizeForPhase(
      String(phase),
      subagent_type,
      prompt
    );

    console.error(
      `[UCM-DESC-Injector] Phase: ${phase || 'default'}, Window size: ${windowSize}`
    );

    // Build task context for filtering
    const taskContext = {
      agentId: subagent_type,
      task: prompt,
      sessionId: input.session_id,
      phase: phase,
      windowSize: windowSize,
      metadata: input.tool_input
    };

    // Retrieve and inject similar solutions with phase-aware window size
    const injectionResult = await injectSolutions(
      prompt,
      subagent_type,
      taskContext,
      windowSize
    );

    if (injectionResult.prompt === prompt) {
      return {
        decision: 'allow',
        reason: 'No similar solutions found',
      };
    }

    // Log filtering results
    const filteredMsg = injectionResult.filtered > 0
      ? ` (${injectionResult.filtered} filtered for safety)`
      : '';
    console.error(
      `[UCM-DESC-Injector] Found ${injectionResult.total} similar solutions${filteredMsg}, ` +
      `injected ${injectionResult.total - injectionResult.filtered} for ${subagent_type || 'agent'}`
    );

    // Show debug info about what was filtered
    if (injectionResult.filtered > 0) {
      console.error(
        `[UCM-DESC-Injector] Safety filters active: coding tasks require 92% similarity, ` +
        `same module/file context, and recent solutions (30-day half-life)`
      );
    }

    return {
      decision: 'allow',
      reason: 'Prompt augmented with similar prior solutions',
      modify_tool_input: {
        ...input.tool_input,
        prompt: injectionResult.prompt,
      },
    };
  } catch (error) {
    console.error('[UCM-DESC-Injector] Error during injection:', error);
    return {
      decision: 'allow',
      reason: 'Failed to inject solutions, proceeding with original prompt',
    };
  }
}

/**
 * Main entry point - reads stdin synchronously with timeout
 */
async function main() {
  // Set up immediate timeout - if we don't get input fast, allow and exit
  const forceExit = setTimeout(() => {
    console.log(JSON.stringify({
      decision: 'allow',
      reason: 'Hook timeout - proceeding without DESC injection',
    }));
    process.exit(0);
  }, 1500);

  // Try to read stdin
  let inputData = '';

  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk) => {
    inputData += chunk;
  });

  process.stdin.on('end', async () => {
    clearTimeout(forceExit);

    if (!inputData.trim()) {
      console.log(JSON.stringify({
        decision: 'allow',
        reason: 'No input provided',
      }));
      process.exit(0);
    }

    try {
      const input: HookInput = JSON.parse(inputData);
      const output = await processHook(input);
      console.log(JSON.stringify(output));
    } catch (error) {
      console.error('[UCM-DESC-Injector] Error:', error);
      console.log(JSON.stringify({
        decision: 'allow',
        reason: 'Hook error - proceeding',
      }));
    }
    process.exit(0);
  });

  process.stdin.on('error', () => {
    clearTimeout(forceExit);
    console.log(JSON.stringify({
      decision: 'allow',
      reason: 'Stdin error',
    }));
    process.exit(0);
  });

  // Resume stdin to start reading
  process.stdin.resume();
}

main().catch((error) => {
  console.error('[UCM-DESC-Injector] Fatal error:', error);
  process.exit(1);
});
