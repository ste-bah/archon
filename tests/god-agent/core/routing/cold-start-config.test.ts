/**
 * DAI-003: Cold Start Configuration Tests
 *
 * TASK-003: Cold Start Configuration Tests
 * Constitution: RULE-DAI-003-006
 *
 * Tests cold start phase determination, weight calculation, and indicator formatting.
 * Uses REAL data (NO MOCKS) per DAI-003 constitution.
 *
 * @module tests/god-agent/core/routing/cold-start-config.test
 */

import { describe, it, expect } from 'vitest';
import {
  defaultColdStartConfig,
  getColdStartPhase,
  getColdStartWeights,
  formatColdStartIndicator,
} from '../../../../src/god-agent/core/routing/cold-start-config.js';
import type {
  ColdStartPhase,
  IColdStartConfig,
} from '../../../../src/god-agent/core/routing/routing-types.js';
import { RoutingError } from '../../../../src/god-agent/core/routing/routing-errors.js';

describe('Cold Start Configuration', () => {
  describe('defaultColdStartConfig', () => {
    it('should have correct default thresholds', () => {
      expect(defaultColdStartConfig.keywordOnlyThreshold).toBe(25);
      expect(defaultColdStartConfig.learnedThreshold).toBe(100);
      expect(defaultColdStartConfig.maxColdStartConfidence).toBe(0.6);
    });

    it('should have correct default weights', () => {
      expect(defaultColdStartConfig.keywordOnlyWeight).toBe(1.0);
      expect(defaultColdStartConfig.blendedKeywordWeight).toBe(0.7);
      expect(defaultColdStartConfig.learnedKeywordWeight).toBe(0.2);
    });
  });

  describe('getColdStartPhase', () => {
    it('should return keyword-only for execution count 0', () => {
      const phase = getColdStartPhase(0);
      expect(phase).toBe('keyword-only');
    });

    it('should return keyword-only for execution count 15', () => {
      const phase = getColdStartPhase(15);
      expect(phase).toBe('keyword-only');
    });

    it('should return keyword-only for execution count at threshold (25)', () => {
      const phase = getColdStartPhase(25);
      expect(phase).toBe('keyword-only');
    });

    it('should return blended for execution count 26', () => {
      const phase = getColdStartPhase(26);
      expect(phase).toBe('blended');
    });

    it('should return blended for execution count 50', () => {
      const phase = getColdStartPhase(50);
      expect(phase).toBe('blended');
    });

    it('should return blended for execution count at threshold (100)', () => {
      const phase = getColdStartPhase(100);
      expect(phase).toBe('blended');
    });

    it('should return learned for execution count 101', () => {
      const phase = getColdStartPhase(101);
      expect(phase).toBe('learned');
    });

    it('should return learned for execution count 500', () => {
      const phase = getColdStartPhase(500);
      expect(phase).toBe('learned');
    });

    it('should throw RoutingError for negative execution count', () => {
      expect(() => getColdStartPhase(-1)).toThrow(RoutingError);
      expect(() => getColdStartPhase(-1)).toThrow('Invalid execution count: -1');
    });

    it('should respect custom config thresholds', () => {
      const customConfig: IColdStartConfig = {
        keywordOnlyThreshold: 10,
        learnedThreshold: 50,
        maxColdStartConfidence: 0.6,
        keywordOnlyWeight: 1.0,
        blendedKeywordWeight: 0.7,
        learnedKeywordWeight: 0.2,
      };

      expect(getColdStartPhase(5, customConfig)).toBe('keyword-only');
      expect(getColdStartPhase(10, customConfig)).toBe('keyword-only');
      expect(getColdStartPhase(11, customConfig)).toBe('blended');
      expect(getColdStartPhase(50, customConfig)).toBe('blended');
      expect(getColdStartPhase(51, customConfig)).toBe('learned');
    });
  });

  describe('getColdStartWeights', () => {
    it('should return correct weights for keyword-only phase', () => {
      const weights = getColdStartWeights('keyword-only');
      expect(weights.keywordWeight).toBe(1.0);
      expect(weights.capabilityWeight).toBe(0.0);
    });

    it('should return correct weights for blended phase', () => {
      const weights = getColdStartWeights('blended');
      expect(weights.keywordWeight).toBe(0.7);
      expect(weights.capabilityWeight).toBeCloseTo(0.3, 10);
    });

    it('should return correct weights for learned phase', () => {
      const weights = getColdStartWeights('learned');
      expect(weights.keywordWeight).toBe(0.2);
      expect(weights.capabilityWeight).toBeCloseTo(0.8, 10);
    });

    it('should ensure weights sum to 1.0 for all phases', () => {
      const phases: ColdStartPhase[] = ['keyword-only', 'blended', 'learned'];
      phases.forEach((phase) => {
        const weights = getColdStartWeights(phase);
        const sum = weights.keywordWeight + weights.capabilityWeight;
        expect(sum).toBeCloseTo(1.0, 10);
      });
    });

    it('should respect custom config weights', () => {
      const customConfig: IColdStartConfig = {
        keywordOnlyThreshold: 25,
        learnedThreshold: 100,
        maxColdStartConfidence: 0.6,
        keywordOnlyWeight: 0.9,
        blendedKeywordWeight: 0.5,
        learnedKeywordWeight: 0.1,
      };

      const weights1 = getColdStartWeights('keyword-only', customConfig);
      expect(weights1.keywordWeight).toBe(0.9);
      expect(weights1.capabilityWeight).toBeCloseTo(0.1, 10);

      const weights2 = getColdStartWeights('blended', customConfig);
      expect(weights2.keywordWeight).toBe(0.5);
      expect(weights2.capabilityWeight).toBeCloseTo(0.5, 10);

      const weights3 = getColdStartWeights('learned', customConfig);
      expect(weights3.keywordWeight).toBe(0.1);
      expect(weights3.capabilityWeight).toBeCloseTo(0.9, 10);
    });
  });

  describe('formatColdStartIndicator', () => {
    it('should format cold start indicator for keyword-only phase', () => {
      const indicator = formatColdStartIndicator('keyword-only', 15);
      expect(indicator).toBe('[Cold Start Mode: 15/100 executions]');
    });

    it('should format cold start indicator for blended phase', () => {
      const indicator = formatColdStartIndicator('blended', 75);
      expect(indicator).toBe('[Cold Start Mode: 75/100 executions]');
    });

    it('should format learned mode indicator', () => {
      const indicator = formatColdStartIndicator('learned', 150);
      expect(indicator).toBe('[Learned Mode]');
    });

    it('should format cold start indicator for execution count 0', () => {
      const indicator = formatColdStartIndicator('keyword-only', 0);
      expect(indicator).toBe('[Cold Start Mode: 0/100 executions]');
    });

    it('should format cold start indicator for execution count at threshold (100)', () => {
      const indicator = formatColdStartIndicator('blended', 100);
      expect(indicator).toBe('[Cold Start Mode: 100/100 executions]');
    });

    it('should format learned mode for execution count 101', () => {
      const indicator = formatColdStartIndicator('learned', 101);
      expect(indicator).toBe('[Learned Mode]');
    });
  });

  describe('Integration: Phase transitions', () => {
    it('should correctly transition through all phases', () => {
      const executionCounts = [0, 10, 25, 26, 50, 100, 101, 500];
      const expectedPhases: ColdStartPhase[] = [
        'keyword-only',
        'keyword-only',
        'keyword-only',
        'blended',
        'blended',
        'blended',
        'learned',
        'learned',
      ];

      executionCounts.forEach((count, index) => {
        const phase = getColdStartPhase(count);
        expect(phase).toBe(expectedPhases[index]);

        const weights = getColdStartWeights(phase);
        expect(weights.keywordWeight + weights.capabilityWeight).toBeCloseTo(1.0, 10);

        const indicator = formatColdStartIndicator(phase, count);
        if (phase === 'learned') {
          expect(indicator).toBe('[Learned Mode]');
        } else {
          expect(indicator).toContain('[Cold Start Mode:');
          expect(indicator).toContain(`${count}/100`);
        }
      });
    });

    it('should show decreasing keyword weight as execution count increases', () => {
      const counts = [10, 50, 150];
      const phases = counts.map((count) => getColdStartPhase(count));
      const weights = phases.map((phase) => getColdStartWeights(phase));

      // Keyword weight should decrease
      expect(weights[0].keywordWeight).toBeGreaterThan(weights[1].keywordWeight);
      expect(weights[1].keywordWeight).toBeGreaterThan(weights[2].keywordWeight);

      // Capability weight should increase
      expect(weights[0].capabilityWeight).toBeLessThan(weights[1].capabilityWeight);
      expect(weights[1].capabilityWeight).toBeLessThan(weights[2].capabilityWeight);
    });
  });
});
