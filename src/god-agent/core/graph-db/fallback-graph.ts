/**
 * Fallback Graph Backend
 * In-memory storage with JSON persistence
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as lockfile from 'proper-lockfile';
import type { IGraphBackend } from './graph-backend.js';
import {
  QueryDirection,
  type NodeID,
  type EdgeID,
  type HyperedgeID,
  type INode,
  type IEdge,
  type IHyperedge,
  type ITemporalHyperedge
} from './types.js';

/**
 * FallbackGraph - In-memory graph storage with JSON persistence
 */
export class FallbackGraph implements IGraphBackend {
  private nodes: Map<NodeID, INode>;
  private edges: Map<EdgeID, IEdge>;
  private hyperedges: Map<HyperedgeID, IHyperedge | ITemporalHyperedge>;
  private dataDir: string;
  private dataFile: string;
  private lockTimeout: number;
  private enablePersistence: boolean;

  constructor(dataDir: string = '.agentdb/graphs', lockTimeout: number = 5000, enablePersistence: boolean = true) {
    this.nodes = new Map();
    this.edges = new Map();
    this.hyperedges = new Map();
    this.dataDir = dataDir;
    this.dataFile = path.join(dataDir, 'graph.json');
    this.lockTimeout = lockTimeout;
    this.enablePersistence = enablePersistence;
  }

  // Node Operations
  async insertNode(node: INode): Promise<void> {
    this.nodes.set(node.id, node);
    await this.save();
  }

  async getNode(id: NodeID): Promise<INode | null> {
    return this.nodes.get(id) || null;
  }

  async updateNode(id: NodeID, updates: Partial<INode>): Promise<void> {
    const node = this.nodes.get(id);
    if (!node) return;

    const updatedNode: INode = {
      ...node,
      ...updates,
      id: node.id, // Preserve ID
      updatedAt: Date.now()
    };

    this.nodes.set(id, updatedNode);
    await this.save();
  }

  async deleteNode(id: NodeID): Promise<void> {
    this.nodes.delete(id);
    await this.save();
  }

  async getAllNodes(): Promise<INode[]> {
    return Array.from(this.nodes.values());
  }

  async nodeExists(id: NodeID): Promise<boolean> {
    return this.nodes.has(id);
  }

  // Edge Operations
  async insertEdge(edge: IEdge): Promise<void> {
    this.edges.set(edge.id, edge);
    await this.save();
  }

  async getEdge(id: EdgeID): Promise<IEdge | null> {
    return this.edges.get(id) || null;
  }

  async getEdges(nodeId: NodeID, direction: QueryDirection): Promise<IEdge[]> {
    const edges = Array.from(this.edges.values());

    switch (direction) {
      case QueryDirection.Incoming:
        return edges.filter(e => e.target === nodeId);
      case QueryDirection.Outgoing:
        return edges.filter(e => e.source === nodeId);
      case QueryDirection.Both:
        return edges.filter(e => e.source === nodeId || e.target === nodeId);
      default:
        return [];
    }
  }

  async deleteEdge(id: EdgeID): Promise<void> {
    this.edges.delete(id);
    await this.save();
  }

  async getAllEdges(): Promise<IEdge[]> {
    return Array.from(this.edges.values());
  }

  // Hyperedge Operations
  async insertHyperedge(hyperedge: IHyperedge | ITemporalHyperedge): Promise<void> {
    this.hyperedges.set(hyperedge.id, hyperedge);
    await this.save();
  }

  async getHyperedge(id: HyperedgeID): Promise<IHyperedge | ITemporalHyperedge | null> {
    return this.hyperedges.get(id) || null;
  }

  async getHyperedgesByNode(nodeId: NodeID): Promise<(IHyperedge | ITemporalHyperedge)[]> {
    return Array.from(this.hyperedges.values()).filter(h => h.nodes.includes(nodeId));
  }

  async deleteHyperedge(id: HyperedgeID): Promise<void> {
    this.hyperedges.delete(id);
    await this.save();
  }

  async getAllHyperedges(): Promise<(IHyperedge | ITemporalHyperedge)[]> {
    return Array.from(this.hyperedges.values());
  }

  // Utility Operations
  async clear(): Promise<void> {
    this.nodes.clear();
    this.edges.clear();
    this.hyperedges.clear();
    await this.save();
  }

  // Persistence Operations
  async save(): Promise<void> {
    if (!this.enablePersistence) return;

    try {
      // Ensure directory exists
      await fs.mkdir(this.dataDir, { recursive: true });

      // Convert Maps to objects for JSON serialization
      const data = {
        nodes: Object.fromEntries(this.nodes),
        edges: Object.fromEntries(this.edges),
        hyperedges: Object.fromEntries(this.hyperedges),
        version: '1.0.0',
        timestamp: Date.now()
      };

      const jsonData = JSON.stringify(data, null, 2);

      // Acquire lock and write
      let release: (() => Promise<void>) | null = null;
      try {
        // Check if file exists, create if not
        try {
          await fs.access(this.dataFile);
        } catch {
          // INTENTIONAL: File doesn't exist - create new empty graph file
          await fs.writeFile(this.dataFile, '{}', 'utf-8');
        }

        release = await lockfile.lock(this.dataFile, {
          retries: {
            retries: 5,
            minTimeout: 100,
            maxTimeout: this.lockTimeout
          }
        });

        await fs.writeFile(this.dataFile, jsonData, 'utf-8');
      } finally {
        if (release) await release();
      }
    } catch (error) {
      // Silent fail for persistence errors - in-memory data remains intact
      console.warn('Failed to persist graph data:', error);
    }
  }

  async load(): Promise<void> {
    if (!this.enablePersistence) return;

    try {
      // Check if file exists
      try {
        await fs.access(this.dataFile);
      } catch {
        // INTENTIONAL: File doesn't exist, nothing to load - start with empty graph
        return;
      }

      // Acquire lock and read
      let release: (() => Promise<void>) | null = null;
      try {
        release = await lockfile.lock(this.dataFile, {
          retries: {
            retries: 5,
            minTimeout: 100,
            maxTimeout: this.lockTimeout
          }
        });

        const jsonData = await fs.readFile(this.dataFile, 'utf-8');
        const data = JSON.parse(jsonData);

        // Convert objects back to Maps
        this.nodes = new Map(Object.entries(data.nodes || {})) as Map<NodeID, INode>;
        this.edges = new Map(Object.entries(data.edges || {})) as Map<EdgeID, IEdge>;
        this.hyperedges = new Map(Object.entries(data.hyperedges || {})) as Map<HyperedgeID, IHyperedge | ITemporalHyperedge>;
      } finally {
        if (release) await release();
      }
    } catch (error) {
      // Silent fail for load errors - start with empty graph
      console.warn('Failed to load graph data:', error);
      this.nodes.clear();
      this.edges.clear();
      this.hyperedges.clear();
    }
  }
}
