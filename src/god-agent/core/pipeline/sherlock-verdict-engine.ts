/**
 * Sherlock Verdict Engine
 *
 * Renders final verdicts based on evidence and adversarial analysis.
 * Extracted from sherlock-phase-reviewer.ts for constitution compliance (< 500 lines).
 *
 * @module src/god-agent/core/pipeline/sherlock-verdict-engine
 * @see docs/god-agent-coding-pipeline/PRD-god-agent-coding-pipeline.md Section 2.3.6
 */

import {
  type IVerificationCheck,
  type IAdversarialFinding,
  type IPhaseInvestigationProtocol,
  Verdict,
  VerdictConfidence,
} from './sherlock-phase-reviewer-types.js';

// ═══════════════════════════════════════════════════════════════════════════
// VERDICT RESULT TYPE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Result of verdict rendering.
 */
export interface IVerdictResult {
  /** Final verdict */
  readonly verdict: Verdict;
  /** Confidence in verdict */
  readonly confidence: VerdictConfidence;
  /** Required remediations if GUILTY */
  readonly remediations: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// VERDICT ENGINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Render final verdict based on verification results and adversarial findings.
 *
 * The verdict engine implements "Guilty Until Proven Innocent" methodology:
 * - INNOCENT: All checks passed, no critical findings
 * - GUILTY: Critical issues found or majority of checks failed
 * - INSUFFICIENT_EVIDENCE: Some failures but not conclusive
 *
 * @param _protocol - Investigation protocol (reserved for future use)
 * @param verificationResults - Results from verification matrix
 * @param adversarialFindings - Findings from adversarial analysis
 * @returns Verdict result with confidence and remediations
 */
export function renderVerdict(
  _protocol: IPhaseInvestigationProtocol,
  verificationResults: readonly IVerificationCheck[],
  adversarialFindings: readonly IAdversarialFinding[]
): IVerdictResult {
  const failedChecks = verificationResults.filter((v) => !v.passed);
  const criticalFindings = adversarialFindings.filter((f) => f.severity === 'critical');
  const warningFindings = adversarialFindings.filter((f) => f.severity === 'warning');

  const remediations: string[] = [];

  // INNOCENT: All checks passed, no critical findings
  if (failedChecks.length === 0 && criticalFindings.length === 0) {
    const confidence = warningFindings.length === 0
      ? VerdictConfidence.HIGH
      : VerdictConfidence.MEDIUM;
    return { verdict: Verdict.INNOCENT, confidence, remediations };
  }

  // GUILTY: Critical issues or majority failures
  if (criticalFindings.length > 0 || failedChecks.length > verificationResults.length / 2) {
    for (const check of failedChecks) {
      remediations.push(`Fix: ${check.check} - ${check.method}`);
    }
    for (const finding of criticalFindings) {
      remediations.push(`Address: ${finding.findings}`);
    }
    return {
      verdict: Verdict.GUILTY,
      confidence: VerdictConfidence.HIGH,
      remediations,
    };
  }

  // INSUFFICIENT_EVIDENCE: Some failures but not critical
  if (failedChecks.length > 0) {
    for (const check of failedChecks) {
      remediations.push(`Investigate: ${check.check}`);
    }
    return {
      verdict: Verdict.INSUFFICIENT_EVIDENCE,
      confidence: VerdictConfidence.LOW,
      remediations,
    };
  }

  // Default: INNOCENT with HIGH confidence
  return { verdict: Verdict.INNOCENT, confidence: VerdictConfidence.HIGH, remediations };
}
