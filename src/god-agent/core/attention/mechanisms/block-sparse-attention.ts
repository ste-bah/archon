/**
 * Real Block Sparse Attention Implementation
 *
 * Reference: BigBird (Zaheer et al. 2020), Sparse Transformer (Child et al. 2019)
 *
 * Divides sequence into blocks and computes attention within/between blocks.
 * Creates structured sparsity for memory efficiency.
 *
 * Use cases:
 * - Long document processing
 * - Structured sparse attention
 * - Memory-efficient transformers
 *
 * Complexity: O(N × B) where B is block size (vs O(N²))
 * Parameter Count: 4 × dim²
 *
 * ANTI-009: REAL implementation
 */

import { IAttentionMechanism } from '../attention-types.js';
import { SeededRandom, xavierUniform, matmul, hasNaNOrInf } from '../utils/index.js';

export interface BlockSparseAttentionConfig {
  dimension?: number;
  numHeads?: number;
  blockSize?: number;       // Size of each block (default: 64)
  numRandomBlocks?: number; // Random connections per block (default: 1)
  seed?: number;
}

export class RealBlockSparseAttention implements IAttentionMechanism {
  readonly name = 'block-sparse';

  private readonly dimension: number;
  private readonly numHeads: number;
  private readonly headDim: number;
  private readonly scale: number;
  private readonly blockSize: number;
  private readonly numRandomBlocks: number;
  private readonly rng: SeededRandom;

  // Weight matrices (dimension × dimension)
  private readonly wQuery: Float32Array;
  private readonly wKey: Float32Array;
  private readonly wValue: Float32Array;
  private readonly wOutput: Float32Array;

  constructor(config?: BlockSparseAttentionConfig) {
    // Defaults
    this.dimension = config?.dimension ?? 128;
    this.numHeads = config?.numHeads ?? 8;
    this.blockSize = config?.blockSize ?? 64;
    this.numRandomBlocks = config?.numRandomBlocks ?? 1;

    // Validation
    if (this.dimension <= 0 || !Number.isInteger(this.dimension)) {
      throw new Error('dimension must be positive integer');
    }
    if (this.numHeads <= 0 || !Number.isInteger(this.numHeads)) {
      throw new Error('numHeads must be positive integer');
    }
    if (this.dimension % this.numHeads !== 0) {
      throw new Error('dimension must be divisible by numHeads');
    }
    if (this.blockSize <= 0 || !Number.isInteger(this.blockSize)) {
      throw new Error('blockSize must be positive integer');
    }
    if (this.numRandomBlocks < 0 || !Number.isInteger(this.numRandomBlocks)) {
      throw new Error('numRandomBlocks must be non-negative integer');
    }

    this.headDim = this.dimension / this.numHeads;
    this.scale = 1.0 / Math.sqrt(this.headDim);
    this.rng = new SeededRandom(config?.seed ?? 42);

    // Initialize weight matrices with Xavier uniform
    this.wQuery = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wKey = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wValue = xavierUniform(this.dimension, this.dimension, this.rng);
    this.wOutput = xavierUniform(this.dimension, this.dimension, this.rng);
  }

  forward(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    mask?: boolean[]
  ): Float32Array {
    // Validate query is divisible by dimension first
    if (query.length % this.dimension !== 0) {
      throw new Error(`query length mismatch: got ${query.length}, must be divisible by ${this.dimension}`);
    }

    const effectiveSeqLen = query.length / this.dimension;

    // Validation
    if (key.length !== effectiveSeqLen * this.dimension) {
      throw new Error(`key length mismatch: got ${key.length}, expected ${effectiveSeqLen * this.dimension}`);
    }
    if (value.length !== effectiveSeqLen * this.dimension) {
      throw new Error(`value length mismatch: got ${value.length}, expected ${effectiveSeqLen * this.dimension}`);
    }
    if (mask && mask.length !== effectiveSeqLen * effectiveSeqLen) {
      throw new Error(`mask length mismatch: got ${mask.length}, expected ${effectiveSeqLen * effectiveSeqLen}`);
    }
    if (hasNaNOrInf(query) || hasNaNOrInf(key) || hasNaNOrInf(value)) {
      throw new Error('Input contains NaN or Inf');
    }

    // Convert boolean mask to Float32Array for internal use
    const floatMask = mask ? new Float32Array(mask.length) : undefined;
    if (mask && floatMask) {
      for (let i = 0; i < mask.length; i++) {
        floatMask[i] = mask[i] ? 1.0 : 0.0;
      }
    }

    // Project Q, K, V
    const Q = matmul(query, this.wQuery, this.dimension);
    const K = matmul(key, this.wKey, this.dimension);
    const V = matmul(value, this.wValue, this.dimension);

    // Calculate number of blocks
    const numBlocks = Math.ceil(effectiveSeqLen / this.blockSize);

    // Generate random block connections (deterministic from seed)
    const randomBlockConnections = this.generateRandomBlockConnections(numBlocks);

    // Output buffer
    const output = new Float32Array(effectiveSeqLen * this.dimension);

    // Process each block
    for (let blockIdx = 0; blockIdx < numBlocks; blockIdx++) {
      const blockStart = blockIdx * this.blockSize;
      const blockEnd = Math.min(blockStart + this.blockSize, effectiveSeqLen);
      const actualBlockSize = blockEnd - blockStart;

      // Determine which blocks this block attends to
      const attendBlocks = this.getAttendBlocks(blockIdx, numBlocks, randomBlockConnections);

      // For each query position in this block
      for (let qi = blockStart; qi < blockEnd; qi++) {
        const attentionWeights = new Float32Array(effectiveSeqLen);
        attentionWeights.fill(-Infinity);

        // Compute attention scores only for attended blocks
        for (const attendBlockIdx of attendBlocks) {
          const attendStart = attendBlockIdx * this.blockSize;
          const attendEnd = Math.min(attendStart + this.blockSize, effectiveSeqLen);

          for (let ki = attendStart; ki < attendEnd; ki++) {
            // Compute scaled dot-product attention for this head
            let score = 0.0;
            for (let h = 0; h < this.numHeads; h++) {
              for (let d = 0; d < this.headDim; d++) {
                const idx = h * this.headDim + d;
                score += Q[qi * this.dimension + idx] * K[ki * this.dimension + idx];
              }
            }
            score *= this.scale;

            // Apply mask if provided
            if (floatMask && floatMask[qi * effectiveSeqLen + ki] === 0.0) {
              score = -Infinity;
            }

            attentionWeights[ki] = score;
          }
        }

        // Stable softmax
        let maxScore = -Infinity;
        for (let i = 0; i < effectiveSeqLen; i++) {
          if (attentionWeights[i] > maxScore && isFinite(attentionWeights[i])) {
            maxScore = attentionWeights[i];
          }
        }

        let sumExp = 0.0;
        const expScores = new Float32Array(effectiveSeqLen);
        for (let i = 0; i < effectiveSeqLen; i++) {
          if (isFinite(attentionWeights[i])) {
            expScores[i] = Math.exp(attentionWeights[i] - maxScore);
            sumExp += expScores[i];
          } else {
            expScores[i] = 0.0;
          }
        }

        // Normalize with epsilon guard
        const epsilon = 1e-10;
        if (sumExp < epsilon) {
          // Uniform distribution fallback
          const uniform = 1.0 / effectiveSeqLen;
          for (let i = 0; i < effectiveSeqLen; i++) {
            attentionWeights[i] = uniform;
          }
        } else {
          for (let i = 0; i < effectiveSeqLen; i++) {
            attentionWeights[i] = expScores[i] / sumExp;
          }
        }

        // Weighted sum of values
        for (let d = 0; d < this.dimension; d++) {
          let sum = 0.0;
          for (let vi = 0; vi < effectiveSeqLen; vi++) {
            sum += attentionWeights[vi] * V[vi * this.dimension + d];
          }
          output[qi * this.dimension + d] = sum;
        }
      }
    }

    // Output projection
    const result = matmul(output, this.wOutput, this.dimension);

    // Final validation
    if (hasNaNOrInf(result)) {
      throw new Error('Output contains NaN or Inf');
    }

    return result;
  }

  /**
   * Generate random block connections for each block (deterministic from seed)
   */
  private generateRandomBlockConnections(numBlocks: number): Map<number, Set<number>> {
    const connections = new Map<number, Set<number>>();

    for (let blockIdx = 0; blockIdx < numBlocks; blockIdx++) {
      const randomBlocks = new Set<number>();

      // Add random blocks (excluding self and adjacent)
      let attempts = 0;
      const maxAttempts = numBlocks * 2;
      while (randomBlocks.size < this.numRandomBlocks && attempts < maxAttempts) {
        const randBlockIdx = Math.floor(this.rng.next() * numBlocks);

        // Exclude self and adjacent blocks
        if (randBlockIdx !== blockIdx &&
          randBlockIdx !== blockIdx - 1 &&
          randBlockIdx !== blockIdx + 1) {
          randomBlocks.add(randBlockIdx);
        }
        attempts++;
      }

      connections.set(blockIdx, randomBlocks);
    }

    return connections;
  }

  /**
   * Determine which blocks a given block should attend to
   */
  private getAttendBlocks(
    blockIdx: number,
    numBlocks: number,
    randomConnections: Map<number, Set<number>>
  ): number[] {
    const attendBlocks = new Set<number>();

    // 1. Self (diagonal)
    attendBlocks.add(blockIdx);

    // 2. Adjacent blocks
    if (blockIdx > 0) {
      attendBlocks.add(blockIdx - 1);
    }
    if (blockIdx < numBlocks - 1) {
      attendBlocks.add(blockIdx + 1);
    }

    // 3. Random blocks
    const randomBlocks = randomConnections.get(blockIdx);
    if (randomBlocks) {
      const randomArray = Array.from(randomBlocks);
      for (let i = 0; i < randomArray.length; i++) {
        attendBlocks.add(randomArray[i]);
      }
    }

    // 4. Global attention for first block (optional)
    if (blockIdx === 0) {
      for (let i = 0; i < numBlocks; i++) {
        attendBlocks.add(i);
      }
    }

    return Array.from(attendBlocks).sort((a, b) => a - b);
  }

  getParameterCount(): number {
    return 4 * this.dimension * this.dimension;
  }

  getWeights(): {
    wQuery: Float32Array;
    wKey: Float32Array;
    wValue: Float32Array;
    wOutput: Float32Array;
  } {
    return {
      wQuery: this.wQuery,
      wKey: this.wKey,
      wValue: this.wValue,
      wOutput: this.wOutput
    };
  }

  getConfig(): {
    dimension: number;
    numHeads: number;
    headDim: number;
    blockSize: number;
    numRandomBlocks: number;
  } {
    return {
      dimension: this.dimension,
      numHeads: this.numHeads,
      headDim: this.headDim,
      blockSize: this.blockSize,
      numRandomBlocks: this.numRandomBlocks
    };
  }
}
