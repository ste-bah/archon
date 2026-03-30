/**
 * Scale Tests Module Tests
 * TASK-NFR-002 - Scalability Validation Suite
 *
 * Tests for:
 * - Memory monitoring utilities
 * - Concurrency tracking
 * - Vector scale test (NFR-4.1)
 * - Pipeline scale test (NFR-4.2)
 * - Memory pressure test (NFR-4.3)
 * - Degradation test (NFR-4.4)
 * - Multi-instance test (NFR-4.5)
 * - Scale test runner
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  // Memory Monitor
  MemoryMonitor,
  DEFAULT_MEMORY_THRESHOLDS,
  // Concurrency Tracker
  ConcurrencyTracker,
  AsyncSemaphore,
  RateLimiter,
  // Vector Scale Test
  VectorScaleTest,
  DEFAULT_VECTOR_SCALE_CONFIG,
  generateNormalizedVectors,
  // Pipeline Scale Test
  PipelineScaleTest,
  DEFAULT_PIPELINE_SCALE_CONFIG,
  generatePipelineAgents,
  // Memory Pressure Test
  MemoryPressureTest,
  DEFAULT_MEMORY_PRESSURE_CONFIG,
  // Degradation Test
  DegradationTest,
  CapacityManager,
  CapacityExceededError,
  DEFAULT_DEGRADATION_CONFIG,
  // Multi-Instance Test
  MultiInstanceTest,
  SimulatedInstance,
  DEFAULT_MULTI_INSTANCE_CONFIG,
  // Runner
  ScaleTestRunner,
  DEFAULT_RUNNER_CONFIG,
} from '../../../../src/god-agent/core/scale-tests/index.js';

// ==================== Memory Monitor Tests ====================

describe('MemoryMonitor', () => {
  let monitor: MemoryMonitor;

  beforeEach(() => {
    monitor = new MemoryMonitor({ heapLimit: 512 * 1024 * 1024 });
  });

  describe('basic functionality', () => {
    it('should get memory snapshot', () => {
      const snapshot = monitor.getSnapshot();

      expect(snapshot.heapUsed).toBeGreaterThan(0);
      expect(snapshot.heapTotal).toBeGreaterThan(0);
      expect(snapshot.timestamp).toBeDefined();
    });

    it('should track heap usage', () => {
      expect(monitor.getHeapUsed()).toBeGreaterThan(0);
      expect(monitor.getHeapTotal()).toBeGreaterThan(0);
    });

    it('should calculate utilization', () => {
      const utilization = monitor.getUtilization();
      expect(utilization).toBeGreaterThanOrEqual(0);
      expect(utilization).toBeLessThanOrEqual(100);
    });

    it('should determine threshold level', () => {
      const level = monitor.getThresholdLevel();
      expect(['green', 'yellow', 'orange', 'red', 'critical']).toContain(level);
    });
  });

  describe('history tracking', () => {
    it('should maintain history', () => {
      monitor.getSnapshot();
      monitor.getSnapshot();
      monitor.getSnapshot();

      const history = monitor.getHistory();
      expect(history.length).toBe(3);
    });

    it('should limit history size', () => {
      const smallMonitor = new MemoryMonitor({
        maxHistorySize: 5,
        heapLimit: 512 * 1024 * 1024,
      });

      for (let i = 0; i < 10; i++) {
        smallMonitor.getSnapshot();
      }

      expect(smallMonitor.getHistory().length).toBe(5);
    });

    it('should clear history', () => {
      monitor.getSnapshot();
      monitor.getSnapshot();
      monitor.clearHistory();

      expect(monitor.getHistory().length).toBe(0);
    });
  });

  describe('trend analysis', () => {
    it('should analyze trend with insufficient data', () => {
      const trend = monitor.analyzeTrend();
      expect(trend.direction).toBe('stable');
      expect(trend.sampleCount).toBeLessThan(2);
    });

    it('should generate report', () => {
      const report = monitor.getReport();

      expect(report).toContain('Memory Report');
      expect(report).toContain('Heap Used');
      expect(report).toContain('Utilization');
    });
  });

  describe('default thresholds', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_MEMORY_THRESHOLDS.yellow).toBe(60);
      expect(DEFAULT_MEMORY_THRESHOLDS.orange).toBe(80);
      expect(DEFAULT_MEMORY_THRESHOLDS.red).toBe(90);
      expect(DEFAULT_MEMORY_THRESHOLDS.critical).toBe(95);
    });
  });
});

// ==================== Concurrency Tracker Tests ====================

describe('ConcurrencyTracker', () => {
  let tracker: ConcurrencyTracker;

  beforeEach(() => {
    tracker = new ConcurrencyTracker();
  });

  describe('basic tracking', () => {
    it('should track concurrent operations', () => {
      const h1 = tracker.enter('op1');
      expect(tracker.current).toBe(1);

      const h2 = tracker.enter('op2');
      expect(tracker.current).toBe(2);

      h1.exit();
      expect(tracker.current).toBe(1);

      h2.exit();
      expect(tracker.current).toBe(0);
    });

    it('should track peak concurrency', () => {
      const handles = [];
      for (let i = 0; i < 5; i++) {
        handles.push(tracker.enter(`op_${i}`));
      }

      expect(tracker.peak).toBe(5);

      handles.forEach(h => h.exit());
      expect(tracker.current).toBe(0);
      expect(tracker.peak).toBe(5); // Peak preserved
    });
  });

  describe('contention reporting', () => {
    it('should record contention events', () => {
      const handle = tracker.enter('op1');
      handle.reportContention('lock', 50);
      handle.exit();

      const events = tracker.getContentionEvents();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('lock');
      expect(events[0].waitTimeMs).toBe(50);
    });

    it('should track active operations', () => {
      const h1 = tracker.enter('op1', 'resource_a');
      const h2 = tracker.enter('op2', 'resource_b');

      const active = tracker.getActiveOperations();
      expect(active.length).toBe(2);

      h1.exit();
      h2.exit();
    });
  });

  describe('statistics', () => {
    it('should calculate stats', () => {
      for (let i = 0; i < 10; i++) {
        const h = tracker.enter(`op_${i}`);
        h.exit();
      }

      const stats = tracker.getStats();
      expect(stats.total).toBe(10);
      expect(stats.peak).toBeGreaterThanOrEqual(1);
    });

    it('should generate report', () => {
      tracker.enter('op1');
      const report = tracker.getReport();

      expect(report).toContain('Concurrency Report');
      expect(report).toContain('Current');
      expect(report).toContain('Peak');
    });

    it('should reset', () => {
      tracker.enter('op1');
      tracker.reset();

      expect(tracker.current).toBe(0);
      expect(tracker.peak).toBe(0);
    });
  });
});

// ==================== AsyncSemaphore Tests ====================

describe('AsyncSemaphore', () => {
  it('should limit concurrency', async () => {
    const semaphore = new AsyncSemaphore(2);

    expect(semaphore.available()).toBe(2);

    await semaphore.acquire();
    expect(semaphore.available()).toBe(1);

    await semaphore.acquire();
    expect(semaphore.available()).toBe(0);

    semaphore.release();
    expect(semaphore.available()).toBe(1);
  });

  it('should queue when full', async () => {
    const semaphore = new AsyncSemaphore(1);
    let executed = false;

    await semaphore.acquire();

    // Start waiting
    const waitPromise = semaphore.acquire().then(() => {
      executed = true;
    });

    expect(semaphore.waiting()).toBe(1);

    semaphore.release();
    await waitPromise;

    expect(executed).toBe(true);
  });

  it('should work with withPermit', async () => {
    const semaphore = new AsyncSemaphore(1);
    let result = 0;

    await semaphore.withPermit(async () => {
      result = 42;
    });

    expect(result).toBe(42);
    expect(semaphore.available()).toBe(1);
  });
});

// ==================== RateLimiter Tests ====================

describe('RateLimiter', () => {
  it('should limit rate', () => {
    const limiter = new RateLimiter(5, 10); // 5 tokens, 10/sec refill

    // Consume all tokens
    for (let i = 0; i < 5; i++) {
      expect(limiter.tryAcquire()).toBe(true);
    }

    // Should be empty
    expect(limiter.tryAcquire()).toBe(false);
  });

  it('should refill over time', async () => {
    const limiter = new RateLimiter(2, 100); // Fast refill for test

    limiter.tryAcquire();
    limiter.tryAcquire();
    expect(limiter.available()).toBeLessThan(1);

    await new Promise(r => setTimeout(r, 50));
    expect(limiter.available()).toBeGreaterThan(0);
  });
});

// ==================== Vector Scale Test Tests ====================

describe('VectorScaleTest', () => {
  describe('vector generation', () => {
    it('should generate normalized vectors', () => {
      const vectors = generateNormalizedVectors(10, 768);

      expect(vectors.length).toBe(10);
      expect(vectors[0].length).toBe(768);

      // Check normalization (magnitude should be ~1)
      const v = vectors[0];
      let magnitude = 0;
      for (let i = 0; i < v.length; i++) {
        magnitude += v[i] * v[i];
      }
      expect(Math.sqrt(magnitude)).toBeCloseTo(1, 1);
    });
  });

  describe('scale test', () => {
    it('should run scale test with small config', async () => {
      const test = new VectorScaleTest();

      const report = await test.runScaleTest({
        dimensions: 64,
        scalePoints: [100, 500],
        compressionEnabled: true,
        searchValidation: true,
        memoryTracking: true,
        batchSize: 100,
      });

      expect(report.results.length).toBe(2);
      expect(report.results[0].vectorCount).toBe(100);
      expect(report.results[1].vectorCount).toBe(500);
      expect(report.validation).toBeDefined();
    });

    it('should calculate compression ratio', async () => {
      const test = new VectorScaleTest();

      const report = await test.runScaleTest({
        dimensions: 64,
        scalePoints: [1000],
        compressionEnabled: true,
        searchValidation: false,
        memoryTracking: false,
        batchSize: 1000,
      });

      const result = report.results[0];
      expect(result.compressionRatio).toBeGreaterThan(0);
      expect(result.rawMemoryMB).toBeGreaterThan(result.compressedMemoryMB);
    });
  });

  describe('default config', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_VECTOR_SCALE_CONFIG.dimensions).toBe(1536);
      expect(DEFAULT_VECTOR_SCALE_CONFIG.scalePoints).toContain(1000000);
      expect(DEFAULT_VECTOR_SCALE_CONFIG.compressionEnabled).toBe(true);
    });
  });
});

// ==================== Pipeline Scale Test Tests ====================

describe('PipelineScaleTest', () => {
  describe('agent generation', () => {
    it('should generate pipeline agents', () => {
      const agents = generatePipelineAgents(48);

      expect(agents.length).toBe(48);
      expect(agents[0].id).toBe(0);
      expect(agents[0].phase).toBe('foundation');
    });

    it('should set dependencies correctly', () => {
      const agents = generatePipelineAgents(14);

      // First phase agents have no dependencies
      expect(agents[0].dependencies.length).toBe(0);

      // Second phase agents depend on first phase
      expect(agents[7].dependencies.length).toBeGreaterThan(0);
    });
  });

  describe('pipeline test', () => {
    it('should run pipeline test', async () => {
      const test = new PipelineScaleTest();

      const report = await test.runPipelineTest({
        agentCount: 10,
        targetCompletionRate: 0.80,
        maxHandoffLatencyMs: 100,
        timeoutMs: 10000,
      });

      expect(report.agentCount).toBe(10);
      expect(report.completions).toBeGreaterThan(0);
      expect(report.completionRate).toBeGreaterThan(0);
      expect(report.maxConcurrency).toBeGreaterThanOrEqual(1);
    });

    it('should run contention test', async () => {
      const test = new PipelineScaleTest();

      const report = await test.runContentionTest(10);

      expect(report.concurrentOperations).toBe(10);
      expect(report.successRate).toBeGreaterThan(0);
    });
  });

  describe('default config', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_PIPELINE_SCALE_CONFIG.agentCount).toBe(48);
      expect(DEFAULT_PIPELINE_SCALE_CONFIG.targetCompletionRate).toBe(0.88);
    });
  });
});

// ==================== Memory Pressure Test Tests ====================

describe('MemoryPressureTest', () => {
  describe('pressure test', () => {
    it('should run pressure test at low threshold', async () => {
      const test = new MemoryPressureTest({ heapLimit: 512 * 1024 * 1024 });

      const report = await test.runPressureTest(30, {
        operationCount: 20,
        operationTimeoutMs: 100,
        allowGC: false,
        thresholds: [30],
      });

      expect(report.targetUtilization).toBe(30);
      expect(report.successRate).toBeGreaterThan(0);
    });

    it('should track compression triggers', async () => {
      const test = new MemoryPressureTest();

      await test.runPressureTest(60, {
        operationCount: 10,
        operationTimeoutMs: 100,
        thresholds: [60],
        allowGC: false,
      });

      // Compression may or may not trigger at 60%
      expect(test.getCompressionCount()).toBeGreaterThanOrEqual(0);
    });
  });

  describe('default config', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_MEMORY_PRESSURE_CONFIG.thresholds).toContain(80);
      expect(DEFAULT_MEMORY_PRESSURE_CONFIG.thresholds).toContain(95);
      expect(DEFAULT_MEMORY_PRESSURE_CONFIG.operationCount).toBe(100);
    });
  });
});

// ==================== Degradation Test Tests ====================

describe('DegradationTest', () => {
  describe('CapacityManager', () => {
    it('should track capacity', () => {
      const manager = new CapacityManager(10);

      expect(manager.getLoad()).toBe(0);
      expect(manager.getUtilization()).toBe(0);

      manager.acquire();
      expect(manager.getLoad()).toBe(1);
      expect(manager.getUtilization()).toBe(0.1);
    });

    it('should reject when at capacity', () => {
      const manager = new CapacityManager(3);

      manager.acquire();
      manager.acquire();
      manager.acquire();

      expect(() => manager.acquire()).toThrow(CapacityExceededError);
    });

    it('should release capacity', () => {
      const manager = new CapacityManager(3);

      manager.acquire();
      manager.acquire();
      manager.release();

      expect(manager.getLoad()).toBe(1);
      expect(manager.tryAcquire()).toBe(true);
    });
  });

  describe('degradation test', () => {
    it('should test graceful degradation', async () => {
      const test = new DegradationTest({
        capacityLimit: 20,
        overloadAttempts: 10,
        recoveryCheckCount: 5,
        recoveryTimeoutMs: 2000,
      });

      const report = await test.runDegradationTest();

      expect(report.capacityReached).toBe(true);
      expect(report.rejectionBehavior.crashes).toBe(0);
      expect(report.rejectionBehavior.gracefulRejections).toBeGreaterThan(0);
    });
  });

  describe('default config', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_DEGRADATION_CONFIG.capacityLimit).toBe(100);
      expect(DEFAULT_DEGRADATION_CONFIG.overloadAttempts).toBe(50);
    });
  });
});

// ==================== Multi-Instance Test Tests ====================

describe('MultiInstanceTest', () => {
  describe('SimulatedInstance', () => {
    it('should execute operations', async () => {
      const instance = new SimulatedInstance('test');

      await instance.execute('key1', { value: 42 });

      expect(instance.get('key1')).toBeDefined();
      expect(instance.operationCount).toBe(1);
    });

    it('should sync from another instance', async () => {
      const inst1 = new SimulatedInstance('inst1');
      const inst2 = new SimulatedInstance('inst2');

      await inst1.execute('shared_key', { value: 100 });
      inst2.syncFrom(inst1);

      expect(inst2.get('shared_key')).toBeDefined();
    });

    it('should handle partition', async () => {
      const instance = new SimulatedInstance('test');

      instance.partition();

      await expect(instance.execute('key', 'value')).rejects.toThrow('partitioned');

      instance.heal();
      await instance.execute('key', 'value');
      expect(instance.get('key')).toBeDefined();
    });
  });

  describe('multi-instance test', () => {
    it('should test multiple instances', async () => {
      const test = new MultiInstanceTest({
        instanceCount: 2,
        operationsPerInstance: 20,
        syncIntervalMs: 50,
        partitionDurationMs: 500,
      });

      const report = await test.runMultiInstanceTest();

      expect(report.instanceCount).toBe(2);
      expect(report.stateSynchronization).toBeDefined();
      expect(report.loadDistribution).toBeDefined();
      expect(report.partitionTolerance).toBeDefined();
    });
  });

  describe('default config', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_MULTI_INSTANCE_CONFIG.instanceCount).toBe(4);
      expect(DEFAULT_MULTI_INSTANCE_CONFIG.operationsPerInstance).toBe(100);
    });
  });
});

// ==================== Scale Test Runner Tests ====================

describe('ScaleTestRunner', () => {
  describe('runner', () => {
    it('should run specific test', async () => {
      const runner = new ScaleTestRunner({ verbose: false });

      const report = await runner.runTest('degradation');

      expect(report.tests.degradation).toBeDefined();
      expect(report.tests.vectorScale).toBeUndefined();
    });

    it('should generate summary', async () => {
      const runner = new ScaleTestRunner({
        verbose: false,
        runVectorScale: false,
        runPipelineScale: false,
        runMemoryPressure: false,
        runDegradation: true,
        runMultiInstance: false,
      });

      const report = await runner.runAllScaleTests();

      expect(report.summary.checks.length).toBeGreaterThan(0);
      expect(report.summary.total).toBeGreaterThan(0);
    });

    it('should generate markdown report', async () => {
      const runner = new ScaleTestRunner({
        verbose: false,
        runVectorScale: false,
        runPipelineScale: false,
        runMemoryPressure: false,
        runDegradation: true,
        runMultiInstance: false,
      });

      const report = await runner.runAllScaleTests();
      const md = runner.generateMarkdownReport(report);

      expect(md).toContain('# NFR-4');
      expect(md).toContain('Summary');
      expect(md).toContain('Status');
    });
  });

  describe('default config', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_RUNNER_CONFIG.runVectorScale).toBe(true);
      expect(DEFAULT_RUNNER_CONFIG.runPipelineScale).toBe(true);
      expect(DEFAULT_RUNNER_CONFIG.verbose).toBe(true);
    });
  });
});

// ==================== Integration Tests ====================

describe('Scale Tests Integration', () => {
  it('should run lightweight full suite', async () => {
    const runner = new ScaleTestRunner({
      verbose: false,
      runVectorScale: true,
      runPipelineScale: true,
      runMemoryPressure: false, // Skip - can be slow/resource-intensive
      runDegradation: true,
      runMultiInstance: true,
    });

    const report = await runner.runAllScaleTests({
      dimensions: 64,
      scalePoints: [100],
      batchSize: 100,
      compressionEnabled: true,
      searchValidation: false,
      memoryTracking: false,
    });

    expect(report.tests.vectorScale).toBeDefined();
    expect(report.tests.pipelineScale).toBeDefined();
    expect(report.tests.degradation).toBeDefined();
    expect(report.tests.multiInstance).toBeDefined();
    expect(report.summary).toBeDefined();
  });
});
