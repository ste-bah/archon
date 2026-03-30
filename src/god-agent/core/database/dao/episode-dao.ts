/**
 * EpisodeDAO - Data Access Object for Episode persistence
 *
 * Implements: GAP-DESC-001, GAP-DESC-004, GAP-DESC-007
 * Constitution: RULE-011 (SQLite for all episode data), RULE-016 (append-only), RULE-023 (indexes)
 *
 * This DAO provides SQLite-backed persistence for DESC episodes.
 * CRITICAL: All episode data MUST be stored in SQLite (RULE-011)
 */

import type { IDatabaseConnection } from '../connection.js';
import type { IStoredEpisode, IEpisodeInput } from '../../ucm/types.js';
import type Database from 'better-sqlite3';
import { withRetrySync, type IRetryOptions } from '../../validation/index.js';

/**
 * Database row representation for episodes
 * Matches the episodes.sql schema
 */
interface IEpisodeRow {
  id: string;
  query_text: string;
  answer_text: string;
  query_embeddings: Buffer;
  answer_embeddings: Buffer;
  query_chunk_count: number;
  answer_chunk_count: number;
  created_at: string;
  metadata: string | null;
  trajectory_id: string | null;
  reasoning_trace: string | null;
  trajectory_linked_at: string | null;
}

/**
 * Episode count result
 */
interface ICountResult {
  count: number;
}

/**
 * EpisodeDAO - SQLite-backed episode persistence
 *
 * Provides CRUD operations for DESC episodes with proper serialization
 * of Float32Array embeddings to/from SQLite BLOB storage.
 */
export class EpisodeDAO {
  private insertStmt: Database.Statement<unknown[], unknown> | null = null;
  private selectByIdStmt: Database.Statement<unknown[], unknown> | null = null;
  private selectAllStmt: Database.Statement<unknown[], unknown> | null = null;
  private countStmt: Database.Statement<unknown[], unknown> | null = null;
  // RULE-016 COMPLIANCE: DELETE statements removed - episodes are append-only

  constructor(private readonly db: IDatabaseConnection) {
    this.ensureSchema();
    this.prepareStatements();
  }

  /**
   * Ensure the DESC episodes table exists
   * Uses separate table from main episodes to avoid schema conflicts
   */
  private ensureSchema(): void {
    this.db.db.exec(`
      CREATE TABLE IF NOT EXISTS desc_episodes (
        id TEXT PRIMARY KEY NOT NULL,
        query_text TEXT NOT NULL,
        answer_text TEXT NOT NULL,
        query_embeddings BLOB NOT NULL,
        answer_embeddings BLOB NOT NULL,
        query_chunk_count INTEGER NOT NULL,
        answer_chunk_count INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        metadata TEXT,
        trajectory_id TEXT,
        reasoning_trace TEXT,
        trajectory_linked_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_desc_episodes_created
        ON desc_episodes(created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_desc_episodes_trajectory
        ON desc_episodes(trajectory_id)
        WHERE trajectory_id IS NOT NULL;
    `);
  }

  /**
   * Prepare SQL statements for performance
   */
  private prepareStatements(): void {
    this.insertStmt = this.db.prepare(`
      INSERT INTO desc_episodes (
        id, query_text, answer_text, query_embeddings, answer_embeddings,
        query_chunk_count, answer_chunk_count, created_at, metadata,
        trajectory_id, reasoning_trace, trajectory_linked_at
      ) VALUES (
        @id, @queryText, @answerText, @queryEmbeddings, @answerEmbeddings,
        @queryChunkCount, @answerChunkCount, @createdAt, @metadata,
        @trajectoryId, @reasoningTrace, @trajectoryLinkedAt
      )
    `);

    this.selectByIdStmt = this.db.prepare(`
      SELECT * FROM desc_episodes WHERE id = ?
    `);

    this.selectAllStmt = this.db.prepare(`
      SELECT * FROM desc_episodes ORDER BY created_at DESC
    `);

    this.countStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM desc_episodes
    `);

    // RULE-016 COMPLIANCE: No DELETE statements prepared
    // Episodes are append-only per Constitution RULE-016
  }

  /**
   * Insert an episode into SQLite
   *
   * Implements: TASK-ERR-004, RULE-072 (database retry on failure)
   * Uses exponential backoff: 100ms, 200ms, 400ms
   *
   * @param episode - The stored episode to persist
   * @throws Error if insert fails after all retry attempts
   */
  insert(episode: IStoredEpisode): void {
    const params = {
      id: episode.episodeId,
      queryText: episode.queryText,
      answerText: episode.answerText,
      queryEmbeddings: this.serializeEmbeddings(episode.queryChunkEmbeddings),
      answerEmbeddings: this.serializeEmbeddings(episode.answerChunkEmbeddings),
      queryChunkCount: episode.queryChunkCount,
      answerChunkCount: episode.answerChunkCount,
      createdAt: episode.createdAt.toISOString(),
      metadata: episode.metadata ? JSON.stringify(episode.metadata) : null,
      trajectoryId: episode.trajectoryId ?? null,
      reasoningTrace: episode.reasoningTrace ?? null,
      trajectoryLinkedAt: episode.trajectoryLinkedAt?.toISOString() ?? null
    };

    // RULE-072: Database operations MUST retry on failure (max 3 attempts)
    withRetrySync(
      () => this.insertStmt!.run(params),
      { operationName: 'EpisodeDAO.insert' }
    );
  }

  /**
   * Find an episode by ID
   *
   * @param episodeId - The episode ID to find
   * @returns The stored episode or null if not found
   */
  findById(episodeId: string): IStoredEpisode | null {
    const row = this.selectByIdStmt!.get(episodeId) as IEpisodeRow | undefined;
    if (!row) return null;
    return this.rowToEpisode(row);
  }

  /**
   * Get all stored episodes
   *
   * @returns Array of all stored episodes (newest first)
   */
  findAll(): IStoredEpisode[] {
    const rows = this.selectAllStmt!.all() as IEpisodeRow[];
    return rows.map(row => this.rowToEpisode(row));
  }

  /**
   * Get the count of stored episodes
   *
   * @returns The number of episodes in storage
   */
  count(): number {
    const result = this.countStmt!.get() as ICountResult;
    return result.count;
  }

  /**
   * Delete an episode by ID
   *
   * RULE-016 VIOLATION: Episodes are append-only. DELETE operations are FORBIDDEN.
   * Exception: Compaction with explicit human approval (not implemented here).
   *
   * @param _episodeId - The episode ID (unused - operation forbidden)
   * @throws Error Always throws - DELETE is forbidden per RULE-016
   */
  delete(_episodeId: string): never {
    throw new Error(
      'RULE-016 VIOLATION: Episodes are append-only. DELETE operations are FORBIDDEN. ' +
      'Exception: Compaction with explicit human approval requires separate implementation.'
    );
  }

  /**
   * Clear all episodes
   *
   * RULE-016 VIOLATION: Episodes are append-only. DELETE/CLEAR operations are FORBIDDEN.
   * Exception: Compaction with explicit human approval (not implemented here).
   *
   * @throws Error Always throws - CLEAR is forbidden per RULE-016
   */
  clear(): never {
    throw new Error(
      'RULE-016 VIOLATION: Episodes are append-only. CLEAR operations are FORBIDDEN. ' +
      'Exception: Compaction with explicit human approval requires separate implementation.'
    );
  }

  /**
   * Check if an episode exists
   *
   * @param episodeId - The episode ID to check
   * @returns True if the episode exists
   */
  exists(episodeId: string): boolean {
    return this.findById(episodeId) !== null;
  }

  /**
   * Serialize Float32Array[] to Buffer for SQLite BLOB storage
   */
  private serializeEmbeddings(embeddings: Float32Array[]): Buffer {
    // Format: [count:4bytes][length1:4bytes][data1:length1*4bytes][length2:4bytes][data2:length2*4bytes]...
    const count = embeddings.length;
    let totalBytes = 4; // count header

    for (const emb of embeddings) {
      totalBytes += 4 + emb.length * 4; // length header + data
    }

    const buffer = Buffer.alloc(totalBytes);
    let offset = 0;

    // Write count
    buffer.writeUInt32LE(count, offset);
    offset += 4;

    // Write each embedding
    for (const emb of embeddings) {
      buffer.writeUInt32LE(emb.length, offset);
      offset += 4;

      for (let i = 0; i < emb.length; i++) {
        buffer.writeFloatLE(emb[i], offset);
        offset += 4;
      }
    }

    return buffer;
  }

  /**
   * Deserialize Buffer from SQLite BLOB to Float32Array[]
   */
  private deserializeEmbeddings(buffer: Buffer): Float32Array[] {
    const embeddings: Float32Array[] = [];
    let offset = 0;

    // Read count
    const count = buffer.readUInt32LE(offset);
    offset += 4;

    // Read each embedding
    for (let i = 0; i < count; i++) {
      const length = buffer.readUInt32LE(offset);
      offset += 4;

      const embedding = new Float32Array(length);
      for (let j = 0; j < length; j++) {
        embedding[j] = buffer.readFloatLE(offset);
        offset += 4;
      }
      embeddings.push(embedding);
    }

    return embeddings;
  }

  /**
   * Convert a database row to an IStoredEpisode
   */
  private rowToEpisode(row: IEpisodeRow): IStoredEpisode {
    return {
      episodeId: row.id,
      queryText: row.query_text,
      answerText: row.answer_text,
      queryChunkEmbeddings: this.deserializeEmbeddings(row.query_embeddings),
      answerChunkEmbeddings: this.deserializeEmbeddings(row.answer_embeddings),
      queryChunkCount: row.query_chunk_count,
      answerChunkCount: row.answer_chunk_count,
      createdAt: new Date(row.created_at),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      trajectoryId: row.trajectory_id ?? undefined,
      reasoningTrace: row.reasoning_trace ?? undefined,
      trajectoryLinkedAt: row.trajectory_linked_at ? new Date(row.trajectory_linked_at) : undefined
    };
  }

  /**
   * Get storage statistics
   */
  getStats(): {
    episodeCount: number;
    totalQueryChunks: number;
    totalAnswerChunks: number;
    avgQueryChunksPerEpisode: number;
    avgAnswerChunksPerEpisode: number;
  } {
    const countResult = this.db.prepare(`
      SELECT
        COUNT(*) as count,
        COALESCE(SUM(query_chunk_count), 0) as total_query,
        COALESCE(SUM(answer_chunk_count), 0) as total_answer
      FROM desc_episodes
    `).get() as { count: number; total_query: number; total_answer: number };

    const episodeCount = countResult.count;
    const totalQueryChunks = countResult.total_query;
    const totalAnswerChunks = countResult.total_answer;

    return {
      episodeCount,
      totalQueryChunks,
      totalAnswerChunks,
      avgQueryChunksPerEpisode: episodeCount > 0 ? totalQueryChunks / episodeCount : 0,
      avgAnswerChunksPerEpisode: episodeCount > 0 ? totalAnswerChunks / episodeCount : 0
    };
  }
}
