/**
 * Unified Search - Quad-Fusion Search Orchestration
 * Combines vector, graph, memory, and pattern sources
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-SEARCH-001
 *
 * @module src/god-agent/core/search/unified-search
 */

import type { NativeHNSW } from '../vector-db/native-hnsw.js';
import type { FallbackGraph } from '../graph-db/fallback-graph.js';
import type { MemoryClient } from '../memory-server/memory-client.js';
import type { ReasoningBank } from '../reasoning/reasoning-bank.js';
import type {
  QuadFusionOptions,
  QuadFusionResult,
  SourceWeights,
  SearchMetadata,
  SourceStatistics,
  SourceStat,
  AggregatedResults,
  RawSourceResult,
  SourceExecutionResult,
  SearchSource,
} from './search-types.js';
import {
  createSearchError,
  SearchErrorCode,
  validateOptions,
  mergeOptions,
} from './search-types.js';
import {
  VectorSourceAdapter,
  GraphSourceAdapter,
  MemorySourceAdapter,
  PatternSourceAdapter,
  GNNSearchAdapter,
} from './adapters/index.js';
import { FusionScorer } from './fusion-scorer.js';
import type { GNNEnhancer } from '../reasoning/gnn-enhancer.js';
import { ActivityStream } from '../../observability/activity-stream.js';

/**
 * Unified Search orchestrates quad-fusion search across four sources
 */
export class UnifiedSearch {
  private readonly vectorAdapter: VectorSourceAdapter;
  private readonly graphAdapter: GraphSourceAdapter;
  private readonly memoryAdapter: MemorySourceAdapter;
  private readonly patternAdapter: PatternSourceAdapter;
  private readonly fusionScorer: FusionScorer;
  private readonly gnnAdapter?: GNNSearchAdapter;
  private readonly activityStream?: ActivityStream;
  private options: QuadFusionOptions;

  /**
   * Create unified search instance
   *
   * @param vectorDb - NativeHNSW vector database
   * @param graphDb - FallbackGraph graph database
   * @param memoryClient - MemoryClient for pattern queries
   * @param reasoningBank - ReasoningBank for pattern matching
   * @param gnnEnhancer - Optional GNN enhancer for graph-enhanced embeddings
   * @param options - Optional configuration overrides
   * @param activityStream - Optional ActivityStream for observability events
   */
  constructor(
    vectorDb: NativeHNSW,
    graphDb: FallbackGraph,
    memoryClient: MemoryClient,
    reasoningBank: ReasoningBank,
    gnnEnhancer?: GNNEnhancer,
    options?: Partial<QuadFusionOptions>,
    activityStream?: ActivityStream
  ) {
    // Validate options if provided
    if (options) {
      validateOptions(options);
    }

    // Merge with defaults
    this.options = mergeOptions(options || {});

    // Create adapters
    this.vectorAdapter = new VectorSourceAdapter(vectorDb);
    this.graphAdapter = new GraphSourceAdapter(graphDb);
    this.memoryAdapter = new MemorySourceAdapter(memoryClient);
    this.patternAdapter = new PatternSourceAdapter(reasoningBank);

    // Create GNN adapter if enhancer provided
    if (gnnEnhancer && this.options.gnnEnhancement?.enabled) {
      this.gnnAdapter = new GNNSearchAdapter(gnnEnhancer, graphDb, {
        enabled: this.options.gnnEnhancement.enabled,
        enhancementPoint: this.options.gnnEnhancement.point,
        graphDepth: this.options.gnnEnhancement.graphDepth,
        timeout: this.options.gnnEnhancement.timeout,
      });
    }

    // Create fusion scorer
    this.fusionScorer = new FusionScorer(this.options.weights);

    // Store activity stream for observability
    this.activityStream = activityStream;
  }

  /**
   * Execute quad-fusion search
   *
   * @param query - Text query string
   * @param embedding - Optional pre-computed query embedding (VECTOR_DIM dimensions, default 1536)
   * @param options - Optional per-query options
   * @returns Quad-fusion search result
   */
  async search(
    query: string,
    embedding?: Float32Array,
    options?: Partial<QuadFusionOptions>
  ): Promise<QuadFusionResult> {
    const startTime = performance.now();
    const correlationId = this.generateCorrelationId();

    // Emit search.started observability event
    await this.emitSearchEvent('search.started', {
      correlationId,
      query,
      hasEmbedding: !!embedding,
      options: options ?? {},
    });

    try {
      // Validate query
      if (!query || query.trim().length === 0) {
        throw createSearchError(
          SearchErrorCode.INVALID_QUERY,
          'Query cannot be empty',
          { query }
        );
      }

      // Merge options for this query
      const queryOptions = options
        ? mergeOptions({ ...this.options, ...options })
        : this.options;

      // Validate per-query options
      if (options) {
        validateOptions(options);
      }

      // GNN enhancement (pre-search if enabled)
      let enhancedEmbedding = embedding;
      if (
        embedding &&
        this.gnnAdapter &&
        queryOptions.gnnEnhancement?.enabled &&
        (queryOptions.gnnEnhancement.point === 'pre_search' ||
          queryOptions.gnnEnhancement.point === 'both')
      ) {
        enhancedEmbedding = await this.gnnAdapter.enhance(embedding, query);
      }

      // Execute parallel search across all sources
      const aggregated = await this.executeParallelSearch(
        query,
        enhancedEmbedding,
        queryOptions
      );

      // Check if all sources failed
      const allFailed = Object.values(aggregated.sourceOutcomes).every(
        (outcome) => outcome.status !== 'success' || outcome.results.length === 0
      );

      if (allFailed && aggregated.rawResults.length === 0) {
        throw createSearchError(
          SearchErrorCode.ALL_SOURCES_FAILED,
          'All search sources failed or returned no results',
          {
            sourceOutcomes: Object.fromEntries(
              Object.entries(aggregated.sourceOutcomes).map(([k, v]) => [
                k,
                { status: v.status, durationMs: v.durationMs },
              ])
            ),
          }
        );
      }

      // Fuse results
      const fusedResults = this.fusionScorer.fuse(aggregated, queryOptions.topK);

      // Build metadata
      const totalDurationMs = performance.now() - startTime;
      const metadata = this.buildMetadata(
        aggregated,
        fusedResults.length,
        totalDurationMs,
        correlationId
      );

      // Build source statistics
      const sourceStats = this.buildSourceStats(aggregated);

      // Emit search.completed observability event
      await this.emitSearchEvent('search.completed', {
        correlationId,
        query,
        resultCount: fusedResults.length,
        totalDurationMs,
        sourcesResponded: metadata.sourcesResponded,
        sourcesTimedOut: metadata.sourcesTimedOut,
      });

      return {
        query,
        results: fusedResults,
        metadata,
        sourceStats,
      };
    } catch (error) {
      // Emit search.error observability event
      const durationMs = performance.now() - startTime;
      await this.emitSearchEvent('search.error', {
        correlationId,
        query,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs,
      }, 'error');
      // RULE-070: Re-throw with operation context
      throw new Error(
        `Quad-fusion search failed for query "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}" (correlationId: ${correlationId}): ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * Execute parallel search across all sources
   */
  private async executeParallelSearch(
    query: string,
    embedding: Float32Array | undefined,
    options: QuadFusionOptions
  ): Promise<AggregatedResults> {
    // Execute all sources in parallel with Promise.allSettled
    const [vectorResult, graphResult, memoryResult, patternResult] =
      await Promise.allSettled([
        this.vectorAdapter.search(
          embedding,
          options.topK,
          options.sourceTimeoutMs
        ),
        this.graphAdapter.search(query, options.graphDepth, options.sourceTimeoutMs),
        this.memoryAdapter.search(
          query,
          options.memoryNamespace,
          options.sourceTimeoutMs
        ),
        this.patternAdapter.search(
          embedding || query,
          options.minPatternConfidence,
          options.sourceTimeoutMs
        ),
      ]);

    // Convert settled results to source execution results
    const sourceOutcomes: Record<SearchSource, SourceExecutionResult> = {
      vector: this.settledToOutcome(vectorResult, 'vector'),
      graph: this.settledToOutcome(graphResult, 'graph'),
      memory: this.settledToOutcome(memoryResult, 'memory'),
      pattern: this.settledToOutcome(patternResult, 'pattern'),
    };

    // Collect all raw results from successful sources
    const rawResults: RawSourceResult[] = [];
    for (const outcome of Object.values(sourceOutcomes)) {
      if (outcome.status === 'success') {
        rawResults.push(...outcome.results);
      }
    }

    return { rawResults, sourceOutcomes };
  }

  /**
   * Convert settled promise result to source execution result
   */
  private settledToOutcome(
    settled: PromiseSettledResult<SourceExecutionResult>,
    source: SearchSource
  ): SourceExecutionResult {
    if (settled.status === 'fulfilled') {
      return settled.value;
    }

    // Promise rejected - convert to error result
    return {
      status: 'error',
      error: settled.reason instanceof Error
        ? settled.reason.message
        : `${source} search failed`,
      durationMs: 0,
    };
  }

  /**
   * Build search metadata
   */
  private buildMetadata(
    aggregated: AggregatedResults,
    dedupedCount: number,
    totalDurationMs: number,
    correlationId: string
  ): SearchMetadata {
    let sourcesResponded = 0;
    let sourcesTimedOut = 0;

    for (const outcome of Object.values(aggregated.sourceOutcomes)) {
      if (outcome.status === 'success') {
        sourcesResponded++;
      } else if (outcome.status === 'timeout') {
        sourcesTimedOut++;
      }
    }

    return {
      totalDurationMs,
      sourcesResponded,
      sourcesTimedOut,
      rawResultCount: aggregated.rawResults.length,
      dedupedResultCount: dedupedCount,
      correlationId,
    };
  }

  /**
   * Build per-source statistics
   */
  private buildSourceStats(aggregated: AggregatedResults): SourceStatistics {
    const buildStat = (outcome: SourceExecutionResult): SourceStat => ({
      responded: outcome.status === 'success',
      durationMs: outcome.durationMs,
      resultCount:
        outcome.status === 'success' ? outcome.results.length : 0,
      timedOut: outcome.status === 'timeout',
      error: outcome.status === 'error' ? outcome.error : undefined,
    });

    return {
      vector: buildStat(aggregated.sourceOutcomes.vector),
      graph: buildStat(aggregated.sourceOutcomes.graph),
      memory: buildStat(aggregated.sourceOutcomes.memory),
      pattern: buildStat(aggregated.sourceOutcomes.pattern),
    };
  }

  /**
   * Generate correlation ID for tracing
   */
  private generateCorrelationId(): string {
    return `qf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }


  /**
   * Emit search observability event
   * Non-blocking - errors are caught and logged silently
   */
  private async emitSearchEvent(
    type: string,
    payload: Record<string, unknown>,
    status: 'pending' | 'running' | 'success' | 'error' = 'success'
  ): Promise<void> {
    if (!this.activityStream) {
      return;
    }

    try {
      await this.activityStream.emit({
        type,
        correlationId: payload.correlationId as string | undefined,
        payload,
        component: 'search',
        status,
      });
    } catch {
      // Observability failures should not affect search operations
    }
  }

  /**
   * Update source weights
   *
   * @param weights - Partial weights to update
   */
  updateWeights(weights: Partial<SourceWeights>): void {
    const newWeights: SourceWeights = {
      ...this.options.weights,
      ...weights,
    };
    this.options.weights = newWeights;
    this.fusionScorer.updateWeights(newWeights);
  }

  /**
   * Get current options
   *
   * @returns Current quad-fusion options
   */
  getOptions(): QuadFusionOptions {
    return { ...this.options };
  }

  /**
   * Update options
   *
   * @param options - Partial options to update
   */
  updateOptions(options: Partial<QuadFusionOptions>): void {
    validateOptions(options);
    this.options = mergeOptions({ ...this.options, ...options });

    if (options.weights) {
      this.fusionScorer.updateWeights(this.options.weights);
    }
  }
}
