/**
 * ActivityStream - Circular Buffer for Real-time Events
 * 
 * Implements an in-memory circular buffer for real-time event storage
 * with FIFO eviction when full.
 * 
 * @module observability/activity-stream
 * @see TASK-OBS-002-ACTIVITY-STREAM.md
 * @see SPEC-OBS-001-CORE.md
 */

import {
  IActivityEvent,
  IFilterCriteria,
  BUFFER_LIMITS,
} from './types.js';
import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../core/observability/index.js';

const logger = createComponentLogger('ActivityStream', {
  minLevel: LogLevel.WARN,
  handlers: [new ConsoleLogHandler({ useStderr: true })]
});

// =============================================================================
// Quality Monitoring Interfaces
// =============================================================================

/**
 * Quality metric interface for injection quality tracking
 * Implements [AC-IDESC-005a]: Continuous quality monitoring
 */
export interface IQualityMetric {
  timestamp: Date;
  category: string;
  accuracy: number;
  falsePositiveRate: number;
  injectionCount: number;
}

/**
 * Alert severity levels
 */
export type AlertSeverity = 'WARNING' | 'CRITICAL';

/**
 * Alert interface for quality threshold violations
 */
export interface IQualityAlert {
  severity: AlertSeverity;
  type: string;
  message: string;
  category: string;
  timestamp: Date;
}

// =============================================================================
// Interfaces
// =============================================================================

/**
 * ActivityStream interface
 * Implements [REQ-OBS-01]: Activity stream buffer
 * Implements [REQ-OBS-02]: Maximum 1000 events enforced (RULE-OBS-004)
 */
export interface IActivityStream {
  /**
   * Push an event to the stream.
   * O(1) operation - overwrites oldest if full.
   * @param event The event to push
   */
  push(event: IActivityEvent): void;

  /**
   * Get the most recent events.
   * @param limit Maximum number of events to return (default: 100)
   * @returns Array of events in chronological order (oldest first)
   */
  getRecent(limit?: number): IActivityEvent[];

  /**
   * Filter events by criteria.
   * @param criteria Filter criteria
   * @returns Filtered events in chronological order
   */
  filter(criteria: IFilterCriteria): IActivityEvent[];

  /**
   * Clear all events from the stream.
   */
  clear(): void;

  /**
   * Get the current number of events in the stream.
   */
  size(): number;

  /**
   * Subscribe to new events.
   * @param listener Callback for new events
   * @returns Unsubscribe function
   */
  subscribe(listener: (event: IActivityEvent) => void): () => void;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * ActivityStream circular buffer implementation
 * 
 * Implements:
 * - [REQ-OBS-01]: Activity stream buffer
 * - [REQ-OBS-02]: Maximum 1000 events with FIFO eviction
 * - [RULE-OBS-004]: Memory bounds enforcement
 */
export class ActivityStream implements IActivityStream {
  // Static singleton instance
  private static singletonInstance: ActivityStream | null = null;

  /**
   * Get the singleton ActivityStream instance
   * Creates one if it doesn't exist
   */
  static getInstance(): Promise<ActivityStream> {
    if (!ActivityStream.singletonInstance) {
      ActivityStream.singletonInstance = new ActivityStream();
    }
    return Promise.resolve(ActivityStream.singletonInstance);
  }

  /**
   * Reset the singleton (for testing)
   */
  static resetInstance(): void {
    ActivityStream.singletonInstance = null;
  }

  // Circular buffer storage
  private buffer: (IActivityEvent | null)[];
  private head: number = 0;  // Points to oldest element
  private tail: number = 0;  // Points to next write position
  private count: number = 0;
  private readonly maxSize: number;

  // Event listeners
  private listeners: Array<(event: IActivityEvent) => void> = [];

  // Quality thresholds (AC-IDESC-005a)
  private readonly ACCURACY_THRESHOLD = 0.90;
  private readonly FPR_ESCALATION_THRESHOLD = 0.03;

  /**
   * Create a new ActivityStream
   * @param maxSize Maximum buffer size (default: 1000 per RULE-OBS-004)
   */
  constructor(maxSize: number = BUFFER_LIMITS.ACTIVITY_STREAM) {
    this.maxSize = maxSize;
    // Pre-allocate buffer for memory efficiency
    this.buffer = new Array(maxSize).fill(null);
  }

  /**
   * Push an event to the stream
   * Implements [REQ-OBS-02]: FIFO eviction when full
   * O(1) operation - no array shifting
   */
  public push(event: IActivityEvent): void {
    // Store at tail position (overwrite if buffer is full)
    this.buffer[this.tail] = event;

    // Advance tail
    this.tail = (this.tail + 1) % this.maxSize;

    if (this.count < this.maxSize) {
      // Buffer not full yet
      this.count++;
    } else {
      // Buffer full - head moves forward (oldest evicted)
      this.head = (this.head + 1) % this.maxSize;
    }

    // Notify listeners (non-blocking)
    this.notifyListeners(event);
  }

  /**
   * Get the most recent events
   * @param limit Maximum number of events to return (default: 100)
   * @returns Events in chronological order (oldest first)
   */
  public getRecent(limit: number = 100): IActivityEvent[] {
    if (this.count === 0) {
      return [];
    }

    const resultLimit = Math.min(limit, this.count);
    const result: IActivityEvent[] = [];

    // Start from the newest events (work backwards from tail)
    let idx = (this.tail - 1 + this.maxSize) % this.maxSize;
    
    for (let i = 0; i < resultLimit; i++) {
      const event = this.buffer[idx];
      if (event) {
        result.unshift(event);  // Add to front to maintain order
      }
      idx = (idx - 1 + this.maxSize) % this.maxSize;
    }

    return result;
  }

  /**
   * Get all events in chronological order
   * @returns All events from oldest to newest
   */
  public getAll(): IActivityEvent[] {
    return this.getRecent(this.count);
  }

  /**
   * Filter events by criteria
   * @param criteria Filter criteria
   * @returns Filtered events in chronological order
   */
  public filter(criteria: IFilterCriteria): IActivityEvent[] {
    const all = this.getAll();
    
    return all.filter(event => {
      // Filter by component
      if (criteria.component && event.component !== criteria.component) {
        return false;
      }

      // Filter by status
      if (criteria.status && event.status !== criteria.status) {
        return false;
      }

      // Filter by time range (since)
      if (criteria.since && event.timestamp < criteria.since) {
        return false;
      }

      // Filter by time range (until)
      if (criteria.until && event.timestamp > criteria.until) {
        return false;
      }

      return true;
    });
  }

  /**
   * Clear all events
   */
  public clear(): void {
    this.buffer = new Array(this.maxSize).fill(null);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  /**
   * Get current event count
   */
  public size(): number {
    return this.count;
  }

  /**
   * Check if buffer is full
   */
  public isFull(): boolean {
    return this.count >= this.maxSize;
  }

  /**
   * Subscribe to new events
   * @param listener Callback for new events
   * @returns Unsubscribe function
   */
  public subscribe(listener: (event: IActivityEvent) => void): () => void {
    this.listeners.push(listener);

    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Get statistics about the buffer
   */
  public getStats(): {
    size: number;
    maxSize: number;
    isFull: boolean;
    headIndex: number;
    tailIndex: number;
  } {
    return {
      size: this.count,
      maxSize: this.maxSize,
      isFull: this.isFull(),
      headIndex: this.head,
      tailIndex: this.tail,
    };
  }


  /**
   * Emit an event with auto-generated id and timestamp
   * Convenience method for hooks and components
   * @param event Partial event data (id and timestamp auto-generated)
   */
  public async emit(event: {
    type: string;
    correlationId?: string;
    payload?: Record<string, unknown>;
    component?: IActivityEvent['component'];
    status?: IActivityEvent['status'];
  }): Promise<void> {
    const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = Date.now();

    // Map type to operation
    const operation = event.type;
    const component = event.component ?? 'general';
    const status = event.status ?? 'success';

    const fullEvent: IActivityEvent = {
      id,
      timestamp,
      component,
      operation,
      status,
      metadata: {
        correlationId: event.correlationId,
        ...event.payload,
      },
    };

    this.push(fullEvent);
  }

  /**
   * Track injection quality metrics (AC-IDESC-005a)
   * Monitors accuracy and false positive rates with automatic alerting
   *
   * Thresholds:
   * - Accuracy < 90%: WARNING alert
   * - FPR > 3%: CRITICAL alert
   *
   * @param metric Quality metric to track
   */
  public async trackQualityMetric(metric: IQualityMetric): Promise<void> {
    // Emit quality metric event
    await this.emit({
      type: 'quality_metric',
      component: 'quality_monitor',
      status: 'success',
      payload: {
        category: metric.category,
        accuracy: metric.accuracy,
        fpr: metric.falsePositiveRate,
        injectionCount: metric.injectionCount,
        timestamp: metric.timestamp.toISOString(),
      },
    });

    // Check alert thresholds
    const alerts: IQualityAlert[] = [];

    // Accuracy degradation check
    if (metric.accuracy < this.ACCURACY_THRESHOLD) {
      alerts.push({
        severity: 'WARNING',
        type: 'ACCURACY_DEGRADATION',
        message: `Accuracy ${(metric.accuracy * 100).toFixed(1)}% below ${(this.ACCURACY_THRESHOLD * 100)}% threshold`,
        category: metric.category,
        timestamp: metric.timestamp,
      });
    }

    // False positive rate escalation check
    if (metric.falsePositiveRate > this.FPR_ESCALATION_THRESHOLD) {
      alerts.push({
        severity: 'CRITICAL',
        type: 'FPR_ESCALATION',
        message: `FPR ${(metric.falsePositiveRate * 100).toFixed(1)}% exceeds ${(this.FPR_ESCALATION_THRESHOLD * 100)}% escalation threshold`,
        category: metric.category,
        timestamp: metric.timestamp,
      });
    }

    // Emit all alerts
    for (const alert of alerts) {
      await this.emitAlert(alert);
    }
  }

  /**
   * Emit alert to observability system
   * Logs to console and pushes to activity stream
   * @param alert Alert details
   */
  private async emitAlert(alert: IQualityAlert): Promise<void> {
    // Log to structured logger for immediate visibility
    logger.error(`Quality alert: ${alert.message}`, undefined, { severity: alert.severity, alertType: alert.type, category: alert.category });

    // Emit to activity stream
    await this.emit({
      type: 'alert',
      component: 'quality_monitor',
      status: alert.severity === 'CRITICAL' ? 'error' : 'warning',
      payload: {
        severity: alert.severity,
        alertType: alert.type,
        message: alert.message,
        category: alert.category,
        timestamp: alert.timestamp.toISOString(),
      },
    });
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Notify all listeners of a new event
   * Non-blocking - uses setImmediate
   */
  private notifyListeners(event: IActivityEvent): void {
    if (this.listeners.length === 0) {
      return;
    }

    // Non-blocking notification
    setImmediate(() => {
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch {
          // INTENTIONAL: Implements [RULE-OBS-003] - listener exceptions must not propagate to prevent cascade failures
        }
      }
    });
  }
}


// =============================================================================
// Singleton Instance (static methods now in class)
// =============================================================================

// =============================================================================
// Default Export
// =============================================================================

export default ActivityStream;
