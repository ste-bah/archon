/**
 * GraphDB Backend Interface
 * Defines the storage contract for graph database implementations
 */

import type {
  NodeID,
  EdgeID,
  HyperedgeID,
  INode,
  IEdge,
  IHyperedge,
  ITemporalHyperedge,
  QueryDirection
} from './types.js';

/**
 * Backend storage interface for GraphDB
 * Implementations provide actual storage (in-memory, disk, etc.)
 */
export interface IGraphBackend {
  // Node Operations
  insertNode(node: INode): Promise<void>;
  getNode(id: NodeID): Promise<INode | null>;
  updateNode(id: NodeID, updates: Partial<INode>): Promise<void>;
  deleteNode(id: NodeID): Promise<void>;
  getAllNodes(): Promise<INode[]>;

  // Edge Operations
  insertEdge(edge: IEdge): Promise<void>;
  getEdge(id: EdgeID): Promise<IEdge | null>;
  getEdges(nodeId: NodeID, direction: QueryDirection): Promise<IEdge[]>;
  deleteEdge(id: EdgeID): Promise<void>;
  getAllEdges(): Promise<IEdge[]>;

  // Hyperedge Operations
  insertHyperedge(hyperedge: IHyperedge | ITemporalHyperedge): Promise<void>;
  getHyperedge(id: HyperedgeID): Promise<IHyperedge | ITemporalHyperedge | null>;
  getHyperedgesByNode(nodeId: NodeID): Promise<(IHyperedge | ITemporalHyperedge)[]>;
  deleteHyperedge(id: HyperedgeID): Promise<void>;
  getAllHyperedges(): Promise<(IHyperedge | ITemporalHyperedge)[]>;

  // Utility Operations
  nodeExists(id: NodeID): Promise<boolean>;
  clear(): Promise<void>;

  // Persistence Operations (optional)
  save?(): Promise<void>;
  load?(): Promise<void>;
}
