/**
 * LanceDB Memory MCP Server - Type Definitions
 *
 * TypeScript interfaces for the LanceDB-backed memory vector search server.
 * Defines the table schema, tool input/output shapes, and server configuration.
 *
 * @module mcp-servers/lancedb-memory/types
 */

// ============================================================================
// Table Schema
// ============================================================================

/**
 * Row schema for the `memories` LanceDB table.
 *
 * The `vector` field stores a 1536-dimensional Float32 embedding.
 * All other fields are metadata columns used for filtering and display.
 */
export interface MemoryRecord {
  /** UUID matching a MemoryGraph node ID */
  id: string;

  /** 1536-dimensional embedding vector */
  vector: Float32Array;

  /** First 500 characters of memory content (for display in results) */
  content: string;

  /** Human-readable title */
  title: string;

  /** Category: architectural_decision, code_pattern, bug_fix, etc. */
  memory_type: string;

  /** Current importance score, 0.0 to 1.0 */
  importance: number;

  /** Comma-separated tags */
  tags: string;

  /** Origin: user_stated, agent_inferred, pipeline_output, etc. */
  source_type: string;

  /** Project directory path for scoping queries */
  project_path: string;

  /** Unix timestamp in milliseconds — when the memory was created */
  created_at: number;

  /** Unix timestamp in milliseconds — last access time */
  last_accessed_at: number;
}

/** Dimension of the embedding vectors */
export const VECTOR_DIMENSION = 1536;

/** Maximum content length stored in the table */
export const MAX_CONTENT_LENGTH = 500;

// ============================================================================
// Tool Inputs
// ============================================================================

/** Input for the store_embedding tool */
export interface StoreEmbeddingInput {
  /** UUID for this memory */
  id: string;

  /** 1536-dimensional embedding vector (array of numbers) */
  vector: number[];

  /** Text content (will be truncated to 500 chars) */
  content: string;

  /** Human-readable title */
  title: string;

  /** Optional metadata fields */
  metadata?: {
    memory_type?: string;
    importance?: number;
    tags?: string;
    source_type?: string;
    project_path?: string;
  };
}

/** Input for the search_similar tool */
export interface SearchSimilarInput {
  /** 1536-dimensional query embedding vector */
  query_vector: number[];

  /** Maximum number of results to return (default 10) */
  limit?: number;

  /** Optional SQL WHERE clause for filtering (e.g. "importance > 0.5") */
  filter?: string;
}

/** Input for the delete_embedding tool */
export interface DeleteEmbeddingInput {
  /** UUID of the memory to delete */
  id: string;
}

/** Input for the embed_and_store tool */
export interface EmbedAndStoreInput {
  /** UUID for this memory */
  id: string;

  /** Text content to embed and store (truncated to 500 chars for storage) */
  content: string;

  /** Human-readable title */
  title: string;

  /** Category: architectural_decision, code_pattern, bug_fix, etc. */
  memory_type?: string;

  /** Importance score 0.0 to 1.0 */
  importance?: number;

  /** Comma-separated tags */
  tags?: string;

  /** Origin: user_stated, agent_inferred, pipeline_output, etc. */
  source_type?: string;

  /** Project directory path for scoping */
  project_path?: string;
}

// ============================================================================
// Tool Outputs
// ============================================================================

/** Output from store_embedding */
export interface StoreEmbeddingOutput {
  success: boolean;
  id: string;
  message: string;
}

/** A single search result with similarity score */
export interface SearchResult {
  id: string;
  content: string;
  title: string;
  memory_type: string;
  importance: number;
  tags: string;
  source_type: string;
  project_path: string;
  created_at: number;
  last_accessed_at: number;
  /** Cosine distance (lower = more similar). Convert to similarity via 1 - distance. */
  _distance: number;
}

/** Output from search_similar */
export interface SearchSimilarOutput {
  results: SearchResult[];
  count: number;
  query_dimension: number;
}

/** Output from delete_embedding */
export interface DeleteEmbeddingOutput {
  success: boolean;
  id: string;
  message: string;
}

/** Output from stats */
export interface StatsOutput {
  row_count: number;
  vector_dimension: number;
  table_exists: boolean;
  data_directory: string;
  disk_usage_bytes: number;
  disk_usage_human: string;
}

// ============================================================================
// Dual Store & Retrieval Types
// ============================================================================

/** Input for the dual_store tool */
export interface DualStoreInput {
  /** UUID for this memory (should match MemoryGraph node ID) */
  id: string;

  /** Text content to embed and store */
  content: string;

  /** Human-readable title */
  title: string;

  /** Category: architectural_decision, code_pattern, bug_fix, etc. */
  memory_type?: string;

  /** Importance score 0.0 to 1.0 */
  importance?: number;

  /** Comma-separated tags */
  tags?: string;

  /** Origin: user_stated, agent_inferred, pipeline_output, etc. */
  source_type?: string;

  /** Project directory path for scoping */
  project_path?: string;
}

/** Input for the retrieve_context tool */
export interface RetrieveContextInput {
  /** Natural-language query to search for */
  query: string;

  /** Maximum number of results to return (default 10) */
  limit?: number;

  /** Maximum token budget for returned content (default 2000) */
  token_budget?: number;

  /** Optional SQL WHERE clause for filtering */
  filter?: string;

  /** Minimum importance threshold (default 0.2) */
  min_importance?: number;
}

/** Output from the reconcile tool */
export interface ReconcileOutput {
  /** All LanceDB memory IDs */
  lancedb_ids: string[];

  /** Total count */
  count: number;
}

/** A single ranked retrieval result with fusion score */
export interface RankedResult {
  id: string;
  content: string;
  title: string;
  memory_type: string;
  importance: number;
  tags: string;
  source_type: string;
  project_path: string;
  created_at: number;
  fusion_score: number;
  similarity: number;
}

/** Output from the retrieve_context tool */
export interface RetrieveContextOutput {
  results: RankedResult[];
  count: number;
  tokens_used: number;
  token_budget: number;
}

/** Output from the drain_queue tool */
export interface DrainQueueOutput {
  processed: number;
  failed: number;
  remaining: number;
  message: string;
}

/** Shape of a pending embedding entry in the queue file */
export interface PendingEmbeddingEntry {
  id: string;
  content: string;
  title: string;
  metadata?: {
    memory_type?: string;
    importance?: number;
    tags?: string;
    source_type?: string;
    project_path?: string;
  };
}

// ============================================================================
// Server Configuration
// ============================================================================

/** Configuration for the LanceDB Memory MCP Server */
export interface LanceDBMemoryServerConfig {
  /** Directory where LanceDB stores data */
  dataDirectory: string;

  /** Table name within the database */
  tableName: string;

  /** Whether to log to stderr */
  enableLogging: boolean;

  /** Log level */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
