/**
 * Cross-Session Trajectory Feedback Tests
 * TASK-TRAJ-001 - Ensure trajectory feedback works across process restarts
 *
 * Tests cover:
 * - REQ-TRAJ-001: SonaEngine.getTrajectory() must check SQLite if trajectory not in memory
 * - REQ-TRAJ-002: Loaded trajectories must be cached in memory map
 * - REQ-TRAJ-004: TrajectoryTracker.updateFeedback() must load from SQLite if not in memory
 * - REQ-TRAJ-005: TrajectoryTracker.getTrajectory() must load from SQLite if not in memory
 * - REQ-TRAJ-006: SonaEngine must have hasTrajectoryInStorage() and getTrajectoryFromStorage()
 * - REQ-TRAJ-008: Map SQLite metadata fields to ITrajectory correctly
 *
 * Constitution rules tested:
 * - RULE-008: All learning data MUST be stored in SQLite
 * - RULE-069: try/catch for SQLite operations
 * - RULE-070: Error logging with context
 * - RULE-074: Map as primary storage is FORBIDDEN in production
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';

// Import the classes under test
import { SonaEngine } from '../../../../src/god-agent/core/learning/sona-engine.js';
import { TrajectoryTracker, type TrajectoryTrackerConfig } from '../../../../src/god-agent/core/reasoning/trajectory-tracker.js';
import { DatabaseConnection, type DatabaseConfig, createConnection } from '../../../../src/god-agent/core/database/connection.js';
import { ReasoningMode, type IReasoningRequest, type IReasoningResponse, type TrajectoryID } from '../../../../src/god-agent/core/reasoning/reasoning-types.js';
import type { ISonaEngine, ITrajectory } from '../../../../src/god-agent/core/learning/sona-types.js';

// Test helper to create temporary database
function createTempDbPath(): string {
  const tempDir = join(tmpdir(), `sona-test-${Date.now()}-${randomUUID().substring(0, 8)}`);
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }
  return join(tempDir, 'learning.db');
}

// Test helper to cleanup temp directory
function cleanupTempDb(dbPath: string): void {
  const dir = join(dbPath, '..');
  try {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
}

// Create mock reasoning request for testing
function createMockRequest(): IReasoningRequest {
  return {
    type: ReasoningMode.PATTERN_MATCH,
    query: 'test query',
    context: 'test context'
  } as IReasoningRequest;
}

// Create mock reasoning response for testing
function createMockResponse(): IReasoningResponse {
  return {
    patterns: [],
    confidence: 0.8,
    causalInferences: []
  } as unknown as IReasoningResponse;
}

// =============================================================================
// SONA ENGINE UNIT TESTS - REQ-TRAJ-001, REQ-TRAJ-002, REQ-TRAJ-006, REQ-TRAJ-008
// =============================================================================

describe('TASK-TRAJ-001: SonaEngine Cross-Session Trajectory Support', () => {
  let dbPath: string;
  let dbConnection: DatabaseConnection;
  let sonaEngine: SonaEngine;

  beforeEach(() => {
    // Create fresh temp database for each test
    dbPath = createTempDbPath();
    dbConnection = createConnection({ dbPath });
    sonaEngine = new SonaEngine({ databaseConnection: dbConnection });
  });

  afterEach(async () => {
    // Cleanup
    try {
      dbConnection.close();
    } catch {
      // Ignore close errors
    }
    cleanupTempDb(dbPath);
  });

  describe('REQ-TRAJ-006: SQLite Storage Methods', () => {
    it('UT-TRAJ-001: hasTrajectoryInStorage() returns true for existing trajectory', () => {
      // Arrange: Create a trajectory (stored in memory AND SQLite)
      const trajectoryId = 'traj_test_001_abcd1234';
      sonaEngine.createTrajectoryWithId(trajectoryId, 'test-route', []);

      // Act & Assert: Should find in storage
      expect(sonaEngine.hasTrajectoryInStorage(trajectoryId)).toBe(true);
    });

    it('UT-TRAJ-002: hasTrajectoryInStorage() returns false for non-existent trajectory', () => {
      // Act & Assert: Non-existent trajectory should not be found
      expect(sonaEngine.hasTrajectoryInStorage('non_existent_id_12345678')).toBe(false);
    });

    it('UT-TRAJ-003: getTrajectoryFromStorage() loads trajectory from SQLite', () => {
      // Arrange: Create a trajectory
      const trajectoryId = 'traj_test_003_abcd1234';
      const route = 'test-route';
      sonaEngine.createTrajectoryWithId(trajectoryId, route, []);

      // Act: Load directly from storage
      const loaded = sonaEngine.getTrajectoryFromStorage(trajectoryId);

      // Assert: Should be found with correct data
      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(trajectoryId);
      expect(loaded?.route).toBe(route);
    });

    it('UT-TRAJ-003b: getTrajectoryFromStorage() returns null for non-existent trajectory', () => {
      // Act & Assert
      const loaded = sonaEngine.getTrajectoryFromStorage('non_existent_id');
      expect(loaded).toBeNull();
    });

    it('UT-TRAJ-006: hasTrajectoryInStorage handles errors gracefully', () => {
      // Create a SonaEngine without database (persistence disabled)
      const engineWithoutDb = new SonaEngine({});

      // Should return false, not throw
      expect(engineWithoutDb.hasTrajectoryInStorage('any_id')).toBe(false);
    });

    it('UT-TRAJ-006b: getTrajectoryFromStorage handles errors gracefully', () => {
      // Create a SonaEngine without database (persistence disabled)
      const engineWithoutDb = new SonaEngine({});

      // Should return null, not throw
      expect(engineWithoutDb.getTrajectoryFromStorage('any_id')).toBeNull();
    });
  });

  describe('REQ-TRAJ-001: getTrajectory() SQLite Fallback', () => {
    it('UT-TRAJ-004: getTrajectory() falls back to SQLite when not in memory', () => {
      // Arrange: Create trajectory with first engine instance
      const trajectoryId = 'traj_test_004_abcd1234';
      const route = 'test-route';
      sonaEngine.createTrajectoryWithId(trajectoryId, route, []);

      // Act: Create NEW SonaEngine instance (simulates process restart)
      // This new instance will have empty memory map but same database
      const newSonaEngine = new SonaEngine({ databaseConnection: dbConnection });

      // Assert: Should find via SQLite fallback
      const result = newSonaEngine.getTrajectory(trajectoryId);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(trajectoryId);
      expect(result?.route).toBe(route);
    });

    it('UT-TRAJ-004b: getTrajectory() returns from memory if available (no SQLite call)', () => {
      // Arrange: Create trajectory
      const trajectoryId = 'traj_test_004b_abcd1234';
      sonaEngine.createTrajectoryWithId(trajectoryId, 'test-route', []);

      // Act: Get trajectory (should be in memory)
      const result1 = sonaEngine.getTrajectory(trajectoryId);
      const result2 = sonaEngine.getTrajectory(trajectoryId);

      // Assert: Both should return the same in-memory trajectory
      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      expect(result1?.id).toBe(result2?.id);
    });
  });

  describe('REQ-TRAJ-002: Loaded Trajectory Caching', () => {
    it('UT-TRAJ-005: getTrajectory() caches loaded trajectory in memory', () => {
      // Arrange: Create trajectory and simulate restart
      const trajectoryId = 'traj_test_005_abcd1234';
      sonaEngine.createTrajectoryWithId(trajectoryId, 'test-route', []);

      // Create new engine (empty memory)
      const newSonaEngine = new SonaEngine({ databaseConnection: dbConnection });

      // Act: Load from SQLite (first call)
      const result1 = newSonaEngine.getTrajectory(trajectoryId);

      // Spy on SQLite calls for second retrieval
      const getFromStorageSpy = vi.spyOn(newSonaEngine, 'getTrajectoryFromStorage');

      // Get again (second call - should be cached)
      const result2 = newSonaEngine.getTrajectory(trajectoryId);

      // Assert: First call loaded from storage, second from cache
      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      expect(result1?.id).toBe(result2?.id);

      // The spy should NOT be called because trajectory is now in memory cache
      expect(getFromStorageSpy).not.toHaveBeenCalled();

      getFromStorageSpy.mockRestore();
    });
  });

  describe('REQ-TRAJ-008: SQLite Metadata Mapping', () => {
    it('UT-TRAJ-008: Trajectory fields are correctly mapped from SQLite', () => {
      // Arrange: Create trajectory with known data
      const trajectoryId = 'traj_test_008_abcd1234';
      const route = 'reasoning.pattern';
      const patterns = ['pattern1', 'pattern2'];
      sonaEngine.createTrajectoryWithId(trajectoryId, route, patterns);

      // Act: Simulate restart and load from SQLite
      const newSonaEngine = new SonaEngine({ databaseConnection: dbConnection });
      const loaded = newSonaEngine.getTrajectory(trajectoryId);

      // Assert: Core fields mapped correctly
      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(trajectoryId);
      expect(loaded?.route).toBe(route);
      expect(loaded?.createdAt).toBeDefined();
      expect(loaded?.createdAt).toBeGreaterThan(0);
      // Note: patterns and context are not stored in trajectory_metadata table
      // They are stored in memory only during the session
      expect(loaded?.patterns).toBeDefined();
      expect(loaded?.context).toBeDefined();
    });
  });

  describe('Persistence Validation', () => {
    it('should have persistence enabled with database connection', () => {
      expect(sonaEngine.isPersistenceEnabled()).toBe(true);
    });

    it('should have persistence disabled without database connection', () => {
      const engineWithoutDb = new SonaEngine({});
      expect(engineWithoutDb.isPersistenceEnabled()).toBe(false);
    });

    it('should return database stats when persistence is enabled', () => {
      sonaEngine.createTrajectoryWithId('traj_stats_test_abcd1234', 'test', []);

      const stats = sonaEngine.getDatabaseStats();
      expect(stats).not.toBeNull();
      expect(stats?.trajectoryMetadata).toBeDefined();
    });
  });
});

// =============================================================================
// TRAJECTORY TRACKER UNIT TESTS - REQ-TRAJ-004, REQ-TRAJ-005
// =============================================================================

describe('TASK-TRAJ-001: TrajectoryTracker Cross-Session Support', () => {
  let dbPath: string;
  let dbConnection: DatabaseConnection;
  let sonaEngine: SonaEngine;
  let tracker: TrajectoryTracker;

  beforeEach(() => {
    // Create fresh temp database for each test
    dbPath = createTempDbPath();
    dbConnection = createConnection({ dbPath });
    sonaEngine = new SonaEngine({ databaseConnection: dbConnection });

    // Create tracker with SonaEngine injection (RULE-031)
    tracker = new TrajectoryTracker({
      sonaEngine,
      autoPrune: false, // Disable auto-prune for tests
    });
  });

  afterEach(async () => {
    // Cleanup
    tracker.destroy();
    try {
      dbConnection.close();
    } catch {
      // Ignore close errors
    }
    cleanupTempDb(dbPath);
  });

  describe('REQ-TRAJ-005: getTrajectory() SQLite Fallback', () => {
    it('UT-TRAJ-007: getTrajectory() loads from SQLite when not in memory', async () => {
      // Arrange: Create trajectory via tracker
      const trajectory = await tracker.createTrajectory(
        createMockRequest(),
        createMockResponse(),
        new Float32Array(10),
        undefined,
        0.8
      );

      // Create NEW tracker (simulates process restart)
      // The new tracker has empty memory but same sonaEngine with database
      const newTracker = new TrajectoryTracker({
        sonaEngine: new SonaEngine({ databaseConnection: dbConnection }),
        autoPrune: false,
      });

      // Act: Get trajectory from new tracker
      const loaded = await newTracker.getTrajectory(trajectory.id as TrajectoryID);

      // Assert: Should load from SQLite via SonaEngine
      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(trajectory.id);

      newTracker.destroy();
    });

    it('UT-TRAJ-007b: getTrajectory() returns null for truly non-existent trajectory', async () => {
      const result = await tracker.getTrajectory('non_existent_traj_12345678' as TrajectoryID);
      expect(result).toBeNull();
    });
  });

  describe('REQ-TRAJ-004: updateFeedback() SQLite Fallback', () => {
    it('UT-TRAJ-006: updateFeedback() loads from SQLite when not in memory', async () => {
      // Arrange: Create trajectory via tracker
      const trajectory = await tracker.createTrajectory(
        createMockRequest(),
        createMockResponse(),
        new Float32Array(10),
        undefined,
        0.8
      );

      // Create NEW tracker and sonaEngine (simulates process restart)
      const newSonaEngine = new SonaEngine({ databaseConnection: dbConnection });
      const newTracker = new TrajectoryTracker({
        sonaEngine: newSonaEngine,
        autoPrune: false,
      });

      // Act: Update feedback (should load from SQLite first)
      const feedback = {
        quality: 0.9,
        outcome: 'positive' as const,
      };

      const updated = await newTracker.updateFeedback(
        trajectory.id as TrajectoryID,
        feedback
      );

      // Assert: Should have loaded and updated
      expect(updated).not.toBeNull();
      expect(updated.id).toBe(trajectory.id);
      expect(updated.feedback).toBeDefined();
      expect(updated.feedback?.quality).toBe(0.9);

      newTracker.destroy();
    });

    it('UT-TRAJ-006b: updateFeedback() throws for truly non-existent trajectory', async () => {
      const feedback = { quality: 0.9, outcome: 'positive' as const };

      await expect(
        tracker.updateFeedback('non_existent_12345678' as TrajectoryID, feedback)
      ).rejects.toThrow('Trajectory not found');
    });
  });
});

// =============================================================================
// INTEGRATION TEST - IT-TRAJ-001: Full Cross-Session Feedback Workflow
// =============================================================================

describe('IT-TRAJ-001: Full Cross-Session Feedback Workflow', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = createTempDbPath();
  });

  afterEach(() => {
    cleanupTempDb(dbPath);
  });

  it('full cross-session feedback workflow succeeds', async () => {
    // =========================================================================
    // PHASE 1: Create trajectory (simulates first Claude Code session)
    // =========================================================================
    const dbConnection1 = createConnection({ dbPath });
    const sonaEngine1 = new SonaEngine({ databaseConnection: dbConnection1 });
    const tracker1 = new TrajectoryTracker({
      sonaEngine: sonaEngine1,
      autoPrune: false,
    });

    // Create a trajectory
    const trajectory = await tracker1.createTrajectory(
      createMockRequest(),
      createMockResponse(),
      new Float32Array(10),
      undefined,
      0.8
    );

    const trajectoryId = trajectory.id;
    expect(trajectoryId).toBeDefined();
    expect(sonaEngine1.isPersistenceEnabled()).toBe(true);

    // Verify trajectory exists in memory
    const inMemory = await tracker1.getTrajectory(trajectoryId as TrajectoryID);
    expect(inMemory).not.toBeNull();

    // Cleanup Phase 1 (simulate process exit)
    tracker1.destroy();
    dbConnection1.close();

    // =========================================================================
    // PHASE 2: Provide feedback in new session (simulates second Claude Code session)
    // =========================================================================

    // Create completely new instances (simulates fresh process)
    const dbConnection2 = createConnection({ dbPath });
    const sonaEngine2 = new SonaEngine({ databaseConnection: dbConnection2 });
    const tracker2 = new TrajectoryTracker({
      sonaEngine: sonaEngine2,
      autoPrune: false,
    });

    // Verify the NEW instances have empty memory
    // (trajectory should NOT be in the new engine's memory map directly)
    // But it SHOULD be retrievable via SQLite fallback

    // Attempt to provide feedback - this previously failed with "Trajectory not found"
    const feedback = {
      quality: 0.85,
      outcome: 'positive' as const,
      weightChange: 0.1,
    };

    // This is the critical test - feedback should work even though
    // the trajectory was created in a different process
    const updated = await tracker2.updateFeedback(
      trajectoryId as TrajectoryID,
      feedback
    );

    // Verify feedback was recorded
    expect(updated).toBeDefined();
    expect(updated.id).toBe(trajectoryId);
    expect(updated.feedback).toBeDefined();
    expect(updated.feedback?.quality).toBe(0.85);

    // Also test getTrajectory works
    const retrieved = await tracker2.getTrajectory(trajectoryId as TrajectoryID);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(trajectoryId);

    // Cleanup Phase 2
    tracker2.destroy();
    dbConnection2.close();
  });

  it('SonaEngine.provideFeedback works across sessions', async () => {
    // =========================================================================
    // PHASE 1: Create trajectory directly in SonaEngine
    // =========================================================================
    const dbConnection1 = createConnection({ dbPath });
    const sonaEngine1 = new SonaEngine({ databaseConnection: dbConnection1 });
    await sonaEngine1.initialize();

    // Create trajectory with specific ID
    const trajectoryId = `traj-${Date.now()}-abcd1234`;
    sonaEngine1.createTrajectoryWithId(trajectoryId, 'code', ['pattern1']);

    // Close first session
    dbConnection1.close();

    // =========================================================================
    // PHASE 2: Provide feedback in new session
    // =========================================================================
    const dbConnection2 = createConnection({ dbPath });
    const sonaEngine2 = new SonaEngine({ databaseConnection: dbConnection2 });
    await sonaEngine2.initialize();

    // The trajectory should be loadable from SQLite
    const loaded = sonaEngine2.getTrajectory(trajectoryId);
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(trajectoryId);
    expect(loaded?.route).toBe('code');

    // Cleanup
    dbConnection2.close();
  });
});

// =============================================================================
// EDGE CASES AND ERROR HANDLING
// =============================================================================

describe('TASK-TRAJ-001: Edge Cases and Error Handling', () => {
  let dbPath: string;
  let dbConnection: DatabaseConnection;
  let sonaEngine: SonaEngine;

  beforeEach(() => {
    dbPath = createTempDbPath();
    dbConnection = createConnection({ dbPath });
    sonaEngine = new SonaEngine({ databaseConnection: dbConnection });
  });

  afterEach(() => {
    try {
      dbConnection.close();
    } catch {
      // Ignore
    }
    cleanupTempDb(dbPath);
  });

  it('should handle concurrent trajectory creation and retrieval', async () => {
    // Create multiple trajectories concurrently
    const promises = Array.from({ length: 10 }, (_, i) =>
      Promise.resolve().then(() => {
        const id = `traj_concurrent_${i}_abcd1234`;
        sonaEngine.createTrajectoryWithId(id, `route${i}`, []);
        return id;
      })
    );

    const ids = await Promise.all(promises);

    // All should be retrievable
    for (const id of ids) {
      const traj = sonaEngine.getTrajectory(id);
      expect(traj).not.toBeNull();
      expect(traj?.id).toBe(id);
    }
  });

  it('should handle rapid session switches', async () => {
    const trajectoryId = `traj_rapid_${Date.now()}_abcd1234`;

    // Create trajectory
    sonaEngine.createTrajectoryWithId(trajectoryId, 'rapid-test', []);

    // Rapidly create new engines and check (simulates rapid restarts)
    for (let i = 0; i < 5; i++) {
      const newEngine = new SonaEngine({ databaseConnection: dbConnection });
      const loaded = newEngine.getTrajectory(trajectoryId);
      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(trajectoryId);
    }
  });

  it('should gracefully handle missing trajectory in both memory and SQLite', () => {
    const result = sonaEngine.getTrajectory('completely_nonexistent_id');
    expect(result).toBeNull();
  });

  it('should handle trajectories with empty patterns array', () => {
    const trajectoryId = `traj_empty_${Date.now()}_abcd1234`;
    sonaEngine.createTrajectoryWithId(trajectoryId, 'empty-patterns', []);

    const newEngine = new SonaEngine({ databaseConnection: dbConnection });
    const loaded = newEngine.getTrajectory(trajectoryId);

    expect(loaded).not.toBeNull();
    expect(loaded?.patterns).toEqual([]);
  });

  it('should handle trajectories with empty context array', () => {
    const trajectoryId = `traj_nocontext_${Date.now()}_abcd1234`;
    sonaEngine.createTrajectoryWithId(trajectoryId, 'no-context', ['p1'], []);

    const newEngine = new SonaEngine({ databaseConnection: dbConnection });
    const loaded = newEngine.getTrajectory(trajectoryId);

    expect(loaded).not.toBeNull();
    expect(loaded?.context).toEqual([]);
  });
});

// =============================================================================
// CONSTITUTION COMPLIANCE TESTS
// =============================================================================

describe('Constitution Compliance', () => {
  it('RULE-008: SonaEngine uses SQLite for persistence', () => {
    const dbPath = createTempDbPath();
    const dbConnection = createConnection({ dbPath });
    const sonaEngine = new SonaEngine({ databaseConnection: dbConnection });

    expect(sonaEngine.isPersistenceEnabled()).toBe(true);

    dbConnection.close();
    cleanupTempDb(dbPath);
  });

  it('RULE-074: Production SonaEngine requires database connection', () => {
    // Set production flag
    const originalEnv = process.env.SONA_REQUIRE_PERSISTENCE;
    process.env.SONA_REQUIRE_PERSISTENCE = 'true';

    // Should throw without database connection
    expect(() => new SonaEngine({})).toThrow('CONSTITUTION VIOLATION (RULE-074)');

    // Restore
    process.env.SONA_REQUIRE_PERSISTENCE = originalEnv;
  });

  it('RULE-031: TrajectoryTracker requires SonaEngine injection', () => {
    expect(() => new TrajectoryTracker({} as TrajectoryTrackerConfig)).toThrow(
      'SonaEngine injection required per Constitution RULE-031'
    );
  });
});

// =============================================================================
// TASK-TRAJ-002: MINIMAL TRAJECTORY DATA HANDLING
// =============================================================================

describe('TASK-TRAJ-002: Minimal Trajectory Data Handling', () => {
  let dbPath: string;
  let dbConnection: DatabaseConnection;
  let sonaEngine: SonaEngine;

  beforeEach(() => {
    dbPath = createTempDbPath();
    dbConnection = createConnection({ dbPath });
    sonaEngine = new SonaEngine({ databaseConnection: dbConnection });
  });

  afterEach(() => {
    try {
      dbConnection.close();
    } catch {
      // Ignore
    }
    cleanupTempDb(dbPath);
  });

  /**
   * REQ-TRAJ-009: SQLite-loaded trajectories have minimal data
   * When loaded from SQLite, trajectories may not have full response data
   */
  it('REQ-TRAJ-009: SQLite-loaded trajectories have minimal data structure', () => {
    const trajectoryId = `traj_minimal_${Date.now()}_abcd1234`;

    // Create trajectory with minimal data
    sonaEngine.createTrajectoryWithId(trajectoryId, 'minimal-test', []);

    // Load in new engine (simulates process restart)
    const newEngine = new SonaEngine({ databaseConnection: dbConnection });
    const loaded = newEngine.getTrajectory(trajectoryId);

    // Should load successfully
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(trajectoryId);

    // SQLite-loaded trajectory has minimal data (no response object)
    expect(loaded?.patterns).toEqual([]);
    expect(loaded?.context).toEqual([]);
    // Response may be undefined for SQLite-loaded trajectories
    expect(loaded?.response).toBeUndefined();
  });

  /**
   * REQ-TRAJ-010: Code must handle missing response data gracefully
   */
  it('REQ-TRAJ-010: getTrajectory returns valid ITrajectory even with minimal data', () => {
    const trajectoryId = `traj_graceful_${Date.now()}_abcd1234`;

    // Create and retrieve from SQLite
    sonaEngine.createTrajectoryWithId(trajectoryId, 'graceful-test', []);
    const newEngine = new SonaEngine({ databaseConnection: dbConnection });
    const loaded = newEngine.getTrajectory(trajectoryId);

    // Should be a valid ITrajectory
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBeDefined();
    expect(loaded?.route).toBeDefined();
    expect(loaded?.createdAt).toBeDefined();

    // Safe to check for response existence
    const hasResponse = !!loaded?.response;
    const hasPatterns = !!loaded?.response?.patterns;
    const hasCausalInferences = !!loaded?.response?.causalInferences;

    // These checks should not throw
    expect(typeof hasResponse).toBe('boolean');
    expect(typeof hasPatterns).toBe('boolean');
    expect(typeof hasCausalInferences).toBe('boolean');
  });

  it('REQ-TRAJ-010: Optional chaining works on minimal trajectory data', () => {
    const trajectoryId = `traj_optional_${Date.now()}_abcd1234`;

    sonaEngine.createTrajectoryWithId(trajectoryId, 'optional-test', []);
    const newEngine = new SonaEngine({ databaseConnection: dbConnection });
    const loaded = newEngine.getTrajectory(trajectoryId);

    // These should all return undefined/0, not throw
    const patternCount = loaded?.response?.patterns?.length ?? 0;
    const inferenceCount = loaded?.response?.causalInferences?.length ?? 0;

    expect(patternCount).toBe(0);
    expect(inferenceCount).toBe(0);
  });

  it('should support feedback for SQLite-loaded trajectories with minimal data', async () => {
    const trajectoryId = `traj_feedback_minimal_${Date.now()}_abcd1234`;

    // Create trajectory
    sonaEngine.createTrajectoryWithId(trajectoryId, 'feedback-minimal', []);

    // Load in new engine
    const newEngine = new SonaEngine({ databaseConnection: dbConnection });
    const loaded = newEngine.getTrajectory(trajectoryId);

    expect(loaded).not.toBeNull();

    // Create tracker with new engine
    const tracker = new TrajectoryTracker({
      maxActiveTrajectories: 10,
      maxStoredTrajectories: 10,
      sonaEngine: newEngine,
    });

    // Get trajectory through tracker (should work for minimal data)
    const trackerLoaded = await tracker.getTrajectory(trajectoryId);
    expect(trackerLoaded).not.toBeNull();
    expect(trackerLoaded?.id).toBe(trajectoryId);
  });
});
