/**
 * Statistical Utilities for Benchmark Analysis
 *
 * Implements: TASK-VDB-002
 * Referenced by: vector-db.bench.ts
 *
 * Provides statistical functions for analyzing benchmark results.
 */

/**
 * Calculate percentile from sorted or unsorted array
 *
 * @param values - Array of numbers
 * @param p - Percentile (0-100)
 * @returns Percentile value
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    throw new Error('Cannot calculate percentile of empty array');
  }

  // Sort array
  const sorted = [...values].sort((a, b) => a - b);

  // Calculate index using linear interpolation
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (lower === upper) {
    return sorted[lower];
  }

  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Calculate median (50th percentile)
 *
 * @param values - Array of numbers
 * @returns Median value
 */
export function median(values: number[]): number {
  return percentile(values, 50);
}

/**
 * Calculate mean (average)
 *
 * @param values - Array of numbers
 * @returns Mean value
 */
export function mean(values: number[]): number {
  if (values.length === 0) {
    throw new Error('Cannot calculate mean of empty array');
  }

  return sum(values) / values.length;
}

/**
 * Calculate sum of all values
 *
 * @param values - Array of numbers
 * @returns Sum
 */
export function sum(values: number[]): number {
  return values.reduce((acc, val) => acc + val, 0);
}

/**
 * Calculate standard deviation
 *
 * @param values - Array of numbers
 * @returns Standard deviation
 */
export function standardDeviation(values: number[]): number {
  if (values.length === 0) {
    throw new Error('Cannot calculate standard deviation of empty array');
  }

  const avg = mean(values);
  const squaredDiffs = values.map(value => Math.pow(value - avg, 2));
  const variance = mean(squaredDiffs);

  return Math.sqrt(variance);
}

/**
 * Calculate min value
 *
 * @param values - Array of numbers
 * @returns Minimum value
 */
export function min(values: number[]): number {
  if (values.length === 0) {
    throw new Error('Cannot find min of empty array');
  }

  return Math.min(...values);
}

/**
 * Calculate max value
 *
 * @param values - Array of numbers
 * @returns Maximum value
 */
export function max(values: number[]): number {
  if (values.length === 0) {
    throw new Error('Cannot find max of empty array');
  }

  return Math.max(...values);
}

/**
 * Calculate comprehensive statistics for an array of values
 *
 * @param values - Array of numbers
 * @returns Object with min, max, mean, median, p50, p95, p99, stddev
 */
export function calculateStats(values: number[]): {
  min: number;
  max: number;
  mean: number;
  median: number;
  p50: number;
  p95: number;
  p99: number;
  stdDev: number;
} {
  return {
    min: min(values),
    max: max(values),
    mean: mean(values),
    median: median(values),
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    stdDev: standardDeviation(values)
  };
}
