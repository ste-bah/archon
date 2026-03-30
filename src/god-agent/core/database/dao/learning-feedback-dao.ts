/**
 * LearningFeedbackDAO - Data Access Object for Learning Feedback persistence
 *
 * Implements: GAP-DESC-005, RULE-008, RULE-018, RULE-072, RULE-088
 * Constitution:
 *   - RULE-008: ALL learning feedback MUST be stored in SQLite
 *   - RULE-018: Feedback is APPEND-ONLY (NO DELETE, NO UPDATE except processed flag)
 *   - RULE-072: Use withRetrySync for all DB operations
 *   - RULE-074: FORBIDDEN - Map as primary storage
 *   - RULE-088: Quality must be validated (0.0-1.0)
 *
 * This DAO provides SQLite-backed persistence for learning feedback records.
 * CRITICAL: All feedback data MUST be stored in SQLite (RULE-008)
 */

import type { IDatabaseConnection } from '../connection.js';
import type Database from 'better-sqlite3';
import { withRetrySync } from '../../validation/index.js';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

/**
 * Valid outcome values for feedback
 * Matches CHECK constraint in outcomes.sql
 */
export type FeedbackOutcome = 'positive' | 'negative' | 'neutral';

/**
 * Input for creating new learning feedback
 * Does not include version or processed (set by DAO)
 */
export interface ILearningFeedbackInput {
  /** Unique identifier for this feedback record */
  id: string;
  /** Associated trajectory ID (required) */
  trajectoryId: string;
  /** Optional linked episode ID */
  episodeId?: string;
  /** Optional linked pattern ID */
  patternId?: string;
  /** Quality score 0.0-1.0 (RULE-088 validated) */
  quality: number;
  /** Outcome classification */
  outcome: FeedbackOutcome;
  /** Type of task that generated this feedback */
  taskType: string;
  /** ID of agent that generated this feedback */
  agentId: string;
  /** Length of result in characters (optional) */
  resultLength?: number;
  /** Whether the result contains code blocks */
  hasCodeBlocks?: boolean;
  /** Unix timestamp in milliseconds */
  createdAt: number;
  /** RLM: Whether context injection was successful */
  rlmInjectionSuccess?: boolean;
  /** RLM: Source agent key that produced the injected output */
  rlmSourceAgent?: string;
  /** RLM: Source step index in the pipeline */
  rlmSourceStepIndex?: number;
  /** RLM: Memory domain from which output was retrieved */
  rlmSourceDomain?: string;
}

/**
 * Full learning feedback record including system fields
 */
export interface ILearningFeedback extends ILearningFeedbackInput {
  /** Version number for optimistic locking */
  version: number;
  /** Whether this feedback has been processed for learning */
  processed: boolean;
  /** RLM: Whether context injection was successful (inherited from input) */
  rlmInjectionSuccess?: boolean;
  /** RLM: Source agent key that produced the injected output (inherited from input) */
  rlmSourceAgent?: string;
  /** RLM: Source step index in the pipeline (inherited from input) */
  rlmSourceStepIndex?: number;
  /** RLM: Memory domain from which output was retrieved (inherited from input) */
  rlmSourceDomain?: string;
}

/**
 * Database row representation for learning_feedback table
 * Matches the outcomes.sql schema
 */
interface ILearningFeedbackRow {
  id: string;
  trajectory_id: string;
  episode_id: string | null;
  pattern_id: string | null;
  quality: number;
  outcome: string;
  task_type: string;
  agent_id: string;
  result_length: number | null;
  has_code_blocks: number;
  rlm_injection_success: number | null;
  rlm_source_agent: string | null;
  rlm_source_step_index: number | null;
  rlm_source_domain: string | null;
  created_at: number;
  version: number;
  processed: number;
}

/**
 * Count result from aggregate queries
 */
interface ICountResult {
  count: number;
}

/**
 * Statistics result for observability
 */
interface IStatsRow {
  count: number;
  total_processed: number;
  avg_quality: number | null;
  positive_count: number;
  negative_count: number;
  neutral_count: number;
}

// ============================================================
// DAO IMPLEMENTATION
// ============================================================

/**
 * LearningFeedbackDAO - SQLite-backed learning feedback persistence
 *
 * Provides CRUD operations for learning feedback with proper validation
 * and APPEND-ONLY semantics per Constitution RULE-018.
 *
 * RULE-074 COMPLIANCE: No Map/in-memory primary storage - all data in SQLite.
 */
export class LearningFeedbackDAO {
  private insertStmt: Database.Statement<unknown[], unknown> | null = null;
  private selectByIdStmt: Database.Statement<unknown[], unknown> | null = null;
  private selectByTrajectoryIdStmt: Database.Statement<unknown[], unknown> | null = null;
  private selectUnprocessedStmt: Database.Statement<unknown[], unknown> | null = null;
  private countStmt: Database.Statement<unknown[], unknown> | null = null;
  private countUnprocessedStmt: Database.Statement<unknown[], unknown> | null = null;
  private markProcessedStmt: Database.Statement<unknown[], unknown> | null = null;
  // RULE-018 COMPLIANCE: DELETE/UPDATE statements intentionally omitted

  constructor(private readonly db: IDatabaseConnection) {
    this.ensureSchema();
    this.prepareStatements();
  }

  /**
   * Ensure additional indexes exist for learning_feedback table
   * The table itself is created by outcomes.sql schema initialization
   */
  private ensureSchema(): void {
    // Table already exists from outcomes.sql, ensure additional indexes if needed
    this.db.db.exec(`
      -- Composite index for efficient unprocessed feedback queries by trajectory
      CREATE INDEX IF NOT EXISTS idx_feedback_unprocessed_trajectory
        ON learning_feedback(processed, trajectory_id)
        WHERE processed = 0;

      -- Composite index for quality-based queries by outcome
      CREATE INDEX IF NOT EXISTS idx_feedback_outcome_quality
        ON learning_feedback(outcome, quality DESC);

      -- Index for agent-based queries
      CREATE INDEX IF NOT EXISTS idx_feedback_agent
        ON learning_feedback(agent_id, created_at DESC);

      -- Index for task type analysis
      CREATE INDEX IF NOT EXISTS idx_feedback_task_type
        ON learning_feedback(task_type, outcome);
    `);
  }

  /**
   * Prepare SQL statements for performance
   */
  private prepareStatements(): void {
    this.insertStmt = this.db.prepare(`
      INSERT INTO learning_feedback (
        id, trajectory_id, episode_id, pattern_id, quality, outcome,
        task_type, agent_id, result_length, has_code_blocks,
        rlm_injection_success, rlm_source_agent, rlm_source_step_index, rlm_source_domain,
        created_at, version, processed
      ) VALUES (
        @id, @trajectoryId, @episodeId, @patternId, @quality, @outcome,
        @taskType, @agentId, @resultLength, @hasCodeBlocks,
        @rlmInjectionSuccess, @rlmSourceAgent, @rlmSourceStepIndex, @rlmSourceDomain,
        @createdAt, @version, @processed
      )
    `);

    this.selectByIdStmt = this.db.prepare(`
      SELECT * FROM learning_feedback WHERE id = ?
    `);

    this.selectByTrajectoryIdStmt = this.db.prepare(`
      SELECT * FROM learning_feedback WHERE trajectory_id = ? ORDER BY created_at DESC
    `);

    this.selectUnprocessedStmt = this.db.prepare(`
      SELECT * FROM learning_feedback WHERE processed = 0 ORDER BY created_at ASC LIMIT ?
    `);

    this.countStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM learning_feedback
    `);

    this.countUnprocessedStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM learning_feedback WHERE processed = 0
    `);

    // RULE-018: Only processed flag can be updated
    this.markProcessedStmt = this.db.prepare(`
      UPDATE learning_feedback SET processed = 1, version = version + 1 WHERE id = ?
    `);

    // RULE-018 COMPLIANCE: No DELETE statements prepared - feedback is append-only
  }

  /**
   * Validate quality score per RULE-088
   *
   * @param quality - Quality score to validate
   * @throws Error if quality is outside valid range
   */
  private validateQuality(quality: number): void {
    if (typeof quality !== 'number' || !Number.isFinite(quality)) {
      throw new Error(
        `RULE-088 VIOLATION: Quality must be a finite number, got: ${typeof quality}`
      );
    }
    if (quality < 0.0 || quality > 1.0) {
      throw new Error(
        `RULE-088 VIOLATION: Quality must be in range [0.0, 1.0], got: ${quality}`
      );
    }
  }

  /**
   * Validate outcome value
   *
   * @param outcome - Outcome to validate
   * @throws Error if outcome is not a valid value
   */
  private validateOutcome(outcome: string): void {
    const validOutcomes: FeedbackOutcome[] = ['positive', 'negative', 'neutral'];
    if (!validOutcomes.includes(outcome as FeedbackOutcome)) {
      throw new Error(
        `Invalid outcome: "${outcome}". Must be one of: ${validOutcomes.join(', ')}`
      );
    }
  }

  /**
   * Validate and truncate RLM string values
   *
   * @param value - String value to validate
   * @param maxLength - Maximum allowed length (default: 256)
   * @returns Validated/truncated string or null if undefined
   */
  private validateRlmString(value: string | undefined, maxLength = 256): string | null {
    if (value === undefined || value === null) return null;
    if (value.length > maxLength) return value.substring(0, maxLength);
    return value;
  }

  /**
   * Insert learning feedback into SQLite
   *
   * Implements: RULE-008 (SQLite storage), RULE-072 (retry), RULE-088 (validation)
   * Uses exponential backoff: 100ms, 200ms, 400ms
   *
   * @param feedback - The learning feedback input to persist
   * @throws Error if insert fails after all retry attempts or validation fails
   */
  insert(feedback: ILearningFeedbackInput): void {
    // RULE-088: Validate quality before insert
    this.validateQuality(feedback.quality);
    this.validateOutcome(feedback.outcome);

    const params = {
      id: feedback.id,
      trajectoryId: feedback.trajectoryId,
      episodeId: feedback.episodeId ?? null,
      patternId: feedback.patternId ?? null,
      quality: feedback.quality,
      outcome: feedback.outcome,
      taskType: feedback.taskType,
      agentId: feedback.agentId,
      resultLength: feedback.resultLength ?? null,
      hasCodeBlocks: feedback.hasCodeBlocks ? 1 : 0,
      rlmInjectionSuccess: feedback.rlmInjectionSuccess !== undefined
        ? (feedback.rlmInjectionSuccess ? 1 : 0)
        : null,
      rlmSourceAgent: this.validateRlmString(feedback.rlmSourceAgent),
      rlmSourceStepIndex: feedback.rlmSourceStepIndex ?? null,
      rlmSourceDomain: this.validateRlmString(feedback.rlmSourceDomain),
      createdAt: feedback.createdAt,
      version: 1,
      processed: 0
    };

    // RULE-072: Database operations MUST retry on failure (max 3 attempts)
    withRetrySync(
      () => this.insertStmt!.run(params),
      { operationName: 'LearningFeedbackDAO.insert' }
    );
  }

  /**
   * Mark feedback as processed
   *
   * This is the ONLY update operation allowed per RULE-018.
   * Used to track which feedback has been consumed by the learning system.
   *
   * @param id - The feedback ID to mark as processed
   * @throws Error if update fails after retry attempts
   */
  markProcessed(id: string): void {
    // RULE-072: Database operations MUST retry on failure
    withRetrySync(
      () => this.markProcessedStmt!.run(id),
      { operationName: 'LearningFeedbackDAO.markProcessed' }
    );
  }

  /**
   * Find feedback by ID
   *
   * @param id - The feedback ID to find
   * @returns The learning feedback or null if not found
   */
  findById(id: string): ILearningFeedback | null {
    const row = this.selectByIdStmt!.get(id) as ILearningFeedbackRow | undefined;
    if (!row) return null;
    return this.rowToFeedback(row);
  }

  /**
   * Find all feedback for a trajectory
   *
   * @param trajectoryId - The trajectory ID to query
   * @returns Array of learning feedback records (newest first)
   */
  findByTrajectoryId(trajectoryId: string): ILearningFeedback[] {
    const rows = this.selectByTrajectoryIdStmt!.all(trajectoryId) as ILearningFeedbackRow[];
    return rows.map(row => this.rowToFeedback(row));
  }

  /**
   * Find unprocessed feedback for batch learning
   *
   * @param limit - Maximum number of records to return (default: 100)
   * @returns Array of unprocessed feedback records (oldest first for FIFO processing)
   */
  findUnprocessed(limit: number = 100): ILearningFeedback[] {
    const rows = this.selectUnprocessedStmt!.all(limit) as ILearningFeedbackRow[];
    return rows.map(row => this.rowToFeedback(row));
  }

  /**
   * Get total count of feedback records
   *
   * @returns Total number of feedback records
   */
  count(): number {
    const result = this.countStmt!.get() as ICountResult;
    return result.count;
  }

  /**
   * Get count of unprocessed feedback records
   *
   * @returns Number of feedback records awaiting processing
   */
  countUnprocessed(): number {
    const result = this.countUnprocessedStmt!.get() as ICountResult;
    return result.count;
  }

  /**
   * Check if feedback exists
   *
   * @param id - The feedback ID to check
   * @returns True if the feedback exists
   */
  exists(id: string): boolean {
    return this.findById(id) !== null;
  }

  /**
   * Delete a feedback record by ID
   *
   * RULE-018 VIOLATION: Learning feedback is append-only. DELETE operations are FORBIDDEN.
   *
   * @param _id - The feedback ID (unused - operation forbidden)
   * @throws Error Always throws - DELETE is forbidden per RULE-018
   */
  delete(_id: string): never {
    throw new Error(
      'RULE-018 VIOLATION: Learning feedback is append-only. DELETE operations are FORBIDDEN. ' +
      'Only markProcessed() updates are permitted.'
    );
  }

  /**
   * Clear all feedback records
   *
   * RULE-018 VIOLATION: Learning feedback is append-only. DELETE/CLEAR operations are FORBIDDEN.
   *
   * @throws Error Always throws - CLEAR is forbidden per RULE-018
   */
  clear(): never {
    throw new Error(
      'RULE-018 VIOLATION: Learning feedback is append-only. CLEAR operations are FORBIDDEN. ' +
      'Only markProcessed() updates are permitted.'
    );
  }

  /**
   * Get storage statistics for observability
   *
   * @returns Statistics about stored feedback
   */
  getStats(): {
    feedbackCount: number;
    processedCount: number;
    unprocessedCount: number;
    avgQuality: number;
    outcomeBreakdown: {
      positive: number;
      negative: number;
      neutral: number;
    };
  } {
    const statsRow = this.db.prepare(`
      SELECT
        COUNT(*) as count,
        SUM(CASE WHEN processed = 1 THEN 1 ELSE 0 END) as total_processed,
        AVG(quality) as avg_quality,
        SUM(CASE WHEN outcome = 'positive' THEN 1 ELSE 0 END) as positive_count,
        SUM(CASE WHEN outcome = 'negative' THEN 1 ELSE 0 END) as negative_count,
        SUM(CASE WHEN outcome = 'neutral' THEN 1 ELSE 0 END) as neutral_count
      FROM learning_feedback
    `).get() as IStatsRow;

    const feedbackCount = statsRow.count;
    const processedCount = statsRow.total_processed;

    return {
      feedbackCount,
      processedCount,
      unprocessedCount: feedbackCount - processedCount,
      avgQuality: statsRow.avg_quality ?? 0,
      outcomeBreakdown: {
        positive: statsRow.positive_count,
        negative: statsRow.negative_count,
        neutral: statsRow.neutral_count
      }
    };
  }

  /**
   * Convert a database row to an ILearningFeedback object
   */
  private rowToFeedback(row: ILearningFeedbackRow): ILearningFeedback {
    return {
      id: row.id,
      trajectoryId: row.trajectory_id,
      episodeId: row.episode_id ?? undefined,
      patternId: row.pattern_id ?? undefined,
      quality: row.quality,
      outcome: row.outcome as FeedbackOutcome,
      taskType: row.task_type,
      agentId: row.agent_id,
      resultLength: row.result_length ?? undefined,
      hasCodeBlocks: row.has_code_blocks === 1,
      rlmInjectionSuccess: row.rlm_injection_success !== null
        ? row.rlm_injection_success === 1
        : undefined,
      rlmSourceAgent: row.rlm_source_agent ?? undefined,
      rlmSourceStepIndex: row.rlm_source_step_index ?? undefined,
      rlmSourceDomain: row.rlm_source_domain ?? undefined,
      createdAt: row.created_at,
      version: row.version,
      processed: row.processed === 1
    };
  }
}
