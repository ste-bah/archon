/**
 * Causal Loop Detector
 * TASK-HYPEREDGE-001
 *
 * DFS-based cycle detection for causal chains
 * Constitution: HYPER-05 - detect loops before chain creation
 */

import type { NodeID } from '../../graph-db/types.js';
import type { CausalNode, CausalLoop } from '../hyperedge-types.js';
import { logger } from '../../observability/index.js';

/**
 * Detects cycles in a directed graph using DFS
 * Constitution: HYPER-05 - DFS loop detection
 */
export class LoopDetector {
  private visitedNodes: Set<NodeID>;
  private recursionStack: Set<NodeID>;
  private detectedCycles: CausalLoop[];

  constructor() {
    this.visitedNodes = new Set();
    this.recursionStack = new Set();
    this.detectedCycles = [];
  }

  /**
   * Detect all cycles in a causal chain
   *
   * @param nodes - Nodes in the causal chain
   * @param chainId - Chain ID for cycle metadata
   * @returns Array of detected cycles
   *
   * Constitution: HYPER-05 - DFS-based detection
   */
  public detectLoops(nodes: CausalNode[], chainId: string): CausalLoop[] {
    const startTime = Date.now();

    // Reset state
    this.visitedNodes.clear();
    this.recursionStack.clear();
    this.detectedCycles = [];

    // Build adjacency list for efficient traversal
    const adjacency = this.buildAdjacencyList(nodes);

    // Run DFS from each unvisited node
    for (const node of nodes) {
      if (!this.visitedNodes.has(node.id)) {
        this.dfsDetectCycle(node.id, adjacency, chainId, []);
      }
    }

    const executionTime = Date.now() - startTime;
    logger.debug('Loop detection completed', {
      chainId,
      cyclesFound: this.detectedCycles.length,
      executionTime,
      nodesChecked: nodes.length,
    });

    return this.detectedCycles;
  }

  /**
   * DFS traversal to detect cycles
   *
   * @param nodeId - Current node ID
   * @param adjacency - Adjacency list representation
   * @param chainId - Chain ID for metadata
   * @param path - Current path for cycle reconstruction
   */
  private dfsDetectCycle(
    nodeId: NodeID,
    adjacency: Map<NodeID, NodeID[]>,
    chainId: string,
    path: NodeID[]
  ): void {
    // Mark node as visited and add to recursion stack
    this.visitedNodes.add(nodeId);
    this.recursionStack.add(nodeId);
    path.push(nodeId);

    // Visit all neighbors
    const neighbors = adjacency.get(nodeId) || [];
    for (const neighborId of neighbors) {
      if (!this.visitedNodes.has(neighborId)) {
        // Recurse to unvisited neighbor
        this.dfsDetectCycle(neighborId, adjacency, chainId, path);
      } else if (this.recursionStack.has(neighborId)) {
        // Found a cycle - neighbor is in current recursion stack
        const cycleStartIndex = path.indexOf(neighborId);
        const cycleNodes = path.slice(cycleStartIndex);

        // Create cycle record
        const cycle: CausalLoop = {
          id: `loop-${chainId}-${this.detectedCycles.length}`,
          nodes: cycleNodes,
          chainId,
          timestamp: Date.now(),
        };

        this.detectedCycles.push(cycle);

        logger.warn('Causal cycle detected', {
          chainId,
          cycleId: cycle.id,
          cycleLength: cycleNodes.length,
          nodes: cycleNodes,
        });
      }
    }

    // Remove from recursion stack (backtrack)
    this.recursionStack.delete(nodeId);
    path.pop();
  }

  /**
   * Build adjacency list from causal nodes
   *
   * @param nodes - Causal nodes
   * @returns Adjacency list (node -> effects)
   */
  private buildAdjacencyList(nodes: CausalNode[]): Map<NodeID, NodeID[]> {
    const adjacency = new Map<NodeID, NodeID[]>();

    for (const node of nodes) {
      adjacency.set(node.id, node.effects);
    }

    return adjacency;
  }

  /**
   * Check if adding an edge would create a cycle
   * Fast check for single edge addition
   *
   * @param from - Source node ID
   * @param to - Target node ID
   * @param nodes - Existing causal nodes
   * @returns True if edge would create a cycle
   */
  public wouldCreateCycle(from: NodeID, to: NodeID, nodes: CausalNode[]): boolean {
    // Build temporary adjacency list with new edge
    const adjacency = this.buildAdjacencyList(nodes);
    const existingEffects = adjacency.get(from) || [];
    adjacency.set(from, [...existingEffects, to]);

    // Check if we can reach 'from' starting from 'to'
    const visited = new Set<NodeID>();
    return this.canReach(to, from, adjacency, visited);
  }

  /**
   * Check if target is reachable from source
   *
   * @param source - Source node ID
   * @param target - Target node ID
   * @param adjacency - Adjacency list
   * @param visited - Visited nodes (for cycle prevention in this check)
   * @returns True if target is reachable from source
   */
  private canReach(
    source: NodeID,
    target: NodeID,
    adjacency: Map<NodeID, NodeID[]>,
    visited: Set<NodeID>
  ): boolean {
    if (source === target) {
      return true;
    }

    if (visited.has(source)) {
      return false;
    }

    visited.add(source);

    const neighbors = adjacency.get(source) || [];
    for (const neighbor of neighbors) {
      if (this.canReach(neighbor, target, adjacency, visited)) {
        return true;
      }
    }

    return false;
  }
}

/**
 * Validate that a causal chain has no cycles
 *
 * @param nodes - Causal nodes
 * @param chainId - Chain ID
 * @returns Validation result
 *
 * Constitution: HYPER-05 - validate before creation
 */
export function validateNoCycles(nodes: CausalNode[], chainId: string): {
  valid: boolean;
  cycles: CausalLoop[];
} {
  const detector = new LoopDetector();
  const cycles = detector.detectLoops(nodes, chainId);

  return {
    valid: cycles.length === 0,
    cycles,
  };
}
