/**
 * LEANN Search MCP Server
 *
 * Provides semantic code search capabilities via MCP protocol.
 * Uses LEANN (Lightweight Exact Approximate Nearest Neighbor) for
 * high-performance vector similarity search with hub-aware navigation.
 *
 * Features:
 * - Natural language code search
 * - Repository indexing with automatic language detection
 * - Code similarity search
 * - Index statistics and monitoring
 *
 * @module mcp-servers/leann-search
 *
 * @example
 * ```typescript
 * // Programmatic usage
 * import { LEANNMCPServer } from './mcp-servers/leann-search';
 *
 * const server = new LEANNMCPServer({
 *   persistPath: './my-index',
 *   autoSave: true,
 * });
 *
 * await server.initialize();
 * await server.start();
 * ```
 *
 * @example
 * ```bash
 * # CLI usage
 * npx tsx src/mcp-servers/leann-search/index.ts
 *
 * # With environment variables
 * LEANN_PERSIST_PATH=./custom-path LEANN_LOG_LEVEL=debug npx tsx src/mcp-servers/leann-search/index.ts
 * ```
 */

// =============================================================================
// Server Exports
// =============================================================================

import { LEANNMCPServer, main as serverMain } from './server.js';
import type { ToolExecutionContext } from './server.js';

export { LEANNMCPServer };
export type { ToolExecutionContext };
export { serverMain as main };

// =============================================================================
// Type Exports
// =============================================================================

// Common types
export type {
  SupportedLanguage,
  CodeSymbolType,
  CodeMetadata,
} from './types.js';

// Server configuration types
export type {
  LEANNMCPServerConfig,
  LEANNMCPServerState,
  MCPToolDefinition,
  ToolContext,
  ToolResult,
} from './types.js';

// Tool: index_code types
export type {
  IndexCodeInput,
  IndexCodeOutput,
} from './types.js';

// Tool: search_code types
export type {
  SearchMode,
  FilterOperator,
  FilterCondition,
  FilterGroup,
  SearchCodeInput,
  SearchCodeOutput,
  CodeSearchResult,
} from './types.js';

// Tool: get_stats types
export type {
  GetStatsInput,
  GetStatsOutput,
  CategoryBreakdown,
  MemoryStats,
  LeannIndexStats,
} from './types.js';

// Tool: clear_index types
export type {
  ClearScope,
  ClearIndexInput,
  ClearIndexOutput,
} from './types.js';

// Error types
export { LEANNErrorCode, LEANNMCPError } from './types.js';

// Re-exported types from core
export type {
  VectorID,
  SearchResult,
  DistanceMetric,
  LEANNConfig,
  LEANNStats,
} from './types.js';

// =============================================================================
// Tool Function Exports
// =============================================================================

// Export tool functions for programmatic use
export {
  // Semantic search
  semanticCodeSearch,
  SEMANTIC_CODE_SEARCH_DEFINITION,
} from './tools/semantic-code-search.js';

export {
  // Repository/code indexing
  indexRepository,
  indexCode,
  INDEX_REPOSITORY_DEFINITION,
  INDEX_CODE_DEFINITION,
} from './tools/index-repository.js';

export {
  // Code similarity
  findSimilarCode,
  FIND_SIMILAR_CODE_DEFINITION,
} from './tools/find-similar-code.js';

export {
  // Index statistics
  getIndexStats,
  getQuickStats,
  GET_INDEX_STATS_DEFINITION,
} from './tools/get-index-stats.js';

// Re-export tool handler type
export type { ToolHandler } from './tools/index.js';

// =============================================================================
// CLI Entry Point
// =============================================================================

/**
 * CLI entry point when executed directly.
 *
 * Checks if this module is being run as the main script and
 * starts the MCP server if so.
 */
const isDirectExecution = (): boolean => {
  // Check various ways the script might be executed
  const scriptPath = process.argv[1] ?? '';
  return (
    scriptPath.endsWith('leann-search/index.ts') ||
    scriptPath.endsWith('leann-search/index.js') ||
    // For ESM modules using import.meta.url
    (typeof import.meta.url === 'string' &&
      import.meta.url === `file://${process.argv[1]}`)
  );
};

if (isDirectExecution()) {
  serverMain().catch((error) => {
    console.error('Fatal error starting LEANN MCP Server:', error);
    process.exit(1);
  });
}
