/**
 * Graph-based Anomaly Detector
 * Detects structural anomalies using community structure
 * - Isolated nodes
 * - Cross-community bridges
 * - Unusual connectivity patterns
 */

import type { AnomalyResult, AnomalyDetectionConfig, Community } from '../hyperedge-types.js';
import type { CommunityDetector } from '../community/index.js';

/**
 * Graph structure for anomaly detection
 */
export interface GraphStructure {
  nodes: string[];
  edges: Map<string, string[]>;
  weights?: Map<string, Map<string, number>>;
}

/**
 * Node structural features
 */
interface NodeFeatures {
  degree: number;
  communityId?: string;
  communityCohesion?: number;
  crossCommunityEdges: number;
  isolationScore: number;
}

/**
 * Graph-based anomaly detector using community structure
 */
export class GraphAnomalyDetector {
  private readonly minConfidence: number;
  private graph: GraphStructure | null;
  private nodesCommunityMap: Map<string, string>;

  constructor(config?: Pick<AnomalyDetectionConfig, 'minConfidence'>) {
    this.minConfidence = config?.minConfidence ?? 0.8;
    this.graph = null;
    this.nodesCommunityMap = new Map();
  }

  /**
   * Set the graph structure for analysis
   */
  setGraph(graph: GraphStructure): void {
    this.graph = graph;
    this.nodesCommunityMap.clear();
  }

  /**
   * Set community detector for enhanced analysis
   * Stores the community assignments from detection result
   */
  setCommunityDetector(detector: CommunityDetector | { communities: Community[] }): void {
    this.nodesCommunityMap.clear();

    // Support both CommunityDetector and raw detection results
    const communities = 'communities' in detector
      ? detector.communities
      : [];

    for (const community of communities) {
      for (const member of community.members) {
        this.nodesCommunityMap.set(member, community.id);
      }
    }
  }

  /**
   * Set communities from detection result directly
   */
  setCommunities(communities: Community[]): void {
    this.nodesCommunityMap.clear();

    for (const community of communities) {
      for (const member of community.members) {
        this.nodesCommunityMap.set(member, community.id);
      }
    }
  }

  /**
   * Calculate node degree
   */
  private getNodeDegree(nodeId: string): number {
    if (!this.graph) return 0;
    const neighbors = this.graph.edges.get(nodeId);
    return neighbors ? neighbors.length : 0;
  }

  /**
   * Calculate average degree in graph
   */
  private getAverageDegree(): number {
    if (!this.graph || this.graph.nodes.length === 0) return 0;

    let totalDegree = 0;
    for (const node of this.graph.nodes) {
      totalDegree += this.getNodeDegree(node);
    }

    return totalDegree / this.graph.nodes.length;
  }

  /**
   * Calculate isolation score
   * Higher score = more isolated from graph
   */
  private calculateIsolationScore(nodeId: string, avgDegree: number): number {
    const degree = this.getNodeDegree(nodeId);

    if (degree === 0) return 1.0; // Completely isolated
    if (avgDegree === 0) return 0;

    // Normalized distance from average degree
    const ratio = degree / avgDegree;

    if (ratio >= 1) return 0; // Well-connected or above average

    return 1 - ratio; // [0, 1] where 1 = isolated
  }

  /**
   * Count cross-community edges for a node
   */
  private countCrossCommunityEdges(
    nodeId: string,
    nodesCommunityMap: Map<string, string>
  ): number {
    if (!this.graph) return 0;

    const nodeCommunity = nodesCommunityMap.get(nodeId);
    if (!nodeCommunity) return 0;

    const neighbors = this.graph.edges.get(nodeId) ?? [];
    let crossEdges = 0;

    for (const neighbor of neighbors) {
      const neighborCommunity = nodesCommunityMap.get(neighbor);
      if (neighborCommunity && neighborCommunity !== nodeCommunity) {
        crossEdges++;
      }
    }

    return crossEdges;
  }

  /**
   * Calculate community cohesion for a node
   * Ratio of internal community edges to total edges
   */
  private calculateCommunityCohesion(
    nodeId: string,
    nodesCommunityMap: Map<string, string>
  ): number {
    if (!this.graph) return 0;

    const neighbors = this.graph.edges.get(nodeId) ?? [];
    if (neighbors.length === 0) return 0;

    const nodeCommunity = nodesCommunityMap.get(nodeId);
    if (!nodeCommunity) return 0;

    let internalEdges = 0;
    for (const neighbor of neighbors) {
      if (nodesCommunityMap.get(neighbor) === nodeCommunity) {
        internalEdges++;
      }
    }

    return internalEdges / neighbors.length;
  }

  /**
   * Extract structural features for a node
   */
  private extractNodeFeatures(
    nodeId: string,
    avgDegree: number,
    nodesCommunityMap: Map<string, string>
  ): NodeFeatures {
    const degree = this.getNodeDegree(nodeId);
    const isolationScore = this.calculateIsolationScore(nodeId, avgDegree);
    const crossCommunityEdges = this.countCrossCommunityEdges(nodeId, nodesCommunityMap);
    const communityCohesion = this.calculateCommunityCohesion(nodeId, nodesCommunityMap);

    return {
      degree,
      communityId: nodesCommunityMap.get(nodeId),
      communityCohesion,
      crossCommunityEdges,
      isolationScore
    };
  }

  /**
   * Calculate anomaly score from features
   * Combines multiple structural signals
   */
  private calculateAnomalyScore(features: NodeFeatures): {
    score: number;
    confidence: number;
    reason: string;
  } {
    type SignalName = 'isolation' | 'bridge' | 'weak-cohesion';
    const signals: Array<{ weight: number; value: number; name: SignalName }> = [];

    // Signal 1: Isolation (high isolation = anomaly)
    // Only flag if significantly isolated (>0.7) to avoid false positives in complete graphs and hubs
    if (features.isolationScore > 0.7) {
      signals.push({
        weight: 0.5,
        value: features.isolationScore,
        name: 'isolation'
      });
    }

    // Signal 2: Cross-community bridging (many bridges = anomaly)
    if (features.degree > 0) {
      const bridgeRatio = features.crossCommunityEdges / features.degree;
      if (bridgeRatio > 0.6) {
        signals.push({
          weight: 0.3,
          value: bridgeRatio,
          name: 'bridge'
        });
      }
    }

    // Signal 3: Low community cohesion (weak ties = anomaly)
    if (features.communityCohesion !== undefined && features.communityCohesion < 0.3) {
      signals.push({
        weight: 0.2,
        value: 1 - features.communityCohesion,
        name: 'weak-cohesion'
      });
    }

    if (signals.length === 0) {
      return { score: 0, confidence: 0, reason: 'No anomaly signals detected' };
    }

    // Weighted combination of signals
    let totalWeight = 0;
    let weightedSum = 0;

    for (const signal of signals) {
      totalWeight += signal.weight;
      weightedSum += signal.weight * signal.value;
    }

    const score = weightedSum / totalWeight;

    // Confidence based on score magnitude and signal count
    // Isolated nodes (score=1.0) should have very high confidence
    const baseConfidence = score * 0.9; // Base confidence from score
    const boostFromSignals = (signals.length / 3) * 0.1; // Bonus from multiple signals
    const confidence = Math.min(baseConfidence + boostFromSignals, 0.99);

    const primarySignal = signals.reduce((max, s) =>
      s.weight * s.value > max.weight * max.value ? s : max
    );

    const reasons = {
      isolation: `Isolated node (degree: ${features.degree})`,
      bridge: `Cross-community bridge (${features.crossCommunityEdges} external edges)`,
      'weak-cohesion': `Weak community ties (cohesion: ${(features.communityCohesion ?? 0).toFixed(2)})`
    };

    return {
      score,
      confidence,
      reason: reasons[primarySignal.name]
    };
  }

  /**
   * Detect structural anomaly in a single node
   */
  detect(nodeId: string): AnomalyResult | null {
    if (!this.graph) {
      throw new Error('Graph structure not set');
    }

    if (!this.graph.nodes.includes(nodeId)) {
      throw new Error(`Node ${nodeId} not found in graph`);
    }

    const avgDegree = this.getAverageDegree();
    const features = this.extractNodeFeatures(nodeId, avgDegree, this.nodesCommunityMap);
    const { score, confidence, reason } = this.calculateAnomalyScore(features);

    // Only return if confidence meets threshold (HYPER-10: >= 0.8)
    if (confidence < this.minConfidence) {
      return null;
    }

    return {
      entityId: nodeId,
      entityType: 'node',
      score,
      confidence,
      algorithm: 'isolation-forest', // Graph-based uses similar concepts
      timestamp: Date.now(),
      reason,
      neighbors: this.graph.edges.get(nodeId)
    };
  }

  /**
   * Detect anomalies in all nodes
   */
  detectAll(): AnomalyResult[] {
    if (!this.graph) {
      throw new Error('Graph structure not set');
    }

    const results: AnomalyResult[] = [];

    for (const nodeId of this.graph.nodes) {
      const result = this.detect(nodeId);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Get statistics about current graph
   */
  getStats(): {
    nodeCount: number;
    edgeCount: number;
    avgDegree: number;
    hasCommunities: boolean;
  } {
    if (!this.graph) {
      return {
        nodeCount: 0,
        edgeCount: 0,
        avgDegree: 0,
        hasCommunities: false
      };
    }

    let edgeCount = 0;
    for (const neighbors of this.graph.edges.values()) {
      edgeCount += neighbors.length;
    }

    return {
      nodeCount: this.graph.nodes.length,
      edgeCount: edgeCount / 2, // Undirected edges
      avgDegree: this.getAverageDegree(),
      hasCommunities: this.nodesCommunityMap.size > 0
    };
  }
}
