#!/usr/bin/env node --import tsx/esm
/**
 * Daemon CLI - Start/Stop the God Agent daemon server
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-DAEMON-CLI
 *
 * Usage:
 *   npx tsx src/god-agent/core/daemon/daemon-cli.ts start
 *   npx tsx src/god-agent/core/daemon/daemon-cli.ts stop
 *   npx tsx src/god-agent/core/daemon/daemon-cli.ts status
 *
 * @module src/god-agent/core/daemon/daemon-cli
 */

import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import * as net from 'net';
import { DaemonServer } from './daemon-server.js';
import { DEFAULT_SOCKET_PATH } from './daemon-types.js';

const PID_FILE = '/tmp/godagent-daemon.pid';
const SOCKET_PATH = DEFAULT_SOCKET_PATH;

async function startDaemon(): Promise<void> {
  console.log('[DaemonCLI] Starting God Agent daemon...');

  // Check if already running
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    try {
      process.kill(pid, 0); // Check if process exists
      console.log(`[DaemonCLI] Daemon already running (PID: ${pid})`);
      return;
    } catch {
      // INTENTIONAL: Process not running, clean up stale PID file
      unlinkSync(PID_FILE);
    }
  }

  // Create and start daemon server
  const server = new DaemonServer(SOCKET_PATH);

  // Register core services with basic handlers
  server.registerService('health', async () => ({ status: 'ok', timestamp: Date.now() }), ['check']);
  server.registerService('status', async () => ({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    services: server.getServices()
  }), ['get']);

  // Start the server
  await server.start();

  // Write PID file
  writeFileSync(PID_FILE, process.pid.toString());

  console.log(`[DaemonCLI] Daemon started at ${SOCKET_PATH} (PID: ${process.pid})`);
  console.log('[DaemonCLI] Services registered:');
  console.log('  - health: Health check service');
  console.log('  - status: Status and metrics service');
  console.log('[DaemonCLI] Press Ctrl+C to stop');

  // Handle shutdown
  const shutdown = async () => {
    console.log('\n[DaemonCLI] Shutting down...');
    await server.stop();
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE);
    }
    console.log('[DaemonCLI] Daemon stopped');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Neutralize tsx's internal ESM loader handles to prevent CPU spin.
  // tsx creates IPC pipes for module resolution that stay active in processes
  // with large module trees, causing libuv to poll them at 100% CPU.
  process.stdin.pause();
  if (typeof process.stdin.unref === 'function') {
    process.stdin.unref();
  }
  const activeHandles = (process as any)._getActiveHandles?.();
  if (Array.isArray(activeHandles)) {
    for (const handle of activeHandles) {
      if (handle instanceof net.Server) continue; // Keep daemon socket alive
      if (typeof handle.unref === 'function') {
        handle.unref();
      }
    }
  }

  // Keep process alive
  await new Promise(() => {}); // Never resolves
}

async function stopDaemon(): Promise<void> {
  if (!existsSync(PID_FILE)) {
    console.log('[DaemonCLI] Daemon not running');
    return;
  }

  const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);

  try {
    process.kill(pid, 'SIGTERM');
    console.log(`[DaemonCLI] Sent SIGTERM to daemon (PID: ${pid})`);

    // Wait for process to exit
    let attempts = 0;
    while (attempts < 10) {
      try {
        process.kill(pid, 0);
        await new Promise(r => setTimeout(r, 500));
        attempts++;
      } catch {
        // INTENTIONAL: Process exited - break loop to continue cleanup
        break;
      }
    }

    // Clean up
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE);
    }
    if (existsSync(SOCKET_PATH)) {
      unlinkSync(SOCKET_PATH);
    }

    console.log('[DaemonCLI] Daemon stopped');
  } catch (error) {
    console.log(`[DaemonCLI] Failed to stop daemon: ${error}`);
    // Clean up anyway
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE);
    }
  }
}

function statusDaemon(): void {
  console.log('\n=== God Agent Daemon Status ===\n');

  // Check PID file
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    console.log(`PID File: exists`);
    console.log(`  PID: ${pid}`);

    try {
      process.kill(pid, 0);
      console.log(`  Process: RUNNING`);
    } catch {
      // INTENTIONAL: Process not found - stale PID file detected
      console.log(`  Process: NOT RUNNING (stale PID file)`);
    }
  } else {
    console.log('PID File: not found');
  }

  // Check socket
  console.log(`\nSocket: ${SOCKET_PATH}`);
  if (existsSync(SOCKET_PATH)) {
    console.log('  Status: EXISTS');
  } else {
    console.log('  Status: NOT FOUND');
  }

  console.log('');
}

// Main
const command = process.argv[2];

switch (command) {
  case 'start':
    startDaemon().catch((error) => {
      console.error('[DaemonCLI] Failed to start:', error.message);
      process.exit(1);
    });
    break;
  case 'stop':
    stopDaemon().catch((error) => {
      console.error('[DaemonCLI] Failed to stop:', error.message);
      process.exit(1);
    });
    break;
  case 'status':
    statusDaemon();
    break;
  default:
    console.log('Usage: daemon-cli.ts <start|stop|status>');
    process.exit(1);
}
