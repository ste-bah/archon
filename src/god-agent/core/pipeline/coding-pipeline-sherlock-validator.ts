/**
 * Coding Pipeline Sherlock Validator
 *
 * Extracted validation logic for Sherlock-Quality Gate integration.
 * ONLY for /god-code coding pipeline - NOT for PhD pipeline.
 *
 * @module src/god-agent/core/pipeline/coding-pipeline-sherlock-validator
 * @see docs/god-agent-coding-pipeline/PRD-god-agent-coding-pipeline.md Section 2.3
 */

import { z } from 'zod';
import type { CodingPipelinePhase } from './types.js';
import type { IPhaseExecutionResult } from './types.js';
import type {
  ILScoreBreakdown,
  IGateValidationContext,
} from './coding-quality-gate-types.js';
import type {
  IntegratedValidator,
  IIntegratedValidationResult,
} from './sherlock-quality-gate-integration.js';

// ═══════════════════════════════════════════════════════════════════════════
// ERROR CLASS (ERR-002 Compliance)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Error codes for Sherlock validation.
 */
export type SherlockValidatorErrorCode =
  | 'VALIDATION_FAILED'
  | 'PHASE_INVALID'
  | 'LSCORE_CALCULATION_FAILED';

/**
 * Custom error class for Sherlock validation errors.
 */
export class SherlockValidatorError extends Error {
  constructor(
    public readonly code: SherlockValidatorErrorCode,
    message: string,
    public readonly phase?: CodingPipelinePhase
  ) {
    super(message);
    this.name = 'SherlockValidatorError';
    Object.setPrototypeOf(this, SherlockValidatorError.prototype);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Map CodingPipelinePhase to numeric phase for Sherlock.
 */
export const PHASE_TO_NUMBER: Readonly<Record<CodingPipelinePhase, number>> = {
  understanding: 1,
  exploration: 2,
  architecture: 3,
  implementation: 4,
  testing: 5,
  optimization: 6,
  delivery: 7,
} as const;

/**
 * L-Score thresholds per phase.
 * Later phases require higher quality scores.
 */
export const PHASE_L_SCORE_THRESHOLDS: Readonly<Record<CodingPipelinePhase, number>> = {
  understanding: 0.75,
  exploration: 0.78,
  architecture: 0.82,
  implementation: 0.85,
  testing: 0.88,
  optimization: 0.92,
  delivery: 0.95,
} as const;

/**
 * L-Score component weights for calculation.
 * Weights sum to 1.0.
 */
export const L_SCORE_WEIGHTS = {
  accuracy: 0.25,
  completeness: 0.20,
  maintainability: 0.15,
  security: 0.15,
  performance: 0.10,
  testCoverage: 0.15,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION (TS-004 Zod Validation)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Configuration for Sherlock validation.
 */
export interface ISherlockValidatorConfig {
  /** Enable verbose logging */
  readonly verbose?: boolean;
  /** Default L-Score for missing components */
  readonly defaultComponentScore?: number;
}

/**
 * Zod schema for configuration validation.
 */
export const SherlockValidatorConfigSchema = z.object({
  verbose: z.boolean().optional().default(false),
  defaultComponentScore: z.number().min(0).max(1).optional().default(0.5),
});

// ═══════════════════════════════════════════════════════════════════════════
// L-SCORE CALCULATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate L-Score breakdown for a phase execution result.
 *
 * Components are weighted and combined into composite score:
 * - accuracy: 0.25 (code correctness)
 * - completeness: 0.20 (feature coverage)
 * - maintainability: 0.15 (code quality)
 * - security: 0.15 (vulnerability absence)
 * - performance: 0.10 (efficiency)
 * - testCoverage: 0.15 (test quality)
 *
 * @param phase - Current pipeline phase
 * @param phaseResult - Execution result from phase
 * @param config - Optional configuration
 * @returns L-Score breakdown with composite
 */
export function calculatePhaseLScore(
  phase: CodingPipelinePhase,
  phaseResult: IPhaseExecutionResult,
  config?: ISherlockValidatorConfig
): ILScoreBreakdown {
  const defaultScore = config?.defaultComponentScore ?? 0.5;

  // Derive metrics from phase result structure
  // IPhaseExecutionResult has: phase, success, agentResults[], totalXP, checkpointCreated, executionTimeMs
  const successfulAgents = phaseResult.agentResults?.filter(r => r.success).length ?? 0;
  const totalAgents = phaseResult.agentResults?.length ?? 1;
  const successRate = totalAgents > 0 ? successfulAgents / totalAgents : 0;

  // Calculate individual components based on phase execution data
  // Accuracy: based on overall success and agent success rate
  const accuracy = phaseResult.success
    ? Math.max(0.75, successRate * 0.9 + 0.1)
    : Math.max(defaultScore, successRate * 0.6);

  // Completeness: based on whether agents produced outputs
  const completeness = totalAgents > 0
    ? Math.max(0.6, successRate * 0.85 + 0.15)
    : defaultScore;

  // Maintainability: default score, can be enhanced with code analysis
  const maintainability = phaseResult.success ? 0.7 : defaultScore;

  // Security: conservative default, phase-aware
  const security = phase === 'testing' || phase === 'optimization'
    ? 0.75
    : 0.7;

  // Performance: based on execution time (lower is better)
  const execTimeSeconds = (phaseResult.executionTimeMs ?? 60000) / 1000;
  const performance = execTimeSeconds < 30 ? 0.9 : execTimeSeconds < 120 ? 0.7 : defaultScore;

  // Test coverage: higher for testing phase with successful results
  const testCoverage = phase === 'testing'
    ? (phaseResult.success ? 0.8 : 0.6)
    : defaultScore;

  // Calculate weighted composite
  const composite =
    accuracy * L_SCORE_WEIGHTS.accuracy +
    completeness * L_SCORE_WEIGHTS.completeness +
    maintainability * L_SCORE_WEIGHTS.maintainability +
    security * L_SCORE_WEIGHTS.security +
    performance * L_SCORE_WEIGHTS.performance +
    testCoverage * L_SCORE_WEIGHTS.testCoverage;

  return {
    accuracy,
    completeness,
    maintainability,
    security,
    performance,
    testCoverage,
    composite: Math.min(1, Math.max(0, composite)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SHERLOCK VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate phase with integrated Sherlock-Quality Gate system.
 *
 * Per PRD Section 2.3: "Each phase concludes with a mandatory forensic review
 * by the sherlock-holmes agent before proceeding to the next phase."
 *
 * @param validator - IntegratedValidator instance
 * @param phase - Current pipeline phase
 * @param phaseResult - Execution result from phase
 * @param retryCount - Number of retry attempts (escalates investigation tier)
 * @param config - Optional configuration
 * @returns Validation result or null if validator unavailable
 */
export async function validatePhaseWithSherlock(
  validator: IntegratedValidator | null,
  phase: CodingPipelinePhase,
  phaseResult: IPhaseExecutionResult,
  retryCount: number = 0,
  config?: ISherlockValidatorConfig
): Promise<IIntegratedValidationResult | null> {
  if (!validator) {
    if (config?.verbose) {
      process.stderr.write(`[SHERLOCK-VALIDATOR] No validator available for phase ${phase}\n`);
    }
    return null;
  }

  const phaseNumber = PHASE_TO_NUMBER[phase];
  if (!phaseNumber) {
    throw new SherlockValidatorError(
      'PHASE_INVALID',
      `Invalid phase: ${phase}`,
      phase
    );
  }

  // Calculate L-Score for validation
  const lScore = calculatePhaseLScore(phase, phaseResult, config);

  // Build validation context
  const context: IGateValidationContext = {
    remediationAttempts: retryCount,
  };

  if (config?.verbose) {
    process.stderr.write(
      `[SHERLOCK-VALIDATOR] Validating phase ${phase} (${phaseNumber}) ` +
      `with L-Score composite: ${lScore.composite.toFixed(3)}\n`
    );
  }

  // Run integrated validation (Quality Gate + Sherlock)
  const result = await validator.validatePhase(phaseNumber, lScore, context, retryCount);

  if (config?.verbose) {
    process.stderr.write(
      `[SHERLOCK-VALIDATOR] Phase ${phase} validation result: ` +
      `canProceed=${result.canProceed}, tier=${result.investigationTier ?? 'N/A'}\n`
    );
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// GUILTY VERDICT HANDLING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handle Sherlock GUILTY verdict by extracting remediation actions.
 *
 * @param validationResult - Result from Sherlock validation
 * @param phase - Current pipeline phase
 * @param config - Optional configuration
 * @returns Array of remediation action strings
 */
export function handleSherlockGuiltyVerdict(
  validationResult: IIntegratedValidationResult,
  phase: CodingPipelinePhase,
  config?: ISherlockValidatorConfig
): string[] {
  const remediations: string[] = [];

  // Add phase context
  remediations.push(`[Phase ${phase}] Sherlock verdict: GUILTY`);

  // Add remediations from validation result
  for (const remediation of validationResult.remediations) {
    remediations.push(remediation);
  }

  // Add investigation tier context
  if (validationResult.investigationTier) {
    remediations.push(`Investigation tier: ${validationResult.investigationTier}`);
  }

  if (config?.verbose) {
    process.stderr.write(
      `[SHERLOCK-VALIDATOR] GUILTY verdict for phase ${phase}: ` +
      `${remediations.length} remediation(s)\n`
    );
  }

  return remediations;
}

// ═══════════════════════════════════════════════════════════════════════════
// THRESHOLD CHECKING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if L-Score meets phase threshold.
 *
 * @param phase - Pipeline phase
 * @param lScore - L-Score breakdown
 * @returns Whether composite meets threshold
 */
export function meetsPhaseThreshold(
  phase: CodingPipelinePhase,
  lScore: ILScoreBreakdown
): boolean {
  const threshold = PHASE_L_SCORE_THRESHOLDS[phase];
  return lScore.composite >= threshold;
}

/**
 * Get threshold for a phase.
 *
 * @param phase - Pipeline phase
 * @returns Threshold value (0.75 - 0.95)
 */
export function getPhaseThreshold(phase: CodingPipelinePhase): number {
  return PHASE_L_SCORE_THRESHOLDS[phase];
}

/**
 * Get numeric phase number.
 *
 * @param phase - Pipeline phase
 * @returns Phase number (1-7)
 */
export function getPhaseNumber(phase: CodingPipelinePhase): number {
  return PHASE_TO_NUMBER[phase];
}
