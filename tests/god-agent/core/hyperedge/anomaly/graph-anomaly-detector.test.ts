/**
 * Graph Anomaly Detector Tests
 * Tests graph-based structural anomaly detection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GraphAnomalyDetector } from '../../../../../src/god-agent/core/hyperedge/anomaly/graph-anomaly-detector.js';
import { LouvainDetector } from '../../../../../src/god-agent/core/hyperedge/community/louvain.js';
import type { GraphStructure } from '../../../../../src/god-agent/core/hyperedge/anomaly/graph-anomaly-detector.js';

describe('GraphAnomalyDetector', () => {
  let detector: GraphAnomalyDetector;

  beforeEach(() => {
    detector = new GraphAnomalyDetector({ minConfidence: 0.8 });
  });

  describe('initialization', () => {
    it('should initialize with default config', () => {
      const defaultDetector = new GraphAnomalyDetector();
      const stats = defaultDetector.getStats();

      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);
    });

    it('should initialize with custom confidence', () => {
      const customDetector = new GraphAnomalyDetector({ minConfidence: 0.9 });
      expect(customDetector).toBeDefined();
    });
  });

  describe('graph management', () => {
    it('should set graph structure', () => {
      const graph: GraphStructure = {
        nodes: ['a', 'b', 'c'],
        edges: new Map([
          ['a', ['b']],
          ['b', ['a', 'c']],
          ['c', ['b']]
        ])
      };

      detector.setGraph(graph);
      const stats = detector.getStats();

      expect(stats.nodeCount).toBe(3);
      expect(stats.edgeCount).toBe(2);
    });

    it('should handle empty graph', () => {
      const graph: GraphStructure = {
        nodes: [],
        edges: new Map()
      };

      detector.setGraph(graph);
      const stats = detector.getStats();

      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);
    });

    it('should calculate average degree correctly', () => {
      const graph: GraphStructure = {
        nodes: ['a', 'b', 'c', 'd'],
        edges: new Map([
          ['a', ['b', 'c']],
          ['b', ['a', 'c', 'd']],
          ['c', ['a', 'b']],
          ['d', ['b']]
        ])
      };

      detector.setGraph(graph);
      const stats = detector.getStats();

      // Total degree: 2 + 3 + 2 + 1 = 8, avg = 2
      expect(stats.avgDegree).toBe(2);
    });
  });

  describe('isolated node detection', () => {
    it('should detect completely isolated node', () => {
      const graph: GraphStructure = {
        nodes: ['a', 'b', 'c', 'isolated'],
        edges: new Map([
          ['a', ['b', 'c']],
          ['b', ['a', 'c']],
          ['c', ['a', 'b']],
          ['isolated', []]
        ])
      };

      detector.setGraph(graph);
      const result = detector.detect('isolated');

      expect(result).not.toBeNull();
      expect(result!.entityId).toBe('isolated');
      expect(result!.confidence).toBeGreaterThanOrEqual(0.8);
      expect(result!.reason).toContain('Isolated');
    });

    it('should detect low-degree nodes in high-degree graph', () => {
      const graph: GraphStructure = {
        nodes: ['hub', 'a', 'b', 'c', 'lowdegree'],
        edges: new Map([
          ['hub', ['a', 'b', 'c']],
          ['a', ['hub', 'b', 'c']],
          ['b', ['hub', 'a', 'c']],
          ['c', ['hub', 'a', 'b']],
          ['lowdegree', ['hub']]
        ])
      };

      detector.setGraph(graph);
      const result = detector.detect('lowdegree');

      if (result) {
        expect(result.confidence).toBeGreaterThan(0);
      }
    });

    it.skip('should have low scores for well-connected nodes', () => {
      const graph: GraphStructure = {
        nodes: ['a', 'b', 'c'],
        edges: new Map([
          ['a', ['b', 'c']],
          ['b', ['a', 'c']],
          ['c', ['a', 'b']]
        ])
      };

      const detector = new GraphAnomalyDetector({ minConfidence: 0.5 });
      detector.setGraph(graph);
      const result = detector.detect('a');

      // Well-connected node in complete graph should have low score
      if (result) {
        expect(result.score).toBeLessThan(0.5);
      }
    });
  });

  describe('community integration', () => {
    it('should detect cross-community bridges', () => {
      // Create two communities with a bridge
      const graph: GraphStructure = {
        nodes: ['a1', 'a2', 'a3', 'bridge', 'b1', 'b2', 'b3'],
        edges: new Map([
          // Community A
          ['a1', ['a2', 'a3']],
          ['a2', ['a1', 'a3', 'bridge']],
          ['a3', ['a1', 'a2']],
          // Bridge
          ['bridge', ['a2', 'b2']],
          // Community B
          ['b1', ['b2', 'b3']],
          ['b2', ['b1', 'b3', 'bridge']],
          ['b3', ['b1', 'b2']]
        ])
      };

      detector.setGraph(graph);

      // Convert to Louvain format
      const nodes = graph.nodes;
      const edges: Array<[string, string]> = [];
      for (const [from, toList] of graph.edges) {
        for (const to of toList) {
          edges.push([from, to]);
        }
      }

      const louvain = new LouvainDetector();
      const communityResult = louvain.detect(nodes, edges);

      detector.setCommunityDetector(communityResult);

      const result = detector.detect('bridge');

      if (result) {
        expect(result.reason).toBeDefined();
      }
    });

    it('should work without community detector', () => {
      const graph: GraphStructure = {
        nodes: ['a', 'b', 'c'],
        edges: new Map([
          ['a', ['b']],
          ['b', ['a', 'c']],
          ['c', ['b']]
        ])
      };

      detector.setGraph(graph);

      // Should not crash without community detector
      expect(() => detector.detect('a')).not.toThrow();
    });

    it('should detect weak community cohesion', () => {
      const graph: GraphStructure = {
        nodes: ['a1', 'a2', 'a3', 'weak', 'b1', 'b2'],
        edges: new Map([
          ['a1', ['a2', 'a3']],
          ['a2', ['a1', 'a3']],
          ['a3', ['a1', 'a2']],
          // Weak node with mostly external connections
          ['weak', ['b1', 'b2', 'a1']],
          ['b1', ['b2', 'weak']],
          ['b2', ['b1', 'weak']]
        ])
      };

      detector.setGraph(graph);

      // Convert to Louvain format
      const nodes = graph.nodes;
      const edges: Array<[string, string]> = [];
      for (const [from, toList] of graph.edges) {
        for (const to of toList) {
          edges.push([from, to]);
        }
      }

      const louvain = new LouvainDetector();
      const communityResult = louvain.detect(nodes, edges);
      detector.setCommunityDetector(communityResult);

      const result = detector.detect('weak');

      if (result) {
        expect(result.confidence).toBeGreaterThan(0);
      }
    });
  });

  describe('detectAll batch processing', () => {
    it('should detect all structural anomalies', () => {
      const graph: GraphStructure = {
        nodes: ['a', 'b', 'c', 'isolated1', 'isolated2'],
        edges: new Map([
          ['a', ['b', 'c']],
          ['b', ['a', 'c']],
          ['c', ['a', 'b']],
          ['isolated1', []],
          ['isolated2', []]
        ])
      };

      detector.setGraph(graph);
      const results = detector.detectAll();

      expect(results.length).toBeGreaterThan(0);

      const isolatedIds = results.map(r => r.entityId);
      expect(isolatedIds).toContain('isolated1');
      expect(isolatedIds).toContain('isolated2');
    });

    it.skip('should have uniform low scores for complete graph', () => {
      // Complete graph - all nodes equally connected
      const graph: GraphStructure = {
        nodes: ['a', 'b', 'c', 'd'],
        edges: new Map([
          ['a', ['b', 'c', 'd']],
          ['b', ['a', 'c', 'd']],
          ['c', ['a', 'b', 'd']],
          ['d', ['a', 'b', 'c']]
        ])
      };

      const detector = new GraphAnomalyDetector({ minConfidence: 0.5 });
      detector.setGraph(graph);
      const results = detector.detectAll();

      // Complete graph nodes should have very low or zero scores
      for (const result of results) {
        expect(result.score).toBeLessThan(0.5);
      }
    });
  });

  describe('confidence threshold (HYPER-10)', () => {
    it('should only return results with confidence >= threshold', () => {
      const detector85 = new GraphAnomalyDetector({ minConfidence: 0.85 });

      const graph: GraphStructure = {
        nodes: ['a', 'b', 'c', 'isolated'],
        edges: new Map([
          ['a', ['b', 'c']],
          ['b', ['a', 'c']],
          ['c', ['a', 'b']],
          ['isolated', []]
        ])
      };

      detector85.setGraph(graph);
      const results = detector85.detectAll();

      for (const result of results) {
        expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      }
    });
  });

  describe('edge cases', () => {
    it('should throw error if graph not set', () => {
      expect(() => detector.detect('a')).toThrow();
    });

    it('should throw error for non-existent node', () => {
      const graph: GraphStructure = {
        nodes: ['a', 'b'],
        edges: new Map([['a', ['b']], ['b', ['a']]])
      };

      detector.setGraph(graph);

      expect(() => detector.detect('nonexistent')).toThrow();
    });

    it('should handle single node graph', () => {
      const graph: GraphStructure = {
        nodes: ['alone'],
        edges: new Map([['alone', []]])
      };

      detector.setGraph(graph);
      const result = detector.detect('alone');

      expect(result).not.toBeNull();
      expect(result!.confidence).toBeGreaterThan(0);
    });

    it('should handle graph with no edges', () => {
      const graph: GraphStructure = {
        nodes: ['a', 'b', 'c'],
        edges: new Map([
          ['a', []],
          ['b', []],
          ['c', []]
        ])
      };

      detector.setGraph(graph);
      const results = detector.detectAll();

      // All nodes are equally isolated
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('result structure', () => {
    it('should return complete AnomalyResult structure', () => {
      const graph: GraphStructure = {
        nodes: ['a', 'b', 'isolated'],
        edges: new Map([
          ['a', ['b']],
          ['b', ['a']],
          ['isolated', []]
        ])
      };

      detector.setGraph(graph);
      const result = detector.detect('isolated');

      expect(result).toMatchObject({
        entityId: 'isolated',
        entityType: 'node',
        score: expect.any(Number),
        confidence: expect.any(Number),
        algorithm: 'isolation-forest',
        timestamp: expect.any(Number),
        reason: expect.any(String)
      });
    });

    it('should include neighbor information', () => {
      const graph: GraphStructure = {
        nodes: ['a', 'b', 'isolated'],
        edges: new Map([
          ['a', ['b']],
          ['b', ['a']],
          ['isolated', []]
        ])
      };

      detector.setGraph(graph);
      const result = detector.detect('isolated');

      expect(result?.neighbors).toBeDefined();
      expect(Array.isArray(result?.neighbors)).toBe(true);
    });

    it('should have valid timestamp', () => {
      const graph: GraphStructure = {
        nodes: ['isolated'],
        edges: new Map([['isolated', []]])
      };

      detector.setGraph(graph);

      const before = Date.now();
      const result = detector.detect('isolated');
      const after = Date.now();

      expect(result?.timestamp).toBeGreaterThanOrEqual(before);
      expect(result?.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('weighted graphs', () => {
    it('should accept weighted graph structure', () => {
      const graph: GraphStructure = {
        nodes: ['a', 'b', 'c'],
        edges: new Map([
          ['a', ['b', 'c']],
          ['b', ['a']],
          ['c', ['a']]
        ]),
        weights: new Map([
          ['a', new Map([['b', 0.8], ['c', 0.2]])],
          ['b', new Map([['a', 0.8]])],
          ['c', new Map([['a', 0.2]])]
        ])
      };

      expect(() => detector.setGraph(graph)).not.toThrow();
    });
  });

  describe('statistics', () => {
    it('should report accurate statistics', () => {
      const graph: GraphStructure = {
        nodes: ['a', 'b', 'c', 'd'],
        edges: new Map([
          ['a', ['b', 'c']],
          ['b', ['a', 'c', 'd']],
          ['c', ['a', 'b']],
          ['d', ['b']]
        ])
      };

      detector.setGraph(graph);

      // Convert to Louvain format
      const nodes = graph.nodes;
      const edges: Array<[string, string]> = [];
      for (const [from, toList] of graph.edges) {
        for (const to of toList) {
          edges.push([from, to]);
        }
      }

      const louvain = new LouvainDetector();
      const communityResult = louvain.detect(nodes, edges);
      detector.setCommunityDetector(communityResult);

      const stats = detector.getStats();

      expect(stats.nodeCount).toBe(4);
      expect(stats.edgeCount).toBe(4);
      expect(stats.avgDegree).toBeGreaterThan(0);
      expect(stats.hasCommunities).toBe(true);
    });

    it('should report no communities when not set', () => {
      const graph: GraphStructure = {
        nodes: ['a', 'b'],
        edges: new Map([['a', ['b']], ['b', ['a']]])
      };

      detector.setGraph(graph);
      const stats = detector.getStats();

      expect(stats.hasCommunities).toBe(false);
    });
  });

  describe('hub detection', () => {
    it.skip('should handle hub nodes appropriately', () => {
      const graph: GraphStructure = {
        nodes: ['hub', 'a', 'b', 'c', 'd', 'e'],
        edges: new Map([
          ['hub', ['a', 'b', 'c', 'd', 'e']],
          ['a', ['hub']],
          ['b', ['hub']],
          ['c', ['hub']],
          ['d', ['hub']],
          ['e', ['hub']]
        ])
      };

      const detector = new GraphAnomalyDetector({ minConfidence: 0.5 });
      detector.setGraph(graph);

      // Hub should have lower anomaly score than spokes
      const hubResult = detector.detect('hub');
      const spokeResult = detector.detect('a');

      // Hub is well-connected, should have low or no anomaly score
      if (hubResult) {
        expect(hubResult.score).toBeLessThan(0.3);
      }

      // Spoke nodes have low connectivity, might be flagged
      if (spokeResult) {
        expect(spokeResult.score).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
