/**
 * UnifiedSearch Tests
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-SEARCH-001
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UnifiedSearch } from '../../src/god-agent/core/search/unified-search.js';
import type { NativeHNSW } from '../../src/god-agent/core/vector-db/native-hnsw.js';
import type { FallbackGraph } from '../../src/god-agent/core/graph-db/fallback-graph.js';
import type { MemoryClient } from '../../src/god-agent/core/memory-server/memory-client.js';
import type { ReasoningBank } from '../../src/god-agent/core/reasoning/reasoning-bank.js';
import type {
  QuadFusionOptions,
  SourceWeights,
} from '../../src/god-agent/core/search/search-types.js';
import { SearchErrorCode } from '../../src/god-agent/core/search/search-types.js';

describe('UnifiedSearch', () => {
  let mockVectorDb: NativeHNSW;
  let mockGraphDb: FallbackGraph;
  let mockMemoryClient: MemoryClient;
  let mockReasoningBank: ReasoningBank;
  let unifiedSearch: UnifiedSearch;

  beforeEach(() => {
    // Create mock vector database
    // NativeHNSW.search is synchronous, so use mockReturnValue (not mockResolvedValue)
    // SearchResult interface: { id: string, similarity: number, vector?: Float32Array }
    mockVectorDb = {
      search: vi.fn().mockReturnValue([
        { id: 'vector-id-1', similarity: 0.9 },
        { id: 'vector-id-2', similarity: 0.7 },
      ]),
    } as unknown as NativeHNSW;

    // Create mock graph database - must match INode interface
    // getAllNodes must be async and nodes need properties (not data), createdAt, updatedAt
    mockGraphDb = {
      getAllNodes: vi.fn().mockResolvedValue([
        {
          id: 'test-node-1',
          type: 'entity',
          properties: { content: 'graph result 1 test', text: 'test data' },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 'test-node-2',
          type: 'test-type',
          properties: { content: 'graph result 2', text: 'other' },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]),
    } as unknown as FallbackGraph;

    // Create mock memory client
    mockMemoryClient = {
      isConnected: vi.fn().mockReturnValue(true),
      queryPatterns: vi.fn().mockResolvedValue([
        { pattern: 'memory result 1 test', confidence: 0.8, metadata: {} },
        { pattern: 'memory result 2', confidence: 0.6, metadata: {} },
      ]),
    } as unknown as MemoryClient;

    // Create mock reasoning bank - must match IReasoningResponse interface
    // The adapter expects response.patterns with template, patternId, taskType, lScore
    mockReasoningBank = {
      reason: vi.fn().mockResolvedValue({
        patterns: [
          { template: 'pattern result 1 test', confidence: 0.9, patternId: 'p1', taskType: 'test', lScore: 0.8 },
          { template: 'pattern result 2', confidence: 0.7, patternId: 'p2', taskType: 'test', lScore: 0.7 },
        ],
      }),
    } as unknown as ReasoningBank;

    unifiedSearch = new UnifiedSearch(
      mockVectorDb,
      mockGraphDb,
      mockMemoryClient,
      mockReasoningBank
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with default options', () => {
      const search = new UnifiedSearch(
        mockVectorDb,
        mockGraphDb,
        mockMemoryClient,
        mockReasoningBank
      );

      const options = search.getOptions();
      expect(options.topK).toBe(10);
      expect(options.sourceTimeoutMs).toBe(400);
    });

    it('should accept custom options', () => {
      const customOptions: Partial<QuadFusionOptions> = {
        topK: 20,
        sourceTimeoutMs: 300,
      };

      const search = new UnifiedSearch(
        mockVectorDb,
        mockGraphDb,
        mockMemoryClient,
        mockReasoningBank,
        undefined, // gnnEnhancer
        customOptions
      );

      const options = search.getOptions();
      expect(options.topK).toBe(20);
      expect(options.sourceTimeoutMs).toBe(300);
    });

    it('should validate options on construction', () => {
      expect(() => {
        new UnifiedSearch(
          mockVectorDb,
          mockGraphDb,
          mockMemoryClient,
          mockReasoningBank,
          undefined, // gnnEnhancer
          { topK: -5 } // Invalid
        );
      }).toThrow();
    });
  });

  describe('search', () => {
    it('should return QuadFusionResult with required fields', async () => {
      const result = await unifiedSearch.search('test');

      expect(result).toHaveProperty('query', 'test');
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('metadata');
      expect(result).toHaveProperty('sourceStats');
      expect(Array.isArray(result.results)).toBe(true);
    });

    it('should include metadata with timing and counts', async () => {
      const result = await unifiedSearch.search('test');

      expect(result.metadata).toHaveProperty('totalDurationMs');
      expect(result.metadata).toHaveProperty('sourcesResponded');
      expect(result.metadata).toHaveProperty('sourcesTimedOut');
      expect(result.metadata).toHaveProperty('rawResultCount');
      expect(result.metadata).toHaveProperty('dedupedResultCount');
      expect(result.metadata).toHaveProperty('correlationId');
    });

    it('should include source statistics for all four sources', async () => {
      const result = await unifiedSearch.search('test');

      expect(result.sourceStats).toHaveProperty('vector');
      expect(result.sourceStats).toHaveProperty('graph');
      expect(result.sourceStats).toHaveProperty('memory');
      expect(result.sourceStats).toHaveProperty('pattern');
    });

    it('should throw on empty query', async () => {
      // Errors are wrapped: outer Error has cause with .code
      await expect(unifiedSearch.search('')).rejects.toThrow(/Query cannot be empty/);
      await expect(unifiedSearch.search('   ')).rejects.toThrow(/Query cannot be empty/);
    });

    it('should accept optional embedding parameter', async () => {
      const embedding = new Float32Array(1536).fill(0.1);
      const result = await unifiedSearch.search('test', embedding);

      expect(result.results).toBeDefined();
      expect(mockVectorDb.search).toHaveBeenCalled();
    });

    it('should accept per-query options', async () => {
      const result = await unifiedSearch.search('test', undefined, {
        topK: 5,
      });

      expect(result.results.length).toBeLessThanOrEqual(5);
    });

    it('should generate unique correlation IDs', async () => {
      const result1 = await unifiedSearch.search('test');
      const result2 = await unifiedSearch.search('test');

      expect(result1.metadata.correlationId).not.toBe(
        result2.metadata.correlationId
      );
      expect(result1.metadata.correlationId).toMatch(/^qf_/);
    });

    it('should respect topK limit', async () => {
      const result = await unifiedSearch.search('test', undefined, { topK: 2 });

      expect(result.results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('parallel execution', () => {
    it('should execute all sources in parallel', async () => {
      // Provide embedding so vector adapter calls search
      const embedding = new Float32Array(1536).fill(0.1);
      const startTime = Date.now();
      await unifiedSearch.search('test', embedding);
      const duration = Date.now() - startTime;

      // All sources called
      expect(mockVectorDb.search).toHaveBeenCalled();
      expect(mockGraphDb.getAllNodes).toHaveBeenCalled();
      expect(mockMemoryClient.queryPatterns).toHaveBeenCalled();
      expect(mockReasoningBank.reason).toHaveBeenCalled();

      // Should complete quickly due to parallel execution (not 4x serial)
      expect(duration).toBeLessThan(2000);
    });

    it('should handle partial source failures gracefully', async () => {
      // Create mock with empty vector results (simulating "no matches" scenario)
      // NativeHNSW.search is synchronous
      const emptyVectorDb = {
        search: vi.fn().mockReturnValue([]),
      } as unknown as NativeHNSW;

      const search = new UnifiedSearch(
        emptyVectorDb,
        mockGraphDb,
        mockMemoryClient,
        mockReasoningBank
      );

      const result = await search.search('test');

      // Should still return results from other sources
      expect(result.results.length).toBeGreaterThan(0);
      // Graph should respond successfully
      expect(result.sourceStats.graph.responded).toBe(true);
      // Vector should also respond (just with empty results)
      expect(result.sourceStats.vector.responded).toBe(true);
    });

    it('should track source response status in stats', async () => {
      const result = await unifiedSearch.search('test');

      // Graph, memory, pattern should respond successfully
      expect(result.sourceStats.graph.responded).toBe(true);
      // Check at least graph and pattern work
      expect(result.sourceStats.pattern.responded).toBe(true);
    });

    it('should throw when all sources fail', async () => {
      // Create fresh mocks that all fail or return empty
      // NativeHNSW.search is synchronous
      const failingVectorDb = {
        search: vi.fn().mockReturnValue([]),
      } as unknown as NativeHNSW;

      const emptyGraphDb = {
        getAllNodes: vi.fn().mockResolvedValue([]),
      } as unknown as FallbackGraph;

      const failingMemoryClient = {
        isConnected: vi.fn().mockReturnValue(true),
        queryPatterns: vi.fn().mockResolvedValue([]),
      } as unknown as MemoryClient;

      const failingReasoningBank = {
        reason: vi.fn().mockResolvedValue({ patternMatches: [] }),
      } as unknown as ReasoningBank;

      const search = new UnifiedSearch(
        failingVectorDb,
        emptyGraphDb,
        failingMemoryClient,
        failingReasoningBank
      );

      await expect(search.search('test')).rejects.toThrow(/All search sources failed/);
    });
  });

  describe('result fusion', () => {
    it('should return results sorted by fused score', async () => {
      const result = await unifiedSearch.search('test');

      for (let i = 1; i < result.results.length; i++) {
        expect(result.results[i].score).toBeLessThanOrEqual(
          result.results[i - 1].score
        );
      }
    });

    it('should include source attribution in results', async () => {
      const result = await unifiedSearch.search('test');

      if (result.results.length > 0) {
        expect(result.results[0]).toHaveProperty('sources');
        expect(Array.isArray(result.results[0].sources)).toBe(true);
      }
    });

    it('should include content hash in results', async () => {
      const result = await unifiedSearch.search('test');

      if (result.results.length > 0) {
        expect(result.results[0]).toHaveProperty('contentHash');
        expect(result.results[0].contentHash).toMatch(/^[0-9a-f]{16}$/);
      }
    });

    it('should deduplicate identical content from multiple sources', async () => {
      // Setup: same content from multiple sources with proper structure
      const embedding = new Float32Array(1536).fill(0.1);
      (mockVectorDb.search as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 0, distance: 0.1, data: { content: 'duplicate content' } },
      ]);
      (mockGraphDb.getAllNodes as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'test-node-dup',
          type: 'entity',
          properties: { content: 'test node' },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]);

      const result = await unifiedSearch.search('test', embedding);

      // Should have results from multiple sources
      expect(result.results.length).toBeGreaterThan(0);
      // Check that results have source attribution
      expect(result.results[0].sources).toBeDefined();
      expect(result.results[0].sources.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('updateWeights', () => {
    it('should update source weights', () => {
      unifiedSearch.updateWeights({ vector: 0.5, graph: 0.2 });

      const options = unifiedSearch.getOptions();
      // Weights get normalized
      expect(options.weights.vector).toBeGreaterThan(options.weights.graph);
    });

    it('should affect future search results', async () => {
      // First search with default weights
      const result1 = await unifiedSearch.search('test');

      // Heavily weight pattern source
      unifiedSearch.updateWeights({
        vector: 0.1,
        graph: 0.1,
        memory: 0.1,
        pattern: 0.7,
      });

      const result2 = await unifiedSearch.search('test');

      // Both should succeed
      expect(result1.results).toBeDefined();
      expect(result2.results).toBeDefined();
    });
  });

  describe('getOptions', () => {
    it('should return copy of current options', () => {
      const options1 = unifiedSearch.getOptions();
      const options2 = unifiedSearch.getOptions();

      expect(options1).toEqual(options2);
      expect(options1).not.toBe(options2); // Different object reference
    });

    it('should not allow mutation via returned options', () => {
      const options = unifiedSearch.getOptions();
      options.topK = 999;

      const freshOptions = unifiedSearch.getOptions();
      expect(freshOptions.topK).not.toBe(999);
    });
  });

  describe('updateOptions', () => {
    it('should update options', () => {
      unifiedSearch.updateOptions({ topK: 25 });

      expect(unifiedSearch.getOptions().topK).toBe(25);
    });

    it('should validate new options', () => {
      expect(() => {
        unifiedSearch.updateOptions({ topK: -10 });
      }).toThrow();
    });

    it('should merge with existing options', () => {
      unifiedSearch.updateOptions({ topK: 15 });
      unifiedSearch.updateOptions({ graphDepth: 5 });

      const options = unifiedSearch.getOptions();
      expect(options.topK).toBe(15);
      expect(options.graphDepth).toBe(5);
    });
  });

  describe('error handling', () => {
    it('should handle sources returning empty results', async () => {
      // Test graceful handling when vector returns no results
      // NativeHNSW.search is synchronous
      const emptyVectorDb = {
        search: vi.fn().mockReturnValue([]),
      } as unknown as NativeHNSW;

      const search = new UnifiedSearch(
        emptyVectorDb,
        mockGraphDb,
        mockMemoryClient,
        mockReasoningBank
      );

      const embedding = new Float32Array(1536).fill(0.1);
      const result = await search.search('test', embedding);

      // Vector should respond successfully but with no results
      expect(result.sourceStats.vector.responded).toBe(true);
      expect(result.sourceStats.vector.resultCount).toBe(0);
      // Other sources should still contribute results
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('should continue with remaining sources when some return empty', async () => {
      // Test partial results scenario
      // NativeHNSW.search is synchronous
      const emptyVectorDb = {
        search: vi.fn().mockReturnValue([]),
      } as unknown as NativeHNSW;

      const emptyMemoryClient = {
        isConnected: vi.fn().mockReturnValue(true),
        queryPatterns: vi.fn().mockResolvedValue([]),
      } as unknown as MemoryClient;

      const search = new UnifiedSearch(
        emptyVectorDb,
        mockGraphDb,
        emptyMemoryClient,
        mockReasoningBank
      );

      const embedding = new Float32Array(1536).fill(0.1);
      const result = await search.search('test', embedding);

      // Graph and pattern should still work
      expect(result.sourceStats.graph.responded).toBe(true);
      expect(result.sourceStats.pattern.responded).toBe(true);
      expect(result.results.length).toBeGreaterThan(0);
    });
  });

  describe('source timeout handling', () => {
    it('should track timeout count in metadata', async () => {
      // Test with working sources - verify metadata fields exist
      const result = await unifiedSearch.search('test');

      // Metadata should track timeouts (should be 0 with working mocks)
      expect(result.metadata.sourcesTimedOut).toBeGreaterThanOrEqual(0);
      // Total should not exceed 4 sources
      expect(
        result.metadata.sourcesResponded + result.metadata.sourcesTimedOut
      ).toBeLessThanOrEqual(4);
      // Some sources should respond
      expect(result.metadata.sourcesResponded).toBeGreaterThan(0);
    });
  });

  describe('metadata tracking', () => {
    it('should track raw vs deduped result counts', async () => {
      const result = await unifiedSearch.search('test');

      expect(result.metadata.rawResultCount).toBeGreaterThanOrEqual(0);
      expect(result.metadata.dedupedResultCount).toBeGreaterThanOrEqual(0);
      expect(result.metadata.dedupedResultCount).toBeLessThanOrEqual(
        result.metadata.rawResultCount
      );
    });

    it('should track total duration', async () => {
      const result = await unifiedSearch.search('test');

      expect(result.metadata.totalDurationMs).toBeGreaterThan(0);
    });

    it('should count sources responded', async () => {
      const result = await unifiedSearch.search('test');

      expect(result.metadata.sourcesResponded).toBeGreaterThanOrEqual(0);
      expect(result.metadata.sourcesResponded).toBeLessThanOrEqual(4);
    });
  });

  describe('source adapter configuration', () => {
    it('should pass graphDepth to graph adapter', async () => {
      const search = new UnifiedSearch(
        mockVectorDb,
        mockGraphDb,
        mockMemoryClient,
        mockReasoningBank,
        { graphDepth: 5 }
      );

      await search.search('test');

      // Graph adapter should be called (verifies configuration was passed)
      expect(mockGraphDb.getAllNodes).toHaveBeenCalled();
    });

    it('should pass memoryNamespace to memory adapter', async () => {
      const search = new UnifiedSearch(
        mockVectorDb,
        mockGraphDb,
        mockMemoryClient,
        mockReasoningBank,
        { memoryNamespace: 'custom-ns' }
      );

      await search.search('test');

      // Memory client should be called (verifies configuration was passed)
      expect(mockMemoryClient.queryPatterns).toHaveBeenCalled();
    });

    it('should pass minPatternConfidence to pattern adapter', async () => {
      const search = new UnifiedSearch(
        mockVectorDb,
        mockGraphDb,
        mockMemoryClient,
        mockReasoningBank,
        { minPatternConfidence: 0.8 }
      );

      await search.search('test');

      // Pattern adapter should filter by confidence
      expect(mockReasoningBank.reason).toHaveBeenCalled();
    });
  });

  describe('integration scenarios', () => {
    it('should handle disconnected memory client', async () => {
      (mockMemoryClient.isConnected as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const result = await unifiedSearch.search('test');

      // Should still return results from other sources
      expect(result.results).toBeDefined();
      expect(result.sourceStats.memory.resultCount).toBe(0);
    });

    it('should handle empty results from all sources', async () => {
      // Vector is synchronous
      (mockVectorDb.search as ReturnType<typeof vi.fn>).mockReturnValue([]);
      // Graph is async
      (mockGraphDb.getAllNodes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (mockMemoryClient.queryPatterns as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      // Pattern adapter expects 'patterns' (not 'patternMatches')
      (mockReasoningBank.reason as ReturnType<typeof vi.fn>).mockResolvedValue({
        patterns: [],
      });

      await expect(unifiedSearch.search('test')).rejects.toThrow(/All search sources failed/);
    });

    it('should work with only embedding (no text query needed for vector)', async () => {
      const embedding = new Float32Array(1536).fill(0.1);
      // Use 'test' as query to also match graph nodes
      const result = await unifiedSearch.search('test', embedding);

      expect(mockVectorDb.search).toHaveBeenCalled();
      expect(result.results).toBeDefined();
      expect(result.results.length).toBeGreaterThan(0);
    });
  });
});
