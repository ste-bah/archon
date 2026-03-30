/**
 * God Agent Vector Distance Metrics
 *
 * Implements: TASK-VDB-001
 * Referenced by: VectorDB search operations
 *
 * All metrics assume vectors are already validated (VECTOR_DIM (1536D), L2-normalized, finite)
 */

import { GraphDimensionMismatchError } from '../validation/index.js';
import { DistanceMetric } from './types.js';

/**
 * Calculate cosine similarity between two vectors
 * For L2-normalized vectors, this is simply the dot product
 *
 * @param a - First vector (must be L2-normalized)
 * @param b - Second vector (must be L2-normalized)
 * @returns Similarity in range [-1, 1], where 1 = identical, -1 = opposite
 * @throws GraphDimensionMismatchError if dimensions don't match
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new GraphDimensionMismatchError(a.length, b.length, 'cosineSimilarity');
  }

  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
  }
  return dotProduct;
}

/**
 * Calculate Euclidean distance (L2 distance) between two vectors
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Distance (0 = identical, larger = more different)
 * @throws GraphDimensionMismatchError if dimensions don't match
 */
export function euclideanDistance(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new GraphDimensionMismatchError(a.length, b.length, 'euclideanDistance');
  }

  let sumOfSquares = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sumOfSquares += diff * diff;
  }
  return Math.sqrt(sumOfSquares);
}

/**
 * Calculate dot product between two vectors
 * Similar to cosine similarity but without normalization assumption
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Dot product value
 * @throws GraphDimensionMismatchError if dimensions don't match
 */
export function dotProduct(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new GraphDimensionMismatchError(a.length, b.length, 'dotProduct');
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result += a[i] * b[i];
  }
  return result;
}

/**
 * Calculate Manhattan distance (L1 distance) between two vectors
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Distance (0 = identical, larger = more different)
 * @throws GraphDimensionMismatchError if dimensions don't match
 */
export function manhattanDistance(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new GraphDimensionMismatchError(a.length, b.length, 'manhattanDistance');
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs(a[i] - b[i]);
  }
  return sum;
}

/**
 * Get the appropriate distance/similarity function for a metric
 *
 * @param metric - The distance metric to use
 * @returns Function that calculates the metric
 */
export function getMetricFunction(
  metric: DistanceMetric
): (a: Float32Array, b: Float32Array) => number {
  switch (metric) {
    case DistanceMetric.COSINE:
      return cosineSimilarity;
    case DistanceMetric.EUCLIDEAN:
      return euclideanDistance;
    case DistanceMetric.DOT:
      return dotProduct;
    case DistanceMetric.MANHATTAN:
      return manhattanDistance;
    default:
      throw new Error(`Unknown distance metric: ${metric}`);
  }
}

/**
 * Check if a metric is a similarity metric (higher = better)
 * vs distance metric (lower = better)
 *
 * @param metric - The metric to check
 * @returns true if similarity metric, false if distance metric
 */
export function isSimilarityMetric(metric: DistanceMetric): boolean {
  return metric === DistanceMetric.COSINE || metric === DistanceMetric.DOT;
}
