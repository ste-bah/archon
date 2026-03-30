/**
 * LEANN Context Service - Provides semantic code search for pipeline context.
 * Integrates LEANN vector search into pipeline execution per PRD Section 4.5.
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-LEANN-CONTEXT-001
 *
 * @module src/god-agent/core/pipeline/leann-context-service
 */

import type { LEANNSourceAdapter } from '../search/adapters/leann-adapter.js';
import type { SourceExecutionResult, RawSourceResult } from '../search/search-types.js';

/**
 * Code context result from semantic search
 */
export interface ICodeContextResult {
  /** File path of the code */
  filePath: string;
  /** Code content snippet */
  content: string;
  /** Similarity score (0-1) */
  similarity: number;
  /** Programming language (optional) */
  language?: string;
}

/**
 * Parameters for building semantic context
 */
export interface ISemanticContextParams {
  /** Description of the task to find relevant code for */
  taskDescription: string;
  /** Current pipeline phase index */
  phase: number;
  /** Output from previous pipeline step (optional) */
  previousOutput?: unknown;
  /** Maximum number of results to return (default: 5) */
  maxResults?: number;
}

/**
 * Semantic context result containing code search results
 */
export interface ISemanticContext {
  /** Array of relevant code contexts */
  codeContext: ICodeContextResult[];
  /** Total number of results found */
  totalResults: number;
  /** Original search query used */
  searchQuery: string;
}

/**
 * Configuration interface for LEANN context service
 */
export interface ILeannContextConfig {
  /** Default number of results to return */
  defaultMaxResults?: number;
  /** Default timeout for searches in ms */
  defaultTimeoutMs?: number;
  /** Minimum similarity threshold to include results */
  minSimilarityThreshold?: number;
}

/**
 * Default configuration for LEANN context service
 */
const DEFAULT_CONFIG: Required<ILeannContextConfig> = {
  /** Default number of results to return */
  defaultMaxResults: 5,
  /** Default timeout for searches in ms */
  defaultTimeoutMs: 5000,
  /** Minimum similarity threshold to include results */
  minSimilarityThreshold: 0.3,
};

/**
 * Service for providing semantic code context to pipeline agents.
 * Uses LEANN vector search to find relevant code snippets based on task descriptions.
 *
 * @example
 * ```typescript
 * const service = new LeannContextService();
 * await service.initialize(leannAdapter);
 *
 * const context = await service.buildSemanticContext({
 *   taskDescription: 'implement user authentication',
 *   phase: 1,
 *   maxResults: 5,
 * });
 * ```
 */
export class LeannContextService {
  private adapter?: LEANNSourceAdapter;
  private initialized = false;
  private readonly defaultMaxResults: number;
  private readonly defaultTimeoutMs: number;
  private readonly minSimilarityThreshold: number;

  /**
   * Create a new LEANN context service
   *
   * @param config - Optional configuration overrides
   */
  constructor(config?: ILeannContextConfig) {
    this.defaultMaxResults = config?.defaultMaxResults ?? DEFAULT_CONFIG.defaultMaxResults;
    this.defaultTimeoutMs = config?.defaultTimeoutMs ?? DEFAULT_CONFIG.defaultTimeoutMs;
    this.minSimilarityThreshold = config?.minSimilarityThreshold ?? DEFAULT_CONFIG.minSimilarityThreshold;
  }

  /**
   * Initialize the service with a LEANN adapter
   *
   * @param adapter - Configured LEANNSourceAdapter instance
   */
  async initialize(adapter: LEANNSourceAdapter): Promise<void> {
    if (!adapter) {
      throw new Error('LEANNSourceAdapter is required for initialization');
    }
    this.adapter = adapter;
    this.initialized = true;
  }

  /**
   * Check if the service is initialized and ready
   */
  isInitialized(): boolean {
    return this.initialized && this.adapter !== undefined;
  }

  /**
   * Search for relevant code context based on a text query
   *
   * @param query - Text query to search for
   * @param k - Maximum number of results (default: 5)
   * @param timeoutMs - Search timeout in milliseconds
   * @returns Array of code context results
   */
  async searchCodeContext(
    query: string,
    k: number = this.defaultMaxResults,
    timeoutMs: number = this.defaultTimeoutMs
  ): Promise<ICodeContextResult[]> {
    if (!this.initialized || !this.adapter) {
      console.debug('[LeannContextService] Search skipped: service not initialized');
      return [];
    }

    try {
      const result: SourceExecutionResult = await this.adapter.searchByText(query, k, timeoutMs);

      if (result.status !== 'success' || !result.results) {
        return [];
      }

      return this.transformResults(result.results);
    } catch (error) {
      // Log error but don't fail - return empty array
      console.warn(`[LeannContextService] Search failed: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Build semantic context for a pipeline step
   *
   * @param params - Parameters for building context
   * @returns Semantic context with code search results
   */
  async buildSemanticContext(params: ISemanticContextParams): Promise<ISemanticContext> {
    const maxResults = params.maxResults ?? this.defaultMaxResults;

    // Build search query from task description
    const searchQuery = this.buildSearchQuery(params);

    // Search for relevant code
    const results = await this.searchCodeContext(searchQuery, maxResults);

    // Filter by minimum similarity threshold
    const filteredResults = results.filter(r => r.similarity >= this.minSimilarityThreshold);

    return {
      codeContext: filteredResults,
      totalResults: filteredResults.length,
      searchQuery,
    };
  }

  /**
   * Transform raw LEANN results to code context format
   *
   * @param results - Raw search results from LEANN
   * @returns Transformed code context results
   */
  private transformResults(results: RawSourceResult[]): ICodeContextResult[] {
    return results.map(r => ({
      filePath: this.extractFilePath(r.metadata),
      content: this.extractContent(r),
      similarity: r.score,
      language: this.extractLanguage(r.metadata),
    }));
  }

  /**
   * Extract file path from result metadata
   */
  private extractFilePath(metadata?: Record<string, unknown>): string {
    if (!metadata) return 'unknown';

    // Try common metadata field names
    const pathFields = ['filePath', 'path', 'file', 'source', 'filename'];
    for (const field of pathFields) {
      if (typeof metadata[field] === 'string') {
        return metadata[field] as string;
      }
    }

    // Fall back to vectorId if available
    if (typeof metadata['vectorId'] === 'string') {
      return metadata['vectorId'] as string;
    }

    return 'unknown';
  }

  /**
   * Extract content from result
   */
  private extractContent(result: RawSourceResult): string {
    // Try metadata content first
    if (result.metadata && typeof result.metadata['content'] === 'string') {
      return result.metadata['content'] as string;
    }

    // Try metadata chunk/text
    if (result.metadata && typeof result.metadata['chunk'] === 'string') {
      return result.metadata['chunk'] as string;
    }
    if (result.metadata && typeof result.metadata['text'] === 'string') {
      return result.metadata['text'] as string;
    }

    // Fall back to result content (usually vectorId in LEANN)
    return result.content || '';
  }

  /**
   * Extract programming language from metadata
   */
  private extractLanguage(metadata?: Record<string, unknown>): string | undefined {
    if (!metadata) return undefined;

    // Try common language field names
    const langFields = ['language', 'lang', 'extension', 'type'];
    for (const field of langFields) {
      if (typeof metadata[field] === 'string') {
        return metadata[field] as string;
      }
    }

    // Try to infer from file path
    const filePath = this.extractFilePath(metadata);
    return this.inferLanguageFromPath(filePath);
  }

  /**
   * Infer programming language from file path extension
   */
  private inferLanguageFromPath(filePath: string): string | undefined {
    const extensionMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.java': 'java',
      '.go': 'go',
      '.rs': 'rust',
      '.rb': 'ruby',
      '.php': 'php',
      '.cs': 'csharp',
      '.cpp': 'cpp',
      '.c': 'c',
      '.h': 'c',
      '.hpp': 'cpp',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.scala': 'scala',
      '.sql': 'sql',
      '.json': 'json',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.md': 'markdown',
      '.sh': 'bash',
      '.bash': 'bash',
    };

    const ext = filePath.match(/\.[^.]+$/)?.[0]?.toLowerCase();
    return ext ? extensionMap[ext] : undefined;
  }

  /**
   * Build search query from context parameters
   *
   * @param params - Semantic context parameters
   * @returns Optimized search query string
   */
  private buildSearchQuery(params: ISemanticContextParams): string {
    // Start with the task description
    let query = params.taskDescription;

    // If we have previous output context, try to extract relevant terms
    if (params.previousOutput) {
      const contextTerms = this.extractContextTerms(params.previousOutput);
      if (contextTerms.length > 0) {
        query = `${query} ${contextTerms.join(' ')}`;
      }
    }

    return query;
  }

  /**
   * Extract relevant terms from previous output for context enrichment
   *
   * @param output - Previous step output
   * @returns Array of relevant terms
   */
  private extractContextTerms(output: unknown): string[] {
    const terms: string[] = [];

    if (typeof output === 'string') {
      // Extract key terms from string (simple approach - first 50 words)
      const words = output.split(/\s+/).slice(0, 50);
      terms.push(...words.filter(w => w.length > 3));
    } else if (typeof output === 'object' && output !== null) {
      // Extract keys from object that might be relevant
      const obj = output as Record<string, unknown>;
      const relevantKeys = ['type', 'name', 'action', 'component', 'module', 'function', 'class'];
      for (const key of relevantKeys) {
        if (typeof obj[key] === 'string') {
          terms.push(obj[key] as string);
        }
      }
    }

    // Return unique terms, limited to 10
    return [...new Set(terms)].slice(0, 10);
  }

  /**
   * Get the underlying adapter (for testing/debugging)
   */
  getAdapter(): LEANNSourceAdapter | undefined {
    return this.adapter;
  }

  /**
   * Save the LEANN index to persistent storage.
   * Persists both the vector index and content store.
   * Uses atomic writes (temp file + rename) to prevent corruption.
   *
   * @param filePath - Path to save the index (content stored at filePath + '.content')
   * @param timeoutMs - Optional timeout in milliseconds (default: 30000)
   * @throws Error if adapter not initialized (ERR-001)
   * @throws Error if save operation times out or fails
   */
  async save(filePath: string, timeoutMs?: number): Promise<void> {
    if (!this.adapter) {
      throw new Error('Cannot save: LEANN adapter not initialized (ERR-001)');
    }
    await this.adapter.save(filePath, timeoutMs);
  }

  /**
   * Load the LEANN index from persistent storage.
   * Restores both the vector index and content store.
   *
   * @param filePath - Path to load the index from (content loaded from filePath + '.content')
   * @param timeoutMs - Optional timeout in milliseconds (default: 30000)
   * @returns True if loaded successfully, false if file doesn't exist
   * @throws Error if adapter not initialized (ERR-001)
   * @throws Error if load operation times out or fails
   */
  async load(filePath: string, timeoutMs?: number): Promise<boolean> {
    if (!this.adapter) {
      throw new Error('Cannot load: LEANN adapter not initialized (ERR-001)');
    }
    return this.adapter.load(filePath, timeoutMs);
  }

  /**
   * Get the number of vectors currently in the index.
   * Useful for debugging and metrics.
   *
   * @returns Number of vectors, or 0 if adapter not initialized
   */
  getVectorCount(): number {
    return this.adapter?.count() ?? 0;
  }
}

/**
 * Factory function to create a LeannContextService
 *
 * @param config - Optional configuration overrides
 * @returns New LeannContextService instance
 */
export function createLeannContextService(
  config?: ILeannContextConfig
): LeannContextService {
  return new LeannContextService(config);
}
