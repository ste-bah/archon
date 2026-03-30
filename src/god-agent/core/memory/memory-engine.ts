/**
 * Memory Engine Core Implementation
 * Orchestrates VectorDB and GraphDB for unified memory management
 */

import type { VectorDB } from '../vector-db/index.js';
import type { GraphDB, NodeID, EdgeID } from '../graph-db/index.js';
import type {
  IEmbeddingProvider,
  IStoreOptions,
  IRetrieveOptions,
  ISearchOptions,
  MemorySearchResult,
  RelationType
} from './types.js';
import { encodeValue, decodeValue } from './encoding.js';
import { validateNamespace, validateOrphanPrevention } from './validation.js';
import { StorageTransactionError } from './errors.js';
import { LRUCache } from './lru-cache.js';
import { TransactionManager } from './transaction-manager.js';

/**
 * MemoryEngine orchestrates vector and graph databases for semantic memory storage
 * Includes LRU cache for <50µs p95 latency on cache hits
 */
export class MemoryEngine {
  private cache: LRUCache<string, string>;
  private transactionManager: TransactionManager;

  constructor(
    private readonly vectorDB: VectorDB,
    private readonly graphDB: GraphDB,
    private readonly embeddingProvider: IEmbeddingProvider,
    cacheCapacity: number = 1000
  ) {
    this.cache = new LRUCache<string, string>(cacheCapacity);
    this.transactionManager = new TransactionManager();
  }

  /**
   * Store a key-value pair with semantic embedding and graph relationships
   * Uses Two-Phase Commit (2PC) for atomic rollback across VectorDB and GraphDB
   *
   * @param key - Unique identifier for the memory
   * @param value - Value to store (will be Base64 encoded)
   * @param options - Storage options including namespace and relationships
   * @throws {NamespaceValidationError} If namespace format is invalid
   * @throws {OrphanNodeError} If non-root namespace lacks linkTo
   * @throws {StorageTransactionError} If storage operation fails
   */
  async store(key: string, value: string, options: IStoreOptions): Promise<void> {
    // PHASE 1: PREPARE - Validate before any operations

    // 1. Validate namespace format
    validateNamespace(options.namespace);

    // 2. Validate orphan prevention (non-root requires linkTo)
    validateOrphanPrevention(options.namespace, options.linkTo);

    // 3. Verify linkTo node exists if provided
    if (options.linkTo) {
      try {
        await this.graphDB.getNode(options.linkTo);
      } catch (error) {
        throw new StorageTransactionError(
          `Link target node ${options.linkTo} not found`,
          error
        );
      }
    }

    // 4. Generate or use provided embedding
    const embedding = options.embedding
      ? options.embedding
      : await this.embeddingProvider.embed(value);

    // 5. Encode value as Base64
    const encodedValue = encodeValue(value);

    // Start transaction
    const txnId = this.transactionManager.startTransaction();

    try {
      // PHASE 2: EXECUTE with operation tracking

      // 2a. Insert vector to VectorDB
      const vectorId = await this.vectorDB.insert(embedding);
      this.transactionManager.addOperation(
        txnId,
        this.transactionManager.createVectorOperation(this.vectorDB, vectorId)
      );

      // 2b. Create graph node with embedded metadata
      const nodeId = await this.graphDB.createNode({
        type: 'memory',
        properties: {
          key,
          value: encodedValue,
          namespace: options.namespace,
          vectorId
        },
        embedding: Array.from(embedding),  // GraphDB uses number[]
        linkTo: options.linkTo  // Pass linkTo to GraphDB for orphan prevention
      });
      this.transactionManager.addOperation(
        txnId,
        this.transactionManager.createNodeOperation(this.graphDB, nodeId)
      );

      // 2c. Create relationship edge if linkTo provided with explicit relation type
      // Note: GraphDB.createNode already creates a 'linked_to' edge when linkTo is provided
      // This creates an additional edge only for explicit relation types
      if (options.linkTo && nodeId && options.relation) {
        const edgeId = await this.graphDB.createEdge({
          source: nodeId,
          target: options.linkTo,
          type: options.relation
        }) as EdgeID;
        this.transactionManager.addOperation(
          txnId,
          this.transactionManager.createEdgeOperation(this.graphDB, edgeId)
        );
      }

      // PHASE 3: COMMIT
      await this.transactionManager.commit(txnId);

      // Update cache after successful storage
      const cacheKey = options.namespace ? `${options.namespace}:${key}` : key;
      this.cache.set(cacheKey, value);

    } catch (error) {
      // PHASE 3 (ALTERNATE): ROLLBACK on any failure
      // Rolls back ALL operations: edges → nodes → vectors
      await this.transactionManager.rollback(txnId);

      throw new StorageTransactionError(
        `Failed to store memory with key "${key}"`,
        error
      );
    }
  }

  /**
   * Retrieve a memory value by key
   *
   * @param key - Memory key to retrieve
   * @param options - Retrieval options
   * @returns Decoded value or null if not found
   */
  async retrieve(
    key: string,
    options: IRetrieveOptions = {}
  ): Promise<string | null> {
    try {
      // Build cache key with namespace
      const cacheKey = options.namespace ? `${options.namespace}:${key}` : key;

      // Check cache first for <50µs p95 latency
      const cachedValue = this.cache.get(cacheKey);
      if (cachedValue !== null) {
        return cachedValue;
      }

      // Cache miss - query graph database using public API
      const matchingNodes = await this.graphDB.queryNodes({
        namespace: options.namespace
      });

      // Find node with matching key
      const node = matchingNodes.find(n => n.key === key);

      if (!node) {
        return null;
      }

      // Decode and cache the value
      // Note: value is stored in the node's metadata or properties
      // We need to get the full node to access the encoded value
      const fullNode = await this.graphDB.getNode(node.id as NodeID);
      const encodedValue = fullNode.properties.value as string;
      const decodedValue = decodeValue(encodedValue);

      // Update cache for future hits
      this.cache.set(cacheKey, decodedValue);

      return decodedValue;

    } catch (error) {
      throw new StorageTransactionError(
        `Failed to retrieve memory with key "${key}"`,
        error
      );
    }
  }

  /**
   * Semantic search for memories using vector similarity
   *
   * @param query - Search query text
   * @param options - Search options (limit, namespace filter, etc.)
   * @returns Array of search results with scores
   */
  async search(
    query: string,
    options: ISearchOptions = {}
  ): Promise<MemorySearchResult[]> {
    try {
      // 1. Generate query embedding
      const queryEmbedding = await this.embeddingProvider.embed(query);

      // 2. Search vector database
      const limit = options.limit || 10;
      const vectorResults = await this.vectorDB.search(queryEmbedding, limit * 2); // Get extras for filtering

      // 3. Retrieve corresponding graph nodes using public API
      const results: MemorySearchResult[] = [];

      // Get all nodes to match with vector results
      const allNodes = await this.graphDB.getAllNodes();

      for (const vectorResult of vectorResults) {
        // Find graph node with this vectorId
        const node = allNodes.find(n => n.vectorId === vectorResult.id);

        if (!node) continue;

        const namespace = node.namespace || '';

        // Filter by namespace if specified
        if (options.namespace && namespace !== options.namespace) {
          continue;
        }

        // Filter by minimum score if specified
        if (options.minScore && vectorResult.similarity < options.minScore) {
          continue;
        }

        // Get full node to decode value
        const fullNode = await this.graphDB.getNode(node.id as NodeID);
        const encodedValue = fullNode.properties.value as string;
        const decodedValue = decodeValue(encodedValue);

        results.push({
          key: node.key,
          value: decodedValue,
          namespace,
          score: vectorResult.similarity,
          nodeId: node.id
        });

        // Stop if we've reached the limit
        if (results.length >= limit) {
          break;
        }
      }

      return results;

    } catch (error) {
      throw new StorageTransactionError(
        `Failed to search memories for query "${query}"`,
        error
      );
    }
  }

  /**
   * Get related memories through graph traversal
   *
   * @param nodeId - Starting node ID
   * @param relationType - Optional relation type filter
   * @returns Array of related memory results
   */
  async getRelated(
    nodeId: NodeID,
    relationType?: RelationType
  ): Promise<MemorySearchResult[]> {
    try {
      // Get outgoing edges using GraphDB's getEdges method
      const { data: edges } = await this.graphDB.getEdges(nodeId);

      const results: MemorySearchResult[] = [];

      for (const edge of edges) {
        // Filter by relation type if specified
        if (relationType && edge.type !== relationType) {
          continue;
        }

        const targetNode = await this.graphDB.getNode(edge.target);

        if (targetNode.type !== 'memory') continue;

        const encodedValue = targetNode.properties.value as string;
        const decodedValue = decodeValue(encodedValue);

        results.push({
          key: targetNode.properties.key as string,
          value: decodedValue,
          namespace: targetNode.properties.namespace as string,
          score: 1.0, // Exact relationship, not similarity-based
          nodeId: targetNode.id
        });
      }

      return results;

    } catch (error) {
      throw new StorageTransactionError(
        `Failed to get related memories for node "${nodeId}"`,
        error
      );
    }
  }

  /**
   * Close the memory engine and release resources
   * Clears cache and closes any database connections
   */
  async close(): Promise<void> {
    // Clear the LRU cache
    this.cache.clear();

    // Close VectorDB if it exists and has a close method
    if (this.vectorDB && typeof (this.vectorDB as any).close === 'function') {
      await (this.vectorDB as any).close();
    }

    // Close GraphDB if it exists and has a close method
    if (this.graphDB && typeof (this.graphDB as any).close === 'function') {
      await (this.graphDB as any).close();
    }
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): { size: number; capacity: number } {
    return {
      size: this.cache.size(),
      capacity: (this.cache as any).capacity || 1000
    };
  }
}
