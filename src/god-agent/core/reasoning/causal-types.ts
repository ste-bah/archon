/**
 * Type definitions for CausalMemory - hypergraph-based causal reasoning
 * Supports multi-cause relationships (A+B+C→D) with bidirectional traversal
 */

/**
 * Unique identifier for nodes and links
 */
export type NodeID = string;

/**
 * Type of causal node in the reasoning graph
 */
export type NodeType = 'concept' | 'action' | 'state';

/**
 * Direction for graph traversal
 */
export type TraversalDirection = 'forward' | 'backward';

/**
 * Node in the causal graph representing a concept, action, or state
 */
export interface CausalNode {
  /** Unique identifier */
  id: NodeID;
  /** Human-readable label */
  label: string;
  /** Type of node */
  type: NodeType;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** Creation timestamp */
  createdAt?: number;
  /** Last modification timestamp */
  updatedAt?: number;
}

/**
 * Hyperedge representing causal relationship(s)
 * Supports multi-cause relationships: {causes: [A, B, C]} → {effects: [D, E]}
 */
export interface CausalLink {
  /** Unique identifier for this link */
  id: string;
  /** Array of cause node IDs (supports multi-cause) */
  causes: NodeID[];
  /** Array of effect node IDs (supports multi-effect) */
  effects: NodeID[];
  /** Confidence in this causal relationship [0.0, 1.0] */
  confidence: number;
  /** Strength of causal influence [0.0, 1.0] */
  strength: number;
  /** Additional metadata (e.g., domain, source, evidence) */
  metadata?: Record<string, unknown>;
  /** Creation timestamp */
  createdAt?: number;
  /** Last modification timestamp */
  updatedAt?: number;
}

/**
 * Chain of causal links forming a reasoning path
 */
export interface CausalChain {
  /** Sequence of causal links from start to end */
  path: CausalLink[];
  /** Combined confidence (product of link confidences) */
  totalConfidence: number;
  /** Number of hops in the chain */
  hopCount: number;
  /** Human-readable explanation of the causal chain */
  explanation: string;
  /** Starting node IDs */
  startNodes: NodeID[];
  /** Ending node IDs */
  endNodes: NodeID[];
}

/**
 * Options for controlling graph traversal
 */
export interface TraversalOptions {
  /** Maximum depth to traverse (default: 5) */
  maxDepth?: number;
  /** Minimum confidence threshold for links [0.0, 1.0] (default: 0.0) */
  minConfidence?: number;
  /** Direction of traversal (default: 'forward') */
  direction?: TraversalDirection;
  /** Stop if cycle detected (default: true) */
  stopOnCycle?: boolean;
  /** Maximum number of chains to return (default: 100) */
  maxChains?: number;
  /** Minimum chain confidence threshold (default: 0.0) */
  minChainConfidence?: number;
}

/**
 * Result of forward causal inference (finding effects)
 */
export interface InferenceResult {
  /** Predicted effect node IDs */
  effects: NodeID[];
  /** Causal chains leading to each effect */
  chains: CausalChain[];
  /** Overall confidence in the inference */
  confidence: number;
  /** Warnings or issues encountered during inference */
  warnings: string[];
  /** Number of nodes explored */
  nodesExplored?: number;
  /** Traversal time in milliseconds */
  traversalTime?: number;
}

/**
 * Result of backward causal analysis (finding causes)
 */
export interface CauseFindingResult {
  /** Identified cause node IDs */
  causes: NodeID[];
  /** Causal chains leading from each cause */
  chains: CausalChain[];
  /** Overall confidence in the identified causes */
  confidence: number;
  /** Warnings or issues encountered during analysis */
  warnings: string[];
  /** Number of nodes explored */
  nodesExplored?: number;
  /** Traversal time in milliseconds */
  traversalTime?: number;
}

/**
 * Parameters for adding a new causal link
 */
export interface AddCausalLinkParams {
  /** Array of cause node IDs */
  causes: NodeID[];
  /** Array of effect node IDs */
  effects: NodeID[];
  /** Confidence in this relationship [0.0, 1.0] */
  confidence: number;
  /** Strength of causal influence [0.0, 1.0] */
  strength: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Statistics about the causal graph
 */
export interface CausalGraphStats {
  /** Total number of nodes */
  nodeCount: number;
  /** Total number of causal links */
  linkCount: number;
  /** Average confidence across all links */
  avgConfidence: number;
  /** Average strength across all links */
  avgStrength: number;
  /** Number of concept nodes */
  conceptCount: number;
  /** Number of action nodes */
  actionCount: number;
  /** Number of state nodes */
  stateCount: number;
  /** Average number of causes per link */
  avgCausesPerLink: number;
  /** Average number of effects per link */
  avgEffectsPerLink: number;
  /** Maximum chain length explored */
  maxChainLength?: number;
}

/**
 * Serialized format for persistence
 */
export interface SerializedCausalGraph {
  /** All nodes in the graph */
  nodes: CausalNode[];
  /** All links in the graph */
  links: CausalLink[];
  /** Metadata about the graph */
  metadata?: {
    version: string;
    createdAt: number;
    updatedAt: number;
    [key: string]: unknown;
  };
}

/**
 * Result of cycle detection check
 */
export interface CycleCheckResult {
  /** Whether adding the link would create a cycle */
  wouldCreateCycle: boolean;
  /** Path that would form the cycle (if any) */
  cyclePath?: NodeID[];
  /** Check duration in milliseconds */
  checkTime?: number;
}
