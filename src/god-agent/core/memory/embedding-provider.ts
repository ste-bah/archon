/**
 * Embedding Provider Implementation
 * SPEC-EMB-001 - Real Embedding Providers
 *
 * Provides semantic embedding generation via:
 * 1. LocalEmbeddingProvider - Uses local gte-Qwen2-1.5B-instruct API (PRIMARY)
 * 2. MockEmbeddingProvider - Random vectors for testing (FALLBACK)
 *
 * Local API: http://127.0.0.1:8000/embed (Alibaba-NLP/gte-Qwen2-1.5B-instruct)
 */

import type { IEmbeddingProvider } from './types.js';
import { VECTOR_DIM } from '../validation/index.js';

// ==================== Local Embedding Provider ====================

/**
 * Configuration for local embedding API
 */
export interface ILocalEmbeddingConfig {
  /** API endpoint URL (default: http://127.0.0.1:8000/embed) */
  endpoint?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Whether to cache embeddings (default: true) */
  enableCache?: boolean;
  /** Maximum cache size (default: 10000) */
  maxCacheSize?: number;
}

/**
 * Local embedding provider using gte-Qwen2-1.5B-instruct API
 * Generates real 1536-dimensional semantic embeddings
 *
 * @implements IEmbeddingProvider
 */
export class LocalEmbeddingProvider implements IEmbeddingProvider {
  private readonly endpoint: string;
  private readonly timeout: number;
  private readonly cache: Map<string, Float32Array>;
  private readonly maxCacheSize: number;
  private readonly enableCache: boolean;

  constructor(config: ILocalEmbeddingConfig = {}) {
    this.endpoint = config.endpoint ?? 'http://127.0.0.1:8000/embed';
    this.timeout = config.timeout ?? 30000;
    this.enableCache = config.enableCache ?? true;
    this.maxCacheSize = config.maxCacheSize ?? 10000;
    this.cache = new Map();
  }

  /**
   * Generate semantic embedding for text using local API
   * @param text - Text to embed
   * @returns 1536-dimensional L2-normalized semantic embedding
   */
  async embed(text: string): Promise<Float32Array> {
    // Check cache first (but validate it's not a zero vector)
    if (this.enableCache && this.cache.has(text)) {
      const cached = this.cache.get(text)!;
      const cachedNorm = Math.sqrt(cached.reduce((sum, v) => sum + v * v, 0));
      if (cachedNorm > 0.001) {
        return cached;
      }
      // Invalid cached value, remove it and refetch
      this.cache.delete(text);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: [text] }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { embeddings: number[][] };

      if (!data.embeddings || !data.embeddings[0]) {
        throw new Error('Invalid response from embedding API');
      }

      const embedding = new Float32Array(data.embeddings[0]);

      // Validate dimension
      if (embedding.length !== VECTOR_DIM) {
        throw new Error(`Expected ${VECTOR_DIM} dimensions, got ${embedding.length}`);
      }

      // L2 normalize (should already be normalized, but ensure consistency)
      const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
      if (magnitude > 0 && Math.abs(magnitude - 1) > 0.001) {
        for (let i = 0; i < embedding.length; i++) {
          embedding[i] /= magnitude;
        }
      }

      // Only cache valid (non-zero) embeddings
      if (this.enableCache && magnitude > 0.001) {
        // Evict oldest if cache is full
        if (this.cache.size >= this.maxCacheSize) {
          const firstKey = this.cache.keys().next().value;
          if (firstKey) this.cache.delete(firstKey);
        }
        this.cache.set(text, embedding);
      }

      return embedding;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Embedding request timed out after ${this.timeout}ms`);
      }
      // RULE-070: Re-throw with embedding context
      throw new Error(
        `Embedding generation failed for text (${text.length} chars): ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * Generate embeddings for multiple texts in a single batch request
   * @param texts - Array of texts to embed
   * @returns Array of 1536-dimensional embeddings
   */
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    // Check cache for all texts, find which need API calls
    const results: Float32Array[] = new Array(texts.length);
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    for (let i = 0; i < texts.length; i++) {
      if (this.enableCache && this.cache.has(texts[i])) {
        const cached = this.cache.get(texts[i])!;
        const cachedNorm = Math.sqrt(cached.reduce((sum, v) => sum + v * v, 0));
        if (cachedNorm > 0.001) {
          results[i] = cached;
          continue;
        }
        // Invalid cached value, remove and refetch
        this.cache.delete(texts[i]);
      }
      uncachedIndices.push(i);
      uncachedTexts.push(texts[i]);
    }

    // If all cached, return early
    if (uncachedTexts.length === 0) {
      return results;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: uncachedTexts }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { embeddings: number[][] };

      if (!data.embeddings || data.embeddings.length !== uncachedTexts.length) {
        throw new Error('Invalid response from embedding API');
      }

      // Process and cache results
      for (let i = 0; i < uncachedIndices.length; i++) {
        const embedding = new Float32Array(data.embeddings[i]);

        // Validate and normalize
        if (embedding.length !== VECTOR_DIM) {
          throw new Error(`Expected ${VECTOR_DIM} dimensions, got ${embedding.length}`);
        }

        const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
        if (magnitude > 0 && Math.abs(magnitude - 1) > 0.001) {
          for (let j = 0; j < embedding.length; j++) {
            embedding[j] /= magnitude;
          }
        }

        // Store result
        results[uncachedIndices[i]] = embedding;

        // Only cache valid (non-zero) embeddings
        if (this.enableCache && magnitude > 0.001) {
          if (this.cache.size >= this.maxCacheSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey) this.cache.delete(firstKey);
          }
          this.cache.set(uncachedTexts[i], embedding);
        }
      }

      return results;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Batch embedding request timed out after ${this.timeout}ms`);
      }
      // RULE-070: Re-throw with batch embedding context
      throw new Error(
        `Batch embedding failed for ${texts.length} texts: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * Check if the local embedding API is available
   * Uses the configured timeout (default 30s) to accommodate slow model loading
   * @returns true if API is reachable
   */
  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      // Allow CLI-mode override via env var (default 30s is too slow for pipeline CLI cold starts)
      const envTimeout = parseInt(process.env.EMBEDDING_HEALTH_TIMEOUT || '0', 10);
      const healthTimeout = envTimeout > 0 ? envTimeout : this.timeout;
      const timeoutId = setTimeout(() => controller.abort(), healthTimeout);

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: ['test'] }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxSize: number; hitRate: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      hitRate: 0, // Would need hit/miss tracking for accurate rate
    };
  }

  /**
   * Clear the embedding cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get the provider name for debugging/logging
   */
  getProviderName(): string {
    return 'local-gte-qwen2';
  }

  /**
   * Get embedding dimensions
   */
  getDimensions(): number {
    return VECTOR_DIM; // 1536
  }
}

// ==================== Embedding Provider Factory ====================

/**
 * Factory for creating embedding providers with automatic fallback
 */
export class EmbeddingProviderFactory {
  private static instance: IEmbeddingProvider | null = null;
  private static localProvider: LocalEmbeddingProvider | null = null;
  private static mockProvider: MockEmbeddingProvider | null = null;

  /**
   * Get the best available embedding provider
   * Tries local API first, falls back to mock if unavailable
   *
   * @param forceLocal - If true, only return local provider or throw
   * @returns Embedding provider instance
   */
  static async getProvider(forceLocal = false): Promise<IEmbeddingProvider> {
    // Try local provider first
    if (!this.localProvider) {
      this.localProvider = new LocalEmbeddingProvider();
    }

    const isLocalAvailable = await this.localProvider.isAvailable();

    if (isLocalAvailable) {
      console.log('[EmbeddingProvider] Using embedding API at http://127.0.0.1:8000');
      this.instance = this.localProvider;
      return this.instance;
    }

    if (forceLocal) {
      throw new Error(
        'Local embedding API not available. Start it with: ./embedding-api/api-embed.sh start'
      );
    }

    // Fall back to mock
    console.warn('[EmbeddingProvider] Local API unavailable, using mock provider');
    if (!this.mockProvider) {
      this.mockProvider = new MockEmbeddingProvider();
    }
    this.instance = this.mockProvider;
    return this.instance;
  }

  /**
   * Get local provider directly (throws if unavailable)
   */
  static getLocalProvider(config?: ILocalEmbeddingConfig): LocalEmbeddingProvider {
    return new LocalEmbeddingProvider(config);
  }

  /**
   * Get mock provider for testing
   */
  static getMockProvider(): MockEmbeddingProvider {
    if (!this.mockProvider) {
      this.mockProvider = new MockEmbeddingProvider();
    }
    return this.mockProvider;
  }

  /**
   * Check if local API is running
   */
  static async isLocalAvailable(): Promise<boolean> {
    if (!this.localProvider) {
      this.localProvider = new LocalEmbeddingProvider();
    }
    return this.localProvider.isAvailable();
  }

  /**
   * Reset factory state (for testing)
   */
  static reset(): void {
    this.instance = null;
    this.localProvider = null;
    this.mockProvider = null;
  }
}

// ==================== Mock Embedding Provider ====================

/**
 * Mock embedding provider for testing and development
 * Generates random L2-normalized 1536-dimensional vectors
 *
 * @deprecated Use LocalEmbeddingProvider for production
 */
export class MockEmbeddingProvider implements IEmbeddingProvider {
  /**
   * Generate a random L2-normalized embedding vector
   * @param _text - Text to embed (currently unused, for future deterministic seeding)
   * @returns 1536-dimensional L2-normalized vector
   */
  async embed(_text: string): Promise<Float32Array> {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 10));

    // Generate random vector
    const vector = new Float32Array(VECTOR_DIM);
    let sumSquares = 0;

    // Fill with random values
    for (let i = 0; i < VECTOR_DIM; i++) {
      const value = Math.random() * 2 - 1; // Range: [-1, 1]
      vector[i] = value;
      sumSquares += value * value;
    }

    // L2 normalize
    const magnitude = Math.sqrt(sumSquares);
    if (magnitude > 0) {
      for (let i = 0; i < VECTOR_DIM; i++) {
        vector[i] /= magnitude;
      }
    }

    return vector;
  }

  /**
   * Generate embedding with deterministic seed for testing
   * @param text - Text to embed (used for seeding)
   * @returns 1536-dimensional L2-normalized vector
   */
  async embedDeterministic(text: string): Promise<Float32Array> {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 10));

    // Simple hash function for seeding
    let seed = 0;
    for (let i = 0; i < text.length; i++) {
      seed = ((seed << 5) - seed) + text.charCodeAt(i);
      seed = seed & seed; // Convert to 32-bit integer
    }

    // Seeded random number generator (simple LCG)
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed >>> 0) / 0xFFFFFFFF;
    };

    // Generate vector
    const vector = new Float32Array(VECTOR_DIM);
    let sumSquares = 0;

    for (let i = 0; i < VECTOR_DIM; i++) {
      const value = random() * 2 - 1; // Range: [-1, 1]
      vector[i] = value;
      sumSquares += value * value;
    }

    // L2 normalize
    const magnitude = Math.sqrt(sumSquares);
    if (magnitude > 0) {
      for (let i = 0; i < VECTOR_DIM; i++) {
        vector[i] /= magnitude;
      }
    }

    return vector;
  }

  /**
   * Get the provider name for debugging/logging
   */
  getProviderName(): string {
    return 'mock';
  }

  /**
   * Get embedding dimensions
   */
  getDimensions(): number {
    return VECTOR_DIM; // 1536
  }
}
