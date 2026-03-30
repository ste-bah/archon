/**
 * Quality Monitoring Tests
 *
 * Tests for continuous quality monitoring functionality in ActivityStream
 * Implements test coverage for [AC-IDESC-005a]
 *
 * @module tests/god-agent/observability/quality-monitoring
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import ActivityStream, { IQualityMetric } from '../../../src/god-agent/observability/activity-stream.js';

describe('Quality Monitoring', () => {
  let stream: ActivityStream;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stream = new ActivityStream();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('trackQualityMetric', () => {
    it('should track quality metrics without alerts when thresholds are met', async () => {
      const metric: IQualityMetric = {
        timestamp: new Date(),
        category: 'test-category',
        accuracy: 0.95,
        falsePositiveRate: 0.02,
        injectionCount: 100,
      };

      await stream.trackQualityMetric(metric);

      // Should emit quality_metric event
      const events = stream.getAll();
      expect(events).toHaveLength(1);

      const event = events[0];
      expect(event.operation).toBe('quality_metric');
      expect(event.component).toBe('quality_monitor');
      expect(event.status).toBe('success');
      expect(event.metadata).toMatchObject({
        category: 'test-category',
        accuracy: 0.95,
        fpr: 0.02,
        injectionCount: 100,
      });

      // Should not trigger alerts
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should emit WARNING alert when accuracy drops below 90%', async () => {
      const metric: IQualityMetric = {
        timestamp: new Date(),
        category: 'low-accuracy',
        accuracy: 0.85,
        falsePositiveRate: 0.02,
        injectionCount: 50,
      };

      await stream.trackQualityMetric(metric);

      // Should emit quality_metric and alert events
      const events = stream.getAll();
      expect(events).toHaveLength(2);

      const alertEvent = events.find(e => e.operation === 'alert');
      expect(alertEvent).toBeDefined();
      expect(alertEvent?.component).toBe('quality_monitor');
      expect(alertEvent?.status).toBe('warning');
      expect(alertEvent?.metadata?.severity).toBe('WARNING');
      expect(alertEvent?.metadata?.alertType).toBe('ACCURACY_DEGRADATION');
      expect(alertEvent?.metadata?.message).toContain('85.0%');
      expect(alertEvent?.metadata?.message).toContain('90%');
      expect(alertEvent?.metadata?.category).toBe('low-accuracy');

      // Should log alert to console (JSON format with severity)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('"severity":"WARNING"')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('85.0%')
      );
    });

    it('should emit CRITICAL alert when FPR exceeds 3%', async () => {
      const metric: IQualityMetric = {
        timestamp: new Date(),
        category: 'high-fpr',
        accuracy: 0.95,
        falsePositiveRate: 0.05,
        injectionCount: 200,
      };

      await stream.trackQualityMetric(metric);

      // Should emit quality_metric and alert events
      const events = stream.getAll();
      expect(events).toHaveLength(2);

      const alertEvent = events.find(e => e.operation === 'alert');
      expect(alertEvent).toBeDefined();
      expect(alertEvent?.component).toBe('quality_monitor');
      expect(alertEvent?.status).toBe('error');
      expect(alertEvent?.metadata?.severity).toBe('CRITICAL');
      expect(alertEvent?.metadata?.alertType).toBe('FPR_ESCALATION');
      expect(alertEvent?.metadata?.message).toContain('5.0%');
      expect(alertEvent?.metadata?.message).toContain('3%');
      expect(alertEvent?.metadata?.category).toBe('high-fpr');

      // Should log alert to console (JSON format with severity)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('"severity":"CRITICAL"')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('5.0%')
      );
    });

    it('should emit multiple alerts when both thresholds are violated', async () => {
      const metric: IQualityMetric = {
        timestamp: new Date(),
        category: 'dual-violation',
        accuracy: 0.80,
        falsePositiveRate: 0.08,
        injectionCount: 75,
      };

      await stream.trackQualityMetric(metric);

      // Should emit quality_metric and 2 alert events
      const events = stream.getAll();
      expect(events).toHaveLength(3);

      const alertEvents = events.filter(e => e.operation === 'alert');
      expect(alertEvents).toHaveLength(2);

      const warningAlert = alertEvents.find(
        e => e.metadata?.severity === 'WARNING'
      );
      expect(warningAlert).toBeDefined();
      expect(warningAlert?.metadata?.alertType).toBe('ACCURACY_DEGRADATION');

      const criticalAlert = alertEvents.find(
        e => e.metadata?.severity === 'CRITICAL'
      );
      expect(criticalAlert).toBeDefined();
      expect(criticalAlert?.metadata?.alertType).toBe('FPR_ESCALATION');

      // Should log both alerts
      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
    });

    it('should handle boundary conditions correctly', async () => {
      // Test exactly at accuracy threshold (90%)
      const exactAccuracy: IQualityMetric = {
        timestamp: new Date(),
        category: 'boundary-accuracy',
        accuracy: 0.90,
        falsePositiveRate: 0.01,
        injectionCount: 100,
      };

      await stream.trackQualityMetric(exactAccuracy);
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      stream.clear();
      consoleErrorSpy.mockClear();

      // Test exactly at FPR threshold (3%)
      const exactFPR: IQualityMetric = {
        timestamp: new Date(),
        category: 'boundary-fpr',
        accuracy: 0.95,
        falsePositiveRate: 0.03,
        injectionCount: 100,
      };

      await stream.trackQualityMetric(exactFPR);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should include timestamp in metric event', async () => {
      const timestamp = new Date('2025-01-01T12:00:00Z');
      const metric: IQualityMetric = {
        timestamp,
        category: 'timestamp-test',
        accuracy: 0.95,
        falsePositiveRate: 0.01,
        injectionCount: 50,
      };

      await stream.trackQualityMetric(metric);

      const events = stream.getAll();
      const metricEvent = events.find(e => e.operation === 'quality_metric');
      expect(metricEvent?.metadata?.timestamp).toBe(timestamp.toISOString());
    });

    it('should track multiple categories independently', async () => {
      const metrics: IQualityMetric[] = [
        {
          timestamp: new Date(),
          category: 'category-a',
          accuracy: 0.95,
          falsePositiveRate: 0.01,
          injectionCount: 100,
        },
        {
          timestamp: new Date(),
          category: 'category-b',
          accuracy: 0.88,
          falsePositiveRate: 0.02,
          injectionCount: 150,
        },
        {
          timestamp: new Date(),
          category: 'category-c',
          accuracy: 0.92,
          falsePositiveRate: 0.05,
          injectionCount: 75,
        },
      ];

      for (const metric of metrics) {
        await stream.trackQualityMetric(metric);
      }

      const events = stream.getAll();
      const metricEvents = events.filter(e => e.operation === 'quality_metric');
      expect(metricEvents).toHaveLength(3);

      const alertEvents = events.filter(e => e.operation === 'alert');
      expect(alertEvents).toHaveLength(2); // category-b accuracy, category-c FPR
    });

    it('should handle zero injection count', async () => {
      const metric: IQualityMetric = {
        timestamp: new Date(),
        category: 'zero-injections',
        accuracy: 1.0,
        falsePositiveRate: 0.0,
        injectionCount: 0,
      };

      await stream.trackQualityMetric(metric);

      const events = stream.getAll();
      expect(events).toHaveLength(1);

      const event = events[0];
      expect(event.metadata?.injectionCount).toBe(0);
    });

    it('should handle perfect metrics (100% accuracy, 0% FPR)', async () => {
      const metric: IQualityMetric = {
        timestamp: new Date(),
        category: 'perfect',
        accuracy: 1.0,
        falsePositiveRate: 0.0,
        injectionCount: 500,
      };

      await stream.trackQualityMetric(metric);

      const events = stream.getAll();
      expect(events).toHaveLength(1);
      expect(events[0].operation).toBe('quality_metric');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should handle worst-case metrics gracefully', async () => {
      const metric: IQualityMetric = {
        timestamp: new Date(),
        category: 'worst-case',
        accuracy: 0.0,
        falsePositiveRate: 1.0,
        injectionCount: 10,
      };

      await stream.trackQualityMetric(metric);

      const events = stream.getAll();
      expect(events.length).toBeGreaterThanOrEqual(3); // metric + 2 alerts

      const alertEvents = events.filter(e => e.operation === 'alert');
      expect(alertEvents).toHaveLength(2);
    });
  });

  describe('Quality Monitoring Integration', () => {
    it('should allow subscription to quality events', async () => {
      const qualityEvents: any[] = [];
      const alertEvents: any[] = [];

      stream.subscribe((event) => {
        if (event.operation === 'quality_metric') {
          qualityEvents.push(event);
        } else if (event.operation === 'alert') {
          alertEvents.push(event);
        }
      });

      const metric: IQualityMetric = {
        timestamp: new Date(),
        category: 'subscription-test',
        accuracy: 0.85,
        falsePositiveRate: 0.05,
        injectionCount: 100,
      };

      await stream.trackQualityMetric(metric);

      // Wait for async subscription notifications
      await new Promise(resolve => setImmediate(resolve));

      expect(qualityEvents).toHaveLength(1);
      expect(alertEvents).toHaveLength(2);
    });

    it('should preserve quality events in circular buffer', async () => {
      // Fill buffer with quality metrics
      for (let i = 0; i < 50; i++) {
        await stream.trackQualityMetric({
          timestamp: new Date(),
          category: `category-${i}`,
          accuracy: 0.90 + (i % 10) / 100,
          falsePositiveRate: 0.01 + (i % 5) / 1000,
          injectionCount: i * 10,
        });
      }

      const events = stream.getAll();
      const qualityEvents = events.filter(e => e.operation === 'quality_metric');
      expect(qualityEvents.length).toBeGreaterThan(0);
    });

    it('should support filtering quality events by component', async () => {
      await stream.trackQualityMetric({
        timestamp: new Date(),
        category: 'test-filter',
        accuracy: 0.95,
        falsePositiveRate: 0.01,
        injectionCount: 100,
      });

      const filtered = stream.filter({ component: 'quality_monitor' });
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.every(e => e.component === 'quality_monitor')).toBe(true);
    });
  });

  describe('Alert Formatting', () => {
    it('should format accuracy percentage to 1 decimal place', async () => {
      const metric: IQualityMetric = {
        timestamp: new Date(),
        category: 'format-test',
        accuracy: 0.8567,
        falsePositiveRate: 0.01,
        injectionCount: 100,
      };

      await stream.trackQualityMetric(metric);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('85.7%')
      );
    });

    it('should format FPR percentage to 1 decimal place', async () => {
      const metric: IQualityMetric = {
        timestamp: new Date(),
        category: 'format-test',
        accuracy: 0.95,
        falsePositiveRate: 0.0456,
        injectionCount: 100,
      };

      await stream.trackQualityMetric(metric);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('4.6%')
      );
    });
  });
});
