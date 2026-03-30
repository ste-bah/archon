/**
 * Benchmark Reporter
 * TASK-NFR-001 - Performance Benchmark Suite
 *
 * Generates benchmark reports in multiple formats:
 * - JSON: Machine-readable output
 * - Markdown: Human-readable documentation
 * - Prometheus: Metrics export format
 * - JUnit XML: CI/CD integration
 */

import type { BenchmarkSuiteResult } from './runner.js';

// ==================== Reporter Interface ====================

/**
 * Report output format
 */
export type ReportFormat = 'json' | 'markdown' | 'prometheus' | 'junit';

/**
 * Report options
 */
export interface ReportOptions {
  /** Include raw timings data */
  includeRawTimings?: boolean;
  /** Include detailed statistics */
  includeDetailedStats?: boolean;
  /** Title for the report */
  title?: string;
}

// ==================== Benchmark Reporter ====================

/**
 * Multi-format benchmark report generator
 */
export class BenchmarkReporter {
  /**
   * Generate report in specified format
   */
  generate(
    result: BenchmarkSuiteResult,
    format: ReportFormat,
    options: ReportOptions = {}
  ): string {
    switch (format) {
      case 'json':
        return this.toJSON(result, options);
      case 'markdown':
        return this.toMarkdown(result, options);
      case 'prometheus':
        return this.toPrometheus(result);
      case 'junit':
        return this.toJUnit(result);
      default:
        throw new Error(`Unknown report format: ${format}`);
    }
  }

  /**
   * Generate JSON report
   */
  toJSON(result: BenchmarkSuiteResult, options: ReportOptions = {}): string {
    const output = {
      name: result.name,
      timestamp: new Date(result.timestamp).toISOString(),
      summary: result.summary,
      results: result.results.map(r => ({
        name: r.name,
        iterations: r.iterations,
        totalTimeMs: r.totalTimeMs,
        statistics: r.statistics,
        sloTarget: r.sloTarget,
        sloMetric: r.sloMetric,
        sloPass: r.sloPass,
        ...(options.includeRawTimings ? { timings: r.timings } : {}),
      })),
    };

    return JSON.stringify(output, null, 2);
  }

  /**
   * Generate Markdown report
   */
  toMarkdown(result: BenchmarkSuiteResult, options: ReportOptions = {}): string {
    const title = options.title || `Benchmark Report: ${result.name}`;
    let md = `# ${title}\n\n`;
    md += `**Timestamp:** ${new Date(result.timestamp).toISOString()}\n`;
    md += `**Overall Status:** ${result.summary.allPass ? '✓ PASS' : '✗ FAIL'}\n`;
    md += `**Results:** ${result.summary.passed}/${result.summary.total} passed\n\n`;

    // SLO Validation Matrix
    md += `## SLO Validation Matrix\n\n`;
    md += `| Benchmark | Target | Actual | Metric | Status |\n`;
    md += `|-----------|--------|--------|--------|--------|\n`;

    for (const r of result.results) {
      const status = r.sloPass ? '✓ PASS' : '✗ FAIL';
      const metric = r.sloMetric || 'p95';
      const actual = r.statistics[metric as keyof typeof r.statistics] as number;
      md += `| ${r.name} | <${r.sloTarget}ms | ${actual.toFixed(4)}ms | ${metric} | ${status} |\n`;
    }

    // Detailed Statistics
    if (options.includeDetailedStats !== false) {
      md += `\n## Detailed Statistics\n\n`;

      for (const r of result.results) {
        md += `### ${r.name}\n\n`;
        md += `- **Iterations:** ${r.iterations}\n`;
        md += `- **Total Time:** ${r.totalTimeMs.toFixed(2)}ms\n`;
        md += `- **Mean:** ${r.statistics.mean.toFixed(4)}ms\n`;
        md += `- **Median:** ${r.statistics.median.toFixed(4)}ms\n`;
        md += `- **p50:** ${r.statistics.p50.toFixed(4)}ms\n`;
        md += `- **p90:** ${r.statistics.p90.toFixed(4)}ms\n`;
        md += `- **p95:** ${r.statistics.p95.toFixed(4)}ms\n`;
        md += `- **p99:** ${r.statistics.p99.toFixed(4)}ms\n`;
        md += `- **Min:** ${r.statistics.min.toFixed(4)}ms\n`;
        md += `- **Max:** ${r.statistics.max.toFixed(4)}ms\n`;
        md += `- **Std Dev:** ${r.statistics.stdDev.toFixed(4)}ms\n\n`;
      }
    }

    return md;
  }

  /**
   * Generate Prometheus metrics format
   */
  toPrometheus(result: BenchmarkSuiteResult): string {
    let prom = `# Benchmark results for ${result.name}\n`;
    prom += `# Generated at ${new Date(result.timestamp).toISOString()}\n\n`;

    for (const r of result.results) {
      const name = r.name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();

      // p95 metric
      prom += `# HELP benchmark_${name}_p95_ms P95 latency in milliseconds\n`;
      prom += `# TYPE benchmark_${name}_p95_ms gauge\n`;
      prom += `benchmark_${name}_p95_ms ${r.statistics.p95}\n\n`;

      // Mean metric
      prom += `# HELP benchmark_${name}_mean_ms Mean latency in milliseconds\n`;
      prom += `# TYPE benchmark_${name}_mean_ms gauge\n`;
      prom += `benchmark_${name}_mean_ms ${r.statistics.mean}\n\n`;

      // SLO pass metric
      prom += `# HELP benchmark_${name}_slo_pass Whether SLO was met (1=pass, 0=fail)\n`;
      prom += `# TYPE benchmark_${name}_slo_pass gauge\n`;
      prom += `benchmark_${name}_slo_pass ${r.sloPass ? 1 : 0}\n\n`;
    }

    // Summary metrics
    prom += `# HELP benchmark_suite_passed Total benchmarks passed\n`;
    prom += `# TYPE benchmark_suite_passed gauge\n`;
    prom += `benchmark_suite_passed ${result.summary.passed}\n\n`;

    prom += `# HELP benchmark_suite_total Total benchmarks run\n`;
    prom += `# TYPE benchmark_suite_total gauge\n`;
    prom += `benchmark_suite_total ${result.summary.total}\n`;

    return prom;
  }

  /**
   * Generate JUnit XML format for CI/CD
   */
  toJUnit(result: BenchmarkSuiteResult): string {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<testsuites name="${escapeXml(result.name)}" `;
    xml += `tests="${result.summary.total}" `;
    xml += `failures="${result.summary.failed}" `;
    xml += `timestamp="${new Date(result.timestamp).toISOString()}">\n`;

    xml += `  <testsuite name="Performance Benchmarks" `;
    xml += `tests="${result.summary.total}" `;
    xml += `failures="${result.summary.failed}">\n`;

    for (const r of result.results) {
      const metric = r.sloMetric || 'p95';
      const actual = r.statistics[metric as keyof typeof r.statistics] as number;
      const timeSeconds = r.totalTimeMs / 1000;

      xml += `    <testcase name="${escapeXml(r.name)}" time="${timeSeconds.toFixed(3)}">\n`;

      if (!r.sloPass) {
        xml += `      <failure message="SLO violation: ${actual.toFixed(4)}ms > ${r.sloTarget}ms target (${metric})"/>\n`;
      }

      xml += `    </testcase>\n`;
    }

    xml += `  </testsuite>\n`;
    xml += `</testsuites>\n`;

    return xml;
  }
}

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ==================== Global Reporter Instance ====================

/**
 * Global benchmark reporter instance
 */
export const benchmarkReporter = new BenchmarkReporter();
