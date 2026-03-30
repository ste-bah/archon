/**
 * LEANN (Lazy-Evaluated Approximate Nearest Neighbors) Backend
 *
 * Implements: TASK-LEANN-001
 * Referenced by: BackendSelector, DualCodeEmbeddingProvider
 *
 * Optimized HNSW backend with LEANN-specific enhancements:
 * - Hub node caching (top 10% high-degree nodes)
 * - Graph pruning algorithm (preserve hub connectivity)
 * - Selective recomputation (on-demand embeddings)
 * - Two-level search (hub cache first, then full graph)
 */

import * as fs from 'fs/promises';
import { open } from 'fs/promises';
import * as path from 'path';
import { IHNSWBackend } from './hnsw-backend.js';
import { VectorID, SearchResult, DistanceMetric } from './types.js';
import { getMetricFunction, isSimilarityMetric } from './distance-metrics.js';
import {
  LEANNConfig,
  LEANNStats,
  HubCacheEntry,
  GraphNode,
  LEANNSerializedData,
  DEFAULT_LEANN_CONFIG,
  LEANN_STORAGE_VERSION,
  LEANN_LEGACY_VERSION,
  LEANN_BINARY_MAGIC,
} from './leann-types.js';

// Re-export types for convenience
// NOTE: Interfaces must use `export type` - they don't exist at runtime in ESM
export type { LEANNConfig, LEANNStats } from './leann-types.js';
export { DEFAULT_LEANN_CONFIG } from './leann-types.js';

/**
 * LEANN Backend Implementation
 *
 * Implements IHNSWBackend with LEANN optimizations:
 * 1. Hub node caching - keeps high-degree nodes in memory for fast access
 * 2. Graph pruning - removes low-value edges while preserving connectivity
 * 3. Selective recomputation - recomputes embeddings on-demand
 * 4. Two-level search - searches hub cache first, then full graph
 */
export class LEANNBackend implements IHNSWBackend {
  private readonly config: LEANNConfig;
  private readonly dimension: number;
  private readonly metric: DistanceMetric;
  private readonly metricFn: (a: Float32Array, b: Float32Array) => number;
  private readonly isSimilarity: boolean;

  /** Main vector storage */
  private readonly vectors: Map<VectorID, Float32Array>;

  /** Graph structure with adjacency lists */
  private readonly graph: Map<VectorID, GraphNode>;

  /** Hub cache with LRU tracking */
  private readonly hubCache: Map<VectorID, HubCacheEntry>;

  /** Maximum hub cache size based on config ratio */
  private maxHubCacheSize: number;

  /** Statistics tracking */
  private cacheHits: number = 0;
  private cacheMisses: number = 0;
  private prunedEdges: number = 0;

  /** Embedding recomputation function (optional) */
  private embeddingGenerator?: (id: VectorID) => Promise<Float32Array>;

  constructor(
    dimension: number,
    metric: DistanceMetric = DistanceMetric.COSINE,
    config: Partial<LEANNConfig> = {}
  ) {
    this.dimension = dimension;
    this.metric = metric;
    this.metricFn = getMetricFunction(metric);
    this.isSimilarity = isSimilarityMetric(metric);

    this.config = { ...DEFAULT_LEANN_CONFIG, ...config };

    this.vectors = new Map();
    this.graph = new Map();
    this.hubCache = new Map();
    this.maxHubCacheSize = 0; // Will be updated on insert
  }

  /**
   * Set the embedding generator function for selective recomputation
   */
  setEmbeddingGenerator(generator: (id: VectorID) => Promise<Float32Array>): void {
    this.embeddingGenerator = generator;
  }

  /**
   * Insert a vector into the index
   *
   * @throws Error if vector dimension doesn't match expected dimension
   */
  insert(id: VectorID, vector: Float32Array): void {
    // Validate dimension to prevent silent corruption
    if (vector.length !== this.dimension) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.dimension}, got ${vector.length}`
      );
    }

    // Store vector copy
    const vectorCopy = new Float32Array(vector);
    this.vectors.set(id, vectorCopy);

    // Initialize graph node
    const node: GraphNode = {
      vector: vectorCopy,
      neighbors: new Set(),
    };
    this.graph.set(id, node);

    // Connect to nearest neighbors
    this.connectToNeighbors(id, vectorCopy);

    // Update hub cache size
    this.maxHubCacheSize = Math.max(
      1,
      Math.floor(this.vectors.size * this.config.hubCacheRatio)
    );

    // Update hub cache
    this.updateHubCache();
  }

  /**
   * Connect a new node to its nearest neighbors
   */
  private connectToNeighbors(id: VectorID, vector: Float32Array): void {
    if (this.vectors.size <= 1) return;

    // Find k nearest neighbors
    const k = Math.min(16, this.vectors.size - 1); // M parameter
    const candidates: Array<{ id: VectorID; score: number }> = [];

    for (const [otherId, otherVector] of this.vectors.entries()) {
      if (otherId === id) continue;
      const score = this.metricFn(vector, otherVector);
      candidates.push({ id: otherId, score });
    }

    // Sort by score (descending for similarity, ascending for distance)
    candidates.sort((a, b) => {
      return this.isSimilarity ? b.score - a.score : a.score - b.score;
    });

    // Connect to top k neighbors
    const node = this.graph.get(id)!;
    for (let i = 0; i < Math.min(k, candidates.length); i++) {
      const neighbor = candidates[i];
      node.neighbors.add(neighbor.id);

      // Bidirectional connection
      const neighborNode = this.graph.get(neighbor.id);
      if (neighborNode) {
        neighborNode.neighbors.add(id);
      }
    }

    // Apply pruning if needed
    this.pruneConnections(id);
  }

  /**
   * Prune low-value edges while preserving hub connectivity
   */
  private pruneConnections(id: VectorID): void {
    const node = this.graph.get(id);
    if (!node || !node.vector) return;

    const maxConnections = Math.floor(16 * this.config.graphPruningRatio);
    if (node.neighbors.size <= maxConnections) return;

    // Score each connection
    const connections: Array<{ neighborId: VectorID; score: number; isHub: boolean }> = [];

    for (const neighborId of node.neighbors) {
      const neighborNode = this.graph.get(neighborId);
      if (!neighborNode || !neighborNode.vector) continue;

      const score = this.metricFn(node.vector, neighborNode.vector);
      const isHub = this.isHubNode(neighborId);

      connections.push({ neighborId, score, isHub });
    }

    // Sort by: hubs first, then by score
    connections.sort((a, b) => {
      if (a.isHub !== b.isHub) return a.isHub ? -1 : 1;
      return this.isSimilarity ? b.score - a.score : a.score - b.score;
    });

    // Keep only top connections
    const toKeep = new Set<VectorID>();
    for (let i = 0; i < Math.min(maxConnections, connections.length); i++) {
      toKeep.add(connections[i].neighborId);
    }

    // Remove pruned connections
    for (const neighborId of node.neighbors) {
      if (!toKeep.has(neighborId)) {
        node.neighbors.delete(neighborId);
        this.prunedEdges++;

        // Remove bidirectional link
        const neighborNode = this.graph.get(neighborId);
        if (neighborNode) {
          neighborNode.neighbors.delete(id);
        }
      }
    }
  }

  /**
   * Check if a node is a hub node
   */
  private isHubNode(id: VectorID): boolean {
    return this.hubCache.has(id);
  }

  /**
   * Get node degree (number of connections)
   */
  private getNodeDegree(id: VectorID): number {
    const node = this.graph.get(id);
    return node ? node.neighbors.size : 0;
  }

  /**
   * Update hub cache with highest-degree nodes.
   * Uses atomic swap pattern to prevent concurrent access issues.
   */
  private updateHubCache(): void {
    // Get all nodes with their degrees
    const nodesByDegree: Array<{ id: VectorID; degree: number }> = [];

    for (const [id] of this.graph.entries()) {
      const degree = this.getNodeDegree(id);
      if (degree >= this.config.hubDegreeThreshold) {
        nodesByDegree.push({ id, degree });
      }
    }

    // Sort by degree descending
    nodesByDegree.sort((a, b) => b.degree - a.degree);

    // Build new cache completely before modifying existing
    // This ensures searches see a consistent state
    const newCache = new Map<VectorID, HubCacheEntry>();
    const now = Date.now();

    for (let i = 0; i < Math.min(this.maxHubCacheSize, nodesByDegree.length); i++) {
      const { id, degree } = nodesByDegree[i];
      const vector = this.vectors.get(id);
      if (vector) {
        // Preserve lastAccess from existing cache if available
        const existing = this.hubCache.get(id);
        newCache.set(id, {
          vector: new Float32Array(vector),
          degree,
          lastAccess: existing?.lastAccess ?? now,
        });
      }
    }

    // Atomic swap: clear and repopulate in sync block
    // (JavaScript single-threaded execution guarantees no interleaving)
    this.hubCache.clear();
    for (const [id, entry] of newCache.entries()) {
      this.hubCache.set(id, entry);
    }
  }

  /**
   * Search for k nearest neighbors using two-level search
   */
  search(query: Float32Array, k: number, includeVectors: boolean = false): SearchResult[] {
    if (this.vectors.size === 0) {
      return [];
    }

    // For datasets <= 5000 vectors, brute force is fast (<1ms) and guarantees exact results.
    // The hub cache optimization only earns its keep at 10K+ vectors.
    // FIX: raised from 100 to 5000 to ensure newly inserted vectors are always searchable.
    if (this.vectors.size <= 5000) {
      return this.bruteForceSearch(query, k, includeVectors);
    }

    // Level 1: Search hub cache first (optimization for large datasets)
    const hubResults = this.searchHubCache(query, k);

    // Always fall through to full graph search — the hub cache is an optimization,
    // not a correctness gate. Skipping the full graph caused newly inserted vectors
    // with low degree to be permanently invisible to search.
    // FIX: removed early-return that skipped full graph when hub cache had k results.

    // Level 2: Full graph search
    this.cacheMisses++;
    const fullResults = this.searchFullGraph(query, k, new Set(hubResults.map(r => r.id)));

    // Merge results
    const allResults = [...hubResults, ...fullResults];

    // Sort by score
    allResults.sort((a, b) => {
      return this.isSimilarity ? b.score - a.score : a.score - b.score;
    });

    // Return top k
    return this.formatResults(allResults.slice(0, k), includeVectors);
  }

  /**
   * Brute force search - guaranteed to find exact matches
   * Used for small datasets where linear scan is efficient
   */
  private bruteForceSearch(
    query: Float32Array,
    k: number,
    includeVectors: boolean
  ): SearchResult[] {
    const results: Array<{ id: VectorID; score: number }> = [];

    for (const [id, vector] of this.vectors.entries()) {
      const score = this.metricFn(query, vector);
      results.push({ id, score });
    }

    // Sort by score
    results.sort((a, b) => {
      return this.isSimilarity ? b.score - a.score : a.score - b.score;
    });

    return this.formatResults(results.slice(0, k), includeVectors);
  }

  /**
   * Search hub cache for nearest neighbors
   */
  private searchHubCache(query: Float32Array, k: number): Array<{ id: VectorID; score: number }> {
    const results: Array<{ id: VectorID; score: number }> = [];

    for (const [id, entry] of this.hubCache.entries()) {
      const score = this.metricFn(query, entry.vector);
      results.push({ id, score });

      // Update LRU timestamp
      entry.lastAccess = Date.now();
    }

    // Sort by score
    results.sort((a, b) => {
      return this.isSimilarity ? b.score - a.score : a.score - b.score;
    });

    return results.slice(0, k);
  }

  /**
   * Search full graph using greedy traversal
   */
  private searchFullGraph(
    query: Float32Array,
    k: number,
    excludeIds: Set<VectorID>
  ): Array<{ id: VectorID; score: number }> {
    const visited = new Set<VectorID>(excludeIds);
    const results: Array<{ id: VectorID; score: number }> = [];

    // Start from hub nodes if available
    const startNodes = this.hubCache.size > 0
      ? Array.from(this.hubCache.keys())
      : Array.from(this.vectors.keys()).slice(0, Math.min(10, this.vectors.size));

    // Priority queue for greedy search
    const candidates: Array<{ id: VectorID; score: number }> = [];

    // Initialize with start nodes
    for (const id of startNodes) {
      if (visited.has(id)) continue;
      visited.add(id);

      const vector = this.vectors.get(id);
      if (!vector) continue;

      const score = this.metricFn(query, vector);
      candidates.push({ id, score });
    }

    // Greedy search
    const maxIterations = this.config.efSearch;
    let iterations = 0;

    while (candidates.length > 0 && iterations < maxIterations) {
      iterations++;

      // Sort candidates
      candidates.sort((a, b) => {
        return this.isSimilarity ? b.score - a.score : a.score - b.score;
      });

      // Take best candidate
      const best = candidates.shift()!;
      results.push(best);

      // Expand neighbors
      const node = this.graph.get(best.id);
      if (!node) continue;

      for (const neighborId of node.neighbors) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);

        const neighborVector = this.vectors.get(neighborId);
        if (!neighborVector) continue;

        const score = this.metricFn(query, neighborVector);
        candidates.push({ id: neighborId, score });
      }

      // Keep candidates list bounded
      if (candidates.length > this.config.efSearch * 2) {
        candidates.sort((a, b) => {
          return this.isSimilarity ? b.score - a.score : a.score - b.score;
        });
        candidates.length = this.config.efSearch;
      }
    }

    // Sort final results
    results.sort((a, b) => {
      return this.isSimilarity ? b.score - a.score : a.score - b.score;
    });

    return results.slice(0, k);
  }

  /**
   * Format search results
   */
  private formatResults(
    results: Array<{ id: VectorID; score: number }>,
    includeVectors: boolean
  ): SearchResult[] {
    return results.map(({ id, score }) => ({
      id,
      similarity: score,
      vector: includeVectors ? this.getVector(id) : undefined,
    }));
  }

  /**
   * Retrieve a vector by ID
   */
  getVector(id: VectorID): Float32Array | undefined {
    // Check hub cache first
    const hubEntry = this.hubCache.get(id);
    if (hubEntry) {
      hubEntry.lastAccess = Date.now();
      return new Float32Array(hubEntry.vector);
    }

    // Check main storage
    const vector = this.vectors.get(id);
    return vector ? new Float32Array(vector) : undefined;
  }

  /**
   * Delete a vector from the index
   */
  delete(id: VectorID): boolean {
    if (!this.vectors.has(id)) {
      return false;
    }

    // Remove from vectors
    this.vectors.delete(id);

    // Remove from hub cache
    this.hubCache.delete(id);

    // Remove from graph and update neighbors
    const node = this.graph.get(id);
    if (node) {
      for (const neighborId of node.neighbors) {
        const neighborNode = this.graph.get(neighborId);
        if (neighborNode) {
          neighborNode.neighbors.delete(id);
        }
      }
      this.graph.delete(id);
    }

    // Update hub cache size and rebuild
    this.maxHubCacheSize = Math.max(
      0,
      Math.floor(this.vectors.size * this.config.hubCacheRatio)
    );
    this.updateHubCache();

    return true;
  }

  /**
   * Get the number of vectors in the index
   */
  count(): number {
    return this.vectors.size;
  }

  /**
   * Save the index to persistent storage
   */
  async save(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Build string table (vector IDs in deterministic order)
    const ids = Array.from(this.vectors.keys());
    const idToIndex = new Map<string, number>();
    ids.forEach((id, i) => idToIndex.set(id, i));

    const vectorCount = ids.length;
    const dimension = this.dimension;

    // Build graph adjacency in CSR format
    const offsets: number[] = [0];
    const neighbors: number[] = [];
    for (const id of ids) {
      const node = this.graph.get(id);
      if (node) {
        for (const nid of node.neighbors) {
          const idx = idToIndex.get(nid);
          if (idx !== undefined) neighbors.push(idx);
        }
      }
      offsets.push(neighbors.length);
    }

    // Hub IDs as indices
    const hubIndices: number[] = [];
    for (const hid of this.hubCache.keys()) {
      const idx = idToIndex.get(hid);
      if (idx !== undefined) hubIndices.push(idx);
    }

    // Config and metric as JSON/string
    const configJson = Buffer.from(JSON.stringify(this.config), 'utf-8');
    const metricStr = Buffer.from(this.metric, 'utf-8');

    // Build string table buffer
    const strBufs: Buffer[] = [];
    let strTableSize = 0;
    for (const id of ids) {
      const strBuf = Buffer.from(id, 'utf-8');
      if (strBuf.length > 65535) {
        throw new Error(`Vector ID "${id.slice(0, 50)}..." is ${strBuf.length} bytes, exceeds UInt16 max (65535)`);
      }
      const lenBuf = Buffer.alloc(2);
      lenBuf.writeUInt16LE(strBuf.length);
      strBufs.push(lenBuf, strBuf);
      strTableSize += 2 + strBuf.length;
    }

    // Calculate total size
    const HEADER_SIZE = 32;
    const strTableTotalSize = 4 + strTableSize; // 4-byte length prefix + string data
    const vectorDataSize = vectorCount * dimension * 4;
    const offsetsSize = (vectorCount + 1) * 4;
    const neighborsSize = neighbors.length * 4;
    const hubSize = hubIndices.length * 4;
    const statsSize = 24; // 3 x float64
    const configSize = 4 + configJson.length;
    const metricSize = 2 + metricStr.length;
    const checksumSize = 16; // MD5

    const totalSize = HEADER_SIZE + strTableTotalSize + vectorDataSize + offsetsSize + neighborsSize + hubSize + statsSize + configSize + metricSize + checksumSize;
    const buf = Buffer.alloc(totalSize);
    let offset = 0;

    // HEADER (32 bytes)
    Buffer.from('LEANN\x00').copy(buf, 0); offset = 6;
    buf.writeUInt16LE(2, offset); offset += 2; // format version
    buf.writeUInt32LE(0x04030201, offset); offset += 4; // endianness marker
    buf.writeUInt32LE(vectorCount, offset); offset += 4;
    buf.writeUInt32LE(dimension, offset); offset += 4;
    buf.writeUInt32LE(vectorCount, offset); offset += 4; // graph node count = vector count
    buf.writeUInt32LE(hubIndices.length, offset); offset += 4;
    buf.writeUInt32LE(0, offset); offset += 4; // reserved

    // STRING TABLE
    buf.writeUInt32LE(strTableSize, offset); offset += 4;
    for (const sb of strBufs) { sb.copy(buf, offset); offset += sb.length; }

    // VECTOR DATA (Float32 per dimension per vector)
    for (const id of ids) {
      const vec = this.vectors.get(id)!;
      for (let d = 0; d < dimension; d++) {
        buf.writeFloatLE(vec[d], offset); offset += 4;
      }
    }

    // GRAPH ADJACENCY (CSR: offsets then neighbor indices)
    for (const o of offsets) { buf.writeUInt32LE(o, offset); offset += 4; }
    for (const n of neighbors) { buf.writeUInt32LE(n, offset); offset += 4; }

    // HUB IDS (as vector indices)
    for (const h of hubIndices) { buf.writeUInt32LE(h, offset); offset += 4; }

    // STATS (3 x float64)
    buf.writeDoubleLE(this.cacheHits, offset); offset += 8;
    buf.writeDoubleLE(this.cacheMisses, offset); offset += 8;
    buf.writeDoubleLE(this.prunedEdges, offset); offset += 8;

    // CONFIG (length-prefixed JSON)
    buf.writeUInt32LE(configJson.length, offset); offset += 4;
    configJson.copy(buf, offset); offset += configJson.length;

    // METRIC (length-prefixed string)
    buf.writeUInt16LE(metricStr.length, offset); offset += 2;
    metricStr.copy(buf, offset); offset += metricStr.length;

    // CHECKSUM (MD5 of everything before this point)
    const { createHash } = await import('crypto');
    const hash = createHash('md5').update(buf.subarray(0, offset)).digest();
    hash.copy(buf, offset); offset += 16;

    // Atomic write: tmp -> fsync -> rename
    // Backup existing file first
    try {
      await fs.access(filePath);
      await fs.copyFile(filePath, filePath + '.bak');
    } catch { /* no existing file to backup */ }

    const tmpPath = filePath + '.tmp';
    const fd = await open(tmpPath, 'w');
    try {
      await fd.write(buf);
      await fd.sync();
    } finally {
      await fd.close();
    }
    await fs.rename(tmpPath, filePath);
  }

  /**
   * Load the index from persistent storage
   */
  async load(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
    } catch {
      return false;
    }

    const raw = await fs.readFile(filePath);

    // Legacy JSON detection: if first byte is '{', load as JSON v1 and migrate
    if (raw[0] === 0x7B) {
      const loaded = await this.loadLegacyJson(raw);
      if (loaded) {
        // Auto-migrate: save in binary format
        try { await this.save(filePath); } catch { /* migration save failed, non-fatal */ }
      }
      return loaded;
    }

    // Verify magic
    if (raw.length < 32 || raw.subarray(0, 6).toString('ascii') !== 'LEANN\x00') {
      throw new Error('Invalid LEANN binary file: bad magic');
    }

    // Verify format version
    const version = raw.readUInt16LE(6);
    if (version !== LEANN_STORAGE_VERSION) {
      throw new Error(`Unsupported LEANN binary version: ${version}`);
    }

    // Verify endianness
    if (raw.readUInt32LE(8) !== 0x04030201) {
      throw new Error('LEANN binary file has unexpected endianness');
    }

    // Verify checksum (last 16 bytes = MD5 of everything before)
    const { createHash } = await import('crypto');
    const payloadEnd = raw.length - 16;
    const expectedHash = raw.subarray(payloadEnd);
    const actualHash = createHash('md5').update(raw.subarray(0, payloadEnd)).digest();
    if (!actualHash.equals(expectedHash)) {
      throw new Error('LEANN binary file checksum mismatch — file is corrupt');
    }

    // Bounds-checking helper to catch truncated files
    const ensureBytes = (needed: number) => {
      if (offset + needed > payloadEnd) {
        throw new Error(
          `LEANN binary truncated: need ${needed} bytes at offset ${offset}, only ${payloadEnd - offset} remain`
        );
      }
    };

    // Parse header
    const vectorCount = raw.readUInt32LE(12);
    const dimension = raw.readUInt32LE(16);
    const graphNodeCount = raw.readUInt32LE(20);
    const hubIdCount = raw.readUInt32LE(24);

    if (dimension !== this.dimension) {
      throw new Error(`Dimension mismatch: file has ${dimension}D, expected ${this.dimension}D`);
    }

    this.clear();
    let offset = 32;

    // Parse string table
    ensureBytes(4);
    const strTableByteLen = raw.readUInt32LE(offset); offset += 4;
    const ids: string[] = [];
    ensureBytes(strTableByteLen);
    const strTableEnd = offset + strTableByteLen;
    while (offset < strTableEnd && ids.length < vectorCount) {
      const slen = raw.readUInt16LE(offset); offset += 2;
      ids.push(raw.subarray(offset, offset + slen).toString('utf-8'));
      offset += slen;
    }
    offset = strTableEnd; // align to end of string table

    // Parse vector data
    ensureBytes(vectorCount * dimension * 4);
    for (let i = 0; i < vectorCount; i++) {
      const vec = new Float32Array(dimension);
      for (let d = 0; d < dimension; d++) {
        vec[d] = raw.readFloatLE(offset); offset += 4;
      }
      this.vectors.set(ids[i], vec);
    }

    // Parse graph adjacency (CSR)
    ensureBytes((graphNodeCount + 1) * 4);
    const offsets: number[] = [];
    for (let i = 0; i <= graphNodeCount; i++) {
      offsets.push(raw.readUInt32LE(offset)); offset += 4;
    }
    const totalNeighbors = offsets[graphNodeCount];
    ensureBytes(totalNeighbors * 4);
    const neighborIndices: number[] = [];
    for (let i = 0; i < totalNeighbors; i++) {
      neighborIndices.push(raw.readUInt32LE(offset)); offset += 4;
    }

    // Reconstruct graph
    for (let i = 0; i < graphNodeCount; i++) {
      const start = offsets[i];
      const end = offsets[i + 1];
      const nodeNeighbors = new Set<string>();
      for (let j = start; j < end; j++) {
        const nIdx = neighborIndices[j];
        if (nIdx >= ids.length) continue; // skip corrupt neighbor indices
        nodeNeighbors.add(ids[nIdx]);
      }
      this.graph.set(ids[i], {
        vector: this.vectors.get(ids[i]) || null,
        neighbors: nodeNeighbors,
      });
    }

    // Parse hub IDs
    ensureBytes(hubIdCount * 4);
    this.maxHubCacheSize = Math.max(1, Math.floor(this.vectors.size * this.config.hubCacheRatio));
    for (let i = 0; i < hubIdCount; i++) {
      const hubIdx = raw.readUInt32LE(offset); offset += 4;
      const hubId = ids[hubIdx];
      const vector = this.vectors.get(hubId);
      if (vector) {
        const node = this.graph.get(hubId);
        this.hubCache.set(hubId, {
          vector: new Float32Array(vector),
          degree: node ? node.neighbors.size : 0,
          lastAccess: Date.now(),
        });
      }
    }

    // Parse stats
    ensureBytes(24);
    this.cacheHits = raw.readDoubleLE(offset); offset += 8;
    this.cacheMisses = raw.readDoubleLE(offset); offset += 8;
    this.prunedEdges = raw.readDoubleLE(offset); offset += 8;

    // Parse config (skip — we use constructor config, not file config)
    const configLen = raw.readUInt32LE(offset); offset += 4;
    offset += configLen;

    // Parse metric (skip — we use constructor metric)
    const metricLen = raw.readUInt16LE(offset); offset += 2;
    offset += metricLen;

    return true;
  }

  private async loadLegacyJson(raw: Buffer): Promise<boolean> {
    let data: LEANNSerializedData;
    try {
      data = JSON.parse(raw.toString('utf-8'));
    } catch (error) {
      throw new Error(`Failed to parse legacy JSON LEANN index: ${error}`);
    }

    if (data.version !== LEANN_LEGACY_VERSION) {
      throw new Error(`Unsupported legacy LEANN version: ${data.version}`);
    }
    if (data.dimension !== this.dimension) {
      throw new Error(`Dimension mismatch: file has ${data.dimension}D, expected ${this.dimension}D`);
    }

    this.clear();

    for (const { id, data: vectorData } of data.vectors) {
      this.vectors.set(id, new Float32Array(vectorData));
    }
    for (const { id, neighbors } of data.graph) {
      this.graph.set(id, {
        vector: this.vectors.get(id) || null,
        neighbors: new Set(neighbors),
      });
    }
    this.maxHubCacheSize = Math.max(1, Math.floor(this.vectors.size * this.config.hubCacheRatio));
    for (const hubId of data.hubIds) {
      const vector = this.vectors.get(hubId);
      if (vector) {
        const node = this.graph.get(hubId);
        this.hubCache.set(hubId, {
          vector: new Float32Array(vector),
          degree: node ? node.neighbors.size : 0,
          lastAccess: Date.now(),
        });
      }
    }
    this.cacheHits = data.stats.cacheHits;
    this.cacheMisses = data.stats.cacheMisses;
    this.prunedEdges = data.stats.prunedEdges;
    return true;
  }

  /**
   * Clear all vectors from the index
   */
  clear(): void {
    this.vectors.clear();
    this.graph.clear();
    this.hubCache.clear();
    this.maxHubCacheSize = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.prunedEdges = 0;
  }

  /**
   * Get statistics about the LEANN backend
   */
  getStats(): LEANNStats {
    let totalEdges = 0;
    let totalHubDegree = 0;

    for (const node of this.graph.values()) {
      totalEdges += node.neighbors.size;
    }

    for (const entry of this.hubCache.values()) {
      totalHubDegree += entry.degree;
    }

    const totalRequests = this.cacheHits + this.cacheMisses;

    return {
      totalVectors: this.vectors.size,
      hubCacheSize: this.hubCache.size,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      hitRatio: totalRequests > 0 ? this.cacheHits / totalRequests : 0,
      avgHubDegree: this.hubCache.size > 0 ? totalHubDegree / this.hubCache.size : 0,
      totalEdges: totalEdges / 2, // Divide by 2 for bidirectional edges
      prunedEdges: this.prunedEdges,
    };
  }

  /**
   * Get the configuration
   */
  getConfig(): LEANNConfig {
    return { ...this.config };
  }

  /**
   * Trigger selective recomputation for cold vectors
   * Uses the embedding generator if set
   */
  async recomputeColdVectors(maxVectors: number = this.config.batchSize): Promise<number> {
    if (!this.embeddingGenerator) {
      return 0;
    }

    // Find cold vectors (not in hub cache, not recently accessed)
    const coldVectors: VectorID[] = [];
    for (const id of this.vectors.keys()) {
      if (!this.hubCache.has(id)) {
        coldVectors.push(id);
        if (coldVectors.length >= maxVectors) break;
      }
    }

    // Recompute embeddings with latency tracking
    let recomputed = 0;
    const startTime = Date.now();

    for (const id of coldVectors) {
      // Check latency budget
      if (Date.now() - startTime >= this.config.maxRecomputeLatencyMs) {
        break;
      }

      try {
        const newVector = await this.embeddingGenerator(id);
        if (newVector && newVector.length === this.dimension) {
          this.vectors.set(id, new Float32Array(newVector));
          const node = this.graph.get(id);
          if (node) {
            node.vector = new Float32Array(newVector);
          }
          recomputed++;
        }
      } catch {
        // Skip failed recomputations
      }
    }

    return recomputed;
  }

  /**
   * Force rebuild of hub cache
   */
  rebuildHubCache(): void {
    this.hubCache.clear();
    this.updateHubCache();
  }

  /**
   * Get hub IDs for external use
   */
  getHubIds(): VectorID[] {
    return Array.from(this.hubCache.keys());
  }
}
