/**
 * Sona Engine Performance Benchmarks
 * TASK-PERSIST-014 - Performance Validation
 *
 * Validates performance targets from TASK-SON-001:
 * - createTrajectoryWithId: <1ms per operation
 * - provideFeedback: <15ms per operation
 * - DAO operations: <2-10ms targets
 *
 * Outputs formatted benchmark results with pass/fail indicators.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';
import {
  SonaEngine,
  createProductionSonaEngine,
  generateTrajectoryID,
} from '../../../../src/god-agent/core/learning/index.js';
import { DatabaseConnection, createConnection } from '../../../../src/god-agent/core/database/connection.js';
import { TrajectoryMetadataDAO } from '../../../../src/god-agent/core/database/dao/trajectory-metadata-dao.js';
import { PatternDAO } from '../../../../src/god-agent/core/database/dao/pattern-dao.js';
import { LearningFeedbackDAO } from '../../../../src/god-agent/core/database/dao/learning-feedback-dao.js';

// ============================================================
// PERFORMANCE UTILITIES
// ============================================================

interface BenchmarkResult {
  name: string;
  iterations: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  target: number;
  passed: boolean;
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sorted: number[], p: number): number {
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Run a synchronous benchmark
 */
function runSyncBenchmark(
  name: string,
  iterations: number,
  target: number,
  fn: () => void
): BenchmarkResult {
  const times: number[] = [];

  // Warmup (10% of iterations, min 10)
  const warmupCount = Math.max(10, Math.floor(iterations * 0.1));
  for (let i = 0; i < warmupCount; i++) {
    fn();
  }

  // Actual benchmark
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }

  // Sort for percentiles
  const sorted = [...times].sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;

  return {
    name,
    iterations,
    mean,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    target,
    passed: mean < target,
  };
}

/**
 * Run an async benchmark
 */
async function runAsyncBenchmark(
  name: string,
  iterations: number,
  target: number,
  fn: () => Promise<void>
): Promise<BenchmarkResult> {
  const times: number[] = [];

  // Warmup (10% of iterations, min 10)
  const warmupCount = Math.max(10, Math.floor(iterations * 0.1));
  for (let i = 0; i < warmupCount; i++) {
    await fn();
  }

  // Actual benchmark
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }

  // Sort for percentiles
  const sorted = [...times].sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;

  return {
    name,
    iterations,
    mean,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    target,
    passed: mean < target,
  };
}

/**
 * Format a benchmark result for display
 */
function formatResult(result: BenchmarkResult): string {
  const status = result.passed ? '\u2713' : '\u2717';
  return [
    `${result.name} (n=${result.iterations}):`,
    `  Mean: ${result.mean.toFixed(3)}ms ${status} (target: <${result.target}ms)`,
    `  P50:  ${result.p50.toFixed(3)}ms`,
    `  P95:  ${result.p95.toFixed(3)}ms`,
    `  P99:  ${result.p99.toFixed(3)}ms`,
    `  Min:  ${result.min.toFixed(3)}ms  Max: ${result.max.toFixed(3)}ms`,
  ].join('\n');
}

// ============================================================
// TEST SETUP
// ============================================================

describe('SonaEngine Persistence Benchmarks', () => {
  let testDir: string;
  let dbConnection: DatabaseConnection;
  let engineWithPersistence: SonaEngine;
  let engineWithoutPersistence: SonaEngine;
  let trajectoryDAO: TrajectoryMetadataDAO;
  let patternDAO: PatternDAO;
  let feedbackDAO: LearningFeedbackDAO;
  const results: BenchmarkResult[] = [];

  beforeAll(() => {
    // Create unique test directory
    testDir = join(tmpdir(), `sona-bench-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Create database connection
    const dbPath = join(testDir, 'benchmark.db');
    dbConnection = createConnection({ dbPath });

    // Initialize DAOs
    trajectoryDAO = new TrajectoryMetadataDAO(dbConnection);
    patternDAO = new PatternDAO(dbConnection);
    feedbackDAO = new LearningFeedbackDAO(dbConnection);

    // Create engines
    engineWithPersistence = new SonaEngine({
      databaseConnection: dbConnection,
      trackPerformance: true,
    });

    engineWithoutPersistence = new SonaEngine({
      trackPerformance: true,
    });

    console.log('\n=== SonaEngine Persistence Benchmarks ===\n');
  });

  afterAll(() => {
    // Print all results
    console.log('\n=== Benchmark Results ===\n');
    results.forEach((result) => {
      console.log(formatResult(result));
      console.log('');
    });

    // Print summary
    const passed = results.filter((r) => r.passed).length;
    const total = results.length;
    console.log(`\nSummary: ${passed}/${total} benchmarks passed\n`);

    // Cleanup
    dbConnection.close();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // INTENTIONAL: Cleanup failure is non-critical in tests
    }
  });

  beforeEach(() => {
    // Clear engines between tests
    engineWithPersistence.clear();
    engineWithoutPersistence.clear();
  });

  // ============================================================
  // CORE SONA ENGINE BENCHMARKS
  // ============================================================

  describe('SonaEngine Core Operations', () => {
    it('createTrajectoryWithId should complete in <1ms (n=1000)', () => {
      const result = runSyncBenchmark(
        'createTrajectoryWithId',
        1000,
        1.0, // Target: <1ms
        () => {
          const id = generateTrajectoryID();
          engineWithPersistence.createTrajectoryWithId(
            id,
            `route.bench.${Date.now()}`,
            ['pattern1', 'pattern2', 'pattern3'],
            ['context1']
          );
        }
      );

      results.push(result);
      expect(result.mean).toBeLessThan(1.0);
    });

    it('provideFeedback should complete in <15ms (n=500)', async () => {
      // Pre-create trajectories
      const trajectoryIds: string[] = [];
      for (let i = 0; i < 600; i++) {
        const id = generateTrajectoryID();
        engineWithoutPersistence.createTrajectoryWithId(
          id,
          'route.feedback.bench',
          ['p1', 'p2', 'p3'],
          []
        );
        trajectoryIds.push(id);
      }

      let idx = 0;
      const result = await runAsyncBenchmark(
        'provideFeedback',
        500,
        15.0, // Target: <15ms
        async () => {
          const trajectoryId = trajectoryIds[idx++];
          await engineWithoutPersistence.provideFeedback(trajectoryId, 0.75, {
            skipAutoSave: true,
          });
        }
      );

      results.push(result);
      expect(result.mean).toBeLessThan(15.0);
    });
  });

  // ============================================================
  // DAO INSERT BENCHMARKS
  // ============================================================

  describe('DAO Insert Operations', () => {
    it('TrajectoryMetadataDAO.insert should complete in <2ms', () => {
      let counter = 0;
      const result = runSyncBenchmark(
        'TrajectoryMetadataDAO.insert',
        500,
        2.0, // Target: <2ms
        () => {
          const id = `traj-bench-${Date.now()}-${counter++}`;
          trajectoryDAO.insert({
            id,
            filePath: `.agentdb/sona/trajectories/${id}.bin`,
            fileOffset: 0,
            fileLength: 1024,
            route: 'benchmark.route',
            stepCount: 10,
            createdAt: Date.now(),
            status: 'active',
          });
        }
      );

      results.push(result);
      expect(result.mean).toBeLessThan(2.0);
    });

    it('PatternDAO.insert should complete in <5ms', () => {
      let counter = 0;
      const result = runSyncBenchmark(
        'PatternDAO.insert',
        200,
        5.0, // Target: <5ms
        () => {
          const id = `pattern-bench-${Date.now()}-${counter++}`;
          const embedding = new Float32Array(1536);
          for (let i = 0; i < 1536; i++) {
            embedding[i] = Math.random();
          }

          patternDAO.insert({
            id,
            name: `Pattern ${counter}`,
            context: 'benchmark context',
            action: 'benchmark action',
            outcome: 'success',
            embedding,
            weight: 0.5,
            trajectoryIds: ['traj-1', 'traj-2'],
            agentId: 'benchmark-agent',
            taskType: 'benchmark',
            createdAt: Date.now(),
            tags: ['bench', 'test'],
          });
        }
      );

      results.push(result);
      expect(result.mean).toBeLessThan(5.0);
    });

    it('LearningFeedbackDAO.insert should complete in <2ms', () => {
      let counter = 0;
      const result = runSyncBenchmark(
        'LearningFeedbackDAO.insert',
        500,
        2.0, // Target: <2ms
        () => {
          const id = `feedback-bench-${Date.now()}-${counter++}`;
          feedbackDAO.insert({
            id,
            trajectoryId: `traj-${counter}`,
            quality: 0.75,
            outcome: 'positive',
            taskType: 'benchmark',
            agentId: 'benchmark-agent',
            resultLength: 1024,
            hasCodeBlocks: false,
            createdAt: Date.now(),
          });
        }
      );

      results.push(result);
      expect(result.mean).toBeLessThan(2.0);
    });
  });

  // ============================================================
  // QUERY BENCHMARKS
  // ============================================================

  describe('Query Operations', () => {
    beforeAll(() => {
      // Pre-populate data for query benchmarks
      for (let i = 0; i < 100; i++) {
        trajectoryDAO.insert({
          id: `query-traj-${i}`,
          filePath: `.agentdb/sona/trajectories/query-traj-${i}.bin`,
          fileOffset: i * 1024,
          fileLength: 1024,
          route: i % 2 === 0 ? 'route.even' : 'route.odd',
          stepCount: 5 + (i % 10),
          qualityScore: 0.5 + (i % 50) / 100,
          createdAt: Date.now() - i * 1000,
          status: i % 3 === 0 ? 'completed' : 'active',
        });
      }
    });

    it('TrajectoryMetadataDAO.findById should complete in <1ms', () => {
      const result = runSyncBenchmark(
        'TrajectoryMetadataDAO.findById',
        1000,
        1.0, // Target: <1ms
        () => {
          const idx = Math.floor(Math.random() * 100);
          trajectoryDAO.findById(`query-traj-${idx}`);
        }
      );

      results.push(result);
      expect(result.mean).toBeLessThan(1.0);
    });

    it('TrajectoryMetadataDAO.findByStatus should complete in <5ms for 100 records', () => {
      const result = runSyncBenchmark(
        'TrajectoryMetadataDAO.findByStatus',
        200,
        5.0, // Target: <5ms
        () => {
          trajectoryDAO.findByStatus('active');
        }
      );

      results.push(result);
      expect(result.mean).toBeLessThan(5.0);
    });

    it('TrajectoryMetadataDAO.getStats should complete in <10ms', () => {
      const result = runSyncBenchmark(
        'TrajectoryMetadataDAO.getStats',
        100,
        10.0, // Target: <10ms
        () => {
          trajectoryDAO.getStats();
        }
      );

      results.push(result);
      expect(result.mean).toBeLessThan(10.0);
    });

    it('PatternDAO.findById should complete in <1ms', () => {
      // Pre-populate patterns
      for (let i = 0; i < 50; i++) {
        const embedding = new Float32Array(1536).fill(0.1);
        patternDAO.insert({
          id: `query-pattern-${i}`,
          name: `Query Pattern ${i}`,
          context: 'query context',
          action: 'query action',
          embedding,
          weight: 0.5,
          trajectoryIds: ['traj-1'],
          agentId: 'query-agent',
          taskType: 'query',
          createdAt: Date.now(),
        });
      }

      const result = runSyncBenchmark(
        'PatternDAO.findById',
        500,
        1.0, // Target: <1ms
        () => {
          const idx = Math.floor(Math.random() * 50);
          patternDAO.findById(`query-pattern-${idx}`);
        }
      );

      results.push(result);
      expect(result.mean).toBeLessThan(1.0);
    });

    it('LearningFeedbackDAO.findByTrajectoryId should complete in <2ms', () => {
      // Pre-populate feedback
      for (let i = 0; i < 100; i++) {
        feedbackDAO.insert({
          id: `query-feedback-${i}`,
          trajectoryId: `query-traj-${i % 20}`,
          quality: 0.7,
          outcome: 'positive',
          taskType: 'query',
          agentId: 'query-agent',
          createdAt: Date.now(),
        });
      }

      const result = runSyncBenchmark(
        'LearningFeedbackDAO.findByTrajectoryId',
        500,
        2.0, // Target: <2ms
        () => {
          const idx = Math.floor(Math.random() * 20);
          feedbackDAO.findByTrajectoryId(`query-traj-${idx}`);
        }
      );

      results.push(result);
      expect(result.mean).toBeLessThan(2.0);
    });
  });

  // ============================================================
  // PERSISTENCE OVERHEAD COMPARISON
  // ============================================================

  describe('Persistence Overhead', () => {
    /**
     * Note on overhead measurement:
     *
     * For extremely fast operations (sub-millisecond), percentage overhead
     * can appear very high even when absolute times are well within targets.
     * Example: 0.003ms vs 0.057ms = 1800% overhead, but both are well under 1ms target.
     *
     * We use two validation strategies:
     * 1. Absolute target validation (primary): Both memory-only and persistence
     *    versions must meet the performance target (e.g., <1ms for createTrajectoryWithId)
     * 2. Maximum allowed overhead in milliseconds (secondary): The difference
     *    between persistence and memory-only should be reasonable
     */

    it('should keep createTrajectoryWithId within absolute target with persistence', () => {
      const iterations = 200;
      const absoluteTarget = 1.0; // <1ms per operation is the spec target
      const maxOverheadMs = 0.5; // Maximum acceptable additional latency

      // Benchmark without persistence
      let memoryOnlyTimes: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const id = generateTrajectoryID();
        const start = performance.now();
        engineWithoutPersistence.createTrajectoryWithId(
          id,
          'route.overhead.test',
          ['p1', 'p2'],
          []
        );
        memoryOnlyTimes.push(performance.now() - start);
      }
      const memoryOnlyMean = memoryOnlyTimes.reduce((a, b) => a + b, 0) / memoryOnlyTimes.length;

      // Clear and benchmark with persistence
      engineWithPersistence.clear();
      let persistenceTimes: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const id = generateTrajectoryID();
        const start = performance.now();
        engineWithPersistence.createTrajectoryWithId(
          id,
          'route.overhead.test',
          ['p1', 'p2'],
          []
        );
        persistenceTimes.push(performance.now() - start);
      }
      const persistenceMean = persistenceTimes.reduce((a, b) => a + b, 0) / persistenceTimes.length;

      // Calculate metrics
      const overheadMs = persistenceMean - memoryOnlyMean;
      const overheadPercent = memoryOnlyMean > 0
        ? ((persistenceMean - memoryOnlyMean) / memoryOnlyMean) * 100
        : 0;

      // Validate both versions meet absolute target AND overhead is acceptable
      const meetsAbsoluteTarget = persistenceMean < absoluteTarget;
      const overheadAcceptable = overheadMs < maxOverheadMs;
      const passed = meetsAbsoluteTarget && overheadAcceptable;

      const result: BenchmarkResult = {
        name: 'createTrajectoryWithId Persistence Overhead',
        iterations,
        mean: persistenceMean,
        p50: percentile([...persistenceTimes].sort((a, b) => a - b), 50),
        p95: percentile([...persistenceTimes].sort((a, b) => a - b), 95),
        p99: percentile([...persistenceTimes].sort((a, b) => a - b), 99),
        min: Math.min(...persistenceTimes),
        max: Math.max(...persistenceTimes),
        target: absoluteTarget,
        passed,
      };

      results.push(result);

      console.log(`\ncreateTrajectoryWithId Persistence Analysis:`);
      console.log(`  Memory-only mean: ${memoryOnlyMean.toFixed(3)}ms`);
      console.log(`  With persistence mean: ${persistenceMean.toFixed(3)}ms`);
      console.log(`  Absolute overhead: +${overheadMs.toFixed(3)}ms ${overheadAcceptable ? '\u2713' : '\u2717'} (max: ${maxOverheadMs}ms)`);
      console.log(`  Percentage overhead: ${overheadPercent.toFixed(1)}%`);
      console.log(`  Meets target (<${absoluteTarget}ms): ${meetsAbsoluteTarget ? '\u2713' : '\u2717'}`);

      // Primary assertion: operation with persistence still meets absolute target
      expect(persistenceMean).toBeLessThan(absoluteTarget);
      // Secondary assertion: overhead is reasonable in absolute terms
      expect(overheadMs).toBeLessThan(maxOverheadMs);
    });

    it('should keep provideFeedback within absolute target with persistence', async () => {
      const iterations = 100;
      const absoluteTarget = 15.0; // <15ms per operation is the spec target
      const maxOverheadMs = 5.0; // Maximum acceptable additional latency

      // Create trajectories for both engines
      const memoryTrajectoryIds: string[] = [];
      const persistTrajectoryIds: string[] = [];

      for (let i = 0; i < iterations + 20; i++) {
        const memId = generateTrajectoryID();
        engineWithoutPersistence.createTrajectoryWithId(memId, 'route.feedback.overhead', ['p1'], []);
        memoryTrajectoryIds.push(memId);

        const persId = generateTrajectoryID();
        engineWithPersistence.createTrajectoryWithId(persId, 'route.feedback.overhead', ['p1'], []);
        persistTrajectoryIds.push(persId);
      }

      // Benchmark without persistence
      let memoryOnlyTimes: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await engineWithoutPersistence.provideFeedback(memoryTrajectoryIds[i], 0.7, { skipAutoSave: true });
        memoryOnlyTimes.push(performance.now() - start);
      }
      const memoryOnlyMean = memoryOnlyTimes.reduce((a, b) => a + b, 0) / memoryOnlyTimes.length;

      // Benchmark with persistence
      let persistenceTimes: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await engineWithPersistence.provideFeedback(persistTrajectoryIds[i], 0.7, { skipAutoSave: true });
        persistenceTimes.push(performance.now() - start);
      }
      const persistenceMean = persistenceTimes.reduce((a, b) => a + b, 0) / persistenceTimes.length;

      // Calculate metrics
      const overheadMs = persistenceMean - memoryOnlyMean;
      const overheadPercent = memoryOnlyMean > 0
        ? ((persistenceMean - memoryOnlyMean) / memoryOnlyMean) * 100
        : 0;

      // Validate both versions meet absolute target AND overhead is acceptable
      const meetsAbsoluteTarget = persistenceMean < absoluteTarget;
      const overheadAcceptable = overheadMs < maxOverheadMs;
      const passed = meetsAbsoluteTarget && overheadAcceptable;

      const result: BenchmarkResult = {
        name: 'provideFeedback Persistence Overhead',
        iterations,
        mean: persistenceMean,
        p50: percentile([...persistenceTimes].sort((a, b) => a - b), 50),
        p95: percentile([...persistenceTimes].sort((a, b) => a - b), 95),
        p99: percentile([...persistenceTimes].sort((a, b) => a - b), 99),
        min: Math.min(...persistenceTimes),
        max: Math.max(...persistenceTimes),
        target: absoluteTarget,
        passed,
      };

      results.push(result);

      console.log(`\nprovideFeedback Persistence Analysis:`);
      console.log(`  Memory-only mean: ${memoryOnlyMean.toFixed(3)}ms`);
      console.log(`  With persistence mean: ${persistenceMean.toFixed(3)}ms`);
      console.log(`  Absolute overhead: +${overheadMs.toFixed(3)}ms ${overheadAcceptable ? '\u2713' : '\u2717'} (max: ${maxOverheadMs}ms)`);
      console.log(`  Percentage overhead: ${overheadPercent.toFixed(1)}%`);
      console.log(`  Meets target (<${absoluteTarget}ms): ${meetsAbsoluteTarget ? '\u2713' : '\u2717'}`);

      // Primary assertion: operation with persistence still meets absolute target
      expect(persistenceMean).toBeLessThan(absoluteTarget);
      // Secondary assertion: overhead is reasonable in absolute terms
      expect(overheadMs).toBeLessThan(maxOverheadMs);
    });
  });

  // ============================================================
  // BULK OPERATION BENCHMARKS
  // ============================================================

  describe('Bulk Operations', () => {
    it('should handle 1000 trajectory inserts in <2 seconds', () => {
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        const id = generateTrajectoryID();
        engineWithoutPersistence.createTrajectoryWithId(
          id,
          `route.bulk.${i % 10}`,
          ['p1', 'p2', 'p3'],
          ['c1']
        );
      }

      const elapsed = performance.now() - start;
      const passed = elapsed < 2000;

      const result: BenchmarkResult = {
        name: 'Bulk Trajectory Insert (1000)',
        iterations: 1000,
        mean: elapsed / 1000,
        p50: elapsed / 1000,
        p95: elapsed / 1000,
        p99: elapsed / 1000,
        min: elapsed / 1000,
        max: elapsed / 1000,
        target: 2.0,
        passed,
      };

      results.push(result);

      console.log(`\nBulk Trajectory Insert (1000):`);
      console.log(`  Total time: ${elapsed.toFixed(1)}ms ${passed ? '\u2713' : '\u2717'} (target: <2000ms)`);
      console.log(`  Per operation: ${(elapsed / 1000).toFixed(3)}ms`);

      expect(elapsed).toBeLessThan(2000);
    });

    it('should handle 500 DAO inserts in transaction in <1 second', () => {
      const start = performance.now();

      dbConnection.transaction(() => {
        for (let i = 0; i < 500; i++) {
          trajectoryDAO.insert({
            id: `bulk-txn-${Date.now()}-${i}`,
            filePath: `.agentdb/sona/trajectories/bulk-${i}.bin`,
            fileOffset: 0,
            fileLength: 512,
            route: 'route.bulk.txn',
            stepCount: 5,
            createdAt: Date.now(),
            status: 'active',
          });
        }
      });

      const elapsed = performance.now() - start;
      const passed = elapsed < 1000;

      const result: BenchmarkResult = {
        name: 'Bulk DAO Insert in Transaction (500)',
        iterations: 500,
        mean: elapsed / 500,
        p50: elapsed / 500,
        p95: elapsed / 500,
        p99: elapsed / 500,
        min: elapsed / 500,
        max: elapsed / 500,
        target: 2.0,
        passed,
      };

      results.push(result);

      console.log(`\nBulk DAO Insert in Transaction (500):`);
      console.log(`  Total time: ${elapsed.toFixed(1)}ms ${passed ? '\u2713' : '\u2717'} (target: <1000ms)`);
      console.log(`  Per operation: ${(elapsed / 500).toFixed(3)}ms`);

      expect(elapsed).toBeLessThan(1000);
    });
  });

  // ============================================================
  // CONCURRENT ACCESS BENCHMARKS
  // ============================================================

  describe('Concurrent Access', () => {
    it('should handle concurrent reads efficiently', async () => {
      // Pre-populate
      for (let i = 0; i < 50; i++) {
        trajectoryDAO.insert({
          id: `concurrent-${i}`,
          filePath: `path-${i}`,
          fileOffset: 0,
          fileLength: 256,
          route: 'route.concurrent',
          stepCount: 3,
          createdAt: Date.now(),
          status: 'active',
        });
      }

      const concurrency = 10;
      const readsPerWorker = 100;

      const start = performance.now();

      const workers = Array(concurrency).fill(null).map(async () => {
        for (let i = 0; i < readsPerWorker; i++) {
          const idx = Math.floor(Math.random() * 50);
          trajectoryDAO.findById(`concurrent-${idx}`);
        }
      });

      await Promise.all(workers);

      const elapsed = performance.now() - start;
      const totalOps = concurrency * readsPerWorker;
      const opsPerSecond = (totalOps / elapsed) * 1000;
      const passed = opsPerSecond > 5000; // Target: >5000 ops/sec

      console.log(`\nConcurrent Reads (${concurrency} workers x ${readsPerWorker} reads):`);
      console.log(`  Total time: ${elapsed.toFixed(1)}ms`);
      console.log(`  Operations/sec: ${opsPerSecond.toFixed(0)} ${passed ? '\u2713' : '\u2717'} (target: >5000)`);

      expect(opsPerSecond).toBeGreaterThan(5000);
    });
  });
});
