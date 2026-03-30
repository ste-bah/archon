/**
 * DualEmbeddingStore - SQLite-backed episode storage with cache layer
 *
 * FIXED: GAP-DESC-001, GAP-DESC-004, GAP-DESC-009
 * Implements: REQ-DESC-007, REQ-DESC-009, RULE-011, RULE-015, RULE-037, RULE-040, RULE-074
 * Implements: TASK-OBS-002 - VectorDB observability wiring
 *
 * Key changes from broken implementation:
 * - PRIMARY storage is SQLite via EpisodeDAO (RULE-011)
 * - LRUCache is used as cache layer with automatic eviction (RULE-015, RULE-037)
 * - Memory tracking via sizeCalculator (RULE-040)
 * - All store() operations write to SQLite FIRST
 * - Emits observability events for cache hit/miss and storage operations
 *
 * Constitution compliance:
 * - RULE-011: All episode data MUST be stored in SQLite
 * - RULE-015: JavaScript Maps ONLY permitted for caching with eviction (LRUCache provides this)
 * - RULE-037: Maximum 1000 episodes in memory (LRUCache default)
 * - RULE-040: Total memory overhead under 200MB (tracked via sizeCalculator)
 * - RULE-074: FORBIDDEN - In-memory Map as primary storage
 */

import type {
  IStoredEpisode,
  IEpisodeInput,
  IDualEmbeddingStore
} from '../types.js';
import { DESCStorageError } from '../errors.js';
import { EpisodeDAO } from '../../database/dao/episode-dao.js';
import { getDatabaseConnection, closeDatabaseConnection, LRUCache, createEpisodeSizeCalculator, type IDatabaseConnection } from '../../database/index.js';
import { getObservabilityBus } from '../../observability/bus.js';
import { METRICS } from '../../observability/metrics.js';

/**
 * Configuration for DualEmbeddingStore
 */
export interface IDualEmbeddingStoreConfig {
  /** Path to SQLite database (uses default if not provided) */
  dbPath?: string;
  /** Maximum cache size (default: 1000) */
  cacheSize?: number;
  /** Existing database connection (optional, for testing) */
  connection?: IDatabaseConnection;
}

/**
 * DualEmbeddingStore - SQLite-backed with LRU cache layer
 *
 * ARCHITECTURE:
 * 1. SQLite (via EpisodeDAO) is the source of truth
 * 2. LRUCache provides automatic LRU eviction (TASK-DESC-005)
 * 3. All writes go to SQLite first, then cache
 * 4. Reads check cache first, fall back to SQLite (updates LRU order)
 *
 * RULE-011 COMPLIANCE: All episode data persisted to SQLite
 * RULE-015 COMPLIANCE: LRUCache provides cache-only with automatic eviction
 * RULE-037 COMPLIANCE: Maximum 1000 episodes in memory (LRUCache default)
 * RULE-040 COMPLIANCE: Memory tracking via sizeCalculator
 * RULE-074 COMPLIANCE: LRUCache is NOT primary storage
 */
export class DualEmbeddingStore implements IDualEmbeddingStore {
  /** Database connection for flush/close operations (RULE-046) */
  private readonly db: IDatabaseConnection;

  /** SQLite data access object - PRIMARY STORAGE (RULE-011) */
  private readonly dao: EpisodeDAO;

  /** LRU Cache layer ONLY - NOT primary storage (RULE-015, RULE-037) */
  private readonly cache: LRUCache<string, IStoredEpisode>;

  /** Track if store has been closed */
  private closed: boolean = false;

  constructor(config: IDualEmbeddingStoreConfig = {}) {
    // Get or create database connection
    this.db = config.connection ?? getDatabaseConnection(config.dbPath);

    // Initialize SQLite DAO - this is PRIMARY storage (RULE-011)
    this.dao = new EpisodeDAO(this.db);

    // Initialize LRU cache layer - ONLY for performance, NOT persistence (RULE-015)
    // RULE-037: Maximum 1000 episodes in memory
    // RULE-040: Memory tracking via sizeCalculator
    this.cache = new LRUCache<string, IStoredEpisode>({
      maxSize: config.cacheSize ?? 1000,
      sizeCalculator: createEpisodeSizeCalculator()
    });
  }

  /**
   * Store an episode with dual embeddings
   *
   * CRITICAL: Writes to SQLite FIRST (RULE-011)
   * Then adds to cache for read performance
   *
   * @param input - Episode data with query/answer text
   * @param queryEmbeddings - Embeddings for query chunks
   * @param answerEmbeddings - Embeddings for answer chunks
   * @returns The episodeId
   */
  async storeEpisode(
    input: IEpisodeInput,
    queryEmbeddings: Float32Array[],
    answerEmbeddings: Float32Array[]
  ): Promise<string> {
    const bus = getObservabilityBus();
    const startTime = Date.now();
    const embeddingCount = queryEmbeddings.length + answerEmbeddings.length;

    bus.emit({
      component: 'vectordb',
      operation: 'vectordb_insert_started',
      status: 'running',
      metadata: {
        storeType: 'dual_embedding',
        queryChunks: queryEmbeddings.length,
        answerChunks: answerEmbeddings.length,
        totalEmbeddings: embeddingCount
      }
    });

    try {
      // Validate input
      if (!input.queryText || !input.answerText) {
        throw new DESCStorageError('queryText and answerText are required');
      }
      if (!queryEmbeddings.length || !answerEmbeddings.length) {
        throw new DESCStorageError('queryEmbeddings and answerEmbeddings are required');
      }

      // Generate episodeId
      const episodeId = this.generateEpisodeId();

      // Check for duplicate in SQLite (RULE-011: SQLite is source of truth)
      if (this.dao.exists(episodeId)) {
        throw new DESCStorageError(
          `Episode ${episodeId} already exists`,
          { episodeId }
        );
      }

      // Create stored episode
      const storedEpisode: IStoredEpisode = {
        episodeId,
        queryText: input.queryText,
        answerText: input.answerText,
        queryChunkEmbeddings: queryEmbeddings,
        answerChunkEmbeddings: answerEmbeddings,
        queryChunkCount: queryEmbeddings.length,
        answerChunkCount: answerEmbeddings.length,
        createdAt: new Date(),
        metadata: input.metadata
      };

      // CRITICAL: Write to SQLite FIRST (RULE-011)
      this.dao.insert(storedEpisode);

      // Then add to cache for read performance (LRUCache handles eviction automatically)
      this.cache.set(episodeId, storedEpisode);

      const latencyMs = Date.now() - startTime;
      bus.emit({
        component: 'vectordb',
        operation: 'vectordb_insert_completed',
        status: 'success',
        durationMs: latencyMs,
        metadata: {
          storeType: 'dual_embedding',
          episodeId,
          embeddingCount,
          latencyMs
        }
      });

      METRICS.vectordbSearchCount.inc({ operation: 'dual_embedding_store', status: 'success' });

      return episodeId;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      bus.emit({
        component: 'vectordb',
        operation: 'vectordb_insert_completed',
        status: 'error',
        durationMs: latencyMs,
        metadata: {
          storeType: 'dual_embedding',
          error: error instanceof Error ? error.message : String(error),
          latencyMs
        }
      });

      METRICS.vectordbSearchCount.inc({ operation: 'dual_embedding_store', status: 'error' });

      if (error instanceof DESCStorageError) {
        throw error;
      }
      throw new DESCStorageError(
        `Failed to store episode: ${error instanceof Error ? error.message : String(error)}`,
        { originalError: error }
      );
    }
  }

  /**
   * Generate unique episode ID
   */
  private generateEpisodeId(): string {
    return `ep-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Retrieve an episode by ID
   *
   * Checks cache first, falls back to SQLite
   *
   * @param episodeId - Unique episode identifier
   * @returns The stored episode or null if not found
   */
  async getEpisode(episodeId: string): Promise<IStoredEpisode | null> {
    const bus = getObservabilityBus();
    const startTime = Date.now();

    bus.emit({
      component: 'vectordb',
      operation: 'vectordb_search_started',
      status: 'running',
      metadata: { storeType: 'dual_embedding', episodeId }
    });

    try {
      // Check cache first (LRUCache.get() updates LRU order and tracks hits/misses)
      const cached = this.cache.get(episodeId);
      if (cached !== undefined) {
        const latencyMs = Date.now() - startTime;

        // Emit cache hit event
        bus.emit({
          component: 'vectordb',
          operation: 'vectordb_cache_hit',
          status: 'success',
          durationMs: latencyMs,
          metadata: { storeType: 'dual_embedding', episodeId, latencyMs }
        });

        METRICS.memoryCacheHit.inc({ cache_type: 'dual_embedding', tier: 'lru' });

        bus.emit({
          component: 'vectordb',
          operation: 'vectordb_search_completed',
          status: 'success',
          durationMs: latencyMs,
          metadata: { storeType: 'dual_embedding', episodeId, source: 'cache', latencyMs }
        });

        return cached;
      }

      // Emit cache miss event
      bus.emit({
        component: 'vectordb',
        operation: 'vectordb_cache_miss',
        status: 'success',
        metadata: { storeType: 'dual_embedding', episodeId }
      });

      METRICS.memoryCacheMiss.inc({ cache_type: 'dual_embedding', tier: 'lru' });

      // Fall back to SQLite (RULE-011: source of truth)
      const episode = this.dao.findById(episodeId);

      if (episode) {
        // Populate cache for future reads (LRUCache handles eviction automatically)
        this.cache.set(episodeId, episode);
      }

      const latencyMs = Date.now() - startTime;
      bus.emit({
        component: 'vectordb',
        operation: 'vectordb_search_completed',
        status: 'success',
        durationMs: latencyMs,
        metadata: {
          storeType: 'dual_embedding',
          episodeId,
          source: 'sqlite',
          found: episode !== null,
          latencyMs
        }
      });

      return episode;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      bus.emit({
        component: 'vectordb',
        operation: 'vectordb_search_completed',
        status: 'error',
        durationMs: latencyMs,
        metadata: {
          storeType: 'dual_embedding',
          episodeId,
          error: error instanceof Error ? error.message : String(error),
          latencyMs
        }
      });

      throw new DESCStorageError(
        `Failed to retrieve episode: ${error instanceof Error ? error.message : String(error)}`,
        { episodeId, originalError: error }
      );
    }
  }

  /**
   * Get all stored episodes
   *
   * Reads from SQLite (source of truth) to ensure completeness
   *
   * @returns Array of all stored episodes
   */
  async getAllEpisodes(): Promise<IStoredEpisode[]> {
    const bus = getObservabilityBus();
    const startTime = Date.now();

    bus.emit({
      component: 'vectordb',
      operation: 'vectordb_batch_operation',
      status: 'running',
      metadata: { operationType: 'get_all', storeType: 'dual_embedding' }
    });

    try {
      // Always read from SQLite for complete list (RULE-011)
      const episodes = this.dao.findAll();

      // Populate cache with results (LRUCache handles eviction automatically)
      for (const episode of episodes) {
        if (!this.cache.has(episode.episodeId)) {
          this.cache.set(episode.episodeId, episode);
        }
      }

      const latencyMs = Date.now() - startTime;
      bus.emit({
        component: 'vectordb',
        operation: 'vectordb_batch_operation',
        status: 'success',
        durationMs: latencyMs,
        metadata: {
          operationType: 'get_all',
          storeType: 'dual_embedding',
          resultCount: episodes.length,
          latencyMs
        }
      });

      return episodes;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      bus.emit({
        component: 'vectordb',
        operation: 'vectordb_batch_operation',
        status: 'error',
        durationMs: latencyMs,
        metadata: {
          operationType: 'get_all',
          storeType: 'dual_embedding',
          error: error instanceof Error ? error.message : String(error),
          latencyMs
        }
      });

      throw new DESCStorageError(
        `Failed to retrieve all episodes: ${error instanceof Error ? error.message : String(error)}`,
        { originalError: error }
      );
    }
  }

  /**
   * Delete an episode by ID
   *
   * RULE-016 VIOLATION: Episodes are append-only. DELETE operations are FORBIDDEN.
   * Exception: Compaction with explicit human approval (not implemented here).
   *
   * @param _episodeId - Episode ID (unused - operation forbidden)
   * @throws DESCStorageError Always throws - DELETE is forbidden per RULE-016
   */
  async deleteEpisode(_episodeId: string): Promise<never> {
    throw new DESCStorageError(
      'RULE-016 VIOLATION: Episodes are append-only. DELETE operations are FORBIDDEN. ' +
      'Exception: Compaction with explicit human approval requires separate implementation.',
      { rule: 'RULE-016' }
    );
  }

  /**
   * Get episode count from SQLite
   */
  getEpisodeCount(): number {
    return this.dao.count();
  }

  /**
   * Clear cache only - Database clearing is FORBIDDEN per RULE-016
   *
   * RULE-016 COMPLIANCE: This method only clears the in-memory cache layer.
   * Database episodes are append-only and cannot be cleared.
   * Exception: Compaction with explicit human approval requires separate implementation.
   *
   * Use this for:
   * - Memory pressure relief
   * - Cache invalidation scenarios
   * - Testing cache behavior (not database behavior)
   */
  async clearCache(): Promise<void> {
    // RULE-016 COMPLIANCE: Only clear cache, NOT database
    // LRUCache.clear() resets hits/misses internally
    this.cache.clear();
  }

  /**
   * Clear all episodes
   *
   * RULE-016 VIOLATION: Episodes are append-only. CLEAR operations are FORBIDDEN.
   * Exception: Compaction with explicit human approval (not implemented here).
   *
   * @throws DESCStorageError Always throws - CLEAR is forbidden per RULE-016
   * @deprecated Use clearCache() to clear only the cache layer
   */
  async clear(): Promise<never> {
    throw new DESCStorageError(
      'RULE-016 VIOLATION: Episodes are append-only. CLEAR operations are FORBIDDEN. ' +
      'Use clearCache() to clear only the in-memory cache layer. ' +
      'Exception: Compaction with explicit human approval requires separate implementation.',
      { rule: 'RULE-016' }
    );
  }

  /**
   * Get storage statistics including cache performance
   */
  getStats(): {
    episodeCount: number;
    totalQueryChunks: number;
    totalAnswerChunks: number;
    avgQueryChunksPerEpisode: number;
    avgAnswerChunksPerEpisode: number;
    cacheSize: number;
    cacheHitRate: number;
  } {
    const daoStats = this.dao.getStats();
    const cacheMetrics = this.cache.getMetrics();

    return {
      ...daoStats,
      cacheSize: cacheMetrics.size,
      cacheHitRate: cacheMetrics.hitRate
    };
  }

  /**
   * Invalidate cache (for testing or recovery scenarios)
   *
   * Uses LRUCache.clear() which resets hits/misses internally
   */
  invalidateCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache metrics for monitoring
   *
   * Delegates to LRUCache.getMetrics() for accurate tracking
   * Includes eviction count and memory usage (RULE-040)
   */
  getCacheMetrics(): {
    size: number;
    maxSize: number;
    hits: number;
    misses: number;
    hitRate: number;
    evictions: number;
    memoryBytes: number;
  } {
    const metrics = this.cache.getMetrics();
    return {
      size: metrics.size,
      maxSize: metrics.maxSize,
      hits: metrics.hits,
      misses: metrics.misses,
      hitRate: metrics.hitRate,
      evictions: metrics.evictions,
      memoryBytes: metrics.memoryBytes
    };
  }

  // ============================================================
  // PERSISTENCE METHODS (TASK-DESC-004)
  // Implements: REQ-DESC-003, GAP-DESC-003, RULE-046, RULE-049
  // ============================================================

  /**
   * Force WAL checkpoint to ensure all data is persisted to disk
   *
   * Implements: RULE-046 (atomic operations)
   *
   * Call this method:
   * - Before application shutdown
   * - After critical batch operations
   * - Periodically for long-running processes
   */
  flush(): void {
    if (this.closed) {
      throw new DESCStorageError('Cannot flush: store is closed');
    }

    try {
      // Force WAL checkpoint (RULE-046)
      this.db.checkpoint();
    } catch (error) {
      throw new DESCStorageError(
        `Failed to flush database: ${error instanceof Error ? error.message : String(error)}`,
        { originalError: error }
      );
    }
  }

  /**
   * Gracefully close the DualEmbeddingStore
   *
   * Implements: RULE-008, RULE-009 (persistence and state recovery)
   *
   * This method:
   * 1. Flushes WAL checkpoint to ensure all data is persisted
   * 2. Clears the in-memory cache
   * 3. Closes the database connection
   *
   * IMPORTANT: After close(), the store cannot be used.
   * Create a new instance if you need to continue operations.
   */
  close(): void {
    if (this.closed) {
      return; // Already closed, no-op
    }

    try {
      // 1. Flush WAL checkpoint to ensure all data persisted (RULE-046)
      this.flush();

      // 2. Clear cache to free memory (LRUCache.clear() resets metrics internally)
      this.cache.clear();

      // 3. Close database connection
      closeDatabaseConnection();

      // 4. Mark as closed
      this.closed = true;
    } catch (error) {
      throw new DESCStorageError(
        `Failed to close store: ${error instanceof Error ? error.message : String(error)}`,
        { originalError: error }
      );
    }
  }

  /**
   * Check if the store is healthy and operational
   *
   * Implements: RULE-049, RULE-050 (health checks and diagnostics)
   *
   * Verifies:
   * - Store is not closed
   * - Database connection is healthy
   * - Basic operations succeed
   *
   * @returns true if store is healthy, false otherwise
   */
  isHealthy(): boolean {
    // Check if closed
    if (this.closed) {
      return false;
    }

    try {
      // Verify database connection is healthy
      if (!this.db.isHealthy()) {
        return false;
      }

      // Verify we can perform basic operations
      const count = this.dao.count();
      return count >= 0;
    } catch {
      // INTENTIONAL: Health check operation failure - return false as unhealthy
      return false;
    }
  }

  /**
   * Check if the store has been closed
   *
   * @returns true if close() has been called
   */
  isClosed(): boolean {
    return this.closed;
  }
}
