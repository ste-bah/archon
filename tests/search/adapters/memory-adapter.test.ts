/**
 * Memory Source Adapter Tests
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-SEARCH-004
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemorySourceAdapter } from '../../../src/god-agent/core/search/adapters/memory-adapter.js';
import type { MemoryClient } from '../../../src/god-agent/core/memory-server/memory-client.js';
import type {
  IQueryPatternsResult,
  IPatternMatch,
} from '../../../src/god-agent/core/types/memory-types.js';

describe('MemorySourceAdapter', () => {
  let mockMemoryClient: MemoryClient;
  let adapter: MemorySourceAdapter;

  const mockPatterns: IPatternMatch[] = [
    {
      id: 'pattern1',
      confidence: 0.9,
      content: 'First matching pattern',
      metadata: { category: 'code' },
    },
    {
      id: 'pattern2',
      confidence: 0.7,
      content: 'Second matching pattern',
      metadata: { category: 'docs' },
    },
  ];

  const mockQueryResult: IQueryPatternsResult = {
    patterns: mockPatterns,
    totalMatches: 2,
    queryTimeMs: 15,
  };

  beforeEach(() => {
    mockMemoryClient = {
      isConnected: vi.fn().mockReturnValue(true),
      queryPatterns: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      storeKnowledge: vi.fn(),
      getKnowledgeByDomain: vi.fn(),
      getKnowledgeByTags: vi.fn(),
      deleteKnowledge: vi.fn(),
      provideFeedback: vi.fn(),
      getStatus: vi.fn(),
      ping: vi.fn(),
    } as unknown as MemoryClient;

    adapter = new MemorySourceAdapter(mockMemoryClient);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('search', () => {
    it('should return success with patterns when search succeeds', async () => {
      vi.mocked(mockMemoryClient.queryPatterns).mockResolvedValue(mockQueryResult);

      const result = await adapter.search('test query', 'default', 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results).toHaveLength(2);
        expect(result.results[0].source).toBe('memory');
        expect(result.results[0].content).toBe('First matching pattern');
        expect(result.results[0].score).toBe(0.9);
      }
    });

    it('should include pattern metadata in results', async () => {
      vi.mocked(mockMemoryClient.queryPatterns).mockResolvedValue(mockQueryResult);

      const result = await adapter.search('test', 'default', 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results[0].metadata).toMatchObject({
          patternId: 'pattern1',
          originalConfidence: 0.9,
          category: 'code',
        });
      }
    });

    it('should return empty results for empty query', async () => {
      const result = await adapter.search('', 'default', 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results).toHaveLength(0);
      }
      expect(mockMemoryClient.queryPatterns).not.toHaveBeenCalled();
    });

    it('should return empty results for whitespace query', async () => {
      const result = await adapter.search('   ', 'default', 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results).toHaveLength(0);
      }
    });

    it('should return empty results when not connected', async () => {
      vi.mocked(mockMemoryClient.isConnected).mockReturnValue(false);

      const result = await adapter.search('test', 'default', 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results).toHaveLength(0);
      }
      expect(mockMemoryClient.queryPatterns).not.toHaveBeenCalled();
    });

    it('should handle connection error gracefully', async () => {
      vi.mocked(mockMemoryClient.queryPatterns).mockRejectedValue(
        new Error('not connected')
      );

      const result = await adapter.search('test', 'default', 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results).toHaveLength(0);
      }
    });

    it('should handle disconnected error gracefully', async () => {
      vi.mocked(mockMemoryClient.queryPatterns).mockRejectedValue(
        new Error('Server disconnected')
      );

      const result = await adapter.search('test', 'default', 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results).toHaveLength(0);
      }
    });

    it('should return error for non-connection errors', async () => {
      vi.mocked(mockMemoryClient.queryPatterns).mockRejectedValue(
        new Error('Invalid query format')
      );

      const result = await adapter.search('test', 'default', 400);

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error).toContain('Invalid query format');
      }
    });

    it('should pass correct parameters to queryPatterns', async () => {
      vi.mocked(mockMemoryClient.queryPatterns).mockResolvedValue({
        patterns: [],
        totalMatches: 0,
        queryTimeMs: 5,
      });

      await adapter.search('my query', 'custom-ns', 400);

      expect(mockMemoryClient.queryPatterns).toHaveBeenCalledWith({
        query: 'my query',
        type: 'semantic',
        maxResults: 20,
        confidenceThreshold: 0.3,
      });
    });

    it('should track duration accurately', async () => {
      vi.mocked(mockMemoryClient.queryPatterns).mockResolvedValue(mockQueryResult);

      const result = await adapter.search('test', 'default', 400);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should generate unique result IDs', async () => {
      vi.mocked(mockMemoryClient.queryPatterns).mockResolvedValue(mockQueryResult);

      const result = await adapter.search('test', 'default', 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        const ids = result.results.map((r) => r.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
      }
    });

    it('should handle empty patterns array', async () => {
      vi.mocked(mockMemoryClient.queryPatterns).mockResolvedValue({
        patterns: [],
        totalMatches: 0,
        queryTimeMs: 5,
      });

      const result = await adapter.search('no matches', 'default', 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results).toHaveLength(0);
      }
    });
  });
});
