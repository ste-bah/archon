/**
 * Sona Engine Unit Tests
 * TASK-SON-001 - Trajectory Tracking and Weight Management
 *
 * Tests cover:
 * - Trajectory creation and validation
 * - Weight storage and retrieval
 * - Route-based organization
 * - Drift detection
 * - Serialization
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SonaEngine,
  TrajectoryValidationError,
  generateTrajectoryID,
  isValidTrajectoryID,
  generateCheckpointID,
  isValidCheckpointID,
  validateRoute,
  validateTrajectoryInput,
  validateQuality,
  validateLearningRate,
  validateRegularization,
  validateAndApplyConfig,
  clampWeight,
  isValidWeight,
  cosineSimilarity,
  calculateDrift,
  arithmeticMean,
  standardDeviation,
  calculateReward,
  calculateGradient,
  calculateWeightUpdate,
  DEFAULT_LEARNING_RATE,
  DEFAULT_REGULARIZATION,
  DEFAULT_DRIFT_ALERT_THRESHOLD,
  DEFAULT_DRIFT_REJECT_THRESHOLD,
  DEFAULT_INITIAL_WEIGHT,
  WEIGHT_MIN,
  WEIGHT_MAX,
} from '../../../../src/god-agent/core/learning/index.js';

// ==================== ID Generation Tests ====================

describe('ID Generation', () => {
  describe('generateTrajectoryID', () => {
    it('should generate unique IDs', () => {
      const id1 = generateTrajectoryID();
      const id2 = generateTrajectoryID();
      expect(id1).not.toBe(id2);
    });

    it('should match expected format', () => {
      const id = generateTrajectoryID();
      expect(isValidTrajectoryID(id)).toBe(true);
    });

    it('should include timestamp', () => {
      const before = Date.now();
      const id = generateTrajectoryID();
      const after = Date.now();

      const match = id.match(/^traj-(\d+)-[a-f0-9]{8}$/);
      expect(match).not.toBeNull();

      const timestamp = parseInt(match![1], 10);
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('isValidTrajectoryID', () => {
    it('should validate correct format', () => {
      expect(isValidTrajectoryID('traj-1234567890-abcd1234')).toBe(true);
      expect(isValidTrajectoryID('traj-1-00000000')).toBe(true);
    });

    it('should reject invalid formats', () => {
      expect(isValidTrajectoryID('')).toBe(false);
      expect(isValidTrajectoryID('traj')).toBe(false);
      expect(isValidTrajectoryID('traj-abc-12345678')).toBe(false);
      expect(isValidTrajectoryID('traj-123-abc')).toBe(false);
      expect(isValidTrajectoryID('traj-123-ABCD1234')).toBe(false); // uppercase
      expect(isValidTrajectoryID('invalid')).toBe(false);
    });
  });

  describe('generateCheckpointID', () => {
    it('should generate unique checkpoint IDs', () => {
      const id1 = generateCheckpointID();
      const id2 = generateCheckpointID();
      expect(id1).not.toBe(id2);
    });

    it('should match checkpoint format', () => {
      const id = generateCheckpointID();
      expect(isValidCheckpointID(id)).toBe(true);
    });
  });

  describe('isValidCheckpointID', () => {
    it('should validate correct checkpoint format', () => {
      expect(isValidCheckpointID('ckpt-1234567890-abcd1234')).toBe(true);
    });

    it('should reject invalid checkpoint formats', () => {
      expect(isValidCheckpointID('traj-1234567890-abcd1234')).toBe(false);
      expect(isValidCheckpointID('ckpt-abc-12345678')).toBe(false);
    });
  });
});

// ==================== Validation Tests ====================

describe('Validation', () => {
  describe('validateRoute', () => {
    it('should accept valid routes', () => {
      expect(() => validateRoute('reasoning.causal')).not.toThrow();
      expect(() => validateRoute('coding.debug')).not.toThrow();
      expect(() => validateRoute('simple')).not.toThrow();
    });

    it('should reject empty route', () => {
      expect(() => validateRoute('')).toThrow(TrajectoryValidationError);
      expect(() => validateRoute('   ')).toThrow(TrajectoryValidationError);
    });

    it('should reject null/undefined route', () => {
      expect(() => validateRoute(null as any)).toThrow(TrajectoryValidationError);
      expect(() => validateRoute(undefined as any)).toThrow(TrajectoryValidationError);
    });
  });

  describe('validateTrajectoryInput', () => {
    it('should accept valid input', () => {
      expect(() =>
        validateTrajectoryInput({
          route: 'test.route',
          patterns: ['p1', 'p2'],
          context: ['c1'],
        })
      ).not.toThrow();
    });

    it('should accept empty patterns and context', () => {
      expect(() =>
        validateTrajectoryInput({
          route: 'test.route',
          patterns: [],
          context: [],
        })
      ).not.toThrow();
    });

    it('should reject non-array patterns', () => {
      expect(() =>
        validateTrajectoryInput({
          route: 'test.route',
          patterns: 'invalid' as any,
          context: [],
        })
      ).toThrow(TrajectoryValidationError);
    });

    it('should reject non-array context', () => {
      expect(() =>
        validateTrajectoryInput({
          route: 'test.route',
          patterns: [],
          context: 'invalid' as any,
        })
      ).toThrow(TrajectoryValidationError);
    });
  });

  describe('validateQuality', () => {
    it('should accept valid quality scores', () => {
      expect(() => validateQuality(0)).not.toThrow();
      expect(() => validateQuality(0.5)).not.toThrow();
      expect(() => validateQuality(1)).not.toThrow();
    });

    it('should reject out of range quality', () => {
      expect(() => validateQuality(-0.1)).toThrow(TrajectoryValidationError);
      expect(() => validateQuality(1.1)).toThrow(TrajectoryValidationError);
    });

    it('should reject NaN', () => {
      expect(() => validateQuality(NaN)).toThrow(TrajectoryValidationError);
    });
  });

  describe('validateLearningRate', () => {
    it('should accept valid learning rates', () => {
      expect(() => validateLearningRate(0.001)).not.toThrow();
      expect(() => validateLearningRate(0.01)).not.toThrow();
      expect(() => validateLearningRate(0.1)).not.toThrow();
    });

    it('should reject out of range learning rates', () => {
      expect(() => validateLearningRate(0.0001)).toThrow(TrajectoryValidationError);
      expect(() => validateLearningRate(0.5)).toThrow(TrajectoryValidationError);
    });
  });

  describe('validateRegularization', () => {
    it('should accept valid regularization', () => {
      expect(() => validateRegularization(0.01)).not.toThrow();
      expect(() => validateRegularization(0.1)).not.toThrow();
      expect(() => validateRegularization(1.0)).not.toThrow();
    });

    it('should reject out of range regularization', () => {
      expect(() => validateRegularization(0.001)).toThrow(TrajectoryValidationError);
      expect(() => validateRegularization(2.0)).toThrow(TrajectoryValidationError);
    });
  });

  describe('validateAndApplyConfig', () => {
    it('should apply defaults', () => {
      const config = validateAndApplyConfig({});
      expect(config.learningRate).toBe(DEFAULT_LEARNING_RATE);
      expect(config.regularization).toBe(DEFAULT_REGULARIZATION);
      expect(config.driftAlertThreshold).toBe(DEFAULT_DRIFT_ALERT_THRESHOLD);
      expect(config.driftRejectThreshold).toBe(DEFAULT_DRIFT_REJECT_THRESHOLD);
    });

    it('should preserve provided values', () => {
      const config = validateAndApplyConfig({
        learningRate: 0.05,
        regularization: 0.5,
      });
      expect(config.learningRate).toBe(0.05);
      expect(config.regularization).toBe(0.5);
    });

    it('should reject invalid drift thresholds', () => {
      expect(() =>
        validateAndApplyConfig({
          driftAlertThreshold: 0.5,
          driftRejectThreshold: 0.3, // Less than alert
        })
      ).toThrow(TrajectoryValidationError);
    });
  });
});

// ==================== Weight Operations Tests ====================

describe('Weight Operations', () => {
  describe('clampWeight', () => {
    it('should clamp to valid range', () => {
      expect(clampWeight(0.5)).toBe(0.5);
      expect(clampWeight(-2)).toBe(WEIGHT_MIN);
      expect(clampWeight(2)).toBe(WEIGHT_MAX);
    });

    it('should handle edge values', () => {
      expect(clampWeight(WEIGHT_MIN)).toBe(WEIGHT_MIN);
      expect(clampWeight(WEIGHT_MAX)).toBe(WEIGHT_MAX);
    });
  });

  describe('isValidWeight', () => {
    it('should accept valid weights', () => {
      expect(isValidWeight(0)).toBe(true);
      expect(isValidWeight(0.5)).toBe(true);
      expect(isValidWeight(-0.5)).toBe(true);
      expect(isValidWeight(WEIGHT_MIN)).toBe(true);
      expect(isValidWeight(WEIGHT_MAX)).toBe(true);
    });

    it('should reject invalid weights', () => {
      expect(isValidWeight(NaN)).toBe(false);
      expect(isValidWeight(Infinity)).toBe(false);
      expect(isValidWeight(-Infinity)).toBe(false);
      expect(isValidWeight(-1.5)).toBe(false);
      expect(isValidWeight(1.5)).toBe(false);
    });
  });

  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const v = new Float32Array([1, 2, 3]);
      expect(cosineSimilarity(v, v)).toBeCloseTo(1);
    });

    it('should return -1 for opposite vectors', () => {
      const v1 = new Float32Array([1, 0, 0]);
      const v2 = new Float32Array([-1, 0, 0]);
      expect(cosineSimilarity(v1, v2)).toBeCloseTo(-1);
    });

    it('should return 0 for orthogonal vectors', () => {
      const v1 = new Float32Array([1, 0, 0]);
      const v2 = new Float32Array([0, 1, 0]);
      expect(cosineSimilarity(v1, v2)).toBeCloseTo(0);
    });

    it('should handle empty vectors', () => {
      const v = new Float32Array(0);
      expect(cosineSimilarity(v, v)).toBe(1);
    });

    it('should handle zero vectors', () => {
      const v = new Float32Array([0, 0, 0]);
      expect(cosineSimilarity(v, v)).toBe(1);
    });

    it('should throw for different length vectors', () => {
      const v1 = new Float32Array([1, 2]);
      const v2 = new Float32Array([1, 2, 3]);
      expect(() => cosineSimilarity(v1, v2)).toThrow();
    });
  });

  describe('calculateDrift', () => {
    it('should return 0 for identical vectors', () => {
      const v = new Float32Array([1, 2, 3]);
      expect(calculateDrift(v, v)).toBeCloseTo(0);
    });

    it('should return 2 for opposite vectors', () => {
      const v1 = new Float32Array([1, 0, 0]);
      const v2 = new Float32Array([-1, 0, 0]);
      expect(calculateDrift(v1, v2)).toBeCloseTo(2);
    });

    it('should return 1 for orthogonal vectors', () => {
      const v1 = new Float32Array([1, 0, 0]);
      const v2 = new Float32Array([0, 1, 0]);
      expect(calculateDrift(v1, v2)).toBeCloseTo(1);
    });
  });
});

// ==================== Statistics Tests ====================

describe('Statistics', () => {
  describe('arithmeticMean', () => {
    it('should calculate mean correctly', () => {
      expect(arithmeticMean([1, 2, 3, 4, 5])).toBeCloseTo(3);
      expect(arithmeticMean([10, 20])).toBeCloseTo(15);
    });

    it('should handle single value', () => {
      expect(arithmeticMean([5])).toBe(5);
    });

    it('should return 0 for empty array', () => {
      expect(arithmeticMean([])).toBe(0);
    });
  });

  describe('standardDeviation', () => {
    it('should calculate std dev correctly', () => {
      // [1, 2, 3, 4, 5] has std dev = sqrt(2) ≈ 1.414
      expect(standardDeviation([1, 2, 3, 4, 5])).toBeCloseTo(Math.sqrt(2));
    });

    it('should return 0 for identical values', () => {
      expect(standardDeviation([5, 5, 5])).toBe(0);
    });

    it('should return 0 for empty array', () => {
      expect(standardDeviation([])).toBe(0);
    });
  });
});

// ==================== Weight Update Formula Tests ====================

describe('Weight Update Formula', () => {
  describe('calculateReward', () => {
    it('should calculate reward correctly', () => {
      // reward = quality × lScore × trajectorySuccessRate
      expect(calculateReward(0.8, 0.9, 0.7)).toBeCloseTo(0.504);
      expect(calculateReward(1, 1, 1)).toBeCloseTo(1);
      expect(calculateReward(0, 0.5, 0.5)).toBe(0);
    });
  });

  describe('calculateGradient', () => {
    it('should calculate gradient correctly', () => {
      // gradient = (reward - 0.5) × similarity
      expect(calculateGradient(0.8, 0.9)).toBeCloseTo(0.27);
      expect(calculateGradient(0.5, 1)).toBe(0); // neutral reward
      expect(calculateGradient(0.2, 1)).toBeCloseTo(-0.3); // negative gradient
    });
  });

  describe('calculateWeightUpdate', () => {
    it('should calculate weight update correctly', () => {
      // weightChange = α × gradient / (1 + λ × importance)
      const update = calculateWeightUpdate(0.5, 0.01, 0.1, 1.0);
      // = 0.01 × 0.5 / (1 + 0.1 × 1.0) = 0.005 / 1.1 ≈ 0.00454
      expect(update).toBeCloseTo(0.00454, 4);
    });

    it('should reduce update with high importance', () => {
      const lowImportance = calculateWeightUpdate(0.5, 0.01, 0.1, 0);
      const highImportance = calculateWeightUpdate(0.5, 0.01, 0.1, 10);
      expect(lowImportance).toBeGreaterThan(highImportance);
    });
  });
});

// ==================== SonaEngine Tests ====================

describe('SonaEngine', () => {
  let engine: SonaEngine;

  beforeEach(() => {
    engine = new SonaEngine();
  });

  describe('initialization', () => {
    it('should initialize with default config', () => {
      expect(engine).toBeDefined();
    });

    it('should accept custom config', () => {
      const customEngine = new SonaEngine({
        learningRate: 0.05,
        trackPerformance: true,
      });
      expect(customEngine).toBeDefined();
    });

    it('should be idempotent', async () => {
      await engine.initialize();
      await engine.initialize(); // Should not throw
    });
  });

  describe('createTrajectory', () => {
    it('should create trajectory with valid input', () => {
      const id = engine.createTrajectory('reasoning.causal', ['p1', 'p2'], ['c1']);
      expect(isValidTrajectoryID(id)).toBe(true);
    });

    it('should accept empty patterns array', () => {
      const id = engine.createTrajectory('test.route', [], []);
      expect(isValidTrajectoryID(id)).toBe(true);
    });

    it('should reject empty route', () => {
      expect(() => engine.createTrajectory('', ['p1'], [])).toThrow(
        TrajectoryValidationError
      );
    });

    it('should initialize route weights on first trajectory', () => {
      const route = 'new.route';
      expect(engine.hasRoute(route)).toBe(false);

      engine.createTrajectory(route, ['p1'], []);
      expect(engine.hasRoute(route)).toBe(true);
    });

    it('should initialize pattern weights to 0.0', async () => {
      engine.createTrajectory('test.route', ['pattern1'], []);
      const weight = await engine.getWeight('pattern1', 'test.route');
      expect(weight).toBe(DEFAULT_INITIAL_WEIGHT);
    });

    it('should increment trajectory count', () => {
      expect(engine.getTrajectoryCount()).toBe(0);
      engine.createTrajectory('r1', [], []);
      expect(engine.getTrajectoryCount()).toBe(1);
      engine.createTrajectory('r2', [], []);
      expect(engine.getTrajectoryCount()).toBe(2);
    });
  });

  describe('getTrajectory', () => {
    it('should return trajectory by ID', () => {
      const id = engine.createTrajectory('test.route', ['p1'], ['c1']);
      const trajectory = engine.getTrajectory(id);

      expect(trajectory).not.toBeNull();
      expect(trajectory!.id).toBe(id);
      expect(trajectory!.route).toBe('test.route');
      expect(trajectory!.patterns).toEqual(['p1']);
      expect(trajectory!.context).toEqual(['c1']);
    });

    it('should return null for unknown ID', () => {
      expect(engine.getTrajectory('traj-123-abcdefgh')).toBeNull();
    });
  });

  describe('listTrajectories', () => {
    it('should return all trajectories', () => {
      engine.createTrajectory('route1', [], []);
      engine.createTrajectory('route2', [], []);
      engine.createTrajectory('route1', [], []);

      const all = engine.listTrajectories();
      expect(all.length).toBe(3);
    });

    it('should filter by route', () => {
      engine.createTrajectory('route1', [], []);
      engine.createTrajectory('route2', [], []);
      engine.createTrajectory('route1', [], []);

      const route1Only = engine.listTrajectories('route1');
      expect(route1Only.length).toBe(2);
      expect(route1Only.every(t => t.route === 'route1')).toBe(true);
    });

    it('should return empty array for unknown route', () => {
      expect(engine.listTrajectories('unknown')).toEqual([]);
    });
  });

  describe('getWeight', () => {
    it('should return weight for known pattern', async () => {
      engine.createTrajectory('route', ['p1'], []);
      engine.setWeight('p1', 'route', 0.5);

      const weight = await engine.getWeight('p1', 'route');
      expect(weight).toBe(0.5);
    });

    it('should return 0.0 for unknown route', async () => {
      const weight = await engine.getWeight('p1', 'unknown');
      expect(weight).toBe(DEFAULT_INITIAL_WEIGHT);
    });

    it('should return 0.0 for unknown pattern', async () => {
      engine.createTrajectory('route', ['p1'], []);
      const weight = await engine.getWeight('unknown', 'route');
      expect(weight).toBe(DEFAULT_INITIAL_WEIGHT);
    });
  });

  describe('getWeights', () => {
    it('should return Float32Array of weights', async () => {
      engine.createTrajectory('route', ['p1', 'p2', 'p3'], []);
      engine.setWeight('p1', 'route', 0.1);
      engine.setWeight('p2', 'route', 0.2);
      engine.setWeight('p3', 'route', 0.3);

      const weights = await engine.getWeights('route');
      expect(weights).toBeInstanceOf(Float32Array);
      expect(weights.length).toBe(3);
    });

    it('should return empty Float32Array for unknown route', async () => {
      const weights = await engine.getWeights('unknown');
      expect(weights).toBeInstanceOf(Float32Array);
      expect(weights.length).toBe(0);
    });
  });

  describe('getWeightsWithIds', () => {
    it('should return weights with pattern IDs', async () => {
      engine.createTrajectory('route', ['p1', 'p2'], []);
      engine.setWeight('p1', 'route', 0.5);
      engine.setWeight('p2', 'route', 0.8);

      const weightsWithIds = await engine.getWeightsWithIds('route');
      expect(weightsWithIds.length).toBe(2);
      expect(weightsWithIds.find(w => w.patternId === 'p1')?.weight).toBe(0.5);
      expect(weightsWithIds.find(w => w.patternId === 'p2')?.weight).toBe(0.8);
    });

    it('should return empty array for unknown route', async () => {
      const weightsWithIds = await engine.getWeightsWithIds('unknown');
      expect(weightsWithIds).toEqual([]);
    });
  });

  describe('setWeight', () => {
    it('should set weight for pattern', async () => {
      engine.setWeight('p1', 'route', 0.7);
      const weight = await engine.getWeight('p1', 'route');
      expect(weight).toBe(0.7);
    });

    it('should clamp weight to valid range', async () => {
      engine.setWeight('p1', 'route', 2.0);
      const weight = await engine.getWeight('p1', 'route');
      expect(weight).toBe(WEIGHT_MAX);

      engine.setWeight('p2', 'route', -2.0);
      const weight2 = await engine.getWeight('p2', 'route');
      expect(weight2).toBe(WEIGHT_MIN);
    });

    it('should create route if not exists', async () => {
      expect(engine.hasRoute('new.route')).toBe(false);
      engine.setWeight('p1', 'new.route', 0.5);
      expect(engine.hasRoute('new.route')).toBe(true);
    });
  });

  describe('getRoutes', () => {
    it('should return all routes', () => {
      engine.createTrajectory('route1', [], []);
      engine.createTrajectory('route2', [], []);
      engine.createTrajectory('route1', [], []); // Duplicate

      const routes = engine.getRoutes();
      expect(routes.length).toBe(2);
      expect(routes).toContain('route1');
      expect(routes).toContain('route2');
    });

    it('should return empty array when no routes', () => {
      expect(engine.getRoutes()).toEqual([]);
    });
  });

  describe('getPatternCount', () => {
    it('should return pattern count for route', () => {
      engine.createTrajectory('route', ['p1', 'p2', 'p3'], []);
      expect(engine.getPatternCount('route')).toBe(3);
    });

    it('should return 0 for unknown route', () => {
      expect(engine.getPatternCount('unknown')).toBe(0);
    });

    it('should count unique patterns', () => {
      engine.createTrajectory('route', ['p1', 'p2'], []);
      engine.createTrajectory('route', ['p2', 'p3'], []); // p2 already exists

      expect(engine.getPatternCount('route')).toBe(3);
    });
  });

  describe('hasRoute', () => {
    it('should return true for existing route', () => {
      engine.createTrajectory('test.route', [], []);
      expect(engine.hasRoute('test.route')).toBe(true);
    });

    it('should return false for non-existing route', () => {
      expect(engine.hasRoute('unknown')).toBe(false);
    });
  });

  describe('getMetrics', () => {
    it('should return learning metrics', () => {
      engine.createTrajectory('route1', ['p1'], []);
      engine.createTrajectory('route2', ['p2'], []);

      const metrics = engine.getMetrics();
      expect(metrics.totalTrajectories).toBe(2);
      expect(metrics.trajectoriesByRoute['route1']).toBe(1);
      expect(metrics.trajectoriesByRoute['route2']).toBe(1);
    });

    it('should track metrics timestamp', () => {
      const before = Date.now();
      engine.createTrajectory('route', [], []);
      const after = Date.now();

      const metrics = engine.getMetrics();
      expect(metrics.lastUpdated).toBeGreaterThanOrEqual(before);
      expect(metrics.lastUpdated).toBeLessThanOrEqual(after);
    });
  });

  describe('calculateDrift', () => {
    it('should calculate drift from baseline', () => {
      engine.createTrajectory('route', ['p1', 'p2'], []);
      engine.setWeight('p1', 'route', 0.5);
      engine.setWeight('p2', 'route', 0.5);

      const baseline = new Float32Array([0.5, 0.5]);
      const driftMetrics = engine.calculateDrift(baseline);

      expect(driftMetrics.drift).toBeCloseTo(0);
      expect(driftMetrics.status).toBe('NORMAL');
    });

    it('should detect drift alert', () => {
      engine.createTrajectory('route', ['p1', 'p2'], []);
      engine.setWeight('p1', 'route', 1.0);
      engine.setWeight('p2', 'route', 0);

      // Baseline orthogonal to current
      const baseline = new Float32Array([0, 1.0]);
      const driftMetrics = engine.calculateDrift(baseline);

      expect(driftMetrics.drift).toBeGreaterThan(0);
    });

    it('should handle size mismatch', () => {
      engine.createTrajectory('route', ['p1', 'p2', 'p3'], []);

      // Baseline with different size
      const baseline = new Float32Array([0.5, 0.5]);
      const driftMetrics = engine.calculateDrift(baseline);

      // Should handle gracefully
      expect(driftMetrics).toBeDefined();
      expect(driftMetrics.status).toBeDefined();
    });
  });

  describe('getStats', () => {
    it('should return engine statistics', () => {
      engine.createTrajectory('route1', ['p1', 'p2'], []);
      engine.createTrajectory('route2', ['p3', 'p4', 'p5'], []);

      const stats = engine.getStats();
      expect(stats.trajectoryCount).toBe(2);
      expect(stats.routeCount).toBe(2);
      expect(stats.totalPatterns).toBe(5);
      expect(stats.avgPatternsPerRoute).toBeCloseTo(2.5);
    });

    it('should handle empty engine', () => {
      const stats = engine.getStats();
      expect(stats.trajectoryCount).toBe(0);
      expect(stats.routeCount).toBe(0);
      expect(stats.totalPatterns).toBe(0);
      expect(stats.avgPatternsPerRoute).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear all data', () => {
      engine.createTrajectory('route1', ['p1'], []);
      engine.createTrajectory('route2', ['p2'], []);

      engine.clear();

      expect(engine.getTrajectoryCount()).toBe(0);
      expect(engine.getRoutes()).toEqual([]);
    });

    it('should reset metrics', () => {
      engine.createTrajectory('route', [], []);
      engine.clear();

      const metrics = engine.getMetrics();
      expect(metrics.totalTrajectories).toBe(0);
    });
  });

  describe('serialization', () => {
    it('should export to JSON', () => {
      engine.createTrajectory('route1', ['p1', 'p2'], ['c1']);
      engine.setWeight('p1', 'route1', 0.5);

      const json = engine.toJSON();

      expect(json.version).toBe('1.0.0');
      expect(json.trajectories.length).toBe(1);
      expect(json.weights.length).toBe(1);
      expect(json.timestamp).toBeDefined();
    });

    it('should import from JSON', async () => {
      engine.createTrajectory('route1', ['p1'], []);
      engine.setWeight('p1', 'route1', 0.8);

      const json = engine.toJSON();
      const newEngine = new SonaEngine();
      newEngine.fromJSON(json);

      expect(newEngine.getTrajectoryCount()).toBe(1);
      expect(await newEngine.getWeight('p1', 'route1')).toBe(0.8);
    });

    it('should preserve trajectory data through serialization', () => {
      const id = engine.createTrajectory('route', ['p1', 'p2'], ['c1', 'c2']);
      const original = engine.getTrajectory(id);

      const json = engine.toJSON();
      const newEngine = new SonaEngine();
      newEngine.fromJSON(json);

      const restored = newEngine.getTrajectory(id);
      expect(restored).not.toBeNull();
      expect(restored!.route).toBe(original!.route);
      expect(restored!.patterns).toEqual(original!.patterns);
      expect(restored!.context).toEqual(original!.context);
    });
  });
});

// ==================== RLM Context Tests ====================

describe('provideFeedback with rlmContext', () => {
  let engine: SonaEngine;

  beforeEach(() => {
    engine = new SonaEngine();
  });

  it('should accept rlmContext in options', async () => {
    // Create a trajectory first
    const trajectoryId = engine.createTrajectory('test.route', ['pattern1'], ['context1']);

    // Provide feedback with RLM context - should not throw
    const result = await engine.provideFeedback(trajectoryId, 0.8, {
      rlmContext: {
        injectionSuccess: true,
        sourceAgentKey: 'test-agent',
        sourceStepIndex: 0,
        sourceDomain: 'project/test',
      },
    });

    expect(result).toBeDefined();
    expect(result.trajectoryId).toBe(trajectoryId);
  });

  it('should handle undefined rlmContext gracefully', async () => {
    // Create a trajectory first
    const trajectoryId = engine.createTrajectory('test.route', ['pattern1'], ['context1']);

    // Provide feedback without RLM context - should not throw
    const result = await engine.provideFeedback(trajectoryId, 0.8, {});

    expect(result).toBeDefined();
    expect(result.trajectoryId).toBe(trajectoryId);
  });

  it('should handle partial rlmContext (only injectionSuccess)', async () => {
    const trajectoryId = engine.createTrajectory('test.route', ['pattern1'], ['context1']);

    // Provide feedback with only injectionSuccess
    const result = await engine.provideFeedback(trajectoryId, 0.7, {
      rlmContext: {
        injectionSuccess: false,
        // No sourceAgentKey, sourceStepIndex, or sourceDomain
      },
    });

    expect(result).toBeDefined();
    expect(result.trajectoryId).toBe(trajectoryId);
  });

  it('should accept rlmContext with all fields populated', async () => {
    const trajectoryId = engine.createTrajectory('test.route', ['pattern1', 'pattern2'], []);

    const rlmContext = {
      injectionSuccess: true,
      sourceAgentKey: 'backend-dev',
      sourceStepIndex: 2,
      sourceDomain: 'project/api/endpoints',
    };

    const result = await engine.provideFeedback(trajectoryId, 0.95, {
      rlmContext,
      lScore: 0.9,
    });

    expect(result).toBeDefined();
    expect(result.trajectoryId).toBe(trajectoryId);
  });

  it('should accept rlmContext with injectionSuccess=false when retrieval failed', async () => {
    const trajectoryId = engine.createTrajectory('failure.test', [], []);

    const result = await engine.provideFeedback(trajectoryId, 0.6, {
      rlmContext: {
        injectionSuccess: false,
        // These fields are undefined when injection fails
        sourceAgentKey: undefined,
        sourceStepIndex: undefined,
        sourceDomain: undefined,
      },
    });

    expect(result).toBeDefined();
    expect(result.trajectoryId).toBe(trajectoryId);
  });

  it('should work with empty patterns trajectory and rlmContext', async () => {
    // Empty patterns trajectory (first agent in pipeline scenario)
    const trajectoryId = engine.createTrajectory('first.agent', [], []);

    const result = await engine.provideFeedback(trajectoryId, 0.85, {
      rlmContext: {
        injectionSuccess: false, // First agent has no previous output
      },
    });

    expect(result).toBeDefined();
    expect(result.patternsUpdated).toBe(0);
  });

  it('should combine rlmContext with other options', async () => {
    const trajectoryId = engine.createTrajectory('combined.test', ['p1'], []);
    engine.setWeight('p1', 'combined.test', 0.5);

    const similarities = new Map<string, number>();
    similarities.set('p1', 0.95);

    const result = await engine.provideFeedback(trajectoryId, 0.9, {
      lScore: 0.85,
      similarities,
      skipAutoSave: true,
      rlmContext: {
        injectionSuccess: true,
        sourceAgentKey: 'analyzer',
        sourceStepIndex: 1,
        sourceDomain: 'project/analysis',
      },
    });

    expect(result).toBeDefined();
    expect(result.trajectoryId).toBe(trajectoryId);
  });
});

// ==================== Constants Tests ====================

describe('Constants', () => {
  it('should have correct default values', () => {
    expect(DEFAULT_LEARNING_RATE).toBe(0.01);
    expect(DEFAULT_REGULARIZATION).toBe(0.1);
    expect(DEFAULT_DRIFT_ALERT_THRESHOLD).toBe(0.3);
    expect(DEFAULT_DRIFT_REJECT_THRESHOLD).toBe(0.5);
    expect(DEFAULT_INITIAL_WEIGHT).toBe(0.0);
    expect(WEIGHT_MIN).toBe(-1.0);
    expect(WEIGHT_MAX).toBe(1.0);
  });
});

// ==================== Performance Tests ====================

describe('Performance', () => {
  it('createTrajectory should complete in <1ms', () => {
    const engine = new SonaEngine({ trackPerformance: true });
    const iterations = 100;
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      engine.createTrajectory(`route.${i}`, ['p1', 'p2', 'p3'], ['c1']);
      times.push(performance.now() - start);
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    expect(avgTime).toBeLessThan(1); // <1ms average
  });

  it('getWeight should complete in <1ms', async () => {
    const engine = new SonaEngine({ trackPerformance: true });
    engine.createTrajectory('route', ['p1', 'p2', 'p3'], []);

    const iterations = 100;
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await engine.getWeight('p1', 'route');
      times.push(performance.now() - start);
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    expect(avgTime).toBeLessThan(1); // <1ms average
  });

  it('getWeights should complete in <5ms', async () => {
    const engine = new SonaEngine({ trackPerformance: true });

    // Create route with 100 patterns
    const patterns = Array.from({ length: 100 }, (_, i) => `pattern-${i}`);
    engine.createTrajectory('route', patterns, []);

    const iterations = 50;
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await engine.getWeights('route');
      times.push(performance.now() - start);
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    expect(avgTime).toBeLessThan(5); // <5ms average
  });
});
