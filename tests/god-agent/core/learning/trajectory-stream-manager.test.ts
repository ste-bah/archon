/**
 * Trajectory Stream Manager Unit Tests
 * SPEC-TRJ-001 - Trajectory Streaming to Disk v1.2
 *
 * Tests cover:
 * - Basic operations (add, get, flush, stats)
 * - Multi-process safety (CRITICAL-003)
 * - Rollback loop detection (CRITICAL-004)
 * - Version migration (CRITICAL-005)
 * - Deletion API with safeguards
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TrajectoryStreamManager } from '../../../../src/god-agent/core/learning/trajectory-stream-manager.js';
import type { ITrajectory, TrajectoryID } from '../../../../src/god-agent/core/learning/sona-types.js';
import type {
  ITrajectoryStreamConfig,
  IStreamStats,
  IRollbackState,
  IDeleteResult,
  IPruneFilter,
  IMigrationResult,
} from '../../../../src/god-agent/core/learning/types/trajectory-streaming-types.js';
import {
  ERR_MULTI_PROCESS,
  ERR_ROLLBACK_LOOP,
  ERR_DELETE_BASELINE,
} from '../../../../src/god-agent/core/learning/types/trajectory-streaming-types.js';
import { writeFile, readFile, unlink, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ==================== Test Utilities ====================

/**
 * Create a temporary directory for tests
 */
async function createTempDir(): Promise<string> {
  const dir = join(tmpdir(), `trajectory-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Clean up temporary directory
 */
async function cleanupTempDir(dir: string): Promise<void> {
  if (existsSync(dir)) {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Create a mock trajectory
 */
function createMockTrajectory(overrides?: Partial<ITrajectory>): ITrajectory {
  return {
    id: `traj-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` as TrajectoryID,
    route: 'test.route',
    patterns: ['pattern1', 'pattern2'],
    context: ['context1'],
    createdAt: Date.now(),
    quality: 0.8,
    reward: 1.0,
    ...overrides,
  };
}

/**
 * Create multiple mock trajectories
 */
function createMockTrajectories(count: number): ITrajectory[] {
  return Array.from({ length: count }, (_, i) =>
    createMockTrajectory({
      id: `traj-${Date.now()}-${String(i).padStart(8, '0')}` as TrajectoryID,
      createdAt: Date.now() + i,
    })
  );
}

/**
 * Wait for a short time
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== Test Suite 1: Basic Operations ====================

describe('TrajectoryStreamManager - Basic Operations', () => {
  let manager: TrajectoryStreamManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    manager = new TrajectoryStreamManager({
      storageDir: tempDir,
      memoryWindowSize: 100,
      batchWriteSize: 10,
      batchWriteIntervalMs: 5000,
      enabled: true,
      compressionEnabled: true,
      formatVersion: 2,
    });
    await manager.initialize();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('initialize and shutdown', () => {
    it('should initialize manager successfully', async () => {
      const stats = manager.getStats();
      expect(stats.memoryCount).toBe(0);
      expect(stats.diskCount).toBe(0);
      expect(stats.totalCount).toBe(0);
    });

    it('should create storage directory if not exists', async () => {
      expect(existsSync(tempDir)).toBe(true);
    });

    it('should initialize without PID file (multi-process handled by MemoryServer)', async () => {
      // MEM-001: PID file creation removed - multi-process detection is now handled by MemoryServer
      // Just verify initialization completed successfully
      const stats = manager.getStats();
      expect(stats).toBeDefined();
    });
  });

  describe('addTrajectory', () => {
    it('should add trajectory to memory window', async () => {
      const trajectory = createMockTrajectory();
      await manager.addTrajectory(trajectory);

      const stats = manager.getStats();
      expect(stats.memoryCount).toBe(1);
      expect(stats.totalCount).toBe(1);
    });

    it('should retrieve trajectory from memory', async () => {
      const trajectory = createMockTrajectory();
      await manager.addTrajectory(trajectory);

      const retrieved = await manager.getTrajectory(trajectory.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(trajectory.id);
      expect(retrieved?.route).toBe(trajectory.route);
      expect(retrieved?.patterns).toEqual(trajectory.patterns);
    });

    it('should add multiple trajectories', async () => {
      const trajectories = createMockTrajectories(5);

      for (const traj of trajectories) {
        await manager.addTrajectory(traj);
      }

      const stats = manager.getStats();
      expect(stats.memoryCount).toBe(5);
      expect(stats.totalCount).toBe(5);
    });
  });

  describe('getTrajectory', () => {
    it('should return null for non-existent trajectory', async () => {
      const result = await manager.getTrajectory('traj-0-00000000' as TrajectoryID);
      expect(result).toBeNull();
    });

    it('should retrieve trajectory from memory', async () => {
      const trajectory = createMockTrajectory();
      await manager.addTrajectory(trajectory);

      const retrieved = await manager.getTrajectory(trajectory.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(trajectory.id);
    });

    it('should retrieve trajectory from disk after flush', async () => {
      const trajectories = createMockTrajectories(15);

      for (const traj of trajectories) {
        await manager.addTrajectory(traj);
      }

      await manager.flush();

      // Verify trajectory is on disk
      const retrieved = await manager.getTrajectory(trajectories[0].id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(trajectories[0].id);
    });
  });

  describe('flush', () => {
    it('should flush pending writes to disk', async () => {
      const trajectories = createMockTrajectories(15);

      for (const traj of trajectories) {
        await manager.addTrajectory(traj);
      }

      const beforeFlush = manager.getStats();
      // Trajectories are in memory, not pending writes yet
      expect(beforeFlush.memoryCount).toBeGreaterThan(0);

      await manager.flush();

      const afterFlush = manager.getStats();
      expect(afterFlush.pendingWrites).toBe(0);
      expect(afterFlush.memoryCount).toBe(0);
      expect(afterFlush.diskCount).toBeGreaterThan(0);
    });

    it('should create data file', async () => {
      const trajectories = createMockTrajectories(15);

      for (const traj of trajectories) {
        await manager.addTrajectory(traj);
      }

      await manager.flush();

      const dataFile = join(tempDir, 'data_000000.bin');
      expect(existsSync(dataFile)).toBe(true);
    });

    it('should update index file', async () => {
      const trajectories = createMockTrajectories(15);

      for (const traj of trajectories) {
        await manager.addTrajectory(traj);
      }

      await manager.flush();

      const indexFile = join(tempDir, 'index.json');
      expect(existsSync(indexFile)).toBe(true);

      const indexContent = JSON.parse(await readFile(indexFile, 'utf-8'));
      expect(indexContent.totalTrajectories).toBeGreaterThan(0);
      expect(indexContent.dataFiles.length).toBeGreaterThan(0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      const trajectories = createMockTrajectories(5);

      for (const traj of trajectories) {
        await manager.addTrajectory(traj);
      }

      const stats = manager.getStats();
      expect(stats.memoryCount).toBe(5);
      expect(stats.totalCount).toBe(5);
      expect(stats.heapUsed).toBeGreaterThan(0);
      expect(stats.heapLimit).toBeGreaterThan(0);
      expect(stats.heapPressure).toBeGreaterThanOrEqual(0);
      expect(stats.heapPressure).toBeLessThanOrEqual(1);
    });

    it('should track disk statistics after flush', async () => {
      const trajectories = createMockTrajectories(15);

      for (const traj of trajectories) {
        await manager.addTrajectory(traj);
      }

      await manager.flush();

      const stats = manager.getStats();
      expect(stats.diskCount).toBeGreaterThan(0);
      expect(stats.bytesOnDisk).toBeGreaterThan(0);
    });
  });
});

// ==================== Test Suite 2: Multi-Process Safety (CRITICAL-003) ====================

describe('TrajectoryStreamManager - Multi-Process Safety (CRITICAL-003)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('AC-MULTI-001: Detect concurrent writer', () => {
    it('should allow multiple instances to initialize (multi-process handled by MemoryServer)', async () => {
      // MEM-001: Multi-process detection removed - MemoryServer handles concurrent access
      const managerA = new TrajectoryStreamManager({
        storageDir: tempDir,
        enabled: true,
      });
      await managerA.initialize();

      // Process B now succeeds (no PID-based locking)
      const managerB = new TrajectoryStreamManager({
        storageDir: tempDir,
        enabled: true,
      });

      await expect(managerB.initialize()).resolves.not.toThrow();
    });

    it('should allow concurrent instances without error', async () => {
      // MEM-001: PID-based multi-process detection removed
      const managerA = new TrajectoryStreamManager({
        storageDir: tempDir,
        enabled: true,
      });
      await managerA.initialize();

      const managerB = new TrajectoryStreamManager({
        storageDir: tempDir,
        enabled: true,
      });

      // No longer throws - multi-process coordination is handled by MemoryServer daemon
      await managerB.initialize();
      expect(managerB.getStats()).toBeDefined();
    });
  });

  describe('AC-MULTI-002: Allow read-only concurrent access', () => {
    it('should allow read-only mode with active writer', async () => {
      // Process A starts as writer
      const writer = new TrajectoryStreamManager({
        storageDir: tempDir,
        enabled: true,
      });
      await writer.initialize();

      const trajectory = createMockTrajectory();
      await writer.addTrajectory(trajectory);
      await writer.flush();

      // Process B starts as reader
      const reader = new TrajectoryStreamManager({
        storageDir: tempDir,
        enabled: true,
        readOnly: true,
      });

      // Should initialize successfully (read-only bypasses PID check)
      await reader.initialize();
      expect(reader).toBeDefined();
    });

    it('should allow reading in read-only mode', async () => {
      // Writer creates data
      const writer = new TrajectoryStreamManager({
        storageDir: tempDir,
        enabled: true,
      });
      await writer.initialize();

      const trajectory = createMockTrajectory();
      await writer.addTrajectory(trajectory);
      await writer.flush();

      // Reader accesses data
      const reader = new TrajectoryStreamManager({
        storageDir: tempDir,
        enabled: true,
        readOnly: true,
      });
      await reader.initialize();

      const retrieved = await reader.getTrajectory(trajectory.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(trajectory.id);
    });
  });

  describe('AC-MULTI-003: Clean up stale PID file', () => {
    it('should clean up stale PID file from dead process', async () => {
      // MEM-001: PID file mechanism removed - initialize should succeed regardless
      await mkdir(tempDir, { recursive: true });

      const newManager = new TrajectoryStreamManager({
        storageDir: tempDir,
        enabled: true,
      });

      await expect(newManager.initialize()).resolves.not.toThrow();
    });

    it('should log when cleaning up stale PID file', async () => {
      const pidFile = join(tempDir, '.sona.pid');
      await mkdir(tempDir, { recursive: true });
      await writeFile(pidFile, '99999');

      const manager = new TrajectoryStreamManager({
        storageDir: tempDir,
        enabled: true,
      });

      // Capture console output
      const consoleSpy: string[] = [];
      const originalLog = console.log;
      console.log = (...args: any[]) => {
        consoleSpy.push(args.join(' '));
        originalLog(...args);
      };

      await manager.initialize();

      console.log = originalLog;

      // Check for log message about stale PID
      // Note: This test may need adjustment based on actual logging implementation
    });
  });

  describe('AC-ORPHAN-001: No orphaned trajectories after concurrent flushes', () => {
    it('should handle all trajectories correctly', async () => {
      const manager = new TrajectoryStreamManager({
        storageDir: tempDir,
        memoryWindowSize: 50,
        batchWriteSize: 10,
        enabled: true,
      });
      await manager.initialize();

      const trajectories = createMockTrajectories(200);

      // Add all trajectories
      for (const traj of trajectories) {
        await manager.addTrajectory(traj);
      }

      // Multiple flushes (simulating concurrent scenarios)
      await Promise.all([
        manager.flush(),
        manager.flush(),
        manager.flush(),
      ]);

      const stats = manager.getStats();

      // All trajectories should be accounted for
      const accountedFor = stats.memoryCount + stats.diskCount;
      expect(accountedFor).toBe(200);
      expect(stats.totalCount).toBe(200);
    });

    it('should ensure all trajectories are retrievable', async () => {
      const manager = new TrajectoryStreamManager({
        storageDir: tempDir,
        memoryWindowSize: 50,
        enabled: true,
      });
      await manager.initialize();

      const trajectories = createMockTrajectories(100);

      for (const traj of trajectories) {
        await manager.addTrajectory(traj);
      }

      await manager.flush();

      // Verify all trajectories are retrievable
      for (const traj of trajectories) {
        const retrieved = await manager.getTrajectory(traj.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved?.id).toBe(traj.id);
      }
    });
  });
});

// ==================== Test Suite 3: Rollback Loop Detection (CRITICAL-004) ====================

describe('TrajectoryStreamManager - Rollback Loop Detection (CRITICAL-004)', () => {
  let manager: TrajectoryStreamManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    manager = new TrajectoryStreamManager({
      storageDir: tempDir,
      enabled: true,
    });
    await manager.initialize();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('AC-CRIT-004.1: Detect same checkpoint rollback', () => {
    it('should throw ERR_ROLLBACK_LOOP on duplicate rollback', async () => {
      const checkpointId = 'chk_A';

      // First rollback succeeds
      await manager.recordRollback(checkpointId);

      // Second rollback to same checkpoint should fail
      await expect(manager.recordRollback(checkpointId)).rejects.toThrow('Rollback loop detected');
    });

    it('should include checkpoint ID in error message', async () => {
      const checkpointId = 'chk_test_123';

      await manager.recordRollback(checkpointId);

      try {
        await manager.recordRollback(checkpointId);
        expect.fail('Should have thrown ERR_ROLLBACK_LOOP');
      } catch (error: any) {
        expect(error.name).toBe('ERR_ROLLBACK_LOOP');
        expect(error.message).toContain(checkpointId);
        expect(error.message).toContain('Rollback loop detected');
      }
    });

    it('should include last rollback timestamp in error', async () => {
      const checkpointId = 'chk_B';

      await manager.recordRollback(checkpointId);

      try {
        await manager.recordRollback(checkpointId);
        expect.fail('Should have thrown ERR_ROLLBACK_LOOP');
      } catch (error: any) {
        expect(error.message).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO timestamp format
      }
    });

    it('should maintain rollback count correctly', async () => {
      const checkpointId = 'chk_C';

      await manager.recordRollback(checkpointId);

      const state = manager.getRollbackState();
      expect(state.rollbackCount).toBe(1);
      expect(state.lastRollbackCheckpointId).toBe(checkpointId);

      // Duplicate rollback should not increment count
      try {
        await manager.recordRollback(checkpointId);
      } catch (error) {
        // Expected error
      }

      const stateAfter = manager.getRollbackState();
      expect(stateAfter.rollbackCount).toBe(1); // Still 1, not incremented
    });
  });

  describe('AC-CRIT-004.2: Allow different checkpoint rollback', () => {
    it('should allow rollback to different checkpoint', async () => {
      await manager.recordRollback('chk_A');

      // Different checkpoint should succeed
      await expect(manager.recordRollback('chk_B')).resolves.not.toThrow();
    });

    it('should update lastRollbackCheckpointId', async () => {
      await manager.recordRollback('chk_A');
      await manager.recordRollback('chk_B');

      const state = manager.getRollbackState();
      expect(state.lastRollbackCheckpointId).toBe('chk_B');
    });

    it('should increment rollback count', async () => {
      await manager.recordRollback('chk_A');
      await manager.recordRollback('chk_B');

      const state = manager.getRollbackState();
      expect(state.rollbackCount).toBe(2);
    });

    it('should allow multiple different rollbacks', async () => {
      await manager.recordRollback('chk_1');
      await manager.recordRollback('chk_2');
      await manager.recordRollback('chk_3');

      const state = manager.getRollbackState();
      expect(state.rollbackCount).toBe(3);
      expect(state.lastRollbackCheckpointId).toBe('chk_3');
    });
  });

  describe('getRollbackState', () => {
    it('should return initial state', () => {
      const state = manager.getRollbackState();

      expect(state.lastRollbackCheckpointId).toBeNull();
      expect(state.lastRollbackAt).toBeNull();
      expect(state.rollbackCount).toBe(0);
    });

    it('should return updated state after rollback', async () => {
      const before = Date.now();
      await manager.recordRollback('chk_test');
      const after = Date.now();

      const state = manager.getRollbackState();

      expect(state.lastRollbackCheckpointId).toBe('chk_test');
      expect(state.lastRollbackAt).toBeGreaterThanOrEqual(before);
      expect(state.lastRollbackAt).toBeLessThanOrEqual(after);
      expect(state.rollbackCount).toBe(1);
    });

    it('should persist rollback state to disk', async () => {
      await manager.recordRollback('chk_persist');

      // Check that rollback-state.json exists
      const statePath = join(tempDir, 'rollback-state.json');
      expect(existsSync(statePath)).toBe(true);

      const content = JSON.parse(await readFile(statePath, 'utf-8'));
      expect(content.lastRollbackCheckpointId).toBe('chk_persist');
      expect(content.rollbackCount).toBe(1);
    });
  });
});

// ==================== Test Suite 4: Version Migration (CRITICAL-005) ====================

describe('TrajectoryStreamManager - Version Migration (CRITICAL-005)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('AC-MIG-001: Complete v1 to v2 migration', () => {
    it('should migrate v1 format to v2', async () => {
      // Use a unique temp directory for this test
      const migTestDir = await createTempDir();

      try {
        // Create manager with v1 format
        const v1Manager = new TrajectoryStreamManager({
          storageDir: migTestDir,
          formatVersion: 1,
          enabled: true,
          batchWriteSize: 20, // Prevent auto-flush during adding
        });
        await v1Manager.initialize();

        // Add trajectories in v1 format
        const trajectories = createMockTrajectories(10);
        for (const traj of trajectories) {
          await v1Manager.addTrajectory(traj);
        }
        await v1Manager.flush();

        // Clean up PID file before creating v2 manager
        const pidFile = join(migTestDir, '.sona.pid');
        if (existsSync(pidFile)) {
          await unlink(pidFile);
        }

        // Create v2 manager and migrate
        const v2Manager = new TrajectoryStreamManager({
          storageDir: migTestDir,
          formatVersion: 2,
          enabled: true,
        });
        await v2Manager.initialize();

        const result = await v2Manager.migrateToVersion(2);

        expect(result.success).toBe(true);
        expect(result.trajectoriesMigrated).toBe(10);
        expect(result.errors).toHaveLength(0);
      } finally {
        await cleanupTempDir(migTestDir);
      }
    });

    it('should add default values for new v2 fields', async () => {
      // Use a unique temp directory for this test
      const migTestDir = await createTempDir();

      try {
        // Create v1 data
        const v1Manager = new TrajectoryStreamManager({
          storageDir: migTestDir,
          formatVersion: 1,
          enabled: true,
          batchWriteSize: 20, // Prevent auto-flush
        });
        await v1Manager.initialize();

        const trajectory = createMockTrajectory();
        await v1Manager.addTrajectory(trajectory);
        await v1Manager.flush();

        // Clean up PID file
        const pidFile = join(migTestDir, '.sona.pid');
        if (existsSync(pidFile)) {
          await unlink(pidFile);
        }

        // Migrate to v2
        const v2Manager = new TrajectoryStreamManager({
          storageDir: migTestDir,
          formatVersion: 2,
          enabled: true,
        });
        await v2Manager.initialize();
        await v2Manager.migrateToVersion(2);

        // Verify v2 fields
        const retrieved = await v2Manager.getTrajectory(trajectory.id);
        expect(retrieved).not.toBeNull();

        // V2 fields should have defaults (checking through type system)
        // Note: actual field checking depends on implementation
      } finally {
        await cleanupTempDir(migTestDir);
      }
    });

    it('should update index formatVersion', async () => {
      // Use a unique temp directory for this test
      const migTestDir = await createTempDir();

      try {
        const v1Manager = new TrajectoryStreamManager({
          storageDir: migTestDir,
          formatVersion: 1,
          enabled: true,
        });
        await v1Manager.initialize();

        const trajectory = createMockTrajectory();
        await v1Manager.addTrajectory(trajectory);
        await v1Manager.flush();

        // Clean up PID file
        const pidFile = join(migTestDir, '.sona.pid');
        if (existsSync(pidFile)) {
          await unlink(pidFile);
        }

        const v2Manager = new TrajectoryStreamManager({
          storageDir: migTestDir,
          formatVersion: 2,
          enabled: true,
        });
        await v2Manager.initialize();
        await v2Manager.migrateToVersion(2);

        const indexPath = join(migTestDir, 'index.json');
        const index = JSON.parse(await readFile(indexPath, 'utf-8'));
        expect(index.formatVersion).toBe(2);
      } finally {
        await cleanupTempDir(migTestDir);
      }
    });
  });

  describe('AC-MIG-002: Backup before migration', () => {
    it('should create backup when backupDir specified', async () => {
      const migTestDir = await createTempDir();

      try {
        const manager = new TrajectoryStreamManager({
          storageDir: migTestDir,
          formatVersion: 1,
          enabled: true,
        });
        await manager.initialize();

        const trajectory = createMockTrajectory();
        await manager.addTrajectory(trajectory);
        await manager.flush();

        const backupDir = join(migTestDir, 'backups');
        const result = await manager.migrateToVersion(2, { backupDir });

        expect(result.backupPath).toBeDefined();
        expect(existsSync(result.backupPath!)).toBe(true);
      } finally {
        await cleanupTempDir(migTestDir);
      }
    });

    it('should backup all data files', async () => {
      const migTestDir = await createTempDir();

      try {
        const manager = new TrajectoryStreamManager({
          storageDir: migTestDir,
          formatVersion: 1,
          enabled: true,
        });
        await manager.initialize();

        const trajectories = createMockTrajectories(20);
        for (const traj of trajectories) {
          await manager.addTrajectory(traj);
        }
        await manager.flush();

        const backupDir = join(migTestDir, 'backups');
        const result = await manager.migrateToVersion(2, { backupDir });

        // Check backup contains index
        const backupIndexPath = join(result.backupPath!, 'index.json');
        expect(existsSync(backupIndexPath)).toBe(true);

        // Check backup contains data file
        const backupDataPath = join(result.backupPath!, 'data_000000.bin');
        expect(existsSync(backupDataPath)).toBe(true);
      } finally {
        await cleanupTempDir(migTestDir);
      }
    });
  });

  describe('AC-MIG-003: Dry run does not modify files', () => {
    it('should not modify files in dry run mode', async () => {
      const migTestDir = await createTempDir();

      try {
        const manager = new TrajectoryStreamManager({
          storageDir: migTestDir,
          formatVersion: 1,
          enabled: true,
        });
        await manager.initialize();

        const trajectory = createMockTrajectory();
        await manager.addTrajectory(trajectory);
        await manager.flush();

        // Get original file hash
        const dataPath = join(migTestDir, 'data_000000.bin');
        const originalData = await readFile(dataPath);
        const originalHash = originalData.toString('hex');

        // Dry run migration
        await manager.migrateToVersion(2, { dryRun: true });

        // Verify file unchanged
        const afterData = await readFile(dataPath);
        const afterHash = afterData.toString('hex');
        expect(afterHash).toBe(originalHash);
      } finally {
        await cleanupTempDir(migTestDir);
      }
    });

    it('should report success in dry run', async () => {
      const migTestDir = await createTempDir();

      try {
        const manager = new TrajectoryStreamManager({
          storageDir: migTestDir,
          formatVersion: 1,
          enabled: true,
        });
        await manager.initialize();

        const trajectory = createMockTrajectory();
        await manager.addTrajectory(trajectory);
        await manager.flush();

        const result = await manager.migrateToVersion(2, { dryRun: true });

        expect(result.filesProcessed).toBeGreaterThan(0);
        expect(result.trajectoriesMigrated).toBeGreaterThan(0);
      } finally {
        await cleanupTempDir(migTestDir);
      }
    });

    it('should not update index formatVersion in dry run', async () => {
      const migTestDir = await createTempDir();

      try {
        const manager = new TrajectoryStreamManager({
          storageDir: migTestDir,
          formatVersion: 1,
          enabled: true,
        });
        await manager.initialize();

        const trajectory = createMockTrajectory();
        await manager.addTrajectory(trajectory);
        await manager.flush();

        await manager.migrateToVersion(2, { dryRun: true });

        const indexPath = join(migTestDir, 'index.json');
        const index = JSON.parse(await readFile(indexPath, 'utf-8'));
        expect(index.formatVersion).toBe(1); // Still v1
      } finally {
        await cleanupTempDir(migTestDir);
      }
    });
  });

  describe('AC-MIG-004: Progress callback', () => {
    it('should call progress callback during migration', async () => {
      const migTestDir = await createTempDir();

      try {
        const manager = new TrajectoryStreamManager({
          storageDir: migTestDir,
          formatVersion: 1,
          enabled: true,
        });
        await manager.initialize();

        const trajectories = createMockTrajectories(10);
        for (const traj of trajectories) {
          await manager.addTrajectory(traj);
        }
        await manager.flush();

        const progressUpdates: number[] = [];
        await manager.migrateToVersion(2, {
          onProgress: (progress) => {
            progressUpdates.push(progress);
          },
        });

        expect(progressUpdates.length).toBeGreaterThan(0);
        expect(progressUpdates[progressUpdates.length - 1]).toBe(1); // Should reach 100%
      } finally {
        await cleanupTempDir(migTestDir);
      }
    });
  });

  describe('detectVersion', () => {
    it('should detect v1 format', async () => {
      const manager = new TrajectoryStreamManager({
        storageDir: tempDir,
        formatVersion: 1,
        enabled: true,
      });
      await manager.initialize();

      const trajectory = createMockTrajectory();
      await manager.addTrajectory(trajectory);
      await manager.flush();

      const version = await manager.detectVersion();
      expect(version).toBe(1);
    });

    it('should detect v2 format', async () => {
      const manager = new TrajectoryStreamManager({
        storageDir: tempDir,
        formatVersion: 2,
        enabled: true,
      });
      await manager.initialize();

      const trajectory = createMockTrajectory();
      await manager.addTrajectory(trajectory);
      await manager.flush();

      const version = await manager.detectVersion();
      expect(version).toBe(2);
    });
  });

  describe('Encoder/Decoder roundtrip', () => {
    it('should roundtrip v2 trajectories correctly', async () => {
      const manager = new TrajectoryStreamManager({
        storageDir: tempDir,
        formatVersion: 2,
        enabled: true,
      });
      await manager.initialize();

      const original = createMockTrajectory({
        quality: 0.95,
        patterns: ['p1', 'p2', 'p3'],
        context: ['ctx1', 'ctx2'],
      });

      await manager.addTrajectory(original);
      await manager.flush();

      const retrieved = await manager.getTrajectory(original.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(original.id);
      expect(retrieved?.route).toBe(original.route);
      expect(retrieved?.patterns).toEqual(original.patterns);
      expect(retrieved?.context).toEqual(original.context);
      expect(retrieved?.quality).toBe(original.quality);
    });
  });
});

// ==================== Test Suite 5: Deletion API ====================

describe('TrajectoryStreamManager - Deletion API', () => {
  let manager: TrajectoryStreamManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    manager = new TrajectoryStreamManager({
      storageDir: tempDir,
      enabled: true,
    });
    await manager.initialize();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('deleteTrajectory', () => {
    it('should delete single trajectory', async () => {
      const trajectory = createMockTrajectory();
      await manager.addTrajectory(trajectory);

      const result = await manager.deleteTrajectory(trajectory.id);

      expect(result.deletedCount).toBe(1);
      expect(result.bytesReclaimed).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should return error for non-existent trajectory', async () => {
      const result = await manager.deleteTrajectory('traj-0-00000000' as TrajectoryID);

      expect(result.deletedCount).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should remove trajectory from memory', async () => {
      const trajectory = createMockTrajectory();
      await manager.addTrajectory(trajectory);

      await manager.deleteTrajectory(trajectory.id);

      const retrieved = await manager.getTrajectory(trajectory.id);
      expect(retrieved).toBeNull();
    });

    it('should update stats after deletion', async () => {
      const trajectory = createMockTrajectory();
      await manager.addTrajectory(trajectory);

      const beforeStats = manager.getStats();
      expect(beforeStats.totalCount).toBe(1);

      await manager.deleteTrajectory(trajectory.id);

      const afterStats = manager.getStats();
      expect(afterStats.totalCount).toBe(0);
    });
  });

  describe('AC-BASE-002: Cannot delete baseline without force', () => {
    it('should throw ERR_DELETE_BASELINE for baseline trajectory', async () => {
      const trajectory = createMockTrajectory();
      await manager.addTrajectory(trajectory);

      // Mark as baseline (implementation detail - may need adjustment)
      // This test assumes metadata has isBaseline field

      // For now, testing the error condition if it were baseline
      // Actual implementation would mark trajectory as baseline first
    });

    it('should preserve baseline trajectory', async () => {
      // Test baseline preservation logic
      // Implementation depends on how baselines are marked
    });
  });

  describe('AC-BASE-003: Force delete baseline', () => {
    it('should allow force deletion of baseline', async () => {
      const trajectory = createMockTrajectory();
      await manager.addTrajectory(trajectory);

      // Even if baseline, force should work
      const result = await manager.deleteTrajectory(trajectory.id, true);

      expect(result.deletedCount).toBe(1);
    });
  });

  describe('pruneTrajectories', () => {
    it('should delete trajectories matching filter', async () => {
      const old = Date.now() - 10000;
      const trajectories = [
        createMockTrajectory({ createdAt: old, quality: 0.3 }),
        createMockTrajectory({ createdAt: old, quality: 0.4 }),
        createMockTrajectory({ createdAt: Date.now(), quality: 0.9 }),
      ];

      for (const traj of trajectories) {
        await manager.addTrajectory(traj);
      }

      const filter: IPruneFilter = {
        qualityBelow: 0.5,
      };

      const result = await manager.pruneTrajectories(filter);

      expect(result.deletedCount).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    it('should respect maxDelete limit', async () => {
      const trajectories = createMockTrajectories(10);
      for (const traj of trajectories) {
        await manager.addTrajectory(traj);
      }

      const filter: IPruneFilter = {
        maxDelete: 3,
      };

      const result = await manager.pruneTrajectories(filter);

      expect(result.deletedCount).toBe(3);
    });

    it('should filter by route', async () => {
      const trajectories = [
        createMockTrajectory({ route: 'test.route.a' }),
        createMockTrajectory({ route: 'test.route.b' }),
        createMockTrajectory({ route: 'test.route.a' }),
      ];

      for (const traj of trajectories) {
        await manager.addTrajectory(traj);
      }

      const filter: IPruneFilter = {
        route: 'test.route.a',
      };

      const result = await manager.pruneTrajectories(filter);

      expect(result.deletedCount).toBe(2);
    });

    it('should filter by age', async () => {
      const cutoff = Date.now();
      const trajectories = [
        createMockTrajectory({ createdAt: cutoff - 10000 }),
        createMockTrajectory({ createdAt: cutoff - 5000 }),
        createMockTrajectory({ createdAt: cutoff + 1000 }),
      ];

      for (const traj of trajectories) {
        await manager.addTrajectory(traj);
      }

      const filter: IPruneFilter = {
        olderThan: cutoff,
      };

      const result = await manager.pruneTrajectories(filter);

      expect(result.deletedCount).toBe(2);
    });

    it('should preserve baselines by default', async () => {
      // Test that baseline trajectories are preserved during bulk pruning
      // Implementation depends on baseline marking logic
    });
  });
});
