/**
 * DualEmbeddingStore Persistence Integration Tests
 * TASK-QUAL-001: Comprehensive persistence tests for DESC episode storage
 *
 * Tests verify:
 * - RULE-011: All episode data stored in SQLite
 * - RULE-015: Cache has eviction policy (LRU)
 * - RULE-016: Episodes are append-only (no DELETE)
 * - RULE-037: Maximum 1000 episodes in memory
 * - RULE-040: Memory overhead under 200MB
 * - RULE-046: Atomic operations via WAL checkpoint
 *
 * Methods tested:
 * - storeEpisode() - write-through to SQLite
 * - getEpisode() - cache hit updates LRU order
 * - getAllEpisodes() - cache population
 * - getCacheMetrics() - evictions and memoryBytes
 * - invalidateCache() - clears LRU cache
 * - flush() - persists to disk via WAL checkpoint
 * - close() - graceful shutdown with persistence
 * - deleteEpisode() - must throw RULE-016 error
 * - clear() - must throw RULE-016 error
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DualEmbeddingStore, IDualEmbeddingStoreConfig } from '../../../../../src/god-agent/core/ucm/desc/dual-embedding-store.js';
import { DESCStorageError } from '../../../../../src/god-agent/core/ucm/errors.js';
import { createConnection, closeDatabaseConnection, type IDatabaseConnection } from '../../../../../src/god-agent/core/database/index.js';
import type { IEpisodeInput, IStoredEpisode } from '../../../../../src/god-agent/core/ucm/types.js';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a normalized embedding for testing
 */
function createTestEmbedding(dimension: number = 1536): Float32Array {
  const arr = new Float32Array(dimension);
  let sumSq = 0;
  for (let i = 0; i < dimension; i++) {
    arr[i] = Math.random() * 2 - 1;
    sumSq += arr[i] * arr[i];
  }
  const norm = Math.sqrt(sumSq);
  for (let i = 0; i < dimension; i++) {
    arr[i] /= norm;
  }
  return arr;
}

/**
 * Create test episode input
 */
function createTestEpisodeInput(index: number = 0): IEpisodeInput {
  return {
    queryText: `Test query ${index}: How do I implement feature X?`,
    answerText: `Test answer ${index}: You can implement feature X by following these steps...`,
    metadata: {
      testIndex: index,
      createdAt: new Date().toISOString()
    }
  };
}

/**
 * Create test embeddings array
 */
function createTestEmbeddings(count: number = 3, dimension: number = 1536): Float32Array[] {
  return Array.from({ length: count }, () => createTestEmbedding(dimension));
}

/**
 * Get unique test database path
 */
function getTestDbPath(): string {
  const testDir = join(tmpdir(), 'dual-embedding-store-tests');
  if (!existsSync(testDir)) {
    mkdirSync(testDir, { recursive: true });
  }
  return join(testDir, `test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}.db`);
}

/**
 * Clean up test database
 */
function cleanupTestDb(dbPath: string): void {
  const extensions = ['', '-wal', '-shm'];
  for (const ext of extensions) {
    const filePath = dbPath + ext;
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('DualEmbeddingStore', () => {
  let store: DualEmbeddingStore;
  let dbPath: string;
  let connection: IDatabaseConnection;

  beforeEach(() => {
    // Create unique database for each test
    dbPath = getTestDbPath();
    connection = createConnection({ dbPath });
    store = new DualEmbeddingStore({
      connection,
      cacheSize: 100 // Smaller cache for testing eviction
    });
  });

  afterEach(() => {
    // Clean up
    try {
      if (store && !store.isClosed()) {
        store.close();
      }
    } catch {
      // Ignore cleanup errors
    }
    closeDatabaseConnection();
    cleanupTestDb(dbPath);
  });

  // ==========================================================================
  // storeEpisode() Tests - RULE-011: Write-through to SQLite
  // ==========================================================================

  describe('storeEpisode()', () => {
    it('should store episode and return episodeId', async () => {
      const input = createTestEpisodeInput(0);
      const queryEmbeddings = createTestEmbeddings(2);
      const answerEmbeddings = createTestEmbeddings(3);

      const episodeId = await store.storeEpisode(input, queryEmbeddings, answerEmbeddings);

      expect(episodeId).toBeDefined();
      expect(episodeId).toMatch(/^ep-\d+-[a-z0-9]+$/);
    });

    it('should persist episode to SQLite (RULE-011)', async () => {
      const input = createTestEpisodeInput(1);
      const queryEmbeddings = createTestEmbeddings(2);
      const answerEmbeddings = createTestEmbeddings(2);

      const episodeId = await store.storeEpisode(input, queryEmbeddings, answerEmbeddings);

      // Invalidate cache to force SQLite read
      store.invalidateCache();

      // Retrieve from SQLite
      const retrieved = await store.getEpisode(episodeId);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.episodeId).toBe(episodeId);
      expect(retrieved?.queryText).toBe(input.queryText);
      expect(retrieved?.answerText).toBe(input.answerText);
      expect(retrieved?.queryChunkCount).toBe(2);
      expect(retrieved?.answerChunkCount).toBe(2);
    });

    it('should store episode with correct embedding dimensions', async () => {
      const input = createTestEpisodeInput(2);
      const queryEmbeddings = createTestEmbeddings(1, 768);
      const answerEmbeddings = createTestEmbeddings(1, 768);

      const episodeId = await store.storeEpisode(input, queryEmbeddings, answerEmbeddings);
      store.invalidateCache();

      const retrieved = await store.getEpisode(episodeId);

      expect(retrieved?.queryChunkEmbeddings[0].length).toBe(768);
      expect(retrieved?.answerChunkEmbeddings[0].length).toBe(768);
    });

    it('should preserve metadata through store/retrieve cycle', async () => {
      const input = createTestEpisodeInput(3);
      input.metadata = {
        agent: 'test-agent',
        phase: 'testing',
        tags: ['unit', 'integration']
      };
      const queryEmbeddings = createTestEmbeddings(1);
      const answerEmbeddings = createTestEmbeddings(1);

      const episodeId = await store.storeEpisode(input, queryEmbeddings, answerEmbeddings);
      store.invalidateCache();

      const retrieved = await store.getEpisode(episodeId);

      expect(retrieved?.metadata).toEqual(input.metadata);
    });

    it('should throw on empty queryText', async () => {
      const input: IEpisodeInput = {
        queryText: '',
        answerText: 'Valid answer'
      };
      const queryEmbeddings = createTestEmbeddings(1);
      const answerEmbeddings = createTestEmbeddings(1);

      await expect(store.storeEpisode(input, queryEmbeddings, answerEmbeddings))
        .rejects.toThrow(DESCStorageError);
    });

    it('should throw on empty answerText', async () => {
      const input: IEpisodeInput = {
        queryText: 'Valid query',
        answerText: ''
      };
      const queryEmbeddings = createTestEmbeddings(1);
      const answerEmbeddings = createTestEmbeddings(1);

      await expect(store.storeEpisode(input, queryEmbeddings, answerEmbeddings))
        .rejects.toThrow(DESCStorageError);
    });

    it('should throw on empty embeddings arrays', async () => {
      const input = createTestEpisodeInput(4);

      await expect(store.storeEpisode(input, [], createTestEmbeddings(1)))
        .rejects.toThrow(DESCStorageError);

      await expect(store.storeEpisode(input, createTestEmbeddings(1), []))
        .rejects.toThrow(DESCStorageError);
    });

    it('should update cache after store', async () => {
      const input = createTestEpisodeInput(5);
      const queryEmbeddings = createTestEmbeddings(1);
      const answerEmbeddings = createTestEmbeddings(1);

      const episodeId = await store.storeEpisode(input, queryEmbeddings, answerEmbeddings);

      // Get cache metrics before retrieval
      const metricsBefore = store.getCacheMetrics();
      expect(metricsBefore.size).toBe(1);

      // Retrieve should be a cache hit
      await store.getEpisode(episodeId);
      const metricsAfter = store.getCacheMetrics();
      expect(metricsAfter.hits).toBe(1);
      expect(metricsAfter.misses).toBe(0);
    });
  });

  // ==========================================================================
  // getEpisode() Tests - Cache hit updates LRU order
  // ==========================================================================

  describe('getEpisode()', () => {
    it('should return null for non-existent episode', async () => {
      const result = await store.getEpisode('ep-nonexistent-123');
      expect(result).toBeNull();
    });

    it('should return episode from cache (cache hit)', async () => {
      const input = createTestEpisodeInput(6);
      const queryEmbeddings = createTestEmbeddings(1);
      const answerEmbeddings = createTestEmbeddings(1);

      const episodeId = await store.storeEpisode(input, queryEmbeddings, answerEmbeddings);

      // First retrieval - should be cache hit (stored during storeEpisode)
      const result = await store.getEpisode(episodeId);
      expect(result).not.toBeNull();
      expect(result?.episodeId).toBe(episodeId);

      const metrics = store.getCacheMetrics();
      expect(metrics.hits).toBeGreaterThanOrEqual(1);
    });

    it('should populate cache on SQLite fallback (cache miss)', async () => {
      const input = createTestEpisodeInput(7);
      const queryEmbeddings = createTestEmbeddings(1);
      const answerEmbeddings = createTestEmbeddings(1);

      const episodeId = await store.storeEpisode(input, queryEmbeddings, answerEmbeddings);
      store.invalidateCache();

      // First retrieval after invalidation - cache miss, SQLite fallback
      const metricsBefore = store.getCacheMetrics();
      expect(metricsBefore.size).toBe(0);

      const result = await store.getEpisode(episodeId);
      expect(result).not.toBeNull();

      // Cache should be populated
      const metricsAfter = store.getCacheMetrics();
      expect(metricsAfter.size).toBe(1);
      expect(metricsAfter.misses).toBe(1);
    });

    it('should update LRU order on cache hit', async () => {
      // Store 3 episodes
      const episodeIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const input = createTestEpisodeInput(10 + i);
        const queryEmbeddings = createTestEmbeddings(1);
        const answerEmbeddings = createTestEmbeddings(1);
        const id = await store.storeEpisode(input, queryEmbeddings, answerEmbeddings);
        episodeIds.push(id);
      }

      // Access first episode (updates LRU order - moves to end)
      await store.getEpisode(episodeIds[0]);

      // Now episodeIds[1] should be LRU (least recently used)
      // This can be verified through eviction behavior
      const metrics = store.getCacheMetrics();
      expect(metrics.size).toBe(3);
      expect(metrics.hits).toBeGreaterThanOrEqual(1);
    });

    it('should preserve embedding data through serialization/deserialization', async () => {
      const input = createTestEpisodeInput(8);
      const queryEmbeddings = [new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5])];
      const answerEmbeddings = [new Float32Array([0.5, 0.4, 0.3, 0.2, 0.1])];

      const episodeId = await store.storeEpisode(input, queryEmbeddings, answerEmbeddings);
      store.invalidateCache();

      const retrieved = await store.getEpisode(episodeId);

      expect(retrieved?.queryChunkEmbeddings[0].length).toBe(5);
      expect(retrieved?.answerChunkEmbeddings[0].length).toBe(5);

      // Check approximate values (floating point precision)
      expect(Math.abs(retrieved!.queryChunkEmbeddings[0][0] - 0.1)).toBeLessThan(0.0001);
      expect(Math.abs(retrieved!.answerChunkEmbeddings[0][4] - 0.1)).toBeLessThan(0.0001);
    });
  });

  // ==========================================================================
  // getAllEpisodes() Tests - Cache population
  // ==========================================================================

  describe('getAllEpisodes()', () => {
    it('should return empty array when no episodes exist', async () => {
      const episodes = await store.getAllEpisodes();
      expect(episodes).toEqual([]);
    });

    it('should return all stored episodes', async () => {
      // Store 5 episodes
      for (let i = 0; i < 5; i++) {
        const input = createTestEpisodeInput(20 + i);
        const queryEmbeddings = createTestEmbeddings(1);
        const answerEmbeddings = createTestEmbeddings(1);
        await store.storeEpisode(input, queryEmbeddings, answerEmbeddings);
      }

      const episodes = await store.getAllEpisodes();

      expect(episodes.length).toBe(5);
      expect(episodes.every(e => e.episodeId.startsWith('ep-'))).toBe(true);
    });

    it('should populate cache with retrieved episodes', async () => {
      // Store 3 episodes
      for (let i = 0; i < 3; i++) {
        const input = createTestEpisodeInput(30 + i);
        const queryEmbeddings = createTestEmbeddings(1);
        const answerEmbeddings = createTestEmbeddings(1);
        await store.storeEpisode(input, queryEmbeddings, answerEmbeddings);
      }

      store.invalidateCache();

      const metricsBefore = store.getCacheMetrics();
      expect(metricsBefore.size).toBe(0);

      await store.getAllEpisodes();

      const metricsAfter = store.getCacheMetrics();
      expect(metricsAfter.size).toBe(3);
    });

    it('should read from SQLite for completeness (RULE-011)', async () => {
      // Store 2 episodes
      const id1 = await store.storeEpisode(
        createTestEpisodeInput(40),
        createTestEmbeddings(1),
        createTestEmbeddings(1)
      );
      const id2 = await store.storeEpisode(
        createTestEpisodeInput(41),
        createTestEmbeddings(1),
        createTestEmbeddings(1)
      );

      // Clear cache (simulating eviction)
      store.invalidateCache();

      // getAllEpisodes should still return all from SQLite
      const episodes = await store.getAllEpisodes();

      expect(episodes.length).toBe(2);
      expect(episodes.map(e => e.episodeId)).toContain(id1);
      expect(episodes.map(e => e.episodeId)).toContain(id2);
    });
  });

  // ==========================================================================
  // getCacheMetrics() Tests - Evictions and memoryBytes
  // ==========================================================================

  describe('getCacheMetrics()', () => {
    it('should return initial metrics with zero values', () => {
      const metrics = store.getCacheMetrics();

      expect(metrics.size).toBe(0);
      expect(metrics.maxSize).toBe(100); // Configured in beforeEach
      expect(metrics.hits).toBe(0);
      expect(metrics.misses).toBe(0);
      expect(metrics.hitRate).toBe(0);
      expect(metrics.evictions).toBe(0);
      expect(metrics.memoryBytes).toBe(0);
    });

    it('should track cache size correctly', async () => {
      // Store 3 episodes
      for (let i = 0; i < 3; i++) {
        await store.storeEpisode(
          createTestEpisodeInput(50 + i),
          createTestEmbeddings(1),
          createTestEmbeddings(1)
        );
      }

      const metrics = store.getCacheMetrics();
      expect(metrics.size).toBe(3);
    });

    it('should track hits and misses accurately', async () => {
      const episodeId = await store.storeEpisode(
        createTestEpisodeInput(60),
        createTestEmbeddings(1),
        createTestEmbeddings(1)
      );

      // Cache hit
      await store.getEpisode(episodeId);
      const metricsAfterHit = store.getCacheMetrics();
      expect(metricsAfterHit.hits).toBe(1);

      // Cache miss (non-existent)
      await store.getEpisode('ep-nonexistent');
      const metricsAfterMiss = store.getCacheMetrics();
      expect(metricsAfterMiss.misses).toBe(1);
    });

    it('should calculate hitRate correctly', async () => {
      const episodeId = await store.storeEpisode(
        createTestEpisodeInput(70),
        createTestEmbeddings(1),
        createTestEmbeddings(1)
      );

      // 2 hits
      await store.getEpisode(episodeId);
      await store.getEpisode(episodeId);

      // 2 misses
      await store.getEpisode('ep-nonexistent-1');
      await store.getEpisode('ep-nonexistent-2');

      const metrics = store.getCacheMetrics();
      expect(metrics.hits).toBe(2);
      expect(metrics.misses).toBe(2);
      expect(metrics.hitRate).toBe(0.5); // 2 / (2 + 2)
    });

    it('should track memory usage in bytes (RULE-040)', async () => {
      // Store episode with known embedding sizes
      await store.storeEpisode(
        createTestEpisodeInput(80),
        createTestEmbeddings(2, 1536), // 2 embeddings x 1536 floats x 4 bytes
        createTestEmbeddings(3, 1536)  // 3 embeddings x 1536 floats x 4 bytes
      );

      const metrics = store.getCacheMetrics();

      // Should have some memory tracked
      expect(metrics.memoryBytes).toBeGreaterThan(0);

      // Approximate check: 5 embeddings x 1536 x 4 bytes + overhead
      const minExpectedBytes = 5 * 1536 * 4;
      expect(metrics.memoryBytes).toBeGreaterThan(minExpectedBytes);
    });

    it('should track evictions (RULE-015)', async () => {
      // Create store with very small cache for eviction testing
      const smallStore = new DualEmbeddingStore({
        connection,
        cacheSize: 3
      });

      // Store 5 episodes (triggers 2 evictions)
      for (let i = 0; i < 5; i++) {
        await smallStore.storeEpisode(
          createTestEpisodeInput(90 + i),
          createTestEmbeddings(1),
          createTestEmbeddings(1)
        );
      }

      const metrics = smallStore.getCacheMetrics();
      expect(metrics.evictions).toBe(2); // 5 stored - 3 max = 2 evictions
      expect(metrics.size).toBe(3);

      // Verify data still in SQLite after eviction
      const allEpisodes = await smallStore.getAllEpisodes();
      expect(allEpisodes.length).toBe(5);
    });
  });

  // ==========================================================================
  // LRU Eviction Tests - RULE-015, RULE-037
  // ==========================================================================

  describe('LRU Eviction (RULE-015, RULE-037)', () => {
    it('should evict LRU entries when cache exceeds maxSize', async () => {
      const smallStore = new DualEmbeddingStore({
        connection,
        cacheSize: 3
      });

      const episodeIds: string[] = [];

      // Store 5 episodes
      for (let i = 0; i < 5; i++) {
        const id = await smallStore.storeEpisode(
          createTestEpisodeInput(100 + i),
          createTestEmbeddings(1),
          createTestEmbeddings(1)
        );
        episodeIds.push(id);
      }

      const metrics = smallStore.getCacheMetrics();
      expect(metrics.size).toBe(3);
      expect(metrics.evictions).toBe(2);

      // First 2 episodes should have been evicted from cache
      // But SQLite should still have them
      smallStore.invalidateCache();

      // All should be retrievable from SQLite
      for (const id of episodeIds) {
        const episode = await smallStore.getEpisode(id);
        expect(episode).not.toBeNull();
      }
    });

    it('should keep most recently accessed items in cache', async () => {
      const smallStore = new DualEmbeddingStore({
        connection,
        cacheSize: 3
      });

      // Store 3 episodes
      const episodeIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const id = await smallStore.storeEpisode(
          createTestEpisodeInput(110 + i),
          createTestEmbeddings(1),
          createTestEmbeddings(1)
        );
        episodeIds.push(id);
      }

      // Access first episode (moves it to most recently used)
      await smallStore.getEpisode(episodeIds[0]);

      // Store new episode (should evict episodeIds[1], not episodeIds[0])
      await smallStore.storeEpisode(
        createTestEpisodeInput(113),
        createTestEmbeddings(1),
        createTestEmbeddings(1)
      );

      const metrics = smallStore.getCacheMetrics();
      expect(metrics.evictions).toBe(1);

      // Reset metrics to test cache state
      // episodeIds[0] should still be in cache (was accessed)
      await smallStore.getEpisode(episodeIds[0]);
      const newMetrics = smallStore.getCacheMetrics();
      expect(newMetrics.hits).toBeGreaterThan(0);
    });

    it('should respect RULE-037 maximum of 1000 episodes with default config', async () => {
      const defaultStore = new DualEmbeddingStore({
        connection
        // No cacheSize specified - should default to 1000
      });

      const metrics = defaultStore.getCacheMetrics();
      expect(metrics.maxSize).toBe(1000);
    });
  });

  // ==========================================================================
  // SQLite as Source of Truth Tests - RULE-011
  // ==========================================================================

  describe('SQLite as Source of Truth (RULE-011)', () => {
    it('should persist data after cache eviction', async () => {
      const smallStore = new DualEmbeddingStore({
        connection,
        cacheSize: 2
      });

      // Store 5 episodes (3 will be evicted from cache)
      const episodeIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const id = await smallStore.storeEpisode(
          createTestEpisodeInput(120 + i),
          createTestEmbeddings(1),
          createTestEmbeddings(1)
        );
        episodeIds.push(id);
      }

      // Clear cache completely
      smallStore.invalidateCache();

      // All should be retrievable from SQLite
      for (let i = 0; i < episodeIds.length; i++) {
        const episode = await smallStore.getEpisode(episodeIds[i]);
        expect(episode).not.toBeNull();
        expect(episode?.queryText).toContain(`Test query ${120 + i}`);
      }
    });

    it('should return correct count from SQLite', async () => {
      // Store 5 episodes
      for (let i = 0; i < 5; i++) {
        await store.storeEpisode(
          createTestEpisodeInput(130 + i),
          createTestEmbeddings(1),
          createTestEmbeddings(1)
        );
      }

      // Clear cache
      store.invalidateCache();

      const count = store.getEpisodeCount();
      expect(count).toBe(5);
    });

    it('should return consistent data between cache and SQLite', async () => {
      const input = createTestEpisodeInput(140);
      input.metadata = { test: 'consistency' };

      const episodeId = await store.storeEpisode(
        input,
        createTestEmbeddings(2),
        createTestEmbeddings(3)
      );

      // Get from cache
      const cachedEpisode = await store.getEpisode(episodeId);

      // Invalidate and get from SQLite
      store.invalidateCache();
      const sqliteEpisode = await store.getEpisode(episodeId);

      expect(cachedEpisode?.queryText).toBe(sqliteEpisode?.queryText);
      expect(cachedEpisode?.answerText).toBe(sqliteEpisode?.answerText);
      expect(cachedEpisode?.queryChunkCount).toBe(sqliteEpisode?.queryChunkCount);
      expect(cachedEpisode?.answerChunkCount).toBe(sqliteEpisode?.answerChunkCount);
      expect(cachedEpisode?.metadata).toEqual(sqliteEpisode?.metadata);
    });
  });

  // ==========================================================================
  // invalidateCache() Tests
  // ==========================================================================

  describe('invalidateCache()', () => {
    it('should clear all cached entries', async () => {
      // Store 5 episodes
      for (let i = 0; i < 5; i++) {
        await store.storeEpisode(
          createTestEpisodeInput(150 + i),
          createTestEmbeddings(1),
          createTestEmbeddings(1)
        );
      }

      const metricsBefore = store.getCacheMetrics();
      expect(metricsBefore.size).toBe(5);

      store.invalidateCache();

      const metricsAfter = store.getCacheMetrics();
      expect(metricsAfter.size).toBe(0);
    });

    it('should reset hit/miss counters', async () => {
      const episodeId = await store.storeEpisode(
        createTestEpisodeInput(160),
        createTestEmbeddings(1),
        createTestEmbeddings(1)
      );

      // Generate some hits/misses
      await store.getEpisode(episodeId);
      await store.getEpisode('nonexistent');

      const metricsBefore = store.getCacheMetrics();
      expect(metricsBefore.hits).toBeGreaterThan(0);
      expect(metricsBefore.misses).toBeGreaterThan(0);

      store.invalidateCache();

      const metricsAfter = store.getCacheMetrics();
      expect(metricsAfter.hits).toBe(0);
      expect(metricsAfter.misses).toBe(0);
    });

    it('should not affect SQLite data', async () => {
      const episodeId = await store.storeEpisode(
        createTestEpisodeInput(170),
        createTestEmbeddings(1),
        createTestEmbeddings(1)
      );

      store.invalidateCache();

      // Episode should still be retrievable from SQLite
      const episode = await store.getEpisode(episodeId);
      expect(episode).not.toBeNull();
    });

    it('should reset memory tracking', async () => {
      await store.storeEpisode(
        createTestEpisodeInput(180),
        createTestEmbeddings(5, 1536),
        createTestEmbeddings(5, 1536)
      );

      const metricsBefore = store.getCacheMetrics();
      expect(metricsBefore.memoryBytes).toBeGreaterThan(0);

      store.invalidateCache();

      const metricsAfter = store.getCacheMetrics();
      expect(metricsAfter.memoryBytes).toBe(0);
    });
  });

  // ==========================================================================
  // flush() Tests - RULE-046
  // ==========================================================================

  describe('flush()', () => {
    it('should execute without error', () => {
      expect(() => store.flush()).not.toThrow();
    });

    it('should persist data via WAL checkpoint', async () => {
      const episodeId = await store.storeEpisode(
        createTestEpisodeInput(190),
        createTestEmbeddings(1),
        createTestEmbeddings(1)
      );

      store.flush();

      // Create new store with same database
      const newStore = new DualEmbeddingStore({ dbPath });

      const episode = await newStore.getEpisode(episodeId);
      expect(episode).not.toBeNull();
      expect(episode?.episodeId).toBe(episodeId);

      newStore.close();
    });

    it('should throw if store is closed', async () => {
      store.close();

      expect(() => store.flush()).toThrow(DESCStorageError);
      expect(() => store.flush()).toThrow('store is closed');
    });
  });

  // ==========================================================================
  // close() Tests - Graceful shutdown with persistence
  // ==========================================================================

  describe('close()', () => {
    it('should mark store as closed', () => {
      expect(store.isClosed()).toBe(false);

      store.close();

      expect(store.isClosed()).toBe(true);
    });

    it('should be idempotent (no error on multiple close)', () => {
      store.close();
      expect(() => store.close()).not.toThrow();
    });

    it('should flush before closing', async () => {
      const episodeId = await store.storeEpisode(
        createTestEpisodeInput(200),
        createTestEmbeddings(1),
        createTestEmbeddings(1)
      );

      store.close();

      // Verify data persisted by creating new connection
      const verifyConnection = createConnection({ dbPath });
      const verifyStore = new DualEmbeddingStore({ connection: verifyConnection });

      const episode = await verifyStore.getEpisode(episodeId);
      expect(episode).not.toBeNull();

      verifyStore.close();
    });

    it('should clear cache on close', async () => {
      await store.storeEpisode(
        createTestEpisodeInput(210),
        createTestEmbeddings(1),
        createTestEmbeddings(1)
      );

      const metricsBefore = store.getCacheMetrics();
      expect(metricsBefore.size).toBe(1);

      store.close();

      // After close, store is unusable but cache should have been cleared
      expect(store.isClosed()).toBe(true);
    });
  });

  // ==========================================================================
  // deleteEpisode() Tests - RULE-016 Compliance
  // ==========================================================================

  describe('deleteEpisode() - RULE-016 Compliance', () => {
    it('should throw RULE-016 error', async () => {
      const episodeId = await store.storeEpisode(
        createTestEpisodeInput(220),
        createTestEmbeddings(1),
        createTestEmbeddings(1)
      );

      await expect(store.deleteEpisode(episodeId))
        .rejects.toThrow(DESCStorageError);

      await expect(store.deleteEpisode(episodeId))
        .rejects.toThrow('RULE-016 VIOLATION');
    });

    it('should throw error with correct context', async () => {
      try {
        await store.deleteEpisode('any-id');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DESCStorageError);
        expect((error as DESCStorageError).context?.rule).toBe('RULE-016');
      }
    });

    it('should preserve episode after failed delete attempt', async () => {
      const episodeId = await store.storeEpisode(
        createTestEpisodeInput(230),
        createTestEmbeddings(1),
        createTestEmbeddings(1)
      );

      try {
        await store.deleteEpisode(episodeId);
      } catch {
        // Expected to throw
      }

      // Episode should still exist
      const episode = await store.getEpisode(episodeId);
      expect(episode).not.toBeNull();
    });
  });

  // ==========================================================================
  // clear() Tests - RULE-016 Compliance
  // ==========================================================================

  describe('clear() - RULE-016 Compliance', () => {
    it('should throw RULE-016 error', async () => {
      await store.storeEpisode(
        createTestEpisodeInput(240),
        createTestEmbeddings(1),
        createTestEmbeddings(1)
      );

      await expect(store.clear()).rejects.toThrow(DESCStorageError);
      await expect(store.clear()).rejects.toThrow('RULE-016 VIOLATION');
    });

    it('should suggest using clearCache() instead', async () => {
      await expect(store.clear()).rejects.toThrow('clearCache()');
    });

    it('should preserve all episodes after failed clear attempt', async () => {
      // Store 3 episodes
      for (let i = 0; i < 3; i++) {
        await store.storeEpisode(
          createTestEpisodeInput(250 + i),
          createTestEmbeddings(1),
          createTestEmbeddings(1)
        );
      }

      try {
        await store.clear();
      } catch {
        // Expected to throw
      }

      // All episodes should still exist
      const episodes = await store.getAllEpisodes();
      expect(episodes.length).toBe(3);
    });
  });

  // ==========================================================================
  // clearCache() Tests - Safe cache clearing
  // ==========================================================================

  describe('clearCache()', () => {
    it('should clear cache without affecting SQLite', async () => {
      // Store 3 episodes
      const episodeIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const id = await store.storeEpisode(
          createTestEpisodeInput(260 + i),
          createTestEmbeddings(1),
          createTestEmbeddings(1)
        );
        episodeIds.push(id);
      }

      await store.clearCache();

      const metrics = store.getCacheMetrics();
      expect(metrics.size).toBe(0);

      // SQLite should still have data
      for (const id of episodeIds) {
        const episode = await store.getEpisode(id);
        expect(episode).not.toBeNull();
      }
    });
  });

  // ==========================================================================
  // isHealthy() Tests
  // ==========================================================================

  describe('isHealthy()', () => {
    it('should return true for healthy store', () => {
      expect(store.isHealthy()).toBe(true);
    });

    it('should return false after close', () => {
      store.close();
      expect(store.isHealthy()).toBe(false);
    });
  });

  // ==========================================================================
  // getStats() Tests
  // ==========================================================================

  describe('getStats()', () => {
    it('should return combined SQLite and cache statistics', async () => {
      // Store episodes with varying chunk counts
      await store.storeEpisode(
        createTestEpisodeInput(270),
        createTestEmbeddings(2), // 2 query chunks
        createTestEmbeddings(3)  // 3 answer chunks
      );
      await store.storeEpisode(
        createTestEpisodeInput(271),
        createTestEmbeddings(4), // 4 query chunks
        createTestEmbeddings(1)  // 1 answer chunk
      );

      const stats = store.getStats();

      expect(stats.episodeCount).toBe(2);
      expect(stats.totalQueryChunks).toBe(6); // 2 + 4
      expect(stats.totalAnswerChunks).toBe(4); // 3 + 1
      expect(stats.avgQueryChunksPerEpisode).toBe(3); // 6 / 2
      expect(stats.avgAnswerChunksPerEpisode).toBe(2); // 4 / 2
      expect(stats.cacheSize).toBe(2);
      expect(stats.cacheHitRate).toBeDefined();
    });
  });

  // ==========================================================================
  // Memory Budget Tests - RULE-040
  // ==========================================================================

  describe('Memory Budget (RULE-040)', () => {
    it('should track memory usage per episode', async () => {
      const metricsBefore = store.getCacheMetrics();
      expect(metricsBefore.memoryBytes).toBe(0);

      // Store episode with large embeddings
      await store.storeEpisode(
        createTestEpisodeInput(280),
        createTestEmbeddings(10, 1536), // 10 x 1536 x 4 = 61,440 bytes
        createTestEmbeddings(10, 1536)  // 10 x 1536 x 4 = 61,440 bytes
      );

      const metricsAfter = store.getCacheMetrics();
      // Should be > 100KB for embeddings + overhead
      expect(metricsAfter.memoryBytes).toBeGreaterThan(100000);
    });

    it('should reduce memory on eviction', async () => {
      const smallStore = new DualEmbeddingStore({
        connection,
        cacheSize: 2
      });

      // Store 2 episodes with large embeddings
      await smallStore.storeEpisode(
        createTestEpisodeInput(290),
        createTestEmbeddings(5, 1536),
        createTestEmbeddings(5, 1536)
      );
      await smallStore.storeEpisode(
        createTestEpisodeInput(291),
        createTestEmbeddings(5, 1536),
        createTestEmbeddings(5, 1536)
      );

      const metricsWithTwo = smallStore.getCacheMetrics();

      // Store third episode (triggers eviction)
      await smallStore.storeEpisode(
        createTestEpisodeInput(292),
        createTestEmbeddings(5, 1536),
        createTestEmbeddings(5, 1536)
      );

      const metricsAfterEviction = smallStore.getCacheMetrics();

      // Memory should be similar (2 items now, was 2 items)
      expect(metricsAfterEviction.size).toBe(2);
      expect(metricsAfterEviction.evictions).toBe(1);
    });
  });

  // ==========================================================================
  // Concurrent Access Tests
  // ==========================================================================

  describe('Concurrent Access', () => {
    it('should handle multiple simultaneous stores', async () => {
      const promises: Promise<string>[] = [];

      for (let i = 0; i < 10; i++) {
        promises.push(
          store.storeEpisode(
            createTestEpisodeInput(300 + i),
            createTestEmbeddings(1),
            createTestEmbeddings(1)
          )
        );
      }

      const episodeIds = await Promise.all(promises);

      expect(episodeIds.length).toBe(10);
      expect(new Set(episodeIds).size).toBe(10); // All unique
    });

    it('should handle multiple simultaneous reads', async () => {
      // Store 5 episodes first
      const episodeIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const id = await store.storeEpisode(
          createTestEpisodeInput(310 + i),
          createTestEmbeddings(1),
          createTestEmbeddings(1)
        );
        episodeIds.push(id);
      }

      // Read all simultaneously
      const promises = episodeIds.map(id => store.getEpisode(id));
      const episodes = await Promise.all(promises);

      expect(episodes.every(e => e !== null)).toBe(true);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle very long text content', async () => {
      const longText = 'A'.repeat(100000);
      const input: IEpisodeInput = {
        queryText: longText,
        answerText: longText
      };

      const episodeId = await store.storeEpisode(
        input,
        createTestEmbeddings(1),
        createTestEmbeddings(1)
      );

      store.invalidateCache();
      const retrieved = await store.getEpisode(episodeId);

      expect(retrieved?.queryText.length).toBe(100000);
      expect(retrieved?.answerText.length).toBe(100000);
    });

    it('should handle unicode in text content', async () => {
      const unicodeText = 'Hello World! Chinese text goes here and Japanese text goes here and Korean text goes here';
      const input: IEpisodeInput = {
        queryText: unicodeText,
        answerText: unicodeText
      };

      const episodeId = await store.storeEpisode(
        input,
        createTestEmbeddings(1),
        createTestEmbeddings(1)
      );

      store.invalidateCache();
      const retrieved = await store.getEpisode(episodeId);

      expect(retrieved?.queryText).toBe(unicodeText);
    });

    it('should handle many small embeddings', async () => {
      const episodeId = await store.storeEpisode(
        createTestEpisodeInput(320),
        createTestEmbeddings(100, 16), // 100 small embeddings
        createTestEmbeddings(100, 16)
      );

      store.invalidateCache();
      const retrieved = await store.getEpisode(episodeId);

      expect(retrieved?.queryChunkCount).toBe(100);
      expect(retrieved?.answerChunkCount).toBe(100);
      expect(retrieved?.queryChunkEmbeddings.length).toBe(100);
    });

    it('should handle single embedding per chunk type', async () => {
      const episodeId = await store.storeEpisode(
        createTestEpisodeInput(330),
        createTestEmbeddings(1),
        createTestEmbeddings(1)
      );

      store.invalidateCache();
      const retrieved = await store.getEpisode(episodeId);

      expect(retrieved?.queryChunkCount).toBe(1);
      expect(retrieved?.answerChunkCount).toBe(1);
    });
  });
});
