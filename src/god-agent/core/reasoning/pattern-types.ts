/**
 * Pattern Matching Type Definitions
 *
 * Implements: TASK-PAT-001 (Type Definitions)
 *
 * Defines types for template-based pattern retrieval with confidence scoring.
 */

/**
 * Task types for pattern categorization
 */
export enum TaskType {
  CODING = 'coding',
  DEBUGGING = 'debugging',
  ANALYSIS = 'analysis',
  REFACTORING = 'refactoring',
  TESTING = 'testing',
  DOCUMENTATION = 'documentation',
  PLANNING = 'planning',
  OPTIMIZATION = 'optimization'
}

/**
 * Core pattern structure representing a successful reasoning template
 */
export interface Pattern {
  /** Unique pattern identifier */
  id: string;

  /** Task category for this pattern */
  taskType: TaskType;

  /** Template text describing the reasoning approach */
  template: string;

  /** 1536D embedding vector (VECTOR_DIM, L2-normalized) */
  embedding: Float32Array;

  /** Success rate in range [0, 1] - minimum 0.8 for creation */
  successRate: number;

  /** SONA weight in range [0, 1] - confidence from SONA system */
  sonaWeight: number;

  /** Number of times this pattern has been used */
  usageCount: number;

  /** Pattern creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;

  /** Additional metadata for context */
  metadata?: Record<string, unknown>;
}

/**
 * Query parameters for pattern retrieval
 */
export interface PatternQuery {
  /** Filter by task type */
  taskType?: TaskType;

  /** Optional query text (will be embedded if no embedding provided) */
  query?: string;

  /** Optional pre-computed embedding (1536D, VECTOR_DIM) */
  embedding?: Float32Array;

  /** Number of top patterns to retrieve (default: 10) */
  topK?: number;

  /** Minimum confidence threshold [0, 1] */
  minConfidence?: number;

  /** Minimum success rate threshold [0, 1] */
  minSuccessRate?: number;

  /** Minimum SONA weight threshold [0, 1] */
  minSonaWeight?: number;
}

/**
 * Pattern search result with scoring metrics
 */
export interface PatternResult {
  /** The matched pattern */
  pattern: Pattern;

  /** Final confidence score [0, 1] = similarity × successRate × sonaWeight */
  confidence: number;

  /** Vector similarity to query [0, 1] */
  similarity: number;

  /** Rank position in results (1-based) */
  rank: number;
}

/**
 * Statistics about the pattern database
 */
export interface PatternStats {
  /** Total number of patterns stored */
  totalPatterns: number;

  /** Patterns per task type */
  patternsByType: Map<TaskType, number>;

  /** Average success rate across all patterns */
  averageSuccessRate: number;

  /** Average SONA weight across all patterns */
  averageSonaWeight: number;

  /** Total usage count across all patterns */
  totalUsageCount: number;

  /** Patterns with success rate >= 0.9 */
  highQualityPatterns: number;

  /** Patterns with success rate < 0.8 (should be pruned) */
  lowQualityPatterns: number;

  /** Most used pattern ID */
  mostUsedPatternId?: string;

  /** Highest success rate */
  highestSuccessRate: number;

  /** Database size in bytes (approximate) */
  storageSize: number;
}

/**
 * Parameters for creating a new pattern
 */
export interface CreatePatternParams {
  /** Task category */
  taskType: TaskType;

  /** Template text */
  template: string;

  /** 1536D embedding (VECTOR_DIM, L2-normalized) */
  embedding: Float32Array;

  /** Initial success rate (must be >= 0.8) */
  successRate: number;

  /** Initial SONA weight [0, 1] */
  sonaWeight?: number;

  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for updating pattern success
 */
export interface UpdateSuccessParams {
  /** Pattern ID to update */
  patternId: string;

  /** Whether the pattern usage was successful */
  success: boolean;
}

/**
 * Parameters for pruning low-quality patterns
 */
export interface PruneParams {
  /** Minimum success rate to keep (default: 0.8) */
  minSuccessRate?: number;

  /** Minimum usage count to keep (default: 5) */
  minUsageCount?: number;

  /** Dry run mode - return what would be pruned without deleting */
  dryRun?: boolean;
}

/**
 * Result from pruning operation
 */
export interface PruneResult {
  /** Number of patterns pruned */
  prunedCount: number;

  /** IDs of pruned patterns */
  prunedIds: string[];

  /** Remaining pattern count */
  remainingCount: number;
}
