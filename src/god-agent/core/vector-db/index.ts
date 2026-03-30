/**
 * God Agent VectorDB Module
 *
 * Implements: TASK-VDB-001
 * Referenced by: God Agent core system
 *
 * High-performance vector database with k-NN search for VECTOR_DIM (1536D) embeddings.
 * Enforces strict validation contract per constitution.md VEC-01 through VEC-05.
 * Supports automatic backend selection (native Rust or JavaScript fallback).
 */

// Main VectorDB class
export { VectorDB } from './vector-db.js';

// Type definitions - enum (value export)
export { DistanceMetric } from './types.js';

// Type definitions - type-only exports for ESM compatibility
export type {
  VectorID,
  SearchResult,
  VectorDBOptions,
  VectorDBOptions as VectorDBConfig, // Alias for compatibility
  BackendType
} from './types.js';

// Backend interface (type-only export for ESM compatibility)
export type { IHNSWBackend } from './hnsw-backend.js';

// Backend class (value export)
export { FallbackHNSW } from './fallback-hnsw.js';

// Backend selector class (value export)
export { BackendSelector } from './backend-selector.js';

// Backend selector types (type-only exports for ESM compatibility)
export type {
  BackendSelection,
  PerformanceTier,
  BackendSelectorConfig
} from './backend-selector.js';

// Distance metrics (exported for direct use if needed)
export {
  cosineSimilarity,
  euclideanDistance,
  dotProduct,
  manhattanDistance,
  getMetricFunction,
  isSimilarityMetric
} from './distance-metrics.js';

// LEANN Backend (value export)
export { LEANNBackend } from './leann-backend.js';

// LEANN types and constants (value exports)
export { DEFAULT_LEANN_CONFIG, LEANN_STORAGE_VERSION } from './leann-types.js';

// LEANN Backend types (type-only exports for ESM compatibility)
export type { LEANNConfig, LEANNStats, HubCacheEntry, GraphNode } from './leann-types.js';
