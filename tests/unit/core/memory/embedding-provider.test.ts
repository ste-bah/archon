/**
 * Unit Tests for MockEmbeddingProvider
 * Tests embedding generation with normalization and deterministic seeding
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockEmbeddingProvider } from '../../../../src/god-agent/core/memory/embedding-provider.js';
import { VECTOR_DIM } from '../../../../src/god-agent/core/validation/index.js';

describe('MockEmbeddingProvider', () => {
  let provider: MockEmbeddingProvider;

  beforeEach(() => {
    provider = new MockEmbeddingProvider();
  });

  describe('embed', () => {
    it('should return Float32Array', async () => {
      const embedding = await provider.embed('test text');

      expect(embedding).toBeInstanceOf(Float32Array);
    });

    it('should return 1536-dimensional vector', async () => {
      // TASK-VEC-001-008: Updated from 768D to 1536D per REQ-VEC-01
      const embedding = await provider.embed('test text');

      expect(embedding.length).toBe(VECTOR_DIM);
      expect(embedding.length).toBe(1536);
    });

    it('should return L2-normalized vector', async () => {
      const embedding = await provider.embed('test text');

      // Calculate L2 norm
      let sumSquares = 0;
      for (let i = 0; i < embedding.length; i++) {
        sumSquares += embedding[i] * embedding[i];
      }
      const norm = Math.sqrt(sumSquares);

      // Should be approximately 1.0
      expect(norm).toBeCloseTo(1.0, 6);
    });

    it('should return different embeddings for different texts', async () => {
      const embedding1 = await provider.embed('text one');
      const embedding2 = await provider.embed('text two');

      // Calculate similarity
      let dotProduct = 0;
      for (let i = 0; i < VECTOR_DIM; i++) {
        dotProduct += embedding1[i] * embedding2[i];
      }

      // Random vectors should not be identical
      expect(dotProduct).not.toBe(1.0);
    });

    it('should contain finite values only', async () => {
      const embedding = await provider.embed('test text');

      for (let i = 0; i < embedding.length; i++) {
        expect(Number.isFinite(embedding[i])).toBe(true);
        expect(Number.isNaN(embedding[i])).toBe(false);
      }
    });

    it('should have values in reasonable range', async () => {
      const embedding = await provider.embed('test text');

      for (let i = 0; i < embedding.length; i++) {
        // L2-normalized values should be between -1 and 1
        expect(embedding[i]).toBeGreaterThanOrEqual(-1);
        expect(embedding[i]).toBeLessThanOrEqual(1);
      }
    });

    it('should complete within reasonable time', async () => {
      const start = Date.now();
      await provider.embed('test text');
      const duration = Date.now() - start;

      // Should complete within 100ms (simulates 10ms API delay)
      expect(duration).toBeLessThan(100);
    });

    it('should handle empty strings', async () => {
      const embedding = await provider.embed('');

      expect(embedding.length).toBe(VECTOR_DIM);

      // Calculate norm
      let sumSquares = 0;
      for (let i = 0; i < embedding.length; i++) {
        sumSquares += embedding[i] * embedding[i];
      }
      const norm = Math.sqrt(sumSquares);

      expect(norm).toBeCloseTo(1.0, 6);
    });

    it('should handle Unicode text', async () => {
      const embedding = await provider.embed('你好世界 🚀');

      expect(embedding.length).toBe(VECTOR_DIM);

      // Verify normalized
      let sumSquares = 0;
      for (let i = 0; i < embedding.length; i++) {
        sumSquares += embedding[i] * embedding[i];
      }
      const norm = Math.sqrt(sumSquares);

      expect(norm).toBeCloseTo(1.0, 6);
    });

    it('should handle very long text', async () => {
      const longText = 'word '.repeat(10000);
      const embedding = await provider.embed(longText);

      expect(embedding.length).toBe(VECTOR_DIM);
    });
  });

  describe('embedDeterministic', () => {
    it('should return same embedding for same text', async () => {
      const embedding1 = await provider.embedDeterministic('test text');
      const embedding2 = await provider.embedDeterministic('test text');

      expect(embedding1.length).toBe(embedding2.length);

      // Should be identical
      for (let i = 0; i < VECTOR_DIM; i++) {
        expect(embedding1[i]).toBe(embedding2[i]);
      }
    });

    it('should return different embeddings for different texts', async () => {
      const embedding1 = await provider.embedDeterministic('text one');
      const embedding2 = await provider.embedDeterministic('text two');

      // Should be different
      let identical = true;
      for (let i = 0; i < VECTOR_DIM; i++) {
        if (embedding1[i] !== embedding2[i]) {
          identical = false;
          break;
        }
      }

      expect(identical).toBe(false);
    });

    it('should return L2-normalized vectors', async () => {
      const embedding = await provider.embedDeterministic('test text');

      let sumSquares = 0;
      for (let i = 0; i < embedding.length; i++) {
        sumSquares += embedding[i] * embedding[i];
      }
      const norm = Math.sqrt(sumSquares);

      expect(norm).toBeCloseTo(1.0, 6);
    });

    it('should be deterministic across multiple calls', async () => {
      const embeddings = [];

      for (let i = 0; i < 5; i++) {
        embeddings.push(await provider.embedDeterministic('consistent'));
      }

      // All should be identical
      for (let i = 1; i < embeddings.length; i++) {
        for (let j = 0; j < VECTOR_DIM; j++) {
          expect(embeddings[i][j]).toBe(embeddings[0][j]);
        }
      }
    });

    it('should produce different seeds for different texts', async () => {
      const texts = ['a', 'b', 'c', 'aa', 'ab', 'ba'];
      const embeddings = [];

      for (const text of texts) {
        embeddings.push(await provider.embedDeterministic(text));
      }

      // Check each pair is different
      for (let i = 0; i < embeddings.length; i++) {
        for (let j = i + 1; j < embeddings.length; j++) {
          let identical = true;
          for (let k = 0; k < VECTOR_DIM; k++) {
            if (embeddings[i][k] !== embeddings[j][k]) {
              identical = false;
              break;
            }
          }
          expect(identical).toBe(false);
        }
      }
    });

    it('should handle empty string deterministically', async () => {
      const embedding1 = await provider.embedDeterministic('');
      const embedding2 = await provider.embedDeterministic('');

      for (let i = 0; i < VECTOR_DIM; i++) {
        expect(embedding1[i]).toBe(embedding2[i]);
      }
    });
  });

  describe('normalization quality', () => {
    it('should maintain norm close to 1.0', async () => {
      const texts = [
        'short',
        'medium length text',
        'very long text '.repeat(100),
        '🚀',
        '你好世界',
        ''
      ];

      for (const text of texts) {
        const embedding = await provider.embed(text);

        let sumSquares = 0;
        for (let i = 0; i < embedding.length; i++) {
          sumSquares += embedding[i] * embedding[i];
        }
        const norm = Math.sqrt(sumSquares);

        // Norm should be very close to 1.0
        expect(Math.abs(norm - 1.0)).toBeLessThan(1e-6);
      }
    });

    it('should never produce zero vectors', async () => {
      for (let i = 0; i < 10; i++) {
        const embedding = await provider.embed(`test ${i}`);

        let isZero = true;
        for (let j = 0; j < embedding.length; j++) {
          if (embedding[j] !== 0) {
            isZero = false;
            break;
          }
        }

        expect(isZero).toBe(false);
      }
    });
  });

  describe('vector distribution', () => {
    it('should use both positive and negative values', async () => {
      const embedding = await provider.embed('test text');

      let hasPositive = false;
      let hasNegative = false;

      for (let i = 0; i < embedding.length; i++) {
        if (embedding[i] > 0) hasPositive = true;
        if (embedding[i] < 0) hasNegative = true;
      }

      expect(hasPositive).toBe(true);
      expect(hasNegative).toBe(true);
    });

    it('should have reasonable variance', async () => {
      const embedding = await provider.embed('test text');

      // Calculate mean
      let sum = 0;
      for (let i = 0; i < embedding.length; i++) {
        sum += embedding[i];
      }
      const mean = sum / embedding.length;

      // For normalized random vectors, mean should be close to 0
      expect(Math.abs(mean)).toBeLessThan(0.1);
    });
  });

  describe('performance characteristics', () => {
    it('should handle batch embedding efficiently', async () => {
      const texts = Array.from({ length: 10 }, (_, i) => `text ${i}`);

      const start = Date.now();
      await Promise.all(texts.map(text => provider.embed(text)));
      const duration = Date.now() - start;

      // Should complete in reasonable time (parallel execution)
      expect(duration).toBeLessThan(1000);
    });

    it('should produce consistent dimensions in batch', async () => {
      const embeddings = await Promise.all([
        provider.embed('text 1'),
        provider.embed('text 2'),
        provider.embed('text 3')
      ]);

      for (const embedding of embeddings) {
        expect(embedding.length).toBe(VECTOR_DIM);
      }
    });
  });
});
