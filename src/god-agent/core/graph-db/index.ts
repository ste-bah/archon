/**
 * GraphDB Module
 * Hypergraph database with temporal features and embedding validation
 */

// Main GraphDB class
export { GraphDB } from './graph-db.js';

// Backend interface (type-only export for ESM compatibility)
export type { IGraphBackend } from './graph-backend.js';

// Backend class (value export)
export { FallbackGraph } from './fallback-graph.js';

// Types
export type {
  NodeID,
  EdgeID,
  HyperedgeID,
  INode,
  IEdge,
  IHyperedge,
  ITemporalHyperedge,
  GraphDBOptions,
  CreateNodeOptions,
  CreateEdgeOptions,
  CreateHyperedgeOptions,
  CreateTemporalHyperedgeOptions,
  QueryResult,
  IIntegrityReport
} from './types.js';

export { Granularity, QueryDirection } from './types.js';

// Alias for compatibility
export type { GraphDBOptions as GraphDBConfig } from './types.js';

// Errors
export {
  NodeNotFoundError,
  InvalidHyperedgeError,
  OrphanNodeError,
  GraphDimensionMismatchError
} from './errors.js';
