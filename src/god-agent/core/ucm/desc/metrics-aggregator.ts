/**
 * IDESC-001: Intelligent DESC v2 - Metrics Aggregation Service
 * TASK-IDESC-LEARN-001: Implement Metrics Aggregation Service
 * TASK-IDESC-LEARN-002: Implement Alert System for Quality Degradation
 * Sprint 6: Active Learning
 *
 * Aggregates injection metrics for active learning threshold adjustments.
 *
 * Implements:
 * - REQ-IDESC-009: Aggregate injection metrics by workflow category
 * - REQ-IDESC-010: Calculate false positive rates
 * - REQ-IDESC-011: Support 7-day and 30-day time windows
 * - REQ-IDESC-012: Alert on quality degradation
 * - NFR-IDESC-003: <100ms p95 for getMetrics
 * - AC-IDESC-005d: Alert rules (WARNING: 2%, CRITICAL: 5%, cooldown: 1 hour)
 *
 * Constitution:
 * - GUARD-IDESC-005: Graceful degradation on errors
 */

import {
  WorkflowCategory,
  type IEpisodeStats,
  type IAlert,
  type IAlertConfig,
  type IOutcome
} from '../types.js';
import type { IDatabaseConnection } from './outcome-tracker.js';

/**
 * Injection metrics for a workflow category
 */
export interface IInjectionMetrics {
  /** Workflow category */
  category: WorkflowCategory;
  /** Number of episode injections */
  injectionCount: number;
  /** Success rate (0-1) */
  successRate: number;
  /** False positive rate (failed injections / total) */
  falsePositiveRate: number;
  /** Average confidence across injections (0-1) */
  avgConfidence: number;
  /** Time window for metrics */
  timeWindow: '7d' | '30d';
  /** Start of time window */
  startDate: Date;
  /** End of time window */
  endDate: Date;
}

/**
 * Metrics aggregator interface
 */
export interface IMetricsAggregator {
  /**
   * Get aggregated metrics for workflow categories
   * @param category - Optional category filter (if null, return all categories)
   * @param timeWindow - Time window for aggregation (default: '7d')
   * @returns Array of metrics by category
   */
  getMetrics(category?: WorkflowCategory, timeWindow?: '7d' | '30d'): Promise<IInjectionMetrics[]>;

  /**
   * Get false positive rate for a category or overall
   * @param category - Optional category filter
   * @returns False positive rate (0-1)
   */
  getFalsePositiveRate(category?: WorkflowCategory): Promise<number>;

  /**
   * Get success rate by category
   * @returns Map of category -> success rate
   */
  getSuccessRateByCategory(): Promise<Map<WorkflowCategory, number>>;

  /**
   * Get injection count for a time window
   * @param timeWindow - Time window ('7d' or '30d')
   * @returns Total injection count
   */
  getInjectionCountByWindow(timeWindow: '7d' | '30d'): Promise<number>;

  /**
   * Check all categories for FPR thresholds and emit alerts
   * Implements: REQ-IDESC-012, AC-IDESC-005d
   * @returns Array of emitted alerts
   */
  checkAndAlert(): Promise<IAlert[]>;

  /**
   * Get recent failure outcomes for a category
   * @param category - Workflow category
   * @param limit - Maximum number of failures to return
   * @returns Array of failure outcomes (newest first)
   */
  getRecentFailures(category: WorkflowCategory, limit?: number): Promise<IOutcome[]>;
}

/**
 * Default alert configuration
 * Implements: AC-IDESC-005d
 */
const DEFAULT_ALERT_CONFIG: IAlertConfig = {
  fprThreshold: 0.02,        // 2% WARNING threshold
  cooldownMs: 3600000,       // 1 hour cooldown
  criticalThreshold: 0.05,   // 5% CRITICAL threshold
  includeRecentFailures: true,
  maxRecentFailures: 5
};

/**
 * MetricsAggregator - Aggregates injection metrics for active learning
 *
 * Performance target: <100ms p95 for getMetrics (NFR-IDESC-003)
 */
export class MetricsAggregator implements IMetricsAggregator {
  private readonly lastAlertTime: Map<WorkflowCategory, number>;
  private readonly alertConfig: IAlertConfig;

  constructor(
    private readonly db: IDatabaseConnection,
    alertConfig?: Partial<IAlertConfig>
  ) {
    this.lastAlertTime = new Map();
    this.alertConfig = { ...DEFAULT_ALERT_CONFIG, ...alertConfig };
  }

  /**
   * Get aggregated metrics for workflow categories
   * Implements: REQ-IDESC-009, REQ-IDESC-011
   */
  async getMetrics(
    category?: WorkflowCategory,
    timeWindow: '7d' | '30d' = '7d'
  ): Promise<IInjectionMetrics[]> {
    const startTime = performance.now();

    try {
      const endDate = new Date();
      const startDate = new Date(endDate);
      const daysToSubtract = timeWindow === '7d' ? 7 : 30;
      startDate.setDate(startDate.getDate() - daysToSubtract);

      const startDateStr = startDate.toISOString();

      // Build SQL query with optional category filter
      let sql = `
        SELECT
          COALESCE(json_extract(e.metadata, '$.category'), 'general') as category,
          COUNT(DISTINCT o.episode_id) as injection_count,
          AVG(CASE WHEN o.success = 1 THEN 1.0 ELSE 0.0 END) as success_rate,
          AVG(CASE WHEN o.success = 0 THEN 1.0 ELSE 0.0 END) as false_positive_rate,
          COALESCE(AVG(CAST(json_extract(e.metadata, '$.confidence') AS REAL)), 0.5) as avg_confidence
        FROM episode_outcomes o
        INNER JOIN episodes e ON o.episode_id = e.episode_id
        WHERE o.recorded_at >= ?
      `;

      const params: unknown[] = [startDateStr];

      if (category) {
        sql += ` AND COALESCE(json_extract(e.metadata, '$.category'), 'general') = ?`;
        params.push(category);
      }

      sql += ' GROUP BY category';

      const rows = await this.db.all<{
        category: string;
        injection_count: number;
        success_rate: number;
        false_positive_rate: number;
        avg_confidence: number;
      }>(sql, params);

      const metrics: IInjectionMetrics[] = rows.map(row => ({
        category: row.category as WorkflowCategory,
        injectionCount: row.injection_count,
        successRate: row.success_rate,
        falsePositiveRate: row.false_positive_rate,
        avgConfidence: row.avg_confidence,
        timeWindow,
        startDate,
        endDate
      }));

      // Log performance
      const duration = performance.now() - startTime;
      if (duration > 100) {
        console.warn(`[MetricsAggregator] getMetrics exceeded 100ms: ${duration.toFixed(2)}ms`);
      }

      return metrics;
    } catch (error) {
      // GUARD-IDESC-005: Graceful degradation
      console.error('[MetricsAggregator] Failed to get metrics:', error);
      return [];
    }
  }

  /**
   * Get false positive rate for a category or overall
   * Implements: REQ-IDESC-010
   */
  async getFalsePositiveRate(category?: WorkflowCategory): Promise<number> {
    try {
      let sql = `
        SELECT
          AVG(CASE WHEN o.success = 0 THEN 1.0 ELSE 0.0 END) as false_positive_rate
        FROM episode_outcomes o
      `;

      const params: unknown[] = [];

      if (category) {
        sql += `
          INNER JOIN episodes e ON o.episode_id = e.episode_id
          WHERE COALESCE(json_extract(e.metadata, '$.category'), 'general') = ?
        `;
        params.push(category);
      }

      const result = await this.db.get<{ false_positive_rate: number }>(sql, params);

      return result?.false_positive_rate ?? 0;
    } catch (error) {
      // GUARD-IDESC-005: Graceful degradation
      console.error('[MetricsAggregator] Failed to get false positive rate:', error);
      return 0;
    }
  }

  /**
   * Get success rate by category
   * Implements: REQ-IDESC-009
   */
  async getSuccessRateByCategory(): Promise<Map<WorkflowCategory, number>> {
    try {
      const sql = `
        SELECT
          COALESCE(json_extract(e.metadata, '$.category'), 'general') as category,
          AVG(CASE WHEN o.success = 1 THEN 1.0 ELSE 0.0 END) as success_rate
        FROM episode_outcomes o
        INNER JOIN episodes e ON o.episode_id = e.episode_id
        GROUP BY category
      `;

      const rows = await this.db.all<{
        category: string;
        success_rate: number;
      }>(sql, []);

      const map = new Map<WorkflowCategory, number>();
      for (const row of rows) {
        map.set(row.category as WorkflowCategory, row.success_rate);
      }

      return map;
    } catch (error) {
      // GUARD-IDESC-005: Graceful degradation
      console.error('[MetricsAggregator] Failed to get success rate by category:', error);
      return new Map();
    }
  }

  /**
   * Get injection count for a time window
   * Implements: REQ-IDESC-011
   */
  async getInjectionCountByWindow(timeWindow: '7d' | '30d'): Promise<number> {
    try {
      const endDate = new Date();
      const startDate = new Date(endDate);
      const daysToSubtract = timeWindow === '7d' ? 7 : 30;
      startDate.setDate(startDate.getDate() - daysToSubtract);

      const startDateStr = startDate.toISOString();

      const sql = `
        SELECT COUNT(DISTINCT episode_id) as injection_count
        FROM episode_outcomes
        WHERE recorded_at >= ?
      `;

      const result = await this.db.get<{ injection_count: number }>(sql, [startDateStr]);

      return result?.injection_count ?? 0;
    } catch (error) {
      // GUARD-IDESC-005: Graceful degradation
      console.error('[MetricsAggregator] Failed to get injection count by window:', error);
      return 0;
    }
  }

  /**
   * Check all categories for FPR thresholds and emit alerts
   * Implements: REQ-IDESC-012, AC-IDESC-005d
   */
  async checkAndAlert(): Promise<IAlert[]> {
    const alerts: IAlert[] = [];
    const now = Date.now();

    try {
      // Get all workflow categories
      const categories: WorkflowCategory[] = [
        WorkflowCategory.RESEARCH,
        WorkflowCategory.CODING,
        WorkflowCategory.GENERAL
      ];

      for (const category of categories) {
        try {
          // Check cooldown period
          const lastAlert = this.lastAlertTime.get(category);
          if (lastAlert && (now - lastAlert) < this.alertConfig.cooldownMs) {
            continue; // Skip if in cooldown period
          }

          // Get FPR for this category
          const fpr = await this.getFalsePositiveRate(category);

          // Check if threshold exceeded
          if (fpr > this.alertConfig.fprThreshold) {
            const alert = await this.emitAlert(category, fpr);
            alerts.push(alert);
            this.lastAlertTime.set(category, now);
          }
        } catch (error) {
          // GUARD-IDESC-005: Don't fail entire check if one category fails
          console.error(`[MetricsAggregator] Failed to check category ${category}:`, error);
        }
      }

      return alerts;
    } catch (error) {
      // GUARD-IDESC-005: Graceful degradation
      console.error('[MetricsAggregator] Failed to check and alert:', error);
      return alerts;
    }
  }

  /**
   * Emit an alert for quality degradation
   * Implements: AC-IDESC-005d
   */
  private async emitAlert(category: WorkflowCategory, fpr: number): Promise<IAlert> {
    const severity: 'WARNING' | 'CRITICAL' = fpr > this.alertConfig.criticalThreshold ? 'CRITICAL' : 'WARNING';
    const threshold = severity === 'CRITICAL' ? this.alertConfig.criticalThreshold : this.alertConfig.fprThreshold;

    const alert: IAlert = {
      type: 'INJECTION_QUALITY_DEGRADATION',
      severity,
      category,
      falsePositiveRate: fpr,
      threshold,
      message: `${severity}: Injection quality degradation detected for ${category}. FPR: ${(fpr * 100).toFixed(2)}% (threshold: ${(threshold * 100).toFixed(2)}%)`,
      timestamp: new Date()
    };

    // Include recent failures if configured
    if (this.alertConfig.includeRecentFailures) {
      try {
        const failures = await this.getRecentFailures(category, this.alertConfig.maxRecentFailures);
        alert.recentFailures = failures;
      } catch (error) {
        console.error('[MetricsAggregator] Failed to get recent failures for alert:', error);
      }
    }

    // Log alert to console
    console.error(`[ALERT] ${alert.message}`);

    return alert;
  }

  /**
   * Get recent failure outcomes for a category
   * Implements: REQ-IDESC-012
   */
  async getRecentFailures(category: WorkflowCategory, limit: number = 5): Promise<IOutcome[]> {
    try {
      const sql = `
        SELECT
          o.outcome_id as outcomeId,
          o.episode_id as episodeId,
          o.task_id as taskId,
          o.success,
          o.error_type as errorType,
          o.details,
          o.recorded_at as recordedAt
        FROM episode_outcomes o
        INNER JOIN episodes e ON o.episode_id = e.episode_id
        WHERE o.success = 0
          AND COALESCE(json_extract(e.metadata, '$.category'), 'general') = ?
        ORDER BY o.recorded_at DESC
        LIMIT ?
      `;

      const rows = await this.db.all<{
        outcomeId: string;
        episodeId: string;
        taskId: string;
        success: number;
        errorType: string | null;
        details: string | null;
        recordedAt: string;
      }>(sql, [category, limit]);

      return rows.map(row => ({
        outcomeId: row.outcomeId,
        episodeId: row.episodeId,
        taskId: row.taskId,
        success: row.success === 1,
        errorType: row.errorType as IOutcome['errorType'],
        details: row.details ? JSON.parse(row.details) : undefined,
        recordedAt: new Date(row.recordedAt)
      }));
    } catch (error) {
      // GUARD-IDESC-005: Graceful degradation
      console.error('[MetricsAggregator] Failed to get recent failures:', error);
      return [];
    }
  }
}

/**
 * Factory function to create MetricsAggregator
 *
 * @param db - Database connection
 * @param alertConfig - Optional alert configuration
 * @returns MetricsAggregator instance
 */
export function createMetricsAggregator(
  db: IDatabaseConnection,
  alertConfig?: Partial<IAlertConfig>
): MetricsAggregator {
  return new MetricsAggregator(db, alertConfig);
}
