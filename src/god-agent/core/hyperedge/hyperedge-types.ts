/**
 * Hyperedge Type Definitions for Phase 4
 * TASK-HYPEREDGE-001, TASK-HYPEREDGE-002, TASK-HYPEREDGE-003
 *
 * Shared types for:
 * - Q&A Hyperedges (HYPEREDGE-001)
 * - Causal Chains (HYPEREDGE-001)
 * - Community Detection (HYPEREDGE-002)
 * - Anomaly Detection (HYPEREDGE-003)
 */

import type { NodeID, HyperedgeID } from '../graph-db/types.js';

// Re-export base types for use by other modules
export type { NodeID, HyperedgeID };

// ============================================================================
// Q&A Hyperedge Types (TASK-HYPEREDGE-001)
// ============================================================================

/**
 * Answer within a Q&A hyperedge
 * Constitution: HYPER-02 - quality threshold >= 0.7
 */
export interface QAAnswer {
  /** Answer text */
  text: string;
  /** Confidence score [0.0-1.0] */
  confidence: number;
  /** Evidence node IDs (sources, citations) */
  evidence: NodeID[];
}

/**
 * Q&A Hyperedge connecting question to multiple answers with evidence
 * Constitution: HYPER-01 - minimum 3 nodes (question + >=2 answers/evidence)
 */
export interface QAHyperedge {
  /** Hyperedge ID */
  id: HyperedgeID;
  /** Question data */
  question: {
    /** Question text */
    text: string;
    /** VECTOR_DIM (1536)-dimensional embedding for semantic search */
    embedding: Float32Array;
  };
  /** Array of answers with confidence and evidence */
  answers: QAAnswer[];
  /** Overall quality score [0.0-1.0] */
  quality: number;
  /** Creation timestamp (Unix ms) */
  timestamp: number;
  /** Source node IDs (all nodes connected by this hyperedge) */
  nodeIds: NodeID[];
}

/**
 * Q&A search result with ranking
 */
export interface QASearchResult {
  /** Q&A hyperedge */
  hyperedge: QAHyperedge;
  /** Similarity score to query */
  similarity: number;
  /** Rank in search results (1-based) */
  rank: number;
}

// ============================================================================
// Causal Chain Types (TASK-HYPEREDGE-001)
// ============================================================================

/**
 * Node in a causal chain representing an event or state
 */
export interface CausalNode {
  /** Node ID */
  id: NodeID;
  /** Event description */
  event: string;
  /** Event timestamp (Unix ms) */
  timestamp: number;
  /** IDs of causal predecessors (causes) */
  causes: NodeID[];
  /** IDs of causal successors (effects) */
  effects: NodeID[];
}

/**
 * Causal edge with strength metric
 */
export interface CausalEdge {
  /** Source node (cause) */
  from: NodeID;
  /** Target node (effect) */
  to: NodeID;
  /** Causal strength [0.0-1.0] */
  strength: number;
}

/**
 * Causal chain - directed acyclic graph of cause-effect relationships
 * Constitution: HYPER-05 - must detect loops via DFS before creation
 */
export interface CausalChain {
  /** Chain ID */
  id: string;
  /** Nodes in the chain */
  nodes: CausalNode[];
  /** Causal edges */
  edges: CausalEdge[];
  /** Creation timestamp (Unix ms) */
  timestamp: number;
  /** Whether this chain has been validated for cycles */
  validated: boolean;
}

/**
 * Detected causal loop (cycle) in a chain
 */
export interface CausalLoop {
  /** Loop ID */
  id: string;
  /** Node IDs forming the cycle */
  nodes: NodeID[];
  /** Chain ID where loop was detected */
  chainId: string;
  /** Detection timestamp (Unix ms) */
  timestamp: number;
}

/**
 * Root cause analysis result
 */
export interface RootCauseResult {
  /** Root cause node */
  rootNode: CausalNode;
  /** Confidence in this being the root cause [0.0-1.0] */
  confidence: number;
  /** Traversal path from effect to root */
  path: NodeID[];
  /** Traversal depth */
  depth: number;
}

// ============================================================================
// Community Detection Types (TASK-HYPEREDGE-002)
// ============================================================================

/**
 * Community (cluster) of related nodes
 * Constitution: HYPER-08 - minimum 3 members
 */
export interface Community {
  /** Community ID */
  id: string;
  /** Node IDs in this community */
  members: NodeID[];
  /** Community cohesion score [0.0-1.0] */
  cohesion: number;
  /** Community detection algorithm used */
  algorithm: 'louvain' | 'label-propagation';
  /** Detection timestamp (Unix ms) */
  timestamp: number;
  /** Optional: Community label/description */
  label?: string;
}

/**
 * Community detection result
 */
export interface CommunityDetectionResult {
  /** Detected communities */
  communities: Community[];
  /** Modularity score of the partition [0.0-1.0] */
  modularity: number;
  /** Algorithm execution time (ms) */
  executionTime: number;
  /** Number of iterations (for iterative algorithms) */
  iterations?: number;
}

// ============================================================================
// Anomaly Detection Types (TASK-HYPEREDGE-003)
// ============================================================================

/**
 * Anomaly detection result for a single node/hyperedge
 * Constitution: HYPER-10 - alerts require confidence >= 0.8
 */
export interface AnomalyResult {
  /** Entity ID (node or hyperedge) */
  entityId: string;
  /** Entity type */
  entityType: 'node' | 'hyperedge';
  /** Anomaly score (higher = more anomalous) */
  score: number;
  /** Confidence that this is a true anomaly [0.0-1.0] */
  confidence: number;
  /** Detection algorithm used */
  algorithm: 'lof' | 'isolation-forest' | 'statistical';
  /** Detection timestamp (Unix ms) */
  timestamp: number;
  /** Anomaly description/reason */
  reason?: string;
  /** Neighboring normal entities for comparison */
  neighbors?: string[];
}

/**
 * Anomaly detection configuration
 */
export interface AnomalyDetectionConfig {
  /** Detection algorithm */
  algorithm: 'lof' | 'isolation-forest' | 'statistical';
  /** Minimum confidence for alerts (default: 0.8) */
  minConfidence?: number;
  /** Number of neighbors for LOF (default: 10) */
  kNeighbors?: number;
  /** Contamination factor [0.0-0.5] (default: 0.1) */
  contamination?: number;
}

// ============================================================================
// Shared Utility Types
// ============================================================================

/**
 * Graph traversal options
 */
export interface TraversalOptions {
  /** Maximum depth to traverse */
  maxDepth: number;
  /** Direction of traversal */
  direction?: 'forward' | 'backward' | 'both';
  /** Maximum nodes to visit (prevent explosion) */
  maxNodes?: number;
}

/**
 * Quality validation result
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Quality score [0.0-1.0] */
  score: number;
  /** Validation errors (if any) */
  errors: string[];
  /** Validation warnings */
  warnings: string[];
}

/**
 * Options for creating hyperedges
 */
export interface HyperedgeCreateOptions {
  /** Validate before creation */
  validate?: boolean;
  /** Emit observability events */
  emitEvents?: boolean;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}
