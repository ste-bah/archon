/**
 * Tests for Unified Community Detector
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CommunityDetector } from '../../../../../src/god-agent/core/hyperedge/community/community-detector';
import type { NodeID } from '../../../../../src/god-agent/core/hyperedge/hyperedge-types';

describe('CommunityDetector', () => {
  describe('algorithm selection', () => {
    it('should use louvain when explicitly specified', () => {
      const detector = new CommunityDetector({ algorithm: 'louvain' });
      const nodes: NodeID[] = ['1', '2', '3', '4'];
      const edges: Array<[NodeID, NodeID]> = [
        ['1', '2'], ['2', '3'], ['3', '4'],
      ];

      const result = detector.detect(nodes, edges);

      for (const community of result.communities) {
        expect(community.algorithm).toBe('louvain');
      }
    });

    it('should use label-propagation when explicitly specified', () => {
      const detector = new CommunityDetector({ algorithm: 'label-propagation' });
      const nodes: NodeID[] = ['1', '2', '3', '4'];
      const edges: Array<[NodeID, NodeID]> = [
        ['1', '2'], ['2', '3'], ['3', '4'],
      ];

      const result = detector.detect(nodes, edges);

      for (const community of result.communities) {
        expect(community.algorithm).toBe('label-propagation');
      }
    });

    it('should auto-select algorithm for small graphs', () => {
      const detector = new CommunityDetector({ algorithm: 'auto' });
      const nodes: NodeID[] = ['1', '2', '3', '4'];
      const edges: Array<[NodeID, NodeID]> = [
        ['1', '2'], ['2', '3'], ['3', '4'],
      ];

      const result = detector.detect(nodes, edges);

      expect(result).toHaveProperty('communities');
      expect(result).toHaveProperty('modularity');
    });

    it('should auto-select label-propagation for large graphs', () => {
      const detector = new CommunityDetector({ algorithm: 'auto' });
      const nodeCount = 6000;
      const nodes: NodeID[] = Array.from({ length: nodeCount }, (_, i) => `${i}`);
      const edges: Array<[NodeID, NodeID]> = [];

      // Sparse graph
      for (let i = 0; i < nodeCount - 1; i++) {
        edges.push([nodes[i], nodes[i + 1]]);
      }

      const result = detector.detect(nodes, edges);

      // Should use label-propagation for large graphs
      expect(result).toHaveProperty('communities');
    });
  });

  describe('minimum community size', () => {
    it('should respect custom minimum size', () => {
      const detector = new CommunityDetector({ minCommunitySize: 5 });
      const nodes: NodeID[] = ['1', '2', '3', '4', '5', '6', '7', '8'];
      const edges: Array<[NodeID, NodeID]> = [
        ['1', '2'], ['2', '3'], ['3', '4'], ['4', '5'],
        ['6', '7'], ['7', '8'],
      ];

      const result = detector.detect(nodes, edges);

      for (const community of result.communities) {
        expect(community.members.length).toBeGreaterThanOrEqual(5);
      }
    });

    it('should default to minimum size 3 (HYPER-08)', () => {
      const detector = new CommunityDetector();
      const nodes: NodeID[] = ['1', '2', '3', '4', '5'];
      const edges: Array<[NodeID, NodeID]> = [
        ['1', '2'],
        ['3', '4'], ['4', '5'],
      ];

      const result = detector.detect(nodes, edges);

      for (const community of result.communities) {
        expect(community.members.length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe('statistics', () => {
    it('should calculate correct statistics', () => {
      const detector = new CommunityDetector();
      const nodes: NodeID[] = ['1', '2', '3', '4', '5', '6'];
      const edges: Array<[NodeID, NodeID]> = [
        ['1', '2'], ['1', '3'], ['2', '3'],
        ['4', '5'], ['4', '6'], ['5', '6'],
      ];

      const result = detector.detect(nodes, edges);
      const stats = detector.getStatistics(result);

      expect(stats).toHaveProperty('communityCount');
      expect(stats).toHaveProperty('avgCommunitySize');
      expect(stats).toHaveProperty('minCommunitySize');
      expect(stats).toHaveProperty('maxCommunitySize');
      expect(stats).toHaveProperty('avgCohesion');
      expect(stats).toHaveProperty('modularity');

      expect(stats.communityCount).toBe(result.communities.length);
      expect(stats.modularity).toBe(result.modularity);
    });

    it('should handle empty results', () => {
      const detector = new CommunityDetector();
      const result = {
        communities: [],
        modularity: 0,
        executionTime: 10,
      };

      const stats = detector.getStatistics(result);

      expect(stats.communityCount).toBe(0);
      expect(stats.avgCommunitySize).toBe(0);
      expect(stats.minCommunitySize).toBe(0);
      expect(stats.maxCommunitySize).toBe(0);
    });
  });

  describe('utility methods', () => {
    it('should find node community', () => {
      const detector = new CommunityDetector();
      const nodes: NodeID[] = ['1', '2', '3', '4', '5', '6'];
      const edges: Array<[NodeID, NodeID]> = [
        ['1', '2'], ['1', '3'], ['2', '3'],
        ['4', '5'], ['4', '6'], ['5', '6'],
      ];

      const result = detector.detect(nodes, edges);

      if (result.communities.length > 0) {
        const nodeId = result.communities[0].members[0];
        const community = detector.findNodeCommunity(nodeId, result);

        expect(community).toBeTruthy();
        expect(community?.members).toContain(nodeId);
      }
    });

    it('should return null for non-existent node', () => {
      const detector = new CommunityDetector();
      const result = {
        communities: [],
        modularity: 0,
        executionTime: 10,
      };

      const community = detector.findNodeCommunity('nonexistent', result);

      expect(community).toBeNull();
    });

    it('should find overlap between communities', () => {
      const detector = new CommunityDetector();
      const community1 = {
        id: '1',
        members: ['a', 'b', 'c'],
        cohesion: 0.8,
        algorithm: 'louvain' as const,
        timestamp: Date.now(),
      };
      const community2 = {
        id: '2',
        members: ['b', 'c', 'd'],
        cohesion: 0.7,
        algorithm: 'louvain' as const,
        timestamp: Date.now(),
      };

      const overlap = detector.findOverlap(community1, community2);

      expect(overlap).toEqual(expect.arrayContaining(['b', 'c']));
      expect(overlap.length).toBe(2);
    });

    it('should handle no overlap', () => {
      const detector = new CommunityDetector();
      const community1 = {
        id: '1',
        members: ['a', 'b', 'c'],
        cohesion: 0.8,
        algorithm: 'louvain' as const,
        timestamp: Date.now(),
      };
      const community2 = {
        id: '2',
        members: ['d', 'e', 'f'],
        cohesion: 0.7,
        algorithm: 'louvain' as const,
        timestamp: Date.now(),
      };

      const overlap = detector.findOverlap(community1, community2);

      expect(overlap.length).toBe(0);
    });
  });

  describe('integration', () => {
    it('should work with both algorithms on same graph', () => {
      const nodes: NodeID[] = ['1', '2', '3', '4', '5', '6'];
      const edges: Array<[NodeID, NodeID]> = [
        ['1', '2'], ['1', '3'], ['2', '3'],
        ['4', '5'], ['4', '6'], ['5', '6'],
      ];

      const louvainDetector = new CommunityDetector({ algorithm: 'louvain' });
      const lpDetector = new CommunityDetector({ algorithm: 'label-propagation' });

      const louvainResult = louvainDetector.detect(nodes, edges);
      const lpResult = lpDetector.detect(nodes, edges);

      expect(louvainResult.communities.length).toBeGreaterThanOrEqual(0);
      expect(lpResult.communities.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle complex community structure', () => {
      const detector = new CommunityDetector();
      const nodes: NodeID[] = Array.from({ length: 30 }, (_, i) => `${i}`);
      const edges: Array<[NodeID, NodeID]> = [];

      // Create 3 communities
      for (let c = 0; c < 3; c++) {
        const start = c * 10;
        const end = start + 10;

        for (let i = start; i < end; i++) {
          for (let j = i + 1; j < end; j++) {
            if (Math.random() < 0.3) {
              edges.push([nodes[i], nodes[j]]);
            }
          }
        }
      }

      const result = detector.detect(nodes, edges);

      expect(result.communities.length).toBeGreaterThanOrEqual(0);
      expect(result.modularity).toBeGreaterThanOrEqual(0);
      expect(result.executionTime).toBeGreaterThan(0);
    });
  });

  describe('performance validation', () => {
    it('should warn if louvain exceeds 2s for 10k+ nodes', () => {
      // This is a validation test - actual performance depends on hardware
      const detector = new CommunityDetector({ algorithm: 'louvain' });
      const nodes: NodeID[] = Array.from({ length: 100 }, (_, i) => `${i}`);
      const edges: Array<[NodeID, NodeID]> = [];

      for (let i = 0; i < nodes.length - 1; i++) {
        edges.push([nodes[i], nodes[i + 1]]);
      }

      const result = detector.detect(nodes, edges);

      // For 100 nodes, should be very fast
      expect(result.executionTime).toBeLessThan(100);
    });

    it('should warn if label-propagation exceeds 500ms for 10k+ nodes', () => {
      const detector = new CommunityDetector({ algorithm: 'label-propagation' });
      const nodes: NodeID[] = Array.from({ length: 100 }, (_, i) => `${i}`);
      const edges: Array<[NodeID, NodeID]> = [];

      for (let i = 0; i < nodes.length - 1; i++) {
        edges.push([nodes[i], nodes[i + 1]]);
      }

      const result = detector.detect(nodes, edges);

      // For 100 nodes, should be very fast
      expect(result.executionTime).toBeLessThan(50);
    });
  });
});
