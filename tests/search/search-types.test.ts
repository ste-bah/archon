import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OPTIONS,
  MAX_TOP_K,
  MAX_GRAPH_DEPTH,
  MAX_SOURCE_TIMEOUT_MS,
  validateOptions,
  createSearchError,
  normalizeWeights,
  mergeOptions,
  SearchErrorCode,
  type SearchSource,
  type SourceWeights,
  type QuadFusionOptions,
  type FusedSearchResult,
  type QuadFusionResult
} from '../../src/god-agent/core/search/search-types';

describe('search-types', () => {
  describe('DEFAULT_OPTIONS', () => {
    it('should have correct default weights', () => {
      expect(DEFAULT_OPTIONS.weights.vector).toBe(0.4);
      expect(DEFAULT_OPTIONS.weights.graph).toBe(0.3);
      expect(DEFAULT_OPTIONS.weights.memory).toBe(0.2);
      expect(DEFAULT_OPTIONS.weights.pattern).toBe(0.1);
    });

    it('should have weights that sum to 1.0', () => {
      const sum = Object.values(DEFAULT_OPTIONS.weights)
        .reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 10);
    });

    it('should have correct default topK', () => {
      expect(DEFAULT_OPTIONS.topK).toBe(10);
    });

    it('should have correct default graphDepth', () => {
      expect(DEFAULT_OPTIONS.graphDepth).toBe(2);
    });

    it('should have correct default sourceTimeoutMs', () => {
      expect(DEFAULT_OPTIONS.sourceTimeoutMs).toBe(400);
    });

    it('should have correct default minPatternConfidence', () => {
      expect(DEFAULT_OPTIONS.minPatternConfidence).toBe(0.5);
    });

    it('should have correct default memoryNamespace', () => {
      expect(DEFAULT_OPTIONS.memoryNamespace).toBe('default');
    });

    it('should have includeAttribution enabled by default', () => {
      expect(DEFAULT_OPTIONS.includeAttribution).toBe(true);
    });
  });

  describe('Constants', () => {
    it('should have MAX_TOP_K = 100', () => {
      expect(MAX_TOP_K).toBe(100);
    });

    it('should have MAX_GRAPH_DEPTH = 5', () => {
      expect(MAX_GRAPH_DEPTH).toBe(5);
    });

    it('should have MAX_SOURCE_TIMEOUT_MS = 500', () => {
      expect(MAX_SOURCE_TIMEOUT_MS).toBe(500);
    });
  });

  describe('validateOptions()', () => {
    it('should reject topK > 100', () => {
      expect(() => validateOptions({ topK: 101 })).toThrow();
    });

    it('should reject topK < 1', () => {
      expect(() => validateOptions({ topK: 0 })).toThrow();
    });

    it('should accept valid topK', () => {
      expect(() => validateOptions({ topK: 50 })).not.toThrow();
    });

    it('should reject graphDepth > 5', () => {
      expect(() => validateOptions({ graphDepth: 6 })).toThrow();
    });

    it('should reject graphDepth < 1', () => {
      expect(() => validateOptions({ graphDepth: 0 })).toThrow();
    });

    it('should accept valid graphDepth', () => {
      expect(() => validateOptions({ graphDepth: 3 })).not.toThrow();
    });

    it('should reject sourceTimeoutMs > 500', () => {
      expect(() => validateOptions({ sourceTimeoutMs: 501 })).toThrow();
    });

    it('should reject sourceTimeoutMs < 100', () => {
      expect(() => validateOptions({ sourceTimeoutMs: 99 })).toThrow();
    });

    it('should accept valid sourceTimeoutMs', () => {
      expect(() => validateOptions({ sourceTimeoutMs: 400 })).not.toThrow();
    });

    it('should reject weights that do not sum to 1.0', () => {
      expect(() => validateOptions({
        weights: { vector: 0.5, graph: 0.5, memory: 0.5, pattern: 0.5 }
      })).toThrow();
    });

    it('should accept weights that sum to 1.0', () => {
      expect(() => validateOptions({
        weights: { vector: 0.25, graph: 0.25, memory: 0.25, pattern: 0.25 }
      })).not.toThrow();
    });

    it('should accept empty options', () => {
      expect(() => validateOptions({})).not.toThrow();
    });
  });

  describe('createSearchError()', () => {
    it('should create error with code and context', () => {
      const error = createSearchError(
        SearchErrorCode.INVALID_QUERY,
        'Query too short',
        { query: 'a' }
      );
      expect(error.code).toBe(SearchErrorCode.INVALID_QUERY);
      expect(error.context.query).toBe('a');
      expect(error.message).toBe('Query too short');
    });

    it('should mark input errors as recoverable', () => {
      const error = createSearchError(
        SearchErrorCode.INVALID_QUERY,
        'Test'
      );
      expect(error.recoverable).toBe(true);
    });

    it('should mark source errors as recoverable', () => {
      const error = createSearchError(
        SearchErrorCode.ALL_SOURCES_FAILED,
        'Test'
      );
      expect(error.recoverable).toBe(true);
    });

    it('should mark fusion errors as not recoverable', () => {
      const error = createSearchError(
        SearchErrorCode.FUSION_ERROR,
        'Test'
      );
      expect(error.recoverable).toBe(false);
    });

    it('should mark system errors as not recoverable', () => {
      const error = createSearchError(
        SearchErrorCode.UNKNOWN_ERROR,
        'Test'
      );
      expect(error.recoverable).toBe(false);
    });

    it('should work with empty context', () => {
      const error = createSearchError(
        SearchErrorCode.INVALID_QUERY,
        'Test'
      );
      expect(error.context).toEqual({});
    });
  });

  describe('normalizeWeights()', () => {
    it('should normalize weights to sum to 1.0', () => {
      const normalized = normalizeWeights({
        vector: 2, graph: 2, memory: 2, pattern: 2
      });
      const sum = normalized.vector + normalized.graph + normalized.memory + normalized.pattern;
      expect(sum).toBeCloseTo(1.0, 5);
    });

    it('should handle already normalized weights', () => {
      const normalized = normalizeWeights({
        vector: 0.4, graph: 0.3, memory: 0.2, pattern: 0.1
      });
      expect(normalized.vector).toBeCloseTo(0.4, 5);
      expect(normalized.graph).toBeCloseTo(0.3, 5);
    });

    it('should return default weights for all-zero input', () => {
      const normalized = normalizeWeights({
        vector: 0, graph: 0, memory: 0, pattern: 0
      });
      expect(normalized).toEqual(DEFAULT_OPTIONS.weights);
    });

    it('should preserve weight ratios', () => {
      const normalized = normalizeWeights({
        vector: 4, graph: 3, memory: 2, pattern: 1
      });
      expect(normalized.vector / normalized.graph).toBeCloseTo(4 / 3, 5);
      expect(normalized.memory / normalized.pattern).toBeCloseTo(2 / 1, 5);
    });
  });

  describe('mergeOptions()', () => {
    it('should return defaults for empty options', () => {
      const merged = mergeOptions({});
      expect(merged).toEqual(DEFAULT_OPTIONS);
    });

    it('should override specific options', () => {
      const merged = mergeOptions({ topK: 50 });
      expect(merged.topK).toBe(50);
      expect(merged.graphDepth).toBe(DEFAULT_OPTIONS.graphDepth);
    });

    it('should normalize custom weights', () => {
      const merged = mergeOptions({
        weights: { vector: 1, graph: 1, memory: 1, pattern: 1 }
      });
      expect(merged.weights.vector).toBeCloseTo(0.25, 5);
    });
  });

  describe('Type definitions', () => {
    it('should allow valid SearchSource values', () => {
      const sources: SearchSource[] = ['vector', 'graph', 'memory', 'pattern'];
      expect(sources).toHaveLength(4);
    });

    it('should create valid FusedSearchResult', () => {
      const result: FusedSearchResult = {
        id: 'test-id',
        content: 'test content',
        score: 0.95,
        contentHash: 'abc123def456',
        sources: [{
          source: 'vector',
          originalScore: 0.9,
          weightedScore: 0.36
        }]
      };
      expect(result.score).toBe(0.95);
    });

    it('should create valid QuadFusionResult', () => {
      const result: QuadFusionResult = {
        query: 'test query',
        results: [],
        metadata: {
          totalDurationMs: 150,
          sourcesResponded: 4,
          sourcesTimedOut: 0,
          rawResultCount: 40,
          dedupedResultCount: 10,
          correlationId: 'corr-123'
        },
        sourceStats: {
          vector: { responded: true, durationMs: 50, resultCount: 10, timedOut: false },
          graph: { responded: true, durationMs: 80, resultCount: 10, timedOut: false },
          memory: { responded: true, durationMs: 30, resultCount: 10, timedOut: false },
          pattern: { responded: true, durationMs: 40, resultCount: 10, timedOut: false }
        }
      };
      expect(result.metadata.sourcesResponded).toBe(4);
    });
  });

  describe('SearchErrorCode enum', () => {
    it('should have input errors in 1xx range', () => {
      expect(SearchErrorCode.INVALID_QUERY).toBe(100);
      expect(SearchErrorCode.INVALID_EMBEDDING).toBe(101);
      expect(SearchErrorCode.INVALID_OPTIONS).toBe(102);
      expect(SearchErrorCode.QUERY_TOO_LONG).toBe(103);
    });

    it('should have source errors in 2xx range', () => {
      expect(SearchErrorCode.ALL_SOURCES_FAILED).toBe(200);
      expect(SearchErrorCode.VECTOR_SOURCE_ERROR).toBe(201);
      expect(SearchErrorCode.GRAPH_SOURCE_ERROR).toBe(202);
      expect(SearchErrorCode.MEMORY_SOURCE_ERROR).toBe(203);
      expect(SearchErrorCode.PATTERN_SOURCE_ERROR).toBe(204);
    });

    it('should have fusion errors in 3xx range', () => {
      expect(SearchErrorCode.FUSION_ERROR).toBe(300);
      expect(SearchErrorCode.DEDUPLICATION_ERROR).toBe(301);
      expect(SearchErrorCode.SCORING_ERROR).toBe(302);
    });

    it('should have system errors in 4xx range', () => {
      expect(SearchErrorCode.INITIALIZATION_ERROR).toBe(400);
      expect(SearchErrorCode.CONFIGURATION_ERROR).toBe(401);
      expect(SearchErrorCode.UNKNOWN_ERROR).toBe(499);
    });
  });
});
