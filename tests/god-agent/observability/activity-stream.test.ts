/**
 * ActivityStream Unit Tests
 *
 * Tests for TASK-OBS-002: ActivityStream
 * @see TASK-OBS-002-ACTIVITY-STREAM.md
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ActivityStream } from '../../../src/god-agent/observability/activity-stream';
import {
  IActivityEvent,
  ActivityEventComponent,
  ActivityEventStatus,
  BUFFER_LIMITS,
} from '../../../src/god-agent/observability/types';

// Helper to create test events
function createTestEvent(overrides: Partial<IActivityEvent> = {}): IActivityEvent {
  return {
    id: 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
    timestamp: Date.now(),
    component: 'routing' as ActivityEventComponent,
    operation: 'test_operation',
    status: 'success' as ActivityEventStatus,
    metadata: {},
    ...overrides,
  };
}

describe('ActivityStream', () => {
  let stream: ActivityStream;

  beforeEach(() => {
    stream = new ActivityStream();
  });

  describe('Constructor', () => {
    it('TC-002-01: creates with default max size (1000)', () => {
      const stats = stream.getStats();
      expect(stats.maxSize).toBe(BUFFER_LIMITS.ACTIVITY_STREAM);
      expect(stats.maxSize).toBe(1000);
    });

    it('TC-002-02: creates with custom max size', () => {
      const customStream = new ActivityStream(500);
      const stats = customStream.getStats();
      expect(stats.maxSize).toBe(500);
    });

    it('TC-002-03: starts empty', () => {
      expect(stream.size()).toBe(0);
      expect(stream.isFull()).toBe(false);
    });
  });

  describe('push()', () => {
    it('TC-002-04: push adds event to stream', () => {
      const event = createTestEvent();
      stream.push(event);

      expect(stream.size()).toBe(1);
    });

    it('TC-002-05: push is O(1) - no array shifting', () => {
      const startTime = performance.now();

      // Push 1000 events
      for (let i = 0; i < 1000; i++) {
        stream.push(createTestEvent({ id: 'evt_' + i }));
      }

      const elapsed = performance.now() - startTime;

      // Should be very fast (< 50ms for 1000 events)
      expect(elapsed).toBeLessThan(50);
    });

    it('TC-002-06: push overwrites oldest when full (FIFO)', () => {
      const smallStream = new ActivityStream(3);

      // Push 5 events into size-3 buffer
      for (let i = 1; i <= 5; i++) {
        smallStream.push(createTestEvent({ id: 'evt_' + i }));
      }

      expect(smallStream.size()).toBe(3);

      const events = smallStream.getAll();
      // Should have events 3, 4, 5 (oldest 1, 2 evicted)
      expect(events[0].id).toBe('evt_3');
      expect(events[1].id).toBe('evt_4');
      expect(events[2].id).toBe('evt_5');
    });
  });

  describe('getRecent()', () => {
    it('TC-002-07: getRecent returns empty array when empty', () => {
      const events = stream.getRecent();
      expect(events).toEqual([]);
    });

    it('TC-002-08: getRecent returns events in chronological order', () => {
      for (let i = 1; i <= 5; i++) {
        stream.push(createTestEvent({ id: 'evt_' + i, timestamp: i * 1000 }));
      }

      const events = stream.getRecent(5);

      // Should be oldest first
      expect(events[0].id).toBe('evt_1');
      expect(events[4].id).toBe('evt_5');
    });

    it('TC-002-09: getRecent respects limit', () => {
      for (let i = 1; i <= 10; i++) {
        stream.push(createTestEvent({ id: 'evt_' + i }));
      }

      const events = stream.getRecent(3);
      expect(events.length).toBe(3);

      // Should be the most recent 3
      expect(events[0].id).toBe('evt_8');
      expect(events[1].id).toBe('evt_9');
      expect(events[2].id).toBe('evt_10');
    });

    it('TC-002-10: getRecent defaults to 100', () => {
      for (let i = 1; i <= 150; i++) {
        stream.push(createTestEvent({ id: 'evt_' + i }));
      }

      const events = stream.getRecent();
      expect(events.length).toBe(100);
    });
  });

  describe('getAll()', () => {
    it('TC-002-11: getAll returns all events', () => {
      for (let i = 1; i <= 50; i++) {
        stream.push(createTestEvent({ id: 'evt_' + i }));
      }

      const events = stream.getAll();
      expect(events.length).toBe(50);
    });
  });

  describe('filter()', () => {
    beforeEach(() => {
      // Push variety of events
      stream.push(createTestEvent({
        id: 'evt_1',
        component: 'routing',
        status: 'success',
        timestamp: 1000,
      }));
      stream.push(createTestEvent({
        id: 'evt_2',
        component: 'pipeline',
        status: 'error',
        timestamp: 2000,
      }));
      stream.push(createTestEvent({
        id: 'evt_3',
        component: 'routing',
        status: 'pending',
        timestamp: 3000,
      }));
      stream.push(createTestEvent({
        id: 'evt_4',
        component: 'memory',
        status: 'success',
        timestamp: 4000,
      }));
    });

    it('TC-002-12: filter by component', () => {
      const events = stream.filter({ component: 'routing' });
      expect(events.length).toBe(2);
      expect(events.every(e => e.component === 'routing')).toBe(true);
    });

    it('TC-002-13: filter by status', () => {
      const events = stream.filter({ status: 'success' });
      expect(events.length).toBe(2);
      expect(events.every(e => e.status === 'success')).toBe(true);
    });

    it('TC-002-14: filter by time range (since)', () => {
      const events = stream.filter({ since: 2500 });
      expect(events.length).toBe(2);
      expect(events.every(e => e.timestamp >= 2500)).toBe(true);
    });

    it('TC-002-15: filter by time range (until)', () => {
      const events = stream.filter({ until: 2500 });
      expect(events.length).toBe(2);
      expect(events.every(e => e.timestamp <= 2500)).toBe(true);
    });

    it('TC-002-16: filter with multiple criteria', () => {
      const events = stream.filter({
        component: 'routing',
        status: 'success',
      });
      expect(events.length).toBe(1);
      expect(events[0].id).toBe('evt_1');
    });
  });

  describe('clear()', () => {
    it('TC-002-17: clear removes all events', () => {
      for (let i = 1; i <= 10; i++) {
        stream.push(createTestEvent());
      }

      expect(stream.size()).toBe(10);

      stream.clear();

      expect(stream.size()).toBe(0);
      expect(stream.getAll()).toEqual([]);
    });
  });

  describe('size() and isFull()', () => {
    it('TC-002-18: size returns current count', () => {
      expect(stream.size()).toBe(0);

      stream.push(createTestEvent());
      expect(stream.size()).toBe(1);

      stream.push(createTestEvent());
      expect(stream.size()).toBe(2);
    });

    it('TC-002-19: isFull returns true when at capacity', () => {
      const smallStream = new ActivityStream(3);

      expect(smallStream.isFull()).toBe(false);

      smallStream.push(createTestEvent());
      smallStream.push(createTestEvent());
      smallStream.push(createTestEvent());

      expect(smallStream.isFull()).toBe(true);
    });
  });

  describe('subscribe()', () => {
    it('TC-002-20: subscribe receives new events', async () => {
      const received: IActivityEvent[] = [];

      stream.subscribe((event) => {
        received.push(event);
      });

      const event = createTestEvent({ id: 'evt_subscribed' });
      stream.push(event);

      // Wait for setImmediate
      await new Promise(resolve => setImmediate(resolve));

      expect(received.length).toBe(1);
      expect(received[0].id).toBe('evt_subscribed');
    });

    it('TC-002-21: unsubscribe stops notifications', async () => {
      const received: IActivityEvent[] = [];

      const unsubscribe = stream.subscribe((event) => {
        received.push(event);
      });

      stream.push(createTestEvent({ id: 'evt_1' }));
      await new Promise(resolve => setImmediate(resolve));

      unsubscribe();

      stream.push(createTestEvent({ id: 'evt_2' }));
      await new Promise(resolve => setImmediate(resolve));

      expect(received.length).toBe(1);
    });

    it('TC-002-22: listener errors are caught', async () => {
      // This should not throw
      stream.subscribe(() => {
        throw new Error('Listener error');
      });

      stream.push(createTestEvent());

      await new Promise(resolve => setImmediate(resolve));

      // Stream should still work
      expect(stream.size()).toBe(1);
    });
  });

  describe('getStats()', () => {
    it('TC-002-23: getStats returns buffer statistics', () => {
      stream.push(createTestEvent());
      stream.push(createTestEvent());

      const stats = stream.getStats();

      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(1000);
      expect(stats.isFull).toBe(false);
      expect(typeof stats.headIndex).toBe('number');
      expect(typeof stats.tailIndex).toBe('number');
    });
  });

  describe('Circular Buffer Behavior', () => {
    it('TC-002-24: correctly wraps around buffer', () => {
      const smallStream = new ActivityStream(5);

      // Push 12 events (wraps around twice)
      for (let i = 1; i <= 12; i++) {
        smallStream.push(createTestEvent({ id: 'evt_' + i }));
      }

      const events = smallStream.getAll();
      expect(events.length).toBe(5);

      // Should have events 8-12
      expect(events[0].id).toBe('evt_8');
      expect(events[4].id).toBe('evt_12');
    });
  });
});
