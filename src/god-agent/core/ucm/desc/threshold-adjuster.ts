/**
 * IDESC-001: Intelligent DESC v2 - Threshold Adjustment Algorithm
 * TASK-IDESC-LEARN-003: Implement Threshold Adjustment Algorithm
 * Sprint 6: Active Learning
 *
 * Automatic threshold adjustment based on outcome feedback.
 *
 * Implements:
 * - REQ-IDESC-013: Track threshold changes by category
 * - REQ-IDESC-014: Adjust thresholds based on success rate
 * - REQ-IDESC-015: Bound adjustments to ±5% per 30 days
 * - REQ-IDESC-016: Require minimum 10 samples for adjustment
 * - AC-IDESC-006a: Track all adjustment history
 * - AC-IDESC-006b: Support manual overrides
 * - AC-IDESC-006c: Manual overrides take precedence
 *
 * Constitution:
 * - GUARD-IDESC-003: Bound threshold changes to ±5% per 30 days
 * - GUARD-IDESC-005: Graceful degradation on errors
 * - EC-IDESC-008: Minimum 10 samples for statistical validity
 */

import { randomUUID } from 'crypto';
import type { WorkflowCategory } from '../types.js';
import type { IMetricsAggregator } from './metrics-aggregator.js';
import type { IDatabaseConnection } from './outcome-tracker.js';
import {
  ThresholdError,
  ThresholdBoundsError,
  InvalidThresholdError
} from './errors.js';

/**
 * Threshold adjustment record
 * Implements: REQ-IDESC-013, AC-IDESC-006a
 */
export interface IThresholdAdjustment {
  /** Workflow category */
  category: WorkflowCategory;
  /** Previous threshold value */
  oldThreshold: number;
  /** New threshold value */
  newThreshold: number;
  /** Reason for adjustment */
  reason: string;
  /** When adjustment was made */
  timestamp: Date;
  /** Number of samples used for decision */
  samplesUsed: number;
  /** Whether this is a manual override */
  isManualOverride?: boolean;
}

/**
 * Threshold configuration
 * Implements: REQ-IDESC-015, EC-IDESC-008
 */
export interface IThresholdConfig {
  /** Base threshold values by category */
  baseThresholds: Record<WorkflowCategory, number>;
  /** Maximum adjustment per period (default: 0.05 = 5%) */
  maxAdjustmentPerPeriod: number;
  /** Adjustment period in days (default: 30) */
  adjustmentPeriodDays: number;
  /** Minimum samples required for adjustment (default: 10) */
  minimumSamples: number;
  /** Target success rate for optimization (default: 0.80) */
  targetSuccessRate: number;
}

/**
 * Threshold adjuster interface
 * Implements: REQ-IDESC-014
 */
export interface IThresholdAdjuster {
  /**
   * Get current thresholds for all categories
   * @returns Map of category -> current threshold
   */
  getCurrentThresholds(): Record<WorkflowCategory, number>;

  /**
   * Propose threshold adjustment based on metrics
   * @param category - Workflow category to adjust
   * @returns Proposed adjustment or null if no adjustment needed
   */
  proposeAdjustment(category: WorkflowCategory): Promise<IThresholdAdjustment | null>;

  /**
   * Apply threshold adjustment
   * @param adjustment - Adjustment to apply
   * @throws ThresholdBoundsError if adjustment violates bounds
   */
  applyAdjustment(adjustment: IThresholdAdjustment): Promise<void>;

  /**
   * Get adjustment history
   * @param category - Optional category filter
   * @param limit - Maximum number of adjustments to return
   * @returns Array of adjustments (newest first)
   */
  getAdjustmentHistory(category?: WorkflowCategory, limit?: number): Promise<IThresholdAdjustment[]>;

  /**
   * Reset thresholds to base values
   */
  resetToDefaults(): void;

  /**
   * Set manual override for a category
   * Implements: AC-IDESC-006b
   * @param category - Category to override
   * @param threshold - Threshold value
   */
  setManualOverride(category: WorkflowCategory, threshold: number): void;

  /**
   * Clear manual override for a category
   * @param category - Category to clear override for
   */
  clearManualOverride(category: WorkflowCategory): void;
}

/**
 * Default threshold configuration
 * Implements: REQ-IDESC-015, EC-IDESC-008
 */
const DEFAULT_THRESHOLD_CONFIG: IThresholdConfig = {
  baseThresholds: {
    research: 0.80,
    coding: 0.75,
    general: 0.70
  },
  maxAdjustmentPerPeriod: 0.05,  // 5%
  adjustmentPeriodDays: 30,
  minimumSamples: 10,
  targetSuccessRate: 0.80
};

/**
 * ThresholdAdjuster - Automatic threshold adjustment based on metrics
 *
 * Features:
 * - Bounded adjustments (±5% per 30 days)
 * - Minimum sample requirements (10 outcomes)
 * - Manual override support
 * - Audit trail persistence
 */
export class ThresholdAdjuster implements IThresholdAdjuster {
  private currentThresholds: Record<WorkflowCategory, number>;
  private manualOverrides: Map<WorkflowCategory, number>;
  private readonly config: IThresholdConfig;

  constructor(
    private readonly db: IDatabaseConnection,
    private readonly metricsAggregator: IMetricsAggregator,
    config?: Partial<IThresholdConfig>
  ) {
    this.config = { ...DEFAULT_THRESHOLD_CONFIG, ...config };
    this.currentThresholds = { ...this.config.baseThresholds };
    this.manualOverrides = new Map();
  }

  /**
   * Get current thresholds for all categories
   */
  getCurrentThresholds(): Record<WorkflowCategory, number> {
    // Manual overrides take precedence (AC-IDESC-006c)
    const result = { ...this.currentThresholds };
    this.manualOverrides.forEach((threshold, category) => {
      result[category] = threshold;
    });
    return result;
  }

  /**
   * Propose threshold adjustment based on metrics
   * Implements: REQ-IDESC-014, REQ-IDESC-016
   */
  async proposeAdjustment(category: WorkflowCategory): Promise<IThresholdAdjustment | null> {
    try {
      // Check if manual override is set (AC-IDESC-006c)
      if (this.manualOverrides.has(category)) {
        console.log(`[ThresholdAdjuster] Category ${category} has manual override, skipping adjustment`);
        return null;
      }

      // Get metrics for category
      const metrics = await this.metricsAggregator.getMetrics(category, '30d');
      if (metrics.length === 0) {
        return null; // No data for this category
      }

      const categoryMetrics = metrics[0];
      const { injectionCount, successRate } = categoryMetrics;

      // Check minimum samples requirement (EC-IDESC-008)
      if (injectionCount < this.config.minimumSamples) {
        console.log(`[ThresholdAdjuster] Category ${category} has ${injectionCount} samples, minimum ${this.config.minimumSamples} required`);
        return null;
      }

      // Get current threshold (accounting for manual overrides)
      const currentThreshold = this.getCurrentThresholds()[category];

      // Calculate proposed adjustment
      const proposedThreshold = this.calculateProposedThreshold(
        currentThreshold,
        successRate,
        category
      );

      // Check if adjustment is significant enough (>0.5%)
      const delta = Math.abs(proposedThreshold - currentThreshold);
      if (delta < 0.005) {
        console.log(`[ThresholdAdjuster] Category ${category} delta ${delta.toFixed(4)} too small, no adjustment needed`);
        return null;
      }

      // Validate bounds (GUARD-IDESC-003)
      await this.validateAdjustmentBounds(category, currentThreshold, proposedThreshold);

      // Generate reason
      const reason = this.generateAdjustmentReason(currentThreshold, proposedThreshold, successRate);

      return {
        category,
        oldThreshold: currentThreshold,
        newThreshold: proposedThreshold,
        reason,
        timestamp: new Date(),
        samplesUsed: injectionCount,
        isManualOverride: false
      };
    } catch (error) {
      // GUARD-IDESC-005: Graceful degradation
      if (error instanceof ThresholdError) {
        throw error; // Re-throw threshold-specific errors (RULE-070: already typed)
      }
      console.error(`[ThresholdAdjuster] Failed to propose adjustment for ${category}:`, error);
      return null;
    }
  }

  /**
   * Calculate proposed threshold based on success rate
   * Implements: REQ-IDESC-014
   */
  private calculateProposedThreshold(
    currentThreshold: number,
    successRate: number,
    category: WorkflowCategory
  ): number {
    const targetRate = this.config.targetSuccessRate;

    // Calculate delta based on success rate deviation
    let delta = 0;

    if (successRate > 0.85) {
      // Excellent results - can lower threshold to allow more injections
      delta = -0.02; // Lower by 2%
    } else if (successRate > targetRate) {
      // Good results - small reduction
      delta = -0.01; // Lower by 1%
    } else if (successRate < 0.60) {
      // Poor results - raise threshold to be more selective
      delta = 0.03; // Raise by 3%
    } else if (successRate < targetRate) {
      // Below target - moderate increase
      delta = 0.02; // Raise by 2%
    }

    // Apply delta and bound to [0, 1]
    const proposed = Math.max(0, Math.min(1, currentThreshold + delta));

    return Math.round(proposed * 1000) / 1000; // Round to 3 decimals
  }

  /**
   * Generate human-readable reason for adjustment
   */
  private generateAdjustmentReason(
    oldThreshold: number,
    newThreshold: number,
    successRate: number
  ): string {
    const direction = newThreshold > oldThreshold ? 'Raising' : 'Lowering';
    const percentChange = Math.abs((newThreshold - oldThreshold) / oldThreshold * 100).toFixed(1);
    const successPercent = (successRate * 100).toFixed(1);

    return `${direction} threshold by ${percentChange}% based on ${successPercent}% success rate`;
  }

  /**
   * Validate that adjustment is within bounds
   * Implements: GUARD-IDESC-003
   */
  private async validateAdjustmentBounds(
    category: WorkflowCategory,
    currentValue: number,
    proposedValue: number
  ): Promise<void> {
    // Validate threshold range [0, 1] first (before checking period bounds)
    if (proposedValue < 0 || proposedValue > 1) {
      throw new InvalidThresholdError(
        category,
        proposedValue,
        'Threshold must be between 0 and 1'
      );
    }

    // Get total adjustment in current period
    const periodAdjustment = await this.getPeriodAdjustment(category);
    const requestedAdjustment = proposedValue - currentValue;
    const totalAdjustment = periodAdjustment + requestedAdjustment;

    const maxAdjustment = this.config.maxAdjustmentPerPeriod;

    // Check bounds
    if (Math.abs(totalAdjustment) > maxAdjustment) {
      throw new ThresholdBoundsError(
        category,
        currentValue,
        proposedValue,
        maxAdjustment,
        this.config.adjustmentPeriodDays
      );
    }
  }

  /**
   * Get total adjustment in current period
   * Implements: GUARD-IDESC-003
   */
  private async getPeriodAdjustment(category: WorkflowCategory): Promise<number> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - this.config.adjustmentPeriodDays);
      const startDateStr = startDate.toISOString();

      const sql = `
        SELECT
          SUM(new_threshold - old_threshold) as total_adjustment
        FROM threshold_adjustments
        WHERE category = ?
          AND adjusted_at >= ?
          AND is_manual_override = 0
      `;

      const result = await this.db.get<{ total_adjustment: number | null }>(sql, [category, startDateStr]);

      return result?.total_adjustment ?? 0;
    } catch (error) {
      console.error('[ThresholdAdjuster] Failed to get period adjustment:', error);
      return 0; // Fail safe - assume no adjustment
    }
  }

  /**
   * Apply threshold adjustment
   * Implements: REQ-IDESC-013, AC-IDESC-006a
   */
  async applyAdjustment(adjustment: IThresholdAdjustment): Promise<void> {
    try {
      // Validate adjustment bounds
      await this.validateAdjustmentBounds(
        adjustment.category,
        adjustment.oldThreshold,
        adjustment.newThreshold
      );

      // Update current threshold
      this.currentThresholds[adjustment.category] = adjustment.newThreshold;

      // Persist to database
      await this.db.run(
        `INSERT INTO threshold_adjustments (
          id,
          category,
          old_threshold,
          new_threshold,
          reason,
          samples_used,
          is_manual_override,
          adjusted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          adjustment.category,
          adjustment.oldThreshold,
          adjustment.newThreshold,
          adjustment.reason,
          adjustment.samplesUsed,
          adjustment.isManualOverride ? 1 : 0,
          adjustment.timestamp.toISOString()
        ]
      );

      console.log(`[ThresholdAdjuster] Applied adjustment for ${adjustment.category}: ${adjustment.oldThreshold} -> ${adjustment.newThreshold} (${adjustment.reason})`);
    } catch (error) {
      if (error instanceof ThresholdError) {
        throw error;
      }
      throw new ThresholdError(`Failed to apply adjustment for ${adjustment.category}`, {
        adjustment,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Get adjustment history
   * Implements: AC-IDESC-006a
   */
  async getAdjustmentHistory(
    category?: WorkflowCategory,
    limit: number = 50
  ): Promise<IThresholdAdjustment[]> {
    try {
      let sql = `
        SELECT
          category,
          old_threshold as oldThreshold,
          new_threshold as newThreshold,
          reason,
          samples_used as samplesUsed,
          is_manual_override as isManualOverride,
          adjusted_at as timestamp
        FROM threshold_adjustments
      `;

      const params: unknown[] = [];

      if (category) {
        sql += ' WHERE category = ?';
        params.push(category);
      }

      sql += ' ORDER BY adjusted_at DESC LIMIT ?';
      params.push(limit);

      const rows = await this.db.all<{
        category: string;
        oldThreshold: number;
        newThreshold: number;
        reason: string;
        samplesUsed: number;
        isManualOverride: number;
        timestamp: string;
      }>(sql, params);

      return rows.map(row => ({
        category: row.category as WorkflowCategory,
        oldThreshold: row.oldThreshold,
        newThreshold: row.newThreshold,
        reason: row.reason,
        samplesUsed: row.samplesUsed,
        isManualOverride: row.isManualOverride === 1,
        timestamp: new Date(row.timestamp)
      }));
    } catch (error) {
      console.error('[ThresholdAdjuster] Failed to get adjustment history:', error);
      return [];
    }
  }

  /**
   * Reset thresholds to base values
   */
  resetToDefaults(): void {
    this.currentThresholds = { ...this.config.baseThresholds };
    this.manualOverrides.clear();
    console.log('[ThresholdAdjuster] Reset thresholds to defaults');
  }

  /**
   * Set manual override for a category
   * Implements: AC-IDESC-006b, AC-IDESC-006c
   */
  setManualOverride(category: WorkflowCategory, threshold: number): void {
    // Validate threshold range
    if (threshold < 0 || threshold > 1) {
      throw new InvalidThresholdError(
        category,
        threshold,
        'Threshold must be between 0 and 1'
      );
    }

    this.manualOverrides.set(category, threshold);
    console.log(`[ThresholdAdjuster] Set manual override for ${category}: ${threshold}`);
  }

  /**
   * Clear manual override for a category
   */
  clearManualOverride(category: WorkflowCategory): void {
    this.manualOverrides.delete(category);
    console.log(`[ThresholdAdjuster] Cleared manual override for ${category}`);
  }
}

/**
 * Factory function to create ThresholdAdjuster
 *
 * @param db - Database connection
 * @param metricsAggregator - Metrics aggregator instance
 * @param config - Optional threshold configuration
 * @returns ThresholdAdjuster instance
 */
export function createThresholdAdjuster(
  db: IDatabaseConnection,
  metricsAggregator: IMetricsAggregator,
  config?: Partial<IThresholdConfig>
): ThresholdAdjuster {
  return new ThresholdAdjuster(db, metricsAggregator, config);
}

/**
 * Initialize threshold_adjustments table
 *
 * @param db - Database connection
 */
export async function initThresholdAdjustmentsTable(db: IDatabaseConnection): Promise<void> {
  try {
    await db.run(`
      CREATE TABLE IF NOT EXISTS threshold_adjustments (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        old_threshold REAL NOT NULL,
        new_threshold REAL NOT NULL,
        reason TEXT NOT NULL,
        samples_used INTEGER NOT NULL,
        is_manual_override INTEGER DEFAULT 0,
        adjusted_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create index for efficient queries
    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_threshold_adjustments_category
      ON threshold_adjustments(category, adjusted_at DESC)
    `);

    console.log('[ThresholdAdjuster] Initialized threshold_adjustments table');
  } catch (error) {
    console.error('[ThresholdAdjuster] Failed to initialize table:', error);
    // RULE-070: Re-throw with initialization context
    throw new Error(
      `Failed to initialize threshold_adjustments table: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}
