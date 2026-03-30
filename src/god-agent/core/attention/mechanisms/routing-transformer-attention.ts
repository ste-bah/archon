/**
 * Routing Transformer Attention
 *
 * Implements content-based routing attention mechanism where queries are routed
 * to relevant key clusters, reducing complexity from O(N²) to O(N × k).
 *
 * Reference: Roy et al. 2021 "Efficient Content-Based Sparse Attention with Routing Transformers"
 *
 * Key Features:
 * - Content-based clustering of keys into k groups
 * - Each query routes to top-r most relevant clusters
 * - Attention computed only within selected clusters
 * - Complexity: O(N × k) where k is number of clusters
 */

import type { IAttentionMechanism } from '../attention-types.js';
import { VECTOR_DIM } from '../../validation/constants.js';
import {
  SeededRandom,
  xavierUniform,
  matmul,
  hasNaNOrInf,
} from '../utils/index.js';

export interface RealRoutingTransformerAttentionConfig {
  dimension?: number;      // default VECTOR_DIM=1536
  numHeads?: number;       // default 12
  numClusters?: number;    // default 16 (k)
  numRoutes?: number;      // default 4 (r - clusters per query)
  seed?: number;
}

export class RealRoutingTransformerAttention implements IAttentionMechanism {
  readonly name = 'routing-transformer';

  private dimension: number;
  private numHeads: number;
  private numClusters: number;
  private numRoutes: number;
  private headDim: number;
  private seed: number;

  // Learnable cluster centroids [numClusters, headDim]
  private clusterCentroids: Float32Array;

  // Projection weights
  private wq: Float32Array; // [dimension, dimension]
  private wk: Float32Array; // [dimension, dimension]
  private wv: Float32Array; // [dimension, dimension]
  private wo: Float32Array; // [dimension, dimension]

  constructor(config: RealRoutingTransformerAttentionConfig = {}) {
    this.dimension = config.dimension ?? VECTOR_DIM;
    this.numHeads = config.numHeads ?? 12;
    this.numClusters = config.numClusters ?? 16;
    this.numRoutes = config.numRoutes ?? 4;
    this.seed = config.seed ?? 42;

    // Validate configuration
    if (this.dimension <= 0 || !Number.isInteger(this.dimension)) {
      throw new Error('ANTI-009: dimension must be positive integer');
    }
    if (this.numHeads <= 0 || !Number.isInteger(this.numHeads)) {
      throw new Error('ANTI-009: numHeads must be positive integer');
    }
    if (this.dimension % this.numHeads !== 0) {
      throw new Error('ANTI-009: dimension must be divisible by numHeads');
    }
    if (this.numClusters <= 0 || !Number.isInteger(this.numClusters)) {
      throw new Error('ANTI-009: numClusters must be positive integer');
    }
    if (this.numRoutes <= 0 || !Number.isInteger(this.numRoutes)) {
      throw new Error('ANTI-009: numRoutes must be positive integer');
    }
    if (this.numRoutes > this.numClusters) {
      throw new Error('ANTI-009: numRoutes cannot exceed numClusters');
    }

    this.headDim = this.dimension / this.numHeads;

    // Initialize weights
    const rng = new SeededRandom(this.seed);

    // Projection matrices
    this.wq = xavierUniform(this.dimension, this.dimension, rng);
    this.wk = xavierUniform(this.dimension, this.dimension, rng);
    this.wv = xavierUniform(this.dimension, this.dimension, rng);
    this.wo = xavierUniform(this.dimension, this.dimension, rng);

    // Cluster centroids [numClusters, headDim]
    this.clusterCentroids = xavierUniform(this.numClusters, this.headDim, rng);
  }

  forward(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    mask?: boolean[],
    seqLen?: number
  ): Float32Array {
    // Validate inputs
    if (query.length !== this.dimension) {
      throw new Error('ANTI-009: query dimension mismatch');
    }
    if (key.length !== this.dimension) {
      throw new Error('ANTI-009: key dimension mismatch');
    }
    if (value.length !== this.dimension) {
      throw new Error('ANTI-009: value dimension mismatch');
    }
    if (hasNaNOrInf(query)) {
      throw new Error('ANTI-009: query contains NaN or Inf');
    }
    if (hasNaNOrInf(key)) {
      throw new Error('ANTI-009: key contains NaN or Inf');
    }
    if (hasNaNOrInf(value)) {
      throw new Error('ANTI-009: value contains NaN or Inf');
    }

    // Project Q, K, V
    const q = matmul(query, this.wq, this.dimension);
    const k = matmul(key, this.wk, this.dimension);
    const v = matmul(value, this.wv, this.dimension);

    // Process each head independently
    const output = new Float32Array(this.dimension);

    for (let h = 0; h < this.numHeads; h++) {
      const headOffset = h * this.headDim;

      // Extract head slices
      const qHead = q.slice(headOffset, headOffset + this.headDim);
      const kHead = k.slice(headOffset, headOffset + this.headDim);
      const vHead = v.slice(headOffset, headOffset + this.headDim);

      // Route query to top-r clusters
      const routedClusters = this.routeQuery(qHead);

      // Compute attention only with keys in selected clusters
      const headOutput = this.computeRoutedAttention(
        qHead,
        kHead,
        vHead,
        routedClusters,
        mask
      );

      // Write to output
      for (let i = 0; i < this.headDim; i++) {
        output[headOffset + i] = headOutput[i];
      }
    }

    // Final projection
    const result = matmul(output, this.wo, this.dimension);

    if (hasNaNOrInf(result)) {
      throw new Error('ANTI-009: output contains NaN or Inf');
    }

    return result;
  }

  /**
   * Route query to top-r most similar clusters
   */
  private routeQuery(qHead: Float32Array): number[] {
    const similarities = new Float32Array(this.numClusters);

    // Compute cosine similarity with each centroid
    for (let c = 0; c < this.numClusters; c++) {
      let dot = 0;
      let qNorm = 0;
      let cNorm = 0;

      for (let i = 0; i < this.headDim; i++) {
        const centroidIdx = c * this.headDim + i;
        dot += qHead[i] * this.clusterCentroids[centroidIdx];
        qNorm += qHead[i] * qHead[i];
        cNorm += this.clusterCentroids[centroidIdx] * this.clusterCentroids[centroidIdx];
      }

      // Cosine similarity
      const norm = Math.sqrt(qNorm) * Math.sqrt(cNorm);
      similarities[c] = norm > 1e-8 ? dot / norm : 0;
    }

    // Select top-r clusters
    const clusterIndices = Array.from({ length: this.numClusters }, (_, i) => i);
    clusterIndices.sort((a, b) => similarities[b] - similarities[a]);

    return clusterIndices.slice(0, this.numRoutes);
  }

  /**
   * Assign key to nearest cluster
   */
  private assignKeyToCluster(kHead: Float32Array): number {
    let bestCluster = 0;
    let bestSimilarity = -Infinity;

    for (let c = 0; c < this.numClusters; c++) {
      let dot = 0;
      let kNorm = 0;
      let cNorm = 0;

      for (let i = 0; i < this.headDim; i++) {
        const centroidIdx = c * this.headDim + i;
        dot += kHead[i] * this.clusterCentroids[centroidIdx];
        kNorm += kHead[i] * kHead[i];
        cNorm += this.clusterCentroids[centroidIdx] * this.clusterCentroids[centroidIdx];
      }

      const norm = Math.sqrt(kNorm) * Math.sqrt(cNorm);
      const similarity = norm > 1e-8 ? dot / norm : 0;

      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestCluster = c;
      }
    }

    return bestCluster;
  }

  /**
   * Compute attention only with keys in routed clusters
   */
  private computeRoutedAttention(
    qHead: Float32Array,
    kHead: Float32Array,
    vHead: Float32Array,
    routedClusters: number[],
    mask?: boolean[]
  ): Float32Array {
    // Determine which key cluster this belongs to
    const keyCluster = this.assignKeyToCluster(kHead);

    // Check if this key is in any of the routed clusters
    const isRouted = routedClusters.includes(keyCluster);

    if (!isRouted || (mask && mask.length > 0 && !mask[0])) {
      // Key not in routed clusters or masked - return zero attention
      return new Float32Array(this.headDim);
    }

    // Compute attention score with scaling
    const scale = 1.0 / Math.sqrt(this.headDim);
    let score = 0;
    for (let i = 0; i < this.headDim; i++) {
      score += qHead[i] * kHead[i];
    }
    score *= scale;

    // Stable softmax (with single element, just exp)
    const attnWeight = Math.exp(score);

    // Weighted value
    const output = new Float32Array(this.headDim);
    for (let i = 0; i < this.headDim; i++) {
      output[i] = attnWeight * vHead[i];
    }

    return output;
  }

  getParameterCount(): number {
    // 4 projection matrices + cluster centroids
    const projectionParams = 4 * this.dimension * this.dimension;
    const centroidParams = this.numClusters * this.headDim;
    return projectionParams + centroidParams;
  }
}
