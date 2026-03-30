/**
 * LEANN (Lazy-Evaluated Approximate Nearest Neighbors) Type Definitions
 *
 * Implements: TASK-LEANN-001
 * Referenced by: LEANNBackend, BackendSelector
 */

import { VectorID } from './types.js';

/**
 * Configuration options for LEANN backend
 */
export interface LEANNConfig {
  /** Ratio of vectors to cache as hubs (default: 0.1 = 10%) */
  hubCacheRatio: number;
  /** Ratio of edges to keep after pruning (default: 0.7 = 70%) */
  graphPruningRatio: number;
  /** Batch size for recomputation operations (default: 100) */
  batchSize: number;
  /** Maximum latency for recomputation in milliseconds (default: 50) */
  maxRecomputeLatencyMs: number;
  /** HNSW efSearch parameter for quality (default: 50) */
  efSearch: number;
  /** Minimum degree for a node to be considered a hub (default: 10) */
  hubDegreeThreshold: number;
}

/**
 * Default LEANN configuration
 */
export const DEFAULT_LEANN_CONFIG: LEANNConfig = {
  hubCacheRatio: 0.1,
  graphPruningRatio: 0.7,
  batchSize: 100,
  maxRecomputeLatencyMs: 50,
  efSearch: 50,
  hubDegreeThreshold: 10,
};

/**
 * Hub cache entry with LRU tracking
 */
export interface HubCacheEntry {
  /** The vector data */
  vector: Float32Array;
  /** Number of connections (degree) in the graph */
  degree: number;
  /** Timestamp of last access for LRU eviction */
  lastAccess: number;
}

/**
 * Graph node with adjacency information
 */
export interface GraphNode {
  /** The vector data (may be null for lazy loading) */
  vector: Float32Array | null;
  /** Connected neighbor IDs */
  neighbors: Set<VectorID>;
}

/**
 * Statistics for LEANN backend
 */
export interface LEANNStats {
  /** Total number of vectors */
  totalVectors: number;
  /** Number of vectors in hub cache */
  hubCacheSize: number;
  /** Number of cache hits */
  cacheHits: number;
  /** Number of cache misses */
  cacheMisses: number;
  /** Cache hit ratio */
  hitRatio: number;
  /** Average hub degree */
  avgHubDegree: number;
  /** Number of edges in graph */
  totalEdges: number;
  /** Number of pruned edges */
  prunedEdges: number;
}

/**
 * Serialization format for persistence
 */
export interface LEANNSerializedData {
  version: number;
  config: LEANNConfig;
  dimension: number;
  metric: string;
  vectors: Array<{ id: string; data: number[] }>;
  graph: Array<{ id: string; neighbors: string[]; degree: number }>;
  hubIds: string[];
  stats: {
    cacheHits: number;
    cacheMisses: number;
    prunedEdges: number;
  };
}

/** Storage version for LEANN format */
export const LEANN_STORAGE_VERSION = 2;
export const LEANN_LEGACY_VERSION = 1;
export const LEANN_BINARY_MAGIC = Buffer.from('LEANN\x00');
