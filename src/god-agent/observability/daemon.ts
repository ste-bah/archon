#!/usr/bin/env node
/**
 * Daemon CLI - Observability Daemon Management
 *
 * Command-line interface for managing the observability daemon:
 * - start: Launch daemon (foreground or background)
 * - stop: Stop daemon gracefully
 * - status: Show daemon state
 * - open: Open dashboard in browser
 *
 * @module observability/daemon
 * @see TASK-OBS-009-DAEMON-CLI.md
 * @see SPEC-OBS-001-CORE.md
 */

import { Command } from 'commander';
import { DaemonServer, removePidFile, readPidFile, isProcessRunning } from './daemon-server.js';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as os from 'os';
import { fileURLToPath } from 'url';

// ESM compatibility for __filename
const __filename = fileURLToPath(import.meta.url);

// =============================================================================
// Constants
// =============================================================================

const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '.';
const GOD_AGENT_DIR = path.join(HOME_DIR, '.god-agent');
const PID_FILE = path.join(GOD_AGENT_DIR, 'daemon.pid');
const LOG_FILE = path.join(GOD_AGENT_DIR, 'daemon.log');

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if daemon is running by validating PID file
 * Implements [REQ-OBS-12]: Stale PID detection
 */
function isDaemonRunning(): boolean {
  const pid = readPidFile();
  if (!pid) {
    return false;
  }

  // Check if process exists
  if (!isProcessRunning(pid)) {
    // Stale PID file - clean it up
    console.log(`Removing stale PID file (process ${pid} not found)`);
    removePidFile();
    return false;
  }

  return true;
}

/**
 * Start daemon in foreground
 */
async function startDaemon(port: number): Promise<void> {
  const server = new DaemonServer({ verbose: true });
  await server.start(port);
  // Keep process alive
  await new Promise(() => {}); // Never resolves
}

/**
 * Open dashboard URL in browser
 */
function openDashboard(port: number): void {
  const url = `http://localhost:${port}`;

  // Platform-specific open command
  let openCmd: string;
  switch (os.platform()) {
    case 'darwin':
      openCmd = 'open';
      break;
    case 'win32':
      openCmd = 'start';
      break;
    default:
      openCmd = 'xdg-open';
  }

  const child = spawn(openCmd, [url], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  console.log(`Opening dashboard: ${url}`);
}

// =============================================================================
// CLI Commands
// =============================================================================

const program = new Command();

program
  .name('god-agent-observe')
  .description('God Agent Observability Daemon')
  .version('1.0.0');

/**
 * Start command
 * Implements [REQ-OBS-12]: Start daemon with PID file management
 */
program
  .command('start')
  .description('Start the observability daemon')
  .option('-d, --daemon', 'Run in background (daemon mode)')
  .option('-p, --port <port>', 'Dashboard port', '3847')
  .action(async (options) => {
    // Check if already running
    if (isDaemonRunning()) {
      console.error('Error: Daemon is already running');
      const pid = readPidFile();
      console.log(`Current PID: ${pid}`);
      console.log('Use "stop" command to stop it first');
      process.exit(1);
    }

    const port = parseInt(options.port, 10);

    if (options.daemon) {
      // Ensure directory exists
      if (!fs.existsSync(GOD_AGENT_DIR)) {
        fs.mkdirSync(GOD_AGENT_DIR, { recursive: true });
      }

      // Fork to background using tsx for TypeScript support
      const args = ['tsx', __filename, 'start', '--port', port.toString()];
      const child = spawn('npx', args, {
        detached: true,
        stdio: ['ignore', fs.openSync(LOG_FILE, 'a'), fs.openSync(LOG_FILE, 'a')],
      });

      child.unref();

      // Give it a moment to start (npx tsx needs more time than node)
      await new Promise(resolve => setTimeout(resolve, 2500));

      // Verify it started
      if (isDaemonRunning()) {
        const pid = readPidFile();
        console.log(`Daemon started successfully`);
        console.log(`PID: ${pid}`);
        console.log(`Dashboard: http://localhost:${port}`);
        console.log(`Logs: ${LOG_FILE}`);
      } else {
        console.error('Error: Daemon failed to start');
        console.log(`Check logs: ${LOG_FILE}`);
        process.exit(1);
      }
    } else {
      // Run in foreground
      console.log('Starting daemon in foreground...');
      console.log('Press Ctrl+C to stop');
      await startDaemon(port);
    }
  });

/**
 * Stop command
 * Implements [REQ-OBS-12]: Send SIGTERM to daemon
 */
program
  .command('stop')
  .description('Stop the observability daemon')
  .action(() => {
    const pid = readPidFile();

    if (!pid) {
      console.log('Daemon is not running');
      process.exit(1);
    }

    // Check if process exists
    if (!isProcessRunning(pid)) {
      console.log('Daemon is not running (stale PID file)');
      removePidFile();
      process.exit(1);
    }

    try {
      console.log(`Stopping daemon (PID: ${pid})...`);
      process.kill(pid, 'SIGTERM');

      // Wait for process to exit (with timeout)
      const maxWait = 5000; // 5 seconds
      const startTime = Date.now();

      while (isProcessRunning(pid) && (Date.now() - startTime) < maxWait) {
        // Busy wait with small sleep
        const waitMs = 100;
        const start = Date.now();
        while (Date.now() - start < waitMs) {
          // Spin
        }
      }

      if (isProcessRunning(pid)) {
        console.log('Daemon did not stop gracefully, sending SIGKILL...');
        process.kill(pid, 'SIGKILL');
      }

      console.log('Daemon stopped successfully');
    } catch (error: any) {
      if (error.code === 'ESRCH') {
        // Process not found - clean up stale PID file
        console.log('Daemon is not running (process not found)');
        removePidFile();
      } else {
        console.error(`Failed to stop daemon: ${error.message}`);
        process.exit(1);
      }
    }
  });

/**
 * Status command
 * Implements [REQ-OBS-12]: Show daemon state with PID
 */
program
  .command('status')
  .description('Show daemon status')
  .option('-p, --port <port>', 'Dashboard port', '3847')
  .action((options) => {
    const pid = readPidFile();

    if (!pid || !isProcessRunning(pid)) {
      console.log('Daemon: stopped');
      if (pid) {
        console.log('(Stale PID file detected and cleaned up)');
        removePidFile();
      }
      return;
    }

    const port = parseInt(options.port, 10);
    console.log('Daemon: running');
    console.log(`PID: ${pid}`);
    console.log(`Dashboard: http://localhost:${port}`);
    console.log(`Logs: ${LOG_FILE}`);

    // TODO: Query /api/health for more detailed stats
  });

/**
 * Open command
 * Opens dashboard in default browser
 */
program
  .command('open')
  .description('Open dashboard in browser')
  .option('-p, --port <port>', 'Dashboard port', '3847')
  .action((options) => {
    const port = parseInt(options.port, 10);

    if (!isDaemonRunning()) {
      console.error('Error: Daemon is not running');
      console.log('Start the daemon first with "start" command');
      process.exit(1);
    }

    openDashboard(port);
  });

// =============================================================================
// Parse and Execute
// =============================================================================

program.parse();
