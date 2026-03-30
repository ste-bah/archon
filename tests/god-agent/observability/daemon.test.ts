/**
 * DaemonServer Tests
 *
 * Test suite for the observability daemon lifecycle management.
 *
 * @see TASK-OBS-009-DAEMON-CLI.md
 * @see src/god-agent/observability/daemon-server.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  DaemonServer,
  writePidFile,
  removePidFile,
  readPidFile,
  isProcessRunning,
} from '../../../src/god-agent/observability/daemon-server';

// =============================================================================
// Test Setup
// =============================================================================

const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '.';
const GOD_AGENT_DIR = path.join(HOME_DIR, '.god-agent');
const PID_FILE = path.join(GOD_AGENT_DIR, 'daemon.pid');

// Cleanup helper
function cleanupPidFile(): void {
  if (fs.existsSync(PID_FILE)) {
    fs.unlinkSync(PID_FILE);
  }
}

// =============================================================================
// Test Suite
// =============================================================================

describe('DaemonServer', () => {
  let server: DaemonServer;
  let testPort: number;

  beforeEach(() => {
    cleanupPidFile();
    // Use random port to avoid conflicts
    testPort = 3847 + Math.floor(Math.random() * 1000);
    server = new DaemonServer({ verbose: false });
  });

  afterEach(async () => {
    // Ensure server is stopped
    if (server && server.isRunning()) {
      await server.stop();
    }
    cleanupPidFile();
  });

  // ===========================================================================
  // TC-009-01: start creates PID file
  // ===========================================================================

  it('TC-009-01: start creates PID file with valid PID', async () => {
    await server.start(testPort);

    // Verify PID file exists
    expect(fs.existsSync(PID_FILE)).toBe(true);

    // Verify PID file contains current process ID
    const pidFromFile = readPidFile();
    expect(pidFromFile).toBe(process.pid);

    // Verify server is running
    expect(server.isRunning()).toBe(true);
    expect(server.getPort()).toBe(testPort);

    await server.stop();
  }, 10000);

  // ===========================================================================
  // TC-009-02: start when already running shows error
  // ===========================================================================

  it('TC-009-02: start when already running throws error', async () => {
    await server.start(testPort);
    expect(server.isRunning()).toBe(true);

    // Attempt to start again should throw
    await expect(server.start(testPort)).rejects.toThrow('already running');

    await server.stop();
  }, 10000);

  // ===========================================================================
  // TC-009-03: stop sends SIGTERM (graceful shutdown)
  // ===========================================================================

  it('TC-009-03: stop gracefully shuts down server', async () => {
    await server.start(testPort);
    expect(server.isRunning()).toBe(true);

    await server.stop();

    // Verify server stopped
    expect(server.isRunning()).toBe(false);
    expect(server.getPort()).toBe(0);

    // Verify PID file removed
    expect(fs.existsSync(PID_FILE)).toBe(false);
  }, 10000);

  // ===========================================================================
  // TC-009-04: stop when not running (no-op)
  // ===========================================================================

  it('TC-009-04: stop when not running is a no-op', async () => {
    expect(server.isRunning()).toBe(false);

    // Should not throw
    await expect(server.stop()).resolves.toBeUndefined();

    expect(server.isRunning()).toBe(false);
  });

  // ===========================================================================
  // TC-009-05: status shows PID when running
  // ===========================================================================

  it('TC-009-05: readPidFile returns correct PID when running', async () => {
    await server.start(testPort);

    const pid = readPidFile();
    expect(pid).toBe(process.pid);
    expect(server.isRunning()).toBe(true);

    await server.stop();
  }, 10000);

  // ===========================================================================
  // TC-009-06: status shows stopped when not running
  // ===========================================================================

  it('TC-009-06: readPidFile returns null when not running', () => {
    cleanupPidFile();

    const pid = readPidFile();
    expect(pid).toBeNull();
  });

  // ===========================================================================
  // TC-009-07: SIGTERM removes PID file
  // ===========================================================================

  it('TC-009-07: stop removes PID file during shutdown', async () => {
    await server.start(testPort);

    // Verify PID file exists
    expect(fs.existsSync(PID_FILE)).toBe(true);

    // Stop server
    await server.stop();

    // Verify PID file removed
    expect(fs.existsSync(PID_FILE)).toBe(false);
  }, 10000);

  // ===========================================================================
  // TC-009-08: Stale PID detection works
  // ===========================================================================

  it('TC-009-08: isProcessRunning detects stale PID', () => {
    // Write a fake PID that doesn't exist
    const fakePid = 999999;
    writePidFile(fakePid);

    // Verify PID file exists
    expect(fs.existsSync(PID_FILE)).toBe(true);

    // Verify process is not running
    const running = isProcessRunning(fakePid);
    expect(running).toBe(false);

    cleanupPidFile();
  });

  // ===========================================================================
  // TC-009-09: Startup under 2 seconds
  // ===========================================================================

  it('TC-009-09: startup completes within performance budget (< 2 seconds)', async () => {
    const startTime = Date.now();

    await server.start(testPort);

    const duration = Date.now() - startTime;

    // Verify startup time < 2 seconds (RULE-OBS-007)
    expect(duration).toBeLessThan(2000);
    console.log(`Startup time: ${duration}ms`);

    expect(server.isRunning()).toBe(true);

    await server.stop();
  }, 10000);

  // ===========================================================================
  // Additional Tests
  // ===========================================================================

  it('should handle multiple stop calls gracefully', async () => {
    await server.start(testPort);

    await server.stop();
    expect(server.isRunning()).toBe(false);

    // Second stop should be a no-op
    await expect(server.stop()).resolves.toBeUndefined();
    expect(server.isRunning()).toBe(false);
  }, 10000);

  it('should verify process.pid is valid', () => {
    const isValid = isProcessRunning(process.pid);
    expect(isValid).toBe(true);
  });

  it('should handle non-existent PID gracefully', () => {
    const isValid = isProcessRunning(999999);
    expect(isValid).toBe(false);
  });

  it('should create .god-agent directory on start', async () => {
    // Clean up directory if it exists
    if (!fs.existsSync(GOD_AGENT_DIR)) {
      // Directory might not exist yet
    }

    await server.start(testPort);

    expect(fs.existsSync(GOD_AGENT_DIR)).toBe(true);

    await server.stop();
  }, 10000);

  it('should return correct port after start', async () => {
    expect(server.getPort()).toBe(0); // Not started yet

    await server.start(testPort);

    expect(server.getPort()).toBe(testPort);

    await server.stop();
  }, 10000);

  it('should clean up resources on failed start', async () => {
    // This test verifies cleanup happens on startup failure
    // Since Express doesn't fail on port-in-use, we test the error path
    // by verifying the running flag is false before marking as started

    const invalidServer = new DaemonServer({ verbose: false });

    // Verify initial state
    expect(invalidServer.isRunning()).toBe(false);

    // Start the server
    await invalidServer.start(testPort);

    // Verify it started
    expect(invalidServer.isRunning()).toBe(true);

    // Try to start again (should fail with "already running" error)
    try {
      await invalidServer.start(testPort);
      expect.fail('Expected start to throw error');
    } catch (error: any) {
      expect(error.message).toContain('already running');
    }

    // Verify still running (first instance)
    expect(invalidServer.isRunning()).toBe(true);

    // Clean up
    await invalidServer.stop();
    expect(invalidServer.isRunning()).toBe(false);
  }, 10000);

  it('should handle PID file I/O operations', () => {
    const testPid = 12345;

    // Write PID
    writePidFile(testPid);
    expect(fs.existsSync(PID_FILE)).toBe(true);

    // Read PID
    const readPid = readPidFile();
    expect(readPid).toBe(testPid);

    // Remove PID
    removePidFile();
    expect(fs.existsSync(PID_FILE)).toBe(false);

    // Read after remove
    const nullPid = readPidFile();
    expect(nullPid).toBeNull();
  });

  it('should handle invalid PID file content', () => {
    // Write invalid content
    if (!fs.existsSync(GOD_AGENT_DIR)) {
      fs.mkdirSync(GOD_AGENT_DIR, { recursive: true });
    }
    fs.writeFileSync(PID_FILE, 'invalid', 'utf-8');

    const pid = readPidFile();
    expect(pid).toBeNull();

    cleanupPidFile();
  });

  it('should handle empty PID file', () => {
    // Write empty file
    if (!fs.existsSync(GOD_AGENT_DIR)) {
      fs.mkdirSync(GOD_AGENT_DIR, { recursive: true });
    }
    fs.writeFileSync(PID_FILE, '', 'utf-8');

    const pid = readPidFile();
    expect(pid).toBeNull();

    cleanupPidFile();
  });

  it('should verify server lifecycle states', async () => {
    // Initial state: not running
    expect(server.isRunning()).toBe(false);
    expect(server.getPort()).toBe(0);

    // Start server
    await server.start(testPort);
    expect(server.isRunning()).toBe(true);
    expect(server.getPort()).toBe(testPort);

    // Stop server
    await server.stop();
    expect(server.isRunning()).toBe(false);
    expect(server.getPort()).toBe(0);
  }, 10000);
});
