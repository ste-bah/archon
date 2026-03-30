/**
 * IDESC-001: Intelligent DESC v2 - Confidence Calculator
 * TASK-IDESC-CONF-001: Implement Multi-Factor Confidence Calculator
 *
 * Implements: REQ-IDESC-006, REQ-IDESC-007, REQ-IDESC-008
 *
 * Calculates confidence levels based on:
 * - Similarity score
 * - Success rate (from outcome tracking)
 * - Episode recency
 * - Workflow category
 */

import type {
  ConfidenceLevel,
  IConfidenceCalculator,
  WorkflowCategory
} from '../types.js';
import { WorkflowCategory as WC } from '../types.js';

/**
 * Workflow-specific similarity thresholds
 * Preserved from existing InjectionFilter (GUARD-IDESC-002)
 */
const THRESHOLDS: Record<WorkflowCategory, number> = {
  [WC.CODING]: 0.92,
  [WC.RESEARCH]: 0.80,
  [WC.GENERAL]: 0.85
};

/**
 * Confidence calculation configuration
 */
export interface IConfidenceConfig {
  /**
   * HIGH confidence requirements
   */
  high: {
    minSimilarity: number;      // Default: 0.95
    minSuccessRate: number;     // Default: 0.80
    maxAgeDays: number;         // Default: 14
    minOutcomes: number;        // Default: 3
  };

  /**
   * MEDIUM confidence requirements
   */
  medium: {
    minSuccessRate: number;     // Default: 0.50
  };

  /**
   * LOW confidence floor
   */
  low: {
    minSimilarity: number;      // Default: 0.70
  };
}

/**
 * Default confidence configuration
 * Implements: REQ-IDESC-006, REQ-IDESC-007, REQ-IDESC-008
 */
const DEFAULT_CONFIG: IConfidenceConfig = {
  high: {
    minSimilarity: 0.95,
    minSuccessRate: 0.80,
    maxAgeDays: 14,
    minOutcomes: 3
  },
  medium: {
    minSuccessRate: 0.50
  },
  low: {
    minSimilarity: 0.70
  }
};

/**
 * Memoization cache entry
 */
interface IMemoEntry {
  level: ConfidenceLevel;
  expiry: number;
}

/**
 * ConfidenceCalculator - Multi-factor confidence level calculation
 *
 * Confidence levels:
 * - HIGH: similarity >= 0.95 AND success_rate >= 0.80 AND age < 14 days AND outcomes >= 3
 * - MEDIUM: similarity >= threshold AND (success_rate >= 0.50 OR outcome_count < 3)
 * - LOW: similarity >= 0.70 AND below MEDIUM thresholds
 */
export class ConfidenceCalculator implements IConfidenceCalculator {
  private readonly config: IConfidenceConfig;

  // PERF-002: Memoization cache with 60s TTL
  private memoCache = new Map<string, IMemoEntry>();
  private readonly cacheTTLMs = 60000; // 60 seconds

  constructor(config?: Partial<IConfidenceConfig>) {
    this.config = {
      high: { ...DEFAULT_CONFIG.high, ...config?.high },
      medium: { ...DEFAULT_CONFIG.medium, ...config?.medium },
      low: { ...DEFAULT_CONFIG.low, ...config?.low }
    };
  }

  /**
   * Calculate confidence level for an injection
   * Implements: REQ-IDESC-006, REQ-IDESC-007, REQ-IDESC-008
   *
   * @param similarity - Similarity score (0-1)
   * @param successRate - Success rate (0-1 or null if insufficient data)
   * @param outcomeCount - Number of recorded outcomes
   * @param episodeCreatedAt - When the episode was created
   * @param category - Workflow category for threshold lookup
   * @returns Confidence level: HIGH, MEDIUM, or LOW
   */
  calculate(
    similarity: number,
    successRate: number | null,
    outcomeCount: number,
    episodeCreatedAt: Date,
    category: WorkflowCategory
  ): ConfidenceLevel {
    const ageDays = this.calculateAgeDays(episodeCreatedAt);
    const threshold = THRESHOLDS[category];

    // HIGH confidence (REQ-IDESC-006):
    // similarity >= 0.95 AND success_rate >= 0.80 AND age < 14 days AND outcomes >= 3
    if (this.isHighConfidence(similarity, successRate, outcomeCount, ageDays)) {
      return 'HIGH';
    }

    // MEDIUM confidence (REQ-IDESC-007):
    // similarity >= threshold AND (success_rate >= 0.50 OR outcome_count < 3)
    if (this.isMediumConfidence(similarity, successRate, outcomeCount, threshold)) {
      return 'MEDIUM';
    }

    // LOW confidence (REQ-IDESC-008):
    // similarity >= 0.70 AND below MEDIUM thresholds
    // Note: If similarity is below 0.70, the episode shouldn't be injected at all
    return 'LOW';
  }

  /**
   * Calculate detailed confidence metrics
   * Useful for debugging and logging
   */
  calculateDetailed(
    similarity: number,
    successRate: number | null,
    outcomeCount: number,
    episodeCreatedAt: Date,
    category: WorkflowCategory
  ): {
    confidence: ConfidenceLevel;
    factors: {
      similarity: number;
      successRate: number | null;
      outcomeCount: number;
      ageDays: number;
      threshold: number;
    };
    reasons: string[];
  } {
    const ageDays = this.calculateAgeDays(episodeCreatedAt);
    const threshold = THRESHOLDS[category];
    const confidence = this.calculate(similarity, successRate, outcomeCount, episodeCreatedAt, category);
    const reasons: string[] = [];

    if (confidence === 'HIGH') {
      reasons.push('High similarity (≥0.95)');
      reasons.push('High success rate (≥80%)');
      reasons.push('Recent episode (<14 days)');
      reasons.push('Sufficient outcomes (≥3)');
    } else if (confidence === 'MEDIUM') {
      reasons.push(`Similarity meets ${category} threshold (${threshold})`);
      if (successRate !== null && successRate >= this.config.medium.minSuccessRate) {
        reasons.push('Acceptable success rate (≥50%)');
      } else if (outcomeCount < this.config.high.minOutcomes) {
        reasons.push('Insufficient outcome data for certainty');
      }
    } else {
      if (similarity < this.config.high.minSimilarity) {
        reasons.push(`Similarity below 0.95 (${similarity.toFixed(3)})`);
      }
      if (successRate !== null && successRate < this.config.medium.minSuccessRate) {
        reasons.push(`Low success rate (${(successRate * 100).toFixed(0)}%)`);
      }
      if (ageDays >= this.config.high.maxAgeDays) {
        reasons.push(`Episode age (${ageDays.toFixed(0)} days) exceeds 14-day freshness`);
      }
    }

    return {
      confidence,
      factors: {
        similarity,
        successRate,
        outcomeCount,
        ageDays,
        threshold
      },
      reasons
    };
  }

  /**
   * Check if conditions meet HIGH confidence
   */
  private isHighConfidence(
    similarity: number,
    successRate: number | null,
    outcomeCount: number,
    ageDays: number
  ): boolean {
    return (
      similarity >= this.config.high.minSimilarity &&
      successRate !== null &&
      successRate >= this.config.high.minSuccessRate &&
      ageDays < this.config.high.maxAgeDays &&
      outcomeCount >= this.config.high.minOutcomes
    );
  }

  /**
   * Check if conditions meet MEDIUM confidence
   */
  private isMediumConfidence(
    similarity: number,
    successRate: number | null,
    outcomeCount: number,
    threshold: number
  ): boolean {
    // Must meet category threshold
    if (similarity < threshold) {
      return false;
    }

    // Either sufficient success rate OR insufficient data
    return (
      successRate === null ||
      successRate >= this.config.medium.minSuccessRate ||
      outcomeCount < this.config.high.minOutcomes
    );
  }

  /**
   * Calculate age in days from episode creation date
   */
  private calculateAgeDays(createdAt: Date): number {
    const now = Date.now();
    const created = createdAt.getTime();
    const msPerDay = 1000 * 60 * 60 * 24;
    return (now - created) / msPerDay;
  }

  /**
   * Calculate confidence with memoization (PERF-002)
   * Performance target: <1ms average
   *
   * @param similarity - Similarity score (0-1)
   * @param successRate - Success rate (0-1 or null)
   * @param outcomeCount - Number of outcomes
   * @param episodeCreatedAt - Episode creation date
   * @param category - Workflow category
   * @returns Cached or calculated confidence level
   */
  calculateMemoized(
    similarity: number,
    successRate: number | null,
    outcomeCount: number,
    episodeCreatedAt: Date,
    category: WorkflowCategory
  ): ConfidenceLevel {
    // Generate cache key
    const key = `${similarity.toFixed(4)}:${successRate?.toFixed(4) ?? 'null'}:${outcomeCount}:${episodeCreatedAt.getTime()}:${category}`;

    // Check cache
    const cached = this.memoCache.get(key);
    if (cached && Date.now() < cached.expiry) {
      return cached.level;
    }

    // Calculate and cache
    const level = this.calculate(similarity, successRate, outcomeCount, episodeCreatedAt, category);

    this.memoCache.set(key, {
      level,
      expiry: Date.now() + this.cacheTTLMs
    });

    return level;
  }

  /**
   * Batch calculate confidence for multiple episodes (PERF-002)
   * Optimizes injection decision for multiple candidates
   *
   * @param episodes - Array of episode data
   * @returns Array of confidence levels in same order
   */
  calculateBatch(episodes: Array<{
    similarity: number;
    successRate: number | null;
    outcomeCount: number;
    episodeCreatedAt: Date;
    category: WorkflowCategory;
  }>): ConfidenceLevel[] {
    return episodes.map(e =>
      this.calculateMemoized(
        e.similarity,
        e.successRate,
        e.outcomeCount,
        e.episodeCreatedAt,
        e.category
      )
    );
  }

  /**
   * Clear memoization cache
   * Useful for testing or forced recalculation
   */
  clearCache(): void {
    this.memoCache.clear();
  }

  /**
   * Get cache statistics (for monitoring)
   */
  getCacheStats(): { size: number; ttlMs: number } {
    return {
      size: this.memoCache.size,
      ttlMs: this.cacheTTLMs
    };
  }

  /**
   * Get current configuration (for testing/debugging)
   */
  getConfig(): IConfidenceConfig {
    return { ...this.config };
  }
}

/**
 * Factory function to create ConfidenceCalculator
 */
export function createConfidenceCalculator(
  config?: Partial<IConfidenceConfig>
): ConfidenceCalculator {
  return new ConfidenceCalculator(config);
}

/**
 * Format confidence level for display
 */
export function formatConfidence(confidence: ConfidenceLevel): string {
  switch (confidence) {
    case 'HIGH':
      return '🟢 HIGH';
    case 'MEDIUM':
      return '🟡 MEDIUM';
    case 'LOW':
      return '🔴 LOW';
  }
}

/**
 * Get confidence level description for injection output
 */
export function getConfidenceDescription(confidence: ConfidenceLevel): string {
  switch (confidence) {
    case 'HIGH':
      return 'This prior solution has high confidence based on recent successful uses and high similarity.';
    case 'MEDIUM':
      return 'This prior solution has medium confidence. Review for applicability to your specific context.';
    case 'LOW':
      return 'This prior solution has low confidence. Use with caution and verify carefully.';
  }
}
