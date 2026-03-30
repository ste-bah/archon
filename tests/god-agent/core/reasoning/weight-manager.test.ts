/**
 * WeightManager Unit Tests - setWeights() and updateWeights()
 * TASK-WM-004 - Unit Tests for Weight Modification Methods
 *
 * Tests for:
 * - setWeights: Direct weight replacement with validation
 * - updateWeights: Delta-based weight updates with rollback
 *
 * Coverage target: >= 90% on setWeights and updateWeights methods
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WeightManager } from '../../../../src/god-agent/core/reasoning/weight-manager.js';
import { existsSync, rmSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

describe('WeightManager - setWeights and updateWeights', () => {
  const testPath = '/tmp/wm-test-weights-' + Date.now();
  let weightManager: WeightManager;

  beforeEach(() => {
    // Clean up and create test directory
    if (existsSync(testPath)) {
      rmSync(testPath, { recursive: true });
    }
    mkdirSync(testPath, { recursive: true });

    // Create WeightManager instance with autoLoad disabled
    weightManager = new WeightManager(testPath, undefined, false);
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testPath)) {
      rmSync(testPath, { recursive: true });
    }
  });

  // Helper to create valid weight matrix
  const createWeights = (rows: number, cols: number, initialValue: number = 0.1): Float32Array[] => {
    const weights: Float32Array[] = [];
    for (let r = 0; r < rows; r++) {
      const row = new Float32Array(cols);
      for (let c = 0; c < cols; c++) {
        row[c] = initialValue + r * 0.01 + c * 0.001;
      }
      weights.push(row);
    }
    return weights;
  };

  // Helper to initialize layer with config
  const initializeLayer = (layerId: string, inputDim: number, outputDim: number) => {
    weightManager.initializeWeights(layerId, {
      inputDim,
      outputDim,
      initialization: 'xavier',
      seed: 12345
    });
  };

  // =====================================================================
  // TASK-WM-004: setWeights() Test Suite - 9 Tests
  // =====================================================================
  describe('setWeights', () => {
    it('should replace weights with valid dimensions', () => {
      // Setup: initialize layer with 10x20 dimensions
      initializeLayer('test-layer', 20, 10); // inputDim=20, outputDim=10

      // Create new weights matching dimensions (10 rows x 20 cols)
      const newWeights = createWeights(10, 20, 0.5);

      // Action: set weights
      weightManager.setWeights('test-layer', newWeights);

      // Verify: weights are stored correctly
      const storedWeights = weightManager.getWeights('test-layer');
      expect(storedWeights).toHaveLength(10);
      expect(storedWeights[0]).toHaveLength(20);

      // Verify values match
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 20; c++) {
          expect(storedWeights[r][c]).toBeCloseTo(newWeights[r][c], 6);
        }
      }
    });

    it('should throw if layerId not in configs', async () => {
      // Create weights but don't initialize layer
      const weights = createWeights(5, 10);

      // Action & Verify: should throw for unknown layer
      expect(() => weightManager.setWeights('unknown-layer', weights))
        .toThrow('not found in configs');
    });

    it('should throw on row count mismatch', () => {
      // Setup: initialize layer with 10 output dimensions (10 rows)
      initializeLayer('test-layer', 20, 10);

      // Create weights with wrong row count (5 instead of 10)
      const wrongRowWeights = createWeights(5, 20);

      // Action & Verify: should throw for row mismatch
      expect(() => weightManager.setWeights('test-layer', wrongRowWeights))
        .toThrow('Row count mismatch');
    });

    it('should throw on column count mismatch', () => {
      // Setup: initialize layer with 20 input dimensions (20 cols)
      initializeLayer('test-layer', 20, 10);

      // Create weights with wrong column count (30 instead of 20)
      const wrongColWeights = createWeights(10, 30);

      // Action & Verify: should throw for column mismatch
      expect(() => weightManager.setWeights('test-layer', wrongColWeights))
        .toThrow('Column count mismatch');
    });

    it('should throw on NaN values', () => {
      // Setup: initialize layer
      initializeLayer('test-layer', 20, 10);

      // Create weights with NaN
      const nanWeights = createWeights(10, 20);
      nanWeights[5][10] = NaN;

      // Action & Verify: should throw for NaN
      expect(() => weightManager.setWeights('test-layer', nanWeights))
        .toThrow('Validation failed');
    });

    it('should throw on Inf values', () => {
      // Setup: initialize layer
      initializeLayer('test-layer', 20, 10);

      // Create weights with Infinity
      const infWeights = createWeights(10, 20);
      infWeights[3][7] = Infinity;

      // Action & Verify: should throw for Infinity
      expect(() => weightManager.setWeights('test-layer', infWeights))
        .toThrow('Validation failed');
    });

    it('should not auto-persist to disk', () => {
      // Setup: initialize layer
      initializeLayer('test-layer', 20, 10);

      // Set new weights
      const newWeights = createWeights(10, 20, 0.5);
      weightManager.setWeights('test-layer', newWeights);

      // Verify: no file written to disk
      const files = readdirSync(testPath);
      const binFiles = files.filter(f => f.endsWith('.bin'));
      expect(binFiles).toHaveLength(0);
    });

    it('should increment updateCount', () => {
      // Setup: initialize layer
      initializeLayer('test-layer', 20, 10);
      const countBefore = weightManager.getUpdateCount();

      // Set new weights
      const newWeights = createWeights(10, 20, 0.5);
      weightManager.setWeights('test-layer', newWeights);

      // Verify: count incremented
      expect(weightManager.getUpdateCount()).toBe(countBefore + 1);
    });

    it('should update metadata timestamp', async () => {
      // Setup: initialize layer and save to create metadata
      initializeLayer('test-layer', 20, 10);
      await weightManager.saveWeights('test-layer');
      const metadataBefore = weightManager.getMetadata('test-layer');
      const timestampBefore = metadataBefore?.timestamp;

      // Wait a tiny bit to ensure timestamp difference
      await new Promise(r => setTimeout(r, 10));

      // Set new weights
      const newWeights = createWeights(10, 20, 0.5);
      weightManager.setWeights('test-layer', newWeights);

      // Verify: timestamp updated
      const metadataAfter = weightManager.getMetadata('test-layer');
      expect(metadataAfter?.timestamp).toBeDefined();
      expect(metadataAfter?.timestamp).not.toBe(timestampBefore);
    });
  });

  // =====================================================================
  // TASK-WM-004: updateWeights() Test Suite - 8 Tests
  // =====================================================================
  describe('updateWeights', () => {
    it('should add delta element-wise', () => {
      // Setup: initialize layer with known values
      initializeLayer('test-layer', 3, 2);
      const initialWeights: Float32Array[] = [
        new Float32Array([1, 2, 3]),
        new Float32Array([4, 5, 6])
      ];
      weightManager.setWeights('test-layer', initialWeights);

      // Create delta
      const delta: Float32Array[] = [
        new Float32Array([0.1, 0.2, 0.3]),
        new Float32Array([0.4, 0.5, 0.6])
      ];

      // Action: update weights with delta (scale=1.0)
      weightManager.updateWeights('test-layer', delta);

      // Verify: weights updated correctly
      const updatedWeights = weightManager.getWeights('test-layer');
      expect(updatedWeights[0][0]).toBeCloseTo(1.1, 5);
      expect(updatedWeights[0][1]).toBeCloseTo(2.2, 5);
      expect(updatedWeights[0][2]).toBeCloseTo(3.3, 5);
      expect(updatedWeights[1][0]).toBeCloseTo(4.4, 5);
      expect(updatedWeights[1][1]).toBeCloseTo(5.5, 5);
      expect(updatedWeights[1][2]).toBeCloseTo(6.6, 5);
    });

    it('should apply scale factor', () => {
      // Setup: initialize layer with known values
      initializeLayer('test-layer', 3, 2);
      const initialWeights: Float32Array[] = [
        new Float32Array([1, 2, 3]),
        new Float32Array([4, 5, 6])
      ];
      weightManager.setWeights('test-layer', initialWeights);

      // Create delta with scale factor of 0.5
      const delta: Float32Array[] = [
        new Float32Array([1, 1, 1]),
        new Float32Array([1, 1, 1])
      ];

      // Action: update weights with scale=0.5 (adds 0.5 to each)
      weightManager.updateWeights('test-layer', delta, 0.5);

      // Verify: weights = original + (scale * delta)
      const updatedWeights = weightManager.getWeights('test-layer');
      expect(updatedWeights[0][0]).toBeCloseTo(1.5, 5);
      expect(updatedWeights[0][1]).toBeCloseTo(2.5, 5);
      expect(updatedWeights[0][2]).toBeCloseTo(3.5, 5);
      expect(updatedWeights[1][0]).toBeCloseTo(4.5, 5);
      expect(updatedWeights[1][1]).toBeCloseTo(5.5, 5);
      expect(updatedWeights[1][2]).toBeCloseTo(6.5, 5);
    });

    it('should throw if layer has no weights', () => {
      // Don't initialize any layer - just create delta
      const delta: Float32Array[] = [
        new Float32Array([0.1, 0.2, 0.3])
      ];

      // Action & Verify: should throw for non-existent layer
      expect(() => weightManager.updateWeights('unknown-layer', delta))
        .toThrow('has no weights');
    });

    it('should throw on dimension mismatch', () => {
      // Setup: initialize layer with 10x20 dimensions
      initializeLayer('test-layer', 20, 10);

      // Create delta with wrong dimensions (5x20 instead of 10x20)
      const wrongDelta = createWeights(5, 20);

      // Action & Verify: should throw for dimension mismatch
      // Use flexible matching pattern for mismatch error messages
      expect(() => weightManager.updateWeights('test-layer', wrongDelta))
        .toThrow(/[Rr]ow count mismatch|dimension mismatch/i);
    });

    it('should rollback on NaN result', () => {
      // Setup: initialize layer with known values
      initializeLayer('test-layer', 3, 2);
      const initialWeights: Float32Array[] = [
        new Float32Array([1, 2, 3]),
        new Float32Array([4, 5, 6])
      ];
      weightManager.setWeights('test-layer', initialWeights);

      // Create delta with NaN
      const nanDelta: Float32Array[] = [
        new Float32Array([NaN, 0, 0]),
        new Float32Array([0, 0, 0])
      ];

      // Action & Verify: should throw and rollback
      expect(() => weightManager.updateWeights('test-layer', nanDelta))
        .toThrow('Rolled back');

      // Verify: original weights preserved
      const weights = weightManager.getWeights('test-layer');
      expect(weights[0][0]).toBeCloseTo(1, 5);
      expect(weights[0][1]).toBeCloseTo(2, 5);
      expect(weights[0][2]).toBeCloseTo(3, 5);
    });

    it('should rollback on Inf result', () => {
      // Setup: initialize layer with normal values
      initializeLayer('test-layer', 3, 2);
      const initialWeights: Float32Array[] = [
        new Float32Array([1, 2, 3]),
        new Float32Array([4, 5, 6])
      ];
      weightManager.setWeights('test-layer', initialWeights);

      // Create delta with Infinity directly (simulates gradient explosion)
      const infDelta: Float32Array[] = [
        new Float32Array([Infinity, 0, 0]),
        new Float32Array([0, 0, 0])
      ];

      // Action & Verify: should throw and rollback
      expect(() => weightManager.updateWeights('test-layer', infDelta))
        .toThrow('Rolled back');

      // Verify: original weights preserved
      const weights = weightManager.getWeights('test-layer');
      expect(weights[0][0]).toBeCloseTo(1, 5);
      expect(weights[0][1]).toBeCloseTo(2, 5);
    });

    it('should preserve original weights on failure', () => {
      // Setup: initialize layer
      initializeLayer('test-layer', 5, 3);
      const originalWeights = createWeights(3, 5, 0.25);
      weightManager.setWeights('test-layer', originalWeights);

      // Deep copy original for comparison
      const originalCopy = originalWeights.map(row => new Float32Array(row));

      // Try to apply invalid delta
      const badDelta: Float32Array[] = [
        new Float32Array([Infinity, 0, 0, 0, 0]),
        new Float32Array([0, 0, 0, 0, 0]),
        new Float32Array([0, 0, 0, 0, 0])
      ];

      // Action: attempt update
      expect(() => weightManager.updateWeights('test-layer', badDelta)).toThrow();

      // Verify: all original weights preserved
      const currentWeights = weightManager.getWeights('test-layer');
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 5; c++) {
          expect(currentWeights[r][c]).toBeCloseTo(originalCopy[r][c], 6);
        }
      }
    });

    it('should increment updateCount on success', () => {
      // Setup: initialize layer
      initializeLayer('test-layer', 3, 2);
      const initialWeights: Float32Array[] = [
        new Float32Array([1, 2, 3]),
        new Float32Array([4, 5, 6])
      ];
      weightManager.setWeights('test-layer', initialWeights);
      const countBefore = weightManager.getUpdateCount();

      // Valid delta
      const delta: Float32Array[] = [
        new Float32Array([0.1, 0.1, 0.1]),
        new Float32Array([0.1, 0.1, 0.1])
      ];

      // Action: update weights
      weightManager.updateWeights('test-layer', delta);

      // Verify: count incremented
      expect(weightManager.getUpdateCount()).toBe(countBefore + 1);
    });

    it('should update metadata timestamp when metadata exists', async () => {
      // Setup: initialize layer and save to create metadata
      initializeLayer('test-layer', 3, 2);
      const initialWeights: Float32Array[] = [
        new Float32Array([1, 2, 3]),
        new Float32Array([4, 5, 6])
      ];
      weightManager.setWeights('test-layer', initialWeights);
      await weightManager.saveWeights('test-layer');

      // Get existing metadata
      const metadataBefore = weightManager.getMetadata('test-layer');
      const timestampBefore = metadataBefore?.timestamp;

      // Wait a tiny bit
      await new Promise(r => setTimeout(r, 10));

      // Apply delta
      const delta: Float32Array[] = [
        new Float32Array([0.1, 0.1, 0.1]),
        new Float32Array([0.1, 0.1, 0.1])
      ];
      weightManager.updateWeights('test-layer', delta);

      // Verify: timestamp updated
      const metadataAfter = weightManager.getMetadata('test-layer');
      expect(metadataAfter?.timestamp).toBeDefined();
      expect(metadataAfter?.timestamp).not.toBe(timestampBefore);
    });
  });

  // =====================================================================
  // Additional Edge Cases for Comprehensive Coverage
  // =====================================================================
  describe('Edge Cases', () => {
    it('setWeights should handle negative infinity', () => {
      initializeLayer('test-layer', 3, 2);
      const infWeights: Float32Array[] = [
        new Float32Array([1, 2, -Infinity]),
        new Float32Array([4, 5, 6])
      ];

      expect(() => weightManager.setWeights('test-layer', infWeights))
        .toThrow('Validation failed');
    });

    it('updateWeights should handle column count mismatch', () => {
      initializeLayer('test-layer', 10, 5);

      // Delta with wrong column count
      const wrongColDelta = createWeights(5, 15); // 15 cols instead of 10

      expect(() => weightManager.updateWeights('test-layer', wrongColDelta))
        .toThrow('Column count mismatch');
    });

    it('setWeights should handle empty row', () => {
      initializeLayer('test-layer', 0, 0);

      // Empty weights to match empty config - this will still fail dimension check
      const emptyWeights: Float32Array[] = [];

      // This should throw because dimensions don't match (0 rows expected, 0 given)
      // but validation catches empty array first
      expect(() => weightManager.setWeights('test-layer', emptyWeights))
        .toThrow();
    });

    it('updateWeights with negative scale should work correctly', () => {
      // Setup with known values
      initializeLayer('test-layer', 3, 2);
      const initialWeights: Float32Array[] = [
        new Float32Array([1, 2, 3]),
        new Float32Array([4, 5, 6])
      ];
      weightManager.setWeights('test-layer', initialWeights);

      // Delta with negative scale (gradient descent: w = w - lr * gradient)
      const gradient: Float32Array[] = [
        new Float32Array([0.1, 0.1, 0.1]),
        new Float32Array([0.1, 0.1, 0.1])
      ];

      // Apply with negative scale (simulating gradient descent)
      weightManager.updateWeights('test-layer', gradient, -0.1);

      const updated = weightManager.getWeights('test-layer');
      expect(updated[0][0]).toBeCloseTo(0.99, 5); // 1 - 0.1 * 0.1 = 0.99
      expect(updated[0][1]).toBeCloseTo(1.99, 5); // 2 - 0.1 * 0.1 = 1.99
    });

    it('should handle multiple sequential setWeights calls', () => {
      initializeLayer('test-layer', 5, 3);

      // First set
      const weights1 = createWeights(3, 5, 0.1);
      weightManager.setWeights('test-layer', weights1);

      // Second set
      const weights2 = createWeights(3, 5, 0.9);
      weightManager.setWeights('test-layer', weights2);

      // Verify second weights are stored
      const stored = weightManager.getWeights('test-layer');
      expect(stored[0][0]).toBeCloseTo(0.9, 5);
    });

    it('should handle multiple sequential updateWeights calls', () => {
      initializeLayer('test-layer', 3, 2);
      const initialWeights: Float32Array[] = [
        new Float32Array([1, 1, 1]),
        new Float32Array([1, 1, 1])
      ];
      weightManager.setWeights('test-layer', initialWeights);

      // Multiple updates
      const delta: Float32Array[] = [
        new Float32Array([0.1, 0.1, 0.1]),
        new Float32Array([0.1, 0.1, 0.1])
      ];

      weightManager.updateWeights('test-layer', delta);
      weightManager.updateWeights('test-layer', delta);
      weightManager.updateWeights('test-layer', delta);

      const final = weightManager.getWeights('test-layer');
      expect(final[0][0]).toBeCloseTo(1.3, 5); // 1 + 0.1*3 = 1.3
    });
  });
});
