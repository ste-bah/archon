/**
 * God Agent Compression Module
 * TASK-CMP-001 - 5-Tier Compression Lifecycle
 *
 * Provides adaptive vector compression:
 * - Hot: Float32 (1x, 3072 bytes)
 * - Warm: Float16 (2x, 1536 bytes)
 * - Cool: PQ8 (8x, 384 bytes)
 * - Cold: PQ4 (16x, 192 bytes)
 * - Frozen: Binary (32x, 96 bytes)
 *
 * Target: 90%+ memory reduction for 1M vectors (3GB → 297MB)
 */

// ===== COMPRESSION MANAGER =====

export { CompressionManager } from './compression-manager.js';

// ===== UTILITIES =====

export {
  float32ToFloat16,
  float16ToFloat32,
  encodeFloat16,
  decodeFloat16,
  trainPQCodebook,
  encodePQ8,
  decodePQ8,
  encodePQ4,
  decodePQ4,
  trainBinaryThresholds,
  encodeBinary,
  decodeBinary,
  calculateReconstructionError,
  cosineSimilarityCompression,
  uint8ToUint16,
  uint16ToUint8,
} from './compression-utils.js';

// ===== TYPE DEFINITIONS =====

export {
  CompressionTier,
  TIER_HIERARCHY,
  TIER_CONFIGS,
  DEFAULT_COMPRESSION_CONFIG,
  CompressionError,
  TierTransitionError,
  getTierForHeatScore,
  isValidTransition,
  getNextTier,
  calculateBytesForTier,
} from './compression-types.js';

export type {
  VectorID,
  ITierConfig,
  ICompressedEmbedding,
  IAccessRecord,
  IMemoryUsageStats,
  ICompressionConfig,
  ICompressionConfig as CompressionConfig, // Alias for compatibility
  IPQCodebook,
  IBinaryThresholds,
} from './compression-types.js';
