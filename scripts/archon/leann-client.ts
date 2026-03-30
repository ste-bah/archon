#!/usr/bin/env npx tsx
/**
 * LEANN Daemon Direct Client
 *
 * Connects to the LEANN daemon's Unix socket and sends MCP JSON-RPC
 * tool calls directly. Zero API cost — no claude -p needed.
 *
 * Usage:
 *   npx tsx scripts/archon/leann-client.ts process_queue '{"maxFiles":20}'
 *   npx tsx scripts/archon/leann-client.ts index_repository '{"repositoryPath":"/path/to/repo","replaceExisting":true}'
 *   npx tsx scripts/archon/leann-client.ts get_stats '{}'
 */

import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ROOT = process.env.LEANN_PROJECT_ROOT || process.cwd();
const SOCKET_PATH = path.join(PROJECT_ROOT, '.run', 'leann.sock');
const PID_PATH = path.join(PROJECT_ROOT, '.run', 'leann-daemon.pid');

function die(msg: string): never {
  process.stderr.write(`[leann-client] ERROR: ${msg}\n`);
  process.exit(1);
}

function log(msg: string) {
  process.stderr.write(`[leann-client] ${msg}\n`);
}

// Check daemon is running
if (!fs.existsSync(SOCKET_PATH)) {
  die(`Daemon socket not found at ${SOCKET_PATH}. Is the daemon running?`);
}

// Parse CLI args
const toolName = process.argv[2];
const toolArgs = process.argv[3] ? JSON.parse(process.argv[3]) : {};

if (!toolName) {
  die('Usage: leann-client.ts <tool_name> [json_args]\n  Tools: get_stats, process_queue, index_repository, search_code');
}

// Build MCP JSON-RPC messages
// MCP requires: initialize handshake, then tools/call
const initMsg = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'leann-client', version: '1.0.0' },
  },
};

const initNotify = {
  jsonrpc: '2.0',
  method: 'notifications/initialized',
};

const callMsg = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: {
    name: toolName,
    arguments: toolArgs,
  },
};

// Connect and send
const socket = net.connect(SOCKET_PATH);
let buffer = '';
let initDone = false;
let resultReceived = false;

// process_queue can take 10+ minutes for large batches
const CLIENT_TIMEOUT_MS = parseInt(process.env.LEANN_CLIENT_TIMEOUT || '600000', 10);
const timeout = setTimeout(() => {
  die(`Timeout after ${CLIENT_TIMEOUT_MS / 1000}s waiting for response`);
}, CLIENT_TIMEOUT_MS);

socket.on('connect', () => {
  log(`Connected to daemon, calling ${toolName}...`);
  // Send initialize
  socket.write(JSON.stringify(initMsg) + '\n');
});

socket.on('data', (chunk: Buffer) => {
  buffer += chunk.toString();

  // Process newline-delimited JSON messages
  let newlineIdx: number;
  while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIdx);
    buffer = buffer.slice(newlineIdx + 1);

    if (!line.trim()) continue;

    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }

    if (msg.id === 1 && msg.result) {
      // Initialize response received — send initialized notification + tool call
      initDone = true;
      socket.write(JSON.stringify(initNotify) + '\n');
      socket.write(JSON.stringify(callMsg) + '\n');
    } else if (msg.id === 2) {
      // Tool call response
      resultReceived = true;
      clearTimeout(timeout);

      if (msg.error) {
        die(`Tool error: ${JSON.stringify(msg.error)}`);
      }

      // Extract the text content from MCP response
      const content = msg.result?.content;
      if (Array.isArray(content) && content.length > 0) {
        const text = content[0]?.text;
        if (text) {
          try {
            // Pretty-print if it's JSON
            const parsed = JSON.parse(text);
            process.stdout.write(JSON.stringify(parsed, null, 2) + '\n');
          } catch {
            process.stdout.write(text + '\n');
          }
        }
      } else {
        process.stdout.write(JSON.stringify(msg.result, null, 2) + '\n');
      }

      socket.end();
    }
  }
});

socket.on('close', () => {
  clearTimeout(timeout);
  if (!resultReceived) {
    die('Connection closed before receiving result');
  }
  process.exit(0);
});

socket.on('error', (err) => {
  clearTimeout(timeout);
  die(`Socket error: ${err.message}`);
});
