/**
 * HNSW Index Type Definitions
 *
 * Implements: TASK-PERF-001 (Native HNSW backend)
 * Implements: TASK-PERF-002 (Int8 quantization support)
 * Referenced by: HNSWIndex, HNSWNode
 *
 * Type definitions for the Hierarchical Navigable Small World algorithm.
 */

import type { QuantizationConfig } from '../quantization/quantization-types.js';

/**
 * Configuration for HNSW index
 */
export interface HNSWConfig {
  /** Maximum number of connections per node at each level (default: 16) */
  M: number;

  /** Build-time search width - higher = better quality, slower build (default: 200) */
  efConstruction: number;

  /** Query-time search width - higher = better recall, slower search (default: 50) */
  efSearch: number;

  /** Distance metric to use */
  metric: 'cosine' | 'euclidean' | 'dot';

  /** Maximum number of connections at level 0 (derived: 2 * M) */
  M0: number;

  /** Level multiplier for random level generation (derived: 1 / ln(M)) */
  mL: number;

  /** Enable Int8 quantization for 4x memory reduction (TASK-PERF-002) */
  quantize?: boolean;

  /** Quantization configuration (when quantize is true) */
  quantizationConfig?: Partial<QuantizationConfig>;

  /** Number of candidates to re-rank with full precision (default: k * 2) */
  rerankCandidates?: number;
}

/**
 * Default HNSW configuration optimized for balanced performance
 */
export const DEFAULT_HNSW_CONFIG: HNSWConfig = {
  M: 16,
  efConstruction: 200,
  efSearch: 50,
  metric: 'cosine',
  M0: 32, // 2 * M
  mL: 1 / Math.log(16), // 1 / ln(M)
};

/**
 * Search result from HNSW index
 */
export interface HNSWSearchResult {
  id: string;
  distance: number;
  vector?: Float32Array;
}

/**
 * Serialized node format for persistence
 */
export interface SerializedNode {
  id: string;
  level: number;
  connections: Array<[number, string[]]>; // [level, neighbor_ids]
}

/**
 * Serialized index format for persistence
 */
export interface SerializedIndex {
  version: number;
  dimension: number;
  config: Omit<HNSWConfig, 'M0' | 'mL'>;
  entryPointId: string | null;
  maxLevel: number;
  nodes: SerializedNode[];
  vectors: Array<{
    id: string;
    data: number[];
  }>;
}

/**
 * Priority queue entry for beam search
 */
export interface CandidateEntry {
  id: string;
  distance: number;
}

/**
 * Distance function type
 */
export type DistanceFunction = (a: Float32Array, b: Float32Array) => number;
