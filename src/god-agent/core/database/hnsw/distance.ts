/**
 * HNSW Distance Functions
 *
 * Implements: TASK-PERF-001 (Native HNSW backend)
 * Referenced by: HNSWIndex
 *
 * Optimized distance/similarity functions for HNSW search.
 * Note: For HNSW, we use distance (lower = more similar) not similarity.
 */

import { DistanceFunction } from './hnsw-types.js';

/**
 * Cosine distance between two vectors
 * For normalized vectors: distance = 1 - dot_product
 *
 * @param a - First vector (should be L2-normalized)
 * @param b - Second vector (should be L2-normalized)
 * @returns Distance in range [0, 2], where 0 = identical
 */
export function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dotProduct = 0;
  const len = a.length;

  // Unroll loop for better performance
  let i = 0;
  for (; i + 3 < len; i += 4) {
    dotProduct += a[i] * b[i];
    dotProduct += a[i + 1] * b[i + 1];
    dotProduct += a[i + 2] * b[i + 2];
    dotProduct += a[i + 3] * b[i + 3];
  }
  // Handle remaining elements
  for (; i < len; i++) {
    dotProduct += a[i] * b[i];
  }

  // For normalized vectors, cosine distance = 1 - cosine_similarity
  // Clamp to [0, 2] to handle floating point errors
  return Math.max(0, Math.min(2, 1 - dotProduct));
}

/**
 * Euclidean distance (L2 distance) between two vectors
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Distance >= 0, where 0 = identical
 */
export function euclideanDistance(a: Float32Array, b: Float32Array): number {
  let sumOfSquares = 0;
  const len = a.length;

  // Unroll loop for better performance
  let i = 0;
  for (; i + 3 < len; i += 4) {
    const d0 = a[i] - b[i];
    const d1 = a[i + 1] - b[i + 1];
    const d2 = a[i + 2] - b[i + 2];
    const d3 = a[i + 3] - b[i + 3];
    sumOfSquares += d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3;
  }
  // Handle remaining elements
  for (; i < len; i++) {
    const diff = a[i] - b[i];
    sumOfSquares += diff * diff;
  }

  return Math.sqrt(sumOfSquares);
}

/**
 * Negative dot product distance (for maximizing dot product)
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Negative dot product (lower = higher similarity)
 */
export function dotProductDistance(a: Float32Array, b: Float32Array): number {
  let dotProduct = 0;
  const len = a.length;

  // Unroll loop for better performance
  let i = 0;
  for (; i + 3 < len; i += 4) {
    dotProduct += a[i] * b[i];
    dotProduct += a[i + 1] * b[i + 1];
    dotProduct += a[i + 2] * b[i + 2];
    dotProduct += a[i + 3] * b[i + 3];
  }
  // Handle remaining elements
  for (; i < len; i++) {
    dotProduct += a[i] * b[i];
  }

  // Return negative dot product so lower = more similar
  return -dotProduct;
}

/**
 * Squared Euclidean distance (faster, avoids sqrt)
 * Use when only relative ordering matters
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Squared distance >= 0
 */
export function squaredEuclideanDistance(a: Float32Array, b: Float32Array): number {
  let sumOfSquares = 0;
  const len = a.length;

  let i = 0;
  for (; i + 3 < len; i += 4) {
    const d0 = a[i] - b[i];
    const d1 = a[i + 1] - b[i + 1];
    const d2 = a[i + 2] - b[i + 2];
    const d3 = a[i + 3] - b[i + 3];
    sumOfSquares += d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3;
  }
  for (; i < len; i++) {
    const diff = a[i] - b[i];
    sumOfSquares += diff * diff;
  }

  return sumOfSquares;
}

/**
 * Get distance function for a given metric type
 *
 * @param metric - The metric type
 * @returns Distance function
 */
export function getDistanceFunction(metric: 'cosine' | 'euclidean' | 'dot'): DistanceFunction {
  switch (metric) {
    case 'cosine':
      return cosineDistance;
    case 'euclidean':
      return euclideanDistance;
    case 'dot':
      return dotProductDistance;
    default:
      throw new Error(`Unknown distance metric: ${metric}`);
  }
}

/**
 * Convert distance back to similarity for output
 * HNSW uses distance internally, but API returns similarity
 *
 * @param distance - Distance value
 * @param metric - The metric type used
 * @returns Similarity value (higher = more similar)
 */
export function distanceToSimilarity(distance: number, metric: 'cosine' | 'euclidean' | 'dot'): number {
  switch (metric) {
    case 'cosine':
      // cosine distance = 1 - similarity, so similarity = 1 - distance
      return 1 - distance;
    case 'euclidean':
      // Convert euclidean distance to similarity using exponential decay
      // similarity = 1 / (1 + distance) is common
      return 1 / (1 + distance);
    case 'dot':
      // dot distance = -dot_product, so similarity = -distance
      return -distance;
    default:
      return 1 - distance;
  }
}
