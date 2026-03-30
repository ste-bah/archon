#!/usr/bin/env node
/**
 * UCM Session Restore Hook (HOOK-002)
 * SessionRestore hook for compaction recovery
 *
 * Detects context window compaction and reconstructs critical context
 * from UCM's rolling window and episodic memory.
 */

import * as net from 'net';
import * as readline from 'readline';

interface SessionRestoreInput {
  session_id: string;
  context_size?: number;
  compaction_detected?: boolean;
}

interface SessionRestoreOutput {
  success: boolean;
  context?: string;
  metrics?: {
    context_restored: number;
    episodes_loaded: number;
    recovery_time_ms: number;
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
const RPC_TIMEOUT = 5000; // 5 seconds for recovery operations
const MAX_CONTEXT_CHUNKS = 10;

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
 * Check if compaction has occurred
 */
async function checkCompaction(sessionId: string): Promise<boolean> {
  try {
    const result = await callDaemon('recovery.check', {
      sessionId,
      metrics: {
        context_size: true,
        compaction_events: true,
      },
    });

    return result?.compactionDetected || false;
  } catch (error) {
    console.error('[UCM-Session-Restore] Error checking compaction:', error);
    return false;
  }
}

/**
 * Reconstruct context from UCM rolling window and episodic memory
 */
async function reconstructContext(sessionId: string): Promise<{
  context: string;
  metrics: any;
}> {
  const startTime = Date.now();

  try {
    const result = await callDaemon('recovery.reconstruct', {
      sessionId,
      maxChunks: MAX_CONTEXT_CHUNKS,
      includeSummaries: true,
      includeDecisions: true,
      includeCriticalPaths: true,
    });

    const recoveryTime = Date.now() - startTime;

    return {
      context: result?.reconstructedContext || '',
      metrics: {
        context_restored: result?.contextSize || 0,
        episodes_loaded: result?.episodesLoaded || 0,
        recovery_time_ms: recoveryTime,
      },
    };
  } catch (error) {
    console.error('[UCM-Session-Restore] Error reconstructing context:', error);
    throw error;
  }
}

/**
 * Load critical episodes from DESC
 */
async function loadCriticalEpisodes(sessionId: string): Promise<string[]> {
  try {
    const result = await callDaemon('desc.retrieve', {
      query: `session:${sessionId} critical:true`,
      topK: 5,
      threshold: 0.8,
    });

    return result?.episodes?.map((ep: any) => ep.content) || [];
  } catch (error) {
    console.error('[UCM-Session-Restore] Error loading critical episodes:', error);
    return [];
  }
}

/**
 * Main hook logic
 */
async function processSessionRestore(input: SessionRestoreInput): Promise<SessionRestoreOutput> {
  const { session_id, compaction_detected } = input;

  try {
    // Check if daemon is available
    const healthCheck = await callDaemon('health.check', {});
    if (!healthCheck?.healthy) {
      console.error('[UCM-Session-Restore] UCM daemon unhealthy, skipping restore');
      return {
        success: false,
      };
    }

    // Check for compaction if not explicitly detected
    const needsRecovery = compaction_detected || await checkCompaction(session_id);

    if (!needsRecovery) {
      console.error('[UCM-Session-Restore] No compaction detected, skipping restore');
      return {
        success: true,
      };
    }

    console.error('[UCM-Session-Restore] Compaction detected, reconstructing context...');

    // Reconstruct context from rolling window
    const { context, metrics } = await reconstructContext(session_id);

    // Load critical episodes
    const criticalEpisodes = await loadCriticalEpisodes(session_id);

    // Combine reconstructed context with critical episodes
    const fullContext = [
      '# Context Recovered from UCM',
      '',
      '## Rolling Window Context',
      context,
      '',
      '## Critical Episodes',
      ...criticalEpisodes.map((ep, idx) => `### Episode ${idx + 1}\n${ep}`),
    ].join('\n');

    console.error(
      `[UCM-Session-Restore] Recovery complete: ${metrics.context_restored} bytes, ` +
      `${metrics.episodes_loaded} episodes, ${metrics.recovery_time_ms}ms`
    );

    return {
      success: true,
      context: fullContext,
      metrics: {
        ...metrics,
        critical_episodes: criticalEpisodes.length,
      },
    };
  } catch (error) {
    console.error('[UCM-Session-Restore] Error during session restore:', error);
    return {
      success: false,
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
      const input: SessionRestoreInput = JSON.parse(line);
      const output = await processSessionRestore(input);
      console.log(JSON.stringify(output));
    } catch (error) {
      console.error('[UCM-Session-Restore] Error processing hook:', error);
      console.log(
        JSON.stringify({
          success: false,
        })
      );
    }
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('[UCM-Session-Restore] Fatal error:', error);
  process.exit(1);
});
