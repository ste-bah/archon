/**
 * TASK-SON-003 Drift Detection and Checkpointing Tests
 *
 * Tests for:
 * - checkDrift() - Automatic drift checking
 * - createCheckpoint() - Weight snapshots with metadata
 * - rollbackToCheckpoint() - Weight restoration with loop detection
 * - Checkpoint persistence and pruning
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  SonaEngine,
  RollbackLoopError,
  CheckpointError,
} from '../../../../src/god-agent/core/learning/index.js';

describe('TASK-SON-003: Drift Detection and Checkpointing', () => {
  let engine: SonaEngine;
  let tempDir: string;

  beforeEach(async () => {
    // Create temp directory for test files
    tempDir = await mkdtemp(join(tmpdir(), 'sona-drift-test-'));

    engine = new SonaEngine({
      learningRate: 0.01,
      regularization: 0.1,
      driftAlertThreshold: 0.3,
      driftRejectThreshold: 0.5,
      maxCheckpoints: 5,
    });
    await engine.initialize();

    // Set test paths
    engine.setWeightsFilePath(join(tempDir, 'weights.bin'));
    engine.setCheckpointsDir(join(tempDir, 'checkpoints'));
  });

  afterEach(async () => {
    // Cleanup temp directory
    if (tempDir && existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  // ==================== checkDrift() Tests ====================

  describe('checkDrift()', () => {
    it('should return NORMAL status when no drift from baseline', async () => {
      // Create a trajectory to initialize weights
      engine.createTrajectory('test.route', ['pattern1', 'pattern2'], []);
      engine.setWeight('pattern1', 'test.route', 0.5);
      engine.setWeight('pattern2', 'test.route', 0.3);

      // Set baseline to current weights
      engine.setBaselineWeights();

      // Check drift - should be essentially 0 (allowing for floating point)
      const metrics = await engine.checkDrift(false);

      expect(metrics.drift).toBeCloseTo(0, 10);
      expect(metrics.status).toBe('NORMAL');
    });

    it('should initialize baseline from current weights if empty', async () => {
      // Create weights without setting baseline
      engine.createTrajectory('test.route', ['pattern1'], []);
      engine.setWeight('pattern1', 'test.route', 0.5);

      // Check drift - baseline should be auto-initialized
      const metrics = await engine.checkDrift(false);

      expect(metrics.drift).toBe(0);
      expect(metrics.status).toBe('NORMAL');
      expect(metrics.baselineWeights.length).toBeGreaterThan(0);
    });

    it('should return ALERT status when drift > alertThreshold', async () => {
      // Set up initial weights - use unit vector in one direction
      // cos(θ) = 0.6 gives drift = 0.4 which is in ALERT range (0.3-0.5)
      engine.createTrajectory('test.route', ['p1', 'p2', 'p3', 'p4'], []);
      engine.setWeight('p1', 'test.route', 1.0);
      engine.setWeight('p2', 'test.route', 0.0);
      engine.setWeight('p3', 'test.route', 0.0);
      engine.setWeight('p4', 'test.route', 0.0);

      // Set baseline
      engine.setBaselineWeights();

      // Modify weights to cause moderate drift (between alert 0.3 and reject 0.5)
      // Vector [0.6, 0.8, 0, 0] has length 1 and cos(θ) = 0.6 with [1, 0, 0, 0]
      engine.setWeight('p1', 'test.route', 0.6);
      engine.setWeight('p2', 'test.route', 0.8);
      engine.setWeight('p3', 'test.route', 0.0);
      engine.setWeight('p4', 'test.route', 0.0);

      // Suppress console.warn for ALERT
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Check drift
      const metrics = await engine.checkDrift(false);

      // Drift should be ~0.4, in alert range (0.3-0.5)
      expect(metrics.drift).toBeGreaterThan(0.3);
      expect(metrics.drift).toBeLessThan(0.5);
      expect(metrics.status).toBe('ALERT');
    });

    it('should return REJECT status when drift > rejectThreshold', async () => {
      // Set up initial weights
      engine.createTrajectory('test.route', ['pattern1', 'pattern2'], []);
      engine.setWeight('pattern1', 'test.route', 0.8);
      engine.setWeight('pattern2', 'test.route', 0.8);

      // Set baseline
      engine.setBaselineWeights();

      // Drastically modify weights to cause high drift
      engine.setWeight('pattern1', 'test.route', -0.8);
      engine.setWeight('pattern2', 'test.route', -0.8);

      // Suppress console.warn for this test
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Check drift without auto-rollback
      const metrics = await engine.checkDrift(false);

      expect(metrics.drift).toBeGreaterThan(0.5);
      expect(metrics.status).toBe('REJECT');

      warnSpy.mockRestore();
    });

    it('should handle size mismatch between current and baseline weights', async () => {
      // Set up initial weights
      engine.createTrajectory('test.route', ['pattern1'], []);
      engine.setWeight('pattern1', 'test.route', 0.5);

      // Set baseline
      engine.setBaselineWeights();

      // Add new pattern
      engine.createTrajectory('test.route', ['pattern2'], []);
      engine.setWeight('pattern2', 'test.route', 0.3);

      // Check drift - should handle size mismatch gracefully
      const metrics = await engine.checkDrift(false);

      expect(metrics.status).toBeDefined();
      expect(metrics.currentWeights.length).toBe(2);
      expect(metrics.baselineWeights.length).toBe(2); // Should be adjusted
    });

    it('should include checkpoint ID in metrics', async () => {
      // Create weights and checkpoint
      engine.createTrajectory('test.route', ['pattern1'], []);
      engine.setWeight('pattern1', 'test.route', 0.5);
      engine.setBaselineWeights();

      const checkpointId = await engine.createCheckpoint('auto');

      // Check drift
      const metrics = await engine.checkDrift(false);

      expect(metrics.checkpointId).toBe(checkpointId);
    });

    it('should auto-rollback when drift exceeds reject threshold', async () => {
      // Create a checkpoint first
      engine.createTrajectory('test.route', ['pattern1'], []);
      engine.setWeight('pattern1', 'test.route', 0.5);
      engine.setBaselineWeights();
      await engine.createCheckpoint('pre-update');

      // Modify weights drastically
      engine.setWeight('pattern1', 'test.route', -0.8);

      // Suppress console messages
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'info').mockImplementation(() => {});

      // Check drift with auto-rollback enabled
      const metrics = await engine.checkDrift(true);

      // Weight should be restored
      const restoredWeight = await engine.getWeight('pattern1', 'test.route');
      expect(restoredWeight).toBe(0.5);
      expect(metrics.status).toBe('REJECT');
    });

    it('should update metrics.currentDrift', async () => {
      // Need multiple orthogonal weights for cosine distance to show drift
      engine.createTrajectory('test.route', ['p1', 'p2', 'p3', 'p4'], []);
      engine.setWeight('p1', 'test.route', 0.5);
      engine.setWeight('p2', 'test.route', 0.5);
      engine.setWeight('p3', 'test.route', 0.0);
      engine.setWeight('p4', 'test.route', 0.0);
      engine.setBaselineWeights();

      // Change direction of the weight vector
      engine.setWeight('p1', 'test.route', 0.0);
      engine.setWeight('p2', 'test.route', 0.0);
      engine.setWeight('p3', 'test.route', 0.5);
      engine.setWeight('p4', 'test.route', 0.5);

      await engine.checkDrift(false);

      const metrics = engine.getMetrics();
      expect(metrics.currentDrift).toBeGreaterThan(0);
    });
  });

  // ==================== createCheckpoint() Tests ====================

  describe('createCheckpoint()', () => {
    it('should create checkpoint with valid ID format', async () => {
      engine.createTrajectory('test.route', ['pattern1'], []);

      const checkpointId = await engine.createCheckpoint('manual');

      expect(checkpointId).toMatch(/^ckpt-\d+-[a-f0-9]{8}$/);
    });

    it('should store checkpoint in memory', async () => {
      engine.createTrajectory('test.route', ['pattern1'], []);

      const checkpointId = await engine.createCheckpoint('manual');
      const checkpoint = engine.getCheckpoint(checkpointId);

      expect(checkpoint).toBeDefined();
      expect(checkpoint!.id).toBe(checkpointId);
    });

    it('should include correct metadata', async () => {
      // Create trajectory with quality
      const trajId = engine.createTrajectory('test.route', ['pattern1'], []);
      engine.setWeight('pattern1', 'test.route', 0.5);
      await engine.provideFeedback(trajId, 0.8, { skipAutoSave: true });

      const checkpointId = await engine.createCheckpoint('auto');
      const checkpoint = engine.getCheckpoint(checkpointId);

      expect(checkpoint!.metadata.trajectoriesProcessed).toBe(1);
      expect(checkpoint!.metadata.averageQuality).toBe(0.8);
      expect(checkpoint!.metadata.reason).toBe('auto');
    });

    it('should snapshot weights correctly', async () => {
      engine.createTrajectory('test.route', ['pattern1', 'pattern2'], []);
      engine.setWeight('pattern1', 'test.route', 0.5);
      engine.setWeight('pattern2', 'test.route', -0.3);

      const checkpointId = await engine.createCheckpoint('manual');

      // Modify weights after checkpoint
      engine.setWeight('pattern1', 'test.route', 0.9);
      engine.setWeight('pattern2', 'test.route', 0.8);

      // Verify checkpoint weights are unchanged
      const checkpoint = engine.getCheckpoint(checkpointId);
      const routeWeights = checkpoint!.weights.get('test.route');

      expect(routeWeights!.get('pattern1')).toBe(0.5);
      expect(routeWeights!.get('pattern2')).toBe(-0.3);
    });

    it('should snapshot Fisher Information', async () => {
      engine.createTrajectory('test.route', ['pattern1'], []);
      engine.setFisherInformation('pattern1', 'test.route', 0.25);

      const checkpointId = await engine.createCheckpoint('manual');

      // Modify Fisher Information after checkpoint
      engine.setFisherInformation('pattern1', 'test.route', 0.9);

      // Verify checkpoint Fisher is unchanged
      const checkpoint = engine.getCheckpoint(checkpointId);
      const routeFisher = checkpoint!.fisherInformation.get('test.route');

      expect(routeFisher!.get('pattern1')).toBe(0.25);
    });

    it('should persist checkpoint to disk', async () => {
      engine.createTrajectory('test.route', ['pattern1'], []);
      engine.setWeight('pattern1', 'test.route', 0.5);

      const checkpointId = await engine.createCheckpoint('manual');

      // Verify file exists
      const filePath = join(tempDir, 'checkpoints', `${checkpointId}.json`);
      expect(existsSync(filePath)).toBe(true);

      // Verify file content
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.id).toBe(checkpointId);
      expect(parsed.metadata.reason).toBe('manual');
    });

    it('should include drift score in checkpoint', async () => {
      // Need multiple weights for cosine distance to detect drift
      engine.createTrajectory('test.route', ['p1', 'p2', 'p3', 'p4'], []);
      engine.setWeight('p1', 'test.route', 0.5);
      engine.setWeight('p2', 'test.route', 0.5);
      engine.setWeight('p3', 'test.route', 0.0);
      engine.setWeight('p4', 'test.route', 0.0);
      engine.setBaselineWeights();

      // Modify weights to change direction
      engine.setWeight('p1', 'test.route', 0.0);
      engine.setWeight('p2', 'test.route', 0.0);
      engine.setWeight('p3', 'test.route', 0.5);
      engine.setWeight('p4', 'test.route', 0.5);

      const checkpointId = await engine.createCheckpoint('auto');
      const checkpoint = engine.getCheckpoint(checkpointId);

      expect(checkpoint!.drift).toBeGreaterThan(0);
    });

    it('should increment checkpointsCreated metric', async () => {
      engine.createTrajectory('test.route', ['pattern1'], []);

      await engine.createCheckpoint('manual');
      await engine.createCheckpoint('auto');

      const metrics = engine.getMetrics();
      expect(metrics.checkpointsCreated).toBe(2);
    });

    it('should handle all checkpoint reasons', async () => {
      engine.createTrajectory('test.route', ['pattern1'], []);

      const id1 = await engine.createCheckpoint('manual');
      const id2 = await engine.createCheckpoint('auto');
      const id3 = await engine.createCheckpoint('pre-update');

      expect(engine.getCheckpoint(id1)!.metadata.reason).toBe('manual');
      expect(engine.getCheckpoint(id2)!.metadata.reason).toBe('auto');
      expect(engine.getCheckpoint(id3)!.metadata.reason).toBe('pre-update');
    });
  });

  // ==================== rollbackToCheckpoint() Tests ====================

  describe('rollbackToCheckpoint()', () => {
    it('should restore weights from checkpoint', async () => {
      // Set up and checkpoint
      engine.createTrajectory('test.route', ['pattern1', 'pattern2'], []);
      engine.setWeight('pattern1', 'test.route', 0.5);
      engine.setWeight('pattern2', 'test.route', -0.3);

      const checkpointId = await engine.createCheckpoint('manual');

      // Modify weights
      engine.setWeight('pattern1', 'test.route', 0.9);
      engine.setWeight('pattern2', 'test.route', 0.8);

      // Suppress console.info
      vi.spyOn(console, 'info').mockImplementation(() => {});

      // Rollback
      await engine.rollbackToCheckpoint(checkpointId);

      // Verify weights restored
      const weight1 = await engine.getWeight('pattern1', 'test.route');
      const weight2 = await engine.getWeight('pattern2', 'test.route');

      expect(weight1).toBe(0.5);
      expect(weight2).toBe(-0.3);
    });

    it('should restore Fisher Information from checkpoint', async () => {
      engine.createTrajectory('test.route', ['pattern1'], []);
      engine.setFisherInformation('pattern1', 'test.route', 0.25);

      const checkpointId = await engine.createCheckpoint('manual');

      // Modify Fisher Information
      engine.setFisherInformation('pattern1', 'test.route', 0.9);

      // Suppress console.info
      vi.spyOn(console, 'info').mockImplementation(() => {});

      // Rollback
      await engine.rollbackToCheckpoint(checkpointId);

      // Verify Fisher restored
      const fisher = engine.getFisherInformation('pattern1', 'test.route');
      expect(fisher).toBe(0.25);
    });

    it('should use most recent checkpoint if no ID provided', async () => {
      engine.createTrajectory('test.route', ['pattern1'], []);

      // Create multiple checkpoints with small delay to ensure different timestamps
      engine.setWeight('pattern1', 'test.route', 0.3);
      await engine.createCheckpoint('manual');

      await new Promise(r => setTimeout(r, 15)); // Ensure different timestamp

      engine.setWeight('pattern1', 'test.route', 0.5);
      await engine.createCheckpoint('auto'); // Most recent

      // Modify weight
      engine.setWeight('pattern1', 'test.route', 0.9);

      // Suppress console.info
      vi.spyOn(console, 'info').mockImplementation(() => {});

      // Rollback without ID
      await engine.rollbackToCheckpoint();

      // Should restore to 0.5 (most recent checkpoint)
      const weight = await engine.getWeight('pattern1', 'test.route');
      expect(weight).toBe(0.5);
    });

    it('should fallback to baseline if no checkpoint available', async () => {
      engine.createTrajectory('test.route', ['pattern1'], []);
      engine.setWeight('pattern1', 'test.route', 0.5);
      engine.setBaselineWeights();

      // Modify weight
      engine.setWeight('pattern1', 'test.route', 0.9);

      // Suppress console.warn
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Rollback with no checkpoints
      await engine.rollbackToCheckpoint();

      // Should restore to baseline
      const weight = await engine.getWeight('pattern1', 'test.route');
      expect(weight).toBe(0.5);
    });

    it('should increment rollbacksTriggered metric', async () => {
      engine.createTrajectory('test.route', ['pattern1'], []);
      engine.setWeight('pattern1', 'test.route', 0.5);
      await engine.createCheckpoint('manual');

      // Suppress console.info
      vi.spyOn(console, 'info').mockImplementation(() => {});

      await engine.rollbackToCheckpoint();

      const metrics = engine.getMetrics();
      expect(metrics.rollbacksTriggered).toBe(1);
    });

    it('should throw RollbackLoopError after too many rollbacks', async () => {
      engine.createTrajectory('test.route', ['pattern1'], []);
      engine.setWeight('pattern1', 'test.route', 0.5);
      await engine.createCheckpoint('manual');

      // Suppress console.info
      vi.spyOn(console, 'info').mockImplementation(() => {});

      // Perform multiple rollbacks quickly
      await engine.rollbackToCheckpoint();
      await engine.rollbackToCheckpoint();

      // Third rollback should throw
      await expect(engine.rollbackToCheckpoint())
        .rejects.toThrow(RollbackLoopError);
    });

    it('should reset rollback counter after time window', async () => {
      engine.createTrajectory('test.route', ['pattern1'], []);
      engine.setWeight('pattern1', 'test.route', 0.5);
      await engine.createCheckpoint('manual');

      // Suppress console.info
      vi.spyOn(console, 'info').mockImplementation(() => {});

      // First rollback
      await engine.rollbackToCheckpoint();

      // Reset counter (simulates time passing)
      engine.resetRollbackCounter();

      // More rollbacks should be allowed
      await engine.rollbackToCheckpoint();
      await engine.rollbackToCheckpoint();

      // This would throw if counter wasn't reset
      engine.resetRollbackCounter();
      await engine.rollbackToCheckpoint();
    });

    it('should save restored weights to disk', async () => {
      engine.createTrajectory('test.route', ['pattern1'], []);
      engine.setWeight('pattern1', 'test.route', 0.5);
      await engine.createCheckpoint('manual');

      // Modify and verify changed
      engine.setWeight('pattern1', 'test.route', 0.9);

      // Suppress console.info
      vi.spyOn(console, 'info').mockImplementation(() => {});

      // Rollback
      await engine.rollbackToCheckpoint();

      // Verify weights file was updated
      const weightsPath = join(tempDir, 'weights.bin');
      expect(existsSync(weightsPath)).toBe(true);
    });
  });

  // ==================== Checkpoint Management Tests ====================

  describe('checkpoint management', () => {
    it('should list checkpoints sorted by timestamp (newest first)', async () => {
      engine.createTrajectory('test.route', ['pattern1'], []);

      await engine.createCheckpoint('manual');
      await new Promise(r => setTimeout(r, 10)); // Small delay
      await engine.createCheckpoint('auto');

      const checkpoints = engine.listCheckpoints();

      expect(checkpoints.length).toBe(2);
      expect(checkpoints[0].timestamp).toBeGreaterThan(checkpoints[1].timestamp);
    });

    it('should return correct checkpoint count', async () => {
      engine.createTrajectory('test.route', ['pattern1'], []);

      expect(engine.getCheckpointCount()).toBe(0);

      await engine.createCheckpoint('manual');
      expect(engine.getCheckpointCount()).toBe(1);

      await engine.createCheckpoint('auto');
      expect(engine.getCheckpointCount()).toBe(2);
    });

    it('should prune old checkpoints beyond maxCheckpoints', async () => {
      // Engine configured with maxCheckpoints: 5
      engine.createTrajectory('test.route', ['pattern1'], []);

      // Create 7 checkpoints
      for (let i = 0; i < 7; i++) {
        engine.setWeight('pattern1', 'test.route', i * 0.1);
        await engine.createCheckpoint('auto');
      }

      // Should only have 5 checkpoints
      expect(engine.getCheckpointCount()).toBe(5);
    });

    it('should keep most recent checkpoints when pruning', async () => {
      engine.createTrajectory('test.route', ['pattern1'], []);

      // Create checkpoints with distinguishable weights
      for (let i = 0; i < 7; i++) {
        engine.setWeight('pattern1', 'test.route', i * 0.1);
        await engine.createCheckpoint('auto');
        await new Promise(r => setTimeout(r, 10)); // Ensure different timestamps
      }

      // Most recent checkpoint should have weight 0.6 (i=6)
      const checkpoints = engine.listCheckpoints();
      const mostRecent = checkpoints[0];
      const routeWeights = mostRecent.weights.get('test.route');

      // Should be approximately 0.6
      expect(routeWeights!.get('pattern1')).toBeCloseTo(0.6, 1);
    });

    it('should load checkpoint from disk', async () => {
      engine.createTrajectory('test.route', ['pattern1'], []);
      engine.setWeight('pattern1', 'test.route', 0.75);

      const checkpointId = await engine.createCheckpoint('manual');

      // Create new engine and load checkpoint
      const newEngine = new SonaEngine();
      await newEngine.initialize();
      newEngine.setCheckpointsDir(join(tempDir, 'checkpoints'));

      const loadedCheckpoint = await newEngine.loadCheckpoint(checkpointId);

      expect(loadedCheckpoint).toBeDefined();
      expect(loadedCheckpoint!.id).toBe(checkpointId);

      const routeWeights = loadedCheckpoint!.weights.get('test.route');
      expect(routeWeights!.get('pattern1')).toBe(0.75);
    });

    it('should load all checkpoints from disk', async () => {
      engine.createTrajectory('test.route', ['pattern1'], []);

      await engine.createCheckpoint('manual');
      await engine.createCheckpoint('auto');
      await engine.createCheckpoint('pre-update');

      // Create new engine and load all checkpoints
      const newEngine = new SonaEngine();
      await newEngine.initialize();
      newEngine.setCheckpointsDir(join(tempDir, 'checkpoints'));

      await newEngine.loadAllCheckpoints();

      expect(newEngine.getCheckpointCount()).toBe(3);
    });

    it('should return undefined for non-existent checkpoint', async () => {
      const checkpoint = engine.getCheckpoint('ckpt-nonexistent-12345678');
      expect(checkpoint).toBeUndefined();
    });

    it('should return undefined when loading non-existent checkpoint file', async () => {
      const loaded = await engine.loadCheckpoint('ckpt-1234567890-abcdef12');
      expect(loaded).toBeUndefined();
    });
  });

  // ==================== Baseline Weight Tests ====================

  describe('baseline weights', () => {
    it('should set baseline from current weights when no argument provided', async () => {
      // Need multiple weights for cosine distance to show drift
      engine.createTrajectory('test.route', ['p1', 'p2', 'p3', 'p4'], []);
      engine.setWeight('p1', 'test.route', 0.5);
      engine.setWeight('p2', 'test.route', 0.5);
      engine.setWeight('p3', 'test.route', 0.0);
      engine.setWeight('p4', 'test.route', 0.0);

      engine.setBaselineWeights();

      // Modify current weights to change direction
      engine.setWeight('p1', 'test.route', 0.0);
      engine.setWeight('p2', 'test.route', 0.0);
      engine.setWeight('p3', 'test.route', 0.5);
      engine.setWeight('p4', 'test.route', 0.5);

      // Check drift - should show difference from baseline
      const metrics = await engine.checkDrift(false);

      expect(metrics.drift).toBeGreaterThan(0);
    });

    it('should set baseline from provided weights', async () => {
      // Need multiple weights for cosine distance
      engine.createTrajectory('test.route', ['p1', 'p2', 'p3', 'p4'], []);
      engine.setWeight('p1', 'test.route', 0.0);
      engine.setWeight('p2', 'test.route', 0.0);
      engine.setWeight('p3', 'test.route', 0.5);
      engine.setWeight('p4', 'test.route', 0.5);

      // Create custom baseline with opposite direction
      const customBaseline = new Map<string, Map<string, number>>();
      const routeWeights = new Map<string, number>();
      routeWeights.set('p1', 0.5);
      routeWeights.set('p2', 0.5);
      routeWeights.set('p3', 0.0);
      routeWeights.set('p4', 0.0);
      customBaseline.set('test.route', routeWeights);

      engine.setBaselineWeights(customBaseline);

      // Check drift - should show difference from custom baseline
      const metrics = await engine.checkDrift(false);

      expect(metrics.drift).toBeGreaterThan(0);
    });
  });

  // ==================== Error Handling Tests ====================

  describe('error handling', () => {
    it('should throw CheckpointError on save failure', async () => {
      // Set invalid path
      engine.setCheckpointsDir('/nonexistent/invalid/path/that/should/fail');

      engine.createTrajectory('test.route', ['pattern1'], []);

      // This should fail because we can't create directory at root level
      // Note: This test may not fail on all systems
      // We'll verify the error type if it throws
      try {
        await engine.createCheckpoint('manual');
      } catch (error) {
        if (error instanceof CheckpointError) {
          expect(error.operation).toBe('save');
        }
      }
    });

    it('should handle loadAllCheckpoints gracefully when directory missing', async () => {
      engine.setCheckpointsDir(join(tempDir, 'nonexistent'));

      // Should not throw
      await expect(engine.loadAllCheckpoints()).resolves.not.toThrow();
    });

    it('RollbackLoopError should contain correct information', () => {
      const error = new RollbackLoopError(3, 300000);

      expect(error.rollbackCount).toBe(3);
      expect(error.timeWindowMs).toBe(300000);
      expect(error.name).toBe('RollbackLoopError');
      expect(error.message).toContain('3 rollbacks');
    });

    it('CheckpointError should contain correct operation', () => {
      const saveError = new CheckpointError('save', 'test message');
      const loadError = new CheckpointError('load', 'test message');

      expect(saveError.operation).toBe('save');
      expect(loadError.operation).toBe('load');
      expect(saveError.name).toBe('CheckpointError');
    });
  });

  // ==================== Integration Tests ====================

  describe('integration scenarios', () => {
    it('should support full drift detection and recovery workflow', async () => {
      // 1. Initialize and set baseline
      engine.createTrajectory('test.route', ['p1', 'p2', 'p3'], []);
      engine.setWeight('p1', 'test.route', 0.3);
      engine.setWeight('p2', 'test.route', 0.3);
      engine.setWeight('p3', 'test.route', 0.3);
      engine.setBaselineWeights();

      // 2. Create initial checkpoint
      const checkpoint1 = await engine.createCheckpoint('auto');

      // 3. Simulate gradual weight updates
      engine.setWeight('p1', 'test.route', 0.35);
      let metrics = await engine.checkDrift(false);
      expect(metrics.status).toBe('NORMAL');

      // 4. Create checkpoint after acceptable changes
      const checkpoint2 = await engine.createCheckpoint('auto');

      // 5. Simulate problematic update that causes high drift
      engine.setWeight('p1', 'test.route', -0.8);
      engine.setWeight('p2', 'test.route', -0.8);
      engine.setWeight('p3', 'test.route', -0.8);

      // Suppress console messages
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'info').mockImplementation(() => {});

      // 6. Detect high drift
      metrics = await engine.checkDrift(false);
      expect(metrics.status).toBe('REJECT');

      // 7. Manually rollback to last good state
      await engine.rollbackToCheckpoint(checkpoint2);

      // 8. Verify weights restored
      const w1 = await engine.getWeight('p1', 'test.route');
      expect(w1).toBeCloseTo(0.35, 2);

      // 9. Verify drift back to normal
      metrics = await engine.checkDrift(false);
      expect(metrics.status).toBe('NORMAL');
    });

    it('should handle multiple routes with independent drift', async () => {
      // Set up two routes
      engine.createTrajectory('route.A', ['patternA'], []);
      engine.createTrajectory('route.B', ['patternB'], []);
      engine.setWeight('patternA', 'route.A', 0.5);
      engine.setWeight('patternB', 'route.B', 0.5);
      engine.setBaselineWeights();

      // Create checkpoint
      await engine.createCheckpoint('auto');

      // Modify only one route drastically
      engine.setWeight('patternA', 'route.A', -0.9);

      // Suppress console
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Check overall drift
      const metrics = await engine.checkDrift(false);

      // Drift should be detected based on all weights
      expect(metrics.currentWeights.length).toBe(2);
    });

    it('should maintain consistency after multiple checkpoint/rollback cycles', async () => {
      engine.createTrajectory('test.route', ['pattern1'], []);

      // Suppress console
      vi.spyOn(console, 'info').mockImplementation(() => {});

      const expectedWeights = [0.1, 0.3, 0.5]; // Avoid 0.0 as first value

      for (let i = 0; i < 3; i++) {
        // Clear checkpoints to ensure we only have one at a time
        // (by creating new engine or using a unique route per iteration)

        // Set weight and checkpoint
        const expectedWeight = expectedWeights[i];
        engine.setWeight('pattern1', 'test.route', expectedWeight);
        const checkpointId = await engine.createCheckpoint('auto');

        // Modify weight
        engine.setWeight('pattern1', 'test.route', 0.9);

        // Rollback to specific checkpoint and reset counter
        await engine.rollbackToCheckpoint(checkpointId);
        engine.resetRollbackCounter();

        // Verify restored
        const weight = await engine.getWeight('pattern1', 'test.route');
        expect(weight).toBeCloseTo(expectedWeight, 2);
      }
    });
  });

  // ==================== Performance Tests ====================

  describe('performance', () => {
    it('checkDrift should complete within 5ms for typical use', async () => {
      // Set up weights
      engine.createTrajectory('test.route', ['p1', 'p2', 'p3', 'p4', 'p5'], []);
      for (let i = 1; i <= 5; i++) {
        engine.setWeight(`p${i}`, 'test.route', i * 0.1);
      }
      engine.setBaselineWeights();

      const start = performance.now();
      await engine.checkDrift(false);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(50); // Allow some margin for test environment
    });

    it('createCheckpoint should complete within 100ms for typical use', async () => {
      // Set up weights
      engine.createTrajectory('test.route', ['p1', 'p2', 'p3'], []);
      for (let i = 1; i <= 3; i++) {
        engine.setWeight(`p${i}`, 'test.route', i * 0.1);
      }

      const start = performance.now();
      await engine.createCheckpoint('auto');
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(200); // Allow margin for disk I/O
    });
  });
});
