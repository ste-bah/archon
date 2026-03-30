/**
 * Label Propagation Community Detection Algorithm
 *
 * Fast iterative algorithm where nodes adopt most frequent label among neighbors.
 * Performance: O(n + m) - must complete in <500ms for 10k nodes (HYPER-07)
 *
 * Algorithm:
 * 1. Initialize each node with unique label
 * 2. Iterate: each node adopts most frequent label among neighbors
 * 3. Break ties by node ID (deterministic)
 * 4. Stop when labels converge (no changes)
 */

import type { NodeID, Community, CommunityDetectionResult } from '../hyperedge-types.js';

interface Graph {
  nodes: string[];
  edges: Map<string, Set<string>>;
  weights: Map<string, Map<string, number>>;
}

interface LabelCount {
  label: string;
  count: number;
  maxNodeId: string; // For deterministic tie-breaking
}

export class LabelPropagationDetector {
  private graph: Graph;
  private labels: Map<string, string>; // nodeId -> label
  private minCommunitySize = 3;
  private maxIterations = 100;
  private convergenceThreshold = 0.95; // 95% nodes unchanged (faster convergence)

  constructor(minCommunitySize = 3, maxIterations = 100) {
    this.minCommunitySize = minCommunitySize;
    this.maxIterations = maxIterations;
    this.graph = { nodes: [], edges: new Map(), weights: new Map() };
    this.labels = new Map();
  }

  /**
   * Detect communities using Label Propagation algorithm
   * @param nodes Array of node IDs
   * @param edges Array of [source, target] or [source, target, weight] tuples
   * @returns Community detection result
   */
  public detect(
    nodes: NodeID[],
    edges: Array<[NodeID, NodeID] | [NodeID, NodeID, number]>
  ): CommunityDetectionResult {
    const startTime = performance.now();

    // Initialize graph
    this.initializeGraph(nodes, edges);

    // Iterative label propagation
    let iterations = 0;
    let converged = false;

    while (!converged && iterations < this.maxIterations) {
      const changes = this.propagateLabels();
      converged = this.checkConvergence(changes, nodes.length);
      iterations++;
    }

    // Build final communities
    const communities = this.buildCommunities();
    const modularity = this.calculateModularity();
    const executionTime = performance.now() - startTime;

    return {
      communities,
      modularity,
      executionTime,
      iterations,
    };
  }

  /**
   * Initialize graph structure with nodes and edges
   */
  private initializeGraph(
    nodes: NodeID[],
    edges: Array<[NodeID, NodeID] | [NodeID, NodeID, number]>
  ): void {
    // Initialize nodes
    this.graph.nodes = [...nodes];
    this.graph.edges = new Map();
    this.graph.weights = new Map();

    for (const node of nodes) {
      this.graph.edges.set(node, new Set());
      this.graph.weights.set(node, new Map());
      // Each node starts with its own label
      this.labels.set(node, node);
    }

    // Initialize edges and weights
    for (const edge of edges) {
      const [source, target, weight = 1.0] = edge;

      // Add edge (undirected)
      this.graph.edges.get(source)?.add(target);
      this.graph.edges.get(target)?.add(source);

      // Add weight
      this.graph.weights.get(source)?.set(target, weight);
      this.graph.weights.get(target)?.set(source, weight);
    }
  }

  /**
   * Propagate labels: each node adopts most frequent label among neighbors
   * @returns Number of nodes that changed labels
   */
  private propagateLabels(): number {
    let changes = 0;
    const newLabels = new Map<string, string>();

    // Randomize node order to avoid bias
    const shuffledNodes = this.shuffleArray([...this.graph.nodes]);

    for (const nodeId of shuffledNodes) {
      const currentLabel = this.labels.get(nodeId)!;
      const newLabel = this.getMostFrequentNeighborLabel(nodeId);

      if (newLabel !== currentLabel) {
        changes++;
      }

      newLabels.set(nodeId, newLabel);
    }

    // Update all labels simultaneously
    this.labels = newLabels;

    return changes;
  }

  /**
   * Get most frequent label among node's neighbors
   * Breaks ties deterministically by choosing label with largest node ID
   */
  private getMostFrequentNeighborLabel(nodeId: string): string {
    const neighbors = this.graph.edges.get(nodeId)!;

    // No neighbors - keep current label
    if (neighbors.size === 0) {
      return this.labels.get(nodeId)!;
    }

    const nodeWeights = this.graph.weights.get(nodeId)!;
    const labelCounts = new Map<string, LabelCount>();

    // Count weighted labels
    for (const neighbor of neighbors) {
      const label = this.labels.get(neighbor)!;
      const weight = nodeWeights.get(neighbor) || 1.0;

      const current = labelCounts.get(label);
      if (current) {
        current.count += weight;
        // Track max node ID for tie-breaking
        if (neighbor > current.maxNodeId) {
          current.maxNodeId = neighbor;
        }
      } else {
        labelCounts.set(label, {
          label,
          count: weight,
          maxNodeId: neighbor,
        });
      }
    }

    // Find most frequent label (deterministic tie-breaking)
    let maxCount = 0;
    let bestLabel = this.labels.get(nodeId)!;
    let bestNodeId = nodeId;

    for (const [label, data] of labelCounts) {
      if (
        data.count > maxCount ||
        (data.count === maxCount && data.maxNodeId > bestNodeId)
      ) {
        maxCount = data.count;
        bestLabel = label;
        bestNodeId = data.maxNodeId;
      }
    }

    return bestLabel;
  }

  /**
   * Check if algorithm has converged
   */
  private checkConvergence(changes: number, totalNodes: number): boolean {
    const unchangedRatio = (totalNodes - changes) / totalNodes;
    return unchangedRatio >= this.convergenceThreshold;
  }

  /**
   * Build final community list, filtering by minimum size
   */
  private buildCommunities(): Community[] {
    const communityMap = new Map<string, string[]>();

    for (const [nodeId, label] of this.labels) {
      if (!communityMap.has(label)) {
        communityMap.set(label, []);
      }
      communityMap.get(label)!.push(nodeId);
    }

    const communities: Community[] = [];
    const timestamp = Date.now();

    for (const [label, members] of communityMap) {
      // Filter by minimum size (HYPER-08)
      if (members.length >= this.minCommunitySize) {
        const cohesion = this.calculateCommunityCohesion(members);

        communities.push({
          id: label,
          members,
          cohesion,
          algorithm: 'label-propagation',
          timestamp,
        });
      }
    }

    return communities;
  }

  /**
   * Calculate community cohesion (internal density)
   */
  private calculateCommunityCohesion(members: string[]): number {
    if (members.length < 2) return 1.0;

    let internalEdges = 0;
    let totalWeight = 0;
    const maxEdges = (members.length * (members.length - 1)) / 2;

    const memberSet = new Set(members);

    for (const nodeId of members) {
      const neighbors = this.graph.edges.get(nodeId);
      if (!neighbors) continue;

      const nodeWeights = this.graph.weights.get(nodeId)!;

      for (const neighbor of neighbors) {
        if (memberSet.has(neighbor) && nodeId < neighbor) {
          internalEdges++;
          totalWeight += nodeWeights.get(neighbor) || 1.0;
        }
      }
    }

    return maxEdges > 0 ? internalEdges / maxEdges : 0;
  }

  /**
   * Calculate modularity score for communities
   */
  private calculateModularity(): number {
    // Calculate total edge weight
    let totalWeight = 0;
    for (const [, nodeWeights] of this.graph.weights) {
      for (const [, weight] of nodeWeights) {
        totalWeight += weight;
      }
    }
    totalWeight /= 2; // Undirected graph

    if (totalWeight === 0) return 0;

    const m2 = 2 * totalWeight;

    // Calculate node degrees
    const nodeDegrees = new Map<string, number>();
    for (const nodeId of this.graph.nodes) {
      let degree = 0;
      const nodeWeights = this.graph.weights.get(nodeId)!;
      for (const [, weight] of nodeWeights) {
        degree += weight;
      }
      nodeDegrees.set(nodeId, degree);
    }

    // Calculate modularity
    let modularity = 0;

    for (const nodeId of this.graph.nodes) {
      const neighbors = this.graph.edges.get(nodeId)!;
      const nodeWeights = this.graph.weights.get(nodeId)!;
      const nodeDegree = nodeDegrees.get(nodeId) || 0;
      const nodeLabel = this.labels.get(nodeId)!;

      for (const neighbor of neighbors) {
        const neighborLabel = this.labels.get(neighbor)!;

        if (nodeLabel === neighborLabel) {
          const edgeWeight = nodeWeights.get(neighbor) || 0;
          const neighborDegree = nodeDegrees.get(neighbor) || 0;

          modularity += edgeWeight - (nodeDegree * neighborDegree) / m2;
        }
      }
    }

    modularity /= m2;

    return Math.max(0, Math.min(1, modularity));
  }

  /**
   * Fisher-Yates shuffle algorithm for randomizing node order
   */
  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
}
