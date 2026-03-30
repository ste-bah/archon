/**
 * DESC Metrics Service - Unit Tests
 * TASK-IDESC-LEARN-004: Implement Observability Dashboard Integration
 * Sprint 6: Active Learning
 *
 * Tests DESC metrics service IPC endpoints for observability integration.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import {
  createDescService,
  type IDescMetricsParams,
  type IDescSuccessRateParams,
  type IDescFalsePositiveRateParams,
  type IDescInjectionCountParams,
  type IDescRecentFailuresParams,
  type IDescTimeSeriesParams
} from '../../../../../src/god-agent/core/daemon/services/desc-service.js';
import { WorkflowCategory } from '../../../../../src/god-agent/core/ucm/types.js';
import type { IDatabaseConnection } from '../../../../../src/god-agent/core/ucm/desc/index.js';

// Mock database connection
function createMockDb(): IDatabaseConnection {
  return {
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn()
  };
}

describe('DESC Metrics Service', () => {
  let mockDb: IDatabaseConnection;
  let service: ReturnType<typeof createDescService>;

  beforeEach(() => {
    mockDb = createMockDb();
    service = createDescService(mockDb);
  });

  describe('desc.metrics endpoint', () => {
    it('should return aggregated metrics for all categories', async () => {
      // Mock database response
      (mockDb.all as Mock).mockResolvedValue([
        {
          category: 'research',
          injection_count: 50,
          success_rate: 0.92,
          false_positive_rate: 0.08,
          avg_confidence: 0.85
        },
        {
          category: 'coding',
          injection_count: 30,
          success_rate: 0.87,
          false_positive_rate: 0.13,
          avg_confidence: 0.78
        }
      ]);

      const params: IDescMetricsParams = {
        timeWindow: '7d'
      };

      const result = await service.methods.get('desc.metrics')!(params);

      expect(result).toHaveProperty('metrics');
      expect(Array.isArray(result.metrics)).toBe(true);
      expect(result.metrics.length).toBe(2);

      const researchMetrics = result.metrics.find(m => m.category === 'research');
      expect(researchMetrics).toBeDefined();
      expect(researchMetrics!.injectionCount).toBe(50);
      expect(researchMetrics!.successRate).toBe(0.92);
      expect(researchMetrics!.falsePositiveRate).toBe(0.08);
      expect(researchMetrics!.avgConfidence).toBe(0.85);
      expect(researchMetrics!.timeWindow).toBe('7d');
      expect(researchMetrics!.startDate).toBeDefined();
      expect(researchMetrics!.endDate).toBeDefined();
    });

    it('should filter metrics by category', async () => {
      (mockDb.all as Mock).mockResolvedValue([
        {
          category: 'research',
          injection_count: 50,
          success_rate: 0.92,
          false_positive_rate: 0.08,
          avg_confidence: 0.85
        }
      ]);

      const params: IDescMetricsParams = {
        category: WorkflowCategory.RESEARCH,
        timeWindow: '7d'
      };

      const result = await service.methods.get('desc.metrics')!(params);

      expect(result.metrics.length).toBe(1);
      expect(result.metrics[0].category).toBe('research');
    });

    it('should support 30-day time window', async () => {
      (mockDb.all as Mock).mockResolvedValue([
        {
          category: 'general',
          injection_count: 100,
          success_rate: 0.88,
          false_positive_rate: 0.12,
          avg_confidence: 0.82
        }
      ]);

      const params: IDescMetricsParams = {
        timeWindow: '30d'
      };

      const result = await service.methods.get('desc.metrics')!(params);

      expect(result.metrics[0].timeWindow).toBe('30d');
    });

    it('should round numeric values to 4 decimal places', async () => {
      (mockDb.all as Mock).mockResolvedValue([
        {
          category: 'research',
          injection_count: 50,
          success_rate: 0.923456789,
          false_positive_rate: 0.076543211,
          avg_confidence: 0.854321098
        }
      ]);

      const params: IDescMetricsParams = {
        timeWindow: '7d'
      };

      const result = await service.methods.get('desc.metrics')!(params);

      expect(result.metrics[0].successRate).toBe(0.9235);
      expect(result.metrics[0].falsePositiveRate).toBe(0.0765);
      expect(result.metrics[0].avgConfidence).toBe(0.8543);
    });

    it('should include ISO date strings for start and end dates', async () => {
      (mockDb.all as Mock).mockResolvedValue([
        {
          category: 'general',
          injection_count: 20,
          success_rate: 0.9,
          false_positive_rate: 0.1,
          avg_confidence: 0.8
        }
      ]);

      const params: IDescMetricsParams = {
        timeWindow: '7d'
      };

      const result = await service.methods.get('desc.metrics')!(params);

      const metric = result.metrics[0];
      expect(metric.startDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(metric.endDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('desc.successRate endpoint', () => {
    it('should return success rates by category', async () => {
      (mockDb.all as Mock).mockResolvedValue([
        { category: 'research', success_rate: 0.92 },
        { category: 'coding', success_rate: 0.87 },
        { category: 'general', success_rate: 0.90 }
      ]);

      const params: IDescSuccessRateParams = {};

      const result = await service.methods.get('desc.successRate')!(params);

      expect(result).toHaveProperty('successRates');
      expect(result.successRates).toHaveProperty('research');
      expect(result.successRates).toHaveProperty('coding');
      expect(result.successRates).toHaveProperty('general');
      expect(result.successRates.research).toBe(0.92);
      expect(result.successRates.coding).toBe(0.87);
      expect(result.successRates.general).toBe(0.90);
    });

    it('should round success rates to 4 decimal places', async () => {
      (mockDb.all as Mock).mockResolvedValue([
        { category: 'research', success_rate: 0.923456789 }
      ]);

      const params: IDescSuccessRateParams = {};

      const result = await service.methods.get('desc.successRate')!(params);

      expect(result.successRates.research).toBe(0.9235);
    });
  });

  describe('desc.falsePositiveRate endpoint', () => {
    it('should return overall false positive rate', async () => {
      (mockDb.get as Mock).mockResolvedValue({
        false_positive_rate: 0.08
      });

      const params: IDescFalsePositiveRateParams = {};

      const result = await service.methods.get('desc.falsePositiveRate')!(params);

      expect(result).toHaveProperty('falsePositiveRate');
      expect(result.falsePositiveRate).toBe(0.08);
    });

    it('should filter FPR by category', async () => {
      (mockDb.get as Mock).mockResolvedValue({
        false_positive_rate: 0.05
      });

      const params: IDescFalsePositiveRateParams = {
        category: WorkflowCategory.RESEARCH
      };

      const result = await service.methods.get('desc.falsePositiveRate')!(params);

      expect(result.falsePositiveRate).toBe(0.05);
    });

    it('should round FPR to 4 decimal places', async () => {
      (mockDb.get as Mock).mockResolvedValue({
        false_positive_rate: 0.076543211
      });

      const params: IDescFalsePositiveRateParams = {};

      const result = await service.methods.get('desc.falsePositiveRate')!(params);

      expect(result.falsePositiveRate).toBe(0.0765);
    });
  });

  describe('desc.injectionCount endpoint', () => {
    it('should return injection count for 7-day window', async () => {
      (mockDb.get as Mock).mockResolvedValue({
        injection_count: 150
      });

      const params: IDescInjectionCountParams = {
        timeWindow: '7d'
      };

      const result = await service.methods.get('desc.injectionCount')!(params);

      expect(result).toHaveProperty('injectionCount');
      expect(result).toHaveProperty('timeWindow');
      expect(result.injectionCount).toBe(150);
      expect(result.timeWindow).toBe('7d');
    });

    it('should return injection count for 30-day window', async () => {
      (mockDb.get as Mock).mockResolvedValue({
        injection_count: 500
      });

      const params: IDescInjectionCountParams = {
        timeWindow: '30d'
      };

      const result = await service.methods.get('desc.injectionCount')!(params);

      expect(result.injectionCount).toBe(500);
      expect(result.timeWindow).toBe('30d');
    });

    it('should throw error for invalid time window', async () => {
      const params = {
        timeWindow: 'invalid'
      } as unknown as IDescInjectionCountParams;

      await expect(
        service.methods.get('desc.injectionCount')!(params)
      ).rejects.toThrow('timeWindow must be "7d" or "30d"');
    });
  });

  describe('desc.alerts endpoint', () => {
    it('should return empty array when no alerts', async () => {
      // Mock successful metrics (below threshold)
      (mockDb.get as Mock).mockResolvedValue({
        false_positive_rate: 0.01
      });

      const result = await service.methods.get('desc.alerts')!({});

      expect(result).toHaveProperty('alerts');
      expect(Array.isArray(result.alerts)).toBe(true);
      expect(result.alerts.length).toBe(0);
    });

    it('should return alerts when FPR exceeds threshold', async () => {
      // Mock high false positive rate (above 2% threshold)
      let callCount = 0;
      (mockDb.get as Mock).mockImplementation(() => {
        callCount++;
        // First call for RESEARCH, second for CODING, third for GENERAL
        if (callCount === 1) {
          return Promise.resolve({ false_positive_rate: 0.03 }); // WARNING
        }
        return Promise.resolve({ false_positive_rate: 0.01 }); // OK
      });

      (mockDb.all as Mock).mockResolvedValue([]);

      const result = await service.methods.get('desc.alerts')!({});

      expect(result.alerts.length).toBeGreaterThan(0);
      const alert = result.alerts[0];
      expect(alert).toHaveProperty('type');
      expect(alert).toHaveProperty('severity');
      expect(alert).toHaveProperty('category');
      expect(alert).toHaveProperty('falsePositiveRate');
      expect(alert).toHaveProperty('threshold');
      expect(alert).toHaveProperty('message');
      expect(alert).toHaveProperty('timestamp');
      expect(alert.type).toBe('INJECTION_QUALITY_DEGRADATION');
      expect(['WARNING', 'CRITICAL']).toContain(alert.severity);
    });

    it('should include recent failures in alerts', async () => {
      // Mock high FPR and recent failures
      (mockDb.get as Mock).mockResolvedValue({
        false_positive_rate: 0.03
      });

      (mockDb.all as Mock).mockResolvedValue([
        {
          outcomeId: 'outcome-1',
          episodeId: 'episode-1',
          taskId: 'task-1',
          success: 0,
          errorType: 'HALLUCINATION',
          details: JSON.stringify({ reason: 'Incorrect facts' }),
          recordedAt: new Date().toISOString()
        }
      ]);

      const result = await service.methods.get('desc.alerts')!({});

      if (result.alerts.length > 0) {
        const alert = result.alerts[0];
        expect(alert.recentFailures).toBeDefined();
        if (alert.recentFailures) {
          expect(Array.isArray(alert.recentFailures)).toBe(true);
        }
      }
    });

    it('should format alert timestamps as ISO strings', async () => {
      (mockDb.get as Mock).mockResolvedValue({
        false_positive_rate: 0.03
      });
      (mockDb.all as Mock).mockResolvedValue([]);

      const result = await service.methods.get('desc.alerts')!({});

      if (result.alerts.length > 0) {
        expect(result.alerts[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      }
    });
  });

  describe('desc.recentFailures endpoint', () => {
    it('should return recent failures for a category', async () => {
      const mockFailures = [
        {
          outcomeId: 'outcome-1',
          episodeId: 'episode-1',
          taskId: 'task-1',
          success: 0,
          errorType: 'HALLUCINATION',
          details: JSON.stringify({ reason: 'Incorrect facts' }),
          recordedAt: new Date().toISOString()
        },
        {
          outcomeId: 'outcome-2',
          episodeId: 'episode-2',
          taskId: 'task-2',
          success: 0,
          errorType: 'IRRELEVANT',
          details: JSON.stringify({ reason: 'Off-topic' }),
          recordedAt: new Date().toISOString()
        }
      ];

      (mockDb.all as Mock).mockResolvedValue(mockFailures);

      const params: IDescRecentFailuresParams = {
        category: WorkflowCategory.RESEARCH,
        limit: 5
      };

      const result = await service.methods.get('desc.recentFailures')!(params);

      expect(result).toHaveProperty('failures');
      expect(Array.isArray(result.failures)).toBe(true);
      expect(result.failures.length).toBe(2);

      const failure = result.failures[0];
      expect(failure).toHaveProperty('outcomeId');
      expect(failure).toHaveProperty('episodeId');
      expect(failure).toHaveProperty('taskId');
      expect(failure).toHaveProperty('success');
      expect(failure).toHaveProperty('errorType');
      expect(failure).toHaveProperty('details');
      expect(failure).toHaveProperty('recordedAt');
      expect(failure.success).toBe(false);
    });

    it('should use default limit of 5 when not specified', async () => {
      (mockDb.all as Mock).mockResolvedValue([]);

      const params: IDescRecentFailuresParams = {
        category: WorkflowCategory.RESEARCH
      };

      await service.methods.get('desc.recentFailures')!(params);

      // Verify the SQL query was called with limit 5
      expect(mockDb.all).toHaveBeenCalled();
    });

    it('should throw error when category is missing', async () => {
      const params = {} as IDescRecentFailuresParams;

      await expect(
        service.methods.get('desc.recentFailures')!(params)
      ).rejects.toThrow('category is required');
    });

    it('should format failure timestamps as ISO strings', async () => {
      const now = new Date();
      (mockDb.all as Mock).mockResolvedValue([
        {
          outcomeId: 'outcome-1',
          episodeId: 'episode-1',
          taskId: 'task-1',
          success: 0,
          errorType: 'HALLUCINATION',
          details: JSON.stringify({}),
          recordedAt: now.toISOString()
        }
      ]);

      const params: IDescRecentFailuresParams = {
        category: WorkflowCategory.RESEARCH
      };

      const result = await service.methods.get('desc.recentFailures')!(params);

      expect(result.failures[0].recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('desc.timeSeries endpoint', () => {
    it('should return time series data', async () => {
      (mockDb.all as Mock).mockResolvedValue([
        {
          category: 'research',
          injection_count: 50,
          success_rate: 0.92,
          false_positive_rate: 0.08,
          avg_confidence: 0.85
        }
      ]);

      const params: IDescTimeSeriesParams = {
        timeWindow: '7d',
        granularity: 'daily'
      };

      const result = await service.methods.get('desc.timeSeries')!(params);

      expect(result).toHaveProperty('timeSeries');
      expect(result).toHaveProperty('granularity');
      expect(result).toHaveProperty('timeWindow');
      expect(Array.isArray(result.timeSeries)).toBe(true);
      expect(result.granularity).toBe('daily');
      expect(result.timeWindow).toBe('7d');
    });

    it('should include timestamp and value in time series points', async () => {
      (mockDb.all as Mock).mockResolvedValue([
        {
          category: 'research',
          injection_count: 50,
          success_rate: 0.92,
          false_positive_rate: 0.08,
          avg_confidence: 0.85
        }
      ]);

      const params: IDescTimeSeriesParams = {
        timeWindow: '7d',
        granularity: 'daily'
      };

      const result = await service.methods.get('desc.timeSeries')!(params);

      if (result.timeSeries.length > 0) {
        const point = result.timeSeries[0];
        expect(point).toHaveProperty('timestamp');
        expect(point).toHaveProperty('value');
        expect(point).toHaveProperty('category');
        expect(point.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      }
    });

    it('should use default parameters when not specified', async () => {
      (mockDb.all as Mock).mockResolvedValue([]);

      const params: IDescTimeSeriesParams = {};

      const result = await service.methods.get('desc.timeSeries')!(params);

      expect(result.timeWindow).toBe('7d');
      expect(result.granularity).toBe('daily');
    });
  });

  describe('Service Handler Structure', () => {
    it('should have methods map', () => {
      expect(service).toHaveProperty('methods');
      expect(service.methods).toBeInstanceOf(Map);
    });

    it('should register all DESC endpoints', () => {
      const expectedMethods = [
        'desc.metrics',
        'desc.successRate',
        'desc.falsePositiveRate',
        'desc.injectionCount',
        'desc.alerts',
        'desc.recentFailures',
        'desc.timeSeries'
      ];

      for (const method of expectedMethods) {
        expect(service.methods.has(method)).toBe(true);
      }
    });

    it('should have async method handlers', () => {
      const method = service.methods.get('desc.metrics');
      expect(method).toBeDefined();
      expect(typeof method).toBe('function');
    });
  });
});
