/**
 * Weight Persistence Test Suite
 * TASK-GNN-003 - Weight Persistence System
 *
 * Tests for:
 * - AC-001: Weights persist to .agentdb/gnn/weights/{layerId}.weights.bin
 * - AC-002: Weights auto-load on GNNEnhancer construction if available
 * - AC-003: Version metadata stored alongside weights
 * - AC-004: Checkpointing every N updates configurable
 * - AC-005: Corrupted weights detected and handled gracefully
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WeightManager } from '../../../../src/god-agent/core/reasoning/weight-manager.js';
import { GNNEnhancer } from '../../../../src/god-agent/core/reasoning/gnn-enhancer.js';
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

describe('TASK-GNN-003: Weight Persistence System', () => {
  const testPath = '/tmp/gnn-test-weights-' + Date.now();
  const checkpointPath = '/tmp/gnn-test-checkpoints-' + Date.now();

  beforeEach(() => {
    // Clean up test directories
    if (existsSync(testPath)) {
      rmSync(testPath, { recursive: true });
    }
    if (existsSync(checkpointPath)) {
      rmSync(checkpointPath, { recursive: true });
    }
    mkdirSync(testPath, { recursive: true });
  });

  afterEach(() => {
    // Clean up
    if (existsSync(testPath)) {
      rmSync(testPath, { recursive: true });
    }
    if (existsSync(checkpointPath)) {
      rmSync(checkpointPath, { recursive: true });
    }
  });

  // =====================================================================
  // AC-001: Weights persist to .agentdb/gnn/weights/{layerId}.weights.bin
  // =====================================================================
  describe('AC-001: Weight Persistence to Binary Files', () => {
    it('should persist weights to binary file', async () => {
      const manager = new WeightManager(testPath);

      // Initialize weights
      manager.initializeWeights('layer1', {
        inputDim: 10,
        outputDim: 5,
        initialization: 'xavier',
        seed: 12345
      });

      // Save weights
      await manager.saveWeights('layer1');

      // Verify binary file exists
      const binPath = join(testPath, 'layer1.weights.bin');
      expect(existsSync(binPath)).toBe(true);

      // Verify file has correct size (header + data)
      const buffer = readFileSync(binPath);
      const expectedSize = 8 + (5 * 10 * 4); // 8 byte header + 50 floats * 4 bytes
      expect(buffer.length).toBe(expectedSize);
    });

    it('should use correct binary format with little-endian dimensions', async () => {
      const manager = new WeightManager(testPath);

      manager.initializeWeights('test_layer', {
        inputDim: 8,
        outputDim: 4,
        initialization: 'xavier',
        seed: 42
      });

      await manager.saveWeights('test_layer');

      const buffer = readFileSync(join(testPath, 'test_layer.weights.bin'));
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

      // Check header: numRows=4, numCols=8 (little-endian)
      const numRows = view.getUint32(0, true);
      const numCols = view.getUint32(4, true);

      expect(numRows).toBe(4);
      expect(numCols).toBe(8);
    });

    it('should save all layers with saveAll()', async () => {
      const manager = new WeightManager(testPath);

      manager.initializeWeights('layer1', { inputDim: 10, outputDim: 5, initialization: 'xavier' });
      manager.initializeWeights('layer2', { inputDim: 5, outputDim: 3, initialization: 'he' });

      await manager.saveAll();

      expect(existsSync(join(testPath, 'layer1.weights.bin'))).toBe(true);
      expect(existsSync(join(testPath, 'layer2.weights.bin'))).toBe(true);
    });
  });

  // =====================================================================
  // AC-002: Weights auto-load on GNNEnhancer construction if available
  // =====================================================================
  describe('AC-002: Automatic Weight Loading', () => {
    it('should load weights from disk when available', async () => {
      // Create and save weights
      const manager1 = new WeightManager(testPath);
      const originalWeights = manager1.initializeWeights('layer1', {
        inputDim: 10,
        outputDim: 5,
        initialization: 'xavier',
        seed: 12345
      });
      await manager1.saveWeights('layer1');

      // Create new manager and load
      const manager2 = new WeightManager(testPath);
      const loadedWeights = await manager2.loadWeights('layer1');

      expect(loadedWeights).not.toBeNull();
      expect(loadedWeights!.length).toBe(originalWeights.length);
      expect(loadedWeights![0].length).toBe(originalWeights[0].length);

      // Verify values match
      for (let r = 0; r < originalWeights.length; r++) {
        for (let c = 0; c < originalWeights[r].length; c++) {
          expect(loadedWeights![r][c]).toBeCloseTo(originalWeights[r][c], 6);
        }
      }
    });

    it('should return null when weights file does not exist', async () => {
      const manager = new WeightManager(testPath);
      const loaded = await manager.loadWeights('nonexistent_layer');
      expect(loaded).toBeNull();
    });

    it('should track which weights were loaded from disk', async () => {
      const manager1 = new WeightManager(testPath);
      manager1.initializeWeights('layer1', { inputDim: 10, outputDim: 5, initialization: 'xavier' });
      await manager1.saveWeights('layer1');

      const manager2 = new WeightManager(testPath);
      await manager2.loadWeights('layer1');

      expect(manager2.wasLoadedFromDisk('layer1')).toBe(true);
      expect(manager2.wasLoadedFromDisk('layer2')).toBe(false);
    });

    it('should check if persisted weights exist', async () => {
      const manager = new WeightManager(testPath);
      manager.initializeWeights('layer1', { inputDim: 10, outputDim: 5, initialization: 'xavier' });

      expect(manager.hasPersistedWeights('layer1')).toBe(false);

      await manager.saveWeights('layer1');

      expect(manager.hasPersistedWeights('layer1')).toBe(true);
      expect(manager.hasPersistedWeights('layer2')).toBe(false);
    });
  });

  // =====================================================================
  // AC-003: Version metadata stored alongside weights
  // =====================================================================
  describe('AC-003: Version Metadata Tracking', () => {
    it('should save metadata JSON file alongside binary weights', async () => {
      const manager = new WeightManager(testPath);
      manager.initializeWeights('layer1', { inputDim: 10, outputDim: 5, initialization: 'xavier', seed: 42 });
      await manager.saveWeights('layer1');

      const metaPath = join(testPath, 'layer1.weights.meta.json');
      expect(existsSync(metaPath)).toBe(true);
    });

    it('should include version, timestamp, and checksum in metadata', async () => {
      const manager = new WeightManager(testPath);
      manager.initializeWeights('layer1', { inputDim: 10, outputDim: 5, initialization: 'xavier', seed: 42 });
      await manager.saveWeights('layer1');

      const metadata = manager.getMetadata('layer1');
      expect(metadata).toBeDefined();
      expect(metadata!.version).toBe('1.0.0');
      expect(metadata!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601 format
      expect(metadata!.checksum).toMatch(/^[a-f0-9]{32}$/); // MD5 hash
    });

    it('should include dimension info in metadata', async () => {
      const manager = new WeightManager(testPath);
      manager.initializeWeights('layer1', { inputDim: 10, outputDim: 5, initialization: 'he', seed: 42 });
      await manager.saveWeights('layer1');

      const metadata = manager.getMetadata('layer1');
      expect(metadata!.numRows).toBe(5);
      expect(metadata!.numCols).toBe(10);
      expect(metadata!.totalParams).toBe(50);
      expect(metadata!.initialization).toBe('he');
      expect(metadata!.seed).toBe(42);
    });

    it('should load and verify metadata when loading weights', async () => {
      const manager1 = new WeightManager(testPath);
      manager1.initializeWeights('layer1', { inputDim: 10, outputDim: 5, initialization: 'xavier' });
      await manager1.saveWeights('layer1');

      const manager2 = new WeightManager(testPath);
      await manager2.loadWeights('layer1');

      const metadata = manager2.getMetadata('layer1');
      expect(metadata).toBeDefined();
      expect(metadata!.version).toBe('1.0.0');
    });
  });

  // =====================================================================
  // AC-004: Checkpointing every N updates configurable
  // =====================================================================
  describe('AC-004: Checkpoint Mechanism', () => {
    it('should create checkpoint with timestamp in filename', async () => {
      const manager = new WeightManager(testPath, {
        enabled: true,
        intervalUpdates: 1,
        maxCheckpoints: 5,
        checkpointDir: checkpointPath
      });

      manager.initializeWeights('layer1', { inputDim: 10, outputDim: 5, initialization: 'xavier' });
      const checkpointName = await manager.createCheckpoint('layer1');

      expect(checkpointName).toMatch(/^layer1\.checkpoint\.\d+\.bin$/);
      expect(existsSync(join(checkpointPath, checkpointName))).toBe(true);
    });

    it('should list checkpoints sorted by timestamp', async () => {
      const manager = new WeightManager(testPath, {
        enabled: true,
        intervalUpdates: 1,
        maxCheckpoints: 10,
        checkpointDir: checkpointPath
      });

      manager.initializeWeights('layer1', { inputDim: 5, outputDim: 3, initialization: 'xavier' });

      // Create multiple checkpoints with small delay
      await manager.createCheckpoint('layer1');
      await new Promise(r => setTimeout(r, 10));
      await manager.createCheckpoint('layer1');
      await new Promise(r => setTimeout(r, 10));
      await manager.createCheckpoint('layer1');

      const checkpoints = manager.listCheckpoints('layer1');
      expect(checkpoints.length).toBe(3);

      // Verify sorted order
      for (let i = 1; i < checkpoints.length; i++) {
        const ts1 = parseInt(checkpoints[i - 1].match(/\.(\d+)\./)?.[1] ?? '0');
        const ts2 = parseInt(checkpoints[i].match(/\.(\d+)\./)?.[1] ?? '0');
        expect(ts2).toBeGreaterThan(ts1);
      }
    });

    it('should cleanup old checkpoints when exceeding maxCheckpoints', async () => {
      const manager = new WeightManager(testPath, {
        enabled: true,
        intervalUpdates: 1,
        maxCheckpoints: 2,
        checkpointDir: checkpointPath
      });

      manager.initializeWeights('layer1', { inputDim: 5, outputDim: 3, initialization: 'xavier' });

      // Create more checkpoints than max
      await manager.createCheckpoint('layer1');
      await new Promise(r => setTimeout(r, 10));
      await manager.createCheckpoint('layer1');
      await new Promise(r => setTimeout(r, 10));
      await manager.createCheckpoint('layer1');

      const checkpoints = manager.listCheckpoints('layer1');
      expect(checkpoints.length).toBe(2);
    });

    it('should restore from latest checkpoint', async () => {
      const manager = new WeightManager(testPath, {
        enabled: true,
        intervalUpdates: 1,
        maxCheckpoints: 5,
        checkpointDir: checkpointPath
      });

      const originalWeights = manager.initializeWeights('layer1', {
        inputDim: 5,
        outputDim: 3,
        initialization: 'xavier',
        seed: 12345
      });
      await manager.createCheckpoint('layer1');

      // Clear weights
      manager.clear();

      // Restore
      const restored = await manager.restoreFromCheckpoint('layer1');
      expect(restored).toBe(true);

      const restoredWeights = manager.getWeights('layer1');
      expect(restoredWeights.length).toBe(originalWeights.length);

      // Verify values match
      for (let r = 0; r < originalWeights.length; r++) {
        for (let c = 0; c < originalWeights[r].length; c++) {
          expect(restoredWeights[r][c]).toBeCloseTo(originalWeights[r][c], 6);
        }
      }
    });

    it('should allow configurable checkpoint interval', () => {
      const manager = new WeightManager(testPath, {
        enabled: true,
        intervalUpdates: 50,
        maxCheckpoints: 10,
        checkpointDir: checkpointPath
      });

      const config = manager.getCheckpointConfig();
      expect(config.intervalUpdates).toBe(50);
      expect(config.maxCheckpoints).toBe(10);
      expect(config.enabled).toBe(true);
    });

    it('should update checkpoint config dynamically', () => {
      const manager = new WeightManager(testPath);

      manager.setCheckpointConfig({
        enabled: true,
        intervalUpdates: 25,
        maxCheckpoints: 3
      });

      const config = manager.getCheckpointConfig();
      expect(config.intervalUpdates).toBe(25);
      expect(config.maxCheckpoints).toBe(3);
    });
  });

  // =====================================================================
  // AC-005: Corrupted weights detected and handled gracefully
  // =====================================================================
  describe('AC-005: Corrupted Weight Detection and Handling', () => {
    it('should detect NaN values in weights', () => {
      const manager = new WeightManager(testPath);
      const corruptWeights = [
        new Float32Array([1, 2, NaN]),
        new Float32Array([4, 5, 6])
      ];

      const result = manager.validateWeights(corruptWeights);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('NaN'))).toBe(true);
    });

    it('should detect Infinity values in weights', () => {
      const manager = new WeightManager(testPath);
      const corruptWeights = [
        new Float32Array([1, Infinity, 3]),
        new Float32Array([4, 5, -Infinity])
      ];

      const result = manager.validateWeights(corruptWeights);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Infinite'))).toBe(true);
    });

    it('should detect dimension mismatches', () => {
      const manager = new WeightManager(testPath);
      const weights = [
        new Float32Array([1, 2, 3]),
        new Float32Array([4, 5, 6])
      ];

      const result = manager.validateWeights(weights, 3, 4); // Wrong expected dimensions

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('mismatch'))).toBe(true);
    });

    it('should detect inconsistent row lengths', () => {
      const manager = new WeightManager(testPath);
      const corruptWeights = [
        new Float32Array([1, 2, 3]),
        new Float32Array([4, 5]) // Wrong length
      ];

      const result = manager.validateWeights(corruptWeights);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('inconsistent'))).toBe(true);
    });

    it('should warn about all-zero weights', () => {
      const manager = new WeightManager(testPath);
      const zeroWeights = [
        new Float32Array([0, 0, 0]),
        new Float32Array([0, 0, 0])
      ];

      const result = manager.validateWeights(zeroWeights);

      expect(result.valid).toBe(true); // Valid but with warning
      expect(result.warnings.some(w => w.includes('zero'))).toBe(true);
    });

    it('should warn about very large weight values', () => {
      const manager = new WeightManager(testPath);
      const largeWeights = [
        new Float32Array([1000, 2000, 3000]),
        new Float32Array([4000, 5000, 6000])
      ];

      const result = manager.validateWeights(largeWeights);

      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('large'))).toBe(true);
    });

    it('should return null when loading corrupted binary file', async () => {
      const manager = new WeightManager(testPath);

      // Create corrupted binary file (too small)
      const corruptPath = join(testPath, 'corrupt.weights.bin');
      writeFileSync(corruptPath, Buffer.from([1, 2, 3])); // Too small

      const loaded = await manager.loadWeights('corrupt');
      expect(loaded).toBeNull();
    });

    it('should return null when dimensions are zero', async () => {
      const manager = new WeightManager(testPath);

      // Create file with zero dimensions
      const buffer = Buffer.alloc(8);
      const view = new DataView(buffer.buffer);
      view.setUint32(0, 0, true); // numRows = 0
      view.setUint32(4, 5, true); // numCols = 5
      writeFileSync(join(testPath, 'zero_dim.weights.bin'), buffer);

      const loaded = await manager.loadWeights('zero_dim');
      expect(loaded).toBeNull();
    });

    it('should handle gracefully when metadata checksum mismatches', async () => {
      const manager1 = new WeightManager(testPath);
      manager1.initializeWeights('layer1', { inputDim: 5, outputDim: 3, initialization: 'xavier' });
      await manager1.saveWeights('layer1');

      // Corrupt the metadata by changing checksum
      const metaPath = join(testPath, 'layer1.weights.meta.json');
      const metadata = JSON.parse(readFileSync(metaPath, 'utf-8'));
      metadata.checksum = 'wrongchecksum';
      writeFileSync(metaPath, JSON.stringify(metadata));

      // Should still load weights but log a warning
      const manager2 = new WeightManager(testPath);
      const loaded = await manager2.loadWeights('layer1');

      // Weights should still load despite checksum mismatch
      expect(loaded).not.toBeNull();
    });

    it('should validate weights after loading by default', async () => {
      const manager1 = new WeightManager(testPath);
      manager1.initializeWeights('layer1', { inputDim: 5, outputDim: 3, initialization: 'xavier' });
      await manager1.saveWeights('layer1');

      // Corrupt the binary file by injecting NaN
      const binPath = join(testPath, 'layer1.weights.bin');
      const buffer = readFileSync(binPath);
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      view.setFloat32(8, NaN, true); // Set first float to NaN
      writeFileSync(binPath, buffer);

      const manager2 = new WeightManager(testPath);
      const loaded = await manager2.loadWeights('layer1');

      // Should fail validation and return null
      expect(loaded).toBeNull();
    });

    it('should allow skipping validation when loading', async () => {
      const manager1 = new WeightManager(testPath);
      manager1.initializeWeights('layer1', { inputDim: 5, outputDim: 3, initialization: 'xavier' });
      await manager1.saveWeights('layer1');

      // Corrupt the binary file
      const binPath = join(testPath, 'layer1.weights.bin');
      const buffer = readFileSync(binPath);
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      view.setFloat32(8, NaN, true);
      writeFileSync(binPath, buffer);

      const manager2 = new WeightManager(testPath);
      const loaded = await manager2.loadWeights('layer1', false); // Skip validation

      // Should load despite NaN
      expect(loaded).not.toBeNull();
    });
  });

  // =====================================================================
  // GNNEnhancer Integration Tests
  // =====================================================================
  describe('GNNEnhancer Integration', () => {
    it('should save and load weights through GNNEnhancer', async () => {
      const enhancer = new GNNEnhancer(undefined, undefined, 12345, {
        checkpointDir: checkpointPath
      }, false);

      // Save weights
      await enhancer.saveWeightsWithMetadata();

      // Verify weights were saved
      expect(enhancer.hasPersistedWeights()).toBe(true);

      // Clean up
      await enhancer.deleteAllPersistedWeights();
    });

    it('should get weight metadata from GNNEnhancer', async () => {
      const enhancer = new GNNEnhancer(undefined, undefined, 12345, undefined, false);

      await enhancer.saveWeightsWithMetadata();

      const metadata = enhancer.getWeightMetadata();
      expect(metadata.size).toBeGreaterThan(0);

      for (const [layerId, meta] of metadata) {
        if (meta) {
          expect(meta.version).toBe('1.0.0');
          expect(meta.timestamp).toBeDefined();
          expect(meta.checksum).toBeDefined();
        }
      }

      await enhancer.deleteAllPersistedWeights();
    });

    it('should validate all weights through GNNEnhancer', () => {
      const enhancer = new GNNEnhancer(undefined, undefined, 12345, undefined, false);

      const validationResults = enhancer.validateAllWeights();
      expect(validationResults.size).toBeGreaterThan(0);

      for (const [, result] of validationResults) {
        expect(result.valid).toBe(true);
        expect(result.errors.length).toBe(0);
      }
    });

    it('should create and restore checkpoints through GNNEnhancer', async () => {
      const enhancer = new GNNEnhancer(undefined, undefined, 12345, {
        enabled: true,
        checkpointDir: checkpointPath,
        maxCheckpoints: 5
      }, false);

      // Create checkpoints
      const checkpoints = await enhancer.createCheckpoint();
      expect(checkpoints.length).toBeGreaterThan(0);

      // Clear and restore
      enhancer.reinitializeWeights(99999); // Different weights
      const restored = await enhancer.restoreFromCheckpoint();
      expect(restored).toBeGreaterThan(0);

      // Clean up
      if (existsSync(checkpointPath)) {
        rmSync(checkpointPath, { recursive: true });
      }
    });

    it('should configure checkpoints through GNNEnhancer', () => {
      const enhancer = new GNNEnhancer();

      enhancer.setCheckpointConfig({
        enabled: true,
        intervalUpdates: 10,
        maxCheckpoints: 3
      });

      const config = enhancer.getCheckpointConfig();
      expect(config.enabled).toBe(true);
      expect(config.intervalUpdates).toBe(10);
      expect(config.maxCheckpoints).toBe(3);
    });
  });
});
