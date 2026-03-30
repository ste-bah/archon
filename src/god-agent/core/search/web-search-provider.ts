/**
 * Web Search Provider Interface
 *
 * Defines the contract for web search providers that can be used
 * by the God Agent for research operations.
 */

export interface ISearchResult {
  /** The main content/snippet from the search result */
  content: string;
  /** Source identifier (URL, provider name, etc.) */
  source: string;
  /** Optional URL for the result */
  url?: string;
  /** Relevance score (0-1) */
  relevance: number;
  /** Timestamp when the result was retrieved */
  timestamp?: Date;
  /** Citations/references for the content */
  citations?: string[];
}

export interface ISearchOptions {
  /** Search depth level */
  depth: 'quick' | 'medium' | 'deep';
  /** Maximum number of results to return */
  maxResults?: number;
  /** Time recency filter */
  recency?: 'day' | 'week' | 'month' | 'year' | 'all';
  /** Restrict search to specific domains */
  domains?: string[];
}

export interface IWebSearchProvider {
  /**
   * Perform a web search with the given query and options
   * @param query The search query string
   * @param options Search options including depth and filters
   * @returns Array of search results
   */
  search(query: string, options: ISearchOptions): Promise<ISearchResult[]>;

  /**
   * Get list of available search sources
   * @returns Array of source identifiers (e.g., ['websearch', 'perplexity-ask'])
   */
  getAvailableSources(): string[];

  /**
   * Check if the provider is available and configured
   * @returns True if the provider can perform searches
   */
  isAvailable(): Promise<boolean>;
}
