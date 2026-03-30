/**
 * GraphDB Type Definitions
 * Provides types for hypergraph with temporal features
 */

// ID Types
export type NodeID = string; // UUID v4
export type EdgeID = string; // UUID v4
export type HyperedgeID = string; // UUID v4

// Temporal Granularity
export enum Granularity {
  Hourly = 'Hourly',
  Daily = 'Daily',
  Monthly = 'Monthly'
}

// Node Interface
export interface INode {
  id: NodeID;
  type: string;
  properties: Record<string, unknown>;
  embedding?: number[]; // Optional VECTOR_DIM (1536D) embedding
  createdAt: number; // Unix timestamp
  updatedAt: number;
}

// Edge Interface (binary relationship)
export interface IEdge {
  id: EdgeID;
  source: NodeID;
  target: NodeID;
  type: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

// Hyperedge Interface (n-ary relationship, n >= 3)
export interface IHyperedge {
  id: HyperedgeID;
  nodes: NodeID[]; // Must contain at least 3 nodes
  type: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

// Temporal Hyperedge Interface
export interface ITemporalHyperedge extends IHyperedge {
  expiresAt: number; // Unix timestamp
  granularity: Granularity;
  isExpired?: boolean; // Computed property
}

// Query Direction
export enum QueryDirection {
  Incoming = 'incoming',
  Outgoing = 'outgoing',
  Both = 'both'
}

// Query Result
export interface QueryResult<T = unknown> {
  data: T[];
  count: number;
  executionTimeMs: number;
}

// Integrity Report
export interface IIntegrityReport {
  totalNodes: number;
  totalEdges: number;
  totalHyperedges: number;
  orphanNodes: NodeID[];
  invalidHyperedges: HyperedgeID[]; // Hyperedges with < 3 nodes
  expiredTemporalHyperedges: HyperedgeID[];
  dimensionMismatches: NodeID[]; // Nodes with embeddings != VECTOR_DIM (1536D)
  isValid: boolean;
  timestamp: number;
}

// GraphDB Options
export interface GraphDBOptions {
  dataDir?: string; // Directory for persistence (default: .agentdb/graphs)
  enablePersistence?: boolean; // Enable JSON file persistence
  lockTimeout?: number; // File lock timeout in ms (default: 5000)
  validateDimensions?: boolean; // Validate embedding dimensions (default: true)
  expectedDimensions?: number; // Expected embedding dimensions (default: VECTOR_DIM = 1536)
}

// Node Creation Options
export interface CreateNodeOptions {
  type: string;
  properties?: Record<string, unknown>;
  embedding?: number[];
  linkTo?: NodeID; // Required for non-orphan enforcement
}

// Edge Creation Options
export interface CreateEdgeOptions {
  source: NodeID;
  target: NodeID;
  type: string;
  metadata?: Record<string, unknown>;
}

// Hyperedge Creation Options
export interface CreateHyperedgeOptions {
  nodes: NodeID[];
  type: string;
  metadata?: Record<string, unknown>;
}

// Temporal Hyperedge Creation Options
export interface CreateTemporalHyperedgeOptions extends CreateHyperedgeOptions {
  expiresAt: number;
  granularity: Granularity;
}
