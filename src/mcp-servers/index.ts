/**
 * MCP Servers
 *
 * Collection of Model Context Protocol servers for the God Agent system.
 * These servers expose various AI capabilities through the standardized
 * MCP protocol for integration with Claude and other MCP clients.
 *
 * @module mcp-servers
 *
 * Available Servers:
 * - leann-search: Semantic code search using LEANN vector backend
 *
 * @example
 * ```typescript
 * // Import LEANN search server
 * import { LEANNMCPServer } from './mcp-servers';
 *
 * // Or import the entire namespace
 * import * as mcpServers from './mcp-servers';
 * const server = new mcpServers.leannSearch.LEANNMCPServer();
 * ```
 */

// =============================================================================
// LEANN Search Server
// =============================================================================

/**
 * LEANN Search MCP Server namespace
 *
 * Provides semantic code search capabilities using the LEANN
 * (Lightweight Exact Approximate Nearest Neighbor) algorithm.
 */
export * as leannSearch from './leann-search/index.js';

/**
 * Direct export of LEANNMCPServer class for convenience
 */
export { LEANNMCPServer } from './leann-search/server.js';

/**
 * Direct export of main function for CLI usage
 */
export { main as startLeannSearch } from './leann-search/server.js';

// =============================================================================
// Shared Types
// =============================================================================

/**
 * Re-export common types used across MCP servers
 */
export type {
  // Server types
  LEANNMCPServerConfig,
  LEANNMCPServerState,
  ToolExecutionContext,

  // Code metadata
  CodeMetadata,
  SupportedLanguage,
  CodeSymbolType,

  // Search types
  SearchCodeInput,
  SearchCodeOutput,
  CodeSearchResult,
  SearchMode,
  FilterCondition,
  FilterGroup,

  // Index types
  IndexCodeInput,
  IndexCodeOutput,

  // Stats types
  GetStatsInput,
  GetStatsOutput,

  // Error types
  LEANNErrorCode,
} from './leann-search/index.js';

export { LEANNMCPError } from './leann-search/index.js';
