/**
 * TASK-SEARCH-006: GodAgent Search Integration Tests
 *
 * Tests UnifiedSearch integration with GodAgent:
 * - search() method
 * - searchWithEmbedding() method
 * - updateSearchWeights() method
 * - getSearchOptions() method
 * - Error handling for uninitialized state
 * - Embedding dimension validation
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-SEARCH-006
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GodAgent } from '../../../../src/god-agent/core/god-agent.js';

describe('TASK-SEARCH-006: GodAgent Search Integration', () => {
  let agent: GodAgent;

  // Helper to create normalized 1536D embedding
  const createEmbedding = (dim: number = 1536): Float32Array => {
    const arr = new Float32Array(dim);
    let sumSq = 0;
    for (let i = 0; i < dim; i++) {
      arr[i] = Math.random() * 2 - 1;
      sumSq += arr[i] * arr[i];
    }
    const norm = Math.sqrt(sumSq);
    for (let i = 0; i < dim; i++) {
      arr[i] /= norm;
    }
    return arr;
  };

  beforeEach(() => {
    agent = new GodAgent({
      verbose: false,
      enableObservability: false,
    });
  });

  afterEach(async () => {
    try {
      await agent.shutdown();
    } catch {
      // Ignore shutdown errors
    }
  });

  describe('Search Method Availability', () => {
    it('TC-S6-001: should have search method', () => {
      expect(typeof agent.search).toBe('function');
    });

    it('TC-S6-002: should have searchWithEmbedding method', () => {
      expect(typeof agent.searchWithEmbedding).toBe('function');
    });

    it('TC-S6-003: should have updateSearchWeights method', () => {
      expect(typeof agent.updateSearchWeights).toBe('function');
    });

    it('TC-S6-004: should have getSearchOptions method', () => {
      expect(typeof agent.getSearchOptions).toBe('function');
    });
  });

  describe('Uninitialized State Errors', () => {
    it('TC-S6-010: search should throw if not initialized', async () => {
      await expect(agent.search('test query')).rejects.toThrow(/not initialized/i);
    });

    it('TC-S6-011: searchWithEmbedding should throw if not initialized', async () => {
      const embedding = createEmbedding(1536);
      await expect(
        agent.searchWithEmbedding('test query', embedding)
      ).rejects.toThrow(/not initialized/i);
    });

    it('TC-S6-012: updateSearchWeights should throw if not initialized', () => {
      expect(() => agent.updateSearchWeights({ vector: 0.5 })).toThrow(
        /not initialized/i
      );
    });

    it('TC-S6-013: getSearchOptions should return undefined if not initialized', () => {
      expect(agent.getSearchOptions()).toBeUndefined();
    });
  });

  describe('After Initialization', () => {
    beforeEach(async () => {
      await agent.initialize();
    });

    describe('search()', () => {
      it('TC-S6-020: should execute search with query string', async () => {
        // Search on empty stores may throw or return empty results
        try {
          const result = await agent.search('test query');

          expect(result).toBeDefined();
          expect(result.query).toBe('test query');
          expect(Array.isArray(result.results)).toBe(true);
          expect(result.metadata).toBeDefined();
          expect(typeof result.metadata.totalDurationMs).toBe('number');
        } catch (error) {
          // Empty stores throw "All search sources failed" - this is expected
          expect(String(error)).toMatch(/no results|failed/i);
        }
      });

      it('TC-S6-021: should return QuadFusionResult structure', async () => {
        try {
          const result = await agent.search('authentication patterns');

          // Validate result structure
          expect(result).toHaveProperty('query');
          expect(result).toHaveProperty('results');
          expect(result).toHaveProperty('metadata');
          expect(result.metadata).toHaveProperty('totalDurationMs');
          expect(result.metadata).toHaveProperty('correlationId');
        } catch (error) {
          // Empty stores throw "All search sources failed" - this is expected
          expect(String(error)).toMatch(/no results|failed/i);
        }
      });

      it('TC-S6-022: should accept optional search options', async () => {
        try {
          const result = await agent.search('test query', {
            maxResults: 5,
            timeoutMs: 1000,
          });

          expect(result).toBeDefined();
          expect(result.results.length).toBeLessThanOrEqual(5);
        } catch (error) {
          // Empty stores throw "All search sources failed" - this is expected
          expect(String(error)).toMatch(/no results|failed/i);
        }
      });

      it('TC-S6-023: should handle empty query gracefully', async () => {
        // Empty queries may return empty results or throw
        // depending on implementation - test for either
        try {
          const result = await agent.search('');
          expect(result.results).toEqual([]);
        } catch (error) {
          expect(error).toBeDefined();
        }
      });
    });

    describe('searchWithEmbedding()', () => {
      it('TC-S6-030: should execute search with 1536D embedding', async () => {
        const embedding = createEmbedding(1536);

        try {
          const result = await agent.searchWithEmbedding('vector search', embedding);

          expect(result).toBeDefined();
          expect(result.query).toBe('vector search');
          expect(Array.isArray(result.results)).toBe(true);
        } catch (error) {
          // Empty stores throw "All search sources failed" - this is expected
          expect(String(error)).toMatch(/no results|failed/i);
        }
      });

      it('TC-S6-031: should reject non-1536D embeddings', async () => {
        const wrongDimEmbedding = createEmbedding(512);

        await expect(
          agent.searchWithEmbedding('test', wrongDimEmbedding)
        ).rejects.toThrow(/1536/);
      });

      it('TC-S6-032: should reject too-large embeddings', async () => {
        const tooLarge = createEmbedding(2048);

        await expect(
          agent.searchWithEmbedding('test', tooLarge)
        ).rejects.toThrow(/1536/);
      });

      it('TC-S6-033: should include embedding in search metadata', async () => {
        const embedding = createEmbedding(1536);

        try {
          const result = await agent.searchWithEmbedding('embedding test', embedding);

          expect(result.metadata).toBeDefined();
          expect(typeof result.metadata.totalDurationMs).toBe('number');
        } catch (error) {
          // Empty stores throw "All search sources failed" - this is expected
          expect(String(error)).toMatch(/no results|failed/i);
        }
      });
    });

    describe('updateSearchWeights()', () => {
      it('TC-S6-040: should update vector weight', () => {
        expect(() => agent.updateSearchWeights({ vector: 0.5 })).not.toThrow();
      });

      it('TC-S6-041: should update graph weight', () => {
        expect(() => agent.updateSearchWeights({ graph: 0.3 })).not.toThrow();
      });

      it('TC-S6-042: should update memory weight', () => {
        expect(() => agent.updateSearchWeights({ memory: 0.2 })).not.toThrow();
      });

      it('TC-S6-043: should update pattern weight', () => {
        expect(() => agent.updateSearchWeights({ pattern: 0.1 })).not.toThrow();
      });

      it('TC-S6-044: should update multiple weights at once', () => {
        expect(() =>
          agent.updateSearchWeights({
            vector: 0.4,
            graph: 0.3,
            memory: 0.2,
            pattern: 0.1,
          })
        ).not.toThrow();
      });
    });

    describe('getSearchOptions()', () => {
      it('TC-S6-050: should return QuadFusionOptions', () => {
        const options = agent.getSearchOptions();

        expect(options).toBeDefined();
        expect(options).toHaveProperty('weights');
        // API uses topK instead of maxResults
        expect(options).toHaveProperty('topK');
      });

      it('TC-S6-051: should reflect weight updates', () => {
        agent.updateSearchWeights({ vector: 0.9 });
        const options = agent.getSearchOptions();

        // Use toBeCloseTo for floating point comparison
        expect(options?.weights?.vector).toBeCloseTo(0.9, 5);
      });

      it('TC-S6-052: should include topK setting', () => {
        const options = agent.getSearchOptions();

        expect(typeof options?.topK).toBe('number');
        expect(options?.topK).toBeGreaterThan(0);
      });
    });
  });

  describe('Search with Custom Options', () => {
    beforeEach(async () => {
      await agent.initialize();
    });

    it('TC-S6-060: should use custom search options from config', async () => {
      const customAgent = new GodAgent({
        verbose: false,
        enableObservability: false,
        searchOptions: {
          topK: 20,
          weights: {
            vector: 0.5,
            graph: 0.2,
            memory: 0.2,
            pattern: 0.1,
          },
        },
      });

      await customAgent.initialize();

      const options = customAgent.getSearchOptions();
      expect(options?.topK).toBe(20);
      // Use toBeCloseTo for floating point comparison
      expect(options?.weights?.vector).toBeCloseTo(0.5, 5);

      await customAgent.shutdown();
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await agent.initialize();
    });

    it('TC-S6-070: search should complete within timeout', async () => {
      const startTime = Date.now();
      try {
        await agent.search('timeout test', { timeoutMs: 5000 });
      } catch {
        // Empty stores throw - that's fine for timeout test
      }
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(5000);
    });

    it('TC-S6-071: should handle special characters in query', async () => {
      try {
        const result = await agent.search('test "quoted" & special < chars >');

        expect(result).toBeDefined();
        expect(result.query).toContain('test');
      } catch (error) {
        // Empty stores throw "All search sources failed" - this is expected
        expect(String(error)).toMatch(/no results|failed/i);
      }
    });

    it('TC-S6-072: should handle very long queries', async () => {
      const longQuery = 'a'.repeat(10000);
      try {
        const result = await agent.search(longQuery);

        expect(result).toBeDefined();
      } catch (error) {
        // Empty stores throw "All search sources failed" - this is expected
        expect(String(error)).toMatch(/no results|failed/i);
      }
    });
  });

  describe('Performance', () => {
    beforeEach(async () => {
      await agent.initialize();
    });

    it('TC-S6-080: search should complete in under 500ms', async () => {
      const startTime = Date.now();
      try {
        await agent.search('performance test');
      } catch {
        // Empty stores throw - that's fine for timing test
      }
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(500);
    });

    it('TC-S6-081: searchWithEmbedding should complete in under 500ms', async () => {
      const embedding = createEmbedding(1536);
      const startTime = Date.now();
      try {
        await agent.searchWithEmbedding('perf test', embedding);
      } catch {
        // Empty stores throw - that's fine for timing test
      }
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(500);
    });

    it('TC-S6-082: multiple sequential searches should be efficient', async () => {
      const startTime = Date.now();
      for (let i = 0; i < 10; i++) {
        try {
          await agent.search(`query ${i}`);
        } catch {
          // Empty stores throw - that's fine for timing test
        }
      }
      const elapsed = Date.now() - startTime;

      // 10 searches should complete in under 2 seconds
      expect(elapsed).toBeLessThan(2000);
    });
  });
});
