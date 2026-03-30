/**
 * IDESC-001: Intelligent DESC v2 - Outcome Tracker Tests
 * TASK-IDESC-OUT-006: Unit Tests for Outcome Tracking
 *
 * Tests for:
 * - OutcomeTracker.recordOutcome (TASK-IDESC-OUT-001)
 * - OutcomeTracker.getSuccessRate (TASK-IDESC-OUT-002)
 * - OutcomeTracker.shouldWarn (TASK-IDESC-NEG-001)
 * - OutcomeTracker.generateWarning (TASK-IDESC-NEG-002)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OutcomeTracker, type IDatabaseConnection } from '../../../../../src/god-agent/core/ucm/desc/outcome-tracker.js';
import {
  EpisodeNotFoundError,
  InvalidOutcomeError
} from '../../../../../src/god-agent/core/ucm/desc/errors.js';
import { ErrorType } from '../../../../../src/god-agent/core/ucm/types.js';

// ============================================================================
// Mock Database
// ============================================================================

function createMockDb(): IDatabaseConnection & {
  outcomes: Map<string, unknown[]>;
  stats: Map<string, unknown>;
  episodes: Set<string>;
} {
  const outcomes = new Map<string, unknown[]>();
  const stats = new Map<string, unknown>();
  const episodes = new Set<string>();

  // Add some default episodes
  episodes.add('ep-test-1');
  episodes.add('ep-test-2');
  episodes.add('ep-test-3');

  return {
    outcomes,
    stats,
    episodes,

    async run(sql: string, params?: unknown[]): Promise<{ lastInsertRowid: number | bigint }> {
      if (sql.includes('INSERT INTO episode_outcomes')) {
        const [outcomeId, episodeId] = params as string[];
        const existing = outcomes.get(episodeId) || [];
        existing.push({
          outcome_id: outcomeId,
          episode_id: episodeId,
          task_id: params![2],
          success: params![3],
          error_type: params![4],
          details: params![5],
          recorded_at: params![6]
        });
        outcomes.set(episodeId, existing);

        // Update stats
        const currentStats = stats.get(episodeId) as { outcome_count: number; success_count: number; failure_count: number } | undefined;
        const success = params![3] as number;
        if (currentStats) {
          currentStats.outcome_count++;
          if (success === 1) currentStats.success_count++;
          else currentStats.failure_count++;
          stats.set(episodeId, currentStats);
        } else {
          stats.set(episodeId, {
            episode_id: episodeId,
            outcome_count: 1,
            success_count: success,
            failure_count: 1 - success,
            success_rate: null,
            last_outcome_at: params![6]
          });
        }
      }
      return { lastInsertRowid: 1 };
    },

    async get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined> {
      if (sql.includes('SELECT episode_id FROM episodes')) {
        const episodeId = params![0] as string;
        if (episodes.has(episodeId)) {
          return { episode_id: episodeId } as T;
        }
        return undefined;
      }

      if (sql.includes('SELECT outcome_count FROM episode_stats')) {
        const episodeId = params![0] as string;
        const stat = stats.get(episodeId) as { outcome_count: number } | undefined;
        if (!stat) return undefined;
        return { outcome_count: stat.outcome_count } as T;
      }

      if (sql.includes('SELECT success_rate FROM episode_stats')) {
        const episodeId = params![0] as string;
        const stat = stats.get(episodeId) as { outcome_count: number; success_count: number } | undefined;
        if (!stat) return undefined;

        const successRate = stat.outcome_count >= 3
          ? stat.success_count / stat.outcome_count
          : null;
        return { success_rate: successRate } as T;
      }

      if (sql.includes('SELECT * FROM episode_stats')) {
        const episodeId = params![0] as string;
        const stat = stats.get(episodeId) as { outcome_count: number; success_count: number; failure_count: number; last_outcome_at?: string } | undefined;
        if (!stat) return undefined;

        return {
          episode_id: episodeId,
          outcome_count: stat.outcome_count,
          success_count: stat.success_count,
          failure_count: stat.failure_count,
          success_rate: stat.outcome_count >= 3 ? stat.success_count / stat.outcome_count : null,
          last_outcome_at: stat.last_outcome_at || new Date().toISOString()
        } as T;
      }

      return undefined;
    },

    async all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
      if (sql.includes('SELECT * FROM episode_outcomes')) {
        const episodeId = params![0] as string;
        const episodeOutcomes = outcomes.get(episodeId) || [];

        if (sql.includes('success = 0')) {
          // Filter for failures only
          const failures = episodeOutcomes.filter((o: unknown) => (o as { success: number }).success === 0);
          return failures.slice(0, params![1] as number || 5) as T[];
        }

        return episodeOutcomes as T[];
      }

      if (sql.includes('SELECT episode_id, success_rate FROM episode_stats')) {
        const episodeIds = params as string[];
        const results: unknown[] = [];
        for (const episodeId of episodeIds) {
          const stat = stats.get(episodeId) as { outcome_count: number; success_count: number } | undefined;
          if (stat) {
            results.push({
              episode_id: episodeId,
              success_rate: stat.outcome_count >= 3 ? stat.success_count / stat.outcome_count : null
            });
          }
        }
        return results as T[];
      }

      return [];
    }
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('OutcomeTracker', () => {
  let db: ReturnType<typeof createMockDb>;
  let tracker: OutcomeTracker;

  beforeEach(() => {
    db = createMockDb();
    tracker = new OutcomeTracker(db);
  });

  describe('recordOutcome', () => {
    it('should record a successful outcome', async () => {
      const outcomeId = await tracker.recordOutcome({
        episodeId: 'ep-test-1',
        taskId: 'task-123',
        success: true
      });

      expect(outcomeId).toBeDefined();
      expect(typeof outcomeId).toBe('string');
      expect(db.outcomes.get('ep-test-1')).toHaveLength(1);
    });

    it('should record a failure outcome with error type', async () => {
      const outcomeId = await tracker.recordOutcome({
        episodeId: 'ep-test-1',
        taskId: 'task-123',
        success: false,
        errorType: ErrorType.SYNTAX_ERROR,
        details: { line: 42, message: 'Unexpected token' }
      });

      expect(outcomeId).toBeDefined();
      const outcomes = db.outcomes.get('ep-test-1');
      expect(outcomes).toHaveLength(1);
      expect((outcomes![0] as { success: number }).success).toBe(0);
      expect((outcomes![0] as { error_type: string }).error_type).toBe('syntax_error');
    });

    it('should throw EpisodeNotFoundError for non-existent episode', async () => {
      await expect(
        tracker.recordOutcome({
          episodeId: 'non-existent',
          taskId: 'task-123',
          success: true
        })
      ).rejects.toThrow(EpisodeNotFoundError);
    });

    it('should throw InvalidOutcomeError for missing episodeId', async () => {
      await expect(
        tracker.recordOutcome({
          episodeId: '',
          taskId: 'task-123',
          success: true
        })
      ).rejects.toThrow(InvalidOutcomeError);
    });

    it('should throw InvalidOutcomeError for missing taskId', async () => {
      await expect(
        tracker.recordOutcome({
          episodeId: 'ep-test-1',
          taskId: '',
          success: true
        })
      ).rejects.toThrow(InvalidOutcomeError);
    });
  });

  describe('getSuccessRate', () => {
    it('should return null when outcome count < 3', async () => {
      await tracker.recordOutcome({
        episodeId: 'ep-test-1',
        taskId: 'task-1',
        success: true
      });
      await tracker.recordOutcome({
        episodeId: 'ep-test-1',
        taskId: 'task-2',
        success: true
      });

      const rate = await tracker.getSuccessRate('ep-test-1');
      expect(rate).toBeNull();
    });

    it('should return 1.0 when all outcomes are success', async () => {
      for (let i = 0; i < 5; i++) {
        await tracker.recordOutcome({
          episodeId: 'ep-test-1',
          taskId: `task-${i}`,
          success: true
        });
      }

      const rate = await tracker.getSuccessRate('ep-test-1');
      expect(rate).toBe(1.0);
    });

    it('should return 0.0 when all outcomes are failures', async () => {
      for (let i = 0; i < 5; i++) {
        await tracker.recordOutcome({
          episodeId: 'ep-test-1',
          taskId: `task-${i}`,
          success: false,
          errorType: ErrorType.LOGIC_ERROR
        });
      }

      const rate = await tracker.getSuccessRate('ep-test-1');
      expect(rate).toBe(0.0);
    });

    it('should return correct rate for mixed outcomes', async () => {
      // 3 successes, 2 failures = 60%
      for (let i = 0; i < 3; i++) {
        await tracker.recordOutcome({
          episodeId: 'ep-test-1',
          taskId: `task-s-${i}`,
          success: true
        });
      }
      for (let i = 0; i < 2; i++) {
        await tracker.recordOutcome({
          episodeId: 'ep-test-1',
          taskId: `task-f-${i}`,
          success: false
        });
      }

      const rate = await tracker.getSuccessRate('ep-test-1');
      expect(rate).toBe(0.6);
    });

    it('should use cache for subsequent calls', async () => {
      for (let i = 0; i < 3; i++) {
        await tracker.recordOutcome({
          episodeId: 'ep-test-1',
          taskId: `task-${i}`,
          success: true
        });
      }

      const getSpy = vi.spyOn(db, 'get');

      // First call - should hit DB
      await tracker.getSuccessRate('ep-test-1');
      expect(getSpy).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      await tracker.getSuccessRate('ep-test-1');
      expect(getSpy).toHaveBeenCalledTimes(1); // Still 1

      getSpy.mockRestore();
    });

    it('should invalidate cache on new outcome', async () => {
      for (let i = 0; i < 3; i++) {
        await tracker.recordOutcome({
          episodeId: 'ep-test-1',
          taskId: `task-${i}`,
          success: true
        });
      }

      // First call
      const rate1 = await tracker.getSuccessRate('ep-test-1');
      expect(rate1).toBe(1.0);

      // Record a failure
      await tracker.recordOutcome({
        episodeId: 'ep-test-1',
        taskId: 'task-failure',
        success: false
      });

      // Should get updated rate (3/4 = 0.75)
      const rate2 = await tracker.getSuccessRate('ep-test-1');
      expect(rate2).toBe(0.75);
    });
  });

  describe('getOutcomes', () => {
    it('should return empty array for episode with no outcomes', async () => {
      const outcomes = await tracker.getOutcomes('ep-test-1');
      expect(outcomes).toEqual([]);
    });

    it('should return all outcomes for an episode', async () => {
      await tracker.recordOutcome({
        episodeId: 'ep-test-1',
        taskId: 'task-1',
        success: true
      });
      await tracker.recordOutcome({
        episodeId: 'ep-test-1',
        taskId: 'task-2',
        success: false,
        errorType: ErrorType.SYNTAX_ERROR
      });

      const outcomes = await tracker.getOutcomes('ep-test-1');
      expect(outcomes).toHaveLength(2);
    });
  });

  describe('getEpisodeStats', () => {
    it('should return zero stats for episode with no outcomes', async () => {
      const stats = await tracker.getEpisodeStats('ep-test-1');
      expect(stats.outcomeCount).toBe(0);
      expect(stats.successCount).toBe(0);
      expect(stats.failureCount).toBe(0);
      expect(stats.successRate).toBeNull();
    });

    it('should return correct stats', async () => {
      for (let i = 0; i < 3; i++) {
        await tracker.recordOutcome({
          episodeId: 'ep-test-1',
          taskId: `task-s-${i}`,
          success: true
        });
      }
      await tracker.recordOutcome({
        episodeId: 'ep-test-1',
        taskId: 'task-f',
        success: false
      });

      const stats = await tracker.getEpisodeStats('ep-test-1');
      expect(stats.outcomeCount).toBe(4);
      expect(stats.successCount).toBe(3);
      expect(stats.failureCount).toBe(1);
      expect(stats.successRate).toBe(0.75);
    });
  });

  describe('shouldWarn', () => {
    it('should return false when outcome count < 3', async () => {
      await tracker.recordOutcome({
        episodeId: 'ep-test-1',
        taskId: 'task-1',
        success: false
      });

      const shouldWarn = await tracker.shouldWarn('ep-test-1');
      expect(shouldWarn).toBe(false);
    });

    it('should return false when success rate >= 50%', async () => {
      for (let i = 0; i < 3; i++) {
        await tracker.recordOutcome({
          episodeId: 'ep-test-1',
          taskId: `task-${i}`,
          success: true
        });
      }
      await tracker.recordOutcome({
        episodeId: 'ep-test-1',
        taskId: 'task-fail',
        success: false
      });

      const shouldWarn = await tracker.shouldWarn('ep-test-1');
      expect(shouldWarn).toBe(false); // 75% success rate
    });

    it('should return true when success rate < 50% with >= 3 outcomes', async () => {
      // 1 success, 3 failures = 25%
      await tracker.recordOutcome({
        episodeId: 'ep-test-1',
        taskId: 'task-s',
        success: true
      });
      for (let i = 0; i < 3; i++) {
        await tracker.recordOutcome({
          episodeId: 'ep-test-1',
          taskId: `task-f-${i}`,
          success: false,
          errorType: ErrorType.LOGIC_ERROR
        });
      }

      const shouldWarn = await tracker.shouldWarn('ep-test-1');
      expect(shouldWarn).toBe(true);
    });
  });

  describe('generateWarning', () => {
    it('should return null when shouldWarn is false', async () => {
      for (let i = 0; i < 3; i++) {
        await tracker.recordOutcome({
          episodeId: 'ep-test-1',
          taskId: `task-${i}`,
          success: true
        });
      }

      const warning = await tracker.generateWarning('ep-test-1');
      expect(warning).toBeNull();
    });

    it('should generate warning with correct structure', async () => {
      // Create low success rate scenario
      await tracker.recordOutcome({
        episodeId: 'ep-test-1',
        taskId: 'task-s',
        success: true
      });
      for (let i = 0; i < 3; i++) {
        await tracker.recordOutcome({
          episodeId: 'ep-test-1',
          taskId: `task-f-${i}`,
          success: false,
          errorType: ErrorType.SYNTAX_ERROR,
          details: { message: `Error ${i}` }
        });
      }

      const warning = await tracker.generateWarning('ep-test-1');

      expect(warning).not.toBeNull();
      expect(warning!.episodeId).toBe('ep-test-1');
      expect(warning!.successRate).toBe(0.25);
      expect(warning!.totalOutcomes).toBe(4);
      expect(warning!.failureCount).toBe(3);
      expect(warning!.warningText).toContain('negative_example_warning');
      expect(warning!.warningText).toContain('LOW success rate');
    });
  });

  describe('getFailures', () => {
    it('should return only failure outcomes', async () => {
      await tracker.recordOutcome({
        episodeId: 'ep-test-1',
        taskId: 'task-s',
        success: true
      });
      await tracker.recordOutcome({
        episodeId: 'ep-test-1',
        taskId: 'task-f-1',
        success: false,
        errorType: ErrorType.SYNTAX_ERROR
      });
      await tracker.recordOutcome({
        episodeId: 'ep-test-1',
        taskId: 'task-f-2',
        success: false,
        errorType: ErrorType.LOGIC_ERROR
      });

      const failures = await tracker.getFailures('ep-test-1');
      expect(failures).toHaveLength(2);
      failures.forEach(f => expect(f.success).toBe(false));
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await tracker.recordOutcome({
          episodeId: 'ep-test-1',
          taskId: `task-f-${i}`,
          success: false
        });
      }

      const failures = await tracker.getFailures('ep-test-1', 3);
      expect(failures).toHaveLength(3);
    });
  });

  describe('getBatchSuccessRates', () => {
    it('should return rates for multiple episodes', async () => {
      // Setup episode 1: 100% success
      for (let i = 0; i < 3; i++) {
        await tracker.recordOutcome({
          episodeId: 'ep-test-1',
          taskId: `task-1-${i}`,
          success: true
        });
      }

      // Setup episode 2: 50% success
      for (let i = 0; i < 2; i++) {
        await tracker.recordOutcome({
          episodeId: 'ep-test-2',
          taskId: `task-2-s-${i}`,
          success: true
        });
      }
      for (let i = 0; i < 2; i++) {
        await tracker.recordOutcome({
          episodeId: 'ep-test-2',
          taskId: `task-2-f-${i}`,
          success: false
        });
      }

      const rates = await tracker.getBatchSuccessRates(['ep-test-1', 'ep-test-2', 'ep-test-3']);

      expect(rates.get('ep-test-1')).toBe(1.0);
      expect(rates.get('ep-test-2')).toBe(0.5);
      expect(rates.get('ep-test-3')).toBeNull(); // No outcomes
    });
  });
});

describe('ConfidenceCalculator', () => {
  // Import dynamically to ensure proper module resolution
  let ConfidenceCalculator: typeof import('../../../../../src/god-agent/core/ucm/desc/confidence-calculator.js').ConfidenceCalculator;
  let WorkflowCategory: typeof import('../../../../../src/god-agent/core/ucm/types.js').WorkflowCategory;

  beforeEach(async () => {
    const confidenceModule = await import('../../../../../src/god-agent/core/ucm/desc/confidence-calculator.js');
    const typesModule = await import('../../../../../src/god-agent/core/ucm/types.js');
    ConfidenceCalculator = confidenceModule.ConfidenceCalculator;
    WorkflowCategory = typesModule.WorkflowCategory;
  });

  it('should return HIGH confidence for optimal conditions', () => {
    const calc = new ConfidenceCalculator();
    const recentDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

    const confidence = calc.calculate(
      0.96,  // similarity >= 0.95
      0.85,  // success rate >= 0.80
      5,     // outcomes >= 3
      recentDate,
      WorkflowCategory.CODING
    );

    expect(confidence).toBe('HIGH');
  });

  it('should return MEDIUM confidence when similarity meets threshold but other conditions fail', () => {
    const calc = new ConfidenceCalculator();
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

    const confidence = calc.calculate(
      0.93,  // similarity >= 0.92 (coding threshold)
      0.60,  // success rate >= 0.50
      5,
      oldDate,
      WorkflowCategory.CODING
    );

    expect(confidence).toBe('MEDIUM');
  });

  it('should return MEDIUM confidence when insufficient outcome data', () => {
    const calc = new ConfidenceCalculator();
    const recentDate = new Date();

    const confidence = calc.calculate(
      0.93,
      null,  // No success rate (insufficient data)
      2,     // outcomes < 3
      recentDate,
      WorkflowCategory.CODING
    );

    expect(confidence).toBe('MEDIUM');
  });

  it('should return LOW confidence when success rate is low', () => {
    const calc = new ConfidenceCalculator();
    const recentDate = new Date();

    const confidence = calc.calculate(
      0.75,  // Above 0.70 floor
      0.30,  // Below 0.50 threshold
      5,
      recentDate,
      WorkflowCategory.CODING
    );

    expect(confidence).toBe('LOW');
  });

  it('should use workflow-specific thresholds', () => {
    const calc = new ConfidenceCalculator();
    const recentDate = new Date();

    // 0.82 similarity: above RESEARCH threshold (0.80) but below CODING (0.92)
    const codingConfidence = calc.calculate(0.82, 0.60, 5, recentDate, WorkflowCategory.CODING);
    const researchConfidence = calc.calculate(0.82, 0.60, 5, recentDate, WorkflowCategory.RESEARCH);

    expect(codingConfidence).toBe('LOW');
    expect(researchConfidence).toBe('MEDIUM');
  });
});
