/**
 * Sherlock Phase Investigation Protocols
 *
 * Phase-specific investigation protocols per PRD Section 2.3.3.
 * Each protocol defines evidence sources, verification matrix, and verdict criteria.
 *
 * @module src/god-agent/core/pipeline/sherlock-phase-reviewer-protocols
 * @see docs/god-agent-coding-pipeline/PRD-god-agent-coding-pipeline.md Section 2.3.3
 */

import {
  type IPhaseInvestigationProtocol,
  AdversarialPersona,
} from './sherlock-phase-reviewer-types.js';

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: UNDERSTANDING VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Phase 1 investigation protocol: Understanding Verification.
 * Verifies task analysis and requirement extraction.
 */
export const PHASE_1_UNDERSTANDING_PROTOCOL: IPhaseInvestigationProtocol = {
  phase: 1,
  subject: 'Task Understanding',
  evidenceSources: [
    'coding/context/task_breakdown',
    'coding/context/requirements',
    'coding/context/scope',
  ],
  verificationMatrix: [
    {
      check: 'Requirements completeness',
      method: 'Cross-reference against original request',
      threshold: '>= 90% coverage',
    },
    {
      check: 'Constraint identification',
      method: 'Scan for hidden assumptions',
      threshold: 'No unexplored edge cases',
    },
    {
      check: 'Scope boundaries',
      method: 'Verify explicit in/out scope',
      threshold: 'Clear boundaries defined',
    },
  ],
  adversarialPersonas: [
    AdversarialPersona.THE_CONFUSED_DEVELOPER,
    AdversarialPersona.THE_FUTURE_ARCHAEOLOGIST,
  ],
  verdictCriteria: {
    INNOCENT: 'All requirements traced, scope clear, constraints explicit',
    GUILTY: 'Missing requirements, ambiguous scope, hidden assumptions',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: EXPLORATION VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Phase 2 investigation protocol: Exploration Verification.
 * Verifies solution exploration and pattern analysis.
 */
export const PHASE_2_EXPLORATION_PROTOCOL: IPhaseInvestigationProtocol = {
  phase: 2,
  subject: 'Solution Exploration',
  evidenceSources: [
    'coding/phase2/solutions',
    'coding/phase2/patterns',
    'coding/phase2/feasibility',
  ],
  verificationMatrix: [
    {
      check: 'Solution viability',
      method: 'Test against constraints from Phase 1',
      threshold: '>= 3 viable candidates',
    },
    {
      check: 'Pattern validity',
      method: 'Verify patterns match problem domain',
      threshold: 'No misapplied patterns',
    },
    {
      check: 'Trade-off analysis',
      method: 'Confirm pros/cons documented',
      threshold: 'Each solution has trade-offs listed',
    },
  ],
  adversarialPersonas: [
    AdversarialPersona.THE_BUG,
    AdversarialPersona.THE_ATTACKER,
  ],
  verdictCriteria: {
    INNOCENT: 'Multiple viable solutions, patterns appropriate, trade-offs clear',
    GUILTY: 'Single solution forced, wrong patterns, missing analysis',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: ARCHITECTURE VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Phase 3 investigation protocol: Architecture Verification.
 * Verifies system architecture and interface design.
 */
export const PHASE_3_ARCHITECTURE_PROTOCOL: IPhaseInvestigationProtocol = {
  phase: 3,
  subject: 'System Architecture',
  evidenceSources: [
    'coding/phase3/architecture',
    'coding/phase3/interfaces',
    'coding/phase3/types',
  ],
  verificationMatrix: [
    {
      check: 'Interface consistency',
      method: 'ACE-V analysis of API contracts',
      threshold: '100% interface compatibility',
    },
    {
      check: 'Dependency graph',
      method: 'Detect circular dependencies',
      threshold: 'DAG structure maintained',
    },
    {
      check: 'Type safety',
      method: 'Verify type hierarchy soundness',
      threshold: 'No type coercion risks',
    },
  ],
  adversarialPersonas: [
    AdversarialPersona.THE_TIRED_DEVELOPER,
    AdversarialPersona.THE_FUTURE_MAINTAINER,
  ],
  verdictCriteria: {
    INNOCENT: 'Clean interfaces, no cycles, types sound',
    GUILTY: 'Interface mismatches, circular deps, type holes',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: IMPLEMENTATION VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Phase 4 investigation protocol: Implementation Verification.
 * Verifies code implementation against architecture.
 */
export const PHASE_4_IMPLEMENTATION_PROTOCOL: IPhaseInvestigationProtocol = {
  phase: 4,
  subject: 'Code Implementation',
  evidenceSources: [
    'coding/phase4/implementation',
    'coding/phase4/types',
    'coding/phase4/apis',
  ],
  verificationMatrix: [
    {
      check: 'Algorithm correctness',
      method: 'Trace execution against specification',
      threshold: 'Matches Phase 3 design exactly',
    },
    {
      check: 'Error handling',
      method: 'Test all exception paths',
      threshold: 'No unhandled exceptions',
    },
    {
      check: 'Code-comment consistency',
      method: 'Contradiction Engine analysis',
      threshold: 'Comments match implementation',
    },
  ],
  adversarialPersonas: [
    AdversarialPersona.THE_BUG,
    AdversarialPersona.THE_ATTACKER,
  ],
  verdictCriteria: {
    INNOCENT: 'Implementation matches design, errors handled, docs accurate',
    GUILTY: 'Logic errors, missing handlers, stale comments',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5: TESTING VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Phase 5 investigation protocol: Testing Verification.
 * Verifies test suite completeness and coverage.
 */
export const PHASE_5_TESTING_PROTOCOL: IPhaseInvestigationProtocol = {
  phase: 5,
  subject: 'Test Suite',
  evidenceSources: [
    'coding/phase5/tests',
    'coding/phase5/coverage',
    'coding/phase5/bugs',
  ],
  verificationMatrix: [
    {
      check: 'Coverage completeness',
      method: 'Verify all paths tested',
      threshold: '>= 80% line coverage, 100% critical paths',
    },
    {
      check: 'Edge case coverage',
      method: 'Test boundary conditions',
      threshold: 'All edge cases documented and tested',
    },
    {
      check: 'Bug verification',
      method: 'Confirm fixes don\'t break other tests',
      threshold: 'No regression risk',
    },
  ],
  adversarialPersonas: [
    AdversarialPersona.THE_BUG,
    AdversarialPersona.THE_TIRED_DEVELOPER,
  ],
  verdictCriteria: {
    INNOCENT: 'Full coverage, edge cases tested, no regressions',
    GUILTY: 'Coverage gaps, missing edge cases, fragile tests',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6: OPTIMIZATION VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Phase 6 investigation protocol: Optimization Verification.
 * Verifies production readiness and performance.
 */
export const PHASE_6_OPTIMIZATION_PROTOCOL: IPhaseInvestigationProtocol = {
  phase: 6,
  subject: 'Production Readiness',
  evidenceSources: [
    'coding/phase6/optimized',
    'coding/phase6/security',
    'coding/phase6/quality',
  ],
  verificationMatrix: [
    {
      check: 'Performance benchmarks',
      method: 'Compare against Phase 1 requirements',
      threshold: 'Meets or exceeds targets',
    },
    {
      check: 'Security audit',
      method: 'OWASP Top 10 scan',
      threshold: '0 critical/high vulnerabilities',
    },
    {
      check: 'Code quality',
      method: 'Linting, complexity metrics',
      threshold: 'Quality score >= 85%',
    },
  ],
  adversarialPersonas: [
    AdversarialPersona.THE_ATTACKER,
    AdversarialPersona.THE_PERFORMANCE_TESTER,
  ],
  verdictCriteria: {
    INNOCENT: 'Performance met, secure, quality high',
    GUILTY: 'Performance issues, vulnerabilities, code smell',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 7: DELIVERY VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Phase 7 investigation protocol: Delivery Verification.
 * Verifies release readiness and documentation.
 */
export const PHASE_7_DELIVERY_PROTOCOL: IPhaseInvestigationProtocol = {
  phase: 7,
  subject: 'Release Readiness',
  evidenceSources: [
    'coding/phase7/docs',
    'coding/phase7/review',
    'coding/phase7/release',
  ],
  verificationMatrix: [
    {
      check: 'Documentation completeness',
      method: 'Verify all public APIs documented',
      threshold: '>= 90% coverage',
    },
    {
      check: 'Code review approval',
      method: 'Confirm all review comments addressed',
      threshold: 'No outstanding blockers',
    },
    {
      check: 'Release artifacts',
      method: 'Verify package integrity',
      threshold: 'All artifacts present and valid',
    },
  ],
  adversarialPersonas: [
    AdversarialPersona.THE_FUTURE_ARCHAEOLOGIST,
    AdversarialPersona.THE_NEW_HIRE,
  ],
  verdictCriteria: {
    INNOCENT: 'Docs complete, reviews done, artifacts ready',
    GUILTY: 'Missing docs, unresolved reviews, broken artifacts',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// PROTOCOL COLLECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * All phase investigation protocols in order.
 */
export const ALL_PHASE_PROTOCOLS: readonly IPhaseInvestigationProtocol[] = [
  PHASE_1_UNDERSTANDING_PROTOCOL,
  PHASE_2_EXPLORATION_PROTOCOL,
  PHASE_3_ARCHITECTURE_PROTOCOL,
  PHASE_4_IMPLEMENTATION_PROTOCOL,
  PHASE_5_TESTING_PROTOCOL,
  PHASE_6_OPTIMIZATION_PROTOCOL,
  PHASE_7_DELIVERY_PROTOCOL,
] as const;

/**
 * Get investigation protocol for a specific phase.
 *
 * @param phase - Phase number (1-7)
 * @returns The investigation protocol or undefined
 */
export function getProtocolForPhase(phase: number): IPhaseInvestigationProtocol | undefined {
  return ALL_PHASE_PROTOCOLS.find((p) => p.phase === phase);
}

/**
 * Get all evidence sources for a phase.
 *
 * @param phase - Phase number (1-7)
 * @returns Array of memory keys for evidence sources
 */
export function getEvidenceSourcesForPhase(phase: number): readonly string[] {
  const protocol = getProtocolForPhase(phase);
  return protocol?.evidenceSources ?? [];
}

/**
 * Get adversarial personas for a phase.
 *
 * @param phase - Phase number (1-7)
 * @returns Array of adversarial personas to apply
 */
export function getAdversarialPersonasForPhase(phase: number): readonly AdversarialPersona[] {
  const protocol = getProtocolForPhase(phase);
  return protocol?.adversarialPersonas ?? [];
}

/**
 * Get protocol summary for logging/reporting.
 *
 * @returns Summary of all protocols
 */
export function getProtocolSummary(): Record<number, { subject: string; checks: number }> {
  const summary: Record<number, { subject: string; checks: number }> = {};
  for (const protocol of ALL_PHASE_PROTOCOLS) {
    summary[protocol.phase] = {
      subject: protocol.subject,
      checks: protocol.verificationMatrix.length,
    };
  }
  return summary;
}
