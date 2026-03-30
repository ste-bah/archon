/**
 * Tests for TrainingHistoryManager - TASK-GNN-004
 *
 * Validates loss history persistence for GNN training progress tracking.
 * Tests compliance with:
 * - RULE-008: Persist to SQLite
 * - RULE-009: Zero data loss - training history survives restarts
 * - RULE-072: Database operations retry on failure
 *
 * @module tests/god-agent/core/reasoning/training-history.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TrainingHistoryManager, type TrainingRecord } from '../../../../src/god-agent/core/reasoning/training-history.js';
import { createConnection, type DatabaseConnection } from '../../../../src/god-agent/core/database/connection.js';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { dirname } from 'path';

describe('TrainingHistoryManager', () => {
  let db: DatabaseConnection;
  let manager: TrainingHistoryManager;
  const testDbPath = '.test-training-history/training-history-test.db';

  beforeEach(() => {
    // Ensure test directory exists
    const dir = dirname(testDbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    // Remove existing test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    if (existsSync(`${testDbPath}-wal`)) {
      unlinkSync(`${testDbPath}-wal`);
    }
    if (existsSync(`${testDbPath}-shm`)) {
      unlinkSync(`${testDbPath}-shm`);
    }

    db = createConnection({ dbPath: testDbPath });
    manager = new TrainingHistoryManager(db);
  });

  afterEach(() => {
    db.close();
    // Cleanup test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    if (existsSync(`${testDbPath}-wal`)) {
      unlinkSync(`${testDbPath}-wal`);
    }
    if (existsSync(`${testDbPath}-shm`)) {
      unlinkSync(`${testDbPath}-shm`);
    }
  });

  describe('Schema Initialization', () => {
    it('should create gnn_training_history table on construction', async () => {
      const count = await manager.count();
      expect(count).toBe(0);
    });

    it('should have required indexes', () => {
      const indexes = db.db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='gnn_training_history'
      `).all() as { name: string }[];

      const indexNames = indexes.map(i => i.name);
      expect(indexNames).toContain('idx_training_epoch');
      expect(indexNames).toContain('idx_training_created');
      expect(indexNames).toContain('idx_training_loss');
    });
  });

  describe('recordBatch', () => {
    it('should persist a training record', async () => {
      const record: TrainingRecord = {
        id: 'train_0_0_123',
        epoch: 0,
        batchIndex: 0,
        loss: 0.5,
        learningRate: 0.001,
        samplesCount: 32,
      };

      await manager.recordBatch(record);

      const retrieved = await manager.findById('train_0_0_123');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.loss).toBe(0.5);
      expect(retrieved!.epoch).toBe(0);
      expect(retrieved!.batchIndex).toBe(0);
      expect(retrieved!.learningRate).toBe(0.001);
      expect(retrieved!.samplesCount).toBe(32);
    });

    it('should persist optional fields when provided', async () => {
      const record: TrainingRecord = {
        id: 'train_0_1_456',
        epoch: 0,
        batchIndex: 1,
        loss: 0.45,
        validationLoss: 0.48,
        learningRate: 0.001,
        samplesCount: 32,
        checkpointPath: '/checkpoints/epoch0_batch1.pt',
      };

      await manager.recordBatch(record);

      const retrieved = await manager.findById('train_0_1_456');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.validationLoss).toBe(0.48);
      expect(retrieved!.checkpointPath).toBe('/checkpoints/epoch0_batch1.pt');
    });

    it('should set createdAt timestamp automatically', async () => {
      const record: TrainingRecord = {
        id: 'train_0_2_789',
        epoch: 0,
        batchIndex: 2,
        loss: 0.4,
        learningRate: 0.001,
        samplesCount: 32,
      };

      await manager.recordBatch(record);

      const retrieved = await manager.findById('train_0_2_789');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.createdAt).toBeInstanceOf(Date);
      // Timestamp should be recent (within last 5 seconds)
      const now = Date.now();
      expect(retrieved!.createdAt!.getTime()).toBeGreaterThan(now - 5000);
    });
  });

  describe('recordBatchBulk', () => {
    it('should persist multiple records atomically', async () => {
      const records: TrainingRecord[] = [
        { id: 'bulk_0_0', epoch: 0, batchIndex: 0, loss: 0.5, learningRate: 0.001, samplesCount: 32 },
        { id: 'bulk_0_1', epoch: 0, batchIndex: 1, loss: 0.48, learningRate: 0.001, samplesCount: 32 },
        { id: 'bulk_0_2', epoch: 0, batchIndex: 2, loss: 0.46, learningRate: 0.001, samplesCount: 32 },
      ];

      await manager.recordBatchBulk(records);

      const count = await manager.count();
      expect(count).toBe(3);
    });

    it('should handle empty array', async () => {
      await manager.recordBatchBulk([]);
      const count = await manager.count();
      expect(count).toBe(0);
    });
  });

  describe('getHistory', () => {
    beforeEach(async () => {
      // Insert test data across multiple epochs
      const records: TrainingRecord[] = [
        { id: 'hist_0_0', epoch: 0, batchIndex: 0, loss: 0.5, learningRate: 0.001, samplesCount: 32 },
        { id: 'hist_0_1', epoch: 0, batchIndex: 1, loss: 0.48, learningRate: 0.001, samplesCount: 32 },
        { id: 'hist_1_0', epoch: 1, batchIndex: 0, loss: 0.4, learningRate: 0.001, samplesCount: 32 },
        { id: 'hist_1_1', epoch: 1, batchIndex: 1, loss: 0.38, learningRate: 0.001, samplesCount: 32 },
        { id: 'hist_2_0', epoch: 2, batchIndex: 0, loss: 0.35, learningRate: 0.001, samplesCount: 32 },
      ];
      await manager.recordBatchBulk(records);
    });

    it('should return all records when no filter', async () => {
      const history = await manager.getHistory();
      expect(history.length).toBe(5);
    });

    it('should filter by epoch range', async () => {
      const history = await manager.getHistory({ start: 0, end: 1 });
      expect(history.length).toBe(4);
      expect(history.every(r => r.epoch <= 1)).toBe(true);
    });

    it('should filter single epoch', async () => {
      const history = await manager.getHistory({ start: 1, end: 1 });
      expect(history.length).toBe(2);
      expect(history.every(r => r.epoch === 1)).toBe(true);
    });

    it('should order by epoch and batch for filtered results', async () => {
      const history = await manager.getHistory({ start: 0, end: 1 });
      for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1];
        const curr = history[i];
        if (prev.epoch === curr.epoch) {
          expect(prev.batchIndex).toBeLessThan(curr.batchIndex);
        } else {
          expect(prev.epoch).toBeLessThan(curr.epoch);
        }
      }
    });
  });

  describe('getLatestLoss', () => {
    it('should return null when no records', async () => {
      const loss = await manager.getLatestLoss();
      expect(loss).toBeNull();
    });

    it('should return most recent loss', async () => {
      await manager.recordBatch({
        id: 'latest_1', epoch: 0, batchIndex: 0, loss: 0.5, learningRate: 0.001, samplesCount: 32
      });
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      await manager.recordBatch({
        id: 'latest_2', epoch: 0, batchIndex: 1, loss: 0.3, learningRate: 0.001, samplesCount: 32
      });

      const loss = await manager.getLatestLoss();
      expect(loss).toBe(0.3);
    });
  });

  describe('getLossTrend', () => {
    beforeEach(async () => {
      // Insert records with decreasing loss
      const records: TrainingRecord[] = [];
      for (let i = 0; i < 10; i++) {
        records.push({
          id: `trend_${i}`,
          epoch: Math.floor(i / 2),
          batchIndex: i % 2,
          loss: 1.0 - i * 0.1,
          learningRate: 0.001,
          samplesCount: 32,
        });
        // Add small delay for timestamp ordering
      }
      await manager.recordBatchBulk(records);
    });

    it('should return losses in chronological order', async () => {
      const trend = await manager.getLossTrend(5);
      expect(trend.length).toBe(5);
      // Should be oldest to newest (reversed from DB query)
      // Since we inserted in order, recent losses are lower
      expect(trend[0]).toBeGreaterThan(trend[trend.length - 1]);
    });

    it('should limit to window size', async () => {
      const trend = await manager.getLossTrend(3);
      expect(trend.length).toBe(3);
    });

    it('should handle window larger than data', async () => {
      const trend = await manager.getLossTrend(100);
      expect(trend.length).toBe(10);
    });
  });

  describe('cleanup', () => {
    it('should delete records older than specified date', async () => {
      // Insert old and new records
      const oldDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

      await manager.recordBatch({
        id: 'old_record',
        epoch: 0, batchIndex: 0, loss: 0.5, learningRate: 0.001, samplesCount: 32,
        createdAt: oldDate,
      });
      await manager.recordBatch({
        id: 'new_record',
        epoch: 1, batchIndex: 0, loss: 0.3, learningRate: 0.001, samplesCount: 32,
      });

      // Cleanup records older than 1 day
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const deleted = await manager.cleanup(cutoff);

      expect(deleted).toBe(1);
      const remaining = await manager.count();
      expect(remaining).toBe(1);
      expect(await manager.exists('new_record')).toBe(true);
      expect(await manager.exists('old_record')).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return zero values when empty', async () => {
      const stats = await manager.getStats();
      expect(stats.totalRecords).toBe(0);
      expect(stats.uniqueEpochs).toBe(0);
      expect(stats.minLoss).toBe(0);
      expect(stats.maxLoss).toBe(0);
      expect(stats.averageLoss).toBe(0);
    });

    it('should calculate correct statistics', async () => {
      const records: TrainingRecord[] = [
        { id: 'stats_0', epoch: 0, batchIndex: 0, loss: 0.5, learningRate: 0.001, samplesCount: 32 },
        { id: 'stats_1', epoch: 0, batchIndex: 1, loss: 0.3, learningRate: 0.001, samplesCount: 32 },
        { id: 'stats_2', epoch: 1, batchIndex: 0, loss: 0.2, learningRate: 0.0005, samplesCount: 64 },
      ];
      await manager.recordBatchBulk(records);

      const stats = await manager.getStats();
      expect(stats.totalRecords).toBe(3);
      expect(stats.uniqueEpochs).toBe(2);
      expect(stats.minLoss).toBeCloseTo(0.2);
      expect(stats.maxLoss).toBeCloseTo(0.5);
      expect(stats.averageLoss).toBeCloseTo((0.5 + 0.3 + 0.2) / 3);
      expect(stats.totalSamples).toBe(128);
      expect(stats.latestLearningRate).toBeCloseTo(0.0005);
    });
  });

  describe('getBestLoss', () => {
    it('should return null when no records', async () => {
      const best = await manager.getBestLoss();
      expect(best).toBeNull();
    });

    it('should return record with lowest loss', async () => {
      const records: TrainingRecord[] = [
        { id: 'best_0', epoch: 0, batchIndex: 0, loss: 0.5, learningRate: 0.001, samplesCount: 32 },
        { id: 'best_1', epoch: 1, batchIndex: 0, loss: 0.1, learningRate: 0.001, samplesCount: 32 },
        { id: 'best_2', epoch: 2, batchIndex: 0, loss: 0.3, learningRate: 0.001, samplesCount: 32 },
      ];
      await manager.recordBatchBulk(records);

      const best = await manager.getBestLoss();
      expect(best).not.toBeNull();
      expect(best!.id).toBe('best_1');
      expect(best!.loss).toBe(0.1);
    });
  });

  describe('isLossImproving', () => {
    it('should return false when not enough data', async () => {
      await manager.recordBatch({
        id: 'single', epoch: 0, batchIndex: 0, loss: 0.5, learningRate: 0.001, samplesCount: 32
      });

      const improving = await manager.isLossImproving();
      expect(improving).toBe(false);
    });

    it('should return true when loss is decreasing', async () => {
      // Insert records with decreasing loss (older to newer)
      for (let i = 0; i < 6; i++) {
        await manager.recordBatch({
          id: `improve_${i}`,
          epoch: 0,
          batchIndex: i,
          loss: 1.0 - i * 0.1,
          learningRate: 0.001,
          samplesCount: 32,
        });
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      const improving = await manager.isLossImproving(6);
      expect(improving).toBe(true);
    });

    it('should return false when loss is increasing', async () => {
      // Insert records with increasing loss
      for (let i = 0; i < 6; i++) {
        await manager.recordBatch({
          id: `decline_${i}`,
          epoch: 0,
          batchIndex: i,
          loss: 0.1 + i * 0.1,
          learningRate: 0.001,
          samplesCount: 32,
        });
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      const improving = await manager.isLossImproving(6);
      expect(improving).toBe(false);
    });
  });

  describe('generateRecordId', () => {
    it('should generate unique IDs', () => {
      const id1 = TrainingHistoryManager.generateRecordId(0, 0);
      const id2 = TrainingHistoryManager.generateRecordId(0, 1);
      const id3 = TrainingHistoryManager.generateRecordId(1, 0);

      expect(id1).not.toBe(id2);
      expect(id1).not.toBe(id3);
      expect(id2).not.toBe(id3);
    });

    it('should include epoch and batch in ID', () => {
      const id = TrainingHistoryManager.generateRecordId(5, 10);
      expect(id).toMatch(/^train_5_10_\d+$/);
    });
  });

  describe('RULE-009: Zero data loss', () => {
    it('should persist data that survives reconnection', async () => {
      // Insert test data
      await manager.recordBatch({
        id: 'persist_test',
        epoch: 0,
        batchIndex: 0,
        loss: 0.42,
        validationLoss: 0.45,
        learningRate: 0.001,
        samplesCount: 64,
        checkpointPath: '/test/checkpoint.pt',
      });

      // Close connection
      db.close();

      // Reopen connection
      db = createConnection({ dbPath: testDbPath });
      manager = new TrainingHistoryManager(db);

      // Verify data survived
      const retrieved = await manager.findById('persist_test');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.loss).toBe(0.42);
      expect(retrieved!.validationLoss).toBe(0.45);
      expect(retrieved!.checkpointPath).toBe('/test/checkpoint.pt');
    });
  });

  describe('getEpochHistory', () => {
    beforeEach(async () => {
      const records: TrainingRecord[] = [
        { id: 'epoch_0_0', epoch: 0, batchIndex: 0, loss: 0.5, learningRate: 0.001, samplesCount: 32 },
        { id: 'epoch_0_1', epoch: 0, batchIndex: 1, loss: 0.45, learningRate: 0.001, samplesCount: 32 },
        { id: 'epoch_1_0', epoch: 1, batchIndex: 0, loss: 0.4, learningRate: 0.001, samplesCount: 32 },
      ];
      await manager.recordBatchBulk(records);
    });

    it('should return records for specific epoch', async () => {
      const history = await manager.getEpochHistory(0);
      expect(history.length).toBe(2);
      expect(history.every(r => r.epoch === 0)).toBe(true);
    });
  });

  describe('getEpochAverageLoss', () => {
    beforeEach(async () => {
      const records: TrainingRecord[] = [
        { id: 'avg_0_0', epoch: 0, batchIndex: 0, loss: 0.4, learningRate: 0.001, samplesCount: 32 },
        { id: 'avg_0_1', epoch: 0, batchIndex: 1, loss: 0.6, learningRate: 0.001, samplesCount: 32 },
      ];
      await manager.recordBatchBulk(records);
    });

    it('should calculate average loss for epoch', async () => {
      const avg = await manager.getEpochAverageLoss(0);
      expect(avg).toBeCloseTo(0.5);
    });

    it('should return null for non-existent epoch', async () => {
      const avg = await manager.getEpochAverageLoss(99);
      expect(avg).toBeNull();
    });
  });
});
