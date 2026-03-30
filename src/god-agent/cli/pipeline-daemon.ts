#!/usr/bin/env node --import tsx/esm
/**
 * Pipeline Daemon - Persistent process for coding pipeline operations
 *
 * Eliminates cold-start overhead by keeping UniversalAgent, orchestrator,
 * and embedding provider warm in memory. Follows the DaemonServer pattern
 * from daemon-cli.ts.
 *
 * Socket: /tmp/godagent-pipeline.sock
 * PID: /tmp/godagent-pipeline.pid
 *
 * Usage:
 *   npx tsx src/god-agent/cli/pipeline-daemon.ts start
 *   npx tsx src/god-agent/cli/pipeline-daemon.ts stop
 *   npx tsx src/god-agent/cli/pipeline-daemon.ts status
 */

import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { createServer, Server, Socket } from 'net';
import { PipelineDaemonService } from './pipeline-daemon-service.js';

const SOCKET_PATH = '/tmp/godagent-pipeline.sock';
const PID_FILE = '/tmp/godagent-pipeline.pid';

/** JSON-RPC 2.0 error codes */
const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  HANDLER_ERROR: -32001,
};

async function startDaemon(): Promise<void> {
  console.log('[PipelineDaemon] Starting pipeline daemon...');

  // Check if already running
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    try {
      process.kill(pid, 0);
      console.log(`[PipelineDaemon] Already running (PID: ${pid})`);
      return;
    } catch {
      // Stale PID file — process not running
      unlinkSync(PID_FILE);
    }
  }

  // Initialize the pipeline service (expensive — does UniversalAgent init)
  const service = new PipelineDaemonService();
  await service.initialize();
  const handler = service.createHandler();

  // Clean up existing socket
  if (existsSync(SOCKET_PATH)) {
    try { unlinkSync(SOCKET_PATH); } catch { /* ignore */ }
  }

  // Message buffers for partial JSON handling
  const messageBuffers = new Map<Socket, string>();

  // Create lightweight JSON-RPC 2.0 server (no DaemonServer dependency)
  const server: Server = createServer((socket: Socket) => {
    messageBuffers.set(socket, '');

    socket.on('data', (data: Buffer) => {
      let buffer = (messageBuffers.get(socket) ?? '') + data.toString();
      const messages = buffer.split('\n');
      messageBuffers.set(socket, messages.pop() ?? '');

      for (const msg of messages) {
        if (!msg.trim()) continue;
        processMessage(socket, msg.trim(), handler);
      }
    });

    socket.on('close', () => messageBuffers.delete(socket));
    socket.on('error', () => messageBuffers.delete(socket));
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(`[PipelineDaemon] Server error: ${err.message}`);
    process.exit(1);
  });

  server.listen(SOCKET_PATH, () => {
    writeFileSync(PID_FILE, process.pid.toString());
    console.log(`[PipelineDaemon] Listening at ${SOCKET_PATH} (PID: ${process.pid})`);
    console.log(`[PipelineDaemon] Methods: ${service.getMethods().join(', ')}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[PipelineDaemon] Shutting down...');
    server.close();
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
    if (existsSync(SOCKET_PATH)) {
      try { unlinkSync(SOCKET_PATH); } catch { /* ignore */ }
    }
    console.log('[PipelineDaemon] Stopped');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // tsx CPU-spin mitigation (same as daemon-cli.ts lines 77-92)
  process.stdin.pause();
  if (typeof process.stdin.unref === 'function') {
    process.stdin.unref();
  }
  const activeHandles = (process as unknown as { _getActiveHandles?: () => Array<{ unref?: () => void }> })
    ._getActiveHandles?.();
  if (Array.isArray(activeHandles)) {
    for (const handle of activeHandles) {
      if (handle instanceof Server) continue; // Keep daemon socket alive
      if (typeof handle.unref === 'function') {
        handle.unref();
      }
    }
  }

  // Keep process alive
  await new Promise(() => {}); // Never resolves
}

/** Process a single JSON-RPC 2.0 message */
async function processMessage(
  socket: Socket,
  message: string,
  handler: (method: string, params: unknown) => Promise<unknown>,
): Promise<void> {
  let request: Record<string, unknown>;

  try {
    request = JSON.parse(message);
  } catch {
    sendResponse(socket, {
      jsonrpc: '2.0',
      error: { code: JSON_RPC_ERRORS.PARSE_ERROR, message: 'Parse error: Invalid JSON' },
      id: null,
    });
    return;
  }

  const id = request.id as string | number | null ?? null;

  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    sendResponse(socket, {
      jsonrpc: '2.0',
      error: { code: JSON_RPC_ERRORS.INVALID_REQUEST, message: 'Invalid Request' },
      id,
    });
    return;
  }

  // Built-in health endpoint
  if (request.method === 'health.ping') {
    sendResponse(socket, {
      jsonrpc: '2.0',
      result: { pong: true, timestamp: Date.now() },
      id,
    });
    return;
  }

  // Route: pipeline.<method>
  const parts = (request.method as string).split('.');
  if (parts.length < 2 || parts[0] !== 'pipeline') {
    sendResponse(socket, {
      jsonrpc: '2.0',
      error: {
        code: JSON_RPC_ERRORS.METHOD_NOT_FOUND,
        message: `Method not found: ${request.method}. Expected "pipeline.<method>"`,
      },
      id,
    });
    return;
  }

  const method = parts.slice(1).join('.');

  try {
    const result = await handler(method, request.params);
    sendResponse(socket, { jsonrpc: '2.0', result, id });
  } catch (error) {
    sendResponse(socket, {
      jsonrpc: '2.0',
      error: {
        code: JSON_RPC_ERRORS.HANDLER_ERROR,
        message: error instanceof Error ? error.message : String(error),
      },
      id,
    });
  }
}

/** Send JSON-RPC response over socket */
function sendResponse(socket: Socket, response: Record<string, unknown>): void {
  try {
    socket.write(JSON.stringify(response) + '\n');
  } catch { /* socket may be closed */ }
}

async function stopDaemon(): Promise<void> {
  if (!existsSync(PID_FILE)) {
    console.log('[PipelineDaemon] Not running');
    return;
  }

  const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`[PipelineDaemon] Sent SIGTERM to PID ${pid}`);

    let attempts = 0;
    while (attempts < 10) {
      try {
        process.kill(pid, 0);
        await new Promise(r => setTimeout(r, 500));
        attempts++;
      } catch {
        break; // Process exited
      }
    }
  } catch (err) {
    console.log(`[PipelineDaemon] Failed to stop: ${err}`);
  }

  // Cleanup
  if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  if (existsSync(SOCKET_PATH)) {
    try { unlinkSync(SOCKET_PATH); } catch { /* ignore */ }
  }
  console.log('[PipelineDaemon] Stopped');
}

function statusDaemon(): void {
  console.log('\n=== Pipeline Daemon Status ===\n');

  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    console.log(`PID File: exists (PID: ${pid})`);
    try {
      process.kill(pid, 0);
      console.log('  Process: RUNNING');
    } catch {
      console.log('  Process: NOT RUNNING (stale PID)');
    }
  } else {
    console.log('PID File: not found');
  }

  console.log(`\nSocket: ${SOCKET_PATH}`);
  console.log(`  Status: ${existsSync(SOCKET_PATH) ? 'EXISTS' : 'NOT FOUND'}`);
  console.log('');
}

// CLI entry point
const command = process.argv[2];

switch (command) {
  case 'start':
    startDaemon().catch(e => { console.error('[PipelineDaemon] Start failed:', e.message); process.exit(1); });
    break;
  case 'stop':
    stopDaemon().catch(e => { console.error('[PipelineDaemon] Stop failed:', e.message); process.exit(1); });
    break;
  case 'status':
    statusDaemon();
    break;
  default:
    console.log('Usage: pipeline-daemon.ts <start|stop|status>');
    process.exit(1);
}
