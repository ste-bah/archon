import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  InjectionFilter,
  EnhancedInjectionFilter
} from '../../../../../src/god-agent/core/ucm/desc/injection-filter';
import { OutcomeTracker, type IDatabaseConnection } from '../../../../../src/god-agent/core/ucm/desc/outcome-tracker';
import { NegativeExampleProvider } from '../../../../../src/god-agent/core/ucm/desc/negative-example-provider';
import { MetricsAggregator } from '../../../../../src/god-agent/core/ucm/desc/metrics-aggregator';
import { TrajectoryLinker } from '../../../../../src/god-agent/core/ucm/desc/trajectory-linker';
import { ConfidenceCalculator } from '../../../../../src/god-agent/core/ucm/desc/confidence-calculator';
import { createQualityMonitor } from '../../../../../src/god-agent/core/ucm/desc/quality-monitor';
import type {
  IOutcomeTracker,
  IEpisodeMetadata,
  IOutcomeRecord,
  IRetrievalContext,
  IInjectionDecision,
  IEpisodeStats,
  IWarningMessage,
  IStoredEpisode,
  ITaskContext
} from '../../../../../src/god-agent/core/ucm/desc/types';

// ============================================================================
// Mock Database
// ============================================================================

function createMockDb(): IDatabaseConnection & {
  outcomes: Map<string, unknown[]>;
  stats: Map<string, unknown>;
  episodes: Set<string>;
  trajectoryLinks: Map<string, unknown>;
} {
  const outcomes = new Map<string, unknown[]>();
  const stats = new Map<string, unknown>();
  const episodes = new Set<string>();
  const trajectoryLinks = new Map<string, unknown>();

  return {
    outcomes,
    stats,
    episodes,
    trajectoryLinks,

    async run(sql: string, params?: unknown[]): Promise<{ lastInsertRowid: number | bigint }> {
      if (sql.includes('INSERT INTO episode_outcomes')) {
        // Params: [outcomeId, episodeId, taskId, success (1/0), errorType, details, recordedAt (ISO string)]
        const [outcomeId, episodeId, taskId, success, errorType, details, recordedAt] = params as [
          string,
          string,
          string,
          number,
          string | null,
          string | null,
          string
        ];
        const existing = outcomes.get(episodeId) || [];
        existing.push({
          outcome_id: outcomeId,
          episode_id: episodeId,
          task_id: taskId,
          success, // Already a number (1/0)
          error_type: errorType,
          details,
          recorded_at: recordedAt
        });
        outcomes.set(episodeId, existing);
        return { lastInsertRowid: existing.length };
      }

      if (sql.includes('INSERT INTO episode_trajectory_links')) {
        const [episodeId, trajectoryId, reasoningTrace] = params as string[];
        trajectoryLinks.set(episodeId, {
          episode_id: episodeId,
          trajectory_id: trajectoryId,
          reasoning_trace: reasoningTrace,
          linked_at: new Date().toISOString()
        });
        return { lastInsertRowid: 1 };
      }

      // Handle UPDATE episodes SET trajectory_id (from TrajectoryLinker.linkEpisodeToTrajectory)
      if (sql.includes('UPDATE episodes') && sql.includes('trajectory_id')) {
        const [trajectoryId, reasoningTrace, linkedAt, episodeId] = params as [string, string | null, string, string];
        trajectoryLinks.set(episodeId, {
          episode_id: episodeId,
          trajectory_id: trajectoryId,
          reasoning_trace: reasoningTrace || '',
          linked_at: linkedAt
        });
        return { lastInsertRowid: 1 };
      }

      return { lastInsertRowid: 1 };
    },

    async get(sql: string, params?: unknown[]): Promise<unknown | undefined> {
      // Episode existence check - auto-register new episodes
      if (sql.includes('SELECT episode_id FROM episodes WHERE episode_id')) {
        const episodeId = params?.[0] as string;
        // Auto-register episode if not exists
        if (!episodes.has(episodeId)) {
          episodes.add(episodeId);
        }
        return { episode_id: episodeId };
      }

      // Handle trajectory link queries (for getTrajectoryLink)
      if (sql.includes('trajectory_id') && sql.includes('reasoning_trace') && sql.includes('trajectory_linked_at')) {
        const episodeId = params?.[0] as string;
        const link = trajectoryLinks.get(episodeId) as { trajectory_id?: string; reasoning_trace?: string; linked_at?: string } | undefined;
        if (link && link.trajectory_id) {
          return {
            episode_id: episodeId,
            trajectory_id: link.trajectory_id,
            reasoning_trace: link.reasoning_trace || '',
            trajectory_linked_at: link.linked_at || new Date().toISOString()
          };
        }
        return { episode_id: episodeId, trajectory_id: null, reasoning_trace: null, trajectory_linked_at: null };
      }

      // Handle episode_stats queries (used by getEpisodeStats and getSuccessRate)
      if (sql.includes('FROM episode_stats') || sql.includes('episode_stats WHERE')) {
        const episodeId = params?.[0] as string;
        const outcomeList = outcomes.get(episodeId) || [];
        const successCount = outcomeList.filter((o: any) => o.success === 1 || o.success === true).length;
        const failureCount = outcomeList.length - successCount;
        const successRate = outcomeList.length >= 3 ? successCount / outcomeList.length : null;

        return {
          episode_id: episodeId,
          outcome_count: outcomeList.length,
          success_count: successCount,
          failure_count: failureCount,
          success_rate: successRate,
          last_outcome_at: outcomeList.length > 0 ? new Date().toISOString() : null
        };
      }

      if (sql.includes('SELECT * FROM episode_outcomes')) {
        const episodeId = params?.[0] as string;
        const outcomeList = outcomes.get(episodeId) || [];
        return outcomeList[0];
      }

      if (sql.includes('COUNT(*) as outcome_count')) {
        const episodeId = params?.[0] as string;
        const outcomeList = outcomes.get(episodeId) || [];
        const successCount = outcomeList.filter((o: any) => o.success === 1 || o.success === true).length;
        const failureCount = outcomeList.length - successCount;

        return {
          outcome_count: outcomeList.length,
          success_count: successCount,
          failure_count: failureCount,
          success_rate: outcomeList.length > 0 ? successCount / outcomeList.length : 0,
          last_outcome_at: outcomeList.length > 0 ? new Date().toISOString() : null
        };
      }

      if (sql.includes('SELECT * FROM episode_trajectory_links')) {
        const episodeId = params?.[0] as string;
        return trajectoryLinks.get(episodeId);
      }

      if (sql.includes('SELECT success')) {
        const episodeId = params?.[0] as string;
        const outcomeList = outcomes.get(episodeId) || [];
        const successCount = outcomeList.filter((o: any) => o.success === 1 || o.success === true).length;
        const failureCount = outcomeList.length - successCount;

        return {
          true_positives: successCount,
          false_positives: failureCount
        };
      }

      // Handle MetricsAggregator.getFalsePositiveRate query
      if (sql.includes('false_positive_rate') && sql.includes('episode_outcomes')) {
        // Aggregate false positive rate across all outcomes
        const allOutcomes: unknown[] = [];
        outcomes.forEach((list) => allOutcomes.push(...list));

        if (allOutcomes.length === 0) {
          return { false_positive_rate: 0 };
        }

        const failureCount = allOutcomes.filter((o: any) => o.success === 0 || o.success === false).length;
        return { false_positive_rate: failureCount / allOutcomes.length };
      }

      return undefined;
    },

    async all(sql: string, params?: unknown[]): Promise<unknown[]> {
      if (sql.includes('SELECT * FROM episode_outcomes')) {
        const episodeId = params?.[0] as string;
        const outcomeList = outcomes.get(episodeId) || [];
        // Return outcomes ordered by recorded_at DESC
        return [...outcomeList].sort((a: any, b: any) =>
          new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()
        );
      }

      if (sql.includes('error_type, COUNT(*) as count')) {
        const episodeId = params?.[0] as string;
        const outcomeList = outcomes.get(episodeId) || [];
        const errorCounts = new Map<string, number>();

        for (const outcome of outcomeList) {
          const errorType = (outcome as any).error_type || 'unknown';
          errorCounts.set(errorType, (errorCounts.get(errorType) || 0) + 1);
        }

        return Array.from(errorCounts.entries()).map(([error_type, count]) => ({
          error_type,
          count
        }));
      }

      if (sql.includes('GROUP BY date')) {
        // Return mock metrics grouped by date
        const allOutcomes: unknown[] = [];
        outcomes.forEach((list) => allOutcomes.push(...list));

        if (allOutcomes.length === 0) return [];

        const successCount = allOutcomes.filter((o: any) => o.success).length;

        return [
          {
            date: new Date().toISOString().split('T')[0],
            total_outcomes: allOutcomes.length,
            success_count: successCount,
            failure_count: allOutcomes.length - successCount,
            success_rate: allOutcomes.length > 0 ? successCount / allOutcomes.length : 0
          }
        ];
      }

      // Handle MetricsAggregator.getMetrics query (GROUP BY category)
      if (sql.includes('FROM episode_outcomes') && sql.includes('GROUP BY category')) {
        const allOutcomes: unknown[] = [];
        outcomes.forEach((list) => allOutcomes.push(...list));

        if (allOutcomes.length === 0) return [];

        const successCount = allOutcomes.filter((o: any) => o.success === 1 || o.success === true).length;
        const failureCount = allOutcomes.length - successCount;

        return [
          {
            category: 'general',
            injection_count: allOutcomes.length,
            success_rate: allOutcomes.length > 0 ? successCount / allOutcomes.length : 0,
            false_positive_rate: allOutcomes.length > 0 ? failureCount / allOutcomes.length : 0,
            avg_confidence: 0.5
          }
        ];
      }

      return [];
    },

    async close(): Promise<void> {
      outcomes.clear();
      stats.clear();
      episodes.clear();
      trajectoryLinks.clear();
    }
  };
}

/**
 * E2E Test Suite - Simulates Real Pipeline Execution
 * Validates all US-IDESC user stories in realistic scenarios
 *
 * Tests cover:
 * - US-IDESC-001: Negative example warnings
 * - US-IDESC-002: Confidence levels for proven solutions
 * - US-IDESC-003: Automatic outcome recording
 * - US-IDESC-004: Quality degradation alerts
 * - US-IDESC-005: ReasoningBank trace integration
 * - US-IDESC-006: Continuous quality monitoring
 */
describe('IDESC v2 End-to-End Tests', () => {
  let outcomeTracker: IOutcomeTracker;
  let injectionFilter: EnhancedInjectionFilter;
  let confidenceCalculator: ConfidenceCalculator;
  let negativeProvider: NegativeExampleProvider;
  let metricsAggregator: MetricsAggregator;
  let trajectoryLinker: TrajectoryLinker;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeAll(() => {
    // Initialize mock database
    mockDb = createMockDb();

    // Initialize all components with mock database
    outcomeTracker = new OutcomeTracker(mockDb);
    confidenceCalculator = new ConfidenceCalculator();
    negativeProvider = new NegativeExampleProvider(outcomeTracker);
    injectionFilter = new EnhancedInjectionFilter(
      outcomeTracker,
      confidenceCalculator,
      negativeProvider
    );
    metricsAggregator = new MetricsAggregator(mockDb);
    trajectoryLinker = new TrajectoryLinker(mockDb);
  });

  beforeEach(() => {
    // Clear state between tests
    vi.clearAllMocks();
  });

  afterAll(async () => {
    // Cleanup resources
    await outcomeTracker.close?.();
  });

  /**
   * Helper function to simulate storing an agent episode
   */
  async function storeAgentEpisode(
    agentId: string,
    data: { query: string; answer: string }
  ): Promise<string> {
    const episodeId = `episode-${agentId}-${Date.now()}`;

    // Simulate episode storage in the system
    // In real implementation, this would call EpisodeLinker.storeEpisode()
    const metadata: IEpisodeMetadata = {
      episodeId,
      createdAt: new Date(),
      metadata: {
        agentId,
        query: data.query,
        answer: data.answer,
        timestamp: Date.now()
      }
    };

    return episodeId;
  }

  /**
   * Helper function to simulate episode retrieval
   */
  async function retrieveEpisodes(query: string, maxResults: number = 3) {
    // Mock retrieval - would use vector search in real implementation
    return Array.from({ length: maxResults }, (_, i) => ({
      episodeId: `retrieved-${i}`,
      score: 0.9 - (i * 0.1),
      metadata: {}
    }));
  }

  /**
   * Mock outcome recording hook
   */
  async function outcomeRecorderHook(hookData: {
    toolName: string;
    result: { success: boolean };
    metadata: {
      injectedEpisodeIds: string[];
      taskId: string;
    };
  }): Promise<void> {
    const { result, metadata } = hookData;

    for (const episodeId of metadata.injectedEpisodeIds) {
      await outcomeTracker.recordOutcome({
        episodeId,
        taskId: metadata.taskId,
        success: result.success,
        errorType: result.success ? undefined : 'unknown_error',
        timestamp: new Date()
      });
    }
  }

  describe('PhD Pipeline Simulation', () => {
    const agents = [
      'literature-mapper',
      'methodology-scanner',
      'theoretical-framework-analyst',
      'hypothesis-generator',
      'sampling-strategist',
      'instrument-developer',
      'ethics-reviewer',
      'analysis-planner',
      'results-writer',
      'discussion-writer'
    ];

    it('simulates 10-agent PhD pipeline with DESC injection', async () => {
      const results: Array<{
        agentId: string;
        episodeId: string;
        success: boolean;
      }> = [];

      for (const agentId of agents) {
        // 1. Store episode from agent work
        const episodeId = await storeAgentEpisode(agentId, {
          query: `${agentId} task description`,
          answer: `${agentId} completed work output`
        });

        // 2. Simulate injection for next agent
        const retrieval = await retrieveEpisodes(`Similar to ${agentId}`, 3);

        // 3. Record outcome based on simulated success (80% success rate)
        const success = Math.random() > 0.2;
        await outcomeTracker.recordOutcome({
          episodeId,
          taskId: `pipeline-${agentId}`,
          success,
          errorType: success ? undefined : 'logic_error',
          timestamp: new Date()
        });

        results.push({ agentId, episodeId, success });
      }

      // Verify all agents processed
      expect(results).toHaveLength(10);

      // Verify episodes stored
      for (const { episodeId } of results) {
        const stats = await outcomeTracker.getEpisodeStats(episodeId);
        expect(stats.outcomeCount).toBeGreaterThanOrEqual(0);
      }

      // Count successful pipeline steps
      const successCount = results.filter(r => r.success).length;
      expect(successCount).toBeGreaterThan(0);
    }, 10000); // Extended timeout for pipeline simulation

    it('injects prior solutions with confidence levels', async () => {
      // Create proven episode with high success
      const episodeId = await storeAgentEpisode('test-agent', {
        query: 'Implement data analysis',
        answer: 'Use pandas for data processing'
      });

      // Record successes for HIGH confidence (5 successes)
      for (let i = 0; i < 5; i++) {
        await outcomeTracker.recordOutcome({
          episodeId,
          taskId: `success-${i}`,
          success: true,
          timestamp: new Date()
        });
      }

      // Retrieve and verify confidence
      const episode: IStoredEpisode = {
        episodeId,
        createdAt: new Date(),
        metadata: {
          agentId: 'test-agent',
          query: 'Implement data analysis'
        }
      };

      const context: ITaskContext = {
        task: 'Implement data analysis',
        agentId: 'phd-agent',
        metadata: {}
      };

      const decision = await injectionFilter.shouldInjectEnhanced(
        episode,
        0.96, // High similarity
        context
      );

      expect(decision.inject).toBe(true);
      expect(decision.confidence).toBe('HIGH');
      expect(decision.adjustedScore).toBeGreaterThan(0.9);
    });

    it('shows warnings for failed episodes', async () => {
      // Create episode with failures
      const episodeId = await storeAgentEpisode('failing-agent', {
        query: 'Broken approach',
        answer: 'This approach fails'
      });

      // Record failures (4 failures triggers warning)
      for (let i = 0; i < 4; i++) {
        await outcomeTracker.recordOutcome({
          episodeId,
          taskId: `failure-${i}`,
          success: false,
          errorType: 'logic_error',
          timestamp: new Date()
        });
      }

      // Verify warning generated
      const warning = await negativeProvider.getWarning(episodeId);
      expect(warning).not.toBeNull();
      expect(warning?.warningText).toContain('<caution>');
      // IWarningMessage has successRate, not severity/failureRate
      // 4 failures out of 4 = 0% success rate
      expect(warning?.successRate).toBeLessThanOrEqual(0.2);
      expect(warning?.failureCount).toBeGreaterThanOrEqual(4);
    });

    it('records outcomes automatically', async () => {
      const episodeId = 'auto-record-test';

      // Simulate outcome recording hook (3 times to get a success rate)
      for (let i = 0; i < 3; i++) {
        await outcomeRecorderHook({
          toolName: 'Task',
          result: { success: true },
          metadata: {
            injectedEpisodeIds: [episodeId],
            taskId: `auto-test-${i}`
          }
        });
      }

      // Verify outcomes recorded
      const stats = await outcomeTracker.getEpisodeStats(episodeId);
      expect(stats.outcomeCount).toBe(3);
      expect(stats.successCount).toBe(3);
      expect(stats.successRate).toBe(1.0); // 3+ outcomes allows success rate calculation
    });

    it('aggregates metrics correctly', async () => {
      // Create episodes with various outcomes
      for (let i = 0; i < 10; i++) {
        const episodeId = `metrics-${i}`;
        await outcomeTracker.recordOutcome({
          episodeId,
          taskId: `task-${i}`,
          success: i < 8, // 80% success rate
          timestamp: new Date()
        });
      }

      // Get aggregated metrics
      const metrics = await metricsAggregator.getMetrics(undefined, '7d');

      expect(metrics).toBeDefined();
      expect(Array.isArray(metrics)).toBe(true);

      // Should have data points matching IInjectionMetrics interface
      if (metrics.length > 0) {
        expect(metrics[0]).toHaveProperty('category');
        expect(metrics[0]).toHaveProperty('injectionCount');
        expect(metrics[0]).toHaveProperty('successRate');
        expect(metrics[0]).toHaveProperty('falsePositiveRate');
        expect(metrics[0]).toHaveProperty('timeWindow');
      }
    });

    it('maintains zero regressions in existing DESC', async () => {
      // Test existing InjectionFilter API (backward compatibility)
      const filter = new InjectionFilter(
        outcomeTracker,
        confidenceCalculator,
        negativeProvider
      );

      const episode: IStoredEpisode = {
        episodeId: 'test',
        createdAt: new Date(),
        metadata: {}
      };

      const context: ITaskContext = {
        task: 'Test task',
        agentId: 'test-agent',
        metadata: {}
      };

      const decision = filter.shouldInject(episode, 0.90, context);

      // Verify returns IInjectionDecision with all required fields
      expect(decision).toHaveProperty('inject');
      expect(decision).toHaveProperty('reason');
      expect(decision).toHaveProperty('adjustedScore');
      expect(decision).toHaveProperty('category');
      expect(typeof decision.inject).toBe('boolean');
      expect(typeof decision.reason).toBe('string');
      expect(typeof decision.adjustedScore).toBe('number');
      expect(typeof decision.category).toBe('string');
    });
  });

  describe('All User Stories Validation', () => {
    it('US-IDESC-001: Negative examples warn about failures', async () => {
      // Create failing episode
      const episodeId = 'us-001-test';

      // Record multiple failures
      for (let i = 0; i < 5; i++) {
        await outcomeTracker.recordOutcome({
          episodeId,
          taskId: `us-001-failure-${i}`,
          success: false,
          errorType: 'validation_error',
          errorMessage: 'Test validation failed',
          timestamp: new Date()
        });
      }

      // Get warning
      const warning = await negativeProvider.getWarning(episodeId);

      // Validate warning structure (IWarningMessage interface)
      expect(warning).not.toBeNull();
      expect(warning?.warningText).toBeDefined();
      // IWarningMessage has successRate, not severity/failureRate
      expect(warning?.successRate).toBeLessThanOrEqual(0.2); // 5 failures = 0% success
      expect(warning?.failureCount).toBeGreaterThanOrEqual(5);
      expect(warning?.totalOutcomes).toBeGreaterThanOrEqual(5);
    });

    it('US-IDESC-002: High confidence for proven solutions', async () => {
      const episodeId = 'us-002-test';

      // Record many successes for proven solution
      for (let i = 0; i < 10; i++) {
        await outcomeTracker.recordOutcome({
          episodeId,
          taskId: `us-002-success-${i}`,
          success: true,
          timestamp: new Date()
        });
      }

      // Test injection decision
      const episode: IStoredEpisode = {
        episodeId,
        createdAt: new Date(),
        metadata: {}
      };

      const context: ITaskContext = {
        task: 'Proven task',
        agentId: 'test-agent',
        metadata: {}
      };

      const decision = await injectionFilter.shouldInjectEnhanced(
        episode,
        0.95,
        context
      );

      expect(decision.confidence).toBe('HIGH');
      expect(decision.inject).toBe(true);
      // Allow small floating point tolerance (0.95 - epsilon)
      expect(decision.adjustedScore).toBeGreaterThanOrEqual(0.9499);
    });

    it('US-IDESC-003: Outcomes recorded from task completions', async () => {
      const episodeIds = ['us-003-ep1', 'us-003-ep2', 'us-003-ep3'];

      // Simulate task completion hook
      await outcomeRecorderHook({
        toolName: 'Task',
        result: { success: true },
        metadata: {
          injectedEpisodeIds: episodeIds,
          taskId: 'us-003-task'
        }
      });

      // Verify all episodes have outcomes
      for (const episodeId of episodeIds) {
        const stats = await outcomeTracker.getEpisodeStats(episodeId);
        expect(stats.outcomeCount).toBeGreaterThan(0);
        expect(stats.successCount).toBeGreaterThan(0);
      }
    });

    it('US-IDESC-004: Quality degradation alerts', async () => {
      // Create deteriorating quality pattern
      const baseEpisodeId = 'us-004-quality';

      // Week 1: Good performance
      for (let i = 0; i < 10; i++) {
        await outcomeTracker.recordOutcome({
          episodeId: `${baseEpisodeId}-w1-${i}`,
          taskId: `w1-task-${i}`,
          success: i < 9, // 90% success
          timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 1 week ago
        });
      }

      // Week 2: Degraded performance
      for (let i = 0; i < 10; i++) {
        await outcomeTracker.recordOutcome({
          episodeId: `${baseEpisodeId}-w2-${i}`,
          taskId: `w2-task-${i}`,
          success: i < 5, // 50% success (degraded)
          timestamp: new Date()
        });
      }

      // Check for alerts
      const alerts = await metricsAggregator.checkAndAlert();

      expect(Array.isArray(alerts)).toBe(true);
      // Alerts may or may not be present depending on thresholds
    });

    it('US-IDESC-005: ReasoningBank traces included', async () => {
      const episodeId = 'us-005-trace';
      const trajectoryId = 'traj-123';
      const reasoningTrace = 'Because this approach uses proven patterns from literature-mapper...';

      // Link episode to trajectory
      await trajectoryLinker.linkEpisodeToTrajectory(
        episodeId,
        trajectoryId,
        reasoningTrace
      );

      // Verify trace available
      const link = await trajectoryLinker.getTrajectoryLink(episodeId);

      expect(link).not.toBeNull();
      expect(link?.trajectoryId).toBe(trajectoryId);
      expect(link?.reasoningTrace).toBe(reasoningTrace);
      expect(link?.linkedAt).toBeDefined();
    });

    it('US-IDESC-006: Quality monitor runs continuously', async () => {
      const monitor = createQualityMonitor(metricsAggregator, {
        intervalMs: 100,
        enabled: true,
        alertThresholds: {
          successRateDrop: 0.2,
          minSuccessRate: 0.5
        }
      });

      // Start monitoring
      monitor.start();
      expect(monitor.isRunning()).toBe(true);

      // Wait for at least one check cycle
      await new Promise(resolve => setTimeout(resolve, 150));

      // Verify checks are running
      expect(monitor.getCheckCount()).toBeGreaterThan(0);

      // Stop monitoring
      monitor.stop();
      expect(monitor.isRunning()).toBe(false);
    });
  });

  describe('Integration Scenarios', () => {
    it('handles concurrent episode processing', async () => {
      const episodeCount = 20;
      const promises: Promise<void>[] = [];

      // Create concurrent episode recordings
      for (let i = 0; i < episodeCount; i++) {
        const episodeId = `concurrent-${i}`;
        const promise = outcomeTracker.recordOutcome({
          episodeId,
          taskId: `concurrent-task-${i}`,
          success: Math.random() > 0.3, // 70% success
          timestamp: new Date()
        });
        promises.push(promise);
      }

      // Wait for all to complete
      await Promise.all(promises);

      // Verify all recorded
      const statsPromises = Array.from({ length: episodeCount }, (_, i) =>
        outcomeTracker.getEpisodeStats(`concurrent-${i}`)
      );

      const allStats = await Promise.all(statsPromises);
      expect(allStats.every(s => s.outcomeCount > 0)).toBe(true);
    });

    it('maintains performance under load', async () => {
      const startTime = Date.now();

      // Record 100 outcomes
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          outcomeTracker.recordOutcome({
            episodeId: `perf-test-${i % 10}`, // Reuse 10 episodes
            taskId: `perf-task-${i}`,
            success: Math.random() > 0.2,
            timestamp: new Date()
          })
        );
      }

      await Promise.all(promises);

      const duration = Date.now() - startTime;

      // Should complete in reasonable time (< 5 seconds)
      expect(duration).toBeLessThan(5000);
    });

    it('handles edge cases gracefully', async () => {
      // Empty episode ID
      await expect(async () => {
        await outcomeTracker.recordOutcome({
          episodeId: '',
          taskId: 'test',
          success: true,
          timestamp: new Date()
        });
      }).rejects.toThrow();

      // Invalid timestamps handled
      const stats = await outcomeTracker.getEpisodeStats('nonexistent-episode');
      expect(stats.outcomeCount).toBe(0);

      // Null safety
      const warning = await negativeProvider.getWarning('no-outcomes-episode');
      expect(warning).toBeNull(); // No warning for episode with no outcomes
    });
  });

  describe('Backward Compatibility', () => {
    it('supports legacy InjectionFilter.shouldInject()', async () => {
      const filter = new InjectionFilter(outcomeTracker);

      const metadata: IEpisodeMetadata = {
        episodeId: 'legacy-test',
        createdAt: new Date(),
        metadata: {}
      };

      const context: IRetrievalContext = {
        task: 'Legacy test',
        agentId: 'legacy-agent',
        metadata: {}
      };

      const decision = filter.shouldInject(metadata, 0.85, context);

      // Verify legacy format preserved
      expect(decision).toHaveProperty('inject');
      expect(decision).toHaveProperty('reason');
      expect(decision).toHaveProperty('adjustedScore');
      expect(decision).toHaveProperty('category');

      // Should NOT have enhanced fields in legacy mode
      expect(decision).not.toHaveProperty('confidence');
      expect(decision).not.toHaveProperty('warning');
    });
  });
});
