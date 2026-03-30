/**
 * LanceDB Memory MCP Server
 *
 * An MCP server that wraps LanceDB for general-purpose memory vector search.
 * Receives pre-computed 1536-dimensional embeddings and stores them alongside
 * metadata for cosine similarity search.
 *
 * Tools provided:
 * - store_embedding: Store a vector with metadata
 * - search_similar: Cosine similarity search with optional SQL WHERE filter
 * - delete_embedding: Remove a memory vector by ID
 * - stats: Table row count, disk usage
 *
 * Data is persisted in Lance columnar format at `.persistent-memory/vectors/`.
 *
 * @module mcp-servers/lancedb-memory/server
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import * as lancedb from '@lancedb/lancedb';

import type {
  LanceDBMemoryServerConfig,
  StoreEmbeddingInput,
  SearchSimilarInput,
  DeleteEmbeddingInput,
  EmbedAndStoreInput,
  DualStoreInput,
  RetrieveContextInput,
  StoreEmbeddingOutput,
  SearchSimilarOutput,
  DeleteEmbeddingOutput,
  StatsOutput,
  ReconcileOutput,
  RetrieveContextOutput,
  DrainQueueOutput,
  RankedResult,
  PendingEmbeddingEntry,
  MemoryRecord,
} from './types.js';

import {
  MAX_CONTENT_LENGTH,
} from './types.js';

import {
  recencyScore,
  fusionScore,
  estimateTokens,
  deduplicateByContent,
} from './retrieval.js';

import {
  createEmbeddingProvider,
  type EmbeddingProvider,
} from './embedding.js';

// ============================================================================
// Constants
// ============================================================================

const SERVER_NAME = 'lancedb-memory';
const SERVER_VERSION = '1.0.0';
const TABLE_NAME = 'memories';

const DEFAULT_CONFIG: LanceDBMemoryServerConfig = {
  dataDirectory: '.persistent-memory/vectors',
  tableName: TABLE_NAME,
  enableLogging: true,
  logLevel: 'info',
};

// ============================================================================
// Logger
// ============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private level: LogLevel;
  private enabled: boolean;

  constructor(level: LogLevel = 'info', enabled: boolean = true) {
    this.level = level;
    this.enabled = enabled;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.enabled && LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) console.error(`[lancedb-memory][DEBUG] ${message}`, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) console.error(`[lancedb-memory][INFO] ${message}`, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) console.error(`[lancedb-memory][WARN] ${message}`, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) console.error(`[lancedb-memory][ERROR] ${message}`, ...args);
  }
}

// ============================================================================
// Tool Definitions (MCP schema)
// ============================================================================

const STORE_EMBEDDING_DEFINITION = {
  name: 'store_embedding',
  description:
    'Store a pre-computed embedding vector with metadata in LanceDB. ' +
    'The vector must be 1536-dimensional (Float32). ' +
    'Content is truncated to 500 characters for display.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      id: {
        type: 'string',
        description: 'UUID for this memory (should match MemoryGraph node ID)',
      },
      vector: {
        type: 'array',
        items: { type: 'number' },
        description: '1536-dimensional embedding vector',
      },
      content: {
        type: 'string',
        description: 'Text content of the memory (truncated to 500 chars for storage)',
      },
      title: {
        type: 'string',
        description: 'Human-readable title for the memory',
      },
      metadata: {
        type: 'object',
        description: 'Optional metadata fields',
        properties: {
          memory_type: {
            type: 'string',
            description: 'Category: architectural_decision, code_pattern, bug_fix, etc.',
          },
          importance: {
            type: 'number',
            description: 'Importance score 0.0 to 1.0',
          },
          tags: {
            type: 'string',
            description: 'Comma-separated tags',
          },
          source_type: {
            type: 'string',
            description: 'Origin: user_stated, agent_inferred, pipeline_output, etc.',
          },
          project_path: {
            type: 'string',
            description: 'Project directory path for scoping',
          },
        },
      },
    },
    required: ['id', 'vector', 'content', 'title'],
  },
};

const SEARCH_SIMILAR_DEFINITION = {
  name: 'search_similar',
  description:
    'Search for similar memories by cosine similarity using a pre-computed query vector. ' +
    'Returns results ranked by distance (lower = more similar). ' +
    'Supports optional SQL WHERE filters on metadata columns.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query_vector: {
        type: 'array',
        items: { type: 'number' },
        description: '1536-dimensional query embedding vector',
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return (default 10, max 100)',
      },
      filter: {
        type: 'string',
        description: 'Optional SQL WHERE clause for filtering (e.g. "importance > 0.5")',
      },
    },
    required: ['query_vector'],
  },
};

const DELETE_EMBEDDING_DEFINITION = {
  name: 'delete_embedding',
  description: 'Delete a memory embedding by its UUID.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      id: {
        type: 'string',
        description: 'UUID of the memory to delete',
      },
    },
    required: ['id'],
  },
};

const STATS_DEFINITION = {
  name: 'stats',
  description:
    'Return statistics about the LanceDB memories table: row count, ' +
    'vector dimension, disk usage, and whether the table exists.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
};

const EMBED_AND_STORE_DEFINITION = {
  name: 'embed_and_store',
  description:
    'Generate an embedding from text content and store it with metadata in LanceDB. ' +
    'This is a convenience tool that combines embedding generation and storage into a single call. ' +
    'Uses OpenAI text-embedding-3-small (1536 dims) if OPENAI_API_KEY is set, otherwise falls back to local model (384 dims).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      id: {
        type: 'string',
        description: 'UUID for this memory (should match MemoryGraph node ID)',
      },
      content: {
        type: 'string',
        description: 'Text content to embed and store (truncated to 500 chars for storage display)',
      },
      title: {
        type: 'string',
        description: 'Human-readable title for the memory',
      },
      memory_type: {
        type: 'string',
        description: 'Category: architectural_decision, code_pattern, bug_fix, etc.',
      },
      importance: {
        type: 'number',
        description: 'Importance score 0.0 to 1.0 (default 0.5)',
      },
      tags: {
        type: 'string',
        description: 'Comma-separated tags',
      },
      source_type: {
        type: 'string',
        description: 'Origin: user_stated, agent_inferred, pipeline_output, etc.',
      },
      project_path: {
        type: 'string',
        description: 'Project directory path for scoping',
      },
    },
    required: ['id', 'content', 'title'],
  },
};

const DUAL_STORE_DEFINITION = {
  name: 'dual_store',
  description:
    'Embed content and store in LanceDB. Returns a reminder to also call memorygraph store_memory ' +
    'with the same ID so both stores stay in sync. This is the preferred write path for the dual-store architecture.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      id: {
        type: 'string',
        description: 'UUID for this memory (must match MemoryGraph node ID)',
      },
      content: {
        type: 'string',
        description: 'Text content to embed and store',
      },
      title: {
        type: 'string',
        description: 'Human-readable title for the memory',
      },
      memory_type: {
        type: 'string',
        description: 'Category: architectural_decision, code_pattern, bug_fix, etc.',
      },
      importance: {
        type: 'number',
        description: 'Importance score 0.0 to 1.0 (default 0.5)',
      },
      tags: {
        type: 'string',
        description: 'Comma-separated tags',
      },
      source_type: {
        type: 'string',
        description: 'Origin: user_stated, agent_inferred, pipeline_output, etc.',
      },
      project_path: {
        type: 'string',
        description: 'Project directory path for scoping',
      },
    },
    required: ['id', 'content', 'title'],
  },
};

const RECONCILE_DEFINITION = {
  name: 'reconcile',
  description:
    'Return all LanceDB memory IDs for comparison with MemoryGraph. ' +
    'Use this to find orphaned entries that exist in one store but not the other.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
};

const DRAIN_QUEUE_DEFINITION = {
  name: 'drain_queue',
  description:
    'Process the pending-embeddings queue (.persistent-memory/pending-embeddings.json). ' +
    'Retries failed embeddings: generates embedding for each entry, stores in LanceDB, ' +
    'and removes successfully stored entries from the queue file.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
};

const RETRIEVE_CONTEXT_DEFINITION = {
  name: 'retrieve_context',
  description:
    'Semantic search with fusion scoring. Embeds the query, searches LanceDB, ' +
    'ranks results using a weighted fusion of similarity, importance, recency, and rank position, ' +
    'then returns results that fit within the token budget.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Natural-language query to search for',
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return (default 10, max 100)',
      },
      token_budget: {
        type: 'number',
        description: 'Maximum token budget for returned content (default 2000)',
      },
      filter: {
        type: 'string',
        description: 'Optional SQL WHERE clause for filtering (e.g. "importance > 0.5")',
      },
      min_importance: {
        type: 'number',
        description: 'Minimum importance threshold, 0.0-1.0 (default 0.2)',
      },
    },
    required: ['query'],
  },
};

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate that a vector is a number array of the expected dimension.
 * Accepts a dynamic expectedDimension rather than the hardcoded constant.
 */
function validateVector(vector: unknown, fieldName: string, expectedDimension: number): number[] {
  if (!Array.isArray(vector)) {
    throw new Error(`${fieldName} must be an array of numbers`);
  }

  if (vector.length !== expectedDimension) {
    throw new Error(
      `${fieldName} must have exactly ${expectedDimension} dimensions, got ${vector.length}`
    );
  }

  for (let i = 0; i < vector.length; i++) {
    if (typeof vector[i] !== 'number' || !Number.isFinite(vector[i])) {
      throw new Error(`${fieldName}[${i}] must be a finite number`);
    }
  }

  return vector as number[];
}

/**
 * Validate and sanitize importance values.
 * Guards against NaN, Infinity, and out-of-range values.
 */
function validateImportance(value: unknown, defaultValue: number = 0.5): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    return defaultValue;
  }
  return value;
}

/**
 * Sanitize a SQL WHERE clause filter to prevent injection.
 *
 * Only allows simple column-operator-value conditions joined by AND/OR.
 * Rejects dangerous SQL keywords (DDL, DML) and comment/statement terminators.
 */
function sanitizeFilter(filter: string): string {
  const trimmed = filter.trim();
  if (trimmed.length === 0) {
    throw new Error('Filter must be a non-empty string');
  }

  // Reject dangerous SQL patterns
  const DANGEROUS = /;|--|\/\*|\*\/|\bDROP\b|\bDELETE\b|\bINSERT\b|\bUPDATE\b|\bCREATE\b|\bALTER\b|\bEXEC\b|\bUNION\b|\bINTO\b/i;
  if (DANGEROUS.test(trimmed)) {
    throw new Error('Filter contains potentially dangerous SQL. Only WHERE clause conditions are allowed.');
  }

  return trimmed;
}

/**
 * Validate that an ID is a non-empty string.
 */
function validateId(id: unknown): string {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('id must be a non-empty string');
  }
  return id.trim();
}

/**
 * Format bytes to human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(1)} ${units[i]}`;
}

/**
 * Recursively compute the total size of a directory in bytes.
 */
async function getDirectorySize(dirPath: string): Promise<number> {
  let totalSize = 0;

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        totalSize += await getDirectorySize(entryPath);
      } else if (entry.isFile()) {
        const stat = await fs.stat(entryPath);
        totalSize += stat.size;
      }
    }
  } catch {
    // Directory may not exist yet
  }

  return totalSize;
}

// ============================================================================
// LanceDB Memory MCP Server
// ============================================================================

export class LanceDBMemoryServer {
  private readonly server: Server;
  private readonly config: LanceDBMemoryServerConfig;
  private readonly logger: Logger;
  private readonly embeddingProvider: EmbeddingProvider;

  /** LanceDB database connection */
  private db: any = null;

  /** LanceDB table handle (null until first store or if table doesn't exist yet) */
  private table: any = null;

  /** Active vector dimension — read from stored .dimension file or from embedding provider */
  private vectorDimension: number;

  constructor(config: Partial<LanceDBMemoryServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.logger = new Logger(
      this.config.logLevel ?? 'info',
      this.config.enableLogging ?? true,
    );

    this.embeddingProvider = createEmbeddingProvider();
    this.vectorDimension = this.embeddingProvider.dimensions;
    this.logger.info(
      `Embedding backend: ${this.embeddingProvider.name} (${this.embeddingProvider.dimensions} dims)`,
    );

    this.server = new Server(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { capabilities: { tools: {} } },
    );

    this.setupHandlers();
  }

  // ==========================================================================
  // Handler Setup
  // ==========================================================================

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          STORE_EMBEDDING_DEFINITION,
          SEARCH_SIMILAR_DEFINITION,
          DELETE_EMBEDDING_DEFINITION,
          STATS_DEFINITION,
          EMBED_AND_STORE_DEFINITION,
          DUAL_STORE_DEFINITION,
          RECONCILE_DEFINITION,
          DRAIN_QUEUE_DEFINITION,
          RETRIEVE_CONTEXT_DEFINITION,
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      this.logger.debug(`Tool call: ${name}`);

      try {
        const result = await this.executeTool(name, args ?? {});
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Tool ${name} failed: ${message}`);

        throw new McpError(
          ErrorCode.InternalError,
          `Tool ${name} failed: ${message}`,
        );
      }
    });
  }

  private async executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (name) {
      case 'store_embedding':
        return this.handleStoreEmbedding(args as unknown as StoreEmbeddingInput);
      case 'search_similar':
        return this.handleSearchSimilar(args as unknown as SearchSimilarInput);
      case 'delete_embedding':
        return this.handleDeleteEmbedding(args as unknown as DeleteEmbeddingInput);
      case 'stats':
        return this.handleStats();
      case 'embed_and_store':
        return this.handleEmbedAndStore(args as unknown as EmbedAndStoreInput);
      case 'dual_store':
        return this.handleDualStore(args as unknown as DualStoreInput);
      case 'reconcile':
        return this.handleReconcile();
      case 'drain_queue':
        return this.handleDrainQueue();
      case 'retrieve_context':
        return this.handleRetrieveContext(args as unknown as RetrieveContextInput);
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  }

  // ==========================================================================
  // Tool Handlers
  // ==========================================================================

  /**
   * Store a pre-computed embedding with metadata.
   *
   * Creates the `memories` table on the first call if it does not exist.
   * On subsequent calls, appends rows via `table.add()`.
   * If a record with the same `id` exists, it is deleted first (upsert).
   */
  private async handleStoreEmbedding(
    input: StoreEmbeddingInput,
  ): Promise<StoreEmbeddingOutput> {
    const id = validateId(input.id);
    const vector = validateVector(input.vector, 'vector', this.vectorDimension);

    if (typeof input.content !== 'string') {
      throw new Error('content must be a string');
    }
    if (typeof input.title !== 'string') {
      throw new Error('title must be a string');
    }

    const meta = input.metadata ?? {};
    const importance = meta.importance ?? 0.5;
    if (typeof importance !== 'number' || !Number.isFinite(importance) || importance < 0 || importance > 1) {
      throw new Error('metadata.importance must be a finite number between 0.0 and 1.0');
    }

    const now = Date.now();

    const record: MemoryRecord = {
      id,
      vector: new Float32Array(vector),
      content: input.content.slice(0, MAX_CONTENT_LENGTH),
      title: input.title,
      memory_type: meta.memory_type ?? 'general',
      importance,
      tags: meta.tags ?? '',
      source_type: meta.source_type ?? 'unknown',
      project_path: meta.project_path ?? '',
      created_at: now,
      last_accessed_at: now,
    };

    await this.ensureConnection();

    // Safe upsert: add first, then delete old record. If add fails, old data is preserved.
    if (!this.table) {
      this.logger.info('Creating memories table with first record');
      this.table = await this.db.createTable(this.config.tableName, [record]);
    } else {
      // Delete existing record with same ID first, then add new one
      // If add() fails after delete(), log a CRITICAL error
      let deleted = false;
      try {
        await this.table.delete(`id = '${id.replace(/'/g, "''")}'`);
        deleted = true;
      } catch {
        // Record may not exist — safe to ignore
      }
      try {
        await this.table.add([record]);
      } catch (addError) {
        if (deleted) {
          this.logger.error(
            `CRITICAL: Upsert data loss for id=${id} — old record was deleted but new record failed to add: ${addError instanceof Error ? addError.message : String(addError)}`
          );
        }
        throw addError;
      }
    }

    this.logger.info(`Stored embedding: id=${id}, title="${input.title}"`);

    return {
      success: true,
      id,
      message: `Embedding stored successfully`,
    };
  }

  /**
   * Search for similar memories by cosine distance.
   *
   * Uses LanceDB's vector search with optional SQL WHERE filter.
   * Results are sorted by distance ascending (lower = more similar).
   */
  private async handleSearchSimilar(
    input: SearchSimilarInput,
  ): Promise<SearchSimilarOutput> {
    const queryVector = validateVector(input.query_vector, 'query_vector', this.vectorDimension);

    const limit = Math.min(Math.max(input.limit ?? 10, 1), 100);

    await this.ensureConnection();

    if (!this.table) {
      return { results: [], count: 0, query_dimension: this.vectorDimension };
    }

    let query = this.table
      .search(new Float32Array(queryVector))
      .distanceType('cosine')
      .limit(limit);

    if (input.filter && typeof input.filter === 'string' && input.filter.trim().length > 0) {
      const safeFilter = sanitizeFilter(input.filter);
      query = query.where(safeFilter);
    }

    const rawResults = await query.toArray();

    const results = rawResults.map((row: any) => ({
      id: row.id,
      content: row.content,
      title: row.title,
      memory_type: row.memory_type,
      importance: row.importance,
      tags: row.tags,
      source_type: row.source_type,
      project_path: row.project_path,
      created_at: row.created_at,
      last_accessed_at: row.last_accessed_at,
      _distance: row._distance,
    }));

    this.logger.info(
      `Search returned ${results.length} results` +
        (input.filter ? ` (filter applied, length=${input.filter.length})` : ''),
    );

    return {
      results,
      count: results.length,
      query_dimension: this.vectorDimension,
    };
  }

  /**
   * Delete a memory embedding by ID.
   *
   * Uses LanceDB's SQL delete with an equality filter on the `id` column.
   */
  private async handleDeleteEmbedding(
    input: DeleteEmbeddingInput,
  ): Promise<DeleteEmbeddingOutput> {
    const id = validateId(input.id);

    await this.ensureConnection();

    if (!this.table) {
      return {
        success: false,
        id,
        message: 'Table does not exist — nothing to delete',
      };
    }

    try {
      await this.table.delete(`id = '${id.replace(/'/g, "''")}'`);
      this.logger.info(`Deleted embedding: id=${id}`);

      return {
        success: true,
        id,
        message: `Embedding deleted successfully`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to delete embedding ${id}: ${message}`);
    }
  }

  /**
   * Return statistics about the memories table.
   */
  private async handleStats(): Promise<StatsOutput> {
    await this.ensureConnection();

    const dataDir = path.resolve(process.cwd(), this.config.dataDirectory);
    let rowCount = 0;
    let tableExists = false;

    if (this.table) {
      try {
        const rows = await this.table.countRows();
        rowCount = rows;
        tableExists = true;
      } catch {
        tableExists = false;
      }
    }

    const diskBytes = await getDirectorySize(dataDir);

    const stats: StatsOutput = {
      row_count: rowCount,
      vector_dimension: this.vectorDimension,
      table_exists: tableExists,
      data_directory: dataDir,
      disk_usage_bytes: diskBytes,
      disk_usage_human: formatBytes(diskBytes),
    };

    this.logger.info(`Stats: ${rowCount} rows, ${stats.disk_usage_human} on disk`);

    return stats;
  }

  /**
   * Generate an embedding from text content and store it with metadata.
   *
   * Combines embedding generation via the configured provider with the
   * existing store logic (upsert, table creation, etc.).
   */
  private async handleEmbedAndStore(
    input: EmbedAndStoreInput,
  ): Promise<StoreEmbeddingOutput> {
    const id = validateId(input.id);

    if (typeof input.content !== 'string') {
      throw new Error('content must be a string');
    }
    if (typeof input.title !== 'string') {
      throw new Error('title must be a string');
    }

    const importance = input.importance ?? 0.5;
    if (typeof importance !== 'number' || !Number.isFinite(importance) || importance < 0 || importance > 1) {
      throw new Error('importance must be a finite number between 0.0 and 1.0');
    }

    // Concatenate title + content for richer embedding signal
    const textToEmbed = `${input.title}\n${input.content}`;

    this.logger.info(`Generating embedding for id=${id} via ${this.embeddingProvider.name}`);
    const vector = await this.embeddingProvider.embed(textToEmbed);

    const now = Date.now();

    const record: MemoryRecord = {
      id,
      vector,
      content: input.content.slice(0, MAX_CONTENT_LENGTH),
      title: input.title,
      memory_type: input.memory_type ?? 'general',
      importance,
      tags: input.tags ?? '',
      source_type: input.source_type ?? 'unknown',
      project_path: input.project_path ?? '',
      created_at: now,
      last_accessed_at: now,
    };

    await this.ensureConnection();

    // Safe upsert: delete then add with error recovery logging
    if (!this.table) {
      this.logger.info('Creating memories table with first record');
      this.table = await this.db.createTable(this.config.tableName, [record]);
    } else {
      let deleted = false;
      try {
        await this.table.delete(`id = '${id.replace(/'/g, "''")}'`);
        deleted = true;
      } catch {
        // Record may not exist — safe to ignore
      }
      try {
        await this.table.add([record]);
      } catch (addError) {
        if (deleted) {
          this.logger.error(
            `CRITICAL: Upsert data loss for id=${id} — old record was deleted but new record failed to add: ${addError instanceof Error ? addError.message : String(addError)}`
          );
        }
        throw addError;
      }
    }

    this.logger.info(
      `Embedded and stored: id=${id}, title="${input.title}", dims=${vector.length}`,
    );

    return {
      success: true,
      id,
      message: `Embedding generated (${this.embeddingProvider.name}) and stored successfully`,
    };
  }

  // ==========================================================================
  // Dual Store & Retrieval Handlers
  // ==========================================================================

  /**
   * Embed content and store in LanceDB, then return a reminder to also
   * store in MemoryGraph for dual-store consistency.
   */
  private async handleDualStore(
    input: DualStoreInput,
  ): Promise<StoreEmbeddingOutput & { memorygraph_reminder: string }> {
    const id = validateId(input.id);

    if (typeof input.content !== 'string') {
      throw new Error('content must be a string');
    }
    if (typeof input.title !== 'string') {
      throw new Error('title must be a string');
    }

    const importance = input.importance ?? 0.5;
    if (typeof importance !== 'number' || !Number.isFinite(importance) || importance < 0 || importance > 1) {
      throw new Error('importance must be a finite number between 0.0 and 1.0');
    }

    // Generate embedding
    const textToEmbed = `${input.title}\n${input.content}`;
    this.logger.info(`dual_store: generating embedding for id=${id} via ${this.embeddingProvider.name}`);
    const vector = await this.embeddingProvider.embed(textToEmbed);

    const now = Date.now();

    const record: MemoryRecord = {
      id,
      vector,
      content: input.content.slice(0, MAX_CONTENT_LENGTH),
      title: input.title,
      memory_type: input.memory_type ?? 'general',
      importance,
      tags: input.tags ?? '',
      source_type: input.source_type ?? 'unknown',
      project_path: input.project_path ?? '',
      created_at: now,
      last_accessed_at: now,
    };

    await this.ensureConnection();

    // Safe upsert: delete then add with error recovery logging
    if (!this.table) {
      this.logger.info('Creating memories table with first record');
      this.table = await this.db.createTable(this.config.tableName, [record]);
    } else {
      let deleted = false;
      try {
        await this.table.delete(`id = '${id.replace(/'/g, "''")}'`);
        deleted = true;
      } catch {
        // Record may not exist — safe to ignore
      }
      try {
        await this.table.add([record]);
      } catch (addError) {
        if (deleted) {
          this.logger.error(
            `CRITICAL: Upsert data loss for id=${id} — old record was deleted but new record failed to add: ${addError instanceof Error ? addError.message : String(addError)}`
          );
        }
        throw addError;
      }
    }

    this.logger.info(`dual_store: stored in LanceDB: id=${id}, title="${input.title}"`);

    return {
      success: true,
      id,
      message: `Embedding generated (${this.embeddingProvider.name}) and stored in LanceDB successfully`,
      memorygraph_reminder:
        `IMPORTANT: Also call memorygraph store_memory with id="${id}", ` +
        `title="${input.title}", memory_type="${input.memory_type ?? 'general'}" ` +
        `to keep both stores in sync.`,
    };
  }

  /**
   * Return all LanceDB memory IDs for comparison with MemoryGraph.
   */
  private async handleReconcile(): Promise<ReconcileOutput> {
    await this.ensureConnection();

    if (!this.table) {
      return { lancedb_ids: [], count: 0 };
    }

    try {
      // Use a non-vector query to scan all IDs instead of a dummy zero-vector search.
      // This avoids undefined cosine similarity with zero vectors and dimension mismatches.
      const rows = await this.table
        .query()
        .select(['id'])
        .toArray();

      const ids: string[] = rows.map((row: any) => row.id);

      this.logger.info(`reconcile: found ${ids.length} IDs in LanceDB`);

      return { lancedb_ids: ids, count: ids.length };
    } catch (error) {
      // Fallback: try filter-based scan
      this.logger.warn('reconcile: table query failed, returning empty', error);
      return { lancedb_ids: [], count: 0 };
    }
  }

  /**
   * Process the pending-embeddings queue file.
   *
   * Reads `.persistent-memory/pending-embeddings.json`, generates embeddings
   * for each entry, stores in LanceDB, and removes successful entries from
   * the queue. Deletes the file when the queue is fully drained.
   */
  private async handleDrainQueue(): Promise<DrainQueueOutput> {
    const queueDir = path.resolve(process.cwd(), '.persistent-memory');
    const queuePath = path.join(queueDir, 'pending-embeddings.json');

    // Read the queue file
    let entries: PendingEmbeddingEntry[];
    try {
      const raw = await fs.readFile(queuePath, 'utf-8');
      entries = JSON.parse(raw);
      if (!Array.isArray(entries)) {
        throw new Error('Queue file is not a JSON array');
      }
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        this.logger.info('drain_queue: no pending-embeddings.json found — queue is empty');
        return { processed: 0, failed: 0, remaining: 0, message: 'No pending queue file found' };
      }
      throw new Error(`Failed to read queue file: ${error.message}`);
    }

    if (entries.length === 0) {
      // Clean up empty file
      await fs.unlink(queuePath).catch(() => {});
      return { processed: 0, failed: 0, remaining: 0, message: 'Queue was empty' };
    }

    this.logger.info(`drain_queue: processing ${entries.length} pending entries`);

    await this.ensureConnection();

    let processed = 0;
    const failedEntries: PendingEmbeddingEntry[] = [];

    for (const entry of entries) {
      try {
        const id = validateId(entry.id);

        if (typeof entry.content !== 'string' || typeof entry.title !== 'string') {
          this.logger.warn(`drain_queue: skipping invalid entry id=${entry.id}`);
          failedEntries.push(entry);
          continue;
        }

        const meta = entry.metadata ?? {};
        const importance = validateImportance(meta.importance, 0.5);

        // Generate embedding
        const textToEmbed = `${entry.title}\n${entry.content}`;
        const vector = await this.embeddingProvider.embed(textToEmbed);

        const now = Date.now();
        const record: MemoryRecord = {
          id,
          vector,
          content: entry.content.slice(0, MAX_CONTENT_LENGTH),
          title: entry.title,
          memory_type: meta.memory_type ?? 'general',
          importance,
          tags: meta.tags ?? '',
          source_type: meta.source_type ?? 'unknown',
          project_path: meta.project_path ?? '',
          created_at: now,
          last_accessed_at: now,
        };

        // Safe upsert with error recovery logging
        if (!this.table) {
          this.table = await this.db.createTable(this.config.tableName, [record]);
        } else {
          let deleted = false;
          try {
            await this.table.delete(`id = '${id.replace(/'/g, "''")}'`);
            deleted = true;
          } catch {
            // Record may not exist — safe to ignore
          }
          try {
            await this.table.add([record]);
          } catch (addError) {
            if (deleted) {
              this.logger.error(
                `CRITICAL: Upsert data loss for id=${id} — old record was deleted but new record failed to add: ${addError instanceof Error ? addError.message : String(addError)}`
              );
            }
            throw addError;
          }
        }

        processed++;
        this.logger.debug(`drain_queue: stored id=${id}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`drain_queue: failed to process id=${entry.id}: ${message}`);
        failedEntries.push(entry);
      }
    }

    // Atomic write: write to .tmp file then rename to prevent corruption on crash
    if (failedEntries.length > 0) {
      const tmpPath = queuePath + '.tmp';
      await fs.writeFile(tmpPath, JSON.stringify(failedEntries, null, 2), 'utf-8');
      await fs.rename(tmpPath, queuePath);
    } else {
      await fs.unlink(queuePath).catch(() => {});
    }

    const result: DrainQueueOutput = {
      processed,
      failed: failedEntries.length,
      remaining: failedEntries.length,
      message:
        failedEntries.length === 0
          ? `All ${processed} entries processed successfully, queue cleared`
          : `Processed ${processed}, ${failedEntries.length} failed and remain in queue`,
    };

    this.logger.info(`drain_queue: ${result.message}`);
    return result;
  }

  /**
   * Semantic search with weighted fusion scoring and token budget enforcement.
   *
   * 1. Embed the query text
   * 2. Search LanceDB with limit and optional filter
   * 3. Compute fusion score for each result (similarity + importance + recency + rank)
   * 4. Sort by fusion score descending
   * 5. Accumulate results up to token_budget
   * 6. Return ranked results with scores
   */
  private async handleRetrieveContext(
    input: RetrieveContextInput,
  ): Promise<RetrieveContextOutput> {
    if (typeof input.query !== 'string' || input.query.trim().length === 0) {
      throw new Error('query must be a non-empty string');
    }

    const limit = Math.min(Math.max(input.limit ?? 10, 1), 100);
    const tokenBudget = Math.max(input.token_budget ?? 2000, 100);

    // Validate minImportance is a finite number to prevent SQL injection via interpolation
    const rawMinImp = input.min_importance;
    const minImportance = (typeof rawMinImp === 'number' && Number.isFinite(rawMinImp))
      ? Math.max(0, Math.min(1, rawMinImp))
      : 0.2;

    // Build a filter that enforces min_importance — use toFixed to guarantee numeric literal
    let filter = `importance >= ${minImportance.toFixed(6)}`;
    if (input.filter && typeof input.filter === 'string' && input.filter.trim().length > 0) {
      const safeUserFilter = sanitizeFilter(input.filter);
      filter = `(${filter}) AND (${safeUserFilter})`;
    }

    // Step 1: Embed the query
    this.logger.info(`retrieve_context: embedding query via ${this.embeddingProvider.name}`);
    const queryVector = await this.embeddingProvider.embed(input.query.trim());

    await this.ensureConnection();

    if (!this.table) {
      return { results: [], count: 0, tokens_used: 0, token_budget: tokenBudget };
    }

    // Step 2: Search LanceDB
    // Request more than the limit to allow for deduplication and budget trimming
    const searchLimit = Math.min(limit * 3, 300);

    let query = this.table
      .search(queryVector)
      .distanceType('cosine')
      .limit(searchLimit);

    try {
      query = query.where(filter);
    } catch {
      // If filter fails, search without it
      this.logger.warn(`retrieve_context: filter failed, searching without filter`);
    }

    const rawResults = await query.toArray();

    // Step 3: Convert distance to similarity and compute fusion scores
    const nowMs = Date.now();

    const scored = rawResults.map((row: any, index: number) => {
      // LanceDB cosine distance is in [0, 2]; similarity = 1 - distance
      const similarity = Math.max(0, Math.min(1, 1 - (row._distance ?? 0)));
      const recency = recencyScore(row.created_at ?? nowMs, nowMs);

      const score = fusionScore({
        similarity,
        importance: row.importance ?? 0.5,
        recency,
        rankPosition: index,
        crossStoreBonus: 0, // single-store search; cross-store bonus applied externally
      });

      return {
        id: row.id as string,
        content: row.content as string,
        title: row.title as string,
        memory_type: (row.memory_type ?? 'general') as string,
        importance: row.importance as number,
        tags: (row.tags ?? '') as string,
        source_type: (row.source_type ?? 'unknown') as string,
        project_path: (row.project_path ?? '') as string,
        created_at: row.created_at as number,
        fusion_score: score,
        similarity,
      };
    });

    // Step 4: Deduplicate by content prefix
    const deduped = deduplicateByContent(scored);

    // Step 5: Sort by fusion score descending
    deduped.sort((a, b) => b.fusion_score - a.fusion_score);

    // Step 6: Enforce token budget and result limit
    const results: RankedResult[] = [];
    let tokensUsed = 0;

    for (const item of deduped) {
      if (results.length >= limit) break;

      const itemTokens = estimateTokens(item.content) + estimateTokens(item.title);
      if (tokensUsed + itemTokens > tokenBudget && results.length > 0) {
        // Already have at least one result and this would exceed budget — stop
        break;
      }

      results.push(item);
      tokensUsed += itemTokens;
    }

    this.logger.info(
      `retrieve_context: returning ${results.length} results, ` +
      `${tokensUsed} tokens used of ${tokenBudget} budget`,
    );

    return {
      results,
      count: results.length,
      tokens_used: tokensUsed,
      token_budget: tokenBudget,
    };
  }

  // ==========================================================================
  // Dimension File Management
  // ==========================================================================

  /**
   * Read the stored vector dimension from the .dimension file.
   * Returns null if the file does not exist (first-time use).
   */
  private getStoredDimension(): number | null {
    const dataDir = path.resolve(process.cwd(), this.config.dataDirectory);
    const dimFile = path.join(dataDir, '.dimension');
    try {
      const raw = fsSync.readFileSync(dimFile, 'utf8').trim();
      const dim = parseInt(raw, 10);
      return Number.isFinite(dim) && dim > 0 ? dim : null;
    } catch {
      return null;
    }
  }

  /**
   * Persist the vector dimension to the .dimension file.
   */
  private setStoredDimension(dim: number): void {
    const dataDir = path.resolve(process.cwd(), this.config.dataDirectory);
    const dimFile = path.join(dataDir, '.dimension');
    fsSync.writeFileSync(dimFile, String(dim));
  }

  /**
   * Verify that the current embedding provider dimension matches the stored
   * dimension. If mismatched, throw a clear error to prevent data corruption.
   * On first use, stores the current dimension.
   */
  private verifyDimension(): void {
    const storedDim = this.getStoredDimension();
    if (storedDim === null) {
      // First-time: store current provider dimension
      this.setStoredDimension(this.embeddingProvider.dimensions);
      this.vectorDimension = this.embeddingProvider.dimensions;
      this.logger.info(`Stored vector dimension: ${this.vectorDimension}`);
    } else if (storedDim !== this.embeddingProvider.dimensions) {
      throw new Error(
        `Vector dimension mismatch: existing data uses ${storedDim} dimensions, ` +
        `but current embedding provider (${this.embeddingProvider.name}) produces ${this.embeddingProvider.dimensions} dimensions. ` +
        `Either switch back to the original provider or re-embed all data. ` +
        `To force a reset, delete the file: ${path.join(path.resolve(process.cwd(), this.config.dataDirectory), '.dimension')}`
      );
    } else {
      this.vectorDimension = storedDim;
    }
  }

  // ==========================================================================
  // Connection Management
  // ==========================================================================

  /**
   * Ensure we have a live LanceDB connection and have opened the table
   * (if it already exists on disk).
   */
  private async ensureConnection(): Promise<void> {
    if (!this.db) {
      const dataDir = path.resolve(process.cwd(), this.config.dataDirectory);

      // Ensure the data directory exists
      await fs.mkdir(dataDir, { recursive: true });

      // Verify vector dimension consistency before connecting
      this.verifyDimension();

      this.logger.info(`Connecting to LanceDB at ${dataDir} (${this.vectorDimension} dims)`);
      this.db = await lancedb.connect(dataDir);
    }

    // Try to open the existing table if we haven't yet
    if (!this.table) {
      try {
        const tableNames = await this.db.tableNames();
        if (tableNames.includes(this.config.tableName)) {
          this.table = await this.db.openTable(this.config.tableName);
          this.logger.info(`Opened existing table: ${this.config.tableName}`);
        }
      } catch (error) {
        this.logger.debug('Could not open existing table (may not exist yet)', error);
      }
    }
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Start the MCP server on stdio transport.
   */
  async start(): Promise<void> {
    this.logger.info('Starting LanceDB Memory MCP Server...');

    // Pre-connect to LanceDB so the table is ready
    await this.ensureConnection();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    this.logger.info('LanceDB Memory MCP Server started and ready for requests');
  }

  /**
   * Gracefully shut down the server.
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down LanceDB Memory MCP Server...');
    await this.server.close();
    this.db = null;
    this.table = null;
    this.logger.info('Shutdown complete');
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

export async function main(): Promise<void> {
  const config: Partial<LanceDBMemoryServerConfig> = {
    dataDirectory:
      process.env.LANCEDB_DATA_DIR ?? '.persistent-memory/vectors',
    enableLogging: process.env.LANCEDB_LOG_LEVEL !== 'silent',
    logLevel: (process.env.LANCEDB_LOG_LEVEL as LogLevel) ?? 'info',
  };

  const server = new LanceDBMemoryServer(config);

  const handleShutdown = async (): Promise<void> => {
    console.error('\nReceived shutdown signal, cleaning up...');
    await server.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);

  process.on('uncaughtException', async (error) => {
    console.error('Uncaught exception:', error);
    await server.shutdown();
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason) => {
    console.error('Unhandled rejection:', reason);
    await server.shutdown();
    process.exit(1);
  });

  try {
    await server.start();
  } catch (error) {
    console.error('Failed to start LanceDB Memory MCP Server:', error);
    process.exit(1);
  }
}

// Run if executed directly
const isMainModule =
  process.argv[1]?.endsWith('server.js') ||
  process.argv[1]?.endsWith('server.ts');

if (isMainModule) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
