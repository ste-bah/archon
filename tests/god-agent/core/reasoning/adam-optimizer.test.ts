/**
 * Adam Optimizer Tests
 *
 * Tests for TASK-GNN-006: Adam Optimizer Implementation
 *
 * Verifies:
 * - AC-001: Adam optimizer correctly implements algorithm
 * - AC-002: Momentum and velocity tracked per weight
 * - AC-003: State can be saved/restored
 * - AC-004: Numerical stability (epsilon handling)
 * - AC-005: Weight decay option functional
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AdamOptimizer,
  createAdamOptimizer,
  flattenWeights,
  unflattenWeights,
  applyAdamTo2DWeights,
} from '../../../../src/god-agent/core/reasoning/adam-optimizer.js';
import type { AdamConfig, AdamState } from '../../../../src/god-agent/core/reasoning/adam-optimizer.js';

describe('AdamOptimizer', () => {
  let optimizer: AdamOptimizer;

  beforeEach(() => {
    optimizer = new AdamOptimizer();
  });

  // ===========================================================================
  // AC-001: Adam optimizer correctly implements algorithm
  // ===========================================================================

  describe('AC-001: Adam Algorithm Implementation', () => {
    it('should perform basic weight update', () => {
      const weights = new Map<string, Float32Array>();
      weights.set('layer1', new Float32Array([1.0, 2.0, 3.0]));

      const gradients = new Map<string, Float32Array>();
      gradients.set('layer1', new Float32Array([0.1, 0.2, 0.3]));

      const updated = optimizer.step(weights, gradients);

      expect(updated.has('layer1')).toBe(true);
      const newWeights = updated.get('layer1')!;

      // Weights should decrease when gradients are positive
      expect(newWeights[0]).toBeLessThan(1.0);
      expect(newWeights[1]).toBeLessThan(2.0);
      expect(newWeights[2]).toBeLessThan(3.0);
    });

    it('should apply bias correction for early timesteps', () => {
      // At t=1, bias correction should significantly boost effective learning rate
      const weights = new Map<string, Float32Array>();
      weights.set('layer1', new Float32Array([1.0]));

      const gradients = new Map<string, Float32Array>();
      gradients.set('layer1', new Float32Array([0.1]));

      // First step (t=1)
      const updated1 = optimizer.step(weights, gradients);

      // The update should account for bias correction:
      // m_1 = 0.1 * 0.1 = 0.01 (first moment)
      // m_hat_1 = 0.01 / (1 - 0.9) = 0.1 (bias corrected)
      // v_1 = 0.001 * 0.01 = 0.00001
      // v_hat_1 = 0.00001 / (1 - 0.999) = 0.01
      // update = 0.001 * 0.1 / (sqrt(0.01) + 1e-8) = 0.001

      expect(updated1.get('layer1')![0]).toBeLessThan(1.0);
      expect(optimizer.getTimestep()).toBe(1);
    });

    it('should correctly implement momentum (beta1)', () => {
      const config: Partial<AdamConfig> = {
        learningRate: 0.01,
        beta1: 0.9,
        beta2: 0.999,
      };
      const momentumOptimizer = new AdamOptimizer(config);

      const weights = new Map<string, Float32Array>();
      weights.set('w', new Float32Array([0.0]));

      const gradients = new Map<string, Float32Array>();
      gradients.set('w', new Float32Array([1.0]));

      // First step - gradient is 1.0
      let result = momentumOptimizer.step(weights, gradients);

      // Second step - gradient is still 1.0
      result = momentumOptimizer.step(result, gradients);

      // Third step
      result = momentumOptimizer.step(result, gradients);

      // With consistent gradient, momentum should build up
      // and updates should be relatively large
      expect(result.get('w')![0]).toBeLessThan(-0.02);
    });

    it('should correctly implement adaptive learning rate (beta2)', () => {
      const config: Partial<AdamConfig> = {
        learningRate: 0.1,
        beta1: 0.9,
        beta2: 0.999,
      };
      const adaptiveOptimizer = new AdamOptimizer(config);

      const weights = new Map<string, Float32Array>();
      weights.set('w', new Float32Array([0.0]));

      // Alternate between large and small gradients
      const largeGrad = new Map<string, Float32Array>();
      largeGrad.set('w', new Float32Array([10.0]));

      const smallGrad = new Map<string, Float32Array>();
      smallGrad.set('w', new Float32Array([0.1]));

      // Apply several large gradients
      let result = weights;
      for (let i = 0; i < 5; i++) {
        result = adaptiveOptimizer.step(result, largeGrad);
      }

      // Second moment should have grown, limiting updates
      const stats = adaptiveOptimizer.getMomentStats('w');
      expect(stats).not.toBeNull();
      expect(stats!.vMax).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // AC-002: Momentum and velocity tracked per weight
  // ===========================================================================

  describe('AC-002: Per-Weight Momentum/Velocity Tracking', () => {
    it('should track separate moments for each weight key', () => {
      const weights = new Map<string, Float32Array>();
      weights.set('layer1', new Float32Array([1.0, 2.0]));
      weights.set('layer2', new Float32Array([3.0, 4.0, 5.0]));

      const gradients = new Map<string, Float32Array>();
      gradients.set('layer1', new Float32Array([0.1, 0.2]));
      gradients.set('layer2', new Float32Array([0.3, 0.4, 0.5]));

      optimizer.step(weights, gradients);

      expect(optimizer.isTracking('layer1')).toBe(true);
      expect(optimizer.isTracking('layer2')).toBe(true);
      expect(optimizer.getNumTrackedWeights()).toBe(2);
    });

    it('should maintain per-weight moment statistics', () => {
      const weights = new Map<string, Float32Array>();
      weights.set('w1', new Float32Array([0.0]));
      weights.set('w2', new Float32Array([0.0]));

      // Different gradients for each weight
      const gradients = new Map<string, Float32Array>();
      gradients.set('w1', new Float32Array([1.0]));
      gradients.set('w2', new Float32Array([0.01]));

      // Run several steps
      let result = weights;
      for (let i = 0; i < 10; i++) {
        result = optimizer.step(result, gradients);
      }

      const stats1 = optimizer.getMomentStats('w1');
      const stats2 = optimizer.getMomentStats('w2');

      expect(stats1).not.toBeNull();
      expect(stats2).not.toBeNull();

      // w1 should have larger moment estimates due to larger gradients
      expect(Math.abs(stats1!.mMean)).toBeGreaterThan(Math.abs(stats2!.mMean));
      expect(stats1!.vMean).toBeGreaterThan(stats2!.vMean);
    });

    it('should allow clearing moments for individual weights', () => {
      const weights = new Map<string, Float32Array>();
      weights.set('layer1', new Float32Array([1.0]));
      weights.set('layer2', new Float32Array([2.0]));

      const gradients = new Map<string, Float32Array>();
      gradients.set('layer1', new Float32Array([0.1]));
      gradients.set('layer2', new Float32Array([0.2]));

      optimizer.step(weights, gradients);

      expect(optimizer.isTracking('layer1')).toBe(true);
      expect(optimizer.isTracking('layer2')).toBe(true);

      optimizer.clearMoments('layer1');

      expect(optimizer.isTracking('layer1')).toBe(false);
      expect(optimizer.isTracking('layer2')).toBe(true);
    });
  });

  // ===========================================================================
  // AC-003: State can be saved/restored
  // ===========================================================================

  describe('AC-003: State Save/Restore', () => {
    it('should save complete optimizer state', () => {
      const weights = new Map<string, Float32Array>();
      weights.set('layer1', new Float32Array([1.0, 2.0]));

      const gradients = new Map<string, Float32Array>();
      gradients.set('layer1', new Float32Array([0.1, 0.2]));

      // Run some steps
      optimizer.step(weights, gradients);
      optimizer.step(optimizer.step(weights, gradients), gradients);

      const state = optimizer.getState();

      expect(state.t).toBe(3);
      expect(state.version).toBeDefined();
      expect(state.config).toBeDefined();
      expect(state.m).toHaveProperty('layer1');
      expect(state.v).toHaveProperty('layer1');
    });

    it('should restore state correctly', () => {
      const weights = new Map<string, Float32Array>();
      weights.set('layer1', new Float32Array([1.0, 2.0]));

      const gradients = new Map<string, Float32Array>();
      gradients.set('layer1', new Float32Array([0.1, 0.2]));

      // Run some steps
      for (let i = 0; i < 5; i++) {
        optimizer.step(weights, gradients);
      }

      const savedState = optimizer.getState();

      // Create new optimizer and restore state
      const newOptimizer = new AdamOptimizer();
      newOptimizer.setState(savedState);

      expect(newOptimizer.getTimestep()).toBe(optimizer.getTimestep());
      expect(newOptimizer.getConfig()).toEqual(optimizer.getConfig());
      expect(newOptimizer.isTracking('layer1')).toBe(true);
    });

    it('should produce identical results after restore', () => {
      const weights = new Map<string, Float32Array>();
      weights.set('layer1', new Float32Array([1.0, 2.0, 3.0]));

      const gradients = new Map<string, Float32Array>();
      gradients.set('layer1', new Float32Array([0.1, 0.2, 0.3]));

      // Run 5 steps and save state
      let result = weights;
      for (let i = 0; i < 5; i++) {
        result = optimizer.step(result, gradients);
      }
      const savedState = optimizer.getState();

      // Run one more step with original optimizer
      const result1 = optimizer.step(result, gradients);

      // Restore to new optimizer and run same step
      const newOptimizer = new AdamOptimizer();
      newOptimizer.setState(savedState);
      const result2 = newOptimizer.step(result, gradients);

      // Results should be identical
      const w1 = result1.get('layer1')!;
      const w2 = result2.get('layer1')!;
      for (let i = 0; i < w1.length; i++) {
        expect(w1[i]).toBeCloseTo(w2[i], 10);
      }
    });

    it('should serialize state to JSON', () => {
      const weights = new Map<string, Float32Array>();
      weights.set('layer1', new Float32Array([1.0]));

      const gradients = new Map<string, Float32Array>();
      gradients.set('layer1', new Float32Array([0.1]));

      optimizer.step(weights, gradients);
      const state = optimizer.getState();

      // Should be serializable to JSON
      const json = JSON.stringify(state);
      const parsed = JSON.parse(json) as AdamState;

      expect(parsed.t).toBe(state.t);
      expect(parsed.m.layer1).toEqual(state.m.layer1);
    });
  });

  // ===========================================================================
  // AC-004: Numerical stability (epsilon handling)
  // ===========================================================================

  describe('AC-004: Numerical Stability', () => {
    it('should handle zero gradients without division by zero', () => {
      const weights = new Map<string, Float32Array>();
      weights.set('layer1', new Float32Array([1.0, 2.0, 3.0]));

      const gradients = new Map<string, Float32Array>();
      gradients.set('layer1', new Float32Array([0.0, 0.0, 0.0]));

      // Should not throw
      expect(() => optimizer.step(weights, gradients)).not.toThrow();

      const updated = optimizer.step(weights, gradients);

      // Weights should be unchanged or very slightly modified
      const w = updated.get('layer1')!;
      expect(w[0]).toBeCloseTo(1.0, 5);
      expect(w[1]).toBeCloseTo(2.0, 5);
      expect(w[2]).toBeCloseTo(3.0, 5);
    });

    it('should handle very small gradients', () => {
      const weights = new Map<string, Float32Array>();
      weights.set('layer1', new Float32Array([1.0]));

      const gradients = new Map<string, Float32Array>();
      gradients.set('layer1', new Float32Array([1e-20]));

      // Should not throw
      expect(() => optimizer.step(weights, gradients)).not.toThrow();

      const updated = optimizer.step(weights, gradients);
      const w = updated.get('layer1')!;

      expect(Number.isFinite(w[0])).toBe(true);
    });

    it('should handle very large gradients', () => {
      const weights = new Map<string, Float32Array>();
      weights.set('layer1', new Float32Array([1.0]));

      const gradients = new Map<string, Float32Array>();
      gradients.set('layer1', new Float32Array([1e10]));

      // Should not throw
      expect(() => optimizer.step(weights, gradients)).not.toThrow();

      const updated = optimizer.step(weights, gradients);
      const w = updated.get('layer1')!;

      expect(Number.isFinite(w[0])).toBe(true);
    });

    it('should handle NaN gradients gracefully', () => {
      const weights = new Map<string, Float32Array>();
      weights.set('layer1', new Float32Array([1.0, 2.0]));

      const gradients = new Map<string, Float32Array>();
      gradients.set('layer1', new Float32Array([NaN, 0.1]));

      // Should not throw
      expect(() => optimizer.step(weights, gradients)).not.toThrow();

      const updated = optimizer.step(weights, gradients);
      const w = updated.get('layer1')!;

      // NaN gradient should be skipped, weight unchanged
      expect(w[0]).toBe(1.0);
      // Normal gradient should be applied
      expect(w[1]).not.toBe(2.0);
      expect(Number.isFinite(w[1])).toBe(true);
    });

    it('should handle Infinity gradients gracefully', () => {
      const weights = new Map<string, Float32Array>();
      weights.set('layer1', new Float32Array([1.0, 2.0]));

      const gradients = new Map<string, Float32Array>();
      gradients.set('layer1', new Float32Array([Infinity, 0.1]));

      // Should not throw
      expect(() => optimizer.step(weights, gradients)).not.toThrow();

      const updated = optimizer.step(weights, gradients);
      const w = updated.get('layer1')!;

      // Infinite gradient should be skipped
      expect(w[0]).toBe(1.0);
      expect(Number.isFinite(w[1])).toBe(true);
    });

    it('should maintain stability over many steps', () => {
      const weights = new Map<string, Float32Array>();
      weights.set('layer1', new Float32Array([1.0]));

      const gradients = new Map<string, Float32Array>();
      gradients.set('layer1', new Float32Array([0.1]));

      let result = weights;
      for (let i = 0; i < 1000; i++) {
        result = optimizer.step(result, gradients);
      }

      const w = result.get('layer1')!;
      expect(Number.isFinite(w[0])).toBe(true);
      expect(Number.isNaN(w[0])).toBe(false);
    });
  });

  // ===========================================================================
  // AC-005: Weight decay option functional
  // ===========================================================================

  describe('AC-005: Weight Decay', () => {
    it('should apply weight decay when configured', () => {
      const decayOptimizer = new AdamOptimizer({
        learningRate: 0.001,
        weightDecay: 0.1,
      });

      const weights = new Map<string, Float32Array>();
      weights.set('layer1', new Float32Array([10.0]));

      // Zero gradient - only weight decay should affect weights
      const gradients = new Map<string, Float32Array>();
      gradients.set('layer1', new Float32Array([0.0]));

      const updated = decayOptimizer.step(weights, gradients);
      const w = updated.get('layer1')!;

      // Weight decay should shrink the weight toward zero
      // decay = lr * wd * w = 0.001 * 0.1 * 10 = 0.001
      expect(w[0]).toBeLessThan(10.0);
      expect(w[0]).toBeCloseTo(10.0 - 0.001, 5);
    });

    it('should not apply decay when weightDecay is 0', () => {
      const noDecayOptimizer = new AdamOptimizer({
        learningRate: 0.001,
        weightDecay: 0,
      });

      const weights = new Map<string, Float32Array>();
      weights.set('layer1', new Float32Array([10.0]));

      const gradients = new Map<string, Float32Array>();
      gradients.set('layer1', new Float32Array([0.0]));

      const updated = noDecayOptimizer.step(weights, gradients);
      const w = updated.get('layer1')!;

      // Weight should be essentially unchanged (only numerical noise)
      expect(w[0]).toBeCloseTo(10.0, 5);
    });

    it('should combine gradient updates with weight decay', () => {
      const decayOptimizer = new AdamOptimizer({
        learningRate: 0.01,
        weightDecay: 0.01,
      });

      const weights = new Map<string, Float32Array>();
      weights.set('layer1', new Float32Array([5.0]));

      const gradients = new Map<string, Float32Array>();
      gradients.set('layer1', new Float32Array([1.0]));

      const updated = decayOptimizer.step(weights, gradients);
      const w = updated.get('layer1')!;

      // Should have both gradient update and weight decay
      // Weight should decrease due to positive gradient AND decay
      expect(w[0]).toBeLessThan(5.0);
    });
  });

  // ===========================================================================
  // Additional Tests
  // ===========================================================================

  describe('Configuration', () => {
    it('should use default configuration values', () => {
      const config = optimizer.getConfig();

      expect(config.learningRate).toBe(0.001);
      expect(config.beta1).toBe(0.9);
      expect(config.beta2).toBe(0.999);
      expect(config.epsilon).toBe(1e-8);
      expect(config.weightDecay).toBe(0);
    });

    it('should allow custom configuration', () => {
      const customOptimizer = new AdamOptimizer({
        learningRate: 0.01,
        beta1: 0.8,
        beta2: 0.99,
        epsilon: 1e-7,
        weightDecay: 0.001,
      });

      const config = customOptimizer.getConfig();

      expect(config.learningRate).toBe(0.01);
      expect(config.beta1).toBe(0.8);
      expect(config.beta2).toBe(0.99);
      expect(config.epsilon).toBe(1e-7);
      expect(config.weightDecay).toBe(0.001);
    });

    it('should reject invalid configuration', () => {
      expect(() => new AdamOptimizer({ learningRate: -0.001 })).toThrow();
      expect(() => new AdamOptimizer({ beta1: 1.0 })).toThrow();
      expect(() => new AdamOptimizer({ beta2: 1.5 })).toThrow();
      expect(() => new AdamOptimizer({ epsilon: 0 })).toThrow();
      expect(() => new AdamOptimizer({ weightDecay: -0.1 })).toThrow();
    });

    it('should allow updating learning rate', () => {
      optimizer.setLearningRate(0.01);
      expect(optimizer.getLearningRate()).toBe(0.01);

      optimizer.setLearningRate(0.0001);
      expect(optimizer.getLearningRate()).toBe(0.0001);
    });
  });

  describe('Reset', () => {
    it('should reset all state', () => {
      const weights = new Map<string, Float32Array>();
      weights.set('layer1', new Float32Array([1.0]));

      const gradients = new Map<string, Float32Array>();
      gradients.set('layer1', new Float32Array([0.1]));

      // Run some steps
      optimizer.step(weights, gradients);
      optimizer.step(weights, gradients);

      expect(optimizer.getTimestep()).toBe(2);
      expect(optimizer.isTracking('layer1')).toBe(true);

      optimizer.reset();

      expect(optimizer.getTimestep()).toBe(0);
      expect(optimizer.isTracking('layer1')).toBe(false);
      expect(optimizer.getNumTrackedWeights()).toBe(0);
    });
  });

  describe('stepWithStats', () => {
    it('should return statistics about the update', () => {
      const weights = new Map<string, Float32Array>();
      weights.set('layer1', new Float32Array([1.0, 2.0]));

      const gradients = new Map<string, Float32Array>();
      gradients.set('layer1', new Float32Array([0.5, 0.1]));

      const result = optimizer.stepWithStats(weights, gradients);

      expect(result.weights.has('layer1')).toBe(true);
      expect(result.maxGradientMag).toBeCloseTo(0.5, 5);
      expect(result.maxUpdateMag).toBeGreaterThan(0);
      expect(result.weightsUpdated).toBe(1);
    });
  });

  describe('Memory Usage', () => {
    it('should report memory usage', () => {
      const weights = new Map<string, Float32Array>();
      weights.set('layer1', new Float32Array(100));
      weights.set('layer2', new Float32Array(200));

      const gradients = new Map<string, Float32Array>();
      gradients.set('layer1', new Float32Array(100));
      gradients.set('layer2', new Float32Array(200));

      optimizer.step(weights, gradients);

      const memoryUsage = optimizer.getMemoryUsage();

      // m and v arrays: (100 + 200) * 4 bytes * 2 = 2400 bytes
      expect(memoryUsage).toBe(2400);
    });
  });
});

// ===========================================================================
// Utility Function Tests
// ===========================================================================

describe('Adam Optimizer Utilities', () => {
  describe('createAdamOptimizer', () => {
    it('should create optimizer with default config', () => {
      const optimizer = createAdamOptimizer();
      expect(optimizer.getConfig().learningRate).toBe(0.001);
    });

    it('should create optimizer with custom config', () => {
      const optimizer = createAdamOptimizer({ learningRate: 0.01 });
      expect(optimizer.getConfig().learningRate).toBe(0.01);
    });
  });

  describe('flattenWeights', () => {
    it('should flatten 2D weights to 1D', () => {
      const weights: Float32Array[] = [
        new Float32Array([1, 2, 3]),
        new Float32Array([4, 5, 6]),
      ];

      const flat = flattenWeights(weights);

      expect(flat.length).toBe(6);
      expect(Array.from(flat)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('should handle empty input', () => {
      const flat = flattenWeights([]);
      expect(flat.length).toBe(0);
    });
  });

  describe('unflattenWeights', () => {
    it('should unflatten 1D to 2D weights', () => {
      const flat = new Float32Array([1, 2, 3, 4, 5, 6]);
      const weights = unflattenWeights(flat, 2, 3);

      expect(weights.length).toBe(2);
      expect(weights[0].length).toBe(3);
      expect(Array.from(weights[0])).toEqual([1, 2, 3]);
      expect(Array.from(weights[1])).toEqual([4, 5, 6]);
    });

    it('should round-trip correctly', () => {
      const original: Float32Array[] = [
        new Float32Array([1.5, 2.5]),
        new Float32Array([3.5, 4.5]),
        new Float32Array([5.5, 6.5]),
      ];

      const flat = flattenWeights(original);
      const restored = unflattenWeights(flat, 3, 2);

      expect(restored.length).toBe(original.length);
      for (let i = 0; i < original.length; i++) {
        expect(Array.from(restored[i])).toEqual(Array.from(original[i]));
      }
    });
  });

  describe('applyAdamTo2DWeights', () => {
    it('should apply optimizer to 2D weight matrices', () => {
      const optimizer = createAdamOptimizer();

      const weights = new Map<string, Float32Array[]>();
      weights.set('layer1', [
        new Float32Array([1, 2]),
        new Float32Array([3, 4]),
      ]);

      const gradients = new Map<string, Float32Array[]>();
      gradients.set('layer1', [
        new Float32Array([0.1, 0.2]),
        new Float32Array([0.3, 0.4]),
      ]);

      const updated = applyAdamTo2DWeights(optimizer, weights, gradients);

      expect(updated.has('layer1')).toBe(true);
      const updatedLayer = updated.get('layer1')!;
      expect(updatedLayer.length).toBe(2);
      expect(updatedLayer[0].length).toBe(2);

      // Weights should have been updated
      expect(updatedLayer[0][0]).toBeLessThan(1);
      expect(updatedLayer[1][1]).toBeLessThan(4);
    });
  });
});
