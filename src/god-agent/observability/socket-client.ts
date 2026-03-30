/**
 * SocketClient - Unix Domain Socket IPC Client (God Agent Side)
 *
 * Implements Unix Domain Socket client for sending events to daemon.
 *
 * @module observability/socket-client
 * @see TASK-OBS-012-SOCKET-IPC.md
 * @see SPEC-OBS-001-CORE.md
 */

import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { IActivityEvent } from './types.js';
import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../core/observability/index.js';

const logger = createComponentLogger('SocketClient', {
  minLevel: LogLevel.INFO,
  handlers: [new ConsoleLogHandler()]
});

// =============================================================================
// Interfaces
// =============================================================================

/**
 * Socket client interface
 * Implements [REQ-OBS-11]: God Agent side IPC client
 */
export interface ISocketClient {
  /**
   * Connect to daemon socket
   * @returns Promise resolving to connection success
   */
  connect(): Promise<boolean>;

  /**
   * Send an event (non-blocking)
   * Implements [RULE-OBS-002]: Non-blocking send
   * @param event Event to send
   */
  send(event: IActivityEvent): void;

  /**
   * Disconnect from daemon
   */
  disconnect(): void;

  /**
   * Check if connected
   */
  isConnected(): boolean;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * SocketClient implementation
 *
 * Implements:
 * - [REQ-OBS-11]: God Agent socket client
 * - [RULE-OBS-002]: Non-blocking send
 * - Queue up to 100 events if not connected
 * - Flush queue on connect
 * - Connection timeout: 1000ms
 */
export class SocketClient implements ISocketClient {
  private socket: net.Socket | null = null;
  private connected: boolean = false;
  private socketPath: string;
  private verbose: boolean;

  // Event queue for when disconnected
  private queue: IActivityEvent[] = [];
  private readonly MAX_QUEUE_SIZE = 100;

  // Connection timeout in milliseconds
  private readonly CONNECTION_TIMEOUT_MS = 1000;

  /**
   * Create a new SocketClient
   * @param options Optional configuration
   */
  constructor(options?: {
    socketPath?: string;
    verbose?: boolean;
  }) {
    this.verbose = options?.verbose ?? false;

    // Determine socket path
    const defaultPath = path.join(os.homedir(), '.god-agent', 'daemon.sock');
    this.socketPath = options?.socketPath
      || process.env.GOD_AGENT_SOCKET_PATH
      || defaultPath;
  }

  /**
   * Connect to daemon socket
   * @returns Promise resolving to connection success
   */
  public async connect(): Promise<boolean> {
    // Check if socket exists
    if (!fs.existsSync(this.socketPath)) {
      if (this.verbose) {
        logger.warn('Socket does not exist', { socketPath: this.socketPath });
      }
      return false;
    }

    return new Promise((resolve) => {
      const socket = net.connect(this.socketPath);

      // Set connection timeout
      const timeout = setTimeout(() => {
        socket.destroy();
        if (this.verbose) {
          logger.warn('Connection timeout', { timeoutMs: this.CONNECTION_TIMEOUT_MS });
        }
        resolve(false);
      }, this.CONNECTION_TIMEOUT_MS);

      socket.on('connect', () => {
        clearTimeout(timeout);
        this.socket = socket;
        this.connected = true;

        if (this.verbose) {
          logger.info('Connected to daemon', { socketPath: this.socketPath });
        }

        // Flush queued events
        this.flushQueue();

        resolve(true);
      });

      socket.on('error', (error) => {
        clearTimeout(timeout);
        if (this.verbose) {
          logger.error('Connection error', error);
        }
        resolve(false);
      });

      socket.on('close', () => {
        this.connected = false;
        this.socket = null;
        if (this.verbose) {
          logger.info('Disconnected from daemon');
        }
      });
    });
  }

  /**
   * Send an event (non-blocking)
   * Implements [RULE-OBS-002]: Non-blocking send
   * @param event Event to send
   */
  public send(event: IActivityEvent): void {
    if (!this.connected || !this.socket) {
      // Queue event if not connected
      this.queueEvent(event);
      return;
    }

    try {
      // NDJSON format: one JSON object per line
      const line = JSON.stringify(event) + '\n';
      this.socket.write(line);
    } catch (error) {
      if (this.verbose) {
        logger.error('Send error', error instanceof Error ? error : new Error(String(error)));
      }

      // Queue event and mark as disconnected
      this.connected = false;
      this.queueEvent(event);
    }
  }

  /**
   * Disconnect from daemon
   */
  public disconnect(): void {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
      this.connected = false;

      if (this.verbose) {
        logger.info('Disconnected');
      }
    }
  }

  /**
   * Check if connected
   */
  public isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get current queue size (for testing)
   */
  public getQueueSize(): number {
    return this.queue.length;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Queue an event when disconnected
   * Implements bounded queue (max 100 events)
   * @param event Event to queue
   */
  private queueEvent(event: IActivityEvent): void {
    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      // Queue full - drop oldest event (FIFO)
      this.queue.shift();
      if (this.verbose) {
        logger.warn('Queue full, dropping oldest event', { maxQueueSize: this.MAX_QUEUE_SIZE });
      }
    }

    this.queue.push(event);
  }

  /**
   * Flush queued events on connect
   */
  private flushQueue(): void {
    if (this.queue.length === 0) {
      return;
    }

    if (this.verbose) {
      logger.info('Flushing queued events', { queueSize: this.queue.length });
    }

    const eventsToSend = [...this.queue];
    this.queue = [];

    for (const event of eventsToSend) {
      this.send(event);
    }
  }
}

// =============================================================================
// Default Export
// =============================================================================

export default SocketClient;
