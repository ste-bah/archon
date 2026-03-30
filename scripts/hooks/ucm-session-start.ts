#!/usr/bin/env node
/**
 * UCM Session Start Hook (HOOK-004)
 * SessionStart hook
 *
 * Ensures BOTH main daemon and UCM daemon are running,
 * then initializes session state in the context engine.
 */

import * as net from 'net';
import * as readline from 'readline';
import { spawn } from 'child_process';
import * as fs from 'fs';

interface SessionStartInput {
  session_id: string;
  project_path?: string;
  agent_config?: any;
}

interface SessionStartOutput {
  success: boolean;
  main_daemon_running: boolean;
  ucm_daemon_running: boolean;
  session_initialized: boolean;
  metrics?: {
    main_daemon_start_time_ms?: number;
    ucm_daemon_start_time_ms?: number;
    session_init_time_ms?: number;
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

// Two separate daemons with separate sockets
const MAIN_DAEMON_SOCKET = '/tmp/godagent-db.sock';
const UCM_DAEMON_SOCKET = '/tmp/godagent-ucm.sock';

const RPC_TIMEOUT = 3000; // 3 seconds
const DAEMON_START_TIMEOUT = 10000; // 10 seconds
const HEALTH_CHECK_RETRIES = 10;
const HEALTH_CHECK_INTERVAL = 500; // ms

/**
 * Call daemon via JSON-RPC over Unix socket
 */
async function callDaemon(socketPath: string, method: string, params: any, timeout = RPC_TIMEOUT): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    const request: RPCRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id: Date.now(),
    };

    let responseBuffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timeout calling ${method} on ${socketPath}`));
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
 * Check if daemon is running and healthy
 */
async function isDaemonHealthy(socketPath: string): Promise<boolean> {
  try {
    const result = await callDaemon(socketPath, 'health.check', {});
    // Main daemon returns {status: "ok"}, UCM daemon returns {status: "healthy"}
    return result?.status === 'healthy' || result?.status === 'ok' || false;
  } catch (error) {
    return false;
  }
}

/**
 * Wait for daemon to become healthy
 */
async function waitForDaemonHealthy(socketPath: string, maxRetries = HEALTH_CHECK_RETRIES): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    if (await isDaemonHealthy(socketPath)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, HEALTH_CHECK_INTERVAL));
  }
  return false;
}

/**
 * Start main GodAgent daemon
 */
async function startMainDaemon(): Promise<number> {
  const startTime = Date.now();

  console.error('[Session-Start] Starting main GodAgent daemon...');

  // Start daemon process using the CLI
  const daemonProcess = spawn('npx', ['tsx', 'src/god-agent/core/daemon/daemon-cli.ts', 'start'], {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
  });

  daemonProcess.unref();

  // Wait for daemon to become healthy
  const healthy = await waitForDaemonHealthy(MAIN_DAEMON_SOCKET);

  if (!healthy) {
    throw new Error('Main daemon failed to become healthy within timeout');
  }

  const startupTime = Date.now() - startTime;
  console.error(`[Session-Start] Main daemon started in ${startupTime}ms`);

  return startupTime;
}

/**
 * Start UCM daemon
 */
async function startUCMDaemon(): Promise<number> {
  const startTime = Date.now();

  console.error('[Session-Start] Starting UCM daemon...');

  // Start UCM daemon process using the CLI
  const daemonProcess = spawn('npx', ['tsx', 'src/god-agent/core/ucm/daemon/ucm-cli.ts', 'start'], {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
  });

  daemonProcess.unref();

  // Wait for daemon to become healthy
  const healthy = await waitForDaemonHealthy(UCM_DAEMON_SOCKET);

  if (!healthy) {
    throw new Error('UCM daemon failed to become healthy within timeout');
  }

  const startupTime = Date.now() - startTime;
  console.error(`[Session-Start] UCM daemon started in ${startupTime}ms`);

  return startupTime;
}

/**
 * Initialize session in UCM context engine
 */
async function initializeSession(sessionId: string, projectPath?: string): Promise<void> {
  try {
    await callDaemon(UCM_DAEMON_SOCKET, 'context.initSession', {
      sessionId,
      projectPath,
      timestamp: Date.now(),
      config: {
        rollingWindowSize: 50000, // 50KB
        maxEpisodes: 1000,
        autoCompaction: true,
      },
    });

    console.error(`[Session-Start] Session ${sessionId} initialized in UCM`);
  } catch (error) {
    console.error('[Session-Start] Error initializing session:', error);
    throw error;
  }
}

/**
 * Main hook logic - starts both daemons if needed
 */
async function processSessionStart(input: SessionStartInput): Promise<SessionStartOutput> {
  const { session_id, project_path } = input;
  let mainDaemonStartTime: number | undefined;
  let ucmDaemonStartTime: number | undefined;
  let sessionInitTime: number | undefined;

  try {
    // Check and start main daemon
    let mainDaemonRunning = await isDaemonHealthy(MAIN_DAEMON_SOCKET);
    if (!mainDaemonRunning) {
      try {
        mainDaemonStartTime = await startMainDaemon();
        mainDaemonRunning = true;
      } catch (error) {
        console.error('[Session-Start] Failed to start main daemon:', error);
        // Continue - UCM daemon can work independently
      }
    } else {
      console.error('[Session-Start] Main daemon already running');
    }

    // Check and start UCM daemon
    let ucmDaemonRunning = await isDaemonHealthy(UCM_DAEMON_SOCKET);
    if (!ucmDaemonRunning) {
      try {
        ucmDaemonStartTime = await startUCMDaemon();
        ucmDaemonRunning = true;
      } catch (error) {
        console.error('[Session-Start] Failed to start UCM daemon:', error);
      }
    } else {
      console.error('[Session-Start] UCM daemon already running');
    }

    // Initialize session if UCM daemon is running
    if (ucmDaemonRunning) {
      const initStart = Date.now();
      await initializeSession(session_id, project_path);
      sessionInitTime = Date.now() - initStart;
    }

    return {
      success: ucmDaemonRunning, // Success if at least UCM daemon is running
      main_daemon_running: mainDaemonRunning,
      ucm_daemon_running: ucmDaemonRunning,
      session_initialized: ucmDaemonRunning,
      metrics: {
        main_daemon_start_time_ms: mainDaemonStartTime,
        ucm_daemon_start_time_ms: ucmDaemonStartTime,
        session_init_time_ms: sessionInitTime,
      },
    };
  } catch (error) {
    console.error('[Session-Start] Error during session start:', error);
    return {
      success: false,
      main_daemon_running: false,
      ucm_daemon_running: false,
      session_initialized: false,
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
      const input: SessionStartInput = JSON.parse(line);
      const output = await processSessionStart(input);
      console.log(JSON.stringify(output));
    } catch (error) {
      console.error('[Session-Start] Error processing hook:', error);
      console.log(
        JSON.stringify({
          success: false,
          main_daemon_running: false,
          ucm_daemon_running: false,
          session_initialized: false,
        })
      );
    }
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('[Session-Start] Fatal error:', error);
  process.exit(1);
});
