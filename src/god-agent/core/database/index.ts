/**
 * Database module exports for god-agent learning system
 *
 * Implements: REQ-DESC-007, GAP-DESC-007
 * Implements: TASK-PERF-001 (HNSW), TASK-PERF-002 (Int8 Quantization)
 * Constitution: RULE-008, RULE-046, RULE-085
 */

// Core connection exports (types)
export type {
  IDatabaseConnection,
  DatabaseConfig,
} from './connection.js';

// Core connection exports (values)
export {
  DatabaseConnection,
  getDatabaseConnection,
  closeDatabaseConnection,
  hasConnection,
  createConnection,
} from './connection.js';

// DAO exports (TASK-DESC-003: SQLite-backed persistence)
export { EpisodeDAO } from './dao/episode-dao.js';

// Cache exports (TASK-DESC-005: LRU cache with eviction)
export type {
  ILRUCacheMetrics,
  EvictionCallback,
  SizeCalculator,
} from './cache/lru-cache.js';

export {
  LRUCache,
  createEpisodeSizeCalculator,
} from './cache/lru-cache.js';

// HNSW exports (TASK-PERF-001: O(log n) vector search)
// Types
export type {
  HNSWConfig,
  HNSWSearchResult,
  SerializedIndex,
  SerializedNode,
  CandidateEntry,
  DistanceFunction,
} from './hnsw/index.js';

// Values
export {
  HNSWIndex,
  HNSWNode,
  DEFAULT_HNSW_CONFIG,
  cosineDistance,
  euclideanDistance,
  dotProductDistance,
  squaredEuclideanDistance,
  getDistanceFunction,
  distanceToSimilarity,
} from './hnsw/index.js';

// Quantization exports (TASK-PERF-002: 4x memory reduction)
// Types
export type {
  QuantizationConfig,
  QuantizedVector,
  QuantizedVectorBatch,
  QuantizationMemoryStats,
  QuantizationQualityMetrics,
  StoredQuantizedVector,
  QuantizedSearchResult,
} from './quantization/index.js';

// Values
export {
  Int8Quantizer,
  QuantizedVectorStorage,
  DEFAULT_QUANTIZATION_CONFIG,
} from './quantization/index.js';
