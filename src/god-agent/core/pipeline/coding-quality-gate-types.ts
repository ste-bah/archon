/**
 * Coding Quality Gate Types
 *
 * Type definitions for the L-Score quality gate system used in the
 * God Agent Coding Pipeline (/god-code).
 *
 * @module src/god-agent/core/pipeline/coding-quality-gate-types
 * @see docs/coding-pipeline/quality-gate-system.md
 */

import type { CodingPipelinePhase } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// EMERG TRIGGER TYPES (from emerg-triggers.md)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Emergency trigger identifiers that can bypass quality gates.
 * These correspond to the 17 EMERG triggers defined in emerg-triggers.md.
 */
export enum EmergencyTrigger {
  EMERG_01_AGENT_CATASTROPHIC_FAILURE = 'emerg_01_agent_catastrophic_failure',
  EMERG_02_MEMORY_CORRUPTION = 'emerg_02_memory_corruption',
  EMERG_03_INFINITE_LOOP_RUNTIME = 'emerg_03_infinite_loop_runtime',
  EMERG_04_SECURITY_BREACH = 'emerg_04_security_breach',
  EMERG_05_RESOURCE_EXHAUSTION = 'emerg_05_resource_exhaustion',
  EMERG_06_EXTERNAL_SERVICE_DOWN = 'emerg_06_external_service_down',
  EMERG_07_PIPELINE_DEADLOCK = 'emerg_07_pipeline_deadlock',
  EMERG_08_DATA_INTEGRITY_COMPROMISE = 'emerg_08_data_integrity_compromise',
  EMERG_09_QUALITY_CATASTROPHIC_DROP = 'emerg_09_quality_catastrophic_drop',
  EMERG_10_AUTH_FAILURE = 'emerg_10_auth_failure',
  EMERG_11_CONFIG_CORRUPTION = 'emerg_11_config_corruption',
  EMERG_12_DEPENDENCY_RESOLUTION_FAIL = 'emerg_12_dependency_resolution_fail',
  EMERG_13_BUILD_CATASTROPHIC_FAIL = 'emerg_13_build_catastrophic_fail',
  EMERG_14_TEST_SUITE_CATASTROPHIC_FAIL = 'emerg_14_test_suite_catastrophic_fail',
  EMERG_15_DEPLOYMENT_ROLLBACK_REQUIRED = 'emerg_15_deployment_rollback_required',
  EMERG_16_USER_ABORT = 'emerg_16_user_abort',
  EMERG_17_SYSTEM_HEALTH_CRITICAL = 'emerg_17_system_health_critical',
}

// ═══════════════════════════════════════════════════════════════════════════
// L-SCORE TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * L-Score component weights for composite calculation.
 * Weights are phase-specific and must sum to 1.0.
 */
export interface ILScoreWeights {
  /** Code correctness and requirement alignment */
  readonly accuracy: number;
  /** Feature coverage and implementation depth */
  readonly completeness: number;
  /** Code quality, readability, and documentation */
  readonly maintainability: number;
  /** Security posture and vulnerability absence */
  readonly security: number;
  /** Efficiency and resource utilization */
  readonly performance: number;
  /** Test coverage and assertion quality */
  readonly testCoverage: number;
}

/**
 * L-Score breakdown by component.
 * All values are normalized to 0.0 - 1.0 range.
 */
export interface ILScoreBreakdown {
  /** Code correctness and requirement alignment (0.0 - 1.0) */
  readonly accuracy: number;
  /** Feature coverage and implementation depth (0.0 - 1.0) */
  readonly completeness: number;
  /** Code quality, readability, and documentation (0.0 - 1.0) */
  readonly maintainability: number;
  /** Security posture and vulnerability absence (0.0 - 1.0) */
  readonly security: number;
  /** Efficiency and resource utilization (0.0 - 1.0) */
  readonly performance: number;
  /** Test coverage and assertion quality (0.0 - 1.0) */
  readonly testCoverage: number;
  /** Weighted average (0.0 - 1.0) */
  readonly composite: number;
}

/**
 * Component keys for type safety (excludes composite which is calculated).
 */
export type LScoreComponent = keyof Omit<ILScoreBreakdown, 'composite'>;

// ═══════════════════════════════════════════════════════════════════════════
// GATE RESULT TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Gate validation result states.
 */
export enum GateResult {
  /** All checks passed - proceed to next phase */
  PASSED = 'passed',
  /** Passed with warnings - proceed but address warnings */
  CONDITIONAL_PASS = 'conditional_pass',
  /** Remediation possible within current phase */
  SOFT_REJECT = 'soft_reject',
  /** Phase restart required - remediation attempts exhausted */
  HARD_REJECT = 'hard_reject',
  /** Emergency override active - bypassing normal validation */
  EMERGENCY_BYPASS = 'emergency_bypass',
}

/**
 * Violation severity levels.
 */
export type ViolationSeverity = 'critical' | 'warning';

/**
 * Gate violation details.
 */
export interface IGateViolation {
  /** Component that violated threshold */
  readonly component: string;
  /** Required threshold value */
  readonly required: number;
  /** Actual measured value */
  readonly actual: number;
  /** Severity of the violation */
  readonly severity: ViolationSeverity;
  /** Human-readable violation message */
  readonly message: string;
}

/**
 * Emergency event for bypass checking.
 */
export interface IEmergencyEvent {
  /** Unique event ID */
  readonly id: string;
  /** Trigger that caused the emergency */
  readonly trigger: EmergencyTrigger;
  /** Event timestamp */
  readonly timestamp: Date;
  /** Additional context */
  readonly context?: Record<string, unknown>;
}

/**
 * Gate validation context.
 */
export interface IGateValidationContext {
  /** Number of remediation attempts for this gate */
  readonly remediationAttempts: number;
  /** Active emergency event (if any) */
  readonly activeEmergency?: IEmergencyEvent;
  /** Previous validation results (for trend analysis) */
  readonly previousValidations?: IGateValidationResult[];
}

/**
 * Complete gate validation result.
 */
export interface IGateValidationResult {
  /** Gate identifier */
  readonly gateId: string;
  /** Validation timestamp */
  readonly timestamp: Date;
  /** L-Score breakdown that was validated */
  readonly lScore: ILScoreBreakdown;
  /** Whether gate was passed */
  readonly passed: boolean;
  /** Detailed result state */
  readonly result: GateResult;
  /** List of violations */
  readonly violations: IGateViolation[];
  /** Warning messages */
  readonly warnings: string[];
  /** Suggested remediation actions */
  readonly remediationActions: string[];
  /** Whether emergency bypass was applied */
  readonly bypassApplied: boolean;
  /** Reason for bypass (if applied) */
  readonly bypassReason?: EmergencyTrigger;
}

// ═══════════════════════════════════════════════════════════════════════════
// QUALITY GATE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pipeline phase enum (mirrors CodingPipelinePhase but with COMPLETE).
 */
export enum PipelinePhase {
  UNDERSTANDING = 'understanding',
  EXPLORATION = 'exploration',
  ARCHITECTURE = 'architecture',
  IMPLEMENTATION = 'implementation',
  TESTING = 'testing',
  OPTIMIZATION = 'optimization',
  DELIVERY = 'delivery',
  COMPLETE = 'complete',
}

/**
 * Gate definition for each phase boundary.
 */
export interface IQualityGate {
  /** Unique gate identifier */
  readonly gateId: string;
  /** Phase before this gate */
  readonly phaseBefore: PipelinePhase;
  /** Phase after this gate */
  readonly phaseAfter: PipelinePhase;
  /** Minimum composite L-Score to pass */
  readonly minLScore: number;
  /** Individual component thresholds */
  readonly componentThresholds: Partial<Record<LScoreComponent, number>>;
  /** Components that MUST meet threshold (critical) */
  readonly criticalComponents: LScoreComponent[];
  /** Maximum remediation attempts before hard reject */
  readonly allowedRemediationAttempts: number;
  /** EMERG triggers that can bypass this gate */
  readonly bypassConditions: EmergencyTrigger[];
}

// ═══════════════════════════════════════════════════════════════════════════
// BACKWARD COMPATIBILITY TYPE ALIASES
// ═══════════════════════════════════════════════════════════════════════════

/** @deprecated Use ILScoreWeights instead */
export type LScoreWeights = ILScoreWeights;

/** @deprecated Use ILScoreBreakdown instead */
export type LScoreBreakdown = ILScoreBreakdown;

/** @deprecated Use IGateViolation instead */
export type GateViolation = IGateViolation;

/** @deprecated Use IEmergencyEvent instead */
export type EmergencyEvent = IEmergencyEvent;

/** @deprecated Use IGateValidationContext instead */
export type GateValidationContext = IGateValidationContext;

/** @deprecated Use IGateValidationResult instead */
export type GateValidationResult = IGateValidationResult;

/** @deprecated Use IQualityGate instead */
export type QualityGate = IQualityGate;
