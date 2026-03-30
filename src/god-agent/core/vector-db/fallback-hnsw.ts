/**
 * God Agent Fallback HNSW Implementation
 *
 * Implements: TASK-VDB-001, TASK-PERF-001
 * Referenced by: VectorDB
 *
 * Pure TypeScript HNSW implementation with automatic backend selection:
 * - Uses HNSW graph for datasets >= HNSW_THRESHOLD (1000 vectors)
 * - Falls back to brute-force for small datasets (faster for small n)
 *
 * Storage format v2 (.agentdb/vectors.bin):
 * - HNSW index serialized as JSON with graph structure
 *
 * Storage format v1 (legacy, read-only):
 * - 4 bytes: version (uint32)
 * - 4 bytes: dimension (uint32)
 * - 4 bytes: count (uint32)
 * - For each vector:
 *   - 4 bytes: ID length (uint32)
 *   - N bytes: ID string (UTF-8)
 *   - dimension * 4 bytes: vector data (float32)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { IHNSWBackend } from './hnsw-backend.js';
import { VectorID, SearchResult, DistanceMetric } from './types.js';
import { getMetricFunction, isSimilarityMetric } from './distance-metrics.js';
import { HNSWIndex, distanceToSimilarity } from '../database/hnsw/index.js';

/** Threshold for switching from brute-force to HNSW (number of vectors) */
const HNSW_THRESHOLD = 1000;

/** Storage version for new HNSW format */
const STORAGE_VERSION = 2;

/** Legacy storage version (brute-force) */
const LEGACY_STORAGE_VERSION = 1;

/**
 * Convert DistanceMetric enum to HNSW metric type
 */
function toHNSWMetric(metric: DistanceMetric): 'cosine' | 'euclidean' | 'dot' {
  switch (metric) {
    case DistanceMetric.COSINE:
      return 'cosine';
    case DistanceMetric.EUCLIDEAN:
      return 'euclidean';
    case DistanceMetric.DOT:
      return 'dot';
    default:
      return 'cosine';
  }
}

/**
 * Pure TypeScript HNSW implementation
 *
 * Automatically selects between:
 * - Brute-force search for small datasets (< 1000 vectors)
 * - HNSW graph for larger datasets (O(log n) search)
 */
export class FallbackHNSW implements IHNSWBackend {
  private readonly vectors: Map<VectorID, Float32Array>;
  private readonly dimension: number;
  readonly metric: DistanceMetric;
  private readonly metricFn: (a: Float32Array, b: Float32Array) => number;
  private readonly isSimilarity: boolean;

  /** HNSW index for large datasets */
  private hnswIndex: HNSWIndex | null = null;

  /** Whether HNSW index needs rebuilding after modifications */
  private hnswDirty: boolean = false;

  constructor(dimension: number, metric: DistanceMetric = DistanceMetric.COSINE) {
    this.vectors = new Map();
    this.dimension = dimension;
    this.metric = metric;
    this.metricFn = getMetricFunction(metric);
    this.isSimilarity = isSimilarityMetric(metric);
  }

  /**
   * Check if we should use HNSW index
   */
  private shouldUseHNSW(): boolean {
    return this.vectors.size >= HNSW_THRESHOLD;
  }

  /**
   * Ensure HNSW index is built and up-to-date
   */
  private ensureHNSWIndex(): void {
    if (!this.shouldUseHNSW()) {
      // Too few vectors, don't use HNSW
      this.hnswIndex = null;
      return;
    }

    if (this.hnswIndex && !this.hnswDirty) {
      // Index exists and is up-to-date
      return;
    }

    // Build or rebuild HNSW index
    this.hnswIndex = new HNSWIndex(this.dimension, {
      M: 16,
      efConstruction: 200,
      efSearch: 50,
      metric: toHNSWMetric(this.metric),
    });

    // Add all vectors
    for (const [id, vector] of this.vectors) {
      this.hnswIndex.add(id, vector);
    }

    this.hnswDirty = false;
  }

  insert(id: VectorID, vector: Float32Array): void {
    // Create a copy to avoid external modifications
    const vectorCopy = new Float32Array(vector);
    this.vectors.set(id, vectorCopy);

    // Mark HNSW as dirty if it exists
    if (this.hnswIndex) {
      // For efficiency, add directly to index if not too many pending changes
      this.hnswIndex.add(id, vectorCopy);
    } else if (this.shouldUseHNSW()) {
      // Crossed threshold, will need to build index
      this.hnswDirty = true;
    }
  }

  search(query: Float32Array, k: number, includeVectors: boolean = false): SearchResult[] {
    if (this.vectors.size === 0) {
      return [];
    }

    // Ensure HNSW index is ready if we should use it
    this.ensureHNSWIndex();

    if (this.hnswIndex && !this.hnswDirty) {
      // Use HNSW for O(log n) search
      return this.searchHNSW(query, k, includeVectors);
    } else {
      // Use brute-force for small datasets or when index is dirty
      return this.searchBruteForce(query, k, includeVectors);
    }
  }

  /**
   * HNSW-based search (O(log n))
   */
  private searchHNSW(query: Float32Array, k: number, includeVectors: boolean): SearchResult[] {
    const results = this.hnswIndex!.search(query, k);

    return results.map(r => ({
      id: r.id,
      similarity: distanceToSimilarity(r.distance, toHNSWMetric(this.metric)),
      vector: includeVectors ? this.getVector(r.id) : undefined,
    }));
  }

  /**
   * Brute-force search (O(n))
   */
  private searchBruteForce(query: Float32Array, k: number, includeVectors: boolean): SearchResult[] {
    // Calculate similarity/distance to all vectors
    const scores: Array<{ id: VectorID; score: number; vector: Float32Array }> = [];

    for (const [id, vector] of this.vectors.entries()) {
      const score = this.metricFn(query, vector);
      scores.push({ id, score, vector });
    }

    // Sort by score (descending for similarity, ascending for distance)
    scores.sort((a, b) => {
      return this.isSimilarity ? b.score - a.score : a.score - b.score;
    });

    // Return top k results
    const results = scores.slice(0, Math.min(k, scores.length));

    return results.map(({ id, score, vector }) => ({
      id,
      similarity: score,
      vector: includeVectors ? new Float32Array(vector) : undefined
    }));
  }

  getVector(id: VectorID): Float32Array | undefined {
    const vector = this.vectors.get(id);
    // Return a copy to prevent external modifications
    return vector ? new Float32Array(vector) : undefined;
  }

  delete(id: VectorID): boolean {
    const deleted = this.vectors.delete(id);

    if (deleted && this.hnswIndex) {
      // Remove from HNSW index
      this.hnswIndex.remove(id);
    }

    return deleted;
  }

  count(): number {
    return this.vectors.size;
  }

  async save(filePath: string): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Use new HNSW format for large datasets
    if (this.hnswIndex && !this.hnswDirty) {
      // Save HNSW index with graph structure
      const buffer = this.hnswIndex.serialize();
      await fs.writeFile(filePath, buffer);
      return;
    }

    // Fall back to legacy format for small datasets
    await this.saveLegacy(filePath);
  }

  /**
   * Save in legacy format (for small datasets)
   */
  private async saveLegacy(filePath: string): Promise<void> {
    const count = this.vectors.size;
    let totalSize = 12; // version + dimension + count

    const entries = Array.from(this.vectors.entries());
    for (const [id] of entries) {
      const idBytes = Buffer.byteLength(id, 'utf-8');
      totalSize += 4 + idBytes + this.dimension * 4;
    }

    // Create buffer and write header
    const buffer = Buffer.allocUnsafe(totalSize);
    let offset = 0;

    buffer.writeUInt32LE(LEGACY_STORAGE_VERSION, offset);
    offset += 4;
    buffer.writeUInt32LE(this.dimension, offset);
    offset += 4;
    buffer.writeUInt32LE(count, offset);
    offset += 4;

    // Write vectors
    for (const [id, vector] of entries) {
      // Write ID length and string
      const idBytes = Buffer.from(id, 'utf-8');
      buffer.writeUInt32LE(idBytes.length, offset);
      offset += 4;
      idBytes.copy(buffer, offset);
      offset += idBytes.length;

      // Write vector data
      for (let i = 0; i < vector.length; i++) {
        buffer.writeFloatLE(vector[i], offset);
        offset += 4;
      }
    }

    // Write to file
    await fs.writeFile(filePath, buffer);
  }

  async load(filePath: string): Promise<boolean> {
    try {
      // Check if file exists
      await fs.access(filePath);
    } catch {
      // INTENTIONAL: File doesn't exist - return false to indicate no index loaded
      return false;
    }

    // Read file
    const buffer = await fs.readFile(filePath);

    // Detect format: HNSW JSON starts with '{', legacy binary starts with version number
    if (buffer[0] === 0x7b) { // '{' character
      // New HNSW format
      return this.loadHNSW(buffer);
    } else {
      // Legacy format
      return this.loadLegacy(buffer);
    }
  }

  /**
   * Load HNSW format
   */
  private loadHNSW(buffer: Buffer): boolean {
    try {
      const index = HNSWIndex.deserialize(buffer);

      // Clear existing data
      this.vectors.clear();
      this.hnswIndex = index;
      this.hnswDirty = false;

      // Populate vectors map from index
      // We need to extract vectors from the serialized data
      const data = JSON.parse(buffer.toString());
      for (const { id, data: vectorData } of data.vectors) {
        this.vectors.set(id, new Float32Array(vectorData));
      }

      return true;
    } catch (error) {
      throw new Error(`Failed to load HNSW index: ${error}`);
    }
  }

  /**
   * Load legacy format
   */
  private loadLegacy(buffer: Buffer): boolean {
    let offset = 0;

    // Read header
    const version = buffer.readUInt32LE(offset);
    offset += 4;

    if (version !== LEGACY_STORAGE_VERSION) {
      throw new Error(`Unsupported storage version: ${version} (expected ${LEGACY_STORAGE_VERSION})`);
    }

    const dimension = buffer.readUInt32LE(offset);
    offset += 4;

    if (dimension !== this.dimension) {
      throw new Error(`Dimension mismatch: file has ${dimension}D, expected ${this.dimension}D`);
    }

    const count = buffer.readUInt32LE(offset);
    offset += 4;

    // Clear existing data
    this.vectors.clear();
    this.hnswIndex = null;
    this.hnswDirty = false;

    // Read vectors
    for (let i = 0; i < count; i++) {
      // Read ID
      const idLength = buffer.readUInt32LE(offset);
      offset += 4;
      const id = buffer.toString('utf-8', offset, offset + idLength);
      offset += idLength;

      // Read vector data
      const vector = new Float32Array(dimension);
      for (let j = 0; j < dimension; j++) {
        vector[j] = buffer.readFloatLE(offset);
        offset += 4;
      }

      this.vectors.set(id, vector);
    }

    // Mark as needing rebuild if we crossed threshold
    if (this.shouldUseHNSW()) {
      this.hnswDirty = true;
    }

    return true;
  }

  clear(): void {
    this.vectors.clear();
    this.hnswIndex = null;
    this.hnswDirty = false;
  }

  /**
   * Get statistics about the backend
   */
  getStats(): {
    size: number;
    usingHNSW: boolean;
    hnswStats?: ReturnType<HNSWIndex['getStats']>;
  } {
    this.ensureHNSWIndex();

    return {
      size: this.vectors.size,
      usingHNSW: this.hnswIndex !== null && !this.hnswDirty,
      hnswStats: this.hnswIndex?.getStats(),
    };
  }
}
