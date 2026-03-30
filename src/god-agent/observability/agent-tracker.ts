/**
 * AgentExecutionTracker - Track agent lifecycle from spawn to completion
 *
 * Implements agent execution tracking with timing, status, and memory coordination.
 * Maintains bounded list of active and completed executions with FIFO eviction.
 *
 * @module observability/agent-tracker
 * @see TASK-OBS-003-AGENT-TRACKER.md
 * @see TECH-OBS-001-IMPLEMENTATION.md Section 3.4
 */

import Database from 'better-sqlite3';
import * as path from 'path';

import {
  IAgentExecution,
  IMemoryEntry,
  ActivityEventComponent,
  ActivityEventStatus,
} from './types.js';
import { IActivityStream } from './activity-stream.js';

// =============================================================================
// Interfaces
// =============================================================================

/**
 * Agent result data after completion
 */
export interface IAgentResult {
  /** Result output/summary */
  output: string;
  /** Quality score 0-1 */
  qualityScore?: number;
  /** Memory entries stored by this agent */
  memoryStored?: IMemoryEntry[];
}

/**
 * Input for starting agent from IPC event
 */
export interface IAgentStartInput {
  id: string;
  agentKey: string;
  agentName: string;
  category: string;
  pipelineId?: string;
  input: string;
  startTime: number;
  promptText?: string;
}

/**
 * Input for completing agent from IPC event
 */
export interface IAgentCompleteInput {
  output: string;
  qualityScore?: number;
  durationMs: number;
}

/**
 * AgentExecutionTracker interface
 * Implements [REQ-OBS-04]: AgentExecutionTracker MUST track agent lifecycle
 */
export interface IAgentExecutionTracker {
  /**
   * Start tracking a new agent execution
   * @param execution Agent execution data (without endTime, durationMs, status)
   * @returns Unique execution ID
   */
  startAgent(execution: Omit<IAgentExecution, 'endTime' | 'durationMs' | 'status'>): string;

  /**
   * Start tracking agent from IPC event (with pre-generated ID)
   * Used by SocketServer when receiving events from God Agent processes
   * @param input Agent start input with pre-generated executionId
   */
  startAgentFromEvent(input: IAgentStartInput): void;

  /**
   * Mark agent execution as completed successfully
   * @param executionId The execution ID to complete
   * @param result Result data from agent execution
   */
  completeAgent(executionId: string, result: IAgentResult): void;

  /**
   * Mark agent as completed from IPC event
   * @param executionId The execution ID to complete
   * @param input Completion data from event
   */
  completeAgentFromEvent(executionId: string, input: IAgentCompleteInput): void;

  /**
   * Mark agent execution as failed
   * @param executionId The execution ID that failed
   * @param error The error that caused failure
   */
  failAgent(executionId: string, error: Error): void;

  /**
   * Mark agent as failed from IPC event
   * @param executionId The execution ID that failed
   * @param errorMessage Error message from event
   * @param durationMs Execution duration
   */
  failAgentFromEvent(executionId: string, errorMessage: string, durationMs: number): void;

  /**
   * Get all currently active agent executions
   * @returns Array of active executions
   */
  getActive(): IAgentExecution[];

  /**
   * Get executions by agent key (active + recent completed)
   * @param agentKey The agent key to filter by
   * @returns Array of matching executions
   */
  getByType(agentKey: string): IAgentExecution[];

  /**
   * Get a specific execution by ID
   * @param executionId The execution ID to retrieve
   * @returns The execution or null if not found
   */
  getById(executionId: string): IAgentExecution | null;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * AgentExecutionTracker implementation
 *
 * Implements:
 * - [REQ-OBS-04]: Agent lifecycle tracking
 * - [REQ-OBS-05]: Output summary, quality score, memory capture
 * - [RULE-OBS-004]: Memory bounds enforcement (50 completed max)
 */
export class AgentExecutionTracker implements IAgentExecutionTracker {
  // Active executions by ID
  private active: Map<string, IAgentExecution> = new Map();

  // Completed executions (FIFO, max 50)
  private completed: IAgentExecution[] = [];

  // Maximum completed executions to retain
  private readonly MAX_COMPLETED = 50;

  // SQLite database handle for persistence
  private db: InstanceType<typeof Database> | null = null;

  /**
   * Create a new AgentExecutionTracker
   * @param activityStream ActivityStream for event emission
   * @param dbPath Path to SQLite database file (default: .god-agent/events.db)
   */
  constructor(
    private activityStream: IActivityStream,
    dbPath?: string,
  ) {
    const resolvedPath = dbPath || path.resolve(process.cwd(), '.god-agent', 'events.db');
    this.initDb(resolvedPath);
  }

  /**
   * Start tracking a new agent execution
   * Implements [REQ-OBS-04]: Track agent start
   *
   * @param execution Agent execution data
   * @returns Unique execution ID (format: exec_{agentKey}_{timestamp}_{random})
   */
  public startAgent(
    execution: Omit<IAgentExecution, 'endTime' | 'durationMs' | 'status'>
  ): string {
    // Generate execution ID
    const executionId = this.generateExecutionId(execution.agentKey);

    // Create full execution record
    const fullExecution: IAgentExecution = {
      ...execution,
      id: executionId,
      status: 'running',
      startTime: Date.now(),
    };

    // Store in active map
    this.active.set(executionId, fullExecution);

    // Persist to SQLite
    this.persistAgent(fullExecution);

    // Emit agent_started event
    this.activityStream.push({
      id: `evt_${Date.now()}_${this.randomId()}`,
      timestamp: Date.now(),
      component: 'agent' as ActivityEventComponent,
      operation: 'agent_started',
      status: 'running' as ActivityEventStatus,
      metadata: {
        executionId,
        agentKey: execution.agentKey,
        agentName: execution.agentName,
        category: execution.category,
        pipelineId: execution.pipelineId,
        input: execution.input,
      },
    });

    return executionId;
  }

  /**
   * Mark agent execution as completed successfully
   * Implements [REQ-OBS-05]: Capture output, quality, memory
   *
   * @param executionId The execution ID to complete
   * @param result Result data from agent execution
   */
  public completeAgent(executionId: string, result: IAgentResult): void {
    const execution = this.active.get(executionId);

    if (!execution) {
      // Log warning but don't throw (defensive)
      console.warn(`[AgentExecutionTracker] Attempted to complete unknown execution: ${executionId}`);
      return;
    }

    // Calculate duration
    const endTime = Date.now();
    const durationMs = endTime - execution.startTime;

    // Update execution record
    execution.status = 'completed';
    execution.endTime = endTime;
    execution.durationMs = durationMs;
    execution.output = result.output;
    execution.qualityScore = result.qualityScore;
    execution.memoryStored = result.memoryStored;

    // Move from active to completed
    this.active.delete(executionId);
    this.addCompleted(execution);

    // Persist updated state to SQLite
    this.persistAgent(execution);

    // Emit agent_completed event
    this.activityStream.push({
      id: `evt_${Date.now()}_${this.randomId()}`,
      timestamp: Date.now(),
      component: 'agent' as ActivityEventComponent,
      operation: 'agent_completed',
      status: 'success' as ActivityEventStatus,
      durationMs,
      metadata: {
        executionId,
        agentKey: execution.agentKey,
        agentName: execution.agentName,
        qualityScore: result.qualityScore,
        memoryStored: result.memoryStored?.length || 0,
        pipelineId: execution.pipelineId,
      },
    });
  }

  /**
   * Mark agent execution as failed
   *
   * @param executionId The execution ID that failed
   * @param error The error that caused failure
   */
  public failAgent(executionId: string, error: Error): void {
    const execution = this.active.get(executionId);

    if (!execution) {
      console.warn(`[AgentExecutionTracker] Attempted to fail unknown execution: ${executionId}`);
      return;
    }

    // Calculate duration
    const endTime = Date.now();
    const durationMs = endTime - execution.startTime;

    // Update execution record
    execution.status = 'failed';
    execution.endTime = endTime;
    execution.durationMs = durationMs;
    execution.error = error.message;

    // Move from active to completed
    this.active.delete(executionId);
    this.addCompleted(execution);

    // Persist updated state to SQLite
    this.persistAgent(execution);

    // Emit agent_failed event
    this.activityStream.push({
      id: `evt_${Date.now()}_${this.randomId()}`,
      timestamp: Date.now(),
      component: 'agent' as ActivityEventComponent,
      operation: 'agent_failed',
      status: 'error' as ActivityEventStatus,
      durationMs,
      metadata: {
        executionId,
        agentKey: execution.agentKey,
        agentName: execution.agentName,
        error: error.message,
        pipelineId: execution.pipelineId,
      },
    });
  }

  // ===========================================================================
  // IPC Event Methods (for SocketServer routing)
  // ===========================================================================

  /**
   * Start tracking agent from IPC event (with pre-generated ID)
   * Used by SocketServer when receiving events from God Agent processes
   *
   * NOTE: This does NOT emit an event (the event already came from the God Agent
   * process via IPC). It just updates the tracker state.
   *
   * @param input Agent start input with pre-generated executionId
   */
  public startAgentFromEvent(input: IAgentStartInput): void {
    // Create execution record with pre-generated ID
    const execution: IAgentExecution = {
      id: input.id,
      agentKey: input.agentKey,
      agentName: input.agentName,
      category: input.category,
      pipelineId: input.pipelineId,
      input: input.input,
      promptText: input.promptText,
      status: 'running',
      startTime: input.startTime,
    };

    // Store in active map
    this.active.set(input.id, execution);

    // Persist to SQLite
    this.persistAgent(execution);
  }

  /**
   * Mark agent as completed from IPC event
   * Used by SocketServer when receiving events from God Agent processes
   *
   * NOTE: This does NOT emit an event (the event already came from IPC).
   *
   * @param executionId The execution ID to complete
   * @param input Completion data from event
   */
  public completeAgentFromEvent(executionId: string, input: IAgentCompleteInput): void {
    const execution = this.active.get(executionId);

    if (!execution) {
      // Agent may have been started before daemon was running, or event lost
      // Log warning but don't fail
      console.warn(`[AgentExecutionTracker] Attempted to complete unknown execution from event: ${executionId}`);
      return;
    }

    // Update execution record
    const endTime = Date.now();
    execution.status = 'completed';
    execution.endTime = endTime;
    execution.durationMs = input.durationMs || (endTime - execution.startTime);
    execution.output = input.output;
    execution.qualityScore = input.qualityScore;

    // Move from active to completed
    this.active.delete(executionId);
    this.addCompleted(execution);

    // Persist updated state to SQLite
    this.persistAgent(execution);
  }

  /**
   * Mark agent as failed from IPC event
   * Used by SocketServer when receiving events from God Agent processes
   *
   * NOTE: This does NOT emit an event (the event already came from IPC).
   *
   * @param executionId The execution ID that failed
   * @param errorMessage Error message from event
   * @param durationMs Execution duration
   */
  public failAgentFromEvent(executionId: string, errorMessage: string, durationMs: number): void {
    const execution = this.active.get(executionId);

    if (!execution) {
      console.warn(`[AgentExecutionTracker] Attempted to fail unknown execution from event: ${executionId}`);
      return;
    }

    // Update execution record
    const endTime = Date.now();
    execution.status = 'failed';
    execution.endTime = endTime;
    execution.durationMs = durationMs || (endTime - execution.startTime);
    execution.error = errorMessage;

    // Move from active to completed
    this.active.delete(executionId);
    this.addCompleted(execution);

    // Persist updated state to SQLite
    this.persistAgent(execution);
  }

  // ===========================================================================
  // Query Methods
  // ===========================================================================

  /**
   * Get all currently active agent executions
   * @returns Array of active executions
   */
  public getActive(): IAgentExecution[] {
    return Array.from(this.active.values());
  }

  /**
   * Get executions by agent key (active + recent completed)
   * @param agentKey The agent key to filter by
   * @returns Array of matching executions
   */
  public getByType(agentKey: string): IAgentExecution[] {
    const activeMatches = this.getActive().filter(e => e.agentKey === agentKey);
    const completedMatches = this.completed.filter(e => e.agentKey === agentKey);

    return [...activeMatches, ...completedMatches];
  }

  /**
   * Get a specific execution by ID
   * @param executionId The execution ID to retrieve
   * @returns The execution or null if not found
   */
  public getById(executionId: string): IAgentExecution | null {
    // Check active first
    const activeExec = this.active.get(executionId);
    if (activeExec) {
      return activeExec;
    }

    // Check completed
    const completedExec = this.completed.find(e => e.id === executionId);
    return completedExec || null;
  }

  /**
   * Get statistics about tracker state
   */
  public getStats(): {
    activeCount: number;
    completedCount: number;
    maxCompleted: number;
  } {
    return {
      activeCount: this.active.size,
      completedCount: this.completed.length,
      maxCompleted: this.MAX_COMPLETED,
    };
  }

  // ===========================================================================
  // SQLite Persistence Methods
  // ===========================================================================

  /**
   * Initialize SQLite database for agent state persistence.
   * Creates the active_agents table if it does not exist, then rehydrates
   * in-memory state and prunes stale rows.
   */
  private initDb(dbPath: string): void {
    try {
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('busy_timeout = 5000');

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS active_agents (
          execution_id TEXT PRIMARY KEY,
          agent_key TEXT NOT NULL,
          agent_name TEXT,
          category TEXT,
          status TEXT NOT NULL,
          start_time INTEGER NOT NULL,
          end_time INTEGER,
          duration_ms INTEGER,
          input TEXT,
          output TEXT,
          quality_score REAL,
          error TEXT,
          prompt_text TEXT,
          updated_at INTEGER NOT NULL
        )
      `);

      // Migration: add prompt_text for databases created before this column existed
      try {
        const columns = this.db.pragma('table_info(active_agents)') as Array<{name: string}>;
        const hasPromptText = columns.some(c => c.name === 'prompt_text');
        if (!hasPromptText) {
          this.db.exec('ALTER TABLE active_agents ADD COLUMN prompt_text TEXT');
        }
      } catch {
        // Column check or migration failed — not critical
      }

      this.db.exec(
        'CREATE INDEX IF NOT EXISTS idx_active_agents_status ON active_agents(status)'
      );

      this.rehydrate();
      this.cleanupOld();
    } catch (err) {
      console.warn('[AgentExecutionTracker] Failed to initialize SQLite persistence — continuing in-memory only:', err);
      this.db = null;
    }
  }

  /**
   * Rehydrate in-memory state from SQLite after a daemon restart.
   * - Running agents are restored to `this.active`
   * - Completed/failed agents from the last hour are restored to `this.completed`
   */
  private rehydrate(): void {
    if (!this.db) return;

    try {
      const oneHourAgo = Date.now() - 3_600_000;

      // Restore running agents
      const runningRows = this.db.prepare(
        'SELECT * FROM active_agents WHERE status = ?'
      ).all('running') as any[];

      for (const row of runningRows) {
        const execution = this.rowToExecution(row);
        this.active.set(execution.id, execution);
      }

      // Restore recent completed/failed agents (newest 50, then reverse to oldest-first)
      const recentRows = this.db.prepare(
        'SELECT * FROM active_agents WHERE status IN (?, ?) AND updated_at > ? ORDER BY updated_at DESC LIMIT 50'
      ).all('completed', 'failed', oneHourAgo) as any[];

      recentRows.reverse(); // oldest-first for FIFO ordering
      for (const row of recentRows) {
        const execution = this.rowToExecution(row);
        this.completed.push(execution);
      }

      // Mark stale running agents as failed (running > 2 hours means daemon died)
      const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
      const now = Date.now();
      for (const [id, execution] of Array.from(this.active.entries())) {
        if (now - execution.startTime > TWO_HOURS_MS) {
          execution.status = 'failed';
          execution.error = 'Daemon restarted — outcome unknown';
          execution.endTime = now;
          this.active.delete(id);
          this.addCompleted(execution);
        }
      }

      if (runningRows.length > 0 || recentRows.length > 0) {
        console.log(
          `[AgentExecutionTracker] Rehydrated ${this.active.size} active, ${recentRows.length} recent completed agents from SQLite`
        );
      }
    } catch (err) {
      console.warn('[AgentExecutionTracker] Failed to rehydrate from SQLite:', err);
    }
  }

  /**
   * Convert a SQLite row object back into an IAgentExecution.
   */
  private rowToExecution(row: any): IAgentExecution {
    const execution: IAgentExecution = {
      id: row.execution_id,
      agentKey: row.agent_key,
      agentName: row.agent_name || '',
      category: row.category || '',
      status: row.status as IAgentExecution['status'],
      startTime: row.start_time,
      input: row.input || '',
    };

    if (row.end_time != null) execution.endTime = row.end_time;
    if (row.duration_ms != null) execution.durationMs = row.duration_ms;
    if (row.output != null) execution.output = row.output;
    if (row.quality_score != null) execution.qualityScore = row.quality_score;
    if (row.error != null) execution.error = row.error;
    if (row.prompt_text != null) execution.promptText = row.prompt_text;

    return execution;
  }

  /**
   * Persist (upsert) an agent execution record to SQLite.
   * Never throws — persistence failures are logged and swallowed.
   */
  private persistAgent(execution: IAgentExecution): void {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        INSERT INTO active_agents (
          execution_id, agent_key, agent_name, category, status,
          start_time, end_time, duration_ms, input, output,
          quality_score, error, prompt_text, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(execution_id) DO UPDATE SET
          status = excluded.status,
          end_time = excluded.end_time,
          duration_ms = excluded.duration_ms,
          output = excluded.output,
          quality_score = excluded.quality_score,
          error = excluded.error,
          prompt_text = excluded.prompt_text,
          updated_at = excluded.updated_at
      `);

      stmt.run(
        execution.id,
        execution.agentKey,
        execution.agentName,
        execution.category,
        execution.status,
        execution.startTime,
        execution.endTime ?? null,
        execution.durationMs ?? null,
        execution.input ?? null,
        execution.output ?? null,
        execution.qualityScore ?? null,
        execution.error ?? null,
        execution.promptText ?? null,
        Date.now(),
      );
    } catch (err) {
      console.warn('[AgentExecutionTracker] Failed to persist agent to SQLite:', err);
    }
  }

  /**
   * Remove agent records older than 24 hours from SQLite.
   */
  private cleanupOld(): void {
    if (!this.db) return;

    try {
      const cutoff = Date.now() - 86_400_000; // 24 hours
      const result = this.db.prepare(
        'DELETE FROM active_agents WHERE updated_at < ?'
      ).run(cutoff);

      if (result.changes > 0) {
        console.log(`[AgentExecutionTracker] Cleaned up ${result.changes} stale agent records`);
      }
    } catch (err) {
      console.warn('[AgentExecutionTracker] Failed to clean up old agent records:', err);
    }
  }

  /**
   * Close the SQLite database connection.
   * Call this on daemon shutdown for clean resource release.
   */
  public close(): void {
    try {
      if (this.db) {
        this.db.close();
        this.db = null;
      }
    } catch (err) {
      console.warn('[AgentExecutionTracker] Error closing database:', err);
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Generate a unique execution ID
   * Format: exec_{agentKey}_{timestamp}_{random}
   *
   * @param agentKey The agent key
   * @returns Unique execution ID
   */
  private generateExecutionId(agentKey: string): string {
    const timestamp = Date.now();
    const random = this.randomId();
    return `exec_${agentKey}_${timestamp}_${random}`;
  }

  /**
   * Generate a random 6-character ID
   * @returns Random alphanumeric string
   */
  private randomId(): string {
    return Math.random().toString(36).substring(2, 8);
  }

  /**
   * Add a completed execution to the completed list
   * Implements FIFO eviction when exceeding MAX_COMPLETED
   *
   * @param execution The completed execution
   */
  private addCompleted(execution: IAgentExecution): void {
    // Add to end of array
    this.completed.push(execution);

    // Evict oldest if exceeding max
    if (this.completed.length > this.MAX_COMPLETED) {
      this.completed.shift();  // Remove first (oldest)
    }
  }
}

// =============================================================================
// Default Export
// =============================================================================

export default AgentExecutionTracker;
