/**
 * EventStore - Dual Storage with Circular Buffer + SQLite Persistence
 *
 * Implements high-performance event storage with:
 * - In-memory circular buffer (10,000 events max, FIFO eviction)
 * - SQLite persistence for 24-hour retention
 * - Non-blocking inserts (< 0.1ms)
 * - Batch SQLite writes (100 events per transaction)
 *
 * @module observability/event-store
 * @see TASK-OBS-006-EVENT-STORE.md
 * @see SPEC-OBS-001-CORE.md#event_store
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import {
  IActivityEvent,
  ActivityEventComponent,
  ActivityEventStatus,
  BUFFER_LIMITS,
} from './types.js';
import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../core/observability/index.js';

const logger = createComponentLogger('EventStore', {
  minLevel: LogLevel.WARN,
  handlers: [new ConsoleLogHandler({ useStderr: true })]
});

// =============================================================================
// Interfaces
// =============================================================================

/**
 * Event query criteria
 */
export interface IEventQuery {
  /** Maximum number of events to return (default: 100) */
  limit?: number;
  /** Offset for pagination (default: 0) */
  offset?: number;
  /** Filter by component */
  component?: ActivityEventComponent;
  /** Filter by status */
  status?: ActivityEventStatus;
  /** Filter events after this timestamp */
  since?: number;
  /** Filter events before this timestamp */
  until?: number;
  /** Filter by trace ID */
  traceId?: string;
}

/**
 * EventStore statistics
 */
export interface IEventStoreStats {
  /** Current buffer size */
  bufferSize: number;
  /** Buffer capacity */
  bufferCapacity: number;
  /** Total events in SQLite database */
  dbEventCount: number;
  /** Oldest event timestamp in storage */
  oldestEventTime: number | null;
  /** Newest event timestamp in storage */
  newestEventTime: number | null;
}

/**
 * EventStore interface
 * Implements [REQ-OBS-06]: Dual storage (buffer + SQLite)
 */
export interface IEventStore {
  /**
   * Insert an event (non-blocking)
   * Implements [RULE-OBS-005]: Insert MUST complete in < 0.1ms
   * @param event The event to insert
   */
  insert(event: IActivityEvent): void;

  /**
   * Query events from storage
   * Strategy: Check buffer first, fall back to SQLite for historical
   * @param criteria Query criteria
   * @returns Promise resolving to events array
   */
  query(criteria: IEventQuery): Promise<IActivityEvent[]>;

  /**
   * Get storage statistics
   * @returns Current stats
   */
  getStats(): IEventStoreStats;

  /**
   * Close the event store and flush pending writes
   * @returns Promise resolving when closed
   */
  close(): Promise<void>;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * EventStore implementation with circular buffer + SQLite
 *
 * Implements:
 * - [REQ-OBS-06]: Dual storage system
 * - [RULE-OBS-004]: 10,000 event buffer with FIFO eviction
 * - [RULE-OBS-005]: Non-blocking insert (< 0.1ms)
 * - 24-hour SQLite retention with auto-cleanup
 * - Batch writes (100 events per transaction)
 */
export class EventStore implements IEventStore {
  // Circular buffer for in-memory storage
  private buffer: (IActivityEvent | null)[];
  private head: number = 0;  // Points to oldest element
  private tail: number = 0;  // Points to next write position
  private count: number = 0;
  private readonly maxSize: number;

  // SQLite database
  private db: Database.Database;
  private insertStmt: Database.Statement;
  private dbPath: string;

  // Write batching
  private writeQueue: IActivityEvent[] = [];
  private writeTimer: NodeJS.Immediate | null = null;
  private readonly batchSize: number = 100;
  private isClosing: boolean = false;

  // 24-hour retention (in milliseconds)
  private readonly retentionMs: number = 24 * 60 * 60 * 1000;

  /**
   * Create a new EventStore
   * @param dbPath Path to SQLite database file
   * @param maxSize Maximum buffer size (default: 10000 per RULE-OBS-004)
   */
  constructor(
    dbPath: string = '.god-agent/events.db',
    maxSize: number = BUFFER_LIMITS.EVENT_STORE
  ) {
    this.maxSize = maxSize;
    this.dbPath = dbPath;

    // Pre-allocate circular buffer
    this.buffer = new Array(maxSize).fill(null);

    // Ensure database directory exists
    this.ensureDirectoryExists(dbPath);

    // Initialize SQLite database
    this.db = this.initDatabase(dbPath);

    // Prepare insert statement for batch writes
    this.insertStmt = this.db.prepare(`
      INSERT INTO events (
        id, timestamp, component, operation, status,
        duration_ms, metadata, trace_id, span_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  /**
   * Ensure the directory for the database file exists
   * @param dbPath Database file path
   */
  private ensureDirectoryExists(dbPath: string): void {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Initialize SQLite database with schema and triggers
   * @param dbPath Database file path
   * @returns Database instance
   */
  private initDatabase(dbPath: string): Database.Database {
    const db = new Database(dbPath);

    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');

    // Create events table
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        component TEXT NOT NULL,
        operation TEXT NOT NULL,
        status TEXT NOT NULL,
        duration_ms INTEGER,
        metadata TEXT NOT NULL,
        trace_id TEXT,
        span_id TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );
    `);

    // Create indexes for efficient queries
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_timestamp
        ON events(timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_events_component
        ON events(component);

      CREATE INDEX IF NOT EXISTS idx_events_trace_id
        ON events(trace_id);
    `);

    // Create trigger for 24-hour auto-cleanup
    const retentionSeconds = Math.floor(this.retentionMs / 1000);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS cleanup_old_events
      AFTER INSERT ON events
      BEGIN
        DELETE FROM events
        WHERE timestamp < (strftime('%s', 'now') - ${retentionSeconds}) * 1000;
      END;
    `);

    return db;
  }

  /**
   * Insert an event (non-blocking)
   * Implements [RULE-OBS-005]: < 0.1ms operation
   *
   * Strategy:
   * 1. Add to circular buffer synchronously (O(1))
   * 2. Queue for SQLite batch write (async via setImmediate)
   *
   * @param event The event to insert
   */
  public insert(event: IActivityEvent): void {
    // 1. Add to circular buffer (synchronous, < 0.1ms)
    this.buffer[this.tail] = event;
    this.tail = (this.tail + 1) % this.maxSize;

    if (this.count < this.maxSize) {
      this.count++;
    } else {
      // Buffer full - FIFO eviction (RULE-OBS-004)
      this.head = (this.head + 1) % this.maxSize;
    }

    // 2. Queue for async SQLite write
    this.queueWrite(event);
  }

  /**
   * Queue an event for batch SQLite write
   * Non-blocking - uses setImmediate
   *
   * @param event Event to queue
   */
  private queueWrite(event: IActivityEvent): void {
    if (this.isClosing) {
      return;
    }

    this.writeQueue.push(event);

    // Batch write when queue reaches batchSize or schedule for next tick
    if (this.writeQueue.length >= this.batchSize) {
      this.flushWrites();
    } else if (!this.writeTimer) {
      // Schedule flush on next event loop tick
      this.writeTimer = setImmediate(() => {
        this.flushWrites();
      });
    }
  }

  /**
   * Flush pending writes to SQLite in a batch transaction
   * Implements batch writes (100 events per transaction)
   */
  private flushWrites(): void {
    if (this.writeTimer) {
      clearImmediate(this.writeTimer);
      this.writeTimer = null;
    }

    if (this.writeQueue.length === 0) {
      return;
    }

    const batch = this.writeQueue.splice(0, this.batchSize);

    try {
      // Use transaction for batch insert
      const transaction = this.db.transaction((events: IActivityEvent[]) => {
        for (const event of events) {
          this.insertStmt.run(
            event.id,
            event.timestamp,
            event.component,
            event.operation,
            event.status,
            event.durationMs ?? null,
            JSON.stringify(event.metadata),
            event.traceId ?? null,
            event.spanId ?? null
          );
        }
      });

      transaction(batch);
    } catch (error) {
      // Log error but don't throw (non-blocking)
      logger.error('SQLite batch write failed', error instanceof Error ? error : new Error(String(error)));
    }

    // Continue flushing if more events queued
    if (this.writeQueue.length > 0) {
      this.writeTimer = setImmediate(() => {
        this.flushWrites();
      });
    }
  }

  /**
   * Query events from storage
   * Strategy:
   * 1. Check circular buffer for recent events
   * 2. Fall back to SQLite for historical events
   * 3. Merge and deduplicate results
   *
   * @param criteria Query criteria
   * @returns Promise resolving to events array
   */
  public async query(criteria: IEventQuery = {}): Promise<IActivityEvent[]> {
    const limit = criteria.limit ?? 100;
    const offset = criteria.offset ?? 0;

    // 1. Query buffer for recent events
    const bufferEvents = this.queryBuffer(criteria);

    // 2. Query SQLite for historical events (if needed)
    let dbEvents: IActivityEvent[] = [];

    if (bufferEvents.length < limit + offset) {
      // Need more events from SQLite
      const dbLimit = limit + offset - bufferEvents.length;
      dbEvents = await this.queryDatabase(criteria, dbLimit);
    }

    // 3. Merge results (buffer events are more recent)
    const allEvents = [...bufferEvents, ...dbEvents];

    // 4. Deduplicate by ID (buffer takes precedence)
    const seen = new Set<string>();
    const uniqueEvents = allEvents.filter(event => {
      if (seen.has(event.id)) {
        return false;
      }
      seen.add(event.id);
      return true;
    });

    // 5. Apply pagination
    return uniqueEvents.slice(offset, offset + limit);
  }

  /**
   * Query events from circular buffer
   * @param criteria Query criteria
   * @returns Filtered events from buffer
   */
  private queryBuffer(criteria: IEventQuery): IActivityEvent[] {
    if (this.count === 0) {
      return [];
    }

    const results: IActivityEvent[] = [];

    // Iterate through buffer from newest to oldest
    let idx = (this.tail - 1 + this.maxSize) % this.maxSize;

    for (let i = 0; i < this.count; i++) {
      const event = this.buffer[idx];

      if (event && this.matchesCriteria(event, criteria)) {
        results.push(event);
      }

      idx = (idx - 1 + this.maxSize) % this.maxSize;
    }

    // Results are in reverse chronological order (newest first)
    return results;
  }

  /**
   * Query events from SQLite database
   * @param criteria Query criteria
   * @param limit Maximum results
   * @returns Promise resolving to events array
   */
  private async queryDatabase(
    criteria: IEventQuery,
    limit: number
  ): Promise<IActivityEvent[]> {
    return new Promise((resolve) => {
      try {
        // Build SQL query
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (criteria.component) {
          conditions.push('component = ?');
          params.push(criteria.component);
        }

        if (criteria.status) {
          conditions.push('status = ?');
          params.push(criteria.status);
        }

        if (criteria.since) {
          conditions.push('timestamp >= ?');
          params.push(criteria.since);
        }

        if (criteria.until) {
          conditions.push('timestamp <= ?');
          params.push(criteria.until);
        }

        if (criteria.traceId) {
          conditions.push('trace_id = ?');
          params.push(criteria.traceId);
        }

        const whereClause = conditions.length > 0
          ? `WHERE ${conditions.join(' AND ')}`
          : '';

        const sql = `
          SELECT * FROM events
          ${whereClause}
          ORDER BY timestamp DESC
          LIMIT ?
        `;

        params.push(limit);

        const stmt = this.db.prepare(sql);
        const rows = stmt.all(...params) as Array<{
          id: string;
          timestamp: number;
          component: string;
          operation: string;
          status: string;
          duration_ms: number | null;
          metadata: string;
          trace_id: string | null;
          span_id: string | null;
        }>;

        // Convert database rows to IActivityEvent
        const events: IActivityEvent[] = rows.map(row => ({
          id: row.id,
          timestamp: row.timestamp,
          component: row.component as ActivityEventComponent,
          operation: row.operation,
          status: row.status as ActivityEventStatus,
          durationMs: row.duration_ms ?? undefined,
          metadata: JSON.parse(row.metadata),
          traceId: row.trace_id ?? undefined,
          spanId: row.span_id ?? undefined,
        }));

        resolve(events);
      } catch (error) {
        logger.error('SQLite query failed', error instanceof Error ? error : new Error(String(error)));
        resolve([]);
      }
    });
  }

  /**
   * Check if an event matches query criteria
   * @param event Event to check
   * @param criteria Query criteria
   * @returns True if event matches
   */
  private matchesCriteria(event: IActivityEvent, criteria: IEventQuery): boolean {
    if (criteria.component && event.component !== criteria.component) {
      return false;
    }

    if (criteria.status && event.status !== criteria.status) {
      return false;
    }

    if (criteria.since && event.timestamp < criteria.since) {
      return false;
    }

    if (criteria.until && event.timestamp > criteria.until) {
      return false;
    }

    if (criteria.traceId && event.traceId !== criteria.traceId) {
      return false;
    }

    return true;
  }

  /**
   * Get storage statistics
   * @returns Current storage stats
   */
  public getStats(): IEventStoreStats {
    // Get database event count
    const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM events');
    const countRow = countStmt.get() as { count: number };
    const dbEventCount = countRow.count;

    // Get oldest and newest timestamps
    const rangeStmt = this.db.prepare(`
      SELECT
        MIN(timestamp) as oldest,
        MAX(timestamp) as newest
      FROM events
    `);
    const rangeRow = rangeStmt.get() as {
      oldest: number | null;
      newest: number | null;
    };

    return {
      bufferSize: this.count,
      bufferCapacity: this.maxSize,
      dbEventCount,
      oldestEventTime: rangeRow.oldest,
      newestEventTime: rangeRow.newest,
    };
  }

  /**
   * Close the event store and flush pending writes
   * @returns Promise resolving when closed
   */
  public async close(): Promise<void> {
    this.isClosing = true;

    // Clear any pending write timer
    if (this.writeTimer) {
      clearImmediate(this.writeTimer);
      this.writeTimer = null;
    }

    // Flush remaining writes
    if (this.writeQueue.length > 0) {
      return new Promise((resolve) => {
        setImmediate(() => {
          this.flushWrites();
          this.db.close();
          resolve();
        });
      });
    } else {
      this.db.close();
    }
  }

  /**
   * Clear all events from buffer and database
   * WARNING: This is destructive and used primarily for testing
   */
  public clear(): void {
    // Clear buffer
    this.buffer = new Array(this.maxSize).fill(null);
    this.head = 0;
    this.tail = 0;
    this.count = 0;

    // Clear write queue
    this.writeQueue = [];
    if (this.writeTimer) {
      clearImmediate(this.writeTimer);
      this.writeTimer = null;
    }

    // Clear database
    this.db.prepare('DELETE FROM events').run();
  }
}

// =============================================================================
// Default Export
// =============================================================================

export default EventStore;
