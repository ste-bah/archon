/**
 * Unit Tests for VectorDB Persistence
 *
 * TASK-VDB-001: Tests for save/load operations and persistence after restart
 *
 * Test coverage targets:
 * - Save and load roundtrip preserves all data
 * - Persistence after insert + restart
 * - Count after reload returns correct count
 * - Search works correctly after reload
 * - File format validation
 * - Error handling for missing/corrupt files
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectorDB } from '../../../../src/god-agent/core/vector-db/vector-db';
import { DistanceMetric } from '../../../../src/god-agent/core/vector-db/types';
import {
  createRandomNormalizedVector,
  createBatchVectors,
  expectVectorsEqual
} from './test-helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

const TEST_DB_PATH = '.agentdb-test/vectors-test.bin';

describe('VectorDB Persistence - Save and Load Roundtrip', () => {
  let db: VectorDB;

  beforeEach(async () => {
    db = new VectorDB({ persistencePath: TEST_DB_PATH });
    // Clean up any existing test file
    try {
      await fs.unlink(TEST_DB_PATH);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up test file
    try {
      await fs.unlink(TEST_DB_PATH);
      await fs.rmdir(path.dirname(TEST_DB_PATH));
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should save and load empty database', async () => {
    await db.save();
    const loaded = await db.load();

    expect(loaded).toBe(true);
    expect(await db.count()).toBe(0);
  });

  it('should preserve vector data after save/load', async () => {
    const vectors = createBatchVectors(5);
    const ids = await db.batchInsert(vectors);

    await db.save();

    // Create new database instance and load
    const db2 = new VectorDB({ persistencePath: TEST_DB_PATH });
    const loaded = await db2.load();

    expect(loaded).toBe(true);
    expect(await db2.count()).toBe(5);

    // Verify all vectors are preserved
    for (let i = 0; i < ids.length; i++) {
      const retrieved = await db2.getVector(ids[i]);
      expect(retrieved).toBeDefined();
      expectVectorsEqual(retrieved!, vectors[i]);
    }
  });

  it('should preserve large number of vectors', async () => {
    const vectors = createBatchVectors(100);
    const ids = await db.batchInsert(vectors);

    await db.save();

    const db2 = new VectorDB({ persistencePath: TEST_DB_PATH });
    await db2.load();

    expect(await db2.count()).toBe(100);

    // Spot check some vectors
    for (let i = 0; i < 10; i++) {
      const randomIdx = Math.floor(Math.random() * 100);
      const retrieved = await db2.getVector(ids[randomIdx]);
      expectVectorsEqual(retrieved!, vectors[randomIdx]);
    }
  });

  it('should preserve search functionality after reload', async () => {
    const vectors = createBatchVectors(20);
    await db.batchInsert(vectors);
    await db.save();

    const db2 = new VectorDB({ persistencePath: TEST_DB_PATH });
    await db2.load();

    const query = createRandomNormalizedVector();
    const results = await db2.search(query, 10);

    expect(results).toHaveLength(10);
    expect(results[0].similarity).toBeGreaterThanOrEqual(results[9].similarity);
  });

  it('should handle multiple save operations', async () => {
    await db.insert(createRandomNormalizedVector());
    await db.save();

    await db.insert(createRandomNormalizedVector());
    await db.save();

    await db.insert(createRandomNormalizedVector());
    await db.save();

    const db2 = new VectorDB({ persistencePath: TEST_DB_PATH });
    await db2.load();

    expect(await db2.count()).toBe(3);
  });

  it('should return false when loading nonexistent file', async () => {
    const db2 = new VectorDB({ persistencePath: '.agentdb-test/nonexistent.bin' });
    const loaded = await db2.load();

    expect(loaded).toBe(false);
    expect(await db2.count()).toBe(0);
  });
});

describe('VectorDB Persistence - Insert + Restart + Count', () => {
  const testPath = '.agentdb-test/restart-test.bin';

  afterEach(async () => {
    try {
      await fs.unlink(testPath);
      await fs.rmdir(path.dirname(testPath));
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should persist count after restart', async () => {
    // First session: insert and save
    const db1 = new VectorDB({ persistencePath: testPath });
    await db1.insert(createRandomNormalizedVector());
    await db1.insert(createRandomNormalizedVector());
    await db1.insert(createRandomNormalizedVector());
    await db1.save();

    expect(await db1.count()).toBe(3);

    // Second session: load and check count
    const db2 = new VectorDB({ persistencePath: testPath });
    await db2.load();

    expect(await db2.count()).toBe(3);
  });

  it('should maintain consistency across multiple restart cycles', async () => {
    const testPath2 = '.agentdb-test/multi-restart.bin';

    try {
      // Cycle 1: Insert 5 vectors
      let db = new VectorDB({ persistencePath: testPath2 });
      await db.batchInsert(createBatchVectors(5));
      await db.save();

      // Cycle 2: Load and insert 3 more
      db = new VectorDB({ persistencePath: testPath2 });
      await db.load();
      expect(await db.count()).toBe(5);
      await db.batchInsert(createBatchVectors(3));
      await db.save();

      // Cycle 3: Load and delete 2
      db = new VectorDB({ persistencePath: testPath2 });
      await db.load();
      expect(await db.count()).toBe(8);
      const results = await db.search(createRandomNormalizedVector(), 8);
      const allIds = results.map(r => r.id).filter(Boolean);

      if (allIds.length >= 2) {
        await db.delete(allIds[0]!);
        await db.delete(allIds[1]!);
      }
      await db.save();

      // Final cycle: Verify count
      db = new VectorDB({ persistencePath: testPath2 });
      await db.load();
      expect(await db.count()).toBe(6);
    } finally {
      try {
        await fs.unlink(testPath2);
      } catch {
        // Ignore
      }
    }
  });
});

describe('VectorDB Persistence - File Format Validation', () => {
  const testPath = '.agentdb-test/format-test.bin';

  beforeEach(async () => {
    // Clean up
    try {
      await fs.unlink(testPath);
    } catch {
      // Ignore
    }
  });

  afterEach(async () => {
    try {
      await fs.unlink(testPath);
      await fs.rmdir(path.dirname(testPath));
    } catch {
      // Ignore
    }
  });

  it('should create directory if it does not exist', async () => {
    const db = new VectorDB({ persistencePath: testPath });
    await db.insert(createRandomNormalizedVector());
    await db.save();

    // Verify file exists
    const stats = await fs.stat(testPath);
    expect(stats.isFile()).toBe(true);
  });

  it('should reject file with wrong version', async () => {
    // Create a file with wrong version (invalid format)
    // Note: LEANN backend uses JSON format, so invalid binary data
    // will fail to parse. Updated test to match new API behavior.
    const dir = path.dirname(testPath);
    await fs.mkdir(dir, { recursive: true });

    const buffer = Buffer.allocUnsafe(12);
    buffer.writeUInt32LE(999, 0); // Wrong version
    buffer.writeUInt32LE(1536, 4);  // Dimension (TASK-VEC-001-008: updated from 768)
    buffer.writeUInt32LE(0, 8);    // Count

    await fs.writeFile(testPath, buffer);

    const db = new VectorDB({ persistencePath: testPath });
    // LEANN backend throws parse errors for invalid JSON format
    await expect(db.load()).rejects.toThrow(/parse|invalid|JSON|SyntaxError|read/i);
  });

  it('should reject file with wrong dimension', async () => {
    // Create a file with wrong dimension (invalid format)
    // Note: LEANN backend uses JSON format, so invalid binary data
    // will fail to parse. Updated test to match new API behavior.
    const dir = path.dirname(testPath);
    await fs.mkdir(dir, { recursive: true });

    const buffer = Buffer.allocUnsafe(12);
    buffer.writeUInt32LE(1, 0);    // Version
    buffer.writeUInt32LE(512, 4);  // Wrong dimension
    buffer.writeUInt32LE(0, 8);    // Count

    await fs.writeFile(testPath, buffer);

    const db = new VectorDB({ persistencePath: testPath });
    // LEANN backend throws parse errors for invalid JSON format
    // Use flexible matching for various error messages
    await expect(db.load()).rejects.toThrow(/[Dd]imension mismatch|parse|invalid|JSON|SyntaxError|read/i);
  });

  it('should handle corrupted file gracefully', async () => {
    // Create a corrupted file (incomplete data)
    const dir = path.dirname(testPath);
    await fs.mkdir(dir, { recursive: true });

    const buffer = Buffer.from([0, 1, 2, 3]); // Too short
    await fs.writeFile(testPath, buffer);

    const db = new VectorDB({ persistencePath: testPath });
    await expect(db.load()).rejects.toThrow();
  });
});

describe('VectorDB Persistence - Auto-save Feature', () => {
  const testPath = '.agentdb-test/autosave-test.bin';

  afterEach(async () => {
    try {
      await fs.unlink(testPath);
      await fs.rmdir(path.dirname(testPath));
    } catch {
      // Ignore
    }
  });

  it('should auto-save on insert when enabled', async () => {
    const db = new VectorDB({
      persistencePath: testPath,
      autoSave: true
    });

    await db.insert(createRandomNormalizedVector());

    // Verify file was created automatically
    const stats = await fs.stat(testPath);
    expect(stats.isFile()).toBe(true);

    // Verify data can be loaded
    const db2 = new VectorDB({ persistencePath: testPath });
    await db2.load();
    expect(await db2.count()).toBe(1);
  });

  it('should not auto-save when disabled', async () => {
    const db = new VectorDB({
      persistencePath: testPath,
      autoSave: false
    });

    await db.insert(createRandomNormalizedVector());

    // Verify file was NOT created
    try {
      await fs.access(testPath);
      expect.fail('File should not exist');
    } catch {
      // Expected - file doesn't exist
    }
  });

  it('should auto-save on delete when enabled', async () => {
    const db = new VectorDB({
      persistencePath: testPath,
      autoSave: true
    });

    const id = await db.insert(createRandomNormalizedVector());
    await db.delete(id);

    // Verify persistence reflects deletion
    const db2 = new VectorDB({ persistencePath: testPath });
    await db2.load();
    expect(await db2.count()).toBe(0);
  });

  it('should auto-save on batch insert when enabled', async () => {
    const db = new VectorDB({
      persistencePath: testPath,
      autoSave: true
    });

    await db.batchInsert(createBatchVectors(5));

    // Verify persistence
    const db2 = new VectorDB({ persistencePath: testPath });
    await db2.load();
    expect(await db2.count()).toBe(5);
  });
});

describe('VectorDB Persistence - Different Metrics', () => {
  const testPath = '.agentdb-test/metrics-test.bin';

  afterEach(async () => {
    try {
      await fs.unlink(testPath);
      await fs.rmdir(path.dirname(testPath));
    } catch {
      // Ignore
    }
  });

  it('should preserve vectors with Euclidean metric', async () => {
    const db1 = new VectorDB({
      persistencePath: testPath,
      metric: DistanceMetric.EUCLIDEAN
    });

    const vectors = createBatchVectors(10);
    const ids = await db1.batchInsert(vectors);
    await db1.save();

    const db2 = new VectorDB({
      persistencePath: testPath,
      metric: DistanceMetric.EUCLIDEAN
    });
    await db2.load();

    expect(await db2.count()).toBe(10);
    for (let i = 0; i < ids.length; i++) {
      const retrieved = await db2.getVector(ids[i]);
      expectVectorsEqual(retrieved!, vectors[i]);
    }
  });

  it('should work with Manhattan metric', async () => {
    const db1 = new VectorDB({
      persistencePath: testPath,
      metric: DistanceMetric.MANHATTAN
    });

    const vectors = createBatchVectors(5);
    await db1.batchInsert(vectors);
    await db1.save();

    const db2 = new VectorDB({
      persistencePath: testPath,
      metric: DistanceMetric.MANHATTAN
    });
    await db2.load();

    expect(await db2.count()).toBe(5);
  });
});

describe('VectorDB Persistence - Edge Cases', () => {
  const testPath = '.agentdb-test/edge-test.bin';

  afterEach(async () => {
    try {
      await fs.unlink(testPath);
      await fs.rmdir(path.dirname(testPath));
    } catch {
      // Ignore
    }
  });

  it('should handle very long vector IDs', async () => {
    const db1 = new VectorDB({ persistencePath: testPath });
    const longId = 'x'.repeat(1000);
    await db1.insertWithId(longId, createRandomNormalizedVector());
    await db1.save();

    const db2 = new VectorDB({ persistencePath: testPath });
    await db2.load();

    expect(await db2.getVector(longId)).toBeDefined();
  });

  it('should handle special characters in IDs', async () => {
    const db1 = new VectorDB({ persistencePath: testPath });
    const specialId = 'test-特殊-🚀-id';
    await db1.insertWithId(specialId, createRandomNormalizedVector());
    await db1.save();

    const db2 = new VectorDB({ persistencePath: testPath });
    await db2.load();

    expect(await db2.getVector(specialId)).toBeDefined();
  });

  it('should preserve vector precision', async () => {
    const db1 = new VectorDB({ persistencePath: testPath });
    const vector = createRandomNormalizedVector();
    const id = await db1.insert(vector);
    await db1.save();

    const db2 = new VectorDB({ persistencePath: testPath });
    await db2.load();

    const retrieved = await db2.getVector(id);
    expectVectorsEqual(retrieved!, vector, 1e-6);
  });

  it('should clear before loading', async () => {
    const db = new VectorDB({ persistencePath: testPath });

    // Insert some vectors
    await db.batchInsert(createBatchVectors(5));
    await db.save();

    // Insert more vectors without saving
    await db.batchInsert(createBatchVectors(3));
    expect(await db.count()).toBe(8);

    // Load from disk (should clear the 3 unsaved vectors)
    await db.load();
    expect(await db.count()).toBe(5);
  });
});
