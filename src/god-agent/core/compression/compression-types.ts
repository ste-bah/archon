/**
 * Compression Type Definitions
 * TASK-CMP-001 - 5-Tier Compression Lifecycle
 *
 * Provides types for adaptive vector compression (1536D vectors):
 * - Hot: Float32 (1x, 6144 bytes)
 * - Warm: Float16 (2x, 3072 bytes)
 * - Cool: PQ8 (8x, 768 bytes)
 * - Cold: PQ4 (16x, 384 bytes)
 * - Frozen: Binary (32x, 192 bytes)
 *
 * Target: 90%+ memory reduction for 1M vectors (6GB → 594MB)
 */

import { VECTOR_DIM } from '../validation/constants.js';

// ==================== Core Types ====================

/**
 * Vector identifier
 */
export type VectorID = string;

/**
 * Compression tier enumeration
 * Ordered from least to most compressed
 */
export enum CompressionTier {
  HOT = 'hot',       // Float32, no compression
  WARM = 'warm',     // Float16, 2x compression
  COOL = 'cool',     // PQ8, 8x compression
  COLD = 'cold',     // PQ4, 16x compression
  FROZEN = 'frozen', // Binary, 32x compression
}

/**
 * Tier hierarchy for one-way transitions
 */
export const TIER_HIERARCHY: CompressionTier[] = [
  CompressionTier.HOT,
  CompressionTier.WARM,
  CompressionTier.COOL,
  CompressionTier.COLD,
  CompressionTier.FROZEN,
];

/**
 * Tier configuration
 */
export interface ITierConfig {
  /** Tier name */
  tier: CompressionTier;
  /** Minimum heat score for this tier */
  minHeatScore: number;
  /** Maximum heat score for this tier */
  maxHeatScore: number;
  /** Compression format */
  format: 'float32' | 'float16' | 'pq8' | 'pq4' | 'binary';
  /** Compression ratio (1 = no compression) */
  compressionRatio: number;
  /** Bytes per VECTOR_DIM vector */
  bytesPerVector: number;
  /** Maximum acceptable error rate */
  maxErrorRate: number;
}

/**
 * Default tier configurations
 */
export const TIER_CONFIGS: Record<CompressionTier, ITierConfig> = {
  [CompressionTier.HOT]: {
    tier: CompressionTier.HOT,
    minHeatScore: 0.8,
    maxHeatScore: 1.0,
    format: 'float32',
    compressionRatio: 1,
    bytesPerVector: VECTOR_DIM * 4, // 6144 bytes for 1536D
    maxErrorRate: 0.0001,
  },
  [CompressionTier.WARM]: {
    tier: CompressionTier.WARM,
    minHeatScore: 0.4,
    maxHeatScore: 0.8,
    format: 'float16',
    compressionRatio: 2,
    bytesPerVector: VECTOR_DIM * 2, // 3072 bytes for 1536D
    maxErrorRate: 0.0001,
  },
  [CompressionTier.COOL]: {
    tier: CompressionTier.COOL,
    minHeatScore: 0.1,
    maxHeatScore: 0.4,
    format: 'pq8',
    compressionRatio: 8,
    bytesPerVector: (VECTOR_DIM / 8) * 4, // 768 bytes for 1536D (192 subvectors)
    maxErrorRate: 0.02,
  },
  [CompressionTier.COLD]: {
    tier: CompressionTier.COLD,
    minHeatScore: 0.01,
    maxHeatScore: 0.1,
    format: 'pq4',
    compressionRatio: 16,
    bytesPerVector: (VECTOR_DIM / 8) * 2, // 384 bytes for 1536D (192 subvectors, 4-bit)
    maxErrorRate: 0.05,
  },
  [CompressionTier.FROZEN]: {
    tier: CompressionTier.FROZEN,
    minHeatScore: 0,
    maxHeatScore: 0.01,
    format: 'binary',
    compressionRatio: 32,
    bytesPerVector: VECTOR_DIM / 8, // 192 bytes for 1536D
    maxErrorRate: 0.10,
  },
};

// ==================== Compressed Embedding ====================

/**
 * Compressed embedding with metadata
 */
export interface ICompressedEmbedding {
  /** Vector identifier */
  vectorId: VectorID;
  /** Current compression tier */
  tier: CompressionTier;
  /** Compressed data */
  data: Uint8Array;
  /** Original dimension (for validation) */
  originalDim: number;
  /** Compression timestamp */
  compressedAt: number;
  /** Codebook index (for PQ methods) */
  codebookIndex?: number;
}

// ==================== Access Tracking ====================

/**
 * Access record for a vector
 */
export interface IAccessRecord {
  /** Vector identifier */
  vectorId: VectorID;
  /** Current tier */
  tier: CompressionTier;
  /** Access timestamps (last 24h) */
  accessTimestamps: number[];
  /** Total access count */
  totalAccesses: number;
  /** Current heat score [0, 1] */
  heatScore: number;
  /** Last access timestamp */
  lastAccessAt: number;
  /** Creation timestamp */
  createdAt: number;
}

// ==================== Memory Usage ====================

/**
 * Memory usage statistics
 */
export interface IMemoryUsageStats {
  /** Total number of vectors */
  totalVectors: number;
  /** Count by tier */
  byTier: Record<CompressionTier, number>;
  /** Total bytes used */
  totalBytes: number;
  /** Compression ratio (original / compressed) */
  compressionRatio: number;
  /** Bytes saved */
  bytesSaved: number;
  /** Uncompressed size (for comparison) */
  uncompressedBytes: number;
}

// ==================== Configuration ====================

/**
 * Compression manager configuration
 */
export interface ICompressionConfig {
  /** Default dimension (default: VECTOR_DIM = 1536) */
  dimension?: number;
  /** Heat decay rate per hour (default: 0.1) */
  heatDecayRate?: number;
  /** Window for access counting in ms (default: 86400000 = 24h) */
  accessWindow?: number;
  /** Enable automatic tier transitions (default: true) */
  autoTransition?: boolean;
  /** Transition check interval in ms (default: 3600000 = 1h) */
  transitionCheckInterval?: number;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_COMPRESSION_CONFIG: Required<ICompressionConfig> = {
  dimension: VECTOR_DIM,
  heatDecayRate: 0.1,
  accessWindow: 86400000, // 24 hours
  autoTransition: true,
  transitionCheckInterval: 3600000, // 1 hour
  verbose: false,
};

// ==================== Codec Types ====================

/**
 * Product Quantization codebook
 */
export interface IPQCodebook {
  /** Number of subvectors */
  numSubvectors: number;
  /** Dimension per subvector */
  subvectorDim: number;
  /** Number of centroids (256 for PQ8, 16 for PQ4) */
  numCentroids: number;
  /** Centroids: [numSubvectors][numCentroids][subvectorDim] */
  centroids: Float32Array[];
  /** Training timestamp */
  trainedAt: number;
  /** Number of vectors used for training */
  trainingSize: number;
}

/**
 * Binary quantization thresholds
 */
export interface IBinaryThresholds {
  /** Per-dimension thresholds */
  thresholds: Float32Array;
  /** Training timestamp */
  trainedAt: number;
  /** Number of vectors used for training */
  trainingSize: number;
}

// ==================== Error Types ====================

/**
 * Error thrown when compression fails
 */
export class CompressionError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_TIER' | 'INVALID_DATA' | 'CODEC_NOT_TRAINED' | 'DIMENSION_MISMATCH'
  ) {
    super(message);
    this.name = 'CompressionError';
  }
}

/**
 * Error thrown when tier transition is invalid
 */
export class TierTransitionError extends Error {
  constructor(
    public readonly fromTier: CompressionTier,
    public readonly toTier: CompressionTier
  ) {
    super(`Invalid tier transition: ${fromTier} → ${toTier}. Only forward transitions allowed.`);
    this.name = 'TierTransitionError';
  }
}

// ==================== Utility Functions ====================

/**
 * Get tier config for a heat score
 */
export function getTierForHeatScore(heatScore: number): CompressionTier {
  for (const tier of TIER_HIERARCHY) {
    const config = TIER_CONFIGS[tier];
    if (heatScore >= config.minHeatScore) {
      return tier;
    }
  }
  return CompressionTier.FROZEN;
}

/**
 * Check if tier transition is valid (forward only)
 */
export function isValidTransition(fromTier: CompressionTier, toTier: CompressionTier): boolean {
  const fromIndex = TIER_HIERARCHY.indexOf(fromTier);
  const toIndex = TIER_HIERARCHY.indexOf(toTier);
  return toIndex > fromIndex;
}

/**
 * Get the next tier in the hierarchy
 */
export function getNextTier(tier: CompressionTier): CompressionTier | null {
  const index = TIER_HIERARCHY.indexOf(tier);
  if (index < TIER_HIERARCHY.length - 1) {
    return TIER_HIERARCHY[index + 1];
  }
  return null;
}

/**
 * Calculate bytes for N vectors at a tier
 */
export function calculateBytesForTier(tier: CompressionTier, count: number): number {
  return TIER_CONFIGS[tier].bytesPerVector * count;
}
