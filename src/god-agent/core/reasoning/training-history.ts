/**
 * Training History Manager - TASK-GNN-004
 *
 * Implements loss history persistence for GNN training progress tracking.
 * Loss values survive restarts per Constitution RULE-009 (Zero data loss).
 *
 * Implements:
 * - RULE-008: Persist to SQLite
 * - RULE-009: Zero data loss - training history survives restarts
 * - RULE-072: Database operations retry on failure (max 3 attempts)
 *
 * Performance targets:
 * - recordBatch: <5ms per record
 * - getHistory: <10ms for 1000 records
 * - getLossTrend: <5ms for window of 100
 *
 * @module src/god-agent/core/reasoning/training-history
 */

import type { IDatabaseConnection } from '../database/connection.js';
import type Database from 'better-sqlite3';
import { withRetrySync, type IRetryOptions } from '../validation/retry.js';

/**
 * Training record for a single batch during GNN training
 *
 * Represents one training iteration with associated metrics
 */
export interface TrainingRecord {
  /** Unique identifier for this record (format: "train_{epoch}_{batch}_{timestamp}") */
  id: string;
  /** Training epoch number (0-indexed) */
  epoch: number;
  /** Batch index within the epoch */
  batchIndex: number;
  /** Training loss value for this batch */
  loss: number;
  /** Optional validation loss if validation was performed */
  validationLoss?: number;
  /** Learning rate used for this batch */
  learningRate: number;
  /** Number of samples in this batch */
  samplesCount: number;
  /** Optional path to checkpoint file if checkpoint was saved */
  checkpointPath?: string;
  /** Timestamp when record was created */
  createdAt?: Date;
}

/**
 * Database row representation for training history
 * Maps to gnn_training_history table schema
 */
interface ITrainingHistoryRow {
  id: string;
  epoch: number;
  batch_index: number;
  loss: number;
  validation_loss: number | null;
  learning_rate: number;
  samples_count: number;
  created_at: string;
  checkpoint_path: string | null;
}

/**
 * Count result from SQL query
 */
interface ICountResult {
  count: number;
}

/**
 * Loss aggregate result from SQL query
 */
interface ILossResult {
  loss: number;
}

/**
 * Training statistics summary
 */
export interface ITrainingStats {
  /** Total number of training records */
  totalRecords: number;
  /** Number of unique epochs */
  uniqueEpochs: number;
  /** Lowest loss value recorded */
  minLoss: number;
  /** Highest loss value recorded */
  maxLoss: number;
  /** Average loss across all records */
  averageLoss: number;
  /** Total samples processed */
  totalSamples: number;
  /** Latest learning rate */
  latestLearningRate: number;
}

/**
 * TrainingHistoryManager - SQLite-backed training history persistence
 *
 * Provides CRUD operations for GNN training records with proper
 * retry logic and transaction support per Constitution RULE-008, RULE-009, RULE-072.
 *
 * @example
 * ```typescript
 * const manager = new TrainingHistoryManager(dbConnection);
 *
 * // Record a training batch
 * await manager.recordBatch({
 *   id: 'train_0_0_1234567890',
 *   epoch: 0,
 *   batchIndex: 0,
 *   loss: 0.5,
 *   learningRate: 0.001,
 *   samplesCount: 32
 * });
 *
 * // Get loss trend
 * const trend = await manager.getLossTrend(10);
 * console.log('Loss trend:', trend);
 * ```
 */
export class TrainingHistoryManager {
  private insertStmt: Database.Statement<unknown[], unknown> | null = null;
  private selectByIdStmt: Database.Statement<unknown[], unknown> | null = null;
  private selectAllStmt: Database.Statement<unknown[], unknown> | null = null;
  private selectByEpochRangeStmt: Database.Statement<unknown[], unknown> | null = null;
  private selectLatestLossStmt: Database.Statement<unknown[], unknown> | null = null;
  private selectRecentLossesStmt: Database.Statement<unknown[], unknown> | null = null;
  private countStmt: Database.Statement<unknown[], unknown> | null = null;
  private deleteOlderThanStmt: Database.Statement<unknown[], unknown> | null = null;

  /**
   * Create a new TrainingHistoryManager
   *
   * @param db - Database connection implementing IDatabaseConnection
   */
  constructor(private readonly db: IDatabaseConnection) {
    this.ensureSchema();
    this.prepareStatements();
  }

  /**
   * Ensure the training history table and indexes exist
   * Implements: RULE-008 (SQLite persistence), RULE-023 (indexes)
   */
  private ensureSchema(): void {
    this.db.db.exec(`
      CREATE TABLE IF NOT EXISTS gnn_training_history (
        id TEXT PRIMARY KEY,
        epoch INTEGER NOT NULL,
        batch_index INTEGER NOT NULL,
        loss REAL NOT NULL,
        validation_loss REAL,
        learning_rate REAL NOT NULL,
        samples_count INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        checkpoint_path TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_training_epoch
        ON gnn_training_history(epoch);

      CREATE INDEX IF NOT EXISTS idx_training_created
        ON gnn_training_history(created_at);

      CREATE INDEX IF NOT EXISTS idx_training_loss
        ON gnn_training_history(loss);
    `);
  }

  /**
   * Prepare SQL statements for performance
   * Pre-compiled statements reduce parsing overhead
   */
  private prepareStatements(): void {
    this.insertStmt = this.db.prepare(`
      INSERT INTO gnn_training_history (
        id, epoch, batch_index, loss, validation_loss,
        learning_rate, samples_count, created_at, checkpoint_path
      ) VALUES (
        @id, @epoch, @batchIndex, @loss, @validationLoss,
        @learningRate, @samplesCount, @createdAt, @checkpointPath
      )
    `);

    this.selectByIdStmt = this.db.prepare(`
      SELECT * FROM gnn_training_history WHERE id = ?
    `);

    this.selectAllStmt = this.db.prepare(`
      SELECT * FROM gnn_training_history ORDER BY created_at DESC
    `);

    this.selectByEpochRangeStmt = this.db.prepare(`
      SELECT * FROM gnn_training_history
      WHERE epoch >= @startEpoch AND epoch <= @endEpoch
      ORDER BY epoch ASC, batch_index ASC
    `);

    this.selectLatestLossStmt = this.db.prepare(`
      SELECT loss FROM gnn_training_history
      ORDER BY created_at DESC LIMIT 1
    `);

    this.selectRecentLossesStmt = this.db.prepare(`
      SELECT loss FROM gnn_training_history
      ORDER BY created_at DESC LIMIT ?
    `);

    this.countStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM gnn_training_history
    `);

    this.deleteOlderThanStmt = this.db.prepare(`
      DELETE FROM gnn_training_history WHERE created_at < ?
    `);
  }

  /**
   * Record a training batch result
   *
   * Implements: RULE-009 (Zero data loss), RULE-072 (retry on failure)
   * Uses exponential backoff: 100ms, 200ms, 400ms
   *
   * @param record - Training record to persist
   * @throws Error if insert fails after all retry attempts
   */
  async recordBatch(record: TrainingRecord): Promise<void> {
    const params = {
      id: record.id,
      epoch: record.epoch,
      batchIndex: record.batchIndex,
      loss: record.loss,
      validationLoss: record.validationLoss ?? null,
      learningRate: record.learningRate,
      samplesCount: record.samplesCount,
      createdAt: record.createdAt?.toISOString() ?? new Date().toISOString(),
      checkpointPath: record.checkpointPath ?? null,
    };

    // RULE-072: Database operations MUST retry on failure (max 3 attempts)
    withRetrySync(
      () => this.insertStmt!.run(params),
      { operationName: 'TrainingHistoryManager.recordBatch' }
    );
  }

  /**
   * Record multiple training batches in a single transaction
   *
   * Implements: RULE-046 (atomic operations), RULE-009 (Zero data loss)
   * All records are inserted atomically - either all succeed or none do.
   *
   * @param records - Array of training records to persist
   * @throws Error if transaction fails
   */
  async recordBatchBulk(records: TrainingRecord[]): Promise<void> {
    if (records.length === 0) return;

    this.db.transaction(() => {
      for (const record of records) {
        const params = {
          id: record.id,
          epoch: record.epoch,
          batchIndex: record.batchIndex,
          loss: record.loss,
          validationLoss: record.validationLoss ?? null,
          learningRate: record.learningRate,
          samplesCount: record.samplesCount,
          createdAt: record.createdAt?.toISOString() ?? new Date().toISOString(),
          checkpointPath: record.checkpointPath ?? null,
        };
        this.insertStmt!.run(params);
      }
    });
  }

  /**
   * Get training history with optional epoch range filter
   *
   * @param epochRange - Optional range to filter by epoch
   * @returns Array of training records (ordered by epoch/batch for ranges, by created_at DESC otherwise)
   */
  async getHistory(epochRange?: { start: number; end: number }): Promise<TrainingRecord[]> {
    let rows: ITrainingHistoryRow[];

    if (epochRange) {
      rows = this.selectByEpochRangeStmt!.all({
        startEpoch: epochRange.start,
        endEpoch: epochRange.end,
      }) as ITrainingHistoryRow[];
    } else {
      rows = this.selectAllStmt!.all() as ITrainingHistoryRow[];
    }

    return rows.map(row => this.rowToRecord(row));
  }

  /**
   * Get the most recent loss value
   *
   * @returns Latest loss value or null if no records exist
   */
  async getLatestLoss(): Promise<number | null> {
    const result = this.selectLatestLossStmt!.get() as ILossResult | undefined;
    return result?.loss ?? null;
  }

  /**
   * Get loss trend as an array of recent loss values
   *
   * Returns loss values in chronological order (oldest to newest)
   * to facilitate trend analysis.
   *
   * @param windowSize - Number of recent losses to retrieve
   * @returns Array of loss values (oldest to newest)
   */
  async getLossTrend(windowSize: number): Promise<number[]> {
    const rows = this.selectRecentLossesStmt!.all(windowSize) as ILossResult[];
    // Reverse to get chronological order (oldest to newest)
    return rows.map(row => row.loss).reverse();
  }

  /**
   * Cleanup old training records
   *
   * Removes records older than the specified date.
   * Use with caution - this permanently deletes historical data.
   *
   * @param olderThan - Delete records created before this date
   * @returns Number of records deleted
   */
  async cleanup(olderThan: Date): Promise<number> {
    const result = this.deleteOlderThanStmt!.run(olderThan.toISOString());
    return result.changes;
  }

  /**
   * Get a specific training record by ID
   *
   * @param recordId - Record ID to find
   * @returns Training record or null if not found
   */
  async findById(recordId: string): Promise<TrainingRecord | null> {
    const row = this.selectByIdStmt!.get(recordId) as ITrainingHistoryRow | undefined;
    if (!row) return null;
    return this.rowToRecord(row);
  }

  /**
   * Get the count of training records
   *
   * @returns Total number of records
   */
  async count(): Promise<number> {
    const result = this.countStmt!.get() as ICountResult;
    return result.count;
  }

  /**
   * Check if a training record exists
   *
   * @param recordId - Record ID to check
   * @returns True if record exists
   */
  async exists(recordId: string): Promise<boolean> {
    const record = await this.findById(recordId);
    return record !== null;
  }

  /**
   * Get training statistics summary
   *
   * @returns Statistics about all training records
   */
  async getStats(): Promise<ITrainingStats> {
    const statsQuery = this.db.prepare(`
      SELECT
        COUNT(*) as total_records,
        COUNT(DISTINCT epoch) as unique_epochs,
        MIN(loss) as min_loss,
        MAX(loss) as max_loss,
        AVG(loss) as avg_loss,
        SUM(samples_count) as total_samples
      FROM gnn_training_history
    `);

    const latestLrQuery = this.db.prepare(`
      SELECT learning_rate FROM gnn_training_history
      ORDER BY created_at DESC LIMIT 1
    `);

    const stats = statsQuery.get() as {
      total_records: number;
      unique_epochs: number;
      min_loss: number | null;
      max_loss: number | null;
      avg_loss: number | null;
      total_samples: number | null;
    };

    const latestLr = latestLrQuery.get() as { learning_rate: number } | undefined;

    return {
      totalRecords: stats.total_records,
      uniqueEpochs: stats.unique_epochs,
      minLoss: stats.min_loss ?? 0,
      maxLoss: stats.max_loss ?? 0,
      averageLoss: stats.avg_loss ?? 0,
      totalSamples: stats.total_samples ?? 0,
      latestLearningRate: latestLr?.learning_rate ?? 0,
    };
  }

  /**
   * Get loss values for a specific epoch
   *
   * @param epoch - Epoch number to query
   * @returns Array of training records for that epoch
   */
  async getEpochHistory(epoch: number): Promise<TrainingRecord[]> {
    return this.getHistory({ start: epoch, end: epoch });
  }

  /**
   * Calculate the average loss for a specific epoch
   *
   * @param epoch - Epoch number to calculate average for
   * @returns Average loss or null if no records for that epoch
   */
  async getEpochAverageLoss(epoch: number): Promise<number | null> {
    const query = this.db.prepare(`
      SELECT AVG(loss) as avg_loss FROM gnn_training_history WHERE epoch = ?
    `);
    const result = query.get(epoch) as { avg_loss: number | null } | undefined;
    return result?.avg_loss ?? null;
  }

  /**
   * Get the best (lowest) loss and its associated record
   *
   * @returns Best training record or null if no records exist
   */
  async getBestLoss(): Promise<TrainingRecord | null> {
    const query = this.db.prepare(`
      SELECT * FROM gnn_training_history
      ORDER BY loss ASC LIMIT 1
    `);
    const row = query.get() as ITrainingHistoryRow | undefined;
    if (!row) return null;
    return this.rowToRecord(row);
  }

  /**
   * Check if loss is improving (decreasing trend)
   *
   * @param windowSize - Number of recent losses to analyze (minimum 2)
   * @returns True if loss is trending downward, false otherwise
   */
  async isLossImproving(windowSize: number = 10): Promise<boolean> {
    const trend = await this.getLossTrend(Math.max(windowSize, 2));
    if (trend.length < 2) return false;

    // Compare first half average to second half average
    const midpoint = Math.floor(trend.length / 2);
    const firstHalf = trend.slice(0, midpoint);
    const secondHalf = trend.slice(midpoint);

    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    return secondAvg < firstAvg;
  }

  /**
   * Generate a unique record ID
   *
   * @param epoch - Epoch number
   * @param batchIndex - Batch index
   * @returns Unique record ID
   */
  static generateRecordId(epoch: number, batchIndex: number): string {
    return `train_${epoch}_${batchIndex}_${Date.now()}`;
  }

  /**
   * Convert database row to TrainingRecord
   */
  private rowToRecord(row: ITrainingHistoryRow): TrainingRecord {
    return {
      id: row.id,
      epoch: row.epoch,
      batchIndex: row.batch_index,
      loss: row.loss,
      validationLoss: row.validation_loss ?? undefined,
      learningRate: row.learning_rate,
      samplesCount: row.samples_count,
      createdAt: new Date(row.created_at),
      checkpointPath: row.checkpoint_path ?? undefined,
    };
  }
}
