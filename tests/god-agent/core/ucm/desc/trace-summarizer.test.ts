/**
 * IDESC-001 Sprint 5 - Reasoning Trace Summarizer Tests
 * TASK-IDESC-RB-003: Unit Tests for Trace Summarizer
 *
 * Tests for:
 * - TraceSummarizer.summarize - Token-budget aware summarization
 * - TraceSummarizer.extractKeyInsights - Decision marker extraction
 * - TraceSummarizer.formatForInjection - DESC injection formatting
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TraceSummarizer,
  createTraceSummarizer,
  DEFAULT_TRACE_CONFIG,
  type ITraceSummarizer,
  type ITraceSummarizerConfig
} from '../../../../../src/god-agent/core/ucm/desc/trace-summarizer.js';

// ============================================================================
// Test Fixtures
// ============================================================================

const SHORT_TRACE = 'Decided: Use approach A. Conclusion: Best choice.';

const MEDIUM_TRACE = `
Analyzing the problem:
Decided: We should implement caching for performance.
Because: Database queries are slow and repetitive.
Therefore: Cache layer will reduce latency by 80%.
Conclusion: Redis is the optimal caching solution.
`;

const LONG_TRACE = `
Initial Analysis:
The system requires high throughput with low latency.
Current bottleneck is at the database layer.

Reasoning: After analyzing multiple approaches:
1. In-memory caching - fastest but limited capacity
2. Distributed caching - scalable but adds complexity
3. Query optimization - helps but not sufficient alone

Decided: Implement distributed caching with Redis.

Because:
- Horizontal scaling capability
- Sub-millisecond response times
- Built-in replication and persistence
- Industry-standard solution

Therefore: We will:
1. Set up Redis cluster
2. Implement cache-aside pattern
3. Add cache invalidation logic
4. Monitor cache hit rates

Performance Analysis:
Expected improvement: 80% latency reduction
Cache hit rate target: >90%
Memory overhead: ~2GB for 1M entries

Conclusion: Redis distributed caching is the optimal solution.
This approach balances performance, scalability, and maintainability.

Next Steps:
1. Design cache key strategy
2. Implement cache service layer
3. Add monitoring and alerts
4. Performance testing
`.repeat(3); // ~3000 chars, ~750 tokens

const TRACE_WITHOUT_MARKERS = `
This is a reasoning trace without explicit markers.
We analyzed various approaches to the problem.
The solution involves multiple components working together.
Performance is critical for this use case.
Security must be maintained throughout.
`;

// ============================================================================
// Test Suite
// ============================================================================

describe('TraceSummarizer', () => {
  let summarizer: ITraceSummarizer;

  beforeEach(() => {
    summarizer = new TraceSummarizer();
  });

  // ==========================================================================
  // Constructor and Configuration Tests
  // ==========================================================================

  describe('Constructor', () => {
    it('should create instance with default config', () => {
      const instance = new TraceSummarizer();
      expect(instance).toBeInstanceOf(TraceSummarizer);
    });

    it('should accept custom configuration', () => {
      const customConfig: Partial<ITraceSummarizerConfig> = {
        defaultMaxTokens: 1000,
        maxInsights: 10,
        decisionMarkers: ['decided:', 'custom-marker:']
      };
      const instance = new TraceSummarizer(customConfig);
      expect(instance).toBeInstanceOf(TraceSummarizer);
    });

    it('should merge custom config with defaults', () => {
      const instance = new TraceSummarizer({ defaultMaxTokens: 200 });
      expect(instance).toBeInstanceOf(TraceSummarizer);
    });
  });

  describe('createTraceSummarizer factory', () => {
    it('should create TraceSummarizer instance', () => {
      const instance = createTraceSummarizer();
      expect(instance).toBeInstanceOf(TraceSummarizer);
    });

    it('should accept config parameter', () => {
      const instance = createTraceSummarizer({ maxInsights: 3 });
      expect(instance).toBeInstanceOf(TraceSummarizer);
    });
  });

  // ==========================================================================
  // summarize() Tests
  // ==========================================================================

  describe('summarize()', () => {
    it('should return empty string for empty trace', async () => {
      const result = await summarizer.summarize('');
      expect(result).toBe('');
    });

    it('should return empty string for null/undefined trace', async () => {
      // @ts-expect-error Testing graceful handling of invalid input
      const result1 = await summarizer.summarize(null);
      expect(result1).toBe('');

      // @ts-expect-error Testing graceful handling of invalid input
      const result2 = await summarizer.summarize(undefined);
      expect(result2).toBe('');
    });

    it('should return trace as-is if under token budget', async () => {
      const result = await summarizer.summarize(SHORT_TRACE, 100);
      expect(result).toBe(SHORT_TRACE);
    });

    it('should use default maxTokens if not specified', async () => {
      const result = await summarizer.summarize(SHORT_TRACE);
      expect(result).toBe(SHORT_TRACE);
    });

    it('should truncate long trace to fit token budget', async () => {
      const maxTokens = 100; // ~400 chars
      const result = await summarizer.summarize(LONG_TRACE, maxTokens);

      // Result should be shorter than original
      expect(result.length).toBeLessThan(LONG_TRACE.length);

      // Result should be approximately at token budget (chars ~= tokens * 4)
      const expectedMaxChars = maxTokens * 4 * 1.2; // Allow 20% margin
      expect(result.length).toBeLessThanOrEqual(expectedMaxChars);
    });

    it('should preserve complete sentences when truncating', async () => {
      const trace = 'Sentence one. Sentence two. Sentence three.';
      const result = await summarizer.summarize(trace, 5); // Force truncation

      // Should not cut mid-sentence (unless no good break point)
      const hasCompleteSentence = result.endsWith('.') || result.endsWith('...');
      expect(hasCompleteSentence).toBe(true);
    });

    it('should handle traces with only whitespace', async () => {
      const result = await summarizer.summarize('   \n\n   \t   ');
      expect(result).toBe('');
    });

    it('should handle very short token budgets gracefully', async () => {
      const result = await summarizer.summarize(LONG_TRACE, 1);
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThan(20); // Very small
    });

    it('should handle exact token budget match', async () => {
      const trace = 'A'.repeat(400); // Exactly 100 tokens
      const result = await summarizer.summarize(trace, 100);
      expect(result).toBe(trace); // Should return unchanged
    });
  });

  // ==========================================================================
  // extractKeyInsights() Tests
  // ==========================================================================

  describe('extractKeyInsights()', () => {
    it('should return empty array for empty trace', async () => {
      const result = await summarizer.extractKeyInsights('');
      expect(result).toEqual([]);
    });

    it('should extract insights from decision markers', async () => {
      const result = await summarizer.extractKeyInsights(MEDIUM_TRACE);
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(DEFAULT_TRACE_CONFIG.maxInsights);
    });

    it('should recognize all default decision markers', async () => {
      const trace = `
Decided: Use Redis for caching.
Because: It provides fast access.
Conclusion: This is optimal.
Therefore: We proceed with this.
Reasoning: After careful analysis.
`;
      const result = await summarizer.extractKeyInsights(trace);
      expect(result.length).toBe(5); // All 5 markers
    });

    it('should extract insights case-insensitively', async () => {
      const trace = `
DECIDED: Use uppercase.
decided: Use lowercase.
DeCiDeD: Use mixed case.
`;
      const result = await summarizer.extractKeyInsights(trace);
      expect(result.length).toBe(3);
    });

    it('should respect maxInsights limit', async () => {
      const trace = Array(20).fill('Decided: Insight.').join('\n');
      const result = await summarizer.extractKeyInsights(trace);
      expect(result.length).toBeLessThanOrEqual(DEFAULT_TRACE_CONFIG.maxInsights);
    });

    it('should filter out very short insights (<10 chars)', async () => {
      const trace = `
Decided: Short.
Decided: This is a much longer and more substantive insight.
`;
      const result = await summarizer.extractKeyInsights(trace);
      expect(result.length).toBe(1); // Only the long one
      expect(result[0]).toContain('substantive');
    });

    it('should extract substantive lines when no markers found', async () => {
      const result = await summarizer.extractKeyInsights(TRACE_WITHOUT_MARKERS);
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(DEFAULT_TRACE_CONFIG.maxInsights);
    });

    it('should skip empty lines and whitespace', async () => {
      const trace = `

Decided: First insight.


Decided: Second insight.

`;
      const result = await summarizer.extractKeyInsights(trace);
      expect(result.length).toBe(2);
    });

    it('should remove marker prefix from extracted insight', async () => {
      const trace = 'Decided: Use Redis for caching.';
      const result = await summarizer.extractKeyInsights(trace);
      expect(result[0]).toBe('Use Redis for caching.');
      expect(result[0]).not.toContain('Decided:');
    });

    it('should handle traces with mixed content', async () => {
      const result = await summarizer.extractKeyInsights(LONG_TRACE);
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(DEFAULT_TRACE_CONFIG.maxInsights);
    });
  });

  // ==========================================================================
  // formatForInjection() Tests
  // ==========================================================================

  describe('formatForInjection()', () => {
    it('should return empty string for empty trace', async () => {
      const result = await summarizer.formatForInjection('', 'context');
      expect(result).toBe('');
    });

    it('should include HTML comment markers', async () => {
      const result = await summarizer.formatForInjection(SHORT_TRACE, 'test context');
      expect(result).toContain('<!-- reasoning_trace -->');
      expect(result).toContain('<!-- /reasoning_trace -->');
    });

    it('should include episode context', async () => {
      const context = 'Building authentication system';
      const result = await summarizer.formatForInjection(SHORT_TRACE, context);
      expect(result).toContain(context);
    });

    it('should include summarized trace', async () => {
      const result = await summarizer.formatForInjection(SHORT_TRACE, 'context');
      expect(result).toContain('Key Reasoning:');
      expect(result).toContain(SHORT_TRACE);
    });

    it('should include insights section when insights found', async () => {
      const result = await summarizer.formatForInjection(MEDIUM_TRACE, 'context');
      expect(result).toContain('### Insights:');
      expect(result).toContain('- '); // Bullet point
    });

    it('should omit insights section when trace is too short', async () => {
      const noInsights = 'Short.'; // Too short for substantive insights (<20 chars)
      const result = await summarizer.formatForInjection(noInsights, 'context');
      // Should not have insights section
      const hasInsights = result.includes('### Insights:');
      expect(hasInsights).toBe(false);
    });

    it('should use default context if empty', async () => {
      const result = await summarizer.formatForInjection(SHORT_TRACE, '');
      expect(result).toContain('Context:');
      expect(result).toContain('Similar problem context');
    });

    it('should produce well-formatted markdown', async () => {
      const result = await summarizer.formatForInjection(MEDIUM_TRACE, 'Test Context');

      // Check structure
      expect(result).toContain('##'); // Header
      expect(result).toContain('###'); // Subheaders
      expect(result).toContain('\n\n'); // Paragraph breaks

      // Check order
      const sections = [
        '<!-- reasoning_trace -->',
        '## Prior Reasoning',
        'Context:',
        '### Key Reasoning:',
        '<!-- /reasoning_trace -->'
      ];

      let lastIndex = -1;
      for (const section of sections) {
        const index = result.indexOf(section);
        expect(index).toBeGreaterThan(lastIndex);
        lastIndex = index;
      }
    });

    it('should handle long traces by summarizing', async () => {
      const result = await summarizer.formatForInjection(LONG_TRACE, 'context');

      // Should be much shorter than original
      expect(result.length).toBeLessThan(LONG_TRACE.length);

      // Should still have structure
      expect(result).toContain('<!-- reasoning_trace -->');
      expect(result).toContain('<!-- /reasoning_trace -->');
    });

    it('should handle traces with special characters', async () => {
      const specialTrace = 'Decided: Use <Redis> & [Cache] (optimal).';
      const result = await summarizer.formatForInjection(specialTrace, 'context');
      expect(result).toContain('<Redis>');
      expect(result).toContain('&');
      expect(result).toContain('[Cache]');
    });

    it('should format multiple insights correctly', async () => {
      const trace = `
Decided: First decision.
Because: First reason.
Conclusion: First conclusion.
Therefore: First action.
`;
      const result = await summarizer.formatForInjection(trace, 'context');

      const insightLines = result.split('\n').filter(line => line.startsWith('- '));
      expect(insightLines.length).toBeGreaterThan(0);
      expect(insightLines.length).toBeLessThanOrEqual(DEFAULT_TRACE_CONFIG.maxInsights);
    });
  });

  // ==========================================================================
  // Integration Tests
  // ==========================================================================

  describe('Integration', () => {
    it('should handle complete workflow from long trace to injection', async () => {
      // Summarize
      const summarized = await summarizer.summarize(LONG_TRACE, 200);
      expect(summarized.length).toBeLessThan(LONG_TRACE.length);

      // Extract insights
      const insights = await summarizer.extractKeyInsights(LONG_TRACE);
      expect(insights.length).toBeGreaterThan(0);

      // Format for injection
      const formatted = await summarizer.formatForInjection(LONG_TRACE, 'Performance optimization task');
      expect(formatted).toContain('<!-- reasoning_trace -->');
      expect(formatted).toContain('Performance optimization task');
      expect(formatted).toContain('### Insights:');
    });

    it('should produce consistent results across multiple calls', async () => {
      const trace = MEDIUM_TRACE;

      const result1 = await summarizer.formatForInjection(trace, 'context');
      const result2 = await summarizer.formatForInjection(trace, 'context');

      expect(result1).toBe(result2);
    });

    it('should handle edge case of trace that is exactly at token budget', async () => {
      const trace = 'A'.repeat(400); // Exactly 100 tokens
      const summarized = await summarizer.summarize(trace, 100);
      const formatted = await summarizer.formatForInjection(summarized, 'test');

      expect(formatted).toContain(trace);
    });
  });

  // ==========================================================================
  // Custom Configuration Tests
  // ==========================================================================

  describe('Custom Configuration', () => {
    it('should respect custom defaultMaxTokens', async () => {
      const customSummarizer = new TraceSummarizer({ defaultMaxTokens: 50 });
      const result = await customSummarizer.summarize(LONG_TRACE); // No maxTokens param

      const approxMaxChars = 50 * 4 * 1.2; // 50 tokens * 4 chars/token * 1.2 margin
      expect(result.length).toBeLessThanOrEqual(approxMaxChars);
    });

    it('should respect custom maxInsights', async () => {
      const customSummarizer = new TraceSummarizer({ maxInsights: 2 });
      const trace = Array(10).fill('Decided: Insight.').join('\n');
      const result = await customSummarizer.extractKeyInsights(trace);

      expect(result.length).toBeLessThanOrEqual(2);
    });

    it('should respect custom decision markers', async () => {
      const customSummarizer = new TraceSummarizer({
        decisionMarkers: ['custom-marker:', 'special:']
      });

      const trace = `
custom-marker: Custom insight.
special: Special insight.
decided: Standard insight (should be ignored).
`;
      const result = await customSummarizer.extractKeyInsights(trace);

      expect(result.length).toBe(2);
      expect(result[0]).toContain('Custom');
      expect(result[1]).toContain('Special');
    });
  });

  // ==========================================================================
  // Performance Tests
  // ==========================================================================

  describe('Performance', () => {
    it('should handle very large traces efficiently', async () => {
      const hugeTrace = LONG_TRACE.repeat(10); // ~30,000 chars

      const start = Date.now();
      await summarizer.summarize(hugeTrace, 100);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100); // Should be fast (<100ms)
    });

    it('should handle many insights efficiently', async () => {
      const manyInsights = Array(1000).fill('Decided: Insight.').join('\n');

      const start = Date.now();
      await summarizer.extractKeyInsights(manyInsights);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(50); // Should be fast (<50ms)
    });
  });
});
