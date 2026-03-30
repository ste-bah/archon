/**
 * Graph Service - IPC wrapper for GraphDB
 * TASK-DAEMON-003: Service Registry & Integration
 *
 * Exposes graph database operations via JSON-RPC 2.0
 */

import type { GraphDB } from '../../graph-db/graph-db.js';
import type { NodeID, CreateNodeOptions, CreateEdgeOptions } from '../../graph-db/types.js';
import { createServiceHandler, type ServiceHandler } from '../service-registry.js';

/**
 * Graph service parameters
 */
export interface IGraphAddNodeParams {
  type: string;
  properties?: Record<string, unknown>;
  embedding?: number[];
  linkTo?: string;
}

export interface IGraphGetNodeParams {
  id: string;
}

export interface IGraphAddEdgeParams {
  source: string;
  target: string;
  type: string;
  metadata?: Record<string, unknown>;
}

export interface IGraphQueryParams {
  namespace?: string;
  keyPattern?: string;
  limit?: number;
}

export interface IGraphTraverseParams {
  startNodeId: string;
  depth: number;
}

/**
 * Create graph service handler
 *
 * @param graphDB - GraphDB instance
 * @returns Service handler with method map
 */
export function createGraphService(graphDB: GraphDB): ServiceHandler {
  return createServiceHandler({
    /**
     * Add node to graph
     */
    addNode: async (params: IGraphAddNodeParams) => {
      const { type, properties = {}, embedding, linkTo } = params;
      if (!type) {
        throw new Error('type is required');
      }

      const options: CreateNodeOptions = {
        type,
        properties,
        linkTo: linkTo as NodeID | undefined,
      };

      // Add embedding if provided (already in number[] format)
      if (embedding) {
        options.embedding = embedding;
      }

      const nodeId = await graphDB.createNode(options);
      return { nodeId };
    },

    /**
     * Get node by ID
     */
    getNode: async (params: IGraphGetNodeParams) => {
      const { id } = params;
      if (!id) {
        throw new Error('id is required');
      }
      const node = await graphDB.getNodeById(id);
      return node || { found: false };
    },

    /**
     * Add edge between nodes
     */
    addEdge: async (params: IGraphAddEdgeParams) => {
      const { source, target, type, metadata } = params;
      if (!source || !target || !type) {
        throw new Error('source, target, and type are required');
      }

      const options: CreateEdgeOptions = {
        source: source as NodeID,
        target: target as NodeID,
        type,
        metadata,
      };

      const edgeId = await graphDB.createEdge(options);
      return { edgeId };
    },

    /**
     * Query nodes with filters
     */
    query: async (params: IGraphQueryParams) => {
      const nodes = await graphDB.queryNodes(params);
      return { nodes };
    },

    /**
     * Traverse graph with N hops
     */
    traverse: async (params: IGraphTraverseParams) => {
      const { startNodeId, depth } = params;
      if (!startNodeId || depth === undefined) {
        throw new Error('startNodeId and depth are required');
      }
      const result = await graphDB.traverseHops(startNodeId as NodeID, depth);
      return {
        nodeIds: result.data,
        count: result.count,
        executionTimeMs: result.executionTimeMs,
      };
    },

    /**
     * Get graph statistics
     */
    stats: async () => {
      const nodeCount = await graphDB.nodeCount();
      const edgeCount = await graphDB.edgeCount();
      return { nodeCount, edgeCount };
    },

    /**
     * Clear all graph data
     */
    clear: async () => {
      await graphDB.clear();
      return { success: true };
    },
  });
}
