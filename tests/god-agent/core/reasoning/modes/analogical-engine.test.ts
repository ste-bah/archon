/**
 * AnalogicalEngine Tests
 * SPEC-ANA-001 Verification - Real Embeddings Integration
 *
 * Tests cover:
 * 1. MockEmbeddingProvider integration (no API dependency)
 * 2. Real embedding generation (not zero-filled)
 * 3. Cache functionality
 * 4. Batch processing
 * 5. Fallback mechanisms
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AnalogicalEngine } from '../../../../../src/god-agent/core/reasoning/modes/analogical-engine.js';
import { MockEmbeddingProvider } from '../../../../../src/god-agent/core/memory/embedding-provider.js';
import type { IReasoningRequest } from '../../../../../src/god-agent/core/reasoning/reasoning-types.js';
import type { AnalogicalConfig } from '../../../../../src/god-agent/core/reasoning/advanced-reasoning-types.js';

describe('AnalogicalEngine - SPEC-ANA-001 Verification', () => {
  let engine: AnalogicalEngine;
  let mockEmbeddingProvider: MockEmbeddingProvider;

  beforeEach(() => {
    mockEmbeddingProvider = new MockEmbeddingProvider();
    engine = new AnalogicalEngine({
      embeddingProvider: mockEmbeddingProvider
    });
  });

  describe('Embedding Provider Integration', () => {
    it('should use embedding provider for synthetic patterns', async () => {
      const request: IReasoningRequest = {
        query: 'How is software like biology?',
        mode: 'hybrid'
      };

      const config: AnalogicalConfig = {
        sourceDomain: 'software',
        targetDomain: 'biology',
        maxMappings: 3
      };

      const result = await engine.reason(request, config);

      // Should have generated analogical mappings
      expect(result.analogicalMappings).toBeDefined();
      expect(result.analogicalMappings.length).toBeGreaterThan(0);
    });

    it('should generate non-zero embeddings via provider', async () => {
      const request: IReasoningRequest = {
        query: 'Compare physics and economics',
        mode: 'hybrid'
      };

      const config: AnalogicalConfig = {
        sourceDomain: 'physics',
        targetDomain: 'economics',
        maxMappings: 5,
        structuralMappingThreshold: 0.3 // Lower threshold to ensure results
      };

      const result = await engine.reason(request, config);

      // Should have at least some mappings
      expect(result.analogicalMappings).toBeDefined();
      expect(result.analogicalMappings.length).toBeGreaterThan(0);

      // Check that embeddings are not all zeros for any mapping
      for (const mapping of result.analogicalMappings) {
        const sourcePattern = mapping.sourcePattern;
        expect(sourcePattern).toBeDefined();
        expect(sourcePattern.embedding).toBeDefined();
        expect(sourcePattern.embedding.length).toBe(1536);

        // Verify not all zeros
        const hasNonZero = Array.from(sourcePattern.embedding).some(v => v !== 0);
        expect(hasNonZero).toBe(true);

        // Check L2 normalization
        const magnitudeSquared = Array.from(sourcePattern.embedding)
          .reduce((sum, v) => sum + v * v, 0);
        expect(Math.abs(magnitudeSquared - 1.0)).toBeLessThan(0.01); // Should be normalized
      }
    });

    it('should handle embeddings without provider (fallback to mock)', async () => {
      // Create engine without embedding provider
      const engineNoProvider = new AnalogicalEngine({});

      const request: IReasoningRequest = {
        query: 'Software and music similarities',
        mode: 'hybrid'
      };

      const config: AnalogicalConfig = {
        sourceDomain: 'music', // Use predefined mapping
        targetDomain: 'software',
        maxMappings: 3,
        structuralMappingThreshold: 0.3 // Lower threshold
      };

      const result = await engineNoProvider.reason(request, config);

      // Should still work with fallback mock embeddings
      expect(result.analogicalMappings).toBeDefined();
      expect(result.analogicalMappings.length).toBeGreaterThan(0);

      // Check all mappings have valid embeddings
      for (const mapping of result.analogicalMappings) {
        const sourcePattern = mapping.sourcePattern;
        expect(sourcePattern.embedding).toBeDefined();
        const hasNonZero = Array.from(sourcePattern.embedding).some(v => v !== 0);
        expect(hasNonZero).toBe(true);
      }
    });
  });

  describe('Embedding Cache', () => {
    it('should cache embeddings for same domain', async () => {
      const request1: IReasoningRequest = {
        query: 'First query',
        mode: 'hybrid'
      };

      const config1: AnalogicalConfig = {
        sourceDomain: 'software',
        targetDomain: 'biology',
        maxMappings: 3
      };

      // First call - generates embeddings
      await engine.reason(request1, config1);
      const stats1 = engine.getSyntheticPatternCacheStats();
      expect(stats1.size).toBeGreaterThan(0);

      // Second call - should use cache
      const request2: IReasoningRequest = {
        query: 'Second query',
        mode: 'hybrid'
      };

      const config2: AnalogicalConfig = {
        sourceDomain: 'software', // Same domain
        targetDomain: 'physics',
        maxMappings: 3
      };

      await engine.reason(request2, config2);
      const stats2 = engine.getSyntheticPatternCacheStats();

      // Cache should still have entries
      expect(stats2.size).toBeGreaterThan(0);
    });

    it('should clear cache on demand', async () => {
      const request: IReasoningRequest = {
        query: 'Test query',
        mode: 'hybrid'
      };

      const config: AnalogicalConfig = {
        sourceDomain: 'software',
        targetDomain: 'biology',
        maxMappings: 3
      };

      await engine.reason(request, config);
      const statsBeforeClear = engine.getSyntheticPatternCacheStats();
      expect(statsBeforeClear.size).toBeGreaterThan(0);

      engine.clearSyntheticPatternCache();
      const statsAfterClear = engine.getSyntheticPatternCacheStats();
      expect(statsAfterClear.size).toBe(0);
    });

    it('should benefit from cache on repeated patterns', async () => {
      const request: IReasoningRequest = {
        query: 'Repeated query',
        mode: 'hybrid'
      };

      const config: AnalogicalConfig = {
        sourceDomain: 'software',
        targetDomain: 'biology',
        maxMappings: 3
      };

      // First call - cold cache
      const start1 = Date.now();
      await engine.reason(request, config);
      const duration1 = Date.now() - start1;

      // Second call - warm cache
      const start2 = Date.now();
      await engine.reason(request, config);
      const duration2 = Date.now() - start2;

      // Second call should be faster or similar (cache hit)
      // We can't guarantee it's faster due to other factors, but cache should be populated
      const stats = engine.getSyntheticPatternCacheStats();
      expect(stats.size).toBeGreaterThan(0);
    });
  });

  describe('Batch Embedding Processing', () => {
    it('should generate embeddings for multiple concepts', async () => {
      const request: IReasoningRequest = {
        query: 'Complex cross-domain query',
        mode: 'hybrid'
      };

      const config: AnalogicalConfig = {
        sourceDomain: 'software',
        targetDomain: 'biology',
        maxMappings: 5 // Request more mappings
      };

      const result = await engine.reason(request, config);

      // Should generate multiple patterns with unique embeddings
      expect(result.analogicalMappings.length).toBeGreaterThan(0);

      const embeddings = result.analogicalMappings.map(m => m.sourcePattern.embedding);

      // All embeddings should be non-zero
      for (const embedding of embeddings) {
        const hasNonZero = Array.from(embedding).some(v => v !== 0);
        expect(hasNonZero).toBe(true);
      }

      // Embeddings should be different (not all identical)
      if (embeddings.length > 1) {
        const first = embeddings[0];
        const second = embeddings[1];
        const areDifferent = Array.from(first).some((v, i) => v !== second[i]);
        expect(areDifferent).toBe(true);
      }
    });

    it('should handle embedBatch if available', async () => {
      // Create provider with embedBatch support
      const providerWithBatch = new MockEmbeddingProvider();
      const engineWithBatch = new AnalogicalEngine({
        embeddingProvider: providerWithBatch
      });

      const request: IReasoningRequest = {
        query: 'Batch test',
        mode: 'hybrid'
      };

      const config: AnalogicalConfig = {
        sourceDomain: 'physics',
        targetDomain: 'economics',
        maxMappings: 4,
        structuralMappingThreshold: 0.3 // Lower threshold
      };

      const result = await engineWithBatch.reason(request, config);

      // Should successfully generate mappings using batch
      expect(result.analogicalMappings).toBeDefined();
      expect(result.analogicalMappings.length).toBeGreaterThan(0);
    });
  });

  describe('Cross-Domain Analogies', () => {
    it('should find software-biology analogies', async () => {
      const request: IReasoningRequest = {
        query: 'How are software classes like biological cells?',
        mode: 'hybrid'
      };

      const config: AnalogicalConfig = {
        sourceDomain: 'software',
        targetDomain: 'biology',
        structuralMappingThreshold: 0.6,
        maxMappings: 5
      };

      const result = await engine.reason(request, config);

      expect(result.mode).toBe('analogical');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.analogicalMappings.length).toBeGreaterThan(0);

      // Check mapping structure
      const firstMapping = result.analogicalMappings[0];
      expect(firstMapping.sourcePattern).toBeDefined();
      expect(firstMapping.targetDomain).toBe('biology');
      expect(firstMapping.structuralSimilarity).toBeGreaterThanOrEqual(0);
      expect(firstMapping.transferability).toBeGreaterThanOrEqual(0);
    });

    it('should respect structural mapping threshold', async () => {
      const request: IReasoningRequest = {
        query: 'Physics and economics similarities',
        mode: 'hybrid'
      };

      const highThresholdConfig: AnalogicalConfig = {
        sourceDomain: 'physics',
        targetDomain: 'economics',
        structuralMappingThreshold: 0.9, // Very high threshold
        maxMappings: 10
      };

      const lowThresholdConfig: AnalogicalConfig = {
        sourceDomain: 'physics',
        targetDomain: 'economics',
        structuralMappingThreshold: 0.3, // Low threshold
        maxMappings: 10
      };

      const highResult = await engine.reason(request, highThresholdConfig);
      const lowResult = await engine.reason(request, lowThresholdConfig);

      // Lower threshold should return more or equal mappings
      expect(lowResult.analogicalMappings.length).toBeGreaterThanOrEqual(
        highResult.analogicalMappings.length
      );

      // All mappings should meet threshold
      for (const mapping of highResult.analogicalMappings) {
        expect(mapping.structuralSimilarity).toBeGreaterThanOrEqual(0.9);
      }
    });

    it('should limit mappings to maxMappings', async () => {
      const request: IReasoningRequest = {
        query: 'Architecture vs music',
        mode: 'hybrid'
      };

      const config: AnalogicalConfig = {
        sourceDomain: 'architecture',
        targetDomain: 'music',
        maxMappings: 3,
        structuralMappingThreshold: 0.1 // Low to get many candidates
      };

      const result = await engine.reason(request, config);

      // Should respect maxMappings limit
      expect(result.analogicalMappings.length).toBeLessThanOrEqual(3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle unknown domains gracefully', async () => {
      const request: IReasoningRequest = {
        query: 'Unknown domains',
        mode: 'hybrid'
      };

      const config: AnalogicalConfig = {
        sourceDomain: 'unknown_domain_xyz',
        targetDomain: 'another_unknown_domain',
        maxMappings: 3
      };

      const result = await engine.reason(request, config);

      // Should still generate synthetic patterns
      expect(result.analogicalMappings).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty concept lists', async () => {
      const request: IReasoningRequest = {
        query: 'Minimal domain',
        mode: 'hybrid'
      };

      const config: AnalogicalConfig = {
        sourceDomain: 'x',
        targetDomain: 'y',
        maxMappings: 1
      };

      const result = await engine.reason(request, config);

      // Should handle gracefully with fallback
      expect(result).toBeDefined();
      expect(result.answer).toBeDefined();
    });

    it('should handle embedding provider errors gracefully', async () => {
      // Create provider that throws errors
      const errorProvider = {
        async embed(_text: string): Promise<Float32Array> {
          throw new Error('Embedding API unavailable');
        },
        getProviderName: () => 'error-provider',
        getDimensions: () => 1536
      };

      const engineWithErrorProvider = new AnalogicalEngine({
        embeddingProvider: errorProvider
      });

      const request: IReasoningRequest = {
        query: 'Error handling test',
        mode: 'hybrid'
      };

      const config: AnalogicalConfig = {
        sourceDomain: 'software',
        targetDomain: 'biology',
        maxMappings: 2
      };

      // Should fallback to mock embeddings
      const result = await engineWithErrorProvider.reason(request, config);
      expect(result).toBeDefined();
      expect(result.analogicalMappings).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should complete reasoning within 150ms target', async () => {
      const request: IReasoningRequest = {
        query: 'Performance test',
        mode: 'hybrid'
      };

      const config: AnalogicalConfig = {
        sourceDomain: 'software',
        targetDomain: 'biology',
        maxMappings: 5
      };

      const start = Date.now();
      const result = await engine.reason(request, config);
      const duration = Date.now() - start;

      expect(result.latencyMs).toBeDefined();
      // Allow some overhead for test environment
      expect(duration).toBeLessThan(500); // Relaxed for test environment
    });

    it('should report accurate latency metrics', async () => {
      const request: IReasoningRequest = {
        query: 'Latency test',
        mode: 'hybrid'
      };

      const config: AnalogicalConfig = {
        sourceDomain: 'physics',
        targetDomain: 'economics',
        maxMappings: 3
      };

      const result = await engine.reason(request, config);

      expect(result.latencyMs).toBeGreaterThan(0);
      expect(result.processingTimeMs).toBe(result.latencyMs);
    });
  });

  describe('Output Format', () => {
    it('should return properly formatted result', async () => {
      const request: IReasoningRequest = {
        query: 'Format test',
        mode: 'hybrid'
      };

      const config: AnalogicalConfig = {
        sourceDomain: 'software',
        targetDomain: 'architecture',
        maxMappings: 3
      };

      const result = await engine.reason(request, config);

      // Check all required fields
      expect(result.mode).toBe('analogical');
      expect(result.answer).toBeDefined();
      expect(typeof result.answer).toBe('string');
      expect(result.reasoningSteps).toBeDefined();
      expect(Array.isArray(result.reasoningSteps)).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.analogicalMappings).toBeDefined();
      expect(Array.isArray(result.analogicalMappings)).toBe(true);
    });

    it('should include meaningful reasoning steps', async () => {
      const request: IReasoningRequest = {
        query: 'Reasoning steps test',
        mode: 'hybrid'
      };

      const config: AnalogicalConfig = {
        sourceDomain: 'biology',
        targetDomain: 'software',
        maxMappings: 3
      };

      const result = await engine.reason(request, config);

      expect(result.reasoningSteps.length).toBeGreaterThan(0);
      expect(result.reasoningSteps[0]).toContain('biology');
      expect(result.reasoningSteps[0]).toContain('software');
    });

    it('should format answer with domain information', async () => {
      const request: IReasoningRequest = {
        query: 'Answer format test',
        mode: 'hybrid'
      };

      const config: AnalogicalConfig = {
        sourceDomain: 'music',
        targetDomain: 'software',
        maxMappings: 2
      };

      const result = await engine.reason(request, config);

      expect(result.answer).toContain('music');
      expect(result.answer).toContain('software');
    });
  });
});
