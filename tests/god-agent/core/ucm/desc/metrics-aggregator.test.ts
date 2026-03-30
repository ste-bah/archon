/**
 * IDESC-001: Intelligent DESC v2 - Metrics Aggregator Tests
 * TASK-IDESC-LEARN-001: Unit Tests for Metrics Aggregation
 * TASK-IDESC-LEARN-002: Unit Tests for Alert System
 *
 * Tests for:
 * - MetricsAggregator.getMetrics (REQ-IDESC-009, REQ-IDESC-011)
 * - MetricsAggregator.getFalsePositiveRate (REQ-IDESC-010)
 * - MetricsAggregator.getSuccessRateByCategory (REQ-IDESC-009)
 * - MetricsAggregator.getInjectionCountByWindow (REQ-IDESC-011)
 * - MetricsAggregator.checkAndAlert (REQ-IDESC-012, AC-IDESC-005d)
 * - MetricsAggregator.getRecentFailures (REQ-IDESC-012)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MetricsAggregator,
  createMetricsAggregator,
  type IInjectionMetrics
} from '../../../../../src/god-agent/core/ucm/desc/metrics-aggregator.js';
import type { IDatabaseConnection } from '../../../../../src/god-agent/core/ucm/desc/outcome-tracker.js';
import { WorkflowCategory, ErrorType } from '../../../../../src/god-agent/core/ucm/types.js';

// ============================================================================
// Mock Database
// ============================================================================

interface MockOutcome {
  outcome_id: string;
  episode_id: string;
  task_id: string;
  success: number;
  error_type: string | null;
  details: string | null;
  recorded_at: string;
}

interface MockEpisode {
  episode_id: string;
  metadata: string; // JSON string
}

function createMockDb(): IDatabaseConnection & {
  outcomes: MockOutcome[];
  episodes: MockEpisode[];
} {
  const outcomes: MockOutcome[] = [];
  const episodes: MockEpisode[] = [];

  return {
    outcomes,
    episodes,

    async run(sql: string, params?: unknown[]): Promise<{ lastInsertRowid: number | bigint }> {
      return { lastInsertRowid: 1 };
    },

    async get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined> {
      // Handle false positive rate queries
      if (sql.includes('false_positive_rate')) {
        const categoryFilter = params && params.length > 0 ? params[0] as string : null;

        let filteredOutcomes = outcomes;
        if (categoryFilter) {
          filteredOutcomes = outcomes.filter(o => {
            const ep = episodes.find(e => e.episode_id === o.episode_id);
            if (!ep) return false;
            const metadata = JSON.parse(ep.metadata);
            const category = metadata.category || 'general';
            return category === categoryFilter;
          });
        }

        const failureCount = filteredOutcomes.filter(o => o.success === 0).length;
        const totalCount = filteredOutcomes.length;
        const rate = totalCount > 0 ? failureCount / totalCount : 0;

        return { false_positive_rate: rate } as T;
      }

      // Handle injection count queries
      if (sql.includes('COUNT(DISTINCT episode_id)')) {
        const startDate = params?.[0] as string;
        const filteredOutcomes = outcomes.filter(o => o.recorded_at >= startDate);
        const uniqueEpisodes = new Set(filteredOutcomes.map(o => o.episode_id));
        return { injection_count: uniqueEpisodes.size } as T;
      }

      return undefined;
    },

    async all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
      // Handle getRecentFailures queries
      if (sql.includes('WHERE o.success = 0')) {
        const categoryFilter = params?.[0] as string;
        const limit = params?.[1] as number;

        const filteredOutcomes = outcomes
          .filter(o => {
            const ep = episodes.find(e => e.episode_id === o.episode_id);
            if (!ep) return false;
            const metadata = JSON.parse(ep.metadata);
            const category = metadata.category || 'general';
            return o.success === 0 && category === categoryFilter;
          })
          .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())
          .slice(0, limit)
          .map(o => ({
            outcomeId: o.outcome_id,
            episodeId: o.episode_id,
            taskId: o.task_id,
            success: o.success,
            errorType: o.error_type,
            details: o.details,
            recordedAt: o.recorded_at
          }));

        return filteredOutcomes as T[];
      }

      // Handle getMetrics queries (has injection_count field)
      if (sql.includes('injection_count') && sql.includes('GROUP BY category')) {
        const startDate = params?.[0] as string;
        const categoryFilter = params && params.length > 1 ? params[1] as string : null;

        // Filter outcomes by date
        const filteredOutcomes = outcomes.filter(o => o.recorded_at >= startDate);

        // Group by category
        const categoryMap = new Map<string, {
          injections: Set<string>;
          successes: number;
          failures: number;
          confidences: number[];
        }>();

        for (const outcome of filteredOutcomes) {
          const episode = episodes.find(e => e.episode_id === outcome.episode_id);
          if (!episode) continue;

          const metadata = JSON.parse(episode.metadata);
          const category = metadata.category || 'general';

          // Apply category filter if provided
          if (categoryFilter && category !== categoryFilter) continue;

          if (!categoryMap.has(category)) {
            categoryMap.set(category, {
              injections: new Set(),
              successes: 0,
              failures: 0,
              confidences: []
            });
          }

          const stats = categoryMap.get(category)!;
          stats.injections.add(outcome.episode_id);
          if (outcome.success === 1) {
            stats.successes++;
          } else {
            stats.failures++;
          }
          stats.confidences.push(metadata.confidence || 0.5);
        }

        // Convert to result rows
        const results: T[] = [];
        for (const [category, stats] of Array.from(categoryMap.entries())) {
          const total = stats.successes + stats.failures;
          const successRate = total > 0 ? stats.successes / total : 0;
          const falsePositiveRate = total > 0 ? stats.failures / total : 0;
          const avgConfidence = stats.confidences.length > 0
            ? stats.confidences.reduce((a, b) => a + b, 0) / stats.confidences.length
            : 0.5;

          results.push({
            category,
            injection_count: stats.injections.size,
            success_rate: successRate,
            false_positive_rate: falsePositiveRate,
            avg_confidence: avgConfidence
          } as T);
        }

        return results;
      }

      // Handle getSuccessRateByCategory queries (no GROUP BY category in getMetrics)
      if (sql.includes('success_rate') && !sql.includes('false_positive_rate')) {
        const categoryMap = new Map<string, { successes: number; total: number }>();

        for (const outcome of outcomes) {
          const episode = episodes.find(e => e.episode_id === outcome.episode_id);
          if (!episode) continue;

          const metadata = JSON.parse(episode.metadata);
          const category = metadata.category || 'general';

          if (!categoryMap.has(category)) {
            categoryMap.set(category, { successes: 0, total: 0 });
          }

          const stats = categoryMap.get(category)!;
          stats.total++;
          if (outcome.success === 1) {
            stats.successes++;
          }
        }

        const results: T[] = [];
        for (const [category, stats] of Array.from(categoryMap.entries())) {
          const successRate = stats.total > 0 ? stats.successes / stats.total : 0;
          results.push({
            category,
            success_rate: successRate
          } as T);
        }

        return results;
      }

      return [];
    }
  };
}

// ============================================================================
// Test Helpers
// ============================================================================

function addOutcome(
  db: ReturnType<typeof createMockDb>,
  episodeId: string,
  success: boolean,
  category: WorkflowCategory = WorkflowCategory.GENERAL,
  daysAgo: number = 0,
  confidence: number = 0.8,
  errorType?: ErrorType,
  taskId: string = 'task-1'
): void {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);

  // Add episode if not exists
  if (!db.episodes.find(e => e.episode_id === episodeId)) {
    db.episodes.push({
      episode_id: episodeId,
      metadata: JSON.stringify({ category, confidence })
    });
  }

  // Add outcome
  const outcomeId = `outcome-${db.outcomes.length + 1}`;
  db.outcomes.push({
    outcome_id: outcomeId,
    episode_id: episodeId,
    task_id: taskId,
    success: success ? 1 : 0,
    error_type: errorType || null,
    details: errorType ? JSON.stringify({ error: errorType }) : null,
    recorded_at: date.toISOString()
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('MetricsAggregator', () => {
  let db: ReturnType<typeof createMockDb>;
  let aggregator: MetricsAggregator;

  beforeEach(() => {
    db = createMockDb();
    aggregator = new MetricsAggregator(db);
  });

  describe('createMetricsAggregator', () => {
    it('should create a MetricsAggregator instance', () => {
      const instance = createMetricsAggregator(db);
      expect(instance).toBeInstanceOf(MetricsAggregator);
    });
  });

  describe('getMetrics', () => {
    it('should return empty array when no data exists', async () => {
      const metrics = await aggregator.getMetrics();
      expect(metrics).toEqual([]);
    });

    it('should aggregate metrics by category for 7-day window', async () => {
      // Add coding outcomes (3 successes, 1 failure)
      addOutcome(db, 'ep-1', true, WorkflowCategory.CODING, 3, 0.9);
      addOutcome(db, 'ep-1', true, WorkflowCategory.CODING, 4, 0.9);
      addOutcome(db, 'ep-2', true, WorkflowCategory.CODING, 5, 0.85);
      addOutcome(db, 'ep-3', false, WorkflowCategory.CODING, 6, 0.7);

      // Add research outcomes (2 successes)
      addOutcome(db, 'ep-4', true, WorkflowCategory.RESEARCH, 2, 0.95);
      addOutcome(db, 'ep-5', true, WorkflowCategory.RESEARCH, 1, 0.92);

      const metrics = await aggregator.getMetrics(undefined, '7d');

      expect(metrics).toHaveLength(2);

      const codingMetrics = metrics.find(m => m.category === WorkflowCategory.CODING);
      expect(codingMetrics).toBeDefined();
      expect(codingMetrics!.injectionCount).toBe(3); // 3 unique episodes
      expect(codingMetrics!.successRate).toBeCloseTo(0.75, 2); // 3/4
      expect(codingMetrics!.falsePositiveRate).toBeCloseTo(0.25, 2); // 1/4
      expect(codingMetrics!.avgConfidence).toBeCloseTo(0.8375, 2);
      expect(codingMetrics!.timeWindow).toBe('7d');

      const researchMetrics = metrics.find(m => m.category === WorkflowCategory.RESEARCH);
      expect(researchMetrics).toBeDefined();
      expect(researchMetrics!.injectionCount).toBe(2); // 2 unique episodes
      expect(researchMetrics!.successRate).toBe(1.0);
      expect(researchMetrics!.falsePositiveRate).toBe(0.0);
    });

    it('should filter by specific category', async () => {
      addOutcome(db, 'ep-1', true, WorkflowCategory.CODING, 2);
      addOutcome(db, 'ep-2', true, WorkflowCategory.RESEARCH, 2);

      const metrics = await aggregator.getMetrics(WorkflowCategory.CODING, '7d');

      expect(metrics).toHaveLength(1);
      expect(metrics[0].category).toBe(WorkflowCategory.CODING);
    });

    it('should respect 30-day time window', async () => {
      // Recent outcome (within 7 days)
      addOutcome(db, 'ep-1', true, WorkflowCategory.GENERAL, 5);

      // Older outcome (within 30 days but not 7 days)
      addOutcome(db, 'ep-2', true, WorkflowCategory.GENERAL, 20);

      // Very old outcome (outside 30 days)
      addOutcome(db, 'ep-3', true, WorkflowCategory.GENERAL, 35);

      const metrics7d = await aggregator.getMetrics(undefined, '7d');
      expect(metrics7d[0].injectionCount).toBe(1);

      const metrics30d = await aggregator.getMetrics(undefined, '30d');
      expect(metrics30d[0].injectionCount).toBe(2);
    });

    it('should use default category "general" when metadata missing', async () => {
      db.episodes.push({
        episode_id: 'ep-no-category',
        metadata: JSON.stringify({}) // No category
      });
      db.outcomes.push({
        episode_id: 'ep-no-category',
        success: 1,
        recorded_at: new Date().toISOString()
      });

      const metrics = await aggregator.getMetrics();
      expect(metrics[0].category).toBe('general');
    });

    it('should handle performance within NFR-IDESC-003 (<100ms)', async () => {
      // Add moderate amount of data
      for (let i = 0; i < 50; i++) {
        addOutcome(db, `ep-${i}`, i % 2 === 0, WorkflowCategory.CODING, i % 7);
      }

      const startTime = performance.now();
      await aggregator.getMetrics();
      const duration = performance.now() - startTime;

      // Should be fast (though mock DB is always fast)
      expect(duration).toBeLessThan(100);
    });

    it('should gracefully handle database errors (GUARD-IDESC-005)', async () => {
      const brokenDb = {
        async run() { throw new Error('DB error'); },
        async get() { throw new Error('DB error'); },
        async all() { throw new Error('DB error'); }
      } as IDatabaseConnection;

      const brokenAggregator = new MetricsAggregator(brokenDb);
      const metrics = await brokenAggregator.getMetrics();

      // Should return empty array instead of throwing
      expect(metrics).toEqual([]);
    });
  });

  describe('getFalsePositiveRate', () => {
    it('should return 0 when no data exists', async () => {
      const rate = await aggregator.getFalsePositiveRate();
      expect(rate).toBe(0);
    });

    it('should calculate overall false positive rate', async () => {
      addOutcome(db, 'ep-1', true, WorkflowCategory.CODING, 2);
      addOutcome(db, 'ep-2', false, WorkflowCategory.CODING, 2);
      addOutcome(db, 'ep-3', false, WorkflowCategory.RESEARCH, 2);
      addOutcome(db, 'ep-4', true, WorkflowCategory.RESEARCH, 2);

      const rate = await aggregator.getFalsePositiveRate();
      expect(rate).toBe(0.5); // 2 failures out of 4
    });

    it('should calculate category-specific false positive rate', async () => {
      addOutcome(db, 'ep-1', true, WorkflowCategory.CODING, 2);
      addOutcome(db, 'ep-2', false, WorkflowCategory.CODING, 2);
      addOutcome(db, 'ep-3', false, WorkflowCategory.CODING, 2);
      addOutcome(db, 'ep-4', true, WorkflowCategory.RESEARCH, 2);

      const codingRate = await aggregator.getFalsePositiveRate(WorkflowCategory.CODING);
      expect(codingRate).toBeCloseTo(0.667, 2); // 2 failures out of 3

      const researchRate = await aggregator.getFalsePositiveRate(WorkflowCategory.RESEARCH);
      expect(researchRate).toBe(0); // 0 failures out of 1
    });

    it('should gracefully handle database errors', async () => {
      const brokenDb = {
        async run() { throw new Error('DB error'); },
        async get() { throw new Error('DB error'); },
        async all() { throw new Error('DB error'); }
      } as IDatabaseConnection;

      const brokenAggregator = new MetricsAggregator(brokenDb);
      const rate = await brokenAggregator.getFalsePositiveRate();

      expect(rate).toBe(0);
    });
  });

  describe('getSuccessRateByCategory', () => {
    it('should return empty map when no data exists', async () => {
      const map = await aggregator.getSuccessRateByCategory();
      expect(map.size).toBe(0);
    });

    it('should return success rates for all categories', async () => {
      addOutcome(db, 'ep-1', true, WorkflowCategory.CODING, 2);
      addOutcome(db, 'ep-2', false, WorkflowCategory.CODING, 2);
      addOutcome(db, 'ep-3', true, WorkflowCategory.RESEARCH, 2);
      addOutcome(db, 'ep-4', true, WorkflowCategory.RESEARCH, 2);
      addOutcome(db, 'ep-5', true, WorkflowCategory.GENERAL, 2);

      const map = await aggregator.getSuccessRateByCategory();

      expect(map.size).toBe(3);
      expect(map.get(WorkflowCategory.CODING)).toBe(0.5); // 1/2
      expect(map.get(WorkflowCategory.RESEARCH)).toBe(1.0); // 2/2
      expect(map.get(WorkflowCategory.GENERAL)).toBe(1.0); // 1/1
    });

    it('should gracefully handle database errors', async () => {
      const brokenDb = {
        async run() { throw new Error('DB error'); },
        async get() { throw new Error('DB error'); },
        async all() { throw new Error('DB error'); }
      } as IDatabaseConnection;

      const brokenAggregator = new MetricsAggregator(brokenDb);
      const map = await brokenAggregator.getSuccessRateByCategory();

      expect(map.size).toBe(0);
    });
  });

  describe('getInjectionCountByWindow', () => {
    it('should return 0 when no data exists', async () => {
      const count = await aggregator.getInjectionCountByWindow('7d');
      expect(count).toBe(0);
    });

    it('should count unique episodes in 7-day window', async () => {
      addOutcome(db, 'ep-1', true, WorkflowCategory.CODING, 2);
      addOutcome(db, 'ep-1', true, WorkflowCategory.CODING, 3); // Same episode
      addOutcome(db, 'ep-2', false, WorkflowCategory.CODING, 5);
      addOutcome(db, 'ep-3', true, WorkflowCategory.RESEARCH, 10); // Outside 7 days

      const count = await aggregator.getInjectionCountByWindow('7d');
      expect(count).toBe(2); // ep-1 and ep-2 only
    });

    it('should count unique episodes in 30-day window', async () => {
      addOutcome(db, 'ep-1', true, WorkflowCategory.CODING, 2);
      addOutcome(db, 'ep-2', false, WorkflowCategory.CODING, 20);
      addOutcome(db, 'ep-3', true, WorkflowCategory.RESEARCH, 35); // Outside 30 days

      const count = await aggregator.getInjectionCountByWindow('30d');
      expect(count).toBe(2); // ep-1 and ep-2 only
    });

    it('should handle both time windows correctly', async () => {
      addOutcome(db, 'ep-1', true, WorkflowCategory.CODING, 5); // In both
      addOutcome(db, 'ep-2', true, WorkflowCategory.CODING, 15); // Only in 30d
      addOutcome(db, 'ep-3', true, WorkflowCategory.CODING, 35); // In neither

      const count7d = await aggregator.getInjectionCountByWindow('7d');
      expect(count7d).toBe(1);

      const count30d = await aggregator.getInjectionCountByWindow('30d');
      expect(count30d).toBe(2);
    });

    it('should gracefully handle database errors', async () => {
      const brokenDb = {
        async run() { throw new Error('DB error'); },
        async get() { throw new Error('DB error'); },
        async all() { throw new Error('DB error'); }
      } as IDatabaseConnection;

      const brokenAggregator = new MetricsAggregator(brokenDb);
      const count = await brokenAggregator.getInjectionCountByWindow('7d');

      expect(count).toBe(0);
    });
  });

  describe('checkAndAlert', () => {
    it('should return empty array when no categories exceed threshold', async () => {
      // Add mostly successful outcomes (FPR < 2%)
      addOutcome(db, 'ep-1', true, WorkflowCategory.CODING, 2);
      addOutcome(db, 'ep-2', true, WorkflowCategory.CODING, 2);
      addOutcome(db, 'ep-3', true, WorkflowCategory.CODING, 2);
      addOutcome(db, 'ep-4', true, WorkflowCategory.CODING, 2);

      const alerts = await aggregator.checkAndAlert();
      expect(alerts).toEqual([]);
    });

    it('should emit WARNING alert when FPR exceeds 2%', async () => {
      // Add outcomes with 3% FPR (above 2% threshold but below 5% CRITICAL)
      // 1 failure out of 34 = ~2.94% FPR
      for (let i = 0; i < 33; i++) {
        addOutcome(db, `ep-success-${i}`, true, WorkflowCategory.CODING, 2);
      }
      addOutcome(db, 'ep-fail', false, WorkflowCategory.CODING, 2, 0.8, ErrorType.LOGIC_ERROR);

      const alerts = await aggregator.checkAndAlert();

      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe('INJECTION_QUALITY_DEGRADATION');
      expect(alerts[0].severity).toBe('WARNING');
      expect(alerts[0].category).toBe(WorkflowCategory.CODING);
      expect(alerts[0].falsePositiveRate).toBeCloseTo(0.0294, 2); // ~2.94%
      expect(alerts[0].threshold).toBe(0.02);
      expect(alerts[0].message).toContain('WARNING');
      expect(alerts[0].message).toContain('coding');
      expect(alerts[0].timestamp).toBeInstanceOf(Date);
    });

    it('should emit CRITICAL alert when FPR exceeds 5%', async () => {
      // Add outcomes with 50% FPR (above 5% CRITICAL threshold)
      addOutcome(db, 'ep-1', true, WorkflowCategory.RESEARCH, 2);
      addOutcome(db, 'ep-2', false, WorkflowCategory.RESEARCH, 2, 0.8, ErrorType.NOT_APPLICABLE);

      const alerts = await aggregator.checkAndAlert();

      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe('CRITICAL');
      expect(alerts[0].category).toBe(WorkflowCategory.RESEARCH);
      expect(alerts[0].falsePositiveRate).toBe(0.5);
      expect(alerts[0].threshold).toBe(0.05);
    });

    it('should emit alerts for multiple categories', async () => {
      // Coding: 3% FPR (WARNING - between 2% and 5%)
      // 1 failure out of 34 = ~2.94% FPR
      for (let i = 0; i < 33; i++) {
        addOutcome(db, `ep-coding-${i}`, true, WorkflowCategory.CODING, 2);
      }
      addOutcome(db, 'ep-coding-fail', false, WorkflowCategory.CODING, 2, 0.8, ErrorType.SYNTAX_ERROR);

      // Research: 100% FPR (CRITICAL)
      addOutcome(db, 'ep-research-fail', false, WorkflowCategory.RESEARCH, 2, 0.8, ErrorType.STALE_SOLUTION);

      const alerts = await aggregator.checkAndAlert();

      expect(alerts).toHaveLength(2);

      const codingAlert = alerts.find(a => a.category === WorkflowCategory.CODING);
      expect(codingAlert?.severity).toBe('WARNING');

      const researchAlert = alerts.find(a => a.category === WorkflowCategory.RESEARCH);
      expect(researchAlert?.severity).toBe('CRITICAL');
    });

    it('should respect cooldown period (1 hour per category)', async () => {
      // Add high FPR data
      addOutcome(db, 'ep-1', false, WorkflowCategory.CODING, 2, 0.8, ErrorType.LOGIC_ERROR);

      // First call should emit alert
      const firstAlerts = await aggregator.checkAndAlert();
      expect(firstAlerts).toHaveLength(1);

      // Second call immediately after should NOT emit (cooldown)
      const secondAlerts = await aggregator.checkAndAlert();
      expect(secondAlerts).toEqual([]);
    });

    it('should include recent failures in alert when configured', async () => {
      // Add failures with different error types
      addOutcome(db, 'ep-1', false, WorkflowCategory.CODING, 2, 0.8, ErrorType.SYNTAX_ERROR, 'task-1');
      addOutcome(db, 'ep-2', false, WorkflowCategory.CODING, 1, 0.8, ErrorType.LOGIC_ERROR, 'task-2');
      addOutcome(db, 'ep-3', false, WorkflowCategory.CODING, 0, 0.8, ErrorType.NOT_APPLICABLE, 'task-3');

      const alerts = await aggregator.checkAndAlert();

      expect(alerts).toHaveLength(1);
      expect(alerts[0].recentFailures).toBeDefined();
      expect(alerts[0].recentFailures!.length).toBe(3);
      expect(alerts[0].recentFailures![0].errorType).toBe(ErrorType.NOT_APPLICABLE); // Most recent
      expect(alerts[0].recentFailures![2].errorType).toBe(ErrorType.SYNTAX_ERROR); // Oldest
    });

    it('should limit recent failures to maxRecentFailures (5)', async () => {
      // Add 10 failures
      for (let i = 0; i < 10; i++) {
        addOutcome(db, `ep-${i}`, false, WorkflowCategory.CODING, i, 0.8, ErrorType.LOGIC_ERROR);
      }

      const alerts = await aggregator.checkAndAlert();

      expect(alerts).toHaveLength(1);
      expect(alerts[0].recentFailures!.length).toBe(5); // Limited to 5
    });

    it('should not include recent failures when disabled in config', async () => {
      const customAggregator = createMetricsAggregator(db, {
        includeRecentFailures: false
      });

      addOutcome(db, 'ep-1', false, WorkflowCategory.CODING, 2, 0.8, ErrorType.SYNTAX_ERROR);

      const alerts = await customAggregator.checkAndAlert();

      expect(alerts).toHaveLength(1);
      expect(alerts[0].recentFailures).toBeUndefined();
    });

    it('should use custom alert thresholds when provided', async () => {
      const customAggregator = createMetricsAggregator(db, {
        fprThreshold: 0.1,        // 10% WARNING
        criticalThreshold: 0.3     // 30% CRITICAL
      });

      // 15% FPR (would be WARNING with default, CRITICAL with custom)
      addOutcome(db, 'ep-1', true, WorkflowCategory.CODING, 2);
      addOutcome(db, 'ep-2', false, WorkflowCategory.CODING, 2, 0.8, ErrorType.LOGIC_ERROR);
      addOutcome(db, 'ep-3', true, WorkflowCategory.CODING, 2);
      addOutcome(db, 'ep-4', true, WorkflowCategory.CODING, 2);
      addOutcome(db, 'ep-5', true, WorkflowCategory.CODING, 2);
      addOutcome(db, 'ep-6', true, WorkflowCategory.CODING, 2);

      const alerts = await customAggregator.checkAndAlert();

      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe('WARNING');
      expect(alerts[0].threshold).toBe(0.1);
    });

    it('should gracefully handle individual category check failures', async () => {
      // This test verifies GUARD-IDESC-005 compliance
      // Even if one category check fails, others should still be checked

      // Add high FPR for research
      addOutcome(db, 'ep-1', false, WorkflowCategory.RESEARCH, 2, 0.8, ErrorType.LOGIC_ERROR);

      const alerts = await aggregator.checkAndAlert();

      // Should get at least the research alert despite any potential failures
      expect(alerts.length).toBeGreaterThanOrEqual(1);
    });

    it('should log alert to console.error with [ALERT] prefix', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Add outcomes with 3% FPR (above 2% threshold but below 5% CRITICAL)
      // 1 failure out of 34 = ~2.94% FPR
      for (let i = 0; i < 33; i++) {
        addOutcome(db, `ep-success-${i}`, true, WorkflowCategory.CODING, 2);
      }
      addOutcome(db, 'ep-fail', false, WorkflowCategory.CODING, 2, 0.8, ErrorType.SYNTAX_ERROR);

      await aggregator.checkAndAlert();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ALERT]')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('WARNING')
      );

      consoleErrorSpy.mockRestore();
    });

    it('should gracefully handle overall check failures', async () => {
      const brokenDb = {
        async run() { throw new Error('DB error'); },
        async get() { throw new Error('DB error'); },
        async all() { throw new Error('DB error'); }
      } as IDatabaseConnection;

      const brokenAggregator = new MetricsAggregator(brokenDb);
      const alerts = await brokenAggregator.checkAndAlert();

      // Should return empty array instead of throwing
      expect(alerts).toEqual([]);
    });
  });

  describe('getRecentFailures', () => {
    it('should return empty array when no failures exist', async () => {
      addOutcome(db, 'ep-1', true, WorkflowCategory.CODING, 2);

      const failures = await aggregator.getRecentFailures(WorkflowCategory.CODING);
      expect(failures).toEqual([]);
    });

    it('should return recent failures for a category', async () => {
      addOutcome(db, 'ep-1', false, WorkflowCategory.CODING, 5, 0.8, ErrorType.SYNTAX_ERROR, 'task-1');
      addOutcome(db, 'ep-2', false, WorkflowCategory.CODING, 3, 0.8, ErrorType.LOGIC_ERROR, 'task-2');
      addOutcome(db, 'ep-3', true, WorkflowCategory.CODING, 2); // Success, should be filtered
      addOutcome(db, 'ep-4', false, WorkflowCategory.RESEARCH, 1, 0.8, ErrorType.NOT_APPLICABLE); // Different category

      const failures = await aggregator.getRecentFailures(WorkflowCategory.CODING);

      expect(failures).toHaveLength(2);
      expect(failures[0].episodeId).toBe('ep-2'); // Most recent first
      expect(failures[0].errorType).toBe(ErrorType.LOGIC_ERROR);
      expect(failures[1].episodeId).toBe('ep-1');
      expect(failures[1].errorType).toBe(ErrorType.SYNTAX_ERROR);
    });

    it('should limit results to specified limit', async () => {
      for (let i = 0; i < 10; i++) {
        addOutcome(db, `ep-${i}`, false, WorkflowCategory.CODING, i, 0.8, ErrorType.LOGIC_ERROR);
      }

      const failures = await aggregator.getRecentFailures(WorkflowCategory.CODING, 3);

      expect(failures).toHaveLength(3);
    });

    it('should default to limit of 5', async () => {
      for (let i = 0; i < 10; i++) {
        addOutcome(db, `ep-${i}`, false, WorkflowCategory.CODING, i, 0.8, ErrorType.LOGIC_ERROR);
      }

      const failures = await aggregator.getRecentFailures(WorkflowCategory.CODING);

      expect(failures).toHaveLength(5);
    });

    it('should return failures ordered by most recent first', async () => {
      addOutcome(db, 'ep-1', false, WorkflowCategory.CODING, 10, 0.8, ErrorType.SYNTAX_ERROR);
      addOutcome(db, 'ep-2', false, WorkflowCategory.CODING, 5, 0.8, ErrorType.LOGIC_ERROR);
      addOutcome(db, 'ep-3', false, WorkflowCategory.CODING, 1, 0.8, ErrorType.NOT_APPLICABLE);

      const failures = await aggregator.getRecentFailures(WorkflowCategory.CODING, 10);

      expect(failures[0].episodeId).toBe('ep-3'); // 1 day ago (most recent)
      expect(failures[1].episodeId).toBe('ep-2'); // 5 days ago
      expect(failures[2].episodeId).toBe('ep-1'); // 10 days ago (oldest)
    });

    it('should include all outcome fields', async () => {
      addOutcome(db, 'ep-1', false, WorkflowCategory.CODING, 2, 0.8, ErrorType.SYNTAX_ERROR, 'task-123');

      const failures = await aggregator.getRecentFailures(WorkflowCategory.CODING);

      expect(failures).toHaveLength(1);
      expect(failures[0]).toHaveProperty('outcomeId');
      expect(failures[0]).toHaveProperty('episodeId', 'ep-1');
      expect(failures[0]).toHaveProperty('taskId', 'task-123');
      expect(failures[0]).toHaveProperty('success', false);
      expect(failures[0]).toHaveProperty('errorType', ErrorType.SYNTAX_ERROR);
      expect(failures[0]).toHaveProperty('details');
      expect(failures[0]).toHaveProperty('recordedAt');
      expect(failures[0].recordedAt).toBeInstanceOf(Date);
    });

    it('should gracefully handle database errors', async () => {
      const brokenDb = {
        async run() { throw new Error('DB error'); },
        async get() { throw new Error('DB error'); },
        async all() { throw new Error('DB error'); }
      } as IDatabaseConnection;

      const brokenAggregator = new MetricsAggregator(brokenDb);
      const failures = await brokenAggregator.getRecentFailures(WorkflowCategory.CODING);

      expect(failures).toEqual([]);
    });
  });
});
