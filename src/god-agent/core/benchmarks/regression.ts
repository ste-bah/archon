/**
 * Regression Detector
 * TASK-NFR-001 - Performance Benchmark Suite
 *
 * Provides regression detection capabilities:
 * - Baseline storage and loading
 * - Threshold-based regression detection
 * - Severity classification
 * - Trend analysis
 */

import type { BenchmarkSuiteResult, BenchmarkStatistics } from './runner.js';

// ==================== Types ====================

/**
 * Severity levels for regressions
 */
export type RegressionSeverity = 'info' | 'warning' | 'critical';

/**
 * Single regression detection result
 */
export interface Regression {
  /** Benchmark name */
  benchmark: string;
  /** Baseline value in ms */
  baseline: number;
  /** Current value in ms */
  current: number;
  /** Percentage change */
  changePercent: number;
  /** Severity classification */
  severity: RegressionSeverity;
  /** Metric used for comparison */
  metric: keyof BenchmarkStatistics;
}

/**
 * Improvement detection (negative change)
 */
export interface Improvement {
  /** Benchmark name */
  benchmark: string;
  /** Baseline value in ms */
  baseline: number;
  /** Current value in ms */
  current: number;
  /** Percentage change (negative = improvement) */
  changePercent: number;
  /** Metric used for comparison */
  metric: keyof BenchmarkStatistics;
}

/**
 * Complete regression report
 */
export interface RegressionReport {
  /** Whether a baseline was available */
  hasBaseline: boolean;
  /** Detected regressions */
  regressions: Regression[];
  /** Detected improvements */
  improvements: Improvement[];
  /** Summary counts */
  summary: {
    total: number;
    regressions: number;
    improvements: number;
    unchanged: number;
  };
  /** Overall status */
  status: 'pass' | 'warning' | 'fail';
  /** Baseline timestamp if available */
  baselineTimestamp?: number;
  /** Current timestamp */
  currentTimestamp: number;
}

/**
 * Regression detection configuration
 */
export interface RegressionConfig {
  /** Percentage threshold for regression detection (default: 10) */
  regressionThreshold: number;
  /** Percentage threshold for improvement detection (default: -10) */
  improvementThreshold: number;
  /** Percentage threshold for warning severity (default: 25) */
  warningSeverityThreshold: number;
  /** Percentage threshold for critical severity (default: 50) */
  criticalSeverityThreshold: number;
  /** Metric to compare (default: 'p95') */
  metric: keyof BenchmarkStatistics;
}

/**
 * Default regression configuration
 */
export const DEFAULT_REGRESSION_CONFIG: RegressionConfig = {
  regressionThreshold: 10,
  improvementThreshold: -10,
  warningSeverityThreshold: 25,
  criticalSeverityThreshold: 50,
  metric: 'p95',
};

// ==================== Baseline Storage ====================

/**
 * In-memory baseline storage interface
 */
export interface BaselineStorage {
  /** Save baseline */
  save(baseline: BenchmarkSuiteResult): void;
  /** Load baseline */
  load(): BenchmarkSuiteResult | null;
  /** Check if baseline exists */
  exists(): boolean;
  /** Clear baseline */
  clear(): void;
}

/**
 * In-memory baseline storage implementation
 */
export class MemoryBaselineStorage implements BaselineStorage {
  private baseline: BenchmarkSuiteResult | null = null;

  save(baseline: BenchmarkSuiteResult): void {
    this.baseline = { ...baseline };
  }

  load(): BenchmarkSuiteResult | null {
    return this.baseline;
  }

  exists(): boolean {
    return this.baseline !== null;
  }

  clear(): void {
    this.baseline = null;
  }
}

/**
 * JSON-serializable baseline storage
 * (For use with file storage in integration)
 */
export class JsonBaselineStorage implements BaselineStorage {
  private data: string | null = null;

  save(baseline: BenchmarkSuiteResult): void {
    this.data = JSON.stringify(baseline);
  }

  load(): BenchmarkSuiteResult | null {
    if (!this.data) return null;
    try {
      return JSON.parse(this.data);
    } catch {
      // INTENTIONAL: JSON parse failure - return null to indicate invalid baseline data
      return null;
    }
  }

  exists(): boolean {
    return this.data !== null;
  }

  clear(): void {
    this.data = null;
  }

  /** Export baseline as JSON string */
  export(): string | null {
    return this.data;
  }

  /** Import baseline from JSON string */
  import(json: string): boolean {
    try {
      JSON.parse(json); // Validate JSON
      this.data = json;
      return true;
    } catch {
      // INTENTIONAL: JSON validation failure - return false to reject invalid import
      return false;
    }
  }
}

// ==================== Regression Detector ====================

/**
 * Regression detector for performance trends
 *
 * Compares benchmark results against a stored baseline and
 * detects performance regressions based on configurable thresholds.
 *
 * @example
 * ```typescript
 * const detector = new RegressionDetector();
 *
 * // Save baseline
 * detector.saveBaseline(baselineResults);
 *
 * // Detect regressions
 * const report = detector.detectRegressions(currentResults);
 *
 * if (report.status === 'fail') {
 *   console.log('Performance regressions detected!');
 *   for (const r of report.regressions) {
 *     console.log(`${r.benchmark}: ${r.changePercent.toFixed(1)}% slower`);
 *   }
 * }
 * ```
 */
export class RegressionDetector {
  private storage: BaselineStorage;
  private config: RegressionConfig;

  constructor(
    storage: BaselineStorage = new MemoryBaselineStorage(),
    config: Partial<RegressionConfig> = {}
  ) {
    this.storage = storage;
    this.config = { ...DEFAULT_REGRESSION_CONFIG, ...config };
  }

  /**
   * Save current results as the new baseline
   */
  saveBaseline(results: BenchmarkSuiteResult): void {
    this.storage.save(results);
  }

  /**
   * Load the stored baseline
   */
  loadBaseline(): BenchmarkSuiteResult | null {
    return this.storage.load();
  }

  /**
   * Check if a baseline exists
   */
  hasBaseline(): boolean {
    return this.storage.exists();
  }

  /**
   * Clear the stored baseline
   */
  clearBaseline(): void {
    this.storage.clear();
  }

  /**
   * Detect regressions between current results and baseline
   *
   * @param current - Current benchmark results
   * @param config - Optional configuration overrides
   * @returns Regression report
   */
  detectRegressions(
    current: BenchmarkSuiteResult,
    config: Partial<RegressionConfig> = {}
  ): RegressionReport {
    const cfg = { ...this.config, ...config };
    const baseline = this.storage.load();

    if (!baseline) {
      return {
        hasBaseline: false,
        regressions: [],
        improvements: [],
        summary: {
          total: current.results.length,
          regressions: 0,
          improvements: 0,
          unchanged: current.results.length,
        },
        status: 'pass',
        currentTimestamp: current.timestamp,
      };
    }

    const regressions: Regression[] = [];
    const improvements: Improvement[] = [];
    let unchanged = 0;

    for (const currentResult of current.results) {
      const baselineResult = baseline.results.find(r => r.name === currentResult.name);
      if (!baselineResult) {
        unchanged++;
        continue;
      }

      const baselineValue = baselineResult.statistics[cfg.metric] as number;
      const currentValue = currentResult.statistics[cfg.metric] as number;

      // Calculate percentage change (positive = slower/regression)
      const changePercent = ((currentValue - baselineValue) / baselineValue) * 100;

      if (changePercent > cfg.regressionThreshold) {
        // Regression detected
        regressions.push({
          benchmark: currentResult.name,
          baseline: baselineValue,
          current: currentValue,
          changePercent,
          severity: this.classifySeverity(changePercent, cfg),
          metric: cfg.metric,
        });
      } else if (changePercent < cfg.improvementThreshold) {
        // Improvement detected
        improvements.push({
          benchmark: currentResult.name,
          baseline: baselineValue,
          current: currentValue,
          changePercent,
          metric: cfg.metric,
        });
      } else {
        unchanged++;
      }
    }

    // Determine overall status
    let status: 'pass' | 'warning' | 'fail' = 'pass';
    if (regressions.some(r => r.severity === 'critical')) {
      status = 'fail';
    } else if (regressions.some(r => r.severity === 'warning')) {
      status = 'warning';
    } else if (regressions.length > 0) {
      status = 'warning';
    }

    return {
      hasBaseline: true,
      regressions,
      improvements,
      summary: {
        total: current.results.length,
        regressions: regressions.length,
        improvements: improvements.length,
        unchanged,
      },
      status,
      baselineTimestamp: baseline.timestamp,
      currentTimestamp: current.timestamp,
    };
  }

  /**
   * Compare two benchmark results directly without baseline storage
   *
   * @param baseline - Baseline results
   * @param current - Current results to compare
   * @param config - Optional configuration overrides
   * @returns Regression report
   */
  compare(
    baseline: BenchmarkSuiteResult,
    current: BenchmarkSuiteResult,
    config: Partial<RegressionConfig> = {}
  ): RegressionReport {
    // Temporarily save baseline, detect, then restore
    const previousBaseline = this.storage.load();
    this.storage.save(baseline);
    const report = this.detectRegressions(current, config);
    if (previousBaseline) {
      this.storage.save(previousBaseline);
    } else {
      this.storage.clear();
    }
    return report;
  }

  /**
   * Get trend analysis for a specific benchmark across multiple runs
   *
   * @param benchmarkName - Name of benchmark to analyze
   * @param history - Array of past results (oldest first)
   * @returns Trend analysis
   */
  analyzeTrend(
    benchmarkName: string,
    history: BenchmarkSuiteResult[]
  ): TrendAnalysis {
    const values: number[] = [];
    const timestamps: number[] = [];

    for (const run of history) {
      const result = run.results.find(r => r.name === benchmarkName);
      if (result) {
        values.push(result.statistics[this.config.metric] as number);
        timestamps.push(run.timestamp);
      }
    }

    if (values.length < 2) {
      return {
        benchmark: benchmarkName,
        dataPoints: values.length,
        trend: 'stable',
        slope: 0,
        values,
        timestamps,
      };
    }

    // Simple linear regression for trend
    const n = values.length;
    const sumX = timestamps.reduce((a, b, i) => a + i, 0);
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = timestamps.reduce((acc, _, i) => acc + i * values[i], 0);
    const sumXX = timestamps.reduce((acc, _, i) => acc + i * i, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

    // Determine trend direction
    let trend: 'improving' | 'degrading' | 'stable';
    const threshold = 0.001; // Minimal change threshold
    if (slope > threshold) {
      trend = 'degrading';
    } else if (slope < -threshold) {
      trend = 'improving';
    } else {
      trend = 'stable';
    }

    return {
      benchmark: benchmarkName,
      dataPoints: n,
      trend,
      slope,
      values,
      timestamps,
    };
  }

  /**
   * Classify regression severity
   */
  private classifySeverity(changePercent: number, config: RegressionConfig): RegressionSeverity {
    if (changePercent >= config.criticalSeverityThreshold) {
      return 'critical';
    } else if (changePercent >= config.warningSeverityThreshold) {
      return 'warning';
    }
    return 'info';
  }

  /**
   * Get current configuration
   */
  getConfig(): RegressionConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<RegressionConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Trend analysis result
 */
export interface TrendAnalysis {
  /** Benchmark name */
  benchmark: string;
  /** Number of data points */
  dataPoints: number;
  /** Trend direction */
  trend: 'improving' | 'degrading' | 'stable';
  /** Linear regression slope */
  slope: number;
  /** Historical values */
  values: number[];
  /** Historical timestamps */
  timestamps: number[];
}

// ==================== Utility Functions ====================

/**
 * Format regression report as Markdown
 */
export function formatRegressionReportMarkdown(report: RegressionReport): string {
  let md = `# Performance Regression Report\n\n`;
  md += `**Status:** ${report.status.toUpperCase()}\n`;
  md += `**Baseline Available:** ${report.hasBaseline ? 'Yes' : 'No'}\n\n`;

  if (!report.hasBaseline) {
    md += `> No baseline available for comparison. Save a baseline first.\n`;
    return md;
  }

  // Summary
  md += `## Summary\n\n`;
  md += `- Total benchmarks: ${report.summary.total}\n`;
  md += `- Regressions: ${report.summary.regressions}\n`;
  md += `- Improvements: ${report.summary.improvements}\n`;
  md += `- Unchanged: ${report.summary.unchanged}\n\n`;

  // Regressions
  if (report.regressions.length > 0) {
    md += `## Regressions\n\n`;
    md += `| Benchmark | Baseline | Current | Change | Severity |\n`;
    md += `|-----------|----------|---------|--------|----------|\n`;

    for (const r of report.regressions) {
      const icon = r.severity === 'critical' ? '🔴' : r.severity === 'warning' ? '🟡' : '🟢';
      md += `| ${r.benchmark} | ${r.baseline.toFixed(4)}ms | ${r.current.toFixed(4)}ms | +${r.changePercent.toFixed(1)}% | ${icon} ${r.severity} |\n`;
    }
    md += '\n';
  }

  // Improvements
  if (report.improvements.length > 0) {
    md += `## Improvements\n\n`;
    md += `| Benchmark | Baseline | Current | Change |\n`;
    md += `|-----------|----------|---------|--------|\n`;

    for (const i of report.improvements) {
      md += `| ${i.benchmark} | ${i.baseline.toFixed(4)}ms | ${i.current.toFixed(4)}ms | ${i.changePercent.toFixed(1)}% |\n`;
    }
    md += '\n';
  }

  return md;
}

// ==================== Global Instance ====================

/**
 * Global regression detector instance
 */
export const regressionDetector = new RegressionDetector();
