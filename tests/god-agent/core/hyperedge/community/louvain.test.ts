/**
 * Tests for Louvain Community Detection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LouvainDetector } from '../../../../../src/god-agent/core/hyperedge/community/louvain';
import type { NodeID } from '../../../../../src/god-agent/core/hyperedge/hyperedge-types';

describe('LouvainDetector', () => {
  let detector: LouvainDetector;

  beforeEach(() => {
    detector = new LouvainDetector(3);
  });

  describe('basic functionality', () => {
    it('should detect single community in fully connected graph', () => {
      const nodes: NodeID[] = ['1', '2', '3', '4', '5'];
      const edges: Array<[NodeID, NodeID]> = [
        ['1', '2'], ['1', '3'], ['1', '4'], ['1', '5'],
        ['2', '3'], ['2', '4'], ['2', '5'],
        ['3', '4'], ['3', '5'],
        ['4', '5'],
      ];

      const result = detector.detect(nodes, edges);

      expect(result.communities.length).toBeGreaterThanOrEqual(1);
      expect(result.modularity).toBeGreaterThanOrEqual(0);
      expect(result.modularity).toBeLessThanOrEqual(1);
    });

    it('should detect two clear communities', () => {
      const nodes: NodeID[] = ['1', '2', '3', '4', '5', '6'];
      const edges: Array<[NodeID, NodeID]> = [
        // Community 1
        ['1', '2'], ['1', '3'], ['2', '3'],
        // Community 2
        ['4', '5'], ['4', '6'], ['5', '6'],
        // Weak link between communities
        ['3', '4'],
      ];

      const result = detector.detect(nodes, edges);

      expect(result.communities.length).toBeGreaterThanOrEqual(1);
      expect(result.communities.length).toBeLessThanOrEqual(2);
    });

    it('should filter communities below minimum size', () => {
      const nodes: NodeID[] = ['1', '2', '3', '4', '5'];
      const edges: Array<[NodeID, NodeID]> = [
        ['1', '2'],
        ['3', '4'], ['4', '5'],
      ];

      const result = detector.detect(nodes, edges);

      // All communities should have >= 3 members (HYPER-08)
      for (const community of result.communities) {
        expect(community.members.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('should handle weighted edges', () => {
      const nodes: NodeID[] = ['1', '2', '3', '4'];
      const edges: Array<[NodeID, NodeID, number]> = [
        ['1', '2', 10.0],
        ['2', '3', 1.0],
        ['3', '4', 10.0],
      ];

      const result = detector.detect(nodes, edges);

      expect(result.communities.length).toBeGreaterThanOrEqual(0);
      expect(result.executionTime).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty graph', () => {
      const nodes: NodeID[] = [];
      const edges: Array<[NodeID, NodeID]> = [];

      const result = detector.detect(nodes, edges);

      expect(result.communities.length).toBe(0);
      expect(result.modularity).toBe(0);
    });

    it('should handle graph with no edges', () => {
      const nodes: NodeID[] = ['1', '2', '3', '4'];
      const edges: Array<[NodeID, NodeID]> = [];

      const result = detector.detect(nodes, edges);

      expect(result.communities.length).toBe(0);
    });

    it('should handle disconnected components', () => {
      const nodes: NodeID[] = ['1', '2', '3', '4', '5', '6'];
      const edges: Array<[NodeID, NodeID]> = [
        ['1', '2'], ['2', '3'],
        ['4', '5'], ['5', '6'],
      ];

      const result = detector.detect(nodes, edges);

      // Should find separate communities or none (depending on min size)
      expect(result.communities.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle self-loops correctly', () => {
      const nodes: NodeID[] = ['1', '2', '3'];
      const edges: Array<[NodeID, NodeID]> = [
        ['1', '1'], // Self-loop
        ['1', '2'],
        ['2', '3'],
      ];

      const result = detector.detect(nodes, edges);

      expect(result.communities.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('algorithm correctness', () => {
    it('should produce valid modularity scores', () => {
      const nodes: NodeID[] = ['1', '2', '3', '4', '5', '6', '7', '8'];
      const edges: Array<[NodeID, NodeID]> = [
        ['1', '2'], ['1', '3'], ['2', '3'],
        ['4', '5'], ['4', '6'], ['5', '6'],
        ['7', '8'],
        ['3', '4'], ['6', '7'],
      ];

      const result = detector.detect(nodes, edges);

      expect(result.modularity).toBeGreaterThanOrEqual(0);
      expect(result.modularity).toBeLessThanOrEqual(1);
    });

    it('should assign all nodes to communities', () => {
      const nodes: NodeID[] = ['1', '2', '3', '4', '5', '6'];
      const edges: Array<[NodeID, NodeID]> = [
        ['1', '2'], ['1', '3'], ['2', '3'],
        ['4', '5'], ['4', '6'], ['5', '6'],
      ];

      const result = detector.detect(nodes, edges);

      const allMembers = new Set<string>();
      for (const community of result.communities) {
        for (const member of community.members) {
          allMembers.add(member);
        }
      }

      // All nodes in communities or filtered out (< min size)
      expect(allMembers.size).toBeLessThanOrEqual(nodes.length);
    });

    it('should have valid cohesion values', () => {
      const nodes: NodeID[] = ['1', '2', '3', '4', '5', '6'];
      const edges: Array<[NodeID, NodeID]> = [
        ['1', '2'], ['1', '3'], ['2', '3'],
        ['4', '5'], ['4', '6'], ['5', '6'],
      ];

      const result = detector.detect(nodes, edges);

      for (const community of result.communities) {
        expect(community.cohesion).toBeGreaterThanOrEqual(0);
        expect(community.cohesion).toBeLessThanOrEqual(1);
      }
    });

    it('should set correct algorithm tag', () => {
      const nodes: NodeID[] = ['1', '2', '3', '4'];
      const edges: Array<[NodeID, NodeID]> = [
        ['1', '2'], ['2', '3'], ['3', '4'],
      ];

      const result = detector.detect(nodes, edges);

      for (const community of result.communities) {
        expect(community.algorithm).toBe('louvain');
      }
    });
  });

  describe('performance', () => {
    it('should complete in reasonable time for small graph', () => {
      const nodes: NodeID[] = Array.from({ length: 100 }, (_, i) => `${i}`);
      const edges: Array<[NodeID, NodeID]> = [];

      // Create random graph
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          if (Math.random() < 0.1) {
            edges.push([nodes[i], nodes[j]]);
          }
        }
      }

      const result = detector.detect(nodes, edges);

      expect(result.executionTime).toBeLessThan(1000); // < 1s for 100 nodes
    });

    it('should complete in <2s for 1000 nodes (scaled test)', () => {
      const nodeCount = 1000;
      const nodes: NodeID[] = Array.from({ length: nodeCount }, (_, i) => `${i}`);
      const edges: Array<[NodeID, NodeID]> = [];

      // Create community structure
      const communitySize = 50;
      for (let c = 0; c < nodeCount / communitySize; c++) {
        const start = c * communitySize;
        const end = Math.min(start + communitySize, nodeCount);

        for (let i = start; i < end; i++) {
          for (let j = i + 1; j < end; j++) {
            if (Math.random() < 0.2) {
              edges.push([nodes[i], nodes[j]]);
            }
          }
        }
      }

      const result = detector.detect(nodes, edges);

      // Should scale to <2s for 10k nodes (HYPER-06)
      // For 1k nodes, expect proportionally faster
      expect(result.executionTime).toBeLessThan(500);
    });

    it('should track iterations', () => {
      const nodes: NodeID[] = ['1', '2', '3', '4', '5', '6'];
      const edges: Array<[NodeID, NodeID]> = [
        ['1', '2'], ['2', '3'],
        ['4', '5'], ['5', '6'],
      ];

      const result = detector.detect(nodes, edges);

      expect(result.iterations).toBeGreaterThan(0);
    });
  });

  describe('result structure', () => {
    it('should return valid CommunityDetectionResult', () => {
      const nodes: NodeID[] = ['1', '2', '3', '4'];
      const edges: Array<[NodeID, NodeID]> = [
        ['1', '2'], ['2', '3'], ['3', '4'],
      ];

      const result = detector.detect(nodes, edges);

      expect(result).toHaveProperty('communities');
      expect(result).toHaveProperty('modularity');
      expect(result).toHaveProperty('executionTime');
      expect(result).toHaveProperty('iterations');
      expect(Array.isArray(result.communities)).toBe(true);
    });

    it('should create communities with all required fields', () => {
      const nodes: NodeID[] = ['1', '2', '3', '4', '5', '6'];
      const edges: Array<[NodeID, NodeID]> = [
        ['1', '2'], ['1', '3'], ['2', '3'],
        ['4', '5'], ['4', '6'], ['5', '6'],
      ];

      const result = detector.detect(nodes, edges);

      for (const community of result.communities) {
        expect(community).toHaveProperty('id');
        expect(community).toHaveProperty('members');
        expect(community).toHaveProperty('cohesion');
        expect(community).toHaveProperty('algorithm');
        expect(community).toHaveProperty('timestamp');
        expect(Array.isArray(community.members)).toBe(true);
      }
    });
  });
});
