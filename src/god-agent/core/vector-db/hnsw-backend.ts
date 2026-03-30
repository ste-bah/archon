/**
 * God Agent HNSW Backend Interface
 *
 * Implements: TASK-VDB-001
 * Referenced by: VectorDB implementation
 *
 * Defines the contract for HNSW index backends.
 * Allows for different implementations (TypeScript fallback, native WASM, etc.)
 */

import { VectorID, SearchResult } from './types.js';

/**
 * Interface for HNSW index backend implementations
 * All vectors passed to/from backend are assumed to be validated
 */
export interface IHNSWBackend {
  /**
   * Insert a vector into the index
   *
   * @param id - Unique vector identifier
   * @param vector - The vector data (VECTOR_DIM (1536D), L2-normalized, validated)
   */
  insert(id: VectorID, vector: Float32Array): void;

  /**
   * Search for k nearest neighbors
   *
   * @param query - Query vector (VECTOR_DIM (1536D), L2-normalized, validated)
   * @param k - Number of neighbors to return
   * @param includeVectors - Whether to include vector data in results
   * @returns Array of search results, sorted by similarity (best first)
   */
  search(query: Float32Array, k: number, includeVectors?: boolean): SearchResult[];

  /**
   * Retrieve a vector by ID
   *
   * @param id - Vector identifier
   * @returns The vector if found, undefined otherwise
   */
  getVector(id: VectorID): Float32Array | undefined;

  /**
   * Delete a vector from the index
   *
   * @param id - Vector identifier to delete
   * @returns true if vector was deleted, false if not found
   */
  delete(id: VectorID): boolean;

  /**
   * Get the number of vectors in the index
   *
   * @returns Vector count
   */
  count(): number;

  /**
   * Save the index to persistent storage
   *
   * @param path - Path to save to (typically .agentdb/vectors.bin)
   */
  save(path: string): Promise<void>;

  /**
   * Load the index from persistent storage
   *
   * @param path - Path to load from (typically .agentdb/vectors.bin)
   * @returns true if loaded successfully, false if file doesn't exist
   */
  load(path: string): Promise<boolean>;

  /**
   * Clear all vectors from the index
   */
  clear(): void;
}
