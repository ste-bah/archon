/**
 * Search Type Definitions for Quad-Fusion Unified Search
 * PRD: PRD-GOD-AGENT-001
 * Technical Spec: TECH-SEARCH-001
 */

// ============================================================================
// Source Types
// ============================================================================

/**
 * Search source identifiers
 */
export type SearchSource = 'vector' | 'graph' | 'memory' | 'pattern';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Source weight configuration
 */
export interface SourceWeights {
  /** Vector similarity weight (default: 0.4) */
  vector: number;

  /** Graph relationship weight (default: 0.3) */
  graph: number;

  /** Memory recency weight (default: 0.2) */
  memory: number;

  /** Pattern match weight (default: 0.1) */
  pattern: number;
}

/**
 * Quad-Fusion search options
 */
export interface QuadFusionOptions {
  /** Maximum results to return (default: 10, max: 100) */
  topK: number;

  /** Source weights (normalized to sum to 1.0) */
  weights: SourceWeights;

  /** Graph traversal depth (default: 2) */
  graphDepth: number;

  /** Minimum pattern confidence (default: 0.5) */
  minPatternConfidence: number;

  /** Memory namespace to search (default: 'default') */
  memoryNamespace: string;

  /** Per-source timeout in ms (default: 400) */
  sourceTimeoutMs: number;

  /** Include source attribution in results */
  includeAttribution: boolean;

  /** GNN enhancement options (optional) */
  gnnEnhancement?: {
    /** Enable GNN enhancement */
    enabled: boolean;
    /** Enhancement point in pipeline */
    point: 'pre_search' | 'post_search' | 'both';
    /** Graph depth for context */
    graphDepth: number;
    /** Enhancement timeout (ms) */
    timeout: number;
  };
}

/**
 * Default configuration values
 */
export const DEFAULT_OPTIONS: QuadFusionOptions = {
  topK: 10,
  weights: {
    vector: 0.4,
    graph: 0.3,
    memory: 0.2,
    pattern: 0.1
  },
  graphDepth: 2,
  minPatternConfidence: 0.5,
  memoryNamespace: 'default',
  sourceTimeoutMs: 400,
  includeAttribution: true
};

/**
 * Maximum allowed values
 */
export const MAX_TOP_K = 100;
export const MAX_GRAPH_DEPTH = 5;
export const MAX_SOURCE_TIMEOUT_MS = 500;

// ============================================================================
// Result Types
// ============================================================================

/**
 * Source attribution for a result
 */
export interface SourceAttribution {
  /** Source identifier */
  source: SearchSource;

  /** Original score from source */
  originalScore: number;

  /** Weighted contribution to final score */
  weightedScore: number;

  /** Source-specific metadata */
  sourceMetadata?: Record<string, unknown>;
}

/**
 * Individual fused result
 */
export interface FusedSearchResult {
  /** Unique result ID */
  id: string;

  /** Result content */
  content: string;

  /** Fused relevance score (0.0 to 1.0) */
  score: number;

  /** Content hash for deduplication (SHA-256, first 16 chars) */
  contentHash: string;

  /** Source attribution */
  sources: SourceAttribution[];

  /** Optional structured metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Search metadata
 */
export interface SearchMetadata {
  /** Total execution time in ms */
  totalDurationMs: number;

  /** Number of sources that responded */
  sourcesResponded: number;

  /** Number of sources that timed out */
  sourcesTimedOut: number;

  /** Number of results before deduplication */
  rawResultCount: number;

  /** Number of results after deduplication */
  dedupedResultCount: number;

  /** Correlation ID for tracing */
  correlationId: string;
}

/**
 * Individual source statistics
 */
export interface SourceStat {
  /** Whether source responded */
  responded: boolean;

  /** Execution time in ms */
  durationMs: number;

  /** Number of results returned */
  resultCount: number;

  /** Whether source timed out */
  timedOut: boolean;

  /** Error message if failed */
  error?: string;
}

/**
 * Per-source statistics
 */
export interface SourceStatistics {
  vector: SourceStat;
  graph: SourceStat;
  memory: SourceStat;
  pattern: SourceStat;
}

/**
 * Complete quad-fusion search result
 */
export interface QuadFusionResult {
  /** Search query */
  query: string;

  /** Fused results */
  results: FusedSearchResult[];

  /** Search metadata */
  metadata: SearchMetadata;

  /** Per-source statistics */
  sourceStats: SourceStatistics;
}

// ============================================================================
// Internal Types
// ============================================================================

/**
 * Raw result from a single source
 */
export interface RawSourceResult {
  /** Source identifier */
  source: SearchSource;

  /** Result ID */
  id: string;

  /** Content string */
  content: string;

  /** Source-specific score (0.0 to 1.0) */
  score: number;

  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Source execution success result
 */
export interface SourceSuccessResult {
  status: 'success';
  results: RawSourceResult[];
  durationMs: number;
}

/**
 * Source execution timeout result
 */
export interface SourceTimeoutResult {
  status: 'timeout';
  durationMs: number;
}

/**
 * Source execution error result
 */
export interface SourceErrorResult {
  status: 'error';
  error: string;
  durationMs: number;
}

/**
 * Source execution result (union type)
 */
export type SourceExecutionResult =
  | SourceSuccessResult
  | SourceTimeoutResult
  | SourceErrorResult;

/**
 * Aggregated results before fusion
 */
export interface AggregatedResults {
  /** All raw results from successful sources */
  rawResults: RawSourceResult[];

  /** Source execution outcomes */
  sourceOutcomes: Record<SearchSource, SourceExecutionResult>;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Search error codes
 */
export enum SearchErrorCode {
  // Input errors (1xx)
  INVALID_QUERY = 100,
  INVALID_EMBEDDING = 101,
  INVALID_OPTIONS = 102,
  QUERY_TOO_LONG = 103,

  // Source errors (2xx)
  ALL_SOURCES_FAILED = 200,
  VECTOR_SOURCE_ERROR = 201,
  GRAPH_SOURCE_ERROR = 202,
  MEMORY_SOURCE_ERROR = 203,
  PATTERN_SOURCE_ERROR = 204,

  // Fusion errors (3xx)
  FUSION_ERROR = 300,
  DEDUPLICATION_ERROR = 301,
  SCORING_ERROR = 302,

  // System errors (4xx)
  INITIALIZATION_ERROR = 400,
  CONFIGURATION_ERROR = 401,
  UNKNOWN_ERROR = 499
}

/**
 * Search error with context
 */
export interface SearchError extends Error {
  code: SearchErrorCode;
  context: Record<string, unknown>;
  recoverable: boolean;
}

/**
 * Create typed search error
 * @param code - Error code from SearchErrorCode enum
 * @param message - Human-readable error message
 * @param context - Additional context for debugging
 * @returns SearchError instance
 */
export function createSearchError(
  code: SearchErrorCode,
  message: string,
  context: Record<string, unknown> = {}
): SearchError {
  const error = new Error(message) as SearchError;
  error.code = code;
  error.context = context;
  error.recoverable = code < 300;
  return error;
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate search options
 * @param options - Partial options to validate
 * @throws SearchError if validation fails
 */
export function validateOptions(
  options: Partial<QuadFusionOptions>
): void {
  if (options.topK !== undefined) {
    if (options.topK < 1 || options.topK > MAX_TOP_K) {
      throw createSearchError(
        SearchErrorCode.INVALID_OPTIONS,
        `topK must be between 1 and ${MAX_TOP_K}`,
        { topK: options.topK }
      );
    }
  }

  if (options.graphDepth !== undefined) {
    if (options.graphDepth < 1 || options.graphDepth > MAX_GRAPH_DEPTH) {
      throw createSearchError(
        SearchErrorCode.INVALID_OPTIONS,
        `graphDepth must be between 1 and ${MAX_GRAPH_DEPTH}`,
        { graphDepth: options.graphDepth }
      );
    }
  }

  if (options.sourceTimeoutMs !== undefined) {
    if (options.sourceTimeoutMs < 100 || options.sourceTimeoutMs > MAX_SOURCE_TIMEOUT_MS) {
      throw createSearchError(
        SearchErrorCode.INVALID_OPTIONS,
        `sourceTimeoutMs must be between 100 and ${MAX_SOURCE_TIMEOUT_MS}`,
        { sourceTimeoutMs: options.sourceTimeoutMs }
      );
    }
  }

  if (options.weights !== undefined) {
    const sum = Object.values(options.weights).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1.0) > 0.001) {
      throw createSearchError(
        SearchErrorCode.INVALID_OPTIONS,
        `weights must sum to 1.0, got ${sum}`,
        { weights: options.weights }
      );
    }
  }
}

/**
 * Normalize weights to sum to 1.0
 * @param weights - Weights to normalize
 * @returns Normalized weights
 */
export function normalizeWeights(weights: SourceWeights): SourceWeights {
  const sum = weights.vector + weights.graph + weights.memory + weights.pattern;
  if (sum === 0) {
    return { ...DEFAULT_OPTIONS.weights };
  }
  return {
    vector: weights.vector / sum,
    graph: weights.graph / sum,
    memory: weights.memory / sum,
    pattern: weights.pattern / sum
  };
}

/**
 * Merge partial options with defaults
 * @param options - Partial options to merge
 * @returns Complete options with defaults
 */
export function mergeOptions(
  options: Partial<QuadFusionOptions>
): QuadFusionOptions {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    weights: options.weights
      ? normalizeWeights(options.weights)
      : DEFAULT_OPTIONS.weights
  };
}
