/**
 * LEANN Search MCP Server - Core Server Implementation
 *
 * Implements the MCP protocol server for semantic code search using LEANN backend.
 * Handles tool registration, lifecycle management, and request routing.
 *
 * Tools provided:
 * - search_code: Natural language code search
 * - index_repository: Repository indexing
 * - index_code: Single code snippet indexing
 * - find_similar_code: Code similarity search
 * - get_stats: Index statistics
 *
 * @module mcp-servers/leann-search/server
 */

import * as fs from 'fs/promises';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { LEANNBackend } from '../../god-agent/core/vector-db/leann-backend.js';
import { DualCodeEmbeddingProvider } from '../../god-agent/core/search/dual-code-embedding.js';
import { DistanceMetric } from '../../god-agent/core/vector-db/types.js';
import { VECTOR_DIM } from '../../god-agent/core/validation/index.js';

import type {
  LEANNMCPServerConfig,
  LEANNMCPServerState,
  CodeMetadata,
  VectorID,
} from './types.js';

// Import tool handlers and definitions
import {
  semanticCodeSearch,
  SEMANTIC_CODE_SEARCH_DEFINITION,
  type ToolExecutionContext,
} from './tools/semantic-code-search.js';

import {
  indexRepository,
  indexCode,
  INDEX_REPOSITORY_DEFINITION,
  INDEX_CODE_DEFINITION,
} from './tools/index-repository.js';

import {
  findSimilarCode,
  FIND_SIMILAR_CODE_DEFINITION,
} from './tools/find-similar-code.js';

import {
  getIndexStats,
  GET_INDEX_STATS_DEFINITION,
} from './tools/get-index-stats.js';

import {
  processQueue,
  PROCESS_QUEUE_DEFINITION,
} from './tools/process-queue.js';

// ============================================================================
// Constants
// ============================================================================

/** Server name for MCP protocol */
const SERVER_NAME = 'leann-search';

/** Server version */
const SERVER_VERSION = '1.0.0';

/** Default configuration values */
const DEFAULT_CONFIG: LEANNMCPServerConfig = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  leannConfig: {
    hubCacheRatio: 0.1,
    graphPruningRatio: 0.7,
    batchSize: 100,
    maxRecomputeLatencyMs: 50,
    efSearch: 50,
    hubDegreeThreshold: 10,
  },
  persistPath: './vector_db_leann',
  autoLoad: true,
  autoSave: true,
  autoSaveInterval: 60000, // 1 minute
  maxChunkSize: 4000,  // Increased to handle larger code blocks while staying under embedder limit
  defaultSearchLimit: 10,
  enableLogging: true,
  logLevel: 'info',
};

// ============================================================================
// Logger Utility
// ============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Simple logger with level filtering
 */
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
    if (this.shouldLog('debug')) {
      console.error(`[DEBUG] ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.error(`[INFO] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.error(`[WARN] ${message}`, ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  }
}

// ============================================================================
// LEANN MCP Server Class
// ============================================================================

/**
 * LEANN MCP Server
 *
 * Main server class that:
 * 1. Initializes the MCP protocol server
 * 2. Registers all 5 code search tools
 * 3. Manages LEANN backend and embedding provider lifecycle
 * 4. Routes tool calls to appropriate handlers
 * 5. Handles graceful shutdown and persistence
 */
export class LEANNMCPServer {
  private readonly server: Server;
  private readonly config: LEANNMCPServerConfig;
  private readonly logger: Logger;

  /** LEANN backend instance */
  private backend: LEANNBackend | null = null;

  /** Dual code embedding provider instance */
  private embeddingProvider: DualCodeEmbeddingProvider | null = null;

  /** Metadata storage (maps vector IDs to code metadata) */
  private metadataStore: Map<VectorID, CodeMetadata>;

  /** Code content storage (maps vector IDs to actual code) */
  private codeStore: Map<VectorID, string>;

  /** Server state tracking */
  private state: LEANNMCPServerState;

  /** Auto-save interval handle */
  private autoSaveInterval: ReturnType<typeof setInterval> | null = null;

  /** Guard: true while indexing is in progress. Auto-save skips when set to prevent saving partially-built HNSW graphs. */
  private isIndexing = false;

  /** When true, auto-save is disabled to prevent overwriting a good on-disk index after a bad load. */
  private saveDisabled = false;

  /** Mutex for serializing indexing operations from concurrent daemon clients. */
  private indexingMutex: Promise<void> = Promise.resolve();

  /**
   * Create a new LEANN MCP Server
   *
   * @param config - Server configuration options
   */
  constructor(config: Partial<LEANNMCPServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.logger = new Logger(
      this.config.logLevel ?? 'info',
      this.config.enableLogging ?? true
    );

    // Initialize state
    this.state = {
      initialized: false,
      backendLoaded: false,
      indexedCount: 0,
      startedAt: Date.now(),
      operationCount: 0,
      errorCount: 0,
    };

    // Initialize storage maps
    this.metadataStore = new Map();
    this.codeStore = new Map();

    // Create MCP server instance
    this.server = new Server(
      {
        name: this.config.name,
        version: this.config.version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Set up request handlers
    this.setupHandlers();
  }

  // ==========================================================================
  // Handler Setup
  // ==========================================================================

  /**
   * Set up MCP request handlers for tools listing and tool calls
   */
  private setupHandlers(): void {
    // Handler for listing available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      this.logger.debug('Handling ListTools request');

      return {
        tools: [
          SEMANTIC_CODE_SEARCH_DEFINITION,
          INDEX_REPOSITORY_DEFINITION,
          INDEX_CODE_DEFINITION,
          FIND_SIMILAR_CODE_DEFINITION,
          GET_INDEX_STATS_DEFINITION,
          PROCESS_QUEUE_DEFINITION,
        ],
      };
    });

    // Handler for tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      this.logger.debug(`Handling CallTool request: ${name}`);
      this.state.operationCount++;
      this.state.lastOperationAt = Date.now();

      // Ensure server is initialized
      if (!this.backend || !this.embeddingProvider) {
        throw new McpError(
          ErrorCode.InternalError,
          'Server not initialized. Call initialize() first.'
        );
      }

      // Build tool execution context
      const context: ToolExecutionContext = {
        backend: this.backend,
        embeddingProvider: this.embeddingProvider,
        metadataStore: this.metadataStore,
        codeStore: this.codeStore,
        requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      };

      try {
        const result = await this.executeTool(name, args ?? {}, context);

        // Update indexed count after indexing operations
        if (name === 'index_repository' || name === 'index_code' || name === 'process_queue') {
          this.state.indexedCount = this.backend.count();
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        this.state.errorCount++;
        this.logger.error(`Tool execution failed: ${name}`, error);

        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });
  }

  /**
   * Execute a tool by name
   *
   * @param name - Tool name
   * @param args - Tool arguments
   * @param context - Execution context
   * @returns Tool result
   */
  private async executeTool(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<unknown> {
    switch (name) {
      case 'search_code':
        return semanticCodeSearch(args as any, context);

      case 'index_repository':
        this.isIndexing = true;
        try { return await indexRepository(args as any, context); }
        finally { this.isIndexing = false; }

      case 'index_code':
        this.isIndexing = true;
        try { return await indexCode(args as any, context); }
        finally { this.isIndexing = false; }

      case 'find_similar_code':
        return findSimilarCode(args as any, context);

      case 'get_stats':
        return getIndexStats(args as any, context);

      case 'process_queue':
        this.isIndexing = true;
        try { return await processQueue(args as any, context); }
        finally { this.isIndexing = false; }

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  }

  // ==========================================================================
  // Lifecycle Management
  // ==========================================================================

  /**
   * Initialize the server components
   *
   * Initializes:
   * 1. DualCodeEmbeddingProvider for query/code embeddings
   * 2. LEANNBackend for vector storage and search
   * 3. Auto-save interval (if configured)
   *
   * @throws Error if initialization fails
   */
  async initialize(): Promise<void> {
    if (this.state.initialized) {
      this.logger.warn('Server already initialized');
      return;
    }

    this.logger.info('Initializing LEANN MCP Server...');

    try {
      // Initialize embedding provider
      this.logger.debug('Initializing DualCodeEmbeddingProvider...');
      this.embeddingProvider = new DualCodeEmbeddingProvider({
        dimension: VECTOR_DIM,
        cacheEnabled: true,
        cacheMaxSize: 1000,
      });

      // Initialize LEANN backend
      this.logger.debug('Initializing LEANNBackend...');
      this.backend = new LEANNBackend(
        VECTOR_DIM,
        DistanceMetric.COSINE,
        this.config.leannConfig
      );

      // Load existing index if configured
      if (this.config.autoLoad && this.config.persistPath) {
        await this.loadIndex();
      }

      // Set up auto-save if configured
      if (this.config.autoSave && this.config.autoSaveInterval) {
        this.startAutoSave();
      }

      this.state.initialized = true;
      this.state.backendLoaded = true;
      this.state.indexedCount = this.backend.count();

      this.logger.info(
        `LEANN MCP Server initialized with ${this.state.indexedCount} indexed items`
      );
    } catch (error) {
      this.logger.error('Initialization failed', error);
      throw error;
    }
  }

  /**
   * Start the MCP server with stdio transport
   *
   * This connects the server to stdin/stdout for communication
   * with MCP clients.
   */
  async start(): Promise<void> {
    // Ensure initialized
    if (!this.state.initialized) {
      await this.initialize();
    }

    this.logger.info('Starting LEANN MCP Server on stdio transport...');

    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    this.logger.info('LEANN MCP Server started and ready for requests');
  }

  /**
   * Gracefully shutdown the server
   *
   * Performs:
   * 1. Stops auto-save interval
   * 2. Persists index to disk
   * 3. Closes MCP server connection
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down LEANN MCP Server...');

    // Stop auto-save
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }

    // Persist index
    if (this.config.autoSave) {
      await this.saveIndex();
    }

    // Close server
    await this.server.close();

    this.state.initialized = false;
    this.logger.info('LEANN MCP Server shutdown complete');
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Load index from disk
   */
  private async loadIndex(): Promise<void> {
    if (!this.config.persistPath || !this.backend) {
      return;
    }

    try {
      const loaded = await this.backend.load(this.config.persistPath);
      if (loaded) {
        this.logger.info(`Loaded index from ${this.config.persistPath}`);
        this.state.backendLoaded = true;
      } else {
        this.logger.debug('No existing index found, starting fresh');
      }
    } catch (error) {
      this.logger.warn('Failed to load index, starting fresh', error);
    }

    // Load verification: compare loaded count against meta sidecar
    const metaPath = this.config.persistPath + '.meta';
    try {
      const metaRaw = await fs.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(metaRaw);
      const loadedCount = this.backend.count();

      if (meta.vectorCount > 100 && loadedCount === 0) {
        this.logger.error(
          `LOAD VERIFICATION FAILED: meta sidecar says ${meta.vectorCount} vectors, ` +
          `but loaded ${loadedCount}. Disabling auto-save to prevent data loss. ` +
          `Check ${this.config.persistPath} for corruption.`
        );
        this.saveDisabled = true;
      } else if (meta.vectorCount > 0 && loadedCount > 0 && loadedCount < meta.vectorCount * 0.5) {
        this.logger.warn(
          `Load verification warning: meta says ${meta.vectorCount} vectors, ` +
          `loaded only ${loadedCount}. Index may be partially corrupt.`
        );
        // Don't disable save — partial load is better than nothing
      }
    } catch {
      // No meta file — first run or migration, nothing to verify against
    }

    // Load metadata and code stores from sidecar file
    const storesPath = this.config.persistPath + '.stores';
    try {
      const raw = await fs.readFile(storesPath, 'utf-8');
      const storesData = JSON.parse(raw);
      if (storesData.metadata) {
        for (const [id, meta] of Object.entries(storesData.metadata)) {
          this.metadataStore.set(id as VectorID, meta as CodeMetadata);
        }
      }
      if (storesData.code) {
        for (const [id, code] of Object.entries(storesData.code)) {
          this.codeStore.set(id as VectorID, code as string);
        }
      }
      this.logger.info(`Loaded ${this.metadataStore.size} metadata entries and ${this.codeStore.size} code entries`);
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        this.logger.warn('Failed to load metadata/code stores', err);
      }
    }
  }

  /**
   * Save index to disk
   */
  private async saveIndex(): Promise<void> {
    if (!this.config.persistPath || !this.backend) {
      return;
    }

    if (this.saveDisabled) {
      this.logger.warn('Save disabled due to load verification failure — skipping');
      return;
    }

    if (this.isIndexing) {
      this.logger.debug('Skipping save — indexing in progress');
      return;
    }

    const currentCount = this.backend.count();
    if (currentCount === 0) {
      this.logger.debug('Skipping save — no vectors in backend');
      return;
    }

    // Save guard: read meta sidecar to check what's on disk
    const metaPath = this.config.persistPath + '.meta';
    try {
      const metaRaw = await fs.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(metaRaw);
      if (meta.vectorCount > currentCount && meta.vectorCount > Math.max(10, currentCount * 2)) {
        this.logger.warn(
          `Save guard: refusing to overwrite index with ${meta.vectorCount} vectors ` +
          `using in-memory index with only ${currentCount} vectors`
        );
        return;
      }
    } catch {
      // No meta file or parse error — proceed with save
    }

    try {
      await this.backend.save(this.config.persistPath);
      this.logger.debug(`Saved index to ${this.config.persistPath} (${currentCount} vectors)`);
    } catch (error) {
      this.logger.error('Failed to save index', error);
      return; // Don't write meta if save failed
    }

    // Save metadata and code stores to sidecar file
    const storesPath = this.config.persistPath + '.stores';
    try {
      const storesData = {
        metadata: Object.fromEntries(this.metadataStore),
        code: Object.fromEntries(this.codeStore),
      };
      const tmpPath = storesPath + '.tmp';
      await fs.writeFile(tmpPath, JSON.stringify(storesData), 'utf-8');
      await fs.rename(tmpPath, storesPath);
      this.logger.debug(`Saved ${this.metadataStore.size} metadata entries and ${this.codeStore.size} code entries`);
    } catch (error) {
      this.logger.warn('Failed to save metadata/code stores', error);
    }

    // Write meta sidecar AFTER successful save
    try {
      const metaData = {
        vectorCount: currentCount,
        metadataCount: this.metadataStore.size,
        savedAt: new Date().toISOString(),
        pid: process.pid,
        formatVersion: 2,
      };
      const tmpMeta = metaPath + '.tmp';
      await fs.writeFile(tmpMeta, JSON.stringify(metaData, null, 2), 'utf-8');
      await fs.rename(tmpMeta, metaPath);
    } catch (error) {
      this.logger.warn('Failed to write meta sidecar', error);
    }
  }

  /**
   * Start auto-save interval
   */
  private startAutoSave(): void {
    if (this.autoSaveInterval) {
      return;
    }

    const interval = this.config.autoSaveInterval ?? 60000;
    this.autoSaveInterval = setInterval(async () => {
      if (this.backend && this.state.initialized) {
        await this.saveIndex();
      }
    }, interval);

    this.logger.debug(`Auto-save enabled with ${interval}ms interval`);
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Get current server state
   */
  getState(): LEANNMCPServerState {
    return { ...this.state };
  }

  /**
   * Get server configuration
   */
  getConfig(): LEANNMCPServerConfig {
    return { ...this.config };
  }

  /**
   * Get indexed item count
   */
  getIndexedCount(): number {
    return this.backend?.count() ?? 0;
  }

  /**
   * Get tool execution context for external use
   * (useful for testing or programmatic access)
   */
  getExecutionContext(): ToolExecutionContext | null {
    if (!this.backend || !this.embeddingProvider) {
      return null;
    }

    return {
      backend: this.backend,
      embeddingProvider: this.embeddingProvider,
      metadataStore: this.metadataStore,
      codeStore: this.codeStore,
    };
  }

  // ==========================================================================
  // Daemon Support API
  // ==========================================================================

  /**
   * Get the vector count from the backend.
   * Used by the daemon to report index size after initialization.
   */
  getVectorCount(): number {
    return this.backend?.count() ?? 0;
  }

  /**
   * Get the list of tool definitions for MCP ListTools responses.
   * Used by the daemon to register tools on per-connection MCP Server instances.
   */
  getToolDefinitions(): Array<Record<string, unknown>> {
    return [
      SEMANTIC_CODE_SEARCH_DEFINITION,
      INDEX_REPOSITORY_DEFINITION,
      INDEX_CODE_DEFINITION,
      FIND_SIMILAR_CODE_DEFINITION,
      GET_INDEX_STATS_DEFINITION,
      PROCESS_QUEUE_DEFINITION,
    ];
  }

  /**
   * Execute a tool by name with the given arguments.
   * Used by the daemon to delegate tool calls from per-connection MCP Servers
   * to the shared backend/stores owned by this instance.
   *
   * @param name - Tool name (e.g. 'search_code', 'index_repository')
   * @param args - Tool arguments object
   * @returns MCP CallToolResult-shaped object with content array
   */
  async executeToolCall(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    if (!this.backend || !this.embeddingProvider) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Server not initialized' }) }],
        isError: true,
      };
    }

    const context: ToolExecutionContext = {
      backend: this.backend,
      embeddingProvider: this.embeddingProvider,
      metadataStore: this.metadataStore,
      codeStore: this.codeStore,
      requestId: `daemon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };

    try {
      this.state.operationCount++;
      this.state.lastOperationAt = Date.now();

      const isWriteOp = name === 'index_repository' || name === 'index_code' || name === 'process_queue';
      let result: unknown;

      if (isWriteOp) {
        // Serialize indexing operations to prevent concurrent HNSW mutation
        let resolve: () => void;
        const myTurn = new Promise<void>(r => { resolve = r; });
        const prevMutex = this.indexingMutex;
        this.indexingMutex = myTurn;
        await prevMutex;
        try {
          result = await this.executeTool(name, args, context);
          this.state.indexedCount = this.backend.count();
        } finally {
          resolve!();
        }
      } else {
        result = await this.executeTool(name, args, context);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      this.state.errorCount++;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
        }],
        isError: true,
      };
    }
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

/**
 * Main entry point for CLI execution
 *
 * Creates server, sets up signal handlers, and starts serving.
 */
export async function main(): Promise<void> {
  const server = new LEANNMCPServer({
    persistPath: process.env.LEANN_PERSIST_PATH ?? './vector_db_leann',
    enableLogging: process.env.LEANN_LOG_LEVEL !== 'silent',
    logLevel: (process.env.LEANN_LOG_LEVEL as LogLevel) ?? 'info',
  });

  // Handle graceful shutdown
  const handleShutdown = async (): Promise<void> => {
    console.error('\nReceived shutdown signal, cleaning up...');
    await server.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);

  // Handle uncaught errors
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

  // Start server
  try {
    await server.start();
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Export for programmatic use
export type { ToolExecutionContext };

// Run if executed directly
// Note: This check works for ESM modules
const isMainModule = process.argv[1]?.endsWith('server.js') ||
                     process.argv[1]?.endsWith('server.ts');

if (isMainModule) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
