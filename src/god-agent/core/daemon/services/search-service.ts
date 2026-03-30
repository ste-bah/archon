/**
 * Search Service - IPC wrapper for UnifiedSearch
 * TASK-DAEMON-003: Service Registry & Integration
 *
 * Exposes quad-fusion search operations via JSON-RPC 2.0
 */

import type { UnifiedSearch } from '../../search/unified-search.js';
import type { QuadFusionOptions, SourceWeights } from '../../search/search-types.js';
import { createServiceHandler, type ServiceHandler } from '../service-registry.js';

/**
 * Search service parameters
 */
export interface ISearchQueryParams {
  query: string;
  embedding?: number[];
  options?: Partial<QuadFusionOptions>;
}

export interface ISearchUpdateWeightsParams {
  weights: Partial<SourceWeights>;
}

/**
 * Create search service handler
 *
 * @param unifiedSearch - UnifiedSearch instance
 * @returns Service handler with method map
 */
export function createSearchService(unifiedSearch: UnifiedSearch): ServiceHandler {
  return createServiceHandler({
    /**
     * Execute quad-fusion search
     */
    query: async (params: ISearchQueryParams) => {
      const { query, embedding, options } = params;
      if (!query) {
        throw new Error('query is required');
      }

      const embeddingArray = embedding ? new Float32Array(embedding) : undefined;
      const result = await unifiedSearch.search(query, embeddingArray, options);

      return {
        query: result.query,
        results: result.results.map((r) => ({
          id: r.id,
          score: r.score,
          sources: r.sources,
          metadata: r.metadata,
        })),
        metadata: result.metadata,
        sourceStats: Object.fromEntries(
          Object.entries(result.sourceStats).map(([source, stat]) => [
            source,
            {
              responded: stat.responded,
              durationMs: stat.durationMs,
              resultCount: stat.resultCount,
              timedOut: stat.timedOut,
              error: stat.error,
            },
          ])
        ),
      };
    },

    /**
     * Update source weights
     */
    updateWeights: async (params: ISearchUpdateWeightsParams) => {
      const { weights } = params;
      if (!weights) {
        throw new Error('weights are required');
      }
      unifiedSearch.updateWeights(weights);
      return { success: true };
    },

    /**
     * Get current options
     */
    getOptions: async () => {
      const options = unifiedSearch.getOptions();
      return {
        weights: options.weights,
        topK: options.topK,
        sourceTimeoutMs: options.sourceTimeoutMs,
        graphDepth: options.graphDepth,
        memoryNamespace: options.memoryNamespace,
        minPatternConfidence: options.minPatternConfidence,
      };
    },

    /**
     * Get search statistics
     */
    stats: async () => {
      const options = unifiedSearch.getOptions();
      return {
        weightsConfigured: options.weights,
        topK: options.topK,
        sourceTimeoutMs: options.sourceTimeoutMs,
      };
    },
  });
}
