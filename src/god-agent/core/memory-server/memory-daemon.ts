#!/usr/bin/env node
/**
 * Memory Server Daemon Entry Point
 * MEM-001 - Standalone daemon process for memory operations
 *
 * This script runs the MemoryServer as an independent daemon process
 * that persists beyond the parent process lifecycle.
 *
 * Usage:
 *   npx tsx src/god-agent/core/memory-server/memory-daemon.ts start
 *   npx tsx src/god-agent/core/memory-server/memory-daemon.ts stop
 *   npx tsx src/god-agent/core/memory-server/memory-daemon.ts status
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { MemoryServer } from './memory-server.js';
import { MemoryHealthMonitor } from './memory-health.js';
import type { IMemoryServerConfig } from '../types/memory-types.js';

// ==================== Constants ====================

const DEFAULT_AGENTDB_PATH = path.join(process.cwd(), '.agentdb');
const DAEMON_LOG_FILE = 'memory-daemon.log';

// ==================== Logging ====================

async function log(level: string, message: string, context?: Record<string, unknown>): Promise<void> {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    component: 'MemoryDaemon',
    message,
    pid: process.pid,
    ...context,
  };

  const logLine = JSON.stringify(entry);
  console.log(logLine);

  // Also write to log file for debugging
  try {
    const logPath = path.join(DEFAULT_AGENTDB_PATH, DAEMON_LOG_FILE);
    await fs.appendFile(logPath, logLine + '\n');
  } catch {
    // INTENTIONAL: Log file write errors are non-critical - daemon continues operation
  }
}

// ==================== Signal Handlers ====================

function setupSignalHandlers(server: MemoryServer): void {
  const shutdown = async (signal: string) => {
    await log('info', `Received ${signal}, shutting down gracefully...`);
    try {
      await server.stop();
      await log('info', 'Memory server stopped successfully');
      process.exit(0);
    } catch (error) {
      await log('error', 'Error during shutdown', { error: String(error) });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    await log('error', 'Uncaught exception', { error: error.message, stack: error.stack });
    await server.stop();
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason) => {
    await log('error', 'Unhandled rejection', { reason: String(reason) });
  });
}

// ==================== Commands ====================

async function startDaemon(config: Partial<IMemoryServerConfig> = {}): Promise<void> {
  await log('info', 'Starting memory server daemon...');

  // Ensure storage directory exists
  await fs.mkdir(config.agentDbPath ?? DEFAULT_AGENTDB_PATH, { recursive: true });

  const server = new MemoryServer({
    agentDbPath: config.agentDbPath ?? DEFAULT_AGENTDB_PATH,
    verbose: config.verbose ?? false,
    ...config,
  });

  setupSignalHandlers(server);

  try {
    const address = await server.start();
    await log('info', `Memory server daemon started at ${address}`, { pid: process.pid });

    // Keep the process alive
    await log('info', 'Daemon running. Send SIGTERM to stop.');

    // Heartbeat logging
    setInterval(async () => {
      const state = server.getState();
      if (state === 'ready') {
        await log('debug', 'Daemon heartbeat', { state, pid: process.pid });
      }
    }, 60000); // Log every minute

  } catch (error) {
    if (error instanceof Error && error.message.includes('Cannot start server')) {
      await log('info', 'Server already running, exiting');
      process.exit(0);
    }
    await log('error', 'Failed to start daemon', { error: String(error) });
    process.exit(1);
  }
}

async function stopDaemon(agentDbPath: string = DEFAULT_AGENTDB_PATH): Promise<void> {
  const pidPath = path.join(agentDbPath, 'memory-server.pid');

  try {
    const content = await fs.readFile(pidPath, 'utf-8');
    const pidFile = JSON.parse(content);

    // Check if process is running
    try {
      process.kill(pidFile.pid, 0);
      // Process is running, send SIGTERM
      console.log(`Stopping memory server daemon (PID: ${pidFile.pid})...`);
      process.kill(pidFile.pid, 'SIGTERM');

      // Wait for process to stop (max 5 seconds)
      for (let i = 0; i < 50; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        try {
          process.kill(pidFile.pid, 0);
        } catch {
          // INTENTIONAL: Process exited - successful stop
          console.log('Memory server daemon stopped.');
          return;
        }
      }

      // Force kill if still running
      console.log('Daemon not responding, sending SIGKILL...');
      process.kill(pidFile.pid, 'SIGKILL');
      console.log('Memory server daemon killed.');

    } catch {
      // INTENTIONAL: Process not running - clean up stale PID file
      console.log('Daemon not running. Cleaning up stale PID file...');
      await fs.unlink(pidPath).catch(() => {});
    }
  } catch {
    // INTENTIONAL: No PID file found - daemon is not running
    console.log('No PID file found. Daemon is not running.');
  }
}

async function statusDaemon(agentDbPath: string = DEFAULT_AGENTDB_PATH): Promise<void> {
  const monitor = new MemoryHealthMonitor(agentDbPath);
  const diagnostics = await monitor.getDiagnostics();

  console.log('\n=== Memory Server Daemon Status ===\n');

  if (!diagnostics.pidFileExists) {
    console.log('Status: NOT RUNNING (no PID file)');
    console.log(`Storage: ${diagnostics.storageStatus?.exists ? 'exists' : 'not found'}`);
    return;
  }

  console.log(`PID File: ${diagnostics.pidFileExists ? 'exists' : 'missing'}`);
  if (diagnostics.pidFileContent) {
    console.log(`  PID: ${diagnostics.pidFileContent.pid}`);
    console.log(`  Address: ${diagnostics.pidFileContent.address}`);
    console.log(`  Started: ${new Date(diagnostics.pidFileContent.startedAt).toISOString()}`);
    console.log(`  Version: ${diagnostics.pidFileContent.version}`);
  }

  console.log(`\nProcess: ${diagnostics.serverProcessRunning ? 'RUNNING' : 'NOT RUNNING'}`);
  console.log(`Server Reachable: ${diagnostics.serverReachable ? 'YES' : 'NO'}`);

  if (diagnostics.storageStatus) {
    console.log(`\nStorage:`);
    console.log(`  Path: ${agentDbPath}`);
    console.log(`  Exists: ${diagnostics.storageStatus.exists}`);
    if (diagnostics.storageStatus.permissions) {
      console.log(`  Permissions: ${diagnostics.storageStatus.permissions}`);
    }
  }

  // If process not running but PID file exists, it's stale
  if (diagnostics.pidFileExists && !diagnostics.serverProcessRunning) {
    console.log('\n[!] Stale PID file detected. Run "stop" to clean up.');
  }

  console.log('');
}

// ==================== Main ====================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'start';
  const agentDbPath = args[1] || DEFAULT_AGENTDB_PATH;

  switch (command) {
    case 'start':
      await startDaemon({ agentDbPath, verbose: args.includes('--verbose') });
      break;

    case 'stop':
      await stopDaemon(agentDbPath);
      break;

    case 'status':
      await statusDaemon(agentDbPath);
      break;

    case 'help':
    case '--help':
    case '-h':
      console.log(`
Memory Server Daemon

Usage:
  npx tsx memory-daemon.ts <command> [agentDbPath] [options]

Commands:
  start     Start the memory server daemon (default)
  stop      Stop a running daemon
  status    Check daemon status

Options:
  --verbose  Enable verbose logging

Examples:
  npx tsx memory-daemon.ts start
  npx tsx memory-daemon.ts start .agentdb --verbose
  npx tsx memory-daemon.ts stop
  npx tsx memory-daemon.ts status
`);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Use --help for usage information.');
      process.exit(1);
  }
}

main().catch(async (error) => {
  await log('error', 'Daemon main error', { error: String(error) });
  process.exit(1);
});
