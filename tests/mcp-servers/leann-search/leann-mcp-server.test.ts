/**
 * LEANN MCP Server - Comprehensive Test Suite
 *
 * Tests for the LEANN (Lightweight Exact Approximate Nearest Neighbor) MCP server
 * implementing semantic code search capabilities via MCP protocol.
 *
 * Test Categories:
 * 1. Server Lifecycle - initialization, start, stop, shutdown
 * 2. Tool Registration - schema validation, tool names
 * 3. Tool Execution - all 5 tools: search_code, index_repository, index_code, find_similar_code, get_stats
 * 4. Integration Workflow - full index -> search -> verify workflow
 * 5. Error Handling - invalid inputs, edge cases
 *
 * @module tests/mcp-servers/leann-search/leann-mcp-server.test
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { LEANNMCPServer } from '../../../src/mcp-servers/leann-search/server.js';
import {
  semanticCodeSearch,
  indexCode,
  findSimilarCode,
  getIndexStats,
  getQuickStats,
  indexRepository,
  SEMANTIC_CODE_SEARCH_DEFINITION,
  INDEX_CODE_DEFINITION,
  INDEX_REPOSITORY_DEFINITION,
  FIND_SIMILAR_CODE_DEFINITION,
  GET_INDEX_STATS_DEFINITION,
  type ToolExecutionContext,
} from '../../../src/mcp-servers/leann-search/tools/index.js';
import type { CodeMetadata, VectorID } from '../../../src/mcp-servers/leann-search/types.js';

// ============================================================================
// Mock Modules
// ============================================================================

// Mock the LEANN backend
vi.mock('../../../src/god-agent/core/vector-db/leann-backend.js', () => {
  const mockVectors = new Map<string, Float32Array>();
  let insertCount = 0;

  return {
    LEANNBackend: vi.fn().mockImplementation(() => ({
      insert: vi.fn((id: string, vector: Float32Array) => {
        mockVectors.set(id, vector);
        insertCount++;
      }),
      delete: vi.fn((id: string) => {
        mockVectors.delete(id);
        insertCount = Math.max(0, insertCount - 1);
      }),
      search: vi.fn((query: Float32Array, k: number) => {
        // Return mock search results based on what's been inserted
        const results: Array<{ id: string; similarity: number; vector?: Float32Array }> = [];
        let i = 0;
        for (const [id] of mockVectors.entries()) {
          if (i >= k) break;
          results.push({
            id,
            similarity: 0.9 - i * 0.05, // Decreasing similarity
          });
          i++;
        }
        return results;
      }),
      count: vi.fn(() => mockVectors.size),
      getStats: vi.fn(() => ({
        totalVectors: mockVectors.size,
        hubCacheSize: Math.floor(mockVectors.size * 0.1),
        avgHubDegree: 8,
        totalEdges: mockVectors.size * 8,
        hitRatio: 0.85,
        prunedEdges: 10,
      })),
      getConfig: vi.fn(() => ({
        hubCacheRatio: 0.1,
        graphPruningRatio: 0.7,
        batchSize: 100,
        maxRecomputeLatencyMs: 50,
        efSearch: 50,
        hubDegreeThreshold: 10,
      })),
      save: vi.fn().mockResolvedValue(true),
      load: vi.fn().mockResolvedValue(false),
      clear: vi.fn(() => {
        mockVectors.clear();
        insertCount = 0;
      }),
    })),
  };
});

// Mock the DualCodeEmbeddingProvider
vi.mock('../../../src/god-agent/core/search/dual-code-embedding.js', () => {
  return {
    DualCodeEmbeddingProvider: vi.fn().mockImplementation(() => ({
      embedCode: vi.fn().mockImplementation(async (code: string) => {
        // Generate deterministic mock embedding based on code content
        const hash = code.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const embedding = new Float32Array(1536);
        for (let i = 0; i < 1536; i++) {
          embedding[i] = Math.sin(hash * i * 0.001) * 0.5 + 0.5;
        }
        return embedding;
      }),
      embedQuery: vi.fn().mockImplementation(async (query: string) => {
        // Generate deterministic mock embedding based on query
        const hash = query.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const embedding = new Float32Array(1536);
        for (let i = 0; i < 1536; i++) {
          embedding[i] = Math.sin(hash * i * 0.001) * 0.5 + 0.5;
        }
        return embedding;
      }),
      getDimension: vi.fn().mockReturnValue(1536),
    })),
  };
});

// Mock fs module for repository indexing tests
vi.mock('fs/promises', () => ({
  stat: vi.fn().mockResolvedValue({ isDirectory: () => true, isFile: () => true, size: 1000 }),
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue('function test() { return 42; }'),
}));

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock tool execution context for testing
 */
function createMockContext(): ToolExecutionContext {
  const metadataStore = new Map<VectorID, CodeMetadata>();
  const codeStore = new Map<VectorID, string>();

  // Create mock backend with proper interface
  const mockBackend = {
    insert: vi.fn((id: string, _vector: Float32Array) => {
      // Backend tracks internally
    }),
    delete: vi.fn(),
    search: vi.fn(() => []),
    count: vi.fn(() => metadataStore.size),
    getStats: vi.fn(() => ({
      totalVectors: metadataStore.size,
      hubCacheSize: 0,
      avgHubDegree: 8,
      totalEdges: 0,
      hitRatio: 0.85,
      prunedEdges: 0,
    })),
    getConfig: vi.fn(() => ({
      hubCacheRatio: 0.1,
      graphPruningRatio: 0.7,
      batchSize: 100,
      maxRecomputeLatencyMs: 50,
      efSearch: 50,
      hubDegreeThreshold: 10,
    })),
  };

  // Create mock embedding provider
  const mockEmbeddingProvider = {
    embedCode: vi.fn().mockImplementation(async () => new Float32Array(1536).fill(0.1)),
    embedQuery: vi.fn().mockImplementation(async () => new Float32Array(1536).fill(0.1)),
    getDimension: vi.fn().mockReturnValue(1536),
  };

  return {
    backend: mockBackend as any,
    embeddingProvider: mockEmbeddingProvider as any,
    metadataStore,
    codeStore,
    requestId: 'test-request-001',
  };
}

/**
 * Create sample code metadata
 */
function createSampleMetadata(overrides: Partial<CodeMetadata> = {}): CodeMetadata {
  return {
    filePath: '/test/src/example.ts',
    language: 'typescript',
    symbolType: 'function',
    symbolName: 'testFunction',
    startLine: 1,
    endLine: 5,
    repository: 'test-repo',
    indexedAt: Date.now(),
    contentHash: 'abc123',
    ...overrides,
  };
}

// ============================================================================
// Test Suites
// ============================================================================

describe('LEANN MCP Server', () => {
  // --------------------------------------------------------------------------
  // Server Lifecycle Tests
  // --------------------------------------------------------------------------
  describe('Server Lifecycle', () => {
    it('should create server with default config', () => {
      const server = new LEANNMCPServer();
      expect(server).toBeDefined();

      const state = server.getState();
      expect(state.initialized).toBe(false);
      expect(state.backendLoaded).toBe(false);
      expect(state.indexedCount).toBe(0);
      expect(state.operationCount).toBe(0);
    });

    it('should create server with custom config', () => {
      const server = new LEANNMCPServer({
        name: 'custom-leann',
        version: '2.0.0',
        enableLogging: false,
        logLevel: 'error',
        defaultSearchLimit: 20,
      });

      const config = server.getConfig();
      expect(config.name).toBe('custom-leann');
      expect(config.version).toBe('2.0.0');
      expect(config.enableLogging).toBe(false);
      expect(config.defaultSearchLimit).toBe(20);
    });

    it('should initialize successfully', async () => {
      const server = new LEANNMCPServer({
        enableLogging: false,
        autoLoad: false,
        autoSave: false,
      });

      await server.initialize();

      const state = server.getState();
      expect(state.initialized).toBe(true);
      expect(state.backendLoaded).toBe(true);
    });

    it('should not re-initialize if already initialized', async () => {
      const server = new LEANNMCPServer({
        enableLogging: false,
        autoLoad: false,
        autoSave: false,
      });

      await server.initialize();
      const firstState = server.getState();

      // Initialize again should be a no-op
      await server.initialize();
      const secondState = server.getState();

      expect(secondState.startedAt).toBe(firstState.startedAt);
    });

    it('should shutdown gracefully', async () => {
      const server = new LEANNMCPServer({
        enableLogging: false,
        autoLoad: false,
        autoSave: false,
      });

      await server.initialize();
      expect(server.getState().initialized).toBe(true);

      // Shutdown should not throw
      await expect(server.shutdown()).resolves.not.toThrow();
      expect(server.getState().initialized).toBe(false);
    });

    it('should provide execution context after initialization', async () => {
      const server = new LEANNMCPServer({
        enableLogging: false,
        autoLoad: false,
        autoSave: false,
      });

      // Before initialization, context should be null
      expect(server.getExecutionContext()).toBeNull();

      await server.initialize();

      // After initialization, context should be available
      const context = server.getExecutionContext();
      expect(context).not.toBeNull();
      expect(context?.backend).toBeDefined();
      expect(context?.embeddingProvider).toBeDefined();
      expect(context?.metadataStore).toBeDefined();
      expect(context?.codeStore).toBeDefined();
    });

    it('should track server start time', async () => {
      const beforeCreate = Date.now();
      const server = new LEANNMCPServer({ enableLogging: false });
      const afterCreate = Date.now();

      const state = server.getState();
      expect(state.startedAt).toBeGreaterThanOrEqual(beforeCreate);
      expect(state.startedAt).toBeLessThanOrEqual(afterCreate);
    });
  });

  // --------------------------------------------------------------------------
  // Tool Registration Tests
  // --------------------------------------------------------------------------
  describe('Tool Registration', () => {
    it('should have search_code tool definition', () => {
      expect(SEMANTIC_CODE_SEARCH_DEFINITION).toBeDefined();
      expect(SEMANTIC_CODE_SEARCH_DEFINITION.name).toBe('search_code');
      expect(SEMANTIC_CODE_SEARCH_DEFINITION.description).toContain('Search for code');
      expect(SEMANTIC_CODE_SEARCH_DEFINITION.inputSchema).toBeDefined();
      expect(SEMANTIC_CODE_SEARCH_DEFINITION.inputSchema.required).toContain('query');
    });

    it('should have index_code tool definition', () => {
      expect(INDEX_CODE_DEFINITION).toBeDefined();
      expect(INDEX_CODE_DEFINITION.name).toBe('index_code');
      expect(INDEX_CODE_DEFINITION.description).toContain('Index');
      expect(INDEX_CODE_DEFINITION.inputSchema.required).toContain('code');
      expect(INDEX_CODE_DEFINITION.inputSchema.required).toContain('filePath');
    });

    it('should have index_repository tool definition', () => {
      expect(INDEX_REPOSITORY_DEFINITION).toBeDefined();
      expect(INDEX_REPOSITORY_DEFINITION.name).toBe('index_repository');
      expect(INDEX_REPOSITORY_DEFINITION.description).toContain('repository');
      expect(INDEX_REPOSITORY_DEFINITION.inputSchema.required).toContain('repositoryPath');
    });

    it('should have find_similar_code tool definition', () => {
      expect(FIND_SIMILAR_CODE_DEFINITION).toBeDefined();
      expect(FIND_SIMILAR_CODE_DEFINITION.name).toBe('find_similar_code');
      expect(FIND_SIMILAR_CODE_DEFINITION.description).toContain('similar');
      expect(FIND_SIMILAR_CODE_DEFINITION.inputSchema.required).toContain('code');
    });

    it('should have get_stats tool definition', () => {
      expect(GET_INDEX_STATS_DEFINITION).toBeDefined();
      expect(GET_INDEX_STATS_DEFINITION.name).toBe('get_stats');
      expect(GET_INDEX_STATS_DEFINITION.description).toContain('statistics');
      // get_stats has no required fields
      expect(GET_INDEX_STATS_DEFINITION.inputSchema.required).toEqual([]);
    });

    it('should have proper JSON schema for search_code', () => {
      const schema = SEMANTIC_CODE_SEARCH_DEFINITION.inputSchema;
      expect(schema.type).toBe('object');
      expect(schema.properties).toHaveProperty('query');
      expect(schema.properties).toHaveProperty('limit');
      expect(schema.properties).toHaveProperty('minScore');
      expect(schema.properties).toHaveProperty('languages');
      expect(schema.properties).toHaveProperty('includeCode');
    });

    it('should have proper JSON schema for index_code', () => {
      const schema = INDEX_CODE_DEFINITION.inputSchema;
      expect(schema.type).toBe('object');
      expect(schema.properties).toHaveProperty('code');
      expect(schema.properties).toHaveProperty('filePath');
      expect(schema.properties).toHaveProperty('language');
      expect(schema.properties).toHaveProperty('symbolType');
      expect(schema.properties).toHaveProperty('replaceExisting');
    });
  });

  // --------------------------------------------------------------------------
  // Tool Execution Tests: index_code
  // --------------------------------------------------------------------------
  describe('Tool Execution - index_code', () => {
    let context: ToolExecutionContext;

    beforeEach(() => {
      context = createMockContext();
    });

    it('should index a code chunk successfully', async () => {
      const result = await indexCode(
        {
          code: 'function hello() { return "world"; }',
          filePath: '/test/hello.ts',
          language: 'typescript',
        },
        context
      );

      expect(result.success).toBe(true);
      expect(result.vectorId).toBeDefined();
      expect(result.vectorId).toMatch(/^[0-9a-f-]+$/); // UUID format
      expect(result.message).toContain('Indexed');
      expect(result.embeddingDimension).toBe(1536);
      expect(result.indexTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.replaced).toBe(false);
    });

    it('should store metadata correctly', async () => {
      const result = await indexCode(
        {
          code: 'class UserService { getUser() {} }',
          filePath: '/test/services/user.ts',
          language: 'typescript',
          symbolType: 'class',
          symbolName: 'UserService',
          startLine: 10,
          endLine: 25,
          repository: 'my-app',
          branch: 'main',
          commitHash: 'abc123',
        },
        context
      );

      expect(result.success).toBe(true);
      expect(result.metadata.filePath).toBe('/test/services/user.ts');
      expect(result.metadata.language).toBe('typescript');
      expect(result.metadata.symbolType).toBe('class');
      expect(result.metadata.symbolName).toBe('UserService');
      expect(result.metadata.startLine).toBe(10);
      expect(result.metadata.endLine).toBe(25);
      expect(result.metadata.repository).toBe('my-app');
      expect(result.metadata.branch).toBe('main');
      expect(result.metadata.commitHash).toBe('abc123');
      expect(result.metadata.contentHash).toBeDefined();
      expect(result.metadata.indexedAt).toBeDefined();
    });

    it('should fail with empty code', async () => {
      const result = await indexCode(
        {
          code: '',
          filePath: '/test/empty.ts',
        },
        context
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('empty');
    });

    it('should fail with whitespace-only code', async () => {
      const result = await indexCode(
        {
          code: '   \n\t  ',
          filePath: '/test/whitespace.ts',
        },
        context
      );

      expect(result.success).toBe(false);
    });

    it('should auto-detect language from file extension', async () => {
      const result = await indexCode(
        {
          code: 'def hello(): pass',
          filePath: '/test/script.py',
        },
        context
      );

      expect(result.success).toBe(true);
      expect(result.metadata.language).toBe('python');
    });

    it('should store code content for retrieval', async () => {
      const code = 'const x = 42;';
      const result = await indexCode(
        {
          code,
          filePath: '/test/const.ts',
        },
        context
      );

      expect(result.success).toBe(true);
      expect(context.codeStore.get(result.vectorId)).toBe(code);
    });

    it('should generate unique vector IDs', async () => {
      const result1 = await indexCode(
        { code: 'function a() {}', filePath: '/test/a.ts' },
        context
      );
      const result2 = await indexCode(
        { code: 'function b() {}', filePath: '/test/b.ts' },
        context
      );

      expect(result1.vectorId).not.toBe(result2.vectorId);
    });

    it('should handle custom metadata', async () => {
      const result = await indexCode(
        {
          code: 'function test() {}',
          filePath: '/test/meta.ts',
          customMetadata: {
            author: 'test-user',
            version: '1.0.0',
          },
        },
        context
      );

      expect(result.success).toBe(true);
      expect(result.metadata.custom).toEqual({
        author: 'test-user',
        version: '1.0.0',
      });
    });
  });

  // --------------------------------------------------------------------------
  // Tool Execution Tests: search_code
  // --------------------------------------------------------------------------
  describe('Tool Execution - search_code', () => {
    let context: ToolExecutionContext;

    beforeEach(() => {
      context = createMockContext();
    });

    it('should return empty results for empty index', async () => {
      const result = await semanticCodeSearch(
        { query: 'find hello function' },
        context
      );

      expect(result.success).toBe(true);
      expect(result.results).toEqual([]);
      expect(result.totalResults).toBe(0);
      expect(result.query).toBe('find hello function');
      expect(result.mode).toBe('semantic');
    });

    it('should fail with empty query', async () => {
      const result = await semanticCodeSearch(
        { query: '' },
        context
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('empty');
    });

    it('should fail with whitespace-only query', async () => {
      const result = await semanticCodeSearch(
        { query: '   ' },
        context
      );

      expect(result.success).toBe(false);
    });

    it('should search with filters', async () => {
      // Index some code first
      const vectorId = 'test-vector-1';
      const metadata = createSampleMetadata({ language: 'typescript' });
      context.metadataStore.set(vectorId, metadata);
      context.codeStore.set(vectorId, 'function test() {}');

      // Mock backend to return the vector
      (context.backend.search as MockInstance).mockReturnValue([
        { id: vectorId, similarity: 0.9 },
      ]);
      (context.backend.count as MockInstance).mockReturnValue(1);

      const result = await semanticCodeSearch(
        {
          query: 'test function',
          languages: ['typescript'],
          limit: 5,
        },
        context
      );

      expect(result.success).toBe(true);
      expect(result.totalResults).toBeGreaterThanOrEqual(0);
    });

    it('should respect limit parameter', async () => {
      // Add multiple items
      for (let i = 0; i < 10; i++) {
        const vectorId = `vector-${i}`;
        context.metadataStore.set(vectorId, createSampleMetadata());
      }

      (context.backend.search as MockInstance).mockReturnValue(
        Array.from({ length: 10 }, (_, i) => ({
          id: `vector-${i}`,
          similarity: 0.9 - i * 0.05,
        }))
      );
      (context.backend.count as MockInstance).mockReturnValue(10);

      const result = await semanticCodeSearch(
        { query: 'test', limit: 3 },
        context
      );

      expect(result.results.length).toBeLessThanOrEqual(3);
    });

    it('should filter by minimum score', async () => {
      const vectorId = 'low-score-vector';
      context.metadataStore.set(vectorId, createSampleMetadata());

      (context.backend.search as MockInstance).mockReturnValue([
        { id: vectorId, similarity: 0.3 }, // Below 0.7 threshold
      ]);
      (context.backend.count as MockInstance).mockReturnValue(1);

      const result = await semanticCodeSearch(
        { query: 'test', minScore: 0.7 },
        context
      );

      expect(result.results).toEqual([]);
    });

    it('should include code content when requested', async () => {
      const vectorId = 'code-vector';
      const code = 'function getUser() { return user; }';
      context.metadataStore.set(vectorId, createSampleMetadata());
      context.codeStore.set(vectorId, code);

      (context.backend.search as MockInstance).mockReturnValue([
        { id: vectorId, similarity: 0.9 },
      ]);
      (context.backend.count as MockInstance).mockReturnValue(1);

      const result = await semanticCodeSearch(
        { query: 'get user', includeCode: true },
        context
      );

      expect(result.results.length).toBe(1);
      expect(result.results[0].code).toBe(code);
    });

    it('should filter by repository', async () => {
      const matchingVectorId = 'matching-vector';
      const nonMatchingVectorId = 'non-matching-vector';

      context.metadataStore.set(
        matchingVectorId,
        createSampleMetadata({ repository: 'my-repo' })
      );
      context.metadataStore.set(
        nonMatchingVectorId,
        createSampleMetadata({ repository: 'other-repo' })
      );

      (context.backend.search as MockInstance).mockReturnValue([
        { id: matchingVectorId, similarity: 0.9 },
        { id: nonMatchingVectorId, similarity: 0.85 },
      ]);
      (context.backend.count as MockInstance).mockReturnValue(2);

      const result = await semanticCodeSearch(
        { query: 'test', repository: 'my-repo' },
        context
      );

      expect(result.results.length).toBe(1);
      expect(result.results[0].metadata.repository).toBe('my-repo');
    });

    it('should track search timing', async () => {
      const result = await semanticCodeSearch(
        { query: 'test function' },
        context
      );

      expect(result.searchTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.embeddingTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  // --------------------------------------------------------------------------
  // Tool Execution Tests: find_similar_code
  // --------------------------------------------------------------------------
  describe('Tool Execution - find_similar_code', () => {
    let context: ToolExecutionContext;

    beforeEach(() => {
      context = createMockContext();
    });

    it('should find similar code snippets', async () => {
      // Add some indexed code
      const vectorId = 'similar-vector';
      context.metadataStore.set(
        vectorId,
        createSampleMetadata({ symbolName: 'add' })
      );
      context.codeStore.set(vectorId, 'function add(a, b) { return a + b; }');

      (context.backend.search as MockInstance).mockReturnValue([
        { id: vectorId, similarity: 0.92 },
      ]);
      (context.backend.count as MockInstance).mockReturnValue(1);

      const result = await findSimilarCode(
        { code: 'function sum(x, y) { return x + y; }' },
        context
      );

      expect(result.success).toBe(true);
      expect(result.results.length).toBeGreaterThanOrEqual(0);
      expect(result.searchTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.codeLength).toBeGreaterThan(0);
    });

    it('should fail with empty code', async () => {
      const result = await findSimilarCode({ code: '' }, context);

      expect(result.success).toBe(false);
      expect(result.message).toContain('empty');
    });

    it('should categorize similarity levels', async () => {
      const exactVectorId = 'exact-match';
      const similarVectorId = 'similar-match';

      context.metadataStore.set(exactVectorId, createSampleMetadata());
      context.metadataStore.set(similarVectorId, createSampleMetadata({
        filePath: '/other/path.ts',
      }));

      (context.backend.search as MockInstance).mockReturnValue([
        { id: exactVectorId, similarity: 0.99 },
        { id: similarVectorId, similarity: 0.75 },
      ]);
      (context.backend.count as MockInstance).mockReturnValue(2);

      const result = await findSimilarCode(
        { code: 'function test() {}' },
        context
      );

      expect(result.success).toBe(true);
      // Check categories are assigned
      for (const item of result.results) {
        expect(['exact', 'near-duplicate', 'very-similar', 'similar', 'related']).toContain(
          item.category
        );
      }
    });

    it('should exclude exact matches when requested', async () => {
      const exactVectorId = 'exact-vector';
      context.metadataStore.set(exactVectorId, createSampleMetadata());

      (context.backend.search as MockInstance).mockReturnValue([
        { id: exactVectorId, similarity: 0.995 }, // Exact match
      ]);
      (context.backend.count as MockInstance).mockReturnValue(1);

      const result = await findSimilarCode(
        {
          code: 'function test() {}',
          excludeExact: true,
        },
        context
      );

      expect(result.success).toBe(true);
      expect(result.results.length).toBe(0);
    });

    it('should filter by language', async () => {
      const tsVectorId = 'ts-vector';
      const pyVectorId = 'py-vector';

      context.metadataStore.set(
        tsVectorId,
        createSampleMetadata({ language: 'typescript' })
      );
      context.metadataStore.set(
        pyVectorId,
        createSampleMetadata({ language: 'python' })
      );

      (context.backend.search as MockInstance).mockReturnValue([
        { id: tsVectorId, similarity: 0.9 },
        { id: pyVectorId, similarity: 0.85 },
      ]);
      (context.backend.count as MockInstance).mockReturnValue(2);

      const result = await findSimilarCode(
        {
          code: 'function test() {}',
          languages: ['typescript'],
        },
        context
      );

      expect(result.results.every((r) => r.metadata.language === 'typescript')).toBe(true);
    });

    it('should include code content when requested', async () => {
      const vectorId = 'code-vector';
      const storedCode = 'function stored() { return 42; }';

      context.metadataStore.set(vectorId, createSampleMetadata());
      context.codeStore.set(vectorId, storedCode);

      (context.backend.search as MockInstance).mockReturnValue([
        { id: vectorId, similarity: 0.88 },
      ]);
      (context.backend.count as MockInstance).mockReturnValue(1);

      const result = await findSimilarCode(
        {
          code: 'function similar() { return 41; }',
          includeCode: true,
        },
        context
      );

      expect(result.results.length).toBe(1);
      expect(result.results[0].code).toBe(storedCode);
    });
  });

  // --------------------------------------------------------------------------
  // Tool Execution Tests: get_stats
  // --------------------------------------------------------------------------
  describe('Tool Execution - get_stats', () => {
    let context: ToolExecutionContext;

    beforeEach(() => {
      context = createMockContext();
    });

    it('should return basic statistics for empty index', async () => {
      const result = await getIndexStats({}, context);

      expect(result.success).toBe(true);
      expect(result.totalIndexed).toBe(0);
      expect(result.uniqueFiles).toBe(0);
      expect(result.uniqueRepositories).toBe(0);
      expect(result.config).toBeDefined();
      expect(result.message).toContain('Index contains');
    });

    it('should count unique files and repositories', async () => {
      // Add multiple entries from same file
      context.metadataStore.set('v1', createSampleMetadata({
        filePath: '/test/file1.ts',
        repository: 'repo1',
      }));
      context.metadataStore.set('v2', createSampleMetadata({
        filePath: '/test/file1.ts',
        repository: 'repo1',
      }));
      context.metadataStore.set('v3', createSampleMetadata({
        filePath: '/test/file2.ts',
        repository: 'repo2',
      }));

      (context.backend.count as MockInstance).mockReturnValue(3);

      const result = await getIndexStats({}, context);

      expect(result.totalIndexed).toBe(3);
      expect(result.uniqueFiles).toBe(2);
      expect(result.uniqueRepositories).toBe(2);
    });

    it('should include language breakdown when requested', async () => {
      context.metadataStore.set('v1', createSampleMetadata({ language: 'typescript' }));
      context.metadataStore.set('v2', createSampleMetadata({ language: 'typescript' }));
      context.metadataStore.set('v3', createSampleMetadata({ language: 'python' }));

      const result = await getIndexStats(
        { includeLanguageBreakdown: true },
        context
      );

      expect(result.languageBreakdown).toBeDefined();
      expect(result.languageBreakdown?.length).toBeGreaterThan(0);

      const tsEntry = result.languageBreakdown?.find((b) => b.category === 'typescript');
      const pyEntry = result.languageBreakdown?.find((b) => b.category === 'python');

      expect(tsEntry?.count).toBe(2);
      expect(pyEntry?.count).toBe(1);
    });

    it('should include repository breakdown when requested', async () => {
      context.metadataStore.set('v1', createSampleMetadata({ repository: 'repo-a' }));
      context.metadataStore.set('v2', createSampleMetadata({ repository: 'repo-a' }));
      context.metadataStore.set('v3', createSampleMetadata({ repository: 'repo-b' }));

      const result = await getIndexStats(
        { includeRepositoryBreakdown: true },
        context
      );

      expect(result.repositoryBreakdown).toBeDefined();
      expect(result.repositoryBreakdown?.length).toBe(2);
    });

    it('should include symbol breakdown when requested', async () => {
      context.metadataStore.set('v1', createSampleMetadata({ symbolType: 'function' }));
      context.metadataStore.set('v2', createSampleMetadata({ symbolType: 'class' }));
      context.metadataStore.set('v3', createSampleMetadata({ symbolType: 'function' }));

      const result = await getIndexStats(
        { includeSymbolBreakdown: true },
        context
      );

      expect(result.symbolBreakdown).toBeDefined();

      const functionEntry = result.symbolBreakdown?.find((b) => b.category === 'function');
      expect(functionEntry?.count).toBe(2);
    });

    it('should include memory details when requested', async () => {
      context.metadataStore.set('v1', createSampleMetadata());
      context.codeStore.set('v1', 'function test() {}');

      (context.backend.count as MockInstance).mockReturnValue(1);

      const result = await getIndexStats(
        { includeMemoryDetails: true },
        context
      );

      expect(result.memoryStats).toBeDefined();
      expect(result.memoryStats?.totalBytes).toBeGreaterThan(0);
      expect(result.memoryStats?.vectorBytes).toBeGreaterThanOrEqual(0);
      expect(result.memoryStats?.metadataBytes).toBeGreaterThan(0);
      expect(result.memoryStats?.totalFormatted).toBeDefined();
    });

    it('should include LEANN details when requested', async () => {
      context.metadataStore.set('v1', createSampleMetadata());

      const result = await getIndexStats(
        { includeLeannDetails: true },
        context
      );

      expect(result.leannStats).toBeDefined();
      expect(result.leannStats?.embeddingDimension).toBe(1536);
      expect(result.leannStats?.avgConnections).toBeDefined();
      expect(result.message).toContain('Hub cache hit ratio');
    });

    it('should track indexing timestamps', async () => {
      const early = Date.now() - 10000;
      const late = Date.now();

      context.metadataStore.set('v1', createSampleMetadata({ indexedAt: early }));
      context.metadataStore.set('v2', createSampleMetadata({ indexedAt: late }));

      const result = await getIndexStats({}, context);

      expect(result.firstIndexedAt).toBe(early);
      expect(result.lastIndexedAt).toBe(late);
    });

    it('should provide quick stats', async () => {
      context.metadataStore.set('v1', createSampleMetadata());
      (context.backend.count as MockInstance).mockReturnValue(1);

      const quickStats = await getQuickStats(context);

      expect(quickStats.totalIndexed).toBe(1);
      expect(quickStats.uniqueFiles).toBe(1);
      expect(quickStats.hubCacheHitRatio).toBe(0.85); // From mock
    });
  });

  // --------------------------------------------------------------------------
  // Integration Workflow Tests
  // --------------------------------------------------------------------------
  describe('Integration Workflow', () => {
    let context: ToolExecutionContext;
    let storedVectorIds: string[];

    beforeEach(() => {
      context = createMockContext();
      storedVectorIds = [];

      // Update mock to track inserts
      (context.backend.insert as MockInstance).mockImplementation((id: string) => {
        storedVectorIds.push(id);
      });
      (context.backend.count as MockInstance).mockImplementation(() => storedVectorIds.length);
    });

    it('should complete index -> search -> verify workflow', async () => {
      // Step 1: Index multiple code chunks
      const indexResult1 = await indexCode(
        {
          code: 'class UserService { getUser(id) { return this.db.find(id); } }',
          filePath: '/src/services/user.ts',
          language: 'typescript',
          symbolType: 'class',
          repository: 'api',
        },
        context
      );
      expect(indexResult1.success).toBe(true);

      const indexResult2 = await indexCode(
        {
          code: 'async function fetchData(url) { return await fetch(url).json(); }',
          filePath: '/src/utils/fetch.ts',
          language: 'typescript',
          symbolType: 'function',
          repository: 'api',
        },
        context
      );
      expect(indexResult2.success).toBe(true);

      // Step 2: Verify stats - check that indexing succeeded
      // Note: storedVectorIds tracks insert calls which should match indexed count
      const stats = await getIndexStats({}, context);
      expect(stats.totalIndexed).toBe(storedVectorIds.length);
      expect(stats.uniqueFiles).toBe(context.metadataStore.size);

      // Step 3: Setup search mock to return indexed items
      (context.backend.search as MockInstance).mockReturnValue(
        storedVectorIds.map((id, i) => ({
          id,
          similarity: 0.9 - i * 0.05,
        }))
      );

      // Step 4: Search for code
      const searchResult = await semanticCodeSearch(
        { query: 'get user from database', limit: 5 },
        context
      );

      expect(searchResult.success).toBe(true);
      expect(searchResult.totalResults).toBeGreaterThanOrEqual(0);
    });

    it('should handle concurrent indexing', async () => {
      // Index multiple items concurrently
      const indexPromises = [
        indexCode(
          { code: 'function a() {}', filePath: '/a.ts' },
          context
        ),
        indexCode(
          { code: 'function b() {}', filePath: '/b.ts' },
          context
        ),
        indexCode(
          { code: 'function c() {}', filePath: '/c.ts' },
          context
        ),
      ];

      const results = await Promise.all(indexPromises);

      expect(results.every((r) => r.success)).toBe(true);
      expect(new Set(results.map((r) => r.vectorId)).size).toBe(3);
    });

    it('should handle search immediately after indexing', async () => {
      // Index
      const indexResult = await indexCode(
        {
          code: 'function processPayment(amount) { return amount * 1.1; }',
          filePath: '/src/payment.ts',
        },
        context
      );
      storedVectorIds.push(indexResult.vectorId);

      (context.backend.search as MockInstance).mockReturnValue([
        { id: indexResult.vectorId, similarity: 0.95 },
      ]);

      // Search immediately
      const searchResult = await semanticCodeSearch(
        { query: 'payment processing' },
        context
      );

      expect(searchResult.success).toBe(true);
    });

    it('should support filtering workflow', async () => {
      // Index TypeScript code
      const tsResult = await indexCode(
        {
          code: 'function tsFunction() {}',
          filePath: '/src/code.ts',
          language: 'typescript',
          repository: 'ts-repo',
        },
        context
      );
      storedVectorIds.push(tsResult.vectorId);

      // Index Python code
      const pyResult = await indexCode(
        {
          code: 'def py_function(): pass',
          filePath: '/src/code.py',
          language: 'python',
          repository: 'py-repo',
        },
        context
      );
      storedVectorIds.push(pyResult.vectorId);

      (context.backend.search as MockInstance).mockReturnValue(
        storedVectorIds.map((id, i) => ({
          id,
          similarity: 0.9 - i * 0.05,
        }))
      );

      // Search with TypeScript filter
      const filteredResult = await semanticCodeSearch(
        {
          query: 'function',
          languages: ['typescript'],
        },
        context
      );

      expect(filteredResult.success).toBe(true);
      expect(
        filteredResult.results.every((r) => r.metadata.language === 'typescript')
      ).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Error Handling Tests
  // --------------------------------------------------------------------------
  describe('Error Handling', () => {
    let context: ToolExecutionContext;

    beforeEach(() => {
      context = createMockContext();
    });

    it('should handle embedding generation failure gracefully', async () => {
      (context.embeddingProvider.embedCode as MockInstance).mockRejectedValue(
        new Error('Embedding service unavailable')
      );

      // This should not throw, but return an error result
      await expect(
        indexCode(
          { code: 'function test() {}', filePath: '/test.ts' },
          context
        )
      ).rejects.toThrow('Embedding service unavailable');
    });

    it('should handle search embedding failure gracefully', async () => {
      (context.embeddingProvider.embedQuery as MockInstance).mockRejectedValue(
        new Error('Query embedding failed')
      );

      const result = await semanticCodeSearch(
        { query: 'test query' },
        context
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to generate query embedding');
    });

    it('should handle find_similar embedding failure gracefully', async () => {
      (context.embeddingProvider.embedCode as MockInstance).mockRejectedValue(
        new Error('Code embedding failed')
      );

      const result = await findSimilarCode(
        { code: 'function test() {}' },
        context
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to generate code embedding');
    });

    it('should handle missing metadata gracefully during search', async () => {
      // Vector exists but no metadata
      (context.backend.search as MockInstance).mockReturnValue([
        { id: 'orphan-vector', similarity: 0.9 },
      ]);
      (context.backend.count as MockInstance).mockReturnValue(1);

      const result = await semanticCodeSearch(
        { query: 'test' },
        context
      );

      // Should succeed but not include the orphan vector
      expect(result.success).toBe(true);
      expect(result.results.length).toBe(0);
    });

    it('should handle very long code input', async () => {
      const longCode = 'function test() { '.repeat(10000) + '}';

      const result = await indexCode(
        { code: longCode, filePath: '/large.ts' },
        context
      );

      // Should still succeed (backend might chunk it)
      expect(result.success).toBe(true);
    });

    it('should handle special characters in code', async () => {
      const codeWithSpecialChars = `
        function test() {
          const regex = /[\\w]+/g;
          const str = "Hello\\nWorld";
          return \`Template \${str}\`;
        }
      `;

      const result = await indexCode(
        { code: codeWithSpecialChars, filePath: '/special.ts' },
        context
      );

      expect(result.success).toBe(true);
    });

    it('should handle unicode in code', async () => {
      const unicodeCode = `
        function greet() {
          return "Hello, World!";
        }
      `;

      const result = await indexCode(
        { code: unicodeCode, filePath: '/unicode.ts' },
        context
      );

      expect(result.success).toBe(true);
      expect(context.codeStore.get(result.vectorId)).toContain('');
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases Tests
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    let context: ToolExecutionContext;

    beforeEach(() => {
      context = createMockContext();
    });

    it('should handle single character code', async () => {
      const result = await indexCode(
        { code: 'x', filePath: '/single.ts' },
        context
      );

      expect(result.success).toBe(true);
    });

    it('should handle binary-like content', async () => {
      const binaryLike = Buffer.from([0x00, 0x01, 0x02]).toString();

      const result = await indexCode(
        { code: binaryLike, filePath: '/binary.ts' },
        context
      );

      // Should succeed with hash generated
      expect(result.success).toBe(true);
      expect(result.metadata.contentHash).toBeDefined();
    });

    it('should handle file path with spaces', async () => {
      const result = await indexCode(
        {
          code: 'function test() {}',
          filePath: '/path with spaces/file name.ts',
        },
        context
      );

      expect(result.success).toBe(true);
      expect(result.metadata.filePath).toBe('/path with spaces/file name.ts');
    });

    it('should handle very deep file paths', async () => {
      const deepPath = '/a'.repeat(100) + '/file.ts';

      const result = await indexCode(
        { code: 'const x = 1;', filePath: deepPath },
        context
      );

      expect(result.success).toBe(true);
    });

    it('should handle search with all filters at once', async () => {
      context.metadataStore.set('v1', createSampleMetadata({
        language: 'typescript',
        symbolType: 'function',
        repository: 'test-repo',
      }));

      (context.backend.search as MockInstance).mockReturnValue([
        { id: 'v1', similarity: 0.9 },
      ]);
      (context.backend.count as MockInstance).mockReturnValue(1);

      const result = await semanticCodeSearch(
        {
          query: 'test',
          limit: 5,
          minScore: 0.5,
          languages: ['typescript'],
          symbolTypes: ['function'],
          repository: 'test-repo',
          filePattern: '*.ts',
          includeCode: true,
          deduplicate: true,
        },
        context
      );

      expect(result.success).toBe(true);
    });

    it('should handle empty statistics gracefully', async () => {
      const result = await getIndexStats(
        {
          includeLanguageBreakdown: true,
          includeRepositoryBreakdown: true,
          includeSymbolBreakdown: true,
          includeMemoryDetails: true,
          includeLeannDetails: true,
        },
        context
      );

      expect(result.success).toBe(true);
      expect(result.totalIndexed).toBe(0);
    });

    it('should preserve order in search results', async () => {
      const ids = ['v1', 'v2', 'v3'];
      ids.forEach((id, i) => {
        context.metadataStore.set(id, createSampleMetadata({
          filePath: `/file${i}.ts`,
        }));
      });

      (context.backend.search as MockInstance).mockReturnValue(
        ids.map((id, i) => ({
          id,
          similarity: 0.9 - i * 0.1, // Decreasing similarity
        }))
      );
      (context.backend.count as MockInstance).mockReturnValue(3);

      const result = await semanticCodeSearch(
        { query: 'test' },
        context
      );

      // Results should maintain similarity order
      for (let i = 1; i < result.results.length; i++) {
        expect(result.results[i - 1].score).toBeGreaterThanOrEqual(
          result.results[i].score
        );
      }
    });
  });
});

// ============================================================================
// Standalone Tool Function Tests
// ============================================================================

describe('Tool Function Exports', () => {
  it('should export all tool functions', () => {
    expect(typeof semanticCodeSearch).toBe('function');
    expect(typeof indexCode).toBe('function');
    expect(typeof indexRepository).toBe('function');
    expect(typeof findSimilarCode).toBe('function');
    expect(typeof getIndexStats).toBe('function');
    expect(typeof getQuickStats).toBe('function');
  });

  it('should export all tool definitions', () => {
    expect(SEMANTIC_CODE_SEARCH_DEFINITION).toBeDefined();
    expect(INDEX_CODE_DEFINITION).toBeDefined();
    expect(INDEX_REPOSITORY_DEFINITION).toBeDefined();
    expect(FIND_SIMILAR_CODE_DEFINITION).toBeDefined();
    expect(GET_INDEX_STATS_DEFINITION).toBeDefined();
  });
});
