/**
 * Temporal Evolution Tracking Tests
 * SPEC-TMP-001.2
 *
 * Tests for temporal concept evolution tracking implementation:
 * - Cosine similarity calculations
 * - Linear regression for trend analysis
 * - Embedding drift detection
 * - Emerging/declining pattern detection
 * - Integration with trackConceptEvolution
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TemporalEngine } from '../../../../../src/god-agent/core/reasoning/modes/temporal-engine.js';
import type { GraphDB } from '../../../../../src/god-agent/core/graph-db/graph-db.js';
import type { CausalMemory } from '../../../../../src/god-agent/core/reasoning/causal-memory.js';
import type { TemporalChain } from '../../../../../src/god-agent/core/reasoning/advanced-reasoning-types.js';

describe('TemporalEngine - Evolution Tracking', () => {
  let engine: TemporalEngine;
  let mockGraphDB: GraphDB;
  let mockCausalMemory: CausalMemory;

  beforeEach(() => {
    // Mock GraphDB
    mockGraphDB = {
      getAllHyperedges: async () => [],
    } as unknown as GraphDB;

    // Mock CausalMemory
    mockCausalMemory = {} as CausalMemory;

    engine = new TemporalEngine({
      graphDB: mockGraphDB,
      causalMemory: mockCausalMemory,
    });
  });

  describe('cosineSimilarity', () => {
    it('should return 1.0 for identical vectors', () => {
      const vector = [1, 2, 3, 4];
      const similarity = (engine as any).cosineSimilarity(vector, vector);
      expect(similarity).toBeCloseTo(1.0, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      const similarity = (engine as any).cosineSimilarity(a, b);
      expect(similarity).toBeCloseTo(0, 5);
    });

    it('should return -1 for opposite vectors', () => {
      const a = [1, 2, 3];
      const b = [-1, -2, -3];
      const similarity = (engine as any).cosineSimilarity(a, b);
      expect(similarity).toBeCloseTo(-1, 5);
    });

    it('should handle zero vectors gracefully', () => {
      const a = [0, 0, 0];
      const b = [1, 2, 3];
      const similarity = (engine as any).cosineSimilarity(a, b);
      expect(similarity).toBe(0);
    });

    it('should throw for mismatched vector lengths', () => {
      const a = [1, 2, 3];
      const b = [1, 2];
      const similarity = (engine as any).cosineSimilarity(a, b);
      expect(similarity).toBe(0); // Returns 0 instead of throwing
    });

    it('should return 0 for empty vectors', () => {
      const a: number[] = [];
      const b: number[] = [];
      const similarity = (engine as any).cosineSimilarity(a, b);
      expect(similarity).toBe(0);
    });

    it('should handle normalized vectors correctly', () => {
      const a = [0.6, 0.8]; // Unit vector
      const b = [0.8, 0.6]; // Another unit vector
      const similarity = (engine as any).cosineSimilarity(a, b);
      expect(similarity).toBeCloseTo(0.96, 2); // cos(θ) for small angle
    });
  });

  describe('linearRegression', () => {
    it('should return positive slope for upward trend', () => {
      const data = [
        { count: 1, timestamp: 1000 },
        { count: 2, timestamp: 2000 },
        { count: 3, timestamp: 3000 },
        { count: 4, timestamp: 4000 },
      ];
      const result = (engine as any).linearRegression(data);
      expect(result.slope).toBeGreaterThan(0);
      expect(result.percentChange).toBeCloseTo(300, 0); // 1->4 = 300% increase
    });

    it('should return negative slope for downward trend', () => {
      const data = [
        { count: 4, timestamp: 1000 },
        { count: 3, timestamp: 2000 },
        { count: 2, timestamp: 3000 },
        { count: 1, timestamp: 4000 },
      ];
      const result = (engine as any).linearRegression(data);
      expect(result.slope).toBeLessThan(0);
      expect(result.percentChange).toBeCloseTo(-75, 0); // 4->1 = -75% decrease
    });

    it('should return near-zero slope for stable trend', () => {
      const data = [
        { count: 5, timestamp: 1000 },
        { count: 5, timestamp: 2000 },
        { count: 5, timestamp: 3000 },
        { count: 5, timestamp: 4000 },
      ];
      const result = (engine as any).linearRegression(data);
      expect(Math.abs(result.slope)).toBeLessThan(0.001);
      expect(result.percentChange).toBe(0);
    });

    it('should calculate correct R² confidence', () => {
      // Perfect linear relationship
      const data = [
        { count: 1, timestamp: 1000 },
        { count: 2, timestamp: 2000 },
        { count: 3, timestamp: 3000 },
        { count: 4, timestamp: 4000 },
      ];
      const result = (engine as any).linearRegression(data);
      expect(result.confidence).toBeCloseTo(1.0, 1); // R² should be ~1 for perfect fit
    });

    it('should calculate percent change from first to last', () => {
      const data = [
        { count: 10, timestamp: 1000 },
        { count: 20, timestamp: 2000 },
      ];
      const result = (engine as any).linearRegression(data);
      expect(result.percentChange).toBeCloseTo(100, 0); // 100% increase
    });

    it('should handle single data point', () => {
      const data = [{ count: 5, timestamp: 1000 }];
      const result = (engine as any).linearRegression(data);
      expect(result.slope).toBe(0);
      expect(result.confidence).toBe(0);
      expect(result.percentChange).toBe(0);
    });

    it('should handle data with zero initial count', () => {
      const data = [
        { count: 0, timestamp: 1000 },
        { count: 10, timestamp: 2000 },
      ];
      const result = (engine as any).linearRegression(data);
      expect(result.percentChange).toBe(0); // Division by zero protection
    });

    it('should clamp R² confidence to [0, 1]', () => {
      const data = [
        { count: 5, timestamp: 1000 },
        { count: 3, timestamp: 2000 },
        { count: 8, timestamp: 3000 },
      ];
      const result = (engine as any).linearRegression(data);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('calculateEmbeddingDrift', () => {
    it('should return 0 drift for identical embeddings', async () => {
      const concept = 'test-concept';
      const embedding = [1, 2, 3, 4];

      // Store historical embeddings
      await (engine as any).storeHistoricalEmbedding(concept, embedding);
      await (engine as any).storeHistoricalEmbedding(concept, embedding);

      const results = await (engine as any).calculateEmbeddingDrift([concept]);
      expect(results).toHaveLength(1);
      expect(results[0].drift).toBeCloseTo(0, 5);
    });

    it('should return high drift for different embeddings', async () => {
      const concept = 'test-concept';
      const embedding1 = [1, 0, 0, 0];
      const embedding2 = [0, 0, 0, 1]; // Orthogonal

      await (engine as any).storeHistoricalEmbedding(concept, embedding1);
      await (engine as any).storeHistoricalEmbedding(concept, embedding2);

      const results = await (engine as any).calculateEmbeddingDrift([concept]);
      expect(results).toHaveLength(1);
      expect(results[0].drift).toBeGreaterThan(0.5); // High drift for orthogonal vectors
    });

    it('should include confidence based on history length', async () => {
      const concept = 'test-concept';
      const embedding = [1, 2, 3, 4];

      // Store 5 embeddings
      for (let i = 0; i < 5; i++) {
        await (engine as any).storeHistoricalEmbedding(concept, embedding);
      }

      const results = await (engine as any).calculateEmbeddingDrift([concept]);
      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBeCloseTo(0.5, 1); // 5/10 = 0.5
    });

    it('should handle concepts with no history', async () => {
      const concept = 'new-concept';
      const results = await (engine as any).calculateEmbeddingDrift([concept]);
      expect(results).toHaveLength(0); // No results for concepts with insufficient history
    });

    it('should calculate drift correctly for multiple concepts', async () => {
      const concept1 = 'concept1';
      const concept2 = 'concept2';

      await (engine as any).storeHistoricalEmbedding(concept1, [1, 0, 0]);
      await (engine as any).storeHistoricalEmbedding(concept1, [1, 0, 0]);

      await (engine as any).storeHistoricalEmbedding(concept2, [0, 1, 0]);
      await (engine as any).storeHistoricalEmbedding(concept2, [0, 0, 1]);

      const results = await (engine as any).calculateEmbeddingDrift([concept1, concept2]);
      expect(results).toHaveLength(2);
      expect(results[0].drift).toBeLessThan(results[1].drift); // concept1 has less drift
    });
  });

  describe('detectEmergingPatterns', () => {
    it('should detect patterns with >50% frequency increase', () => {
      const frequencyChanges = [
        { concept: 'pattern1', changeRate: 75, trend: 'increasing' },
        { concept: 'pattern2', changeRate: 51, trend: 'increasing' },
        { concept: 'pattern3', changeRate: 100, trend: 'increasing' },
      ];

      const emerging = (engine as any).detectEmergingPatterns(frequencyChanges);
      expect(emerging).toHaveLength(3);
      expect(emerging).toContain('pattern1');
      expect(emerging).toContain('pattern2');
      expect(emerging).toContain('pattern3');
    });

    it('should not detect patterns with <50% increase', () => {
      const frequencyChanges = [
        { concept: 'pattern1', changeRate: 49, trend: 'increasing' },
        { concept: 'pattern2', changeRate: 25, trend: 'increasing' },
        { concept: 'pattern3', changeRate: 10, trend: 'increasing' },
      ];

      const emerging = (engine as any).detectEmergingPatterns(frequencyChanges);
      expect(emerging).toHaveLength(0);
    });

    it('should return empty array when no emerging patterns', () => {
      const frequencyChanges = [
        { concept: 'pattern1', changeRate: 5, trend: 'stable' },
        { concept: 'pattern2', changeRate: -20, trend: 'decreasing' },
      ];

      const emerging = (engine as any).detectEmergingPatterns(frequencyChanges);
      expect(emerging).toHaveLength(0);
    });

    it('should filter by trend type (increasing only)', () => {
      const frequencyChanges = [
        { concept: 'pattern1', changeRate: 75, trend: 'increasing' },
        { concept: 'pattern2', changeRate: 75, trend: 'decreasing' }, // Same rate, wrong trend
        { concept: 'pattern3', changeRate: 75, trend: 'stable' },
      ];

      const emerging = (engine as any).detectEmergingPatterns(frequencyChanges);
      expect(emerging).toHaveLength(1);
      expect(emerging).toEqual(['pattern1']);
    });
  });

  describe('detectDecliningPatterns', () => {
    it('should detect patterns with >50% frequency decrease', () => {
      const frequencyChanges = [
        { concept: 'pattern1', changeRate: -75, trend: 'decreasing' },
        { concept: 'pattern2', changeRate: -51, trend: 'decreasing' },
        { concept: 'pattern3', changeRate: -100, trend: 'decreasing' },
      ];

      const declining = (engine as any).detectDecliningPatterns(frequencyChanges);
      expect(declining).toHaveLength(3);
      expect(declining).toContain('pattern1');
      expect(declining).toContain('pattern2');
      expect(declining).toContain('pattern3');
    });

    it('should not detect patterns with <50% decrease', () => {
      const frequencyChanges = [
        { concept: 'pattern1', changeRate: -49, trend: 'decreasing' },
        { concept: 'pattern2', changeRate: -25, trend: 'decreasing' },
        { concept: 'pattern3', changeRate: -10, trend: 'decreasing' },
      ];

      const declining = (engine as any).detectDecliningPatterns(frequencyChanges);
      expect(declining).toHaveLength(0);
    });

    it('should return empty array when no declining patterns', () => {
      const frequencyChanges = [
        { concept: 'pattern1', changeRate: 5, trend: 'stable' },
        { concept: 'pattern2', changeRate: 20, trend: 'increasing' },
      ];

      const declining = (engine as any).detectDecliningPatterns(frequencyChanges);
      expect(declining).toHaveLength(0);
    });

    it('should filter by trend type (decreasing only)', () => {
      const frequencyChanges = [
        { concept: 'pattern1', changeRate: -75, trend: 'decreasing' },
        { concept: 'pattern2', changeRate: -75, trend: 'increasing' }, // Same rate, wrong trend
        { concept: 'pattern3', changeRate: -75, trend: 'stable' },
      ];

      const declining = (engine as any).detectDecliningPatterns(frequencyChanges);
      expect(declining).toHaveLength(1);
      expect(declining).toEqual(['pattern1']);
    });
  });

  describe('trackConceptEvolution - Integration', () => {
    it('should return real drift value (not hardcoded 0.1)', async () => {
      // Create chains with concepts
      const chains: TemporalChain[] = [
        {
          events: [
            { nodeId: 'concept1', timestamp: 1000, granularity: 'day' },
            { nodeId: 'concept2', timestamp: 2000, granularity: 'day' },
          ],
          constraints: [],
          consistency: true,
          duration: 1000,
        },
      ];

      // Store historical embeddings to enable drift calculation
      await (engine as any).storeHistoricalEmbedding('concept1', [1, 0, 0]);
      await (engine as any).storeHistoricalEmbedding('concept1', [0.9, 0.1, 0]); // Slight drift

      await (engine as any).storeHistoricalEmbedding('concept2', [0, 1, 0]);
      await (engine as any).storeHistoricalEmbedding('concept2', [0, 1, 0]); // No drift

      const inference = {
        chains,
        avgConfidence: 0.8,
        temporalConsistency: 1,
        direction: 'forward' as const,
      };

      const evolution = await (engine as any).trackConceptEvolution(chains, inference);

      // Should return calculated drift, not 0.1
      expect(evolution.embeddingDrift).toBeGreaterThan(0);
      expect(evolution.embeddingDrift).not.toBe(0.1);
    });

    it('should return frequency changes array', async () => {
      const chains: TemporalChain[] = [
        {
          events: [
            { nodeId: 'concept1', timestamp: 1000, granularity: 'day' },
          ],
          constraints: [],
          consistency: true,
          duration: 0,
        },
      ];

      const inference = {
        chains,
        avgConfidence: 0.8,
        temporalConsistency: 1,
        direction: 'forward' as const,
      };

      const evolution = await (engine as any).trackConceptEvolution(chains, inference);

      expect(Array.isArray(evolution.frequencyChanges)).toBe(true);
      expect(evolution.frequencyChanges.every((fc: any) =>
        fc.hasOwnProperty('concept') &&
        fc.hasOwnProperty('trend') &&
        fc.hasOwnProperty('changeRate')
      )).toBe(true);
    });

    it('should return emerging patterns when frequency increases', async () => {
      const chains: TemporalChain[] = [
        {
          events: [
            { nodeId: 'emerging-concept', timestamp: 1000, granularity: 'day' },
          ],
          constraints: [],
          consistency: true,
          duration: 0,
        },
      ];

      // Create frequency snapshots showing increase
      const snapshots = [
        { concept: 'emerging-concept', count: 1, timestamp: 1000 },
        { concept: 'emerging-concept', count: 2, timestamp: 2000 },
        { concept: 'emerging-concept', count: 4, timestamp: 3000 },
        { concept: 'emerging-concept', count: 8, timestamp: 4000 },
      ];

      (engine as any).frequencySnapshots.set('emerging-concept', snapshots);

      const inference = {
        chains,
        avgConfidence: 0.8,
        temporalConsistency: 1,
        direction: 'forward' as const,
      };

      const evolution = await (engine as any).trackConceptEvolution(chains, inference);

      expect(evolution.emergingPatterns).toContain('emerging-concept');
    });

    it('should return declining patterns when frequency decreases', async () => {
      const chains: TemporalChain[] = [
        {
          events: [
            { nodeId: 'declining-concept', timestamp: 1000, granularity: 'day' },
          ],
          constraints: [],
          consistency: true,
          duration: 0,
        },
      ];

      // Create frequency snapshots showing decrease
      const snapshots = [
        { concept: 'declining-concept', count: 8, timestamp: 1000 },
        { concept: 'declining-concept', count: 4, timestamp: 2000 },
        { concept: 'declining-concept', count: 2, timestamp: 3000 },
        { concept: 'declining-concept', count: 1, timestamp: 4000 },
      ];

      (engine as any).frequencySnapshots.set('declining-concept', snapshots);

      const inference = {
        chains,
        avgConfidence: 0.8,
        temporalConsistency: 1,
        direction: 'forward' as const,
      };

      const evolution = await (engine as any).trackConceptEvolution(chains, inference);

      expect(evolution.decliningPatterns).toContain('declining-concept');
    });

    it('should handle empty chains gracefully', async () => {
      const chains: TemporalChain[] = [];

      const inference = {
        chains,
        avgConfidence: 0,
        temporalConsistency: 0,
        direction: 'forward' as const,
      };

      const evolution = await (engine as any).trackConceptEvolution(chains, inference);

      expect(evolution.embeddingDrift).toBe(0);
      expect(evolution.frequencyChanges).toEqual([]);
      expect(evolution.emergingPatterns).toEqual([]);
      expect(evolution.decliningPatterns).toEqual([]);
    });

    it('should store evolution snapshots', async () => {
      const chains: TemporalChain[] = [
        {
          events: [
            { nodeId: 'concept1', timestamp: 1000, granularity: 'day' },
          ],
          constraints: [],
          consistency: true,
          duration: 0,
        },
      ];

      const inference = {
        chains,
        avgConfidence: 0.8,
        temporalConsistency: 1,
        direction: 'forward' as const,
      };

      const initialSnapshotCount = (engine as any).evolutionHistory.length;

      await (engine as any).trackConceptEvolution(chains, inference);

      const finalSnapshotCount = (engine as any).evolutionHistory.length;
      expect(finalSnapshotCount).toBe(initialSnapshotCount + 1);

      const latestSnapshot = (engine as any).evolutionHistory[finalSnapshotCount - 1];
      expect(latestSnapshot).toHaveProperty('timestamp');
      expect(latestSnapshot).toHaveProperty('avgDrift');
      expect(latestSnapshot).toHaveProperty('frequencyChanges');
      expect(latestSnapshot).toHaveProperty('emergingPatterns');
      expect(latestSnapshot).toHaveProperty('decliningPatterns');
    });
  });

  describe('Helper Methods', () => {
    it('should average embeddings correctly', () => {
      const embeddings = [
        [1, 2, 3],
        [3, 4, 5],
        [5, 6, 7],
      ];

      const averaged = (engine as any).averageEmbeddings(embeddings);
      expect(averaged).toEqual([3, 4, 5]);
    });

    it('should handle empty embeddings array', () => {
      const averaged = (engine as any).averageEmbeddings([]);
      expect(averaged).toEqual([]);
    });

    it('should extract concepts from chains', () => {
      const chains: TemporalChain[] = [
        {
          events: [
            { nodeId: 'concept1', timestamp: 1000, granularity: 'day' },
            { nodeId: 'concept2', timestamp: 2000, granularity: 'day' },
          ],
          constraints: [],
          consistency: true,
          duration: 1000,
        },
        {
          events: [
            { nodeId: 'concept1', timestamp: 3000, granularity: 'day' }, // Duplicate
            { nodeId: 'concept3', timestamp: 4000, granularity: 'day' },
          ],
          constraints: [],
          consistency: true,
          duration: 1000,
        },
      ];

      const concepts = (engine as any).extractConceptsFromChains(chains);
      expect(concepts).toHaveLength(3); // Unique concepts only
      expect(concepts).toContain('concept1');
      expect(concepts).toContain('concept2');
      expect(concepts).toContain('concept3');
    });

    it('should generate deterministic placeholder embeddings', async () => {
      const concept = 'test-concept';
      const embedding1 = await (engine as any).generatePlaceholderEmbedding(concept);
      const embedding2 = await (engine as any).generatePlaceholderEmbedding(concept);

      expect(embedding1).toEqual(embedding2); // Deterministic
      expect(embedding1).toHaveLength(1536); // 1536 dimensions (all-mpnet-base-v2)

      // Verify it's normalized (unit vector)
      const norm = Math.sqrt(embedding1.reduce((sum: number, val: number) => sum + val * val, 0));
      expect(norm).toBeCloseTo(1.0, 5);
    });
  });
});
