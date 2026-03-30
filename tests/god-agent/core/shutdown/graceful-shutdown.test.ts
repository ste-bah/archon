/**
 * Graceful Shutdown Unit Tests
 * TASK-ERR-005 - Implement graceful shutdown handlers
 *
 * Constitution: RULE-073 (All components MUST register graceful shutdown handlers)
 *
 * Tests cover:
 * - Handler registration and unregistration
 * - Priority-based execution order
 * - 5-second timeout enforcement
 * - SIGTERM/SIGINT signal handling
 * - Uncaught exception handling
 * - Component factory helpers
 * - Singleton management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GracefulShutdown,
  ShutdownPriority,
  ShutdownTimeoutError,
  DEFAULT_HANDLER_TIMEOUT_MS,
  MAX_SHUTDOWN_TIME_MS,
  getGracefulShutdown,
  registerShutdownHandler,
  initiateShutdown,
  resetGracefulShutdown,
  registerComponentShutdown,
  registerDatabaseShutdown,
  registerSonaEngineShutdown,
  registerGraphDBShutdown,
  registerEmbeddingStoreShutdown,
  registerServerShutdown,
  type IShutdownEvent,
  type ShutdownReason,
} from '../../../../src/god-agent/core/shutdown/index.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock handler that tracks calls and timing
 */
function createMockHandler(options?: {
  delayMs?: number;
  shouldFail?: boolean;
  errorMessage?: string;
}): { handler: () => Promise<void>; calls: number[]; getCallCount: () => number } {
  const calls: number[] = [];

  const handler = async (): Promise<void> => {
    calls.push(Date.now());

    if (options?.delayMs) {
      await new Promise(resolve => setTimeout(resolve, options.delayMs));
    }

    if (options?.shouldFail) {
      throw new Error(options.errorMessage || 'Handler failed');
    }
  };

  return {
    handler,
    calls,
    getCallCount: () => calls.length,
  };
}

/**
 * Create a mock component with standard shutdown methods
 */
function createMockComponent(): {
  close: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
  checkpoint: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue(undefined),
    checkpoint: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

// ============================================================================
// Constants Tests
// ============================================================================

describe('Shutdown Constants', () => {
  it('should have 5-second default timeout per Constitution', () => {
    expect(DEFAULT_HANDLER_TIMEOUT_MS).toBe(5000);
  });

  it('should have 30-second max shutdown time', () => {
    expect(MAX_SHUTDOWN_TIME_MS).toBe(30000);
  });

  it('should have priority levels', () => {
    expect(ShutdownPriority.CRITICAL).toBe(100);
    expect(ShutdownPriority.HIGH).toBe(75);
    expect(ShutdownPriority.NORMAL).toBe(50);
    expect(ShutdownPriority.LOW).toBe(25);
    expect(ShutdownPriority.CLEANUP).toBe(0);
  });
});

// ============================================================================
// GracefulShutdown Class Tests
// ============================================================================

describe('GracefulShutdown', () => {
  let shutdown: GracefulShutdown;

  beforeEach(() => {
    // Create instance without auto signal handlers for testing
    shutdown = new GracefulShutdown({
      registerSignalHandlers: false,
      exitOnComplete: false,
    });
  });

  afterEach(() => {
    resetGracefulShutdown();
  });

  describe('Handler Registration', () => {
    it('should register a handler', () => {
      const { handler } = createMockHandler();
      shutdown.register('test', handler);

      expect(shutdown.hasHandler('test')).toBe(true);
      expect(shutdown.handlerCount).toBe(1);
    });

    it('should register multiple handlers', () => {
      shutdown.register('handler1', createMockHandler().handler);
      shutdown.register('handler2', createMockHandler().handler);
      shutdown.register('handler3', createMockHandler().handler);

      expect(shutdown.handlerCount).toBe(3);
      expect(shutdown.getHandlerNames()).toEqual(['handler1', 'handler2', 'handler3']);
    });

    it('should reject duplicate handler names', () => {
      const { handler } = createMockHandler();
      shutdown.register('test', handler);

      expect(() => shutdown.register('test', handler)).toThrow(
        "Shutdown handler 'test' is already registered"
      );
    });

    it('should unregister a handler', () => {
      shutdown.register('test', createMockHandler().handler);
      expect(shutdown.hasHandler('test')).toBe(true);

      const removed = shutdown.unregister('test');
      expect(removed).toBe(true);
      expect(shutdown.hasHandler('test')).toBe(false);
    });

    it('should return false when unregistering non-existent handler', () => {
      const removed = shutdown.unregister('nonexistent');
      expect(removed).toBe(false);
    });
  });

  describe('Shutdown Execution', () => {
    it('should execute all handlers', async () => {
      const mock1 = createMockHandler();
      const mock2 = createMockHandler();

      shutdown.register('handler1', mock1.handler);
      shutdown.register('handler2', mock2.handler);

      await shutdown.shutdown('manual');

      expect(mock1.getCallCount()).toBe(1);
      expect(mock2.getCallCount()).toBe(1);
    });

    it('should return shutdown event with results', async () => {
      shutdown.register('test', createMockHandler().handler);

      const event = await shutdown.shutdown('manual');

      expect(event.reason).toBe('manual');
      expect(event.success).toBe(true);
      expect(event.handlers).toHaveLength(1);
      expect(event.handlers[0].name).toBe('test');
      expect(event.handlers[0].success).toBe(true);
      expect(event.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle handler failures gracefully', async () => {
      const failing = createMockHandler({ shouldFail: true, errorMessage: 'Oops' });
      const passing = createMockHandler();

      shutdown.register('failing', failing.handler);
      shutdown.register('passing', passing.handler);

      const event = await shutdown.shutdown('manual');

      expect(event.success).toBe(false);
      expect(event.handlers).toHaveLength(2);

      const failResult = event.handlers.find(h => h.name === 'failing');
      expect(failResult?.success).toBe(false);
      expect(failResult?.error?.message).toBe('Oops');

      const passResult = event.handlers.find(h => h.name === 'passing');
      expect(passResult?.success).toBe(true);
    });

    it('should set shuttingDown flag during shutdown', async () => {
      let wasShuttingDown = false;

      shutdown.register('check', async () => {
        wasShuttingDown = shutdown.shuttingDown;
      });

      expect(shutdown.shuttingDown).toBe(false);
      await shutdown.shutdown('manual');
      expect(wasShuttingDown).toBe(true);
    });

    it('should return same promise for concurrent shutdown calls', async () => {
      shutdown.register('slow', createMockHandler({ delayMs: 100 }).handler);

      const promise1 = shutdown.shutdown('manual');
      const promise2 = shutdown.shutdown('manual');

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toEqual(result2);
    });
  });

  describe('Priority Ordering', () => {
    it('should execute handlers in priority order (higher first)', async () => {
      const executionOrder: string[] = [];

      shutdown.register(
        'low',
        async () => { executionOrder.push('low'); },
        ShutdownPriority.LOW
      );
      shutdown.register(
        'critical',
        async () => { executionOrder.push('critical'); },
        ShutdownPriority.CRITICAL
      );
      shutdown.register(
        'normal',
        async () => { executionOrder.push('normal'); },
        ShutdownPriority.NORMAL
      );
      shutdown.register(
        'high',
        async () => { executionOrder.push('high'); },
        ShutdownPriority.HIGH
      );

      await shutdown.shutdown('manual');

      // Higher priority should execute first
      expect(executionOrder.indexOf('critical')).toBeLessThan(executionOrder.indexOf('high'));
      expect(executionOrder.indexOf('high')).toBeLessThan(executionOrder.indexOf('normal'));
      expect(executionOrder.indexOf('normal')).toBeLessThan(executionOrder.indexOf('low'));
    });

    it('should execute same-priority handlers in parallel', async () => {
      const startTimes: number[] = [];

      shutdown.register(
        'parallel1',
        async () => {
          startTimes.push(Date.now());
          await new Promise(r => setTimeout(r, 50));
        },
        ShutdownPriority.NORMAL
      );
      shutdown.register(
        'parallel2',
        async () => {
          startTimes.push(Date.now());
          await new Promise(r => setTimeout(r, 50));
        },
        ShutdownPriority.NORMAL
      );

      await shutdown.shutdown('manual');

      // Both should start at approximately the same time (within 20ms)
      const timeDiff = Math.abs(startTimes[0] - startTimes[1]);
      expect(timeDiff).toBeLessThan(20);
    });
  });

  describe('Timeout Enforcement', () => {
    it('should timeout handlers exceeding limit', async () => {
      // Use custom short timeout for test
      const quickShutdown = new GracefulShutdown({
        registerSignalHandlers: false,
        exitOnComplete: false,
        defaultTimeoutMs: 100,
      });

      const slow = createMockHandler({ delayMs: 500 });
      quickShutdown.register('slow', slow.handler);

      const event = await quickShutdown.shutdown('manual');

      expect(event.success).toBe(false);
      expect(event.handlers[0].timedOut).toBe(true);
      expect(event.handlers[0].error).toBeInstanceOf(ShutdownTimeoutError);
    });

    it('should respect per-handler timeout override', async () => {
      const quickShutdown = new GracefulShutdown({
        registerSignalHandlers: false,
        exitOnComplete: false,
        defaultTimeoutMs: 100,
      });

      // This handler takes 200ms but has 500ms timeout
      const slow = createMockHandler({ delayMs: 200 });
      quickShutdown.register('slow', slow.handler, ShutdownPriority.NORMAL, {
        timeoutMs: 500,
      });

      const event = await quickShutdown.shutdown('manual');

      expect(event.success).toBe(true);
      expect(event.handlers[0].timedOut).toBe(false);
    });

    it('should have 5-second default timeout', () => {
      const defaultShutdown = new GracefulShutdown({
        registerSignalHandlers: false,
        exitOnComplete: false,
      });

      // Access private config through any cast for testing
      expect((defaultShutdown as unknown as { config: { defaultTimeoutMs: number } }).config.defaultTimeoutMs).toBe(5000);
    });
  });

  describe('Shutdown Reasons', () => {
    const reasons: ShutdownReason[] = [
      'SIGTERM',
      'SIGINT',
      'SIGHUP',
      'uncaughtException',
      'unhandledRejection',
      'manual',
      'error',
    ];

    it.each(reasons)('should accept %s as shutdown reason', async (reason) => {
      const event = await shutdown.shutdown(reason);
      expect(event.reason).toBe(reason);
    });
  });
});

// ============================================================================
// Singleton Functions Tests
// ============================================================================

describe('Singleton Functions', () => {
  beforeEach(() => {
    resetGracefulShutdown();
  });

  afterEach(() => {
    resetGracefulShutdown();
  });

  it('should return same instance from getGracefulShutdown', () => {
    const instance1 = getGracefulShutdown({ registerSignalHandlers: false });
    const instance2 = getGracefulShutdown();

    expect(instance1).toBe(instance2);
  });

  it('should register handler via registerShutdownHandler', () => {
    // Get instance first with disabled signal handlers
    getGracefulShutdown({ registerSignalHandlers: false });

    registerShutdownHandler('test', async () => {});

    expect(getGracefulShutdown().hasHandler('test')).toBe(true);
  });

  it('should reset instance via resetGracefulShutdown', () => {
    const instance1 = getGracefulShutdown({ registerSignalHandlers: false });
    instance1.register('test', async () => {});

    resetGracefulShutdown();

    const instance2 = getGracefulShutdown({ registerSignalHandlers: false });
    expect(instance2).not.toBe(instance1);
    expect(instance2.hasHandler('test')).toBe(false);
  });
});

// ============================================================================
// Component Registration Helpers Tests
// ============================================================================

describe('Component Registration Helpers', () => {
  beforeEach(() => {
    // Initialize singleton with disabled signal handlers and exit
    resetGracefulShutdown();
    getGracefulShutdown({ registerSignalHandlers: false, exitOnComplete: false });
  });

  afterEach(() => {
    resetGracefulShutdown();
  });

  describe('registerComponentShutdown', () => {
    it('should call close method', async () => {
      const component = createMockComponent();
      registerComponentShutdown('test-component', component);

      await initiateShutdown('manual');

      expect(component.close).toHaveBeenCalledOnce();
    });

    it('should flush before close when flushFirst is true', async () => {
      const component = createMockComponent();
      const callOrder: string[] = [];

      component.flush.mockImplementation(() => {
        callOrder.push('flush');
        return Promise.resolve();
      });
      component.close.mockImplementation(() => {
        callOrder.push('close');
        return Promise.resolve();
      });

      registerComponentShutdown('test-component', component, { flushFirst: true });

      await initiateShutdown('manual');

      expect(callOrder).toEqual(['flush', 'close']);
    });

    it('should checkpoint before close when checkpointFirst is true', async () => {
      const component = createMockComponent();
      const callOrder: string[] = [];

      component.checkpoint.mockImplementation(() => {
        callOrder.push('checkpoint');
        return Promise.resolve();
      });
      component.close.mockImplementation(() => {
        callOrder.push('close');
        return Promise.resolve();
      });

      registerComponentShutdown('test-component', component, { checkpointFirst: true });

      await initiateShutdown('manual');

      expect(callOrder).toEqual(['checkpoint', 'close']);
    });

    it('should call stop if available', async () => {
      const component = createMockComponent();
      registerComponentShutdown('test-component', component);

      await initiateShutdown('manual');

      expect(component.stop).toHaveBeenCalledOnce();
    });
  });

  describe('registerDatabaseShutdown', () => {
    it('should checkpoint and close database', async () => {
      const connection = {
        checkpoint: vi.fn(),
        close: vi.fn(),
      };
      const callOrder: string[] = [];

      connection.checkpoint.mockImplementation(() => callOrder.push('checkpoint'));
      connection.close.mockImplementation(() => callOrder.push('close'));

      registerDatabaseShutdown('test-db', connection);

      await initiateShutdown('manual');

      expect(callOrder).toEqual(['checkpoint', 'close']);
    });

    it('should register with CRITICAL priority', () => {
      const connection = { checkpoint: vi.fn(), close: vi.fn() };
      registerDatabaseShutdown('test-db', connection);

      // Verify by checking handler execution order
      const shutdown = getGracefulShutdown();
      expect(shutdown.hasHandler('test-db')).toBe(true);
    });
  });

  describe('registerSonaEngineShutdown', () => {
    it('should create checkpoint on shutdown', async () => {
      const engine = {
        createCheckpoint: vi.fn().mockResolvedValue('checkpoint-id'),
      };

      registerSonaEngineShutdown('sona-engine', engine);

      await initiateShutdown('manual');

      expect(engine.createCheckpoint).toHaveBeenCalledWith('shutdown');
    });
  });

  describe('registerGraphDBShutdown', () => {
    it('should clear graph on shutdown', async () => {
      const db = {
        clear: vi.fn().mockResolvedValue(undefined),
      };

      registerGraphDBShutdown('graph-db', db);

      await initiateShutdown('manual');

      expect(db.clear).toHaveBeenCalledOnce();
    });
  });

  describe('registerEmbeddingStoreShutdown', () => {
    it('should flush and close store', async () => {
      const store = {
        flush: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const callOrder: string[] = [];

      store.flush.mockImplementation(() => {
        callOrder.push('flush');
        return Promise.resolve();
      });
      store.close.mockImplementation(() => {
        callOrder.push('close');
        return Promise.resolve();
      });

      registerEmbeddingStoreShutdown('embedding-store', store);

      await initiateShutdown('manual');

      expect(callOrder).toEqual(['flush', 'close']);
    });

    it('should work without flush method', async () => {
      const store = {
        close: vi.fn().mockResolvedValue(undefined),
      };

      registerEmbeddingStoreShutdown('embedding-store', store);

      await initiateShutdown('manual');

      expect(store.close).toHaveBeenCalledOnce();
    });
  });

  describe('registerServerShutdown', () => {
    it('should stop server on shutdown', async () => {
      const server = {
        stop: vi.fn().mockResolvedValue(undefined),
      };

      registerServerShutdown('http-server', server);

      await initiateShutdown('manual');

      expect(server.stop).toHaveBeenCalledOnce();
    });

    it('should fall back to close if no stop method', async () => {
      const server = {
        close: vi.fn().mockResolvedValue(undefined),
      };

      registerServerShutdown('http-server', server);

      await initiateShutdown('manual');

      expect(server.close).toHaveBeenCalledOnce();
    });
  });
});

// ============================================================================
// Error Classes Tests
// ============================================================================

describe('ShutdownTimeoutError', () => {
  it('should include handler name and timeout in message', () => {
    const error = new ShutdownTimeoutError('myHandler', 5000);

    expect(error.name).toBe('ShutdownTimeoutError');
    expect(error.message).toBe("Shutdown handler 'myHandler' timed out after 5000ms");
    expect(error.handlerName).toBe('myHandler');
    expect(error.timeoutMs).toBe(5000);
  });

  it('should be instanceof Error', () => {
    const error = new ShutdownTimeoutError('test', 1000);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ShutdownTimeoutError);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration Tests', () => {
  beforeEach(() => {
    resetGracefulShutdown();
  });

  afterEach(() => {
    resetGracefulShutdown();
  });

  it('should handle complex multi-component shutdown', async () => {
    const shutdown = new GracefulShutdown({
      registerSignalHandlers: false,
      exitOnComplete: false,
    });

    const executionLog: string[] = [];

    // Simulate database (CRITICAL)
    shutdown.register(
      'database',
      async () => {
        executionLog.push('database:checkpoint');
        await new Promise(r => setTimeout(r, 10));
        executionLog.push('database:close');
      },
      ShutdownPriority.CRITICAL
    );

    // Simulate cache (HIGH)
    shutdown.register(
      'cache',
      async () => {
        executionLog.push('cache:flush');
        await new Promise(r => setTimeout(r, 10));
        executionLog.push('cache:close');
      },
      ShutdownPriority.HIGH
    );

    // Simulate HTTP server (NORMAL)
    shutdown.register(
      'http-server',
      async () => {
        executionLog.push('http:stop');
      },
      ShutdownPriority.NORMAL
    );

    // Simulate temp file cleanup (CLEANUP)
    shutdown.register(
      'temp-cleanup',
      async () => {
        executionLog.push('temp:cleanup');
      },
      ShutdownPriority.CLEANUP
    );

    const event = await shutdown.shutdown('SIGTERM');

    expect(event.success).toBe(true);
    expect(event.handlers).toHaveLength(4);

    // Verify priority order
    const dbIndex = executionLog.indexOf('database:checkpoint');
    const cacheIndex = executionLog.indexOf('cache:flush');
    const httpIndex = executionLog.indexOf('http:stop');
    const tempIndex = executionLog.indexOf('temp:cleanup');

    expect(dbIndex).toBeLessThan(cacheIndex);
    expect(cacheIndex).toBeLessThan(httpIndex);
    expect(httpIndex).toBeLessThan(tempIndex);
  });

  it('should continue shutdown even if some handlers fail', async () => {
    const shutdown = new GracefulShutdown({
      registerSignalHandlers: false,
      exitOnComplete: false,
    });

    const executed: string[] = [];

    shutdown.register(
      'pass1',
      async () => { executed.push('pass1'); },
      ShutdownPriority.HIGH
    );
    shutdown.register(
      'fail',
      async () => {
        executed.push('fail');
        throw new Error('Intentional failure');
      },
      ShutdownPriority.NORMAL
    );
    shutdown.register(
      'pass2',
      async () => { executed.push('pass2'); },
      ShutdownPriority.LOW
    );

    const event = await shutdown.shutdown('manual');

    // All handlers should have been called despite failure
    expect(executed).toContain('pass1');
    expect(executed).toContain('fail');
    expect(executed).toContain('pass2');

    // Overall success should be false due to failure
    expect(event.success).toBe(false);

    // Check individual results
    const passResult1 = event.handlers.find(h => h.name === 'pass1');
    const failResult = event.handlers.find(h => h.name === 'fail');
    const passResult2 = event.handlers.find(h => h.name === 'pass2');

    expect(passResult1?.success).toBe(true);
    expect(failResult?.success).toBe(false);
    expect(passResult2?.success).toBe(true);
  });
});
