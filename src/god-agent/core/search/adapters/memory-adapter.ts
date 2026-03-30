/**
 * Memory Source Adapter
 * Wraps MemoryClient for quad-fusion search
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-SEARCH-004
 *
 * @module src/god-agent/core/search/adapters/memory-adapter
 */

import type { MemoryClient } from '../../memory-server/memory-client.js';
import type {
  IQueryPatternsParams,
  IQueryPatternsResult,
  IPatternMatch,
} from '../../types/memory-types.js';
import type {
  SourceExecutionResult,
  RawSourceResult,
} from '../search-types.js';
import { withTimeout, TimeoutError, generateResultId } from '../utils.js';

/**
 * Adapter for memory-based pattern search via MemoryClient
 */
export class MemorySourceAdapter {
  private readonly memoryClient: MemoryClient;

  /**
   * Create memory source adapter
   * @param memoryClient - MemoryClient instance
   */
  constructor(memoryClient: MemoryClient) {
    this.memoryClient = memoryClient;
  }

  /**
   * Execute memory pattern search
   *
   * @param query - Search query string
   * @param namespace - Memory namespace (used for type filter)
   * @param timeoutMs - Timeout in milliseconds
   * @returns Source execution result
   */
  async search(
    query: string,
    namespace: string,
    timeoutMs: number
  ): Promise<SourceExecutionResult> {
    const startTime = performance.now();

    if (!query || query.trim().length === 0) {
      return {
        status: 'success',
        results: [],
        durationMs: performance.now() - startTime,
      };
    }

    try {
      const searchPromise = this.executeSearch(query, namespace);
      const results = await withTimeout(searchPromise, timeoutMs, 'memory');

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
   * Execute memory pattern query
   */
  private async executeSearch(
    query: string,
    _namespace: string
  ): Promise<RawSourceResult[]> {
    // Check if client is connected
    if (!this.memoryClient.isConnected()) {
      // Return empty results if not connected (graceful degradation)
      return [];
    }

    const params: IQueryPatternsParams = {
      query,
      type: 'semantic',
      maxResults: 20,
      confidenceThreshold: 0.3,
    };

    let result: IQueryPatternsResult;
    try {
      result = await this.memoryClient.queryPatterns(params);
    } catch (error) {
      // Handle connection errors gracefully
      if (error instanceof Error &&
          (error.message.includes('not connected') ||
           error.message.includes('disconnected'))) {
        return [];
      }
      // RULE-070: Re-throw with operation context
      throw new Error(
        `Memory search failed for query "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}" (namespace: ${_namespace}): ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }

    return result.patterns.map((pattern, index) =>
      this.patternToResult(pattern, index)
    );
  }

  /**
   * Convert pattern match to raw source result
   */
  private patternToResult(pattern: IPatternMatch, index: number): RawSourceResult {
    return {
      source: 'memory' as const,
      id: generateResultId('memory', index),
      content: pattern.content,
      score: pattern.confidence,
      metadata: {
        patternId: pattern.id,
        originalConfidence: pattern.confidence,
        ...pattern.metadata,
      },
    };
  }
}
