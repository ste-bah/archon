/**
 * Confidence Scoring for Pattern Matching
 *
 * Implements: TASK-PAT-001 (Confidence Scorer)
 *
 * Provides confidence scoring, calibration, and ranking for pattern results.
 * Performance target: <1ms per pattern scoring
 */

import { Pattern, PatternResult } from './pattern-types.js';

/**
 * Calculate raw confidence score for a pattern match
 *
 * Formula: confidence = similarity × successRate × sonaWeight
 *
 * @param similarity - Vector similarity [0, 1] from HNSW search
 * @param successRate - Historical success rate [0, 1]
 * @param sonaWeight - SONA confidence weight [0, 1]
 * @returns Raw confidence score [0, 1]
 */
export function calculateConfidence(
  similarity: number,
  successRate: number,
  sonaWeight: number
): number {
  // Clamp inputs to [0, 1] to handle floating-point precision issues
  const clampedSimilarity = Math.max(0, Math.min(1, similarity));
  const clampedSuccessRate = Math.max(0, Math.min(1, successRate));
  const clampedSonaWeight = Math.max(0, Math.min(1, sonaWeight));

  // Simple multiplicative combination
  return clampedSimilarity * clampedSuccessRate * clampedSonaWeight;
}

/**
 * Calibrate raw confidence using sigmoid function
 *
 * Maps raw confidence to calibrated confidence with better distribution.
 * Uses sigmoid centered at 0.5 with steepness parameter.
 *
 * Formula: sigmoid(x) = 1 / (1 + exp(-k * (x - 0.5)))
 * where k controls steepness (higher k = steeper curve)
 *
 * @param rawConfidence - Raw confidence score [0, 1]
 * @param steepness - Sigmoid steepness parameter (default: 10)
 * @returns Calibrated confidence [0, 1]
 */
export function calibrateConfidence(
  rawConfidence: number,
  steepness: number = 10
): number {
  if (rawConfidence < 0 || rawConfidence > 1) {
    throw new Error(`Invalid rawConfidence: ${rawConfidence}, must be in [0, 1]`);
  }

  // Sigmoid calibration centered at 0.5
  const x = rawConfidence - 0.5;
  const calibrated = 1 / (1 + Math.exp(-steepness * x));

  return calibrated;
}

/**
 * Rank patterns by confidence with tie-breaking rules
 *
 * Primary sort: confidence (descending)
 * Tie-breakers (in order):
 * 1. successRate (descending)
 * 2. sonaWeight (descending)
 * 3. usageCount (descending)
 * 4. createdAt (ascending - older patterns preferred)
 *
 * @param patterns - Array of pattern results to rank
 * @returns Sorted array with rank field updated
 */
export function rankPatterns(patterns: PatternResult[]): PatternResult[] {
  // Sort by confidence and tie-breakers
  const sorted = [...patterns].sort((a, b) => {
    // Primary: confidence (descending)
    if (a.confidence !== b.confidence) {
      return b.confidence - a.confidence;
    }

    // Tie-breaker 1: successRate (descending)
    if (a.pattern.successRate !== b.pattern.successRate) {
      return b.pattern.successRate - a.pattern.successRate;
    }

    // Tie-breaker 2: sonaWeight (descending)
    if (a.pattern.sonaWeight !== b.pattern.sonaWeight) {
      return b.pattern.sonaWeight - a.pattern.sonaWeight;
    }

    // Tie-breaker 3: usageCount (descending)
    if (a.pattern.usageCount !== b.pattern.usageCount) {
      return b.pattern.usageCount - a.pattern.usageCount;
    }

    // Tie-breaker 4: createdAt (ascending - older is better)
    return a.pattern.createdAt.getTime() - b.pattern.createdAt.getTime();
  });

  // Update rank field (1-based)
  return sorted.map((result, index) => ({
    ...result,
    rank: index + 1
  }));
}

/**
 * Filter patterns by minimum thresholds
 *
 * @param patterns - Array of pattern results
 * @param minConfidence - Minimum confidence threshold [0, 1]
 * @param minSuccessRate - Minimum success rate threshold [0, 1]
 * @param minSonaWeight - Minimum SONA weight threshold [0, 1]
 * @returns Filtered array of patterns
 */
export function filterPatterns(
  patterns: PatternResult[],
  minConfidence?: number,
  minSuccessRate?: number,
  minSonaWeight?: number
): PatternResult[] {
  return patterns.filter(result => {
    // Check confidence threshold
    if (minConfidence !== undefined && result.confidence < minConfidence) {
      return false;
    }

    // Check success rate threshold
    if (minSuccessRate !== undefined && result.pattern.successRate < minSuccessRate) {
      return false;
    }

    // Check SONA weight threshold
    if (minSonaWeight !== undefined && result.pattern.sonaWeight < minSonaWeight) {
      return false;
    }

    return true;
  });
}

/**
 * Batch calculate confidences for multiple patterns
 *
 * Performance-optimized for batch processing.
 * Target: <1ms per pattern
 *
 * @param patterns - Array of patterns to score
 * @param similarities - Corresponding similarity scores
 * @param calibrate - Whether to apply sigmoid calibration (default: true)
 * @returns Array of confidence scores
 */
export function batchCalculateConfidence(
  patterns: Pattern[],
  similarities: number[],
  calibrate: boolean = true
): number[] {
  if (patterns.length !== similarities.length) {
    throw new Error('Patterns and similarities arrays must have same length');
  }

  const confidences: number[] = new Array(patterns.length);

  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i];
    const similarity = similarities[i];

    // Calculate raw confidence
    const raw = calculateConfidence(
      similarity,
      pattern.successRate,
      pattern.sonaWeight
    );

    // Apply calibration if requested
    confidences[i] = calibrate ? calibrateConfidence(raw) : raw;
  }

  return confidences;
}

/**
 * Create pattern result from pattern and scoring metrics
 *
 * @param pattern - The pattern object
 * @param similarity - Vector similarity score [0, 1]
 * @param rank - Result rank position (1-based)
 * @param calibrate - Whether to calibrate confidence (default: true)
 * @returns PatternResult object
 */
export function createPatternResult(
  pattern: Pattern,
  similarity: number,
  rank: number = 0,
  calibrate: boolean = true
): PatternResult {
  const raw = calculateConfidence(
    similarity,
    pattern.successRate,
    pattern.sonaWeight
  );

  const confidence = calibrate ? calibrateConfidence(raw) : raw;

  return {
    pattern,
    confidence,
    similarity,
    rank
  };
}
