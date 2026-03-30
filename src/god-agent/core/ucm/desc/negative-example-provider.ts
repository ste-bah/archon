/**
 * IDESC-001: Intelligent DESC v2 - Negative Example Provider
 * TASK-IDESC-NEG-003: Build Negative Example Provider
 *
 * Implements: AC-IDESC-001c, AC-IDESC-001d
 * Constitution: GUARD-IDESC-005 (graceful degradation)
 *
 * Provides warnings for episodes with poor success rates and handles
 * deprioritization logic for negative examples in retrieval results.
 */

import type {
  IRetrievalResult,
  IEnhancedRetrievalResult,
  IWarningMessage,
  INegativeExampleConfig,
  IEpisodeStats
} from '../types.js';
import type { OutcomeTracker } from './outcome-tracker.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Default configuration for negative example handling
 */
export const DEFAULT_NEGATIVE_EXAMPLE_CONFIG: Required<INegativeExampleConfig> = {
  minimumOutcomes: 3,       // REQ-IDESC-002: minimum 3 outcomes
  warningThreshold: 0.50,   // AC-IDESC-001c: warn when < 50%
  deprioritizationFactor: 0.9 // Reduce score by 10% for low success
};

// ============================================================================
// Negative Example Provider
// ============================================================================

/**
 * Provides negative example warnings and deprioritization for retrieved episodes
 *
 * Key responsibilities:
 * - Detect episodes that should have warnings (success rate < 50% with >= 3 outcomes)
 * - Generate warning messages for inclusion in retrieval results
 * - Apply deprioritization to move failed episodes after successful ones
 * - Maintain graceful degradation if outcome data is unavailable
 */
export class NegativeExampleProvider {
  private readonly config: Required<INegativeExampleConfig>;
  private readonly statsCache: Map<string, { stats: IEpisodeStats | null; expiresAt: number }> = new Map();
  private readonly cacheDurationMs: number = 60000; // 1 minute

  constructor(
    private readonly outcomeTracker: OutcomeTracker,
    config?: Partial<INegativeExampleConfig>
  ) {
    this.config = {
      ...DEFAULT_NEGATIVE_EXAMPLE_CONFIG,
      ...config
    };
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Enhance retrieval results with warning information
   * Implements: AC-IDESC-001c, AC-IDESC-001d
   *
   * @param results - Original retrieval results
   * @returns Enhanced results with warnings and deprioritization applied
   */
  async enhanceResults(
    results: IRetrievalResult[]
  ): Promise<IEnhancedRetrievalResult[]> {
    if (results.length === 0) {
      return [];
    }

    // Get episode IDs for batch lookup
    const episodeIds = results.map(r => r.episodeId);

    // Batch fetch stats for all episodes
    const statsMap = await this.getBatchStats(episodeIds);

    // Enhance each result
    const enhanced = await Promise.all(
      results.map(async (result) => {
        const stats = statsMap.get(result.episodeId);
        return this.enhanceSingleResult(result, stats ?? null);
      })
    );

    // Sort: non-deprioritized first, then by original score
    return this.sortByDeprioritization(enhanced);
  }

  /**
   * Check if an episode should have a warning
   *
   * @param episodeId - Episode to check
   * @returns True if episode should trigger a warning
   */
  async shouldWarn(episodeId: string): Promise<boolean> {
    try {
      return await this.outcomeTracker.shouldWarn(episodeId);
    } catch {
      // INTENTIONAL: GUARD-IDESC-005 - Graceful degradation on tracker failure
      return false;
    }
  }

  /**
   * Generate a warning message for an episode
   *
   * @param episodeId - Episode to generate warning for
   * @returns Warning message or null if no warning needed
   */
  async getWarning(episodeId: string): Promise<IWarningMessage | null> {
    try {
      return await this.outcomeTracker.generateWarning(episodeId);
    } catch {
      // INTENTIONAL: GUARD-IDESC-005 - Graceful degradation on warning generation failure
      return null;
    }
  }

  /**
   * Get batch warnings for multiple episodes
   *
   * @param episodeIds - Episode IDs to check
   * @returns Map of episode ID to warning message (null if no warning)
   */
  async getBatchWarnings(
    episodeIds: string[]
  ): Promise<Map<string, IWarningMessage | null>> {
    const warnings = new Map<string, IWarningMessage | null>();

    // Process in parallel but handle failures gracefully
    const results = await Promise.allSettled(
      episodeIds.map(async id => ({
        id,
        warning: await this.getWarning(id)
      }))
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        warnings.set(result.value.id, result.value.warning);
      } else {
        // Failed - set null warning (graceful degradation)
        warnings.set(
          (result.reason as { episodeId?: string })?.episodeId ?? 'unknown',
          null
        );
      }
    }

    return warnings;
  }

  /**
   * Calculate deprioritization factor for an episode
   *
   * @param successRate - Episode success rate (null if insufficient data)
   * @param outcomeCount - Number of outcomes
   * @returns Factor to multiply score by (1.0 = no change, < 1.0 = deprioritized)
   */
  getDeprioritizationFactor(
    successRate: number | null,
    outcomeCount: number
  ): number {
    // No data or insufficient data - no deprioritization
    if (successRate === null || outcomeCount < this.config.minimumOutcomes) {
      return 1.0;
    }

    // High success rate - no deprioritization
    if (successRate >= this.config.warningThreshold) {
      return 1.0;
    }

    // Low success rate - apply deprioritization
    // Scale factor: 50% success = 0.9, 0% success = 0.8
    const successPenalty = (1 - successRate) * 0.1;
    return Math.max(0.8, this.config.deprioritizationFactor - successPenalty);
  }

  // --------------------------------------------------------------------------
  // Private Methods
  // --------------------------------------------------------------------------

  /**
   * Get episode stats with caching
   */
  private async getStats(episodeId: string): Promise<IEpisodeStats | null> {
    // Check cache
    const cached = this.statsCache.get(episodeId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.stats;
    }

    try {
      const stats = await this.outcomeTracker.getEpisodeStats(episodeId);
      this.statsCache.set(episodeId, {
        stats,
        expiresAt: Date.now() + this.cacheDurationMs
      });
      return stats;
    } catch {
      // INTENTIONAL: Graceful degradation - return null stats on tracker failure
      return null;
    }
  }

  /**
   * Get batch stats for multiple episodes
   */
  private async getBatchStats(
    episodeIds: string[]
  ): Promise<Map<string, IEpisodeStats | null>> {
    const statsMap = new Map<string, IEpisodeStats | null>();

    // Use batch method from OutcomeTracker for efficiency
    try {
      const rates = await this.outcomeTracker.getBatchSuccessRates(episodeIds);

      // For each episode, get full stats (cached) if we have rate data
      const statsPromises = episodeIds.map(async id => {
        const rate = rates.get(id);
        if (rate !== undefined) {
          const stats = await this.getStats(id);
          return { id, stats };
        }
        return { id, stats: null };
      });

      const results = await Promise.all(statsPromises);
      for (const { id, stats } of results) {
        statsMap.set(id, stats);
      }
    } catch {
      // INTENTIONAL: Graceful degradation - return null stats for all episodes on batch failure
      for (const id of episodeIds) {
        statsMap.set(id, null);
      }
    }

    return statsMap;
  }

  /**
   * Enhance a single retrieval result with warning and stats
   */
  private async enhanceSingleResult(
    result: IRetrievalResult,
    stats: IEpisodeStats | null
  ): Promise<IEnhancedRetrievalResult> {
    const successRate = stats?.successRate ?? null;
    const outcomeCount = stats?.outcomeCount ?? 0;
    const shouldWarn = successRate !== null &&
      outcomeCount >= this.config.minimumOutcomes &&
      successRate < this.config.warningThreshold;

    // Get warning if needed
    let warning: IWarningMessage | undefined;
    if (shouldWarn) {
      warning = (await this.getWarning(result.episodeId)) ?? undefined;
    }

    // Calculate deprioritization
    const deprioritized = shouldWarn;
    const factor = this.getDeprioritizationFactor(successRate, outcomeCount);

    return {
      ...result,
      // Apply deprioritization factor to score
      maxSimilarity: result.maxSimilarity * factor,
      warning,
      deprioritized,
      successRate,
      outcomeCount
    };
  }

  /**
   * Sort results: non-deprioritized first, then by score
   * Implements: AC-IDESC-001d (deprioritized but not suppressed)
   */
  private sortByDeprioritization(
    results: IEnhancedRetrievalResult[]
  ): IEnhancedRetrievalResult[] {
    return results.sort((a, b) => {
      // Non-deprioritized first
      if (a.deprioritized !== b.deprioritized) {
        return a.deprioritized ? 1 : -1;
      }
      // Then by score (descending)
      return b.maxSimilarity - a.maxSimilarity;
    });
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a NegativeExampleProvider instance
 *
 * @param outcomeTracker - OutcomeTracker for accessing outcome data
 * @param config - Optional configuration overrides
 * @returns Configured NegativeExampleProvider
 */
export function createNegativeExampleProvider(
  outcomeTracker: OutcomeTracker,
  config?: Partial<INegativeExampleConfig>
): NegativeExampleProvider {
  return new NegativeExampleProvider(outcomeTracker, config);
}
