/**
 * Louvain Community Detection Algorithm
 *
 * Two-phase modularity optimization algorithm for community detection.
 * Performance: O(n log n) - must complete in <2s for 10k nodes (HYPER-06)
 *
 * Algorithm:
 * 1. Phase 1: Move nodes to communities that maximize modularity gain
 * 2. Phase 2: Aggregate communities into super-nodes
 * 3. Repeat until no improvement
 *
 * Modularity: Q = (1/2m) * Σ[Aij - (ki*kj)/(2m)] * δ(ci, cj)
 * where m = total edge weight, ki = degree of node i, Aij = edge weight
 */

import type { NodeID, Community, CommunityDetectionResult } from '../hyperedge-types.js';

interface Graph {
  nodes: string[];
  edges: Map<string, Set<string>>;
  weights: Map<string, Map<string, number>>;
}

// NodeCommunity: Used conceptually in algorithm, not as explicit interface
// interface NodeCommunity { nodeId: string; communityId: string; }

interface ModularityStats {
  totalWeight: number;
  nodeDegrees: Map<string, number>;
  communityWeights: Map<string, number>;
  internalWeights: Map<string, number>;
}

export class LouvainDetector {
  private graph: Graph;
  private originalGraph: Graph; // Keep original graph for cohesion calculation
  private communities: Map<string, string>; // nodeId -> communityId
  private nodeMapping: Map<string, string[]>; // super-node -> original nodes
  private stats: ModularityStats;
  private minCommunitySize = 3;

  constructor(minCommunitySize = 3) {
    this.minCommunitySize = minCommunitySize;
    this.graph = { nodes: [], edges: new Map(), weights: new Map() };
    this.originalGraph = { nodes: [], edges: new Map(), weights: new Map() };
    this.communities = new Map();
    this.nodeMapping = new Map(); // Track original nodes through aggregations
    this.stats = {
      totalWeight: 0,
      nodeDegrees: new Map(),
      communityWeights: new Map(),
      internalWeights: new Map(),
    };
  }

  /**
   * Detect communities using Louvain algorithm
   * @param nodes Array of node IDs
   * @param edges Array of [source, target] or [source, target, weight] tuples
   * @returns Community detection result with modularity score
   */
  public detect(
    nodes: NodeID[],
    edges: Array<[NodeID, NodeID] | [NodeID, NodeID, number]>
  ): CommunityDetectionResult {
    const startTime = performance.now();

    // Initialize graph
    this.initializeGraph(nodes, edges);

    // Phase 1 & 2: Iterative optimization
    let improved = true;
    let iterations = 0;
    const maxIterations = 100;

    while (improved && iterations < maxIterations) {
      improved = this.optimizeModularity();
      if (improved) {
        this.aggregateCommunities();
      }
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
    this.originalGraph.nodes = [...nodes];
    this.originalGraph.edges = new Map();
    this.originalGraph.weights = new Map();

    for (const node of nodes) {
      this.graph.edges.set(node, new Set());
      this.graph.weights.set(node, new Map());
      this.originalGraph.edges.set(node, new Set());
      this.originalGraph.weights.set(node, new Map());
      // Each node starts in its own community
      this.communities.set(node, node);
      // Initialize mapping: each node maps to itself
      this.nodeMapping.set(node, [node]);
    }

    // Initialize edges and weights
    this.stats.totalWeight = 0;
    this.stats.nodeDegrees = new Map();

    for (const edge of edges) {
      const [source, target, weight = 1.0] = edge;

      // Add edge (undirected)
      this.graph.edges.get(source)?.add(target);
      this.graph.edges.get(target)?.add(source);
      this.originalGraph.edges.get(source)?.add(target);
      this.originalGraph.edges.get(target)?.add(source);

      // Add weight
      this.graph.weights.get(source)?.set(target, weight);
      this.graph.weights.get(target)?.set(source, weight);
      this.originalGraph.weights.get(source)?.set(target, weight);
      this.originalGraph.weights.get(target)?.set(source, weight);

      // Update total weight (count each edge once)
      this.stats.totalWeight += weight;

      // Update node degrees
      const sourceDegree = (this.stats.nodeDegrees.get(source) || 0) + weight;
      const targetDegree = (this.stats.nodeDegrees.get(target) || 0) + weight;
      this.stats.nodeDegrees.set(source, sourceDegree);
      this.stats.nodeDegrees.set(target, targetDegree);
    }

    // Initialize community weights
    this.updateCommunityWeights();
  }

  /**
   * Phase 1: Optimize modularity by moving nodes to better communities
   * @returns true if any node was moved
   */
  private optimizeModularity(): boolean {
    let improved = false;

    for (const nodeId of this.graph.nodes) {
      const currentCommunity = this.communities.get(nodeId)!;
      const neighbors = this.graph.edges.get(nodeId)!;

      // Find neighboring communities
      const neighborCommunities = new Set<string>();
      for (const neighbor of neighbors) {
        const neighborCommunity = this.communities.get(neighbor)!;
        neighborCommunities.add(neighborCommunity);
      }

      // Calculate modularity gain for each neighboring community
      let bestCommunity = currentCommunity;
      let bestGain = 0;

      for (const targetCommunity of neighborCommunities) {
        if (targetCommunity === currentCommunity) continue;

        const gain = this.calculateModularityGain(nodeId, currentCommunity, targetCommunity);
        if (gain > bestGain) {
          bestGain = gain;
          bestCommunity = targetCommunity;
        }
      }

      // Move node if beneficial
      if (bestCommunity !== currentCommunity && bestGain > 1e-10) {
        this.communities.set(nodeId, bestCommunity);
        improved = true;
      }
    }

    if (improved) {
      this.updateCommunityWeights();
    }

    return improved;
  }

  /**
   * Calculate modularity gain from moving a node to a new community
   */
  private calculateModularityGain(
    nodeId: string,
    fromCommunity: string,
    toCommunity: string
  ): number {
    const nodeDegree = this.stats.nodeDegrees.get(nodeId) || 0;
    const m2 = 2 * this.stats.totalWeight;

    // Weight of edges from node to target community
    const weightTo = this.getEdgeWeightToCommunity(nodeId, toCommunity);

    // Weight of edges from node to current community (excluding self-loops)
    const weightFrom = this.getEdgeWeightToCommunity(nodeId, fromCommunity);

    // Total weight in target community
    const sumTot = this.stats.communityWeights.get(toCommunity) || 0;

    // Total weight in current community
    const sumFrom = this.stats.communityWeights.get(fromCommunity) || 0;

    // Modularity gain formula
    const gain =
      (weightTo - weightFrom) / m2 +
      (nodeDegree * (sumFrom - sumTot - nodeDegree)) / (m2 * m2);

    return gain;
  }

  /**
   * Get total weight of edges from node to nodes in a community
   */
  private getEdgeWeightToCommunity(nodeId: string, communityId: string): number {
    let weight = 0;
    const neighbors = this.graph.edges.get(nodeId)!;
    const nodeWeights = this.graph.weights.get(nodeId)!;

    for (const neighbor of neighbors) {
      if (this.communities.get(neighbor) === communityId) {
        weight += nodeWeights.get(neighbor) || 0;
      }
    }

    return weight;
  }

  /**
   * Update community weights after node movements
   */
  private updateCommunityWeights(): void {
    this.stats.communityWeights.clear();
    this.stats.internalWeights.clear();

    for (const nodeId of this.graph.nodes) {
      const communityId = this.communities.get(nodeId)!;
      const nodeDegree = this.stats.nodeDegrees.get(nodeId) || 0;

      // Update total community weight
      const currentWeight = this.stats.communityWeights.get(communityId) || 0;
      this.stats.communityWeights.set(communityId, currentWeight + nodeDegree);

      // Update internal community weight
      const internalWeight = this.getEdgeWeightToCommunity(nodeId, communityId);
      const currentInternal = this.stats.internalWeights.get(communityId) || 0;
      this.stats.internalWeights.set(communityId, currentInternal + internalWeight);
    }
  }

  /**
   * Phase 2: Aggregate communities into super-nodes
   */
  private aggregateCommunities(): void {
    // Build community mapping
    const communityNodes = new Map<string, string[]>();
    for (const [nodeId, communityId] of this.communities) {
      if (!communityNodes.has(communityId)) {
        communityNodes.set(communityId, []);
      }
      communityNodes.get(communityId)!.push(nodeId);
    }

    // Create new graph where communities are nodes
    const newNodes: string[] = [];
    const newEdges = new Map<string, Set<string>>();
    const newWeights = new Map<string, Map<string, number>>();
    const newNodeMapping = new Map<string, string[]>();

    for (const [communityId, members] of communityNodes) {
      newNodes.push(communityId);
      newEdges.set(communityId, new Set());
      newWeights.set(communityId, new Map());

      // Track original nodes: aggregate all original nodes from members
      const originalNodes: string[] = [];
      for (const member of members) {
        const originals = this.nodeMapping.get(member) || [member];
        originalNodes.push(...originals);
      }
      newNodeMapping.set(communityId, originalNodes);
    }

    // Aggregate edges between communities
    for (const [nodeId, communityId] of this.communities) {
      const neighbors = this.graph.edges.get(nodeId)!;
      const nodeWeights = this.graph.weights.get(nodeId)!;

      for (const neighbor of neighbors) {
        const neighborCommunity = this.communities.get(neighbor)!;
        if (communityId !== neighborCommunity) {
          newEdges.get(communityId)?.add(neighborCommunity);

          const weight = nodeWeights.get(neighbor) || 0;
          const currentWeight = newWeights.get(communityId)?.get(neighborCommunity) || 0;
          newWeights.get(communityId)?.set(neighborCommunity, currentWeight + weight);
        }
      }
    }

    // Update graph
    this.graph.nodes = newNodes;
    this.graph.edges = newEdges;
    this.graph.weights = newWeights;
    this.nodeMapping = newNodeMapping;

    // Reset communities (each super-node in its own community)
    this.communities.clear();
    for (const node of newNodes) {
      this.communities.set(node, node);
    }

    // Recalculate statistics
    this.recalculateStats();
  }

  /**
   * Recalculate node degrees and total weight after aggregation
   */
  private recalculateStats(): void {
    this.stats.nodeDegrees.clear();
    this.stats.totalWeight = 0;

    for (const nodeId of this.graph.nodes) {
      let degree = 0;
      const nodeWeights = this.graph.weights.get(nodeId)!;

      for (const [, weight] of nodeWeights) {
        degree += weight;
        this.stats.totalWeight += weight;
      }

      this.stats.nodeDegrees.set(nodeId, degree);
    }

    // Total weight counted twice (undirected)
    this.stats.totalWeight /= 2;

    this.updateCommunityWeights();
  }

  /**
   * Calculate final modularity score
   */
  private calculateModularity(): number {
    const m2 = 2 * this.stats.totalWeight;
    if (m2 === 0) return 0;

    let modularity = 0;

    for (const [communityId, internalWeight] of this.stats.internalWeights) {
      const sumTot = this.stats.communityWeights.get(communityId) || 0;
      modularity += (internalWeight / m2) - Math.pow(sumTot / m2, 2);
    }

    return Math.max(0, Math.min(1, modularity));
  }

  /**
   * Build final community list, filtering by minimum size
   */
  private buildCommunities(): Community[] {
    const communityMap = new Map<string, string[]>();

    // Map back to original nodes
    for (const [nodeId, communityId] of this.communities) {
      if (!communityMap.has(communityId)) {
        communityMap.set(communityId, []);
      }
      // Get original nodes for this super-node
      const originalNodes = this.nodeMapping.get(nodeId) || [nodeId];
      communityMap.get(communityId)!.push(...originalNodes);
    }

    const communities: Community[] = [];
    const timestamp = Date.now();

    for (const [communityId, members] of communityMap) {
      // Filter by minimum size (HYPER-08)
      if (members.length >= this.minCommunitySize) {
        const cohesion = this.calculateCommunityCohesion(members);

        communities.push({
          id: communityId,
          members,
          cohesion,
          algorithm: 'louvain',
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
    const maxEdges = (members.length * (members.length - 1)) / 2;

    const memberSet = new Set(members);

    // Use original graph for cohesion calculation
    for (const nodeId of members) {
      const neighbors = this.originalGraph.edges.get(nodeId);
      if (!neighbors) continue;

      for (const neighbor of neighbors) {
        if (memberSet.has(neighbor) && nodeId < neighbor) {
          internalEdges++;
        }
      }
    }

    return maxEdges > 0 ? internalEdges / maxEdges : 0;
  }
}
