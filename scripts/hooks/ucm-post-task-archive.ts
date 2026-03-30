#!/usr/bin/env node
/**
 * UCM Post-Task Archive Hook (HOOK-003)
 * PostToolUse hook for Task tool
 *
 * Archives completed agent output to UCM for future reuse.
 * Stores episodes in DESC and updates rolling window.
 */

import * as net from 'net';
import * as readline from 'readline';

interface PostTaskInput {
  tool_name: string;
  tool_input: {
    prompt: string;
    subagent_type?: string;
    [key: string]: any;
  };
  tool_output: string;
  session_id: string;
  task_id?: string;
  success?: boolean;
}

interface PostTaskOutput {
  success: boolean;
  archived: boolean;
  episode_id?: string;
  metrics?: {
    content_size: number;
    archive_time_ms: number;
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
const RPC_TIMEOUT = 3000; // 3 seconds
const MIN_CONTENT_SIZE = 100; // Minimum content size to archive

/**
 * Call UCM daemon via JSON-RPC over Unix socket
 */
async function callDaemon(method: string, params: any, timeout = RPC_TIMEOUT): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(SOCKET_PATH);
    const request: RPCRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id: Date.now(),
    };

    let responseBuffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timeout calling ${method}`));
    }, timeout);

    socket.on('connect', () => {
      socket.write(JSON.stringify(request) + '\n');
    });

    socket.on('data', (data) => {
      responseBuffer += data.toString();

      try {
        const response: RPCResponse = JSON.parse(responseBuffer);
        clearTimeout(timer);
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
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Extract metadata from task output
 */
function extractMetadata(output: string): {
  codeSnippets: string[];
  decisions: string[];
  outcome: string;
} {
  const codeSnippets: string[] = [];
  const decisions: string[] = [];
  let outcome = 'unknown';

  // Extract code blocks
  const codeRegex = /```[\s\S]*?```/g;
  const matches = output.match(codeRegex);
  if (matches) {
    codeSnippets.push(...matches.map(m => m.replace(/```/g, '').trim()));
  }

  // Extract decision points (lines starting with "Decision:" or "Chose:")
  const decisionRegex = /^(?:Decision|Chose):\s*(.+)$/gim;
  const decisionMatches = output.matchAll(decisionRegex);
  for (const match of decisionMatches) {
    decisions.push(match[1].trim());
  }

  // Determine outcome
  if (output.toLowerCase().includes('success') || output.toLowerCase().includes('completed')) {
    outcome = 'success';
  } else if (output.toLowerCase().includes('error') || output.toLowerCase().includes('failed')) {
    outcome = 'failure';
  }

  return { codeSnippets, decisions, outcome };
}

/**
 * Archive task to context engine
 */
async function archiveToContext(
  agentId: string,
  content: string,
  task: string,
  sessionId: string
): Promise<any> {
  try {
    const result = await callDaemon('context.archive', {
      agentId,
      content,
      task,
      sessionId,
      timestamp: Date.now(),
    });

    return result;
  } catch (error) {
    console.error('[UCM-Post-Task-Archive] Error archiving to context:', error);
    throw error;
  }
}

/**
 * Store episode in DESC
 */
async function storeEpisode(
  agentType: string,
  task: string,
  approach: string,
  outcome: string,
  metadata: any
): Promise<string> {
  try {
    const result = await callDaemon('desc.store', {
      agentType,
      task,
      approach,
      outcome,
      metadata,
      timestamp: Date.now(),
    });

    return result?.episodeId || '';
  } catch (error) {
    console.error('[UCM-Post-Task-Archive] Error storing episode:', error);
    throw error;
  }
}

/**
 * Update rolling window
 */
async function updateRollingWindow(sessionId: string, content: string): Promise<void> {
  try {
    await callDaemon('context.updateWindow', {
      sessionId,
      content,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('[UCM-Post-Task-Archive] Error updating rolling window:', error);
    // Non-critical, don't throw
  }
}

/**
 * Main hook logic
 */
async function processPostTask(input: PostTaskInput): Promise<PostTaskOutput> {
  const startTime = Date.now();

  // Only process Task tool calls
  if (input.tool_name !== 'Task') {
    return {
      success: true,
      archived: false,
    };
  }

  const { tool_input, tool_output, session_id, task_id, success = true } = input;
  const { prompt, subagent_type } = tool_input;

  // Skip archiving if output is too small or task failed
  if (!tool_output || tool_output.length < MIN_CONTENT_SIZE) {
    return {
      success: true,
      archived: false,
    };
  }

  try {
    // Check if daemon is available
    const healthCheck = await callDaemon('health.check', {});
    if (!healthCheck?.healthy) {
      console.error('[UCM-Post-Task-Archive] UCM daemon unhealthy, skipping archive');
      return {
        success: true,
        archived: false,
      };
    }

    // Extract metadata from output
    const { codeSnippets, decisions, outcome } = extractMetadata(tool_output);

    // Archive to context engine
    const agentId = task_id || `${subagent_type || 'agent'}-${Date.now()}`;
    await archiveToContext(agentId, tool_output, prompt, session_id);

    // Store as episode in DESC
    const episodeId = await storeEpisode(
      subagent_type || 'unknown',
      prompt,
      tool_output.substring(0, 500), // First 500 chars as approach summary
      outcome,
      {
        codeSnippets: codeSnippets.slice(0, 3), // Store up to 3 code snippets
        decisions,
        sessionId: session_id,
        taskId: task_id,
        success,
      }
    );

    // Update rolling window
    await updateRollingWindow(session_id, tool_output);

    const archiveTime = Date.now() - startTime;

    console.error(
      `[UCM-Post-Task-Archive] Archived task output: ` +
      `episode=${episodeId}, size=${tool_output.length}, time=${archiveTime}ms`
    );

    return {
      success: true,
      archived: true,
      episode_id: episodeId,
      metrics: {
        content_size: tool_output.length,
        archive_time_ms: archiveTime,
      },
    };
  } catch (error) {
    console.error('[UCM-Post-Task-Archive] Error during archival:', error);
    return {
      success: false,
      archived: false,
    };
  }
}

/**
 * Main entry point
 */
async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line) => {
    try {
      const input: PostTaskInput = JSON.parse(line);
      const output = await processPostTask(input);
      console.log(JSON.stringify(output));
    } catch (error) {
      console.error('[UCM-Post-Task-Archive] Error processing hook:', error);
      console.log(
        JSON.stringify({
          success: false,
          archived: false,
        })
      );
    }
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('[UCM-Post-Task-Archive] Fatal error:', error);
  process.exit(1);
});
