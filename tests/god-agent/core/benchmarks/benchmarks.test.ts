/**
 * Benchmarks Module Tests
 * TASK-NFR-001 - Performance Benchmark Suite
 *
 * Tests for:
 * - BenchmarkRunner with standardized protocol
 * - Statistical analysis (percentiles, mean, stdDev)
 * - BenchmarkSuite aggregation
 * - Multi-format reporting (JSON, Markdown, Prometheus, JUnit)
 * - SLO validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  // Runner
  BenchmarkRunner,
  BenchmarkSuite,
  DEFAULT_BENCHMARK_CONFIG,
  type BenchmarkConfig,
  type BenchmarkResult,
  type BenchmarkSuiteResult,
  // Statistical functions
  percentile,
  mean,
  variance,
  stdDev,
  calculateStatistics,
  // Reporter
  BenchmarkReporter,
  type ReportFormat,
  // Regression
  RegressionDetector,
  MemoryBaselineStorage,
  JsonBaselineStorage,
  DEFAULT_REGRESSION_CONFIG,
  formatRegressionReportMarkdown,
  type RegressionReport,
} from '../../../../src/god-agent/core/benchmarks/index.js';

// ==================== Statistical Functions Tests ====================

describe('Statistical Functions', () => {
  describe('percentile', () => {
    it('should calculate p50 (median)', () => {
      const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      expect(percentile(sorted, 50)).toBe(5);
    });

    it('should calculate p95', () => {
      const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
      expect(percentile(sorted, 95)).toBe(95);
    });

    it('should calculate p99', () => {
      const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
      expect(percentile(sorted, 99)).toBe(99);
    });

    it('should handle single element', () => {
      expect(percentile([5], 50)).toBe(5);
      expect(percentile([5], 95)).toBe(5);
    });

    it('should handle empty array', () => {
      expect(percentile([], 50)).toBe(0);
    });
  });

  describe('mean', () => {
    it('should calculate mean', () => {
      expect(mean([1, 2, 3, 4, 5])).toBe(3);
      expect(mean([10, 20, 30])).toBe(20);
    });

    it('should handle single element', () => {
      expect(mean([5])).toBe(5);
    });

    it('should handle empty array', () => {
      expect(mean([])).toBe(0);
    });
  });

  describe('variance', () => {
    it('should calculate variance', () => {
      // Variance of [1, 2, 3, 4, 5] = 2
      expect(variance([1, 2, 3, 4, 5])).toBe(2);
    });

    it('should use provided mean', () => {
      const values = [1, 2, 3, 4, 5];
      const m = mean(values);
      expect(variance(values, m)).toBe(2);
    });

    it('should handle empty array', () => {
      expect(variance([])).toBe(0);
    });
  });

  describe('stdDev', () => {
    it('should calculate standard deviation', () => {
      const sd = stdDev([1, 2, 3, 4, 5]);
      expect(sd).toBeCloseTo(Math.sqrt(2), 5);
    });

    it('should handle single element (zero variance)', () => {
      expect(stdDev([5])).toBe(0);
    });

    it('should handle empty array', () => {
      expect(stdDev([])).toBe(0);
    });
  });

  describe('calculateStatistics', () => {
    it('should calculate comprehensive statistics', () => {
      const values = Array.from({ length: 100 }, (_, i) => i + 1);
      const stats = calculateStatistics(values);

      expect(stats.p50).toBeGreaterThan(0);
      expect(stats.p95).toBeGreaterThan(stats.p50);
      expect(stats.p99).toBeGreaterThanOrEqual(stats.p95);
      expect(stats.min).toBeLessThanOrEqual(stats.max);
      expect(stats.mean).toBeGreaterThan(0);
      expect(stats.stdDev).toBeGreaterThanOrEqual(0);
    });

    it('should remove outliers', () => {
      // Create values with extreme outliers
      const values = [...Array.from({ length: 95 }, () => 1), 1000, 2000, 3000, 4000, 5000];
      const stats = calculateStatistics(values, 95);

      // After removing top 5% (5 values), max should be 1
      expect(stats.max).toBe(1);
    });

    it('should handle empty array', () => {
      const stats = calculateStatistics([]);
      expect(stats.mean).toBe(0);
      expect(stats.p50).toBe(0);
      expect(stats.p95).toBe(0);
    });
  });
});

// ==================== BenchmarkRunner Tests ====================

describe('BenchmarkRunner', () => {
  let runner: BenchmarkRunner;

  beforeEach(() => {
    runner = new BenchmarkRunner();
  });

  describe('runBenchmarkSync', () => {
    it('should run synchronous benchmark', () => {
      const config: BenchmarkConfig = {
        name: 'sync_test',
        warmUpIterations: 5,
        measureIterations: 100,
        coolDownMs: 0,
        timeoutMs: 5000,
        outlierPercentile: 95,
      };

      const result = runner.runBenchmarkSync(
        config,
        () => ({ counter: 0 }),
        ctx => {
          ctx.counter++;
        },
        () => {}
      );

      expect(result.name).toBe('sync_test');
      expect(result.iterations).toBe(100);
      expect(result.timings.length).toBe(100);
      expect(result.statistics.mean).toBeGreaterThan(0);
      expect(result.timestamp).toBeDefined();
    });

    it('should store result in runner', () => {
      const config: BenchmarkConfig = {
        name: 'stored_test',
        warmUpIterations: 1,
        measureIterations: 10,
        coolDownMs: 0,
        timeoutMs: 1000,
        outlierPercentile: 95,
      };

      runner.runBenchmarkSync(config, () => ({}), () => {});

      expect(runner.getResult('stored_test')).toBeDefined();
      expect(runner.getResults().size).toBe(1);
    });
  });

  describe('runBenchmark (async)', () => {
    it('should run asynchronous benchmark', async () => {
      const config: BenchmarkConfig = {
        name: 'async_test',
        warmUpIterations: 5,
        measureIterations: 50,
        coolDownMs: 10,
        timeoutMs: 5000,
        outlierPercentile: 95,
      };

      const result = await runner.runBenchmark(
        config,
        async () => ({ value: 0 }),
        async ctx => {
          await Promise.resolve();
          ctx.value++;
        },
        async () => {}
      );

      expect(result.name).toBe('async_test');
      expect(result.iterations).toBe(50);
      expect(result.statistics).toBeDefined();
    });
  });

  describe('validateSLO', () => {
    it('should pass when under target', () => {
      const result: BenchmarkResult = {
        name: 'test',
        iterations: 100,
        totalTimeMs: 100,
        timings: [],
        statistics: {
          mean: 0.5,
          median: 0.5,
          p50: 0.5,
          p90: 0.8,
          p95: 0.9,
          p99: 1.2,
          min: 0.1,
          max: 1.5,
          stdDev: 0.2,
          variance: 0.04,
        },
        timestamp: Date.now(),
      };

      expect(runner.validateSLO(result, 1.0, 'p95')).toBe(true);
      expect(result.sloPass).toBe(true);
      expect(result.sloTarget).toBe(1.0);
      expect(result.sloMetric).toBe('p95');
    });

    it('should fail when over target', () => {
      const result: BenchmarkResult = {
        name: 'test',
        iterations: 100,
        totalTimeMs: 100,
        timings: [],
        statistics: {
          mean: 0.5,
          median: 0.5,
          p50: 0.5,
          p90: 0.8,
          p95: 1.5,
          p99: 2.0,
          min: 0.1,
          max: 2.5,
          stdDev: 0.5,
          variance: 0.25,
        },
        timestamp: Date.now(),
      };

      expect(runner.validateSLO(result, 1.0, 'p95')).toBe(false);
      expect(result.sloPass).toBe(false);
    });

    it('should support different metrics', () => {
      const result: BenchmarkResult = {
        name: 'test',
        iterations: 100,
        totalTimeMs: 100,
        timings: [],
        statistics: {
          mean: 0.5,
          median: 0.4,
          p50: 0.4,
          p90: 0.8,
          p95: 1.0,
          p99: 1.5,
          min: 0.1,
          max: 2.0,
          stdDev: 0.3,
          variance: 0.09,
        },
        timestamp: Date.now(),
      };

      expect(runner.validateSLO(result, 0.5, 'median')).toBe(true);
      expect(runner.validateSLO(result, 0.5, 'mean')).toBe(true);
      expect(runner.validateSLO(result, 0.3, 'p50')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all results', () => {
      const config: BenchmarkConfig = {
        name: 'to_clear',
        warmUpIterations: 1,
        measureIterations: 10,
        coolDownMs: 0,
        timeoutMs: 1000,
        outlierPercentile: 95,
      };

      runner.runBenchmarkSync(config, () => ({}), () => {});
      expect(runner.getResults().size).toBe(1);

      runner.clear();
      expect(runner.getResults().size).toBe(0);
    });
  });
});

// ==================== BenchmarkSuite Tests ====================

describe('BenchmarkSuite', () => {
  it('should run multiple benchmarks', async () => {
    const suite = new BenchmarkSuite('Test Suite');

    suite.add({
      id: 'bench_1',
      name: 'Benchmark 1',
      sloTarget: 10,
      sloMetric: 'p95',
      config: { warmUpIterations: 5, measureIterations: 50 },
      setup: () => ({}),
      benchmark: () => {
        // Fast operation
        let sum = 0;
        for (let i = 0; i < 100; i++) sum += i;
      },
    });

    suite.add({
      id: 'bench_2',
      name: 'Benchmark 2',
      sloTarget: 10,
      sloMetric: 'mean',
      config: { warmUpIterations: 5, measureIterations: 50 },
      setup: () => ({}),
      benchmark: () => {
        let sum = 0;
        for (let i = 0; i < 50; i++) sum += i;
      },
    });

    const result = await suite.run(false);

    expect(result.name).toBe('Test Suite');
    expect(result.results.length).toBe(2);
    expect(result.summary.total).toBe(2);
    expect(result.timestamp).toBeDefined();
  });

  it('should report pass/fail correctly', async () => {
    const suite = new BenchmarkSuite('Pass/Fail Test');

    suite.add({
      id: 'fast_op',
      name: 'Fast Operation',
      sloTarget: 100, // Very generous target
      sloMetric: 'p95',
      config: { warmUpIterations: 5, measureIterations: 20 },
      setup: () => ({}),
      benchmark: () => {},
    });

    const result = await suite.run(false);

    expect(result.summary.passed).toBe(1);
    expect(result.summary.failed).toBe(0);
    expect(result.summary.allPass).toBe(true);
  });

  it('should track suite size', () => {
    const suite = new BenchmarkSuite('Size Test');

    expect(suite.size()).toBe(0);

    suite.add({
      id: 'test1',
      name: 'Test 1',
      sloTarget: 10,
      sloMetric: 'p95',
      setup: () => ({}),
      benchmark: () => {},
    });

    expect(suite.size()).toBe(1);
  });
});

// ==================== BenchmarkReporter Tests ====================

describe('BenchmarkReporter', () => {
  let reporter: BenchmarkReporter;
  let sampleResult: ReturnType<typeof createSampleResult>;

  function createSampleResult() {
    return {
      name: 'Test Suite',
      timestamp: Date.now(),
      results: [
        {
          name: 'vectordb.search',
          iterations: 1000,
          totalTimeMs: 500,
          timings: [0.5, 0.6, 0.4, 0.5, 0.5],
          statistics: {
            mean: 0.5,
            median: 0.5,
            p50: 0.5,
            p90: 0.8,
            p95: 0.9,
            p99: 1.1,
            min: 0.3,
            max: 1.2,
            stdDev: 0.15,
            variance: 0.0225,
          },
          sloTarget: 1.0,
          sloMetric: 'p95' as const,
          sloPass: true,
          timestamp: Date.now(),
        },
        {
          name: 'cache.hit',
          iterations: 10000,
          totalTimeMs: 100,
          timings: [0.01, 0.02, 0.01, 0.015],
          statistics: {
            mean: 0.014,
            median: 0.0125,
            p50: 0.0125,
            p90: 0.018,
            p95: 0.02,
            p99: 0.025,
            min: 0.01,
            max: 0.03,
            stdDev: 0.004,
            variance: 0.000016,
          },
          sloTarget: 0.05,
          sloMetric: 'p95' as const,
          sloPass: true,
          timestamp: Date.now(),
        },
      ],
      summary: {
        passed: 2,
        failed: 0,
        total: 2,
        allPass: true,
      },
    };
  }

  beforeEach(() => {
    reporter = new BenchmarkReporter();
    sampleResult = createSampleResult();
  });

  describe('toJSON', () => {
    it('should generate valid JSON', () => {
      const json = reporter.toJSON(sampleResult);
      const parsed = JSON.parse(json);

      expect(parsed.name).toBe('Test Suite');
      expect(parsed.results.length).toBe(2);
      expect(parsed.summary.total).toBe(2);
    });

    it('should exclude raw timings by default', () => {
      const json = reporter.toJSON(sampleResult);
      const parsed = JSON.parse(json);

      expect(parsed.results[0].timings).toBeUndefined();
    });

    it('should include raw timings when requested', () => {
      const json = reporter.toJSON(sampleResult, { includeRawTimings: true });
      const parsed = JSON.parse(json);

      expect(parsed.results[0].timings).toBeDefined();
      expect(parsed.results[0].timings.length).toBeGreaterThan(0);
    });
  });

  describe('toMarkdown', () => {
    it('should generate Markdown report', () => {
      const md = reporter.toMarkdown(sampleResult);

      expect(md).toContain('# Benchmark Report');
      expect(md).toContain('## SLO Validation Matrix');
      expect(md).toContain('## Detailed Statistics');
      expect(md).toContain('vectordb.search');
      expect(md).toContain('cache.hit');
      expect(md).toContain('✓ PASS');
    });

    it('should include custom title', () => {
      const md = reporter.toMarkdown(sampleResult, { title: 'Custom Title' });
      expect(md).toContain('# Custom Title');
    });

    it('should show failure status', () => {
      sampleResult.results[0].sloPass = false;
      sampleResult.summary.passed = 1;
      sampleResult.summary.failed = 1;
      sampleResult.summary.allPass = false;

      const md = reporter.toMarkdown(sampleResult);
      expect(md).toContain('✗ FAIL');
    });
  });

  describe('toPrometheus', () => {
    it('should generate Prometheus metrics format', () => {
      const prom = reporter.toPrometheus(sampleResult);

      expect(prom).toContain('# HELP');
      expect(prom).toContain('# TYPE');
      expect(prom).toContain('gauge');
      expect(prom).toContain('benchmark_vectordb_search_p95_ms');
      expect(prom).toContain('benchmark_cache_hit_p95_ms');
      expect(prom).toContain('benchmark_suite_passed');
      expect(prom).toContain('benchmark_suite_total');
    });

    it('should use valid metric names', () => {
      const prom = reporter.toPrometheus(sampleResult);

      // Metric names should not contain dots
      expect(prom).not.toContain('benchmark_vectordb.search');
      expect(prom).toContain('benchmark_vectordb_search');
    });
  });

  describe('toJUnit', () => {
    it('should generate valid JUnit XML', () => {
      const xml = reporter.toJUnit(sampleResult);

      expect(xml).toContain('<?xml version="1.0"');
      expect(xml).toContain('<testsuites');
      expect(xml).toContain('<testsuite');
      expect(xml).toContain('<testcase');
      expect(xml).toContain('</testsuites>');
    });

    it('should include test count', () => {
      const xml = reporter.toJUnit(sampleResult);
      expect(xml).toContain('tests="2"');
    });

    it('should include failure for failed tests', () => {
      sampleResult.results[0].sloPass = false;
      sampleResult.summary.failed = 1;

      const xml = reporter.toJUnit(sampleResult);
      expect(xml).toContain('<failure');
      expect(xml).toContain('SLO violation');
    });

    it('should escape XML special characters', () => {
      sampleResult.results[0].name = 'test<>&"\'';
      const xml = reporter.toJUnit(sampleResult);

      expect(xml).not.toContain('test<');
      expect(xml).toContain('&lt;');
      expect(xml).toContain('&gt;');
    });
  });

  describe('generate', () => {
    it('should support all formats', () => {
      const formats: ReportFormat[] = ['json', 'markdown', 'prometheus', 'junit'];

      for (const format of formats) {
        const output = reporter.generate(sampleResult, format);
        expect(output.length).toBeGreaterThan(0);
      }
    });

    it('should throw for unknown format', () => {
      expect(() => reporter.generate(sampleResult, 'unknown' as ReportFormat)).toThrow();
    });
  });
});

// ==================== Integration Tests ====================

describe('Benchmark Integration', () => {
  it('should benchmark compression operations', async () => {
    const suite = new BenchmarkSuite('Compression Performance');

    suite.add({
      id: 'float16_compress',
      name: 'Float16 Compression',
      sloTarget: 1.0,
      sloMetric: 'p95',
      config: { warmUpIterations: 50, measureIterations: 500 },
      setup: () => {
        const vector = new Float32Array(768);
        for (let i = 0; i < 768; i++) {
          vector[i] = Math.random() * 2 - 1;
        }
        return { vector };
      },
      benchmark: ctx => {
        // Simulate Float16 compression
        const result = new Uint16Array(ctx.vector.length);
        for (let i = 0; i < ctx.vector.length; i++) {
          result[i] = Math.fround(ctx.vector[i]) * 32767;
        }
      },
    });

    const result = await suite.run(false);

    expect(result.summary.total).toBe(1);
    expect(result.results[0].statistics.p95).toBeLessThan(1.0);
  });

  it('should benchmark attention selection', async () => {
    const suite = new BenchmarkSuite('Attention Performance');

    suite.add({
      id: 'attention_select',
      name: 'Attention Mechanism Selection',
      sloTarget: 1.0,
      sloMetric: 'p95',
      config: { warmUpIterations: 100, measureIterations: 1000 },
      setup: () => ({
        profile: {
          dimensions: 768,
          elementCount: 10000,
          hasHierarchy: true,
          hasGraphStructure: true,
        },
      }),
      benchmark: ctx => {
        // Simulate selection logic
        const profile = ctx.profile;
        let mechanism = 'LinearAttention';
        if (profile.hasHierarchy && profile.hasGraphStructure) {
          mechanism = 'DualSpaceAttention';
        } else if (profile.hasHierarchy) {
          mechanism = 'HyperbolicAttention';
        } else if (profile.hasGraphStructure) {
          mechanism = 'GraphAttention';
        }
        return mechanism;
      },
    });

    const result = await suite.run(false);

    expect(result.summary.allPass).toBe(true);
  });

  it('should generate complete report', async () => {
    const suite = new BenchmarkSuite('Complete Test');
    const reporter = new BenchmarkReporter();

    suite.add({
      id: 'fast_op',
      name: 'Fast Operation',
      sloTarget: 10,
      sloMetric: 'p95',
      config: { warmUpIterations: 10, measureIterations: 100 },
      setup: () => ({}),
      benchmark: () => {
        let sum = 0;
        for (let i = 0; i < 100; i++) sum += i;
      },
    });

    const result = await suite.run(false);

    // Generate all report formats
    const json = reporter.toJSON(result);
    const md = reporter.toMarkdown(result);
    const prom = reporter.toPrometheus(result);
    const junit = reporter.toJUnit(result);

    expect(JSON.parse(json).summary.allPass).toBe(true);
    expect(md).toContain('✓ PASS');
    expect(prom).toContain('benchmark_fast_op');
    expect(junit).toContain('name="fast_op"');
  });
});

// ==================== Default Config Tests ====================

describe('Default Configuration', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_BENCHMARK_CONFIG.warmUpIterations).toBe(100);
    expect(DEFAULT_BENCHMARK_CONFIG.measureIterations).toBe(1000);
    expect(DEFAULT_BENCHMARK_CONFIG.coolDownMs).toBe(100);
    expect(DEFAULT_BENCHMARK_CONFIG.timeoutMs).toBe(30000);
    expect(DEFAULT_BENCHMARK_CONFIG.outlierPercentile).toBe(95);
  });
});

// ==================== Regression Detection Tests ====================

describe('RegressionDetector', () => {
  let detector: RegressionDetector;

  function createSuiteResult(
    name: string,
    p95Values: Record<string, number>,
    timestamp = Date.now()
  ): BenchmarkSuiteResult {
    const results: BenchmarkResult[] = Object.entries(p95Values).map(([benchName, p95]) => ({
      name: benchName,
      iterations: 1000,
      totalTimeMs: p95 * 1000,
      timings: [],
      statistics: {
        mean: p95 * 0.9,
        median: p95 * 0.95,
        p50: p95 * 0.95,
        p90: p95 * 0.98,
        p95,
        p99: p95 * 1.05,
        min: p95 * 0.5,
        max: p95 * 1.5,
        stdDev: p95 * 0.1,
        variance: (p95 * 0.1) ** 2,
      },
      timestamp,
    }));

    return {
      name,
      timestamp,
      results,
      summary: {
        passed: results.length,
        failed: 0,
        total: results.length,
        allPass: true,
      },
    };
  }

  beforeEach(() => {
    detector = new RegressionDetector();
  });

  describe('baseline management', () => {
    it('should start without baseline', () => {
      expect(detector.hasBaseline()).toBe(false);
      expect(detector.loadBaseline()).toBeNull();
    });

    it('should save and load baseline', () => {
      const baseline = createSuiteResult('Baseline', { test: 1.0 });
      detector.saveBaseline(baseline);

      expect(detector.hasBaseline()).toBe(true);
      expect(detector.loadBaseline()?.name).toBe('Baseline');
    });

    it('should clear baseline', () => {
      const baseline = createSuiteResult('Baseline', { test: 1.0 });
      detector.saveBaseline(baseline);
      detector.clearBaseline();

      expect(detector.hasBaseline()).toBe(false);
    });
  });

  describe('regression detection', () => {
    it('should return no regressions when no baseline exists', () => {
      const current = createSuiteResult('Current', { test: 2.0 });
      const report = detector.detectRegressions(current);

      expect(report.hasBaseline).toBe(false);
      expect(report.regressions.length).toBe(0);
      expect(report.status).toBe('pass');
    });

    it('should detect regression when p95 increases beyond threshold', () => {
      const baseline = createSuiteResult('Baseline', { test: 1.0 });
      const current = createSuiteResult('Current', { test: 1.2 }); // 20% slower

      detector.saveBaseline(baseline);
      const report = detector.detectRegressions(current);

      expect(report.hasBaseline).toBe(true);
      expect(report.regressions.length).toBe(1);
      expect(report.regressions[0].benchmark).toBe('test');
      expect(report.regressions[0].changePercent).toBeCloseTo(20, 0);
    });

    it('should detect improvement when p95 decreases beyond threshold', () => {
      const baseline = createSuiteResult('Baseline', { test: 1.0 });
      const current = createSuiteResult('Current', { test: 0.8 }); // 20% faster

      detector.saveBaseline(baseline);
      const report = detector.detectRegressions(current);

      expect(report.improvements.length).toBe(1);
      expect(report.improvements[0].benchmark).toBe('test');
      expect(report.improvements[0].changePercent).toBeCloseTo(-20, 0);
    });

    it('should report unchanged when within threshold', () => {
      const baseline = createSuiteResult('Baseline', { test: 1.0 });
      const current = createSuiteResult('Current', { test: 1.05 }); // 5% slower (within default 10%)

      detector.saveBaseline(baseline);
      const report = detector.detectRegressions(current);

      expect(report.regressions.length).toBe(0);
      expect(report.improvements.length).toBe(0);
      expect(report.summary.unchanged).toBe(1);
    });

    it('should handle multiple benchmarks', () => {
      const baseline = createSuiteResult('Baseline', {
        fast: 0.5,
        medium: 1.0,
        slow: 5.0,
      });
      const current = createSuiteResult('Current', {
        fast: 0.7,  // 40% regression
        medium: 0.8, // 20% improvement
        slow: 5.2,  // 4% - unchanged
      });

      detector.saveBaseline(baseline);
      const report = detector.detectRegressions(current);

      expect(report.regressions.length).toBe(1);
      expect(report.regressions[0].benchmark).toBe('fast');
      expect(report.improvements.length).toBe(1);
      expect(report.improvements[0].benchmark).toBe('medium');
      expect(report.summary.unchanged).toBe(1);
    });
  });

  describe('severity classification', () => {
    it('should classify info severity for small regressions', () => {
      const baseline = createSuiteResult('Baseline', { test: 1.0 });
      const current = createSuiteResult('Current', { test: 1.15 }); // 15% regression

      detector.saveBaseline(baseline);
      const report = detector.detectRegressions(current);

      expect(report.regressions[0].severity).toBe('info');
      expect(report.status).toBe('warning');
    });

    it('should classify warning severity for moderate regressions', () => {
      const baseline = createSuiteResult('Baseline', { test: 1.0 });
      const current = createSuiteResult('Current', { test: 1.30 }); // 30% regression

      detector.saveBaseline(baseline);
      const report = detector.detectRegressions(current);

      expect(report.regressions[0].severity).toBe('warning');
      expect(report.status).toBe('warning');
    });

    it('should classify critical severity for large regressions', () => {
      const baseline = createSuiteResult('Baseline', { test: 1.0 });
      const current = createSuiteResult('Current', { test: 1.60 }); // 60% regression

      detector.saveBaseline(baseline);
      const report = detector.detectRegressions(current);

      expect(report.regressions[0].severity).toBe('critical');
      expect(report.status).toBe('fail');
    });
  });

  describe('custom configuration', () => {
    it('should respect custom thresholds', () => {
      const baseline = createSuiteResult('Baseline', { test: 1.0 });
      const current = createSuiteResult('Current', { test: 1.05 }); // 5% slower

      detector.saveBaseline(baseline);

      // With default config (10% threshold), this should not be a regression
      let report = detector.detectRegressions(current);
      expect(report.regressions.length).toBe(0);

      // With custom 3% threshold, this should be a regression
      report = detector.detectRegressions(current, { regressionThreshold: 3 });
      expect(report.regressions.length).toBe(1);
    });

    it('should use different metrics', () => {
      const baseline = createSuiteResult('Baseline', { test: 1.0 });
      baseline.results[0].statistics.mean = 0.8;

      const current = createSuiteResult('Current', { test: 1.0 });
      current.results[0].statistics.mean = 1.0; // Mean is 25% higher

      detector.saveBaseline(baseline);

      // By default uses p95, should be unchanged
      let report = detector.detectRegressions(current);
      expect(report.regressions.length).toBe(0);

      // Using mean metric, should detect regression
      report = detector.detectRegressions(current, { metric: 'mean' });
      expect(report.regressions.length).toBe(1);
    });

    it('should allow configuration updates', () => {
      expect(detector.getConfig().regressionThreshold).toBe(10);

      detector.setConfig({ regressionThreshold: 5 });
      expect(detector.getConfig().regressionThreshold).toBe(5);
    });
  });

  describe('compare method', () => {
    it('should compare without modifying stored baseline', () => {
      const originalBaseline = createSuiteResult('Original', { test: 1.0 });
      const compareBaseline = createSuiteResult('Compare', { test: 0.5 });
      const current = createSuiteResult('Current', { test: 0.8 });

      detector.saveBaseline(originalBaseline);
      const report = detector.compare(compareBaseline, current);

      // Compare shows regression vs compareBaseline (0.5 -> 0.8 = 60%)
      expect(report.regressions.length).toBe(1);
      expect(report.regressions[0].baseline).toBe(0.5);

      // Original baseline should be preserved
      expect(detector.loadBaseline()?.name).toBe('Original');
    });
  });

  describe('trend analysis', () => {
    it('should detect degrading trend', () => {
      const history = [
        createSuiteResult('Run1', { test: 1.0 }, 1000),
        createSuiteResult('Run2', { test: 1.1 }, 2000),
        createSuiteResult('Run3', { test: 1.2 }, 3000),
        createSuiteResult('Run4', { test: 1.3 }, 4000),
      ];

      const trend = detector.analyzeTrend('test', history);

      expect(trend.dataPoints).toBe(4);
      expect(trend.trend).toBe('degrading');
      expect(trend.slope).toBeGreaterThan(0);
    });

    it('should detect improving trend', () => {
      const history = [
        createSuiteResult('Run1', { test: 1.3 }, 1000),
        createSuiteResult('Run2', { test: 1.2 }, 2000),
        createSuiteResult('Run3', { test: 1.1 }, 3000),
        createSuiteResult('Run4', { test: 1.0 }, 4000),
      ];

      const trend = detector.analyzeTrend('test', history);

      expect(trend.trend).toBe('improving');
      expect(trend.slope).toBeLessThan(0);
    });

    it('should detect stable trend', () => {
      const history = [
        createSuiteResult('Run1', { test: 1.0 }, 1000),
        createSuiteResult('Run2', { test: 1.0 }, 2000),
        createSuiteResult('Run3', { test: 1.0 }, 3000),
      ];

      const trend = detector.analyzeTrend('test', history);

      expect(trend.trend).toBe('stable');
    });

    it('should handle insufficient data', () => {
      const history = [createSuiteResult('Run1', { test: 1.0 })];
      const trend = detector.analyzeTrend('test', history);

      expect(trend.dataPoints).toBe(1);
      expect(trend.trend).toBe('stable');
    });
  });
});

// ==================== Storage Implementation Tests ====================

describe('MemoryBaselineStorage', () => {
  it('should implement BaselineStorage interface', () => {
    const storage = new MemoryBaselineStorage();

    expect(storage.exists()).toBe(false);

    const baseline: BenchmarkSuiteResult = {
      name: 'Test',
      timestamp: Date.now(),
      results: [],
      summary: { passed: 0, failed: 0, total: 0, allPass: true },
    };

    storage.save(baseline);
    expect(storage.exists()).toBe(true);
    expect(storage.load()?.name).toBe('Test');

    storage.clear();
    expect(storage.exists()).toBe(false);
  });
});

describe('JsonBaselineStorage', () => {
  it('should serialize and deserialize', () => {
    const storage = new JsonBaselineStorage();

    const baseline: BenchmarkSuiteResult = {
      name: 'Test',
      timestamp: 12345,
      results: [],
      summary: { passed: 0, failed: 0, total: 0, allPass: true },
    };

    storage.save(baseline);
    const exported = storage.export();
    expect(exported).toBeTruthy();
    expect(JSON.parse(exported!).timestamp).toBe(12345);

    storage.clear();
    expect(storage.exists()).toBe(false);

    expect(storage.import(exported!)).toBe(true);
    expect(storage.load()?.timestamp).toBe(12345);
  });

  it('should reject invalid JSON', () => {
    const storage = new JsonBaselineStorage();
    expect(storage.import('not valid json')).toBe(false);
    expect(storage.exists()).toBe(false);
  });
});

// ==================== Format Utility Tests ====================

describe('formatRegressionReportMarkdown', () => {
  it('should format report without baseline', () => {
    const report: RegressionReport = {
      hasBaseline: false,
      regressions: [],
      improvements: [],
      summary: { total: 5, regressions: 0, improvements: 0, unchanged: 5 },
      status: 'pass',
      currentTimestamp: Date.now(),
    };

    const md = formatRegressionReportMarkdown(report);
    expect(md).toContain('No baseline available');
    expect(md).toContain('PASS');
  });

  it('should format report with regressions', () => {
    const report: RegressionReport = {
      hasBaseline: true,
      regressions: [
        {
          benchmark: 'slowTest',
          baseline: 1.0,
          current: 1.5,
          changePercent: 50,
          severity: 'critical',
          metric: 'p95',
        },
      ],
      improvements: [],
      summary: { total: 1, regressions: 1, improvements: 0, unchanged: 0 },
      status: 'fail',
      baselineTimestamp: Date.now() - 86400000,
      currentTimestamp: Date.now(),
    };

    const md = formatRegressionReportMarkdown(report);
    expect(md).toContain('## Regressions');
    expect(md).toContain('slowTest');
    expect(md).toContain('+50.0%');
    expect(md).toContain('critical');
    expect(md).toContain('FAIL');
  });

  it('should format report with improvements', () => {
    const report: RegressionReport = {
      hasBaseline: true,
      regressions: [],
      improvements: [
        {
          benchmark: 'fastTest',
          baseline: 1.0,
          current: 0.7,
          changePercent: -30,
          metric: 'p95',
        },
      ],
      summary: { total: 1, regressions: 0, improvements: 1, unchanged: 0 },
      status: 'pass',
      baselineTimestamp: Date.now() - 86400000,
      currentTimestamp: Date.now(),
    };

    const md = formatRegressionReportMarkdown(report);
    expect(md).toContain('## Improvements');
    expect(md).toContain('fastTest');
    expect(md).toContain('-30.0%');
  });
});

// ==================== Default Regression Config Tests ====================

describe('Default Regression Configuration', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_REGRESSION_CONFIG.regressionThreshold).toBe(10);
    expect(DEFAULT_REGRESSION_CONFIG.improvementThreshold).toBe(-10);
    expect(DEFAULT_REGRESSION_CONFIG.warningSeverityThreshold).toBe(25);
    expect(DEFAULT_REGRESSION_CONFIG.criticalSeverityThreshold).toBe(50);
    expect(DEFAULT_REGRESSION_CONFIG.metric).toBe('p95');
  });
});
