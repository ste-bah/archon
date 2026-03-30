/**
 * Pipeline Daemon Client
 *
 * JSON-RPC 2.0 client for the pipeline daemon with auto-start capability.
 * Follows CoreDaemonClient pattern: RULE-106 (spawn not exec), RULE-108 (env allowlist).
 */

import * as net from 'net';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const SOCKET_PATH = '/tmp/godagent-pipeline.sock';
const DEFAULT_TIMEOUT = 300000; // 300s (completeAndNext takes ~180s with embeddings + LEANN)
const DAEMON_START_TIMEOUT = 30000; // 30s (first start includes UniversalAgent init)

interface RPCResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  id: number;
}

/**
 * Pipeline Daemon Client with auto-start
 */
export class PipelineDaemonClient {
  private requestId = 0;
  private autoStartAttempted = false;

  constructor(
    private readonly socketPath: string = SOCKET_PATH,
    private readonly timeout: number = DEFAULT_TIMEOUT,
    private readonly autoStart: boolean = true,
  ) {}

  /** Check if daemon socket exists */
  private socketExists(): boolean {
    try { return fs.existsSync(this.socketPath); } catch { return false; }
  }

  /**
   * Auto-start daemon if not running.
   * Uses spawn (RULE-106) with env allowlist (RULE-108).
   */
  private async startDaemon(): Promise<boolean> {
    if (this.autoStartAttempted) return false;
    this.autoStartAttempted = true;

    try {
      const currentFile = fileURLToPath(import.meta.url);
      const currentDir = dirname(currentFile);
      const daemonPath = join(currentDir, 'pipeline-daemon.ts');

      console.error('[PipelineClient] Auto-starting pipeline daemon...');

      const allowedEnv: Record<string, string> = {
        PATH: process.env.PATH || '',
        HOME: process.env.HOME || '',
        NODE_ENV: process.env.NODE_ENV || 'production',
        EMBEDDING_HEALTH_TIMEOUT: '2000',
      };

      const child = spawn('npx', ['tsx', daemonPath, 'start'], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        env: allowedEnv,
      });
      child.unref();

      // Wait for socket to appear
      const startTime = Date.now();
      while (Date.now() - startTime < DAEMON_START_TIMEOUT) {
        await new Promise(r => setTimeout(r, 500));
        if (this.socketExists()) {
          console.error('[PipelineClient] Daemon started successfully');
          return true;
        }
      }

      console.error('[PipelineClient] Daemon did not start within timeout');
      return false;
    } catch (error) {
      console.error(`[PipelineClient] Failed to start daemon: ${error instanceof Error ? error.message : error}`);
      return false;
    }
  }

  /** Ensure daemon is running */
  private async ensureRunning(): Promise<boolean> {
    if (this.socketExists()) return true;
    if (!this.autoStart) return false;
    return this.startDaemon();
  }

  /** Low-level JSON-RPC 2.0 call over Unix socket */
  private async call<T>(method: string, params: unknown): Promise<T> {
    await this.ensureRunning();

    return new Promise((resolve, reject) => {
      const socket = net.connect(this.socketPath);
      const request = {
        jsonrpc: '2.0',
        method,
        params,
        id: ++this.requestId,
      };

      let responseBuffer = '';
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Pipeline daemon timeout calling ${method}`));
      }, this.timeout);

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
            reject(new Error(`Pipeline RPC Error [${response.error.code}]: ${response.error.message}`));
          } else {
            resolve(response.result as T);
          }
        } catch {
          // Incomplete JSON — wait for more data
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Pipeline daemon connection error: ${err.message}`));
      });
    });
  }

  // ── Public API ───────────────────────────────────────────────────────

  async isHealthy(): Promise<boolean> {
    try {
      await this.call('health.ping', {});
      return true;
    } catch { return false; }
  }

  async init(task: string): Promise<Record<string, unknown>> {
    return this.call('pipeline.init', { task });
  }

  async next(sessionId: string): Promise<Record<string, unknown>> {
    return this.call('pipeline.next', { sessionId });
  }

  async complete(sessionId: string, agentKey: string, file?: string): Promise<Record<string, unknown>> {
    return this.call('pipeline.complete', { sessionId, agentKey, file });
  }

  async completeAndNext(sessionId: string, agentKey: string, file?: string): Promise<Record<string, unknown>> {
    return this.call('pipeline.completeAndNext', { sessionId, agentKey, file });
  }

  async status(sessionId: string): Promise<Record<string, unknown>> {
    return this.call('pipeline.status', { sessionId });
  }

  async resume(sessionId: string): Promise<Record<string, unknown>> {
    return this.call('pipeline.resume', { sessionId });
  }

  async health(): Promise<Record<string, unknown>> {
    return this.call('pipeline.health', {});
  }

  async restart(): Promise<Record<string, unknown>> {
    return this.call('pipeline.restart', {});
  }
}

// Singleton
let defaultClient: PipelineDaemonClient | null = null;

export function getPipelineDaemonClient(): PipelineDaemonClient {
  if (!defaultClient) {
    defaultClient = new PipelineDaemonClient();
  }
  return defaultClient;
}

export function resetPipelineDaemonClient(): void {
  defaultClient = null;
}
