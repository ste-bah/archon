/**
 * Sherlock Adversarial Analysis
 *
 * Implements adversarial persona analysis for forensic investigations.
 * Extracted from sherlock-phase-reviewer.ts for constitution compliance (< 500 lines).
 *
 * @module src/god-agent/core/pipeline/sherlock-adversarial-analysis
 * @see docs/god-agent-coding-pipeline/PRD-god-agent-coding-pipeline.md Section 2.3.3
 */

import {
  type IEvidenceItem,
  type IAdversarialFinding,
  type IPhaseInvestigationProtocol,
  AdversarialPersona,
  EvidenceStatus,
} from './sherlock-phase-reviewer-types.js';

// ═══════════════════════════════════════════════════════════════════════════
// ADVERSARIAL ANALYSIS ENGINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run adversarial persona analysis on collected evidence.
 *
 * Each persona approaches the evidence from a different perspective:
 * - THE_BUG: Looks for places to hide
 * - THE_ATTACKER: Looks for security blindspots
 * - THE_TIRED_DEVELOPER: Assesses maintainability
 * - THE_FUTURE_ARCHAEOLOGIST: Evaluates long-term context preservation
 *
 * @param protocol - Investigation protocol with personas to apply
 * @param evidence - Evidence items to analyze
 * @returns Findings from each adversarial persona
 */
export function runAdversarialAnalysis(
  protocol: IPhaseInvestigationProtocol,
  evidence: readonly IEvidenceItem[]
): IAdversarialFinding[] {
  const findings: IAdversarialFinding[] = [];
  const missingEvidence = evidence.filter((e) => e.status !== EvidenceStatus.VERIFIED);

  for (const persona of protocol.adversarialPersonas) {
    const finding = generateAdversarialFinding(persona, evidence, missingEvidence);
    findings.push(finding);
  }

  return findings;
}

/**
 * Generate finding for a specific adversarial persona.
 *
 * @param persona - Adversarial persona to apply
 * @param evidence - All evidence items
 * @param missingEvidence - Evidence items that are missing or suspect
 * @returns Finding from the persona's perspective
 */
export function generateAdversarialFinding(
  persona: AdversarialPersona,
  evidence: readonly IEvidenceItem[],
  missingEvidence: readonly IEvidenceItem[]
): IAdversarialFinding {
  const hasMissing = missingEvidence.length > 0;

  switch (persona) {
    case AdversarialPersona.THE_BUG:
      return {
        persona,
        findings: hasMissing
          ? `Missing evidence at: ${missingEvidence.map((e) => e.source).join(', ')}`
          : 'No obvious hiding spots found in evidence chain',
        severity: hasMissing ? 'warning' : 'info',
      };

    case AdversarialPersona.THE_ATTACKER:
      return {
        persona,
        findings: hasMissing
          ? 'Incomplete evidence chain - potential security blindspot'
          : 'Evidence chain appears complete for security analysis',
        severity: hasMissing ? 'critical' : 'info',
      };

    case AdversarialPersona.THE_TIRED_DEVELOPER:
      return {
        persona,
        findings: evidence.length > 5
          ? 'Complex evidence structure - may be difficult to maintain'
          : 'Evidence structure appears manageable',
        severity: evidence.length > 5 ? 'warning' : 'info',
      };

    case AdversarialPersona.THE_FUTURE_ARCHAEOLOGIST:
      return {
        persona,
        findings: hasMissing
          ? 'Context gaps will make future investigation difficult'
          : 'Sufficient context preserved for future analysis',
        severity: hasMissing ? 'warning' : 'info',
      };

    case AdversarialPersona.THE_CONFUSED_DEVELOPER:
      return {
        persona,
        findings: hasMissing
          ? 'Incomplete documentation may confuse future developers'
          : 'Evidence structure is clear and understandable',
        severity: hasMissing ? 'warning' : 'info',
      };

    case AdversarialPersona.THE_FUTURE_MAINTAINER:
      return {
        persona,
        findings: evidence.length > 7
          ? 'High evidence complexity may burden future maintainers'
          : 'Evidence chain is maintainable',
        severity: evidence.length > 7 ? 'warning' : 'info',
      };

    case AdversarialPersona.THE_PERFORMANCE_TESTER:
      return {
        persona,
        findings: 'No performance concerns identified in evidence structure',
        severity: 'info',
      };

    case AdversarialPersona.THE_NEW_HIRE:
      return {
        persona,
        findings: hasMissing
          ? 'Onboarding may be difficult due to missing context'
          : 'Sufficient context for new team members',
        severity: hasMissing ? 'warning' : 'info',
      };

    default:
      return {
        persona,
        findings: 'No specific concerns from this perspective',
        severity: 'info',
      };
  }
}
