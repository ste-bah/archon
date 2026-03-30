/**
 * GNN Service - IPC wrapper for GNNEnhancer
 * TASK-DAEMON-003: Service Registry & Integration
 *
 * Exposes GNN enhancement operations via JSON-RPC 2.0
 */

import type { GNNEnhancer } from '../../reasoning/gnn-enhancer.js';
import { createServiceHandler, type ServiceHandler } from '../service-registry.js';

/**
 * GNN service parameters
 */
export interface IGNNEnhanceParams {
  embedding: number[]; // VECTOR_DIM (1536D)
  trajectoryGraph?: {
    nodes: Array<{
      id: string;
      embedding: number[];
      metadata?: Record<string, unknown>;
    }>;
    edges?: Array<{
      source: string;
      target: string;
      weight: number;
    }>;
  };
}

/**
 * Create GNN service handler
 *
 * @param gnnEnhancer - GNNEnhancer instance
 * @returns Service handler with method map
 */
export function createGNNService(gnnEnhancer: GNNEnhancer): ServiceHandler {
  return createServiceHandler({
    /**
     * Enhance embedding using GNN
     */
    enhance: async (params: IGNNEnhanceParams) => {
      const { embedding, trajectoryGraph } = params;
      if (!embedding) {
        throw new Error('embedding is required');
      }

      // Convert to Float32Array
      const embeddingArray = new Float32Array(embedding);

      // Convert trajectory graph if provided
      const graph = trajectoryGraph
        ? {
          nodes: trajectoryGraph.nodes.map((n) => ({
            id: n.id,
            embedding: new Float32Array(n.embedding),
            metadata: n.metadata,
          })),
          edges: trajectoryGraph.edges,
        }
        : undefined;

      const result = await gnnEnhancer.enhance(embeddingArray, graph);

      return {
        enhanced: Array.from(result.enhanced),
        original: Array.from(result.original),
        enhancementTime: result.enhancementTime,
        cached: result.cached,
      };
    },

    /**
     * Get GNN metrics
     */
    getMetrics: async () => {
      const metrics = gnnEnhancer.getMetrics();
      return {
        totalEnhancements: metrics.totalEnhancements,
        cacheHitRate: metrics.cacheHitRate,
        averageTimeMs: metrics.averageTimeMs,
      };
    },

    /**
     * Clear GNN cache
     */
    clearCache: async () => {
      gnnEnhancer.clearCache();
      return { success: true };
    },

    /**
     * Get cache statistics
     */
    getCacheStats: async () => {
      const stats = gnnEnhancer.getCacheStats();
      return {
        size: stats.size,
        maxSize: stats.maxSize,
        hitRate: stats.hitRate,
        totalEnhancements: stats.totalEnhancements,
        totalCacheHits: stats.totalCacheHits,
        averageEnhancementTime: stats.averageEnhancementTime,
      };
    },
  });
}
