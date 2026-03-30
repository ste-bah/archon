/**
 * IDESC-001: Intelligent DESC v2 - Quality Monitor Tests
 * TASK-IDESC-LEARN-005: Implement Continuous Quality Monitoring
 * Sprint 6: Active Learning
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  QualityMonitor,
  createQualityMonitor,
  type IQualityMonitorConfig
} from '../../../../../src/god-agent/core/ucm/desc/quality-monitor.js';
import { MetricsAggregator } from '../../../../../src/god-agent/core/ucm/desc/metrics-aggregator.js';
import { WorkflowCategory, type IAlert } from '../../../../../src/god-agent/core/ucm/types.js';

// Mock MetricsAggregator
class MockMetricsAggregator {
  checkAndAlertCalls: number = 0;
  alertsToReturn: IAlert[] = [];
  shouldThrow: boolean = false;

  async checkAndAlert(): Promise<IAlert[]> {
    this.checkAndAlertCalls++;
    if (this.shouldThrow) {
      throw new Error('Mock checkAndAlert error');
    }
    return this.alertsToReturn;
  }
}

describe('QualityMonitor', () => {
  let mockAggregator: MockMetricsAggregator;
  let monitor: QualityMonitor;

  beforeEach(() => {
    mockAggregator = new MockMetricsAggregator();
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (monitor) {
      monitor.stop();
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('constructor and factory', () => {
    it('should create monitor with default config', () => {
      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator);
      expect(monitor).toBeDefined();
      expect(monitor.isRunning()).toBe(false);
      expect(monitor.getCheckCount()).toBe(0);
      expect(monitor.getLastCheckTime()).toBeNull();
    });

    it('should create monitor with custom config', () => {
      const config: Partial<IQualityMonitorConfig> = {
        intervalMs: 5000,
        enabled: true,
        onAlert: vi.fn()
      };
      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator, config);
      expect(monitor).toBeDefined();
    });

    it('should create monitor via factory function', () => {
      monitor = createQualityMonitor(mockAggregator as unknown as MetricsAggregator, {
        intervalMs: 10000
      });
      expect(monitor).toBeDefined();
      expect(monitor.isRunning()).toBe(false);
    });
  });

  describe('start() and stop()', () => {
    it('should start monitoring and run initial check', async () => {
      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator);

      monitor.start();

      expect(monitor.isRunning()).toBe(true);

      // Wait for initial check to complete
      await vi.advanceTimersByTimeAsync(0);

      expect(mockAggregator.checkAndAlertCalls).toBeGreaterThan(0);
    });

    it('should not start if already running', async () => {
      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator);

      monitor.start();
      const firstCallCount = mockAggregator.checkAndAlertCalls;

      monitor.start(); // Second start should be ignored

      await vi.advanceTimersByTimeAsync(0);

      // Should not have extra calls from second start
      expect(monitor.isRunning()).toBe(true);
    });

    it('should not start if disabled', () => {
      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator, {
        enabled: false
      });

      monitor.start();

      expect(monitor.isRunning()).toBe(false);
      expect(mockAggregator.checkAndAlertCalls).toBe(0);
    });

    it('should stop monitoring', async () => {
      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator);

      monitor.start();
      await vi.advanceTimersByTimeAsync(0);

      monitor.stop();

      expect(monitor.isRunning()).toBe(false);
    });

    it('should handle stop when not running', () => {
      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator);

      expect(() => monitor.stop()).not.toThrow();
      expect(monitor.isRunning()).toBe(false);
    });
  });

  describe('periodic checks', () => {
    it('should run checks at configured interval', async () => {
      const intervalMs = 1000; // 1 second for testing
      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator, {
        intervalMs
      });

      monitor.start();
      await vi.advanceTimersByTimeAsync(0); // Initial check

      const initialCalls = mockAggregator.checkAndAlertCalls;

      // Advance time by one interval
      await vi.advanceTimersByTimeAsync(intervalMs);

      expect(mockAggregator.checkAndAlertCalls).toBeGreaterThan(initialCalls);
    });

    it('should run multiple checks over time', async () => {
      const intervalMs = 500;
      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator, {
        intervalMs
      });

      monitor.start();
      await vi.advanceTimersByTimeAsync(0); // Initial check

      // Advance time by 3 intervals
      await vi.advanceTimersByTimeAsync(intervalMs * 3);

      // Should have run initial + 3 periodic checks
      expect(mockAggregator.checkAndAlertCalls).toBeGreaterThanOrEqual(4);
    });

    it('should update checkCount on each check', async () => {
      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator, {
        intervalMs: 100
      });

      monitor.start();
      await vi.advanceTimersByTimeAsync(0);

      const countAfterStart = monitor.getCheckCount();
      expect(countAfterStart).toBeGreaterThan(0);

      await vi.advanceTimersByTimeAsync(100);

      expect(monitor.getCheckCount()).toBeGreaterThan(countAfterStart);
    });

    it('should update lastCheckTime on each check', async () => {
      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator);

      monitor.start();
      await vi.advanceTimersByTimeAsync(0);

      const lastCheckTime = monitor.getLastCheckTime();
      expect(lastCheckTime).not.toBeNull();
      expect(lastCheckTime).toBeInstanceOf(Date);
    });
  });

  describe('alert callbacks', () => {
    it('should invoke onAlert callback when alerts are generated', async () => {
      const onAlert = vi.fn();
      const mockAlert: IAlert = {
        type: 'INJECTION_QUALITY_DEGRADATION',
        severity: 'WARNING',
        category: WorkflowCategory.CODING,
        falsePositiveRate: 0.03,
        threshold: 0.02,
        message: 'Test alert',
        timestamp: new Date()
      };

      mockAggregator.alertsToReturn = [mockAlert];

      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator, {
        onAlert
      });

      monitor.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(onAlert).toHaveBeenCalledWith(mockAlert);
    });

    it('should invoke callback for each alert', async () => {
      const onAlert = vi.fn();
      const mockAlerts: IAlert[] = [
        {
          type: 'INJECTION_QUALITY_DEGRADATION',
          severity: 'WARNING',
          category: WorkflowCategory.CODING,
          falsePositiveRate: 0.03,
          threshold: 0.02,
          message: 'Alert 1',
          timestamp: new Date()
        },
        {
          type: 'INJECTION_QUALITY_DEGRADATION',
          severity: 'CRITICAL',
          category: WorkflowCategory.RESEARCH,
          falsePositiveRate: 0.06,
          threshold: 0.05,
          message: 'Alert 2',
          timestamp: new Date()
        }
      ];

      mockAggregator.alertsToReturn = mockAlerts;

      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator, {
        onAlert
      });

      monitor.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(onAlert).toHaveBeenCalledTimes(2);
      expect(onAlert).toHaveBeenCalledWith(mockAlerts[0]);
      expect(onAlert).toHaveBeenCalledWith(mockAlerts[1]);
    });

    it('should not invoke callback when no alerts', async () => {
      const onAlert = vi.fn();

      mockAggregator.alertsToReturn = [];

      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator, {
        onAlert
      });

      monitor.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(onAlert).not.toHaveBeenCalled();
    });

    it('should handle callback errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const onAlert = vi.fn().mockImplementation(() => {
        throw new Error('Callback error');
      });

      mockAggregator.alertsToReturn = [{
        type: 'INJECTION_QUALITY_DEGRADATION',
        severity: 'WARNING',
        category: WorkflowCategory.CODING,
        falsePositiveRate: 0.03,
        threshold: 0.02,
        message: 'Test alert',
        timestamp: new Date()
      }];

      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator, {
        onAlert
      });

      monitor.start();
      await vi.advanceTimersByTimeAsync(0);

      // Should not crash
      expect(monitor.isRunning()).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('checkNow()', () => {
    it('should trigger immediate check', async () => {
      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator);

      const alerts = await monitor.checkNow();

      expect(mockAggregator.checkAndAlertCalls).toBe(1);
      expect(alerts).toEqual([]);
    });

    it('should return alerts from immediate check', async () => {
      const mockAlert: IAlert = {
        type: 'INJECTION_QUALITY_DEGRADATION',
        severity: 'WARNING',
        category: WorkflowCategory.CODING,
        falsePositiveRate: 0.03,
        threshold: 0.02,
        message: 'Test alert',
        timestamp: new Date()
      };

      mockAggregator.alertsToReturn = [mockAlert];

      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator);

      const alerts = await monitor.checkNow();

      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toEqual(mockAlert);
    });

    it('should update check count on manual check', async () => {
      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator);

      expect(monitor.getCheckCount()).toBe(0);

      await monitor.checkNow();

      expect(monitor.getCheckCount()).toBe(1);
    });

    it('should work when monitor is not running', async () => {
      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator);

      expect(monitor.isRunning()).toBe(false);

      await monitor.checkNow();

      expect(mockAggregator.checkAndAlertCalls).toBe(1);
    });
  });

  describe('error handling', () => {
    it('should handle checkAndAlert errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockAggregator.shouldThrow = true;

      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator);

      monitor.start();
      await vi.advanceTimersByTimeAsync(0);

      // Should not crash
      expect(monitor.isRunning()).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should return empty array on error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      mockAggregator.shouldThrow = true;

      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator);

      const alerts = await monitor.checkNow();

      expect(alerts).toEqual([]);
    });

    it('should continue running after error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      mockAggregator.shouldThrow = true;

      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator, {
        intervalMs: 100
      });

      monitor.start();
      await vi.advanceTimersByTimeAsync(0);

      // Reset error condition
      mockAggregator.shouldThrow = false;

      await vi.advanceTimersByTimeAsync(100);

      // Should continue running
      expect(monitor.isRunning()).toBe(true);
      expect(mockAggregator.checkAndAlertCalls).toBeGreaterThan(1);
    });
  });

  describe('status methods', () => {
    it('should track running status correctly', async () => {
      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator);

      expect(monitor.isRunning()).toBe(false);

      monitor.start();
      expect(monitor.isRunning()).toBe(true);

      monitor.stop();
      expect(monitor.isRunning()).toBe(false);
    });

    it('should track check count accurately', async () => {
      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator, {
        intervalMs: 100
      });

      expect(monitor.getCheckCount()).toBe(0);

      await monitor.checkNow();
      expect(monitor.getCheckCount()).toBe(1);

      await monitor.checkNow();
      expect(monitor.getCheckCount()).toBe(2);

      monitor.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(monitor.getCheckCount()).toBeGreaterThan(2);
    });

    it('should track last check time', async () => {
      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator);

      expect(monitor.getLastCheckTime()).toBeNull();

      const beforeCheck = new Date();
      await monitor.checkNow();
      const afterCheck = new Date();

      const lastCheckTime = monitor.getLastCheckTime();
      expect(lastCheckTime).not.toBeNull();
      expect(lastCheckTime!.getTime()).toBeGreaterThanOrEqual(beforeCheck.getTime());
      expect(lastCheckTime!.getTime()).toBeLessThanOrEqual(afterCheck.getTime());
    });
  });

  describe('integration scenarios', () => {
    it('should handle high-frequency monitoring', async () => {
      const intervalMs = 50; // Very frequent
      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator, {
        intervalMs
      });

      monitor.start();
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(intervalMs * 10);

      expect(mockAggregator.checkAndAlertCalls).toBeGreaterThan(5);
      expect(monitor.isRunning()).toBe(true);
    });

    it('should clean up resources on stop', async () => {
      monitor = new QualityMonitor(mockAggregator as unknown as MetricsAggregator, {
        intervalMs: 100
      });

      monitor.start();
      await vi.advanceTimersByTimeAsync(0);

      const checkCountBeforeStop = mockAggregator.checkAndAlertCalls;

      monitor.stop();

      // Advance time significantly
      await vi.advanceTimersByTimeAsync(1000);

      // No additional checks should occur
      expect(mockAggregator.checkAndAlertCalls).toBe(checkCountBeforeStop);
    });
  });
});
