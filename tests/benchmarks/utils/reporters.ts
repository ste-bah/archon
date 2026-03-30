/**
 * Benchmark Result Reporters
 *
 * Implements: TASK-VDB-002
 * Referenced by: vector-db.bench.ts
 *
 * Formats and reports benchmark results in various formats.
 */

/**
 * Benchmark result structure
 */
export interface BenchmarkResult {
  name: string;
  vectorCount: number;
  iterations: number;
  stats: {
    min: number;
    max: number;
    mean: number;
    median: number;
    p50: number;
    p95: number;
    p99: number;
    stdDev: number;
  };
  opsPerSecond?: number;
  memoryUsage?: {
    heapUsed: number;
    external: number;
    bytesPerVector: number;
  };
}

/**
 * Format time in appropriate unit (µs, ms, s)
 *
 * @param ms - Time in milliseconds
 * @returns Formatted string with appropriate unit
 */
export function formatTime(ms: number): string {
  if (ms < 0.001) {
    return `${(ms * 1000000).toFixed(2)}ns`;
  } else if (ms < 1) {
    return `${(ms * 1000).toFixed(2)}µs`;
  } else if (ms < 1000) {
    return `${ms.toFixed(2)}ms`;
  } else {
    return `${(ms / 1000).toFixed(2)}s`;
  }
}

/**
 * Format bytes in appropriate unit (B, KB, MB, GB)
 *
 * @param bytes - Size in bytes
 * @returns Formatted string with appropriate unit
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes.toFixed(0)}B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)}KB`;
  } else if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  } else {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
  }
}

/**
 * Print benchmark result to console
 *
 * @param result - Benchmark result to print
 */
export function printBenchmarkResult(result: BenchmarkResult): void {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Benchmark: ${result.name}`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Vectors: ${result.vectorCount.toLocaleString()}`);
  console.log(`Iterations: ${result.iterations.toLocaleString()}`);
  console.log(`\nLatency Statistics:`);
  console.log(`  Min:    ${formatTime(result.stats.min)}`);
  console.log(`  Median: ${formatTime(result.stats.median)} (p50)`);
  console.log(`  Mean:   ${formatTime(result.stats.mean)}`);
  console.log(`  p95:    ${formatTime(result.stats.p95)}`);
  console.log(`  p99:    ${formatTime(result.stats.p99)}`);
  console.log(`  Max:    ${formatTime(result.stats.max)}`);
  console.log(`  StdDev: ${formatTime(result.stats.stdDev)}`);

  if (result.opsPerSecond !== undefined) {
    console.log(`\nThroughput: ${result.opsPerSecond.toLocaleString(undefined, { maximumFractionDigits: 0 })} ops/sec`);
  }

  if (result.memoryUsage) {
    console.log(`\nMemory Usage:`);
    console.log(`  Heap Used:       ${formatBytes(result.memoryUsage.heapUsed)}`);
    console.log(`  External:        ${formatBytes(result.memoryUsage.external)}`);
    console.log(`  Bytes/Vector:    ${formatBytes(result.memoryUsage.bytesPerVector)}`);
  }

  console.log(`${'='.repeat(80)}\n`);
}

/**
 * Generate markdown table row for benchmark result
 *
 * @param result - Benchmark result
 * @returns Markdown table row
 */
export function generateMarkdownRow(result: BenchmarkResult): string {
  const memoryMB = result.memoryUsage
    ? (result.memoryUsage.heapUsed / (1024 * 1024)).toFixed(2)
    : 'N/A';

  const opsPerSec = result.opsPerSecond
    ? result.opsPerSecond.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : 'N/A';

  return `| ${result.name} | ${result.vectorCount.toLocaleString()} | ${formatTime(result.stats.median)} | ${formatTime(result.stats.p95)} | ${formatTime(result.stats.p99)} | ${opsPerSec} | ${memoryMB} MB |`;
}

/**
 * Generate complete markdown report for multiple benchmark results
 *
 * @param results - Array of benchmark results
 * @returns Markdown report string
 */
export function generateMarkdownReport(results: BenchmarkResult[]): string {
  const timestamp = new Date().toISOString();

  let markdown = `# VectorDB Benchmark Results\n\n`;
  markdown += `Generated: ${timestamp}\n\n`;
  markdown += `## Summary\n\n`;
  markdown += `| Benchmark | Vectors | Median | p95 | p99 | Ops/sec | Memory |\n`;
  markdown += `|-----------|---------|--------|-----|-----|---------|--------|\n`;

  for (const result of results) {
    markdown += generateMarkdownRow(result) + '\n';
  }

  markdown += `\n## Performance Targets (from PRD)\n\n`;
  markdown += `| Vectors | Search (k=10) Target | Construction Target | Index Size Target |\n`;
  markdown += `|---------|---------------------|---------------------|-------------------|\n`;
  markdown += `| 1k      | 0.2ms               | 0.8s                | 3 MB              |\n`;
  markdown += `| 10k     | 0.3ms (native)      | 12s                 | 30 MB             |\n`;
  markdown += `| 10k     | <1ms (median)       | 12s                 | 30 MB             |\n`;
  markdown += `| 100k    | 1.2ms               | 3.2min              | 300 MB            |\n`;

  markdown += `\n## Notes\n\n`;
  markdown += `- All latencies shown are for k=10 nearest neighbor search\n`;
  markdown += `- Native backend targets are more aggressive than fallback\n`;
  markdown += `- Insert target: <50µs per operation\n`;
  markdown += `- Search target: median <1ms, p99 <3ms for 10k vectors\n`;

  return markdown;
}
