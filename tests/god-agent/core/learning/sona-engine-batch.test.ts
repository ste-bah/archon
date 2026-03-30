/**
 * Sona Engine Batch Operations Unit Tests
 * TASK-SON-BATCH - Tests for syncQualityFromEvents and convertHighQualityTrajectoriesToPatterns
 *
 * Tests cover:
 * - syncQualityFromEvents(): Syncing quality scores from events to trajectory_metadata
 * - convertHighQualityTrajectoriesToPatterns(): Converting high-quality trajectories to patterns
 * - Error handling and edge cases
 * - Dry-run mode validation
 */

import { describe, it, expect, beforeEach, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { SonaEngine } from '../../../../src/god-agent/core/learning/sona-engine.js';
import Database from 'better-sqlite3';
import type { IDatabaseConnection } from '../../../../src/god-agent/core/database/connection.js';
import { rmSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// ==================== Test Database Setup ====================

const TEST_DB_DIR = join(process.cwd(), '.test-db-sona-batch');
let testDbPath: string;
let testDbConnection: IDatabaseConnection;

/**
 * Creates a real SQLite database connection for testing that fully implements IDatabaseConnection
 */
function createTestDatabaseConnection(dbPath: string): IDatabaseConnection {
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  return {
    db,
    prepare: <BindParams extends unknown[] | {} = unknown[], Result = unknown>(sql: string) => {
      return db.prepare<BindParams, Result>(sql);
    },
    transaction: <T>(fn: () => T): T => {
      return db.transaction(fn)();
    },
    close: () => db.close(),
    isHealthy: () => {
      try {
        db.prepare('SELECT 1').get();
        return true;
      } catch {
        return false;
      }
    },
    checkpoint: () => {
      db.pragma('wal_checkpoint(TRUNCATE)');
    }
  };
}

/**
 * Sets up the required database tables for testing
 * Replicates essential schema from patterns.sql and outcomes.sql
 */
function setupTestTables(db: Database.Database): void {
  // Create patterns table (from patterns.sql)
  db.exec(`
    CREATE TABLE IF NOT EXISTS patterns (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      context TEXT NOT NULL,
      action TEXT NOT NULL,
      outcome TEXT,
      embedding BLOB NOT NULL,
      weight REAL NOT NULL DEFAULT 0.5
          CHECK (weight >= 0.0 AND weight <= 1.0),
      success_count INTEGER NOT NULL DEFAULT 0
          CHECK (success_count >= 0),
      failure_count INTEGER NOT NULL DEFAULT 0
          CHECK (failure_count >= 0),
      trajectory_ids TEXT NOT NULL DEFAULT '[]',
      agent_id TEXT NOT NULL,
      task_type TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      deprecated INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_patterns_task_type ON patterns(task_type);
    CREATE INDEX IF NOT EXISTS idx_patterns_agent ON patterns(agent_id);
    CREATE INDEX IF NOT EXISTS idx_patterns_weight ON patterns(weight DESC);
    CREATE INDEX IF NOT EXISTS idx_patterns_deprecated ON patterns(deprecated);
    CREATE INDEX IF NOT EXISTS idx_patterns_updated ON patterns(updated_at DESC);
  `);

  // Create learning_feedback table (from outcomes.sql)
  // MUST include RLM columns to match production schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS learning_feedback (
      id TEXT PRIMARY KEY NOT NULL,
      trajectory_id TEXT NOT NULL,
      episode_id TEXT,
      pattern_id TEXT,
      quality REAL NOT NULL
          CHECK (quality >= 0.0 AND quality <= 1.0),
      outcome TEXT NOT NULL
          CHECK (outcome IN ('positive', 'negative', 'neutral')),
      task_type TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      result_length INTEGER,
      has_code_blocks INTEGER NOT NULL DEFAULT 0,
      rlm_injection_success INTEGER,
      rlm_source_agent TEXT,
      rlm_source_step_index INTEGER,
      rlm_source_domain TEXT,
      created_at INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      processed INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_trajectory ON learning_feedback(trajectory_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_quality ON learning_feedback(quality DESC);
    CREATE INDEX IF NOT EXISTS idx_feedback_processed ON learning_feedback(processed);
    CREATE INDEX IF NOT EXISTS idx_feedback_created ON learning_feedback(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_feedback_rlm_success
      ON learning_feedback(rlm_injection_success, quality DESC);
  `);

  // trajectory_metadata table is created by TrajectoryMetadataDAO
}

/**
 * Inserts test feedback records with all required fields
 */
function insertFeedbackRecord(
  db: Database.Database,
  id: string,
  trajectoryId: string,
  quality: number,
  createdAt: number = Date.now()
): void {
  const outcome = quality >= 0.7 ? 'positive' : quality >= 0.3 ? 'neutral' : 'negative';
  db.prepare(`
    INSERT INTO learning_feedback (id, trajectory_id, quality, outcome, task_type, agent_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, trajectoryId, quality, outcome, 'test-task', 'test-agent', createdAt);
}

/**
 * Inserts test trajectory metadata records
 */
function insertTrajectoryMetadata(
  db: Database.Database,
  id: string,
  route: string,
  qualityScore: number | null,
  status: string = 'completed'
): void {
  db.prepare(`
    INSERT OR REPLACE INTO trajectory_metadata (id, file_path, file_offset, file_length, route, step_count, quality_score, created_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, '/test/path', 0, 100, route, 5, qualityScore, Date.now(), status);
}

// ==================== Test Setup and Teardown ====================

beforeAll(() => {
  // Create test database directory
  if (!existsSync(TEST_DB_DIR)) {
    mkdirSync(TEST_DB_DIR, { recursive: true });
  }
});

afterAll(() => {
  // Clean up test database directory
  try {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

// ==================== syncQualityFromEvents Tests ====================

describe('SonaEngine.syncQualityFromEvents', () => {
  let engine: SonaEngine;

  beforeEach(() => {
    // Reset console methods
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Create fresh database for each test
    testDbPath = join(TEST_DB_DIR, `test-sync-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    testDbConnection = createTestDatabaseConnection(testDbPath);
    setupTestTables(testDbConnection.db);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      testDbConnection?.close();
    } catch {
      // Ignore close errors
    }
  });

  describe('when persistence is disabled', () => {
    beforeEach(() => {
      engine = new SonaEngine();
    });

    it('should return error when persistence is not enabled', async () => {
      const result = await engine.syncQualityFromEvents();

      expect(result.synced).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Database persistence not enabled');
    });
  });

  describe('when persistence is enabled', () => {
    beforeEach(() => {
      engine = new SonaEngine({ databaseConnection: testDbConnection });
    });

    it('should successfully sync quality from events to trajectory_metadata', async () => {
      // Setup: Create trajectory metadata and feedback records
      const trajId1 = 'traj-sync-00000001';
      const trajId2 = 'traj-sync-00000002';

      insertTrajectoryMetadata(testDbConnection.db, trajId1, 'reasoning.causal', 0.5);
      insertTrajectoryMetadata(testDbConnection.db, trajId2, 'coding.debug', null);
      insertFeedbackRecord(testDbConnection.db, 'fb-1', trajId1, 0.85);
      insertFeedbackRecord(testDbConnection.db, 'fb-2', trajId2, 0.92);

      const result = await engine.syncQualityFromEvents();

      expect(result.synced).toBe(2);
      expect(result.errors).toHaveLength(0);

      // Verify quality was updated in trajectory_metadata
      const row1 = testDbConnection.db.prepare(
        'SELECT quality_score FROM trajectory_metadata WHERE id = ?'
      ).get(trajId1) as { quality_score: number };
      const row2 = testDbConnection.db.prepare(
        'SELECT quality_score FROM trajectory_metadata WHERE id = ?'
      ).get(trajId2) as { quality_score: number };

      expect(row1.quality_score).toBeCloseTo(0.85);
      expect(row2.quality_score).toBeCloseTo(0.92);
    });

    it('should return correct count of synced trajectories', async () => {
      // Setup: Create 3 trajectory-feedback pairs
      for (let i = 1; i <= 3; i++) {
        const trajId = `traj-count-${String(i).padStart(8, '0')}`;
        insertTrajectoryMetadata(testDbConnection.db, trajId, 'test.route', 0.5);
        insertFeedbackRecord(testDbConnection.db, `fb-${i}`, trajId, 0.7 + i * 0.05);
      }

      const result = await engine.syncQualityFromEvents();

      expect(result.synced).toBe(3);
    });

    it('should handle empty events table gracefully', async () => {
      // No feedback records inserted
      const result = await engine.syncQualityFromEvents();

      expect(result.synced).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should skip trajectories not found in metadata', async () => {
      const existingTrajId = 'traj-exists-11110000';
      const missingTrajId = 'traj-missing-22220000';

      // Only create metadata for one trajectory
      insertTrajectoryMetadata(testDbConnection.db, existingTrajId, 'test.route', 0.5);

      // Create feedback for both
      insertFeedbackRecord(testDbConnection.db, 'fb-1', existingTrajId, 0.9);
      insertFeedbackRecord(testDbConnection.db, 'fb-2', missingTrajId, 0.8);

      const result = await engine.syncQualityFromEvents();

      expect(result.synced).toBe(1); // Only one synced
      expect(result.errors).toHaveLength(0); // Missing trajectories are skipped, not errors
    });

    it('should skip trajectories where quality already matches', async () => {
      const trajId = 'traj-match-33330000';
      const qualityValue = 0.85;

      // Create metadata with same quality as feedback
      insertTrajectoryMetadata(testDbConnection.db, trajId, 'test.route', qualityValue);
      insertFeedbackRecord(testDbConnection.db, 'fb-1', trajId, qualityValue);

      const result = await engine.syncQualityFromEvents();

      expect(result.synced).toBe(0); // Skipped because quality matches
    });

    it('should use most recent feedback when multiple exist for same trajectory', async () => {
      const trajId = 'traj-multi-44440000';

      insertTrajectoryMetadata(testDbConnection.db, trajId, 'test.route', 0.5);

      // Insert older feedback first, then newer
      insertFeedbackRecord(testDbConnection.db, 'fb-old', trajId, 0.6, Date.now() - 1000);
      insertFeedbackRecord(testDbConnection.db, 'fb-new', trajId, 0.95, Date.now());

      const result = await engine.syncQualityFromEvents();

      expect(result.synced).toBe(1);

      // Verify the most recent quality was used
      const row = testDbConnection.db.prepare(
        'SELECT quality_score FROM trajectory_metadata WHERE id = ?'
      ).get(trajId) as { quality_score: number };

      expect(row.quality_score).toBeCloseTo(0.95);
    });

    it('should handle trajectories with null quality (new trajectories)', async () => {
      const trajId = 'traj-null-55550000';

      insertTrajectoryMetadata(testDbConnection.db, trajId, 'test.route', null);
      insertFeedbackRecord(testDbConnection.db, 'fb-1', trajId, 0.88);

      const result = await engine.syncQualityFromEvents();

      expect(result.synced).toBe(1);

      const row = testDbConnection.db.prepare(
        'SELECT quality_score FROM trajectory_metadata WHERE id = ?'
      ).get(trajId) as { quality_score: number };

      expect(row.quality_score).toBeCloseTo(0.88);
    });
  });
});

// ==================== convertHighQualityTrajectoriesToPatterns Tests ====================

describe('SonaEngine.convertHighQualityTrajectoriesToPatterns', () => {
  let engine: SonaEngine;

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Create fresh database for each test
    testDbPath = join(TEST_DB_DIR, `test-convert-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    testDbConnection = createTestDatabaseConnection(testDbPath);
    setupTestTables(testDbConnection.db);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      testDbConnection?.close();
    } catch {
      // Ignore close errors
    }
  });

  describe('when persistence is disabled', () => {
    beforeEach(() => {
      engine = new SonaEngine();
    });

    it('should return error when persistence is not enabled', async () => {
      const result = await engine.convertHighQualityTrajectoriesToPatterns();

      expect(result.totalTrajectories).toBe(0);
      expect(result.eligibleTrajectories).toBe(0);
      expect(result.patternsCreated).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Database persistence not enabled');
    });
  });

  describe('when persistence is enabled', () => {
    beforeEach(async () => {
      engine = new SonaEngine({ databaseConnection: testDbConnection });
      await engine.initialize();
    });

    it('should report eligible trajectories with quality >= 0.8', async () => {
      // Create trajectories with various quality scores
      insertTrajectoryMetadata(testDbConnection.db, 'traj-hq-00000001', 'reasoning.causal', 0.85);
      insertTrajectoryMetadata(testDbConnection.db, 'traj-hq-00000002', 'coding.optimize', 0.92);
      insertTrajectoryMetadata(testDbConnection.db, 'traj-lq-00000003', 'test.route', 0.65); // Below threshold

      const result = await engine.convertHighQualityTrajectoriesToPatterns();

      expect(result.totalTrajectories).toBe(3);
      expect(result.eligibleTrajectories).toBe(2); // Only 2 with quality >= 0.8
    });

    it('should respect custom qualityThreshold option', async () => {
      insertTrajectoryMetadata(testDbConnection.db, 'traj-th-00000001', 'test.route', 0.85);
      insertTrajectoryMetadata(testDbConnection.db, 'traj-th-00000002', 'test.route', 0.92);
      insertTrajectoryMetadata(testDbConnection.db, 'traj-th-00000003', 'test.route', 0.75);

      const result = await engine.convertHighQualityTrajectoriesToPatterns({ qualityThreshold: 0.9 });

      expect(result.eligibleTrajectories).toBe(1); // Only 0.92 meets 0.9 threshold
    });

    it('should return counts without creating patterns in dryRun mode', async () => {
      insertTrajectoryMetadata(testDbConnection.db, 'traj-dry-00000001', 'test.route', 0.85);
      insertTrajectoryMetadata(testDbConnection.db, 'traj-dry-00000002', 'test.route', 0.9);

      const result = await engine.convertHighQualityTrajectoriesToPatterns({ dryRun: true });

      expect(result.totalTrajectories).toBe(2);
      expect(result.eligibleTrajectories).toBe(2);
      expect(result.patternsCreated).toBe(0); // No patterns created in dry run
      expect(result.errors).toHaveLength(0);

      // Verify no patterns were created in database
      const patternCount = testDbConnection.db.prepare(
        'SELECT COUNT(*) as count FROM patterns'
      ).get() as { count: number };

      expect(patternCount.count).toBe(0);
    });

    it('should return correct statistics including total and eligible', async () => {
      // Create mix of high and low quality trajectories
      for (let i = 1; i <= 5; i++) {
        const quality = i <= 3 ? 0.85 : 0.6; // 3 high quality, 2 low quality
        insertTrajectoryMetadata(
          testDbConnection.db,
          `traj-stats-${String(i).padStart(8, '0')}`,
          'test.route',
          quality
        );
      }

      const result = await engine.convertHighQualityTrajectoriesToPatterns({ dryRun: true });

      expect(result.totalTrajectories).toBe(5);
      expect(result.eligibleTrajectories).toBe(3);
      expect(typeof result.patternsCreated).toBe('number');
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('should handle no eligible trajectories gracefully', async () => {
      // All trajectories below threshold
      insertTrajectoryMetadata(testDbConnection.db, 'traj-low-00000001', 'test.route', 0.5);
      insertTrajectoryMetadata(testDbConnection.db, 'traj-low-00000002', 'test.route', 0.6);

      const result = await engine.convertHighQualityTrajectoriesToPatterns();

      expect(result.totalTrajectories).toBe(2);
      expect(result.eligibleTrajectories).toBe(0);
      expect(result.patternsCreated).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle empty database gracefully', async () => {
      const result = await engine.convertHighQualityTrajectoriesToPatterns();

      expect(result.totalTrajectories).toBe(0);
      expect(result.eligibleTrajectories).toBe(0);
      expect(result.patternsCreated).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should combine multiple options correctly', async () => {
      // Create 5 high-quality trajectories
      for (let i = 1; i <= 5; i++) {
        insertTrajectoryMetadata(
          testDbConnection.db,
          `traj-combo-${String(i).padStart(8, '0')}`,
          'test.route',
          0.95
        );
      }

      const result = await engine.convertHighQualityTrajectoriesToPatterns({
        qualityThreshold: 0.9,
        dryRun: true,
        maxConversions: 2,
      });

      expect(result.eligibleTrajectories).toBe(5);
      expect(result.patternsCreated).toBe(0); // Dry run
    });

    it('should handle trajectories with null quality score', async () => {
      // Trajectory without quality score should be excluded
      insertTrajectoryMetadata(testDbConnection.db, 'traj-null-00000001', 'test.route', null);
      insertTrajectoryMetadata(testDbConnection.db, 'traj-good-00000002', 'test.route', 0.9);

      const result = await engine.convertHighQualityTrajectoriesToPatterns({ dryRun: true });

      expect(result.eligibleTrajectories).toBe(1); // Only non-null quality counts
    });

    it('should filter by quality threshold correctly at boundary', async () => {
      // Test boundary condition at exactly 0.8
      insertTrajectoryMetadata(testDbConnection.db, 'traj-edge-00000001', 'test.route', 0.8);
      insertTrajectoryMetadata(testDbConnection.db, 'traj-edge-00000002', 'test.route', 0.79);
      insertTrajectoryMetadata(testDbConnection.db, 'traj-edge-00000003', 'test.route', 0.81);

      const result = await engine.convertHighQualityTrajectoriesToPatterns({ dryRun: true });

      // 0.8 should be included (>=), 0.79 excluded, 0.81 included
      expect(result.eligibleTrajectories).toBe(2);
    });
  });
});

// ==================== Integration Tests ====================

describe('SonaEngine Batch Operations Integration', () => {
  let engine: SonaEngine;

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    testDbPath = join(TEST_DB_DIR, `test-integration-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    testDbConnection = createTestDatabaseConnection(testDbPath);
    setupTestTables(testDbConnection.db);
    engine = new SonaEngine({ databaseConnection: testDbConnection });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      testDbConnection?.close();
    } catch {
      // Ignore close errors
    }
  });

  it('should handle workflow: sync quality then check conversion eligibility', async () => {
    // Step 1: Create trajectories with no quality
    const trajIds = ['traj-wf-00000001', 'traj-wf-00000002', 'traj-wf-00000003'];
    for (const trajId of trajIds) {
      insertTrajectoryMetadata(testDbConnection.db, trajId, 'workflow.test', null);
    }

    // Step 2: Add feedback with various quality scores
    insertFeedbackRecord(testDbConnection.db, 'fb-1', trajIds[0], 0.95); // High quality
    insertFeedbackRecord(testDbConnection.db, 'fb-2', trajIds[1], 0.85); // High quality
    insertFeedbackRecord(testDbConnection.db, 'fb-3', trajIds[2], 0.6);  // Low quality

    // Step 3: Sync quality from events
    const syncResult = await engine.syncQualityFromEvents();
    expect(syncResult.synced).toBe(3);

    // Step 4: Initialize and check conversion eligibility
    await engine.initialize();
    const convertResult = await engine.convertHighQualityTrajectoriesToPatterns({ dryRun: true });

    expect(convertResult.totalTrajectories).toBe(3);
    expect(convertResult.eligibleTrajectories).toBe(2); // Only 2 with quality >= 0.8
  });

  it('should maintain data consistency across operations', async () => {
    const trajId = 'traj-consist-00000001';

    // Create trajectory and feedback
    insertTrajectoryMetadata(testDbConnection.db, trajId, 'test.route', 0.5);
    insertFeedbackRecord(testDbConnection.db, 'fb-1', trajId, 0.88);

    // Sync should update quality
    const syncResult = await engine.syncQualityFromEvents();
    expect(syncResult.synced).toBe(1);

    // Verify quality was updated
    const row = testDbConnection.db.prepare(
      'SELECT quality_score FROM trajectory_metadata WHERE id = ?'
    ).get(trajId) as { quality_score: number };
    expect(row.quality_score).toBeCloseTo(0.88);

    // Now it should be eligible for pattern conversion
    await engine.initialize();
    const convertResult = await engine.convertHighQualityTrajectoriesToPatterns({ dryRun: true });
    expect(convertResult.eligibleTrajectories).toBe(1);
  });
});

// ==================== Error Handling Tests ====================

describe('SonaEngine Batch Operations Error Handling', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should handle missing databaseConnection gracefully in syncQualityFromEvents', async () => {
    const engine = new SonaEngine(); // No database connection

    const result = await engine.syncQualityFromEvents();

    expect(result.synced).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('persistence');
  });

  it('should handle missing databaseConnection gracefully in convertHighQualityTrajectoriesToPatterns', async () => {
    const engine = new SonaEngine(); // No database connection

    const result = await engine.convertHighQualityTrajectoriesToPatterns();

    expect(result.patternsCreated).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('persistence');
  });

  it('should return valid result structure even on error', async () => {
    const engine = new SonaEngine();

    const syncResult = await engine.syncQualityFromEvents();
    expect(typeof syncResult.synced).toBe('number');
    expect(Array.isArray(syncResult.errors)).toBe(true);

    const convertResult = await engine.convertHighQualityTrajectoriesToPatterns();
    expect(typeof convertResult.totalTrajectories).toBe('number');
    expect(typeof convertResult.eligibleTrajectories).toBe('number');
    expect(typeof convertResult.patternsCreated).toBe('number');
    expect(Array.isArray(convertResult.errors)).toBe(true);
  });
});
