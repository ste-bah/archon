/**
 * God Agent VectorDB Type Definitions
 *
 * Implements: TASK-VDB-001
 * Referenced by: God Agent core system
 */

import type { LEANNConfig } from './leann-types.js';

/**
 * Unique identifier for vectors in the database
 * Generated using crypto.randomUUID()
 */
export type VectorID = string;

/**
 * Distance metric for vector similarity/distance calculations
 */
export enum DistanceMetric {
  /** Cosine similarity (recommended for normalized vectors) */
  COSINE = 'cosine',
  /** Euclidean distance (L2 distance) */
  EUCLIDEAN = 'euclidean',
  /** Dot product (assumes normalized vectors) */
  DOT = 'dot',
  /** Manhattan distance (L1 distance) */
  MANHATTAN = 'manhattan'
}

/**
 * Result from k-NN vector search
 */
export interface SearchResult {
  /** Vector ID */
  id: VectorID;
  /** Similarity score (higher is more similar for cosine/dot, lower for distance metrics) */
  similarity: number;
  /** Optional: the actual vector data (included if requested) */
  vector?: Float32Array;
}

/**
 * Backend type for HNSW implementation
 */
export type BackendType = 'auto' | 'native' | 'leann' | 'javascript';

/**
 * Configuration options for VectorDB
 */
export interface VectorDBOptions {
  /** Vector dimension (default: VECTOR_DIM = 1536) */
  dimension?: number;
  /** Distance metric to use (default: cosine) */
  metric?: DistanceMetric;
  /** HNSW M parameter - max connections per node (default: 32) */
  hnswM?: number;
  /** HNSW efConstruction - quality during construction (default: 200) */
  hnswEfConstruction?: number;
  /** HNSW efSearch - quality during search (default: 50) */
  hnswEfSearch?: number;
  /** Persistence directory (default: .agentdb/) */
  persistencePath?: string;
  /** Enable auto-save on modifications (default: false) */
  autoSave?: boolean;
  /** Backend selection: 'auto' (default), 'native', 'leann', or 'javascript' */
  backend?: BackendType;
  /** Enable verbose logging for backend selection (default: false) */
  verbose?: boolean;
  /** LEANN configuration options (only used when backend is 'leann') */
  leannConfig?: Partial<LEANNConfig>;
}
