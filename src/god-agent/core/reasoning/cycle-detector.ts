/**
 * CycleDetector - Fast cycle detection for causal hypergraphs
 * Prevents infinite loops in causal chains with <5ms performance guarantee
 */

import type { CausalLink, NodeID, CycleCheckResult } from './causal-types.js';

/**
 * Internal representation of the graph for cycle detection
 */
interface GraphStructure {
  nodes: Map<NodeID, CausalNode>;
  links: Map<string, CausalLink>;
  forwardIndex: Map<NodeID, Set<string>>;
  backwardIndex: Map<NodeID, Set<string>>;
}

interface CausalNode {
  id: NodeID;
  label: string;
  type: string;
}

/**
 * Cache entry for cycle detection results
 */
interface CycleCache {
  /** Key: "sourceId->targetId" */
  results: Map<string, boolean>;
  /** Maximum cache size before eviction */
  maxSize: number;
  /** LRU tracking */
  accessOrder: string[];
}

/**
 * High-performance cycle detector for causal hypergraphs
 * Uses BFS with caching to achieve <5ms detection time
 */
export class CycleDetector {
  private cache: CycleCache;

  constructor(cacheSize: number = 1000) {
    this.cache = {
      results: new Map(),
      maxSize: cacheSize,
      accessOrder: [],
    };
  }

  /**
   * Check if adding a new causal link would create a cycle
   * Performance: <5ms per check
   *
   * @param graph - Current graph structure
   * @param newLink - Proposed causal link to add
   * @returns Result indicating if cycle would be created
   */
  wouldCreateCycle(graph: GraphStructure, newLink: CausalLink): CycleCheckResult {
    const startTime = performance.now();

    // For multi-cause hyperedges, check if any effect can reach any cause
    // If effect E can already reach cause C, then adding C→E creates a cycle
    for (const effectId of newLink.effects) {
      for (const causeId of newLink.causes) {
        // Check if there's a path from effect back to cause
        if (this.hasPath(graph, effectId, causeId)) {
          const checkTime = performance.now() - startTime;
          return {
            wouldCreateCycle: true,
            cyclePath: this.findPath(graph, effectId, causeId),
            checkTime,
          };
        }
      }
    }

    const checkTime = performance.now() - startTime;
    return {
      wouldCreateCycle: false,
      checkTime,
    };
  }

  /**
   * Check if there's a directed path from source to target
   * Uses BFS with cycle detection and caching
   *
   * @param graph - Graph structure to search
   * @param sourceId - Starting node
   * @param targetId - Target node to reach
   * @returns true if path exists
   */
  hasPath(graph: GraphStructure, sourceId: NodeID, targetId: NodeID): boolean {
    // Same node check
    if (sourceId === targetId) {
      return true;
    }

    // Check cache
    const cacheKey = `${sourceId}->${targetId}`;
    const cached = this.getCached(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    // BFS to find path
    const visited = new Set<NodeID>();
    const queue: NodeID[] = [sourceId];
    visited.add(sourceId);

    while (queue.length > 0) {
      const currentId = queue.shift()!;

      // Get all outgoing links from current node
      const outgoingLinkIds = graph.forwardIndex.get(currentId);
      if (!outgoingLinkIds) {
        continue;
      }

      // Explore each outgoing link
      for (const linkId of outgoingLinkIds) {
        const link = graph.links.get(linkId);
        if (!link) {
          continue;
        }

        // Check all effects of this link
        for (const effectId of link.effects) {
          if (effectId === targetId) {
            // Found path!
            this.setCached(cacheKey, true);
            return true;
          }

          if (!visited.has(effectId)) {
            visited.add(effectId);
            queue.push(effectId);
          }
        }
      }
    }

    // No path found
    this.setCached(cacheKey, false);
    return false;
  }

  /**
   * Find actual path from source to target (for cycle reporting)
   * Uses BFS with parent tracking
   *
   * @param graph - Graph structure
   * @param sourceId - Starting node
   * @param targetId - Target node
   * @returns Array of node IDs forming the path, or empty if no path
   */
  private findPath(graph: GraphStructure, sourceId: NodeID, targetId: NodeID): NodeID[] {
    if (sourceId === targetId) {
      return [sourceId];
    }

    const visited = new Set<NodeID>();
    const parent = new Map<NodeID, NodeID>();
    const queue: NodeID[] = [sourceId];
    visited.add(sourceId);

    while (queue.length > 0) {
      const currentId = queue.shift()!;

      const outgoingLinkIds = graph.forwardIndex.get(currentId);
      if (!outgoingLinkIds) {
        continue;
      }

      for (const linkId of outgoingLinkIds) {
        const link = graph.links.get(linkId);
        if (!link) {
          continue;
        }

        for (const effectId of link.effects) {
          if (!visited.has(effectId)) {
            visited.add(effectId);
            parent.set(effectId, currentId);

            if (effectId === targetId) {
              // Reconstruct path
              return this.reconstructPath(parent, sourceId, targetId);
            }

            queue.push(effectId);
          }
        }
      }
    }

    return [];
  }

  /**
   * Reconstruct path from parent map
   */
  private reconstructPath(
    parent: Map<NodeID, NodeID>,
    sourceId: NodeID,
    targetId: NodeID
  ): NodeID[] {
    const path: NodeID[] = [];
    let current: NodeID | undefined = targetId;

    while (current !== undefined) {
      path.unshift(current);
      if (current === sourceId) {
        break;
      }
      current = parent.get(current);
    }

    return path;
  }

  /**
   * Get cached result with LRU tracking
   */
  private getCached(key: string): boolean | undefined {
    const result = this.cache.results.get(key);
    if (result !== undefined) {
      // Update LRU
      const index = this.cache.accessOrder.indexOf(key);
      if (index > -1) {
        this.cache.accessOrder.splice(index, 1);
      }
      this.cache.accessOrder.push(key);
    }
    return result;
  }

  /**
   * Set cached result with LRU eviction
   */
  private setCached(key: string, value: boolean): void {
    // Evict if at capacity
    if (this.cache.results.size >= this.cache.maxSize && !this.cache.results.has(key)) {
      const evictKey = this.cache.accessOrder.shift();
      if (evictKey) {
        this.cache.results.delete(evictKey);
      }
    }

    this.cache.results.set(key, value);
    this.cache.accessOrder.push(key);
  }

  /**
   * Clear the cycle detection cache
   */
  clearCache(): void {
    this.cache.results.clear();
    this.cache.accessOrder = [];
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxSize: number; hitRate?: number } {
    return {
      size: this.cache.results.size,
      maxSize: this.cache.maxSize,
    };
  }
}
