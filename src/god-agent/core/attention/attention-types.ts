/**
 * Attention Type Definitions
 * TASK-ATT-001 - Attention Factory Auto-Selection
 *
 * Provides types for automatic attention mechanism selection:
 * - IDataProfile for input characterization
 * - AttentionCapabilities for mechanism features
 * - ComplexityClass for computational costs
 * - 39+ attention mechanism descriptors
 *
 * Target: <1ms selection overhead, 95%+ correct mechanism selection
 */

// ==================== Core Types ====================

/**
 * Data profile from MemoryEngine (compatible with TASK-MEM-001)
 */
export interface IDataProfile {
  /** Number of tokens/items in sequence */
  sequenceLength: number;
  /** Maximum nesting level (0 = flat) */
  hierarchyDepth: number;
  /** True if graph connectivity detected */
  hasGraphStructure: boolean;
  /** Maximum acceptable latency (ms) */
  latencyBudget: number;
  /** Fraction of non-zero attention weights (0-1) */
  sparsity?: number;
  /** Number of sequences in batch */
  batchSize?: number;
  /** Maximum memory usage (MB) */
  memoryBudget?: number;
}

/**
 * Complexity class for attention mechanisms
 */
export enum ComplexityClass {
  LINEAR = 'O(N)',           // e.g., Linear attention
  LINEARITHMIC = 'O(N log N)', // e.g., Reformer
  QUADRATIC = 'O(N²)',        // e.g., Standard attention
  SUBQUADRATIC = 'O(N√N)',    // e.g., Sparse attention
}

/**
 * Capability flags for attention mechanisms
 */
export interface IAttentionCapabilities {
  /** Efficient for >10k tokens */
  supportsLongContext: boolean;
  /** Handles nested structures */
  supportsHierarchy: boolean;
  /** Handles graph connectivity */
  supportsGraphs: boolean;
  /** Exploits sparse patterns */
  supportsSparsity: boolean;
  /** Needs preprocessing step */
  requiresPrecomputation: boolean;
}

/**
 * Performance characteristics
 */
export interface IPerformanceProfile {
  /** Computational complexity */
  complexity: ComplexityClass;
  /** Typical latency for 1k tokens (ms) */
  avgLatencyMs: number;
  /** Memory overhead per 1k tokens (MB) */
  memoryUsageMB: number;
  /** Can leverage GPU/multi-core */
  parallelizable: boolean;
}

/**
 * Base interface for all attention mechanisms
 */
export interface IAttentionMechanism {
  /** Mechanism name */
  readonly name: string;

  /**
   * Compute attention weights
   * @param query - Query vectors [batch, seqLen, dim]
   * @param key - Key vectors [batch, seqLen, dim]
   * @param value - Value vectors [batch, seqLen, dim]
   * @param mask - Optional attention mask
   * @returns Attention output [batch, seqLen, dim]
   */
  forward(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    mask?: boolean[]
  ): Float32Array;

  /**
   * Get number of parameters
   */
  getParameterCount(): number;
}

/**
 * Factory function type for creating attention mechanisms
 */
export type AttentionMechanismFactory = (config?: Record<string, unknown>) => IAttentionMechanism;

/**
 * Registered attention mechanism descriptor
 */
export interface IAttentionMechanismDescriptor {
  /** Unique identifier */
  name: string;
  /** Display name for UI */
  displayName: string;
  /** Brief description */
  description: string;
  /** Capability flags */
  capabilities: IAttentionCapabilities;
  /** Performance characteristics */
  performance: IPerformanceProfile;
  /** Ordered list of fallback mechanisms */
  fallbacks: string[];
  /** Factory function to create instance */
  factory: AttentionMechanismFactory;
}

/**
 * Selection result with rationale
 */
export interface ISelectionResult {
  /** Selected mechanism name */
  mechanismName: string;
  /** Human-readable explanation */
  rationale: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Ordered fallback chain */
  fallbackChain: string[];
}

// ==================== Configuration ====================

/**
 * Selection rule thresholds (configurable)
 */
export interface ISelectionThresholds {
  /** Sequence length threshold for Flash attention */
  longSequenceThreshold: number;
  /** Hierarchy depth threshold for Hyperbolic attention */
  hierarchyDepthThreshold: number;
  /** Latency threshold for Linear attention (ms) */
  strictLatencyThreshold: number;
  /** Sequence length threshold for sparse attention */
  mediumSequenceThreshold: number;
  /** Sparsity threshold for BigBird */
  sparsityThreshold: number;
  /** Hierarchy + graph threshold for DualSpace */
  dualSpaceHierarchyThreshold: number;
}

/**
 * Default selection thresholds
 */
export const DEFAULT_SELECTION_THRESHOLDS: ISelectionThresholds = {
  longSequenceThreshold: 10000,
  hierarchyDepthThreshold: 3,
  strictLatencyThreshold: 1.0,
  mediumSequenceThreshold: 4096,
  sparsityThreshold: 0.5,
  dualSpaceHierarchyThreshold: 2,
};

/**
 * Attention factory configuration
 */
export interface IAttentionConfig {
  /** Selection thresholds */
  thresholds?: Partial<ISelectionThresholds>;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Default mixing weight for DualSpace */
  dualSpaceMixingWeight?: number;
}

/**
 * Default attention configuration
 */
export const DEFAULT_ATTENTION_CONFIG: Required<IAttentionConfig> = {
  thresholds: DEFAULT_SELECTION_THRESHOLDS,
  verbose: false,
  dualSpaceMixingWeight: 0.5,
};

// ==================== Error Types ====================

/**
 * Error thrown when attention mechanism operations fail
 */
export class AttentionError extends Error {
  constructor(
    message: string,
    public readonly code: 'UNKNOWN_MECHANISM' | 'CREATION_FAILED' | 'INVALID_CONFIG' | 'SELECTION_FAILED'
  ) {
    super(message);
    this.name = 'AttentionError';
  }
}

// ==================== Metrics ====================

/**
 * Selection metrics for observability
 */
export interface ISelectionMetrics {
  /** Operation type */
  operation: 'select_mechanism' | 'create_mechanism' | 'fallback_used';
  /** Selected mechanism name */
  selected: string;
  /** Confidence score */
  confidence: number;
  /** Selection duration (ms) */
  durationMs: number;
  /** Hash of input profile */
  profileHash: string;
  /** Timestamp */
  timestamp: number;
}

// ==================== Utility Functions ====================

/**
 * Default data profile for testing
 */
export function createDefaultDataProfile(): IDataProfile {
  return {
    sequenceLength: 512,
    hierarchyDepth: 0,
    hasGraphStructure: false,
    latencyBudget: 10,
    sparsity: 0,
    batchSize: 1,
    memoryBudget: 1000,
  };
}

/**
 * Create a hash of data profile for caching/logging
 */
export function hashDataProfile(profile: IDataProfile): string {
  return `${profile.sequenceLength}_${profile.hierarchyDepth}_${profile.hasGraphStructure}_${profile.latencyBudget}`;
}
