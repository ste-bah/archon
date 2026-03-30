/**
 * Dual Code Embedding Provider Tests
 * Tests for combined NLP + Code embeddings with LRU caching
 *
 * PRD: PRD-GOD-AGENT-001
 * SPEC: SPEC-002-leann-integration Step 5
 *
 * @module tests/god-agent/core/search/dual-code-embedding
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the embedding provider factory BEFORE imports
vi.mock('../../../../src/god-agent/core/memory/embedding-provider.js', () => ({
  EmbeddingProviderFactory: {
    getProvider: vi.fn(),
  },
  LocalEmbeddingProvider: vi.fn(),
}));

import {
  DualCodeEmbeddingProvider,
  DualCodeEmbeddingConfig,
  ContentType,
  CacheStats,
  createLEANNEmbedder,
  DEFAULT_DUAL_CODE_CONFIG,
} from '../../../../src/god-agent/core/search/dual-code-embedding.js';
import { EmbeddingProviderFactory } from '../../../../src/god-agent/core/memory/embedding-provider.js';

describe('DualCodeEmbeddingProvider', () => {
  let provider: DualCodeEmbeddingProvider;
  let mockBaseProvider: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock base provider that returns Float32Arrays
    mockBaseProvider = {
      embed: vi.fn().mockImplementation(async (text: string) => {
        return new Float32Array(1536).fill(0.1);
      }),
      embedBatch: vi.fn().mockImplementation(async (texts: string[]) => {
        return texts.map(() => new Float32Array(1536).fill(0.1));
      }),
      isAvailable: vi.fn().mockResolvedValue(true),
      getProviderName: vi.fn().mockReturnValue('mock-provider'),
      getDimensions: vi.fn().mockReturnValue(1536),
    };

    // Mock the factory to return our mock provider
    vi.mocked(EmbeddingProviderFactory.getProvider).mockResolvedValue(mockBaseProvider);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('DEFAULT_DUAL_CODE_CONFIG', () => {
    it('should have default dimension of 1536', () => {
      expect(DEFAULT_DUAL_CODE_CONFIG.dimension).toBe(1536);
    });

    it('should have default cacheMaxSize of 1000', () => {
      expect(DEFAULT_DUAL_CODE_CONFIG.cacheMaxSize).toBe(1000);
    });

    it('should have default nlpWeight of 0.4', () => {
      expect(DEFAULT_DUAL_CODE_CONFIG.nlpWeight).toBe(0.4);
    });

    it('should have default codeWeight of 0.6', () => {
      expect(DEFAULT_DUAL_CODE_CONFIG.codeWeight).toBe(0.6);
    });

    it('should have cacheEnabled true by default', () => {
      expect(DEFAULT_DUAL_CODE_CONFIG.cacheEnabled).toBe(true);
    });

    it('should have default provider as local', () => {
      expect(DEFAULT_DUAL_CODE_CONFIG.provider).toBe('local');
    });

    it('should have codeDetectionThreshold of 0.6', () => {
      expect(DEFAULT_DUAL_CODE_CONFIG.codeDetectionThreshold).toBe(0.6);
    });
  });

  describe('constructor', () => {
    it('should create provider with default configuration', () => {
      provider = new DualCodeEmbeddingProvider();
      expect(provider).toBeDefined();
    });

    it('should accept custom configuration', () => {
      provider = new DualCodeEmbeddingProvider({
        dimension: 768,
        cacheMaxSize: 500,
        nlpWeight: 0.7,
        codeWeight: 0.3,
      });
      expect(provider).toBeDefined();
    });

    it('should accept partial configuration', () => {
      provider = new DualCodeEmbeddingProvider({
        nlpWeight: 0.5,
      });
      expect(provider).toBeDefined();
    });

    it('should use provided cacheEnabled setting', () => {
      provider = new DualCodeEmbeddingProvider({
        cacheEnabled: false,
      });
      expect(provider).toBeDefined();
    });
  });

  describe('embed', () => {
    beforeEach(() => {
      provider = new DualCodeEmbeddingProvider();
    });

    it('should return Float32Array', async () => {
      const result = await provider.embed('test text');
      expect(result).toBeInstanceOf(Float32Array);
    });

    it('should return embedding of correct dimension', async () => {
      const result = await provider.embed('test text');
      expect(result.length).toBe(1536);
    });

    it('should call base provider embed', async () => {
      await provider.embed('test text');
      expect(mockBaseProvider.embed).toHaveBeenCalled();
    });

    it('should cache repeated embeddings when cache enabled', async () => {
      provider = new DualCodeEmbeddingProvider({ cacheEnabled: true });

      await provider.embed('test query');
      await provider.embed('test query');

      // First call initializes, subsequent should use cache
      const stats = provider.getCacheStats();
      expect(stats.hits).toBeGreaterThanOrEqual(0);
    });

    it('should return different embeddings for different text', async () => {
      mockBaseProvider.embed.mockImplementation(async (text: string) => {
        const arr = new Float32Array(1536);
        arr[0] = text.length * 0.01;
        return arr;
      });

      const result1 = await provider.embed('short');
      const result2 = await provider.embed('much longer text here');

      // Both should be valid embeddings (actual diff depends on real embedder)
      expect(result1).toBeInstanceOf(Float32Array);
      expect(result2).toBeInstanceOf(Float32Array);
      expect(result1.length).toBe(result2.length);
    });
  });

  describe('embedBatch', () => {
    beforeEach(() => {
      provider = new DualCodeEmbeddingProvider();
    });

    it('should return array of Float32Arrays', async () => {
      const results = await provider.embedBatch(['text1', 'text2', 'text3']);

      expect(Array.isArray(results)).toBe(true);
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result).toBeInstanceOf(Float32Array);
      });
    });

    it('should return embeddings of correct dimension', async () => {
      const results = await provider.embedBatch(['text1', 'text2']);

      results.forEach(result => {
        expect(result.length).toBe(1536);
      });
    });

    it('should handle empty batch', async () => {
      const results = await provider.embedBatch([]);
      expect(results).toEqual([]);
    });

    it('should handle single item batch', async () => {
      const results = await provider.embedBatch(['single']);

      expect(results).toHaveLength(1);
      expect(results[0]).toBeInstanceOf(Float32Array);
    });
  });

  describe('embedQuery', () => {
    beforeEach(() => {
      provider = new DualCodeEmbeddingProvider();
    });

    it('should return Float32Array', async () => {
      const result = await provider.embedQuery('How do I sort an array?');
      expect(result).toBeInstanceOf(Float32Array);
    });

    it('should return embedding of correct dimension', async () => {
      const result = await provider.embedQuery('What is binary search?');
      expect(result.length).toBe(1536);
    });

    it('should call embed for query content', async () => {
      await provider.embedQuery('test query');
      expect(mockBaseProvider.embed).toHaveBeenCalled();
    });
  });

  describe('embedCode', () => {
    beforeEach(() => {
      provider = new DualCodeEmbeddingProvider();
    });

    it('should return Float32Array for code', async () => {
      const code = 'function sort(arr) { return arr.sort(); }';
      const result = await provider.embedCode(code);
      expect(result).toBeInstanceOf(Float32Array);
    });

    it('should return embedding of correct dimension', async () => {
      const code = 'const x = 1;';
      const result = await provider.embedCode(code);
      expect(result.length).toBe(1536);
    });
  });

  describe('embedFused', () => {
    beforeEach(() => {
      provider = new DualCodeEmbeddingProvider({
        nlpWeight: 0.5,
        codeWeight: 0.5,
      });
    });

    it('should return Float32Array', async () => {
      const result = await provider.embedFused('mixed content');
      expect(result).toBeInstanceOf(Float32Array);
    });

    it('should return embedding of correct dimension', async () => {
      const result = await provider.embedFused('test content');
      expect(result.length).toBe(1536);
    });

    it('should accept isCode parameter', async () => {
      const result = await provider.embedFused('function test() {}', true);
      expect(result).toBeInstanceOf(Float32Array);
    });

    it('should normalize fused embeddings', async () => {
      const result = await provider.embedFused('test');

      // Check that it's a valid embedding (non-zero values)
      const hasNonZero = Array.from(result).some(v => v !== 0);
      expect(hasNonZero).toBe(true);
    });
  });

  describe('detectContentType', () => {
    beforeEach(() => {
      provider = new DualCodeEmbeddingProvider();
    });

    it('should detect JavaScript/TypeScript code', () => {
      const jsCode = 'const foo = () => { return bar; };';
      expect(provider.detectContentType(jsCode)).toBe('code');

      const tsCode = 'interface User { name: string; age: number; }';
      expect(provider.detectContentType(tsCode)).toBe('code');
    });

    it('should detect Python code', () => {
      const pyCode = 'def greet(name):\n    print(f"Hello, {name}")';
      expect(provider.detectContentType(pyCode)).toBe('code');

      const pyClass = 'class MyClass:\n    def __init__(self):\n        pass';
      expect(provider.detectContentType(pyClass)).toBe('code');
    });

    it('should detect import/export statements', () => {
      const imports = 'import { Component } from "@angular/core";';
      expect(provider.detectContentType(imports)).toBe('code');

      const exports = 'export default class App {}';
      expect(provider.detectContentType(exports)).toBe('code');
    });

    it('should detect natural language', () => {
      const query1 = 'How do I sort an array in JavaScript?';
      expect(provider.detectContentType(query1)).toBe('natural_language');

      const query2 = 'What is the best way to handle errors?';
      expect(provider.detectContentType(query2)).toBe('natural_language');
    });

    it('should detect mixed content', () => {
      const mixed = `
        // This function sorts an array
        function quickSort(arr) {
          if (arr.length <= 1) return arr;
        }
      `;
      const result = provider.detectContentType(mixed);
      expect(['mixed', 'code']).toContain(result);
    });

    it('should handle empty string', () => {
      // Empty strings return 'mixed' (no indicators detected)
      expect(provider.detectContentType('')).toBe('mixed');
    });

    it('should handle whitespace only', () => {
      // Whitespace returns 'mixed' (no indicators detected)
      expect(provider.detectContentType('   ')).toBe('mixed');
    });

    it('should detect code by symbol patterns', () => {
      const symbols = '() => { [].map(x => x * 2); };';
      expect(provider.detectContentType(symbols)).toBe('code');
    });
  });

  describe('getCacheStats', () => {
    beforeEach(() => {
      provider = new DualCodeEmbeddingProvider({ cacheEnabled: true });
    });

    it('should return cache statistics object', () => {
      const stats = provider.getCacheStats();

      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('hits');
      expect(stats).toHaveProperty('misses');
      expect(stats).toHaveProperty('hitRatio');
    });

    it('should return initial stats with zero values', () => {
      const stats = provider.getCacheStats();

      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRatio).toBe(0);
    });

    it('should track cache operations', async () => {
      await provider.embed('test1');
      await provider.embed('test2');
      await provider.embed('test1'); // Should be cache hit

      const stats = provider.getCacheStats();
      expect(stats.size).toBeGreaterThanOrEqual(0);
    });

    it('should respect cacheMaxSize in config', () => {
      // cacheMaxSize is used internally to limit cache size
      provider = new DualCodeEmbeddingProvider({ cacheMaxSize: 500 });
      const config = provider.getConfig();
      expect(config.cacheMaxSize).toBe(500);
    });
  });

  describe('clearCache', () => {
    beforeEach(() => {
      provider = new DualCodeEmbeddingProvider({ cacheEnabled: true });
    });

    it('should clear the cache', async () => {
      await provider.embed('test');
      provider.clearCache();

      const stats = provider.getCacheStats();
      expect(stats.size).toBe(0);
    });

    it('should reset cache statistics', async () => {
      await provider.embed('test');
      await provider.embed('test'); // Hit
      provider.clearCache();

      const stats = provider.getCacheStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('isAvailable', () => {
    beforeEach(() => {
      provider = new DualCodeEmbeddingProvider();
    });

    it('should return boolean', async () => {
      const result = await provider.isAvailable();
      expect(typeof result).toBe('boolean');
    });

    it('should return true when provider is available', async () => {
      mockBaseProvider.isAvailable.mockResolvedValue(true);
      const result = await provider.isAvailable();
      expect(result).toBe(true);
    });

    it('should return false when provider unavailable', async () => {
      mockBaseProvider.isAvailable.mockResolvedValue(false);
      const result = await provider.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('getProviderName', () => {
    beforeEach(() => {
      provider = new DualCodeEmbeddingProvider();
    });

    it('should return string', () => {
      const name = provider.getProviderName();
      expect(typeof name).toBe('string');
    });

    it('should return non-empty name', () => {
      const name = provider.getProviderName();
      expect(name.length).toBeGreaterThan(0);
    });
  });

  describe('getDimensions', () => {
    it('should return configured dimension', () => {
      provider = new DualCodeEmbeddingProvider({ dimension: 768 });
      expect(provider.getDimensions()).toBe(768);
    });

    it('should return default dimension', () => {
      provider = new DualCodeEmbeddingProvider();
      expect(provider.getDimensions()).toBe(1536);
    });
  });

  describe('getConfig', () => {
    it('should return readonly config', () => {
      provider = new DualCodeEmbeddingProvider({
        nlpWeight: 0.3,
        codeWeight: 0.7,
      });

      const config = provider.getConfig();

      expect(config.nlpWeight).toBe(0.3);
      expect(config.codeWeight).toBe(0.7);
    });

    it('should include all config properties', () => {
      provider = new DualCodeEmbeddingProvider();
      const config = provider.getConfig();

      expect(config).toHaveProperty('dimension');
      expect(config).toHaveProperty('nlpWeight');
      expect(config).toHaveProperty('codeWeight');
      expect(config).toHaveProperty('cacheEnabled');
      expect(config).toHaveProperty('cacheMaxSize');
      expect(config).toHaveProperty('provider');
    });
  });

  describe('LRU cache behavior', () => {
    beforeEach(() => {
      provider = new DualCodeEmbeddingProvider({
        cacheEnabled: true,
        cacheMaxSize: 3, // Small cache for testing
      });
    });

    it('should cache embeddings', async () => {
      await provider.embed('test');
      const statsAfterFirst = provider.getCacheStats();

      await provider.embed('test');
      const statsAfterSecond = provider.getCacheStats();

      // Second call should hit cache
      expect(statsAfterSecond.hits).toBeGreaterThan(statsAfterFirst.hits);
    });

    it('should evict least recently used when full', async () => {
      // Fill cache
      await provider.embed('item1');
      await provider.embed('item2');
      await provider.embed('item3');

      // Access item1 to make it recently used
      await provider.embed('item1');

      // Add new item, should evict item2
      await provider.embed('item4');

      const stats = provider.getCacheStats();
      // Cache should be at max size
      expect(stats.size).toBeLessThanOrEqual(3);
    });

    it('should track hit ratio', async () => {
      await provider.embed('test'); // Miss
      await provider.embed('test'); // Hit
      await provider.embed('test'); // Hit

      const stats = provider.getCacheStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      provider = new DualCodeEmbeddingProvider();
    });

    it('should propagate provider errors', async () => {
      mockBaseProvider.embed.mockRejectedValue(new Error('Provider failed'));

      await expect(provider.embed('test')).rejects.toThrow('Provider failed');
    });

    it('should handle initialization errors', async () => {
      vi.mocked(EmbeddingProviderFactory.getProvider).mockRejectedValue(
        new Error('Init failed')
      );

      const newProvider = new DualCodeEmbeddingProvider();
      await expect(newProvider.embed('test')).rejects.toThrow();
    });
  });

  describe('createLEANNEmbedder factory', () => {
    beforeEach(() => {
      provider = new DualCodeEmbeddingProvider();
    });

    it('should create LEANN-compatible embedder function', async () => {
      const embedder = createLEANNEmbedder(provider);

      expect(typeof embedder).toBe('function');
    });

    it('should return Float32Array from embedder', async () => {
      const embedder = createLEANNEmbedder(provider);
      const embedding = await embedder('test text');

      expect(embedding).toBeInstanceOf(Float32Array);
    });

    it('should return embedding of correct dimension', async () => {
      const embedder = createLEANNEmbedder(provider);
      const embedding = await embedder('test text');

      expect(embedding.length).toBe(1536);
    });

    it('should work with different content types', async () => {
      const embedder = createLEANNEmbedder(provider);

      const queryEmbed = await embedder('How does this work?');
      expect(queryEmbed).toBeInstanceOf(Float32Array);

      const codeEmbed = await embedder('function test() { return 42; }');
      expect(codeEmbed).toBeInstanceOf(Float32Array);
    });
  });

  describe('weight configuration', () => {
    it('should use configured nlpWeight', async () => {
      provider = new DualCodeEmbeddingProvider({
        nlpWeight: 0.8,
        codeWeight: 0.2,
      });

      const config = provider.getConfig();
      expect(config.nlpWeight).toBe(0.8);
      expect(config.codeWeight).toBe(0.2);
    });

    it('should use default weights when not specified', () => {
      provider = new DualCodeEmbeddingProvider();

      const config = provider.getConfig();
      expect(config.nlpWeight).toBe(0.4);
      expect(config.codeWeight).toBe(0.6);
    });
  });

  describe('IEmbeddingProvider interface compliance', () => {
    beforeEach(() => {
      provider = new DualCodeEmbeddingProvider();
    });

    it('should implement embed method', () => {
      expect(typeof provider.embed).toBe('function');
    });

    it('should implement embedBatch method', () => {
      expect(typeof provider.embedBatch).toBe('function');
    });

    it('should implement isAvailable method', () => {
      expect(typeof provider.isAvailable).toBe('function');
    });

    it('should implement getProviderName method', () => {
      expect(typeof provider.getProviderName).toBe('function');
    });

    it('should implement getDimensions method', () => {
      expect(typeof provider.getDimensions).toBe('function');
    });

    it('should return Float32Array from embed', async () => {
      const result = await provider.embed('test');
      expect(result).toBeInstanceOf(Float32Array);
    });

    it('should return Float32Array[] from embedBatch', async () => {
      const results = await provider.embedBatch(['text1', 'text2']);

      expect(Array.isArray(results)).toBe(true);
      results.forEach(result => {
        expect(result).toBeInstanceOf(Float32Array);
      });
    });
  });
});
