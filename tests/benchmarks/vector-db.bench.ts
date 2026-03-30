/**
 * VectorDB Performance Benchmark Harness
 *
 * Implements: TASK-VDB-002
 * Referenced by: God Agent core system
 *
 * Comprehensive benchmark suite for VectorDB performance validation
 * against PRD targets:
 * - Insert: <50µs per operation
 * - Search (k=10, 10k vectors): median <1ms, p99 <3ms (native mode)
 * - Construction: <12s for 10k vectors
 * - Index size: ~30MB for 10k vectors
 */

import { describe, bench } from 'vitest';
import { VectorDB } from '../../src/god-agent/core/vector-db/vector-db.js';
import { generateTestVectors, generateRandomVector } from './utils/test-vectors.js';
import { calculateStats } from './utils/statistics.js';
import { printBenchmarkResult, generateMarkdownReport, type BenchmarkResult } from './utils/reporters.js';

/**
 * Benchmark configuration
 */
interface BenchmarkConfig {
  name: string;
  vectorCount: number;
  searchIterations: number;
  insertIterations: number;
  warmupIterations: number;
}

/**
 * Standard benchmark configurations
 */
const BENCHMARK_CONFIGS: BenchmarkConfig[] = [
  {
    name: 'Small Dataset',
    vectorCount: 1000,
    searchIterations: 1000,
    insertIterations: 1000,
    warmupIterations: 100
  },
  {
    name: 'Medium Dataset',
    vectorCount: 10000,
    searchIterations: 1000,
    insertIterations: 1000,
    warmupIterations: 100
  },
  // Large dataset commented out by default (takes too long)
  // Uncomment for full benchmark suite
  // {
  //   name: 'Large Dataset',
  //   vectorCount: 100000,
  //   searchIterations: 500,
  //   insertIterations: 500,
  //   warmupIterations: 50
  // }
];

/**
 * Measure memory usage
 */
function measureMemory(): NodeJS.MemoryUsage {
  if (global.gc) {
    global.gc();
  }
  return process.memoryUsage();
}

/**
 * Run insert benchmark
 */
async function benchmarkInsert(config: BenchmarkConfig): Promise<BenchmarkResult> {
  const db = new VectorDB();
  const testVectors = generateTestVectors(config.insertIterations);
  const latencies: number[] = [];

  // Warmup phase
  for (let i = 0; i < config.warmupIterations; i++) {
    await db.insert(generateRandomVector());
  }

  // Clear for actual benchmark
  db.clear();

  // Benchmark phase
  for (let i = 0; i < config.insertIterations; i++) {
    const start = performance.now();
    await db.insert(testVectors[i]);
    const end = performance.now();
    latencies.push(end - start);
  }

  const stats = calculateStats(latencies);
  const totalTime = latencies.reduce((sum, val) => sum + val, 0);
  const opsPerSecond = (config.insertIterations / totalTime) * 1000;

  return {
    name: `Insert (${config.name})`,
    vectorCount: config.vectorCount,
    iterations: config.insertIterations,
    stats,
    opsPerSecond
  };
}

/**
 * Run batch insert benchmark
 */
async function benchmarkBatchInsert(config: BenchmarkConfig): Promise<BenchmarkResult> {
  const db = new VectorDB();
  const batchSize = 100;
  const numBatches = Math.floor(config.insertIterations / batchSize);
  const latencies: number[] = [];

  // Warmup
  const warmupVectors = generateTestVectors(batchSize);
  await db.batchInsert(warmupVectors);
  db.clear();

  // Benchmark phase
  for (let i = 0; i < numBatches; i++) {
    const batch = generateTestVectors(batchSize);
    const start = performance.now();
    await db.batchInsert(batch);
    const end = performance.now();

    // Record per-vector latency
    const perVectorLatency = (end - start) / batchSize;
    for (let j = 0; j < batchSize; j++) {
      latencies.push(perVectorLatency);
    }
  }

  const stats = calculateStats(latencies);
  const totalTime = latencies.reduce((sum, val) => sum + val, 0);
  const opsPerSecond = (latencies.length / totalTime) * 1000;

  return {
    name: `Batch Insert (${config.name})`,
    vectorCount: config.vectorCount,
    iterations: latencies.length,
    stats,
    opsPerSecond
  };
}

/**
 * Run search benchmark
 */
async function benchmarkSearch(config: BenchmarkConfig): Promise<BenchmarkResult> {
  const db = new VectorDB();

  // Pre-populate database
  const indexVectors = generateTestVectors(config.vectorCount);
  for (const vector of indexVectors) {
    await db.insert(vector);
  }

  // Generate query vectors
  const queryVectors = generateTestVectors(100); // 100 unique queries
  const latencies: number[] = [];

  // Warmup phase
  for (let i = 0; i < config.warmupIterations; i++) {
    db.search(generateRandomVector(), 10);
  }

  // Benchmark phase: run multiple iterations per query
  const iterationsPerQuery = Math.ceil(config.searchIterations / queryVectors.length);
  for (const query of queryVectors) {
    for (let i = 0; i < iterationsPerQuery; i++) {
      const start = performance.now();
      db.search(query, 10);
      const end = performance.now();
      latencies.push(end - start);

      if (latencies.length >= config.searchIterations) {
        break;
      }
    }
    if (latencies.length >= config.searchIterations) {
      break;
    }
  }

  const stats = calculateStats(latencies);
  const totalTime = latencies.reduce((sum, val) => sum + val, 0);
  const opsPerSecond = (latencies.length / totalTime) * 1000;

  return {
    name: `Search k=10 (${config.name})`,
    vectorCount: config.vectorCount,
    iterations: latencies.length,
    stats,
    opsPerSecond
  };
}

/**
 * Run construction benchmark
 */
async function benchmarkConstruction(config: BenchmarkConfig): Promise<BenchmarkResult> {
  const testVectors = generateTestVectors(config.vectorCount);

  // Warmup with smaller dataset
  const warmupDb = new VectorDB();
  const warmupVectors = generateTestVectors(config.warmupIterations);
  for (const vector of warmupVectors) {
    await warmupDb.insert(vector);
  }

  // Benchmark construction
  const start = performance.now();
  const db = new VectorDB();
  for (const vector of testVectors) {
    await db.insert(vector);
  }
  const end = performance.now();

  const totalTime = end - start;
  const perVectorTime = totalTime / config.vectorCount;

  return {
    name: `Construction (${config.name})`,
    vectorCount: config.vectorCount,
    iterations: 1,
    stats: {
      min: totalTime,
      max: totalTime,
      mean: totalTime,
      median: totalTime,
      p50: totalTime,
      p95: totalTime,
      p99: totalTime,
      stdDev: 0
    },
    opsPerSecond: (config.vectorCount / totalTime) * 1000
  };
}

/**
 * Run memory usage benchmark
 */
async function benchmarkMemoryUsage(config: BenchmarkConfig): Promise<BenchmarkResult> {
  const testVectors = generateTestVectors(config.vectorCount);

  // Measure baseline memory
  const beforeMemory = measureMemory();

  // Insert vectors
  const db = new VectorDB();
  for (const vector of testVectors) {
    await db.insert(vector);
  }

  // Measure after insertion
  const afterMemory = measureMemory();

  const heapUsed = afterMemory.heapUsed - beforeMemory.heapUsed;
  const external = afterMemory.external - beforeMemory.external;
  const bytesPerVector = heapUsed / config.vectorCount;

  return {
    name: `Memory Usage (${config.name})`,
    vectorCount: config.vectorCount,
    iterations: 1,
    stats: {
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      stdDev: 0
    },
    memoryUsage: {
      heapUsed,
      external,
      bytesPerVector
    }
  };
}

/**
 * Validate benchmark results against performance targets
 */
function validatePerformanceTargets(results: BenchmarkResult[]): {
  passed: boolean;
  failures: string[];
} {
  const failures: string[] = [];

  for (const result of results) {
    // Check insert performance: <50µs per operation
    if (result.name.includes('Insert') && !result.name.includes('Batch')) {
      const medianMicroseconds = result.stats.median * 1000;
      if (medianMicroseconds > 50) {
        failures.push(
          `${result.name}: Insert median ${medianMicroseconds.toFixed(2)}µs exceeds 50µs target`
        );
      }
    }

    // Check search performance for 10k vectors: median <1ms, p99 <3ms
    if (result.name.includes('Search') && result.vectorCount === 10000) {
      if (result.stats.median > 1.0) {
        failures.push(
          `${result.name}: Search median ${result.stats.median.toFixed(2)}ms exceeds 1ms target`
        );
      }
      if (result.stats.p99 > 3.0) {
        failures.push(
          `${result.name}: Search p99 ${result.stats.p99.toFixed(2)}ms exceeds 3ms target`
        );
      }
    }

    // Check construction time for 10k vectors: <12s
    if (result.name.includes('Construction') && result.vectorCount === 10000) {
      const totalSeconds = result.stats.median / 1000;
      if (totalSeconds > 12.0) {
        failures.push(
          `${result.name}: Construction time ${totalSeconds.toFixed(2)}s exceeds 12s target`
        );
      }
    }

    // Check memory usage for 10k vectors: ~30MB (with 20% tolerance)
    if (result.name.includes('Memory') && result.vectorCount === 10000 && result.memoryUsage) {
      const memoryMB = result.memoryUsage.heapUsed / (1024 * 1024);
      if (memoryMB > 30 * 1.2) {
        failures.push(
          `${result.name}: Memory usage ${memoryMB.toFixed(2)}MB significantly exceeds 30MB target`
        );
      }
    }
  }

  return {
    passed: failures.length === 0,
    failures
  };
}

// ============================================================================
// Vitest Benchmark Suite
// ============================================================================

describe('VectorDB Benchmarks', () => {
  const allResults: BenchmarkResult[] = [];

  for (const config of BENCHMARK_CONFIGS) {
    describe(config.name, () => {
      bench(
        `insert - ${config.vectorCount} vectors`,
        async () => {
          const result = await benchmarkInsert(config);
          allResults.push(result);
          printBenchmarkResult(result);
        },
        { iterations: 1 }
      );

      bench(
        `batch insert - ${config.vectorCount} vectors`,
        async () => {
          const result = await benchmarkBatchInsert(config);
          allResults.push(result);
          printBenchmarkResult(result);
        },
        { iterations: 1 }
      );

      bench(
        `search k=10 - ${config.vectorCount} vectors`,
        async () => {
          const result = await benchmarkSearch(config);
          allResults.push(result);
          printBenchmarkResult(result);
        },
        { iterations: 1 }
      );

      bench(
        `construction - ${config.vectorCount} vectors`,
        async () => {
          const result = await benchmarkConstruction(config);
          allResults.push(result);
          printBenchmarkResult(result);
        },
        { iterations: 1 }
      );

      bench(
        `memory usage - ${config.vectorCount} vectors`,
        async () => {
          const result = await benchmarkMemoryUsage(config);
          allResults.push(result);
          printBenchmarkResult(result);
        },
        { iterations: 1 }
      );
    });
  }

  // Generate reports after all benchmarks
  bench('generate reports', async () => {
    console.log('\n' + '='.repeat(80));
    console.log('BENCHMARK COMPLETE - GENERATING REPORTS');
    console.log('='.repeat(80) + '\n');

    // Validate against targets
    const validation = validatePerformanceTargets(allResults);

    if (!validation.passed) {
      console.error('\n⚠️  PERFORMANCE TARGETS NOT MET:\n');
      for (const failure of validation.failures) {
        console.error(`  ❌ ${failure}`);
      }
      console.error('\n');
    } else {
      console.log('\n✅ All performance targets met!\n');
    }

    // Generate markdown report
    const markdown = generateMarkdownReport(allResults);
    console.log(markdown);

    // Note: In production, you would write this to a file
    // await writeFile('benchmark-results.md', markdown);
    // await writeFile('benchmark-results.json', JSON.stringify(allResults, null, 2));
  }, { iterations: 1 });
});
