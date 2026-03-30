/**
 * Benchmarks Module
 * TASK-NFR-001 - Performance Benchmark Suite
 *
 * Provides performance benchmarking infrastructure:
 * - Standardized benchmark runner
 * - Statistical analysis
 * - Multi-format reporting
 * - SLO validation
 */

// ===== RUNNER =====

export {
  // Types
  type BenchmarkConfig,
  DEFAULT_BENCHMARK_CONFIG,
  type BenchmarkStatistics,
  type BenchmarkResult,
  type BenchmarkSuiteResult,
  type BenchmarkDefinition,
  // Statistical functions
  percentile,
  mean,
  variance,
  stdDev,
  calculateStatistics,
  // Classes
  BenchmarkRunner,
  BenchmarkSuite,
  // Global instance
  benchmarkRunner,
} from './runner.js';

// ===== REPORTER =====

export {
  // Types
  type ReportFormat,
  type ReportOptions,
  // Classes
  BenchmarkReporter,
  // Global instance
  benchmarkReporter,
} from './reporter.js';

// ===== REGRESSION =====

export {
  // Types
  type RegressionSeverity,
  type Regression,
  type Improvement,
  type RegressionReport,
  type RegressionConfig,
  DEFAULT_REGRESSION_CONFIG,
  type TrendAnalysis,
  // Storage interfaces
  type BaselineStorage,
  MemoryBaselineStorage,
  JsonBaselineStorage,
  // Classes
  RegressionDetector,
  // Utilities
  formatRegressionReportMarkdown,
  // Global instance
  regressionDetector,
} from './regression.js';
