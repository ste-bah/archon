/**
 * Coding Quality Gate Validator
 *
 * Validates L-Scores (Learning Scores) at phase boundaries within the
 * God Agent Coding Pipeline. Each gate enforces minimum quality thresholds
 * before allowing progression to the next phase.
 *
 * @module src/god-agent/core/pipeline/coding-quality-gate-validator
 * @see docs/coding-pipeline/quality-gate-system.md
 */

import type { CodingPipelinePhase } from './types.js';

// Import types for internal use
import {
  type ILScoreBreakdown,
  type IGateValidationContext,
  type IGateValidationResult,
  type IGateViolation,
  type IQualityGate,
  type LScoreComponent,
  EmergencyTrigger,
  GateResult,
  PipelinePhase,
} from './coding-quality-gate-types.js';

import { calculateLScore } from './coding-quality-gate-weights.js';
import { ALL_GATES, getGateForPhase as getGateForPhaseFromDefs } from './coding-quality-gate-definitions.js';

// Import Zod schemas from separate file
import {
  LScoreBreakdownSchema,
  GateValidationContextSchema,
  GateIdSchema,
} from './coding-quality-gate-schemas.js';

// Re-export schemas for external use
export { LScoreBreakdownSchema, GateValidationContextSchema, GateIdSchema } from './coding-quality-gate-schemas.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Multiplier for determining catastrophic L-Score failure */
const CATASTROPHIC_SCORE_MULTIPLIER = 0.5;

/** Threshold for critical security violations */
const CRITICAL_SECURITY_THRESHOLD = 0.5;

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOM ERROR CLASS (ERR-002 compliance)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Error codes for quality gate validation errors.
 */
export type QualityGateErrorCode =
  | 'UNKNOWN_GATE'
  | 'VALIDATION_FAILED'
  | 'INVALID_INPUT'
  | 'GATE_NOT_FOUND';

/**
 * Custom error class for coding quality gate validation errors.
 * Includes error codes per constitution ERR-002.
 * Named CodingQualityGateError to avoid conflict with pipeline-errors.ts QualityGateError.
 */
export class CodingQualityGateError extends Error {
  /**
   * Creates a new CodingQualityGateError.
   *
   * @param code - The error code
   * @param message - Human-readable error message
   */
  constructor(
    public readonly code: QualityGateErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'CodingQualityGateError';
    Object.setPrototypeOf(this, CodingQualityGateError.prototype);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CODING QUALITY GATE VALIDATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Quality Gate Validation Engine for Coding Pipeline.
 *
 * Validates L-Scores at phase boundaries, handles remediation workflows,
 * and integrates with the EMERG bypass system.
 *
 * @example
 * ```typescript
 * const validator = createCodingQualityGateValidator();
 * const result = await validator.validateGate('GATE-01-UNDERSTANDING', lScore, context);
 * if (!result.passed) {
 *   console.log(validator.getFailureReport(result));
 * }
 * ```
 */
export class CodingQualityGateValidator {
  private readonly _gates: Map<string, IQualityGate> = new Map();
  private readonly _validationHistory: IGateValidationResult[] = [];

  constructor() {
    this._registerAllGates();
  }

  /**
   * Register all gates in the validator.
   * @private
   */
  private _registerAllGates(): void {
    for (const gate of ALL_GATES) {
      this._gates.set(gate.gateId, gate);
    }
  }

  /**
   * Get gate by ID.
   *
   * @param gateId - The gate identifier
   * @returns The gate definition or undefined if not found
   */
  getGate(gateId: string): IQualityGate | undefined {
    return this._gates.get(gateId);
  }

  /**
   * Get gate for a specific phase transition.
   *
   * @param phase - The pipeline phase before the gate
   * @returns The gate definition or undefined if not found
   */
  getGateForPhase(phase: PipelinePhase | CodingPipelinePhase): IQualityGate | undefined {
    return getGateForPhaseFromDefs(phase.toString());
  }

  /**
   * Validate L-Score against gate requirements.
   *
   * @param gateId - The gate identifier to validate against
   * @param lScore - The L-Score breakdown to validate
   * @param context - The validation context with remediation info
   * @returns Promise resolving to the validation result
   * @throws {CodingQualityGateError} If gate is not found or input is invalid
   */
  async validateGate(
    gateId: string,
    lScore: ILScoreBreakdown,
    context: IGateValidationContext
  ): Promise<IGateValidationResult> {
    // Validate inputs (TS-004 compliance)
    const gateIdResult = GateIdSchema.safeParse(gateId);
    if (!gateIdResult.success) {
      throw new CodingQualityGateError('INVALID_INPUT', `Invalid gate ID: ${gateIdResult.error.message}`);
    }

    const lScoreResult = LScoreBreakdownSchema.safeParse(lScore);
    if (!lScoreResult.success) {
      throw new CodingQualityGateError('INVALID_INPUT', `Invalid L-Score: ${lScoreResult.error.message}`);
    }

    const contextResult = GateValidationContextSchema.safeParse(context);
    if (!contextResult.success) {
      throw new CodingQualityGateError('INVALID_INPUT', `Invalid context: ${contextResult.error.message}`);
    }

    const gate = this._gates.get(gateId);
    if (!gate) {
      throw new CodingQualityGateError('UNKNOWN_GATE', `Unknown gate: ${gateId}`);
    }

    // Build mutable result object
    const violations: IGateViolation[] = [];
    const warnings: string[] = [];
    let remediationActions: string[] = [];
    let passed = false;
    let result: GateResult = GateResult.HARD_REJECT;
    let bypassApplied = false;
    let bypassReason: EmergencyTrigger | undefined = undefined;

    // Check for emergency bypass conditions
    if (await this._checkBypassConditions(gate, context)) {
      passed = true;
      result = GateResult.EMERGENCY_BYPASS;
      bypassApplied = true;
      bypassReason = context.activeEmergency?.trigger;
      warnings.push(`Gate bypassed due to ${context.activeEmergency?.trigger}`);

      const finalResult: IGateValidationResult = {
        gateId,
        timestamp: new Date(),
        lScore,
        passed,
        result,
        violations,
        warnings,
        remediationActions,
        bypassApplied,
        bypassReason,
      };
      return this._recordAndReturn(finalResult);
    }

    // Check composite L-Score
    if (lScore.composite < gate.minLScore) {
      violations.push({
        component: 'composite',
        required: gate.minLScore,
        actual: lScore.composite,
        severity: 'critical',
        message: `Composite L-Score ${lScore.composite.toFixed(3)} below threshold ${gate.minLScore}`,
      });
    }

    // Check individual component thresholds
    for (const [component, threshold] of Object.entries(gate.componentThresholds)) {
      const componentKey = component as LScoreComponent;
      const actual = lScore[componentKey];
      if (actual < threshold) {
        const isCritical = gate.criticalComponents.includes(componentKey);
        violations.push({
          component,
          required: threshold,
          actual,
          severity: isCritical ? 'critical' : 'warning',
          message: `${component} score ${actual.toFixed(3)} below threshold ${threshold}`,
        });
      }
    }

    // Determine result based on violations
    const criticalViolations = violations.filter((v) => v.severity === 'critical');
    const warningViolations = violations.filter((v) => v.severity === 'warning');

    if (criticalViolations.length === 0 && warningViolations.length === 0) {
      passed = true;
      result = GateResult.PASSED;
    } else if (criticalViolations.length === 0 && warningViolations.length > 0) {
      passed = true;
      result = GateResult.CONDITIONAL_PASS;
      warnings.push(...warningViolations.map((v) => v.message));
    } else if (this._isHardRejection(lScore, gate, context)) {
      result = GateResult.HARD_REJECT;
      remediationActions = ['Phase restart required - remediation attempts exhausted or catastrophic failure'];
    } else if (context.remediationAttempts < gate.allowedRemediationAttempts) {
      result = GateResult.SOFT_REJECT;
      remediationActions = this._generateRemediationActions(gate, violations);
    } else {
      result = GateResult.HARD_REJECT;
      remediationActions = ['Phase restart required - remediation attempts exhausted'];
    }

    const finalResult: IGateValidationResult = {
      gateId,
      timestamp: new Date(),
      lScore,
      passed,
      result,
      violations,
      warnings,
      remediationActions,
      bypassApplied,
      bypassReason,
    };

    return this._recordAndReturn(finalResult);
  }

  /**
   * Check if emergency bypass conditions are met.
   * @private
   */
  private async _checkBypassConditions(
    gate: IQualityGate,
    context: IGateValidationContext
  ): Promise<boolean> {
    if (!context.activeEmergency) {
      return false;
    }

    const triggerStr = context.activeEmergency.trigger as unknown as string;
    const bypassStrings = gate.bypassConditions.map((t) => t.toString());

    if (bypassStrings.includes(triggerStr)) {
      this._logBypassEvent(gate.gateId, context.activeEmergency.trigger);
      return true;
    }

    return false;
  }

  /**
   * Log a bypass event.
   * @private
   */
  private _logBypassEvent(gateId: string, trigger: unknown): void {
    const logEntry = {
      level: 'warn',
      event: 'GATE_BYPASS',
      gateId,
      trigger: String(trigger),
      timestamp: new Date().toISOString(),
    };
    if (process.env.NODE_ENV !== 'test') {
      process.stderr.write(`[GATE-BYPASS] ${JSON.stringify(logEntry)}\n`);
    }
  }

  /**
   * Determine if this is a hard rejection scenario.
   * @private
   */
  private _isHardRejection(
    lScore: ILScoreBreakdown,
    gate: IQualityGate,
    context: IGateValidationContext
  ): boolean {
    if (lScore.composite < gate.minLScore * CATASTROPHIC_SCORE_MULTIPLIER) {
      return true;
    }
    if (lScore.security < CRITICAL_SECURITY_THRESHOLD && gate.criticalComponents.includes('security')) {
      return true;
    }
    if (context.remediationAttempts >= gate.allowedRemediationAttempts) {
      return true;
    }
    return false;
  }

  /**
   * Generate remediation actions based on violations.
   * @private
   */
  private _generateRemediationActions(gate: IQualityGate, violations: IGateViolation[]): string[] {
    const actions: string[] = [];

    for (const violation of violations) {
      switch (violation.component) {
        case 'accuracy':
          actions.push('Review requirements alignment', 'Cross-check implementation against specification');
          break;
        case 'completeness':
          actions.push('Identify missing features', 'Review requirement coverage matrix');
          break;
        case 'maintainability':
          actions.push('Run code quality analysis', 'Refactor complex code sections', 'Add missing documentation');
          break;
        case 'security':
          actions.push('Run security scan', 'Review authentication/authorization', 'Check for hardcoded secrets');
          break;
        case 'performance':
          actions.push('Profile hot paths', 'Review database queries', 'Optimize memory usage');
          break;
        case 'testCoverage':
          actions.push('Add missing unit tests', 'Improve integration test coverage', 'Add edge case tests');
          break;
        case 'composite':
          actions.push('Review overall quality metrics', 'Address highest-impact component first');
          break;
      }
    }

    return [...new Set(actions)];
  }

  /**
   * Record result in history and return.
   * @private
   */
  private _recordAndReturn(result: IGateValidationResult): IGateValidationResult {
    this._validationHistory.push(result);
    return result;
  }

  /**
   * Get validation history.
   * @returns Copy of the validation history array
   */
  getValidationHistory(): IGateValidationResult[] {
    return [...this._validationHistory];
  }

  /**
   * Clear validation history.
   */
  clearHistory(): void {
    this._validationHistory.length = 0;
  }

  /**
   * Quick check if L-Score passes gate (without full validation).
   */
  quickCheck(gateId: string, lScore: ILScoreBreakdown): boolean {
    const gate = this._gates.get(gateId);
    if (!gate) return false;

    if (lScore.composite < gate.minLScore) return false;

    for (const component of gate.criticalComponents) {
      const threshold = gate.componentThresholds[component];
      if (threshold && lScore[component] < threshold) return false;
    }

    return true;
  }

  /**
   * Get detailed failure report for a validation result.
   */
  getFailureReport(result: IGateValidationResult): string {
    if (result.passed && result.result === GateResult.PASSED) {
      return `✓ All quality checks passed for ${result.gateId}`;
    }

    const lines = [
      `✗ Quality gate ${result.result} for ${result.gateId}`,
      `  Composite L-Score: ${(result.lScore.composite * 100).toFixed(1)}%`,
    ];

    if (result.violations.length > 0) {
      lines.push('  Violations:');
      for (const v of result.violations) {
        lines.push(`    - [${v.severity.toUpperCase()}] ${v.message}`);
      }
    }

    if (result.warnings.length > 0) {
      lines.push('  Warnings:');
      for (const w of result.warnings) lines.push(`    - ${w}`);
    }

    if (result.remediationActions.length > 0) {
      lines.push('  Remediation Actions:');
      for (const a of result.remediationActions) lines.push(`    → ${a}`);
    }

    return lines.join('\n');
  }

  /**
   * Create an L-Score breakdown with composite calculation.
   */
  static createLScore(
    components: Omit<ILScoreBreakdown, 'composite'>,
    phase: PipelinePhase | CodingPipelinePhase
  ): ILScoreBreakdown {
    return { ...components, composite: calculateLScore(components, phase) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a coding quality gate validator instance.
 * @returns A new CodingQualityGateValidator instance
 */
export function createCodingQualityGateValidator(): CodingQualityGateValidator {
  return new CodingQualityGateValidator();
}

/**
 * Get all gate definitions.
 * @returns Array of all quality gate definitions
 */
export function getAllGates(): readonly IQualityGate[] {
  return ALL_GATES;
}
