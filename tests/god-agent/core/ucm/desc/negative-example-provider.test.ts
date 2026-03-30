/**
 * IDESC-001: Intelligent DESC v2 - Negative Example Provider Tests
 * TASK-IDESC-NEG-004: Unit Tests for Negative Examples
 *
 * Tests for:
 * - NegativeExampleProvider.enhanceResults (TASK-IDESC-NEG-003)
 * - NegativeExampleProvider.shouldWarn
 * - NegativeExampleProvider.getWarning
 * - NegativeExampleProvider.getDeprioritizationFactor
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  NegativeExampleProvider,
  DEFAULT_NEGATIVE_EXAMPLE_CONFIG,
  createNegativeExampleProvider
} from '../../../../../src/god-agent/core/ucm/desc/negative-example-provider.js';
import type { OutcomeTracker } from '../../../../../src/god-agent/core/ucm/desc/outcome-tracker.js';
import type {
  IRetrievalResult,
  IEpisodeStats,
  IWarningMessage
} from '../../../../../src/god-agent/core/ucm/types.js';
import { ErrorType } from '../../../../../src/god-agent/core/ucm/types.js';

// ============================================================================
// Mock OutcomeTracker
// ============================================================================

function createMockOutcomeTracker(): OutcomeTracker & {
  mockStats: Map<string, IEpisodeStats>;
  mockWarnings: Map<string, IWarningMessage>;
} {
  const mockStats = new Map<string, IEpisodeStats>();
  const mockWarnings = new Map<string, IWarningMessage>();

  return {
    mockStats,
    mockWarnings,

    async shouldWarn(episodeId: string): Promise<boolean> {
      const stats = mockStats.get(episodeId);
      if (!stats || stats.outcomeCount < 3) return false;
      return (stats.successRate ?? 1) < 0.50;
    },

    async generateWarning(episodeId: string): Promise<IWarningMessage | null> {
      return mockWarnings.get(episodeId) ?? null;
    },

    async getEpisodeStats(episodeId: string): Promise<IEpisodeStats> {
      const stats = mockStats.get(episodeId);
      if (!stats) {
        return {
          episodeId,
          outcomeCount: 0,
          successCount: 0,
          failureCount: 0,
          successRate: null,
          lastOutcomeAt: null
        };
      }
      return stats;
    },

    async getBatchSuccessRates(episodeIds: string[]): Promise<Map<string, number | null>> {
      const rates = new Map<string, number | null>();
      for (const id of episodeIds) {
        const stats = mockStats.get(id);
        rates.set(id, stats?.successRate ?? null);
      }
      return rates;
    }
  } as unknown as OutcomeTracker & {
    mockStats: Map<string, IEpisodeStats>;
    mockWarnings: Map<string, IWarningMessage>;
  };
}

// ============================================================================
// Test Fixtures
// ============================================================================

function createRetrievalResult(
  episodeId: string,
  score: number = 0.85
): IRetrievalResult {
  return {
    episodeId,
    answerText: `Answer for ${episodeId}`,
    maxSimilarity: score,
    matchedChunkType: 'answer',
    matchedChunkIndex: 0,
    searchChunkIndex: 0,
    metadata: {}
  };
}

function createStats(
  episodeId: string,
  outcomeCount: number,
  successRate: number | null
): IEpisodeStats {
  const successCount = successRate !== null
    ? Math.round(outcomeCount * successRate)
    : 0;
  return {
    episodeId,
    outcomeCount,
    successCount,
    failureCount: outcomeCount - successCount,
    successRate,
    lastOutcomeAt: new Date()
  };
}

function createWarning(
  episodeId: string,
  successRate: number,
  failureCount: number
): IWarningMessage {
  return {
    episodeId,
    successRate,
    totalOutcomes: Math.round(failureCount / (1 - successRate)),
    failureCount,
    recentFailures: [
      { errorType: ErrorType.LOGIC_ERROR, details: 'Test failure', timestamp: new Date() }
    ],
    warningText: `<!-- negative_example_warning -->\n⚠️ CAUTION: LOW success rate (${(successRate * 100).toFixed(0)}%)`
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('NegativeExampleProvider', () => {
  let mockTracker: ReturnType<typeof createMockOutcomeTracker>;
  let provider: NegativeExampleProvider;

  beforeEach(() => {
    mockTracker = createMockOutcomeTracker();
    provider = new NegativeExampleProvider(mockTracker);
  });

  describe('constructor', () => {
    it('should use default config when none provided', () => {
      const prov = new NegativeExampleProvider(mockTracker);
      expect(prov).toBeDefined();
    });

    it('should merge custom config with defaults', () => {
      const prov = new NegativeExampleProvider(mockTracker, {
        warningThreshold: 0.40
      });
      expect(prov).toBeDefined();
    });
  });

  describe('createNegativeExampleProvider', () => {
    it('should create a provider instance', () => {
      const prov = createNegativeExampleProvider(mockTracker);
      expect(prov).toBeInstanceOf(NegativeExampleProvider);
    });
  });

  describe('DEFAULT_NEGATIVE_EXAMPLE_CONFIG', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_NEGATIVE_EXAMPLE_CONFIG.minimumOutcomes).toBe(3);
      expect(DEFAULT_NEGATIVE_EXAMPLE_CONFIG.warningThreshold).toBe(0.50);
      expect(DEFAULT_NEGATIVE_EXAMPLE_CONFIG.deprioritizationFactor).toBe(0.9);
    });
  });

  describe('shouldWarn', () => {
    it('should return true for low success rate episodes', async () => {
      mockTracker.mockStats.set('ep-1', createStats('ep-1', 4, 0.25));

      const result = await provider.shouldWarn('ep-1');
      expect(result).toBe(true);
    });

    it('should return false for high success rate episodes', async () => {
      mockTracker.mockStats.set('ep-1', createStats('ep-1', 4, 0.80));

      const result = await provider.shouldWarn('ep-1');
      expect(result).toBe(false);
    });

    it('should return false for episodes with insufficient data', async () => {
      mockTracker.mockStats.set('ep-1', createStats('ep-1', 2, null));

      const result = await provider.shouldWarn('ep-1');
      expect(result).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      const errorTracker = {
        ...mockTracker,
        shouldWarn: vi.fn().mockRejectedValue(new Error('DB error'))
      } as unknown as OutcomeTracker;

      const prov = new NegativeExampleProvider(errorTracker);
      const result = await prov.shouldWarn('ep-1');
      expect(result).toBe(false); // Graceful degradation
    });
  });

  describe('getWarning', () => {
    it('should return warning for episode', async () => {
      const warning = createWarning('ep-1', 0.25, 3);
      mockTracker.mockWarnings.set('ep-1', warning);

      const result = await provider.getWarning('ep-1');
      expect(result).not.toBeNull();
      expect(result!.episodeId).toBe('ep-1');
      expect(result!.successRate).toBe(0.25);
    });

    it('should return null for episode without warning', async () => {
      const result = await provider.getWarning('ep-1');
      expect(result).toBeNull();
    });

    it('should handle errors gracefully', async () => {
      const errorTracker = {
        ...mockTracker,
        generateWarning: vi.fn().mockRejectedValue(new Error('DB error'))
      } as unknown as OutcomeTracker;

      const prov = new NegativeExampleProvider(errorTracker);
      const result = await prov.getWarning('ep-1');
      expect(result).toBeNull(); // Graceful degradation
    });
  });

  describe('getDeprioritizationFactor', () => {
    it('should return 1.0 for null success rate', () => {
      const factor = provider.getDeprioritizationFactor(null, 4);
      expect(factor).toBe(1.0);
    });

    it('should return 1.0 for insufficient outcomes', () => {
      const factor = provider.getDeprioritizationFactor(0.25, 2);
      expect(factor).toBe(1.0);
    });

    it('should return 1.0 for high success rate', () => {
      const factor = provider.getDeprioritizationFactor(0.80, 4);
      expect(factor).toBe(1.0);
    });

    it('should return deprioritization factor for low success rate', () => {
      const factor = provider.getDeprioritizationFactor(0.25, 4);
      expect(factor).toBeLessThan(1.0);
      expect(factor).toBeGreaterThanOrEqual(0.8);
    });

    it('should scale with success rate severity', () => {
      const factor50 = provider.getDeprioritizationFactor(0.49, 4);
      const factor25 = provider.getDeprioritizationFactor(0.25, 4);
      const factor0 = provider.getDeprioritizationFactor(0.0, 4);

      // Lower success rate = lower factor
      expect(factor50).toBeGreaterThan(factor25);
      expect(factor25).toBeGreaterThan(factor0);
    });
  });

  describe('enhanceResults', () => {
    it('should return empty array for empty input', async () => {
      const result = await provider.enhanceResults([]);
      expect(result).toEqual([]);
    });

    it('should enhance results with success rate and outcome count', async () => {
      mockTracker.mockStats.set('ep-1', createStats('ep-1', 5, 0.80));

      const results = [createRetrievalResult('ep-1')];
      const enhanced = await provider.enhanceResults(results);

      expect(enhanced).toHaveLength(1);
      expect(enhanced[0].successRate).toBe(0.80);
      expect(enhanced[0].outcomeCount).toBe(5);
      expect(enhanced[0].deprioritized).toBe(false);
    });

    it('should add warning for low success rate episode', async () => {
      const warning = createWarning('ep-1', 0.25, 3);
      mockTracker.mockStats.set('ep-1', createStats('ep-1', 4, 0.25));
      mockTracker.mockWarnings.set('ep-1', warning);

      const results = [createRetrievalResult('ep-1')];
      const enhanced = await provider.enhanceResults(results);

      expect(enhanced).toHaveLength(1);
      expect(enhanced[0].warning).not.toBeUndefined();
      expect(enhanced[0].warning!.successRate).toBe(0.25);
      expect(enhanced[0].deprioritized).toBe(true);
    });

    it('should not add warning for high success rate episode', async () => {
      mockTracker.mockStats.set('ep-1', createStats('ep-1', 4, 0.80));

      const results = [createRetrievalResult('ep-1')];
      const enhanced = await provider.enhanceResults(results);

      expect(enhanced).toHaveLength(1);
      expect(enhanced[0].warning).toBeUndefined();
      expect(enhanced[0].deprioritized).toBe(false);
    });

    it('should not add warning for insufficient outcome count', async () => {
      mockTracker.mockStats.set('ep-1', createStats('ep-1', 2, null));

      const results = [createRetrievalResult('ep-1')];
      const enhanced = await provider.enhanceResults(results);

      expect(enhanced).toHaveLength(1);
      expect(enhanced[0].warning).toBeUndefined();
      expect(enhanced[0].deprioritized).toBe(false);
    });

    it('should apply deprioritization factor to score', async () => {
      mockTracker.mockStats.set('ep-1', createStats('ep-1', 4, 0.25));
      mockTracker.mockWarnings.set('ep-1', createWarning('ep-1', 0.25, 3));

      const results = [createRetrievalResult('ep-1', 0.90)];
      const enhanced = await provider.enhanceResults(results);

      expect(enhanced).toHaveLength(1);
      expect(enhanced[0].maxSimilarity).toBeLessThan(0.90);
      expect(enhanced[0].deprioritized).toBe(true);
    });

    it('should sort deprioritized episodes after non-deprioritized', async () => {
      // ep-1: high success rate (not deprioritized)
      // ep-2: low success rate (deprioritized)
      // ep-3: high success rate (not deprioritized)
      mockTracker.mockStats.set('ep-1', createStats('ep-1', 4, 0.80));
      mockTracker.mockStats.set('ep-2', createStats('ep-2', 4, 0.25));
      mockTracker.mockStats.set('ep-3', createStats('ep-3', 4, 0.90));
      mockTracker.mockWarnings.set('ep-2', createWarning('ep-2', 0.25, 3));

      const results = [
        createRetrievalResult('ep-1', 0.85),
        createRetrievalResult('ep-2', 0.95), // Higher score but will be deprioritized
        createRetrievalResult('ep-3', 0.80)
      ];

      const enhanced = await provider.enhanceResults(results);

      expect(enhanced).toHaveLength(3);
      // Non-deprioritized first (ep-1 and ep-3)
      expect(enhanced[0].deprioritized).toBe(false);
      expect(enhanced[1].deprioritized).toBe(false);
      // Deprioritized last (ep-2)
      expect(enhanced[2].deprioritized).toBe(true);
      expect(enhanced[2].episodeId).toBe('ep-2');
    });

    it('should handle missing stats gracefully', async () => {
      // No stats set for ep-1
      const results = [createRetrievalResult('ep-1')];
      const enhanced = await provider.enhanceResults(results);

      expect(enhanced).toHaveLength(1);
      expect(enhanced[0].successRate).toBeNull();
      expect(enhanced[0].outcomeCount).toBe(0);
      expect(enhanced[0].warning).toBeUndefined();
      expect(enhanced[0].deprioritized).toBe(false);
    });
  });

  describe('getBatchWarnings', () => {
    it('should return warnings for multiple episodes', async () => {
      const warning1 = createWarning('ep-1', 0.25, 3);
      const warning2 = createWarning('ep-2', 0.30, 2);
      mockTracker.mockWarnings.set('ep-1', warning1);
      mockTracker.mockWarnings.set('ep-2', warning2);

      const warnings = await provider.getBatchWarnings(['ep-1', 'ep-2', 'ep-3']);

      expect(warnings.size).toBe(3);
      expect(warnings.get('ep-1')).not.toBeNull();
      expect(warnings.get('ep-2')).not.toBeNull();
      expect(warnings.get('ep-3')).toBeNull();
    });
  });
});
