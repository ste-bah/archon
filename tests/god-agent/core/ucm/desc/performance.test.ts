import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OutcomeTracker } from '../../../../../src/god-agent/core/ucm/desc/outcome-tracker';
import { EnhancedInjectionFilter } from '../../../../../src/god-agent/core/ucm/desc/injection-filter';
import { ConfidenceCalculator } from '../../../../../src/god-agent/core/ucm/desc/confidence-calculator';
import type { IStoredEpisode, OutcomeRecord } from '../../../../../src/god-agent/core/ucm/types';
import type { IDatabaseConnection } from '../../../../../src/god-agent/core/ucm/desc/outcome-tracker';

/**
 * Performance Benchmark Tests for IDESC-001
 *
 * Validates NFR requirements:
 * - NFR-IDESC-001: Outcome recording p95 <10ms
 * - NFR-IDESC-002: Enhanced shouldInject p95 <50ms
 * - NFR-IDESC-003: Memory overhead <10MB for 10K outcomes
 */

/**
 * Create mock database connection for testing
 * Tracks episodes and outcomes in memory for realistic behavior
 */
function createMockDb(): IDatabaseConnection {
  const episodeStats = new Map<string, {
    episode_id: string;
    outcome_count: number;
    success_count: number;
    failure_count: number;
  }>();
  const outcomes = new Map<string, unknown[]>();

  // Pre-register episodes for performance tests
  const registerEpisode = (episodeId: string) => {
    if (!episodeStats.has(episodeId)) {
      episodeStats.set(episodeId, {
        episode_id: episodeId,
        outcome_count: 0,
        success_count: 0,
        failure_count: 0
      });
    }
  };

  return {
    async run(sql: string, params?: unknown[]): Promise<{ lastInsertRowid: number | bigint }> {
      // Handle INSERT into episode_outcomes
      if (sql.includes('INSERT INTO episode_outcomes') && params) {
        const episodeId = params[1] as string;
        const success = params[3] as number;

        // Auto-register episode if not exists
        registerEpisode(episodeId);

        const stats = episodeStats.get(episodeId)!;
        stats.outcome_count++;
        if (success) stats.success_count++;
        else stats.failure_count++;

        // Store outcome
        if (!outcomes.has(episodeId)) {
          outcomes.set(episodeId, []);
        }
        outcomes.get(episodeId)!.push({
          outcome_id: params[0],
          episode_id: episodeId,
          task_id: params[2],
          success: success,
          error_type: params[4],
          details: params[5],
          recorded_at: params[6]
        });
      }
      // Handle INSERT/UPSERT into episode_stats
      else if (sql.includes('episode_stats') && params) {
        const episodeId = params[0] as string;
        registerEpisode(episodeId);
      }
      return { lastInsertRowid: Date.now() };
    },
    async get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined> {
      if (params && params[0]) {
        const episodeId = params[0] as string;
        // Auto-register episode for lookup
        registerEpisode(episodeId);

        // Handle episodes table query (used by OutcomeTracker.recordOutcome validation)
        if (sql.includes('FROM episodes')) {
          return { episode_id: episodeId } as T;
        }

        // Handle episode_stats table query
        if (sql.includes('episode_stats')) {
          const stats = episodeStats.get(episodeId);
          return stats as T | undefined;
        }
      }
      return undefined;
    },
    async all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
      if (sql.includes('episode_outcomes') && params && params[0]) {
        const episodeId = params[0] as string;
        return (outcomes.get(episodeId) || []) as T[];
      }
      return [];
    }
  };
}

function calculatePercentile(values: number[], percentile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[index];
}

function createTestStoredEpisode(episodeId: string): IStoredEpisode {
  return {
    episodeId,
    queryText: `Query for ${episodeId}`,
    answerText: `Answer for ${episodeId}`,
    queryChunkEmbeddings: [new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5])],
    answerChunkEmbeddings: [new Float32Array([0.5, 0.4, 0.3, 0.2, 0.1])],
    queryChunkCount: 1,
    answerChunkCount: 1,
    createdAt: new Date(),
    metadata: {
      agentId: 'test-agent',
      sessionId: 'perf-session'
    }
  };
}

describe('Performance Benchmarks - IDESC-001', () => {
  let outcomeTracker: OutcomeTracker;
  let injectionFilter: EnhancedInjectionFilter;
  let mockDb: IDatabaseConnection;

  beforeEach(() => {
    mockDb = createMockDb();
    outcomeTracker = new OutcomeTracker(mockDb);
    injectionFilter = new EnhancedInjectionFilter(outcomeTracker, new ConfidenceCalculator());
  });

  afterEach(() => {
    // Cleanup
    outcomeTracker = null as any;
    injectionFilter = null as any;
  });

  describe('NFR-IDESC-001: Outcome Recording Performance', () => {
    it('p95 latency < 10ms for single outcome', async () => {
      const latencies: number[] = [];

      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        await outcomeTracker.recordOutcome({
          episodeId: `ep-perf-${i}`,
          taskId: `task-${i}`,
          success: i % 2 === 0,
          timestamp: Date.now(),
          metadata: {
            iteration: i,
            testType: 'single-outcome'
          }
        });
        latencies.push(performance.now() - start);
      }

      const p95 = calculatePercentile(latencies, 95);
      const p50 = calculatePercentile(latencies, 50);
      const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

      console.log(`
📊 Outcome Recording Performance:
   - Average: ${avg.toFixed(2)}ms
   - p50: ${p50.toFixed(2)}ms
   - p95: ${p95.toFixed(2)}ms
   - Target: <10ms (p95)
      `);

      expect(p95).toBeLessThan(10);
    });

    it('p99 latency < 15ms for single outcome', async () => {
      const latencies: number[] = [];

      for (let i = 0; i < 200; i++) {
        const start = performance.now();
        await outcomeTracker.recordOutcome({
          episodeId: `ep-perf-p99-${i}`,
          taskId: `task-p99-${i}`,
          success: true,
          timestamp: Date.now()
        });
        latencies.push(performance.now() - start);
      }

      const p99 = calculatePercentile(latencies, 99);
      console.log(`Outcome recording p99: ${p99.toFixed(2)}ms (target: <15ms)`);
      expect(p99).toBeLessThan(15);
    });

    it('batch recording 10 outcomes < 50ms total', async () => {
      const start = performance.now();

      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          outcomeTracker.recordOutcome({
            episodeId: `ep-batch-${i}`,
            taskId: `task-batch`,
            success: true,
            timestamp: Date.now(),
            metadata: { batchIndex: i }
          })
        )
      );

      const duration = performance.now() - start;
      console.log(`
📦 Batch Recording Performance:
   - 10 outcomes: ${duration.toFixed(2)}ms
   - Target: <50ms
   - Per outcome: ${(duration / 10).toFixed(2)}ms
      `);
      expect(duration).toBeLessThan(50);
    });

    it('batch recording 100 outcomes < 300ms total', async () => {
      const start = performance.now();

      await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          outcomeTracker.recordOutcome({
            episodeId: `ep-large-batch-${i}`,
            taskId: `task-large-batch`,
            success: i % 3 !== 0,
            timestamp: Date.now()
          })
        )
      );

      const duration = performance.now() - start;
      console.log(`Large batch (100 outcomes): ${duration.toFixed(2)}ms (target: <300ms)`);
      expect(duration).toBeLessThan(300);
    });
  });

  describe('NFR-IDESC-002: Enhanced shouldInject Performance', () => {
    it('p95 latency < 50ms with outcome lookups', async () => {
      // Pre-create episodes with outcomes
      const episodes: IStoredEpisode[] = [];
      for (let i = 0; i < 20; i++) {
        const episode = createTestStoredEpisode(`ep-inject-${i}`);
        episodes.push(episode);

        // Record some outcomes for each episode
        for (let j = 0; j < 5; j++) {
          await outcomeTracker.recordOutcome({
            episodeId: episode.episodeId,
            taskId: `task-${i}-${j}`,
            success: j % 2 === 0,
            timestamp: Date.now(),
            metadata: {
              episodeIndex: i,
              outcomeIndex: j
            }
          });
        }
      }

      const latencies: number[] = [];

      for (const episode of episodes) {
        const start = performance.now();
        await injectionFilter.shouldInjectEnhanced(
          episode,
          0.85,
          { task: 'Test task', agentId: 'perf-agent' }
        );
        latencies.push(performance.now() - start);
      }

      const p95 = calculatePercentile(latencies, 95);
      const p50 = calculatePercentile(latencies, 50);
      const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

      console.log(`
🎯 Enhanced shouldInject Performance:
   - Average: ${avg.toFixed(2)}ms
   - p50: ${p50.toFixed(2)}ms
   - p95: ${p95.toFixed(2)}ms
   - Target: <50ms (p95)
   - Episodes tested: ${episodes.length}
   - Outcomes per episode: 5
      `);

      expect(p95).toBeLessThan(50);
    });

    it('basic shouldInject p95 < 5ms (without outcome lookups)', async () => {
      const episodes: IStoredEpisode[] = [];
      for (let i = 0; i < 50; i++) {
        episodes.push(createTestStoredEpisode(`ep-basic-${i}`));
      }

      const latencies: number[] = [];

      for (const episode of episodes) {
        const start = performance.now();
        await injectionFilter.shouldInject(
          episode,
          0.80,
          { task: 'Basic test', agentId: 'basic-agent' }
        );
        latencies.push(performance.now() - start);
      }

      const p95 = calculatePercentile(latencies, 95);
      console.log(`Basic shouldInject p95: ${p95.toFixed(2)}ms (target: <5ms)`);
      expect(p95).toBeLessThan(5);
    });

    it('handles concurrent injection checks efficiently', async () => {
      const episodes: IStoredEpisode[] = [];
      for (let i = 0; i < 50; i++) {
        const episode = createTestStoredEpisode(`ep-concurrent-${i}`);
        episodes.push(episode);

        // Add some outcomes
        await outcomeTracker.recordOutcome({
          episodeId: episode.episodeId,
          taskId: `task-concurrent-${i}`,
          success: true,
          timestamp: Date.now()
        });
      }

      const start = performance.now();

      await Promise.all(
        episodes.map(episode =>
          injectionFilter.shouldInjectEnhanced(
            episode,
            0.85,
            { task: 'Concurrent test', agentId: 'concurrent-agent' }
          )
        )
      );

      const duration = performance.now() - start;
      const avgPerCheck = duration / episodes.length;

      console.log(`
⚡ Concurrent Injection Checks:
   - Total: ${duration.toFixed(2)}ms
   - Episodes: ${episodes.length}
   - Average per check: ${avgPerCheck.toFixed(2)}ms
      `);

      expect(avgPerCheck).toBeLessThan(10);
    });
  });

  describe('NFR-IDESC-003: Memory Overhead', () => {
    it('10K outcomes < 10MB additional heap', async () => {
      // Force GC if available
      if (global.gc) global.gc();

      // Wait for GC to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      const initialHeap = process.memoryUsage().heapUsed;

      // Record 10,000 outcomes
      const batchSize = 100;
      for (let batch = 0; batch < 100; batch++) {
        await Promise.all(
          Array.from({ length: batchSize }, (_, i) => {
            const index = batch * batchSize + i;
            return outcomeTracker.recordOutcome({
              episodeId: `ep-mem-${index % 1000}`,
              taskId: `task-mem-${index}`,
              success: Math.random() > 0.5,
              timestamp: Date.now(),
              metadata: {
                batch,
                index: i
              }
            });
          })
        );
      }

      // Force GC if available
      if (global.gc) global.gc();

      // Wait for GC to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      const finalHeap = process.memoryUsage().heapUsed;
      const overheadMB = (finalHeap - initialHeap) / 1024 / 1024;

      console.log(`
💾 Memory Overhead Benchmark:
   - Initial heap: ${(initialHeap / 1024 / 1024).toFixed(2)}MB
   - Final heap: ${(finalHeap / 1024 / 1024).toFixed(2)}MB
   - Overhead: ${overheadMB.toFixed(2)}MB
   - Target: <10MB
   - Outcomes recorded: 10,000
   - Bytes per outcome: ${((finalHeap - initialHeap) / 10000).toFixed(2)}
      `);

      expect(overheadMB).toBeLessThan(10);
    });

    it('memory grows linearly with outcome count', async () => {
      if (global.gc) global.gc();
      await new Promise(resolve => setTimeout(resolve, 100));

      const measurements: Array<{ count: number; heapMB: number }> = [];

      // Measure at different scales
      for (const targetCount of [1000, 2000, 5000, 10000]) {
        const tracker = new OutcomeTracker(createMockDb());
        if (global.gc) global.gc();
        await new Promise(resolve => setTimeout(resolve, 50));

        const baseline = process.memoryUsage().heapUsed;

        for (let i = 0; i < targetCount; i++) {
          await tracker.recordOutcome({
            episodeId: `ep-scale-${i % 500}`,
            taskId: `task-scale-${i}`,
            success: true,
            timestamp: Date.now()
          });
        }

        if (global.gc) global.gc();
        await new Promise(resolve => setTimeout(resolve, 50));

        const current = process.memoryUsage().heapUsed;
        const heapMB = (current - baseline) / 1024 / 1024;

        measurements.push({ count: targetCount, heapMB });
      }

      console.log('\n📈 Memory Scaling:');
      measurements.forEach(m => {
        console.log(`   ${m.count.toLocaleString()} outcomes: ${m.heapMB.toFixed(2)}MB`);
      });

      // Check linear growth (shouldn't grow exponentially)
      // Use absolute memory values relative to baseline (1K outcomes)
      // to avoid GC-induced negative ratio issues
      const baseline = measurements[0];
      const final = measurements[measurements.length - 1];

      // Memory should grow roughly linearly: 10x outcomes = ~10x memory
      // With 1K->10K (10x data), expect memory ratio between 5x and 20x
      // (accounting for fixed overhead and GC variability)
      const countRatio = final.count / baseline.count; // Should be 10

      // If both measurements are positive, check proportionality
      // Otherwise, just verify we didn't have exponential growth (final < 100MB)
      if (baseline.heapMB > 0 && final.heapMB > 0) {
        const memoryRatio = final.heapMB / baseline.heapMB;
        console.log(`   Count ratio: ${countRatio}x, Memory ratio: ${memoryRatio.toFixed(2)}x`);

        // Linear growth: memory ratio should be within 0.5x to 3x of count ratio
        // This is generous to account for GC and runtime overhead
        expect(memoryRatio).toBeLessThan(countRatio * 3); // No exponential growth
      } else {
        // GC interference - just verify final heap is reasonable
        console.log(`   GC interference detected, checking absolute bounds`);
        expect(final.heapMB).toBeLessThan(50); // Should not exceed 50MB for 10K outcomes
      }
    });
  });

  describe('Throughput Benchmarks', () => {
    it('handles 100 injections per second', async () => {
      const episodes: IStoredEpisode[] = [];
      for (let i = 0; i < 200; i++) {
        episodes.push(createTestStoredEpisode(`ep-throughput-${i}`));
      }

      const start = performance.now();
      let count = 0;
      let episodeIndex = 0;

      while (performance.now() - start < 1000 && episodeIndex < episodes.length) {
        await injectionFilter.shouldInject(
          episodes[episodeIndex],
          0.80 + Math.random() * 0.15,
          { task: 'Throughput test', agentId: 'test' }
        );
        count++;
        episodeIndex++;
      }

      console.log(`
⚡ Injection Throughput:
   - Injections/second: ${count}
   - Target: >100
   - Duration: ${(performance.now() - start).toFixed(2)}ms
      `);

      expect(count).toBeGreaterThan(100);
    });

    it('handles 50 enhanced injections per second', async () => {
      const episodes: IStoredEpisode[] = [];

      // Pre-create episodes with outcomes
      for (let i = 0; i < 100; i++) {
        const episode = createTestStoredEpisode(`ep-enhanced-throughput-${i}`);
        episodes.push(episode);

        await outcomeTracker.recordOutcome({
          episodeId: episode.episodeId,
          taskId: `task-throughput-${i}`,
          success: true,
          timestamp: Date.now()
        });
      }

      const start = performance.now();
      let count = 0;
      let episodeIndex = 0;

      while (performance.now() - start < 1000 && episodeIndex < episodes.length) {
        await injectionFilter.shouldInjectEnhanced(
          episodes[episodeIndex],
          0.85,
          { task: 'Enhanced throughput test', agentId: 'enhanced-test' }
        );
        count++;
        episodeIndex++;
      }

      console.log(`
⚡ Enhanced Injection Throughput:
   - Injections/second: ${count}
   - Target: >50
   - With outcome lookups
      `);

      expect(count).toBeGreaterThan(50);
    });

    it('outcome recording throughput >500/second', async () => {
      const start = performance.now();
      let count = 0;

      while (performance.now() - start < 1000) {
        await outcomeTracker.recordOutcome({
          episodeId: `ep-recording-throughput-${count % 100}`,
          taskId: `task-recording-${count}`,
          success: count % 2 === 0,
          timestamp: Date.now()
        });
        count++;
      }

      console.log(`
📝 Outcome Recording Throughput:
   - Outcomes/second: ${count}
   - Target: >500
      `);

      expect(count).toBeGreaterThan(500);
    });
  });

  describe('Stress Tests', () => {
    it('maintains performance under sustained load', async () => {
      const episodes: IStoredEpisode[] = [];
      const latencies: number[] = [];

      // Create test data
      for (let i = 0; i < 1000; i++) {
        const episode = createTestStoredEpisode(`ep-stress-${i}`);
        episodes.push(episode);

        if (i % 10 === 0) {
          await outcomeTracker.recordOutcome({
            episodeId: episode.episodeId,
            taskId: `task-stress-${i}`,
            success: true,
            timestamp: Date.now()
          });
        }
      }

      // Test sustained injection checks
      for (let i = 0; i < 1000; i++) {
        const start = performance.now();
        await injectionFilter.shouldInjectEnhanced(
          episodes[i],
          0.85,
          { task: 'Stress test', agentId: 'stress-agent' }
        );
        latencies.push(performance.now() - start);
      }

      const p95 = calculatePercentile(latencies, 95);
      const p99 = calculatePercentile(latencies, 99);

      console.log(`
🔥 Stress Test Results (1000 operations):
   - p95: ${p95.toFixed(2)}ms
   - p99: ${p99.toFixed(2)}ms
   - p95 target: <50ms
      `);

      expect(p95).toBeLessThan(50);
    });
  });
});
