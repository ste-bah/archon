/**
 * Sherlock Phase Reviewer Tests
 *
 * Tests for the Sherlock-Holmes forensic phase review system.
 * Verifies investigation tiers, verdict rendering, and case file generation.
 *
 * @module tests/god-agent/core/pipeline/sherlock-phase-reviewer.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  SherlockPhaseReviewer,
  createSherlockPhaseReviewer,
  handlePhaseReviewResult,
  InvestigationTier,
  Verdict,
  VerdictConfidence,
  EvidenceStatus,
  AdversarialPersona,
  INVESTIGATION_TIER_CONFIG,
  FORENSIC_MEMORY_NAMESPACE,
  MAX_RETRY_COUNT,
  PHASE_NAMES,
  SherlockPhaseReviewerError,
  getProtocolForPhase,
  ALL_PHASE_PROTOCOLS,
  getEvidenceSourcesForPhase,
  getAdversarialPersonasForPhase,
  type IMemoryRetriever,
  type ISherlockPhaseReviewerConfig,
} from '../../../../src/god-agent/core/pipeline/sherlock-phase-reviewer.js';

// ═══════════════════════════════════════════════════════════════════════════
// MOCK MEMORY RETRIEVER
// ═══════════════════════════════════════════════════════════════════════════

function createMockMemoryRetriever(data: Record<string, unknown> = {}): IMemoryRetriever {
  const store: Record<string, unknown> = { ...data };
  return {
    async retrieve(key: string): Promise<unknown> {
      return store[key];
    },
    async store(key: string, value: unknown): Promise<void> {
      store[key] = value;
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// INVESTIGATION TIER CONFIG TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('INVESTIGATION_TIER_CONFIG', () => {
  it('should have all 4 investigation tiers', () => {
    expect(Object.keys(INVESTIGATION_TIER_CONFIG)).toHaveLength(4);
    expect(INVESTIGATION_TIER_CONFIG[InvestigationTier.GLANCE]).toBeDefined();
    expect(INVESTIGATION_TIER_CONFIG[InvestigationTier.SCAN]).toBeDefined();
    expect(INVESTIGATION_TIER_CONFIG[InvestigationTier.INVESTIGATION]).toBeDefined();
    expect(INVESTIGATION_TIER_CONFIG[InvestigationTier.DEEP_DIVE]).toBeDefined();
  });

  it('should have correct durations per PRD 2.3.2', () => {
    expect(INVESTIGATION_TIER_CONFIG[InvestigationTier.GLANCE].maxDurationMs).toBe(5000);
    expect(INVESTIGATION_TIER_CONFIG[InvestigationTier.SCAN].maxDurationMs).toBe(30000);
    expect(INVESTIGATION_TIER_CONFIG[InvestigationTier.INVESTIGATION].maxDurationMs).toBe(300000);
    expect(INVESTIGATION_TIER_CONFIG[InvestigationTier.DEEP_DIVE].maxDurationMs).toBe(1800000);
  });

  it('should have human-readable duration strings', () => {
    expect(INVESTIGATION_TIER_CONFIG[InvestigationTier.GLANCE].humanDuration).toBe('5 seconds');
    expect(INVESTIGATION_TIER_CONFIG[InvestigationTier.SCAN].humanDuration).toBe('30 seconds');
    expect(INVESTIGATION_TIER_CONFIG[InvestigationTier.INVESTIGATION].humanDuration).toBe('5 minutes');
    expect(INVESTIGATION_TIER_CONFIG[InvestigationTier.DEEP_DIVE].humanDuration).toBe('30+ minutes');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FORENSIC MEMORY NAMESPACE TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('FORENSIC_MEMORY_NAMESPACE', () => {
  it('should generate correct per-phase memory keys', () => {
    expect(FORENSIC_MEMORY_NAMESPACE.caseFile(1)).toBe('coding/forensics/phase-1/case-file');
    expect(FORENSIC_MEMORY_NAMESPACE.verdict(3)).toBe('coding/forensics/phase-3/verdict');
    expect(FORENSIC_MEMORY_NAMESPACE.evidenceSummary(5)).toBe('coding/forensics/phase-5/evidence-summary');
    expect(FORENSIC_MEMORY_NAMESPACE.remediation(7)).toBe('coding/forensics/phase-7/remediation');
  });

  it('should have aggregated pipeline keys', () => {
    expect(FORENSIC_MEMORY_NAMESPACE.allVerdicts).toBe('coding/forensics/pipeline/all-verdicts');
    expect(FORENSIC_MEMORY_NAMESPACE.investigationLog).toBe('coding/forensics/pipeline/investigation-log');
    expect(FORENSIC_MEMORY_NAMESPACE.patternLibrary).toBe('coding/forensics/pipeline/pattern-library');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE INVESTIGATION PROTOCOL TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('ALL_PHASE_PROTOCOLS', () => {
  it('should have 7 protocols for all phases', () => {
    expect(ALL_PHASE_PROTOCOLS).toHaveLength(7);
  });

  it('should have correct phase numbers', () => {
    for (let i = 0; i < 7; i++) {
      expect(ALL_PHASE_PROTOCOLS[i].phase).toBe(i + 1);
    }
  });

  it('should have evidence sources for each phase', () => {
    for (const protocol of ALL_PHASE_PROTOCOLS) {
      expect(protocol.evidenceSources.length).toBeGreaterThan(0);
    }
  });

  it('should have verification matrix for each phase', () => {
    for (const protocol of ALL_PHASE_PROTOCOLS) {
      expect(protocol.verificationMatrix.length).toBeGreaterThan(0);
    }
  });

  it('should have adversarial personas for each phase', () => {
    for (const protocol of ALL_PHASE_PROTOCOLS) {
      expect(protocol.adversarialPersonas.length).toBeGreaterThan(0);
    }
  });

  it('should have verdict criteria for each phase', () => {
    for (const protocol of ALL_PHASE_PROTOCOLS) {
      expect(protocol.verdictCriteria.INNOCENT).toBeDefined();
      expect(protocol.verdictCriteria.GUILTY).toBeDefined();
    }
  });
});

describe('getProtocolForPhase', () => {
  it('should return protocol for valid phase', () => {
    const protocol = getProtocolForPhase(3);
    expect(protocol).toBeDefined();
    expect(protocol?.phase).toBe(3);
    expect(protocol?.subject).toBe('System Architecture');
  });

  it('should return undefined for invalid phase', () => {
    expect(getProtocolForPhase(0)).toBeUndefined();
    expect(getProtocolForPhase(8)).toBeUndefined();
  });
});

describe('getEvidenceSourcesForPhase', () => {
  it('should return evidence sources for valid phase', () => {
    const sources = getEvidenceSourcesForPhase(1);
    expect(sources).toContain('coding/context/task_breakdown');
    expect(sources).toContain('coding/context/requirements');
  });

  it('should return empty array for invalid phase', () => {
    expect(getEvidenceSourcesForPhase(0)).toEqual([]);
  });
});

describe('getAdversarialPersonasForPhase', () => {
  it('should return personas for valid phase', () => {
    const personas = getAdversarialPersonasForPhase(4);
    expect(personas).toContain(AdversarialPersona.THE_BUG);
    expect(personas).toContain(AdversarialPersona.THE_ATTACKER);
  });

  it('should return empty array for invalid phase', () => {
    expect(getAdversarialPersonasForPhase(10)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SHERLOCK PHASE REVIEWER TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('SherlockPhaseReviewer', () => {
  let reviewer: SherlockPhaseReviewer;
  let mockMemory: IMemoryRetriever;

  beforeEach(() => {
    mockMemory = createMockMemoryRetriever({
      'coding/context/task_breakdown': { task: 'test task' },
      'coding/context/requirements': { requirements: ['req1', 'req2'] },
      'coding/context/scope': { scope: 'test scope' },
    });
    reviewer = createSherlockPhaseReviewer({ memoryRetriever: mockMemory });
  });

  describe('constructor', () => {
    it('should create instance with valid config', () => {
      expect(reviewer).toBeInstanceOf(SherlockPhaseReviewer);
    });

    it('should throw on invalid config', () => {
      expect(() => {
        new SherlockPhaseReviewer({ memoryRetriever: null as unknown as IMemoryRetriever });
      }).toThrow(SherlockPhaseReviewerError);
    });
  });

  describe('reviewPhase', () => {
    it('should return INNOCENT for phase with complete evidence', async () => {
      const result = await reviewer.reviewPhase(1);
      expect(result.phase).toBe(1);
      expect(result.verdict).toBe(Verdict.INNOCENT);
      expect(result.confidence).toBeDefined();
      expect(result.caseFile).toBeDefined();
    });

    it('should return GUILTY/INSUFFICIENT for phase with missing evidence', async () => {
      const emptyMemory = createMockMemoryRetriever({});
      const emptyReviewer = createSherlockPhaseReviewer({ memoryRetriever: emptyMemory });
      const result = await emptyReviewer.reviewPhase(1);
      expect(result.phase).toBe(1);
      expect([Verdict.GUILTY, Verdict.INSUFFICIENT_EVIDENCE]).toContain(result.verdict);
    });

    it('should throw for invalid phase', async () => {
      await expect(reviewer.reviewPhase(0)).rejects.toThrow(SherlockPhaseReviewerError);
      await expect(reviewer.reviewPhase(8)).rejects.toThrow(SherlockPhaseReviewerError);
    });

    it('should accept investigation tier override', async () => {
      const result = await reviewer.reviewPhase(1, InvestigationTier.DEEP_DIVE);
      expect(result.caseFile.tier).toBe(InvestigationTier.DEEP_DIVE);
    });

    it('should escalate tier on retry', async () => {
      const result1 = await reviewer.reviewPhase(1, undefined, 0);
      const result2 = await reviewer.reviewPhase(1, undefined, 2);
      expect(result2.caseFile.tier).toBe(InvestigationTier.DEEP_DIVE);
    });

    it('should store forensic findings in memory', async () => {
      await reviewer.reviewPhase(2);
      const stored = await mockMemory.retrieve(FORENSIC_MEMORY_NAMESPACE.verdict(2));
      expect(stored).toBeDefined();
    });
  });

  describe('case file generation', () => {
    it('should generate valid case ID format', async () => {
      const result = await reviewer.reviewPhase(3);
      expect(result.caseFile.caseId).toMatch(/^PHASE-3-REVIEW-/);
    });

    it('should include all required case file fields', async () => {
      const result = await reviewer.reviewPhase(1);
      const cf = result.caseFile;

      expect(cf.caseId).toBeDefined();
      expect(cf.phase).toBe(1);
      expect(cf.subject).toBeDefined();
      expect(cf.tier).toBeDefined();
      expect(cf.verdict).toBeDefined();
      expect(cf.confidence).toBeDefined();
      expect(cf.evidenceSummary).toBeDefined();
      expect(cf.verificationResults).toBeDefined();
      expect(cf.adversarialFindings).toBeDefined();
      expect(cf.chainOfCustody).toBeDefined();
      expect(cf.investigator).toBeDefined();
      expect(cf.timestamp).toBeInstanceOf(Date);
    });

    it('should include chain of custody events', async () => {
      const result = await reviewer.reviewPhase(1);
      const events = result.caseFile.chainOfCustody;

      expect(events.length).toBeGreaterThanOrEqual(4);
      expect(events.some(e => e.event.includes('initiated'))).toBe(true);
      expect(events.some(e => e.event.includes('Evidence collected'))).toBe(true);
      expect(events.some(e => e.event.includes('Verification'))).toBe(true);
      expect(events.some(e => e.event.includes('Verdict'))).toBe(true);
    });
  });

  describe('getCaseFileReport', () => {
    it('should generate markdown report', async () => {
      const result = await reviewer.reviewPhase(1);
      const report = reviewer.getCaseFileReport(result.caseFile);

      expect(report).toContain('## SHERLOCK HOLMES CASE FILE');
      expect(report).toContain('### Case ID:');
      expect(report).toContain('### VERDICT:');
      expect(report).toContain('### Evidence Summary');
      expect(report).toContain('### Verification Matrix Results');
      expect(report).toContain('### Adversarial Analysis');
      expect(report).toContain('### Chain of Custody');
    });
  });

  describe('review history', () => {
    it('should track review history', async () => {
      await reviewer.reviewPhase(1);
      await reviewer.reviewPhase(2);

      const history = reviewer.getReviewHistory();
      expect(history).toHaveLength(2);
      expect(history[0].phase).toBe(1);
      expect(history[1].phase).toBe(2);
    });

    it('should clear history', async () => {
      await reviewer.reviewPhase(1);
      reviewer.clearHistory();
      expect(reviewer.getReviewHistory()).toHaveLength(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HANDLE PHASE REVIEW RESULT TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('handlePhaseReviewResult', () => {
  it('should call onInnocent for INNOCENT verdict', async () => {
    const onInnocent = vi.fn();
    const result = {
      phase: 1,
      verdict: Verdict.INNOCENT,
      confidence: VerdictConfidence.HIGH,
      remediations: [],
      retryCount: 0,
      caseFile: {} as any,
    };

    await handlePhaseReviewResult(result, {
      onInnocent,
      onGuilty: vi.fn(),
      onInsufficientEvidence: vi.fn(),
      onEscalate: vi.fn(),
    });

    expect(onInnocent).toHaveBeenCalledWith(2);
  });

  it('should call onGuilty for GUILTY verdict with retries remaining', async () => {
    const onGuilty = vi.fn();
    const result = {
      phase: 1,
      verdict: Verdict.GUILTY,
      confidence: VerdictConfidence.HIGH,
      remediations: ['fix1', 'fix2'],
      retryCount: 1,
      caseFile: {} as any,
    };

    await handlePhaseReviewResult(result, {
      onInnocent: vi.fn(),
      onGuilty,
      onInsufficientEvidence: vi.fn(),
      onEscalate: vi.fn(),
    });

    expect(onGuilty).toHaveBeenCalledWith(['fix1', 'fix2'], 2);
  });

  it('should call onEscalate for GUILTY verdict with max retries', async () => {
    const onEscalate = vi.fn();
    const result = {
      phase: 1,
      verdict: Verdict.GUILTY,
      confidence: VerdictConfidence.HIGH,
      remediations: ['fix1'],
      retryCount: MAX_RETRY_COUNT,
      caseFile: {} as any,
    };

    await handlePhaseReviewResult(result, {
      onInnocent: vi.fn(),
      onGuilty: vi.fn(),
      onInsufficientEvidence: vi.fn(),
      onEscalate,
    });

    expect(onEscalate).toHaveBeenCalledWith(result);
  });

  it('should call onInsufficientEvidence for that verdict', async () => {
    const onInsufficientEvidence = vi.fn();
    const result = {
      phase: 2,
      verdict: Verdict.INSUFFICIENT_EVIDENCE,
      confidence: VerdictConfidence.LOW,
      remediations: [],
      retryCount: 0,
      caseFile: {} as any,
    };

    await handlePhaseReviewResult(result, {
      onInnocent: vi.fn(),
      onGuilty: vi.fn(),
      onInsufficientEvidence,
      onEscalate: vi.fn(),
    });

    expect(onInsufficientEvidence).toHaveBeenCalledWith(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Constants', () => {
  it('MAX_RETRY_COUNT should be 3', () => {
    expect(MAX_RETRY_COUNT).toBe(3);
  });

  it('PHASE_NAMES should have 7 phases', () => {
    expect(Object.keys(PHASE_NAMES)).toHaveLength(7);
    expect(PHASE_NAMES[1]).toBe('Understanding');
    expect(PHASE_NAMES[7]).toBe('Delivery');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ERROR HANDLING TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('SherlockPhaseReviewerError', () => {
  it('should have correct error code and message', () => {
    const error = new SherlockPhaseReviewerError('INVALID_PHASE', 'Test message', 0);
    expect(error.code).toBe('INVALID_PHASE');
    expect(error.message).toBe('Test message');
    expect(error.phase).toBe(0);
    expect(error.name).toBe('SherlockPhaseReviewerError');
  });

  it('should have undefined phase when not provided', () => {
    const error = new SherlockPhaseReviewerError('EVIDENCE_MISSING', 'Missing');
    expect(error.phase).toBeUndefined();
  });
});
