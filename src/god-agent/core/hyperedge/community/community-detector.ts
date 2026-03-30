/**
 * Unified Community Detection Interface
 *
 * Provides algorithm selection, result filtering, and statistics.
 * Enforces constitutional constraints (HYPER-06, HYPER-07, HYPER-08).
 */

import type { NodeID, Community, CommunityDetectionResult } from '../hyperedge-types.js';
import { LouvainDetector } from './louvain.js';
import { LabelPropagationDetector } from './label-propagation.js';

export type CommunityAlgorithm = 'louvain' | 'label-propagation' | 'auto';

export interface CommunityDetectorOptions {
  algorithm?: CommunityAlgorithm;
  minCommunitySize?: number;
  maxIterations?: number;
}

export class CommunityDetector {
  private options: Required<CommunityDetectorOptions>;

  constructor(options: CommunityDetectorOptions = {}) {
    this.options = {
      algorithm: options.algorithm || 'auto',
      minCommunitySize: options.minCommunitySize || 3, // HYPER-08
      maxIterations: options.maxIterations || 100,
    };
  }

  /**
   * Detect communities in graph
   * @param nodes Array of node IDs
   * @param edges Array of [source, target] or [source, target, weight] tuples
   * @returns Community detection result
   */
  public detect(
    nodes: NodeID[],
    edges: Array<[NodeID, NodeID] | [NodeID, NodeID, number]>
  ): CommunityDetectionResult {
    const algorithm = this.selectAlgorithm(nodes.length, edges.length);

    let result: CommunityDetectionResult;

    if (algorithm === 'louvain') {
      const detector = new LouvainDetector(this.options.minCommunitySize);
      result = detector.detect(nodes, edges);
    } else {
      const detector = new LabelPropagationDetector(
        this.options.minCommunitySize,
        this.options.maxIterations
      );
      result = detector.detect(nodes, edges);
    }

    // Validate performance constraints
    this.validatePerformance(result, algorithm, nodes.length);

    return result;
  }

  /**
   * Select algorithm based on graph size and user preference
   */
  private selectAlgorithm(
    nodeCount: number,
    edgeCount: number
  ): 'louvain' | 'label-propagation' {
    if (this.options.algorithm !== 'auto') {
      return this.options.algorithm;
    }

    // Auto-select based on graph characteristics
    // Label propagation is faster but Louvain often finds better communities
    // Use label propagation for very large graphs
    const isLargeGraph = nodeCount > 5000 || edgeCount > 50000;

    return isLargeGraph ? 'label-propagation' : 'louvain';
  }

  /**
   * Validate performance constraints (HYPER-06, HYPER-07)
   */
  private validatePerformance(
    result: CommunityDetectionResult,
    algorithm: 'louvain' | 'label-propagation',
    nodeCount: number
  ): void {
    // Only validate for 10k+ node graphs
    if (nodeCount < 10000) return;

    if (algorithm === 'louvain' && result.executionTime > 2000) {
      console.warn(
        `[HYPER-06 WARNING] Louvain took ${result.executionTime.toFixed(0)}ms ` +
        `for ${nodeCount} nodes (should be <2000ms)`
      );
    }

    if (algorithm === 'label-propagation' && result.executionTime > 500) {
      console.warn(
        `[HYPER-07 WARNING] Label Propagation took ${result.executionTime.toFixed(0)}ms ` +
        `for ${nodeCount} nodes (should be <500ms)`
      );
    }
  }

  /**
   * Get statistics about community structure
   */
  public getStatistics(result: CommunityDetectionResult): CommunityStatistics {
    const communities = result.communities;

    if (communities.length === 0) {
      return {
        communityCount: 0,
        avgCommunitySize: 0,
        minCommunitySize: 0,
        maxCommunitySize: 0,
        avgCohesion: 0,
        modularity: result.modularity,
      };
    }

    const sizes = communities.map((c: Community) => c.members.length);
    const cohesions = communities.map((c: Community) => c.cohesion);

    return {
      communityCount: communities.length,
      avgCommunitySize: this.average(sizes),
      minCommunitySize: Math.min(...sizes),
      maxCommunitySize: Math.max(...sizes),
      avgCohesion: this.average(cohesions),
      modularity: result.modularity,
    };
  }

  /**
   * Find community for a given node
   */
  public findNodeCommunity(nodeId: NodeID, result: CommunityDetectionResult): Community | null {
    for (const community of result.communities) {
      if (community.members.includes(nodeId)) {
        return community;
      }
    }
    return null;
  }

  /**
   * Find overlapping members between two communities
   */
  public findOverlap(community1: Community, community2: Community): NodeID[] {
    const set1 = new Set(community1.members);
    return community2.members.filter((member: NodeID) => set1.has(member));
  }

  /**
   * Calculate average of array
   */
  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }
}

export interface CommunityStatistics {
  communityCount: number;
  avgCommunitySize: number;
  minCommunitySize: number;
  maxCommunitySize: number;
  avgCohesion: number;
  modularity: number;
}
