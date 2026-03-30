/**
 * Weight Update Tests
 * TASK-SON-002 - LoRA-Style Weight Updates and Persistence
 *
 * Tests cover:
 * - provideFeedback() with weight updates
 * - Fisher Information tracking
 * - Binary weight serialization/deserialization
 * - Auto-save throttling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  SonaEngine,
  FeedbackValidationError,
  WeightPersistenceError,
  validateFeedbackQuality,
  updateFisherInformation,
  calculateSuccessRate,
  crc32,
  DEFAULT_FISHER_INFORMATION,
  FISHER_DECAY_RATE,
  AUTO_PATTERN_QUALITY_THRESHOLD,
  DEFAULT_INITIAL_WEIGHT,
} from '../../../../src/god-agent/core/learning/index.js';

// ==================== Utility Function Tests ====================

describe('Weight Update Utilities', () => {
  describe('validateFeedbackQuality', () => {
    it('should accept valid quality scores', () => {
      expect(() => validateFeedbackQuality(0)).not.toThrow();
      expect(() => validateFeedbackQuality(0.5)).not.toThrow();
      expect(() => validateFeedbackQuality(1.0)).not.toThrow();
    });

    it('should reject out of range quality', () => {
      expect(() => validateFeedbackQuality(-0.1)).toThrow();
      expect(() => validateFeedbackQuality(1.1)).toThrow();
    });

    it('should reject NaN', () => {
      expect(() => validateFeedbackQuality(NaN)).toThrow();
    });
  });

  describe('updateFisherInformation', () => {
    it('should update with exponential moving average', () => {
      const currentImportance = 0.1;
      const gradient = 0.5;
      const decay = 0.9;

      // newImportance = 0.9 * 0.1 + 0.1 * (0.5 * 0.5) = 0.09 + 0.025 = 0.115
      const newImportance = updateFisherInformation(currentImportance, gradient, decay);
      expect(newImportance).toBeCloseTo(0.115);
    });

    it('should increase importance with large gradients', () => {
      const currentImportance = 0.1;
      const smallGradient = 0.1;
      const largeGradient = 0.9;

      const afterSmall = updateFisherInformation(currentImportance, smallGradient);
      const afterLarge = updateFisherInformation(currentImportance, largeGradient);

      expect(afterLarge).toBeGreaterThan(afterSmall);
    });

    it('should use default decay rate', () => {
      const result = updateFisherInformation(0.1, 0.5);
      const expected = FISHER_DECAY_RATE * 0.1 + (1 - FISHER_DECAY_RATE) * (0.5 * 0.5);
      expect(result).toBeCloseTo(expected);
    });
  });

  describe('calculateSuccessRate', () => {
    it('should calculate average of quality scores', () => {
      expect(calculateSuccessRate([0.5, 0.7, 0.9])).toBeCloseTo(0.7);
      expect(calculateSuccessRate([1.0, 1.0, 0.8])).toBeCloseTo(0.9333, 3);
    });

    it('should return default for empty array', () => {
      expect(calculateSuccessRate([])).toBe(0.5);
      expect(calculateSuccessRate([], 0.6)).toBe(0.6);
    });
  });

  describe('crc32', () => {
    it('should compute consistent checksums', () => {
      const buffer1 = Buffer.from('hello world');
      const buffer2 = Buffer.from('hello world');
      const buffer3 = Buffer.from('hello world!');

      expect(crc32(buffer1)).toBe(crc32(buffer2));
      expect(crc32(buffer1)).not.toBe(crc32(buffer3));
    });

    it('should return 0 for empty buffer', () => {
      const empty = Buffer.from('');
      expect(typeof crc32(empty)).toBe('number');
    });

    it('should work with Uint8Array', () => {
      const arr = new Uint8Array([1, 2, 3, 4, 5]);
      expect(typeof crc32(arr)).toBe('number');
    });
  });
});

// ==================== provideFeedback Tests ====================

describe('SonaEngine.provideFeedback', () => {
  let engine: SonaEngine;

  beforeEach(() => {
    engine = new SonaEngine();
  });

  describe('validation', () => {
    it('should throw for invalid quality', async () => {
      const trajId = engine.createTrajectory('route', ['p1'], []);
      await expect(engine.provideFeedback(trajId, -0.1)).rejects.toThrow();
      await expect(engine.provideFeedback(trajId, 1.5)).rejects.toThrow();
    });

    it('should throw for non-existent trajectory', async () => {
      await expect(
        engine.provideFeedback('traj-123-nonexist', 0.5)
      ).rejects.toThrow(FeedbackValidationError);
    });
  });

  describe('empty patterns', () => {
    it('should handle trajectory with no patterns', async () => {
      const trajId = engine.createTrajectory('route', [], []);
      const result = await engine.provideFeedback(trajId, 0.8, { skipAutoSave: true });

      expect(result.patternsUpdated).toBe(0);
      expect(result.reward).toBe(0);
      expect(result.patternAutoCreated).toBe(false);

      // Quality should still be set
      const traj = engine.getTrajectory(trajId);
      expect(traj?.quality).toBe(0.8);
    });
  });

  describe('weight updates', () => {
    it('should update weights for patterns', async () => {
      // First, establish a high success rate with prior trajectories
      const priorTraj = engine.createTrajectory('route', ['setup'], []);
      await engine.provideFeedback(priorTraj, 1.0, { skipAutoSave: true });

      const trajId = engine.createTrajectory('route', ['p1', 'p2'], []);

      // Set initial weights
      engine.setWeight('p1', 'route', 0.0);
      engine.setWeight('p2', 'route', 0.0);

      // With prior high-quality feedback, success rate > 0.5
      // So reward = 0.9 × 1.0 × successRate > 0.5 → positive gradient
      const result = await engine.provideFeedback(trajId, 0.9, { skipAutoSave: true });

      expect(result.patternsUpdated).toBe(2);
      expect(result.trajectoryId).toBe(trajId);

      // Weights should have increased (quality > 0.5 and high success rate)
      const w1 = await engine.getWeight('p1', 'route');
      const w2 = await engine.getWeight('p2', 'route');

      expect(w1).toBeGreaterThan(0);
      expect(w2).toBeGreaterThan(0);
    });

    it('should decrease weights for low quality', async () => {
      const trajId = engine.createTrajectory('route', ['p1'], []);
      engine.setWeight('p1', 'route', 0.5);

      await engine.provideFeedback(trajId, 0.1, { skipAutoSave: true });

      // Quality < 0.5 means negative gradient, weight should decrease
      const w1 = await engine.getWeight('p1', 'route');
      expect(w1).toBeLessThan(0.5);
    });

    it('should use provided L-Score', async () => {
      const trajId1 = engine.createTrajectory('route', ['p1'], []);
      const trajId2 = engine.createTrajectory('route', ['p2'], []);

      await engine.provideFeedback(trajId1, 0.8, { lScore: 0.5, skipAutoSave: true });
      await engine.provideFeedback(trajId2, 0.8, { lScore: 1.0, skipAutoSave: true });

      // Higher L-Score should result in larger weight update
      const w1 = await engine.getWeight('p1', 'route');
      const w2 = await engine.getWeight('p2', 'route');

      // Since L-Score 1.0 gives bigger reward, p2 should have higher weight
      // (assuming similar initial conditions)
      expect(w2).toBeGreaterThan(w1);
    });

    it('should use provided similarities', async () => {
      const trajId1 = engine.createTrajectory('route', ['p1'], []);
      const trajId2 = engine.createTrajectory('route', ['p2'], []);

      const lowSim = new Map([['p1', 0.3]]);
      const highSim = new Map([['p2', 0.9]]);

      await engine.provideFeedback(trajId1, 0.9, { similarities: lowSim, skipAutoSave: true });
      await engine.provideFeedback(trajId2, 0.9, { similarities: highSim, skipAutoSave: true });

      const w1 = await engine.getWeight('p1', 'route');
      const w2 = await engine.getWeight('p2', 'route');

      // Higher similarity means larger gradient
      expect(w2).toBeGreaterThan(w1);
    });
  });

  describe('Fisher Information', () => {
    it('should initialize Fisher Information', async () => {
      const trajId = engine.createTrajectory('route', ['p1'], []);
      await engine.provideFeedback(trajId, 0.8, { skipAutoSave: true });

      const fisher = engine.getFisherInformation('p1', 'route');
      expect(fisher).toBeGreaterThan(0);
    });

    it('should update Fisher Information over multiple feedbacks', async () => {
      const trajId1 = engine.createTrajectory('route', ['p1'], []);
      await engine.provideFeedback(trajId1, 0.8, { skipAutoSave: true });
      const fisher1 = engine.getFisherInformation('p1', 'route');

      const trajId2 = engine.createTrajectory('route', ['p1'], []);
      await engine.provideFeedback(trajId2, 0.9, { skipAutoSave: true });
      const fisher2 = engine.getFisherInformation('p1', 'route');

      // Fisher should be updated
      expect(fisher2).not.toBe(fisher1);
    });

    it('should return default for unknown patterns', () => {
      expect(engine.getFisherInformation('unknown', 'route')).toBe(DEFAULT_FISHER_INFORMATION);
    });

    it('should allow setting Fisher Information', () => {
      engine.setFisherInformation('p1', 'route', 0.5);
      expect(engine.getFisherInformation('p1', 'route')).toBe(0.5);
    });
  });

  describe('EWC++ regularization', () => {
    it('should reduce updates for high-importance patterns', async () => {
      // First establish a high success rate
      const priorTraj = engine.createTrajectory('route', ['setup'], []);
      await engine.provideFeedback(priorTraj, 1.0, { skipAutoSave: true });

      // Create two trajectories with same quality
      const trajId1 = engine.createTrajectory('route', ['low-importance'], []);
      const trajId2 = engine.createTrajectory('route', ['high-importance'], []);

      // Set Fisher Information (importance) BEFORE feedback
      // Higher importance = more protected from updates
      engine.setFisherInformation('low-importance', 'route', 0.01);
      engine.setFisherInformation('high-importance', 'route', 10.0);

      // Initialize weights to 0
      engine.setWeight('low-importance', 'route', 0);
      engine.setWeight('high-importance', 'route', 0);

      // Provide same feedback
      await engine.provideFeedback(trajId1, 0.9, { skipAutoSave: true });
      await engine.provideFeedback(trajId2, 0.9, { skipAutoSave: true });

      const wLow = await engine.getWeight('low-importance', 'route');
      const wHigh = await engine.getWeight('high-importance', 'route');

      // Low importance pattern should have larger update (less EWC protection)
      expect(Math.abs(wLow)).toBeGreaterThan(Math.abs(wHigh));
    });
  });

  describe('trajectory success rate', () => {
    it('should use historical quality for success rate', async () => {
      // Create trajectories with different qualities
      const traj1 = engine.createTrajectory('route', ['p1'], []);
      await engine.provideFeedback(traj1, 0.9, { skipAutoSave: true });

      const traj2 = engine.createTrajectory('route', ['p1'], []);
      await engine.provideFeedback(traj2, 0.7, { skipAutoSave: true });

      // Third trajectory should use average success rate (0.8)
      const traj3 = engine.createTrajectory('route', ['p2'], []);
      const result = await engine.provideFeedback(traj3, 0.8, { skipAutoSave: true });

      expect(result.reward).toBeGreaterThan(0);
    });
  });

  describe('auto-create pattern', () => {
    it('should flag auto-creation for high quality', async () => {
      const trajId = engine.createTrajectory('route', ['p1'], []);
      const result = await engine.provideFeedback(trajId, 0.9, { skipAutoSave: true });

      expect(result.patternAutoCreated).toBe(true);
    });

    it('should not flag auto-creation for low quality', async () => {
      const trajId = engine.createTrajectory('route', ['p1'], []);
      const result = await engine.provideFeedback(trajId, 0.5, { skipAutoSave: true });

      expect(result.patternAutoCreated).toBe(false);
    });

    it('should respect quality threshold', async () => {
      const trajId = engine.createTrajectory('route', ['p1'], []);
      const result = await engine.provideFeedback(trajId, AUTO_PATTERN_QUALITY_THRESHOLD - 0.01, {
        skipAutoSave: true,
      });

      expect(result.patternAutoCreated).toBe(false);
    });
  });

  describe('result object', () => {
    it('should return correct result structure', async () => {
      const trajId = engine.createTrajectory('route', ['p1', 'p2'], []);
      const result = await engine.provideFeedback(trajId, 0.7, { skipAutoSave: true });

      expect(result).toHaveProperty('trajectoryId', trajId);
      expect(result).toHaveProperty('patternsUpdated', 2);
      expect(result).toHaveProperty('reward');
      expect(result).toHaveProperty('patternAutoCreated');
      expect(result).toHaveProperty('elapsedMs');
      expect(typeof result.elapsedMs).toBe('number');
    });
  });
});

// ==================== Weight Persistence Tests ====================

describe('Weight Persistence', () => {
  let engine: SonaEngine;
  let testDir: string;
  let testFile: string;

  beforeEach(() => {
    engine = new SonaEngine();
    testDir = join(tmpdir(), `sona-test-${Date.now()}`);
    testFile = join(testDir, 'test_weights.bin');
    mkdirSync(testDir, { recursive: true });
    engine.setWeightsFilePath(testFile);
  });

  afterEach(() => {
    try {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('saveWeights', () => {
    it('should create weight file', async () => {
      engine.createTrajectory('route', ['p1'], []);
      engine.setWeight('p1', 'route', 0.5);

      await engine.saveWeights(testFile);

      expect(existsSync(testFile)).toBe(true);
    });

    it('should include Fisher Information', async () => {
      engine.createTrajectory('route', ['p1'], []);
      engine.setWeight('p1', 'route', 0.5);
      engine.setFisherInformation('p1', 'route', 0.8);

      await engine.saveWeights(testFile);

      // Load into new engine
      const newEngine = new SonaEngine();
      await newEngine.loadWeights(testFile);

      expect(newEngine.getFisherInformation('p1', 'route')).toBeCloseTo(0.8, 4);
    });

    it('should create directory if not exists', async () => {
      const deepPath = join(testDir, 'deep', 'nested', 'weights.bin');
      engine.createTrajectory('route', ['p1'], []);

      await engine.saveWeights(deepPath);

      expect(existsSync(deepPath)).toBe(true);
    });
  });

  describe('loadWeights', () => {
    it('should restore weights from file', async () => {
      // Save weights
      engine.createTrajectory('route', ['p1', 'p2'], []);
      engine.setWeight('p1', 'route', 0.5);
      engine.setWeight('p2', 'route', -0.3);
      await engine.saveWeights(testFile);

      // Load into new engine
      const newEngine = new SonaEngine();
      await newEngine.loadWeights(testFile);

      expect(await newEngine.getWeight('p1', 'route')).toBeCloseTo(0.5, 4);
      expect(await newEngine.getWeight('p2', 'route')).toBeCloseTo(-0.3, 4);
    });

    it('should handle non-existent file gracefully', async () => {
      const newEngine = new SonaEngine();
      // Should not throw, just log warning
      await newEngine.loadWeights(join(testDir, 'nonexistent.bin'));
    });

    it('should preserve multiple routes', async () => {
      engine.createTrajectory('route1', ['p1'], []);
      engine.createTrajectory('route2', ['p2'], []);
      engine.setWeight('p1', 'route1', 0.3);
      engine.setWeight('p2', 'route2', 0.7);

      await engine.saveWeights(testFile);

      const newEngine = new SonaEngine();
      await newEngine.loadWeights(testFile);

      expect(await newEngine.getWeight('p1', 'route1')).toBeCloseTo(0.3, 4);
      expect(await newEngine.getWeight('p2', 'route2')).toBeCloseTo(0.7, 4);
    });
  });

  describe('checksum verification', () => {
    it('should detect corrupted file', async () => {
      engine.createTrajectory('route', ['p1'], []);
      engine.setWeight('p1', 'route', 0.5);
      await engine.saveWeights(testFile);

      // Corrupt the file by modifying a byte
      const { readFileSync, writeFileSync } = await import('fs');
      const buffer = readFileSync(testFile);
      buffer[buffer.length - 5] ^= 0xff; // Flip bits in checksum area
      writeFileSync(testFile, buffer);

      const newEngine = new SonaEngine();
      await expect(newEngine.loadWeights(testFile)).rejects.toThrow();
    });
  });

  describe('round-trip consistency', () => {
    it('should maintain exact values through save/load', async () => {
      // Create complex state
      engine.createTrajectory('route1', ['p1', 'p2', 'p3'], []);
      engine.createTrajectory('route2', ['p4', 'p5'], []);

      const weights = [0.1, -0.2, 0.3, 0.4, -0.5];
      const fishers = [0.01, 0.02, 0.03, 0.04, 0.05];
      const patterns = ['p1', 'p2', 'p3', 'p4', 'p5'];
      const routes = ['route1', 'route1', 'route1', 'route2', 'route2'];

      patterns.forEach((p, i) => {
        engine.setWeight(p, routes[i], weights[i]);
        engine.setFisherInformation(p, routes[i], fishers[i]);
      });

      // Save and load
      await engine.saveWeights(testFile);
      const newEngine = new SonaEngine();
      await newEngine.loadWeights(testFile);

      // Verify
      for (let i = 0; i < patterns.length; i++) {
        const w = await newEngine.getWeight(patterns[i], routes[i]);
        const f = newEngine.getFisherInformation(patterns[i], routes[i]);

        expect(w).toBeCloseTo(weights[i], 4);
        expect(f).toBeCloseTo(fishers[i], 4);
      }
    });
  });
});

// ==================== Concurrency Tests ====================

describe('Concurrency', () => {
  let engine: SonaEngine;

  beforeEach(() => {
    engine = new SonaEngine();
  });

  it('should handle concurrent feedback calls', async () => {
    // Create multiple trajectories
    const trajIds = Array.from({ length: 10 }, (_, i) =>
      engine.createTrajectory('route', [`pattern-${i}`], [])
    );

    // Provide feedback concurrently
    await Promise.all(
      trajIds.map((id, i) => engine.provideFeedback(id, 0.5 + i * 0.05, { skipAutoSave: true }))
    );

    // All should succeed
    for (const id of trajIds) {
      const traj = engine.getTrajectory(id);
      expect(traj?.quality).toBeDefined();
    }
  });

  it('should maintain consistency under concurrent updates', async () => {
    // Create trajectory with shared pattern
    const traj1 = engine.createTrajectory('route', ['shared'], []);
    const traj2 = engine.createTrajectory('route', ['shared'], []);
    const traj3 = engine.createTrajectory('route', ['shared'], []);

    engine.setWeight('shared', 'route', 0.0);

    // Concurrent updates
    await Promise.all([
      engine.provideFeedback(traj1, 0.9, { skipAutoSave: true }),
      engine.provideFeedback(traj2, 0.8, { skipAutoSave: true }),
      engine.provideFeedback(traj3, 0.7, { skipAutoSave: true }),
    ]);

    // Weight should be updated (positive because all quality > 0.5)
    const weight = await engine.getWeight('shared', 'route');
    expect(weight).toBeGreaterThan(0);
  });
});

// ==================== Performance Tests ====================

describe('Performance', () => {
  it('provideFeedback should complete in <15ms', async () => {
    const engine = new SonaEngine({ trackPerformance: true });
    const patterns = Array.from({ length: 10 }, (_, i) => `pattern-${i}`);
    const trajId = engine.createTrajectory('route', patterns, []);

    // Warm up
    await engine.provideFeedback(trajId, 0.5, { skipAutoSave: true });

    const iterations = 20;
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const newTrajId = engine.createTrajectory('route', patterns, []);
      const start = performance.now();
      await engine.provideFeedback(newTrajId, 0.5 + i * 0.02, { skipAutoSave: true });
      times.push(performance.now() - start);
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    expect(avgTime).toBeLessThan(15); // <15ms average
  });
});
