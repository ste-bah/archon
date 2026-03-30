/**
 * Fusion Scorer for Quad-Fusion Unified Search
 * Implements weighted fusion with deduplication
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-SEARCH-002
 *
 * @module src/god-agent/core/search/fusion-scorer
 */

import type {
  SourceWeights,
  RawSourceResult,
  FusedSearchResult,
  AggregatedResults,
  SourceAttribution,
  SearchSource,
} from './search-types.js';
import { normalizeWeights } from './search-types.js';
import { computeContentHash } from './utils.js';

/**
 * Fusion scorer for combining results from multiple search sources
 * Uses weighted averaging with source failure redistribution
 */
export class FusionScorer {
  private weights: SourceWeights;

  /**
   * Create fusion scorer with initial weights
   * @param weights - Source weights (will be normalized)
   */
  constructor(weights: SourceWeights) {
    this.weights = normalizeWeights(weights);
  }

  /**
   * Fuse aggregated results into ranked results
   *
   * @param aggregated - Aggregated results from all sources
   * @param topK - Maximum number of results to return
   * @returns Fused and ranked results
   */
  fuse(aggregated: AggregatedResults, topK: number): FusedSearchResult[] {
    // 1. Calculate active weights (redistribute from failed sources)
    const activeWeights = this.calculateActiveWeights(aggregated);

    // 2. Deduplicate by content hash
    const deduped = this.deduplicate(aggregated.rawResults);

    // 3. Score and merge duplicates
    const scored = this.scoreResults(deduped, activeWeights);

    // 4. Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // 5. Return top K
    return scored.slice(0, topK);
  }

  /**
   * Calculate active weights, redistributing from failed/timed-out sources
   *
   * @param aggregated - Aggregated results with source outcomes
   * @returns Adjusted weights for active sources only
   */
  private calculateActiveWeights(aggregated: AggregatedResults): SourceWeights {
    const activeWeights: SourceWeights = { ...this.weights };
    let failedWeight = 0;
    const activeSources: SearchSource[] = [];

    // Identify failed sources and accumulate their weights
    for (const source of ['vector', 'graph', 'memory', 'pattern'] as const) {
      const outcome = aggregated.sourceOutcomes[source];
      if (!outcome || outcome.status !== 'success') {
        failedWeight += activeWeights[source];
        activeWeights[source] = 0;
      } else if (outcome.results.length > 0) {
        activeSources.push(source);
      }
    }

    // Redistribute failed weight proportionally to active sources
    if (failedWeight > 0 && activeSources.length > 0) {
      const totalActiveWeight = activeSources.reduce(
        (sum, source) => sum + activeWeights[source],
        0
      );

      if (totalActiveWeight > 0) {
        for (const source of activeSources) {
          const proportion = activeWeights[source] / totalActiveWeight;
          activeWeights[source] += failedWeight * proportion;
        }
      }
    }

    return activeWeights;
  }

  /**
   * Deduplicate results by content hash
   *
   * @param results - Raw results from all sources
   * @returns Map of content hash to array of results with that content
   */
  deduplicate(results: RawSourceResult[]): Map<string, RawSourceResult[]> {
    const groups = new Map<string, RawSourceResult[]>();

    for (const result of results) {
      const hash = this.computeContentHash(result.content);
      const existing = groups.get(hash);

      if (existing) {
        existing.push(result);
      } else {
        groups.set(hash, [result]);
      }
    }

    return groups;
  }

  /**
   * Score deduplicated result groups
   *
   * @param groups - Deduplicated result groups
   * @param activeWeights - Active source weights
   * @returns Fused results with combined scores
   */
  private scoreResults(
    groups: Map<string, RawSourceResult[]>,
    activeWeights: SourceWeights
  ): FusedSearchResult[] {
    const results: FusedSearchResult[] = [];

    for (const [contentHash, group] of groups) {
      // Use first result as representative
      const representative = group[0];

      // Calculate weighted score from all contributing sources
      const sources: SourceAttribution[] = [];
      let totalWeightedScore = 0;
      let totalWeight = 0;

      for (const result of group) {
        const weight = activeWeights[result.source];
        const weightedScore = result.score * weight;

        sources.push({
          source: result.source,
          originalScore: result.score,
          weightedScore,
          sourceMetadata: result.metadata,
        });

        totalWeightedScore += weightedScore;
        totalWeight += weight;
      }

      // Normalize by total weight used
      const fusedScore = totalWeight > 0 ? totalWeightedScore / totalWeight : 0;

      results.push({
        id: representative.id,
        content: representative.content,
        score: Math.min(1.0, Math.max(0, fusedScore)),
        contentHash,
        sources,
        metadata: this.mergeMetadata(group),
      });
    }

    return results;
  }

  /**
   * Merge metadata from multiple sources
   *
   * @param group - Group of results with same content
   * @returns Merged metadata object
   */
  private mergeMetadata(group: RawSourceResult[]): Record<string, unknown> {
    const merged: Record<string, unknown> = {};

    for (const result of group) {
      if (result.metadata) {
        // Prefix metadata with source to avoid collisions
        for (const [key, value] of Object.entries(result.metadata)) {
          merged[`${result.source}_${key}`] = value;
        }
      }
    }

    return merged;
  }

  /**
   * Compute SHA-256 content hash (first 16 chars)
   *
   * @param content - Content string to hash
   * @returns First 16 characters of SHA-256 hex digest
   */
  computeContentHash(content: string): string {
    return computeContentHash(content);
  }

  /**
   * Normalize weights to sum to 1.0
   *
   * @param weights - Weights to normalize
   * @returns Normalized weights
   */
  normalizeWeights(weights: SourceWeights): SourceWeights {
    return normalizeWeights(weights);
  }

  /**
   * Get current weights
   *
   * @returns Current source weights
   */
  getWeights(): SourceWeights {
    return { ...this.weights };
  }

  /**
   * Update weights
   *
   * @param weights - New weights (will be normalized)
   */
  updateWeights(weights: SourceWeights): void {
    this.weights = normalizeWeights(weights);
  }
}
