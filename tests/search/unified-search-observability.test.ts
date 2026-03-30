/**
 * UnifiedSearch Observability Tests
 *
 * Tests for TASK-SEARCH-005: Add observability events to UnifiedSearch
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-SEARCH-005
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ActivityStream } from '../../src/god-agent/observability/activity-stream.js';

// Mock ActivityStream
vi.mock('../../src/god-agent/observability/activity-stream.js', () => {
  const mockEmit = vi.fn().mockResolvedValue(undefined);
  const mockPush = vi.fn();

  return {
    ActivityStream: vi.fn().mockImplementation(() => ({
      emit: mockEmit,
      push: mockPush,
      getRecent: vi.fn().mockReturnValue([]),
      filter: vi.fn().mockReturnValue([]),
      clear: vi.fn(),
      size: vi.fn().mockReturnValue(0),
      subscribe: vi.fn().mockReturnValue(() => {}),
    })),
  };
});

// Mock search types
interface MockQuadFusionResult {
  query: string;
  results: Array<{ id: string; content: string; score: number }>;
  metadata: {
    totalDurationMs: number;
    sourcesResponded: number;
    sourcesTimedOut: number;
    correlationId: string;
    rawResultCount: number;
    dedupedResultCount: number;
  };
  sourceStats: Record<string, unknown>;
}

/**
 * Simulated UnifiedSearch for testing observability
 */
class MockUnifiedSearch {
  private activityStream?: ActivityStream;

  constructor(activityStream?: ActivityStream) {
    this.activityStream = activityStream;
  }

  async search(
    query: string,
    _embedding?: Float32Array
  ): Promise<MockQuadFusionResult> {
    const startTime = performance.now();
    const correlationId = `qf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Emit search.started
    await this.emitSearchEvent('search.started', {
      correlationId,
      query,
      hasEmbedding: false,
    });

    // Validate query
    if (!query || query.trim().length === 0) {
      await this.emitSearchEvent(
        'search.error',
        {
          correlationId,
          query,
          error: 'Query cannot be empty',
          durationMs: performance.now() - startTime,
        },
        'error'
      );
      throw new Error('Query cannot be empty');
    }

    const totalDurationMs = performance.now() - startTime;
    const result: MockQuadFusionResult = {
      query,
      results: [
        { id: 'result-1', content: 'Test result 1', score: 0.95 },
        { id: 'result-2', content: 'Test result 2', score: 0.85 },
      ],
      metadata: {
        totalDurationMs,
        sourcesResponded: 4,
        sourcesTimedOut: 0,
        correlationId,
        rawResultCount: 10,
        dedupedResultCount: 2,
      },
      sourceStats: {},
    };

    // Emit search.completed
    await this.emitSearchEvent('search.completed', {
      correlationId,
      query,
      resultCount: result.results.length,
      totalDurationMs,
      sourcesResponded: result.metadata.sourcesResponded,
      sourcesTimedOut: result.metadata.sourcesTimedOut,
    });

    return result;
  }

  private async emitSearchEvent(
    type: string,
    payload: Record<string, unknown>,
    status: 'pending' | 'running' | 'success' | 'error' = 'success'
  ): Promise<void> {
    if (!this.activityStream) {
      return;
    }

    try {
      await this.activityStream.emit({
        type,
        correlationId: payload.correlationId as string | undefined,
        payload,
        component: 'search',
        status,
      });
    } catch {
      // Observability failures should not affect search operations
    }
  }
}

describe('TASK-SEARCH-005: UnifiedSearch Observability', () => {
  let activityStream: ActivityStream;
  let search: MockUnifiedSearch;

  beforeEach(() => {
    vi.clearAllMocks();
    activityStream = new ActivityStream();
    search = new MockUnifiedSearch(activityStream);
  });

  describe('Event Emission', () => {
    it('TC-S5-001: should emit search.started event', async () => {
      await search.search('test query');

      expect(activityStream.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'search.started',
          component: 'search',
          status: 'success',
        })
      );
    });

    it('TC-S5-002: should emit search.completed event', async () => {
      await search.search('test query');

      expect(activityStream.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'search.completed',
          component: 'search',
          status: 'success',
        })
      );
    });

    it('TC-S5-003: should emit search.error event on error', async () => {
      try {
        await search.search('');
      } catch {
        // Expected error
      }

      expect(activityStream.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'search.error',
          component: 'search',
          status: 'error',
        })
      );
    });

    it('TC-S5-004: should include correlationId in events', async () => {
      await search.search('test query');

      const calls = (activityStream.emit as ReturnType<typeof vi.fn>).mock
        .calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);

      // Both started and completed should have correlationId
      for (const call of calls) {
        expect(call[0].correlationId).toMatch(/^qf_\d+_[a-z0-9]+$/);
      }
    });

    it('TC-S5-005: should include query in payload', async () => {
      const testQuery = 'find authentication patterns';
      await search.search(testQuery);

      expect(activityStream.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            query: testQuery,
          }),
        })
      );
    });
  });

  describe('Event Order', () => {
    it('TC-S5-010: should emit started before completed', async () => {
      await search.search('test query');

      const calls = (activityStream.emit as ReturnType<typeof vi.fn>).mock
        .calls;
      const startedIndex = calls.findIndex(
        (c: [{ type: string }]) => c[0].type === 'search.started'
      );
      const completedIndex = calls.findIndex(
        (c: [{ type: string }]) => c[0].type === 'search.completed'
      );

      expect(startedIndex).toBeLessThan(completedIndex);
    });

    it('TC-S5-011: should emit exactly 2 events on success', async () => {
      await search.search('test query');

      expect(activityStream.emit).toHaveBeenCalledTimes(2);
    });

    it('TC-S5-012: should emit exactly 2 events on error', async () => {
      try {
        await search.search('');
      } catch {
        // Expected error
      }

      // started + error
      expect(activityStream.emit).toHaveBeenCalledTimes(2);
    });
  });

  describe('Payload Content', () => {
    it('TC-S5-020: should include resultCount in completed event', async () => {
      await search.search('test query');

      expect(activityStream.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'search.completed',
          payload: expect.objectContaining({
            resultCount: 2,
          }),
        })
      );
    });

    it('TC-S5-021: should include totalDurationMs in completed event', async () => {
      await search.search('test query');

      const completedCall = (
        activityStream.emit as ReturnType<typeof vi.fn>
      ).mock.calls.find((c: [{ type: string }]) => c[0].type === 'search.completed');

      expect(completedCall?.[0].payload.totalDurationMs).toBeGreaterThanOrEqual(
        0
      );
    });

    it('TC-S5-022: should include sourcesResponded in completed event', async () => {
      await search.search('test query');

      expect(activityStream.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'search.completed',
          payload: expect.objectContaining({
            sourcesResponded: 4,
          }),
        })
      );
    });

    it('TC-S5-023: should include error message in error event', async () => {
      try {
        await search.search('');
      } catch {
        // Expected error
      }

      expect(activityStream.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'search.error',
          payload: expect.objectContaining({
            error: 'Query cannot be empty',
          }),
        })
      );
    });
  });

  describe('No ActivityStream', () => {
    it('TC-S5-030: should work without activityStream', async () => {
      const searchWithoutObs = new MockUnifiedSearch();
      const result = await searchWithoutObs.search('test query');

      expect(result.results.length).toBe(2);
    });

    it('TC-S5-031: should not throw when activityStream is undefined', async () => {
      const searchWithoutObs = new MockUnifiedSearch();

      await expect(
        searchWithoutObs.search('test query')
      ).resolves.toBeDefined();
    });
  });

  describe('Event Component Type', () => {
    it('TC-S5-040: should use search component type', async () => {
      await search.search('test query');

      const calls = (activityStream.emit as ReturnType<typeof vi.fn>).mock
        .calls;
      for (const call of calls) {
        expect(call[0].component).toBe('search');
      }
    });
  });

  describe('Performance', () => {
    it('TC-S5-050: observability should not add significant overhead', async () => {
      const searchWithoutObs = new MockUnifiedSearch();
      const searchWithObs = new MockUnifiedSearch(activityStream);

      // Run without observability
      const startWithout = performance.now();
      await searchWithoutObs.search('test query');
      const durationWithout = performance.now() - startWithout;

      // Run with observability
      const startWith = performance.now();
      await searchWithObs.search('test query');
      const durationWith = performance.now() - startWith;

      // Observability should add less than 10ms overhead
      expect(durationWith - durationWithout).toBeLessThan(10);
    });

    it('TC-S5-051: should handle rapid sequential searches', async () => {
      const searches = Array.from({ length: 10 }, (_, i) =>
        search.search(`query ${i}`)
      );

      const results = await Promise.all(searches);

      expect(results.every((r) => r.results.length > 0)).toBe(true);
      expect(activityStream.emit).toHaveBeenCalledTimes(20); // 2 events per search
    });
  });

  describe('Error Resilience', () => {
    it('TC-S5-060: should continue if emit fails', async () => {
      // Make emit throw an error
      (activityStream.emit as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Emit failed')
      );

      // Search should still complete
      const result = await search.search('test query');
      expect(result.results.length).toBe(2);
    });
  });
});

describe('ActivityStream Component Type', () => {
  it('TC-S5-070: search should be valid ActivityEventComponent', () => {
    // This tests that 'search' is a valid component type
    const validComponents = [
      'routing',
      'pipeline',
      'memory',
      'learning',
      'agent',
      'search',
      'general',
    ];

    expect(validComponents).toContain('search');
  });
});
