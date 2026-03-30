/**
 * Vector Source Adapter
 * Wraps NativeHNSW for quad-fusion search
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-SEARCH-004
 *
 * @module src/god-agent/core/search/adapters/vector-adapter
 */

import type { NativeHNSW } from '../../vector-db/native-hnsw.js';
import type { SearchResult } from '../../vector-db/types.js';
import type {
  SourceExecutionResult,
  RawSourceResult,
} from '../search-types.js';
import { withTimeout, TimeoutError, generateResultId } from '../utils.js';

/**
 * Adapter for vector similarity search via NativeHNSW
 */
export class VectorSourceAdapter {
  private readonly vectorDb: NativeHNSW;

  /**
   * Create vector source adapter
   * @param vectorDb - NativeHNSW instance
   */
  constructor(vectorDb: NativeHNSW) {
    this.vectorDb = vectorDb;
  }

  /**
   * Execute vector similarity search
   *
   * @param embedding - Query embedding (VECTOR_DIM dimensions, default 1536)
   * @param topK - Maximum results to return
   * @param timeoutMs - Timeout in milliseconds
   * @returns Source execution result
   */
  async search(
    embedding: Float32Array | undefined,
    topK: number,
    timeoutMs: number
  ): Promise<SourceExecutionResult> {
    const startTime = performance.now();

    // Handle missing embedding gracefully
    if (!embedding) {
      return {
        status: 'success',
        results: [],
        durationMs: performance.now() - startTime,
      };
    }

    try {
      const searchPromise = this.executeSearch(embedding, topK);
      const results = await withTimeout(searchPromise, timeoutMs, 'vector');

      return {
        status: 'success',
        results,
        durationMs: performance.now() - startTime,
      };
    } catch (error) {
      const durationMs = performance.now() - startTime;

      if (error instanceof TimeoutError) {
        return {
          status: 'timeout',
          durationMs,
        };
      }

      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs,
      };
    }
  }

  /**
   * Execute the underlying vector search
   */
  private async executeSearch(
    embedding: Float32Array,
    topK: number
  ): Promise<RawSourceResult[]> {
    // NativeHNSW.search is synchronous but may throw if not available
    let searchResults: SearchResult[];
    try {
      searchResults = this.vectorDb.search(embedding, topK);
    } catch (error) {
      // Handle "Native HNSW not available" error gracefully
      if (error instanceof Error && error.message.includes('not available')) {
        return [];
      }
      // RULE-070: Re-throw with operation context
      throw new Error(
        `Vector search failed (topK: ${topK}): ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }

    return searchResults.map((result, index) => ({
      source: 'vector' as const,
      id: generateResultId('vector', index),
      content: result.id, // Vector ID is the content reference
      score: this.normalizeVectorScore(result.similarity),
      metadata: {
        vectorId: result.id,
        originalSimilarity: result.similarity,
        hasVector: result.vector !== undefined,
      },
    }));
  }

  /**
   * Normalize vector similarity score to [0, 1]
   * Assumes cosine similarity which is already [-1, 1]
   */
  private normalizeVectorScore(similarity: number): number {
    // Cosine similarity: map [-1, 1] to [0, 1]
    return (similarity + 1) / 2;
  }
}
