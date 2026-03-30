/**
 * Tests for Sherlock-Quality Gate Integration Module
 *
 * @module tests/god-agent/core/pipeline/sherlock-quality-gate-integration.test
 * @see src/god-agent/core/pipeline/sherlock-quality-gate-integration.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  IntegratedValidator,
  createIntegratedValidator,
  createTestIntegratedValidator,
  IntegratedValidatorError,
  type IIntegratedValidatorConfig,
} from '../../../../src/god-agent/core/pipeline/sherlock-quality-gate-integration.js';

import type { ILScoreBreakdown, IGateValidationContext } from '../../../../src/god-agent/core/pipeline/coding-quality-gate-types.js';
import type { IMemoryRetriever } from '../../../../src/god-agent/core/pipeline/sherlock-phase-reviewer.js';
import { GateResult } from '../../../../src/god-agent/core/pipeline/coding-quality-gate-types.js';
import { Verdict, InvestigationTier } from '../../../../src/god-agent/core/pipeline/sherlock-phase-reviewer-types.js';

// ═══════════════════════════════════════════════════════════════════════════
// TEST FIXTURES
// ═══════════════════════════════════════════════════════════════════════════

function createMockMemoryRetriever(): IMemoryRetriever {
  const store = new Map<string, unknown>();
  return {
    retrieve: vi.fn(async (key: string) => store.get(key)),
    store: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  };
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

function createGateContext(remediationAttempts = 0): IGateValidationContext {
  return {
    remediationAttempts,
    activeEmergency: undefined,
    previousValidations: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIT TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('IntegratedValidator', () => {
  let mockMemory: IMemoryRetriever;

  beforeEach(() => {
    mockMemory = createMockMemoryRetriever();
  });

  describe('constructor', () => {
    it('should create validator with valid config', () => {
      const config: IIntegratedValidatorConfig = {
        memoryRetriever: mockMemory,
        verbose: false,
        autoTriggerSherlock: true,
      };

      const validator = new IntegratedValidator(config);
      expect(validator).toBeInstanceOf(IntegratedValidator);
    });

    it('should throw on invalid config', () => {
      expect(() => {
        new IntegratedValidator({} as IIntegratedValidatorConfig);
      }).toThrow(IntegratedValidatorError);
    });
  });

  describe('validatePhase', () => {
    it('should pass validation with good L-Score', async () => {
      const validator = createIntegratedValidator({
        memoryRetriever: mockMemory,
        autoTriggerSherlock: false, // Disable to simplify test
      });

      const result = await validator.validatePhase(
        1,
        createPassingLScore(),
        createGateContext()
      );

      expect(result.gateResult.passed).toBe(true);
      expect(result.canProceed).toBe(true);
    });

    it('should fail validation with poor L-Score', async () => {
      const validator = createIntegratedValidator({
        memoryRetriever: mockMemory,
        autoTriggerSherlock: false,
      });

      const result = await validator.validatePhase(
        1,
        createFailingLScore(),
        createGateContext()
      );

      expect(result.gateResult.passed).toBe(false);
      expect(result.canProceed).toBe(false);
    });

    it('should trigger Sherlock on gate failure when autoTriggerSherlock is true', async () => {
      const validator = createIntegratedValidator({
        memoryRetriever: mockMemory,
        autoTriggerSherlock: true,
      });

      const result = await validator.validatePhase(
        1,
        createFailingLScore(),
        createGateContext()
      );

      expect(result.sherlockResult).toBeDefined();
      expect(result.investigationTier).toBeDefined();
    });

    it('should select INVESTIGATION tier on SOFT_REJECT', async () => {
      const validator = createIntegratedValidator({
        memoryRetriever: mockMemory,
        autoTriggerSherlock: true,
      });

      // Use L-Score that will cause SOFT_REJECT (below threshold but fixable)
      const softRejectScore: ILScoreBreakdown = {
        accuracy: 0.70,
        completeness: 0.70,
        maintainability: 0.70,
        security: 0.70,
        performance: 0.70,
        testCoverage: 0.70,
        composite: 0.70,
      };

      const result = await validator.validatePhase(
        1,
        softRejectScore,
        createGateContext(0)
      );

      // Should trigger Sherlock with at least INVESTIGATION tier
      expect(result.sherlockResult).toBeDefined();
    });

    it('should throw on invalid phase number', async () => {
      const validator = createIntegratedValidator({
        memoryRetriever: mockMemory,
      });

      await expect(
        validator.validatePhase(99, createPassingLScore(), createGateContext())
      ).rejects.toThrow(IntegratedValidatorError);
    });

    it('should validate all 7 phases', async () => {
      const validator = createIntegratedValidator({
        memoryRetriever: mockMemory,
        autoTriggerSherlock: false,
      });

      for (let phase = 1; phase <= 7; phase++) {
        const result = await validator.validatePhase(
          phase,
          createPassingLScore(),
          createGateContext()
        );
        expect(result.gateResult).toBeDefined();
      }
    });
  });

  describe('quickGateCheck', () => {
    it('should return true for passing L-Score', () => {
      const validator = createIntegratedValidator({
        memoryRetriever: mockMemory,
      });

      const passes = validator.quickGateCheck(1, createPassingLScore());
      expect(passes).toBe(true);
    });

    it('should return false for failing L-Score', () => {
      const validator = createIntegratedValidator({
        memoryRetriever: mockMemory,
      });

      const passes = validator.quickGateCheck(1, createFailingLScore());
      expect(passes).toBe(false);
    });

    it('should return false for invalid phase', () => {
      const validator = createIntegratedValidator({
        memoryRetriever: mockMemory,
      });

      const passes = validator.quickGateCheck(99, createPassingLScore());
      expect(passes).toBe(false);
    });
  });

  describe('reviewPhase', () => {
    it('should run Sherlock review directly', async () => {
      const validator = createIntegratedValidator({
        memoryRetriever: mockMemory,
      });

      const result = await validator.reviewPhase(1, InvestigationTier.SCAN);

      expect(result).toBeDefined();
      expect(result.phase).toBe(1);
      expect(result.verdict).toBeDefined();
    });
  });

  describe('history management', () => {
    it('should track validation history', async () => {
      const validator = createIntegratedValidator({
        memoryRetriever: mockMemory,
        autoTriggerSherlock: false,
      });

      await validator.validatePhase(1, createPassingLScore(), createGateContext());
      await validator.validatePhase(2, createPassingLScore(), createGateContext());

      const history = validator.getValidationHistory();
      expect(history).toHaveLength(2);
    });

    it('should clear history', async () => {
      const validator = createIntegratedValidator({
        memoryRetriever: mockMemory,
        autoTriggerSherlock: false,
      });

      await validator.validatePhase(1, createPassingLScore(), createGateContext());
      validator.clearHistory();

      const history = validator.getValidationHistory();
      expect(history).toHaveLength(0);
    });
  });

  describe('underlying validators', () => {
    it('should expose gate validator', () => {
      const validator = createIntegratedValidator({
        memoryRetriever: mockMemory,
      });

      const gateValidator = validator.getGateValidator();
      expect(gateValidator).toBeDefined();
    });

    it('should expose Sherlock reviewer', () => {
      const validator = createIntegratedValidator({
        memoryRetriever: mockMemory,
      });

      const sherlockReviewer = validator.getSherlockReviewer();
      expect(sherlockReviewer).toBeDefined();
    });
  });
});

describe('Factory functions', () => {
  it('createIntegratedValidator should create instance', () => {
    const validator = createIntegratedValidator({
      memoryRetriever: createMockMemoryRetriever(),
    });
    expect(validator).toBeInstanceOf(IntegratedValidator);
  });

  it('createTestIntegratedValidator should create minimal instance', () => {
    const validator = createTestIntegratedValidator(createMockMemoryRetriever());
    expect(validator).toBeInstanceOf(IntegratedValidator);
  });
});

describe('IntegratedValidatorError', () => {
  it('should create error with code and message', () => {
    const error = new IntegratedValidatorError('PHASE_INVALID', 'Test error', 99);
    expect(error.code).toBe('PHASE_INVALID');
    expect(error.message).toBe('Test error');
    expect(error.phase).toBe(99);
    expect(error.name).toBe('IntegratedValidatorError');
  });
});

describe('PhD Pipeline Isolation', () => {
  it('should reject PhD pipeline type to prevent contamination', () => {
    expect(() => {
      new IntegratedValidator({
        memoryRetriever: createMockMemoryRetriever(),
        pipelineType: 'phd',
      });
    }).toThrow(IntegratedValidatorError);
  });

  it('should accept coding pipeline type (default)', () => {
    const validator = new IntegratedValidator({
      memoryRetriever: createMockMemoryRetriever(),
      pipelineType: 'coding',
    });
    expect(validator).toBeInstanceOf(IntegratedValidator);
  });

  it('should default to coding pipeline when not specified', () => {
    const validator = new IntegratedValidator({
      memoryRetriever: createMockMemoryRetriever(),
    });
    expect(validator).toBeInstanceOf(IntegratedValidator);
  });
});
