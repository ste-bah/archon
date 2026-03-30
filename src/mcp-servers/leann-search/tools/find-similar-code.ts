/**
 * LEANN Search MCP Server - Find Similar Code Tool
 *
 * Implements code similarity search using a code snippet as the query.
 * Finds semantically similar code in the indexed repository.
 *
 * @module mcp-servers/leann-search/tools/find-similar-code
 */

import type { ToolExecutionContext } from './semantic-code-search.js';
import type {
  CodeMetadata,
  SupportedLanguage,
  CodeSymbolType,
} from '../types.js';
import type { VectorID, SearchResult } from '../../../god-agent/core/vector-db/types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Input parameters for finding similar code
 */
export interface FindSimilarCodeInput {
  /** Code snippet to find similar code for */
  code: string;
  /** Maximum number of results to return (default: 10) */
  limit?: number;
  /** Minimum similarity score (0-1, default: 0.5) */
  minScore?: number;
  /** Filter by programming languages */
  languages?: SupportedLanguage[];
  /** Filter by symbol types */
  symbolTypes?: CodeSymbolType[];
  /** Filter by file path pattern (glob) */
  filePattern?: string;
  /** Filter by repository */
  repository?: string;
  /** Whether to exclude exact matches (same file/lines) */
  excludeExact?: boolean;
  /** Include the similar code content in results */
  includeCode?: boolean;
  /** Deduplication threshold (0-1, default: 0.95) */
  deduplicationThreshold?: number;
}

/**
 * Single similar code result
 */
export interface SimilarCodeResult {
  /** Unique identifier */
  vectorId: VectorID;
  /** Similarity score (0-1, higher is more similar) */
  similarity: number;
  /** Code metadata */
  metadata: CodeMetadata;
  /** The similar code content (if includeCode is true) */
  code?: string;
  /** Similarity category for quick understanding */
  category: 'exact' | 'near-duplicate' | 'very-similar' | 'similar' | 'related';
}

/**
 * Output from find similar code
 */
export interface FindSimilarCodeOutput {
  /** Whether search succeeded */
  success: boolean;
  /** Similar code results */
  results: SimilarCodeResult[];
  /** Total results found (before filtering) */
  totalFound: number;
  /** Input code length in characters */
  codeLength: number;
  /** Search time in milliseconds */
  searchTimeMs: number;
  /** Embedding generation time in milliseconds */
  embeddingTimeMs: number;
  /** Summary message */
  message: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Categorize similarity score for user understanding
 */
function categorizeSimilarity(score: number): SimilarCodeResult['category'] {
  if (score >= 0.99) return 'exact';
  if (score >= 0.95) return 'near-duplicate';
  if (score >= 0.85) return 'very-similar';
  if (score >= 0.70) return 'similar';
  return 'related';
}

/**
 * Check if file path matches a glob pattern (simplified)
 */
function matchesGlobPattern(filePath: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filePath);
}

/**
 * Check if two code results are duplicates based on similarity threshold
 */
function areResultsDuplicates(
  a: SimilarCodeResult,
  b: SimilarCodeResult,
  threshold: number
): boolean {
  // Same file and overlapping lines are duplicates
  if (a.metadata.filePath === b.metadata.filePath) {
    const aStart = a.metadata.startLine;
    const aEnd = a.metadata.endLine;
    const bStart = b.metadata.startLine;
    const bEnd = b.metadata.endLine;

    // Check for line overlap
    if (aStart <= bEnd && bStart <= aEnd) {
      return true;
    }
  }

  // Very similar scores for different files might be duplicates
  return Math.abs(a.similarity - b.similarity) < (1 - threshold);
}

// ============================================================================
// Find Similar Code Tool
// ============================================================================

/**
 * Find code similar to a given code snippet
 *
 * This tool:
 * 1. Embeds the input code using DualCodeEmbeddingProvider.embedCode()
 * 2. Searches the LEANN backend for similar code vectors
 * 3. Filters by language, symbol type, file pattern, repository
 * 4. Deduplicates and ranks results
 * 5. Returns categorized similarity results
 *
 * @param input - Search parameters with code snippet
 * @param context - Tool execution context
 * @returns Similar code results with metadata and scores
 */
export async function findSimilarCode(
  input: FindSimilarCodeInput,
  context: ToolExecutionContext
): Promise<FindSimilarCodeOutput> {
  const startTime = Date.now();
  let embeddingTimeMs = 0;

  // Validate input
  if (!input.code || input.code.trim().length === 0) {
    return {
      success: false,
      results: [],
      totalFound: 0,
      codeLength: 0,
      searchTimeMs: Date.now() - startTime,
      embeddingTimeMs: 0,
      message: 'Code snippet cannot be empty',
    };
  }

  // Set defaults
  const limit = input.limit ?? 10;
  const minScore = input.minScore ?? 0.5;
  const deduplicationThreshold = input.deduplicationThreshold ?? 0.95;

  // Generate code embedding
  const embeddingStart = Date.now();
  let codeEmbedding: Float32Array;

  try {
    // Use embedCode for code-to-code similarity
    codeEmbedding = await context.embeddingProvider.embedCode(input.code);
    embeddingTimeMs = Date.now() - embeddingStart;
  } catch (error) {
    return {
      success: false,
      results: [],
      totalFound: 0,
      codeLength: input.code.length,
      searchTimeMs: Date.now() - startTime,
      embeddingTimeMs: Date.now() - embeddingStart,
      message: `Failed to generate code embedding: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }

  // Search the backend for more results than needed for filtering
  const searchLimit = Math.min(limit * 5, context.backend.count());
  const searchResults: SearchResult[] = context.backend.search(
    codeEmbedding,
    searchLimit,
    false
  );

  // Filter and transform results
  const candidateResults: SimilarCodeResult[] = [];

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

    // Build result
    const similarResult: SimilarCodeResult = {
      vectorId: result.id,
      similarity: result.similarity,
      metadata,
      category: categorizeSimilarity(result.similarity),
    };

    // Exclude exact matches if requested
    if (input.excludeExact && similarResult.category === 'exact') {
      continue;
    }

    // Include code content if requested
    if (input.includeCode) {
      const code = context.codeStore.get(result.id);
      if (code) {
        similarResult.code = code;
      }
    }

    candidateResults.push(similarResult);
  }

  // Deduplicate results
  const deduplicatedResults: SimilarCodeResult[] = [];

  for (const candidate of candidateResults) {
    let isDuplicate = false;

    for (const existing of deduplicatedResults) {
      if (areResultsDuplicates(candidate, existing, deduplicationThreshold)) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      deduplicatedResults.push(candidate);
    }

    // Stop if we have enough
    if (deduplicatedResults.length >= limit) break;
  }

  const searchTimeMs = Date.now() - startTime;

  // Generate summary message
  const categoryCount: Record<string, number> = {};
  for (const result of deduplicatedResults) {
    categoryCount[result.category] = (categoryCount[result.category] || 0) + 1;
  }

  const categorySummary = Object.entries(categoryCount)
    .map(([cat, count]) => `${count} ${cat}`)
    .join(', ');

  return {
    success: true,
    results: deduplicatedResults,
    totalFound: candidateResults.length,
    codeLength: input.code.length,
    searchTimeMs,
    embeddingTimeMs,
    message: deduplicatedResults.length > 0
      ? `Found ${deduplicatedResults.length} similar code snippets (${categorySummary}) in ${searchTimeMs}ms`
      : 'No similar code found matching the criteria',
  };
}

/**
 * MCP Tool definition for find_similar_code
 */
export const FIND_SIMILAR_CODE_DEFINITION = {
  name: 'find_similar_code',
  description: 'Find code similar to a given code snippet. Useful for detecting duplicates, finding related implementations, or understanding code patterns.',
  inputSchema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Code snippet to find similar code for',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 10)',
        default: 10,
      },
      minScore: {
        type: 'number',
        description: 'Minimum similarity score (0-1, default: 0.5)',
        minimum: 0,
        maximum: 1,
        default: 0.5,
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
      excludeExact: {
        type: 'boolean',
        description: 'Exclude exact matches (same file/lines)',
        default: false,
      },
      includeCode: {
        type: 'boolean',
        description: 'Include the similar code content in results',
        default: false,
      },
      deduplicationThreshold: {
        type: 'number',
        description: 'Threshold for considering results as duplicates (0-1, default: 0.95)',
        minimum: 0,
        maximum: 1,
        default: 0.95,
      },
    },
    required: ['code'],
  },
};
