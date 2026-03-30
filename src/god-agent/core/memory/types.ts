/**
 * Memory Engine Types
 * Type definitions for the God Agent memory system
 */

import type { NodeID } from '../graph-db/index.js';

/**
 * Relation types for memory nodes
 */
export type RelationType =
  | 'extends'
  | 'contradicts'
  | 'supports'
  | 'cites'
  | 'derives_from';

/**
 * Options for storing memory entries
 */
export interface IStoreOptions {
  /** Namespace for the memory entry (e.g., 'project/api-design') */
  namespace: string;

  /** Optional pre-computed embedding vector (1536 dimensions) */
  embedding?: Float32Array;

  /** Optional node to link this memory to (required for non-root namespaces) */
  linkTo?: NodeID;

  /** Relation type when linking to another node */
  relation?: RelationType;
}

/**
 * Options for retrieving memory entries
 */
export interface IRetrieveOptions {
  /** Namespace to search within */
  namespace?: string;

  /** Whether to include related memories in the result */
  includeRelated?: boolean;
}

/**
 * Options for searching memories
 */
export interface ISearchOptions {
  /** Maximum number of results to return */
  limit?: number;

  /** Namespace to filter results */
  namespace?: string;

  /** Minimum similarity score (0-1) */
  minScore?: number;
}

/**
 * Search result containing memory data and metadata
 */
export interface MemorySearchResult {
  /** Memory key */
  key: string;

  /** Decoded memory value */
  value: string;

  /** Namespace of the memory */
  namespace: string;

  /** Similarity score (0-1) */
  score: number;

  /** Graph node ID */
  nodeId: NodeID;

  /** Related memory nodes (if requested) */
  related?: Array<{
    key: string;
    value: string;
    relation: RelationType;
  }>;
}

/**
 * Interface for embedding providers
 * Used by AnalogicalEngine for cross-domain pattern embeddings
 */
export interface IEmbeddingProvider {
  /**
   * Generate embedding vector for text
   * @param text - Text to embed
   * @returns 1536-dimensional embedding vector
   */
  embed(text: string): Promise<Float32Array>;

  /**
   * Generate embeddings for multiple texts in batch (optional but recommended)
   * Falls back to sequential embed() calls if not implemented
   * @param texts - Array of texts to embed
   * @returns Array of 1536-dimensional embedding vectors
   */
  embedBatch?(texts: string[]): Promise<Float32Array[]>;

  /**
   * Check if the embedding provider is available
   * @returns true if provider is ready
   */
  isAvailable?(): Promise<boolean>;

  /**
   * Get provider name for debugging/logging
   */
  getProviderName?(): string;

  /**
   * Get embedding dimensions (default: 1536)
   */
  getDimensions?(): number;
}
