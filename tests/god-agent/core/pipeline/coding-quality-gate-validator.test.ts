/**
 * Tests for CodingQualityGateValidator
 *
 * Validates the L-Score quality gate system for the /god-code coding pipeline.
 * Tests cover:
 * - L-Score calculation with phase-specific weights
 * - Gate validation (PASSED, CONDITIONAL_PASS, SOFT_REJECT, HARD_REJECT)
 * - Emergency bypass integration (EMERG triggers)
 * - Remediation action generation
 * - Component threshold validation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CodingQualityGateValidator,
  createCodingQualityGateValidator,
  calculateLScore,
  getPhaseWeights,
  getAllGates,
  getGateThresholdsSummary,
  GateResult,
  PipelinePhase,
  EmergencyTrigger,
  type LScoreBreakdown,
  type LScoreWeights,
  type GateValidationContext,
  type GateValidationResult,
} from '../../../../src/god-agent/core/pipeline/index.js';

describe('CodingQualityGateValidator', () => {
  let validator: CodingQualityGateValidator;

  beforeEach(() => {
    validator = createCodingQualityGateValidator();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // L-SCORE CALCULATION TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('L-Score Calculation', () => {
    it('should calculate composite L-Score with phase-specific weights', () => {
      const breakdown = {
        accuracy: 0.90,
        completeness: 0.85,
        maintainability: 0.80,
        security: 0.88,
        performance: 0.75,
        testCoverage: 0.82,
      };

      const composite = calculateLScore(breakdown, PipelinePhase.UNDERSTANDING);

      // Understanding phase weights: accuracy=0.35, completeness=0.30, maintainability=0.10
      // security=0.10, performance=0.05, testCoverage=0.10
      const expected =
        0.90 * 0.35 +
        0.85 * 0.30 +
        0.80 * 0.10 +
        0.88 * 0.10 +
        0.75 * 0.05 +
        0.82 * 0.10;

      expect(composite).toBeCloseTo(expected, 3);
    });

    it('should weight testCoverage heavily in Testing phase', () => {
      const breakdown = {
        accuracy: 0.80,
        completeness: 0.80,
        maintainability: 0.80,
        security: 0.80,
        performance: 0.80,
        testCoverage: 0.95, // High test coverage
      };

      const testingComposite = calculateLScore(breakdown, PipelinePhase.TESTING);
      const understandingComposite = calculateLScore(breakdown, PipelinePhase.UNDERSTANDING);

      // Testing phase weights testCoverage at 0.35, Understanding at 0.10
      // So a high testCoverage should result in higher composite in Testing phase
      expect(testingComposite).toBeGreaterThan(understandingComposite);
    });

    it('should weight performance heavily in Optimization phase', () => {
      const breakdown = {
        accuracy: 0.80,
        completeness: 0.80,
        maintainability: 0.80,
        security: 0.80,
        performance: 0.95, // High performance
        testCoverage: 0.80,
      };

      const optimizationComposite = calculateLScore(breakdown, PipelinePhase.OPTIMIZATION);
      const implementationComposite = calculateLScore(breakdown, PipelinePhase.IMPLEMENTATION);

      // Optimization phase weights performance at 0.35, Implementation at 0.10
      expect(optimizationComposite).toBeGreaterThan(implementationComposite);
    });

    it('should handle string phase names (CodingPipelinePhase)', () => {
      const breakdown = {
        accuracy: 0.85,
        completeness: 0.85,
        maintainability: 0.85,
        security: 0.85,
        performance: 0.85,
        testCoverage: 0.85,
      };

      const enumResult = calculateLScore(breakdown, PipelinePhase.UNDERSTANDING);
      const stringResult = calculateLScore(breakdown, 'understanding');

      expect(enumResult).toEqual(stringResult);
    });

    it('should use complete phase weights for unknown phase', () => {
      const breakdown = {
        accuracy: 0.85,
        completeness: 0.85,
        maintainability: 0.85,
        security: 0.85,
        performance: 0.85,
        testCoverage: 0.85,
      };

      const unknownResult = calculateLScore(breakdown, 'unknown-phase' as PipelinePhase);
      const completeResult = calculateLScore(breakdown, PipelinePhase.COMPLETE);

      expect(unknownResult).toEqual(completeResult);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE WEIGHTS TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Phase Weights', () => {
    it('should return valid weights for all phases', () => {
      const phases = [
        PipelinePhase.UNDERSTANDING,
        PipelinePhase.EXPLORATION,
        PipelinePhase.ARCHITECTURE,
        PipelinePhase.IMPLEMENTATION,
        PipelinePhase.TESTING,
        PipelinePhase.OPTIMIZATION,
        PipelinePhase.DELIVERY,
        PipelinePhase.COMPLETE,
      ];

      for (const phase of phases) {
        const weights = getPhaseWeights(phase);
        const total =
          weights.accuracy +
          weights.completeness +
          weights.maintainability +
          weights.security +
          weights.performance +
          weights.testCoverage;

        expect(total).toBeCloseTo(1.0, 2);
      }
    });

    it('should have accuracy weighted highest in Understanding phase', () => {
      const weights = getPhaseWeights(PipelinePhase.UNDERSTANDING);
      const maxWeight = Math.max(
        weights.accuracy,
        weights.completeness,
        weights.maintainability,
        weights.security,
        weights.performance,
        weights.testCoverage
      );

      expect(weights.accuracy).toEqual(maxWeight);
    });

    it('should have testCoverage weighted highest in Testing phase', () => {
      const weights = getPhaseWeights(PipelinePhase.TESTING);
      const maxWeight = Math.max(
        weights.accuracy,
        weights.completeness,
        weights.maintainability,
        weights.security,
        weights.performance,
        weights.testCoverage
      );

      expect(weights.testCoverage).toEqual(maxWeight);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GATE VALIDATION TESTS - PASSED
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Gate Validation - PASSED', () => {
    it('should return PASSED when all thresholds are met', async () => {
      const lScore: LScoreBreakdown = {
        accuracy: 0.95,
        completeness: 0.95,
        maintainability: 0.95,
        security: 0.95,
        performance: 0.95,
        testCoverage: 0.95,
        composite: 0.95,
      };

      const context: GateValidationContext = { remediationAttempts: 0 };
      const result = await validator.validateGate('GATE-01-UNDERSTANDING', lScore, context);

      expect(result.passed).toBe(true);
      expect(result.result).toBe(GateResult.PASSED);
      expect(result.violations).toHaveLength(0);
    });

    it('should pass Gate 1 with minimum thresholds (0.75 composite, 0.80 accuracy, 0.75 completeness)', async () => {
      const lScore: LScoreBreakdown = {
        accuracy: 0.80,
        completeness: 0.75,
        maintainability: 0.70,
        security: 0.70,
        performance: 0.70,
        testCoverage: 0.70,
        composite: 0.75,
      };

      const context: GateValidationContext = { remediationAttempts: 0 };
      const result = await validator.validateGate('GATE-01-UNDERSTANDING', lScore, context);

      expect(result.passed).toBe(true);
      expect(result.result).toBe(GateResult.PASSED);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GATE VALIDATION TESTS - CONDITIONAL_PASS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Gate Validation - CONDITIONAL_PASS', () => {
    it('should return CONDITIONAL_PASS when critical thresholds met but warnings exist', async () => {
      // Gate 3 has critical components: maintainability, completeness, security
      // It also checks accuracy (non-critical)
      const lScore: LScoreBreakdown = {
        accuracy: 0.78, // Below 0.80 threshold but non-critical
        completeness: 0.86,
        maintainability: 0.86,
        security: 0.81,
        performance: 0.85,
        testCoverage: 0.85,
        composite: 0.85,
      };

      const context: GateValidationContext = { remediationAttempts: 0 };
      const result = await validator.validateGate('GATE-03-ARCHITECTURE', lScore, context);

      expect(result.passed).toBe(true);
      expect(result.result).toBe(GateResult.CONDITIONAL_PASS);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GATE VALIDATION TESTS - SOFT_REJECT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Gate Validation - SOFT_REJECT', () => {
    it('should return SOFT_REJECT when critical thresholds not met but remediation attempts remain', async () => {
      const lScore: LScoreBreakdown = {
        accuracy: 0.70, // Below 0.80 critical threshold
        completeness: 0.70, // Below 0.75 critical threshold
        maintainability: 0.60,
        security: 0.60,
        performance: 0.60,
        testCoverage: 0.60,
        composite: 0.65, // Below 0.75 threshold
      };

      const context: GateValidationContext = { remediationAttempts: 0 };
      const result = await validator.validateGate('GATE-01-UNDERSTANDING', lScore, context);

      expect(result.passed).toBe(false);
      expect(result.result).toBe(GateResult.SOFT_REJECT);
      expect(result.remediationActions.length).toBeGreaterThan(0);
    });

    it('should generate appropriate remediation actions for accuracy violations', async () => {
      const lScore: LScoreBreakdown = {
        accuracy: 0.60, // Low accuracy
        completeness: 0.90,
        maintainability: 0.90,
        security: 0.90,
        performance: 0.90,
        testCoverage: 0.90,
        composite: 0.70, // Below threshold
      };

      const context: GateValidationContext = { remediationAttempts: 0 };
      const result = await validator.validateGate('GATE-01-UNDERSTANDING', lScore, context);

      expect(result.remediationActions).toContain('Review requirements alignment');
      expect(result.remediationActions).toContain('Cross-check implementation against specification');
    });

    it('should generate security-specific remediation actions', async () => {
      const lScore: LScoreBreakdown = {
        accuracy: 0.90,
        completeness: 0.90,
        maintainability: 0.90,
        security: 0.60, // Low security
        performance: 0.90,
        testCoverage: 0.90,
        composite: 0.85,
      };

      const context: GateValidationContext = { remediationAttempts: 0 };
      const result = await validator.validateGate('GATE-04-IMPLEMENTATION', lScore, context);

      expect(result.remediationActions).toContain('Run security scan');
      expect(result.remediationActions).toContain('Review authentication/authorization');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GATE VALIDATION TESTS - HARD_REJECT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Gate Validation - HARD_REJECT', () => {
    it('should return HARD_REJECT when remediation attempts exhausted', async () => {
      const lScore: LScoreBreakdown = {
        accuracy: 0.70,
        completeness: 0.70,
        maintainability: 0.60,
        security: 0.60,
        performance: 0.60,
        testCoverage: 0.60,
        composite: 0.65,
      };

      // Gate 1 allows 3 remediation attempts
      const context: GateValidationContext = { remediationAttempts: 3 };
      const result = await validator.validateGate('GATE-01-UNDERSTANDING', lScore, context);

      expect(result.passed).toBe(false);
      expect(result.result).toBe(GateResult.HARD_REJECT);
    });

    it('should return HARD_REJECT when composite L-Score is catastrophically low (<50% of threshold)', async () => {
      const lScore: LScoreBreakdown = {
        accuracy: 0.30,
        completeness: 0.30,
        maintainability: 0.30,
        security: 0.30,
        performance: 0.30,
        testCoverage: 0.30,
        composite: 0.30, // Well below 0.75 * 0.5 = 0.375
      };

      const context: GateValidationContext = { remediationAttempts: 0 };
      const result = await validator.validateGate('GATE-01-UNDERSTANDING', lScore, context);

      expect(result.passed).toBe(false);
      expect(result.result).toBe(GateResult.HARD_REJECT);
    });

    it('should return HARD_REJECT when security is critically low for security-critical gates', async () => {
      const lScore: LScoreBreakdown = {
        accuracy: 0.90,
        completeness: 0.90,
        maintainability: 0.90,
        security: 0.40, // Critically low security
        performance: 0.90,
        testCoverage: 0.90,
        composite: 0.88,
      };

      // Gate 4 has security as a critical component
      const context: GateValidationContext = { remediationAttempts: 0 };
      const result = await validator.validateGate('GATE-04-IMPLEMENTATION', lScore, context);

      expect(result.passed).toBe(false);
      expect(result.result).toBe(GateResult.HARD_REJECT);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EMERGENCY BYPASS TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Emergency Bypass', () => {
    it('should bypass gate when USER_ABORT emergency is active', async () => {
      const lScore: LScoreBreakdown = {
        accuracy: 0.50, // Would normally fail
        completeness: 0.50,
        maintainability: 0.50,
        security: 0.50,
        performance: 0.50,
        testCoverage: 0.50,
        composite: 0.50,
      };

      const context: GateValidationContext = {
        remediationAttempts: 0,
        activeEmergency: {
          id: 'emerg-123',
          trigger: EmergencyTrigger.EMERG_16_USER_ABORT,
          timestamp: new Date(),
        },
      };

      const result = await validator.validateGate('GATE-01-UNDERSTANDING', lScore, context);

      expect(result.passed).toBe(true);
      expect(result.result).toBe(GateResult.EMERGENCY_BYPASS);
      expect(result.bypassApplied).toBe(true);
      expect(result.bypassReason).toBe(EmergencyTrigger.EMERG_16_USER_ABORT);
    });

    it('should bypass Gate 4 when BUILD_CATASTROPHIC_FAIL emergency is active', async () => {
      const lScore: LScoreBreakdown = {
        accuracy: 0.50,
        completeness: 0.50,
        maintainability: 0.50,
        security: 0.50,
        performance: 0.50,
        testCoverage: 0.50,
        composite: 0.50,
      };

      const context: GateValidationContext = {
        remediationAttempts: 0,
        activeEmergency: {
          id: 'emerg-456',
          trigger: EmergencyTrigger.EMERG_13_BUILD_CATASTROPHIC_FAIL,
          timestamp: new Date(),
        },
      };

      const result = await validator.validateGate('GATE-04-IMPLEMENTATION', lScore, context);

      expect(result.passed).toBe(true);
      expect(result.result).toBe(GateResult.EMERGENCY_BYPASS);
    });

    it('should NOT bypass gate when emergency trigger is not in bypass list', async () => {
      const lScore: LScoreBreakdown = {
        accuracy: 0.50,
        completeness: 0.50,
        maintainability: 0.50,
        security: 0.50,
        performance: 0.50,
        testCoverage: 0.50,
        composite: 0.50,
      };

      const context: GateValidationContext = {
        remediationAttempts: 0,
        activeEmergency: {
          id: 'emerg-789',
          trigger: EmergencyTrigger.EMERG_04_SECURITY_BREACH, // Not in Gate 1 bypass list
          timestamp: new Date(),
        },
      };

      const result = await validator.validateGate('GATE-01-UNDERSTANDING', lScore, context);

      expect(result.passed).toBe(false);
      expect(result.result).not.toBe(GateResult.EMERGENCY_BYPASS);
      expect(result.bypassApplied).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GATE CONFIGURATION TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Gate Configuration', () => {
    it('should have 7 gates defined', () => {
      const gates = getAllGates();
      expect(gates).toHaveLength(7);
    });

    it('should have increasing thresholds from Gate 1 (0.75) to Gate 7 (0.95)', () => {
      const summary = getGateThresholdsSummary();

      expect(summary['GATE-01-UNDERSTANDING'].minLScore).toBe(0.75);
      expect(summary['GATE-02-EXPLORATION'].minLScore).toBe(0.80);
      expect(summary['GATE-03-ARCHITECTURE'].minLScore).toBe(0.85);
      expect(summary['GATE-04-IMPLEMENTATION'].minLScore).toBe(0.90);
      expect(summary['GATE-05-TESTING'].minLScore).toBe(0.92);
      expect(summary['GATE-06-OPTIMIZATION'].minLScore).toBe(0.88);
      expect(summary['GATE-07-DELIVERY'].minLScore).toBe(0.95);
    });

    it('should throw error for unknown gate', async () => {
      const lScore: LScoreBreakdown = {
        accuracy: 0.95,
        completeness: 0.95,
        maintainability: 0.95,
        security: 0.95,
        performance: 0.95,
        testCoverage: 0.95,
        composite: 0.95,
      };

      const context: GateValidationContext = { remediationAttempts: 0 };

      await expect(validator.validateGate('UNKNOWN-GATE', lScore, context)).rejects.toThrow(
        'Unknown gate: UNKNOWN-GATE'
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // QUICK CHECK TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Quick Check', () => {
    it('should return true for passing L-Score', () => {
      const lScore: LScoreBreakdown = {
        accuracy: 0.85,
        completeness: 0.80,
        maintainability: 0.80,
        security: 0.80,
        performance: 0.80,
        testCoverage: 0.80,
        composite: 0.80,
      };

      expect(validator.quickCheck('GATE-01-UNDERSTANDING', lScore)).toBe(true);
    });

    it('should return false for failing composite', () => {
      const lScore: LScoreBreakdown = {
        accuracy: 0.85,
        completeness: 0.80,
        maintainability: 0.80,
        security: 0.80,
        performance: 0.80,
        testCoverage: 0.80,
        composite: 0.70, // Below 0.75 threshold
      };

      expect(validator.quickCheck('GATE-01-UNDERSTANDING', lScore)).toBe(false);
    });

    it('should return false for failing critical component', () => {
      const lScore: LScoreBreakdown = {
        accuracy: 0.70, // Below 0.80 critical threshold
        completeness: 0.80,
        maintainability: 0.80,
        security: 0.80,
        performance: 0.80,
        testCoverage: 0.80,
        composite: 0.80,
      };

      expect(validator.quickCheck('GATE-01-UNDERSTANDING', lScore)).toBe(false);
    });

    it('should return false for unknown gate', () => {
      const lScore: LScoreBreakdown = {
        accuracy: 0.95,
        completeness: 0.95,
        maintainability: 0.95,
        security: 0.95,
        performance: 0.95,
        testCoverage: 0.95,
        composite: 0.95,
      };

      expect(validator.quickCheck('UNKNOWN-GATE', lScore)).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FAILURE REPORT TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Failure Report', () => {
    it('should generate success message for passing result', async () => {
      const lScore: LScoreBreakdown = {
        accuracy: 0.95,
        completeness: 0.95,
        maintainability: 0.95,
        security: 0.95,
        performance: 0.95,
        testCoverage: 0.95,
        composite: 0.95,
      };

      const context: GateValidationContext = { remediationAttempts: 0 };
      const result = await validator.validateGate('GATE-01-UNDERSTANDING', lScore, context);
      const report = validator.getFailureReport(result);

      expect(report).toContain('✓');
      expect(report).toContain('passed');
    });

    it('should generate detailed failure report with violations', async () => {
      const lScore: LScoreBreakdown = {
        accuracy: 0.60,
        completeness: 0.60,
        maintainability: 0.60,
        security: 0.60,
        performance: 0.60,
        testCoverage: 0.60,
        composite: 0.60,
      };

      const context: GateValidationContext = { remediationAttempts: 0 };
      const result = await validator.validateGate('GATE-01-UNDERSTANDING', lScore, context);
      const report = validator.getFailureReport(result);

      expect(report).toContain('✗');
      expect(report).toContain('Violations');
      expect(report).toContain('CRITICAL');
      expect(report).toContain('Remediation Actions');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STATIC HELPER TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Static Helpers', () => {
    it('should create L-Score with auto-calculated composite', () => {
      const lScore = CodingQualityGateValidator.createLScore(
        {
          accuracy: 0.90,
          completeness: 0.85,
          maintainability: 0.80,
          security: 0.88,
          performance: 0.75,
          testCoverage: 0.82,
        },
        PipelinePhase.UNDERSTANDING
      );

      expect(lScore.composite).toBeDefined();
      expect(lScore.composite).toBeGreaterThan(0);
      expect(lScore.composite).toBeLessThanOrEqual(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATION HISTORY TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Validation History', () => {
    it('should record validation results in history', async () => {
      const lScore: LScoreBreakdown = {
        accuracy: 0.95,
        completeness: 0.95,
        maintainability: 0.95,
        security: 0.95,
        performance: 0.95,
        testCoverage: 0.95,
        composite: 0.95,
      };

      const context: GateValidationContext = { remediationAttempts: 0 };
      await validator.validateGate('GATE-01-UNDERSTANDING', lScore, context);
      await validator.validateGate('GATE-02-EXPLORATION', lScore, context);

      const history = validator.getValidationHistory();
      expect(history).toHaveLength(2);
    });

    it('should clear history when requested', async () => {
      const lScore: LScoreBreakdown = {
        accuracy: 0.95,
        completeness: 0.95,
        maintainability: 0.95,
        security: 0.95,
        performance: 0.95,
        testCoverage: 0.95,
        composite: 0.95,
      };

      const context: GateValidationContext = { remediationAttempts: 0 };
      await validator.validateGate('GATE-01-UNDERSTANDING', lScore, context);

      validator.clearHistory();
      const history = validator.getValidationHistory();
      expect(history).toHaveLength(0);
    });
  });
});
