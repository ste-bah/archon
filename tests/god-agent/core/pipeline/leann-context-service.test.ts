/**
 * LEANN Context Service Tests
 * Tests for semantic code search and persistence
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-LEANN-PERSISTENCE-TESTS
 *
 * @module tests/god-agent/core/pipeline/leann-context-service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LeannContextService,
  createLeannContextService,
} from '../../../../src/god-agent/core/pipeline/leann-context-service.js';
import type { LEANNSourceAdapter } from '../../../../src/god-agent/core/search/adapters/leann-adapter.js';

describe('LeannContextService', () => {
  let service: LeannContextService;
  let mockAdapter: Partial<LEANNSourceAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter = {
      searchByText: vi.fn().mockResolvedValue({
        status: 'success',
        results: [],
        durationMs: 10,
      }),
      save: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(true),
      count: vi.fn().mockReturnValue(10),
      name: 'leann',
    };
    service = createLeannContextService();
  });

  describe('initialization', () => {
    it('should start uninitialized', () => {
      expect(service.isInitialized()).toBe(false);
    });

    it('should initialize with valid adapter', async () => {
      await service.initialize(mockAdapter as LEANNSourceAdapter);
      expect(service.isInitialized()).toBe(true);
    });

    it('should throw on initialize with null adapter', async () => {
      await expect(service.initialize(null as unknown as LEANNSourceAdapter))
        .rejects.toThrow('LEANNSourceAdapter is required for initialization');
    });

    it('should expose adapter via getAdapter after initialization', async () => {
      await service.initialize(mockAdapter as LEANNSourceAdapter);
      expect(service.getAdapter()).toBe(mockAdapter);
    });

    it('should return undefined from getAdapter before initialization', () => {
      expect(service.getAdapter()).toBeUndefined();
    });
  });

  describe('persistence methods', () => {
    it('should throw ERR-001 when save called without adapter', async () => {
      await expect(service.save('/path/to/file'))
        .rejects.toThrow('Cannot save: LEANN adapter not initialized (ERR-001)');
    });

    it('should throw ERR-001 when load called without adapter', async () => {
      await expect(service.load('/path/to/file'))
        .rejects.toThrow('Cannot load: LEANN adapter not initialized (ERR-001)');
    });

    it('should delegate save to adapter after initialization', async () => {
      await service.initialize(mockAdapter as LEANNSourceAdapter);
      await service.save('/path/to/file');
      expect(mockAdapter.save).toHaveBeenCalledWith('/path/to/file', undefined);
    });

    it('should delegate load to adapter after initialization', async () => {
      await service.initialize(mockAdapter as LEANNSourceAdapter);
      const result = await service.load('/path/to/file');
      expect(mockAdapter.load).toHaveBeenCalledWith('/path/to/file', undefined);
      expect(result).toBe(true);
    });

    it('should pass timeout to adapter save', async () => {
      await service.initialize(mockAdapter as LEANNSourceAdapter);
      await service.save('/path/to/file', 5000);
      expect(mockAdapter.save).toHaveBeenCalledWith('/path/to/file', 5000);
    });

    it('should pass timeout to adapter load', async () => {
      await service.initialize(mockAdapter as LEANNSourceAdapter);
      const result = await service.load('/path/to/file', 5000);
      expect(mockAdapter.load).toHaveBeenCalledWith('/path/to/file', 5000);
      expect(result).toBe(true);
    });

    it('should return false from load when adapter returns false', async () => {
      mockAdapter.load = vi.fn().mockResolvedValue(false);
      await service.initialize(mockAdapter as LEANNSourceAdapter);
      const result = await service.load('/nonexistent/path');
      expect(result).toBe(false);
    });

    it('should return vector count when adapter initialized', async () => {
      await service.initialize(mockAdapter as LEANNSourceAdapter);
      expect(service.getVectorCount()).toBe(10);
    });

    it('should return 0 vector count when adapter not initialized', () => {
      expect(service.getVectorCount()).toBe(0);
    });
  });

  describe('search operations', () => {
    it('should return empty array when not initialized', async () => {
      const results = await service.searchCodeContext('test query');
      expect(results).toEqual([]);
    });

    it('should delegate search to adapter after initialization', async () => {
      await service.initialize(mockAdapter as LEANNSourceAdapter);
      await service.searchCodeContext('test query', 5, 1000);
      expect(mockAdapter.searchByText).toHaveBeenCalledWith('test query', 5, 1000);
    });

    it('should transform results correctly', async () => {
      mockAdapter.searchByText = vi.fn().mockResolvedValue({
        status: 'success',
        results: [
          {
            source: 'vector',
            id: 'test-1',
            content: 'function test() {}',
            score: 0.85,
            metadata: {
              vectorId: 'vec-1',
              filePath: '/src/test.ts',
              language: 'typescript',
            },
          },
        ],
        durationMs: 15,
      });
      await service.initialize(mockAdapter as LEANNSourceAdapter);
      const results = await service.searchCodeContext('test');

      expect(results).toHaveLength(1);
      expect(results[0].filePath).toBe('/src/test.ts');
      expect(results[0].similarity).toBe(0.85);
      expect(results[0].language).toBe('typescript');
    });

    it('should return empty array on search error', async () => {
      mockAdapter.searchByText = vi.fn().mockRejectedValue(new Error('Search failed'));
      await service.initialize(mockAdapter as LEANNSourceAdapter);
      const results = await service.searchCodeContext('test query');
      expect(results).toEqual([]);
    });

    it('should return empty array on non-success status', async () => {
      mockAdapter.searchByText = vi.fn().mockResolvedValue({
        status: 'error',
        error: 'Something went wrong',
        durationMs: 5,
      });
      await service.initialize(mockAdapter as LEANNSourceAdapter);
      const results = await service.searchCodeContext('test query');
      expect(results).toEqual([]);
    });
  });

  describe('buildSemanticContext', () => {
    beforeEach(async () => {
      mockAdapter.searchByText = vi.fn().mockResolvedValue({
        status: 'success',
        results: [
          {
            source: 'vector',
            id: 'test-1',
            content: 'auth code',
            score: 0.75,
            metadata: { filePath: '/src/auth.ts' },
          },
          {
            source: 'vector',
            id: 'test-2',
            content: 'login code',
            score: 0.25,
            metadata: { filePath: '/src/login.ts' },
          },
        ],
        durationMs: 20,
      });
      await service.initialize(mockAdapter as LEANNSourceAdapter);
    });

    it('should build context from task description', async () => {
      const context = await service.buildSemanticContext({
        taskDescription: 'implement user authentication',
        phase: 1,
      });

      expect(context.searchQuery).toBe('implement user authentication');
      expect(context.totalResults).toBeGreaterThanOrEqual(0);
    });

    it('should filter results below similarity threshold (0.3 default)', async () => {
      const context = await service.buildSemanticContext({
        taskDescription: 'test query',
        phase: 1,
      });

      // Only the 0.75 score result should pass the 0.3 threshold
      expect(context.codeContext.length).toBe(1);
      expect(context.codeContext[0].similarity).toBe(0.75);
    });

    it('should respect maxResults parameter', async () => {
      const context = await service.buildSemanticContext({
        taskDescription: 'test query',
        phase: 1,
        maxResults: 1,
      });

      expect(mockAdapter.searchByText).toHaveBeenCalledWith(
        expect.any(String),
        1,
        expect.any(Number)
      );
    });

    it('should enrich query with previous output context', async () => {
      const context = await service.buildSemanticContext({
        taskDescription: 'implement feature',
        phase: 2,
        previousOutput: { type: 'UserAuth', name: 'LoginService' },
      });

      // Query should include terms from previousOutput
      expect(context.searchQuery).toContain('implement feature');
    });
  });

  describe('configuration', () => {
    it('should use default config values', () => {
      const defaultService = createLeannContextService();
      expect(defaultService.getVectorCount()).toBe(0);
    });

    it('should accept custom config', async () => {
      const customService = createLeannContextService({
        defaultMaxResults: 10,
        defaultTimeoutMs: 10000,
        minSimilarityThreshold: 0.5,
      });

      mockAdapter.searchByText = vi.fn().mockResolvedValue({
        status: 'success',
        results: [
          { source: 'vector', id: '1', content: 'a', score: 0.4, metadata: {} },
          { source: 'vector', id: '2', content: 'b', score: 0.6, metadata: {} },
        ],
        durationMs: 10,
      });
      await customService.initialize(mockAdapter as LEANNSourceAdapter);

      const context = await customService.buildSemanticContext({
        taskDescription: 'test',
        phase: 1,
      });

      // With minSimilarityThreshold of 0.5, only score 0.6 should pass
      expect(context.codeContext.length).toBe(1);
      expect(context.codeContext[0].similarity).toBe(0.6);
    });
  });

  describe('language inference', () => {
    beforeEach(async () => {
      await service.initialize(mockAdapter as LEANNSourceAdapter);
    });

    it('should infer TypeScript from .ts extension', async () => {
      mockAdapter.searchByText = vi.fn().mockResolvedValue({
        status: 'success',
        results: [
          {
            source: 'vector',
            id: '1',
            content: 'code',
            score: 0.8,
            metadata: { filePath: '/src/file.ts' },
          },
        ],
        durationMs: 5,
      });

      const results = await service.searchCodeContext('query');
      expect(results[0].language).toBe('typescript');
    });

    it('should infer Python from .py extension', async () => {
      mockAdapter.searchByText = vi.fn().mockResolvedValue({
        status: 'success',
        results: [
          {
            source: 'vector',
            id: '1',
            content: 'code',
            score: 0.8,
            metadata: { filePath: '/src/script.py' },
          },
        ],
        durationMs: 5,
      });

      const results = await service.searchCodeContext('query');
      expect(results[0].language).toBe('python');
    });

    it('should use explicit language from metadata over inference', async () => {
      mockAdapter.searchByText = vi.fn().mockResolvedValue({
        status: 'success',
        results: [
          {
            source: 'vector',
            id: '1',
            content: 'code',
            score: 0.8,
            metadata: { filePath: '/src/file.txt', language: 'go' },
          },
        ],
        durationMs: 5,
      });

      const results = await service.searchCodeContext('query');
      expect(results[0].language).toBe('go');
    });
  });

  describe('file path extraction', () => {
    beforeEach(async () => {
      await service.initialize(mockAdapter as LEANNSourceAdapter);
    });

    it('should extract filePath from metadata', async () => {
      mockAdapter.searchByText = vi.fn().mockResolvedValue({
        status: 'success',
        results: [
          {
            source: 'vector',
            id: '1',
            content: 'code',
            score: 0.8,
            metadata: { filePath: '/src/main.ts' },
          },
        ],
        durationMs: 5,
      });

      const results = await service.searchCodeContext('query');
      expect(results[0].filePath).toBe('/src/main.ts');
    });

    it('should fallback to vectorId when filePath missing', async () => {
      mockAdapter.searchByText = vi.fn().mockResolvedValue({
        status: 'success',
        results: [
          {
            source: 'vector',
            id: '1',
            content: 'code',
            score: 0.8,
            metadata: { vectorId: 'vec-123' },
          },
        ],
        durationMs: 5,
      });

      const results = await service.searchCodeContext('query');
      expect(results[0].filePath).toBe('vec-123');
    });

    it('should return "unknown" when no path info available', async () => {
      mockAdapter.searchByText = vi.fn().mockResolvedValue({
        status: 'success',
        results: [
          {
            source: 'vector',
            id: '1',
            content: 'code',
            score: 0.8,
            metadata: {},
          },
        ],
        durationMs: 5,
      });

      const results = await service.searchCodeContext('query');
      expect(results[0].filePath).toBe('unknown');
    });
  });

  describe('content extraction', () => {
    beforeEach(async () => {
      await service.initialize(mockAdapter as LEANNSourceAdapter);
    });

    it('should extract content from metadata.content', async () => {
      mockAdapter.searchByText = vi.fn().mockResolvedValue({
        status: 'success',
        results: [
          {
            source: 'vector',
            id: '1',
            content: 'fallback',
            score: 0.8,
            metadata: { content: 'metadata content' },
          },
        ],
        durationMs: 5,
      });

      const results = await service.searchCodeContext('query');
      expect(results[0].content).toBe('metadata content');
    });

    it('should fallback to metadata.chunk', async () => {
      mockAdapter.searchByText = vi.fn().mockResolvedValue({
        status: 'success',
        results: [
          {
            source: 'vector',
            id: '1',
            content: 'fallback',
            score: 0.8,
            metadata: { chunk: 'chunk content' },
          },
        ],
        durationMs: 5,
      });

      const results = await service.searchCodeContext('query');
      expect(results[0].content).toBe('chunk content');
    });

    it('should fallback to result.content when no metadata content', async () => {
      mockAdapter.searchByText = vi.fn().mockResolvedValue({
        status: 'success',
        results: [
          {
            source: 'vector',
            id: '1',
            content: 'result content',
            score: 0.8,
            metadata: {},
          },
        ],
        durationMs: 5,
      });

      const results = await service.searchCodeContext('query');
      expect(results[0].content).toBe('result content');
    });
  });
});
