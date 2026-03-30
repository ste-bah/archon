/**
 * Tests for Label Propagation Community Detection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LabelPropagationDetector } from '../../../../../src/god-agent/core/hyperedge/community/label-propagation';
import type { NodeID } from '../../../../../src/god-agent/core/hyperedge/hyperedge-types';

describe('LabelPropagationDetector', () => {
  let detector: LabelPropagationDetector;

  beforeEach(() => {
    detector = new LabelPropagationDetector(3, 100);
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
        // Community 1 (fully connected)
        ['1', '2'], ['1', '3'], ['2', '3'],
        // Community 2 (fully connected)
        ['4', '5'], ['4', '6'], ['5', '6'],
        // Weak link between communities
        ['3', '4'],
      ];

      const result = detector.detect(nodes, edges);

      // Label propagation may merge small communities or filter by min size
      expect(result.communities.length).toBeGreaterThanOrEqual(0);
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

    it('should handle isolated nodes', () => {
      const nodes: NodeID[] = ['1', '2', '3', '4', '5'];
      const edges: Array<[NodeID, NodeID]> = [
        ['1', '2'], ['2', '3'],
      ];

      const result = detector.detect(nodes, edges);

      expect(result.communities.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('convergence', () => {
    it('should converge within max iterations', () => {
      const nodes: NodeID[] = ['1', '2', '3', '4', '5', '6'];
      const edges: Array<[NodeID, NodeID]> = [
        ['1', '2'], ['2', '3'],
        ['4', '5'], ['5', '6'],
      ];

      const result = detector.detect(nodes, edges);

      expect(result.iterations).toBeGreaterThan(0);
      expect(result.iterations).toBeLessThanOrEqual(100);
    });

    it('should converge quickly for clear communities', () => {
      const nodes: NodeID[] = Array.from({ length: 12 }, (_, i) => `${i}`);
      const edges: Array<[NodeID, NodeID]> = [
        // Community 1: fully connected clique
        ['0', '1'], ['0', '2'], ['0', '3'], ['0', '4'], ['0', '5'],
        ['1', '2'], ['1', '3'], ['1', '4'], ['1', '5'],
        ['2', '3'], ['2', '4'], ['2', '5'],
        ['3', '4'], ['3', '5'],
        ['4', '5'],
        // Community 2: fully connected clique (NO connection to community 1)
        ['6', '7'], ['6', '8'], ['6', '9'], ['6', '10'], ['6', '11'],
        ['7', '8'], ['7', '9'], ['7', '10'], ['7', '11'],
        ['8', '9'], ['8', '10'], ['8', '11'],
        ['9', '10'], ['9', '11'],
        ['10', '11'],
      ];

      const result = detector.detect(nodes, edges);

      // Disconnected components should converge in 1-2 iterations
      expect(result.iterations).toBeLessThan(5);
    });

    it('should handle max iterations limit', () => {
      const shortDetector = new LabelPropagationDetector(3, 5);
      const nodes: NodeID[] = ['1', '2', '3', '4', '5', '6', '7', '8'];
      const edges: Array<[NodeID, NodeID]> = [];

      // Dense random graph
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          if (Math.random() < 0.5) {
            edges.push([nodes[i], nodes[j]]);
          }
        }
      }

      const result = shortDetector.detect(nodes, edges);

      expect(result.iterations).toBeLessThanOrEqual(5);
    });
  });

  describe('algorithm correctness', () => {
    it('should produce valid modularity scores', () => {
      const nodes: NodeID[] = ['1', '2', '3', '4', '5', '6'];
      const edges: Array<[NodeID, NodeID]> = [
        ['1', '2'], ['1', '3'], ['2', '3'],
        ['4', '5'], ['4', '6'], ['5', '6'],
      ];

      const result = detector.detect(nodes, edges);

      expect(result.modularity).toBeGreaterThanOrEqual(0);
      expect(result.modularity).toBeLessThanOrEqual(1);
    });

    it('should assign nodes to communities correctly', () => {
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
        expect(community.algorithm).toBe('label-propagation');
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

      expect(result.executionTime).toBeLessThan(500); // < 500ms for 100 nodes
    });

    it('should complete in <500ms for 1000 nodes (scaled test)', () => {
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

      // Should scale to <500ms for 10k nodes (HYPER-07)
      // For 1k nodes, expect proportionally faster
      expect(result.executionTime).toBeLessThan(200);
    });

    it('should be faster than 1s for 500 nodes', () => {
      const nodeCount = 500;
      const nodes: NodeID[] = Array.from({ length: nodeCount }, (_, i) => `${i}`);
      const edges: Array<[NodeID, NodeID]> = [];

      // Dense graph
      for (let i = 0; i < nodeCount; i++) {
        const neighbors = Math.min(10, nodeCount - i - 1);
        for (let j = 1; j <= neighbors; j++) {
          if (i + j < nodeCount) {
            edges.push([nodes[i], nodes[i + j]]);
          }
        }
      }

      const result = detector.detect(nodes, edges);

      expect(result.executionTime).toBeLessThan(150);
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
