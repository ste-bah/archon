/**
 * DESC Metrics Service - IPC wrapper for IDESC-001 Metrics Aggregation
 * TASK-IDESC-LEARN-004: Implement Observability Dashboard Integration
 * Sprint 6: Active Learning
 *
 * Exposes DESC (Dual Embedding Symmetric Chunking) metrics via JSON-RPC 2.0
 * for observability dashboards and monitoring systems.
 *
 * Implements:
 * - REQ-IDESC-009: Aggregate injection metrics by workflow category
 * - REQ-IDESC-010: Calculate false positive rates
 * - REQ-IDESC-011: Support 7-day and 30-day time windows
 * - REQ-IDESC-012: Alert on quality degradation
 * - NFR-IDESC-003: <100ms p95 for getMetrics
 */

import {
  createMetricsAggregator,
  type IMetricsAggregator,
  type IInjectionMetrics,
  type IDatabaseConnection
} from '../../ucm/desc/index.js';
import { WorkflowCategory, type IAlert, type IOutcome } from '../../ucm/types.js';
import { createServiceHandler, type ServiceHandler } from '../service-registry.js';

/**
 * DESC metrics service parameters
 */
export interface IDescMetricsParams {
  /** Optional workflow category filter */
  category?: WorkflowCategory | string;
  /** Time window for metrics aggregation */
  timeWindow?: '7d' | '30d';
}

export interface IDescSuccessRateParams {
  /** Optional workflow category filter */
  category?: WorkflowCategory | string;
}

export interface IDescFalsePositiveRateParams {
  /** Optional workflow category filter */
  category?: WorkflowCategory | string;
}

export interface IDescInjectionCountParams {
  /** Time window for injection count */
  timeWindow: '7d' | '30d';
}

export interface IDescRecentFailuresParams {
  /** Workflow category */
  category: WorkflowCategory | string;
  /** Maximum number of failures to return */
  limit?: number;
}

export interface IDescTimeSeriesParams {
  /** Optional workflow category filter */
  category?: WorkflowCategory | string;
  /** Time window for time series data */
  timeWindow?: '7d' | '30d';
  /** Granularity: 'hourly' or 'daily' */
  granularity?: 'hourly' | 'daily';
}

/**
 * DESC metrics service responses
 */
export interface IDescMetricsResponse {
  /** Array of metrics by workflow category */
  metrics: Array<{
    category: string;
    injectionCount: number;
    successRate: number;
    falsePositiveRate: number;
    avgConfidence: number;
    timeWindow: string;
    startDate: string;
    endDate: string;
  }>;
}

export interface IDescSuccessRateResponse {
  /** Map of category to success rate */
  successRates: Record<string, number>;
}

export interface IDescFalsePositiveRateResponse {
  /** False positive rate (0-1) */
  falsePositiveRate: number;
}

export interface IDescInjectionCountResponse {
  /** Total injection count for time window */
  injectionCount: number;
  timeWindow: string;
}

export interface IDescAlertsResponse {
  /** Array of emitted alerts */
  alerts: Array<{
    type: string;
    severity: string;
    category: string;
    falsePositiveRate: number;
    threshold: number;
    message: string;
    timestamp: string;
    recentFailures?: Array<{
      outcomeId: string;
      episodeId: string;
      taskId: string;
      success: boolean;
      errorType: string | null;
      details: unknown;
      recordedAt: string;
    }>;
  }>;
}

export interface IDescRecentFailuresResponse {
  /** Array of recent failure outcomes */
  failures: Array<{
    outcomeId: string;
    episodeId: string;
    taskId: string;
    success: boolean;
    errorType: string | null;
    details: unknown;
    recordedAt: string;
  }>;
}

export interface IDescTimeSeriesResponse {
  /** Time series data points */
  timeSeries: Array<{
    timestamp: string;
    value: number;
    category?: string;
  }>;
  granularity: string;
  timeWindow: string;
}

/**
 * Create DESC metrics service handler
 *
 * @param db - Database connection for accessing episode outcomes
 * @returns Service handler with method map
 *
 * @example
 * ```typescript
 * const db = getDatabaseConnection();
 * const descService = createDescService(db);
 * serviceRegistry.registerService('desc', descService);
 * ```
 */
export function createDescService(db: IDatabaseConnection): ServiceHandler {
  const aggregator: IMetricsAggregator = createMetricsAggregator(db);

  return createServiceHandler({
    /**
     * Get aggregated metrics for workflow categories
     * Endpoint: desc.metrics
     *
     * @param params - Category filter and time window
     * @returns Aggregated metrics by category
     */
    'desc.metrics': async (params: IDescMetricsParams): Promise<IDescMetricsResponse> => {
      const { category, timeWindow = '7d' } = params;

      // Validate category if provided
      const categoryFilter = category
        ? (category as WorkflowCategory)
        : undefined;

      const metrics: IInjectionMetrics[] = await aggregator.getMetrics(categoryFilter, timeWindow);

      return {
        metrics: metrics.map((m) => ({
          category: m.category,
          injectionCount: m.injectionCount,
          successRate: parseFloat(m.successRate.toFixed(4)),
          falsePositiveRate: parseFloat(m.falsePositiveRate.toFixed(4)),
          avgConfidence: parseFloat(m.avgConfidence.toFixed(4)),
          timeWindow: m.timeWindow,
          startDate: m.startDate.toISOString(),
          endDate: m.endDate.toISOString()
        }))
      };
    },

    /**
     * Get success rates by workflow category
     * Endpoint: desc.successRate
     *
     * @param _params - Optional category filter (reserved for future use)
     * @returns Success rates by category
     */
    'desc.successRate': async (_params: IDescSuccessRateParams): Promise<IDescSuccessRateResponse> => {
      const successRateMap = await aggregator.getSuccessRateByCategory();

      const successRates: Record<string, number> = {};
      for (const [category, rate] of successRateMap.entries()) {
        successRates[category] = parseFloat(rate.toFixed(4));
      }

      return { successRates };
    },

    /**
     * Get false positive rate
     * Endpoint: desc.falsePositiveRate
     *
     * @param params - Optional category filter
     * @returns False positive rate
     */
    'desc.falsePositiveRate': async (params: IDescFalsePositiveRateParams): Promise<IDescFalsePositiveRateResponse> => {
      const { category } = params;

      const categoryFilter = category
        ? (category as WorkflowCategory)
        : undefined;

      const fpr = await aggregator.getFalsePositiveRate(categoryFilter);

      return {
        falsePositiveRate: parseFloat(fpr.toFixed(4))
      };
    },

    /**
     * Get injection count for time window
     * Endpoint: desc.injectionCount
     *
     * @param params - Time window parameter
     * @returns Injection count for the specified window
     */
    'desc.injectionCount': async (params: IDescInjectionCountParams): Promise<IDescInjectionCountResponse> => {
      const { timeWindow } = params;

      if (!timeWindow || (timeWindow !== '7d' && timeWindow !== '30d')) {
        throw new Error('timeWindow must be "7d" or "30d"');
      }

      const count = await aggregator.getInjectionCountByWindow(timeWindow);

      return {
        injectionCount: count,
        timeWindow
      };
    },

    /**
     * Check for quality degradation and emit alerts
     * Endpoint: desc.alerts
     *
     * @returns Array of emitted alerts
     */
    'desc.alerts': async (): Promise<IDescAlertsResponse> => {
      const alerts: IAlert[] = await aggregator.checkAndAlert();

      return {
        alerts: alerts.map((alert) => ({
          type: alert.type,
          severity: alert.severity,
          category: alert.category,
          falsePositiveRate: parseFloat(alert.falsePositiveRate.toFixed(4)),
          threshold: parseFloat(alert.threshold.toFixed(4)),
          message: alert.message,
          timestamp: alert.timestamp.toISOString(),
          recentFailures: alert.recentFailures?.map((failure) => ({
            outcomeId: failure.outcomeId,
            episodeId: failure.episodeId,
            taskId: failure.taskId,
            success: failure.success,
            errorType: failure.errorType ?? null,
            details: failure.details,
            recordedAt: failure.recordedAt.toISOString()
          }))
        }))
      };
    },

    /**
     * Get recent failure outcomes for a category
     * Endpoint: desc.recentFailures
     *
     * @param params - Category and limit
     * @returns Array of recent failures
     */
    'desc.recentFailures': async (params: IDescRecentFailuresParams): Promise<IDescRecentFailuresResponse> => {
      const { category, limit = 5 } = params;

      if (!category) {
        throw new Error('category is required');
      }

      const failures: IOutcome[] = await aggregator.getRecentFailures(
        category as WorkflowCategory,
        limit
      );

      return {
        failures: failures.map((failure) => ({
          outcomeId: failure.outcomeId,
          episodeId: failure.episodeId,
          taskId: failure.taskId,
          success: failure.success,
          errorType: failure.errorType ?? null,
          details: failure.details,
          recordedAt: failure.recordedAt.toISOString()
        }))
      };
    },

    /**
     * Get time-series data for charting
     * Endpoint: desc.timeSeries
     *
     * @param params - Category, time window, and granularity
     * @returns Time-series data points
     */
    'desc.timeSeries': async (params: IDescTimeSeriesParams): Promise<IDescTimeSeriesResponse> => {
      const { category, timeWindow = '7d', granularity = 'daily' } = params;

      // For now, we derive time series from aggregated metrics
      // In the future, this could be optimized with dedicated time-series queries
      const categoryFilter = category
        ? (category as WorkflowCategory)
        : undefined;

      const metrics: IInjectionMetrics[] = await aggregator.getMetrics(categoryFilter, timeWindow);

      // Simple time series: one data point per metric (current implementation)
      // TODO: Implement true time-series with hourly/daily buckets
      const timeSeries = metrics.map((m) => ({
        timestamp: m.endDate.toISOString(),
        value: parseFloat(m.successRate.toFixed(4)),
        category: m.category
      }));

      return {
        timeSeries,
        granularity,
        timeWindow
      };
    }
  });
}
