/**
 * Quantized Vector Storage Implementation
 *
 * Implements: TASK-PERF-002 (Int8 quantization for 4x memory reduction)
 * Referenced by: VectorDB, HNSWIndex
 *
 * Storage wrapper that automatically quantizes vectors for memory efficiency.
 * Provides transparent quantization/dequantization with search capabilities.
 *
 * Memory layout:
 * - Float32Array: 4 bytes per component
 * - Int8Array: 1 byte per component
 * - Metadata: 8 bytes per vector (scale: 4, zeroPoint: 4)
 * - Compression ratio: ~4x (dimension >> 8 bytes overhead)
 */

import { Int8Quantizer } from './int8-quantizer.js';
import {
  QuantizationConfig,
  DEFAULT_QUANTIZATION_CONFIG,
  QuantizationMemoryStats,
  StoredQuantizedVector,
  QuantizedSearchResult,
} from './quantization-types.js';

/**
 * Quantized Vector Storage
 *
 * Stores vectors in Int8 format with automatic quantization/dequantization.
 * Provides 4x memory reduction with minimal quality degradation.
 */
export class QuantizedVectorStorage {
  /** Vector dimension */
  readonly dimension: number;

  /** Quantizer instance */
  private readonly quantizer: Int8Quantizer;

  /** Storage for quantized vectors */
  private storage: Map<string, StoredQuantizedVector>;

  /** Original Float32 vectors for re-ranking (optional) */
  private fullPrecisionCache: Map<string, Float32Array>;

  /** Whether to cache full precision for re-ranking */
  private cacheFullPrecision: boolean;

  /** Maximum cache size for full precision vectors */
  private maxCacheSize: number;

  /**
   * Create a new QuantizedVectorStorage
   *
   * @param dimension - Vector dimension
   * @param config - Optional quantization configuration
   * @param options - Storage options
   */
  constructor(
    dimension: number,
    config?: Partial<QuantizationConfig>,
    options?: {
      cacheFullPrecision?: boolean;
      maxCacheSize?: number;
    }
  ) {
    this.dimension = dimension;
    this.quantizer = new Int8Quantizer(config);
    this.storage = new Map();
    this.fullPrecisionCache = new Map();
    this.cacheFullPrecision = options?.cacheFullPrecision ?? false;
    this.maxCacheSize = options?.maxCacheSize ?? 1000;
  }

  /**
   * Get the number of stored vectors
   */
  get size(): number {
    return this.storage.size;
  }

  /**
   * Store a vector with automatic quantization
   *
   * @param id - Unique vector identifier
   * @param vector - Float32 vector to store
   */
  store(id: string, vector: Float32Array): void {
    if (vector.length !== this.dimension) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.dimension}, got ${vector.length}`
      );
    }

    // Quantize
    const { quantized, scale, zeroPoint } = this.quantizer.quantize(vector);

    // Store quantized representation
    this.storage.set(id, {
      id,
      quantized,
      scale,
      zeroPoint,
    });

    // Optionally cache full precision for re-ranking
    if (this.cacheFullPrecision) {
      this.updateCache(id, vector);
    }
  }

  /**
   * Update LRU cache with full precision vector
   */
  private updateCache(id: string, vector: Float32Array): void {
    // Remove if exists to update position
    this.fullPrecisionCache.delete(id);

    // Evict oldest if at capacity
    if (this.fullPrecisionCache.size >= this.maxCacheSize) {
      const firstKey = this.fullPrecisionCache.keys().next().value;
      if (firstKey !== undefined) {
        this.fullPrecisionCache.delete(firstKey);
      }
    }

    // Add to cache (copy to avoid external modifications)
    this.fullPrecisionCache.set(id, new Float32Array(vector));
  }

  /**
   * Retrieve a vector with automatic dequantization
   *
   * @param id - Vector identifier
   * @returns Dequantized Float32 vector or null if not found
   */
  retrieve(id: string): Float32Array | null {
    // Check full precision cache first
    const cached = this.fullPrecisionCache.get(id);
    if (cached) {
      return new Float32Array(cached);
    }

    // Dequantize from storage
    const stored = this.storage.get(id);
    if (!stored) {
      return null;
    }

    return this.quantizer.dequantize(
      stored.quantized,
      stored.scale,
      stored.zeroPoint
    );
  }

  /**
   * Get raw quantized representation
   *
   * @param id - Vector identifier
   * @returns Raw quantized data or null if not found
   */
  getQuantized(id: string): StoredQuantizedVector | null {
    return this.storage.get(id) ?? null;
  }

  /**
   * Check if a vector exists
   *
   * @param id - Vector identifier
   */
  has(id: string): boolean {
    return this.storage.has(id);
  }

  /**
   * Remove a vector
   *
   * @param id - Vector identifier
   * @returns true if removed, false if not found
   */
  remove(id: string): boolean {
    this.fullPrecisionCache.delete(id);
    return this.storage.delete(id);
  }

  /**
   * Clear all stored vectors
   */
  clear(): void {
    this.storage.clear();
    this.fullPrecisionCache.clear();
  }

  /**
   * Search for k nearest neighbors using quantized distance
   *
   * This is a brute-force search on quantized vectors.
   * For large datasets, use with HNSW index instead.
   *
   * @param query - Query vector (Float32)
   * @param k - Number of results
   * @returns Array of search results sorted by distance
   */
  search(
    query: Float32Array,
    k: number
  ): Array<{ id: string; distance: number }> {
    if (query.length !== this.dimension) {
      throw new Error(
        `Query dimension mismatch: expected ${this.dimension}, got ${query.length}`
      );
    }

    if (this.storage.size === 0) {
      return [];
    }

    // Quantize query
    const { quantized: qQuery, scale: qScale, zeroPoint: qZp } =
      this.quantizer.quantize(query);

    // Compute distances to all vectors
    const results: Array<{ id: string; distance: number }> = [];

    for (const stored of this.storage.values()) {
      const distance = this.quantizer.quantizedDistance(
        qQuery,
        qScale,
        qZp,
        stored.quantized,
        stored.scale,
        stored.zeroPoint
      );
      results.push({ id: stored.id, distance });
    }

    // Sort by distance and return top k
    results.sort((a, b) => a.distance - b.distance);
    return results.slice(0, Math.min(k, results.length));
  }

  /**
   * Search with re-ranking using full precision vectors
   *
   * First pass: approximate search on quantized vectors
   * Second pass: re-rank candidates using dequantized vectors
   *
   * @param query - Query vector (Float32)
   * @param k - Number of results
   * @param efSearch - Number of candidates to consider (default: k * 2)
   * @returns Array of search results with both distances
   */
  searchWithRerank(
    query: Float32Array,
    k: number,
    efSearch?: number
  ): QuantizedSearchResult[] {
    const candidates = efSearch ?? k * 2;

    // First pass: get candidates using quantized search
    const approxResults = this.search(query, candidates);

    // Second pass: re-rank using full precision
    const reranked: QuantizedSearchResult[] = approxResults.map(result => {
      const vector = this.retrieve(result.id);
      const exactDistance = vector
        ? this.cosineDistanceFloat(query, vector)
        : result.distance;

      return {
        id: result.id,
        distance: exactDistance,
        approximateDistance: result.distance,
      };
    });

    // Sort by exact distance
    reranked.sort((a, b) => a.distance - b.distance);
    return reranked.slice(0, k);
  }

  /**
   * Cosine distance for Float32 vectors
   */
  private cosineDistanceFloat(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const norm = Math.sqrt(normA) * Math.sqrt(normB);
    if (norm === 0) return 1;

    return Math.max(0, Math.min(2, 1 - dotProduct / norm));
  }

  /**
   * Store multiple vectors in batch
   *
   * @param items - Array of id/vector pairs
   */
  storeBatch(items: Array<{ id: string; vector: Float32Array }>): void {
    for (const { id, vector } of items) {
      this.store(id, vector);
    }
  }

  /**
   * Get memory usage statistics
   *
   * @returns Memory usage breakdown
   */
  getMemoryUsage(): QuantizationMemoryStats {
    const count = this.storage.size;

    // Quantized vector bytes: dimension * 1 byte (Int8)
    const vectorBytes = count * this.dimension;

    // Metadata per vector: scale (4 bytes) + zeroPoint (4 bytes) + id overhead (~50 bytes avg)
    const metadataBytes = count * (4 + 4 + 50);

    // Cache bytes (full precision)
    const cacheBytes = this.fullPrecisionCache.size * this.dimension * 4;

    const totalBytes = vectorBytes + metadataBytes + cacheBytes;

    // Float32 baseline for comparison
    const float32Baseline = count * this.dimension * 4;

    // Compression ratio (vector storage only, excluding cache)
    const compressionRatio =
      float32Baseline > 0
        ? float32Baseline / (vectorBytes + metadataBytes - cacheBytes)
        : 1;

    return {
      totalBytes,
      vectorBytes,
      metadataBytes: metadataBytes + cacheBytes,
      compressionRatio,
    };
  }

  /**
   * Get all stored vector IDs
   */
  getIds(): string[] {
    return Array.from(this.storage.keys());
  }

  /**
   * Iterate over all stored vectors (dequantized)
   */
  *entries(): Generator<[string, Float32Array]> {
    for (const [id, stored] of this.storage) {
      const vector = this.quantizer.dequantize(
        stored.quantized,
        stored.scale,
        stored.zeroPoint
      );
      yield [id, vector];
    }
  }

  /**
   * Iterate over raw quantized entries
   */
  *quantizedEntries(): Generator<StoredQuantizedVector> {
    for (const stored of this.storage.values()) {
      yield stored;
    }
  }

  /**
   * Export all vectors for serialization
   */
  export(): Array<{
    id: string;
    quantized: number[];
    scale: number;
    zeroPoint: number;
  }> {
    const result: Array<{
      id: string;
      quantized: number[];
      scale: number;
      zeroPoint: number;
    }> = [];

    for (const stored of this.storage.values()) {
      result.push({
        id: stored.id,
        quantized: Array.from(stored.quantized),
        scale: stored.scale,
        zeroPoint: stored.zeroPoint,
      });
    }

    return result;
  }

  /**
   * Import vectors from serialized format
   */
  import(
    data: Array<{
      id: string;
      quantized: number[];
      scale: number;
      zeroPoint: number;
    }>
  ): void {
    for (const item of data) {
      this.storage.set(item.id, {
        id: item.id,
        quantized: new Int8Array(item.quantized),
        scale: item.scale,
        zeroPoint: item.zeroPoint,
      });
    }
  }
}
