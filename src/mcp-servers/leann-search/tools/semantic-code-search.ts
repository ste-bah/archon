/**
 * LEANN Search MCP Server - Semantic Code Search Tool
 *
 * Implements natural language code search using the LEANN backend
 * and DualCodeEmbeddingProvider for optimal query understanding.
 *
 * @module mcp-servers/leann-search/tools/semantic-code-search
 */

import type { LEANNBackend } from '../../../god-agent/core/vector-db/leann-backend.js';
import type { DualCodeEmbeddingProvider } from '../../../god-agent/core/search/dual-code-embedding.js';
import type {
  SearchCodeInput,
  SearchCodeOutput,
  CodeSearchResult,
  CodeMetadata,
  FilterCondition,
  FilterGroup,
  SearchMode,
  LEANNMCPError,
  LEANNErrorCode,
} from '../types.js';
import type { VectorID, SearchResult } from '../../../god-agent/core/vector-db/types.js';

// ============================================================================
// Shared Types
// ============================================================================

/**
 * Execution context provided to all tools
 * Contains backend and embedding provider instances
 */
export interface ToolExecutionContext {
  /** LEANN backend instance for vector operations */
  backend: LEANNBackend;
  /** Dual code embedding provider for query/code embeddings */
  embeddingProvider: DualCodeEmbeddingProvider;
  /** Metadata storage (maps vector IDs to code metadata) */
  metadataStore: Map<VectorID, CodeMetadata>;
  /** Code content storage (maps vector IDs to actual code) */
  codeStore: Map<VectorID, string>;
  /** Request ID for tracing */
  requestId?: string;
}

/**
 * Generic tool handler function signature
 */
export type ToolHandler<TInput, TOutput> = (
  input: TInput,
  context: ToolExecutionContext
) => Promise<TOutput>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a value matches a filter condition
 */
function matchesFilter(
  metadata: CodeMetadata,
  condition: FilterCondition
): boolean {
  const fieldValue = metadata[condition.field as keyof CodeMetadata];

  switch (condition.operator) {
    case 'eq':
      return fieldValue === condition.value;
    case 'neq':
      return fieldValue !== condition.value;
    case 'gt':
      return typeof fieldValue === 'number' && fieldValue > (condition.value as number);
    case 'gte':
      return typeof fieldValue === 'number' && fieldValue >= (condition.value as number);
    case 'lt':
      return typeof fieldValue === 'number' && fieldValue < (condition.value as number);
    case 'lte':
      return typeof fieldValue === 'number' && fieldValue <= (condition.value as number);
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(fieldValue);
    case 'nin':
      return Array.isArray(condition.value) && !condition.value.includes(fieldValue);
    case 'contains':
      return typeof fieldValue === 'string' && fieldValue.includes(condition.value as string);
    case 'startsWith':
      return typeof fieldValue === 'string' && fieldValue.startsWith(condition.value as string);
    case 'endsWith':
      return typeof fieldValue === 'string' && fieldValue.endsWith(condition.value as string);
    default:
      return true;
  }
}

/**
 * Check if metadata matches a filter group (recursive)
 */
function matchesFilterGroup(
  metadata: CodeMetadata,
  filterGroup: FilterGroup
): boolean {
  const results = filterGroup.conditions.map((condition) => {
    if ('logic' in condition) {
      return matchesFilterGroup(metadata, condition as FilterGroup);
    }
    return matchesFilter(metadata, condition as FilterCondition);
  });

  if (filterGroup.logic === 'and') {
    return results.every(Boolean);
  }
  return results.some(Boolean);
}

/**
 * Apply filters to metadata
 */
function applyFilters(
  metadata: CodeMetadata,
  filters?: FilterCondition[] | FilterGroup
): boolean {
  if (!filters) return true;

  // Handle array of conditions (implicit AND)
  if (Array.isArray(filters)) {
    return filters.every((condition) => matchesFilter(metadata, condition));
  }

  // Handle filter group
  return matchesFilterGroup(metadata, filters);
}

/**
 * Check if file path matches a glob pattern (simplified)
 */
function matchesGlobPattern(filePath: string, pattern: string): boolean {
  // Convert glob to regex (simplified version)
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filePath);
}

/**
 * Calculate deduplication hash for a code result
 */
function getDeduplicationKey(result: CodeSearchResult): string {
  return `${result.metadata.filePath}:${result.metadata.startLine}-${result.metadata.endLine}`;
}

// ============================================================================
// Semantic Code Search Tool
// ============================================================================

/**
 * Perform semantic code search using natural language query
 *
 * This tool:
 * 1. Embeds the natural language query using DualCodeEmbeddingProvider
 * 2. Searches the LEANN backend for similar code vectors
 * 3. Applies metadata filters (language, file pattern, repository)
 * 4. Returns ranked code search results
 *
 * @param input - Search parameters (query, filters, options)
 * @param context - Tool execution context with backend and providers
 * @returns Search results with metadata and similarity scores
 */
export async function semanticCodeSearch(
  input: SearchCodeInput,
  context: ToolExecutionContext
): Promise<SearchCodeOutput> {
  const startTime = Date.now();
  let embeddingTimeMs = 0;

  // Validate input
  if (!input.query || input.query.trim().length === 0) {
    return {
      success: false,
      results: [],
      totalResults: 0,
      query: input.query || '',
      mode: input.mode ?? 'semantic',
      searchTimeMs: Date.now() - startTime,
      embeddingTimeMs: 0,
      truncated: false,
      message: 'Query cannot be empty',
    };
  }

  // Determine search mode
  const mode: SearchMode = input.mode ?? 'semantic';
  const limit = input.limit ?? 10;
  const minScore = input.minScore ?? 0.0;

  // Generate query embedding
  const embeddingStart = Date.now();
  let queryEmbedding: Float32Array;

  try {
    // Use embedQuery for natural language queries
    queryEmbedding = await context.embeddingProvider.embedQuery(input.query);
    embeddingTimeMs = Date.now() - embeddingStart;
  } catch (error) {
    return {
      success: false,
      results: [],
      totalResults: 0,
      query: input.query,
      mode,
      searchTimeMs: Date.now() - startTime,
      embeddingTimeMs: Date.now() - embeddingStart,
      truncated: false,
      message: `Failed to generate query embedding: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }

  // Search the backend
  // Request more results than needed to account for filtering
  const searchLimit = Math.min(limit * 3, context.backend.count());
  const searchResults: SearchResult[] = context.backend.search(
    queryEmbedding,
    searchLimit,
    false // Don't include vectors in results
  );

  // Filter and transform results
  const filteredResults: CodeSearchResult[] = [];
  const seenKeys = new Set<string>();

  for (const result of searchResults) {
    // Get metadata
    const metadata = context.metadataStore.get(result.id);
    if (!metadata) continue;

    // Apply minimum score filter
    if (result.similarity < minScore) continue;

    // Apply language filter
    if (input.languages && input.languages.length > 0) {
      if (!input.languages.includes(metadata.language)) continue;
    }

    // Apply symbol type filter
    if (input.symbolTypes && input.symbolTypes.length > 0) {
      if (!input.symbolTypes.includes(metadata.symbolType)) continue;
    }

    // Apply file pattern filter
    if (input.filePattern) {
      if (!matchesGlobPattern(metadata.filePath, input.filePattern)) continue;
    }

    // Apply repository filter
    if (input.repository) {
      if (metadata.repository !== input.repository) continue;
    }

    // Apply custom filters
    if (!applyFilters(metadata, input.filters)) continue;

    // Check for deduplication
    if (input.deduplicate !== false) {
      const key = getDeduplicationKey({
        vectorId: result.id,
        score: result.similarity,
        distance: 1 - result.similarity,
        metadata,
      });

      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
    }

    // Build result
    const codeResult: CodeSearchResult = {
      vectorId: result.id,
      score: result.similarity,
      distance: 1 - result.similarity, // Convert similarity to distance
      metadata,
    };

    // Include code content if requested
    if (input.includeCode) {
      const code = context.codeStore.get(result.id);
      if (code) {
        codeResult.code = code;
      }
    }

    filteredResults.push(codeResult);

    // Stop if we have enough results
    if (filteredResults.length >= limit) break;
  }

  const truncated = filteredResults.length < searchResults.length;
  const searchTimeMs = Date.now() - startTime;

  return {
    success: true,
    results: filteredResults,
    totalResults: filteredResults.length,
    query: input.query,
    mode,
    searchTimeMs,
    embeddingTimeMs,
    truncated,
    message: `Found ${filteredResults.length} matching code snippets in ${searchTimeMs}ms`,
  };
}

/**
 * MCP Tool definition for semantic_code_search
 */
export const SEMANTIC_CODE_SEARCH_DEFINITION = {
  name: 'search_code',
  description: 'Search for code using natural language queries. Returns semantically similar code snippets with metadata.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language query or code snippet to search for',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 10)',
        default: 10,
      },
      minScore: {
        type: 'number',
        description: 'Minimum similarity score (0-1, default: 0)',
        minimum: 0,
        maximum: 1,
        default: 0,
      },
      mode: {
        type: 'string',
        enum: ['semantic', 'hybrid', 'exact'],
        description: 'Search mode (default: semantic)',
        default: 'semantic',
      },
      languages: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by programming languages',
      },
      symbolTypes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by symbol types (function, class, method, etc.)',
      },
      filePattern: {
        type: 'string',
        description: 'Glob pattern to filter by file path',
      },
      repository: {
        type: 'string',
        description: 'Filter by repository name',
      },
      includeCode: {
        type: 'boolean',
        description: 'Include full code content in results (default: false)',
        default: false,
      },
      deduplicate: {
        type: 'boolean',
        description: 'Remove near-duplicate results (default: true)',
        default: true,
      },
    },
    required: ['query'],
  },
};
