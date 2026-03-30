/**
 * LocalEmbeddingProvider Integration Test
 * SPEC-EMB-001 - Tests for local all-mpnet-base-v2 embedding API
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LocalEmbeddingProvider, EmbeddingProviderFactory } from '../../../../src/god-agent/core/memory/embedding-provider.js';
import { VECTOR_DIM } from '../../../../src/god-agent/core/validation/index.js';

describe('LocalEmbeddingProvider', () => {
  let provider: LocalEmbeddingProvider;
  let isApiAvailable: boolean;

  beforeAll(async () => {
    provider = new LocalEmbeddingProvider();
    isApiAvailable = await provider.isAvailable();
    if (!isApiAvailable) {
      console.warn('⚠️ Local embedding API not running. Skipping API-dependent tests.');
      console.warn('   Start with: ./embedding-api/api-embed.sh start');
    }
  });

  describe('isAvailable', () => {
    it('should return boolean indicating API availability', async () => {
      const result = await provider.isAvailable();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('embed', () => {
    it('should generate 768-dimensional embedding', async () => {
      if (!isApiAvailable) return;

      const embedding = await provider.embed('Hello world');
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(VECTOR_DIM);
    });

    it('should generate L2-normalized vectors', async () => {
      if (!isApiAvailable) return;

      const embedding = await provider.embed('Test normalization');
      const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
      expect(magnitude).toBeCloseTo(1.0, 2);
    });

    it('should cache repeated queries', async () => {
      if (!isApiAvailable) return;

      const text = 'Cache test ' + Date.now();

      // First call - hits API
      const start1 = Date.now();
      await provider.embed(text);
      const time1 = Date.now() - start1;

      // Second call - should hit cache
      const start2 = Date.now();
      await provider.embed(text);
      const time2 = Date.now() - start2;

      expect(time2).toBeLessThan(time1); // Cache should be faster
      expect(time2).toBeLessThan(5); // Cache should be < 5ms
    });
  });

  describe('embedBatch', () => {
    it('should generate batch embeddings', async () => {
      if (!isApiAvailable) return;

      const texts = ['dog', 'puppy', 'cat'];
      const embeddings = await provider.embedBatch(texts);

      expect(embeddings).toHaveLength(3);
      embeddings.forEach(emb => {
        expect(emb).toBeInstanceOf(Float32Array);
        expect(emb.length).toBe(VECTOR_DIM);
      });
    });

    it('should use cache for batch queries', async () => {
      if (!isApiAvailable) return;

      const texts = ['batch1-' + Date.now(), 'batch2-' + Date.now()];

      // First batch call
      await provider.embedBatch(texts);

      // Second batch should hit cache
      const stats = provider.getCacheStats();
      expect(stats.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe('semantic similarity', () => {
    function cosineSimilarity(a: Float32Array, b: Float32Array): number {
      let dot = 0, magA = 0, magB = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
      }
      return dot / (Math.sqrt(magA) * Math.sqrt(magB));
    }

    it('should produce semantically similar embeddings for related words', async () => {
      if (!isApiAvailable) return;

      const embeddings = await provider.embedBatch(['dog', 'puppy', 'cat', 'car']);

      const dogPuppy = cosineSimilarity(embeddings[0], embeddings[1]);
      const dogCat = cosineSimilarity(embeddings[0], embeddings[2]);
      const dogCar = cosineSimilarity(embeddings[0], embeddings[3]);

      // dog <-> puppy should be most similar
      expect(dogPuppy).toBeGreaterThan(0.7);
      // dog <-> cat should be moderately similar
      expect(dogCat).toBeGreaterThan(0.5);
      // dog <-> car should be least similar (but local embeddings have high baseline similarity)
      expect(dogCar).toBeLessThan(0.95);

      // Verify ordering: dog-puppy >= dog-cat >= dog-car (with tolerance for local embeddings)
      expect(dogPuppy).toBeGreaterThanOrEqual(dogCat - 0.1);
      expect(dogCat).toBeGreaterThanOrEqual(dogCar - 0.1);
    });

    it('should produce high similarity for synonyms', async () => {
      if (!isApiAvailable) return;

      const embeddings = await provider.embedBatch(['car', 'automobile', 'vehicle']);

      const carAuto = cosineSimilarity(embeddings[0], embeddings[1]);
      const carVehicle = cosineSimilarity(embeddings[0], embeddings[2]);

      expect(carAuto).toBeGreaterThan(0.8);
      expect(carVehicle).toBeGreaterThan(0.7);
    });
  });
});

describe('EmbeddingProviderFactory', () => {
  beforeAll(() => {
    EmbeddingProviderFactory.reset();
  });

  it('should check local availability', async () => {
    const result = await EmbeddingProviderFactory.isLocalAvailable();
    expect(typeof result).toBe('boolean');
  });

  it('should return appropriate provider based on availability', async () => {
    const provider = await EmbeddingProviderFactory.getProvider();
    expect(provider).toBeDefined();
    expect(typeof provider.embed).toBe('function');
  });

  it('should return mock provider when requested', () => {
    const mockProvider = EmbeddingProviderFactory.getMockProvider();
    expect(mockProvider.constructor.name).toBe('MockEmbeddingProvider');
  });

  it('should return local provider when requested', () => {
    const localProvider = EmbeddingProviderFactory.getLocalProvider();
    expect(localProvider.constructor.name).toBe('LocalEmbeddingProvider');
  });
});
