/**
 * God Agent Episode Store Implementation
 *
 * Implements: TASK-EPISODE-001
 * Referenced by: God Agent memory system
 *
 * Provides hybrid SQLite + HNSW storage for episodic memory with:
 * - Time-based indexing for temporal queries
 * - Vector similarity search for semantic retrieval
 * - Episode relationship tracking
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { BackendSelector } from '../vector-db/backend-selector.js';
import { IHNSWBackend } from '../vector-db/hnsw-backend.js';
import { DistanceMetric } from '../vector-db/types.js';
import {
  Episode,
  EpisodeUpdateData,
  CreateEpisodeOptions,
  TimeRangeQuery,
  SimilarityQuery,
  EpisodeLink,
  EpisodeLinkType,
  EpisodeValidator,
  EpisodeStorageError,
} from './episode-types.js';
import * as queries from './episode-store-queries.js';
import { withRetrySync, withRetry } from '../validation/index.js';

/**
 * Configuration options for EpisodeStore
 */
export interface EpisodeStoreOptions {
  /** Directory for storage files (default: .god-agent) */
  storageDir?: string;
  /** SQLite database path (default: storageDir/episodes.db) */
  dbPath?: string;
  /** Vector index path (default: storageDir/episode-vectors.bin) */
  vectorPath?: string;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * SQLite row structure for episode_links table
 */
interface EpisodeLinkRow {
  source_id: string;
  target_id: string;
  link_type: string;
  created_at: number;
}

/**
 * EpisodeStore - Hybrid SQL + Vector storage for episodic memory
 *
 * Performance targets (from Constitution):
 * - Create: <5ms (p95)
 * - Time range query: <20ms (1k results)
 * - Similarity search: <50ms (top-10)
 */
export class EpisodeStore {
  private db: Database.Database;
  private vectorBackend: IHNSWBackend | null = null;
  private readonly storageDir: string;
  private readonly dbPath: string;
  private readonly vectorPath: string;
  private readonly verbose: boolean;

  // Prepared statements for performance
  private insertEpisodeStmt?: Database.Statement;
  private insertLinkStmt?: Database.Statement;
  private getEpisodeStmt?: Database.Statement;
  private updateEpisodeStmt?: Database.Statement;
  private deleteEpisodeStmt?: Database.Statement;
  private deleteLinksStmt?: Database.Statement;
  private getLinksStmt?: Database.Statement;

  constructor(options: EpisodeStoreOptions = {}) {
    this.storageDir = options.storageDir ?? '.god-agent';
    this.dbPath = options.dbPath ?? path.join(this.storageDir, 'episodes.db');
    this.vectorPath = options.vectorPath ?? path.join(this.storageDir, 'episode-vectors.bin');
    this.verbose = options.verbose ?? false;

    // Ensure storage directory exists
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    // Initialize SQLite database
    this.db = new Database(this.dbPath);
    this.initializeDatabase();
  }

  /**
   * Initialize SQLite database schema and WAL mode
   */
  private initializeDatabase(): void {
    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000'); // 64MB cache

    // Create episodes table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episodes (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        metadata TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_task_id ON episodes(task_id);
      CREATE INDEX IF NOT EXISTS idx_time_range ON episodes(start_time, end_time);
      CREATE INDEX IF NOT EXISTS idx_created_at ON episodes(created_at);
    `);

    // Create episode_links junction table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episode_links (
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        link_type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (source_id, target_id)
      );

      CREATE INDEX IF NOT EXISTS idx_link_source ON episode_links(source_id);
      CREATE INDEX IF NOT EXISTS idx_link_target ON episode_links(target_id);
    `);

    // Prepare statements for reuse
    this.insertEpisodeStmt = this.db.prepare(`
      INSERT INTO episodes (id, task_id, start_time, end_time, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertLinkStmt = this.db.prepare(`
      INSERT OR IGNORE INTO episode_links (source_id, target_id, link_type, created_at)
      VALUES (?, ?, ?, ?)
    `);

    this.getEpisodeStmt = this.db.prepare(`
      SELECT id, task_id, start_time, end_time, metadata, created_at, updated_at
      FROM episodes
      WHERE id = ?
    `);

    this.updateEpisodeStmt = this.db.prepare(`
      UPDATE episodes
      SET end_time = ?, metadata = ?, updated_at = ?
      WHERE id = ?
    `);

    this.deleteEpisodeStmt = this.db.prepare(`
      DELETE FROM episodes WHERE id = ?
    `);

    this.deleteLinksStmt = this.db.prepare(`
      DELETE FROM episode_links WHERE source_id = ? OR target_id = ?
    `);

    this.getLinksStmt = this.db.prepare(`
      SELECT target_id FROM episode_links WHERE source_id = ?
    `);
  }

  /**
   * Initialize vector backend (async, called lazily)
   */
  private async initializeVectorBackend(): Promise<void> {
    if (this.vectorBackend) return;

    const { backend } = await BackendSelector.loadBackend(1536, DistanceMetric.COSINE, {
      verbose: this.verbose,
    });

    this.vectorBackend = backend;

    // Try to load existing vectors
    try {
      await backend.load(this.vectorPath);
      if (this.verbose) {
        console.log(`[EpisodeStore] Loaded ${backend.count()} vectors from ${this.vectorPath}`);
      }
    } catch (error) {
      if (this.verbose) {
        console.log('[EpisodeStore] No existing vector index, starting fresh');
      }
    }
  }

  /**
   * Create a new episode
   *
   * @param options - Episode creation options
   * @returns Episode ID
   * @throws {EpisodeValidationError} If validation fails
   * @throws {EpisodeStorageError} If storage operation fails
   */
  async createEpisode(options: CreateEpisodeOptions): Promise<string> {
    // Validate input
    EpisodeValidator.validateCreateOptions(options);

    // Ensure vector backend is initialized
    await this.initializeVectorBackend();

    const id = options.id ?? randomUUID();
    const startTime = options.startTime ?? Date.now();
    const endTime = options.endTime ?? null;
    const linkedEpisodes = options.linkedEpisodes ?? [];
    const now = Date.now();

    const episode: Episode = {
      id,
      taskId: options.taskId,
      startTime,
      endTime,
      embedding: options.embedding,
      metadata: options.metadata,
      linkedEpisodes,
      createdAt: now,
      updatedAt: now,
    };

    try {
      // Start transaction
      const transaction = this.db.transaction(() => {
        // Insert episode metadata to SQLite
        this.insertEpisodeStmt!.run(
          episode.id,
          episode.taskId,
          episode.startTime,
          episode.endTime,
          JSON.stringify(episode.metadata),
          episode.createdAt,
          episode.updatedAt
        );

        // Insert episode links
        const linkCreatedAt = Date.now();
        for (const targetId of linkedEpisodes) {
          this.insertLinkStmt!.run(episode.id, targetId, 'semantic', linkCreatedAt);
        }

        // Insert embedding to vector index
        this.vectorBackend!.insert(episode.id, episode.embedding);
      });

      // Execute transaction with retry (RULE-072: database operations must retry)
      withRetrySync(
        () => transaction(),
        { operationName: 'EpisodeStore.createEpisode' }
      );

      if (this.verbose) {
        console.log(`[EpisodeStore] Created episode ${id} for task ${options.taskId}`);
      }

      return id;
    } catch (error) {
      throw new EpisodeStorageError(
        `Failed to create episode: ${error instanceof Error ? error.message : String(error)}`,
        error as Error
      );
    }
  }

  /**
   * Retrieve episode by ID (delegates to query module)
   */
  async getById(id: string): Promise<Episode | null> {
    await this.initializeVectorBackend();
    return queries.getById(this.db, this.vectorBackend, this.getEpisodeStmt!, this.getLinksStmt!, id);
  }

  /**
   * Query episodes by time range (delegates to query module)
   */
  async queryByTimeRange(query: TimeRangeQuery): Promise<Episode[]> {
    await this.initializeVectorBackend();
    return queries.queryByTimeRange(this.db, this.vectorBackend, this.getLinksStmt!, query);
  }

  /**
   * Search episodes by embedding similarity (delegates to query module)
   */
  async searchBySimilarity(query: SimilarityQuery): Promise<Episode[]> {
    await this.initializeVectorBackend();
    return queries.searchBySimilarity(this.vectorBackend, this.getById.bind(this), query);
  }

  /**
   * Update an existing episode
   */
  async update(id: string, updates: EpisodeUpdateData): Promise<void> {
    await this.initializeVectorBackend();

    EpisodeValidator.validateId(id);

    const existing = await this.getById(id);
    if (!existing) {
      throw new EpisodeStorageError(`Episode not found: ${id}`);
    }

    if (updates.endTime !== undefined && updates.endTime !== null) {
      EpisodeValidator.validateTimeRange(existing.startTime, updates.endTime);
    }
    if (updates.embedding !== undefined) {
      EpisodeValidator.validateEmbedding(updates.embedding);
    }
    if (updates.linkedEpisodes !== undefined) {
      EpisodeValidator.validateLinkedEpisodes(updates.linkedEpisodes);
    }

    try {
      const transaction = this.db.transaction(() => {
        const newMetadata = updates.metadata
          ? { ...existing.metadata, ...updates.metadata }
          : existing.metadata;
        const newEndTime = updates.endTime !== undefined ? updates.endTime : existing.endTime;

        this.updateEpisodeStmt!.run(newEndTime, JSON.stringify(newMetadata), Date.now(), id);

        if (updates.embedding !== undefined) {
          this.vectorBackend!.delete(id);
          this.vectorBackend!.insert(id, updates.embedding);
        }

        if (updates.linkedEpisodes !== undefined) {
          this.db.prepare('DELETE FROM episode_links WHERE source_id = ?').run(id);
          const linkCreatedAt = Date.now();
          for (const targetId of updates.linkedEpisodes) {
            this.insertLinkStmt!.run(id, targetId, 'semantic', linkCreatedAt);
          }
        }
      });

      // Execute transaction with retry (RULE-072: database operations must retry)
      withRetrySync(
        () => transaction(),
        { operationName: 'EpisodeStore.update' }
      );

      if (this.verbose) {
        console.log(`[EpisodeStore] Updated episode ${id}`);
      }
    } catch (error) {
      throw new EpisodeStorageError(
        `Failed to update episode ${id}: ${error instanceof Error ? error.message : String(error)}`,
        error as Error
      );
    }
  }

  /**
   * Delete an episode and cleanup associated data
   */
  async delete(id: string): Promise<void> {
    await this.initializeVectorBackend();
    EpisodeValidator.validateId(id);

    try {
      const transaction = this.db.transaction(() => {
        this.deleteLinksStmt!.run(id, id);
        const result = this.deleteEpisodeStmt!.run(id);
        if (result.changes === 0) {
          throw new EpisodeStorageError(`Episode not found: ${id}`);
        }
        this.vectorBackend!.delete(id);
      });

      // Execute transaction with retry (RULE-072: database operations must retry)
      withRetrySync(
        () => transaction(),
        { operationName: 'EpisodeStore.delete' }
      );

      if (this.verbose) {
        console.log(`[EpisodeStore] Deleted episode ${id}`);
      }
    } catch (error) {
      throw new EpisodeStorageError(
        `Failed to delete episode ${id}: ${error instanceof Error ? error.message : String(error)}`,
        error as Error
      );
    }
  }

  /**
   * Get all links for an episode
   */
  async getLinks(episodeId: string): Promise<EpisodeLink[]> {
    const rows = this.db.prepare(`
      SELECT source_id, target_id, link_type, created_at
      FROM episode_links
      WHERE source_id = ? OR target_id = ?
    `).all(episodeId, episodeId) as EpisodeLinkRow[];

    return rows.map(row => ({
      sourceId: row.source_id,
      targetId: row.target_id,
      linkType: row.link_type as EpisodeLinkType,
      createdAt: row.created_at,
    }));
  }

  /**
   * Save vector index to disk
   *
   * Implements: TASK-ERR-004, RULE-072 (file operations must retry)
   */
  async save(): Promise<void> {
    if (!this.vectorBackend) return;

    try {
      // Save with retry (RULE-072: file persistence must retry)
      await withRetry(
        () => this.vectorBackend!.save(this.vectorPath),
        { operationName: 'EpisodeStore.save.vectorIndex' }
      );
      if (this.verbose) {
        console.log(`[EpisodeStore] Saved ${this.vectorBackend.count()} vectors to ${this.vectorPath}`);
      }
    } catch (error) {
      throw new EpisodeStorageError(
        `Failed to save vector index: ${error instanceof Error ? error.message : String(error)}`,
        error as Error
      );
    }
  }

  /**
   * Get storage statistics
   */
  getStats(): { episodeCount: number; vectorCount: number; dbSizeBytes: number } {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM episodes').get() as { count: number };
    const stats = fs.statSync(this.dbPath);

    return {
      episodeCount: row.count,
      vectorCount: this.vectorBackend?.count() ?? 0,
      dbSizeBytes: stats.size,
    };
  }

  /**
   * Close database and save vectors
   */
  async close(): Promise<void> {
    await this.save();
    this.db.close();
  }
}
