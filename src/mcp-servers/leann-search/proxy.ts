#!/usr/bin/env node
/**
 * LEANN MCP Proxy
 *
 * Thin relay between Claude Code's stdio MCP transport and the
 * LEANN daemon's Unix socket. Auto-starts the daemon if not running.
 */

import * as net from 'net';
import * as fs from 'fs/promises';
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

const PROJECT_ROOT = process.cwd(); // Claude Code runs MCP servers from project root
const RUN_DIR = path.join(PROJECT_ROOT, '.run');
const SOCKET_PATH = path.join(RUN_DIR, 'leann.sock');
const PID_PATH = path.join(RUN_DIR, 'leann-daemon.pid');
const SPAWN_LOCK = path.join(RUN_DIR, 'leann-spawn.lock');
const DAEMON_SCRIPT = path.join(PROJECT_ROOT, 'src/mcp-servers/leann-search/daemon.ts');

/** Max age of spawn lock before considered stale (seconds) */
const LOCK_STALE_AGE_S = 60;

function stderr(msg: string) {
  process.stderr.write(`[LEANN proxy] ${msg}\n`);
}

/**
 * Check if daemon is alive by verifying PID file + process liveness.
 * Uses process.kill(pid, 0) for liveness and PID file contents for identity.
 * Does NOT use `ps` command — avoids platform fragility and blocking execSync.
 */
function isDaemonAlive(): boolean {
  try {
    const raw = readFileSync(PID_PATH, 'utf-8');
    const data = JSON.parse(raw);
    const pid = data.pid;
    if (typeof pid !== 'number' || pid <= 0) return false;

    // Check if process exists (throws if not)
    process.kill(pid, 0);

    // Verify PID file has expected fields (daemon wrote it)
    if (!data.version || !data.socketPath) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Clean up stale spawn lock if older than LOCK_STALE_AGE_S.
 */
async function cleanStaleLock(): Promise<void> {
  try {
    const stat = await fs.stat(SPAWN_LOCK);
    const ageS = (Date.now() - stat.mtimeMs) / 1000;
    if (ageS > LOCK_STALE_AGE_S) {
      stderr(`Removing stale spawn lock (${Math.round(ageS)}s old)`);
      await fs.unlink(SPAWN_LOCK);
    }
  } catch {
    // Lock doesn't exist — fine
  }
}

async function acquireSpawnLock(): Promise<fs.FileHandle | null> {
  try {
    await fs.mkdir(RUN_DIR, { recursive: true });
    // O_CREAT | O_EXCL — atomic create, fails if exists
    const fd = await fs.open(SPAWN_LOCK, 'wx');
    return fd;
  } catch {
    return null; // Lock held by another proxy
  }
}

async function releaseSpawnLock(fd: fs.FileHandle | null) {
  if (fd) {
    await fd.close();
    try { await fs.unlink(SPAWN_LOCK); } catch {}
  }
}

async function startDaemon(): Promise<void> {
  stderr('Starting daemon...');

  // Find npx alongside the current node binary
  const npxPath = process.argv[0]?.includes('node')
    ? path.join(path.dirname(process.argv[0]), 'npx')
    : 'npx';

  const child = spawn(npxPath, ['tsx', DAEMON_SCRIPT], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      LEANN_PROJECT_ROOT: PROJECT_ROOT,
      LEANN_PERSIST_PATH: process.env.LEANN_PERSIST_PATH || path.join(PROJECT_ROOT, 'vector_db_leann'),
    },
  });

  child.unref();
  stderr(`Daemon spawned (PID ${child.pid})`);
}

/**
 * Wait for the daemon socket to become available.
 * First checks for socket file existence (cheap), then attempts connection.
 */
async function waitForSocket(timeoutMs: number = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // Cheap check first: does socket file exist?
    if (!existsSync(SOCKET_PATH)) {
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    // Try connecting
    try {
      await new Promise<void>((resolve, reject) => {
        const sock = net.connect(SOCKET_PATH);
        const timer = setTimeout(() => { sock.destroy(); reject(new Error('timeout')); }, 2000);
        sock.on('connect', () => { clearTimeout(timer); sock.destroy(); resolve(); });
        sock.on('error', (err) => { clearTimeout(timer); reject(err); });
      });
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return false;
}

async function connectAndRelay(): Promise<void> {
  const socket = net.connect(SOCKET_PATH);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Socket connect timeout')); }, 5000);
    socket.on('connect', () => { clearTimeout(timer); resolve(); });
    socket.on('error', (err) => { clearTimeout(timer); reject(err); });
  });

  stderr('Connected to daemon');

  // Relay: stdin → socket, socket → stdout
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);

  // Exit when socket closes
  socket.on('close', () => {
    stderr('Daemon connection closed');
    process.exit(0);
  });

  socket.on('error', (err) => {
    stderr(`Socket error: ${err.message}`);
    process.exit(1);
  });

  process.stdin.on('end', () => {
    socket.end();
  });
}

async function main() {
  // Clean stale spawn lock from crashed proxies (H1 fix)
  await cleanStaleLock();

  // Check if daemon is already running — use socket connect as the real liveness test
  let daemonRunning = isDaemonAlive() && existsSync(SOCKET_PATH);

  if (!daemonRunning) {
    // Try to acquire spawn lock before cleaning up files (H3 fix)
    const lock = await acquireSpawnLock();
    if (lock) {
      try {
        // Re-check liveness AFTER acquiring lock to avoid race (H3 fix)
        if (isDaemonAlive() && existsSync(SOCKET_PATH)) {
          stderr('Daemon came alive while acquiring lock');
          daemonRunning = true;
        } else {
          // Safe to clean up stale files — we hold the lock
          try { await fs.unlink(SOCKET_PATH); } catch {}
          try { await fs.unlink(PID_PATH); } catch {}

          await startDaemon();
          const ready = await waitForSocket(30000);
          if (!ready) {
            stderr('Daemon failed to start within 30s');
            process.exit(1);
          }
          daemonRunning = true;
        }
      } finally {
        await releaseSpawnLock(lock);
      }
    } else {
      // Another proxy is starting the daemon — wait for socket
      stderr('Waiting for another proxy to start daemon...');
      const ready = await waitForSocket(30000);
      if (!ready) {
        stderr('Daemon not ready after 30s');
        process.exit(1);
      }
      daemonRunning = true;
    }
  }

  await connectAndRelay();
}

main().catch((err) => {
  stderr(`Fatal: ${err.message}`);
  process.exit(1);
});
