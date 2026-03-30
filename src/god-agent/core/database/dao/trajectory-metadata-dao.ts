/**
 * TrajectoryMetadataDAO - Data Access Object for Trajectory Metadata persistence
 *
 * Implements: GAP-DESC-005, GAP-DESC-007, SPEC-FUNC-LEARNING
 * Constitution: RULE-008 (SQLite for all learning data), RULE-016 (append-only),
 *               RULE-023 (indexes), RULE-072 (retry with exponential backoff)
 *
 * This DAO provides SQLite-backed persistence for trajectory metadata.
 * Binary trajectory data is stored in .agentdb/sona/trajectories/ files;
 * this table stores only metadata and file references.
 *
 * CRITICAL: RULE-016 - trajectory_metadata is APPEND-ONLY
 * - DELETE operations are FORBIDDEN
 * - UPDATE only allowed for: status, quality_score, completed_at, verdict, verdict_confidence, remediation_count, version
 */

import type { IDatabaseConnection } from '../connection.js';
import type Database from 'better-sqlite3';
import { withRetrySync } from '../../validation/index.js';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

/**
 * Valid status values for trajectory metadata
 */
export type TrajectoryStatus = 'active' | 'completed' | 'failed' | 'abandoned';

/**
 * Input interface for creating new trajectory metadata
 * Used when inserting new records
 */
export interface ITrajectoryMetadataInput {
  id: string;
  filePath: string;
  fileOffset: number;
  fileLength: number;
  route: string;
  stepCount: number;
  qualityScore?: number;
  createdAt: number;
  status?: TrajectoryStatus;
  // Sherlock verdict tracking
  verdict?: 'INNOCENT' | 'GUILTY' | 'INSUFFICIENT_EVIDENCE';
  verdictConfidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  remediationCount?: number;
}

/**
 * Full trajectory metadata interface including all fields
 * Returned from database queries
 */
export interface ITrajectoryMetadata extends ITrajectoryMetadataInput {
  completedAt?: number;
  version: number;
}

/**
 * Database row representation for trajectory_metadata
 * Matches the outcomes.sql schema (lines 98-127)
 */
interface ITrajectoryMetadataRow {
  id: string;
  file_path: string;
  file_offset: number;
  file_length: number;
  route: string;
  step_count: number;
  quality_score: number | null;
  verdict: string | null;
  verdict_confidence: string | null;
  remediation_count: number;
  created_at: number;
  completed_at: number | null;
  version: number;
  status: string;
}

/**
 * Count result from aggregate queries
 */
interface ICountResult {
  count: number;
}

/**
 * Statistics result from aggregate queries
 */
interface IStatsResult {
  total_count: number;
  active_count: number;
  completed_count: number;
  failed_count: number;
  abandoned_count: number;
  avg_quality: number | null;
  avg_step_count: number | null;
  total_file_bytes: number;
}

// ============================================================
// DAO IMPLEMENTATION
// ============================================================

/**
 * TrajectoryMetadataDAO - SQLite-backed trajectory metadata persistence
 *
 * Provides CRUD operations for trajectory metadata with proper enforcement
 * of RULE-016 (append-only) and RULE-072 (retry on failure).
 *
 * Key features:
 * - Insert new trajectory metadata (with retry)
 * - Update status (with retry) - ONLY status, quality_score, completed_at, verdict fields allowed
 * - Update quality score (with retry)
 * - Update verdict (with retry)
 * - Query by ID or status
 * - Aggregate statistics for observability
 * - DELETE/CLEAR operations throw errors (RULE-016)
 */
export class TrajectoryMetadataDAO {
  private insertStmt: Database.Statement<unknown[], unknown> | null = null;
  private updateStatusStmt: Database.Statement<unknown[], unknown> | null = null;
  private updateQualityStmt: Database.Statement<unknown[], unknown> | null = null;
  private selectByIdStmt: Database.Statement<unknown[], unknown> | null = null;
  private selectByStatusStmt: Database.Statement<unknown[], unknown> | null = null;
  private selectAllStmt: Database.Statement<unknown[], unknown> | null = null;
  private countStmt: Database.Statement<unknown[], unknown> | null = null;
  // RULE-016 COMPLIANCE: DELETE statements removed - trajectory_metadata is append-only

  constructor(private readonly db: IDatabaseConnection) {
    this.ensureSchema();
    this.prepareStatements();
  }

  /**
   * Ensure the trajectory_metadata table and indexes exist
   * Schema matches outcomes.sql lines 98-127
   */
  private ensureSchema(): void {
    this.db.db.exec(`
      CREATE TABLE IF NOT EXISTS trajectory_metadata (
        -- Identity
        id TEXT PRIMARY KEY NOT NULL,

        -- File reference for binary data
        file_path TEXT NOT NULL,
        file_offset INTEGER NOT NULL,
        file_length INTEGER NOT NULL,

        -- Metadata
        route TEXT NOT NULL,
        step_count INTEGER NOT NULL,
        quality_score REAL
            CHECK (quality_score IS NULL OR (quality_score >= 0.0 AND quality_score <= 1.0)),

        -- Sherlock verdict tracking
        verdict TEXT CHECK (verdict IS NULL OR verdict IN ('INNOCENT', 'GUILTY', 'INSUFFICIENT_EVIDENCE')),
        verdict_confidence TEXT CHECK (verdict_confidence IS NULL OR verdict_confidence IN ('HIGH', 'MEDIUM', 'LOW')),
        remediation_count INTEGER DEFAULT 0,

        -- Timestamps (RULE-020)
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        version INTEGER NOT NULL DEFAULT 1,

        -- Status
        status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'completed', 'failed', 'abandoned'))
      );

      -- Indexes (RULE-023)
      CREATE INDEX IF NOT EXISTS idx_trajectory_status ON trajectory_metadata(status);
      CREATE INDEX IF NOT EXISTS idx_trajectory_route ON trajectory_metadata(route);
      CREATE INDEX IF NOT EXISTS idx_trajectory_created ON trajectory_metadata(created_at DESC);

      -- RULE-016, RULE-017: Append-only triggers
      -- Only status, quality_score, completed_at, verdict, verdict_confidence, remediation_count, version updates allowed

      -- Drop existing triggers if they exist (for idempotent schema creation)
      DROP TRIGGER IF EXISTS trajectory_metadata_no_delete;
      DROP TRIGGER IF EXISTS trajectory_metadata_limited_update;
    `);

    // Migration: add verdict columns if table already exists without them
    try { this.db.db.exec(`ALTER TABLE trajectory_metadata ADD COLUMN verdict TEXT`); } catch { /* already exists */ }
    try { this.db.db.exec(`ALTER TABLE trajectory_metadata ADD COLUMN verdict_confidence TEXT`); } catch { /* already exists */ }
    try { this.db.db.exec(`ALTER TABLE trajectory_metadata ADD COLUMN remediation_count INTEGER DEFAULT 0`); } catch { /* already exists */ }

    // Verdict index created AFTER migration to avoid "no such column" on pre-existing tables
    try { this.db.db.exec(`CREATE INDEX IF NOT EXISTS idx_trajectory_verdict ON trajectory_metadata(verdict)`); } catch { /* already exists */ }

    // Create triggers separately to avoid issues with conditional creation
    try {
      this.db.db.exec(`
        CREATE TRIGGER trajectory_metadata_no_delete
        BEFORE DELETE ON trajectory_metadata
        BEGIN
            SELECT RAISE(ABORT, 'Trajectory metadata is append-only (RULE-016). DELETE forbidden.');
        END;
      `);
    } catch {
      // INTENTIONAL: Trigger may already exist from previous schema initialization
    }

    try {
      this.db.db.exec(`
        CREATE TRIGGER trajectory_metadata_limited_update
        BEFORE UPDATE ON trajectory_metadata
        WHEN OLD.id != NEW.id
           OR OLD.file_path != NEW.file_path
           OR OLD.file_offset != NEW.file_offset
           OR OLD.file_length != NEW.file_length
           OR OLD.route != NEW.route
           OR OLD.step_count != NEW.step_count
           OR OLD.created_at != NEW.created_at
        BEGIN
            SELECT RAISE(ABORT, 'Trajectory metadata: only status, quality_score, completed_at, verdict, verdict_confidence, remediation_count updates allowed (RULE-016).');
        END;
      `);
    } catch {
      // INTENTIONAL: Trigger may already exist from previous schema initialization
    }
  }

  /**
   * Prepare SQL statements for performance
   */
  private prepareStatements(): void {
    this.insertStmt = this.db.prepare(`
      INSERT INTO trajectory_metadata (
        id, file_path, file_offset, file_length, route, step_count,
        quality_score, verdict, verdict_confidence, remediation_count,
        created_at, completed_at, version, status
      ) VALUES (
        @id, @filePath, @fileOffset, @fileLength, @route, @stepCount,
        @qualityScore, @verdict, @verdictConfidence, @remediationCount,
        @createdAt, @completedAt, @version, @status
      )
    `);

    this.updateStatusStmt = this.db.prepare(`
      UPDATE trajectory_metadata
      SET status = @status, completed_at = @completedAt, version = version + 1
      WHERE id = @id
    `);

    this.updateQualityStmt = this.db.prepare(`
      UPDATE trajectory_metadata
      SET quality_score = @qualityScore, version = version + 1
      WHERE id = @id
    `);

    this.selectByIdStmt = this.db.prepare(`
      SELECT * FROM trajectory_metadata WHERE id = ?
    `);

    this.selectByStatusStmt = this.db.prepare(`
      SELECT * FROM trajectory_metadata WHERE status = ? ORDER BY created_at DESC
    `);

    this.selectAllStmt = this.db.prepare(`
      SELECT * FROM trajectory_metadata ORDER BY created_at DESC
    `);

    this.countStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM trajectory_metadata
    `);

    // RULE-016 COMPLIANCE: No DELETE statements prepared
    // Trajectory metadata is append-only per Constitution RULE-016
  }

  /**
   * Insert a new trajectory metadata record
   *
   * Implements: RULE-072 (database retry on failure)
   * Uses exponential backoff: 100ms, 200ms, 400ms
   *
   * @param metadata - The trajectory metadata to insert
   * @throws Error if insert fails after all retry attempts
   */
  insert(metadata: ITrajectoryMetadataInput): void {
    const params = {
      id: metadata.id,
      filePath: metadata.filePath,
      fileOffset: metadata.fileOffset,
      fileLength: metadata.fileLength,
      route: metadata.route,
      stepCount: metadata.stepCount,
      qualityScore: metadata.qualityScore ?? null,
      verdict: metadata.verdict ?? null,
      verdictConfidence: metadata.verdictConfidence ?? null,
      remediationCount: metadata.remediationCount ?? 0,
      createdAt: metadata.createdAt,
      completedAt: null,
      version: 1,
      status: metadata.status ?? 'active'
    };

    // RULE-072: Database operations MUST retry on failure (max 3 attempts)
    withRetrySync(
      () => this.insertStmt!.run(params),
      { operationName: 'TrajectoryMetadataDAO.insert' }
    );
  }

  /**
   * Update the status of a trajectory
   *
   * RULE-016 COMPLIANCE: Only status, completed_at, and version can be updated.
   * Other fields are immutable after creation.
   *
   * @param id - The trajectory ID
   * @param status - New status value
   * @param completedAt - Optional completion timestamp (epoch ms)
   * @throws Error if update fails after all retry attempts
   */
  updateStatus(id: string, status: TrajectoryStatus, completedAt?: number): void {
    const params = {
      id,
      status,
      completedAt: completedAt ?? null
    };

    // RULE-072: Database operations MUST retry on failure (max 3 attempts)
    withRetrySync(
      () => this.updateStatusStmt!.run(params),
      { operationName: 'TrajectoryMetadataDAO.updateStatus' }
    );
  }

  /**
   * Update the quality score of a trajectory
   *
   * RULE-016 COMPLIANCE: Only quality_score and version can be updated.
   * Other fields are immutable after creation.
   *
   * @param id - The trajectory ID
   * @param qualityScore - Quality score between 0.0 and 1.0
   * @throws Error if qualityScore is out of range or update fails
   */
  updateQuality(id: string, qualityScore: number): void {
    // Validate quality score bounds per schema CHECK constraint
    if (qualityScore < 0.0 || qualityScore > 1.0) {
      throw new Error(
        `Invalid quality score: ${qualityScore}. Must be between 0.0 and 1.0.`
      );
    }

    const params = {
      id,
      qualityScore
    };

    // RULE-072: Database operations MUST retry on failure (max 3 attempts)
    withRetrySync(
      () => this.updateQualityStmt!.run(params),
      { operationName: 'TrajectoryMetadataDAO.updateQuality' }
    );
  }

  /**
   * Update the verdict of a trajectory.
   * RULE-016 COMPLIANCE: Only verdict, verdict_confidence, remediation_count, version can be updated.
   *
   * @param id - The trajectory ID
   * @param verdict - Sherlock verdict value
   * @param confidence - Confidence level of the verdict
   * @param remediationCount - Number of remediation attempts
   */
  updateVerdict(
    id: string,
    verdict: 'INNOCENT' | 'GUILTY' | 'INSUFFICIENT_EVIDENCE',
    confidence: 'HIGH' | 'MEDIUM' | 'LOW',
    remediationCount: number
  ): void {
    const stmt = this.db.prepare(`
      UPDATE trajectory_metadata
      SET verdict = @verdict, verdict_confidence = @confidence,
          remediation_count = @remediationCount, version = version + 1
      WHERE id = @id
    `);

    withRetrySync(
      () => stmt.run({ id, verdict, confidence, remediationCount }),
      { operationName: 'TrajectoryMetadataDAO.updateVerdict' }
    );
  }

  /**
   * Find trajectory metadata by ID
   *
   * @param id - The trajectory ID to find
   * @returns The trajectory metadata or null if not found
   */
  findById(id: string): ITrajectoryMetadata | null {
    const row = this.selectByIdStmt!.get(id) as ITrajectoryMetadataRow | undefined;
    if (!row) return null;
    return this.rowToMetadata(row);
  }

  /**
   * Find all trajectory metadata with a specific status
   *
   * @param status - Status to filter by
   * @returns Array of matching trajectory metadata (newest first)
   */
  findByStatus(status: TrajectoryStatus): ITrajectoryMetadata[] {
    const rows = this.selectByStatusStmt!.all(status) as ITrajectoryMetadataRow[];
    return rows.map(row => this.rowToMetadata(row));
  }

  /**
   * Get all trajectory metadata
   *
   * @returns Array of all trajectory metadata (newest first)
   */
  findAll(): ITrajectoryMetadata[] {
    const rows = this.selectAllStmt!.all() as ITrajectoryMetadataRow[];
    return rows.map(row => this.rowToMetadata(row));
  }

  /**
   * Get the count of trajectory metadata records
   *
   * @returns The number of records in storage
   */
  count(): number {
    const result = this.countStmt!.get() as ICountResult;
    return result.count;
  }

  /**
   * Check if trajectory metadata exists
   *
   * @param id - The trajectory ID to check
   * @returns True if the metadata exists
   */
  exists(id: string): boolean {
    return this.findById(id) !== null;
  }

  /**
   * Delete trajectory metadata by ID
   *
   * RULE-016 VIOLATION: Trajectory metadata is append-only. DELETE operations are FORBIDDEN.
   * Exception: Compaction with explicit human approval (not implemented here).
   *
   * @param _id - The trajectory ID (unused - operation forbidden)
   * @throws Error Always throws - DELETE is forbidden per RULE-016
   */
  delete(_id: string): never {
    throw new Error(
      'RULE-016 VIOLATION: Trajectory metadata is append-only. DELETE operations are FORBIDDEN. ' +
      'Exception: Compaction with explicit human approval requires separate implementation.'
    );
  }

  /**
   * Clear all trajectory metadata
   *
   * RULE-016 VIOLATION: Trajectory metadata is append-only. DELETE/CLEAR operations are FORBIDDEN.
   * Exception: Compaction with explicit human approval (not implemented here).
   *
   * @throws Error Always throws - CLEAR is forbidden per RULE-016
   */
  clear(): never {
    throw new Error(
      'RULE-016 VIOLATION: Trajectory metadata is append-only. CLEAR operations are FORBIDDEN. ' +
      'Exception: Compaction with explicit human approval requires separate implementation.'
    );
  }

  /**
   * Convert a database row to ITrajectoryMetadata
   */
  private rowToMetadata(row: ITrajectoryMetadataRow): ITrajectoryMetadata {
    return {
      id: row.id,
      filePath: row.file_path,
      fileOffset: row.file_offset,
      fileLength: row.file_length,
      route: row.route,
      stepCount: row.step_count,
      qualityScore: row.quality_score ?? undefined,
      verdict: (row.verdict as 'INNOCENT' | 'GUILTY' | 'INSUFFICIENT_EVIDENCE') ?? undefined,
      verdictConfidence: (row.verdict_confidence as 'HIGH' | 'MEDIUM' | 'LOW') ?? undefined,
      remediationCount: row.remediation_count ?? 0,
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
      version: row.version,
      status: row.status as TrajectoryStatus
    };
  }

  /**
   * Find past GUILTY verdicts for a specific agent key pattern.
   * Used for Sherlock verdict injection into future agent prompts.
   *
   * @param agentKeyPattern - Route pattern to match (uses SQL LIKE with wildcards)
   * @param limit - Maximum number of results to return (default 10)
   * @returns Array of matching trajectory metadata with GUILTY verdicts (newest first)
   */
  findGuiltyByAgent(agentKeyPattern: string, limit: number = 10): ITrajectoryMetadata[] {
    const stmt = this.db.prepare(`
      SELECT * FROM trajectory_metadata
      WHERE verdict = 'GUILTY' AND route LIKE @pattern
      ORDER BY created_at DESC
      LIMIT @limit
    `);
    const rows = stmt.all({ pattern: `%${agentKeyPattern}%`, limit }) as ITrajectoryMetadataRow[];
    return rows.map(row => this.rowToMetadata(row));
  }

  /**
   * Find past GUILTY verdicts for a specific pipeline phase.
   * Sherlock trajectories use routes like `coding/forensics/phase-N/verdict`,
   * so we match by phase number rather than agent key.
   *
   * @param phase - Pipeline phase number (1-6)
   * @param limit - Maximum number of results to return (default 10)
   * @returns Array of matching trajectory metadata with GUILTY verdicts (newest first)
   */
  findGuiltyByPhase(phase: number, limit: number = 10): ITrajectoryMetadata[] {
    const stmt = this.db.prepare(`
      SELECT * FROM trajectory_metadata
      WHERE verdict = 'GUILTY' AND route LIKE @pattern
      ORDER BY created_at DESC
      LIMIT @limit
    `);
    const rows = stmt.all({ pattern: `%/phase-${phase}/%`, limit }) as ITrajectoryMetadataRow[];
    return rows.map(row => this.rowToMetadata(row));
  }

  /**
   * Get storage and trajectory statistics for observability
   *
   * @returns Aggregate statistics about stored trajectories
   */
  getStats(): {
    totalCount: number;
    activeCount: number;
    completedCount: number;
    failedCount: number;
    abandonedCount: number;
    avgQualityScore: number | null;
    avgStepCount: number | null;
    totalFileBytes: number;
  } {
    const result = this.db.prepare(`
      SELECT
        COUNT(*) as total_count,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
        SUM(CASE WHEN status = 'abandoned' THEN 1 ELSE 0 END) as abandoned_count,
        AVG(quality_score) as avg_quality,
        AVG(step_count) as avg_step_count,
        COALESCE(SUM(file_length), 0) as total_file_bytes
      FROM trajectory_metadata
    `).get() as IStatsResult;

    return {
      totalCount: result.total_count,
      activeCount: result.active_count,
      completedCount: result.completed_count,
      failedCount: result.failed_count,
      abandonedCount: result.abandoned_count,
      avgQualityScore: result.avg_quality,
      avgStepCount: result.avg_step_count,
      totalFileBytes: result.total_file_bytes
    };
  }

  /**
   * Find trajectories by route pattern
   *
   * @param routePattern - Route string to match (exact match)
   * @returns Array of matching trajectory metadata
   */
  findByRoute(routePattern: string): ITrajectoryMetadata[] {
    const stmt = this.db.prepare(`
      SELECT * FROM trajectory_metadata
      WHERE route = ?
      ORDER BY created_at DESC
    `);
    const rows = stmt.all(routePattern) as ITrajectoryMetadataRow[];
    return rows.map(row => this.rowToMetadata(row));
  }

  /**
   * Find trajectories within a time range
   *
   * @param startTime - Start timestamp (epoch ms, inclusive)
   * @param endTime - End timestamp (epoch ms, inclusive)
   * @returns Array of matching trajectory metadata
   */
  findByTimeRange(startTime: number, endTime: number): ITrajectoryMetadata[] {
    const stmt = this.db.prepare(`
      SELECT * FROM trajectory_metadata
      WHERE created_at >= ? AND created_at <= ?
      ORDER BY created_at DESC
    `);
    const rows = stmt.all(startTime, endTime) as ITrajectoryMetadataRow[];
    return rows.map(row => this.rowToMetadata(row));
  }

  /**
   * Find trajectories with quality score above threshold
   *
   * @param minQuality - Minimum quality score (0.0 to 1.0)
   * @returns Array of matching trajectory metadata
   */
  findByMinQuality(minQuality: number): ITrajectoryMetadata[] {
    if (minQuality < 0.0 || minQuality > 1.0) {
      throw new Error(
        `Invalid minQuality: ${minQuality}. Must be between 0.0 and 1.0.`
      );
    }

    const stmt = this.db.prepare(`
      SELECT * FROM trajectory_metadata
      WHERE quality_score IS NOT NULL AND quality_score >= ?
      ORDER BY quality_score DESC, created_at DESC
    `);
    const rows = stmt.all(minQuality) as ITrajectoryMetadataRow[];
    return rows.map(row => this.rowToMetadata(row));
  }
}
