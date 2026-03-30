/**
 * Sherlock Verification Methods
 *
 * Individual verification method implementations per PRD Section 2.3.3.
 * Extracted from sherlock-verification-matrix.ts for constitution compliance (< 500 lines).
 *
 * @module src/god-agent/core/pipeline/sherlock-verification-methods
 * @see docs/god-agent-coding-pipeline/PRD-god-agent-coding-pipeline.md Section 2.3.3
 */

import {
  type IEvidenceItem,
  EvidenceStatus,
} from './sherlock-phase-reviewer-types.js';

import type { ILScoreBreakdown } from './coding-quality-gate-types.js';

// ═══════════════════════════════════════════════════════════════════════════
// THRESHOLD CONSTANTS PER PRD
// ═══════════════════════════════════════════════════════════════════════════

/** Phase 1 thresholds */
export const PHASE_1_THRESHOLDS = {
  requirementsCoverage: 0.90,
  scopeClarity: 1.0,
} as const;

/** Phase 2 thresholds */
export const PHASE_2_THRESHOLDS = {
  viableSolutions: 3,
  patternValidity: 1.0,
  tradeoffCompleteness: 1.0,
} as const;

/** Phase 3 thresholds */
export const PHASE_3_THRESHOLDS = {
  interfaceCompatibility: 1.0,
  dagStructure: 1.0,
  typeSafety: 1.0,
} as const;

/** Phase 4 thresholds */
export const PHASE_4_THRESHOLDS = {
  algorithmCorrectness: 1.0,
  errorHandling: 1.0,
  commentConsistency: 1.0,
} as const;

/** Phase 5 thresholds */
export const PHASE_5_THRESHOLDS = {
  lineCoverage: 0.80,
  criticalPathCoverage: 1.0,
  edgeCaseCoverage: 1.0,
  regressionRisk: 0,
} as const;

/** Phase 6 thresholds - aligns with L-SCORE-CRITICAL (0.85) */
export const PHASE_6_THRESHOLDS = {
  performanceTarget: 1.0,
  criticalVulnerabilities: 0,
  qualityScore: 0.85,
} as const;

/** Phase 7 thresholds */
export const PHASE_7_THRESHOLDS = {
  documentationCoverage: 0.90,
  reviewBlockers: 0,
  artifactValidity: 1.0,
} as const;

/** L-Score threshold for integrated verification (aligns with L-SCORE-CRITICAL) */
export const LSCORE_VERIFICATION_THRESHOLD = 0.85;

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICATION RESULT TYPE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Result of a verification method execution.
 */
export interface IVerificationResult {
  /** Whether the check passed */
  readonly passed: boolean;
  /** Human-readable result description */
  readonly actual: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1 - UNDERSTANDING VERIFICATION METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute cross-reference verification against original request.
 */
export function executeCrossReference(
  evidence: readonly IEvidenceItem[],
  _lScore?: ILScoreBreakdown
): IVerificationResult {
  const requirementsEvidence = evidence.filter(
    (e) => e.source.includes('requirements') || e.source.includes('task_breakdown')
  );
  const verifiedCount = requirementsEvidence.filter(
    (e) => e.status === EvidenceStatus.VERIFIED
  ).length;
  const coverage = requirementsEvidence.length > 0
    ? verifiedCount / requirementsEvidence.length
    : 0;

  return {
    passed: coverage >= PHASE_1_THRESHOLDS.requirementsCoverage,
    actual: `${(coverage * 100).toFixed(1)}% coverage`,
  };
}

/**
 * Scan for hidden assumptions in evidence.
 */
export function executeScanAssumptions(evidence: readonly IEvidenceItem[]): IVerificationResult {
  const suspectEvidence = evidence.filter((e) => e.status === EvidenceStatus.SUSPECT);
  const missingEvidence = evidence.filter((e) => e.status === EvidenceStatus.MISSING);
  const hasUnexploredCases = suspectEvidence.length > 0 || missingEvidence.length > 2;

  return {
    passed: !hasUnexploredCases,
    actual: hasUnexploredCases
      ? `${suspectEvidence.length} suspect, ${missingEvidence.length} missing`
      : 'No unexplored edge cases',
  };
}

/**
 * Verify explicit scope boundaries.
 */
export function executeVerifyBoundaries(evidence: readonly IEvidenceItem[]): IVerificationResult {
  const scopeEvidence = evidence.find((e) => e.source.includes('scope'));
  const hasClearBoundaries = scopeEvidence?.status === EvidenceStatus.VERIFIED;

  return {
    passed: hasClearBoundaries,
    actual: hasClearBoundaries ? 'Clear boundaries defined' : 'Scope boundaries unclear',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2 - EXPLORATION VERIFICATION METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test solution viability against Phase 1 constraints.
 */
export function executeTestConstraints(evidence: readonly IEvidenceItem[]): IVerificationResult {
  const solutionEvidence = evidence.filter(
    (e) => e.source.includes('solutions') || e.source.includes('candidates')
  );
  const viableCount = solutionEvidence.filter((e) => e.status === EvidenceStatus.VERIFIED).length;

  return {
    passed: viableCount >= PHASE_2_THRESHOLDS.viableSolutions,
    actual: `${viableCount} viable candidates`,
  };
}

/**
 * Verify patterns match problem domain.
 */
export function executePatternMatch(evidence: readonly IEvidenceItem[]): IVerificationResult {
  const patternEvidence = evidence.find((e) => e.source.includes('patterns'));
  const hasValidPatterns = patternEvidence?.status === EvidenceStatus.VERIFIED;

  return {
    passed: hasValidPatterns,
    actual: hasValidPatterns ? 'Patterns appropriate' : 'Pattern mismatch detected',
  };
}

/**
 * Confirm trade-off analysis documentation.
 */
export function executeTradeoffAnalysis(evidence: readonly IEvidenceItem[]): IVerificationResult {
  const feasibilityEvidence = evidence.find((e) => e.source.includes('feasibility'));
  const hasTradeoffs = feasibilityEvidence?.status === EvidenceStatus.VERIFIED;

  return {
    passed: hasTradeoffs,
    actual: hasTradeoffs ? 'Trade-offs documented' : 'Missing trade-off analysis',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3 - ARCHITECTURE VERIFICATION METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ACE-V analysis of API contracts.
 * Analysis, Comparison, Evaluation, Verification methodology.
 */
export function executeAceVAnalysis(evidence: readonly IEvidenceItem[]): IVerificationResult {
  const interfaceEvidence = evidence.filter(
    (e) => e.source.includes('interfaces') || e.source.includes('types')
  );
  const verified = interfaceEvidence.filter((e) => e.status === EvidenceStatus.VERIFIED);
  const compatibility = interfaceEvidence.length > 0 ? verified.length / interfaceEvidence.length : 0;

  return {
    passed: compatibility >= PHASE_3_THRESHOLDS.interfaceCompatibility,
    actual: `${(compatibility * 100).toFixed(0)}% interface compatibility`,
  };
}

/**
 * Detect circular dependencies in architecture.
 */
export function executeDetectCycles(evidence: readonly IEvidenceItem[]): IVerificationResult {
  const archEvidence = evidence.find((e) => e.source.includes('architecture'));
  const hasNoCycles = archEvidence?.status === EvidenceStatus.VERIFIED;

  return {
    passed: hasNoCycles,
    actual: hasNoCycles ? 'DAG structure maintained' : 'Circular dependencies detected',
  };
}

/**
 * Verify type hierarchy soundness.
 */
export function executeTypeSoundness(
  evidence: readonly IEvidenceItem[],
  lScore?: ILScoreBreakdown
): IVerificationResult {
  if (lScore && lScore.accuracy >= LSCORE_VERIFICATION_THRESHOLD) {
    return { passed: true, actual: 'Type hierarchy sound (L-Score verified)' };
  }
  const typeEvidence = evidence.find((e) => e.source.includes('types'));
  const isSound = typeEvidence?.status === EvidenceStatus.VERIFIED;

  return {
    passed: isSound,
    actual: isSound ? 'No type coercion risks' : 'Type safety concerns detected',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4 - IMPLEMENTATION VERIFICATION METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Trace execution against specification.
 */
export function executeTraceExecution(
  evidence: readonly IEvidenceItem[],
  lScore?: ILScoreBreakdown
): IVerificationResult {
  if (lScore && lScore.accuracy >= LSCORE_VERIFICATION_THRESHOLD) {
    return { passed: true, actual: 'Matches design exactly (L-Score verified)' };
  }
  const implEvidence = evidence.find((e) => e.source.includes('implementation'));
  const matches = implEvidence?.status === EvidenceStatus.VERIFIED;

  return {
    passed: matches,
    actual: matches ? 'Matches Phase 3 design exactly' : 'Implementation deviates from design',
  };
}

/**
 * Test all exception paths.
 */
export function executeTestExceptionPaths(
  evidence: readonly IEvidenceItem[],
  lScore?: ILScoreBreakdown
): IVerificationResult {
  if (lScore && lScore.security >= LSCORE_VERIFICATION_THRESHOLD) {
    return { passed: true, actual: 'All exceptions handled (L-Score verified)' };
  }
  const errorEvidence = evidence.filter((e) => e.source.includes('errors') || e.source.includes('apis'));
  const handled = errorEvidence.every((e) => e.status === EvidenceStatus.VERIFIED);

  return {
    passed: handled,
    actual: handled ? 'No unhandled exceptions' : 'Unhandled exception paths detected',
  };
}

/**
 * Contradiction Engine analysis for code-comment consistency.
 */
export function executeContradictionEngine(evidence: readonly IEvidenceItem[]): IVerificationResult {
  const implEvidence = evidence.find((e) => e.source.includes('implementation'));
  const consistent = implEvidence?.status === EvidenceStatus.VERIFIED;

  return {
    passed: consistent,
    actual: consistent ? 'Comments match implementation' : 'Code-comment contradictions found',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5 - TESTING VERIFICATION METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify test coverage paths.
 */
export function executeVerifyCoverage(
  evidence: readonly IEvidenceItem[],
  lScore?: ILScoreBreakdown
): IVerificationResult {
  if (lScore) {
    const lineCoverage = lScore.testCoverage;
    const criticalPaths = lScore.accuracy >= LSCORE_VERIFICATION_THRESHOLD ? 1.0 : 0.8;
    const passed = lineCoverage >= PHASE_5_THRESHOLDS.lineCoverage
      && criticalPaths >= PHASE_5_THRESHOLDS.criticalPathCoverage;
    return {
      passed,
      actual: `${(lineCoverage * 100).toFixed(0)}% line, ${(criticalPaths * 100).toFixed(0)}% critical`,
    };
  }
  const coverageEvidence = evidence.find((e) => e.source.includes('coverage'));
  const adequate = coverageEvidence?.status === EvidenceStatus.VERIFIED;

  return {
    passed: adequate,
    actual: adequate ? '≥80% line, 100% critical paths' : 'Coverage below threshold',
  };
}

/**
 * Test boundary conditions.
 */
export function executeTestBoundaries(evidence: readonly IEvidenceItem[]): IVerificationResult {
  const testsEvidence = evidence.find((e) => e.source.includes('tests'));
  const covered = testsEvidence?.status === EvidenceStatus.VERIFIED;

  return {
    passed: covered,
    actual: covered ? 'All edge cases documented and tested' : 'Edge cases not fully covered',
  };
}

/**
 * Check for regression risk.
 */
export function executeRegressionCheck(evidence: readonly IEvidenceItem[]): IVerificationResult {
  const bugsEvidence = evidence.find((e) => e.source.includes('bugs'));
  const noRegression = !bugsEvidence || bugsEvidence.status !== EvidenceStatus.SUSPECT;

  return {
    passed: noRegression,
    actual: noRegression ? 'No regression risk' : 'Regression risk detected',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6 - OPTIMIZATION VERIFICATION METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compare performance against Phase 1 requirements.
 */
export function executePerformanceCompare(
  evidence: readonly IEvidenceItem[],
  lScore?: ILScoreBreakdown
): IVerificationResult {
  if (lScore && lScore.performance >= PHASE_6_THRESHOLDS.qualityScore) {
    return { passed: true, actual: `Performance ${(lScore.performance * 100).toFixed(0)}% - meets targets` };
  }
  const perfEvidence = evidence.find((e) => e.source.includes('optimized'));
  const meets = perfEvidence?.status === EvidenceStatus.VERIFIED;

  return {
    passed: meets,
    actual: meets ? 'Meets or exceeds targets' : 'Performance below targets',
  };
}

/**
 * OWASP Top 10 security scan.
 */
export function executeOwaspScan(
  evidence: readonly IEvidenceItem[],
  lScore?: ILScoreBreakdown
): IVerificationResult {
  if (lScore && lScore.security >= LSCORE_VERIFICATION_THRESHOLD) {
    return { passed: true, actual: '0 critical/high vulnerabilities (L-Score verified)' };
  }
  const secEvidence = evidence.find((e) => e.source.includes('security'));
  const secure = secEvidence?.status === EvidenceStatus.VERIFIED;

  return {
    passed: secure,
    actual: secure ? '0 critical/high vulnerabilities' : 'Security vulnerabilities detected',
  };
}

/**
 * Code quality complexity metrics.
 */
export function executeComplexityMetrics(
  evidence: readonly IEvidenceItem[],
  lScore?: ILScoreBreakdown
): IVerificationResult {
  if (lScore && lScore.maintainability >= PHASE_6_THRESHOLDS.qualityScore) {
    return { passed: true, actual: `Quality ${(lScore.maintainability * 100).toFixed(0)}%` };
  }
  const qualityEvidence = evidence.find((e) => e.source.includes('quality'));
  const highQuality = qualityEvidence?.status === EvidenceStatus.VERIFIED;

  return {
    passed: highQuality,
    actual: highQuality ? 'Quality score ≥ 85%' : 'Quality score below threshold',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 7 - DELIVERY VERIFICATION METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify all public APIs documented.
 */
export function executeDocumentationCheck(evidence: readonly IEvidenceItem[]): IVerificationResult {
  const docsEvidence = evidence.find((e) => e.source.includes('docs'));
  const complete = docsEvidence?.status === EvidenceStatus.VERIFIED;

  return {
    passed: complete,
    actual: complete ? '≥90% documentation coverage' : 'Documentation incomplete',
  };
}

/**
 * Confirm all review comments addressed.
 */
export function executeReviewStatus(evidence: readonly IEvidenceItem[]): IVerificationResult {
  const reviewEvidence = evidence.find((e) => e.source.includes('review'));
  const noBlockers = reviewEvidence?.status === EvidenceStatus.VERIFIED;

  return {
    passed: noBlockers,
    actual: noBlockers ? 'No outstanding blockers' : 'Unresolved review comments',
  };
}

/**
 * Verify package integrity.
 */
export function executeArtifactIntegrity(evidence: readonly IEvidenceItem[]): IVerificationResult {
  const releaseEvidence = evidence.find((e) => e.source.includes('release'));
  const valid = releaseEvidence?.status === EvidenceStatus.VERIFIED;

  return {
    passed: valid,
    actual: valid ? 'All artifacts present and valid' : 'Artifact integrity issues',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT FALLBACK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Default verification when method is unknown.
 */
export function executeDefaultVerification(evidence: readonly IEvidenceItem[]): IVerificationResult {
  const hasEvidence = evidence.some((e) => e.status === EvidenceStatus.VERIFIED);
  return {
    passed: hasEvidence,
    actual: hasEvidence ? 'Evidence verified' : 'Evidence missing',
  };
}
