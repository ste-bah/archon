/**
 * UCM Daemon Client for phd-cli
 * Provides JSON-RPC 2.0 communication with the UCM daemon
 *
 * Used to integrate DESC episode injection and storage
 * directly into the PhD pipeline CLI commands.
 *
 * Features auto-start: if daemon is not running, automatically starts it.
 */

import * as net from 'net';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../core/observability/index.js';

const logger = createComponentLogger('UCMDaemonClient', {
  minLevel: LogLevel.INFO,
  handlers: [new ConsoleLogHandler({ useStderr: true })]
});

const DEFAULT_SOCKET_PATH = '/tmp/godagent-ucm.sock';
const DEFAULT_TIMEOUT = 90000; // 90 seconds for DESC operations (searches 1969 trajectories, can take 30-60s)
const DAEMON_START_TIMEOUT = 5000; // 5 seconds to wait for daemon to start

interface RPCRequest {
  jsonrpc: '2.0';
  method: string;
  params: unknown;
  id: number;
}

interface RPCResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  id: number;
}

interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    context: boolean;
    embedding: boolean;
    desc: boolean;
    recovery: boolean;
  };
  timestamp: string;
}

interface InjectResult {
  augmentedPrompt: string;
  episodesUsed: number;
  episodeIds: string[];
  originalPromptTokens: number;
  augmentedPromptTokens: number;
}

interface StoreResult {
  episodeId: string;
  chunksStored: number;
}

interface RetrievalResult {
  episodeId: string;
  answerText: string;
  maxSimilarity: number;
  matchedChunkType: 'query' | 'answer';
  matchedChunkIndex: number;
  searchChunkIndex: number;
  metadata?: Record<string, unknown>;
}

export class UCMDaemonClient {
  private socketPath: string;
  private timeout: number;
  private requestId: number = 0;
  private autoStartAttempted: boolean = false;
  private autoStart: boolean;

  constructor(options?: { socketPath?: string; timeout?: number; autoStart?: boolean }) {
    this.socketPath = options?.socketPath || DEFAULT_SOCKET_PATH;
    this.timeout = options?.timeout || DEFAULT_TIMEOUT;
    this.autoStart = options?.autoStart ?? false;
  }

  /**
   * Check if daemon socket exists
   */
  private socketExists(): boolean {
    try {
      return fs.existsSync(this.socketPath);
    } catch {
      // INTENTIONAL: Socket existence check failure means socket is not accessible - return false
      return false;
    }
  }

  /**
   * Start the UCM daemon in background
   * Returns true if daemon started successfully
   */
  private async startDaemon(): Promise<boolean> {
    if (this.autoStartAttempted) {
      return false; // Only try once per client instance
    }
    this.autoStartAttempted = true;

    try {
      // Find the daemon-server.ts path relative to this file
      const currentFile = fileURLToPath(import.meta.url);
      const currentDir = dirname(currentFile);
      // ucm-daemon-client.ts is in src/god-agent/cli/
      // daemon-server.ts is in src/god-agent/core/ucm/daemon/
      const daemonPath = join(currentDir, '..', 'core', 'ucm', 'daemon', 'daemon-server.ts');

      logger.info('Auto-starting daemon');

      // Spawn daemon in background, detached
      const child = spawn('npx', ['tsx', daemonPath], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        env: { ...process.env },
      });

      // Unref so parent can exit independently
      child.unref();

      // Wait for socket to appear
      const startTime = Date.now();
      while (Date.now() - startTime < DAEMON_START_TIMEOUT) {
        await new Promise((r) => setTimeout(r, 200));
        if (this.socketExists()) {
          logger.info('Daemon started successfully');
          return true;
        }
      }

      logger.warn('Daemon did not start within timeout');
      return false;
    } catch (error) {
      logger.error('Failed to start daemon', error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Ensure daemon is running, start if needed
   */
  private async ensureDaemonRunning(): Promise<boolean> {
    if (this.socketExists()) {
      return true;
    }
    if (!this.autoStart) {
      return false;
    }
    return this.startDaemon();
  }

  /**
   * Call UCM daemon via JSON-RPC over Unix socket
   * Auto-starts daemon if not running
   */
  private async call<T>(method: string, params: unknown): Promise<T> {
    // Ensure daemon is running before attempting connection
    await this.ensureDaemonRunning();

    return new Promise((resolve, reject) => {
      const socket = net.connect(this.socketPath);
      const request: RPCRequest = {
        jsonrpc: '2.0',
        method,
        params,
        id: ++this.requestId,
      };

      let responseBuffer = '';
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`UCM daemon timeout calling ${method}`));
      }, this.timeout);

      socket.on('connect', () => {
        socket.write(JSON.stringify(request) + '\n');
      });

      socket.on('data', (data) => {
        responseBuffer += data.toString();

        // Check if we have a complete JSON response
        try {
          const response: RPCResponse = JSON.parse(responseBuffer);
          clearTimeout(timeout);
          socket.end();

          if (response.error) {
            reject(new Error(`UCM RPC Error [${response.error.code}]: ${response.error.message}`));
          } else {
            resolve(response.result as T);
          }
        } catch {
          // INTENTIONAL: Incomplete JSON, wait for more data - streaming RPC response pattern
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`UCM daemon connection error: ${err.message}`));
      });

      socket.on('timeout', () => {
        clearTimeout(timeout);
        socket.destroy();
        reject(new Error(`UCM socket timeout calling ${method}`));
      });
    });
  }

  /**
   * Check if UCM daemon is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      const result = await this.call<HealthCheckResult>('health.check', {});
      return result?.status === 'healthy' || result?.status === 'degraded';
    } catch {
      // INTENTIONAL: Health check failure means daemon is unavailable - false is correct response
      return false;
    }
  }

  /**
   * Get detailed health status
   */
  async healthCheck(): Promise<HealthCheckResult | null> {
    try {
      return await this.call<HealthCheckResult>('health.check', {});
    } catch {
      // INTENTIONAL: Health check call failure means daemon unavailable - null is correct response
      return null;
    }
  }

  /**
   * Inject similar prior solutions into a prompt
   * Returns the augmented prompt or original if no matches/error
   */
  async injectSolutions(
    prompt: string,
    options?: {
      threshold?: number;
      maxEpisodes?: number;
      agentType?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<{ augmentedPrompt: string; episodesUsed: number; episodeIds: string[] }> {
    try {
      const result = await this.call<InjectResult>('desc.inject', {
        prompt,
        threshold: options?.threshold ?? 0.75,
        maxEpisodes: options?.maxEpisodes ?? 3,
        agentType: options?.agentType,
        metadata: options?.metadata,
      });

      return {
        augmentedPrompt: result.augmentedPrompt,
        episodesUsed: result.episodesUsed,
        episodeIds: result.episodeIds,
      };
    } catch (error) {
      // On error, return original prompt unchanged
      logger.error('DESC injection failed', error instanceof Error ? error : new Error(String(error)));
      return {
        augmentedPrompt: prompt,
        episodesUsed: 0,
        episodeIds: [],
      };
    }
  }

  /**
   * Store a completed episode (agent result) for future retrieval
   */
  async storeEpisode(
    queryText: string,
    answerText: string,
    metadata?: Record<string, unknown>
  ): Promise<{ episodeId: string; success: boolean }> {
    try {
      const result = await this.call<StoreResult>('desc.store', {
        queryText,
        answerText,
        metadata,
      });

      return {
        episodeId: result.episodeId,
        success: true,
      };
    } catch (error) {
      logger.error('DESC store failed', error instanceof Error ? error : new Error(String(error)));
      return {
        episodeId: '',
        success: false,
      };
    }
  }

  /**
   * Retrieve similar episodes for a query
   */
  async retrieveSimilar(
    searchText: string,
    options?: {
      threshold?: number;
      maxResults?: number;
    }
  ): Promise<RetrievalResult[]> {
    try {
      return await this.call<RetrievalResult[]>('desc.retrieve', {
        searchText,
        threshold: options?.threshold ?? 0.75,
        maxResults: options?.maxResults ?? 5,
      });
    } catch (error) {
      logger.error('DESC retrieve failed', error instanceof Error ? error : new Error(String(error)));
      return [];
    }
  }
}

// Singleton instance for convenience
let defaultClient: UCMDaemonClient | null = null;

export function getUCMClient(): UCMDaemonClient {
  if (!defaultClient) {
    defaultClient = new UCMDaemonClient();
  }
  return defaultClient;
}

export function resetUCMClient(): void {
  defaultClient = null;
}
