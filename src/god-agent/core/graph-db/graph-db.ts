/**
 * GraphDB - Hypergraph Database with Temporal Features
 * Supports hyperedges (n-ary relationships), temporal expiration, and embedding validation
 */

import { randomUUID } from 'crypto';
import { GraphDimensionMismatchError } from '../validation/index.js';
import { FallbackGraph } from './fallback-graph.js';
import {
  NodeNotFoundError,
  InvalidHyperedgeError,
  OrphanNodeError
} from './errors.js';
import type { IGraphBackend } from './graph-backend.js';
import {
  QueryDirection,
  type NodeID,
  type EdgeID,
  type HyperedgeID,
  type INode,
  type IEdge,
  type IHyperedge,
  type ITemporalHyperedge,
  type GraphDBOptions,
  type CreateNodeOptions,
  type CreateEdgeOptions,
  type CreateHyperedgeOptions,
  type CreateTemporalHyperedgeOptions,
  type QueryResult,
  type IIntegrityReport
} from './types.js';

/**
 * Node data interface for public API
 */
export interface INodeData {
  id: string;
  key: string;
  namespace?: string;
  vectorId?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/**
 * Edge data interface for public API
 */
export interface IEdgeData {
  id: string;
  type: string;
  nodeIds: string[];
  weight?: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

/**
 * Node filter interface for public API queries
 */
export interface INodeFilter {
  namespace?: string;
  keyPattern?: string;
  createdAfter?: number;
  createdBefore?: number;
  hasVectorId?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Edge filter interface for public API queries
 */
export interface IEdgeFilter {
  nodeId?: string;
  type?: string;
}

/**
 * Complete GraphDB interface defining all public methods
 */
export interface IGraphDB {
  // Existing methods
  createNode(options: CreateNodeOptions): Promise<NodeID>;
  getNode(id: NodeID): Promise<INode>;
  updateNode(id: NodeID, properties: Record<string, unknown>): Promise<void>;
  updateEmbedding(id: NodeID, embedding: number[]): Promise<void>;
  createEdge(options: CreateEdgeOptions): Promise<EdgeID>;
  getEdges(nodeId: NodeID, direction?: QueryDirection): Promise<QueryResult<IEdge>>;
  createHyperedge(options: CreateHyperedgeOptions): Promise<HyperedgeID>;
  createTemporalHyperedge(options: CreateTemporalHyperedgeOptions): Promise<HyperedgeID>;
  getHyperedge(id: HyperedgeID): Promise<IHyperedge | ITemporalHyperedge>;
  getAllHyperedges(): Promise<(IHyperedge | ITemporalHyperedge)[]>;
  getHyperedgesByNode(nodeId: NodeID): Promise<QueryResult<IHyperedge | ITemporalHyperedge>>;
  validateIntegrity(): Promise<IIntegrityReport>;
  traverseHops(startNodeId: NodeID, hops: number): Promise<QueryResult<NodeID>>;
  nodeCount(): Promise<number>;
  edgeCount(): Promise<number>;
  clear(): Promise<void>;
  initialize(): Promise<void>;

  // NEW: Public query methods (to replace `as any` access)
  queryNodes(filter: INodeFilter): Promise<INodeData[]>;
  getNodeById(nodeId: string): Promise<INodeData | null>;
  getNodeByKey(key: string, namespace?: string): Promise<INodeData | null>;
  getNodesByNamespace(namespace: string): Promise<INodeData[]>;
  getAllNodes(): Promise<INodeData[]>;

  // NEW: Edge query methods
  queryEdges(filter: IEdgeFilter): Promise<IEdgeData[]>;
  getEdgeById(edgeId: string): Promise<IEdgeData | null>;
  getEdgesForNode(nodeId: string): Promise<IEdgeData[]>;

  // NEW: Delete methods (from SPEC-TXN-001)
  deleteNode(nodeId: string): Promise<boolean>;
  deleteEdge(edgeId: string): Promise<boolean>;

  // NEW: Utility methods
  countNodes(filter?: INodeFilter): Promise<number>;
  nodeExists(key: string, namespace?: string): Promise<boolean>;
}

const DEFAULT_OPTIONS: Required<GraphDBOptions> = {
  dataDir: '.agentdb/graphs',
  enablePersistence: true,
  lockTimeout: 5000,
  validateDimensions: true,
  expectedDimensions: 1536
};

/**
 * GraphDB - Main hypergraph database class
 */
export class GraphDB implements IGraphDB {
  private backend: IGraphBackend;
  private options: Required<GraphDBOptions>;


  // RTF-001: Root namespace constants for orphan prevention
  private static readonly ROOT_NAMESPACES = ['project', 'research', 'patterns'];
  private static readonly GRAPH_ROOT_ID = 'graph:root';

  constructor(backend?: IGraphBackend, options: GraphDBOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Use provided backend or create FallbackGraph
    this.backend = backend || new FallbackGraph(
      this.options.dataDir,
      this.options.lockTimeout,
      this.options.enablePersistence
    );
  }

  /**
   * Initialize the database (load persisted data)
   */
  async initialize(): Promise<void> {
    if (this.backend.load) {
      await this.backend.load();
    }
    // RTF-001-T05: graph:root created on-demand by ensureGraphRoot()
    // when first root namespace node needs a parent
  }


  // RTF-001-T02: Extract namespace from node key (e.g., "project/api" -> "project")
  private extractNamespace(key: string): string {
    const parts = key.split('/');
    return parts[0] || key;
  }

  // RTF-001-T02: Check if namespace is a root namespace
  private isRootNamespace(namespace: string): boolean {
    return GraphDB.ROOT_NAMESPACES.includes(namespace);
  }

  // RTF-001-T02: Find existing node in same root namespace
  private async findExistingRootNode(namespace: string): Promise<INode | undefined> {
    const nodes = await this.backend.getAllNodes();
    return nodes.find(n => {
      const key = n.properties?.key as string | undefined;
      return key && this.extractNamespace(key) === namespace;
    });
  }


  // RTF-001-T04: Ensure graph:root node exists, create if needed
  private async ensureGraphRoot(): Promise<NodeID> {
    const nodes = await this.backend.getAllNodes();
    const graphRoot = nodes.find(n => 
      (n.properties?.key as string | undefined) === GraphDB.GRAPH_ROOT_ID
    );

    if (graphRoot) {
      return graphRoot.id;
    }

    // Create graph:root node
    const nodeId = randomUUID() as NodeID;
    const now = Date.now();

    const rootNode: INode = {
      id: nodeId,
      type: 'system',
      properties: {
        key: GraphDB.GRAPH_ROOT_ID,
        created: now,
        purpose: 'Graph root node for orphan prevention'
      },
      createdAt: now,
      updatedAt: now
    };

    await this.backend.insertNode(rootNode);
    console.log(`[GraphDB] Created graph root node: ${GraphDB.GRAPH_ROOT_ID}`);
    
    return nodeId;
  }

  /**
   * Create a node with optional embedding
   * Enforces non-orphan constraint: first node or must link to existing node
   */
  async createNode(options: CreateNodeOptions): Promise<NodeID> {
    const { type, properties = {}, embedding, linkTo } = options;

    // Validate embedding dimensions if provided
    if (embedding && this.options.validateDimensions) {
      if (embedding.length !== this.options.expectedDimensions) {
        throw new GraphDimensionMismatchError(
          this.options.expectedDimensions,
          embedding.length,
          'GraphDB.createNode'
        );
      }
    }

    // RTF-001-T03: Upsert logic - check if node with same key exists
    const existingNodes = await this.backend.getAllNodes();
    const nodeKey = properties?.key as string | undefined;
    
    if (nodeKey) {
      const existingNode = existingNodes.find(n => 
        (n.properties?.key as string | undefined) === nodeKey
      );
      
      if (existingNode) {
        // Upsert: update existing node instead of creating new one
        console.log(`[GraphDB] Upserting existing node with key: ${nodeKey}`);
        await this.updateNode(existingNode.id, { properties, embedding });
        return existingNode.id;
      }
    }

    // RTF-001-T04: Smart orphan constraint with root namespace auto-linking
    let effectiveLinkTo = linkTo;

    if (existingNodes.length > 0 && !linkTo) {
      const namespace = nodeKey ? this.extractNamespace(nodeKey) : undefined;

      // Check if key is in root namespace or is a root-level key (no namespace separator)
      const isRootLevelKey = nodeKey && !nodeKey.includes('/');
      
      if (isRootLevelKey || (namespace && this.isRootNamespace(namespace))) {
        // Root-level key or root namespace node - auto-link to graph:root or existing root node
        if (namespace && this.isRootNamespace(namespace)) {
          const existingRootNode = await this.findExistingRootNode(namespace);
          if (existingRootNode) {
            effectiveLinkTo = existingRootNode.id;
            console.log(`[GraphDB] Auto-linking to existing root node: ${existingRootNode.id}`);
          } else {
            effectiveLinkTo = await this.ensureGraphRoot();
            console.log(`[GraphDB] Auto-linking to graph root: ${effectiveLinkTo}`);
          }
        } else {
          // Root-level key without namespace - link to graph:root
          effectiveLinkTo = await this.ensureGraphRoot();
          console.log(`[GraphDB] Auto-linking root-level key to graph root: ${effectiveLinkTo}`);
        }
      } else {
        // Non-root namespace without linkTo - still an error
        throw new OrphanNodeError();
      }
    }

    // Verify linkTo node exists if provided
    if (effectiveLinkTo) {
      const exists = await this.backend.nodeExists(effectiveLinkTo);
      if (!exists) {
        throw new NodeNotFoundError(effectiveLinkTo);
      }
    }

    const nodeId = randomUUID() as NodeID;
    const now = Date.now();

    const node: INode = {
      id: nodeId,
      type,
      properties,
      embedding,
      createdAt: now,
      updatedAt: now
    };

    await this.backend.insertNode(node);

    // Create edge to linkTo node if provided (or auto-linked for root namespaces)
    if (effectiveLinkTo) {
      await this.createEdge({
        source: nodeId,
        target: effectiveLinkTo,
        type: 'linked_to'
      });
    }

    return nodeId;
  }

  /**
   * Get a node by ID
   */
  async getNode(id: NodeID): Promise<INode> {
    const node = await this.backend.getNode(id);
    if (!node) {
      throw new NodeNotFoundError(id);
    }
    return node;
  }

  /**
   * Update node properties
   */
  async updateNode(id: NodeID, properties: Record<string, unknown>): Promise<void> {
    const node = await this.getNode(id); // Throws if not found

    await this.backend.updateNode(id, {
      properties: { ...node.properties, ...properties }
    });
  }

  /**
   * Update node embedding
   */
  async updateEmbedding(id: NodeID, embedding: number[]): Promise<void> {
    if (this.options.validateDimensions) {
      if (embedding.length !== this.options.expectedDimensions) {
        throw new GraphDimensionMismatchError(
          this.options.expectedDimensions,
          embedding.length,
          'GraphDB.updateEmbedding'
        );
      }
    }

    await this.backend.updateNode(id, { embedding });
  }

  /**
   * Create a binary edge between two nodes
   */
  async createEdge(options: CreateEdgeOptions): Promise<EdgeID> {
    const { source, target, type, metadata } = options;

    // Verify both nodes exist
    const sourceExists = await this.backend.nodeExists(source);
    const targetExists = await this.backend.nodeExists(target);

    if (!sourceExists) throw new NodeNotFoundError(source);
    if (!targetExists) throw new NodeNotFoundError(target);

    const edgeId = randomUUID() as EdgeID;

    const edge: IEdge = {
      id: edgeId,
      source,
      target,
      type,
      metadata,
      createdAt: Date.now()
    };

    await this.backend.insertEdge(edge);
    return edgeId;
  }

  /**
   * Get edges connected to a node
   */
  async getEdges(nodeId: NodeID, direction: QueryDirection = QueryDirection.Both): Promise<QueryResult<IEdge>> {
    const startTime = Date.now();

    // Verify node exists
    await this.getNode(nodeId); // Throws if not found

    const edges = await this.backend.getEdges(nodeId, direction);
    const executionTimeMs = Date.now() - startTime;

    return {
      data: edges,
      count: edges.length,
      executionTimeMs
    };
  }

  /**
   * Create a hyperedge connecting 3+ nodes
   */
  async createHyperedge(options: CreateHyperedgeOptions): Promise<HyperedgeID> {
    const { nodes, type, metadata } = options;

    // Validate hyperedge constraint (3+ nodes)
    if (nodes.length < 3) {
      throw new InvalidHyperedgeError(nodes.length);
    }

    // Verify all nodes exist
    for (const nodeId of nodes) {
      const exists = await this.backend.nodeExists(nodeId);
      if (!exists) {
        throw new NodeNotFoundError(nodeId);
      }
    }

    const hyperedgeId = randomUUID() as HyperedgeID;

    const hyperedge: IHyperedge = {
      id: hyperedgeId,
      nodes,
      type,
      metadata,
      createdAt: Date.now()
    };

    await this.backend.insertHyperedge(hyperedge);
    return hyperedgeId;
  }

  /**
   * Create a temporal hyperedge with expiration
   */
  async createTemporalHyperedge(options: CreateTemporalHyperedgeOptions): Promise<HyperedgeID> {
    const { nodes, type, metadata, expiresAt, granularity } = options;

    // Validate hyperedge constraint (3+ nodes)
    if (nodes.length < 3) {
      throw new InvalidHyperedgeError(nodes.length);
    }

    // Verify all nodes exist
    for (const nodeId of nodes) {
      const exists = await this.backend.nodeExists(nodeId);
      if (!exists) {
        throw new NodeNotFoundError(nodeId);
      }
    }

    const hyperedgeId = randomUUID() as HyperedgeID;
    const now = Date.now();

    const temporalHyperedge: ITemporalHyperedge = {
      id: hyperedgeId,
      nodes,
      type,
      metadata,
      createdAt: now,
      expiresAt,
      granularity,
      isExpired: expiresAt <= now
    };

    await this.backend.insertHyperedge(temporalHyperedge);
    return hyperedgeId;
  }

  /**
   * Get hyperedge by ID
   */
  async getHyperedge(id: HyperedgeID): Promise<IHyperedge | ITemporalHyperedge> {
    const hyperedge = await this.backend.getHyperedge(id);
    if (!hyperedge) {
      throw new Error(`Hyperedge not found: ${id}`);
    }

    // Update isExpired for temporal hyperedges
    if (this.isTemporalHyperedge(hyperedge)) {
      hyperedge.isExpired = hyperedge.expiresAt <= Date.now();
    }

    return hyperedge;
  }

  /**
   * Get all hyperedges in the graph
   */
  async getAllHyperedges(): Promise<(IHyperedge | ITemporalHyperedge)[]> {
    const hyperedges = await this.backend.getAllHyperedges();

    // Update isExpired for temporal hyperedges
    const now = Date.now();
    hyperedges.forEach(h => {
      if (this.isTemporalHyperedge(h)) {
        h.isExpired = h.expiresAt <= now;
      }
    });

    return hyperedges;
  }

  /**
   * Get hyperedges connected to a node
   */
  async getHyperedgesByNode(nodeId: NodeID): Promise<QueryResult<IHyperedge | ITemporalHyperedge>> {
    const startTime = Date.now();

    // Verify node exists
    await this.getNode(nodeId); // Throws if not found

    const hyperedges = await this.backend.getHyperedgesByNode(nodeId);

    // Update isExpired for temporal hyperedges
    const now = Date.now();
    hyperedges.forEach(h => {
      if (this.isTemporalHyperedge(h)) {
        h.isExpired = h.expiresAt <= now;
      }
    });

    const executionTimeMs = Date.now() - startTime;

    return {
      data: hyperedges,
      count: hyperedges.length,
      executionTimeMs
    };
  }

  /**
   * Validate graph integrity
   * Returns report with orphan nodes, invalid hyperedges, expired temporal edges, etc.
   */
  async validateIntegrity(): Promise<IIntegrityReport> {
    const nodes = await this.backend.getAllNodes();
    const edges = await this.backend.getAllEdges();
    const hyperedges = await this.backend.getAllHyperedges();

    const orphanNodes: NodeID[] = [];
    const invalidHyperedges: HyperedgeID[] = [];
    const expiredTemporalHyperedges: HyperedgeID[] = [];
    const dimensionMismatches: NodeID[] = [];

    const now = Date.now();

    // Check for orphan nodes (no edges or hyperedges)
    for (const node of nodes) {
      const hasEdge = edges.some(e => e.source === node.id || e.target === node.id);
      const hasHyperedge = hyperedges.some(h => h.nodes.includes(node.id));

      if (!hasEdge && !hasHyperedge && nodes.length > 1) {
        orphanNodes.push(node.id);
      }

      // Check embedding dimensions
      if (node.embedding && this.options.validateDimensions) {
        if (node.embedding.length !== this.options.expectedDimensions) {
          dimensionMismatches.push(node.id);
        }
      }
    }

    // Check for invalid hyperedges (< 3 nodes)
    for (const hyperedge of hyperedges) {
      if (hyperedge.nodes.length < 3) {
        invalidHyperedges.push(hyperedge.id);
      }

      // Check for expired temporal hyperedges
      if (this.isTemporalHyperedge(hyperedge)) {
        if (hyperedge.expiresAt <= now) {
          expiredTemporalHyperedges.push(hyperedge.id);
        }
      }
    }

    const isValid =
      orphanNodes.length === 0 &&
      invalidHyperedges.length === 0 &&
      dimensionMismatches.length === 0;

    return {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      totalHyperedges: hyperedges.length,
      orphanNodes,
      invalidHyperedges,
      expiredTemporalHyperedges,
      dimensionMismatches,
      isValid,
      timestamp: now
    };
  }

  /**
   * Perform multi-hop traversal (for future query implementation)
   */
  async traverseHops(startNodeId: NodeID, hops: number): Promise<QueryResult<NodeID>> {
    const startTime = Date.now();
    const visited = new Set<NodeID>();
    const queue: { nodeId: NodeID; depth: number }[] = [{ nodeId: startNodeId, depth: 0 }];

    // Verify start node exists
    await this.getNode(startNodeId); // Throws if not found

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.depth > hops) break;
      if (visited.has(current.nodeId)) continue;

      visited.add(current.nodeId);

      if (current.depth < hops) {
        // Get connected nodes via edges
        const outgoingEdges = await this.backend.getEdges(current.nodeId, QueryDirection.Outgoing);
        for (const edge of outgoingEdges) {
          if (!visited.has(edge.target)) {
            queue.push({ nodeId: edge.target, depth: current.depth + 1 });
          }
        }

        const incomingEdges = await this.backend.getEdges(current.nodeId, QueryDirection.Incoming);
        for (const edge of incomingEdges) {
          if (!visited.has(edge.source)) {
            queue.push({ nodeId: edge.source, depth: current.depth + 1 });
          }
        }

        // Get connected nodes via hyperedges
        const hyperedges = await this.backend.getHyperedgesByNode(current.nodeId);
        for (const hyperedge of hyperedges) {
          for (const nodeId of hyperedge.nodes) {
            if (!visited.has(nodeId)) {
              queue.push({ nodeId, depth: current.depth + 1 });
            }
          }
        }
      }
    }

    const executionTimeMs = Date.now() - startTime;

    return {
      data: Array.from(visited),
      count: visited.size,
      executionTimeMs
    };
  }

  /**
   * Get the total number of nodes in the graph
   */
  async nodeCount(): Promise<number> {
    const nodes = await this.backend.getAllNodes();
    return nodes.length;
  }

  /**
   * Get the total number of edges in the graph
   */
  async edgeCount(): Promise<number> {
    const edges = await this.backend.getAllEdges();
    return edges.length;
  }

  /**
   * Clear all data
   */
  async clear(): Promise<void> {
    await this.backend.clear();
  }

  // ============================================================================
  // NEW PUBLIC API METHODS (SPEC-TYP-001)
  // ============================================================================

  /**
   * Query nodes with flexible filtering
   * @param filter - Node filter criteria
   * @returns Array of matching node data
   */
  async queryNodes(filter: INodeFilter): Promise<INodeData[]> {
    let nodes = await this.backend.getAllNodes();

    // Convert INode to INodeData format
    let nodeData: INodeData[] = nodes.map(node => ({
      id: node.id,
      key: (node.properties.key as string) || '',
      namespace: node.properties.namespace as string | undefined,
      vectorId: node.properties.vectorId as string | undefined,
      metadata: node.properties.metadata as Record<string, unknown> | undefined,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt
    }));

    // Apply filters
    if (filter.namespace) {
      nodeData = nodeData.filter(n => n.namespace === filter.namespace);
    }

    if (filter.keyPattern) {
      const regex = new RegExp(filter.keyPattern);
      nodeData = nodeData.filter(n => regex.test(n.key));
    }

    if (filter.createdAfter) {
      nodeData = nodeData.filter(n => n.createdAt > filter.createdAfter!);
    }

    if (filter.createdBefore) {
      nodeData = nodeData.filter(n => n.createdAt < filter.createdBefore!);
    }

    if (filter.hasVectorId !== undefined) {
      nodeData = nodeData.filter(n =>
        filter.hasVectorId ? !!n.vectorId : !n.vectorId
      );
    }

    // Apply pagination
    if (filter.offset) {
      nodeData = nodeData.slice(filter.offset);
    }

    if (filter.limit) {
      nodeData = nodeData.slice(0, filter.limit);
    }

    return nodeData;
  }

  /**
   * Get a single node by ID
   * @param nodeId - Node ID to retrieve
   * @returns Node data or null if not found
   */
  async getNodeById(nodeId: string): Promise<INodeData | null> {
    const node = await this.backend.getNode(nodeId as NodeID);
    if (!node) {
      return null;
    }

    return {
      id: node.id,
      key: (node.properties.key as string) || '',
      namespace: node.properties.namespace as string | undefined,
      vectorId: node.properties.vectorId as string | undefined,
      metadata: node.properties.metadata as Record<string, unknown> | undefined,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt
    };
  }

  /**
   * Get a node by key and optional namespace
   * @param key - Node key to search for
   * @param namespace - Optional namespace to filter by
   * @returns Node data or null if not found
   */
  async getNodeByKey(key: string, namespace?: string): Promise<INodeData | null> {
    const nodes = await this.queryNodes({
      keyPattern: `^${this.escapeRegex(key)}$`,
      namespace
    });
    return nodes[0] || null;
  }

  /**
   * Get all nodes in a namespace
   * @param namespace - Namespace to filter by
   * @returns Array of node data in the namespace
   */
  async getNodesByNamespace(namespace: string): Promise<INodeData[]> {
    return this.queryNodes({ namespace });
  }

  /**
   * Get all nodes in the database
   * Use sparingly - prefer queryNodes with filters for large datasets
   * @returns Array of all node data
   */
  async getAllNodes(): Promise<INodeData[]> {
    return this.queryNodes({});
  }

  /**
   * Query edges with flexible filtering
   * @param filter - Edge filter criteria
   * @returns Array of matching edge data
   */
  async queryEdges(filter: IEdgeFilter): Promise<IEdgeData[]> {
    let edges = await this.backend.getAllEdges();

    // Apply filters
    if (filter.nodeId) {
      edges = edges.filter(e =>
        e.source === filter.nodeId || e.target === filter.nodeId
      );
    }

    if (filter.type) {
      edges = edges.filter(e => e.type === filter.type);
    }

    // Convert to IEdgeData format
    return edges.map(edge => ({
      id: edge.id,
      type: edge.type,
      nodeIds: [edge.source, edge.target],
      weight: edge.metadata?.weight as number | undefined,
      metadata: edge.metadata,
      createdAt: edge.createdAt
    }));
  }

  /**
   * Get a single edge by ID
   * @param edgeId - Edge ID to retrieve
   * @returns Edge data or null if not found
   */
  async getEdgeById(edgeId: string): Promise<IEdgeData | null> {
    const edge = await this.backend.getEdge(edgeId as EdgeID);
    if (!edge) {
      return null;
    }

    return {
      id: edge.id,
      type: edge.type,
      nodeIds: [edge.source, edge.target],
      weight: edge.metadata?.weight as number | undefined,
      metadata: edge.metadata,
      createdAt: edge.createdAt
    };
  }

  /**
   * Get all edges connected to a node
   * @param nodeId - Node ID to get edges for
   * @returns Array of edge data
   */
  async getEdgesForNode(nodeId: string): Promise<IEdgeData[]> {
    return this.queryEdges({ nodeId });
  }

  /**
   * Delete a node and all its connected edges
   * @param nodeId - Node ID to delete
   * @returns True if deleted, false if not found
   */
  async deleteNode(nodeId: string): Promise<boolean> {
    try {
      // Verify node exists
      const exists = await this.backend.nodeExists(nodeId as NodeID);
      if (!exists) {
        return false;
      }

      // Delete all connected edges first
      const edges = await this.getEdgesForNode(nodeId);
      for (const edge of edges) {
        await this.backend.deleteEdge(edge.id as EdgeID);
      }

      // Delete the node
      await this.backend.deleteNode(nodeId as NodeID);
      return true;
    } catch (error) {
      console.error(`Failed to delete node ${nodeId}:`, error);
      return false;
    }
  }

  /**
   * Delete an edge
   * @param edgeId - Edge ID to delete
   * @returns True if deleted, false if not found
   */
  async deleteEdge(edgeId: string): Promise<boolean> {
    try {
      const edge = await this.backend.getEdge(edgeId as EdgeID);
      if (!edge) {
        return false;
      }

      await this.backend.deleteEdge(edgeId as EdgeID);
      return true;
    } catch (error) {
      console.error(`Failed to delete edge ${edgeId}:`, error);
      return false;
    }
  }

  /**
   * Count nodes matching the filter
   * @param filter - Optional filter criteria
   * @returns Number of matching nodes
   */
  async countNodes(filter?: INodeFilter): Promise<number> {
    if (!filter) {
      const nodes = await this.backend.getAllNodes();
      return nodes.length;
    }
    const nodes = await this.queryNodes(filter);
    return nodes.length;
  }

  /**
   * Check if a node exists by key and optional namespace
   * @param key - Node key to check
   * @param namespace - Optional namespace to filter by
   * @returns True if node exists, false otherwise
   */
  async nodeExists(key: string, namespace?: string): Promise<boolean> {
    const node = await this.getNodeByKey(key, namespace);
    return node !== null;
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Escape special regex characters in a string
   * @param str - String to escape
   * @returns Escaped string safe for regex
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Type guard for temporal hyperedges
   */
  private isTemporalHyperedge(
    hyperedge: IHyperedge | ITemporalHyperedge
  ): hyperedge is ITemporalHyperedge {
    return 'expiresAt' in hyperedge && 'granularity' in hyperedge;
  }
}
