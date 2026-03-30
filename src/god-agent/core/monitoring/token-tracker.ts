/**
 * Token Usage Tracker
 * TASK-MON-003
 *
 * Tracks and persists token usage for learning optimization.
 *
 * CONSTITUTION COMPLIANCE:
 * - REQ-CONST-004: Metrics persisted for learning
 * - REQ-CONST-014: Token usage tracked and persisted
 */

import { createComponentLogger } from '../observability/logger.js';
import { getDatabaseConnection } from '../database/index.js';

const logger = createComponentLogger('TokenTracker');

// ==================== Types ====================

/** Token usage record */
export interface ITokenUsage {
  id: string;
  sessionId: string;
  requestId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  taskType: string;
  agentId: string;
  trajectoryId?: string;
  timestamp: number;
}

/** Token statistics */
export interface ITokenStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  averageInputTokens: number;
  averageOutputTokens: number;
  averageTotalTokens: number;
  requestCount: number;
}

/** Token usage input (without generated fields) */
export type ITokenUsageInput = Omit<ITokenUsage, 'id' | 'timestamp'>;

/** Filter for stats queries */
export interface ITokenStatsFilter {
  taskType?: string;
  agentId?: string;
  sessionId?: string;
  since?: number;
}

// ==================== Database Row Type ====================

interface TokenUsageRow {
  id: string;
  session_id: string;
  request_id: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  task_type: string;
  agent_id: string;
  trajectory_id: string | null;
  timestamp: number;
}

interface TokenStatsRow {
  total_input: number;
  total_output: number;
  total_all: number;
  count: number;
}

// ==================== TokenTracker ====================

/**
 * Token Usage Tracker
 *
 * Tracks and persists token usage metrics to SQLite for learning optimization.
 * Implements buffered writes for performance and provides statistical queries.
 */
export class TokenTracker {
  private readonly buffer: ITokenUsage[] = [];
  private readonly bufferLimit: number;
  private flushTimeout: ReturnType<typeof setInterval> | null = null;
  private readonly flushIntervalMs: number;
  private schemaInitialized: boolean = false;

  constructor(config: {
    bufferLimit?: number;
    flushIntervalMs?: number;
  } = {}) {
    this.bufferLimit = config.bufferLimit ?? 100;
    this.flushIntervalMs = config.flushIntervalMs ?? 30000; // 30 seconds
    this.ensureSchema();
    this.startAutoFlush();
  }

  /** Ensure database schema exists */
  private ensureSchema(): void {
    if (this.schemaInitialized) return;

    try {
      const db = getDatabaseConnection();
      db.db.exec(`
        CREATE TABLE IF NOT EXISTS token_usage (
          id TEXT PRIMARY KEY NOT NULL,
          session_id TEXT NOT NULL,
          request_id TEXT NOT NULL,
          input_tokens INTEGER NOT NULL,
          output_tokens INTEGER NOT NULL,
          total_tokens INTEGER NOT NULL,
          task_type TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          trajectory_id TEXT,
          timestamp INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id);
        CREATE INDEX IF NOT EXISTS idx_token_usage_task ON token_usage(task_type);
        CREATE INDEX IF NOT EXISTS idx_token_usage_timestamp ON token_usage(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_token_usage_trajectory ON token_usage(trajectory_id) WHERE trajectory_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_token_usage_agent ON token_usage(agent_id);
      `);
      this.schemaInitialized = true;
      logger.debug('Token usage schema initialized');
    } catch (err) {
      logger.error('Failed to initialize token usage schema', err);
      // RULE-070: Re-throw with initialization context
      throw new Error(
        `Failed to initialize token_usage schema: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }
  }

  /** Start auto-flush timer */
  private startAutoFlush(): void {
    this.flushTimeout = setInterval(() => {
      if (this.buffer.length > 0) {
        this.flush();
      }
    }, this.flushIntervalMs);

    // Unref so it doesn't keep the process alive
    if (this.flushTimeout.unref) {
      this.flushTimeout.unref();
    }
  }

  /** Record token usage */
  record(usage: ITokenUsageInput): void {
    const entry: ITokenUsage = {
      ...usage,
      id: this.generateId(),
      timestamp: Date.now()
    };

    this.buffer.push(entry);

    logger.debug('Token usage recorded', {
      requestId: usage.requestId,
      totalTokens: usage.totalTokens,
      bufferSize: this.buffer.length
    });

    // Auto-flush when buffer full
    if (this.buffer.length >= this.bufferLimit) {
      this.flush();
    }
  }

  /** Flush buffer to SQLite (REQ-CONST-014) */
  flush(): number {
    if (this.buffer.length === 0) return 0;

    const toFlush = [...this.buffer];
    this.buffer.length = 0;

    try {
      const db = getDatabaseConnection();
      const stmt = db.prepare<Record<string, unknown>>(`
        INSERT INTO token_usage (
          id, session_id, request_id, input_tokens, output_tokens,
          total_tokens, task_type, agent_id, trajectory_id, timestamp
        ) VALUES (
          @id, @sessionId, @requestId, @inputTokens, @outputTokens,
          @totalTokens, @taskType, @agentId, @trajectoryId, @timestamp
        )
      `);

      const insertMany = db.db.transaction((entries: ITokenUsage[]) => {
        for (const entry of entries) {
          stmt.run({
            id: entry.id,
            sessionId: entry.sessionId,
            requestId: entry.requestId,
            inputTokens: entry.inputTokens,
            outputTokens: entry.outputTokens,
            totalTokens: entry.totalTokens,
            taskType: entry.taskType,
            agentId: entry.agentId,
            trajectoryId: entry.trajectoryId ?? null,
            timestamp: entry.timestamp
          });
        }
      });

      insertMany(toFlush);

      logger.debug('Token usage flushed', {
        count: toFlush.length,
        totalTokens: toFlush.reduce((sum, u) => sum + u.totalTokens, 0)
      });

      return toFlush.length;
    } catch (err) {
      logger.error('Failed to flush token usage', err, {
        count: toFlush.length
      });
      // Re-add failed entries to buffer
      this.buffer.push(...toFlush);
      return 0;
    }
  }

  /** Get token statistics */
  getStats(filter?: ITokenStatsFilter): ITokenStats {
    // Flush first to include buffered data
    this.flush();

    const db = getDatabaseConnection();
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter?.taskType) {
      conditions.push('task_type = @taskType');
      params.taskType = filter.taskType;
    }
    if (filter?.agentId) {
      conditions.push('agent_id = @agentId');
      params.agentId = filter.agentId;
    }
    if (filter?.sessionId) {
      conditions.push('session_id = @sessionId');
      params.sessionId = filter.sessionId;
    }
    if (filter?.since) {
      conditions.push('timestamp >= @since');
      params.since = filter.since;
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const stmt = db.prepare<Record<string, unknown>, TokenStatsRow>(`
      SELECT
        COALESCE(SUM(input_tokens), 0) as total_input,
        COALESCE(SUM(output_tokens), 0) as total_output,
        COALESCE(SUM(total_tokens), 0) as total_all,
        COUNT(*) as count
      FROM token_usage
      ${whereClause}
    `);

    const result = stmt.get(params);

    if (!result) {
      return {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        averageInputTokens: 0,
        averageOutputTokens: 0,
        averageTotalTokens: 0,
        requestCount: 0
      };
    }

    const count = result.count || 1; // Avoid division by zero

    return {
      totalInputTokens: result.total_input,
      totalOutputTokens: result.total_output,
      totalTokens: result.total_all,
      averageInputTokens: result.total_input / count,
      averageOutputTokens: result.total_output / count,
      averageTotalTokens: result.total_all / count,
      requestCount: result.count
    };
  }

  /** Get usage by task type */
  getUsageByTaskType(taskType: string, limit = 100): ITokenUsage[] {
    this.flush();
    const db = getDatabaseConnection();
    const stmt = db.prepare<Record<string, unknown>, TokenUsageRow>(`
      SELECT * FROM token_usage
      WHERE task_type = @taskType
      ORDER BY timestamp DESC
      LIMIT @limit
    `);
    const rows = stmt.all({ taskType, limit });
    return this.rowsToUsage(rows);
  }

  /** Get usage by trajectory */
  getUsageByTrajectory(trajectoryId: string): ITokenUsage[] {
    this.flush();
    const db = getDatabaseConnection();
    const stmt = db.prepare<Record<string, unknown>, TokenUsageRow>(`
      SELECT * FROM token_usage
      WHERE trajectory_id = @trajectoryId
      ORDER BY timestamp ASC
    `);
    const rows = stmt.all({ trajectoryId });
    return this.rowsToUsage(rows);
  }

  /** Get usage by session */
  getUsageBySession(sessionId: string, limit = 100): ITokenUsage[] {
    this.flush();
    const db = getDatabaseConnection();
    const stmt = db.prepare<Record<string, unknown>, TokenUsageRow>(`
      SELECT * FROM token_usage
      WHERE session_id = @sessionId
      ORDER BY timestamp DESC
      LIMIT @limit
    `);
    const rows = stmt.all({ sessionId, limit });
    return this.rowsToUsage(rows);
  }

  /** Get usage by agent */
  getUsageByAgent(agentId: string, limit = 100): ITokenUsage[] {
    this.flush();
    const db = getDatabaseConnection();
    const stmt = db.prepare<Record<string, unknown>, TokenUsageRow>(`
      SELECT * FROM token_usage
      WHERE agent_id = @agentId
      ORDER BY timestamp DESC
      LIMIT @limit
    `);
    const rows = stmt.all({ agentId, limit });
    return this.rowsToUsage(rows);
  }

  /** Get recent usage */
  getRecent(limit = 50): ITokenUsage[] {
    this.flush();
    const db = getDatabaseConnection();
    const stmt = db.prepare<Record<string, unknown>, TokenUsageRow>(`
      SELECT * FROM token_usage
      ORDER BY timestamp DESC
      LIMIT @limit
    `);
    const rows = stmt.all({ limit });
    return this.rowsToUsage(rows);
  }

  /** Get usage in time range */
  getUsageInRange(startTime: number, endTime: number): ITokenUsage[] {
    this.flush();
    const db = getDatabaseConnection();
    const stmt = db.prepare<Record<string, unknown>, TokenUsageRow>(`
      SELECT * FROM token_usage
      WHERE timestamp >= @startTime AND timestamp <= @endTime
      ORDER BY timestamp ASC
    `);
    const rows = stmt.all({ startTime, endTime });
    return this.rowsToUsage(rows);
  }

  /** Get aggregated stats by task type */
  getStatsByTaskType(): Map<string, ITokenStats> {
    this.flush();
    const db = getDatabaseConnection();
    const stmt = db.prepare<[], { task_type: string } & TokenStatsRow>(`
      SELECT
        task_type,
        COALESCE(SUM(input_tokens), 0) as total_input,
        COALESCE(SUM(output_tokens), 0) as total_output,
        COALESCE(SUM(total_tokens), 0) as total_all,
        COUNT(*) as count
      FROM token_usage
      GROUP BY task_type
      ORDER BY total_all DESC
    `);

    const rows = stmt.all();
    const result = new Map<string, ITokenStats>();

    for (const row of rows) {
      const count = row.count || 1;
      result.set(row.task_type, {
        totalInputTokens: row.total_input,
        totalOutputTokens: row.total_output,
        totalTokens: row.total_all,
        averageInputTokens: row.total_input / count,
        averageOutputTokens: row.total_output / count,
        averageTotalTokens: row.total_all / count,
        requestCount: row.count
      });
    }

    return result;
  }

  /** Get aggregated stats by agent */
  getStatsByAgent(): Map<string, ITokenStats> {
    this.flush();
    const db = getDatabaseConnection();
    const stmt = db.prepare<[], { agent_id: string } & TokenStatsRow>(`
      SELECT
        agent_id,
        COALESCE(SUM(input_tokens), 0) as total_input,
        COALESCE(SUM(output_tokens), 0) as total_output,
        COALESCE(SUM(total_tokens), 0) as total_all,
        COUNT(*) as count
      FROM token_usage
      GROUP BY agent_id
      ORDER BY total_all DESC
    `);

    const rows = stmt.all();
    const result = new Map<string, ITokenStats>();

    for (const row of rows) {
      const count = row.count || 1;
      result.set(row.agent_id, {
        totalInputTokens: row.total_input,
        totalOutputTokens: row.total_output,
        totalTokens: row.total_all,
        averageInputTokens: row.total_input / count,
        averageOutputTokens: row.total_output / count,
        averageTotalTokens: row.total_all / count,
        requestCount: row.count
      });
    }

    return result;
  }

  /** Convert DB rows to ITokenUsage */
  private rowsToUsage(rows: TokenUsageRow[]): ITokenUsage[] {
    return rows.map(row => ({
      id: row.id,
      sessionId: row.session_id,
      requestId: row.request_id,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      totalTokens: row.total_tokens,
      taskType: row.task_type,
      agentId: row.agent_id,
      trajectoryId: row.trajectory_id ?? undefined,
      timestamp: row.timestamp
    }));
  }

  /** Generate unique ID */
  private generateId(): string {
    return `tok-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /** Get buffer size (for testing) */
  getBufferSize(): number {
    return this.buffer.length;
  }

  /** Get pending buffer entries (for testing) */
  getBufferedEntries(): ITokenUsage[] {
    return [...this.buffer];
  }

  /** Stop auto-flush and flush remaining */
  close(): void {
    if (this.flushTimeout) {
      clearInterval(this.flushTimeout);
      this.flushTimeout = null;
    }
    this.flush();
    logger.info('TokenTracker closed');
  }
}

// ==================== Singleton Management ====================

let instance: TokenTracker | null = null;

/**
 * Get the singleton TokenTracker instance
 */
export function getTokenTracker(): TokenTracker {
  if (!instance) {
    instance = new TokenTracker();
  }
  return instance;
}

/**
 * Reset the TokenTracker singleton (for testing)
 */
export function _resetTokenTrackerForTesting(): void {
  if (instance) {
    instance.close();
  }
  instance = null;
}
