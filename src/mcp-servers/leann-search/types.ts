/**
 * LEANN Search MCP Server - Type Definitions
 *
 * This module defines all TypeScript interfaces for the LEANN Search MCP server.
 * It provides types for the 4 core tools: index_code, search_code, get_stats, and clear_index.
 *
 * @module mcp-servers/leann-search/types
 */

import type { VectorID, SearchResult, DistanceMetric } from '../../god-agent/core/vector-db/types.js';
import type { LEANNConfig, LEANNStats } from '../../god-agent/core/vector-db/leann-types.js';

// ============================================================================
// Common Types
// ============================================================================

/**
 * Supported programming languages for code indexing
 */
export type SupportedLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'rust'
  | 'go'
  | 'java'
  | 'c'
  | 'cpp'
  | 'csharp'
  | 'ruby'
  | 'php'
  | 'swift'
  | 'kotlin'
  | 'scala'
  | 'unknown';

/**
 * Code symbol types that can be indexed
 */
export type CodeSymbolType =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'enum'
  | 'constant'
  | 'variable'
  | 'module'
  | 'namespace'
  | 'import'
  | 'export'
  | 'comment'
  | 'unknown';

/**
 * Metadata stored with each indexed code chunk
 */
export interface CodeMetadata {
  /** Absolute file path */
  filePath: string;
  /** Programming language */
  language: SupportedLanguage;
  /** Type of code symbol */
  symbolType: CodeSymbolType;
  /** Name of the symbol (function name, class name, etc.) */
  symbolName?: string;
  /** Starting line number (1-indexed) */
  startLine: number;
  /** Ending line number (1-indexed) */
  endLine: number;
  /** Repository or project name */
  repository?: string;
  /** Git branch name */
  branch?: string;
  /** Git commit hash */
  commitHash?: string;
  /** Timestamp when indexed */
  indexedAt: number;
  /** Hash of the content for deduplication */
  contentHash: string;
  /** Parent symbol (e.g., class name for a method) */
  parentSymbol?: string;
  /** Complexity score (optional, for ranking) */
  complexity?: number;
  /** Additional custom metadata */
  custom?: Record<string, unknown>;
}

// ============================================================================
// Tool: index_code
// ============================================================================

/**
 * Input parameters for the index_code tool
 */
export interface IndexCodeInput {
  /** The code content to index */
  code: string;
  /** Absolute file path where the code resides */
  filePath: string;
  /** Programming language (auto-detected if not provided) */
  language?: SupportedLanguage;
  /** Type of code symbol */
  symbolType?: CodeSymbolType;
  /** Name of the symbol */
  symbolName?: string;
  /** Starting line number */
  startLine?: number;
  /** Ending line number */
  endLine?: number;
  /** Repository name for organization */
  repository?: string;
  /** Git branch */
  branch?: string;
  /** Git commit hash */
  commitHash?: string;
  /** Custom metadata to attach */
  customMetadata?: Record<string, unknown>;
  /** Whether to replace existing entry for same file/lines */
  replaceExisting?: boolean;
}

/**
 * Output from the index_code tool
 */
export interface IndexCodeOutput {
  /** Whether indexing succeeded */
  success: boolean;
  /** Unique identifier for the indexed code */
  vectorId: VectorID;
  /** Message describing the result */
  message: string;
  /** The metadata that was stored */
  metadata: CodeMetadata;
  /** Embedding dimension used */
  embeddingDimension: number;
  /** Time taken to index in milliseconds */
  indexTimeMs: number;
  /** Whether this replaced an existing entry */
  replaced: boolean;
}

// ============================================================================
// Tool: search_code
// ============================================================================

/**
 * Search mode for code search
 */
export type SearchMode =
  | 'semantic'      // Vector similarity search
  | 'hybrid'        // Combine semantic + keyword
  | 'exact';        // Exact text match (fallback)

/**
 * Filter operators for metadata filtering
 */
export type FilterOperator =
  | 'eq'      // Equal
  | 'neq'     // Not equal
  | 'gt'      // Greater than
  | 'gte'     // Greater than or equal
  | 'lt'      // Less than
  | 'lte'     // Less than or equal
  | 'in'      // In array
  | 'nin'     // Not in array
  | 'contains' // String contains
  | 'startsWith' // String starts with
  | 'endsWith';  // String ends with

/**
 * Single filter condition
 */
export interface FilterCondition {
  /** Field name from CodeMetadata */
  field: keyof CodeMetadata | string;
  /** Comparison operator */
  operator: FilterOperator;
  /** Value to compare against */
  value: unknown;
}

/**
 * Combined filter with logical operators
 */
export interface FilterGroup {
  /** Logical operator to combine conditions */
  logic: 'and' | 'or';
  /** List of conditions or nested groups */
  conditions: (FilterCondition | FilterGroup)[];
}

/**
 * Input parameters for the search_code tool
 */
export interface SearchCodeInput {
  /** Natural language query or code snippet to search for */
  query: string;
  /** Maximum number of results to return */
  limit?: number;
  /** Minimum similarity score (0-1) */
  minScore?: number;
  /** Search mode */
  mode?: SearchMode;
  /** Metadata filters */
  filters?: FilterCondition[] | FilterGroup;
  /** Filter by specific languages */
  languages?: SupportedLanguage[];
  /** Filter by specific symbol types */
  symbolTypes?: CodeSymbolType[];
  /** Filter by file path pattern (glob) */
  filePattern?: string;
  /** Filter by repository */
  repository?: string;
  /** Include the full code content in results */
  includeCode?: boolean;
  /** Include surrounding context lines */
  contextLines?: number;
  /** Distance metric to use for similarity */
  distanceMetric?: DistanceMetric;
  /** Whether to deduplicate near-identical results */
  deduplicate?: boolean;
  /** Deduplication threshold (0-1) */
  deduplicationThreshold?: number;
}

/**
 * Single search result item
 */
export interface CodeSearchResult {
  /** Unique identifier */
  vectorId: VectorID;
  /** Similarity score (0-1, higher is better) */
  score: number;
  /** Distance from query vector */
  distance: number;
  /** The indexed code content (if includeCode is true) */
  code?: string;
  /** Code metadata */
  metadata: CodeMetadata;
  /** Surrounding context (if contextLines > 0) */
  context?: {
    before: string[];
    after: string[];
  };
  /** Highlighted matches (for hybrid/exact search) */
  highlights?: string[];
}

/**
 * Output from the search_code tool
 */
export interface SearchCodeOutput {
  /** Whether search succeeded */
  success: boolean;
  /** Search results */
  results: CodeSearchResult[];
  /** Total number of results (before limit) */
  totalResults: number;
  /** Query that was executed */
  query: string;
  /** Search mode used */
  mode: SearchMode;
  /** Time taken to search in milliseconds */
  searchTimeMs: number;
  /** Embedding generation time in milliseconds */
  embeddingTimeMs: number;
  /** Whether results were truncated by limit */
  truncated: boolean;
  /** Message describing the search */
  message: string;
}

// ============================================================================
// Tool: get_stats
// ============================================================================

/**
 * Input parameters for the get_stats tool
 */
export interface GetStatsInput {
  /** Whether to include detailed breakdown by language */
  includeLanguageBreakdown?: boolean;
  /** Whether to include breakdown by repository */
  includeRepositoryBreakdown?: boolean;
  /** Whether to include breakdown by symbol type */
  includeSymbolBreakdown?: boolean;
  /** Whether to include memory usage details */
  includeMemoryDetails?: boolean;
  /** Whether to include LEANN-specific stats */
  includeLeannDetails?: boolean;
}

/**
 * Breakdown statistics by category
 */
export interface CategoryBreakdown {
  /** Category name */
  category: string;
  /** Number of items */
  count: number;
  /** Percentage of total */
  percentage: number;
}

/**
 * Memory usage statistics
 */
export interface MemoryStats {
  /** Total memory used in bytes */
  totalBytes: number;
  /** Memory used by vectors in bytes */
  vectorBytes: number;
  /** Memory used by metadata in bytes */
  metadataBytes: number;
  /** Memory used by LEANN index structures in bytes */
  indexBytes: number;
  /** Human-readable total memory */
  totalFormatted: string;
}

/**
 * LEANN-specific statistics
 */
export interface LeannIndexStats {
  /** Number of layers in the graph */
  layerCount: number;
  /** Average connections per node */
  avgConnections: number;
  /** Maximum connections per layer */
  maxConnections: number[];
  /** Entry point node IDs */
  entryPoints: VectorID[];
  /** Distance metric being used */
  distanceMetric: DistanceMetric;
  /** Embedding dimension */
  embeddingDimension: number;
  /** Whether the index is optimized */
  optimized: boolean;
  /** Last optimization timestamp */
  lastOptimizedAt?: number;
}

/**
 * Output from the get_stats tool
 */
export interface GetStatsOutput {
  /** Whether stats retrieval succeeded */
  success: boolean;
  /** Total number of indexed code chunks */
  totalIndexed: number;
  /** Number of unique files indexed */
  uniqueFiles: number;
  /** Number of unique repositories */
  uniqueRepositories: number;
  /** Timestamp of first indexing */
  firstIndexedAt?: number;
  /** Timestamp of most recent indexing */
  lastIndexedAt?: number;
  /** Language breakdown (if requested) */
  languageBreakdown?: CategoryBreakdown[];
  /** Repository breakdown (if requested) */
  repositoryBreakdown?: CategoryBreakdown[];
  /** Symbol type breakdown (if requested) */
  symbolBreakdown?: CategoryBreakdown[];
  /** Memory usage (if requested) */
  memoryStats?: MemoryStats;
  /** LEANN index stats (if requested) */
  leannStats?: LeannIndexStats;
  /** LEANN configuration */
  config: LEANNConfig;
  /** Message describing the stats */
  message: string;
}

// ============================================================================
// Tool: clear_index
// ============================================================================

/**
 * Scope of what to clear
 */
export type ClearScope =
  | 'all'           // Clear everything
  | 'repository'    // Clear specific repository
  | 'file'          // Clear specific file
  | 'language'      // Clear specific language
  | 'older_than'    // Clear entries older than date
  | 'pattern';      // Clear by file pattern

/**
 * Input parameters for the clear_index tool
 */
export interface ClearIndexInput {
  /** Scope of what to clear */
  scope: ClearScope;
  /** Repository name (required if scope is 'repository') */
  repository?: string;
  /** File path (required if scope is 'file') */
  filePath?: string;
  /** Language (required if scope is 'language') */
  language?: SupportedLanguage;
  /** Timestamp threshold (required if scope is 'older_than') */
  olderThan?: number;
  /** File pattern glob (required if scope is 'pattern') */
  pattern?: string;
  /** Whether to require confirmation (safety check) */
  confirm?: boolean;
  /** Dry run - show what would be deleted without deleting */
  dryRun?: boolean;
}

/**
 * Output from the clear_index tool
 */
export interface ClearIndexOutput {
  /** Whether clearing succeeded */
  success: boolean;
  /** Number of entries deleted */
  deletedCount: number;
  /** Vector IDs that were deleted */
  deletedIds: VectorID[];
  /** Scope that was used */
  scope: ClearScope;
  /** Whether this was a dry run */
  dryRun: boolean;
  /** Time taken in milliseconds */
  clearTimeMs: number;
  /** Remaining entries after clear */
  remainingCount: number;
  /** Message describing the result */
  message: string;
}

// ============================================================================
// MCP Server Types
// ============================================================================

/**
 * MCP Tool definition for schema generation
 */
export interface MCPToolDefinition {
  /** Tool name */
  name: string;
  /** Tool description */
  description: string;
  /** JSON Schema for input parameters */
  inputSchema: Record<string, unknown>;
}

/**
 * MCP Server configuration
 */
export interface LEANNMCPServerConfig {
  /** Server name */
  name: string;
  /** Server version */
  version: string;
  /** LEANN backend configuration */
  leannConfig: LEANNConfig;
  /** Path to persist the index */
  persistPath?: string;
  /** Whether to auto-load index on startup */
  autoLoad?: boolean;
  /** Whether to auto-save index on changes */
  autoSave?: boolean;
  /** Auto-save interval in milliseconds */
  autoSaveInterval?: number;
  /** Maximum code chunk size in characters */
  maxChunkSize?: number;
  /** Default search limit */
  defaultSearchLimit?: number;
  /** Enable request logging */
  enableLogging?: boolean;
  /** Log level */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * MCP Server state
 */
export interface LEANNMCPServerState {
  /** Whether the server is initialized */
  initialized: boolean;
  /** Whether the backend is loaded */
  backendLoaded: boolean;
  /** Number of indexed items */
  indexedCount: number;
  /** Last operation timestamp */
  lastOperationAt?: number;
  /** Server start timestamp */
  startedAt: number;
  /** Total operations processed */
  operationCount: number;
  /** Error count */
  errorCount: number;
}

/**
 * Tool execution context
 */
export interface ToolContext {
  /** Request ID for tracing */
  requestId: string;
  /** Timestamp of request */
  timestamp: number;
  /** Tool being executed */
  toolName: string;
  /** Caller information (if available) */
  caller?: string;
}

/**
 * Tool execution result wrapper
 */
export interface ToolResult<T> {
  /** Whether execution succeeded */
  success: boolean;
  /** Result data */
  data?: T;
  /** Error message if failed */
  error?: string;
  /** Error code if failed */
  errorCode?: string;
  /** Execution context */
  context: ToolContext;
  /** Execution duration in milliseconds */
  durationMs: number;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for the MCP server
 */
export enum LEANNErrorCode {
  // General errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',

  // Backend errors
  BACKEND_NOT_INITIALIZED = 'BACKEND_NOT_INITIALIZED',
  BACKEND_LOAD_FAILED = 'BACKEND_LOAD_FAILED',
  BACKEND_SAVE_FAILED = 'BACKEND_SAVE_FAILED',

  // Indexing errors
  INDEX_FAILED = 'INDEX_FAILED',
  EMBEDDING_FAILED = 'EMBEDDING_FAILED',
  DUPLICATE_ENTRY = 'DUPLICATE_ENTRY',
  CONTENT_TOO_LARGE = 'CONTENT_TOO_LARGE',

  // Search errors
  SEARCH_FAILED = 'SEARCH_FAILED',
  INVALID_FILTER = 'INVALID_FILTER',
  QUERY_TOO_LONG = 'QUERY_TOO_LONG',

  // Clear errors
  CLEAR_FAILED = 'CLEAR_FAILED',
  CONFIRMATION_REQUIRED = 'CONFIRMATION_REQUIRED',
  INVALID_SCOPE = 'INVALID_SCOPE',

  // Stats errors
  STATS_FAILED = 'STATS_FAILED',
}

/**
 * Custom error class for LEANN MCP operations
 */
export class LEANNMCPError extends Error {
  constructor(
    message: string,
    public readonly code: LEANNErrorCode,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'LEANNMCPError';
  }
}

// ============================================================================
// Re-exports from LEANN core
// ============================================================================

export type { VectorID, SearchResult, DistanceMetric } from '../../god-agent/core/vector-db/types.js';
export type { LEANNConfig, LEANNStats } from '../../god-agent/core/vector-db/leann-types.js';
