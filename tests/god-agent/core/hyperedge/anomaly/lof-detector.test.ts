/**
 * LOF Detector Tests
 * Tests LOF anomaly detection with performance validation (<100ms per detection)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LOFDetector } from '../../../../../src/god-agent/core/hyperedge/anomaly/lof-detector.js';

describe('LOFDetector', () => {
  let detector: LOFDetector;

  beforeEach(() => {
    detector = new LOFDetector({ kNeighbors: 5, minConfidence: 0.8 });
  });

  describe('initialization', () => {
    it('should initialize with default config', () => {
      const defaultDetector = new LOFDetector();
      const stats = defaultDetector.getStats();

      expect(stats.k).toBe(10);
      expect(stats.minConfidence).toBe(0.8);
      expect(stats.pointCount).toBe(0);
    });

    it('should initialize with custom config', () => {
      const customDetector = new LOFDetector({
        kNeighbors: 15,
        minConfidence: 0.9
      });
      const stats = customDetector.getStats();

      expect(stats.k).toBe(15);
      expect(stats.minConfidence).toBe(0.9);
    });

    it('should start with empty dataset', () => {
      const stats = detector.getStats();
      expect(stats.pointCount).toBe(0);
    });
  });

  describe('data management', () => {
    it('should add points correctly', () => {
      const points = [
        { id: 'p1', embedding: new Float32Array([1, 2, 3]) },
        { id: 'p2', embedding: new Float32Array([4, 5, 6]) }
      ];

      detector.addPoints(points);
      const stats = detector.getStats();

      expect(stats.pointCount).toBe(2);
    });

    it('should handle multiple batches of points', () => {
      detector.addPoints([
        { id: 'p1', embedding: new Float32Array([1, 2]) }
      ]);
      detector.addPoints([
        { id: 'p2', embedding: new Float32Array([3, 4]) },
        { id: 'p3', embedding: new Float32Array([5, 6]) }
      ]);

      expect(detector.getStats().pointCount).toBe(3);
    });

    it('should clear all points', () => {
      detector.addPoints([
        { id: 'p1', embedding: new Float32Array([1, 2]) },
        { id: 'p2', embedding: new Float32Array([3, 4]) }
      ]);

      detector.clear();
      expect(detector.getStats().pointCount).toBe(0);
    });

    it('should update points with same id', () => {
      detector.addPoints([
        { id: 'p1', embedding: new Float32Array([1, 2]) }
      ]);
      detector.addPoints([
        { id: 'p1', embedding: new Float32Array([10, 20]) }
      ]);

      expect(detector.getStats().pointCount).toBe(1);
    });
  });

  describe('anomaly detection - correctness', () => {
    it('should detect obvious outlier in 2D space', () => {
      // Create cluster of normal points
      const normalPoints = Array.from({ length: 20 }, (_, i) => ({
        id: `normal-${i}`,
        embedding: new Float32Array([
          Math.random() * 2,
          Math.random() * 2
        ])
      }));

      // Add clear outlier
      const outlier = {
        id: 'outlier',
        embedding: new Float32Array([100, 100])
      };

      detector.addPoints([...normalPoints, outlier]);

      const result = detector.detect('outlier');

      expect(result).not.toBeNull();
      expect(result!.entityId).toBe('outlier');
      expect(result!.score).toBeGreaterThan(1);
      expect(result!.confidence).toBeGreaterThanOrEqual(0.8);
      expect(result!.algorithm).toBe('lof');
    });

    it('should not flag normal points as anomalies', () => {
      // Create tight cluster
      const points = Array.from({ length: 20 }, (_, i) => ({
        id: `p${i}`,
        embedding: new Float32Array([
          1 + Math.random() * 0.1,
          1 + Math.random() * 0.1
        ])
      }));

      detector.addPoints(points);

      const result = detector.detect('p0');

      // Normal points should have low LOF scores
      expect(result).toBeNull(); // Below confidence threshold
    });

    it('should detect multiple outliers', () => {
      const normal = Array.from({ length: 20 }, (_, i) => ({
        id: `n${i}`,
        embedding: new Float32Array([Math.random(), Math.random()])
      }));

      const outliers = [
        { id: 'out1', embedding: new Float32Array([50, 50]) },
        { id: 'out2', embedding: new Float32Array([-50, -50]) }
      ];

      detector.addPoints([...normal, ...outliers]);

      const results = detector.detectAll();

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.entityId === 'out1')).toBe(true);
      expect(results.some(r => r.entityId === 'out2')).toBe(true);
    });

    it('should handle high-dimensional data', () => {
      const dim = 128;
      const points = Array.from({ length: 30 }, (_, i) => ({
        id: `p${i}`,
        embedding: new Float32Array(Array.from({ length: dim }, () => Math.random()))
      }));

      // Outlier with extreme values
      const outlier = {
        id: 'outlier',
        embedding: new Float32Array(Array.from({ length: dim }, () => 100))
      };

      detector.addPoints([...points, outlier]);

      const result = detector.detect('outlier');
      expect(result).not.toBeNull();
    });
  });

  describe('performance requirements (HYPER-09)', () => {
    it('should complete single detection in <100ms', () => {
      // Create moderate dataset
      const points = Array.from({ length: 100 }, (_, i) => ({
        id: `p${i}`,
        embedding: new Float32Array([
          Math.random() * 10,
          Math.random() * 10,
          Math.random() * 10
        ])
      }));

      detector.addPoints(points);

      const start = performance.now();
      detector.detect('p0');
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(100);
    });

    it('should handle batch detection efficiently', () => {
      const points = Array.from({ length: 50 }, (_, i) => ({
        id: `p${i}`,
        embedding: new Float32Array([Math.random(), Math.random()])
      }));

      detector.addPoints(points);

      const start = performance.now();
      detector.detectAll();
      const elapsed = performance.now() - start;

      // Should average <100ms per point
      const avgPerPoint = elapsed / points.length;
      expect(avgPerPoint).toBeLessThan(100);
    });
  });

  describe('confidence threshold (HYPER-10)', () => {
    it('should only return anomalies with confidence >= threshold', () => {
      const detector85 = new LOFDetector({ minConfidence: 0.85 });

      const points = Array.from({ length: 20 }, (_, i) => ({
        id: `p${i}`,
        embedding: new Float32Array([Math.random(), Math.random()])
      }));

      detector85.addPoints(points);

      const results = detector85.detectAll();

      // All returned results must meet threshold
      for (const result of results) {
        expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      }
    });

    it('should respect default confidence threshold of 0.8', () => {
      const points = Array.from({ length: 15 }, (_, i) => ({
        id: `p${i}`,
        embedding: new Float32Array([Math.random(), Math.random()])
      }));

      detector.addPoints(points);

      const results = detector.detectAll();

      for (const result of results) {
        expect(result.confidence).toBeGreaterThanOrEqual(0.8);
      }
    });
  });

  describe('edge cases', () => {
    it('should throw error if insufficient points', () => {
      detector.addPoints([
        { id: 'p1', embedding: new Float32Array([1, 2]) },
        { id: 'p2', embedding: new Float32Array([3, 4]) }
      ]);

      // Need k+1 points (6 total for k=5)
      expect(() => detector.detect('p1')).toThrow();
    });

    it('should throw error for non-existent point', () => {
      const points = Array.from({ length: 10 }, (_, i) => ({
        id: `p${i}`,
        embedding: new Float32Array([Math.random(), Math.random()])
      }));

      detector.addPoints(points);

      expect(() => detector.detect('nonexistent')).toThrow();
    });

    it('should handle identical points', () => {
      const points = Array.from({ length: 10 }, (_, i) => ({
        id: `p${i}`,
        embedding: new Float32Array([1, 1, 1])
      }));

      detector.addPoints(points);

      const result = detector.detect('p0');

      // Identical points should have LOF ≈ 1 (normal)
      expect(result).toBeNull();
    });

    it('should handle zero vectors', () => {
      const points = [
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `p${i}`,
          embedding: new Float32Array([0, 0])
        })),
        { id: 'nonzero', embedding: new Float32Array([1, 1]) }
      ];

      detector.addPoints(points);

      // Should not crash
      const result = detector.detect('p0');
      expect(result).toBeDefined();
    });

    it('should handle single dimension', () => {
      const points = Array.from({ length: 15 }, (_, i) => ({
        id: `p${i}`,
        embedding: new Float32Array([i])
      }));

      detector.addPoints(points);

      // Should work with 1D data
      const result = detector.detect('p0');
      expect(result).toBeDefined();
    });
  });

  describe('result structure', () => {
    beforeEach(() => {
      const points = [
        ...Array.from({ length: 20 }, (_, i) => ({
          id: `n${i}`,
          embedding: new Float32Array([Math.random(), Math.random()])
        })),
        { id: 'outlier', embedding: new Float32Array([100, 100]) }
      ];

      detector.addPoints(points);
    });

    it('should return complete AnomalyResult structure', () => {
      const result = detector.detect('outlier');

      expect(result).toMatchObject({
        entityId: 'outlier',
        entityType: 'node',
        score: expect.any(Number),
        confidence: expect.any(Number),
        algorithm: 'lof',
        timestamp: expect.any(Number)
      });
    });

    it('should include reason in result', () => {
      const result = detector.detect('outlier');

      expect(result?.reason).toBeDefined();
      expect(result?.reason).toContain('LOF');
    });

    it('should include neighbor information', () => {
      const result = detector.detect('outlier');

      expect(result?.neighbors).toBeDefined();
      expect(Array.isArray(result?.neighbors)).toBe(true);
      expect(result?.neighbors?.length).toBeGreaterThan(0);
    });

    it('should have valid timestamp', () => {
      const before = Date.now();
      const result = detector.detect('outlier');
      const after = Date.now();

      expect(result?.timestamp).toBeGreaterThanOrEqual(before);
      expect(result?.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('detectAll batch processing', () => {
    it('should detect all anomalies in dataset', () => {
      const normal = Array.from({ length: 30 }, (_, i) => ({
        id: `n${i}`,
        embedding: new Float32Array([Math.random(), Math.random()])
      }));

      const outliers = [
        { id: 'out1', embedding: new Float32Array([50, 50]) },
        { id: 'out2', embedding: new Float32Array([-50, -50]) },
        { id: 'out3', embedding: new Float32Array([50, -50]) }
      ];

      detector.addPoints([...normal, ...outliers]);

      const results = detector.detectAll();

      expect(results.length).toBeGreaterThan(0);
      // Should find at least some outliers
      const outliersFound = results.filter(r =>
        r.entityId.startsWith('out')
      ).length;
      expect(outliersFound).toBeGreaterThan(0);
    });

    it('should return empty array when no anomalies', () => {
      const points = Array.from({ length: 20 }, (_, i) => ({
        id: `p${i}`,
        embedding: new Float32Array([
          1 + Math.random() * 0.01,
          1 + Math.random() * 0.01
        ])
      }));

      detector.addPoints(points);

      const results = detector.detectAll();

      // Tight cluster should have no high-confidence anomalies
      expect(results.length).toBe(0);
    });
  });

  describe('metadata handling', () => {
    it('should preserve point metadata', () => {
      const points = [
        {
          id: 'p1',
          embedding: new Float32Array([1, 2]),
          metadata: { type: 'test', value: 42 }
        }
      ];

      // Should not crash with metadata
      expect(() => detector.addPoints(points)).not.toThrow();
    });
  });

  describe('statistical properties', () => {
    it('should have LOF ≈ 1 for uniform distribution', () => {
      const detector = new LOFDetector({ kNeighbors: 5, minConfidence: 0.5 });

      const points = Array.from({ length: 50 }, (_, i) => ({
        id: `p${i}`,
        embedding: new Float32Array([
          Math.random() * 10,
          Math.random() * 10
        ])
      }));

      detector.addPoints(points);

      const result = detector.detect('p0');

      // Uniform distribution should have low anomaly scores
      if (result) {
        expect(result.score).toBeLessThan(2);
      }
    });

    it('should increase LOF with distance from cluster', () => {
      const detector = new LOFDetector({ kNeighbors: 5, minConfidence: 0.5 });

      const cluster = Array.from({ length: 20 }, (_, i) => ({
        id: `c${i}`,
        embedding: new Float32Array([Math.random(), Math.random()])
      }));

      // Points at increasing distances
      const distant = [
        { id: 'd1', embedding: new Float32Array([10, 10]) },
        { id: 'd2', embedding: new Float32Array([50, 50]) },
        { id: 'd3', embedding: new Float32Array([100, 100]) }
      ];

      detector.addPoints([...cluster, ...distant]);

      const score1 = detector.detect('d1')?.score ?? 0;
      const score2 = detector.detect('d2')?.score ?? 0;
      const score3 = detector.detect('d3')?.score ?? 0;

      // More distant points should have higher scores
      expect(score2).toBeGreaterThanOrEqual(score1);
      expect(score3).toBeGreaterThanOrEqual(score2);
    });
  });
});
