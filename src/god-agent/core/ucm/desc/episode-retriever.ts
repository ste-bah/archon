/**
 * SPRINT 3 - DESC-003: Episode Retriever
 *
 * RULE-069: All-to-all chunk comparison for retrieval
 * RULE-067: Chunk-level match, episode-level return
 * RULE-066: Threshold 0.80 similarity
 *
 * Retrieves episodes by comparing query chunks against stored answer chunks
 * using cosine similarity on L2-normalized embeddings.
 */

import type {
  IEpisodeRetriever,
  IRetrievalResult,
  IRetrievalOptions,
  IStoredEpisode,
  IDualEmbeddingStore,
  IInjectionFilter,
  ITaskContext
} from '../types.js';
import { DESCRetrievalError } from '../errors.js';
import { DualEmbeddingStore } from './dual-embedding-store.js';
import { InjectionFilter } from './injection-filter.js';

/**
 * Default retrieval options (matches IRetrievalOptions from types.ts)
 */
const DEFAULT_RETRIEVAL_OPTIONS: Required<IRetrievalOptions> = {
  threshold: 0.80, // RULE-066
  maxResults: 10,
  includeQueryMatch: true,
  includeAnswerMatch: true
};

/**
 * EpisodeRetriever - RULE-069 compliant retrieval
 *
 * Key features:
 * - All-to-all chunk comparison
 * - Cosine similarity on L2-normalized embeddings
 * - 0.80 similarity threshold (configurable)
 * - Returns full answer text (not chunks)
 * - Episode-level results with aggregated scores
 */
export class EpisodeRetriever implements IEpisodeRetriever {
  private store: IDualEmbeddingStore;
  private options: Required<IRetrievalOptions>;
  private filter: IInjectionFilter;

  constructor(
    store?: IDualEmbeddingStore,
    options?: IRetrievalOptions,
    filter?: IInjectionFilter
  ) {
    this.store = store || new DualEmbeddingStore();
    this.options = {
      ...DEFAULT_RETRIEVAL_OPTIONS,
      ...options
    };
    this.filter = filter || new InjectionFilter();
  }

  /**
   * Retrieve episodes matching query chunks
   *
   * RULE-069: All-to-all comparison - every query chunk is compared
   * against every answer chunk of every episode
   *
   * RULE-067: Chunk-level match, episode-level return - matches happen
   * at chunk level but we return complete episodes
   *
   * @param queryChunks - Chunks from the query
   * @param queryEmbeddings - Embeddings for query chunks
   * @param options - Retrieval options (overrides constructor options)
   * @param taskContext - Optional task context for safety filtering
   */
  async retrieve(
    queryChunks: string[],
    queryEmbeddings: Float32Array[],
    options?: IRetrievalOptions,
    taskContext?: ITaskContext
  ): Promise<IRetrievalResult[]> {
    try {
      // Validate input
      this.validateRetrievalInput(queryChunks, queryEmbeddings);

      // Merge options
      const retrievalOptions: Required<IRetrievalOptions> = {
        ...this.options,
        ...options
      };

      // Get all stored episodes
      const episodes = await this.store.getAllEpisodes();

      if (episodes.length === 0) {
        return [];
      }

      // Compute episode scores using all-to-all comparison
      const episodeScores = this.computeEpisodeScores(
        queryEmbeddings,
        episodes,
        retrievalOptions.threshold
      );

      // Filter by threshold and sort by score
      let matchingEpisodes = episodeScores
        .filter(({ score }) => score >= retrievalOptions.threshold)
        .sort((a, b) => b.score - a.score);

      // Apply injection filter if task context is provided
      const filteredCount = matchingEpisodes.length;
      if (taskContext) {
        const filterResults = matchingEpisodes.map(({ episode, score }) => ({
          episode,
          score,
          decision: this.filter.shouldInject(episode, score, taskContext)
        }));

        matchingEpisodes = filterResults
          .filter(({ decision }) => decision.inject)
          .map(({ episode, decision }) => ({
            episode,
            score: decision.adjustedScore,
            matchingChunks: 0 // Will be set below
          }))
          .sort((a, b) => b.score - a.score);

        // Log filtering results for debugging
        const rejectedCount = filteredCount - matchingEpisodes.length;
        if (rejectedCount > 0) {
          const rejectedReasons = filterResults
            .filter(({ decision }) => !decision.inject)
            .map(({ decision }) => decision.reason);
          console.error(`[DESC Filter] Filtered ${rejectedCount}/${filteredCount} episodes: ${rejectedReasons.join('; ')}`);
        }
      }

      // Limit results
      matchingEpisodes = matchingEpisodes.slice(0, retrievalOptions.maxResults);

      // Convert to retrieval results (conform to IRetrievalResult interface)
      return matchingEpisodes.map(({ episode, score }) => ({
        episodeId: episode.episodeId,
        answerText: this.reconstructAnswerText(episode),
        maxSimilarity: score,
        matchedChunkType: 'answer' as const,
        matchedChunkIndex: 0,
        searchChunkIndex: 0,
        metadata: episode.metadata
      }));
    } catch (error) {
      if (error instanceof DESCRetrievalError) {
        throw error;
      }
      throw new DESCRetrievalError(
        `Retrieval failed: ${error instanceof Error ? error.message : String(error)}`,
        { originalError: error }
      );
    }
  }

  /**
   * Compute episode scores using RULE-069: all-to-all comparison
   */
  private computeEpisodeScores(
    queryEmbeddings: Float32Array[],
    episodes: IStoredEpisode[],
    threshold: number
  ): Array<{
    episode: IStoredEpisode;
    score: number;
    matchingChunks: number;
  }> {
    const results: Array<{
      episode: IStoredEpisode;
      score: number;
      matchingChunks: number;
    }> = [];

    for (const episode of episodes) {
      // answerChunkEmbeddings are already Float32Array[] - no decoding needed
      const answerEmbeddings = episode.answerChunkEmbeddings;

      // All-to-all comparison: compare every query chunk with every answer chunk
      const chunkScores: number[] = [];
      let matchingChunks = 0;

      for (const queryEmbed of queryEmbeddings) {
        let maxSimilarity = 0;

        // Find best matching answer chunk for this query chunk
        for (const answerEmbed of answerEmbeddings) {
          const similarity = this.cosineSimilarity(queryEmbed, answerEmbed);
          maxSimilarity = Math.max(maxSimilarity, similarity);
        }

        chunkScores.push(maxSimilarity);

        // RULE-066: Count chunks above threshold
        if (maxSimilarity >= threshold) {
          matchingChunks++;
        }
      }

      // Aggregate score: average of all query chunk max similarities
      const episodeScore = chunkScores.reduce((sum, s) => sum + s, 0) / chunkScores.length;

      results.push({
        episode,
        score: episodeScore,
        matchingChunks
      });
    }

    return results;
  }

  /**
   * Compute cosine similarity between two L2-normalized embeddings
   *
   * For L2-normalized vectors, cosine similarity = dot product
   * This is because ||a|| = ||b|| = 1, so:
   * cos(θ) = (a·b) / (||a|| * ||b||) = a·b
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new DESCRetrievalError(
        'Embedding dimensions must match',
        { dimA: a.length, dimB: b.length }
      );
    }

    // Compute dot product (assumes L2-normalized vectors)
    let dotProduct = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
    }

    // Clamp to [-1, 1] to handle floating point errors
    return Math.max(-1, Math.min(1, dotProduct));
  }

  /**
   * Get full answer text
   * RULE-067: Return full answer text, not individual chunks
   */
  private reconstructAnswerText(episode: IStoredEpisode): string {
    // answerText is stored as full text, not chunks
    return episode.answerText;
  }

  /**
   * Validate retrieval input
   */
  private validateRetrievalInput(
    queryChunks: string[],
    queryEmbeddings: Float32Array[]
  ): void {
    if (!Array.isArray(queryChunks) || queryChunks.length === 0) {
      throw new DESCRetrievalError('Query chunks must be a non-empty array');
    }

    if (!Array.isArray(queryEmbeddings) || queryEmbeddings.length === 0) {
      throw new DESCRetrievalError('Query embeddings must be a non-empty array');
    }

    if (queryChunks.length !== queryEmbeddings.length) {
      throw new DESCRetrievalError(
        'Query chunks and embeddings length must match',
        {
          queryChunks: queryChunks.length,
          queryEmbeddings: queryEmbeddings.length
        }
      );
    }

    // Validate embeddings are valid Float32Arrays
    for (let i = 0; i < queryEmbeddings.length; i++) {
      const embedding = queryEmbeddings[i];
      if (!(embedding instanceof Float32Array) || embedding.length === 0) {
        throw new DESCRetrievalError(
          `Invalid embedding at index ${i}`,
          { index: i }
        );
      }

      // Check for invalid values
      if (embedding.some(v => !Number.isFinite(v))) {
        throw new DESCRetrievalError(
          `Embedding at index ${i} contains non-finite values`,
          { index: i }
        );
      }
    }
  }

  /**
   * Update retrieval options
   */
  updateOptions(options: Partial<IRetrievalOptions>): void {
    this.options = {
      ...this.options,
      ...options
    };
  }

  /**
   * Get current retrieval options
   */
  getOptions(): Required<IRetrievalOptions> {
    return { ...this.options };
  }

  /**
   * Get the underlying store
   */
  getStore(): IDualEmbeddingStore {
    return this.store;
  }

  /**
   * Get the injection filter
   */
  getFilter(): IInjectionFilter {
    return this.filter;
  }
}
