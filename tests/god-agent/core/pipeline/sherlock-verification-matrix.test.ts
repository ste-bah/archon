/**
 * Tests for Sherlock Verification Matrix Engine
 *
 * @module tests/god-agent/core/pipeline/sherlock-verification-matrix.test
 * @see src/god-agent/core/pipeline/sherlock-verification-matrix.ts
 */

import { describe, it, expect } from 'vitest';
import {
  VerificationMethod,
  VerificationContextSchema,
  executeVerificationCheck,
  runVerificationMatrix,
  calculatePassRate,
} from '../../../../src/god-agent/core/pipeline/sherlock-verification-matrix.js';

import type { IEvidenceItem, IVerificationMatrixEntry } from '../../../../src/god-agent/core/pipeline/sherlock-phase-reviewer-types.js';
import type { ILScoreBreakdown } from '../../../../src/god-agent/core/pipeline/coding-quality-gate-types.js';
import { EvidenceStatus } from '../../../../src/god-agent/core/pipeline/sherlock-phase-reviewer-types.js';

// ═══════════════════════════════════════════════════════════════════════════
// TEST FIXTURES
// ═══════════════════════════════════════════════════════════════════════════

function createVerifiedEvidence(sources: string[]): IEvidenceItem[] {
  return sources.map((source) => ({
    source,
    status: EvidenceStatus.VERIFIED,
    notes: 'Evidence verified',
    data: { test: true },
  }));
}

function createMissingEvidence(sources: string[]): IEvidenceItem[] {
  return sources.map((source) => ({
    source,
    status: EvidenceStatus.MISSING,
    notes: 'Evidence not found',
  }));
}

function createMixedEvidence(): IEvidenceItem[] {
  return [
    { source: 'coding/context/requirements', status: EvidenceStatus.VERIFIED, notes: 'OK' },
    { source: 'coding/context/scope', status: EvidenceStatus.MISSING, notes: 'Missing' },
    { source: 'coding/context/task_breakdown', status: EvidenceStatus.SUSPECT, notes: 'Suspect' },
  ];
}

function createPassingLScore(): ILScoreBreakdown {
  return {
    accuracy: 0.95,
    completeness: 0.92,
    maintainability: 0.90,
    security: 0.95,
    performance: 0.88,
    testCoverage: 0.85,
    composite: 0.91,
  };
}

function createFailingLScore(): ILScoreBreakdown {
  return {
    accuracy: 0.60,
    completeness: 0.55,
    maintainability: 0.50,
    security: 0.45,
    performance: 0.40,
    testCoverage: 0.35,
    composite: 0.48,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICATION METHOD ENUM TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('VerificationMethod enum', () => {
  it('should have all expected methods', () => {
    expect(VerificationMethod.CROSS_REFERENCE).toBe('cross_reference');
    expect(VerificationMethod.SCAN_ASSUMPTIONS).toBe('scan_assumptions');
    expect(VerificationMethod.ACE_V_ANALYSIS).toBe('ace_v_analysis');
    expect(VerificationMethod.OWASP_SCAN).toBe('owasp_scan');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ZOD SCHEMA TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('VerificationContextSchema', () => {
  it('should validate valid context', () => {
    const context = {
      phase: 3,
      evidence: [
        { source: 'test', status: EvidenceStatus.VERIFIED, notes: 'OK' },
      ],
    };

    const result = VerificationContextSchema.safeParse(context);
    expect(result.success).toBe(true);
  });

  it('should reject invalid phase', () => {
    const context = {
      phase: 99,
      evidence: [],
    };

    const result = VerificationContextSchema.safeParse(context);
    expect(result.success).toBe(false);
  });

  it('should accept optional lScore', () => {
    const context = {
      phase: 1,
      evidence: [],
      lScore: createPassingLScore(),
    };

    const result = VerificationContextSchema.safeParse(context);
    expect(result.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICATION CHECK EXECUTION TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('executeVerificationCheck', () => {
  describe('Phase 1 - Understanding verification methods', () => {
    it('should execute cross-reference verification', () => {
      const entry: IVerificationMatrixEntry = {
        check: 'Requirements completeness',
        method: 'Cross-reference against original request',
        threshold: '≥ 90% coverage',
      };

      const evidence = createVerifiedEvidence([
        'coding/context/requirements',
        'coding/context/task_breakdown',
      ]);

      const result = executeVerificationCheck(entry, evidence);

      expect(result.check).toBe('Requirements completeness');
      expect(result.passed).toBe(true);
      expect(result.actual).toContain('coverage');
    });

    it('should execute scan assumptions verification', () => {
      const entry: IVerificationMatrixEntry = {
        check: 'Constraint identification',
        method: 'Scan for hidden assumptions',
        threshold: 'No unexplored edge cases',
      };

      const evidence = createVerifiedEvidence(['coding/context/requirements']);

      const result = executeVerificationCheck(entry, evidence);

      expect(result.check).toBe('Constraint identification');
      expect(result.passed).toBe(true);
    });

    it('should fail scan assumptions with suspect evidence', () => {
      const entry: IVerificationMatrixEntry = {
        check: 'Constraint identification',
        method: 'Scan for hidden assumptions',
        threshold: 'No unexplored edge cases',
      };

      const evidence = createMixedEvidence();

      const result = executeVerificationCheck(entry, evidence);

      expect(result.passed).toBe(false);
      expect(result.actual).toContain('suspect');
    });

    it('should execute verify scope verification', () => {
      const entry: IVerificationMatrixEntry = {
        check: 'Scope boundaries',
        method: 'Verify explicit in/out scope',
        threshold: 'Clear boundaries defined',
      };

      const evidence = createVerifiedEvidence(['coding/context/scope']);

      const result = executeVerificationCheck(entry, evidence);

      expect(result.passed).toBe(true);
      expect(result.actual).toContain('boundaries');
    });
  });

  describe('Phase 2 - Exploration verification methods', () => {
    it('should execute test constraints verification', () => {
      const entry: IVerificationMatrixEntry = {
        check: 'Solution viability',
        method: 'Test against constraints from Phase 1',
        threshold: '≥ 3 viable candidates',
      };

      const evidence = createVerifiedEvidence([
        'coding/phase2/solutions/candidate-1',
        'coding/phase2/solutions/candidate-2',
        'coding/phase2/solutions/candidate-3',
      ]);

      const result = executeVerificationCheck(entry, evidence);

      expect(result.passed).toBe(true);
    });

    it('should execute pattern match verification', () => {
      const entry: IVerificationMatrixEntry = {
        check: 'Pattern validity',
        method: 'Verify patterns match problem domain',
        threshold: 'No misapplied patterns',
      };

      const evidence = createVerifiedEvidence(['coding/phase2/patterns']);

      const result = executeVerificationCheck(entry, evidence);

      expect(result.passed).toBe(true);
    });

    it('should execute trade-off analysis verification', () => {
      const entry: IVerificationMatrixEntry = {
        check: 'Trade-off analysis',
        method: 'Confirm pros/cons documented',
        threshold: 'Each solution has trade-offs listed',
      };

      const evidence = createVerifiedEvidence(['coding/phase2/feasibility']);

      const result = executeVerificationCheck(entry, evidence);

      expect(result.passed).toBe(true);
    });
  });

  describe('Phase 3 - Architecture verification methods', () => {
    it('should execute ACE-V analysis', () => {
      const entry: IVerificationMatrixEntry = {
        check: 'Interface consistency',
        method: 'ACE-V analysis of API contracts',
        threshold: '100% interface compatibility',
      };

      const evidence = createVerifiedEvidence([
        'coding/phase3/interfaces',
        'coding/phase3/types',
      ]);

      const result = executeVerificationCheck(entry, evidence);

      expect(result.passed).toBe(true);
      expect(result.actual).toContain('interface compatibility');
    });

    it('should execute cycle detection', () => {
      const entry: IVerificationMatrixEntry = {
        check: 'Dependency graph',
        method: 'Detect circular dependencies',
        threshold: 'DAG structure maintained',
      };

      const evidence = createVerifiedEvidence(['coding/phase3/architecture']);

      const result = executeVerificationCheck(entry, evidence);

      expect(result.passed).toBe(true);
      expect(result.actual).toContain('DAG');
    });

    it('should execute type soundness with L-Score', () => {
      const entry: IVerificationMatrixEntry = {
        check: 'Type safety',
        method: 'Verify type hierarchy soundness',
        threshold: 'No type coercion risks',
      };

      const evidence = createVerifiedEvidence(['coding/phase3/types']);
      const lScore = createPassingLScore();

      const result = executeVerificationCheck(entry, evidence, lScore);

      expect(result.passed).toBe(true);
      expect(result.actual).toContain('L-Score');
    });
  });

  describe('Phase 4 - Implementation verification methods', () => {
    it('should execute trace execution', () => {
      const entry: IVerificationMatrixEntry = {
        check: 'Algorithm correctness',
        method: 'Trace execution against specification',
        threshold: 'Matches Phase 3 design exactly',
      };

      const evidence = createVerifiedEvidence(['coding/phase4/implementation']);
      const lScore = createPassingLScore();

      const result = executeVerificationCheck(entry, evidence, lScore);

      expect(result.passed).toBe(true);
    });

    it('should execute exception path testing', () => {
      const entry: IVerificationMatrixEntry = {
        check: 'Error handling',
        method: 'Test all exception paths',
        threshold: 'No unhandled exceptions',
      };

      const evidence = createVerifiedEvidence(['coding/phase4/apis']);
      const lScore = createPassingLScore();

      const result = executeVerificationCheck(entry, evidence, lScore);

      expect(result.passed).toBe(true);
    });

    it('should execute contradiction engine analysis', () => {
      const entry: IVerificationMatrixEntry = {
        check: 'Code-comment consistency',
        method: 'Contradiction Engine analysis',
        threshold: 'Comments match implementation',
      };

      const evidence = createVerifiedEvidence(['coding/phase4/implementation']);

      const result = executeVerificationCheck(entry, evidence);

      expect(result.passed).toBe(true);
    });
  });

  describe('Phase 5 - Testing verification methods', () => {
    it('should execute coverage verification with L-Score', () => {
      const entry: IVerificationMatrixEntry = {
        check: 'Coverage completeness',
        method: 'Verify all paths tested',
        threshold: '≥ 80% line coverage, 100% critical paths',
      };

      const evidence = createVerifiedEvidence(['coding/phase5/coverage']);
      const lScore = createPassingLScore();

      const result = executeVerificationCheck(entry, evidence, lScore);

      expect(result.passed).toBe(true);
      expect(result.actual).toContain('%');
    });

    it('should execute boundary testing', () => {
      const entry: IVerificationMatrixEntry = {
        check: 'Edge case coverage',
        method: 'Test boundary conditions',
        threshold: 'All edge cases documented and tested',
      };

      const evidence = createVerifiedEvidence(['coding/phase5/tests']);

      const result = executeVerificationCheck(entry, evidence);

      expect(result.passed).toBe(true);
    });

    it('should execute regression check', () => {
      const entry: IVerificationMatrixEntry = {
        check: 'Bug verification',
        method: 'Confirm fixes do not cause regression',
        threshold: 'No regression risk',
      };

      const evidence = createVerifiedEvidence(['coding/phase5/tests']);

      const result = executeVerificationCheck(entry, evidence);

      expect(result.passed).toBe(true);
    });
  });

  describe('Phase 6 - Optimization verification methods', () => {
    it('should execute performance benchmark', () => {
      const entry: IVerificationMatrixEntry = {
        check: 'Performance benchmarks',
        method: 'Compare against Phase 1 requirements',
        threshold: 'Meets or exceeds targets',
      };

      const evidence = createVerifiedEvidence(['coding/phase6/optimized']);
      const lScore = createPassingLScore();

      const result = executeVerificationCheck(entry, evidence, lScore);

      expect(result.passed).toBe(true);
    });

    it('should execute OWASP scan', () => {
      const entry: IVerificationMatrixEntry = {
        check: 'Security audit',
        method: 'OWASP Top 10 scan',
        threshold: '0 critical/high vulnerabilities',
      };

      const evidence = createVerifiedEvidence(['coding/phase6/security']);
      const lScore = createPassingLScore();

      const result = executeVerificationCheck(entry, evidence, lScore);

      expect(result.passed).toBe(true);
    });

    it('should execute complexity metrics', () => {
      const entry: IVerificationMatrixEntry = {
        check: 'Code quality',
        method: 'Linting, complexity metrics',
        threshold: 'Quality score ≥ 85%',
      };

      const evidence = createVerifiedEvidence(['coding/phase6/quality']);
      const lScore = createPassingLScore();

      const result = executeVerificationCheck(entry, evidence, lScore);

      expect(result.passed).toBe(true);
    });
  });

  describe('Phase 7 - Delivery verification methods', () => {
    it('should execute documentation check', () => {
      const entry: IVerificationMatrixEntry = {
        check: 'Documentation completeness',
        method: 'Verify all public APIs documented',
        threshold: '≥ 90% coverage',
      };

      const evidence = createVerifiedEvidence(['coding/phase7/docs']);

      const result = executeVerificationCheck(entry, evidence);

      expect(result.passed).toBe(true);
    });

    it('should execute review status check', () => {
      const entry: IVerificationMatrixEntry = {
        check: 'Code review approval',
        method: 'Confirm all review comments addressed',
        threshold: 'No outstanding blockers',
      };

      const evidence = createVerifiedEvidence(['coding/phase7/review']);

      const result = executeVerificationCheck(entry, evidence);

      expect(result.passed).toBe(true);
    });

    it('should execute artifact integrity check', () => {
      const entry: IVerificationMatrixEntry = {
        check: 'Release artifacts',
        method: 'Verify package integrity',
        threshold: 'All artifacts present and valid',
      };

      const evidence = createVerifiedEvidence(['coding/phase7/release']);

      const result = executeVerificationCheck(entry, evidence);

      expect(result.passed).toBe(true);
    });
  });

  describe('Default fallback behavior', () => {
    it('should use default check for unknown method', () => {
      const entry: IVerificationMatrixEntry = {
        check: 'Unknown check',
        method: 'Some unknown method',
        threshold: 'Some threshold',
      };

      const evidence = createVerifiedEvidence(['some/evidence']);

      const result = executeVerificationCheck(entry, evidence);

      expect(result.actual).toContain('Evidence');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RUN VERIFICATION MATRIX TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('runVerificationMatrix', () => {
  it('should execute all checks in matrix', () => {
    const matrix: IVerificationMatrixEntry[] = [
      { check: 'Check 1', method: 'Cross-reference check', threshold: '90%' },
      { check: 'Check 2', method: 'Pattern match', threshold: '100%' },
      { check: 'Check 3', method: 'ACE-V analysis', threshold: '100%' },
    ];

    const evidence = createVerifiedEvidence([
      'coding/context/requirements',
      'coding/phase2/patterns',
      'coding/phase3/interfaces',
    ]);

    const results = runVerificationMatrix(matrix, evidence);

    expect(results).toHaveLength(3);
    results.forEach((result) => {
      expect(result.check).toBeDefined();
      expect(result.method).toBeDefined();
      expect(result.passed).toBeDefined();
    });
  });

  it('should integrate L-Score when provided', () => {
    const matrix: IVerificationMatrixEntry[] = [
      { check: 'Type safety', method: 'Verify type hierarchy soundness', threshold: '100%' },
    ];

    const evidence = createVerifiedEvidence(['coding/phase3/types']);
    const lScore = createPassingLScore();

    const results = runVerificationMatrix(matrix, evidence, lScore);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(true);
    expect(results[0].actual).toContain('L-Score');
  });

  it('should handle empty matrix', () => {
    const results = runVerificationMatrix([], []);
    expect(results).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CALCULATE PASS RATE TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('calculatePassRate', () => {
  it('should calculate correct pass rate', () => {
    const results = [
      { check: '1', method: 'm', expected: 'e', actual: 'a', passed: true },
      { check: '2', method: 'm', expected: 'e', actual: 'a', passed: true },
      { check: '3', method: 'm', expected: 'e', actual: 'a', passed: false },
      { check: '4', method: 'm', expected: 'e', actual: 'a', passed: true },
    ];

    const rate = calculatePassRate(results);
    expect(rate).toBeCloseTo(0.75, 2);
  });

  it('should return 0 for empty results', () => {
    const rate = calculatePassRate([]);
    expect(rate).toBe(0);
  });

  it('should return 1 for all passed', () => {
    const results = [
      { check: '1', method: 'm', expected: 'e', actual: 'a', passed: true },
      { check: '2', method: 'm', expected: 'e', actual: 'a', passed: true },
    ];

    const rate = calculatePassRate(results);
    expect(rate).toBe(1);
  });

  it('should return 0 for all failed', () => {
    const results = [
      { check: '1', method: 'm', expected: 'e', actual: 'a', passed: false },
      { check: '2', method: 'm', expected: 'e', actual: 'a', passed: false },
    ];

    const rate = calculatePassRate(results);
    expect(rate).toBe(0);
  });
});
