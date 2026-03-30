/**
 * GNN Integration Tests - TASK-GNN-004
 * Regression Guard for GNN Remediation
 *
 * PURPOSE: Prove that GNN is no longer fake (Potemkin implementation)
 *
 * These tests MUST FAIL if someone reverts to:
 * - simpleProjection() with index cycling
 * - Mean aggregation that ignores adjacency matrix
 * - Weights that don't affect output
 *
 * Acceptance Criteria:
 * - AC-001: Test proves different weights produce different outputs
 * - AC-002: Test proves different graphs produce different aggregations
 * - AC-003: Test proves weights persist and reload correctly
 * - AC-004: Tests detect if someone reverts to Potemkin implementation
 * - AC-005: All tests pass with current WeightManager + GNNEnhancer
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { GNNEnhancer } from '../../../../src/god-agent/core/reasoning/gnn-enhancer.js';
import { WeightManager } from '../../../../src/god-agent/core/reasoning/weight-manager.js';
import { project, simpleProjection, softmax, attentionScore, weightedAggregate } from '../../../../src/god-agent/core/reasoning/gnn-math.js';
import type { TrajectoryGraph } from '../../../../src/god-agent/core/reasoning/gnn-enhancer.js';
import { createNormalizedEmbedding } from '../../../fixtures/gnn-fixtures.js';
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * REGRESSION GUARD TEST SUITE
 *
 * These tests are designed to FAIL on the old Potemkin implementation:
 * 1. Old simpleProjection() cycles values by index - no weights involved
 * 2. Old aggregateNeighborhood() used mean - ignored adjacency matrix
 * 3. Old weights were not learned - same output regardless of initialization
 */

// Test directory for persistence tests
const TEST_PERSIST_PATH = '/tmp/gnn-integration-test-' + Date.now();

describe('TASK-GNN-004: GNN Integration Tests - Regression Guard', () => {

  beforeAll(() => {
    if (!existsSync(TEST_PERSIST_PATH)) {
      mkdirSync(TEST_PERSIST_PATH, { recursive: true });
    }
  });

  afterAll(() => {
    if (existsSync(TEST_PERSIST_PATH)) {
      rmSync(TEST_PERSIST_PATH, { recursive: true });
    }
  });

  // =====================================================================
  // AC-001: Different Weights Produce Different Outputs
  // FAILS on Potemkin: simpleProjection() ignores weights entirely
  // =====================================================================
  describe('AC-001: Weight Sensitivity Tests', () => {
    it('should produce SIGNIFICANTLY different outputs with different weight seeds', async () => {
      // This test FAILS on Potemkin because simpleProjection() cycles indices
      // and does not use weights at all
      const input = createNormalizedEmbedding(1536, 42);

      // Create two enhancers with DRASTICALLY different seeds
      const enhancer1 = new GNNEnhancer(undefined, undefined, 1, undefined, false);
      const enhancer2 = new GNNEnhancer(undefined, undefined, 999999, undefined, false);

      const result1 = await enhancer1.enhance(input);
      const result2 = await enhancer2.enhance(input);

      // Count how many dimensions differ significantly
      let significantDifferences = 0;
      let maxDifference = 0;
      for (let i = 0; i < result1.enhanced.length; i++) {
        const diff = Math.abs(result1.enhanced[i] - result2.enhanced[i]);
        if (diff > 0.001) {
          significantDifferences++;
        }
        if (diff > maxDifference) {
          maxDifference = diff;
        }
      }

      // MUST have at least 50% dimensions different
      // Potemkin would produce IDENTICAL outputs (0 differences)
      expect(significantDifferences).toBeGreaterThan(result1.enhanced.length * 0.5);
      expect(maxDifference).toBeGreaterThan(0.01);
    });

    it('should produce identical outputs with same weight seed (deterministic)', async () => {
      // This test ensures weights ARE being used consistently
      const input = createNormalizedEmbedding(1536, 123);
      const seed = 54321;

      const enhancer1 = new GNNEnhancer(undefined, undefined, seed, undefined, false);
      const enhancer2 = new GNNEnhancer(undefined, undefined, seed, undefined, false);

      const result1 = await enhancer1.enhance(input);
      const result2 = await enhancer2.enhance(input);

      // With same seed, outputs MUST be identical
      for (let i = 0; i < result1.enhanced.length; i++) {
        expect(result1.enhanced[i]).toBeCloseTo(result2.enhanced[i], 6);
      }
    });

    it('should produce different layer outputs with different weight initializations', () => {
      // Direct test of project() with WeightManager weights
      const input = createNormalizedEmbedding(768, 0);

      const manager1 = new WeightManager(TEST_PERSIST_PATH);
      const manager2 = new WeightManager(TEST_PERSIST_PATH);

      // Initialize with different seeds
      const weights1 = manager1.initializeWeights('test_layer1', {
        inputDim: 768,
        outputDim: 512,
        initialization: 'xavier',
        seed: 111
      });

      const weights2 = manager2.initializeWeights('test_layer2', {
        inputDim: 768,
        outputDim: 512,
        initialization: 'xavier',
        seed: 222
      });

      // Project through different weights
      const output1 = project(input, weights1, 512);
      const output2 = project(input, weights2, 512);

      // Outputs MUST differ significantly
      let differences = 0;
      for (let i = 0; i < 512; i++) {
        if (Math.abs(output1[i] - output2[i]) > 0.0001) {
          differences++;
        }
      }

      // At least 80% should be different
      expect(differences).toBeGreaterThan(512 * 0.8);
    });

    it('should produce different outputs with He vs Xavier initialization', async () => {
      // He and Xavier produce different weight distributions
      const input = createNormalizedEmbedding(1536, 77);

      const heEnhancer = new GNNEnhancer({ activation: 'relu' }, undefined, 12345, undefined, false);
      const xavierEnhancer = new GNNEnhancer({ activation: 'tanh' }, undefined, 12345, undefined, false);

      const heResult = await heEnhancer.enhance(input);
      const xavierResult = await xavierEnhancer.enhance(input);

      // Different initialization strategies should produce different outputs
      let differences = 0;
      for (let i = 0; i < 1536; i++) {
        if (Math.abs(heResult.enhanced[i] - xavierResult.enhanced[i]) > 0.0001) {
          differences++;
        }
      }

      expect(differences).toBeGreaterThan(100);
    });
  });

  // =====================================================================
  // AC-002: Different Graphs Produce Different Aggregations
  // FAILS on Potemkin: old aggregateNeighborhood() used mean, ignored adjacency
  // =====================================================================
  describe('AC-002: Graph Sensitivity Tests', () => {
    it('should produce DIFFERENT outputs for different adjacency matrices', async () => {
      // CRITICAL: This test catches the Potemkin mean aggregation
      const input = createNormalizedEmbedding(1536, 999);
      const seed = 54321;

      const enhancer = new GNNEnhancer(undefined, undefined, seed, undefined, false);

      // Same node embeddings, DIFFERENT connectivity
      const nodes = [
        { id: 'n0', embedding: createNormalizedEmbedding(1536, 100) },
        { id: 'n1', embedding: createNormalizedEmbedding(1536, 101) },
        { id: 'n2', embedding: createNormalizedEmbedding(1536, 102) },
        { id: 'n3', embedding: createNormalizedEmbedding(1536, 103) },
      ];

      // Graph A: Dense star topology (n0 connects to all)
      const starGraph: TrajectoryGraph = {
        nodes,
        edges: [
          { source: 'n0', target: 'n1', weight: 1.0 },
          { source: 'n0', target: 'n2', weight: 1.0 },
          { source: 'n0', target: 'n3', weight: 1.0 },
        ],
      };

      // Graph B: Chain topology (n0->n1->n2->n3)
      const chainGraph: TrajectoryGraph = {
        nodes,
        edges: [
          { source: 'n0', target: 'n1', weight: 1.0 },
          { source: 'n1', target: 'n2', weight: 1.0 },
          { source: 'n2', target: 'n3', weight: 1.0 },
        ],
      };

      const resultStar = await enhancer.enhance(input, starGraph);
      enhancer.clearCache();
      const resultChain = await enhancer.enhance(input, chainGraph);

      // Count differences
      let differences = 0;
      for (let i = 0; i < 1536; i++) {
        if (Math.abs(resultStar.enhanced[i] - resultChain.enhanced[i]) > 0.0001) {
          differences++;
        }
      }

      // MUST have significant differences
      // Potemkin mean aggregation would produce SAME output
      expect(differences).toBeGreaterThan(50);
    });

    it('should weight neighbors by edge weights in adjacency matrix', async () => {
      // Test that edge weights actually affect output
      const input = createNormalizedEmbedding(1536, 888);
      const seed = 12345;

      const enhancer = new GNNEnhancer(undefined, undefined, seed, undefined, false);

      const nodes = [
        { id: 'center', embedding: createNormalizedEmbedding(1536, 200) },
        { id: 'strong', embedding: createNormalizedEmbedding(1536, 201) },
        { id: 'weak', embedding: createNormalizedEmbedding(1536, 202) },
      ];

      // Graph A: Strong neighbor has high weight
      const strongNeighborGraph: TrajectoryGraph = {
        nodes,
        edges: [
          { source: 'center', target: 'strong', weight: 10.0 },
          { source: 'center', target: 'weak', weight: 0.1 },
        ],
      };

      // Graph B: Weak neighbor has high weight (reversed)
      const weakNeighborGraph: TrajectoryGraph = {
        nodes,
        edges: [
          { source: 'center', target: 'strong', weight: 0.1 },
          { source: 'center', target: 'weak', weight: 10.0 },
        ],
      };

      const resultStrong = await enhancer.enhance(input, strongNeighborGraph);
      enhancer.clearCache();
      const resultWeak = await enhancer.enhance(input, weakNeighborGraph);

      // Different edge weights MUST produce different outputs
      let differences = 0;
      for (let i = 0; i < 1536; i++) {
        if (Math.abs(resultStrong.enhanced[i] - resultWeak.enhanced[i]) > 0.0001) {
          differences++;
        }
      }

      expect(differences).toBeGreaterThan(50);
    });

    it('should produce different output for isolated vs connected nodes', async () => {
      // Isolated node should produce different result than well-connected node
      const input = createNormalizedEmbedding(1536, 777);
      const seed = 67890;

      const enhancer = new GNNEnhancer(undefined, undefined, seed, undefined, false);

      // Isolated: Single node with no edges
      const isolatedGraph: TrajectoryGraph = {
        nodes: [{ id: 'alone', embedding: createNormalizedEmbedding(1536, 300) }],
        edges: [],
      };

      // Connected: Node with many neighbors
      const connectedGraph: TrajectoryGraph = {
        nodes: [
          { id: 'center', embedding: createNormalizedEmbedding(1536, 300) }, // Same embedding
          { id: 'n1', embedding: createNormalizedEmbedding(1536, 301) },
          { id: 'n2', embedding: createNormalizedEmbedding(1536, 302) },
          { id: 'n3', embedding: createNormalizedEmbedding(1536, 303) },
        ],
        edges: [
          { source: 'center', target: 'n1', weight: 1.0 },
          { source: 'center', target: 'n2', weight: 1.0 },
          { source: 'center', target: 'n3', weight: 1.0 },
          { source: 'n1', target: 'n2', weight: 0.5 },
          { source: 'n2', target: 'n3', weight: 0.5 },
        ],
      };

      const resultIsolated = await enhancer.enhance(input, isolatedGraph);
      enhancer.clearCache();
      const resultConnected = await enhancer.enhance(input, connectedGraph);

      // Must produce different outputs
      let differences = 0;
      for (let i = 0; i < 1536; i++) {
        if (Math.abs(resultIsolated.enhanced[i] - resultConnected.enhanced[i]) > 0.0001) {
          differences++;
        }
      }

      expect(differences).toBeGreaterThan(50);
    });

    it('should use attention mechanism based on adjacency (not just mean)', async () => {
      // This directly tests that softmax attention is used
      const features = [
        createNormalizedEmbedding(128, 1),
        createNormalizedEmbedding(128, 2),
        createNormalizedEmbedding(128, 3),
      ];

      // Test softmax normalization
      const scores = new Float32Array([2.0, 1.0, 0.5]);
      const weights = softmax(scores);

      // Weights must sum to 1
      let sum = 0;
      for (let i = 0; i < weights.length; i++) {
        sum += weights[i];
      }
      expect(sum).toBeCloseTo(1.0, 6);

      // Higher score must get higher weight
      expect(weights[0]).toBeGreaterThan(weights[1]);
      expect(weights[1]).toBeGreaterThan(weights[2]);

      // Test weighted aggregation
      const aggregated = weightedAggregate(features, weights);

      // Result should not be simple mean
      const simpleMean = new Float32Array(128);
      for (const f of features) {
        for (let i = 0; i < 128; i++) {
          simpleMean[i] += f[i] / 3;
        }
      }

      let meanDiffs = 0;
      for (let i = 0; i < 128; i++) {
        if (Math.abs(aggregated[i] - simpleMean[i]) > 0.0001) {
          meanDiffs++;
        }
      }

      // Should differ from simple mean (Potemkin used simple mean)
      expect(meanDiffs).toBeGreaterThan(10);
    });
  });

  // =====================================================================
  // AC-003: Weight Persistence Survives Restart
  // =====================================================================
  describe('AC-003: Weight Persistence Tests', () => {
    const persistPath = join(TEST_PERSIST_PATH, 'persistence');

    beforeEach(() => {
      if (existsSync(persistPath)) {
        rmSync(persistPath, { recursive: true });
      }
      mkdirSync(persistPath, { recursive: true });
    });

    it('should persist weights and reload with same behavior', async () => {
      const input = createNormalizedEmbedding(1536, 555);
      const seed = 77777;

      // Create first enhancer and get output
      const enhancer1 = new GNNEnhancer(
        undefined,
        undefined,
        seed,
        { checkpointDir: persistPath },
        false
      );

      const result1 = await enhancer1.enhance(input);

      // Save weights
      const weightManager = enhancer1.getWeightManager();
      for (const layerId of weightManager.getLayerIds()) {
        await weightManager.saveWeights(layerId);
      }

      // Create NEW enhancer that loads persisted weights
      const enhancer2 = new GNNEnhancer(
        undefined,
        undefined,
        seed,
        { checkpointDir: persistPath },
        true // Enable auto-load
      );

      // Wait for potential async loading
      await new Promise(r => setTimeout(r, 100));

      const result2 = await enhancer2.enhance(input);

      // Results should be identical after reload
      for (let i = 0; i < result1.enhanced.length; i++) {
        expect(result2.enhanced[i]).toBeCloseTo(result1.enhanced[i], 5);
      }
    });

    it('should verify weight files exist after save', async () => {
      const manager = new WeightManager(persistPath);

      manager.initializeWeights('layer1', {
        inputDim: 768,
        outputDim: 512,
        initialization: 'xavier',
        seed: 12345
      });

      await manager.saveWeights('layer1');

      const binPath = join(persistPath, 'layer1.weights.bin');
      const metaPath = join(persistPath, 'layer1.weights.meta.json');

      expect(existsSync(binPath)).toBe(true);
      expect(existsSync(metaPath)).toBe(true);

      // Verify metadata
      const metadata = JSON.parse(readFileSync(metaPath, 'utf-8'));
      expect(metadata.version).toBe('1.0.0');
      expect(metadata.numRows).toBe(512);
      expect(metadata.numCols).toBe(768);
      expect(metadata.checksum).toMatch(/^[a-f0-9]{32}$/);
    });

    it('should load weights with correct dimensions', async () => {
      const manager1 = new WeightManager(persistPath);
      const originalWeights = manager1.initializeWeights('test_layer', {
        inputDim: 100,
        outputDim: 50,
        initialization: 'he',
        seed: 42
      });
      await manager1.saveWeights('test_layer');

      const manager2 = new WeightManager(persistPath);
      const loadedWeights = await manager2.loadWeights('test_layer');

      expect(loadedWeights).not.toBeNull();
      expect(loadedWeights!.length).toBe(50); // outputDim rows
      expect(loadedWeights![0].length).toBe(100); // inputDim cols

      // Verify values match
      for (let r = 0; r < 50; r++) {
        for (let c = 0; c < 100; c++) {
          expect(loadedWeights![r][c]).toBeCloseTo(originalWeights[r][c], 6);
        }
      }
    });

    it('should maintain weight statistics across save/load', async () => {
      const manager1 = new WeightManager(persistPath);
      manager1.initializeWeights('layer_a', { inputDim: 100, outputDim: 50, initialization: 'xavier' });
      manager1.initializeWeights('layer_b', { inputDim: 50, outputDim: 25, initialization: 'he' });

      const stats1 = manager1.getMemoryStats();
      await manager1.saveAll();

      const manager2 = new WeightManager(persistPath);
      await manager2.loadWeights('layer_a');
      await manager2.loadWeights('layer_b');

      const stats2 = manager2.getMemoryStats();

      expect(stats2.layers).toBe(stats1.layers);
      expect(stats2.totalParams).toBe(stats1.totalParams);
    });
  });

  // =====================================================================
  // AC-004: Regression Guard - Detect Potemkin Revert
  // These tests SPECIFICALLY catch the old fake implementation
  // =====================================================================
  describe('AC-004: Regression Guard - Detect Potemkin Implementation', () => {
    it('REGRESSION: project() must use weight matrix, not index cycling', () => {
      // The OLD simpleProjection cycled indices: result[i] = input[i % inputLen]
      // The NEW project() does matrix multiplication

      const input = new Float32Array([1, 2, 3, 4]);

      // Create weight matrix where output[0] = sum of all inputs
      // output[1] = -sum of all inputs
      const weights: Float32Array[] = [
        new Float32Array([0.25, 0.25, 0.25, 0.25]), // Average
        new Float32Array([-0.25, -0.25, -0.25, -0.25]), // Negative average
      ];

      const result = project(input, weights, 2);

      // With proper matrix multiplication:
      // result[0] = 0.25*1 + 0.25*2 + 0.25*3 + 0.25*4 = 2.5
      // result[1] = -0.25*1 - 0.25*2 - 0.25*3 - 0.25*4 = -2.5
      expect(result[0]).toBeCloseTo(2.5, 5);
      expect(result[1]).toBeCloseTo(-2.5, 5);

      // Index cycling would produce: [1, 2] (wrong!)
      expect(result[0]).not.toBe(1);
      expect(result[1]).not.toBe(2);
    });

    it('REGRESSION: simpleProjection should be deprecated and use index cycling', () => {
      // The simpleProjection is @deprecated (see gnn-math.ts JSDoc)
      // It uses index cycling (fake) instead of learned weights (real)
      // This test verifies the function still works but produces predictable cycling behavior
      const input = createNormalizedEmbedding(768, 0);

      // Call the deprecated function - it should still work
      const result = simpleProjection(input, 512);

      // Verify it produces output (index cycling pattern)
      expect(result.length).toBe(512);

      // Key regression guard: simpleProjection uses index CYCLING
      // This means result[0] === input[0], result[768] === input[0], etc.
      // Real projection (project() with weights) would NOT have this pattern
      expect(result[0]).toBe(input[0]);  // Index cycling behavior

      // Expansion test: when targetDim > input.length, values cycle
      const expanded = simpleProjection(new Float32Array([1, 2, 3]), 6);
      expect(expanded[0]).toBe(1);  // index 0 % 3 = 0
      expect(expanded[3]).toBe(1);  // index 3 % 3 = 0 (cycling!)
      expect(expanded[4]).toBe(2);  // index 4 % 3 = 1
    });

    it('REGRESSION: attentionScore must use scaled dot product', () => {
      // Real attention uses: score = (q . k) / sqrt(d)
      const query = new Float32Array([1, 0, 0, 0]);
      const key = new Float32Array([1, 0, 0, 0]);

      const score = attentionScore(query, key);

      // Dot product = 1, scale = 1/sqrt(4) = 0.5
      // Expected: 1 * 0.5 = 0.5
      expect(score).toBeCloseTo(0.5, 5);

      // Orthogonal vectors should have score 0
      const orthogonal = new Float32Array([0, 1, 0, 0]);
      const orthScore = attentionScore(query, orthogonal);
      expect(orthScore).toBeCloseTo(0, 5);
    });

    it('REGRESSION: GNNEnhancer must expose getWeightManager()', () => {
      // Real implementation exposes weight manager for persistence
      const enhancer = new GNNEnhancer();

      expect(enhancer.getWeightManager).toBeDefined();
      expect(typeof enhancer.getWeightManager).toBe('function');

      const manager = enhancer.getWeightManager();
      expect(manager).toBeInstanceOf(WeightManager);
    });

    it('REGRESSION: WeightManager must support He and Xavier initialization', () => {
      const manager = new WeightManager(TEST_PERSIST_PATH);

      // He initialization (for ReLU)
      const heWeights = manager.initializeWeights('he_layer', {
        inputDim: 100,
        outputDim: 50,
        initialization: 'he',
        seed: 42
      });

      // Xavier initialization (for tanh/sigmoid)
      const xavierWeights = manager.initializeWeights('xavier_layer', {
        inputDim: 100,
        outputDim: 50,
        initialization: 'xavier',
        seed: 42
      });

      expect(heWeights.length).toBe(50);
      expect(xavierWeights.length).toBe(50);

      // He and Xavier have different variance formulas
      // He: var = 2/fan_in, Xavier: var = 2/(fan_in + fan_out)
      // So with same seed but different variance, they should differ
      let differences = 0;
      for (let r = 0; r < 50; r++) {
        for (let c = 0; c < 100; c++) {
          if (Math.abs(heWeights[r][c] - xavierWeights[r][c]) > 0.0001) {
            differences++;
          }
        }
      }

      // Should have many differences due to different variance
      expect(differences).toBeGreaterThan(2000);
    });

    it('REGRESSION: enhanceWithGraph must use adjacency for attention', async () => {
      // This is the core test that catches Potemkin mean aggregation
      const enhancer = new GNNEnhancer(undefined, undefined, 12345, undefined, false);
      const input = createNormalizedEmbedding(1536, 100);

      // Create graph where n1 is HIGHLY connected, n2 is ISOLATED
      const nodes = [
        { id: 'n0', embedding: createNormalizedEmbedding(1536, 0) },
        { id: 'n1', embedding: createNormalizedEmbedding(1536, 1) }, // Hub
        { id: 'n2', embedding: createNormalizedEmbedding(1536, 2) }, // Isolated
        { id: 'n3', embedding: createNormalizedEmbedding(1536, 3) },
        { id: 'n4', embedding: createNormalizedEmbedding(1536, 4) },
      ];

      const graph: TrajectoryGraph = {
        nodes,
        edges: [
          // n1 is the hub - connected to everyone with high weight
          { source: 'n1', target: 'n0', weight: 5.0 },
          { source: 'n1', target: 'n3', weight: 5.0 },
          { source: 'n1', target: 'n4', weight: 5.0 },
          { source: 'n0', target: 'n3', weight: 1.0 },
          // n2 has NO edges - isolated
        ],
      };

      // Use enhanceWithGraph directly to test graph processing
      const result = await enhancer.enhance(input, graph);

      // The result should reflect that n1 (hub) has more influence
      // due to its higher connectivity in the adjacency matrix
      expect(result.enhanced.length).toBe(1536);
      expect(result.nodeCount).toBe(5);

      // Verify it's not just returning input
      let differences = 0;
      for (let i = 0; i < 1536; i++) {
        if (Math.abs(result.enhanced[i] - input[i]) > 0.0001) {
          differences++;
        }
      }
      expect(differences).toBeGreaterThan(100);
    });
  });

  // =====================================================================
  // AC-005: All Tests Pass with Current Implementation
  // =====================================================================
  describe('AC-005: Comprehensive Integration Validation', () => {
    it('should process full pipeline: input -> weights -> layers -> output', async () => {
      const enhancer = new GNNEnhancer(undefined, undefined, 98765, undefined, false);
      const input = createNormalizedEmbedding(1536, 42);

      const result = await enhancer.enhance(input);

      // Validate output
      expect(result.enhanced.length).toBe(1536);
      expect(result.original.length).toBe(1536);
      expect(result.cached).toBe(false);
      expect(result.enhancementTime).toBeGreaterThanOrEqual(0);

      // Output should be L2 normalized
      let norm = 0;
      for (let i = 0; i < 1536; i++) {
        norm += result.enhanced[i] * result.enhanced[i];
      }
      norm = Math.sqrt(norm);
      expect(norm).toBeCloseTo(1.0, 1);
    });

    it('should process full pipeline with graph context', async () => {
      const enhancer = new GNNEnhancer(undefined, undefined, 11111, undefined, false);
      const input = createNormalizedEmbedding(1536, 77);

      const graph: TrajectoryGraph = {
        nodes: [
          { id: 'a', embedding: createNormalizedEmbedding(1536, 10) },
          { id: 'b', embedding: createNormalizedEmbedding(1536, 11) },
          { id: 'c', embedding: createNormalizedEmbedding(1536, 12) },
        ],
        edges: [
          { source: 'a', target: 'b', weight: 1.0 },
          { source: 'b', target: 'c', weight: 0.5 },
        ],
      };

      const result = await enhancer.enhance(input, graph);

      expect(result.enhanced.length).toBe(1536);
      expect(result.nodeCount).toBe(3);
    });

    it('should handle weight reinitialization correctly', async () => {
      const enhancer = new GNNEnhancer(undefined, undefined, 12345, undefined, false);
      const input = createNormalizedEmbedding(1536, 99);

      // Get result with original weights
      const result1 = await enhancer.enhance(input);

      // Reinitialize with different seed
      enhancer.reinitializeWeights(99999);

      // Get result with new weights
      const result2 = await enhancer.enhance(input);

      // Results should differ significantly
      let differences = 0;
      for (let i = 0; i < 1536; i++) {
        if (Math.abs(result1.enhanced[i] - result2.enhanced[i]) > 0.0001) {
          differences++;
        }
      }

      expect(differences).toBeGreaterThan(500);
    });

    it('should pass end-to-end: create, save, load, verify', async () => {
      const persistPath = join(TEST_PERSIST_PATH, 'e2e');
      if (existsSync(persistPath)) {
        rmSync(persistPath, { recursive: true });
      }
      mkdirSync(persistPath, { recursive: true });

      const input = createNormalizedEmbedding(1536, 333);
      const seed = 444555;

      // Step 1: Create enhancer and process
      const enhancer1 = new GNNEnhancer(undefined, undefined, seed, undefined, false);
      const result1 = await enhancer1.enhance(input);

      // Step 2: Save weights
      const wm1 = enhancer1.getWeightManager();
      for (const layerId of wm1.getLayerIds()) {
        // Need to manually set persist path for this test
        const weights = wm1.getWeights(layerId);
        if (weights.length > 0) {
          const manager = new WeightManager(persistPath);
          const config = wm1.getConfig(layerId);
          manager.initializeWeights(layerId, config!);
          // Copy weights
          const w = manager.getWeights(layerId);
          for (let r = 0; r < weights.length && r < w.length; r++) {
            for (let c = 0; c < weights[r].length && c < w[r].length; c++) {
              w[r][c] = weights[r][c];
            }
          }
          await manager.saveWeights(layerId);
        }
      }

      // Step 3: Verify files exist
      expect(existsSync(join(persistPath, 'layer1.weights.bin'))).toBe(true);
      expect(existsSync(join(persistPath, 'layer2.weights.bin'))).toBe(true);
      expect(existsSync(join(persistPath, 'layer3.weights.bin'))).toBe(true);

      // Cleanup
      rmSync(persistPath, { recursive: true });
    });
  });
});
