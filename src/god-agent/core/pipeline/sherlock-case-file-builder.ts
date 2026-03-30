/**
 * Sherlock Case File Builder
 *
 * Builds case files and generates markdown reports for forensic investigations.
 * Extracted from sherlock-phase-reviewer.ts for constitution compliance (< 500 lines).
 *
 * @module src/god-agent/core/pipeline/sherlock-case-file-builder
 * @see docs/god-agent-coding-pipeline/PRD-god-agent-coding-pipeline.md Section 2.3.4
 */

import {
  type ICaseFile,
  type IEvidenceItem,
  type IVerificationCheck,
  type IAdversarialFinding,
  type IChainOfCustodyEvent,
  type IPhaseInvestigationProtocol,
  InvestigationTier,
  Verdict,
  VerdictConfidence,
  PHASE_NAMES,
} from './sherlock-phase-reviewer-types.js';

// ═══════════════════════════════════════════════════════════════════════════
// CASE FILE BUILDER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parameters for building a case file.
 */
export interface IBuildCaseFileParams {
  /** Phase number (1-7) */
  readonly phase: number;
  /** Investigation protocol used */
  readonly protocol: IPhaseInvestigationProtocol;
  /** Investigation tier */
  readonly tier: InvestigationTier;
  /** Final verdict */
  readonly verdict: Verdict;
  /** Verdict confidence */
  readonly confidence: VerdictConfidence;
  /** Evidence collected */
  readonly evidenceSummary: readonly IEvidenceItem[];
  /** Verification results */
  readonly verificationResults: readonly IVerificationCheck[];
  /** Adversarial findings */
  readonly adversarialFindings: readonly IAdversarialFinding[];
  /** Chain of custody events */
  readonly chainOfCustody: readonly IChainOfCustodyEvent[];
  /** Required remediations */
  readonly remediations: readonly string[];
}

/**
 * Build complete case file from investigation results.
 *
 * @param params - Case file parameters
 * @returns Complete case file
 */
export function buildCaseFile(params: IBuildCaseFileParams): ICaseFile {
  const {
    phase,
    tier,
    verdict,
    confidence,
    evidenceSummary,
    verificationResults,
    adversarialFindings,
    chainOfCustody,
    remediations,
  } = params;

  const timestamp = new Date();
  const caseId = `PHASE-${phase}-REVIEW-${timestamp.toISOString().replace(/[:.]/g, '-')}`;

  return {
    caseId,
    phase,
    subject: `${PHASE_NAMES[phase]} Verification`,
    tier,
    verdict,
    confidence,
    evidenceSummary,
    verificationResults,
    adversarialFindings,
    chainOfCustody,
    remediations,
    investigator: `sherlock-holmes-phase-${phase}`,
    timestamp,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CASE FILE REPORT GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate markdown report from case file.
 *
 * @param caseFile - Case file to format
 * @returns Markdown-formatted case file report
 */
export function getCaseFileReport(caseFile: ICaseFile): string {
  const lines = [
    '## SHERLOCK HOLMES CASE FILE',
    '',
    `### Case ID: ${caseFile.caseId}`,
    `### Subject: ${caseFile.subject}`,
    `### Investigation Tier: ${caseFile.tier.toUpperCase()}`,
    '',
    `### VERDICT: ${caseFile.verdict}`,
    '',
    '### Evidence Summary',
    '| Source | Status | Notes |',
    '|--------|--------|-------|',
  ];

  for (const e of caseFile.evidenceSummary) {
    lines.push(`| ${e.source} | ${e.status} | ${e.notes} |`);
  }

  lines.push('', '### Verification Matrix Results');
  lines.push('| Check | Method | Expected | Actual | Verdict |');
  lines.push('|-------|--------|----------|--------|---------|');

  for (const v of caseFile.verificationResults) {
    lines.push(`| ${v.check} | ${v.method} | ${v.expected} | ${v.actual} | ${v.passed ? 'PASS' : 'FAIL'} |`);
  }

  lines.push('', '### Adversarial Analysis');
  for (const a of caseFile.adversarialFindings) {
    lines.push(`- **${a.persona}**: ${a.findings}`);
  }

  lines.push('', '### Chain of Custody');
  caseFile.chainOfCustody.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.event}: ${c.timestamp.toISOString()}`);
  });

  if (caseFile.remediations.length > 0) {
    lines.push('', '### Remediation Required');
    caseFile.remediations.forEach((r, i) => {
      lines.push(`${i + 1}. ${r}`);
    });
  }

  lines.push('', '### Sign-Off');
  lines.push(`- Investigator: ${caseFile.investigator}`);
  lines.push(`- Confidence: ${caseFile.confidence}`);

  return lines.join('\n');
}
