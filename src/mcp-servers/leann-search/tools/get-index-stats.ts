/**
 * LEANN Search MCP Server - Get Index Stats Tool
 *
 * Implements index statistics retrieval for the LEANN semantic code search.
 * Provides detailed information about indexed code, memory usage, and LEANN metrics.
 *
 * @module mcp-servers/leann-search/tools/get-index-stats
 */

import type { ToolExecutionContext } from './semantic-code-search.js';
import type {
  GetStatsInput,
  GetStatsOutput,
  CategoryBreakdown,
  MemoryStats,
  LeannIndexStats,
  CodeMetadata,
  SupportedLanguage,
  CodeSymbolType,
} from '../types.js';
import type { LEANNStats } from '../../../god-agent/core/vector-db/leann-types.js';
import type { DistanceMetric } from '../../../god-agent/core/vector-db/types.js';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let size = bytes;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Estimate memory usage for a string
 */
function estimateStringSize(str: string): number {
  // JavaScript strings are UTF-16, so roughly 2 bytes per character
  // Plus object overhead
  return str.length * 2 + 32;
}

/**
 * Estimate memory usage for Float32Array
 */
function estimateFloat32ArraySize(arr: Float32Array): number {
  // 4 bytes per float + array overhead
  return arr.length * 4 + 24;
}

/**
 * Calculate category breakdowns from metadata
 */
function calculateBreakdowns(
  metadataStore: Map<string, CodeMetadata>,
  options: GetStatsInput
): {
  languageBreakdown?: CategoryBreakdown[];
  repositoryBreakdown?: CategoryBreakdown[];
  symbolBreakdown?: CategoryBreakdown[];
} {
  const result: {
    languageBreakdown?: CategoryBreakdown[];
    repositoryBreakdown?: CategoryBreakdown[];
    symbolBreakdown?: CategoryBreakdown[];
  } = {};

  const total = metadataStore.size;
  if (total === 0) return result;

  // Language breakdown
  if (options.includeLanguageBreakdown) {
    const languageCounts = new Map<SupportedLanguage, number>();

    for (const metadata of metadataStore.values()) {
      const count = languageCounts.get(metadata.language) || 0;
      languageCounts.set(metadata.language, count + 1);
    }

    result.languageBreakdown = Array.from(languageCounts.entries())
      .map(([category, count]) => ({
        category,
        count,
        percentage: (count / total) * 100,
      }))
      .sort((a, b) => b.count - a.count);
  }

  // Repository breakdown
  if (options.includeRepositoryBreakdown) {
    const repoCounts = new Map<string, number>();

    for (const metadata of metadataStore.values()) {
      const repo = metadata.repository || 'unknown';
      const count = repoCounts.get(repo) || 0;
      repoCounts.set(repo, count + 1);
    }

    result.repositoryBreakdown = Array.from(repoCounts.entries())
      .map(([category, count]) => ({
        category,
        count,
        percentage: (count / total) * 100,
      }))
      .sort((a, b) => b.count - a.count);
  }

  // Symbol type breakdown
  if (options.includeSymbolBreakdown) {
    const symbolCounts = new Map<CodeSymbolType, number>();

    for (const metadata of metadataStore.values()) {
      const count = symbolCounts.get(metadata.symbolType) || 0;
      symbolCounts.set(metadata.symbolType, count + 1);
    }

    result.symbolBreakdown = Array.from(symbolCounts.entries())
      .map(([category, count]) => ({
        category,
        count,
        percentage: (count / total) * 100,
      }))
      .sort((a, b) => b.count - a.count);
  }

  return result;
}

/**
 * Calculate memory statistics
 */
function calculateMemoryStats(
  context: ToolExecutionContext,
  dimension: number
): MemoryStats {
  let vectorBytes = 0;
  let metadataBytes = 0;

  // Estimate vector storage (4 bytes per float * dimension * count)
  const vectorCount = context.backend.count();
  vectorBytes = vectorCount * dimension * 4;

  // Estimate metadata storage
  for (const metadata of context.metadataStore.values()) {
    metadataBytes += estimateStringSize(metadata.filePath);
    metadataBytes += estimateStringSize(metadata.language);
    metadataBytes += estimateStringSize(metadata.symbolType);
    if (metadata.symbolName) metadataBytes += estimateStringSize(metadata.symbolName);
    if (metadata.repository) metadataBytes += estimateStringSize(metadata.repository);
    if (metadata.branch) metadataBytes += estimateStringSize(metadata.branch);
    if (metadata.commitHash) metadataBytes += estimateStringSize(metadata.commitHash);
    if (metadata.parentSymbol) metadataBytes += estimateStringSize(metadata.parentSymbol);
    metadataBytes += 100; // Object overhead and number fields
  }

  // Estimate code storage
  for (const code of context.codeStore.values()) {
    metadataBytes += estimateStringSize(code);
  }

  // Estimate LEANN index overhead (hub cache, graph structure)
  const leannStats = context.backend.getStats();
  const indexBytes = Math.floor(
    (leannStats.hubCacheSize * dimension * 4) + // Hub cache vectors
    (leannStats.totalEdges * 16) // Graph edges (2 IDs per edge)
  );

  const totalBytes = vectorBytes + metadataBytes + indexBytes;

  return {
    totalBytes,
    vectorBytes,
    metadataBytes,
    indexBytes,
    totalFormatted: formatBytes(totalBytes),
  };
}

/**
 * Build LEANN-specific statistics
 */
function buildLeannStats(
  backendStats: LEANNStats,
  config: any, // LEANNConfig
  dimension: number
): LeannIndexStats {
  return {
    layerCount: 1, // LEANN uses single-layer approach with hub caching
    avgConnections: backendStats.avgHubDegree,
    maxConnections: [Math.ceil(backendStats.avgHubDegree * 1.5)],
    entryPoints: [], // Hub IDs would go here
    distanceMetric: 'cosine' as DistanceMetric, // Default metric
    embeddingDimension: dimension,
    optimized: backendStats.prunedEdges > 0,
    lastOptimizedAt: undefined,
  };
}

// ============================================================================
// Get Index Stats Tool
// ============================================================================

/**
 * Get comprehensive index statistics
 *
 * This tool:
 * 1. Retrieves basic counts (vectors, files, repositories)
 * 2. Optionally calculates breakdowns by language, repository, symbol type
 * 3. Optionally includes memory usage details
 * 4. Optionally includes LEANN-specific statistics
 *
 * @param input - Options for what statistics to include
 * @param context - Tool execution context
 * @returns Detailed index statistics
 */
export async function getIndexStats(
  input: GetStatsInput,
  context: ToolExecutionContext
): Promise<GetStatsOutput> {
  const startTime = Date.now();

  // Get basic counts
  const totalIndexed = context.backend.count();

  // Calculate unique files and repositories
  const uniqueFilesSet = new Set<string>();
  const uniqueReposSet = new Set<string>();
  let firstIndexedAt: number | undefined;
  let lastIndexedAt: number | undefined;

  for (const metadata of context.metadataStore.values()) {
    uniqueFilesSet.add(metadata.filePath);
    if (metadata.repository) {
      uniqueReposSet.add(metadata.repository);
    }

    // Track timestamps
    if (!firstIndexedAt || metadata.indexedAt < firstIndexedAt) {
      firstIndexedAt = metadata.indexedAt;
    }
    if (!lastIndexedAt || metadata.indexedAt > lastIndexedAt) {
      lastIndexedAt = metadata.indexedAt;
    }
  }

  // Get LEANN backend statistics
  const backendStats = context.backend.getStats();
  const config = context.backend.getConfig();

  // Calculate breakdowns if requested
  const breakdowns = calculateBreakdowns(context.metadataStore, input);

  // Build result
  const result: GetStatsOutput = {
    success: true,
    totalIndexed,
    uniqueFiles: uniqueFilesSet.size,
    uniqueRepositories: uniqueReposSet.size,
    firstIndexedAt,
    lastIndexedAt,
    config,
    message: `Index contains ${totalIndexed} code chunks from ${uniqueFilesSet.size} files across ${uniqueReposSet.size} repositories`,
  };

  // Add breakdowns
  if (breakdowns.languageBreakdown) {
    result.languageBreakdown = breakdowns.languageBreakdown;
  }
  if (breakdowns.repositoryBreakdown) {
    result.repositoryBreakdown = breakdowns.repositoryBreakdown;
  }
  if (breakdowns.symbolBreakdown) {
    result.symbolBreakdown = breakdowns.symbolBreakdown;
  }

  // Add memory stats if requested
  if (input.includeMemoryDetails) {
    // Get dimension from config or default
    const dimension = 1536; // VECTOR_DIM
    result.memoryStats = calculateMemoryStats(context, dimension);
  }

  // Add LEANN stats if requested
  if (input.includeLeannDetails) {
    const dimension = 1536;
    result.leannStats = buildLeannStats(backendStats, config, dimension);

    // Add cache performance to message
    const hitRatio = (backendStats.hitRatio * 100).toFixed(1);
    result.message += `. Hub cache hit ratio: ${hitRatio}%`;
  }

  return result;
}

/**
 * MCP Tool definition for get_stats
 */
export const GET_INDEX_STATS_DEFINITION = {
  name: 'get_stats',
  description: 'Get statistics about the code search index including counts, breakdowns, memory usage, and LEANN-specific metrics.',
  inputSchema: {
    type: 'object',
    properties: {
      includeLanguageBreakdown: {
        type: 'boolean',
        description: 'Include breakdown by programming language',
        default: false,
      },
      includeRepositoryBreakdown: {
        type: 'boolean',
        description: 'Include breakdown by repository',
        default: false,
      },
      includeSymbolBreakdown: {
        type: 'boolean',
        description: 'Include breakdown by symbol type (function, class, etc.)',
        default: false,
      },
      includeMemoryDetails: {
        type: 'boolean',
        description: 'Include memory usage details',
        default: false,
      },
      includeLeannDetails: {
        type: 'boolean',
        description: 'Include LEANN-specific statistics (hub cache, graph metrics)',
        default: false,
      },
    },
    required: [],
  },
};

/**
 * Quick summary function for simple stats check
 */
export async function getQuickStats(
  context: ToolExecutionContext
): Promise<{
  totalIndexed: number;
  uniqueFiles: number;
  hubCacheHitRatio: number;
}> {
  const backendStats = context.backend.getStats();
  const uniqueFilesSet = new Set<string>();

  for (const metadata of context.metadataStore.values()) {
    uniqueFilesSet.add(metadata.filePath);
  }

  return {
    totalIndexed: context.backend.count(),
    uniqueFiles: uniqueFilesSet.size,
    hubCacheHitRatio: backendStats.hitRatio,
  };
}
