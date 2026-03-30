/**
 * Daemon Launcher
 * MEM-001 - Spawns memory server as a detached daemon process
 *
 * This module provides functions to start, stop, and manage the
 * memory server daemon as a truly independent background process.
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { discoverMemoryServer, MemoryHealthMonitor } from './memory-health.js';
import type { IPidFileContent } from '../types/memory-types.js';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== Constants ====================

const DAEMON_SCRIPT = 'memory-daemon.ts';
const DAEMON_STARTUP_TIMEOUT_MS = 10000;
const DAEMON_CHECK_INTERVAL_MS = 100;

// ==================== Types ====================

export interface IDaemonLaunchResult {
  success: boolean;
  address?: string;
  pid?: number;
  error?: string;
  alreadyRunning?: boolean;
}

export interface IDaemonStopResult {
  success: boolean;
  wasRunning: boolean;
  error?: string;
}

export interface IDaemonStatus {
  running: boolean;
  pid?: number;
  address?: string;
  uptime?: number;
  version?: string;
  reachable?: boolean;
}

// ==================== Daemon Launcher ====================

/**
 * Launch the memory server as a detached daemon process
 */
export async function launchDaemon(
  agentDbPath: string = '.agentdb',
  options: { verbose?: boolean } = {}
): Promise<IDaemonLaunchResult> {
  // Check if already running
  const existingAddress = await discoverMemoryServer(agentDbPath);
  if (existingAddress) {
    const pidFile = await readPidFile(agentDbPath);
    return {
      success: true,
      address: existingAddress,
      pid: pidFile?.pid,
      alreadyRunning: true,
    };
  }

  // Find the daemon script
  const daemonPath = await findDaemonScript();
  if (!daemonPath) {
    return {
      success: false,
      error: 'Could not find memory-daemon.ts script',
    };
  }

  // Ensure .agentdb directory exists
  const fullAgentDbPath = path.isAbsolute(agentDbPath)
    ? agentDbPath
    : path.join(process.cwd(), agentDbPath);
  await fs.mkdir(fullAgentDbPath, { recursive: true });

  // Build command arguments
  const args = ['tsx', daemonPath, 'start', fullAgentDbPath];
  if (options.verbose) {
    args.push('--verbose');
  }

  // Spawn detached process
  const logPath = path.join(fullAgentDbPath, 'daemon-spawn.log');
  const logFd = await fs.open(logPath, 'a');

  const child: ChildProcess = spawn('npx', args, {
    detached: true,
    stdio: ['ignore', logFd.fd, logFd.fd],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'production',
    },
  });

  // Unref to allow parent to exit
  child.unref();

  // Wait for daemon to start
  const startTime = Date.now();
  while (Date.now() - startTime < DAEMON_STARTUP_TIMEOUT_MS) {
    await new Promise(resolve => setTimeout(resolve, DAEMON_CHECK_INTERVAL_MS));

    const address = await discoverMemoryServer(fullAgentDbPath);
    if (address) {
      // Verify it's actually reachable
      const monitor = new MemoryHealthMonitor(fullAgentDbPath);
      const healthy = await monitor.isServerHealthy(address);
      if (healthy) {
        const pidFile = await readPidFile(fullAgentDbPath);
        await logFd.close();
        return {
          success: true,
          address,
          pid: pidFile?.pid,
          alreadyRunning: false,
        };
      }
    }
  }

  await logFd.close();

  // Startup timeout
  return {
    success: false,
    error: `Daemon startup timeout after ${DAEMON_STARTUP_TIMEOUT_MS}ms`,
  };
}

/**
 * Stop the memory server daemon
 */
export async function stopDaemon(agentDbPath: string = '.agentdb'): Promise<IDaemonStopResult> {
  const fullAgentDbPath = path.isAbsolute(agentDbPath)
    ? agentDbPath
    : path.join(process.cwd(), agentDbPath);

  const pidFile = await readPidFile(fullAgentDbPath);
  if (!pidFile) {
    return { success: true, wasRunning: false };
  }

  // Check if process is running
  if (!isProcessRunning(pidFile.pid)) {
    // Clean up stale PID file
    await cleanupPidFile(fullAgentDbPath);
    return { success: true, wasRunning: false };
  }

  // Send SIGTERM
  try {
    process.kill(pidFile.pid, 'SIGTERM');
  } catch (error) {
    return {
      success: false,
      wasRunning: true,
      error: `Failed to send SIGTERM: ${error}`,
    };
  }

  // Wait for graceful shutdown (max 5 seconds)
  const stopStart = Date.now();
  while (Date.now() - stopStart < 5000) {
    await new Promise(resolve => setTimeout(resolve, 100));
    if (!isProcessRunning(pidFile.pid)) {
      return { success: true, wasRunning: true };
    }
  }

  // Force kill
  try {
    process.kill(pidFile.pid, 'SIGKILL');
    await new Promise(resolve => setTimeout(resolve, 100));
    await cleanupPidFile(fullAgentDbPath);
    return { success: true, wasRunning: true };
  } catch (error) {
    return {
      success: false,
      wasRunning: true,
      error: `Failed to kill daemon: ${error}`,
    };
  }
}

/**
 * Get daemon status
 */
export async function getDaemonStatus(agentDbPath: string = '.agentdb'): Promise<IDaemonStatus> {
  const fullAgentDbPath = path.isAbsolute(agentDbPath)
    ? agentDbPath
    : path.join(process.cwd(), agentDbPath);

  const pidFile = await readPidFile(fullAgentDbPath);
  if (!pidFile) {
    return { running: false };
  }

  const running = isProcessRunning(pidFile.pid);
  if (!running) {
    return { running: false };
  }

  // Check if reachable
  const monitor = new MemoryHealthMonitor(fullAgentDbPath);
  const reachable = await monitor.isServerHealthy(pidFile.address);

  return {
    running: true,
    pid: pidFile.pid,
    address: pidFile.address,
    uptime: Date.now() - pidFile.startedAt,
    version: pidFile.version,
    reachable,
  };
}

/**
 * Ensure daemon is running, launching if necessary
 */
export async function ensureDaemonRunning(
  agentDbPath: string = '.agentdb',
  options: { verbose?: boolean } = {}
): Promise<IDaemonLaunchResult> {
  const status = await getDaemonStatus(agentDbPath);

  if (status.running && status.reachable) {
    return {
      success: true,
      address: status.address,
      pid: status.pid,
      alreadyRunning: true,
    };
  }

  // Not running or not reachable, try to launch
  if (status.running && !status.reachable) {
    // Zombie daemon - stop and restart
    await stopDaemon(agentDbPath);
  }

  return launchDaemon(agentDbPath, options);
}

// ==================== Helper Functions ====================

async function findDaemonScript(): Promise<string | null> {
  // Check relative to this file
  const candidates = [
    path.join(__dirname, DAEMON_SCRIPT),
    path.join(process.cwd(), 'src/god-agent/core/memory-server', DAEMON_SCRIPT),
    path.join(process.cwd(), 'dist/god-agent/core/memory-server', DAEMON_SCRIPT.replace('.ts', '.js')),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // INTENTIONAL: Not found at this location - try next candidate path
    }
  }

  return null;
}

async function readPidFile(agentDbPath: string): Promise<IPidFileContent | null> {
  const pidPath = path.join(agentDbPath, 'memory-server.pid');
  try {
    const content = await fs.readFile(pidPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    // INTENTIONAL: PID file not found or parse failure - return null
    return null;
  }
}

async function cleanupPidFile(agentDbPath: string): Promise<void> {
  const pidPath = path.join(agentDbPath, 'memory-server.pid');
  try {
    await fs.unlink(pidPath);
  } catch {
    // INTENTIONAL: PID file already removed or doesn't exist - safe to ignore
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // INTENTIONAL: Process.kill(0) failure means process not running
    return false;
  }
}

// ==================== Exports ====================

export {
  launchDaemon as startMemoryDaemon,
  stopDaemon as stopMemoryDaemon,
  getDaemonStatus as getMemoryDaemonStatus,
  ensureDaemonRunning as ensureMemoryDaemonRunning,
};
