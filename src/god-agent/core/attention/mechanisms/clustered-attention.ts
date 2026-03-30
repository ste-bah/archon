/**
 * Clustered Attention Mechanism
 *
 * Reference: Vyas et al. 2020 "Fast Transformers with Clustered Attention"
 *
 * Approximates full attention by clustering queries and keys into groups,
 * computing attention between cluster centroids, then distributing back
 * to individual positions.
 *
 * Complexity: O(N × c) where c is number of clusters (typically sqrt(N))
 *
 * Algorithm:
 * 1. Cluster queries into c groups
 * 2. Cluster keys into c groups
 * 3. Compute centroids for each cluster
 * 4. Compute attention between query centroids and key centroids
 * 5. Distribute cluster-level attention back to individual positions
 */

import type { IAttentionMechanism } from '../attention-types.js';
import { VECTOR_DIM } from '../../validation/constants.js';
import {
  SeededRandom,
  xavierUniform,
  matmul,
  hasNaNOrInf,
} from '../utils/index.js';

export interface ClusteredAttentionConfig {
  dimension?: number;
  numHeads?: number;
  numClusters?: number;
  seed?: number;
  maxKMeansIterations?: number;
}

export class RealClusteredAttention implements IAttentionMechanism {
  readonly name = 'clustered';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly numClusters: number;
  private readonly headDim: number;
  private readonly seed: number;
  private readonly maxKMeansIterations: number;

  // Projection matrices (dimension × dimension)
  private readonly Wq: Float32Array;
  private readonly Wk: Float32Array;
  private readonly Wv: Float32Array;
  private readonly Wo: Float32Array;

  constructor(config: ClusteredAttentionConfig = {}) {
    this.dimension = config.dimension ?? VECTOR_DIM;
    this.numHeads = config.numHeads ?? 12;
    this.numClusters = config.numClusters ?? 32;
    this.seed = config.seed ?? 42;
    this.maxKMeansIterations = config.maxKMeansIterations ?? 10;

    if (this.dimension % this.numHeads !== 0) {
      throw new Error(
        `ANTI-009: dimension (${this.dimension}) must be divisible by numHeads (${this.numHeads})`
      );
    }

    if (this.numClusters < 1) {
      throw new Error(
        `ANTI-009: numClusters must be >= 1, got ${this.numClusters}`
      );
    }

    this.headDim = this.dimension / this.numHeads;

    const rng = new SeededRandom(this.seed);

    // Initialize projection matrices
    this.Wq = xavierUniform(this.dimension, this.dimension, rng);
    this.Wk = xavierUniform(this.dimension, this.dimension, rng);
    this.Wv = xavierUniform(this.dimension, this.dimension, rng);
    this.Wo = xavierUniform(this.dimension, this.dimension, rng);
  }

  forward(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    mask?: boolean[],
    seqLen?: number
  ): Float32Array {
    // Validate inputs
    if (query.length !== key.length || key.length !== value.length) {
      throw new Error(
        `ANTI-009: query, key, value must have same length, got ${query.length}, ${key.length}, ${value.length}`
      );
    }

    if (query.length % this.dimension !== 0) {
      throw new Error(
        `ANTI-009: input length must be multiple of dimension ${this.dimension}, got ${query.length}`
      );
    }

    const N = query.length / this.dimension;
    const effectiveSeqLen = seqLen ?? N;

    if (effectiveSeqLen > N) {
      throw new Error(
        `ANTI-009: seqLen (${effectiveSeqLen}) cannot exceed actual sequence length (${N})`
      );
    }

    if (mask && mask.length !== effectiveSeqLen) {
      throw new Error(
        `ANTI-009: mask length (${mask.length}) must match seqLen (${effectiveSeqLen})`
      );
    }

    // Project Q, K, V
    const Q = matmul(query, this.Wq, this.dimension);
    const K = matmul(key, this.Wk, this.dimension);
    const V = matmul(value, this.Wv, this.dimension);

    if (hasNaNOrInf(Q) || hasNaNOrInf(K) || hasNaNOrInf(V)) {
      throw new Error('ANTI-009: NaN/Inf detected after projection');
    }

    // Perform clustered attention for each head
    const output = new Float32Array(N * this.dimension);

    for (let h = 0; h < this.numHeads; h++) {
      const headOffset = h * this.headDim;

      // Extract head-specific Q, K, V
      const Qh = this.extractHead(Q, N, h);
      const Kh = this.extractHead(K, N, h);
      const Vh = this.extractHead(V, N, h);

      // Cluster queries and keys
      const qClusters = this.clusterVectors(Qh, effectiveSeqLen, this.numClusters);
      const kClusters = this.clusterVectors(Kh, effectiveSeqLen, this.numClusters);

      // Compute cluster centroids
      const qCentroids = this.computeCentroids(Qh, qClusters, effectiveSeqLen);
      const kCentroids = this.computeCentroids(Kh, kClusters, effectiveSeqLen);
      const vCentroids = this.computeCentroids(Vh, kClusters, effectiveSeqLen);

      // Compute attention between centroids
      const clusterAttn = this.computeClusterAttention(
        qCentroids,
        kCentroids,
        vCentroids
      );

      // Distribute cluster attention back to individual positions
      const headOutput = this.distributeClusterAttention(
        clusterAttn,
        qClusters,
        effectiveSeqLen
      );

      // Apply mask
      if (mask) {
        for (let i = 0; i < effectiveSeqLen; i++) {
          if (!mask[i]) {
            for (let d = 0; d < this.headDim; d++) {
              headOutput[i * this.headDim + d] = 0;
            }
          }
        }
      }

      // Copy head output to main output
      for (let i = 0; i < effectiveSeqLen; i++) {
        for (let d = 0; d < this.headDim; d++) {
          output[i * this.dimension + headOffset + d] =
            headOutput[i * this.headDim + d];
        }
      }
    }

    // Output projection
    const finalOutput = matmul(output, this.Wo, this.dimension);

    if (hasNaNOrInf(finalOutput)) {
      throw new Error('ANTI-009: NaN/Inf detected in final output');
    }

    return finalOutput;
  }

  private extractHead(
    tensor: Float32Array,
    seqLen: number,
    headIdx: number
  ): Float32Array {
    const head = new Float32Array(seqLen * this.headDim);
    const headOffset = headIdx * this.headDim;

    for (let i = 0; i < seqLen; i++) {
      for (let d = 0; d < this.headDim; d++) {
        head[i * this.headDim + d] =
          tensor[i * this.dimension + headOffset + d];
      }
    }

    return head;
  }

  /**
   * Simple k-means clustering
   * Returns cluster assignment for each position
   */
  private clusterVectors(
    vectors: Float32Array,
    seqLen: number,
    numClusters: number
  ): Uint32Array {
    const effectiveClusters = Math.min(numClusters, seqLen);
    const assignments = new Uint32Array(seqLen);

    // Initialize centroids with first k positions
    const centroids = new Float32Array(effectiveClusters * this.headDim);
    for (let c = 0; c < effectiveClusters; c++) {
      const initIdx = Math.floor((c * seqLen) / effectiveClusters);
      for (let d = 0; d < this.headDim; d++) {
        centroids[c * this.headDim + d] =
          vectors[initIdx * this.headDim + d];
      }
    }

    // K-means iterations
    for (let iter = 0; iter < this.maxKMeansIterations; iter++) {
      // Assign each position to nearest centroid
      for (let i = 0; i < seqLen; i++) {
        let minDist = Infinity;
        let bestCluster = 0;

        for (let c = 0; c < effectiveClusters; c++) {
          let dist = 0;
          for (let d = 0; d < this.headDim; d++) {
            const diff =
              vectors[i * this.headDim + d] -
              centroids[c * this.headDim + d];
            dist += diff * diff;
          }

          if (dist < minDist) {
            minDist = dist;
            bestCluster = c;
          }
        }

        assignments[i] = bestCluster;
      }

      // Update centroids
      const counts = new Uint32Array(effectiveClusters);
      const newCentroids = new Float32Array(effectiveClusters * this.headDim);

      for (let i = 0; i < seqLen; i++) {
        const c = assignments[i];
        counts[c]++;
        for (let d = 0; d < this.headDim; d++) {
          newCentroids[c * this.headDim + d] +=
            vectors[i * this.headDim + d];
        }
      }

      for (let c = 0; c < effectiveClusters; c++) {
        if (counts[c] > 0) {
          for (let d = 0; d < this.headDim; d++) {
            centroids[c * this.headDim + d] =
              newCentroids[c * this.headDim + d] / counts[c];
          }
        }
      }
    }

    return assignments;
  }

  private computeCentroids(
    vectors: Float32Array,
    assignments: Uint32Array,
    seqLen: number
  ): Float32Array {
    const centroids = new Float32Array(this.numClusters * this.headDim);
    const counts = new Uint32Array(this.numClusters);

    // Accumulate
    for (let i = 0; i < seqLen; i++) {
      const c = assignments[i];
      counts[c]++;
      for (let d = 0; d < this.headDim; d++) {
        centroids[c * this.headDim + d] += vectors[i * this.headDim + d];
      }
    }

    // Average
    for (let c = 0; c < this.numClusters; c++) {
      if (counts[c] > 0) {
        for (let d = 0; d < this.headDim; d++) {
          centroids[c * this.headDim + d] /= counts[c];
        }
      }
    }

    return centroids;
  }

  /**
   * Compute attention between cluster centroids
   * Returns: (numClusters × headDim) attention-weighted value centroids
   */
  private computeClusterAttention(
    qCentroids: Float32Array,
    kCentroids: Float32Array,
    vCentroids: Float32Array
  ): Float32Array {
    const scale = 1.0 / Math.sqrt(this.headDim);
    const scores = new Float32Array(this.numClusters * this.numClusters);

    // Compute Q·K^T
    for (let i = 0; i < this.numClusters; i++) {
      for (let j = 0; j < this.numClusters; j++) {
        let score = 0;
        for (let d = 0; d < this.headDim; d++) {
          score +=
            qCentroids[i * this.headDim + d] *
            kCentroids[j * this.headDim + d];
        }
        scores[i * this.numClusters + j] = score * scale;
      }
    }

    // Softmax per row
    for (let i = 0; i < this.numClusters; i++) {
      // Find max for stability
      let maxScore = -Infinity;
      for (let j = 0; j < this.numClusters; j++) {
        maxScore = Math.max(maxScore, scores[i * this.numClusters + j]);
      }

      // Exp and sum
      let sum = 0;
      for (let j = 0; j < this.numClusters; j++) {
        const idx = i * this.numClusters + j;
        scores[idx] = Math.exp(scores[idx] - maxScore);
        sum += scores[idx];
      }

      // Normalize
      if (sum > 0) {
        for (let j = 0; j < this.numClusters; j++) {
          scores[i * this.numClusters + j] /= sum;
        }
      }
    }

    // Compute attention-weighted values
    const output = new Float32Array(this.numClusters * this.headDim);
    for (let i = 0; i < this.numClusters; i++) {
      for (let j = 0; j < this.numClusters; j++) {
        const weight = scores[i * this.numClusters + j];
        for (let d = 0; d < this.headDim; d++) {
          output[i * this.headDim + d] +=
            weight * vCentroids[j * this.headDim + d];
        }
      }
    }

    return output;
  }

  /**
   * Distribute cluster-level attention back to individual positions
   */
  private distributeClusterAttention(
    clusterOutput: Float32Array,
    assignments: Uint32Array,
    seqLen: number
  ): Float32Array {
    const output = new Float32Array(seqLen * this.headDim);

    for (let i = 0; i < seqLen; i++) {
      const c = assignments[i];
      for (let d = 0; d < this.headDim; d++) {
        output[i * this.headDim + d] = clusterOutput[c * this.headDim + d];
      }
    }

    return output;
  }

  getParameterCount(): number {
    // 4 projection matrices: Wq, Wk, Wv, Wo
    return 4 * this.dimension * this.dimension;
  }
}
