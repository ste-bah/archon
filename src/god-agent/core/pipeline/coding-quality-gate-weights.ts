/**
 * Coding Quality Gate Weights
 *
 * Phase-specific weight calculations for L-Score composite scoring.
 * Different phases prioritize different quality components.
 *
 * @module src/god-agent/core/pipeline/coding-quality-gate-weights
 * @see docs/coding-pipeline/quality-gate-system.md
 */

import type { CodingPipelinePhase } from './types.js';
import {
  type ILScoreWeights,
  type ILScoreBreakdown,
  PipelinePhase,
} from './coding-quality-gate-types.js';

// ═══════════════════════════════════════════════════════════════════════════
// PHASE-SPECIFIC WEIGHT CALCULATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Phase weight configurations.
 * Each phase has different priorities for quality components.
 */
const PHASE_WEIGHT_CONFIG: Record<string, ILScoreWeights> = {
  understanding: {
    accuracy: 0.35,        // High - must understand requirements correctly
    completeness: 0.30,    // High - capture all requirements
    maintainability: 0.10, // Low - early phase
    security: 0.10,        // Medium - identify security requirements
    performance: 0.05,     // Low - early phase
    testCoverage: 0.10,    // Low - test strategy only
  },
  exploration: {
    accuracy: 0.25,
    completeness: 0.25,
    maintainability: 0.15,
    security: 0.15,
    performance: 0.10,
    testCoverage: 0.10,
  },
  architecture: {
    accuracy: 0.20,
    completeness: 0.25,
    maintainability: 0.25, // High - architecture affects maintainability
    security: 0.15,
    performance: 0.10,
    testCoverage: 0.05,
  },
  implementation: {
    accuracy: 0.25,
    completeness: 0.20,
    maintainability: 0.20,
    security: 0.15,
    performance: 0.10,
    testCoverage: 0.10,
  },
  testing: {
    accuracy: 0.15,
    completeness: 0.15,
    maintainability: 0.10,
    security: 0.15,
    performance: 0.10,
    testCoverage: 0.35,    // High - primary testing phase
  },
  optimization: {
    accuracy: 0.15,
    completeness: 0.10,
    maintainability: 0.15,
    security: 0.15,
    performance: 0.35,     // High - primary optimization phase
    testCoverage: 0.10,
  },
  delivery: {
    accuracy: 0.20,
    completeness: 0.20,
    maintainability: 0.15,
    security: 0.20,        // High - final security check
    performance: 0.15,
    testCoverage: 0.10,
  },
  complete: {
    accuracy: 0.17,
    completeness: 0.17,
    maintainability: 0.17,
    security: 0.17,
    performance: 0.16,
    testCoverage: 0.16,
  },
};

/**
 * Get phase-specific component weights.
 * Weights are calibrated based on what matters most in each phase.
 *
 * @param phase - The pipeline phase to get weights for
 * @returns The weight configuration for the specified phase
 */
export function getPhaseWeights(
  phase: PipelinePhase | CodingPipelinePhase | string
): ILScoreWeights {
  // Normalize phase to lowercase string for consistent lookup
  const normalizedPhase = phase.toString().toLowerCase();
  return PHASE_WEIGHT_CONFIG[normalizedPhase] || PHASE_WEIGHT_CONFIG.complete;
}

/**
 * Calculate composite L-Score based on phase-specific weights.
 *
 * @param breakdown - The individual L-Score components
 * @param phase - The pipeline phase for weight selection
 * @returns The weighted composite score (0.0 - 1.0)
 */
export function calculateLScore(
  breakdown: Omit<ILScoreBreakdown, 'composite'>,
  phase: PipelinePhase | CodingPipelinePhase
): number {
  const weights = getPhaseWeights(phase);

  const weightedSum =
    breakdown.accuracy * weights.accuracy +
    breakdown.completeness * weights.completeness +
    breakdown.maintainability * weights.maintainability +
    breakdown.security * weights.security +
    breakdown.performance * weights.performance +
    breakdown.testCoverage * weights.testCoverage;

  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

  return Math.round((weightedSum / totalWeight) * 1000) / 1000;
}

/**
 * Create an L-Score breakdown with computed composite.
 *
 * @param components - The individual component scores
 * @param phase - The pipeline phase for weight calculation
 * @returns Complete L-Score breakdown including composite
 */
export function createLScoreBreakdown(
  components: Omit<ILScoreBreakdown, 'composite'>,
  phase: PipelinePhase | CodingPipelinePhase
): ILScoreBreakdown {
  return {
    ...components,
    composite: calculateLScore(components, phase),
  };
}
