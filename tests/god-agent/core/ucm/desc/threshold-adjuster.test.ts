/**
 * IDESC-001: Intelligent DESC v2 - Threshold Adjuster Tests
 * TASK-IDESC-LEARN-003: Implement Threshold Adjustment Algorithm
 * Sprint 6: Active Learning
 *
 * Test coverage:
 * - REQ-IDESC-013: Threshold change tracking by category
 * - REQ-IDESC-014: Threshold adjustment based on success rate
 * - REQ-IDESC-015: Bounded adjustments (±5% per 30 days)
 * - REQ-IDESC-016: Minimum 10 samples requirement
 * - AC-IDESC-006a: Adjustment history tracking
 * - AC-IDESC-006b: Manual override support
 * - AC-IDESC-006c: Manual overrides take precedence
 * - GUARD-IDESC-003: Bounds violation detection
 * - GUARD-IDESC-005: Graceful degradation
 * - EC-IDESC-008: Minimum 10 samples
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ThresholdAdjuster,
  createThresholdAdjuster,
  initThresholdAdjustmentsTable,
  type IThresholdAdjustment,
  type IThresholdConfig
} from '../../../../../src/god-agent/core/ucm/desc/threshold-adjuster.js';
import type { IMetricsAggregator, IInjectionMetrics } from '../../../../../src/god-agent/core/ucm/desc/metrics-aggregator.js';
import type { IDatabaseConnection } from '../../../../../src/god-agent/core/ucm/desc/outcome-tracker.js';
import { WorkflowCategory } from '../../../../../src/god-agent/core/ucm/types.js';
import { ThresholdBoundsError, InvalidThresholdError } from '../../../../../src/god-agent/core/ucm/desc/errors.js';

/**
 * Mock database connection
 */
class MockDatabase implements IDatabaseConnection {
  private rows: Map<string, any[]> = new Map();
  private runCallback?: (sql: string, params?: unknown[]) => void;

  async run(sql: string, params?: unknown[]): Promise<{ lastInsertRowid: number | bigint }> {
    if (this.runCallback) {
      this.runCallback(sql, params);
    }

    // Store threshold adjustments
    if (sql.includes('INSERT INTO threshold_adjustments')) {
      const key = 'threshold_adjustments';
      if (!this.rows.has(key)) {
        this.rows.set(key, []);
      }
      const [id, category, oldThreshold, newThreshold, reason, samplesUsed, isManualOverride, adjustedAt] = params || [];
      this.rows.get(key)!.push({
        id,
        category,
        old_threshold: oldThreshold,
        new_threshold: newThreshold,
        reason,
        samples_used: samplesUsed,
        is_manual_override: isManualOverride,
        adjusted_at: adjustedAt
      });
    }

    return { lastInsertRowid: 1 };
  }

  async get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined> {
    // Return period adjustment
    if (sql.includes('SUM(new_threshold - old_threshold)')) {
      const [category, startDate] = params || [];
      const adjustments = this.rows.get('threshold_adjustments') || [];
      const totalAdjustment = adjustments
        .filter((a: any) => a.category === category && a.adjusted_at >= startDate && a.is_manual_override === 0)
        .reduce((sum: number, a: any) => sum + (a.new_threshold - a.old_threshold), 0);

      return { total_adjustment: totalAdjustment } as T;
    }

    return undefined;
  }

  async all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    // Return adjustment history
    if (sql.includes('FROM threshold_adjustments')) {
      const adjustments = this.rows.get('threshold_adjustments') || [];
      let filtered = adjustments;

      // Apply category filter if present
      if (params && params[0]) {
        const category = params[0];
        filtered = adjustments.filter((a: any) => a.category === category);
      }

      // Sort by adjusted_at DESC
      filtered.sort((a: any, b: any) => b.adjusted_at.localeCompare(a.adjusted_at));

      // Apply limit
      const limit = params && params.length > 1 ? params[params.length - 1] as number : 50;
      filtered = filtered.slice(0, limit);

      // Map to output format
      return filtered.map((row: any) => ({
        category: row.category,
        oldThreshold: row.old_threshold,
        newThreshold: row.new_threshold,
        reason: row.reason,
        samplesUsed: row.samples_used,
        isManualOverride: row.is_manual_override,
        timestamp: row.adjusted_at
      })) as T[];
    }

    return [];
  }

  setRunCallback(callback: (sql: string, params?: unknown[]) => void): void {
    this.runCallback = callback;
  }
}

/**
 * Mock metrics aggregator
 */
class MockMetricsAggregator implements Partial<IMetricsAggregator> {
  private mockMetrics: Map<WorkflowCategory, IInjectionMetrics> = new Map();

  setMetrics(category: WorkflowCategory, metrics: Partial<IInjectionMetrics>): void {
    this.mockMetrics.set(category, {
      category,
      injectionCount: 10,
      successRate: 0.80,
      falsePositiveRate: 0.20,
      avgConfidence: 0.75,
      timeWindow: '30d',
      startDate: new Date(),
      endDate: new Date(),
      ...metrics
    });
  }

  async getMetrics(category?: WorkflowCategory, timeWindow?: '7d' | '30d'): Promise<IInjectionMetrics[]> {
    if (category && this.mockMetrics.has(category)) {
      return [this.mockMetrics.get(category)!];
    }
    return [];
  }
}

describe('ThresholdAdjuster', () => {
  let db: MockDatabase;
  let metricsAggregator: MockMetricsAggregator;
  let adjuster: ThresholdAdjuster;

  beforeEach(() => {
    db = new MockDatabase();
    metricsAggregator = new MockMetricsAggregator();
    adjuster = new ThresholdAdjuster(
      db as unknown as IDatabaseConnection,
      metricsAggregator as unknown as IMetricsAggregator
    );
  });

  describe('getCurrentThresholds', () => {
    it('should return default base thresholds', () => {
      const thresholds = adjuster.getCurrentThresholds();

      expect(thresholds[WorkflowCategory.RESEARCH]).toBe(0.80);
      expect(thresholds[WorkflowCategory.CODING]).toBe(0.75);
      expect(thresholds[WorkflowCategory.GENERAL]).toBe(0.70);
    });

    it('should apply manual overrides (AC-IDESC-006c)', () => {
      adjuster.setManualOverride(WorkflowCategory.RESEARCH, 0.90);

      const thresholds = adjuster.getCurrentThresholds();

      expect(thresholds[WorkflowCategory.RESEARCH]).toBe(0.90);
      expect(thresholds[WorkflowCategory.CODING]).toBe(0.75);
    });
  });

  describe('proposeAdjustment', () => {
    it('should propose lowering threshold for high success rate (REQ-IDESC-014)', async () => {
      metricsAggregator.setMetrics(WorkflowCategory.RESEARCH, {
        injectionCount: 20,
        successRate: 0.90
      });

      const adjustment = await adjuster.proposeAdjustment(WorkflowCategory.RESEARCH);

      expect(adjustment).toBeDefined();
      expect(adjustment!.category).toBe(WorkflowCategory.RESEARCH);
      expect(adjustment!.newThreshold).toBeLessThan(adjustment!.oldThreshold);
      expect(adjustment!.reason).toContain('Lowering');
      expect(adjustment!.samplesUsed).toBe(20);
    });

    it('should propose raising threshold for low success rate (REQ-IDESC-014)', async () => {
      metricsAggregator.setMetrics(WorkflowCategory.CODING, {
        injectionCount: 15,
        successRate: 0.55
      });

      const adjustment = await adjuster.proposeAdjustment(WorkflowCategory.CODING);

      expect(adjustment).toBeDefined();
      expect(adjustment!.category).toBe(WorkflowCategory.CODING);
      expect(adjustment!.newThreshold).toBeGreaterThan(adjustment!.oldThreshold);
      expect(adjustment!.reason).toContain('Raising');
    });

    it('should return null if insufficient samples (EC-IDESC-008)', async () => {
      metricsAggregator.setMetrics(WorkflowCategory.GENERAL, {
        injectionCount: 5,  // Below minimum of 10
        successRate: 0.50
      });

      const adjustment = await adjuster.proposeAdjustment(WorkflowCategory.GENERAL);

      expect(adjustment).toBeNull();
    });

    it('should return null if no data available', async () => {
      const adjustment = await adjuster.proposeAdjustment(WorkflowCategory.RESEARCH);

      expect(adjustment).toBeNull();
    });

    it('should return null if manual override is set (AC-IDESC-006c)', async () => {
      metricsAggregator.setMetrics(WorkflowCategory.RESEARCH, {
        injectionCount: 20,
        successRate: 0.50
      });

      adjuster.setManualOverride(WorkflowCategory.RESEARCH, 0.85);

      const adjustment = await adjuster.proposeAdjustment(WorkflowCategory.RESEARCH);

      expect(adjustment).toBeNull();
    });

    it('should return null for insignificant delta (<0.5%)', async () => {
      metricsAggregator.setMetrics(WorkflowCategory.RESEARCH, {
        injectionCount: 20,
        successRate: 0.80  // Exactly at target, should propose minimal change
      });

      const adjustment = await adjuster.proposeAdjustment(WorkflowCategory.RESEARCH);

      // With target = 0.80 and success = 0.80, delta should be 0 or very small
      expect(adjustment).toBeNull();
    });
  });

  describe('applyAdjustment', () => {
    it('should update current threshold and persist to database (REQ-IDESC-013)', async () => {
      const adjustment: IThresholdAdjustment = {
        category: WorkflowCategory.RESEARCH,
        oldThreshold: 0.80,
        newThreshold: 0.78,
        reason: 'Lowering threshold by 2.5% based on 90.0% success rate',
        timestamp: new Date(),
        samplesUsed: 20
      };

      let insertSql = '';
      db.setRunCallback((sql) => { insertSql = sql; });

      await adjuster.applyAdjustment(adjustment);

      // Verify current threshold updated
      const thresholds = adjuster.getCurrentThresholds();
      expect(thresholds[WorkflowCategory.RESEARCH]).toBe(0.78);

      // Verify database insert
      expect(insertSql).toContain('INSERT INTO threshold_adjustments');
    });

    it('should reject adjustment exceeding bounds (GUARD-IDESC-003)', async () => {
      // Apply initial adjustment
      await adjuster.applyAdjustment({
        category: WorkflowCategory.CODING,
        oldThreshold: 0.75,
        newThreshold: 0.78,
        reason: 'Initial adjustment',
        timestamp: new Date(),
        samplesUsed: 10
      });

      // Try to apply another large adjustment in same period
      const largeAdjustment: IThresholdAdjustment = {
        category: WorkflowCategory.CODING,
        oldThreshold: 0.78,
        newThreshold: 0.82,  // Total would be 0.07 (7%) > 5% limit
        reason: 'Large adjustment',
        timestamp: new Date(),
        samplesUsed: 10
      };

      await expect(adjuster.applyAdjustment(largeAdjustment)).rejects.toThrow(ThresholdBoundsError);
    });

    it('should reject invalid threshold values', async () => {
      const invalidAdjustment: IThresholdAdjustment = {
        category: WorkflowCategory.GENERAL,
        oldThreshold: 0.70,
        newThreshold: 1.50,  // Invalid: > 1.0
        reason: 'Invalid threshold',
        timestamp: new Date(),
        samplesUsed: 10
      };

      await expect(adjuster.applyAdjustment(invalidAdjustment)).rejects.toThrow(InvalidThresholdError);
    });
  });

  describe('getAdjustmentHistory', () => {
    it('should return adjustment history (AC-IDESC-006a)', async () => {
      // Apply two adjustments
      await adjuster.applyAdjustment({
        category: WorkflowCategory.RESEARCH,
        oldThreshold: 0.80,
        newThreshold: 0.78,
        reason: 'First adjustment',
        timestamp: new Date('2025-01-01'),
        samplesUsed: 20
      });

      await adjuster.applyAdjustment({
        category: WorkflowCategory.RESEARCH,
        oldThreshold: 0.78,
        newThreshold: 0.76,
        reason: 'Second adjustment',
        timestamp: new Date('2025-01-15'),
        samplesUsed: 25
      });

      const history = await adjuster.getAdjustmentHistory(WorkflowCategory.RESEARCH);

      expect(history).toHaveLength(2);
      expect(history[0].newThreshold).toBe(0.76); // Newest first
      expect(history[1].newThreshold).toBe(0.78);
    });

    it('should filter by category', async () => {
      await adjuster.applyAdjustment({
        category: WorkflowCategory.RESEARCH,
        oldThreshold: 0.80,
        newThreshold: 0.78,
        reason: 'Research adjustment',
        timestamp: new Date(),
        samplesUsed: 20
      });

      await adjuster.applyAdjustment({
        category: WorkflowCategory.CODING,
        oldThreshold: 0.75,
        newThreshold: 0.77,
        reason: 'Coding adjustment',
        timestamp: new Date(),
        samplesUsed: 15
      });

      const history = await adjuster.getAdjustmentHistory(WorkflowCategory.RESEARCH);

      expect(history).toHaveLength(1);
      expect(history[0].category).toBe(WorkflowCategory.RESEARCH);
    });

    it('should respect limit parameter', async () => {
      // Apply 3 adjustments
      for (let i = 0; i < 3; i++) {
        await adjuster.applyAdjustment({
          category: WorkflowCategory.GENERAL,
          oldThreshold: 0.70 + i * 0.01,
          newThreshold: 0.71 + i * 0.01,
          reason: `Adjustment ${i}`,
          timestamp: new Date(),
          samplesUsed: 10
        });
      }

      const history = await adjuster.getAdjustmentHistory(WorkflowCategory.GENERAL, 2);

      expect(history).toHaveLength(2);
    });
  });

  describe('Manual Overrides', () => {
    it('should set and apply manual override (AC-IDESC-006b)', () => {
      adjuster.setManualOverride(WorkflowCategory.RESEARCH, 0.95);

      const thresholds = adjuster.getCurrentThresholds();

      expect(thresholds[WorkflowCategory.RESEARCH]).toBe(0.95);
    });

    it('should reject invalid manual override values', () => {
      expect(() => {
        adjuster.setManualOverride(WorkflowCategory.RESEARCH, 1.5);
      }).toThrow(InvalidThresholdError);

      expect(() => {
        adjuster.setManualOverride(WorkflowCategory.RESEARCH, -0.1);
      }).toThrow(InvalidThresholdError);
    });

    it('should clear manual override', () => {
      adjuster.setManualOverride(WorkflowCategory.RESEARCH, 0.95);
      adjuster.clearManualOverride(WorkflowCategory.RESEARCH);

      const thresholds = adjuster.getCurrentThresholds();

      expect(thresholds[WorkflowCategory.RESEARCH]).toBe(0.80); // Back to base
    });

    it('should prevent automatic adjustments when override is set (AC-IDESC-006c)', async () => {
      metricsAggregator.setMetrics(WorkflowCategory.RESEARCH, {
        injectionCount: 20,
        successRate: 0.50  // Low success rate
      });

      adjuster.setManualOverride(WorkflowCategory.RESEARCH, 0.85);

      const adjustment = await adjuster.proposeAdjustment(WorkflowCategory.RESEARCH);

      expect(adjustment).toBeNull();
    });
  });

  describe('resetToDefaults', () => {
    it('should reset all thresholds to base values', async () => {
      // Apply small adjustment within bounds
      await adjuster.applyAdjustment({
        category: WorkflowCategory.RESEARCH,
        oldThreshold: 0.80,
        newThreshold: 0.78,  // Only 2.5% change, within 5% limit
        reason: 'Test adjustment',
        timestamp: new Date(),
        samplesUsed: 10
      });

      // Set manual override
      adjuster.setManualOverride(WorkflowCategory.CODING, 0.90);

      // Reset
      adjuster.resetToDefaults();

      const thresholds = adjuster.getCurrentThresholds();

      expect(thresholds[WorkflowCategory.RESEARCH]).toBe(0.80);
      expect(thresholds[WorkflowCategory.CODING]).toBe(0.75);
      expect(thresholds[WorkflowCategory.GENERAL]).toBe(0.70);
    });
  });

  describe('Factory Function', () => {
    it('should create ThresholdAdjuster with custom config', () => {
      const config: Partial<IThresholdConfig> = {
        baseThresholds: {
          research: 0.85,
          coding: 0.80,
          general: 0.75
        },
        maxAdjustmentPerPeriod: 0.03,  // 3%
        minimumSamples: 20
      };

      const customAdjuster = createThresholdAdjuster(
        db as unknown as IDatabaseConnection,
        metricsAggregator as unknown as IMetricsAggregator,
        config
      );

      const thresholds = customAdjuster.getCurrentThresholds();

      expect(thresholds[WorkflowCategory.RESEARCH]).toBe(0.85);
      expect(thresholds[WorkflowCategory.CODING]).toBe(0.80);
      expect(thresholds[WorkflowCategory.GENERAL]).toBe(0.75);
    });
  });

  describe('Database Initialization', () => {
    it('should initialize threshold_adjustments table', async () => {
      let createTableSql = '';
      let createIndexSql = '';

      db.setRunCallback((sql) => {
        if (sql.includes('CREATE TABLE')) {
          createTableSql = sql;
        } else if (sql.includes('CREATE INDEX')) {
          createIndexSql = sql;
        }
      });

      await initThresholdAdjustmentsTable(db as unknown as IDatabaseConnection);

      expect(createTableSql).toContain('threshold_adjustments');
      expect(createTableSql).toContain('category TEXT NOT NULL');
      expect(createTableSql).toContain('old_threshold REAL NOT NULL');
      expect(createTableSql).toContain('new_threshold REAL NOT NULL');
      expect(createIndexSql).toContain('idx_threshold_adjustments_category');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small adjustments (rounding)', async () => {
      metricsAggregator.setMetrics(WorkflowCategory.GENERAL, {
        injectionCount: 100,
        successRate: 0.85  // Slightly above target
      });

      const adjustment = await adjuster.proposeAdjustment(WorkflowCategory.GENERAL);

      if (adjustment) {
        // Should be rounded to 3 decimals
        const thresholdStr = adjustment.newThreshold.toString();
        expect(thresholdStr).toMatch(/^\d\.\d{1,3}$/);
      }
    });

    it('should handle perfect success rate', async () => {
      metricsAggregator.setMetrics(WorkflowCategory.RESEARCH, {
        injectionCount: 50,
        successRate: 1.0
      });

      const adjustment = await adjuster.proposeAdjustment(WorkflowCategory.RESEARCH);

      expect(adjustment).toBeDefined();
      expect(adjustment!.newThreshold).toBeLessThan(adjustment!.oldThreshold);
    });

    it('should handle zero success rate', async () => {
      metricsAggregator.setMetrics(WorkflowCategory.CODING, {
        injectionCount: 20,
        successRate: 0.0
      });

      const adjustment = await adjuster.proposeAdjustment(WorkflowCategory.CODING);

      expect(adjustment).toBeDefined();
      expect(adjustment!.newThreshold).toBeGreaterThan(adjustment!.oldThreshold);
    });
  });

  describe('Graceful Degradation (GUARD-IDESC-005)', () => {
    it('should handle database errors gracefully in proposeAdjustment', async () => {
      const errorDb: Partial<IDatabaseConnection> = {
        get: vi.fn().mockRejectedValue(new Error('Database error')),
        all: vi.fn().mockRejectedValue(new Error('Database error')),
        run: vi.fn().mockRejectedValue(new Error('Database error'))
      };

      const errorMetrics: Partial<IMetricsAggregator> = {
        getMetrics: vi.fn().mockRejectedValue(new Error('Metrics error'))
      };

      const errorAdjuster = new ThresholdAdjuster(
        errorDb as IDatabaseConnection,
        errorMetrics as unknown as IMetricsAggregator
      );

      // Should return null instead of throwing when metrics fail
      const adjustment = await errorAdjuster.proposeAdjustment(WorkflowCategory.RESEARCH);

      expect(adjustment).toBeNull();
    });

    it('should handle database errors gracefully in getAdjustmentHistory', async () => {
      const errorDb: Partial<IDatabaseConnection> = {
        all: vi.fn().mockRejectedValue(new Error('Database error'))
      };

      const errorAdjuster = new ThresholdAdjuster(
        errorDb as IDatabaseConnection,
        metricsAggregator as unknown as IMetricsAggregator
      );

      // Should return empty array instead of throwing
      const history = await errorAdjuster.getAdjustmentHistory();

      expect(history).toEqual([]);
    });
  });
});
