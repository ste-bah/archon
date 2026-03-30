/**
 * SSEBroadcaster Unit Tests
 *
 * Tests for TASK-OBS-007: SSEBroadcaster
 * @see TASK-OBS-007-SSE-BROADCASTER.md
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SSEBroadcaster } from '../../../src/god-agent/observability/sse-broadcaster';
import { ISSEEvent } from '../../../src/god-agent/observability/types';

// Mock Express Response object
function createMockResponse(): {
  res: any;
  written: string[];
  headers: Record<string, string>;
  ended: boolean;
} {
  const written: string[] = [];
  const headers: Record<string, string> = {};
  let ended = false;
  let headersSent = false;

  const res = {
    headersSent,
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    flushHeaders: vi.fn(() => {
      headersSent = true;
      res.headersSent = true;
    }),
    write: vi.fn((data: string) => {
      if (ended) throw new Error('Response ended');
      written.push(data);
      return true;
    }),
    end: vi.fn(() => {
      ended = true;
    }),
  };

  return { res, written, headers, ended };
}

describe('SSEBroadcaster', () => {
  let broadcaster: SSEBroadcaster;

  beforeEach(() => {
    vi.useFakeTimers();
    broadcaster = new SSEBroadcaster();
  });

  afterEach(() => {
    broadcaster.shutdown();
    vi.useRealTimers();
  });

  describe('addClient()', () => {
    it('TC-007-01: addClient returns unique ID', () => {
      const { res: res1 } = createMockResponse();
      const { res: res2 } = createMockResponse();

      const id1 = broadcaster.addClient(res1);
      const id2 = broadcaster.addClient(res2);

      expect(id1).toMatch(/^client_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^client_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    it('TC-007-02: addClient sets SSE headers', () => {
      const { res, headers } = createMockResponse();

      broadcaster.addClient(res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
      expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
      expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
      expect(res.flushHeaders).toHaveBeenCalled();
    });

    it('TC-007-03: addClient sends connection confirmation', () => {
      const { res, written } = createMockResponse();

      const clientId = broadcaster.addClient(res);

      expect(written.length).toBe(1);
      expect(written[0]).toContain('event: connected');
      expect(written[0]).toContain(clientId);
    });

    it('TC-007-04: addClient increments client count', () => {
      const { res: res1 } = createMockResponse();
      const { res: res2 } = createMockResponse();

      expect(broadcaster.getClientCount()).toBe(0);

      broadcaster.addClient(res1);
      expect(broadcaster.getClientCount()).toBe(1);

      broadcaster.addClient(res2);
      expect(broadcaster.getClientCount()).toBe(2);
    });
  });

  describe('removeClient()', () => {
    it('TC-007-05: removeClient decrements client count', () => {
      const { res } = createMockResponse();

      const clientId = broadcaster.addClient(res);
      expect(broadcaster.getClientCount()).toBe(1);

      broadcaster.removeClient(clientId);
      expect(broadcaster.getClientCount()).toBe(0);
    });

    it('TC-007-06: removeClient handles non-existent client', () => {
      // Should not throw
      expect(() => {
        broadcaster.removeClient('non_existent_client');
      }).not.toThrow();
    });
  });

  describe('broadcast()', () => {
    it('TC-007-07: broadcast to 3 clients', () => {
      const mocks = [createMockResponse(), createMockResponse(), createMockResponse()];

      mocks.forEach(m => broadcaster.addClient(m.res));

      // Clear connection messages
      mocks.forEach(m => m.written.length = 0);

      broadcaster.broadcast({
        type: 'test_event',
        data: { message: 'hello' },
        id: 'evt_123',
      });

      mocks.forEach(m => {
        expect(m.written.length).toBe(1);
        expect(m.written[0]).toContain('event: test_event');
        expect(m.written[0]).toContain('data: {"message":"hello"}');
        expect(m.written[0]).toContain('id: evt_123');
      });
    });

    it('TC-007-08: broadcast format is correct', () => {
      const { res, written } = createMockResponse();

      broadcaster.addClient(res);
      written.length = 0; // Clear connection message

      broadcaster.broadcast({
        type: 'agent_started',
        data: { agentType: 'researcher' },
        id: 'evt_456',
      });

      const message = written[0];
      expect(message).toContain('event: agent_started\n');
      expect(message).toContain('data: {"agentType":"researcher"}\n');
      expect(message).toContain('id: evt_456\n');
      expect(message).toMatch(/\n\n$/); // Ends with double newline
    });

    it('TC-007-09: broadcast without id omits id field', () => {
      const { res, written } = createMockResponse();

      broadcaster.addClient(res);
      written.length = 0;

      broadcaster.broadcast({
        type: 'test_event',
        data: { test: true },
      });

      const message = written[0];
      expect(message).not.toContain('id:');
    });

    it('TC-007-10: broadcast removes disconnected clients', () => {
      const mock1 = createMockResponse();
      const mock2 = createMockResponse();

      broadcaster.addClient(mock1.res);
      broadcaster.addClient(mock2.res);

      expect(broadcaster.getClientCount()).toBe(2);

      // Make mock2 throw on write (simulate disconnect)
      mock2.res.write = vi.fn(() => {
        throw new Error('Connection reset');
      });

      broadcaster.broadcast({
        type: 'test',
        data: {},
      });

      // Client 2 should be removed
      expect(broadcaster.getClientCount()).toBe(1);
    });

    it('TC-007-11: broadcast does not throw on error', () => {
      const { res } = createMockResponse();

      broadcaster.addClient(res);

      res.write = vi.fn(() => {
        throw new Error('Write error');
      });

      // Should not throw
      expect(() => {
        broadcaster.broadcast({ type: 'test', data: {} });
      }).not.toThrow();
    });

    it('TC-007-12: broadcast to no clients is no-op', () => {
      // Should not throw
      expect(() => {
        broadcaster.broadcast({ type: 'test', data: {} });
      }).not.toThrow();
    });
  });

  describe('getClientCount()', () => {
    it('TC-007-13: getClientCount accuracy', () => {
      expect(broadcaster.getClientCount()).toBe(0);

      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const { res } = createMockResponse();
        ids.push(broadcaster.addClient(res));
      }

      expect(broadcaster.getClientCount()).toBe(5);

      broadcaster.removeClient(ids[0]);
      broadcaster.removeClient(ids[1]);

      expect(broadcaster.getClientCount()).toBe(3);
    });
  });

  describe('Heartbeat', () => {
    it('TC-007-14: heartbeat sent every 30s', () => {
      const { res, written } = createMockResponse();

      broadcaster.addClient(res);
      written.length = 0; // Clear connection message

      // Advance timer by 30 seconds
      vi.advanceTimersByTime(30000);

      expect(written.length).toBe(1);
      expect(written[0]).toBe(':heartbeat\n\n');
    });

    it('TC-007-15: heartbeat removes stale clients', () => {
      const mock1 = createMockResponse();
      const mock2 = createMockResponse();

      broadcaster.addClient(mock1.res);
      broadcaster.addClient(mock2.res);

      // Make mock2 throw on heartbeat
      mock2.res.write = vi.fn(() => {
        throw new Error('Stale connection');
      });

      expect(broadcaster.getClientCount()).toBe(2);

      vi.advanceTimersByTime(30000);

      expect(broadcaster.getClientCount()).toBe(1);
    });
  });

  describe('shutdown()', () => {
    it('TC-007-16: shutdown clears interval', () => {
      const { res } = createMockResponse();

      broadcaster.addClient(res);
      broadcaster.shutdown();

      // Advance timer - no heartbeat should be sent
      vi.advanceTimersByTime(60000);

      expect(broadcaster.getClientCount()).toBe(0);
    });

    it('TC-007-17: shutdown sends shutdown event', () => {
      const { res, written } = createMockResponse();

      broadcaster.addClient(res);
      written.length = 0;

      broadcaster.shutdown();

      expect(written.some(w => w.includes('event: shutdown'))).toBe(true);
      expect(res.end).toHaveBeenCalled();
    });

    it('TC-007-18: shutdown clears all clients', () => {
      for (let i = 0; i < 5; i++) {
        const { res } = createMockResponse();
        broadcaster.addClient(res);
      }

      expect(broadcaster.getClientCount()).toBe(5);

      broadcaster.shutdown();

      expect(broadcaster.getClientCount()).toBe(0);
    });
  });

  describe('Performance', () => {
    it('TC-007-19: broadcast to 10 clients < 1ms', () => {
      vi.useRealTimers(); // Use real timers for performance test

      const mocks: any[] = [];
      for (let i = 0; i < 10; i++) {
        const mock = createMockResponse();
        mocks.push(mock);
        broadcaster.addClient(mock.res);
      }

      const startTime = performance.now();

      for (let i = 0; i < 100; i++) {
        broadcaster.broadcast({
          type: 'perf_test',
          data: { index: i },
          id: 'evt_' + i,
        });
      }

      const elapsed = performance.now() - startTime;

      // 100 broadcasts to 10 clients should complete quickly
      expect(elapsed).toBeLessThan(100); // Generous limit

      vi.useFakeTimers();
    });

    it('TC-007-20: addClient < 1ms', () => {
      vi.useRealTimers();

      const startTime = performance.now();

      for (let i = 0; i < 100; i++) {
        const { res } = createMockResponse();
        broadcaster.addClient(res);
      }

      const elapsed = performance.now() - startTime;

      expect(elapsed).toBeLessThan(100); // Generous limit

      vi.useFakeTimers();
    });
  });
});
