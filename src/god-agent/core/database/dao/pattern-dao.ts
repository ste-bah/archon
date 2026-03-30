/**
 * PatternDAO - Data Access Object for Pattern persistence
 *
 * Implements: TASK-PERSIST-002, GAP-PATTERN-001
 * Constitution: RULE-008 (SQLite for all pattern data), RULE-019 (no DELETE),
 *               RULE-072 (withRetrySync), RULE-013 (patterns table), RULE-023 (indexes)
 *
 * This DAO provides SQLite-backed persistence for learned patterns.
 * CRITICAL: All pattern data MUST be stored in SQLite (RULE-008)
 * CRITICAL: NO hard DELETE - use soft delete via deprecated flag (RULE-019)
 * CRITICAL: Map as primary storage is FORBIDDEN (RULE-074)
 */

import type { IDatabaseConnection } from '../connection.js';
import type Database from 'better-sqlite3';
import { withRetrySync } from '../../validation/index.js';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

/**
 * Input interface for creating a new pattern
 */
export interface IPatternInput {
  id: string;
  name: string;
  context: string;
  action: string;
  outcome?: string;
  embedding: Float32Array;
  weight?: number;
  trajectoryIds: string[];
  agentId: string;
  taskType: string;
  createdAt: number;
  tags?: string[];
}

/**
 * Full pattern interface including all computed fields
 */
export interface IPattern {
  id: string;
  name: string;
  context: string;
  action: string;
  outcome?: string;
  embedding: Float32Array;
  weight: number;
  trajectoryIds: string[];
  successCount: number;
  failureCount: number;
  agentId: string;
  taskType: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  deprecated: boolean;
  tags: string[];
}

/**
 * Database row representation for patterns
 * Matches the patterns.sql schema exactly
 */
interface IPatternRow {
  id: string;
  name: string;
  context: string;
  action: string;
  outcome: string | null;
  embedding: Buffer;
  weight: number;
  success_count: number;
  failure_count: number;
  trajectory_ids: string;
  agent_id: string;
  task_type: string;
  created_at: number;
  updated_at: number;
  version: number;
  deprecated: number;
  tags: string;
}

/**
 * Count result interface
 */
interface ICountResult {
  count: number;
}

/**
 * Stats query result interface
 */
interface IStatsRow {
  count: number;
  active_count: number;
  deprecated_count: number;
  total_success: number;
  total_failure: number;
  avg_weight: number;
}

// ============================================================
// PATTERN DAO CLASS
// ============================================================

/**
 * PatternDAO - SQLite-backed pattern persistence
 *
 * Provides CRUD operations for learned patterns with proper serialization
 * of Float32Array embeddings to/from SQLite BLOB storage.
 *
 * FORBIDDEN OPERATIONS:
 * - Hard DELETE (RULE-019) - use deprecate() instead
 * - Map as primary storage (RULE-074)
 */
export class PatternDAO {
  private insertStmt: Database.Statement<unknown[], unknown> | null = null;
  private selectByIdStmt: Database.Statement<unknown[], unknown> | null = null;
  private selectByTaskTypeStmt: Database.Statement<unknown[], unknown> | null = null;
  private selectActiveStmt: Database.Statement<unknown[], unknown> | null = null;
  private countStmt: Database.Statement<unknown[], unknown> | null = null;
  private updateWeightStmt: Database.Statement<unknown[], unknown> | null = null;
  private incrementSuccessStmt: Database.Statement<unknown[], unknown> | null = null;
  private incrementFailureStmt: Database.Statement<unknown[], unknown> | null = null;
  private deprecateStmt: Database.Statement<unknown[], unknown> | null = null;

  constructor(private readonly db: IDatabaseConnection) {
    this.ensureSchema();
    this.prepareStatements();
  }

  // ============================================================
  // SCHEMA MANAGEMENT
  // ============================================================

  /**
   * Ensure the patterns table exists
   * Schema is loaded from patterns.sql by DatabaseConnection
   * This method validates the table exists
   */
  private ensureSchema(): void {
    // Verify patterns table exists (created by DatabaseConnection from patterns.sql)
    const tableCheck = this.db.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='patterns'
    `).get() as { name: string } | undefined;

    if (!tableCheck) {
      throw new Error(
        'RULE-013 VIOLATION: patterns table does not exist. ' +
        'Ensure DatabaseConnection initializes schemas from patterns.sql'
      );
    }
  }

  /**
   * Prepare SQL statements for performance
   */
  private prepareStatements(): void {
    this.insertStmt = this.db.prepare(`
      INSERT INTO patterns (
        id, name, context, action, outcome, embedding,
        weight, success_count, failure_count, trajectory_ids,
        agent_id, task_type, created_at, updated_at, version, deprecated, tags
      ) VALUES (
        @id, @name, @context, @action, @outcome, @embedding,
        @weight, @successCount, @failureCount, @trajectoryIds,
        @agentId, @taskType, @createdAt, @updatedAt, @version, @deprecated, @tags
      )
    `);

    this.selectByIdStmt = this.db.prepare(`
      SELECT * FROM patterns WHERE id = ?
    `);

    this.selectByTaskTypeStmt = this.db.prepare(`
      SELECT * FROM patterns
      WHERE task_type = ? AND deprecated = 0
      ORDER BY weight DESC, updated_at DESC
    `);

    this.selectActiveStmt = this.db.prepare(`
      SELECT * FROM patterns
      WHERE deprecated = 0
      ORDER BY weight DESC, updated_at DESC
    `);

    this.countStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM patterns
    `);

    this.updateWeightStmt = this.db.prepare(`
      UPDATE patterns
      SET weight = ?, updated_at = ?, version = version + 1
      WHERE id = ?
    `);

    this.incrementSuccessStmt = this.db.prepare(`
      UPDATE patterns
      SET success_count = success_count + 1, updated_at = ?, version = version + 1
      WHERE id = ?
    `);

    this.incrementFailureStmt = this.db.prepare(`
      UPDATE patterns
      SET failure_count = failure_count + 1, updated_at = ?, version = version + 1
      WHERE id = ?
    `);

    this.deprecateStmt = this.db.prepare(`
      UPDATE patterns
      SET deprecated = 1, updated_at = ?, version = version + 1
      WHERE id = ?
    `);

    // RULE-019 COMPLIANCE: No DELETE statements prepared
    // Patterns use soft-delete via deprecated flag
  }

  // ============================================================
  // WRITE OPERATIONS
  // ============================================================

  /**
   * Insert a pattern into SQLite
   *
   * Implements: TASK-PERSIST-002, RULE-072 (database retry on failure)
   * Uses exponential backoff: 100ms, 200ms, 400ms
   *
   * @param pattern - The pattern input to persist
   * @throws Error if insert fails after all retry attempts
   */
  insert(pattern: IPatternInput): void {
    const now = Date.now();
    const params = {
      id: pattern.id,
      name: pattern.name,
      context: pattern.context,
      action: pattern.action,
      outcome: pattern.outcome ?? null,
      embedding: this.serializeEmbedding(pattern.embedding),
      weight: pattern.weight ?? 0.5,
      successCount: 0,
      failureCount: 0,
      trajectoryIds: JSON.stringify(pattern.trajectoryIds),
      agentId: pattern.agentId,
      taskType: pattern.taskType,
      createdAt: pattern.createdAt,
      updatedAt: now,
      version: 1,
      deprecated: 0,
      tags: JSON.stringify(pattern.tags ?? [])
    };

    // RULE-072: Database operations MUST retry on failure (max 3 attempts)
    withRetrySync(
      () => this.insertStmt!.run(params),
      { operationName: 'PatternDAO.insert' }
    );
  }

  /**
   * Update the weight of a pattern
   * Used for learning/reinforcement
   *
   * @param id - Pattern ID
   * @param weight - New weight value (0.0 to 1.0)
   * @throws Error if weight is out of range or update fails
   */
  updateWeight(id: string, weight: number): void {
    if (weight < 0.0 || weight > 1.0) {
      throw new Error(`Invalid weight ${weight}: must be between 0.0 and 1.0`);
    }

    const now = Date.now();

    // RULE-072: Database operations MUST retry on failure
    withRetrySync(
      () => this.updateWeightStmt!.run(weight, now, id),
      { operationName: 'PatternDAO.updateWeight' }
    );
  }

  /**
   * Increment the success count for a pattern
   * Used when a pattern leads to successful outcome
   *
   * @param id - Pattern ID
   */
  incrementSuccess(id: string): void {
    const now = Date.now();

    // RULE-072: Database operations MUST retry on failure
    withRetrySync(
      () => this.incrementSuccessStmt!.run(now, id),
      { operationName: 'PatternDAO.incrementSuccess' }
    );
  }

  /**
   * Increment the failure count for a pattern
   * Used when a pattern leads to unsuccessful outcome
   *
   * @param id - Pattern ID
   */
  incrementFailure(id: string): void {
    const now = Date.now();

    // RULE-072: Database operations MUST retry on failure
    withRetrySync(
      () => this.incrementFailureStmt!.run(now, id),
      { operationName: 'PatternDAO.incrementFailure' }
    );
  }

  /**
   * Soft-delete a pattern by setting deprecated=1
   * RULE-019: Hard DELETE is FORBIDDEN - use this instead
   *
   * @param id - Pattern ID to deprecate
   */
  deprecate(id: string): void {
    const now = Date.now();

    // RULE-072: Database operations MUST retry on failure
    withRetrySync(
      () => this.deprecateStmt!.run(now, id),
      { operationName: 'PatternDAO.deprecate' }
    );
  }

  // ============================================================
  // READ OPERATIONS
  // ============================================================

  /**
   * Find a pattern by ID
   *
   * @param id - The pattern ID to find
   * @returns The pattern or null if not found
   */
  findById(id: string): IPattern | null {
    const row = this.selectByIdStmt!.get(id) as IPatternRow | undefined;
    if (!row) return null;
    return this.rowToPattern(row);
  }

  /**
   * Find all patterns for a given task type
   * Only returns active (non-deprecated) patterns
   *
   * @param taskType - The task type to filter by
   * @returns Array of patterns sorted by weight (highest first)
   */
  findByTaskType(taskType: string): IPattern[] {
    const rows = this.selectByTaskTypeStmt!.all(taskType) as IPatternRow[];
    return rows.map(row => this.rowToPattern(row));
  }

  /**
   * Find all active (non-deprecated) patterns
   *
   * @returns Array of active patterns sorted by weight (highest first)
   */
  findActive(): IPattern[] {
    const rows = this.selectActiveStmt!.all() as IPatternRow[];
    return rows.map(row => this.rowToPattern(row));
  }

  /**
   * Get the total count of patterns (including deprecated)
   *
   * @returns The total number of patterns in storage
   */
  count(): number {
    const result = this.countStmt!.get() as ICountResult;
    return result.count;
  }

  /**
   * Check if a pattern exists
   *
   * @param id - The pattern ID to check
   * @returns True if the pattern exists
   */
  exists(id: string): boolean {
    return this.findById(id) !== null;
  }

  // ============================================================
  // TRAJECTORY-PATTERN LINKING
  // ============================================================

  /**
   * Find pattern IDs that are linked to a given trajectory ID.
   * Searches the trajectory_ids JSON array column for the trajectory ID.
   *
   * Implements: FIX-TRAJ-PATTERN-001 (trajectory-pattern link gap)
   *
   * @param trajectoryId - The trajectory ID to search for
   * @returns Array of pattern IDs linked to this trajectory
   */
  findPatternIdsByTrajectoryId(trajectoryId: string): string[] {
    // trajectory_ids is stored as a JSON array, e.g. '["traj_1","traj_2"]'
    // LIKE with '%"<id>"%' is safe because trajectory IDs are UUID-like (no SQL wildcards)
    const stmt = this.db.prepare(`
      SELECT id FROM patterns
      WHERE trajectory_ids LIKE '%"' || ? || '"%'
        AND deprecated = 0
    `);

    const rows = withRetrySync(
      () => stmt.all(trajectoryId) as Array<{ id: string }>,
      { operationName: 'PatternDAO.findPatternIdsByTrajectoryId' }
    );

    return rows.map(row => row.id);
  }

  /**
   * Add a trajectory ID to a pattern's trajectory_ids JSON array.
   * Reads the current array, appends the new ID if not already present,
   * and writes it back.
   *
   * Implements: FIX-TRAJ-PATTERN-001 (trajectory-pattern link gap)
   *
   * @param patternId - The pattern to link
   * @param trajectoryId - The trajectory to link to
   */
  addTrajectoryId(patternId: string, trajectoryId: string): void {
    // Read current trajectory_ids
    const row = this.selectByIdStmt!.get(patternId) as IPatternRow | undefined;
    if (!row) {
      return; // Pattern not found — nothing to link
    }

    const currentIds: string[] = JSON.parse(row.trajectory_ids);
    if (currentIds.includes(trajectoryId)) {
      return; // Already linked
    }

    currentIds.push(trajectoryId);
    const now = Date.now();

    const updateStmt = this.db.prepare(`
      UPDATE patterns
      SET trajectory_ids = ?, updated_at = ?, version = version + 1
      WHERE id = ?
    `);

    withRetrySync(
      () => updateStmt.run(JSON.stringify(currentIds), now, patternId),
      { operationName: 'PatternDAO.addTrajectoryId' }
    );
  }

  // ============================================================
  // FORBIDDEN OPERATIONS
  // ============================================================

  /**
   * Delete a pattern by ID
   *
   * RULE-019 VIOLATION: Patterns cannot be deleted. Use deprecate() instead.
   *
   * @param _id - The pattern ID (unused - operation forbidden)
   * @throws Error Always throws - DELETE is forbidden per RULE-019
   */
  delete(_id: string): never {
    throw new Error(
      'RULE-019 VIOLATION: Patterns cannot be deleted. ' +
      'Use deprecate(id) for soft-delete instead.'
    );
  }

  /**
   * Clear all patterns
   *
   * RULE-019 VIOLATION: Patterns cannot be deleted. This operation is FORBIDDEN.
   *
   * @throws Error Always throws - CLEAR is forbidden per RULE-019
   */
  clear(): never {
    throw new Error(
      'RULE-019 VIOLATION: Patterns cannot be deleted. ' +
      'CLEAR operation is FORBIDDEN.'
    );
  }

  // ============================================================
  // STATISTICS & OBSERVABILITY
  // ============================================================

  /**
   * Get storage and usage statistics for observability
   */
  getStats(): {
    totalCount: number;
    activeCount: number;
    deprecatedCount: number;
    totalSuccessCount: number;
    totalFailureCount: number;
    averageWeight: number;
    successRate: number;
  } {
    const statsResult = this.db.prepare(`
      SELECT
        COUNT(*) as count,
        SUM(CASE WHEN deprecated = 0 THEN 1 ELSE 0 END) as active_count,
        SUM(CASE WHEN deprecated = 1 THEN 1 ELSE 0 END) as deprecated_count,
        COALESCE(SUM(success_count), 0) as total_success,
        COALESCE(SUM(failure_count), 0) as total_failure,
        COALESCE(AVG(weight), 0.5) as avg_weight
      FROM patterns
    `).get() as IStatsRow;

    const totalCount = statsResult.count;
    const activeCount = statsResult.active_count;
    const deprecatedCount = statsResult.deprecated_count;
    const totalSuccessCount = statsResult.total_success;
    const totalFailureCount = statsResult.total_failure;
    const averageWeight = statsResult.avg_weight;

    const totalOutcomes = totalSuccessCount + totalFailureCount;
    const successRate = totalOutcomes > 0 ? totalSuccessCount / totalOutcomes : 0;

    return {
      totalCount,
      activeCount,
      deprecatedCount,
      totalSuccessCount,
      totalFailureCount,
      averageWeight,
      successRate
    };
  }

  // ============================================================
  // SERIALIZATION HELPERS
  // ============================================================

  /**
   * Serialize Float32Array to Buffer for SQLite BLOB storage
   * Format: [length:4bytes][data:length*4bytes]
   */
  private serializeEmbedding(embedding: Float32Array): Buffer {
    const length = embedding.length;
    const buffer = Buffer.alloc(4 + length * 4);

    // Write length header
    buffer.writeUInt32LE(length, 0);

    // Write each float
    for (let i = 0; i < length; i++) {
      buffer.writeFloatLE(embedding[i], 4 + i * 4);
    }

    return buffer;
  }

  /**
   * Deserialize Buffer from SQLite BLOB to Float32Array
   */
  private deserializeEmbedding(buffer: Buffer): Float32Array {
    const length = buffer.readUInt32LE(0);
    const embedding = new Float32Array(length);

    for (let i = 0; i < length; i++) {
      embedding[i] = buffer.readFloatLE(4 + i * 4);
    }

    return embedding;
  }

  /**
   * Convert a database row to an IPattern
   */
  private rowToPattern(row: IPatternRow): IPattern {
    return {
      id: row.id,
      name: row.name,
      context: row.context,
      action: row.action,
      outcome: row.outcome ?? undefined,
      embedding: this.deserializeEmbedding(row.embedding),
      weight: row.weight,
      trajectoryIds: JSON.parse(row.trajectory_ids) as string[],
      successCount: row.success_count,
      failureCount: row.failure_count,
      agentId: row.agent_id,
      taskType: row.task_type,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
      deprecated: row.deprecated === 1,
      tags: JSON.parse(row.tags) as string[]
    };
  }
}
