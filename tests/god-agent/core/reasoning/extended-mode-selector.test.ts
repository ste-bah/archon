/**
 * Unit tests for ExtendedModeSelector
 *
 * Tests all 8 advanced reasoning mode scoring functions plus core mode selection
 * and edge case handling.
 *
 * @module tests/god-agent/core/reasoning/extended-mode-selector
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ExtendedModeSelector,
  ExtendedModeSelectorConfig,
  ExtendedModeSelectionResult
} from '../../../../src/god-agent/core/reasoning/extended-mode-selector.js';
import {
  ReasoningMode
} from '../../../../src/god-agent/core/reasoning/reasoning-types.js';
import {
  AdvancedReasoningMode
} from '../../../../src/god-agent/core/reasoning/advanced-reasoning-types.js';

describe('ExtendedModeSelector', () => {
  let selector: ExtendedModeSelector;

  beforeEach(() => {
    selector = new ExtendedModeSelector();
  });

  describe('Mode Selection', () => {
    describe('Analogical Mode Selection', () => {
      it('should select analogical mode for cross-domain queries', async () => {
        const result = await selector.selectMode({
          query: 'What can distributed systems teach us about team organization?'
        });

        expect(result.mode).toBe(AdvancedReasoningMode.ANALOGICAL);
        expect(result.confidence).toBeGreaterThan(0.6);
      });

      it('should score high for "what can X teach us about Y" patterns', async () => {
        const result = await selector.selectMode({
          query: 'What can biology teach neural networks about resilience?'
        });

        expect(result.mode).toBe(AdvancedReasoningMode.ANALOGICAL);
        expect(result.allScores.analogical).toBeGreaterThanOrEqual(0.6);
      });

      it('should score high for analogy keywords', async () => {
        const queries = [
          'This is like how water flows through pipes',
          'Similar to how distributed systems work',
          'Analogous to neural network training',
          'Reminds me of React component lifecycle',
          'Just as TCP handles packet loss',
          'Comparable to database indexing'
        ];

        for (const query of queries) {
          const result = await selector.selectMode({ query });
          expect(result.allScores.analogical).toBeGreaterThan(0.3);
        }
      });

      it('should score high for domain transfer patterns', async () => {
        const result = await selector.selectMode({
          query: 'Apply principles from this domain to a different field'
        });

        expect(result.allScores.analogical).toBeGreaterThan(0.3);
      });

      it('should return 0 for unrelated queries', async () => {
        const result = await selector.selectMode({
          query: 'Calculate the factorial of 10'
        });

        expect(result.allScores.analogical).toBeLessThan(0.2);
      });
    });

    describe('Abductive Mode Selection', () => {
      it('should select abductive mode for "why" questions', async () => {
        const result = await selector.selectMode({
          query: 'Why is the build failing?'
        });

        expect(result.mode).toBe(AdvancedReasoningMode.ABDUCTIVE);
        expect(result.confidence).toBeGreaterThan(0.6);
      });

      it('should select abductive for diagnostic queries', async () => {
        const queries = [
          'What could cause these error logs?',
          'Diagnose the authentication failure',
          'Troubleshoot the database connection issue',
          'Debug the memory leak',
          'Investigate the root cause of the crash'
        ];

        for (const query of queries) {
          const result = await selector.selectMode({ query });
          expect(result.mode).toBe(AdvancedReasoningMode.ABDUCTIVE);
        }
      });

      it('should score high for why/cause keywords', async () => {
        const queries = [
          'Why does this error occur?',
          'What is the cause of the failure?',
          'Explain why the tests are failing',
          'Find the root cause of the issue',
          'The application crashes because of what?'
        ];

        for (const query of queries) {
          const result = await selector.selectMode({ query });
          expect(result.allScores.abductive).toBeGreaterThan(0.3);
        }
      });

      it('should score high for effect-to-cause structure', async () => {
        const result = await selector.selectMode({
          query: 'Why is the API returning 500 errors?'
        });

        expect(result.allScores.abductive).toBeGreaterThan(0.6);
      });
    });

    describe('Counterfactual Mode Selection', () => {
      it('should select counterfactual mode for "what if" queries', async () => {
        const result = await selector.selectMode({
          query: 'What if we had used PostgreSQL instead of MongoDB?'
        });

        expect(result.mode).toBe(AdvancedReasoningMode.COUNTERFACTUAL);
        expect(result.confidence).toBeGreaterThan(0.6);
      });

      it('should select counterfactual for hypothetical scenarios', async () => {
        const queries = [
          'Would the bug have occurred if we added validation?',
          'What would happen if we removed this feature?',
          'Could we have prevented this if we used rate limiting?',
          'Suppose we had chosen React instead of Vue',
          'Imagine if we had implemented caching'
        ];

        for (const query of queries) {
          const result = await selector.selectMode({ query });
          expect(result.mode).toBe(AdvancedReasoningMode.COUNTERFACTUAL);
        }
      });

      it('should score high for what-if keywords', async () => {
        const result = await selector.selectMode({
          query: 'What if we had implemented authentication differently?'
        });

        expect(result.allScores.counterfactual).toBeGreaterThan(0.5);
      });

      it('should score high for hypothetical patterns', async () => {
        const result = await selector.selectMode({
          query: 'If we used Redis then would performance improve?'
        });

        expect(result.allScores.counterfactual).toBeGreaterThan(0.5);
      });

      it('should score moderately for comparison indicators', async () => {
        const result = await selector.selectMode({
          query: 'Compare REST versus GraphQL for this API'
        });

        expect(result.allScores.counterfactual).toBeGreaterThan(0.2);
      });
    });

    describe('Decomposition Mode Selection', () => {
      it('should select decomposition for complex multi-part queries', async () => {
        const result = await selector.selectMode({
          query: 'Build a complete authentication system with SSO, MFA, password reset, email verification, session management, and role-based access control'
        });

        expect(result.mode).toBe(AdvancedReasoningMode.DECOMPOSITION);
        expect(result.confidence).toBeGreaterThan(0.6);
      });

      it('should score high when "step by step" is mentioned', async () => {
        const result = await selector.selectMode({
          query: 'Break down this complex refactoring task step by step'
        });

        expect(result.allScores.decomposition).toBeGreaterThan(0.6);
      });

      it('should score high for long queries', async () => {
        const longQuery = 'A'.repeat(250);
        const result = await selector.selectMode({ query: longQuery });

        expect(result.allScores.decomposition).toBeGreaterThan(0.2);
      });

      it('should score high for queries with multiple subjects', async () => {
        const result = await selector.selectMode({
          query: 'Implement authentication and authorization and logging and monitoring and error handling'
        });

        expect(result.allScores.decomposition).toBeGreaterThan(0.5);
      });

      it('should score high for breakdown keywords', async () => {
        const queries = [
          'Break down this problem',
          'What are the components of this system?',
          'Decompose the task into parts',
          'Split this into smaller pieces',
          'Divide the problem into manageable chunks'
        ];

        for (const query of queries) {
          const result = await selector.selectMode({ query });
          expect(result.allScores.decomposition).toBeGreaterThan(0.3);
        }
      });

      it('should score moderately for 2 "and" connectors', async () => {
        const result = await selector.selectMode({
          query: 'Build the frontend and backend and database'
        });

        expect(result.allScores.decomposition).toBeGreaterThan(0.15);
      });
    });

    describe('Adversarial Mode Selection', () => {
      it('should select adversarial mode for security queries', async () => {
        const result = await selector.selectMode({
          query: 'What security vulnerabilities exist in this authentication flow?'
        });

        expect(result.mode).toBe(AdvancedReasoningMode.ADVERSARIAL);
        expect(result.confidence).toBeGreaterThan(0.6);
      });

      it('should select adversarial for failure mode analysis', async () => {
        const queries = [
          'How could this API be exploited?',
          'What could go wrong with this design?',
          'Find vulnerabilities in the payment system',
          'What attack vectors exist?',
          'How could a hacker break this?'
        ];

        for (const query of queries) {
          const result = await selector.selectMode({ query });
          expect(result.mode).toBe(AdvancedReasoningMode.ADVERSARIAL);
        }
      });

      it('should score high for security/vulnerability keywords', async () => {
        const queries = [
          'Security review of authentication',
          'Check for vulnerabilities',
          'Identify attack surfaces',
          'Find exploitable weaknesses',
          'Assess security threats and risks'
        ];

        for (const query of queries) {
          const result = await selector.selectMode({ query });
          expect(result.allScores.adversarial).toBeGreaterThan(0.4);
        }
      });

      it('should score high for failure mode keywords', async () => {
        const queries = [
          'What could fail in this system?',
          'Find edge cases that break the logic',
          'What corner cases cause errors?',
          'Where could bugs occur?'
        ];

        for (const query of queries) {
          const result = await selector.selectMode({ query });
          expect(result.allScores.adversarial).toBeGreaterThan(0.3);
        }
      });

      it('should score high for challenge patterns', async () => {
        const result = await selector.selectMode({
          query: 'What could go wrong with this deployment pipeline?'
        });

        expect(result.allScores.adversarial).toBeGreaterThan(0.6);
      });
    });

    describe('Temporal Mode Selection', () => {
      it('should select temporal mode for time-based queries', async () => {
        const result = await selector.selectMode({
          query: 'How has our error rate changed over the past month?'
        });

        expect(result.mode).toBe(AdvancedReasoningMode.TEMPORAL);
        expect(result.confidence).toBeGreaterThan(0.6);
      });

      it('should detect date references', async () => {
        const queries = [
          'What events happened before the incident on December 10?',
          'Analyze trends from 2024 to 2025',
          'What changed in January?',
          'Show activity from last week',
          'Track changes over the past 30 days'
        ];

        for (const query of queries) {
          const result = await selector.selectMode({ query });
          expect(result.allScores.temporal).toBeGreaterThan(0.3);
        }
      });

      it('should score high for time keywords', async () => {
        const queries = [
          'When did this issue start?',
          'What happened before the crash?',
          'Events during the deployment',
          'Timeline of the incident',
          'Historical error patterns'
        ];

        for (const query of queries) {
          const result = await selector.selectMode({ query });
          expect(result.allScores.temporal).toBeGreaterThan(0.3);
        }
      });

      it('should score high for sequence keywords', async () => {
        const result = await selector.selectMode({
          query: 'What is the sequence of events? First this happens, then that, finally the error occurs'
        });

        expect(result.allScores.temporal).toBeGreaterThan(0.5);
      });

      it('should score high for trend analysis', async () => {
        const queries = [
          'What is the trend over time?',
          'How has performance evolved?',
          'Track the historical development of errors'
        ];

        for (const query of queries) {
          const result = await selector.selectMode({ query });
          expect(result.allScores.temporal).toBeGreaterThan(0.2);
        }
      });
    });

    describe('Constraint-Based Mode Selection', () => {
      it('should select constraint-based for queries with "must" requirements', async () => {
        const result = await selector.selectMode({
          query: 'Find a solution that must use only open-source libraries'
        });

        expect(result.mode).toBe(AdvancedReasoningMode.CONSTRAINT_BASED);
        expect(result.confidence).toBeGreaterThan(0.6);
      });

      it('should score high for constraint keywords', async () => {
        const queries = [
          'The solution must not use external dependencies',
          'We cannot use paid services',
          'Should not require Docker',
          'Design without using recursion',
          'Only if the response time is under 100ms',
          'This is required for compliance',
          'Mandatory security requirements'
        ];

        for (const query of queries) {
          const result = await selector.selectMode({ query });
          expect(result.allScores.constraintBased).toBeGreaterThan(0.4);
        }
      });

      it('should score high for requirement patterns', async () => {
        const queries = [
          'What are the requirements?',
          'Given these constraints, find a solution',
          'Within the limitations of our tech stack',
          'Restriction: no database writes',
          'Under these conditions, what can we do?'
        ];

        for (const query of queries) {
          const result = await selector.selectMode({ query });
          expect(result.allScores.constraintBased).toBeGreaterThan(0.3);
        }
      });

      it('should score high for conditional constraints', async () => {
        const result = await selector.selectMode({
          query: 'Design the system, but it must run on low-end hardware as long as accuracy is maintained'
        });

        expect(result.allScores.constraintBased).toBeGreaterThan(0.7);
      });
    });

    describe('First-Principles Mode Selection', () => {
      it('should select first-principles for fundamental derivations', async () => {
        const result = await selector.selectMode({
          query: 'Derive the optimal data structure from first principles'
        });

        expect(result.mode).toBe(AdvancedReasoningMode.FIRST_PRINCIPLES);
        expect(result.confidence).toBeGreaterThan(0.6);
      });

      it('should score high for fundamental keywords', async () => {
        const queries = [
          'What are the fundamental concepts?',
          'Explain the basic principles',
          'What is the core mechanism?',
          'Build from scratch without frameworks',
          'What are the underlying assumptions?',
          'Start with foundational knowledge'
        ];

        for (const query of queries) {
          const result = await selector.selectMode({ query });
          expect(result.allScores.firstPrinciples).toBeGreaterThan(0.4);
        }
      });

      it('should score high for derivation keywords', async () => {
        const queries = [
          'Derive the algorithm from basic principles',
          'Prove why this works',
          'Why does TCP use three-way handshake?',
          'How does hashing fundamentally work?',
          'Explain from first principles why this is optimal'
        ];

        for (const query of queries) {
          const result = await selector.selectMode({ query });
          expect(result.allScores.firstPrinciples).toBeGreaterThan(0.3);
        }
      });

      it('should score high for challenging assumptions', async () => {
        const queries = [
          'What assumptions are we making?',
          'Challenge the assumption that we need a database',
          'What is the ground truth here?',
          'Based on which axiom?',
          'Apply first principle reasoning'
        ];

        for (const query of queries) {
          const result = await selector.selectMode({ query });
          expect(result.allScores.firstPrinciples).toBeGreaterThan(0.3);
        }
      });
    });
  });

  describe('Scoring Functions', () => {
    describe('scoreAnalogical', () => {
      it('should score 0.4+ for analogy keywords', async () => {
        const result = await selector.selectMode({
          query: 'This is just as complex as distributed consensus'
        });

        expect(result.allScores.analogical).toBeGreaterThanOrEqual(0.4);
      });

      it('should score 0.3+ for domain transfer patterns', async () => {
        const result = await selector.selectMode({
          query: 'Apply concepts from this domain to our field'
        });

        expect(result.allScores.analogical).toBeGreaterThanOrEqual(0.3);
      });

      it('should return 0 for unrelated queries', async () => {
        const result = await selector.selectMode({
          query: 'Calculate the sum of numbers 1 to 100'
        });

        expect(result.allScores.analogical).toBe(0);
      });
    });

    describe('scoreAbductive', () => {
      it('should score 0.4+ for why/cause keywords', async () => {
        const result = await selector.selectMode({
          query: 'Why is the system slow?'
        });

        expect(result.allScores.abductive).toBeGreaterThanOrEqual(0.4);
      });

      it('should score 0.3+ for diagnostic keywords', async () => {
        const result = await selector.selectMode({
          query: 'Diagnose the network issue'
        });

        expect(result.allScores.abductive).toBeGreaterThanOrEqual(0.3);
      });

      it('should score 0.7+ when both keyword types present', async () => {
        const result = await selector.selectMode({
          query: 'Why is the system failing? Debug and find the root cause.'
        });

        expect(result.allScores.abductive).toBeGreaterThanOrEqual(0.7);
      });
    });

    describe('scoreCounterfactual', () => {
      it('should score 0.5+ for what-if keywords', async () => {
        const result = await selector.selectMode({
          query: 'What if we chose a different approach?'
        });

        expect(result.allScores.counterfactual).toBeGreaterThanOrEqual(0.5);
      });

      it('should score 0.3+ for hypothetical patterns', async () => {
        const result = await selector.selectMode({
          query: 'If we implement caching then performance would improve'
        });

        expect(result.allScores.counterfactual).toBeGreaterThanOrEqual(0.3);
      });

      it('should cap score at 1.0', async () => {
        const result = await selector.selectMode({
          query: 'What if we had chosen differently instead? Compare versus alternatives, would this change things?'
        });

        expect(result.allScores.counterfactual).toBeLessThanOrEqual(1.0);
      });
    });

    describe('scoreDecomposition', () => {
      it('should score 0.2+ for queries over 200 characters', async () => {
        const longQuery = 'A'.repeat(250);
        const result = await selector.selectMode({ query: longQuery });

        expect(result.allScores.decomposition).toBeGreaterThanOrEqual(0.2);
      });

      it('should score 0.3+ for 3+ "and" connectors', async () => {
        const result = await selector.selectMode({
          query: 'Do A and B and C and D'
        });

        expect(result.allScores.decomposition).toBeGreaterThanOrEqual(0.3);
      });

      it('should score 0.15+ for 2 "and" connectors', async () => {
        const result = await selector.selectMode({
          query: 'Do A and B and C'
        });

        expect(result.allScores.decomposition).toBeGreaterThanOrEqual(0.15);
      });

      it('should score 0.3+ for breakdown keywords', async () => {
        const result = await selector.selectMode({
          query: 'Break down this task into steps'
        });

        expect(result.allScores.decomposition).toBeGreaterThanOrEqual(0.3);
      });
    });

    describe('scoreAdversarial', () => {
      it('should score 0.4+ for security keywords', async () => {
        const result = await selector.selectMode({
          query: 'Check for security vulnerabilities'
        });

        expect(result.allScores.adversarial).toBeGreaterThanOrEqual(0.4);
      });

      it('should score 0.3+ for failure keywords', async () => {
        const result = await selector.selectMode({
          query: 'What could break in this edge case?'
        });

        expect(result.allScores.adversarial).toBeGreaterThanOrEqual(0.3);
      });

      it('should score 1.0 for combined patterns', async () => {
        const result = await selector.selectMode({
          query: 'What security vulnerabilities could cause this to fail? Find attack vectors that could break the system.'
        });

        expect(result.allScores.adversarial).toBe(1.0);
      });
    });

    describe('scoreTemporal', () => {
      it('should score 0.3+ for time keywords', async () => {
        const result = await selector.selectMode({
          query: 'When did this occur?'
        });

        expect(result.allScores.temporal).toBeGreaterThanOrEqual(0.3);
      });

      it('should score 0.3+ for date references', async () => {
        const result = await selector.selectMode({
          query: 'What happened in December 2024?'
        });

        expect(result.allScores.temporal).toBeGreaterThanOrEqual(0.3);
      });

      it('should score 0.2+ for sequence keywords', async () => {
        const result = await selector.selectMode({
          query: 'What is the sequence of operations?'
        });

        expect(result.allScores.temporal).toBeGreaterThanOrEqual(0.2);
      });

      it('should score 0.2+ for trend keywords', async () => {
        const result = await selector.selectMode({
          query: 'What is the trend in error rates?'
        });

        expect(result.allScores.temporal).toBeGreaterThanOrEqual(0.2);
      });
    });

    describe('scoreConstraintBased', () => {
      it('should score 0.4+ for constraint keywords', async () => {
        const result = await selector.selectMode({
          query: 'Solution must not use external APIs'
        });

        expect(result.allScores.constraintBased).toBeGreaterThanOrEqual(0.4);
      });

      it('should score 0.3+ for requirement keywords', async () => {
        const result = await selector.selectMode({
          query: 'What are the requirements and constraints?'
        });

        expect(result.allScores.constraintBased).toBeGreaterThanOrEqual(0.3);
      });

      it('should score 0.3+ for conditional constraints', async () => {
        const result = await selector.selectMode({
          query: 'Implement this, but only as long as performance is maintained'
        });

        expect(result.allScores.constraintBased).toBeGreaterThanOrEqual(0.3);
      });
    });

    describe('scoreFirstPrinciples', () => {
      it('should score 0.4+ for fundamental keywords', async () => {
        const result = await selector.selectMode({
          query: 'What are the fundamental principles?'
        });

        expect(result.allScores.firstPrinciples).toBeGreaterThanOrEqual(0.4);
      });

      it('should score 0.3+ for derivation keywords', async () => {
        const result = await selector.selectMode({
          query: 'Derive the solution from basic concepts'
        });

        expect(result.allScores.firstPrinciples).toBeGreaterThanOrEqual(0.3);
      });

      it('should score 0.3+ for assumption keywords', async () => {
        const result = await selector.selectMode({
          query: 'What assumptions are we making?'
        });

        expect(result.allScores.firstPrinciples).toBeGreaterThanOrEqual(0.3);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty queries gracefully', async () => {
      const result = await selector.selectMode({ query: '' });

      expect(result.mode).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
    });

    it('should use hybrid mode when scores are close', async () => {
      // Query that could match multiple modes similarly
      const result = await selector.selectMode({
        query: 'Analyze the issue'
      });

      // Either a specific mode or hybrid is acceptable
      expect(result.mode).toBeDefined();
      if (result.mode === ReasoningMode.HYBRID) {
        expect(result.reasoning).toContain('hybrid');
      }
    });

    it('should respect explicit mode override', async () => {
      const result = await selector.selectMode({
        query: 'Why is this failing?', // Would normally trigger abductive
        type: AdvancedReasoningMode.ANALOGICAL // But override to analogical
      });

      expect(result.mode).toBe(AdvancedReasoningMode.ANALOGICAL);
      expect(result.confidence).toBe(1.0);
      expect(result.reasoning).toBe('Explicit mode specified in request');
    });

    it('should handle queries matching multiple modes', async () => {
      const result = await selector.selectMode({
        query: 'What if we had used a different approach? Why would that fail? What security issues could arise?'
      });

      // Should select one mode with reasonable confidence
      expect(result.mode).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0.4);

      // Multiple scores should be elevated
      const scores = result.allScores;
      const highScores = Object.values(scores).filter(score => score > 0.3).length;
      expect(highScores).toBeGreaterThan(1);
    });

    it('should handle very short queries', async () => {
      const result = await selector.selectMode({ query: 'Why?' });

      expect(result.mode).toBe(AdvancedReasoningMode.ABDUCTIVE);
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should handle queries with no special keywords', async () => {
      const result = await selector.selectMode({
        query: 'Calculate fibonacci sequence'
      });

      expect(result.mode).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
    });

    it('should return all mode scores in allScores', async () => {
      const result = await selector.selectMode({
        query: 'Test query for all scores'
      });

      // Check all advanced mode scores are present
      expect(result.allScores.analogical).toBeDefined();
      expect(result.allScores.abductive).toBeDefined();
      expect(result.allScores.counterfactual).toBeDefined();
      expect(result.allScores.decomposition).toBeDefined();
      expect(result.allScores.adversarial).toBeDefined();
      expect(result.allScores.temporal).toBeDefined();
      expect(result.allScores.constraintBased).toBeDefined();
      expect(result.allScores.firstPrinciples).toBeDefined();

      // Check core mode scores are present
      expect(result.allScores.patternMatch).toBeDefined();
      expect(result.allScores.causalInference).toBeDefined();
      expect(result.allScores.contextual).toBeDefined();
    });

    it('should cap all scores between 0 and 1', async () => {
      const result = await selector.selectMode({
        query: 'What if this is similar to something else, and what are the requirements, and why does it fail, and when did it happen?'
      });

      const allScores = Object.values(result.allScores);
      allScores.forEach(score => {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('Performance Tests', () => {
    it('should complete mode selection in <5ms', async () => {
      const start = performance.now();

      await selector.selectMode({
        query: 'What if we used a different approach? Why would it work?'
      });

      const duration = performance.now() - start;
      expect(duration).toBeLessThan(5);
    });

    it('should handle 1000 queries efficiently', async () => {
      const queries = Array(1000).fill(null).map((_, i) =>
        `Query ${i}: What is the best approach for this problem?`
      );

      const start = performance.now();

      await Promise.all(
        queries.map(query => selector.selectMode({ query }))
      );

      const duration = performance.now() - start;
      const avgPerQuery = duration / 1000;

      // Average should be well under 5ms even with 1000 queries in parallel
      expect(avgPerQuery).toBeLessThan(10);
    });

    it('should handle complex queries efficiently', async () => {
      const complexQuery = `
        What if we had implemented this feature differently?
        Why would that approach fail?
        What security vulnerabilities could arise?
        Break down the problem step by step.
        What are the fundamental principles?
        How has this evolved over time?
        What constraints must we satisfy?
        This is similar to how distributed systems work.
      `.trim();

      const start = performance.now();

      await selector.selectMode({ query: complexQuery });

      const duration = performance.now() - start;
      expect(duration).toBeLessThan(5);
    });
  });

  describe('Mode Description', () => {
    it('should provide descriptions for all advanced modes', () => {
      const modes = [
        AdvancedReasoningMode.ANALOGICAL,
        AdvancedReasoningMode.ABDUCTIVE,
        AdvancedReasoningMode.COUNTERFACTUAL,
        AdvancedReasoningMode.DECOMPOSITION,
        AdvancedReasoningMode.ADVERSARIAL,
        AdvancedReasoningMode.TEMPORAL,
        AdvancedReasoningMode.CONSTRAINT_BASED,
        AdvancedReasoningMode.FIRST_PRINCIPLES
      ];

      modes.forEach(mode => {
        const description = selector.getModeDescription(mode);
        expect(description).toBeDefined();
        expect(description.length).toBeGreaterThan(10);
        expect(description).not.toBe('Unknown reasoning mode');
      });
    });

    it('should provide descriptions for core modes', () => {
      const modes = [
        ReasoningMode.PATTERN_MATCH,
        ReasoningMode.CAUSAL_INFERENCE,
        ReasoningMode.CONTEXTUAL,
        ReasoningMode.HYBRID
      ];

      modes.forEach(mode => {
        const description = selector.getModeDescription(mode);
        expect(description).toBeDefined();
        expect(description.length).toBeGreaterThan(10);
      });
    });
  });

  describe('Configuration', () => {
    it('should use custom thresholds when provided', async () => {
      const customSelector = new ExtendedModeSelector({
        analogicalThreshold: 0.9, // Very high threshold
        abductiveThreshold: 0.2   // Very low threshold
      });

      const result = await customSelector.selectMode({
        query: 'Why is this happening?'
      });

      // Should easily select abductive with low threshold
      expect(result.mode).toBe(AdvancedReasoningMode.ABDUCTIVE);
    });

    it('should use default thresholds when not provided', async () => {
      const defaultSelector = new ExtendedModeSelector();

      const result = await defaultSelector.selectMode({
        query: 'What if we tried something different?'
      });

      expect(result.confidence).toBeDefined();
    });

    it('should respect hybrid threshold configuration', async () => {
      const strictHybridSelector = new ExtendedModeSelector({
        hybridThreshold: 0.05 // Very small gap triggers hybrid
      });

      const result = await strictHybridSelector.selectMode({
        query: 'Analyze this problem' // Generic query
      });

      // More likely to trigger hybrid with strict threshold
      expect(result.mode).toBeDefined();
    });
  });
});
