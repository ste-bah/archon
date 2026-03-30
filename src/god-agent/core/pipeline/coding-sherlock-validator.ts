/**
 * Coding Pipeline Sherlock Validator
 * Extracted from coding-pipeline-orchestrator.ts for constitution.xml compliance
 *
 * Handles:
 * - Phase validation with Sherlock forensic analysis
 * - L-Score calculation with weighted components
 * - GUILTY/INNOCENT verdict processing
 * - Remediation extraction from validation results
 */

import type { CodingPipelinePhase, IPhaseExecutionResult, CodingPipelineAgent } from './types.js';
import type {
  IntegratedValidator,
  IIntegratedValidationResult,
} from './sherlock-quality-gate-integration.js';
import type {
  ILScoreBreakdown,
  IGateValidationContext,
} from './coding-quality-gate-types.js';
import { ObservabilityBus } from '../observability/bus.js';
import { PHASE_TO_NUMBER, PHASE_L_SCORE_THRESHOLDS } from './coding-pipeline-constants.js';

// =============================================================================
// L-SCORE WEIGHT CONSTANTS
// =============================================================================

/**
 * Weights for L-Score composite calculation
 * Total must equal 1.0
 */
export const L_SCORE_WEIGHTS = {
  accuracy: 0.25,
  completeness: 0.20,
  maintainability: 0.15,
  security: 0.15,
  performance: 0.10,
  testCoverage: 0.15,
} as const;

/** Bonus applied when all critical agents pass */
export const CRITICAL_AGENT_BONUS = 0.1;

/** Maximum allowed L-Score (capped at 1.0) */
export const MAX_L_SCORE = 1.0;

// =============================================================================
// PHASE VALIDATION
// =============================================================================

/**
 * Validate a phase with Sherlock forensic analysis
 * Connects to the IntegratedValidator for GUILTY/INNOCENT verdicts
 *
 * @param integratedValidator - The Sherlock validator instance
 * @param phase - Current pipeline phase
 * @param phaseResult - Results from phase execution
 * @param retryCount - Number of remediation attempts
 * @param storeMemory - Function to store forensics audit trail
 * @param log - Logging function
 * @returns Validation result or null if validator unavailable
 */
export async function validatePhaseWithSherlock(
  integratedValidator: IntegratedValidator | null,
  phase: CodingPipelinePhase,
  phaseResult: IPhaseExecutionResult,
  retryCount: number,
  storeMemory: (key: string, value: unknown) => void,
  log: (message: string) => void
): Promise<IIntegratedValidationResult | null> {
  if (!integratedValidator) {
    log('Sherlock validator not available - skipping phase validation');
    return null;
  }

  const phaseNumber = PHASE_TO_NUMBER[phase];
  const lScore = calculatePhaseLScore(phase, phaseResult);

  log(`Validating phase ${phase} (${phaseNumber}) with L-Score: ${lScore.composite.toFixed(3)}`);

  const context: IGateValidationContext = {
    remediationAttempts: retryCount,
  };

  try {
    const result = await integratedValidator.validatePhase(
      phaseNumber,
      lScore,
      context,
      retryCount
    );

    // Store forensics audit trail
    storeMemory(`forensics/phase-${phaseNumber}/validation`, {
      phase,
      phaseNumber,
      lScore,
      verdict: result.sherlockResult?.verdict ?? 'N/A',
      remediations: result.remediations,
      retryCount,
      timestamp: new Date().toISOString(),
    });

    // Emit telemetry event
    ObservabilityBus.getInstance().emit({
      component: 'pipeline',
      operation: 'sherlock_validation',
      status: result.canProceed ? 'success' : 'error',
      metadata: {
        phase,
        phaseNumber,
        lScore: lScore.composite,
        verdict: result.sherlockResult?.verdict ?? 'N/A',
        remediationCount: result.remediations?.length ?? 0,
      },
    });

    return result;
  } catch (error) {
    log(`Sherlock validation error for phase ${phase}: ${error}`);
    return null;
  }
}

// =============================================================================
// L-SCORE CALCULATION
// =============================================================================

/**
 * Calculate L-Score breakdown for a phase
 * Uses weighted components with phase-specific adjustments
 *
 * @param phase - Current pipeline phase
 * @param phaseResult - Results from phase execution
 * @returns L-Score breakdown with all components and composite
 */
export function calculatePhaseLScore(
  phase: CodingPipelinePhase,
  phaseResult: IPhaseExecutionResult
): ILScoreBreakdown {
  const { agentResults } = phaseResult;

  // Calculate base score from agent success rate
  const totalAgents = agentResults.length;
  const successfulAgents = agentResults.filter(r => r.success).length;
  const baseScore = totalAgents > 0 ? successfulAgents / totalAgents : 0;

  // Check if critical agents passed
  const criticalAgents = getCriticalAgentsForPhase(phase);
  const criticalAgentsPassed = criticalAgents.every(agent =>
    agentResults.some(r => r.agentKey === agent && r.success)
  );
  const criticalBonus = criticalAgentsPassed ? CRITICAL_AGENT_BONUS : 0;

  // Calculate base component score with critical bonus
  const clampedScore = Math.min(MAX_L_SCORE, baseScore + criticalBonus);

  // Accuracy and completeness are directly from base score
  const accuracy = clampedScore;
  const completeness = clampedScore;

  // Phase-specific adjustments for other components
  const maintainability = applyPhaseAdjustment(phase, clampedScore, 'maintainability');
  const security = applyPhaseAdjustment(phase, clampedScore, 'security');
  const performance = applyPhaseAdjustment(phase, clampedScore, 'performance');
  const testCoverage = applyPhaseAdjustment(phase, clampedScore, 'testCoverage');

  // Calculate weighted composite score
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
    composite,
  };
}

// =============================================================================
// VERDICT HANDLING
// =============================================================================

/**
 * Handle GUILTY verdict from Sherlock validation
 * Extracts remediations and stores audit trail
 *
 * @param validationResult - Result from Sherlock validation
 * @param phase - Current pipeline phase
 * @param storeMemory - Function to store forensics audit trail
 * @param log - Logging function
 * @returns Array of remediation actions to take
 */
export function handleSherlockGuiltyVerdict(
  validationResult: IIntegratedValidationResult,
  phase: CodingPipelinePhase,
  storeMemory: (key: string, value: unknown) => void,
  log: (message: string) => void
): string[] {
  const remediations = validationResult.remediations ?? [];

  log(`GUILTY verdict for phase ${phase}: ${remediations.length} remediations required`);

  // Store remediations for forensics audit
  storeMemory(`forensics/${phase}/remediations`, {
    phase,
    verdict: 'GUILTY',
    remediations,
    timestamp: new Date().toISOString(),
  });

  return [...remediations];
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get critical agents for a specific phase
 * These agents must pass for the phase to receive critical bonus
 */
function getCriticalAgentsForPhase(phase: CodingPipelinePhase): CodingPipelineAgent[] {
  const criticalAgentsMap: Record<CodingPipelinePhase, CodingPipelineAgent[]> = {
    understanding: ['task-analyzer', 'requirement-extractor'],
    exploration: ['context-gatherer', 'pattern-explorer'],
    architecture: ['system-designer', 'security-architect'],
    implementation: ['code-generator', 'api-implementer'],
    testing: ['test-generator', 'integration-tester'],
    optimization: ['performance-optimizer', 'code-quality-improver'],
    delivery: ['final-refactorer', 'sign-off-approver'],
  };

  return criticalAgentsMap[phase] ?? [];
}

/**
 * Apply phase-specific adjustments to a score component
 * Certain phases get bonuses or penalties for specific metrics
 */
function applyPhaseAdjustment(
  phase: CodingPipelinePhase,
  baseScore: number,
  component: 'maintainability' | 'security' | 'performance' | 'testCoverage'
): number {
  switch (component) {
    case 'maintainability':
      // Optimization and delivery phases get maintainability bonus
      if (phase === 'optimization' || phase === 'delivery') {
        return Math.min(MAX_L_SCORE, baseScore * 1.05);
      }
      return baseScore;

    case 'security':
      // Testing phase has full security score, others get penalty
      if (phase === 'testing') {
        return baseScore;
      }
      return baseScore * 0.95;

    case 'performance':
      // Optimization phase has full performance score, others get penalty
      if (phase === 'optimization') {
        return baseScore;
      }
      return baseScore * 0.9;

    case 'testCoverage':
      // Testing phase has full coverage, others get baseline
      if (phase === 'testing') {
        return baseScore;
      }
      return 0.8;

    default:
      return baseScore;
  }
}

/**
 * Check if L-Score meets the threshold for a phase
 *
 * @param phase - Pipeline phase to check
 * @param lScore - L-Score breakdown to evaluate
 * @returns True if composite score meets or exceeds phase threshold
 */
export function meetsPhaseThreshold(
  phase: CodingPipelinePhase,
  lScore: ILScoreBreakdown
): boolean {
  const threshold = PHASE_L_SCORE_THRESHOLDS[phase];
  return lScore.composite >= threshold;
}
