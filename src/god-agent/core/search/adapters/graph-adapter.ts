/**
 * Graph Source Adapter
 * Wraps FallbackGraph for quad-fusion search
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-SEARCH-004
 *
 * @module src/god-agent/core/search/adapters/graph-adapter
 */

import type { FallbackGraph } from '../../graph-db/fallback-graph.js';
import type { INode } from '../../graph-db/types.js';
import type {
  SourceExecutionResult,
  RawSourceResult,
} from '../search-types.js';
import { withTimeout, TimeoutError, generateResultId } from '../utils.js';

/**
 * Adapter for graph-based search via FallbackGraph
 */
export class GraphSourceAdapter {
  private readonly graphDb: FallbackGraph;

  /**
   * Create graph source adapter
   * @param graphDb - FallbackGraph instance
   */
  constructor(graphDb: FallbackGraph) {
    this.graphDb = graphDb;
  }

  /**
   * Execute graph search by query text matching
   *
   * @param query - Search query string
   * @param depth - Traversal depth (not used in simple search)
   * @param timeoutMs - Timeout in milliseconds
   * @returns Source execution result
   */
  async search(
    query: string,
    depth: number,
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
      const searchPromise = this.executeSearch(query, depth);
      const results = await withTimeout(searchPromise, timeoutMs, 'graph');

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
   * Execute graph search by matching node properties
   */
  private async executeSearch(
    query: string,
    _depth: number
  ): Promise<RawSourceResult[]> {
    const allNodes = await this.graphDb.getAllNodes();
    const queryLower = query.toLowerCase();
    const results: RawSourceResult[] = [];

    for (const node of allNodes) {
      const matchScore = this.scoreNodeMatch(node, queryLower);
      if (matchScore > 0) {
        const content = this.nodeToContent(node);
        results.push({
          source: 'graph' as const,
          id: generateResultId('graph', results.length),
          content,
          score: matchScore,
          metadata: {
            nodeId: node.id,
            nodeType: node.type,
            createdAt: node.createdAt,
            hasEmbedding: node.embedding !== undefined,
          },
        });
      }
    }

    // Sort by score descending
    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Score how well a node matches the query
   */
  private scoreNodeMatch(node: INode, queryLower: string): number {
    let score = 0;

    // Check node type
    if (node.type.toLowerCase().includes(queryLower)) {
      score += 0.5;
    }

    // Check node ID
    if (node.id.toLowerCase().includes(queryLower)) {
      score += 0.3;
    }

    // Check properties
    const propsStr = JSON.stringify(node.properties).toLowerCase();
    if (propsStr.includes(queryLower)) {
      // Boost based on number of matches
      const matches = propsStr.split(queryLower).length - 1;
      score += Math.min(0.5, matches * 0.1);
    }

    return Math.min(1.0, score);
  }

  /**
   * Convert node to content string
   */
  private nodeToContent(node: INode): string {
    const parts: string[] = [
      `Node: ${node.id}`,
      `Type: ${node.type}`,
    ];

    // Add relevant properties
    if (Object.keys(node.properties).length > 0) {
      parts.push(`Properties: ${JSON.stringify(node.properties)}`);
    }

    return parts.join(' | ');
  }
}
