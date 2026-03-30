/**
 * Unified Anomaly Detector Tests
 * Tests unified interface and alert generation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AnomalyDetector, createAnomalyDetector } from '../../../../../src/god-agent/core/hyperedge/anomaly/anomaly-detector.js';
import { LouvainDetector } from '../../../../../src/god-agent/core/hyperedge/community/louvain.js';
import type { GraphStructure } from '../../../../../src/god-agent/core/hyperedge/anomaly/graph-anomaly-detector.js';

describe('AnomalyDetector', () => {
  describe('initialization', () => {
    it('should initialize with LOF algorithm', () => {
      const detector = new AnomalyDetector({
        algorithm: 'lof',
        kNeighbors: 10,
        minConfidence: 0.8
      });

      expect(detector).toBeDefined();
      expect(detector.getConfig().algorithm).toBe('lof');
    });

    it('should initialize with isolation-forest algorithm', () => {
      const detector = new AnomalyDetector({
        algorithm: 'isolation-forest',
        minConfidence: 0.85
      });

      expect(detector).toBeDefined();
      expect(detector.getConfig().algorithm).toBe('isolation-forest');
    });

    it('should throw error for unsupported algorithm', () => {
      expect(() => {
        new AnomalyDetector({
          algorithm: 'statistical'
        });
      }).toThrow();
    });

    it('should use default configuration values', () => {
      const detector = new AnomalyDetector({
        algorithm: 'lof'
      });

      const config = detector.getConfig();

      expect(config.minConfidence).toBe(0.8);
      expect(config.kNeighbors).toBe(10);
      expect(config.contamination).toBe(0.1);
    });
  });

  describe('factory function', () => {
    it('should create detector via factory', () => {
      const detector = createAnomalyDetector({
        algorithm: 'lof',
        kNeighbors: 15
      });

      expect(detector).toBeInstanceOf(AnomalyDetector);
    });
  });

  describe('LOF detection', () => {
    let detector: AnomalyDetector;

    beforeEach(() => {
      detector = new AnomalyDetector({
        algorithm: 'lof',
        kNeighbors: 5,
        minConfidence: 0.8
      });
    });

    it('should detect anomalies using LOF', () => {
      const points = [
        ...Array.from({ length: 20 }, (_, i) => ({
          id: `n${i}`,
          embedding: new Float32Array([Math.random(), Math.random()])
        })),
        { id: 'outlier', embedding: new Float32Array([100, 100]) }
      ];

      detector.addPoints(points);

      const result = detector.detectLOF('outlier');

      expect(result).not.toBeNull();
      expect(result!.algorithm).toBe('lof');
    });

    it('should use detect() method for LOF', () => {
      const points = Array.from({ length: 15 }, (_, i) => ({
        id: `p${i}`,
        embedding: new Float32Array([Math.random(), Math.random()])
      }));

      detector.addPoints(points);

      const result = detector.detect('p0');
      expect(result).toBeDefined();
    });

    it('should throw error if LOF not initialized', () => {
      const graphDetector = new AnomalyDetector({
        algorithm: 'isolation-forest'
      });

      expect(() => graphDetector.detectLOF('test')).toThrow();
    });
  });

  describe('graph-based detection', () => {
    let detector: AnomalyDetector;

    beforeEach(() => {
      detector = new AnomalyDetector({
        algorithm: 'isolation-forest',
        minConfidence: 0.8
      });
    });

    it('should detect graph anomalies', () => {
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

      const result = detector.detectGraph('isolated');

      expect(result).not.toBeNull();
      expect(result!.algorithm).toBe('isolation-forest');
    });

    it('should use detect() method for graphs', () => {
      const graph: GraphStructure = {
        nodes: ['a', 'b'],
        edges: new Map([['a', ['b']], ['b', ['a']]])
      };

      detector.setGraph(graph);

      const result = detector.detect('a');
      expect(result).toBeDefined();
    });

    it('should throw error if graph detector not initialized', () => {
      const lofDetector = new AnomalyDetector({
        algorithm: 'lof'
      });

      expect(() => lofDetector.detectGraph('test')).toThrow();
    });

    it('should integrate with community detector', () => {
      const graph: GraphStructure = {
        nodes: ['a1', 'a2', 'b1', 'b2', 'bridge'],
        edges: new Map([
          ['a1', ['a2', 'bridge']],
          ['a2', ['a1']],
          ['bridge', ['a1', 'b1']],
          ['b1', ['b2', 'bridge']],
          ['b2', ['b1']]
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
      const result = louvain.detect(nodes, edges);

      detector.setCommunityDetector(result);

      expect(() => detector.detect('bridge')).not.toThrow();
    });
  });

  describe('alert generation', () => {
    it('should generate alerts for high-confidence anomalies', () => {
      const detector = new AnomalyDetector({
        algorithm: 'isolation-forest',
        minConfidence: 0.8
      });

      const graph: GraphStructure = {
        nodes: ['a', 'b', 'isolated'],
        edges: new Map([
          ['a', ['b']],
          ['b', ['a']],
          ['isolated', []]
        ])
      };

      detector.setGraph(graph);

      const result = detector.detectBatch(['a', 'b', 'isolated']);

      expect(result.alerts.length).toBeGreaterThan(0);

      for (const alert of result.alerts) {
        expect(alert.anomaly.confidence).toBeGreaterThanOrEqual(0.8);
        expect(alert.severity).toBeDefined();
        expect(alert.acknowledged).toBe(false);
      }
    });

    it('should classify severity correctly', () => {
      const detector = new AnomalyDetector({
        algorithm: 'lof',
        kNeighbors: 5,
        minConfidence: 0.5
      });

      const points = [
        ...Array.from({ length: 20 }, (_, i) => ({
          id: `n${i}`,
          embedding: new Float32Array([Math.random() * 2, Math.random() * 2])
        })),
        { id: 'extreme', embedding: new Float32Array([1000, 1000]) }
      ];

      detector.addPoints(points);

      const result = detector.detectBatch(['extreme']);

      if (result.alerts.length > 0) {
        const alert = result.alerts[0];

        // Verify severity mapping
        if (alert.anomaly.confidence >= 0.95) {
          expect(alert.severity).toBe('critical');
        } else if (alert.anomaly.confidence >= 0.9) {
          expect(alert.severity).toBe('high');
        } else if (alert.anomaly.confidence >= 0.85) {
          expect(alert.severity).toBe('medium');
        } else {
          expect(alert.severity).toBe('low');
        }
      }
    });

    it('should include unique alert IDs', () => {
      const detector = new AnomalyDetector({
        algorithm: 'isolation-forest'
      });

      const graph: GraphStructure = {
        nodes: ['i1', 'i2', 'i3'],
        edges: new Map([
          ['i1', []],
          ['i2', []],
          ['i3', []]
        ])
      };

      detector.setGraph(graph);

      const result = detector.detectBatch(['i1', 'i2', 'i3']);

      const alertIds = new Set(result.alerts.map(a => a.id));
      expect(alertIds.size).toBe(result.alerts.length);
    });
  });

  describe('batch detection', () => {
    it('should process batch efficiently', () => {
      const detector = new AnomalyDetector({
        algorithm: 'lof',
        kNeighbors: 5
      });

      const points = Array.from({ length: 50 }, (_, i) => ({
        id: `p${i}`,
        embedding: new Float32Array([Math.random(), Math.random()])
      }));

      detector.addPoints(points);

      const entityIds = points.slice(0, 20).map(p => p.id);

      const result = detector.detectBatch(entityIds);

      expect(result.stats.totalEntities).toBe(20);
      expect(result.stats.executionTimeMs).toBeGreaterThan(0);
      expect(result.anomalies.length).toBeGreaterThanOrEqual(0);
    });

    it('should calculate statistics correctly', () => {
      const detector = new AnomalyDetector({
        algorithm: 'isolation-forest'
      });

      const graph: GraphStructure = {
        nodes: ['a', 'b', 'c', 'i1', 'i2'],
        edges: new Map([
          ['a', ['b', 'c']],
          ['b', ['a', 'c']],
          ['c', ['a', 'b']],
          ['i1', []],
          ['i2', []]
        ])
      };

      detector.setGraph(graph);

      const result = detector.detectBatch(['a', 'b', 'c', 'i1', 'i2']);

      expect(result.stats.totalEntities).toBe(5);
      expect(result.stats.anomaliesFound).toBeGreaterThanOrEqual(0);

      if (result.stats.anomaliesFound > 0) {
        expect(result.stats.averageConfidence).toBeGreaterThan(0);
      } else {
        expect(result.stats.averageConfidence).toBe(0);
      }
    });

    it('should handle errors gracefully', () => {
      const detector = new AnomalyDetector({
        algorithm: 'lof',
        kNeighbors: 5
      });

      const points = Array.from({ length: 10 }, (_, i) => ({
        id: `p${i}`,
        embedding: new Float32Array([Math.random(), Math.random()])
      }));

      detector.addPoints(points);

      // Include non-existent IDs
      const result = detector.detectBatch(['p0', 'nonexistent', 'p1']);

      // Should skip errors and continue
      expect(result.stats.totalEntities).toBe(3);
    });
  });

  describe('data management', () => {
    it('should clear all data', () => {
      const detector = new AnomalyDetector({
        algorithm: 'lof'
      });

      detector.addPoints([
        { id: 'p1', embedding: new Float32Array([1, 2]) },
        { id: 'p2', embedding: new Float32Array([3, 4]) }
      ]);

      detector.clear();

      const stats = detector.getStats();
      expect(stats).toBeDefined();
    });

    it('should get configuration', () => {
      const detector = new AnomalyDetector({
        algorithm: 'lof',
        kNeighbors: 15,
        minConfidence: 0.85
      });

      const config = detector.getConfig();

      expect(config.algorithm).toBe('lof');
      expect(config.kNeighbors).toBe(15);
      expect(config.minConfidence).toBe(0.85);
    });

    it('should get detector statistics', () => {
      const detector = new AnomalyDetector({
        algorithm: 'lof'
      });

      detector.addPoints([
        { id: 'p1', embedding: new Float32Array([1, 2]) }
      ]);

      const stats = detector.getStats();
      expect(stats).toBeDefined();
    });
  });

  describe('confidence threshold enforcement (HYPER-10)', () => {
    it('should only generate alerts for confidence >= 0.8', () => {
      const detector = new AnomalyDetector({
        algorithm: 'lof',
        minConfidence: 0.8
      });

      const points = Array.from({ length: 30 }, (_, i) => ({
        id: `p${i}`,
        embedding: new Float32Array([Math.random(), Math.random()])
      }));

      detector.addPoints(points);

      const result = detector.detectBatch(points.map(p => p.id));

      // All alerts must meet threshold
      for (const alert of result.alerts) {
        expect(alert.anomaly.confidence).toBeGreaterThanOrEqual(0.8);
      }
    });

    it('should respect custom confidence threshold', () => {
      const detector = new AnomalyDetector({
        algorithm: 'isolation-forest',
        minConfidence: 0.9
      });

      const graph: GraphStructure = {
        nodes: ['a', 'b', 'isolated'],
        edges: new Map([
          ['a', ['b']],
          ['b', ['a']],
          ['isolated', []]
        ])
      };

      detector.setGraph(graph);

      const result = detector.detectBatch(['a', 'b', 'isolated']);

      for (const anomaly of result.anomalies) {
        expect(anomaly.confidence).toBeGreaterThanOrEqual(0.9);
      }
    });
  });

  describe('algorithm selection', () => {
    it('should route to correct detector based on algorithm', () => {
      const lofDetector = new AnomalyDetector({ algorithm: 'lof' });
      const graphDetector = new AnomalyDetector({
        algorithm: 'isolation-forest'
      });

      expect(lofDetector.getConfig().algorithm).toBe('lof');
      expect(graphDetector.getConfig().algorithm).toBe('isolation-forest');
    });

    it('should throw error for unsupported algorithm in detect', () => {
      const detector = new AnomalyDetector({ algorithm: 'lof' });

      // Manually change config (for testing)
      (detector as any).config.algorithm = 'unsupported';

      expect(() => detector.detect('test')).toThrow();
    });
  });

  describe('alert structure', () => {
    it('should create valid alert structure', () => {
      const detector = new AnomalyDetector({
        algorithm: 'isolation-forest'
      });

      const graph: GraphStructure = {
        nodes: ['isolated'],
        edges: new Map([['isolated', []]])
      };

      detector.setGraph(graph);

      const result = detector.detectBatch(['isolated']);

      if (result.alerts.length > 0) {
        const alert = result.alerts[0];

        expect(alert).toMatchObject({
          id: expect.any(String),
          anomaly: expect.any(Object),
          severity: expect.stringMatching(/^(low|medium|high|critical)$/),
          triggered: expect.any(Number),
          acknowledged: false
        });
      }
    });
  });
});
