/**
 * Graph Source Adapter Tests
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-SEARCH-004
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GraphSourceAdapter } from '../../../src/god-agent/core/search/adapters/graph-adapter.js';
import type { FallbackGraph } from '../../../src/god-agent/core/graph-db/fallback-graph.js';
import type { INode } from '../../../src/god-agent/core/graph-db/types.js';

describe('GraphSourceAdapter', () => {
  let mockGraphDb: FallbackGraph;
  let adapter: GraphSourceAdapter;

  const mockNodes: INode[] = [
    {
      id: 'node1',
      type: 'document',
      properties: { title: 'TypeScript Guide', content: 'Learn TypeScript' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'node2',
      type: 'function',
      properties: { name: 'searchFunction', language: 'typescript' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'node3',
      type: 'concept',
      properties: { name: 'Graph Database' },
      embedding: Array(1536).fill(0.1),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];

  beforeEach(() => {
    mockGraphDb = {
      getAllNodes: vi.fn(),
      getNode: vi.fn(),
      insertNode: vi.fn(),
      updateNode: vi.fn(),
      deleteNode: vi.fn(),
      getEdges: vi.fn(),
      insertEdge: vi.fn(),
      deleteEdge: vi.fn(),
      getAllEdges: vi.fn(),
      getHyperedge: vi.fn(),
      getHyperedgesByNode: vi.fn(),
      insertHyperedge: vi.fn(),
      deleteHyperedge: vi.fn(),
      getAllHyperedges: vi.fn(),
      clear: vi.fn(),
      save: vi.fn(),
      load: vi.fn(),
      nodeExists: vi.fn(),
    } as unknown as FallbackGraph;

    adapter = new GraphSourceAdapter(mockGraphDb);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('search', () => {
    it('should return matching nodes by type', async () => {
      vi.mocked(mockGraphDb.getAllNodes).mockResolvedValue(mockNodes);

      const result = await adapter.search('document', 2, 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results.length).toBeGreaterThan(0);
        const matchingResult = result.results.find((r) =>
          r.content.includes('document')
        );
        expect(matchingResult).toBeDefined();
      }
    });

    it('should return matching nodes by ID', async () => {
      vi.mocked(mockGraphDb.getAllNodes).mockResolvedValue(mockNodes);

      const result = await adapter.search('node1', 2, 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results.length).toBeGreaterThan(0);
      }
    });

    it('should return matching nodes by property content', async () => {
      vi.mocked(mockGraphDb.getAllNodes).mockResolvedValue(mockNodes);

      const result = await adapter.search('typescript', 2, 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results.length).toBeGreaterThan(0);
      }
    });

    it('should return empty results for empty query', async () => {
      const result = await adapter.search('', 2, 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results).toHaveLength(0);
      }
      expect(mockGraphDb.getAllNodes).not.toHaveBeenCalled();
    });

    it('should return empty results for whitespace query', async () => {
      const result = await adapter.search('   ', 2, 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results).toHaveLength(0);
      }
    });

    it('should return empty results when no nodes match', async () => {
      vi.mocked(mockGraphDb.getAllNodes).mockResolvedValue(mockNodes);

      const result = await adapter.search('nonexistent', 2, 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results).toHaveLength(0);
      }
    });

    it('should sort results by score descending', async () => {
      vi.mocked(mockGraphDb.getAllNodes).mockResolvedValue(mockNodes);

      const result = await adapter.search('typescript', 10, 400);

      expect(result.status).toBe('success');
      if (result.status === 'success' && result.results.length > 1) {
        for (let i = 1; i < result.results.length; i++) {
          expect(result.results[i - 1].score).toBeGreaterThanOrEqual(
            result.results[i].score
          );
        }
      }
    });

    it('should include node metadata in results', async () => {
      vi.mocked(mockGraphDb.getAllNodes).mockResolvedValue(mockNodes);

      const result = await adapter.search('document', 2, 400);

      expect(result.status).toBe('success');
      if (result.status === 'success' && result.results.length > 0) {
        expect(result.results[0].metadata).toMatchObject({
          nodeId: expect.any(String),
          nodeType: expect.any(String),
          createdAt: expect.any(Number),
        });
      }
    });

    it('should indicate when node has embedding', async () => {
      vi.mocked(mockGraphDb.getAllNodes).mockResolvedValue(mockNodes);

      const result = await adapter.search('graph', 2, 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        const nodeWithEmbedding = result.results.find(
          (r) => r.metadata?.hasEmbedding === true
        );
        expect(nodeWithEmbedding).toBeDefined();
      }
    });

    it('should handle getAllNodes error gracefully', async () => {
      vi.mocked(mockGraphDb.getAllNodes).mockRejectedValue(
        new Error('Database error')
      );

      const result = await adapter.search('test', 2, 400);

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error).toContain('Database error');
      }
    });

    it('should format content correctly', async () => {
      vi.mocked(mockGraphDb.getAllNodes).mockResolvedValue(mockNodes);

      const result = await adapter.search('document', 2, 400);

      expect(result.status).toBe('success');
      if (result.status === 'success' && result.results.length > 0) {
        expect(result.results[0].content).toContain('Node:');
        expect(result.results[0].content).toContain('Type:');
      }
    });

    it('should be case-insensitive', async () => {
      vi.mocked(mockGraphDb.getAllNodes).mockResolvedValue(mockNodes);

      const resultLower = await adapter.search('typescript', 2, 400);
      const resultUpper = await adapter.search('TYPESCRIPT', 2, 400);

      expect(resultLower.status).toBe('success');
      expect(resultUpper.status).toBe('success');
      if (resultLower.status === 'success' && resultUpper.status === 'success') {
        expect(resultLower.results.length).toBe(resultUpper.results.length);
      }
    });
  });
});
