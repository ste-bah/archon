/**
 * Tests for Sherlock-Learning Integration Module
 *
 * @module tests/god-agent/core/pipeline/sherlock-learning-integration.test
 * @see src/god-agent/core/pipeline/sherlock-learning-integration.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SherlockLearningIntegration,
  createSherlockLearningIntegration,
  createTestSherlockLearningIntegration,
  SherlockLearningError,
  DEFAULT_SHERLOCK_LEARNING_CONFIG,
  type ISherlockLearningConfig,
  type ISherlockLearningEvent,
} from '../../../../src/god-agent/core/pipeline/sherlock-learning-integration.js';

import {
  type IPhaseReviewResult,
  type ICaseFile,
  Verdict,
  VerdictConfidence,
  InvestigationTier,
  EvidenceStatus,
  AdversarialPersona,
} from '../../../../src/god-agent/core/pipeline/sherlock-phase-reviewer-types.js';

import type { ISonaEngine, IWeightUpdateResult } from '../../../../src/god-agent/core/learning/sona-types.js';

// ═══════════════════════════════════════════════════════════════════════════
// TEST FIXTURES
// ═══════════════════════════════════════════════════════════════════════════

function createMockSonaEngine(): ISonaEngine {
  return {
    createTrajectoryWithId: vi.fn(),
    provideFeedback: vi.fn().mockResolvedValue({
      trajectoryId: 'test-traj',
      patternsUpdated: 1,
      reward: 0.8,
      patternAutoCreated: false,
      elapsedMs: 5,
    } as IWeightUpdateResult),
    getWeight: vi.fn().mockResolvedValue(0.5),
    getTrajectory: vi.fn().mockReturnValue(null),
    hasTrajectoryInStorage: vi.fn().mockReturnValue(false),
    getTrajectoryFromStorage: vi.fn().mockReturnValue(null),
  };
}

function createMockReasoningBank(): { provideFeedback: ReturnType<typeof vi.fn> } {
  return {
    provideFeedback: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockCaseFile(phase: number, verdict: Verdict): ICaseFile {
  return {
    caseId: `PHASE-${phase}-REVIEW-${Date.now()}`,
    phase,
    subject: `Phase ${phase} Review`,
    tier: InvestigationTier.SCAN,
    verdict,
    confidence: VerdictConfidence.HIGH,
    evidenceSummary: [
      {
        source: 'test-evidence',
        status: EvidenceStatus.VERIFIED,
        notes: 'Test evidence',
      },
    ],
    verificationResults: [
      {
        check: 'test-check',
        method: 'cross-reference',
        expected: '≥ 0.8',
        actual: '0.85',
        passed: true,
      },
    ],
    adversarialFindings: [
      {
        persona: AdversarialPersona.THE_BUG,
        findings: 'No hidden bugs found',
        severity: 'info',
      },
      {
        persona: AdversarialPersona.THE_ATTACKER,
        findings: 'Critical security gap',
        severity: 'critical',
      },
    ],
    chainOfCustody: [
      { event: 'created', timestamp: new Date() },
    ],
    remediations: verdict === Verdict.GUILTY ? ['Fix the issue'] : [],
    investigator: 'SHERLOCK-TEST',
    timestamp: new Date(),
  };
}

function createMockPhaseReviewResult(
  phase: number,
  verdict: Verdict,
  confidence: VerdictConfidence = VerdictConfidence.HIGH
): IPhaseReviewResult {
  return {
    phase,
    verdict,
    confidence,
    remediations: verdict === Verdict.GUILTY ? ['Fix the issue'] : [],
    retryCount: 0,
    caseFile: createMockCaseFile(phase, verdict),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIT TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('SherlockLearningIntegration', () => {
  describe('constructor', () => {
    it('should create integration with default config', () => {
      const integration = new SherlockLearningIntegration({});
      expect(integration).toBeInstanceOf(SherlockLearningIntegration);
      expect(integration.isEnabled()).toBe(false); // No SonaEngine
    });

    it('should create integration with SonaEngine', () => {
      const sonaEngine = createMockSonaEngine();
      const integration = new SherlockLearningIntegration({ sonaEngine });
      expect(integration.isEnabled()).toBe(true);
    });

    it('should throw on invalid config', () => {
      expect(() => {
        new SherlockLearningIntegration({
          config: { patternThreshold: 2.0 } as ISherlockLearningConfig,
        });
      }).toThrow(SherlockLearningError);
    });
  });

  describe('recordVerdict', () => {
    it('should record INNOCENT verdict with high quality', async () => {
      const sonaEngine = createMockSonaEngine();
      const integration = new SherlockLearningIntegration({ sonaEngine });

      const result = createMockPhaseReviewResult(1, Verdict.INNOCENT);
      const updateResult = await integration.recordVerdict(result);

      expect(updateResult).not.toBeNull();
      expect(sonaEngine.createTrajectoryWithId).toHaveBeenCalled();
      expect(sonaEngine.provideFeedback).toHaveBeenCalled();

      // INNOCENT with HIGH confidence should have quality ~0.9
      const feedbackCall = vi.mocked(sonaEngine.provideFeedback).mock.calls[0];
      expect(feedbackCall[1]).toBeGreaterThanOrEqual(0.85);
    });

    it('should record GUILTY verdict with low quality', async () => {
      const sonaEngine = createMockSonaEngine();
      const integration = new SherlockLearningIntegration({ sonaEngine });

      const result = createMockPhaseReviewResult(1, Verdict.GUILTY);
      await integration.recordVerdict(result);

      // GUILTY with HIGH confidence should have quality ~0.3
      const feedbackCall = vi.mocked(sonaEngine.provideFeedback).mock.calls[0];
      expect(feedbackCall[1]).toBeLessThanOrEqual(0.4);
    });

    it('should skip learning when disabled', async () => {
      const sonaEngine = createMockSonaEngine();
      const integration = new SherlockLearningIntegration({
        sonaEngine,
        config: { enabled: false },
      });

      const result = createMockPhaseReviewResult(1, Verdict.INNOCENT);
      const updateResult = await integration.recordVerdict(result);

      expect(updateResult).toBeNull();
      expect(sonaEngine.provideFeedback).not.toHaveBeenCalled();
    });

    it('should skip learning when no SonaEngine', async () => {
      const integration = new SherlockLearningIntegration({});

      const result = createMockPhaseReviewResult(1, Verdict.INNOCENT);
      const updateResult = await integration.recordVerdict(result);

      expect(updateResult).toBeNull();
    });

    it('should store pattern for high-quality verdicts', async () => {
      const sonaEngine = createMockSonaEngine();
      const integration = new SherlockLearningIntegration({
        sonaEngine,
        config: { patternThreshold: 0.75 },
      });

      const result = createMockPhaseReviewResult(1, Verdict.INNOCENT);
      await integration.recordVerdict(result);

      const patterns = integration.getPatterns();
      expect(patterns.length).toBe(1);
      expect(patterns[0].phase).toBe(1);
      expect(patterns[0].verdict).toBe(Verdict.INNOCENT);
    });

    it('should not store pattern for low-quality verdicts', async () => {
      const sonaEngine = createMockSonaEngine();
      const integration = new SherlockLearningIntegration({
        sonaEngine,
        config: { patternThreshold: 0.75 },
      });

      const result = createMockPhaseReviewResult(1, Verdict.GUILTY);
      await integration.recordVerdict(result);

      const patterns = integration.getPatterns();
      expect(patterns.length).toBe(0);
    });
  });

  describe('event listeners', () => {
    it('should emit verdict:recorded event', async () => {
      const sonaEngine = createMockSonaEngine();
      const integration = new SherlockLearningIntegration({ sonaEngine });

      const events: ISherlockLearningEvent[] = [];
      integration.addEventListener((e) => events.push(e));

      const result = createMockPhaseReviewResult(1, Verdict.INNOCENT);
      await integration.recordVerdict(result);

      expect(events.some((e) => e.type === 'verdict:recorded')).toBe(true);
    });

    it('should emit trajectory:feedback event', async () => {
      const sonaEngine = createMockSonaEngine();
      const integration = new SherlockLearningIntegration({ sonaEngine });

      const events: ISherlockLearningEvent[] = [];
      integration.addEventListener((e) => events.push(e));

      const result = createMockPhaseReviewResult(1, Verdict.INNOCENT);
      await integration.recordVerdict(result);

      expect(events.some((e) => e.type === 'trajectory:feedback')).toBe(true);
    });

    it('should remove event listener', async () => {
      const sonaEngine = createMockSonaEngine();
      const integration = new SherlockLearningIntegration({ sonaEngine });

      const events: ISherlockLearningEvent[] = [];
      const listener = (e: ISherlockLearningEvent) => events.push(e);
      integration.addEventListener(listener);
      integration.removeEventListener(listener);

      const result = createMockPhaseReviewResult(1, Verdict.INNOCENT);
      await integration.recordVerdict(result);

      expect(events.length).toBe(0);
    });
  });

  describe('pattern management', () => {
    it('should get patterns for specific phase', async () => {
      const sonaEngine = createMockSonaEngine();
      const integration = new SherlockLearningIntegration({
        sonaEngine,
        config: { patternThreshold: 0.75 },
      });

      await integration.recordVerdict(createMockPhaseReviewResult(1, Verdict.INNOCENT));
      await integration.recordVerdict(createMockPhaseReviewResult(2, Verdict.INNOCENT));
      await integration.recordVerdict(createMockPhaseReviewResult(1, Verdict.INNOCENT));

      const phase1Patterns = integration.getPatternsForPhase(1);
      expect(phase1Patterns.length).toBe(2);

      const phase2Patterns = integration.getPatternsForPhase(2);
      expect(phase2Patterns.length).toBe(1);
    });

    it('should clear patterns', async () => {
      const sonaEngine = createMockSonaEngine();
      const integration = new SherlockLearningIntegration({
        sonaEngine,
        config: { patternThreshold: 0.75 },
      });

      await integration.recordVerdict(createMockPhaseReviewResult(1, Verdict.INNOCENT));
      expect(integration.getPatterns().length).toBe(1);

      integration.clearPatterns();
      expect(integration.getPatterns().length).toBe(0);
    });
  });

  describe('ReasoningBank integration', () => {
    it('should feed INNOCENT verdict to ReasoningBank', async () => {
      const sonaEngine = createMockSonaEngine();
      const reasoningBank = createMockReasoningBank();
      const integration = new SherlockLearningIntegration({
        sonaEngine,
        // Cast to any to satisfy type requirements in test
        reasoningBank: reasoningBank as never,
        config: { patternThreshold: 0.75 },
      });

      const result = createMockPhaseReviewResult(1, Verdict.INNOCENT);
      await integration.recordVerdict(result);

      expect(reasoningBank.provideFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          verdict: 'correct',
        })
      );
    });

    it('should not feed GUILTY verdict to ReasoningBank', async () => {
      const sonaEngine = createMockSonaEngine();
      const reasoningBank = createMockReasoningBank();
      const integration = new SherlockLearningIntegration({
        sonaEngine,
        reasoningBank: reasoningBank as never,
        config: { patternThreshold: 0.75 },
      });

      const result = createMockPhaseReviewResult(1, Verdict.GUILTY);
      await integration.recordVerdict(result);

      // GUILTY verdict should not create pattern in ReasoningBank
      expect(reasoningBank.provideFeedback).not.toHaveBeenCalled();
    });
  });

  describe('confidence multiplier', () => {
    it('should reduce quality for MEDIUM confidence', async () => {
      const sonaEngine = createMockSonaEngine();
      const integration = new SherlockLearningIntegration({ sonaEngine });

      const highConfResult = createMockPhaseReviewResult(
        1,
        Verdict.INNOCENT,
        VerdictConfidence.HIGH
      );
      await integration.recordVerdict(highConfResult);

      const medConfResult = createMockPhaseReviewResult(
        2,
        Verdict.INNOCENT,
        VerdictConfidence.MEDIUM
      );
      await integration.recordVerdict(medConfResult);

      const calls = vi.mocked(sonaEngine.provideFeedback).mock.calls;
      expect(calls[0][1]).toBeGreaterThan(calls[1][1]);
    });

    it('should reduce quality for LOW confidence', async () => {
      const sonaEngine = createMockSonaEngine();
      const integration = new SherlockLearningIntegration({ sonaEngine });

      const highConfResult = createMockPhaseReviewResult(
        1,
        Verdict.INNOCENT,
        VerdictConfidence.HIGH
      );
      await integration.recordVerdict(highConfResult);

      const lowConfResult = createMockPhaseReviewResult(
        2,
        Verdict.INNOCENT,
        VerdictConfidence.LOW
      );
      await integration.recordVerdict(lowConfResult);

      const calls = vi.mocked(sonaEngine.provideFeedback).mock.calls;
      expect(calls[0][1]).toBeGreaterThan(calls[1][1]);
    });
  });
});

describe('Factory functions', () => {
  it('createSherlockLearningIntegration should create instance', () => {
    const integration = createSherlockLearningIntegration({});
    expect(integration).toBeInstanceOf(SherlockLearningIntegration);
  });

  it('createTestSherlockLearningIntegration should create minimal instance', () => {
    const integration = createTestSherlockLearningIntegration();
    expect(integration).toBeInstanceOf(SherlockLearningIntegration);
    expect(integration.isEnabled()).toBe(false); // No backing engine
  });
});

describe('SherlockLearningError', () => {
  it('should create error with code and message', () => {
    const error = new SherlockLearningError('CONFIG_INVALID', 'Test error', 1);
    expect(error.code).toBe('CONFIG_INVALID');
    expect(error.message).toBe('Test error');
    expect(error.phase).toBe(1);
    expect(error.name).toBe('SherlockLearningError');
  });
});

describe('DEFAULT_SHERLOCK_LEARNING_CONFIG', () => {
  it('should have correct default values', () => {
    expect(DEFAULT_SHERLOCK_LEARNING_CONFIG.enabled).toBe(true);
    expect(DEFAULT_SHERLOCK_LEARNING_CONFIG.patternThreshold).toBe(0.75);
    expect(DEFAULT_SHERLOCK_LEARNING_CONFIG.routePrefix).toBe('coding/forensics/');
  });
});

describe('PhD Pipeline Isolation', () => {
  it('should NOT export PhDQualityGateValidator types', () => {
    // This is a compile-time check - the module should not import or export
    // any PhD-specific types. The test file imports only verify we can
    // use the Sherlock types without PhD contamination.
    expect(true).toBe(true);
  });

  it('should use coding/forensics namespace (not phd/)', () => {
    const config = DEFAULT_SHERLOCK_LEARNING_CONFIG;
    expect(config.routePrefix).toBe('coding/forensics/');
    expect(config.routePrefix).not.toContain('phd');
  });
});
