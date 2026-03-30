/**
 * Search Module
 *
 * Provides search capabilities for the God Agent including:
 * - Web search (WebSearch, Perplexity MCP)
 * - Quad-Fusion unified search (Vector + Graph + Memory + Pattern)
 *
 * PRD: PRD-GOD-AGENT-001
 */

// Web Search Provider
export type {
  ISearchResult,
  ISearchOptions,
  IWebSearchProvider,
} from './web-search-provider.js';

export {
  HybridSearchProvider,
  type McpToolInvocation,
} from './hybrid-search-provider.js';

// Quad-Fusion Search Types (PRD-GOD-AGENT-001)
export {
  // Types
  type SearchSource,
  type SourceWeights,
  type QuadFusionOptions,
  type SourceAttribution,
  type FusedSearchResult,
  type SearchMetadata,
  type SourceStat,
  type SourceStatistics,
  type QuadFusionResult,
  type RawSourceResult,
  type SourceSuccessResult,
  type SourceTimeoutResult,
  type SourceErrorResult,
  type SourceExecutionResult,
  type AggregatedResults,
  type SearchError,
  // Constants
  DEFAULT_OPTIONS,
  MAX_TOP_K,
  MAX_GRAPH_DEPTH,
  MAX_SOURCE_TIMEOUT_MS,
  // Enums
  SearchErrorCode,
  // Functions
  createSearchError,
  validateOptions,
  normalizeWeights,
  mergeOptions,
} from './search-types.js';

// Utils (PRD-GOD-AGENT-001 / TASK-SEARCH-004)
export {
  TimeoutError,
  withTimeout,
  computeContentHash,
  measureTime,
  generateResultId,
  normalizeScore,
} from './utils.js';

// Source Adapters (PRD-GOD-AGENT-001 / TASK-SEARCH-004)
export {
  VectorSourceAdapter,
  GraphSourceAdapter,
  MemorySourceAdapter,
  PatternSourceAdapter,
} from './adapters/index.js';

// Fusion Scorer (PRD-GOD-AGENT-001 / TASK-SEARCH-002)
export { FusionScorer } from './fusion-scorer.js';

// Unified Search (PRD-GOD-AGENT-001 / TASK-SEARCH-001)
export { UnifiedSearch } from './unified-search.js';

// Dual Code Embedding (PRD-GOD-AGENT-001 / TASK-LEANN-003)
export {
  DualCodeEmbeddingProvider,
  createDualCodeEmbeddingProvider,
  createLEANNEmbedder,
  type ContentType,
  type DualCodeEmbeddingConfig,
  type CacheStats,
  type EmbeddingResult,
  DEFAULT_DUAL_CODE_CONFIG,
} from './dual-code-embedding.js';
