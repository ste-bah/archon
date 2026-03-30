/**
 * IDESC-001: Intelligent DESC v2 - Outcome Tracker
 * TASK-IDESC-OUT-001: Implement OutcomeStorage Class
 * TASK-IDESC-OUT-002: Create Success Rate Calculator
 *
 * Implements: REQ-IDESC-001, REQ-IDESC-002, NFR-IDESC-001
 * Constitution: GUARD-IDESC-001 (append-only), GUARD-IDESC-005 (graceful degradation)
 *
 * Records and retrieves episode outcomes for intelligent injection decisions.
 * Performance target: <10ms p95 for recordOutcome (NFR-IDESC-001)
 */

import { randomUUID } from 'crypto';
import type {
  IOutcome,
  IOutcomeInput,
  IOutcomeStorage,
  IEpisodeStats,
  IWarningConfig,
  IWarningMessage,
  ErrorType
} from '../types.js';
import {
  OutcomeRecordingError,
  EpisodeNotFoundError,
  InvalidOutcomeError,
  InsufficientOutcomeDataError
} from './errors.js';

/**
 * Database connection interface (compatible with better-sqlite3 and daemon IPC)
 */
export interface IDatabaseConnection {
  run(sql: string, params?: unknown[]): Promise<{ lastInsertRowid: number | bigint }>;
  get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

/**
 * Default warning configuration
 */
const DEFAULT_WARNING_CONFIG: IWarningConfig = {
  warningThreshold: 0.5,
  minimumOutcomes: 3
};

/**
 * OutcomeTracker - Core implementation of IOutcomeStorage
 *
 * Provides outcome recording and retrieval with:
 * - Append-only storage (GUARD-IDESC-001)
 * - Statistical validity checks (REQ-IDESC-002)
 * - Warning generation for negative examples (REQ-IDESC-003, REQ-IDESC-004)
 * - Performance optimization via caching
 */
export class OutcomeTracker implements IOutcomeStorage {
  private readonly warningConfig: IWarningConfig;

  // In-memory cache for success rates (performance optimization)
  private successRateCache = new Map<string, { rate: number | null; expiresAt: number }>();
  private readonly cacheDurationMs = 60_000; // 60 seconds

  constructor(
    private readonly db: IDatabaseConnection,
    warningConfig?: Partial<IWarningConfig>
  ) {
    this.warningConfig = { ...DEFAULT_WARNING_CONFIG, ...warningConfig };
  }

  /**
   * Record an outcome for an episode
   * Implements: REQ-IDESC-001, NFR-IDESC-001 (<10ms p95)
   *
   * @param outcome - Outcome to record
   * @returns Outcome ID on success
   * @throws OutcomeRecordingError if recording fails
   */
  async recordOutcome(outcome: IOutcomeInput): Promise<string> {
    const startTime = performance.now();

    // Validate input
    this.validateOutcomeInput(outcome);

    const outcomeId = randomUUID();
    const recordedAt = new Date().toISOString();

    try {
      // Verify episode exists
      const episodeExists = await this.db.get<{ episode_id: string }>(
        'SELECT episode_id FROM episodes WHERE episode_id = ?',
        [outcome.episodeId]
      );

      if (!episodeExists) {
        throw new EpisodeNotFoundError(outcome.episodeId);
      }

      // Insert outcome (append-only per GUARD-IDESC-001)
      await this.db.run(
        `INSERT INTO episode_outcomes
         (outcome_id, episode_id, task_id, success, error_type, details, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          outcomeId,
          outcome.episodeId,
          outcome.taskId,
          outcome.success ? 1 : 0,
          outcome.errorType || null,
          outcome.details ? JSON.stringify(outcome.details) : null,
          recordedAt
        ]
      );

      // Invalidate cache for this episode
      this.successRateCache.delete(outcome.episodeId);

      // Log performance
      const duration = performance.now() - startTime;
      if (duration > 10) {
        console.warn(`[OutcomeTracker] recordOutcome exceeded 10ms: ${duration.toFixed(2)}ms`);
      }

      return outcomeId;
    } catch (error) {
      if (error instanceof EpisodeNotFoundError) {
        throw error;
      }
      throw new OutcomeRecordingError(
        `Failed to record outcome: ${error instanceof Error ? error.message : 'Unknown error'}`,
        outcome.episodeId,
        outcome.taskId,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get all outcomes for an episode
   * @param episodeId - Episode to get outcomes for
   * @returns List of outcomes (newest first)
   */
  async getOutcomes(episodeId: string): Promise<IOutcome[]> {
    const rows = await this.db.all<{
      outcome_id: string;
      episode_id: string;
      task_id: string;
      success: number;
      error_type: string | null;
      details: string | null;
      recorded_at: string;
    }>(
      `SELECT * FROM episode_outcomes
       WHERE episode_id = ?
       ORDER BY recorded_at DESC`,
      [episodeId]
    );

    return rows.map(row => this.rowToOutcome(row));
  }

  /**
   * Get success rate for an episode
   * Implements: REQ-IDESC-002 (minimum 3 samples)
   *
   * @param episodeId - Episode to get rate for
   * @returns Success rate (0-1) or null if outcomeCount < 3
   */
  async getSuccessRate(episodeId: string): Promise<number | null> {
    // Check cache first
    const cached = this.successRateCache.get(episodeId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.rate;
    }

    // Get from denormalized stats table (fast O(1) lookup)
    const stats = await this.db.get<{
      success_rate: number | null;
    }>(
      'SELECT success_rate FROM episode_stats WHERE episode_id = ?',
      [episodeId]
    );

    const rate = stats?.success_rate ?? null;

    // Cache the result
    this.successRateCache.set(episodeId, {
      rate,
      expiresAt: Date.now() + this.cacheDurationMs
    });

    return rate;
  }

  /**
   * Get outcome count for an episode
   * @param episodeId - Episode to count outcomes for
   * @returns Number of outcomes
   */
  async getOutcomeCount(episodeId: string): Promise<number> {
    const stats = await this.db.get<{ outcome_count: number }>(
      'SELECT outcome_count FROM episode_stats WHERE episode_id = ?',
      [episodeId]
    );
    return stats?.outcome_count ?? 0;
  }

  /**
   * Get episode statistics
   * @param episodeId - Episode to get stats for
   * @returns Pre-computed statistics
   */
  async getEpisodeStats(episodeId: string): Promise<IEpisodeStats> {
    const row = await this.db.get<{
      episode_id: string;
      outcome_count: number;
      success_count: number;
      failure_count: number;
      success_rate: number | null;
      last_outcome_at: string | null;
    }>(
      'SELECT * FROM episode_stats WHERE episode_id = ?',
      [episodeId]
    );

    if (!row) {
      return {
        episodeId,
        outcomeCount: 0,
        successCount: 0,
        failureCount: 0,
        successRate: null,
        lastOutcomeAt: null
      };
    }

    return {
      episodeId: row.episode_id,
      outcomeCount: row.outcome_count,
      successCount: row.success_count,
      failureCount: row.failure_count,
      successRate: row.success_rate,
      lastOutcomeAt: row.last_outcome_at ? new Date(row.last_outcome_at) : null
    };
  }

  /**
   * Get failure outcomes for an episode
   * @param episodeId - Episode to get failures for
   * @param limit - Maximum number of failures to return (default: 5)
   * @returns List of failure outcomes (newest first)
   */
  async getFailures(episodeId: string, limit: number = 5): Promise<IOutcome[]> {
    const rows = await this.db.all<{
      outcome_id: string;
      episode_id: string;
      task_id: string;
      success: number;
      error_type: string | null;
      details: string | null;
      recorded_at: string;
    }>(
      `SELECT * FROM episode_outcomes
       WHERE episode_id = ? AND success = 0
       ORDER BY recorded_at DESC
       LIMIT ?`,
      [episodeId, limit]
    );

    return rows.map(row => this.rowToOutcome(row));
  }

  /**
   * Check if episode should trigger a warning
   * Implements: REQ-IDESC-003
   *
   * @param episodeId - Episode to check
   * @returns True if warning should be shown
   */
  async shouldWarn(episodeId: string): Promise<boolean> {
    const outcomeCount = await this.getOutcomeCount(episodeId);

    if (outcomeCount < this.warningConfig.minimumOutcomes) {
      return false;
    }

    const successRate = await this.getSuccessRate(episodeId);

    if (successRate === null) {
      return false;
    }

    return successRate < this.warningConfig.warningThreshold;
  }

  /**
   * Generate warning message for an episode
   * Implements: REQ-IDESC-004, AC-IDESC-001b
   *
   * @param episodeId - Episode to generate warning for
   * @returns Warning message or null if no warning needed
   */
  async generateWarning(episodeId: string): Promise<IWarningMessage | null> {
    const shouldWarn = await this.shouldWarn(episodeId);

    if (!shouldWarn) {
      return null;
    }

    const outcomes = await this.getOutcomes(episodeId);
    const successRate = await this.getSuccessRate(episodeId);
    const failures = outcomes.filter(o => !o.success);

    const recentFailures = failures.slice(0, 3).map(f => ({
      errorType: f.errorType || ('logic_error' as ErrorType),
      details: f.details ? JSON.stringify(f.details).substring(0, 100) : 'No details',
      timestamp: f.recordedAt
    }));

    const warningText = `
<negative_example_warning>
  <episode_id>${episodeId}</episode_id>
  <success_rate>${((successRate ?? 0) * 100).toFixed(0)}%</success_rate>
  <failure_count>${failures.length}</failure_count>

  <caution>
  This prior solution has a LOW success rate based on ${outcomes.length} previous uses.
  It may not be applicable to your current task or may contain errors.
  </caution>

  <recent_failures>
    ${recentFailures.map(f => `
    <failure>
      <error_type>${f.errorType}</error_type>
      <timestamp>${f.timestamp.toISOString()}</timestamp>
      <details>${f.details}</details>
    </failure>
    `).join('')}
  </recent_failures>

  <recommendation>
  Review this solution critically. Consider alternative approaches or verify its applicability to your specific context.
  </recommendation>
</negative_example_warning>
`.trim();

    return {
      episodeId,
      successRate: successRate ?? 0,
      totalOutcomes: outcomes.length,
      failureCount: failures.length,
      recentFailures,
      warningText
    };
  }

  /**
   * Get batch success rates for multiple episodes
   * Performance optimization for shouldInject with multiple candidates
   *
   * @param episodeIds - Episodes to get rates for
   * @returns Map of episodeId to success rate
   */
  async getBatchSuccessRates(episodeIds: string[]): Promise<Map<string, number | null>> {
    const results = new Map<string, number | null>();

    // Check cache first
    const uncached: string[] = [];
    for (const episodeId of episodeIds) {
      const cached = this.successRateCache.get(episodeId);
      if (cached && Date.now() < cached.expiresAt) {
        results.set(episodeId, cached.rate);
      } else {
        uncached.push(episodeId);
      }
    }

    if (uncached.length === 0) {
      return results;
    }

    // Batch query for uncached episodes
    const placeholders = uncached.map(() => '?').join(',');
    const rows = await this.db.all<{
      episode_id: string;
      success_rate: number | null;
    }>(
      `SELECT episode_id, success_rate FROM episode_stats WHERE episode_id IN (${placeholders})`,
      uncached
    );

    // Process results and cache
    const found = new Set<string>();
    for (const row of rows) {
      results.set(row.episode_id, row.success_rate);
      found.add(row.episode_id);
      this.successRateCache.set(row.episode_id, {
        rate: row.success_rate,
        expiresAt: Date.now() + this.cacheDurationMs
      });
    }

    // Episodes with no stats yet
    for (const episodeId of uncached) {
      if (!found.has(episodeId)) {
        results.set(episodeId, null);
        this.successRateCache.set(episodeId, {
          rate: null,
          expiresAt: Date.now() + this.cacheDurationMs
        });
      }
    }

    return results;
  }

  /**
   * Get cached success rate (PERF-001)
   * Public accessor for cache inspection
   *
   * @param episodeId - Episode to check cache for
   * @returns Cached success rate or null if not in cache or expired
   */
  getCachedSuccessRate(episodeId: string): number | null {
    const cached = this.successRateCache.get(episodeId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.rate;
    }
    return null;
  }

  /**
   * Prune old outcomes (PERF-003 - Memory Optimization)
   * Implements: GUARD-IDESC-007
   *
   * Removes episode outcomes older than specified days to keep memory usage under control.
   * Target: <10MB for 10K episodes
   *
   * @param daysOld - Age threshold in days (default: 90)
   * @returns Number of outcomes deleted
   */
  async pruneOldOutcomes(daysOld: number = 90): Promise<number> {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    try {
      const result = await this.db.run(
        'DELETE FROM episode_outcomes WHERE recorded_at < ?',
        [cutoff.toISOString()]
      );

      // Note: episode_stats will be automatically recalculated by triggers
      // Clear cache to force fresh queries
      this.clearCache();

      return Number(result.lastInsertRowid) || 0;
    } catch (error) {
      throw new OutcomeRecordingError(
        `Failed to prune old outcomes: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'system',
        'prune',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Clear the success rate cache
   * Useful for testing or forced refresh
   */
  clearCache(): void {
    this.successRateCache.clear();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Validate outcome input
   */
  private validateOutcomeInput(outcome: IOutcomeInput): void {
    if (!outcome.episodeId || typeof outcome.episodeId !== 'string') {
      throw new InvalidOutcomeError('episodeId is required and must be a string', outcome as Record<string, unknown>);
    }
    if (!outcome.taskId || typeof outcome.taskId !== 'string') {
      throw new InvalidOutcomeError('taskId is required and must be a string', outcome as Record<string, unknown>);
    }
    if (typeof outcome.success !== 'boolean') {
      throw new InvalidOutcomeError('success is required and must be a boolean', outcome as Record<string, unknown>);
    }
  }

  /**
   * Convert database row to IOutcome
   */
  private rowToOutcome(row: {
    outcome_id: string;
    episode_id: string;
    task_id: string;
    success: number;
    error_type: string | null;
    details: string | null;
    recorded_at: string;
  }): IOutcome {
    return {
      outcomeId: row.outcome_id,
      episodeId: row.episode_id,
      taskId: row.task_id,
      success: row.success === 1,
      errorType: row.error_type as ErrorType | undefined,
      details: row.details ? JSON.parse(row.details) : undefined,
      recordedAt: new Date(row.recorded_at)
    };
  }
}

/**
 * Factory function to create OutcomeTracker with daemon IPC
 */
export function createOutcomeTracker(
  db: IDatabaseConnection,
  warningConfig?: Partial<IWarningConfig>
): OutcomeTracker {
  return new OutcomeTracker(db, warningConfig);
}
