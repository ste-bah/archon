/**
 * HNSW Module Exports
 *
 * Implements: TASK-PERF-001 (Native HNSW backend)
 * Referenced by: VectorDB
 *
 * Exports the HNSW index implementation and related types.
 */

// Core index
export { HNSWIndex } from './hnsw-index.js';

// Node structure
export { HNSWNode } from './hnsw-node.js';

// Types (interfaces - ESM requires `export type`)
export type {
  HNSWConfig,
  HNSWSearchResult,
  SerializedIndex,
  SerializedNode,
  CandidateEntry,
  DistanceFunction,
} from './hnsw-types.js';

// Values (constants)
export { DEFAULT_HNSW_CONFIG } from './hnsw-types.js';

// Distance functions
export {
  cosineDistance,
  euclideanDistance,
  dotProductDistance,
  squaredEuclideanDistance,
  getDistanceFunction,
  distanceToSimilarity,
} from './distance.js';
