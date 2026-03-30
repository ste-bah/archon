/**
 * TASK-IDESC-INT-003: Backward Compatibility Tests
 *
 * Ensures that:
 * 1. Existing InjectionFilter API remains unchanged
 * 2. IEnhancedInjectionDecision can be assigned to IInjectionDecision
 * 3. Legacy code using IInjectionDecision still works
 * 4. Helper functions for type conversion work correctly
 *
 * Implements: REQ-IDESC-018 (backward compatible)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InjectionFilter,
  EnhancedInjectionFilter,
  toLegacyDecision,
  isEnhancedDecision
} from '../../../../../src/god-agent/core/ucm/desc/injection-filter.js';
import type {
  IInjectionDecision,
  IEnhancedInjectionDecision,
  IStoredEpisode,
  ITaskContext,
  ConfidenceLevel
} from '../../../../../src/god-agent/core/ucm/types.js';
import { WorkflowCategory } from '../../../../../src/god-agent/core/ucm/types.js';

describe('Backward Compatibility - TASK-IDESC-INT-003', () => {
  let filter: InjectionFilter;
  let episode: IStoredEpisode;
  let taskContext: ITaskContext;

  beforeEach(() => {
    filter = new InjectionFilter();

    episode = {
      episodeId: 'test-001',
      queryText: 'Implement authentication',
      answerText: 'Here is the auth implementation...',
      queryChunkEmbeddings: [],
      answerChunkEmbeddings: [],
      queryChunkCount: 1,
      answerChunkCount: 1,
      createdAt: new Date(),
      metadata: {
        contentType: 'code',
        files: ['src/auth.ts']
      }
    };

    taskContext = {
      agentId: 'coder',
      task: 'Implement authentication',
      metadata: {
        files: ['src/auth.ts']
      }
    };
  });

  describe('InjectionFilter API Compatibility', () => {
    it('shouldInject returns IInjectionDecision with all required fields', () => {
      const decision = filter.shouldInject(episode, 0.95, taskContext);

      // Verify base IInjectionDecision fields
      expect(decision).toHaveProperty('inject');
      expect(decision).toHaveProperty('reason');
      expect(decision).toHaveProperty('adjustedScore');
      expect(decision).toHaveProperty('category');

      // Verify types
      expect(typeof decision.inject).toBe('boolean');
      expect(typeof decision.reason).toBe('string');
      expect(typeof decision.adjustedScore).toBe('number');
      expect(typeof decision.category).toBe('string');
    });

    it('shouldInject does NOT include enhanced fields', () => {
      const decision = filter.shouldInject(episode, 0.95, taskContext);

      // Base InjectionFilter should NOT return enhanced fields
      expect(decision).not.toHaveProperty('confidence');
      expect(decision).not.toHaveProperty('successRate');
      expect(decision).not.toHaveProperty('outcomeCount');
      expect(decision).not.toHaveProperty('warnings');
    });

    it('InjectionFilter methods maintain backward compatible signatures', () => {
      // Test that all legacy methods exist and work
      expect(typeof filter.detectWorkflowCategory).toBe('function');
      expect(typeof filter.applyRecencyDecay).toBe('function');
      expect(typeof filter.isContentTypeMatch).toBe('function');
      expect(typeof filter.isFileContextRelevant).toBe('function');
      expect(typeof filter.shouldInject).toBe('function');

      // Test calls work with legacy signatures
      const category = filter.detectWorkflowCategory(taskContext);
      expect(category).toBe(WorkflowCategory.CODING);

      const recency = filter.applyRecencyDecay(episode, WorkflowCategory.CODING);
      expect(recency).toBeGreaterThan(0);

      const contentMatch = filter.isContentTypeMatch(episode.metadata || {}, taskContext);
      expect(typeof contentMatch).toBe('boolean');

      const fileMatch = filter.isFileContextRelevant(episode.metadata || {}, taskContext);
      expect(typeof fileMatch).toBe('boolean');
    });
  });

  describe('Type Compatibility', () => {
    it('IEnhancedInjectionDecision is assignable to IInjectionDecision', () => {
      const enhanced: IEnhancedInjectionDecision = {
        inject: true,
        reason: 'Passed all filters',
        adjustedScore: 0.95,
        category: WorkflowCategory.CODING,
        confidence: 'HIGH' as ConfidenceLevel,
        successRate: 0.90,
        outcomeCount: 10,
        warnings: []
      };

      // This should compile without error - structural typing test
      const legacy: IInjectionDecision = enhanced;

      expect(legacy.inject).toBe(true);
      expect(legacy.reason).toBe('Passed all filters');
      expect(legacy.adjustedScore).toBe(0.95);
      expect(legacy.category).toBe(WorkflowCategory.CODING);
    });

    it('IEnhancedInjectionDecision can be used in legacy function', () => {
      // Simulate a legacy function that expects IInjectionDecision
      function legacyHandler(decision: IInjectionDecision): boolean {
        return decision.inject && decision.adjustedScore >= 0.80;
      }

      const enhanced: IEnhancedInjectionDecision = {
        inject: true,
        reason: 'Passed',
        adjustedScore: 0.92,
        category: WorkflowCategory.CODING,
        confidence: 'HIGH' as ConfidenceLevel,
        successRate: 0.85,
        outcomeCount: 5,
        warnings: []
      };

      // Enhanced decision should work seamlessly
      const result = legacyHandler(enhanced);
      expect(result).toBe(true);
    });

    it('Array<IEnhancedInjectionDecision> is assignable to Array<IInjectionDecision>', () => {
      const enhancedDecisions: IEnhancedInjectionDecision[] = [
        {
          inject: true,
          reason: 'Test 1',
          adjustedScore: 0.90,
          category: WorkflowCategory.CODING,
          confidence: 'HIGH' as ConfidenceLevel,
          successRate: 0.88,
          outcomeCount: 8,
          warnings: []
        },
        {
          inject: false,
          reason: 'Test 2',
          adjustedScore: 0.60,
          category: WorkflowCategory.CODING,
          confidence: 'LOW' as ConfidenceLevel,
          successRate: 0.30,
          outcomeCount: 3,
          warnings: ['Low success rate']
        }
      ];

      // Should be assignable
      const legacyDecisions: IInjectionDecision[] = enhancedDecisions;

      expect(legacyDecisions).toHaveLength(2);
      expect(legacyDecisions[0].inject).toBe(true);
      expect(legacyDecisions[1].inject).toBe(false);
    });
  });

  describe('Helper Functions', () => {
    describe('toLegacyDecision', () => {
      it('converts enhanced decision to legacy format', () => {
        const enhanced: IEnhancedInjectionDecision = {
          inject: true,
          reason: 'Passed all filters',
          adjustedScore: 0.95,
          category: WorkflowCategory.CODING,
          confidence: 'HIGH' as ConfidenceLevel,
          successRate: 0.90,
          outcomeCount: 10,
          warnings: ['Some warning'],
          trajectoryId: 'traj-001',
          reasoningTrace: 'trace...'
        };

        const legacy = toLegacyDecision(enhanced);

        // Should have base fields
        expect(legacy.inject).toBe(true);
        expect(legacy.reason).toBe('Passed all filters');
        expect(legacy.adjustedScore).toBe(0.95);
        expect(legacy.category).toBe(WorkflowCategory.CODING);

        // Should NOT have enhanced fields
        expect(legacy).not.toHaveProperty('confidence');
        expect(legacy).not.toHaveProperty('successRate');
        expect(legacy).not.toHaveProperty('outcomeCount');
        expect(legacy).not.toHaveProperty('warnings');
        expect(legacy).not.toHaveProperty('trajectoryId');
        expect(legacy).not.toHaveProperty('reasoningTrace');
      });

      it('preserves base field values exactly', () => {
        const enhanced: IEnhancedInjectionDecision = {
          inject: false,
          reason: 'Below threshold',
          adjustedScore: 0.75,
          category: WorkflowCategory.RESEARCH,
          confidence: 'LOW' as ConfidenceLevel,
          successRate: null,
          outcomeCount: 0,
          warnings: []
        };

        const legacy = toLegacyDecision(enhanced);

        expect(legacy.inject).toBe(false);
        expect(legacy.reason).toBe('Below threshold');
        expect(legacy.adjustedScore).toBe(0.75);
        expect(legacy.category).toBe(WorkflowCategory.RESEARCH);
      });
    });

    describe('isEnhancedDecision', () => {
      it('returns true for enhanced decision', () => {
        const enhanced: IEnhancedInjectionDecision = {
          inject: true,
          reason: 'Test',
          adjustedScore: 0.90,
          category: WorkflowCategory.CODING,
          confidence: 'HIGH' as ConfidenceLevel,
          successRate: 0.85,
          outcomeCount: 5,
          warnings: []
        };

        expect(isEnhancedDecision(enhanced)).toBe(true);
      });

      it('returns false for base decision', () => {
        const base: IInjectionDecision = {
          inject: true,
          reason: 'Test',
          adjustedScore: 0.90,
          category: WorkflowCategory.CODING
        };

        expect(isEnhancedDecision(base)).toBe(false);
      });

      it('can be used as type guard', () => {
        const decision: IInjectionDecision = {
          inject: true,
          reason: 'Test',
          adjustedScore: 0.90,
          category: WorkflowCategory.CODING
        };

        if (isEnhancedDecision(decision)) {
          // TypeScript knows decision is IEnhancedInjectionDecision
          expect(decision.confidence).toBeDefined();
        } else {
          // TypeScript knows decision is IInjectionDecision
          expect(true).toBe(true);
        }
      });

      it('works with enhanced decision from EnhancedInjectionFilter', async () => {
        // Mock dependencies
        const mockOutcomeTracker = {
          getEpisodeStats: vi.fn().mockResolvedValue({
            successRate: 0.85,
            outcomeCount: 5
          }),
          getBatchSuccessRates: vi.fn()
        };

        const mockConfidenceCalculator = {
          calculate: vi.fn().mockReturnValue('HIGH' as ConfidenceLevel)
        };

        const enhancedFilter = new EnhancedInjectionFilter(
          mockOutcomeTracker as any,
          mockConfidenceCalculator as any
        );

        const decision = await enhancedFilter.shouldInjectEnhanced(
          episode,
          0.95,
          taskContext
        );

        // Should be enhanced
        expect(isEnhancedDecision(decision)).toBe(true);

        if (isEnhancedDecision(decision)) {
          expect(decision.confidence).toBe('HIGH');
          expect(decision.successRate).toBe(0.85);
          expect(decision.outcomeCount).toBe(5);
        }
      });
    });
  });

  describe('Legacy Code Integration', () => {
    it('legacy code using IInjectionDecision still works', () => {
      // Simulate legacy code that only knows about IInjectionDecision
      class LegacyInjectionService {
        processDecision(decision: IInjectionDecision): string {
          if (decision.inject) {
            return `Injecting with score ${decision.adjustedScore.toFixed(2)}`;
          } else {
            return `Rejecting: ${decision.reason}`;
          }
        }
      }

      const service = new LegacyInjectionService();

      // Test with base decision
      const baseDecision = filter.shouldInject(episode, 0.95, taskContext);
      const baseResult = service.processDecision(baseDecision);
      expect(baseResult).toContain('Injecting with score');

      // Test with enhanced decision (should work seamlessly)
      const enhanced: IEnhancedInjectionDecision = {
        inject: true,
        reason: 'Passed',
        adjustedScore: 0.92,
        category: WorkflowCategory.CODING,
        confidence: 'HIGH' as ConfidenceLevel,
        successRate: 0.88,
        outcomeCount: 6,
        warnings: []
      };

      const enhancedResult = service.processDecision(enhanced);
      expect(enhancedResult).toBe('Injecting with score 0.92');
    });

    it('legacy array processing still works', () => {
      const decisions: IInjectionDecision[] = [
        filter.shouldInject(episode, 0.95, taskContext),
        filter.shouldInject(episode, 0.85, taskContext)
      ];

      // Legacy code that filters decisions
      const injectedDecisions = decisions.filter(d => d.inject);
      expect(injectedDecisions.length).toBeGreaterThanOrEqual(0);

      // Legacy code that maps decisions
      const scores = decisions.map(d => d.adjustedScore);
      expect(scores).toHaveLength(2);
      expect(scores.every(s => typeof s === 'number')).toBe(true);
    });
  });

  describe('EnhancedInjectionFilter Backward Compatibility', () => {
    it('EnhancedInjectionFilter extends InjectionFilter', () => {
      const mockOutcomeTracker = {
        getEpisodeStats: vi.fn().mockResolvedValue({ successRate: 0.85, outcomeCount: 5 }),
        getBatchSuccessRates: vi.fn()
      };
      const mockConfidenceCalculator = {
        calculate: vi.fn().mockReturnValue('HIGH' as ConfidenceLevel)
      };

      const enhancedFilter = new EnhancedInjectionFilter(
        mockOutcomeTracker as any,
        mockConfidenceCalculator as any
      );

      // Should be instance of both
      expect(enhancedFilter).toBeInstanceOf(EnhancedInjectionFilter);
      expect(enhancedFilter).toBeInstanceOf(InjectionFilter);
    });

    it('EnhancedInjectionFilter has all InjectionFilter methods', () => {
      const mockOutcomeTracker = {
        getEpisodeStats: vi.fn().mockResolvedValue({ successRate: 0.85, outcomeCount: 5 }),
        getBatchSuccessRates: vi.fn()
      };
      const mockConfidenceCalculator = {
        calculate: vi.fn().mockReturnValue('HIGH' as ConfidenceLevel)
      };

      const enhancedFilter = new EnhancedInjectionFilter(
        mockOutcomeTracker as any,
        mockConfidenceCalculator as any
      );

      // All base methods should exist
      expect(typeof enhancedFilter.detectWorkflowCategory).toBe('function');
      expect(typeof enhancedFilter.applyRecencyDecay).toBe('function');
      expect(typeof enhancedFilter.isContentTypeMatch).toBe('function');
      expect(typeof enhancedFilter.isFileContextRelevant).toBe('function');
      expect(typeof enhancedFilter.shouldInject).toBe('function');

      // Enhanced methods should exist
      expect(typeof enhancedFilter.shouldInjectEnhanced).toBe('function');
      expect(typeof enhancedFilter.shouldInjectBatch).toBe('function');
    });

    it('EnhancedInjectionFilter.shouldInject returns IInjectionDecision (not enhanced)', () => {
      const mockOutcomeTracker = {
        getEpisodeStats: vi.fn().mockResolvedValue({ successRate: 0.85, outcomeCount: 5 }),
        getBatchSuccessRates: vi.fn()
      };
      const mockConfidenceCalculator = {
        calculate: vi.fn().mockReturnValue('HIGH' as ConfidenceLevel)
      };

      const enhancedFilter = new EnhancedInjectionFilter(
        mockOutcomeTracker as any,
        mockConfidenceCalculator as any
      );

      // Call base shouldInject (not enhanced version)
      const decision = enhancedFilter.shouldInject(episode, 0.95, taskContext);

      // Should return base IInjectionDecision (not enhanced)
      expect(decision).toHaveProperty('inject');
      expect(decision).toHaveProperty('reason');
      expect(decision).toHaveProperty('adjustedScore');
      expect(decision).toHaveProperty('category');

      // Should NOT have enhanced fields from base method
      expect(decision).not.toHaveProperty('confidence');
    });
  });
});
