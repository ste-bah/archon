/**
 * Sherlock Phase Reviewer Types
 *
 * Type definitions for the Sherlock-Holmes forensic phase review system.
 * Implements "Guilty Until Proven Innocent" verification model per PRD Section 2.3.
 *
 * @module src/god-agent/core/pipeline/sherlock-phase-reviewer-types
 * @see docs/god-agent-coding-pipeline/PRD-god-agent-coding-pipeline.md Section 2.3
 */

import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// INVESTIGATION TIER DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Investigation tier levels per PRD 2.3.2.
 * Determines investigation depth based on agent criticality.
 */
export enum InvestigationTier {
  /** Quick verification (5 seconds) - non-critical agents */
  GLANCE = 'glance',
  /** Cold read scan (30 seconds) - standard agents */
  SCAN = 'scan',
  /** Full evidence analysis (5 minutes) - quality gate failures */
  INVESTIGATION = 'investigation',
  /** Complete forensic reconstruction (30+ minutes) - critical failures */
  DEEP_DIVE = 'deep_dive',
}

/**
 * Investigation tier configuration.
 */
export interface IInvestigationTierConfig {
  /** Tier identifier */
  readonly tier: InvestigationTier;
  /** Maximum duration in milliseconds */
  readonly maxDurationMs: number;
  /** Human-readable duration */
  readonly humanDuration: string;
  /** Triggering conditions */
  readonly triggers: readonly string[];
  /** Required verification depth */
  readonly scope: string;
}

/**
 * Tier configurations per PRD 2.3.2.
 */
export const INVESTIGATION_TIER_CONFIG: Record<InvestigationTier, IInvestigationTierConfig> = {
  [InvestigationTier.GLANCE]: {
    tier: InvestigationTier.GLANCE,
    maxDurationMs: 5000,
    humanDuration: '5 seconds',
    triggers: ['Non-critical agents'],
    scope: 'Quick verification of outputs exist',
  },
  [InvestigationTier.SCAN]: {
    tier: InvestigationTier.SCAN,
    maxDurationMs: 30000,
    humanDuration: '30 seconds',
    triggers: ['Standard agents'],
    scope: 'Cold read of evidence patterns',
  },
  [InvestigationTier.INVESTIGATION]: {
    tier: InvestigationTier.INVESTIGATION,
    maxDurationMs: 300000,
    humanDuration: '5 minutes',
    triggers: ['Quality gate failures'],
    scope: 'Full evidence chain analysis',
  },
  [InvestigationTier.DEEP_DIVE]: {
    tier: InvestigationTier.DEEP_DIVE,
    maxDurationMs: 1800000,
    humanDuration: '30+ minutes',
    triggers: ['Critical agent failures'],
    scope: 'Complete forensic reconstruction',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// VERDICT TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sherlock verdict types per PRD 2.3.6.
 */
export enum Verdict {
  /** Phase outputs verified as correct */
  INNOCENT = 'INNOCENT',
  /** Phase outputs contain violations - remediation required */
  GUILTY = 'GUILTY',
  /** Cannot determine verdict - additional evidence needed */
  INSUFFICIENT_EVIDENCE = 'INSUFFICIENT_EVIDENCE',
}

/**
 * Confidence levels for verdicts.
 */
export enum VerdictConfidence {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

// ═══════════════════════════════════════════════════════════════════════════
// EVIDENCE TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evidence source status.
 */
export enum EvidenceStatus {
  VERIFIED = 'VERIFIED',
  SUSPECT = 'SUSPECT',
  MISSING = 'MISSING',
}

/**
 * Evidence item from memory.
 */
export interface IEvidenceItem {
  /** Memory key source */
  readonly source: string;
  /** Verification status */
  readonly status: EvidenceStatus;
  /** Additional notes */
  readonly notes: string;
  /** Raw evidence data */
  readonly data?: unknown;
}

/**
 * Verification matrix check result.
 */
export interface IVerificationCheck {
  /** Check name */
  readonly check: string;
  /** Method used to verify */
  readonly method: string;
  /** Expected threshold or value */
  readonly expected: string;
  /** Actual measured value */
  readonly actual: string;
  /** Check result */
  readonly passed: boolean;
}

/**
 * Adversarial persona finding.
 */
export interface IAdversarialFinding {
  /** Persona identifier */
  readonly persona: AdversarialPersona;
  /** Findings from this persona's perspective */
  readonly findings: string;
  /** Severity if issue found */
  readonly severity?: 'critical' | 'warning' | 'info';
}

// ═══════════════════════════════════════════════════════════════════════════
// ADVERSARIAL PERSONA TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Adversarial personas per PRD 2.3.3 and sherlock-holmes.md.
 */
export enum AdversarialPersona {
  /** Thinks like a bug trying to hide */
  THE_BUG = 'THE_BUG',
  /** Thinks like a malicious actor */
  THE_ATTACKER = 'THE_ATTACKER',
  /** Thinks like an exhausted maintainer */
  THE_TIRED_DEVELOPER = 'THE_TIRED_DEVELOPER',
  /** Thinks like someone reading code in 2 years */
  THE_FUTURE_ARCHAEOLOGIST = 'THE_FUTURE_ARCHAEOLOGIST',
  /** Thinks like a confused developer */
  THE_CONFUSED_DEVELOPER = 'THE_CONFUSED_DEVELOPER',
  /** Thinks like a future maintainer */
  THE_FUTURE_MAINTAINER = 'THE_FUTURE_MAINTAINER',
  /** Thinks like a performance tester */
  THE_PERFORMANCE_TESTER = 'THE_PERFORMANCE_TESTER',
  /** Thinks like a new hire onboarding */
  THE_NEW_HIRE = 'THE_NEW_HIRE',
}

// ═══════════════════════════════════════════════════════════════════════════
// CASE FILE TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Chain of custody event.
 */
export interface IChainOfCustodyEvent {
  /** Event type */
  readonly event: string;
  /** Timestamp */
  readonly timestamp: Date;
}

/**
 * Complete case file output per PRD 2.3.4.
 */
export interface ICaseFile {
  /** Case ID: PHASE-[N]-REVIEW-[TIMESTAMP] */
  readonly caseId: string;
  /** Phase number */
  readonly phase: number;
  /** Subject of investigation */
  readonly subject: string;
  /** Investigation tier used */
  readonly tier: InvestigationTier;
  /** Final verdict */
  readonly verdict: Verdict;
  /** Verdict confidence */
  readonly confidence: VerdictConfidence;
  /** Evidence summary */
  readonly evidenceSummary: readonly IEvidenceItem[];
  /** Verification matrix results */
  readonly verificationResults: readonly IVerificationCheck[];
  /** Adversarial analysis findings */
  readonly adversarialFindings: readonly IAdversarialFinding[];
  /** Chain of custody */
  readonly chainOfCustody: readonly IChainOfCustodyEvent[];
  /** Remediation required (if GUILTY) */
  readonly remediations: readonly string[];
  /** Investigator signature */
  readonly investigator: string;
  /** Investigation timestamp */
  readonly timestamp: Date;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE REVIEW RESULT (PRD 2.3.6)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Phase review result per PRD 2.3.6.
 * This is the primary interface for verdict-based flow control.
 */
export interface IPhaseReviewResult {
  /** Phase number (1-7) */
  readonly phase: number;
  /** Final verdict */
  readonly verdict: Verdict;
  /** Confidence in verdict */
  readonly confidence: VerdictConfidence;
  /** Required remediations if GUILTY */
  readonly remediations: readonly string[];
  /** Retry count for this phase */
  readonly retryCount: number;
  /** Full case file for audit */
  readonly caseFile: ICaseFile;
}

// ═══════════════════════════════════════════════════════════════════════════
// INVESTIGATION PROTOCOL TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verification matrix entry definition.
 */
export interface IVerificationMatrixEntry {
  /** Check name */
  readonly check: string;
  /** Verification method */
  readonly method: string;
  /** Threshold or expected value */
  readonly threshold: string;
}

/**
 * Verdict criteria definition.
 */
export interface IVerdictCriteria {
  /** Criteria for INNOCENT verdict */
  readonly INNOCENT: string;
  /** Criteria for GUILTY verdict */
  readonly GUILTY: string;
}

/**
 * Phase-specific investigation protocol per PRD 2.3.3.
 */
export interface IPhaseInvestigationProtocol {
  /** Phase number (1-7) */
  readonly phase: number;
  /** Investigation subject */
  readonly subject: string;
  /** Evidence source memory keys */
  readonly evidenceSources: readonly string[];
  /** Verification matrix checks */
  readonly verificationMatrix: readonly IVerificationMatrixEntry[];
  /** Adversarial personas to use */
  readonly adversarialPersonas: readonly AdversarialPersona[];
  /** Verdict criteria */
  readonly verdictCriteria: IVerdictCriteria;
}

// ═══════════════════════════════════════════════════════════════════════════
// ZOD SCHEMAS (TS-004 Compliance)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Zod schema for phase number validation.
 */
export const PhaseNumberSchema = z.number()
  .int()
  .min(1, 'Phase must be >= 1')
  .max(7, 'Phase must be <= 7')
  .describe('Pipeline phase number (1-7)');

/**
 * Zod schema for investigation tier.
 */
export const InvestigationTierSchema = z.nativeEnum(InvestigationTier)
  .describe('Investigation depth tier');

/**
 * Zod schema for verdict.
 */
export const VerdictSchema = z.nativeEnum(Verdict)
  .describe('Investigation verdict');

/**
 * Zod schema for verdict confidence.
 */
export const VerdictConfidenceSchema = z.nativeEnum(VerdictConfidence)
  .describe('Confidence level in verdict');

/**
 * Zod schema for evidence status.
 */
export const EvidenceStatusSchema = z.nativeEnum(EvidenceStatus)
  .describe('Evidence verification status');

/**
 * Zod schema for evidence item.
 */
export const EvidenceItemSchema = z.object({
  source: z.string().min(1).describe('Memory key source'),
  status: EvidenceStatusSchema,
  notes: z.string().describe('Additional notes'),
  data: z.unknown().optional().describe('Raw evidence data'),
});

/**
 * Zod schema for verification check.
 */
export const VerificationCheckSchema = z.object({
  check: z.string().min(1).describe('Check name'),
  method: z.string().min(1).describe('Verification method'),
  expected: z.string().describe('Expected threshold'),
  actual: z.string().describe('Actual value'),
  passed: z.boolean().describe('Check result'),
});

/**
 * Zod schema for phase review input.
 */
export const PhaseReviewInputSchema = z.object({
  phase: PhaseNumberSchema,
  tier: InvestigationTierSchema.optional()
    .describe('Override investigation tier (auto-detected if not provided)'),
  retryCount: z.number().int().min(0).default(0)
    .describe('Current retry count'),
});

// ═══════════════════════════════════════════════════════════════════════════
// MEMORY NAMESPACE CONSTANTS (PRD 2.3.5)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Memory namespace patterns for forensic findings.
 */
export const FORENSIC_MEMORY_NAMESPACE = {
  /** Per-phase case files: coding/forensics/phase-[N]/case-file */
  caseFile: (phase: number): string => `coding/forensics/phase-${phase}/case-file`,
  /** Per-phase verdict: coding/forensics/phase-[N]/verdict */
  verdict: (phase: number): string => `coding/forensics/phase-${phase}/verdict`,
  /** Evidence summary: coding/forensics/phase-[N]/evidence-summary */
  evidenceSummary: (phase: number): string => `coding/forensics/phase-${phase}/evidence-summary`,
  /** Required remediation: coding/forensics/phase-[N]/remediation */
  remediation: (phase: number): string => `coding/forensics/phase-${phase}/remediation`,
  /** All verdicts summary: coding/forensics/pipeline/all-verdicts */
  allVerdicts: 'coding/forensics/pipeline/all-verdicts',
  /** Investigation log: coding/forensics/pipeline/investigation-log */
  investigationLog: 'coding/forensics/pipeline/investigation-log',
  /** Pattern library: coding/forensics/pipeline/pattern-library */
  patternLibrary: 'coding/forensics/pipeline/pattern-library',
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// ERROR TYPES (ERR-002 Compliance)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Error codes for Sherlock phase reviewer.
 */
export type SherlockErrorCode =
  | 'INVALID_PHASE'
  | 'EVIDENCE_MISSING'
  | 'INVESTIGATION_TIMEOUT'
  | 'VERIFICATION_FAILED'
  | 'PROTOCOL_NOT_FOUND';

/**
 * Custom error class for Sherlock phase reviewer.
 */
export class SherlockPhaseReviewerError extends Error {
  /**
   * Creates a new SherlockPhaseReviewerError.
   *
   * @param code - Error code
   * @param message - Human-readable message
   * @param phase - Phase number if applicable
   */
  constructor(
    public readonly code: SherlockErrorCode,
    message: string,
    public readonly phase?: number
  ) {
    super(message);
    this.name = 'SherlockPhaseReviewerError';
    Object.setPrototypeOf(this, SherlockPhaseReviewerError.prototype);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Maximum retry count before escalation to human */
export const MAX_RETRY_COUNT = 3;

/** Default investigation tier for standard phases */
export const DEFAULT_INVESTIGATION_TIER = InvestigationTier.SCAN;

/** Phase names for case file generation */
export const PHASE_NAMES: Record<number, string> = {
  1: 'Understanding',
  2: 'Exploration',
  3: 'Architecture',
  4: 'Implementation',
  5: 'Testing',
  6: 'Optimization',
  7: 'Delivery',
};
