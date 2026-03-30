#!/usr/bin/env node
/**
 * LEANN Daemon Server
 *
 * Standalone process that owns the LEANN index and serves multiple
 * MCP clients over a Unix socket. Prevents the multi-instance
 * clobbering bug where separate processes overwrite each other's index.
 *
 * Architecture:
 * - ONE LEANNMCPServer instance owns the backend, metadataStore, codeStore
 * - Each Unix socket connection gets its own MCP SDK Server instance
 * - Per-connection Servers delegate tool calls to the shared LEANNMCPServer
 *   via its public executeToolCall() and getToolDefinitions() methods
 * - StdioServerTransport accepts the socket as both Readable and Writable
 *
 * Started automatically by proxy.ts on first connection.
 * Stays running after all clients disconnect.
 *
 * @module mcp-servers/leann-search/daemon
 */

import * as net from 'net';
import * as fs from 'fs/promises';
import * as path from 'path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { LEANNMCPServer } from './server.js';

// ============================================================================
// Configuration
// ============================================================================

/** Resolve paths relative to git root */
const PROJECT_ROOT = process.env.LEANN_PROJECT_ROOT || process.cwd();
const RUN_DIR = path.join(PROJECT_ROOT, '.run');
const SOCKET_PATH = path.join(RUN_DIR, 'leann.sock');
const PID_PATH = path.join(RUN_DIR, 'leann-daemon.pid');
const LOG_PATH = path.join(RUN_DIR, 'leann-daemon.log');
const PERSIST_PATH =
  process.env.LEANN_PERSIST_PATH ||
  path.join(PROJECT_ROOT, 'vector_db_leann');

/** Bump when daemon protocol or behavior changes */
const BUILD_VERSION = '2.0.0';

/** Maximum simultaneous client connections */
const MAX_CONNECTIONS = 20;

/** Idle timeout disabled — Claude Code sessions can be idle for hours between
 *  tool calls. The proxy dying on timeout makes Claude Code think the MCP crashed. */
const IDLE_TIMEOUT_MS = 0;

/** Log rotation threshold: 10 MB */
const LOG_ROTATION_BYTES = 10 * 1024 * 1024;

/** Log rotation check interval: 1 hour */
const LOG_ROTATION_INTERVAL_MS = 60 * 60 * 1000;

// ============================================================================
// File Logger (daemon has no stdout — it's detached)
// ============================================================================

let logFd: fs.FileHandle | null = null;

async function initLogger(): Promise<void> {
  await fs.mkdir(RUN_DIR, { recursive: true });
  logFd = await fs.open(LOG_PATH, 'a');
}

function log(level: 'debug' | 'info' | 'warn' | 'error', msg: string): void {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${msg}\n`;
  // Fire-and-forget write — never block the event loop
  logFd?.write(line).catch(() => {});
  if (level === 'error') {
    process.stderr.write(line);
  }
}

// ============================================================================
// Connection Management
// ============================================================================

/** Track active client sockets for graceful shutdown */
const connections = new Set<net.Socket>();

/**
 * Create a per-connection MCP Server that delegates tool calls to the shared
 * LEANNMCPServer instance.
 *
 * Each connection gets its own MCP Server + StdioServerTransport pair so the
 * JSON-RPC framing is properly isolated per client, while the heavyweight
 * LEANN backend and stores are shared across all connections.
 */
function handleConnection(
  socket: net.Socket,
  leannServer: LEANNMCPServer,
  serverState: { ready: boolean }
): void {
  if (connections.size >= MAX_CONNECTIONS) {
    log('warn', `Rejecting connection: max ${MAX_CONNECTIONS} reached`);
    socket.end();
    return;
  }

  connections.add(socket);
  const connId = `conn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  log('info', `[${connId}] Client connected (${connections.size} active)`);

  // Idle timeout (disabled when IDLE_TIMEOUT_MS === 0)
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  if (IDLE_TIMEOUT_MS > 0) {
    idleTimer = setTimeout(() => {
      log('info', `[${connId}] Closing idle connection`);
      socket.destroy();
    }, IDLE_TIMEOUT_MS);
    socket.on('data', () => { idleTimer?.refresh(); });
  }

  // Create a fresh MCP Server for this connection
  const mcpServer = new Server(
    { name: 'leann-search', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // Register ListTools handler — returns tool definitions from shared server
  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: leannServer.getToolDefinitions() };
  });

  // Register CallTool handler — delegates to shared server's executeToolCall
  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (!serverState.ready) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Server initializing, retry in a few seconds',
              retryable: true,
            }),
          },
        ],
        isError: true,
      };
    }
    return leannServer.executeToolCall(
      request.params.name,
      (request.params.arguments ?? {}) as Record<string, unknown>
    );
  });

  // Connect transport: socket is both the Readable and Writable stream
  const transport = new StdioServerTransport(socket, socket);
  mcpServer.connect(transport).catch((err) => {
    log('error', `[${connId}] Transport connect error: ${err}`);
  });

  // Cleanup on disconnect
  const cleanup = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    connections.delete(socket);
    mcpServer.close().catch(() => {});
    log('info', `[${connId}] Client disconnected (${connections.size} active)`);
  };

  socket.on('close', cleanup);
  socket.on('error', (err) => {
    log('warn', `[${connId}] Socket error: ${err.message}`);
    cleanup();
  });
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

let shuttingDown = false;

async function shutdown(
  signal: string,
  unixServer: net.Server,
  leannServer: LEANNMCPServer
): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  log('info', `Received ${signal}, shutting down...`);

  // 1. Close all client connections
  Array.from(connections).forEach((sock) => sock.destroy());
  connections.clear();

  // 2. Stop accepting new connections
  unixServer.close();

  // 3. Persist index to disk
  try {
    await leannServer.shutdown();
    log('info', 'Index saved successfully');
  } catch (err) {
    log('error', `Failed to save on shutdown: ${err}`);
  }

  // 4. Clean up runtime files
  try { await fs.unlink(SOCKET_PATH); } catch {}
  try { await fs.unlink(PID_PATH); } catch {}

  if (logFd) await logFd.close();

  // Let event loop drain naturally instead of process.exit()
  setTimeout(() => process.exit(0), 1000);
}

// ============================================================================
// Log Rotation
// ============================================================================

function startLogRotation(): ReturnType<typeof setInterval> {
  return setInterval(async () => {
    try {
      const stat = await fs.stat(LOG_PATH);
      if (stat.size > LOG_ROTATION_BYTES) {
        const bakPath = LOG_PATH + '.1';
        try {
          await fs.unlink(bakPath);
        } catch {}
        await fs.rename(LOG_PATH, bakPath);
        if (logFd) {
          await logFd.close();
        }
        logFd = await fs.open(LOG_PATH, 'a');
        log('info', 'Log rotated');
      }
    } catch {
      // stat/rename can fail transiently — ignore
    }
  }, LOG_ROTATION_INTERVAL_MS);
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function startDaemon(): Promise<void> {
  await initLogger();
  log('info', `LEANN daemon starting (PID ${process.pid}, version ${BUILD_VERSION})`);
  log('info', `Project root: ${PROJECT_ROOT}`);
  log('info', `Persist path: ${PERSIST_PATH}`);

  // Clean up stale socket file from a previous unclean exit
  try {
    await fs.unlink(SOCKET_PATH);
  } catch {}

  // ------------------------------------------------------------------
  // Step 1: Bind the Unix socket FIRST (before loading the index).
  // This allows proxy.ts to connect immediately; tool calls that arrive
  // before the index is loaded will get a retryable error.
  // ------------------------------------------------------------------
  const unixServer = net.createServer();

  await new Promise<void>((resolve, reject) => {
    unixServer.listen(SOCKET_PATH, () => resolve());
    unixServer.on('error', reject);
  });

  log('info', `Socket listening at ${SOCKET_PATH}`);

  // Write PID file with metadata so proxy.ts can verify liveness
  const pidData = {
    pid: process.pid,
    version: BUILD_VERSION,
    startedAt: new Date().toISOString(),
    socketPath: SOCKET_PATH,
    persistPath: PERSIST_PATH,
  };
  await fs.writeFile(PID_PATH, JSON.stringify(pidData, null, 2));
  log('info', `PID file written to ${PID_PATH}`);

  // ------------------------------------------------------------------
  // Step 2: Create and initialize the shared LEANNMCPServer.
  // This loads the index from disk — may take a few seconds for large
  // indices. Connections accepted during this time get retryable errors.
  // ------------------------------------------------------------------
  const leannServer = new LEANNMCPServer({
    persistPath: PERSIST_PATH,
    autoSave: true,
    autoSaveInterval: 60000,
    enableLogging: true,
    logLevel: 'info',
  });

  const serverState = { ready: false };
  try {
    await leannServer.initialize();
    serverState.ready = true;
    log('info', `Index loaded: ${leannServer.getVectorCount()} vectors`);
  } catch (err) {
    log('error', `Failed to initialize: ${err}`);
    // Daemon stays up — proxy can still connect and will get error responses.
    // This is better than crashing: the user can fix the issue and re-index.
  }

  // ------------------------------------------------------------------
  // Step 3: Accept client connections
  // ------------------------------------------------------------------
  unixServer.on('connection', (socket: net.Socket) => {
    handleConnection(socket, leannServer, serverState);
  });

  // ------------------------------------------------------------------
  // Step 4: Wire up graceful shutdown
  // ------------------------------------------------------------------
  const doShutdown = (signal: string) => shutdown(signal, unixServer, leannServer);

  process.on('SIGTERM', () => doShutdown('SIGTERM'));
  process.on('SIGINT', () => doShutdown('SIGINT'));

  process.on('uncaughtException', async (err) => {
    log('error', `Uncaught exception: ${err.stack || err.message}`);
    await doShutdown('uncaughtException');
  });

  process.on('unhandledRejection', async (reason) => {
    log('error', `Unhandled rejection: ${reason}`);
    await doShutdown('unhandledRejection');
  });

  // ------------------------------------------------------------------
  // Step 5: Start background tasks
  // ------------------------------------------------------------------
  startLogRotation();

  log('info', 'LEANN daemon ready');
}

// ============================================================================
// Run
// ============================================================================

startDaemon().catch((err) => {
  process.stderr.write(`Fatal daemon error: ${err}\n`);
  process.exit(1);
});
