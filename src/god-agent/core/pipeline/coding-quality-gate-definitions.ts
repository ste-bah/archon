/**
 * Coding Quality Gate Definitions
 *
 * Defines the 7 quality gates for the God Agent Coding Pipeline.
 * Each gate enforces minimum L-Score thresholds at phase boundaries.
 *
 * Gate Progression: 0.75 → 0.80 → 0.85 → 0.90 → 0.92 → 0.88 → 0.95
 *
 * @module src/god-agent/core/pipeline/coding-quality-gate-definitions
 * @see docs/coding-pipeline/quality-gate-system.md
 */

import {
  type IQualityGate,
  PipelinePhase,
  EmergencyTrigger,
} from './coding-quality-gate-types.js';

// ═══════════════════════════════════════════════════════════════════════════
// GATE DEFINITIONS (7 Gates for 7 Phase Boundaries)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Gate 1: Understanding → Exploration
 * Minimum L-Score: 0.75
 * Critical: accuracy, completeness
 */
export const GATE_1_UNDERSTANDING: IQualityGate = {
  gateId: 'GATE-01-UNDERSTANDING',
  phaseBefore: PipelinePhase.UNDERSTANDING,
  phaseAfter: PipelinePhase.EXPLORATION,
  minLScore: 0.75,
  componentThresholds: {
    accuracy: 0.80,       // Must accurately understand requirements
    completeness: 0.75,   // Must capture most requirements
  },
  criticalComponents: ['accuracy', 'completeness'],
  allowedRemediationAttempts: 3,
  bypassConditions: [
    EmergencyTrigger.EMERG_16_USER_ABORT,
    EmergencyTrigger.EMERG_05_RESOURCE_EXHAUSTION,
  ],
};

/**
 * Gate 2: Exploration → Architecture
 * Minimum L-Score: 0.80
 * Critical: completeness, accuracy
 */
export const GATE_2_EXPLORATION: IQualityGate = {
  gateId: 'GATE-02-EXPLORATION',
  phaseBefore: PipelinePhase.EXPLORATION,
  phaseAfter: PipelinePhase.ARCHITECTURE,
  minLScore: 0.80,
  componentThresholds: {
    accuracy: 0.75,
    completeness: 0.80,
    security: 0.70,       // Security considerations explored
  },
  criticalComponents: ['completeness', 'accuracy'],
  allowedRemediationAttempts: 3,
  bypassConditions: [
    EmergencyTrigger.EMERG_16_USER_ABORT,
    EmergencyTrigger.EMERG_06_EXTERNAL_SERVICE_DOWN,
    EmergencyTrigger.EMERG_05_RESOURCE_EXHAUSTION,
  ],
};

/**
 * Gate 3: Architecture → Implementation
 * Minimum L-Score: 0.85
 * Critical: maintainability, completeness, security
 */
export const GATE_3_ARCHITECTURE: IQualityGate = {
  gateId: 'GATE-03-ARCHITECTURE',
  phaseBefore: PipelinePhase.ARCHITECTURE,
  phaseAfter: PipelinePhase.IMPLEMENTATION,
  minLScore: 0.85,
  componentThresholds: {
    accuracy: 0.80,
    completeness: 0.85,
    maintainability: 0.85, // Architecture must be maintainable
    security: 0.80,        // Security architecture critical
  },
  criticalComponents: ['maintainability', 'completeness', 'security'],
  allowedRemediationAttempts: 2,
  bypassConditions: [
    EmergencyTrigger.EMERG_16_USER_ABORT,
    EmergencyTrigger.EMERG_05_RESOURCE_EXHAUSTION,
  ],
};

/**
 * Gate 4: Implementation → Testing
 * Minimum L-Score: 0.90
 * Critical: accuracy, security, maintainability
 */
export const GATE_4_IMPLEMENTATION: IQualityGate = {
  gateId: 'GATE-04-IMPLEMENTATION',
  phaseBefore: PipelinePhase.IMPLEMENTATION,
  phaseAfter: PipelinePhase.TESTING,
  minLScore: 0.90,
  componentThresholds: {
    accuracy: 0.90,        // Code must match spec
    completeness: 0.88,    // All features implemented
    maintainability: 0.85, // Code quality standards
    security: 0.85,        // No obvious vulnerabilities
    testCoverage: 0.70,    // Unit tests in place
  },
  criticalComponents: ['accuracy', 'security', 'maintainability'],
  allowedRemediationAttempts: 3,
  bypassConditions: [
    EmergencyTrigger.EMERG_16_USER_ABORT,
    EmergencyTrigger.EMERG_13_BUILD_CATASTROPHIC_FAIL,
    EmergencyTrigger.EMERG_12_DEPENDENCY_RESOLUTION_FAIL,
  ],
};

/**
 * Gate 5: Testing → Optimization
 * Minimum L-Score: 0.92
 * Critical: testCoverage, accuracy, security
 */
export const GATE_5_TESTING: IQualityGate = {
  gateId: 'GATE-05-TESTING',
  phaseBefore: PipelinePhase.TESTING,
  phaseAfter: PipelinePhase.OPTIMIZATION,
  minLScore: 0.92,
  componentThresholds: {
    accuracy: 0.90,
    completeness: 0.90,
    security: 0.90,        // Security tests passed
    testCoverage: 0.90,    // High test coverage required
  },
  criticalComponents: ['testCoverage', 'accuracy', 'security'],
  allowedRemediationAttempts: 3,
  bypassConditions: [
    EmergencyTrigger.EMERG_16_USER_ABORT,
    EmergencyTrigger.EMERG_14_TEST_SUITE_CATASTROPHIC_FAIL,
    EmergencyTrigger.EMERG_05_RESOURCE_EXHAUSTION,
  ],
};

/**
 * Gate 6: Optimization → Delivery
 * Minimum L-Score: 0.88
 * Critical: performance, security, testCoverage
 */
export const GATE_6_OPTIMIZATION: IQualityGate = {
  gateId: 'GATE-06-OPTIMIZATION',
  phaseBefore: PipelinePhase.OPTIMIZATION,
  phaseAfter: PipelinePhase.DELIVERY,
  minLScore: 0.88,
  componentThresholds: {
    accuracy: 0.85,
    maintainability: 0.85,
    security: 0.88,
    performance: 0.90,     // Performance must be optimized
    testCoverage: 0.85,    // Tests still passing after optimization
  },
  criticalComponents: ['performance', 'security', 'testCoverage'],
  allowedRemediationAttempts: 2,
  bypassConditions: [
    EmergencyTrigger.EMERG_16_USER_ABORT,
    EmergencyTrigger.EMERG_05_RESOURCE_EXHAUSTION,
    EmergencyTrigger.EMERG_09_QUALITY_CATASTROPHIC_DROP,
  ],
};

/**
 * Gate 7: Delivery → Complete
 * Minimum L-Score: 0.95 (highest threshold)
 * Critical: accuracy, completeness, security
 */
export const GATE_7_DELIVERY: IQualityGate = {
  gateId: 'GATE-07-DELIVERY',
  phaseBefore: PipelinePhase.DELIVERY,
  phaseAfter: PipelinePhase.COMPLETE,
  minLScore: 0.95,
  componentThresholds: {
    accuracy: 0.95,        // Must match all requirements
    completeness: 0.95,    // All features delivered
    maintainability: 0.90, // High quality code
    security: 0.95,        // Highest security standards
    performance: 0.90,     // Performance validated
    testCoverage: 0.90,    // Comprehensive tests
  },
  criticalComponents: ['accuracy', 'completeness', 'security'],
  allowedRemediationAttempts: 2,
  bypassConditions: [
    EmergencyTrigger.EMERG_16_USER_ABORT,
    EmergencyTrigger.EMERG_15_DEPLOYMENT_ROLLBACK_REQUIRED,
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// GATE COLLECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * All gates in execution order.
 * Gate progression: 0.75 → 0.80 → 0.85 → 0.90 → 0.92 → 0.88 → 0.95
 */
export const ALL_GATES: readonly IQualityGate[] = [
  GATE_1_UNDERSTANDING,
  GATE_2_EXPLORATION,
  GATE_3_ARCHITECTURE,
  GATE_4_IMPLEMENTATION,
  GATE_5_TESTING,
  GATE_6_OPTIMIZATION,
  GATE_7_DELIVERY,
] as const;

/**
 * Get gate by ID.
 *
 * @param gateId - The gate identifier
 * @returns The gate definition or undefined
 */
export function getGateById(gateId: string): IQualityGate | undefined {
  return ALL_GATES.find((gate) => gate.gateId === gateId);
}

/**
 * Get gate for a specific phase transition.
 *
 * @param phaseBefore - The phase before the gate
 * @returns The gate definition or undefined
 */
export function getGateForPhase(phaseBefore: PipelinePhase | string): IQualityGate | undefined {
  const normalizedPhase = phaseBefore.toString().toLowerCase();
  return ALL_GATES.find(
    (gate) => gate.phaseBefore.toLowerCase() === normalizedPhase
  );
}

/**
 * Get summary of all gate thresholds.
 *
 * @returns Record of gate IDs to their threshold info
 */
export function getGateThresholdsSummary(): Record<
  string,
  { minLScore: number; criticalComponents: string[] }
> {
  const summary: Record<string, { minLScore: number; criticalComponents: string[] }> = {};
  for (const gate of ALL_GATES) {
    summary[gate.gateId] = {
      minLScore: gate.minLScore,
      criticalComponents: [...gate.criticalComponents],
    };
  }
  return summary;
}
