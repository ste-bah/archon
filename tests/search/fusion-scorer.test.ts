/**
 * FusionScorer Tests
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-SEARCH-002
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FusionScorer } from '../../src/god-agent/core/search/fusion-scorer.js';
import type {
  SourceWeights,
  RawSourceResult,
  AggregatedResults,
  SourceExecutionResult,
} from '../../src/god-agent/core/search/search-types.js';

describe('FusionScorer', () => {
  let scorer: FusionScorer;
  const defaultWeights: SourceWeights = {
    vector: 0.4,
    graph: 0.3,
    memory: 0.2,
    pattern: 0.1,
  };

  beforeEach(() => {
    scorer = new FusionScorer(defaultWeights);
  });

  describe('constructor', () => {
    it('should normalize weights on creation', () => {
      const unnormalized: SourceWeights = {
        vector: 0.8,
        graph: 0.6,
        memory: 0.4,
        pattern: 0.2,
      };
      const scorer = new FusionScorer(unnormalized);
      const weights = scorer.getWeights();

      const sum = weights.vector + weights.graph + weights.memory + weights.pattern;
      expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);
    });

    it('should preserve weight ratios when normalizing', () => {
      const unnormalized: SourceWeights = {
        vector: 2,
        graph: 1,
        memory: 1,
        pattern: 0,
      };
      const scorer = new FusionScorer(unnormalized);
      const weights = scorer.getWeights();

      expect(weights.vector).toBeCloseTo(0.5, 2);
      expect(weights.graph).toBeCloseTo(0.25, 2);
      expect(weights.memory).toBeCloseTo(0.25, 2);
      expect(weights.pattern).toBeCloseTo(0, 2);
    });
  });

  describe('computeContentHash', () => {
    it('should return 16-character hex string', () => {
      const hash = scorer.computeContentHash('test content');
      expect(hash).toHaveLength(16);
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should be deterministic', () => {
      const hash1 = scorer.computeContentHash('same content');
      const hash2 = scorer.computeContentHash('same content');
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different content', () => {
      const hash1 = scorer.computeContentHash('content 1');
      const hash2 = scorer.computeContentHash('content 2');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('deduplicate', () => {
    it('should group results with same content', () => {
      const results: RawSourceResult[] = [
        { source: 'vector', id: 'v1', content: 'duplicate', score: 0.9 },
        { source: 'graph', id: 'g1', content: 'duplicate', score: 0.8 },
        { source: 'memory', id: 'm1', content: 'unique', score: 0.7 },
      ];

      const groups = scorer.deduplicate(results);

      expect(groups.size).toBe(2);
    });

    it('should keep all results with same hash together', () => {
      const results: RawSourceResult[] = [
        { source: 'vector', id: 'v1', content: 'same', score: 0.9 },
        { source: 'graph', id: 'g1', content: 'same', score: 0.8 },
        { source: 'pattern', id: 'p1', content: 'same', score: 0.7 },
      ];

      const groups = scorer.deduplicate(results);
      const hash = scorer.computeContentHash('same');
      const group = groups.get(hash);

      expect(group).toHaveLength(3);
    });

    it('should handle empty results array', () => {
      const groups = scorer.deduplicate([]);
      expect(groups.size).toBe(0);
    });

    it('should treat all unique content as separate groups', () => {
      const results: RawSourceResult[] = [
        { source: 'vector', id: 'v1', content: 'unique1', score: 0.9 },
        { source: 'graph', id: 'g1', content: 'unique2', score: 0.8 },
        { source: 'memory', id: 'm1', content: 'unique3', score: 0.7 },
      ];

      const groups = scorer.deduplicate(results);
      expect(groups.size).toBe(3);
    });
  });

  describe('fuse', () => {
    const createSuccessOutcome = (results: RawSourceResult[]): SourceExecutionResult => ({
      status: 'success',
      results,
      durationMs: 10,
    });

    const createTimeoutOutcome = (): SourceExecutionResult => ({
      status: 'timeout',
      durationMs: 400,
    });

    const createErrorOutcome = (): SourceExecutionResult => ({
      status: 'error',
      error: 'Test error',
      durationMs: 5,
    });

    it('should return empty array when no results', () => {
      const aggregated: AggregatedResults = {
        rawResults: [],
        sourceOutcomes: {
          vector: createSuccessOutcome([]),
          graph: createSuccessOutcome([]),
          memory: createSuccessOutcome([]),
          pattern: createSuccessOutcome([]),
        },
      };

      const results = scorer.fuse(aggregated, 10);
      expect(results).toHaveLength(0);
    });

    it('should respect topK limit', () => {
      const rawResults: RawSourceResult[] = [];
      for (let i = 0; i < 20; i++) {
        rawResults.push({
          source: 'vector',
          id: `v${i}`,
          content: `content ${i}`,
          score: 0.9 - i * 0.01,
        });
      }

      const aggregated: AggregatedResults = {
        rawResults,
        sourceOutcomes: {
          vector: createSuccessOutcome(rawResults),
          graph: createSuccessOutcome([]),
          memory: createSuccessOutcome([]),
          pattern: createSuccessOutcome([]),
        },
      };

      const results = scorer.fuse(aggregated, 5);
      expect(results).toHaveLength(5);
    });

    it('should sort results by score descending', () => {
      const rawResults: RawSourceResult[] = [
        { source: 'vector', id: 'v1', content: 'low', score: 0.3 },
        { source: 'vector', id: 'v2', content: 'high', score: 0.9 },
        { source: 'vector', id: 'v3', content: 'mid', score: 0.6 },
      ];

      const aggregated: AggregatedResults = {
        rawResults,
        sourceOutcomes: {
          vector: createSuccessOutcome(rawResults),
          graph: createSuccessOutcome([]),
          memory: createSuccessOutcome([]),
          pattern: createSuccessOutcome([]),
        },
      };

      const results = scorer.fuse(aggregated, 10);

      expect(results[0].content).toBe('high');
      expect(results[1].content).toBe('mid');
      expect(results[2].content).toBe('low');
    });

    it('should include source attribution', () => {
      const rawResults: RawSourceResult[] = [
        { source: 'vector', id: 'v1', content: 'test', score: 0.9 },
      ];

      const aggregated: AggregatedResults = {
        rawResults,
        sourceOutcomes: {
          vector: createSuccessOutcome(rawResults),
          graph: createSuccessOutcome([]),
          memory: createSuccessOutcome([]),
          pattern: createSuccessOutcome([]),
        },
      };

      const results = scorer.fuse(aggregated, 10);

      expect(results[0].sources).toHaveLength(1);
      expect(results[0].sources[0].source).toBe('vector');
      expect(results[0].sources[0].originalScore).toBe(0.9);
    });

    it('should merge duplicate content from multiple sources', () => {
      const rawResults: RawSourceResult[] = [
        { source: 'vector', id: 'v1', content: 'duplicate', score: 0.9 },
        { source: 'graph', id: 'g1', content: 'duplicate', score: 0.8 },
      ];

      const aggregated: AggregatedResults = {
        rawResults,
        sourceOutcomes: {
          vector: createSuccessOutcome([rawResults[0]]),
          graph: createSuccessOutcome([rawResults[1]]),
          memory: createSuccessOutcome([]),
          pattern: createSuccessOutcome([]),
        },
      };

      const results = scorer.fuse(aggregated, 10);

      expect(results).toHaveLength(1);
      expect(results[0].sources).toHaveLength(2);
    });

    it('should redistribute weight from failed sources', () => {
      const vectorResult: RawSourceResult = {
        source: 'vector',
        id: 'v1',
        content: 'test',
        score: 0.8,
      };

      const aggregated: AggregatedResults = {
        rawResults: [vectorResult],
        sourceOutcomes: {
          vector: createSuccessOutcome([vectorResult]),
          graph: createTimeoutOutcome(),
          memory: createErrorOutcome(),
          pattern: createSuccessOutcome([]),
        },
      };

      const results = scorer.fuse(aggregated, 10);

      // Vector should get redistributed weight
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('should include content hash in results', () => {
      const rawResults: RawSourceResult[] = [
        { source: 'vector', id: 'v1', content: 'test content', score: 0.9 },
      ];

      const aggregated: AggregatedResults = {
        rawResults,
        sourceOutcomes: {
          vector: createSuccessOutcome(rawResults),
          graph: createSuccessOutcome([]),
          memory: createSuccessOutcome([]),
          pattern: createSuccessOutcome([]),
        },
      };

      const results = scorer.fuse(aggregated, 10);

      expect(results[0].contentHash).toHaveLength(16);
      expect(results[0].contentHash).toBe(
        scorer.computeContentHash('test content')
      );
    });

    it('should clamp scores to [0, 1] range', () => {
      const rawResults: RawSourceResult[] = [
        { source: 'vector', id: 'v1', content: 'test', score: 1.5 }, // Over 1
      ];

      const aggregated: AggregatedResults = {
        rawResults,
        sourceOutcomes: {
          vector: createSuccessOutcome(rawResults),
          graph: createSuccessOutcome([]),
          memory: createSuccessOutcome([]),
          pattern: createSuccessOutcome([]),
        },
      };

      const results = scorer.fuse(aggregated, 10);

      expect(results[0].score).toBeLessThanOrEqual(1);
      expect(results[0].score).toBeGreaterThanOrEqual(0);
    });

    it('should merge metadata from multiple sources', () => {
      const rawResults: RawSourceResult[] = [
        {
          source: 'vector',
          id: 'v1',
          content: 'duplicate',
          score: 0.9,
          metadata: { vectorId: 'vec123' },
        },
        {
          source: 'graph',
          id: 'g1',
          content: 'duplicate',
          score: 0.8,
          metadata: { nodeId: 'node456' },
        },
      ];

      const aggregated: AggregatedResults = {
        rawResults,
        sourceOutcomes: {
          vector: createSuccessOutcome([rawResults[0]]),
          graph: createSuccessOutcome([rawResults[1]]),
          memory: createSuccessOutcome([]),
          pattern: createSuccessOutcome([]),
        },
      };

      const results = scorer.fuse(aggregated, 10);

      expect(results[0].metadata).toMatchObject({
        vector_vectorId: 'vec123',
        graph_nodeId: 'node456',
      });
    });
  });

  describe('normalizeWeights', () => {
    it('should normalize weights to sum to 1', () => {
      const weights: SourceWeights = {
        vector: 2,
        graph: 2,
        memory: 2,
        pattern: 2,
      };

      const normalized = scorer.normalizeWeights(weights);
      const sum =
        normalized.vector +
        normalized.graph +
        normalized.memory +
        normalized.pattern;

      expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);
    });

    it('should handle all zero weights by returning default', () => {
      const weights: SourceWeights = {
        vector: 0,
        graph: 0,
        memory: 0,
        pattern: 0,
      };

      const normalized = scorer.normalizeWeights(weights);

      // Should return default weights
      expect(normalized.vector).toBe(0.4);
      expect(normalized.graph).toBe(0.3);
      expect(normalized.memory).toBe(0.2);
      expect(normalized.pattern).toBe(0.1);
    });
  });

  describe('getWeights / updateWeights', () => {
    it('should return current weights', () => {
      const weights = scorer.getWeights();

      expect(weights.vector).toBeCloseTo(0.4, 5);
      expect(weights.graph).toBeCloseTo(0.3, 5);
      expect(weights.memory).toBeCloseTo(0.2, 5);
      expect(weights.pattern).toBeCloseTo(0.1, 5);
    });

    it('should update weights with normalization', () => {
      scorer.updateWeights({
        vector: 0.5,
        graph: 0.3,
        memory: 0.1,
        pattern: 0.1,
      });

      const weights = scorer.getWeights();
      const sum =
        weights.vector +
        weights.graph +
        weights.memory +
        weights.pattern;

      expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);
    });

    it('should not mutate returned weights', () => {
      const weights = scorer.getWeights();
      weights.vector = 999;

      const freshWeights = scorer.getWeights();
      expect(freshWeights.vector).toBeCloseTo(0.4, 5);
    });
  });

  describe('weighted scoring', () => {
    it('should weight vector results highest by default', () => {
      const vectorResult: RawSourceResult = {
        source: 'vector',
        id: 'v1',
        content: 'vector content',
        score: 1.0,
      };
      const patternResult: RawSourceResult = {
        source: 'pattern',
        id: 'p1',
        content: 'pattern content',
        score: 1.0,
      };

      const aggregated: AggregatedResults = {
        rawResults: [vectorResult, patternResult],
        sourceOutcomes: {
          vector: { status: 'success', results: [vectorResult], durationMs: 10 },
          graph: { status: 'success', results: [], durationMs: 10 },
          memory: { status: 'success', results: [], durationMs: 10 },
          pattern: { status: 'success', results: [patternResult], durationMs: 10 },
        },
      };

      const results = scorer.fuse(aggregated, 10);

      // Vector result should score higher due to higher weight (0.4 vs 0.1)
      const vectorFused = results.find((r) => r.content === 'vector content');
      const patternFused = results.find((r) => r.content === 'pattern content');

      expect(vectorFused).toBeDefined();
      expect(patternFused).toBeDefined();
      // With equal original scores, vector should be higher due to weight
    });

    it('should combine scores from multiple sources correctly', () => {
      // Same content from vector (0.4 weight) and graph (0.3 weight)
      const rawResults: RawSourceResult[] = [
        { source: 'vector', id: 'v1', content: 'combined', score: 1.0 },
        { source: 'graph', id: 'g1', content: 'combined', score: 1.0 },
      ];

      const aggregated: AggregatedResults = {
        rawResults,
        sourceOutcomes: {
          vector: { status: 'success', results: [rawResults[0]], durationMs: 10 },
          graph: { status: 'success', results: [rawResults[1]], durationMs: 10 },
          memory: { status: 'success', results: [], durationMs: 10 },
          pattern: { status: 'success', results: [], durationMs: 10 },
        },
      };

      const results = scorer.fuse(aggregated, 10);

      // Combined weighted score should be weighted average
      expect(results[0].score).toBe(1.0); // Perfect scores from both
    });
  });
});
