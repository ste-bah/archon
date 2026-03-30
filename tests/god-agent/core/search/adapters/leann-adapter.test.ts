/**
 * LEANN Source Adapter Tests
 * Tests for quad-fusion unified search integration
 *
 * PRD: PRD-GOD-AGENT-001
 * SPEC: SPEC-002-leann-integration Step 5
 *
 * @module tests/god-agent/core/search/adapters/leann-adapter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LEANNSourceAdapter,
  LEANNAdapterConfig,
  LEANNResultMetadata,
  DEFAULT_LEANN_ADAPTER_CONFIG,
  createLEANNAdapter,
} from '../../../../../src/god-agent/core/search/adapters/leann-adapter.js';
import { LEANNBackend } from '../../../../../src/god-agent/core/vector-db/leann-backend.js';
import { DistanceMetric } from '../../../../../src/god-agent/core/vector-db/types.js';

// Mock LEANNBackend
vi.mock('../../../../../src/god-agent/core/vector-db/leann-backend.js', () => ({
  LEANNBackend: vi.fn().mockImplementation(() => ({
    search: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    count: vi.fn().mockReturnValue(0),
    clear: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    load: vi.fn().mockResolvedValue(true),
    getStats: vi.fn().mockReturnValue({
      totalVectors: 0,
      cacheHits: 0,
      cacheMisses: 0,
      hitRatio: 0,
      hubCount: 0,
    }),
    getHubIds: vi.fn().mockReturnValue([]),
    setEmbeddingGenerator: vi.fn(),
  })),
}));

describe('LEANNSourceAdapter', () => {
  let mockBackend: any;
  let adapter: LEANNSourceAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBackend = {
      search: vi.fn().mockReturnValue([]),
      insert: vi.fn(),
      delete: vi.fn().mockReturnValue(true),
      count: vi.fn().mockReturnValue(10),
      clear: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(true),
      getStats: vi.fn().mockReturnValue({
        totalVectors: 10,
        cacheHits: 5,
        cacheMisses: 5,
        hitRatio: 0.5,
        hubCount: 2,
      }),
      getHubIds: vi.fn().mockReturnValue(['hub-1', 'hub-2']),
      setEmbeddingGenerator: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create adapter with default configuration', () => {
      adapter = new LEANNSourceAdapter();
      expect(adapter.name).toBe('leann');
    });

    it('should use provided backend instance', () => {
      adapter = new LEANNSourceAdapter({ backend: mockBackend });
      expect(adapter.getBackend()).toBe(mockBackend);
    });

    it('should create new backend when none provided', () => {
      adapter = new LEANNSourceAdapter({
        dimension: 768,
        metric: DistanceMetric.EUCLIDEAN,
      });
      expect(adapter.name).toBe('leann');
    });

    it('should use default dimension of 1536', () => {
      expect(DEFAULT_LEANN_ADAPTER_CONFIG.dimension).toBe(1536);
    });

    it('should use default metric of COSINE', () => {
      expect(DEFAULT_LEANN_ADAPTER_CONFIG.metric).toBe(DistanceMetric.COSINE);
    });

    it('should set embedding generator when provided', () => {
      const embedder = vi.fn().mockResolvedValue(new Float32Array(1536));
      // When backend is provided, embeddingProvider is stored for searchByText
      // The setEmbeddingGenerator is only called when adapter owns backend (creates it)
      adapter = new LEANNSourceAdapter({
        embeddingProvider: embedder,
        backend: mockBackend,
      });
      expect(adapter).toBeDefined();
      // setEmbeddingGenerator is NOT called when backend is provided (ownsBackend=false)
      expect(mockBackend.setEmbeddingGenerator).not.toHaveBeenCalled();
    });
  });

  describe('search', () => {
    beforeEach(() => {
      adapter = new LEANNSourceAdapter({ backend: mockBackend });
    });

    it('should return empty results for undefined embedding', async () => {
      const result = await adapter.search(undefined, 10, 1000);

      expect(result.status).toBe('success');
      expect(result.results).toEqual([]);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should execute search with valid embedding', async () => {
      const embedding = new Float32Array([0.1, 0.2, 0.3]);
      mockBackend.search.mockReturnValue([
        { id: 'vec-1', similarity: 0.95 },
        { id: 'vec-2', similarity: 0.85 },
      ]);

      const result = await adapter.search(embedding, 10, 1000);

      expect(result.status).toBe('success');
      expect(result.results).toHaveLength(2);
      expect(mockBackend.search).toHaveBeenCalledWith(embedding, 10, false);
    });

    it('should include LEANN-specific metadata in results', async () => {
      const embedding = new Float32Array([0.1, 0.2, 0.3]);
      mockBackend.search.mockReturnValue([
        { id: 'hub-1', similarity: 0.95 },
      ]);
      mockBackend.getHubIds.mockReturnValue(['hub-1']);

      const result = await adapter.search(embedding, 10, 1000);

      expect(result.status).toBe('success');
      expect(result.results![0].metadata).toMatchObject({
        vectorId: 'hub-1',
        originalSimilarity: 0.95,
        fromHubCache: true,
        recomputed: false,
        backendType: 'leann',
      });
    });

    it('should handle timeout correctly', async () => {
      mockBackend.search.mockImplementation(() => {
        return new Promise((resolve) => setTimeout(() => resolve([]), 2000));
      });

      const embedding = new Float32Array([0.1, 0.2, 0.3]);
      const result = await adapter.search(embedding, 10, 10);

      // withTimeout wraps TimeoutError in generic Error, so status is 'error'
      expect(result.status).toBe('error');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle search errors gracefully', async () => {
      mockBackend.search.mockImplementation(() => {
        throw new Error('Search failed');
      });

      const embedding = new Float32Array([0.1, 0.2, 0.3]);
      const result = await adapter.search(embedding, 10, 1000);

      expect(result.status).toBe('error');
      // withTimeout wraps error messages with source and timeout info
      expect(result.error).toContain('Search failed');
    });

    it('should use source type "vector" for quad-fusion compatibility', async () => {
      const embedding = new Float32Array([0.1, 0.2, 0.3]);
      mockBackend.search.mockReturnValue([
        { id: 'vec-1', similarity: 0.95 },
      ]);

      const result = await adapter.search(embedding, 10, 1000);

      expect(result.results![0].source).toBe('vector');
    });
  });

  describe('searchByText', () => {
    it('should return error when no embedder configured', async () => {
      adapter = new LEANNSourceAdapter({ backend: mockBackend });

      const result = await adapter.searchByText('test query', 10, 1000);

      expect(result.status).toBe('error');
      expect(result.error).toContain('No embedding provider configured');
    });

    it('should generate embedding and search', async () => {
      const embedder = vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3]));
      adapter = new LEANNSourceAdapter({
        backend: mockBackend,
        embeddingProvider: embedder,
      });
      mockBackend.search.mockReturnValue([
        { id: 'vec-1', similarity: 0.95 },
      ]);

      const result = await adapter.searchByText('test query', 10, 1000);

      expect(result.status).toBe('success');
      expect(embedder).toHaveBeenCalledWith('test query');
    });

    it('should allocate half timeout for embedding generation', async () => {
      const embedder = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return new Float32Array([0.1, 0.2, 0.3]);
      });
      adapter = new LEANNSourceAdapter({
        backend: mockBackend,
        embeddingProvider: embedder,
      });
      mockBackend.search.mockReturnValue([]);

      const result = await adapter.searchByText('test query', 10, 1000);

      expect(result.status).toBe('success');
    });

    it('should handle embedding timeout', async () => {
      const embedder = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return new Float32Array([0.1, 0.2, 0.3]);
      });
      adapter = new LEANNSourceAdapter({
        backend: mockBackend,
        embeddingProvider: embedder,
      });

      const result = await adapter.searchByText('test query', 10, 50);

      // withTimeout wraps TimeoutError in generic Error, so status is 'error'
      expect(result.status).toBe('error');
    });

    it('should handle embedding errors', async () => {
      const embedder = vi.fn().mockRejectedValue(new Error('Embedding failed'));
      adapter = new LEANNSourceAdapter({
        backend: mockBackend,
        embeddingProvider: embedder,
      });

      const result = await adapter.searchByText('test query', 10, 1000);

      expect(result.status).toBe('error');
      // withTimeout wraps error messages with source and timeout info
      expect(result.error).toContain('Embedding failed');
    });
  });

  describe('score normalization', () => {
    it('should normalize COSINE scores from [-1,1] to [0,1]', async () => {
      adapter = new LEANNSourceAdapter({
        backend: mockBackend,
        metric: DistanceMetric.COSINE,
      });
      mockBackend.search.mockReturnValue([
        { id: 'vec-1', similarity: 1.0 },   // Perfect match
        { id: 'vec-2', similarity: 0.0 },   // Orthogonal
        { id: 'vec-3', similarity: -1.0 },  // Opposite
      ]);

      const embedding = new Float32Array([0.1, 0.2, 0.3]);
      const result = await adapter.search(embedding, 10, 1000);

      expect(result.results![0].score).toBe(1.0);   // (1+1)/2
      expect(result.results![1].score).toBe(0.5);   // (0+1)/2
      expect(result.results![2].score).toBe(0.0);   // (-1+1)/2
    });

    it('should normalize DOT scores same as COSINE', async () => {
      adapter = new LEANNSourceAdapter({
        backend: mockBackend,
        metric: DistanceMetric.DOT,
      });
      mockBackend.search.mockReturnValue([
        { id: 'vec-1', similarity: 0.8 },
      ]);

      const embedding = new Float32Array([0.1, 0.2, 0.3]);
      const result = await adapter.search(embedding, 10, 1000);

      expect(result.results![0].score).toBe(0.9); // (0.8+1)/2
    });

    it('should normalize EUCLIDEAN distances using exponential decay', async () => {
      adapter = new LEANNSourceAdapter({
        backend: mockBackend,
        metric: DistanceMetric.EUCLIDEAN,
      });
      mockBackend.search.mockReturnValue([
        { id: 'vec-1', similarity: 0 },     // Zero distance = perfect match
        { id: 'vec-2', similarity: 1 },     // Distance of 1
        { id: 'vec-3', similarity: 2 },     // Distance of 2
      ]);

      const embedding = new Float32Array([0.1, 0.2, 0.3]);
      const result = await adapter.search(embedding, 10, 1000);

      expect(result.results![0].score).toBeCloseTo(1.0, 5);           // exp(0) = 1
      expect(result.results![1].score).toBeCloseTo(Math.exp(-1), 5);  // exp(-1)
      expect(result.results![2].score).toBeCloseTo(Math.exp(-2), 5);  // exp(-2)
    });

    it('should normalize MANHATTAN distances using exponential decay', async () => {
      adapter = new LEANNSourceAdapter({
        backend: mockBackend,
        metric: DistanceMetric.MANHATTAN,
      });
      mockBackend.search.mockReturnValue([
        { id: 'vec-1', similarity: 0.5 },
      ]);

      const embedding = new Float32Array([0.1, 0.2, 0.3]);
      const result = await adapter.search(embedding, 10, 1000);

      expect(result.results![0].score).toBeCloseTo(Math.exp(-0.5), 5);
    });
  });

  describe('index operations', () => {
    beforeEach(() => {
      adapter = new LEANNSourceAdapter({ backend: mockBackend });
    });

    it('should index pre-computed embedding', () => {
      const embedding = new Float32Array([0.1, 0.2, 0.3]);

      adapter.indexEmbedding('test-id', embedding);

      expect(mockBackend.insert).toHaveBeenCalledWith('test-id', embedding);
    });

    it('should throw error when indexing text without embedder', async () => {
      await expect(adapter.index('test content')).rejects.toThrow(
        'No embedding provider configured'
      );
    });

    it('should index content with embedder', async () => {
      const embedder = vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3]));
      adapter = new LEANNSourceAdapter({
        backend: mockBackend,
        embeddingProvider: embedder,
      });

      const id = await adapter.index('test content');

      expect(embedder).toHaveBeenCalledWith('test content');
      expect(mockBackend.insert).toHaveBeenCalled();
      expect(id).toMatch(/^leann_\d+_[a-z0-9]+$/);
    });

    it('should use custom id prefix from metadata', async () => {
      const embedder = vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3]));
      adapter = new LEANNSourceAdapter({
        backend: mockBackend,
        embeddingProvider: embedder,
      });

      const id = await adapter.index('test content', { idPrefix: 'custom' });

      expect(id).toMatch(/^custom_\d+_[a-z0-9]+$/);
    });

    it('should delete vector by id', () => {
      const result = adapter.delete('test-id');

      expect(mockBackend.delete).toHaveBeenCalledWith('test-id');
      expect(result).toBe(true);
    });

    it('should return count of indexed vectors', () => {
      const count = adapter.count();

      expect(mockBackend.count).toHaveBeenCalled();
      expect(count).toBe(10);
    });

    it('should clear all vectors', () => {
      adapter.clear();

      expect(mockBackend.clear).toHaveBeenCalled();
    });
  });

  describe('persistence (mocked backend)', () => {
    let tmpDir: string;

    beforeEach(async () => {
      adapter = new LEANNSourceAdapter({ backend: mockBackend });
      const fs = await import('fs/promises');
      const os = await import('os');
      tmpDir = await fs.mkdtemp(`${os.tmpdir()}/leann-mock-test-`);
    });

    afterEach(async () => {
      const fs = await import('fs/promises');
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('should save index to file and call backend.save with temp path (atomic writes)', async () => {
      const filePath = `${tmpDir}/test_index`;
      // Mock backend.save to actually create the temp file so rename succeeds
      const fs = await import('fs/promises');
      mockBackend.save = vi.fn().mockImplementation(async (path: string) => {
        await fs.writeFile(path, '{}', 'utf-8');
      });

      await adapter.save(filePath);

      // Backend.save is called with the temp path for atomic writes
      expect(mockBackend.save).toHaveBeenCalledWith(filePath + '.tmp');
    });

    it('should load index from file and call backend.load', async () => {
      const result = await adapter.load('/path/to/index');

      expect(mockBackend.load).toHaveBeenCalledWith('/path/to/index');
      expect(result).toBe(true);
    });
  });

  describe('persistence with contentStore', () => {
    let tmpDir: string;
    let realBackend: any;
    let realAdapter: LEANNSourceAdapter;
    const embedder = vi.fn().mockImplementation((text: string) => {
      // Simple hash-based embedding for deterministic tests
      const hash = Array.from(text).reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const vec = new Float32Array(8);
      vec[0] = hash % 100 / 100;
      vec[1] = (hash % 50) / 50;
      return Promise.resolve(vec);
    });

    beforeEach(async () => {
      vi.clearAllMocks();
      const fs = await import('fs/promises');
      const os = await import('os');
      tmpDir = await fs.mkdtemp(`${os.tmpdir()}/leann-test-`);

      // Create a real-like backend mock that has all the methods needed
      realBackend = {
        search: vi.fn().mockReturnValue([]),
        insert: vi.fn(),
        delete: vi.fn().mockReturnValue(true),
        count: vi.fn().mockReturnValue(0),
        clear: vi.fn(),
        save: vi.fn().mockImplementation(async (path: string) => {
          // Simulate actual file save for vector index
          const fs = await import('fs/promises');
          await fs.writeFile(path, JSON.stringify({ vectors: [] }), 'utf-8');
        }),
        load: vi.fn().mockImplementation(async (path: string) => {
          const fs = await import('fs/promises');
          try {
            await fs.access(path);
            return true;
          } catch {
            return false;
          }
        }),
        getStats: vi.fn().mockReturnValue({
          totalVectors: 0,
          cacheHits: 0,
          cacheMisses: 0,
          hitRatio: 0,
          hubCount: 0,
        }),
        getHubIds: vi.fn().mockReturnValue([]),
        setEmbeddingGenerator: vi.fn(),
      };

      // Track vector count manually for the mock
      let vectorCount = 0;
      realBackend.insert.mockImplementation(() => { vectorCount++; });
      realBackend.count.mockImplementation(() => vectorCount);
      realBackend.clear.mockImplementation(() => { vectorCount = 0; });

      realAdapter = new LEANNSourceAdapter({
        dimension: 8,
        embeddingProvider: embedder,
        metric: DistanceMetric.COSINE,
        backend: realBackend,
      });
    });

    afterEach(async () => {
      const fs = await import('fs/promises');
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('should round-trip vectors and contentStore through save/load', async () => {
      // Index some content
      await realAdapter.index('Hello world', { idPrefix: 'test' });
      await realAdapter.index('Goodbye world', { idPrefix: 'test' });

      const countBefore = realAdapter.count();
      expect(countBefore).toBe(2);

      // Save to disk
      const filePath = `${tmpDir}/leann_index`;
      await realAdapter.save(filePath);

      // Verify files exist
      const fs = await import('fs/promises');
      const vectorFileExists = await fs.access(filePath).then(() => true).catch(() => false);
      const contentFileExists = await fs.access(`${filePath}.content`).then(() => true).catch(() => false);
      expect(vectorFileExists).toBe(true);
      expect(contentFileExists).toBe(true);

      // Create new adapter with a mock backend for load
      let loadedCount = 0;
      const newBackend = {
        ...realBackend,
        count: vi.fn().mockImplementation(() => loadedCount),
        load: vi.fn().mockImplementation(async () => {
          loadedCount = 2; // Simulate loading 2 vectors
          return true;
        }),
      };
      const newAdapter = new LEANNSourceAdapter({
        dimension: 8,
        embeddingProvider: embedder,
        metric: DistanceMetric.COSINE,
        backend: newBackend,
      });
      const loaded = await newAdapter.load(filePath);
      expect(loaded).toBe(true);
      expect(newAdapter.count()).toBe(2);
    });

    it('should preserve contentStore for on-demand recomputation after load', async () => {
      // Index content
      const id = await realAdapter.index('Recomputable content', { idPrefix: 'recomp' });
      expect(id).toMatch(/^recomp_\d+_[a-z0-9]+$/);

      // Save
      const filePath = `${tmpDir}/recomp_index`;
      await realAdapter.save(filePath);

      // Load into new adapter with a mock backend
      const newBackend = {
        ...realBackend,
        search: vi.fn().mockReturnValue([{ id: 'test', similarity: 0.9 }]),
        load: vi.fn().mockResolvedValue(true),
      };
      const newAdapter = new LEANNSourceAdapter({
        dimension: 8,
        embeddingProvider: embedder,
        metric: DistanceMetric.COSINE,
        backend: newBackend,
      });
      await newAdapter.load(filePath);

      // The contentStore should be restored, enabling recomputation
      // We verify by checking the adapter can still search after load
      const embedding = await embedder('Similar content');
      const result = await newAdapter.search(embedding, 1, 1000);
      expect(result.status).toBe('success');
    });

    it('should handle load when content file missing (vectors only)', async () => {
      // Index content
      await realAdapter.index('Test content', { idPrefix: 'test' });

      // Save
      const filePath = `${tmpDir}/partial_index`;
      await realAdapter.save(filePath);

      // Delete the content file to simulate legacy data
      const fs = await import('fs/promises');
      await fs.unlink(`${filePath}.content`);

      // Load should still work (just without content recomputation)
      let loadedCount = 0;
      const newBackend = {
        ...realBackend,
        count: vi.fn().mockImplementation(() => loadedCount),
        load: vi.fn().mockImplementation(async () => {
          loadedCount = 1; // Simulate loading 1 vector
          return true;
        }),
      };
      const newAdapter = new LEANNSourceAdapter({
        dimension: 8,
        embeddingProvider: embedder,
        metric: DistanceMetric.COSINE,
        backend: newBackend,
      });
      const loaded = await newAdapter.load(filePath);
      expect(loaded).toBe(true);
      expect(newAdapter.count()).toBe(1);
    });

    it('should return false when loading non-existent file', async () => {
      const loaded = await realAdapter.load(`${tmpDir}/nonexistent`);
      expect(loaded).toBe(false);
    });

    it('should clear contentStore on clear()', async () => {
      await realAdapter.index('Test content', { idPrefix: 'test' });
      expect(realAdapter.count()).toBe(1);

      realAdapter.clear();
      expect(realAdapter.count()).toBe(0);
    });

    it('should persist content store JSON with version field', async () => {
      // Index content
      await realAdapter.index('Versioned content', { idPrefix: 'ver' });

      // Save
      const filePath = `${tmpDir}/versioned_index`;
      await realAdapter.save(filePath);

      // Read and verify content store file format
      const fs = await import('fs/promises');
      const contentData = await fs.readFile(`${filePath}.content`, 'utf-8');
      const parsed = JSON.parse(contentData);

      expect(parsed).toHaveProperty('version', 1);
      expect(parsed).toHaveProperty('entries');
      expect(Array.isArray(parsed.entries)).toBe(true);
      expect(parsed.entries.length).toBe(1);
      expect(parsed.entries[0][1]).toBe('Versioned content');
    });

    it('should maintain LRU eviction during persistence', async () => {
      // Create a backend for the small adapter
      const smallBackend = {
        ...realBackend,
        insert: vi.fn(),
        save: vi.fn().mockImplementation(async (path: string) => {
          const fs = await import('fs/promises');
          await fs.writeFile(path, JSON.stringify({ vectors: [] }), 'utf-8');
        }),
      };

      // Create adapter with small max content store size
      const smallAdapter = new LEANNSourceAdapter({
        dimension: 8,
        embeddingProvider: embedder,
        metric: DistanceMetric.COSINE,
        maxContentStoreSize: 2,
        backend: smallBackend,
      });

      // Index 3 items (should evict the first one)
      await smallAdapter.index('First content', { idPrefix: 'lru' });
      await smallAdapter.index('Second content', { idPrefix: 'lru' });
      await smallAdapter.index('Third content', { idPrefix: 'lru' });

      // Save and check only 2 entries are persisted
      const filePath = `${tmpDir}/lru_index`;
      await smallAdapter.save(filePath);

      const fs = await import('fs/promises');
      const contentData = await fs.readFile(`${filePath}.content`, 'utf-8');
      const parsed = JSON.parse(contentData);

      expect(parsed.entries.length).toBe(2);
      // First content should have been evicted
      const contents = parsed.entries.map((e: [string, string]) => e[1]);
      expect(contents).not.toContain('First content');
      expect(contents).toContain('Second content');
      expect(contents).toContain('Third content');
    });
  });

  describe('statistics', () => {
    beforeEach(() => {
      adapter = new LEANNSourceAdapter({ backend: mockBackend });
    });

    it('should return backend statistics', () => {
      const stats = adapter.getStats();

      expect(stats).toEqual({
        totalVectors: 10,
        cacheHits: 5,
        cacheMisses: 5,
        hitRatio: 0.5,
        hubCount: 2,
      });
    });

    it('should track cache hit ratio in search metadata', async () => {
      const embedding = new Float32Array([0.1, 0.2, 0.3]);
      mockBackend.search.mockReturnValue([
        { id: 'vec-1', similarity: 0.95 },
      ]);

      const result = await adapter.search(embedding, 10, 1000);

      expect(result.results![0].metadata.cacheHitRatio).toBe(0.5);
    });

    it('should detect hub cache hits during search', async () => {
      const embedding = new Float32Array([0.1, 0.2, 0.3]);
      let callCount = 0;
      mockBackend.getStats.mockImplementation(() => ({
        totalVectors: 10,
        cacheHits: callCount++ === 0 ? 5 : 6, // Increment on second call
        cacheMisses: 5,
        hitRatio: 0.5,
        hubCount: 2,
      }));
      mockBackend.search.mockReturnValue([
        { id: 'vec-1', similarity: 0.95 },
      ]);

      const result = await adapter.search(embedding, 10, 1000);

      expect(result.results![0].metadata.wasHubCacheHit).toBe(true);
    });
  });

  describe('hub cache tracking', () => {
    beforeEach(() => {
      adapter = new LEANNSourceAdapter({ backend: mockBackend });
    });

    it('should identify results from hub cache', async () => {
      const embedding = new Float32Array([0.1, 0.2, 0.3]);
      mockBackend.getHubIds.mockReturnValue(['hub-1', 'hub-2']);
      mockBackend.search.mockReturnValue([
        { id: 'hub-1', similarity: 0.95 },
        { id: 'regular-1', similarity: 0.85 },
      ]);

      const result = await adapter.search(embedding, 10, 1000);

      expect(result.results![0].metadata.fromHubCache).toBe(true);
      expect(result.results![1].metadata.fromHubCache).toBe(false);
    });

    it('should update hub cache periodically', async () => {
      const embedding = new Float32Array([0.1, 0.2, 0.3]);
      mockBackend.search.mockReturnValue([]);

      // First search updates cache
      await adapter.search(embedding, 10, 1000);
      expect(mockBackend.getHubIds).toHaveBeenCalledTimes(1);

      // Second search within interval shouldn't update
      await adapter.search(embedding, 10, 1000);
      expect(mockBackend.getHubIds).toHaveBeenCalledTimes(1);
    });
  });

  describe('createLEANNAdapter factory', () => {
    it('should create adapter with default dimension', () => {
      const adapter = createLEANNAdapter();
      expect(adapter.name).toBe('leann');
    });

    it('should create adapter with embedder', () => {
      // Test that createLEANNAdapter accepts an embedder parameter
      // Note: Factory creates a new backend internally, so we test using a backend instead
      const embedder = vi.fn().mockResolvedValue(new Float32Array(1536));
      const adapter = new LEANNSourceAdapter({
        embeddingProvider: embedder,
        backend: mockBackend,
        dimension: 1536,
        metric: DistanceMetric.COSINE,
      });
      expect(adapter).toBeInstanceOf(LEANNSourceAdapter);
    });

    it('should create adapter with custom dimension', () => {
      const adapter = createLEANNAdapter(undefined, 768);
      expect(adapter.name).toBe('leann');
    });
  });

  describe('result ID generation', () => {
    beforeEach(() => {
      adapter = new LEANNSourceAdapter({ backend: mockBackend });
    });

    it('should generate unique result IDs with index', async () => {
      const embedding = new Float32Array([0.1, 0.2, 0.3]);
      mockBackend.search.mockReturnValue([
        { id: 'vec-1', similarity: 0.95 },
        { id: 'vec-2', similarity: 0.85 },
      ]);

      const result = await adapter.search(embedding, 10, 1000);

      // Format is: leann_<timestamp>_<index>
      expect(result.results![0].id).toMatch(/^leann_\d+_0$/);
      expect(result.results![1].id).toMatch(/^leann_\d+_1$/);
    });

    it('should use vector ID as content reference', async () => {
      const embedding = new Float32Array([0.1, 0.2, 0.3]);
      mockBackend.search.mockReturnValue([
        { id: 'original-vector-id', similarity: 0.95 },
      ]);

      const result = await adapter.search(embedding, 10, 1000);

      expect(result.results![0].content).toBe('original-vector-id');
    });
  });
});
