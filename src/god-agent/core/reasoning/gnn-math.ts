/**
 * GNN Math Utilities - Extracted from GNNEnhancer
 *
 * Provides vector operations for GNN-enhanced embeddings.
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-GNN-001
 *
 * @module src/god-agent/core/reasoning/gnn-math
 */

import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../observability/index.js';

const logger = createComponentLogger('GNNMath', {
  minLevel: LogLevel.WARN,
  handlers: [new ConsoleLogHandler()]
});

/**
 * Activation function types
 */
export type ActivationType = 'relu' | 'tanh' | 'sigmoid' | 'leaky_relu';

/**
 * Add two vectors element-wise
 */
export function addVectors(
  a: Float32Array,
  b: Float32Array
): Float32Array {
  const maxLen = Math.max(a.length, b.length);
  const result = new Float32Array(maxLen);

  for (let i = 0; i < maxLen; i++) {
    const aVal = i < a.length ? a[i] : 0;
    const bVal = i < b.length ? b[i] : 0;
    result[i] = aVal + bVal;
  }

  return result;
}

/**
 * Zero-pad vector to target dimension
 */
export function zeroPad(
  embedding: Float32Array,
  targetDim: number
): Float32Array {
  if (embedding.length >= targetDim) {
    return embedding.slice(0, targetDim);
  }
  const padded = new Float32Array(targetDim);
  padded.set(embedding);
  return padded;
}

/**
 * Normalize vector to unit length
 */
export function normalize(embedding: Float32Array): Float32Array {
  let magnitude = 0;
  for (let i = 0; i < embedding.length; i++) {
    magnitude += embedding[i] * embedding[i];
  }
  magnitude = Math.sqrt(magnitude);

  if (magnitude === 0) {
    return embedding;
  }

  const normalized = new Float32Array(embedding.length);
  for (let i = 0; i < embedding.length; i++) {
    normalized[i] = embedding[i] / magnitude;
  }
  return normalized;
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(
  a: Float32Array,
  b: Float32Array
): number {
  const minLen = Math.min(a.length, b.length);
  let dotProduct = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < minLen; i++) {
    dotProduct += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);

  if (magA === 0 || magB === 0) {
    return 0;
  }

  return dotProduct / (magA * magB);
}

/**
 * Apply activation function to vector
 */
export function applyActivation(
  embedding: Float32Array,
  activation: ActivationType
): Float32Array {
  const result = new Float32Array(embedding.length);

  for (let i = 0; i < embedding.length; i++) {
    const x = embedding[i];
    switch (activation) {
      case 'relu':
        result[i] = Math.max(0, x);
        break;
      case 'tanh':
        result[i] = Math.tanh(x);
        break;
      case 'sigmoid':
        result[i] = 1 / (1 + Math.exp(-x));
        break;
      case 'leaky_relu':
        result[i] = x > 0 ? x : 0.01 * x;
        break;
      default:
        result[i] = x;
    }
  }

  return result;
}

/**
 * Simple projection for dimension reduction/expansion
 *
 * @deprecated Use project() with weight matrix instead.
 * VIOLATES: ULTIMATE_RULE (fake neural computation - index cycling, not learned weights)
 * See: TASK-GNN-001 for migration guide
 */
export function simpleProjection(
  embedding: Float32Array,
  targetDim: number
): Float32Array {
  logger.warn('DEPRECATION: simpleProjection() performs index cycling, not neural computation. Use project() with WeightManager for learned projections. See TASK-GNN-001.');
  if (embedding.length === targetDim) {
    return new Float32Array(embedding);
  }

  const result = new Float32Array(targetDim);

  if (embedding.length < targetDim) {
    // Expand by cycling
    for (let i = 0; i < targetDim; i++) {
      result[i] = embedding[i % embedding.length];
    }
  } else {
    // Reduce by averaging
    const ratio = embedding.length / targetDim;
    for (let i = 0; i < targetDim; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.floor((i + 1) * ratio);
      let sum = 0;
      for (let j = start; j < end; j++) {
        sum += embedding[j];
      }
      result[i] = sum / (end - start);
    }
  }

  return result;
}

/**
 * Learned projection with weight matrix
 */
export function project(
  embedding: Float32Array,
  weights: Float32Array[],
  outputDim: number
): Float32Array {
  const result = new Float32Array(outputDim);

  for (let o = 0; o < outputDim; o++) {
    let sum = 0;
    const w = weights[o] || new Float32Array(embedding.length);
    for (let i = 0; i < embedding.length && i < w.length; i++) {
      sum += embedding[i] * w[i];
    }
    result[o] = sum;
  }

  return result;
}

/**
 * Matrix-vector multiplication
 */
export function matVecMul(
  matrix: Float32Array[],
  vector: Float32Array
): Float32Array {
  const rows = matrix.length;
  const result = new Float32Array(rows);

  for (let i = 0; i < rows; i++) {
    let sum = 0;
    const row = matrix[i];
    for (let j = 0; j < vector.length && j < row.length; j++) {
      sum += row[j] * vector[j];
    }
    result[i] = sum;
  }

  return result;
}

/**
 * Prune graph edges by score threshold
 */
export function pruneByThreshold<T extends { score: number }>(
  items: T[],
  threshold: number
): T[] {
  return items.filter((item) => item.score >= threshold);
}

// =============================================================================
// TASK-GNN-002: Graph Attention Functions
// Implements real graph attention to replace fake mean aggregation
// =============================================================================

/**
 * Softmax activation for attention weights
 * Implements: TASK-GNN-002 (graph attention)
 *
 * Computes numerically stable softmax:
 *   softmax(x_i) = exp(x_i - max(x)) / sum(exp(x_j - max(x)))
 *
 * @param scores - Raw attention scores
 * @returns Normalized attention weights that sum to 1
 */
export function softmax(scores: Float32Array): Float32Array {
  if (scores.length === 0) {
    return new Float32Array(0);
  }

  // Find max for numerical stability (prevents overflow)
  let maxScore = scores[0];
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] > maxScore) {
      maxScore = scores[i];
    }
  }

  // Compute exp(x - max) for numerical stability
  const expScores = new Float32Array(scores.length);
  let sumExp = 0;
  for (let i = 0; i < scores.length; i++) {
    expScores[i] = Math.exp(scores[i] - maxScore);
    sumExp += expScores[i];
  }

  // Normalize by sum
  const result = new Float32Array(scores.length);
  if (sumExp === 0) {
    // Uniform distribution if all exp values are 0
    const uniform = 1.0 / scores.length;
    for (let i = 0; i < scores.length; i++) {
      result[i] = uniform;
    }
  } else {
    for (let i = 0; i < scores.length; i++) {
      result[i] = expScores[i] / sumExp;
    }
  }

  return result;
}

/**
 * Compute attention score between two vectors using scaled dot product
 * Implements: TASK-GNN-002 (graph attention)
 *
 * Formula: score = (query . key) / sqrt(d_k)
 * Where d_k is the dimension of the key vector
 *
 * @param query - Query vector (center node embedding)
 * @param key - Key vector (neighbor node embedding)
 * @param scale - Optional custom scaling factor (default: 1/sqrt(dim))
 * @returns Scalar attention score
 */
export function attentionScore(
  query: Float32Array,
  key: Float32Array,
  scale?: number
): number {
  const minLen = Math.min(query.length, key.length);
  if (minLen === 0) {
    return 0;
  }

  // Compute dot product
  let dotProduct = 0;
  for (let i = 0; i < minLen; i++) {
    dotProduct += query[i] * key[i];
  }

  // Scale by 1/sqrt(d_k) for stable gradients (Attention Is All You Need)
  const scaleFactor = scale ?? 1.0 / Math.sqrt(minLen);
  return dotProduct * scaleFactor;
}

/**
 * Apply attention weights to aggregate features
 * Implements: TASK-GNN-002 (graph attention)
 *
 * Computes: output = sum(attention_i * feature_i)
 *
 * @param features - Array of neighbor feature vectors
 * @param attentionWeights - Softmax-normalized attention weights (must sum to 1)
 * @returns Weighted sum of features
 */
export function weightedAggregate(
  features: Float32Array[],
  attentionWeights: Float32Array
): Float32Array {
  if (features.length === 0 || attentionWeights.length === 0) {
    return new Float32Array(0);
  }

  // Determine output dimension from first feature
  const dim = features[0].length;
  const result = new Float32Array(dim);

  // Weighted sum of features
  const numFeatures = Math.min(features.length, attentionWeights.length);
  for (let f = 0; f < numFeatures; f++) {
    const weight = attentionWeights[f];
    const feature = features[f];
    const featureLen = Math.min(feature.length, dim);
    for (let i = 0; i < featureLen; i++) {
      result[i] += weight * feature[i];
    }
  }

  return result;
}

/**
 * Compute attention scores for all neighbors from adjacency matrix row
 * Implements: TASK-GNN-002 (graph attention)
 *
 * This function:
 * 1. Identifies neighbors from non-zero adjacency values
 * 2. Computes raw attention scores using scaled dot product
 * 3. Multiplies by edge weight from adjacency matrix
 * 4. Returns indices of neighbors and their raw scores
 *
 * @param centerIdx - Index of center node
 * @param center - Center node embedding
 * @param features - All node embeddings
 * @param adjacency - Adjacency matrix (row for center node)
 * @returns Object with neighbor indices and raw attention scores
 */
export function computeNeighborAttention(
  centerIdx: number,
  center: Float32Array,
  features: Float32Array[],
  adjacencyRow: Float32Array
): { neighborIndices: number[]; rawScores: Float32Array } {
  const neighborIndices: number[] = [];
  const rawScoresList: number[] = [];

  // Find neighbors from adjacency row (non-zero entries)
  for (let j = 0; j < adjacencyRow.length && j < features.length; j++) {
    const edgeWeight = adjacencyRow[j];
    if (edgeWeight > 0 && j !== centerIdx) {
      // This is a neighbor
      neighborIndices.push(j);

      // Compute attention score and multiply by edge weight
      const rawScore = attentionScore(center, features[j]);
      const weightedScore = rawScore * edgeWeight;
      rawScoresList.push(weightedScore);
    }
  }

  return {
    neighborIndices,
    rawScores: new Float32Array(rawScoresList),
  };
}
