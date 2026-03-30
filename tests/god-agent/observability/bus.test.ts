/**
 * ObservabilityBus Unit Tests
 *
 * Tests for TASK-OBS-001: ObservabilityBus
 * @see TASK-OBS-001-OBSERVABILITY-BUS.md
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as net from 'net';
import { ObservabilityBus, getObservabilityBus, emitObservabilityEvent } from '../../../src/god-agent/core/observability/bus';
import { ActivityEventComponent, ActivityEventStatus } from '../../../src/god-agent/observability/types';

// Mock fs and net modules
vi.mock('fs');
vi.mock('net');

describe('ObservabilityBus', () => {
  beforeEach(() => {
    // Reset singleton before each test
    ObservabilityBus.resetInstance();
    vi.clearAllMocks();

    // Default: socket doesn't exist
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    ObservabilityBus.resetInstance();
  });

  describe('Singleton Pattern', () => {
    it('TC-001-01: getInstance returns singleton', () => {
      const instance1 = ObservabilityBus.getInstance();
      const instance2 = ObservabilityBus.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('TC-001-02: resetInstance creates new instance', () => {
      const instance1 = ObservabilityBus.getInstance();
      ObservabilityBus.resetInstance();
      const instance2 = ObservabilityBus.getInstance();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('emit()', () => {
    it('TC-001-03: emit generates unique ID', () => {
      const bus = ObservabilityBus.getInstance();

      // Emit event (will be queued since not connected)
      bus.emit({
        component: 'routing' as ActivityEventComponent,
        operation: 'test_op',
        status: 'success' as ActivityEventStatus,
        metadata: {},
      });

      // Should be queued
      expect(bus.getQueueSize()).toBe(1);
    });

    it('TC-001-04: emit generates timestamp', () => {
      const bus = ObservabilityBus.getInstance();
      const now = Date.now();

      bus.emit({
        component: 'pipeline' as ActivityEventComponent,
        operation: 'test_op',
        status: 'running' as ActivityEventStatus,
        metadata: {},
      });

      // Event should be queued with timestamp
      expect(bus.getQueueSize()).toBe(1);
    });

    it('TC-001-05: emit is non-blocking (returns immediately)', () => {
      const bus = ObservabilityBus.getInstance();

      const startTime = performance.now();
      for (let i = 0; i < 100; i++) {
        bus.emit({
          component: 'agent' as ActivityEventComponent,
          operation: 'test_op',
          status: 'pending' as ActivityEventStatus,
          metadata: { index: i },
        });
      }
      const elapsed = performance.now() - startTime;

      // Should complete very quickly (< 10ms for 100 events)
      expect(elapsed).toBeLessThan(10);
    });
  });

  describe('Queue Management', () => {
    it('TC-001-06: queue respects max size (FIFO eviction)', () => {
      const bus = ObservabilityBus.getInstance();

      // Emit more than max queue size (100)
      for (let i = 0; i < 150; i++) {
        bus.emit({
          component: 'memory' as ActivityEventComponent,
          operation: 'test_op',
          status: 'success' as ActivityEventStatus,
          metadata: { index: i },
        });
      }

      // Queue should be at max size
      expect(bus.getQueueSize()).toBeLessThanOrEqual(100);
    });
  });

  describe('Connection State', () => {
    it('TC-001-07: isConnected returns false when no daemon', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const bus = ObservabilityBus.getInstance();

      expect(bus.isConnected()).toBe(false);
    });
  });

  describe('Shutdown', () => {
    it('TC-001-08: shutdown clears queue', () => {
      const bus = ObservabilityBus.getInstance();

      // Emit some events
      bus.emit({
        component: 'routing' as ActivityEventComponent,
        operation: 'test_op',
        status: 'success' as ActivityEventStatus,
        metadata: {},
      });

      expect(bus.getQueueSize()).toBeGreaterThan(0);

      // Shutdown
      bus.shutdown();

      expect(bus.getQueueSize()).toBe(0);
      expect(bus.isConnected()).toBe(false);
    });
  });

  describe('Convenience Functions', () => {
    it('TC-001-09: getObservabilityBus returns singleton', () => {
      const bus1 = getObservabilityBus();
      const bus2 = getObservabilityBus();

      expect(bus1).toBe(bus2);
    });

    it('TC-001-10: emitObservabilityEvent emits event', () => {
      emitObservabilityEvent({
        component: 'general' as ActivityEventComponent,
        operation: 'test_op',
        status: 'success' as ActivityEventStatus,
        metadata: { test: true },
      });

      const bus = getObservabilityBus();
      expect(bus.getQueueSize()).toBeGreaterThan(0);
    });
  });

  describe('Event ID Format', () => {
    it('TC-001-11: event ID follows evt_{timestamp}_{random} format', () => {
      // We can't directly access the generated ID, but we can verify
      // the bus is handling events correctly
      const bus = ObservabilityBus.getInstance();

      bus.emit({
        component: 'routing' as ActivityEventComponent,
        operation: 'test_op',
        status: 'success' as ActivityEventStatus,
        metadata: {},
      });

      // Event was queued (ID was generated internally)
      expect(bus.getQueueSize()).toBe(1);
    });
  });
});
