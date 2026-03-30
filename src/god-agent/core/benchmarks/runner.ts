/**
 * Benchmark Runner
 * TASK-NFR-001 - Performance Benchmark Suite
 *
 * Provides standardized benchmark execution with:
 * - Warm-up, measurement, and cool-down phases
 * - Statistical analysis (percentiles, mean, stdDev)
 * - Outlier removal
 * - SLO validation
 */

// ==================== Types ====================

/**
 * Benchmark configuration
 */
export interface BenchmarkConfig {
  /** Benchmark name */
  name: string;
  /** Warm-up iterations (discarded) */
  warmUpIterations: number;
  /** Measurement iterations */
  measureIterations: number;
  /** Cool-down time in ms */
  coolDownMs: number;
  /** Maximum timeout in ms */
  timeoutMs: number;
  /** Percentile for outlier removal (e.g., 95 removes top 5%) */
  outlierPercentile: number;
}

/**
 * Default benchmark configuration
 */
export const DEFAULT_BENCHMARK_CONFIG: Omit<BenchmarkConfig, 'name'> = {
  warmUpIterations: 100,
  measureIterations: 1000,
  coolDownMs: 100,
  timeoutMs: 30000,
  outlierPercentile: 95,
};

/**
 * Statistics result
 */
export interface BenchmarkStatistics {
  mean: number;
  median: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  stdDev: number;
  variance: number;
}

/**
 * Complete benchmark result
 */
export interface BenchmarkResult {
  /** Benchmark name */
  name: string;
  /** Number of measurement iterations */
  iterations: number;
  /** Total execution time in ms */
  totalTimeMs: number;
  /** Individual iteration timings in ms */
  timings: number[];
  /** Calculated statistics */
  statistics: BenchmarkStatistics;
  /** SLO target in ms (if defined) */
  sloTarget?: number;
  /** SLO metric type */
  sloMetric?: 'p50' | 'p95' | 'p99' | 'mean' | 'median';
  /** Whether SLO was met */
  sloPass?: boolean;
  /** Timestamp of benchmark run */
  timestamp: number;
}

/**
 * Benchmark suite result
 */
export interface BenchmarkSuiteResult {
  /** Suite name */
  name: string;
  /** Timestamp */
  timestamp: number;
  /** Individual benchmark results */
  results: BenchmarkResult[];
  /** SLO summary */
  summary: {
    passed: number;
    failed: number;
    total: number;
    allPass: boolean;
  };
}

// ==================== Statistical Functions ====================

/**
 * Calculate percentile from sorted array
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

/**
 * Calculate mean of array
 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Calculate variance of array
 */
export function variance(values: number[], meanValue?: number): number {
  if (values.length === 0) return 0;
  const m = meanValue ?? mean(values);
  return values.reduce((sum, x) => sum + (x - m) ** 2, 0) / values.length;
}

/**
 * Calculate standard deviation
 */
export function stdDev(values: number[], meanValue?: number): number {
  return Math.sqrt(variance(values, meanValue));
}

/**
 * Calculate comprehensive statistics
 */
export function calculateStatistics(
  timings: number[],
  outlierPercentile: number = 95
): BenchmarkStatistics {
  if (timings.length === 0) {
    return {
      mean: 0,
      median: 0,
      p50: 0,
      p90: 0,
      p95: 0,
      p99: 0,
      min: 0,
      max: 0,
      stdDev: 0,
      variance: 0,
    };
  }

  // Sort for percentile calculation
  const sorted = [...timings].sort((a, b) => a - b);

  // Remove outliers (top N%)
  const cutoff = Math.max(1, Math.floor(sorted.length * (outlierPercentile / 100)));
  const filtered = sorted.slice(0, cutoff);

  const meanVal = mean(filtered);
  const varianceVal = variance(filtered, meanVal);

  return {
    mean: meanVal,
    median: percentile(filtered, 50),
    p50: percentile(filtered, 50),
    p90: percentile(filtered, 90),
    p95: percentile(filtered, 95),
    p99: percentile(filtered, 99),
    min: filtered[0],
    max: filtered[filtered.length - 1],
    stdDev: Math.sqrt(varianceVal),
    variance: varianceVal,
  };
}

// ==================== Benchmark Runner ====================

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Standardized benchmark runner
 */
export class BenchmarkRunner {
  private results: Map<string, BenchmarkResult> = new Map();

  /**
   * Run a single benchmark with standardized protocol
   */
  async runBenchmark<T>(
    config: BenchmarkConfig,
    setup: () => Promise<T>,
    benchmark: (context: T) => Promise<void> | void,
    teardown?: (context: T) => Promise<void> | void
  ): Promise<BenchmarkResult> {
    // Setup phase
    const context = await setup();

    // Warm-up phase (discard results)
    for (let i = 0; i < config.warmUpIterations; i++) {
      await benchmark(context);
    }

    // Cool-down between phases
    await sleep(config.coolDownMs);

    // Measurement phase
    const timings: number[] = [];
    const startTotal = performance.now();

    for (let i = 0; i < config.measureIterations; i++) {
      const start = performance.now();
      await benchmark(context);
      const end = performance.now();
      timings.push(end - start);
    }

    const endTotal = performance.now();

    // Teardown
    if (teardown) {
      await teardown(context);
    }

    // Calculate statistics
    const statistics = calculateStatistics(timings, config.outlierPercentile);

    const result: BenchmarkResult = {
      name: config.name,
      iterations: config.measureIterations,
      totalTimeMs: endTotal - startTotal,
      timings,
      statistics,
      timestamp: Date.now(),
    };

    this.results.set(config.name, result);
    return result;
  }

  /**
   * Run a synchronous benchmark
   */
  runBenchmarkSync<T>(
    config: BenchmarkConfig,
    setup: () => T,
    benchmark: (context: T) => void,
    teardown?: (context: T) => void
  ): BenchmarkResult {
    // Setup phase
    const context = setup();

    // Warm-up phase (discard results)
    for (let i = 0; i < config.warmUpIterations; i++) {
      benchmark(context);
    }

    // Measurement phase
    const timings: number[] = [];
    const startTotal = performance.now();

    for (let i = 0; i < config.measureIterations; i++) {
      const start = performance.now();
      benchmark(context);
      const end = performance.now();
      timings.push(end - start);
    }

    const endTotal = performance.now();

    // Teardown
    if (teardown) {
      teardown(context);
    }

    // Calculate statistics
    const statistics = calculateStatistics(timings, config.outlierPercentile);

    const result: BenchmarkResult = {
      name: config.name,
      iterations: config.measureIterations,
      totalTimeMs: endTotal - startTotal,
      timings,
      statistics,
      timestamp: Date.now(),
    };

    this.results.set(config.name, result);
    return result;
  }

  /**
   * Validate SLO for a benchmark result
   */
  validateSLO(
    result: BenchmarkResult,
    target: number,
    metric: 'p50' | 'p95' | 'p99' | 'mean' | 'median' = 'p95'
  ): boolean {
    result.sloTarget = target;
    result.sloMetric = metric;

    let actual: number;
    switch (metric) {
      case 'p50':
        actual = result.statistics.p50;
        break;
      case 'p95':
        actual = result.statistics.p95;
        break;
      case 'p99':
        actual = result.statistics.p99;
        break;
      case 'mean':
        actual = result.statistics.mean;
        break;
      case 'median':
        actual = result.statistics.median;
        break;
    }

    result.sloPass = actual <= target;
    return result.sloPass;
  }

  /**
   * Get all results
   */
  getResults(): Map<string, BenchmarkResult> {
    return new Map(this.results);
  }

  /**
   * Get a specific result
   */
  getResult(name: string): BenchmarkResult | undefined {
    return this.results.get(name);
  }

  /**
   * Clear all results
   */
  clear(): void {
    this.results.clear();
  }
}

// ==================== Benchmark Suite ====================

/**
 * Benchmark definition for suite
 */
export interface BenchmarkDefinition<T = unknown> {
  /** Benchmark ID */
  id: string;
  /** Display name */
  name: string;
  /** SLO target in ms */
  sloTarget: number;
  /** SLO metric type */
  sloMetric: 'p50' | 'p95' | 'p99' | 'mean' | 'median';
  /** Configuration overrides */
  config?: Partial<BenchmarkConfig>;
  /** Setup function */
  setup: () => Promise<T> | T;
  /** Benchmark function */
  benchmark: (context: T) => Promise<void> | void;
  /** Teardown function */
  teardown?: (context: T) => Promise<void> | void;
}

/**
 * Benchmark suite runner
 */
export class BenchmarkSuite {
  private name: string;
  private benchmarks: BenchmarkDefinition[] = [];
  private runner: BenchmarkRunner = new BenchmarkRunner();

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Add a benchmark to the suite
   */
  add<T>(definition: BenchmarkDefinition<T>): void {
    this.benchmarks.push(definition as BenchmarkDefinition);
  }

  /**
   * Run all benchmarks in the suite
   */
  async run(verbose: boolean = false): Promise<BenchmarkSuiteResult> {
    const results: BenchmarkResult[] = [];
    let passed = 0;
    let failed = 0;

    if (verbose) {
      console.log(`\nRunning benchmark suite: ${this.name}`);
      console.log('='.repeat(60));
    }

    for (const bench of this.benchmarks) {
      if (verbose) {
        console.log(`\n[${bench.id}] ${bench.name}`);
        console.log(`  Target: <${bench.sloTarget}ms ${bench.sloMetric}`);
      }

      const config: BenchmarkConfig = {
        name: bench.id,
        ...DEFAULT_BENCHMARK_CONFIG,
        ...bench.config,
      };

      try {
        const result = await this.runner.runBenchmark(
          config,
          bench.setup as () => Promise<unknown>,
          bench.benchmark,
          bench.teardown
        );

        const sloPass = this.runner.validateSLO(result, bench.sloTarget, bench.sloMetric);

        if (sloPass) {
          passed++;
        } else {
          failed++;
        }

        results.push(result);

        if (verbose) {
          const actualValue = result.statistics[bench.sloMetric];
          console.log(`  Actual: ${actualValue.toFixed(4)}ms ${bench.sloMetric}`);
          console.log(`  Status: ${sloPass ? '✓ PASS' : '✗ FAIL'}`);
        }
      } catch (error) {
        if (verbose) {
          console.log(`  Error: ${error}`);
        }
        failed++;
      }
    }

    if (verbose) {
      console.log('\n' + '='.repeat(60));
      console.log(`SUMMARY: ${passed}/${this.benchmarks.length} passed`);
      console.log(`Overall: ${failed === 0 ? '✓ ALL PASS' : '✗ FAILED'}`);
    }

    return {
      name: this.name,
      timestamp: Date.now(),
      results,
      summary: {
        passed,
        failed,
        total: this.benchmarks.length,
        allPass: failed === 0,
      },
    };
  }

  /**
   * Get benchmark count
   */
  size(): number {
    return this.benchmarks.length;
  }
}

// ==================== Global Runner Instance ====================

/**
 * Global benchmark runner instance
 */
export const benchmarkRunner = new BenchmarkRunner();
