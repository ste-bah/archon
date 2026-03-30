/**
 * God Agent VectorDB - High-Level Vector Database
 *
 * Implements: TASK-VDB-001, TASK-OBS-002
 * Referenced by: God Agent core system
 *
 * Provides validated vector storage with k-NN search.
 * All vectors are validated at insertion boundaries per VEC-04.
 * Emits observability events for all operations per TASK-OBS-002.
 */

import { randomUUID } from 'crypto';
import { assertDimensions, VECTOR_DIM } from '../validation/index.js';
import { IHNSWBackend } from './hnsw-backend.js';
import { BackendSelector, BackendSelection } from './backend-selector.js';
import { VectorID, SearchResult, VectorDBOptions, DistanceMetric } from './types.js';
import { getObservabilityBus } from '../observability/bus.js';
import { METRICS } from '../observability/metrics.js';

/**
 * High-level vector database with automatic validation
 * Enforces VECTOR_DIM (1536D), L2-normalized vectors at all insertion boundaries
 * Automatically selects optimal HNSW backend (native Rust or JavaScript fallback)
 */
export class VectorDB {
  private backend!: IHNSWBackend; // Initialized in initialize()
  private readonly dimension: number;
  private readonly metric: DistanceMetric;
  private readonly persistencePath: string;
  private readonly autoSave: boolean;
  private readonly backendConfig: { type?: 'native' | 'leann' | 'javascript'; verbose?: boolean; leannConfig?: VectorDBOptions['leannConfig'] };
  private backendSelection?: BackendSelection;
  private initialized: boolean = false;

  /**
   * Create a new VectorDB instance
   *
   * Note: Backend selection happens asynchronously during first operation.
   * Call initialize() explicitly if you need to know backend selection before first use.
   *
   * @param options - Configuration options
   */
  constructor(options: VectorDBOptions = {}) {
    const {
      dimension = VECTOR_DIM,
      metric = DistanceMetric.COSINE,
      // HNSW params (hnswM, hnswEfConstruction, hnswEfSearch) will be used
      // when native backend is implemented - see HNSW_PARAMS in validation/constants
      persistencePath = '.agentdb/vectors.bin',
      autoSave = false,
      backend = 'auto',
      verbose = false,
      leannConfig
    } = options;

    this.dimension = dimension;
    this.metric = metric;
    this.persistencePath = persistencePath;
    this.autoSave = autoSave;

    // Store backend configuration for lazy initialization
    this.backendConfig = {
      type: backend === 'auto' ? undefined : backend,
      verbose,
      leannConfig
    };
  }

  /**
   * Initialize the VectorDB backend
   * This is called automatically on first operation, but can be called explicitly
   * to control when backend selection happens.
   *
   * @returns Backend selection information
   */
  async initialize(): Promise<BackendSelection> {
    if (this.initialized) {
      return this.backendSelection!;
    }

    const { backend, selection } = await BackendSelector.loadBackend(
      this.dimension,
      this.metric,
      {
        forceBackend: this.backendConfig.type,
        verbose: this.backendConfig.verbose,
        leannConfig: this.backendConfig.leannConfig
      }
    );

    this.backend = backend;
    this.backendSelection = selection;
    this.initialized = true;

    return selection;
  }

  /**
   * Get the underlying HNSW backend (for advanced use cases)
   * Note: Will trigger initialization if not already done
   */
  get backend_(): IHNSWBackend {
    if (!this.initialized) {
      throw new Error('VectorDB not initialized. Call initialize() or perform an operation first.');
    }
    return this.backend;
  }

  /**
   * Get backend selection information
   *
   * @returns Backend selection details, or undefined if not yet initialized
   */
  getBackendInfo(): BackendSelection | undefined {
    return this.backendSelection;
  }

  /**
   * Check if VectorDB is initialized
   *
   * @returns true if backend has been loaded
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Insert a vector into the database
   * Automatically generates a UUID for the vector
   *
   * @param vector - Vector to insert (must be VECTOR_DIM (1536D), L2-normalized, finite)
   * @returns The generated vector ID
   * @throws GraphDimensionMismatchError if dimension mismatch
   * @throws NotNormalizedError if not L2-normalized
   * @throws InvalidVectorValueError if contains NaN/Infinity
   */
  async insert(vector: Float32Array): Promise<VectorID> {
    const bus = getObservabilityBus();
    const startTime = Date.now();

    bus.emit({
      component: 'vectordb',
      operation: 'vectordb_insert_started',
      status: 'running',
      metadata: { dimension: vector.length, count: 1 }
    });

    try {
      // Ensure backend is initialized
      await this.initialize();

      // VEC-04: Validate at insertion boundary
      assertDimensions(vector, this.dimension, 'VectorDB.insert');

      // Generate ID and insert
      const id = randomUUID();
      this.backend.insert(id, vector);

      // Auto-save if enabled
      if (this.autoSave) {
        await this.save();
      }

      const latencyMs = Date.now() - startTime;
      bus.emit({
        component: 'vectordb',
        operation: 'vectordb_insert_completed',
        status: 'success',
        durationMs: latencyMs,
        metadata: { vectorId: id, count: 1, latencyMs }
      });

      // Update Prometheus metrics
      METRICS.vectordbSearchCount.inc({ operation: 'insert', status: 'success' });

      return id;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      bus.emit({
        component: 'vectordb',
        operation: 'vectordb_insert_completed',
        status: 'error',
        durationMs: latencyMs,
        metadata: { error: error instanceof Error ? error.message : String(error), latencyMs }
      });

      METRICS.vectordbSearchCount.inc({ operation: 'insert', status: 'error' });
      throw error;
    }
  }

  /**
   * Insert a vector with a specific ID
   *
   * @param id - Vector identifier
   * @param vector - Vector to insert (must be VECTOR_DIM (1536D), L2-normalized, finite)
   * @throws GraphDimensionMismatchError if dimension mismatch
   * @throws NotNormalizedError if not L2-normalized
   * @throws InvalidVectorValueError if contains NaN/Infinity
   */
  async insertWithId(id: VectorID, vector: Float32Array): Promise<void> {
    const bus = getObservabilityBus();
    const startTime = Date.now();

    bus.emit({
      component: 'vectordb',
      operation: 'vectordb_insert_started',
      status: 'running',
      metadata: { vectorId: id, dimension: vector.length, count: 1 }
    });

    try {
      // Ensure backend is initialized
      await this.initialize();

      // VEC-04: Validate at insertion boundary
      assertDimensions(vector, this.dimension, 'VectorDB.insertWithId');

      this.backend.insert(id, vector);

      // Auto-save if enabled
      if (this.autoSave) {
        await this.save();
      }

      const latencyMs = Date.now() - startTime;
      bus.emit({
        component: 'vectordb',
        operation: 'vectordb_insert_completed',
        status: 'success',
        durationMs: latencyMs,
        metadata: { vectorId: id, count: 1, latencyMs }
      });

      METRICS.vectordbSearchCount.inc({ operation: 'insert', status: 'success' });
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      bus.emit({
        component: 'vectordb',
        operation: 'vectordb_insert_completed',
        status: 'error',
        durationMs: latencyMs,
        metadata: { vectorId: id, error: error instanceof Error ? error.message : String(error), latencyMs }
      });

      METRICS.vectordbSearchCount.inc({ operation: 'insert', status: 'error' });
      throw error;
    }
  }

  /**
   * Batch insert multiple vectors
   * More efficient than individual inserts
   *
   * @param vectors - Array of vectors to insert
   * @returns Array of generated vector IDs
   * @throws GraphDimensionMismatchError if any dimension mismatch
   * @throws NotNormalizedError if any vector not L2-normalized
   * @throws InvalidVectorValueError if any vector contains NaN/Infinity
   */
  async batchInsert(vectors: Float32Array[]): Promise<VectorID[]> {
    const bus = getObservabilityBus();
    const startTime = Date.now();
    const batchSize = vectors.length;

    bus.emit({
      component: 'vectordb',
      operation: 'vectordb_batch_operation',
      status: 'running',
      metadata: { operationType: 'insert', batchSize, dimension: vectors[0]?.length ?? 0 }
    });

    try {
      // Ensure backend is initialized
      await this.initialize();

      const ids: VectorID[] = [];

      // Validate all vectors first (fail fast)
      for (let i = 0; i < vectors.length; i++) {
        assertDimensions(vectors[i], this.dimension, `VectorDB.batchInsert[${i}]`);
      }

      // Insert all vectors
      for (const vector of vectors) {
        const id = randomUUID();
        this.backend.insert(id, vector);
        ids.push(id);
      }

      // Auto-save if enabled
      if (this.autoSave) {
        await this.save();
      }

      const latencyMs = Date.now() - startTime;
      bus.emit({
        component: 'vectordb',
        operation: 'vectordb_batch_operation',
        status: 'success',
        durationMs: latencyMs,
        metadata: { operationType: 'insert', batchSize, count: ids.length, latencyMs }
      });

      METRICS.vectordbSearchCount.inc({ operation: 'batch_insert', status: 'success' }, batchSize);

      return ids;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      bus.emit({
        component: 'vectordb',
        operation: 'vectordb_batch_operation',
        status: 'error',
        durationMs: latencyMs,
        metadata: {
          operationType: 'insert',
          batchSize,
          error: error instanceof Error ? error.message : String(error),
          latencyMs
        }
      });

      METRICS.vectordbSearchCount.inc({ operation: 'batch_insert', status: 'error' });
      throw error;
    }
  }

  /**
   * Search for k nearest neighbors
   *
   * @param query - Query vector (must be VECTOR_DIM (1536D), L2-normalized, finite)
   * @param k - Number of neighbors to return (default: 10)
   * @param includeVectors - Whether to include vector data in results (default: false)
   * @returns Array of search results, sorted by similarity (best first)
   * @throws GraphDimensionMismatchError if dimension mismatch
   * @throws NotNormalizedError if not L2-normalized
   * @throws InvalidVectorValueError if contains NaN/Infinity
   */
  async search(query: Float32Array, k: number = 10, includeVectors: boolean = false): Promise<SearchResult[]> {
    const bus = getObservabilityBus();
    const startTime = Date.now();

    bus.emit({
      component: 'vectordb',
      operation: 'vectordb_search_started',
      status: 'running',
      metadata: { topK: k, dimension: query.length, includeVectors }
    });

    try {
      // Ensure backend is initialized
      await this.initialize();

      // VEC-04: Validate query at search boundary
      assertDimensions(query, this.dimension, 'VectorDB.search');

      const results = this.backend.search(query, k, includeVectors);
      const latencyMs = Date.now() - startTime;

      bus.emit({
        component: 'vectordb',
        operation: 'vectordb_search_completed',
        status: 'success',
        durationMs: latencyMs,
        metadata: { topK: k, resultCount: results.length, latencyMs }
      });

      // Update Prometheus metrics
      METRICS.vectordbSearchLatency.observe(latencyMs / 1000, { operation: 'search', index: 'hnsw' });
      METRICS.vectordbSearchCount.inc({ operation: 'search', status: 'success' });

      return results;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      bus.emit({
        component: 'vectordb',
        operation: 'vectordb_search_completed',
        status: 'error',
        durationMs: latencyMs,
        metadata: { topK: k, error: error instanceof Error ? error.message : String(error), latencyMs }
      });

      METRICS.vectordbSearchLatency.observe(latencyMs / 1000, { operation: 'search', index: 'hnsw' });
      METRICS.vectordbSearchCount.inc({ operation: 'search', status: 'error' });
      throw error;
    }
  }

  /**
   * Retrieve a vector by ID
   *
   * @param id - Vector identifier
   * @returns The vector if found, undefined otherwise
   */
  async getVector(id: VectorID): Promise<Float32Array | undefined> {
    // Ensure backend is initialized
    await this.initialize();

    return this.backend.getVector(id);
  }

  /**
   * Delete a vector from the database
   *
   * @param id - Vector identifier to delete
   * @returns true if vector was deleted, false if not found
   */
  async delete(id: VectorID): Promise<boolean> {
    // Ensure backend is initialized
    await this.initialize();

    const deleted = this.backend.delete(id);

    // Auto-save if enabled and something was deleted
    if (this.autoSave && deleted) {
      await this.save();
    }

    return deleted;
  }

  /**
   * Get the number of vectors in the database
   *
   * @returns Vector count
   */
  async count(): Promise<number> {
    // Ensure backend is initialized
    await this.initialize();

    return this.backend.count();
  }

  /**
   * Save the database to persistent storage
   */
  async save(): Promise<void> {
    // Ensure backend is initialized
    await this.initialize();

    await this.backend.save(this.persistencePath);
  }

  /**
   * Load the database from persistent storage
   *
   * @returns true if loaded successfully, false if file doesn't exist
   */
  async load(): Promise<boolean> {
    // Ensure backend is initialized
    await this.initialize();

    return await this.backend.load(this.persistencePath);
  }

  /**
   * Clear all vectors from the database
   */
  async clear(): Promise<void> {
    // Ensure backend is initialized
    await this.initialize();

    this.backend.clear();
  }
}
