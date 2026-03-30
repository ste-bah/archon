/**
 * ObservabilityBus - Central Event Emission System
 * 
 * Implements the core event emission system that forwards events to the
 * observability daemon via Unix socket.
 * 
 * @module core/observability/bus
 * @see TASK-OBS-001-OBSERVABILITY-BUS.md
 * @see SPEC-OBS-001-CORE.md
 */

import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import {
  IActivityEvent,
  IActivityEventInput,
  BUFFER_LIMITS,
} from '../../observability/types.js';

// =============================================================================
// Interfaces
// =============================================================================

/**
 * ObservabilityBus interface
 * Implements [REQ-OBS-01]: Event emission
 */
export interface IObservabilityBus {
  /**
   * Emit an event to the observability system.
   * Non-blocking - returns immediately.
   * @param event Event data (id and timestamp auto-generated)
   */
  emit(event: IActivityEventInput): void;

  /**
   * Check if connected to the daemon.
   */
  isConnected(): boolean;

  /**
   * Get the current queue size (events waiting to be sent).
   */
  getQueueSize(): number;

  /**
   * Flush all queued events (waits for completion).
   */
  flush(): Promise<void>;

  /**
   * Shutdown the bus and clean up resources.
   */
  shutdown(): void;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * ObservabilityBus singleton implementation
 * 
 * Implements:
 * - [REQ-OBS-01]: Event emission
 * - [RULE-OBS-002]: Non-blocking emission
 * - [RULE-OBS-003]: Graceful degradation
 * - [RULE-OBS-008]: Auto-detection
 */
export class ObservabilityBus implements IObservabilityBus {
  private static instance: ObservabilityBus | null = null;

  private socket: net.Socket | null = null;
  private connected: boolean = false;
  private connecting: boolean = false;
  private queue: IActivityEvent[] = [];
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly socketPath: string;
  private readonly maxQueueSize: number = BUFFER_LIMITS.BUS_QUEUE;
  private readonly checkIntervalMs: number = 5000;
  private readonly verbose: boolean;
  private shuttingDown: boolean = false;

  /**
   * Get singleton instance
   * Implements [RULE-OBS-008]: Auto-detection without configuration
   */
  public static getInstance(): ObservabilityBus {
    if (!ObservabilityBus.instance) {
      ObservabilityBus.instance = new ObservabilityBus();
    }
    return ObservabilityBus.instance;
  }

  /**
   * Reset singleton (for testing)
   */
  public static resetInstance(): void {
    if (ObservabilityBus.instance) {
      ObservabilityBus.instance.shutdown();
      ObservabilityBus.instance = null;
    }
  }

  private constructor(options?: { socketPath?: string; verbose?: boolean }) {
    // Implements [RULE-OBS-008]: Auto-detect daemon socket
    this.socketPath = options?.socketPath ?? this.getDefaultSocketPath();
    this.verbose = options?.verbose ?? false;

    // Start checking for daemon
    this.checkForDaemon();
    this.startPeriodicCheck();
  }

  /**
   * Get default socket path
   * Checks both ~/.god-agent/daemon.sock and /tmp/god-agent.sock
   */
  private getDefaultSocketPath(): string {
    const homeSocket = path.join(os.homedir(), '.god-agent', 'daemon.sock');
    const tmpSocket = '/tmp/god-agent.sock';

    // Prefer home directory socket if it exists
    if (fs.existsSync(homeSocket)) {
      return homeSocket;
    }
    return tmpSocket;
  }

  /**
   * Emit an event
   * Implements [RULE-OBS-002]: MUST return immediately (non-blocking)
   * Implements [RULE-OBS-003]: Failed delivery logged but no exception thrown
   */
  public emit(event: IActivityEventInput): void {
    // Implements [REQ-OBS-03]: Auto-generate id and timestamp
    const fullEvent: IActivityEvent = {
      ...event,
      id: this.generateEventId(),
      timestamp: Date.now(),
    };

    // Non-blocking: queue event and return immediately
    // Implements [RULE-OBS-002]: emit() MUST return immediately
    if (this.connected && this.socket) {
      // Send immediately in background
      setImmediate(() => this.sendEvent(fullEvent));
    } else {
      // Queue for later
      this.queueEvent(fullEvent);
    }
  }

  /**
   * Check if connected to daemon
   */
  public isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get queue size
   */
  public getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Flush all queued events
   */
  public async flush(): Promise<void> {
    if (!this.connected || this.queue.length === 0) {
      return;
    }

    const events = [...this.queue];
    this.queue = [];

    for (const event of events) {
      await this.sendEventAsync(event);
    }
  }

  /**
   * Shutdown the bus
   */
  public shutdown(): void {
    this.shuttingDown = true;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    if (this.socket) {
      try {
        this.socket.end();
      } catch {
        // INTENTIONAL: Socket end errors are expected during shutdown
      }
      this.socket = null;
    }

    this.connected = false;
    this.queue = [];

    if (this.verbose) {
      console.log('[ObservabilityBus] Shutdown complete');
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Generate unique event ID
   * Format: evt_{timestamp}_{random}
   */
  private generateEventId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `evt_${timestamp}_${random}`;
  }

  /**
   * Queue an event for later sending
   * Implements [RULE-OBS-004]: FIFO eviction when full
   */
  private queueEvent(event: IActivityEvent): void {
    this.queue.push(event);

    // Evict oldest if over limit
    while (this.queue.length > this.maxQueueSize) {
      this.queue.shift();
      if (this.verbose) {
        console.log('[ObservabilityBus] Queue full, oldest event evicted');
      }
    }
  }

  /**
   * Send event to daemon (non-blocking)
   */
  private sendEvent(event: IActivityEvent): void {
    if (!this.socket || !this.connected) {
      this.queueEvent(event);
      return;
    }

    try {
      // NDJSON format (newline-delimited JSON)
      const data = JSON.stringify(event) + '\n';
      this.socket.write(data);
    } catch (error) {
      // Implements [RULE-OBS-003]: Log error but continue
      if (this.verbose) {
        console.log('[ObservabilityBus] Send error:', error);
      }
      this.queueEvent(event);
    }
  }

  /**
   * Send event async (for flush)
   */
  private sendEventAsync(event: IActivityEvent): Promise<void> {
    return new Promise((resolve) => {
      if (!this.socket || !this.connected) {
        resolve();
        return;
      }

      try {
        const data = JSON.stringify(event) + '\n';
        this.socket.write(data, () => resolve());
      } catch {
        // INTENTIONAL: Write failure - resolve anyway to prevent blocking
        resolve();
      }
    });
  }

  /**
   * Check for daemon socket and connect if available
   * Implements [RULE-OBS-008]: Auto-detect daemon
   */
  private checkForDaemon(): void {
    if (this.shuttingDown || this.connecting || this.connected) {
      return;
    }

    // Check if socket file exists
    if (!fs.existsSync(this.socketPath)) {
      if (this.verbose) {
        console.log('[ObservabilityBus] Daemon socket not found at', this.socketPath);
      }
      return;
    }

    this.connect();
  }

  /**
   * Connect to daemon socket
   */
  private connect(): void {
    if (this.connecting || this.connected || this.shuttingDown) {
      return;
    }

    this.connecting = true;

    try {
      this.socket = net.createConnection(this.socketPath);

      this.socket.on('connect', () => {
        this.connected = true;
        this.connecting = false;

        if (this.verbose) {
          console.log('[ObservabilityBus] Connected to daemon');
        }

        // Drain queue
        this.drainQueue();
      });

      this.socket.on('error', (error) => {
        this.connecting = false;
        this.connected = false;

        if (this.verbose) {
          console.log('[ObservabilityBus] Socket error:', error.message);
        }
      });

      this.socket.on('close', () => {
        this.connected = false;
        this.connecting = false;
        this.socket = null;

        if (this.verbose) {
          console.log('[ObservabilityBus] Disconnected from daemon');
        }
      });

      this.socket.on('end', () => {
        this.connected = false;
        this.connecting = false;
      });
    } catch (error) {
      this.connecting = false;
      if (this.verbose) {
        console.log('[ObservabilityBus] Connection failed:', error);
      }
    }
  }

  /**
   * Drain queued events after connection
   */
  private drainQueue(): void {
    if (!this.connected || this.queue.length === 0) {
      return;
    }

    const events = [...this.queue];
    this.queue = [];

    for (const event of events) {
      this.sendEvent(event);
    }

    if (this.verbose) {
      console.log(`[ObservabilityBus] Drained ${events.length} queued events`);
    }
  }

  /**
   * Start periodic daemon check
   */
  private startPeriodicCheck(): void {
    this.checkInterval = setInterval(() => {
      if (!this.connected && !this.shuttingDown) {
        this.checkForDaemon();
      }
    }, this.checkIntervalMs);

    // Don't prevent process from exiting
    this.checkInterval.unref();
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Get the singleton ObservabilityBus instance
 */
export function getObservabilityBus(): ObservabilityBus {
  return ObservabilityBus.getInstance();
}

/**
 * Emit an event to the observability system
 * Convenience function for quick event emission
 */
export function emitObservabilityEvent(event: IActivityEventInput): void {
  getObservabilityBus().emit(event);
}

// =============================================================================
// Default Export
// =============================================================================

export default ObservabilityBus;
