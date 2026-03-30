/**
 * Vector Service - IPC wrapper for NativeHNSW/FallbackHNSW
 * TASK-DAEMON-003: Service Registry & Integration
 *
 * Exposes vector database operations via JSON-RPC 2.0
 */

import type { IHNSWBackend } from '../../vector-db/hnsw-backend.js';
import { createServiceHandler, type ServiceHandler } from '../service-registry.js';

/**
 * Vector service parameters
 */
export interface IVectorAddParams {
  id: string;
  vector: number[];
}

export interface IVectorSearchParams {
  query: number[];
  k: number;
  includeVectors?: boolean;
}

export interface IVectorGetParams {
  id: string;
}

export interface IVectorDeleteParams {
  id: string;
}

/**
 * Vector service responses
 */
export interface IVectorSearchResult {
  id: string;
  similarity: number;
  vector?: number[];
}

export interface IVectorStatsResult {
  count: number;
  dimension: number;
}

/**
 * Create vector service handler
 *
 * @param backend - HNSW backend implementation (FallbackHNSW or NativeHNSW)
 * @returns Service handler with method map
 */
export function createVectorService(backend: IHNSWBackend): ServiceHandler {
  return createServiceHandler({
    /**
     * Add vector to index
     */
    add: async (params: IVectorAddParams) => {
      const { id, vector } = params;
      if (!id || !vector) {
        throw new Error('id and vector are required');
      }
      backend.insert(id, new Float32Array(vector));
      return { success: true };
    },

    /**
     * Search for k nearest neighbors
     */
    search: async (params: IVectorSearchParams) => {
      const { query, k, includeVectors = false } = params;
      if (!query || !k) {
        throw new Error('query and k are required');
      }
      const results = backend.search(
        new Float32Array(query),
        k,
        includeVectors
      );
      return results.map((r) => ({
        id: r.id,
        similarity: r.similarity,
        vector: r.vector ? Array.from(r.vector) : undefined,
      }));
    },

    /**
     * Get vector by ID
     */
    get: async (params: IVectorGetParams) => {
      const { id } = params;
      if (!id) {
        throw new Error('id is required');
      }
      const vector = backend.getVector(id);
      if (!vector) {
        return { found: false };
      }
      return {
        found: true,
        vector: Array.from(vector),
      };
    },

    /**
     * Delete vector by ID
     */
    delete: async (params: IVectorDeleteParams) => {
      const { id } = params;
      if (!id) {
        throw new Error('id is required');
      }
      const deleted = backend.delete(id);
      return { deleted };
    },

    /**
     * Get vector database statistics
     */
    stats: async () => {
      return {
        count: backend.count(),
        dimension: 1536, // Fixed dimension for God Agent (text-embedding-3-large)
      };
    },

    /**
     * Clear all vectors
     */
    clear: async () => {
      backend.clear();
      return { success: true };
    },
  });
}
