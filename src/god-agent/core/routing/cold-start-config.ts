/**
 * DAI-003: Intelligent Task Routing Cold Start Configuration
 *
 * TASK-003: Cold Start Configuration
 * Constitution: RULE-DAI-003-006 (cold start mode must be explicit)
 *
 * Provides:
 * - Phase determination based on execution count
 * - Weight calculation per phase
 * - Cold start indicator formatting
 * - Validation for execution counts
 *
 * Phase thresholds:
 * - keyword-only: 0-25 executions
 * - blended: 26-100 executions
 * - learned: 100+ executions
 *
 * Weight progression:
 * - keyword-only: keyword=1.0, capability=0.0
 * - blended: keyword=0.7, capability=0.3
 * - learned: keyword=0.2, capability=0.8
 *
 * @module src/god-agent/core/routing/cold-start-config
 */

import {
  ColdStartPhase,
  IColdStartConfig,
  DEFAULT_COLD_START_CONFIG,
} from './routing-types.js';
import { RoutingError } from './routing-errors.js';

/**
 * Default cold start configuration (re-export)
 */
export const defaultColdStartConfig: IColdStartConfig = DEFAULT_COLD_START_CONFIG;

/**
 * Determine the cold start phase based on execution count
 *
 * Phase thresholds:
 * - keyword-only: 0-25 executions (pure keyword matching)
 * - blended: 26-100 executions (keyword + capability)
 * - learned: 100+ executions (full learned routing)
 *
 * @param executionCount - Current execution count
 * @param config - Cold start configuration (optional)
 * @returns Cold start phase
 * @throws RoutingError if execution count is negative
 *
 * @example
 * ```typescript
 * const phase = getColdStartPhase(15); // 'keyword-only'
 * const phase2 = getColdStartPhase(50); // 'blended'
 * const phase3 = getColdStartPhase(150); // 'learned'
 * ```
 */
export function getColdStartPhase(
  executionCount: number,
  config: IColdStartConfig = DEFAULT_COLD_START_CONFIG
): ColdStartPhase {
  // Validate execution count
  if (executionCount < 0) {
    throw new RoutingError(
      `Invalid execution count: ${executionCount}. Must be non-negative.`,
      { confidence: 0 }
    );
  }

  // Determine phase based on thresholds
  if (executionCount <= config.keywordOnlyThreshold) {
    return 'keyword-only';
  } else if (executionCount <= config.learnedThreshold) {
    return 'blended';
  } else {
    return 'learned';
  }
}

/**
 * Get keyword and capability weights for a given cold start phase
 *
 * Weight progression:
 * - keyword-only: keyword=1.0, capability=0.0
 * - blended: keyword=0.7, capability=0.3
 * - learned: keyword=0.2, capability=0.8
 *
 * Capability weight is always (1.0 - keyword weight) to ensure they sum to 1.0
 *
 * @param phase - Cold start phase
 * @param config - Cold start configuration (optional)
 * @returns Object with keywordWeight and capabilityWeight
 *
 * @example
 * ```typescript
 * const weights = getColdStartWeights('keyword-only');
 * // { keywordWeight: 1.0, capabilityWeight: 0.0 }
 *
 * const weights2 = getColdStartWeights('blended');
 * // { keywordWeight: 0.7, capabilityWeight: 0.3 }
 *
 * const weights3 = getColdStartWeights('learned');
 * // { keywordWeight: 0.2, capabilityWeight: 0.8 }
 * ```
 */
export function getColdStartWeights(
  phase: ColdStartPhase,
  config: IColdStartConfig = DEFAULT_COLD_START_CONFIG
): { keywordWeight: number; capabilityWeight: number } {
  let keywordWeight: number;

  switch (phase) {
    case 'keyword-only':
      keywordWeight = config.keywordOnlyWeight;
      break;
    case 'blended':
      keywordWeight = config.blendedKeywordWeight;
      break;
    case 'learned':
      keywordWeight = config.learnedKeywordWeight;
      break;
  }

  // Capability weight is always complement of keyword weight
  const capabilityWeight = 1.0 - keywordWeight;

  return { keywordWeight, capabilityWeight };
}

/**
 * Format a cold start indicator message for routing results
 *
 * Per RULE-DAI-003-006, cold start mode must be explicit in routing results.
 *
 * Format:
 * - Cold start (< 100 executions): "[Cold Start Mode: X/100 executions]"
 * - Learned (≥ 100 executions): "[Learned Mode]"
 *
 * @param phase - Cold start phase
 * @param executionCount - Current execution count
 * @returns Formatted cold start indicator string
 *
 * @example
 * ```typescript
 * const indicator = formatColdStartIndicator('keyword-only', 15);
 * // "[Cold Start Mode: 15/100 executions]"
 *
 * const indicator2 = formatColdStartIndicator('blended', 75);
 * // "[Cold Start Mode: 75/100 executions]"
 *
 * const indicator3 = formatColdStartIndicator('learned', 150);
 * // "[Learned Mode]"
 * ```
 */
export function formatColdStartIndicator(
  phase: ColdStartPhase,
  executionCount: number
): string {
  if (phase === 'learned') {
    return '[Learned Mode]';
  } else {
    // Cold start phases (keyword-only or blended)
    return `[Cold Start Mode: ${executionCount}/100 executions]`;
  }
}
