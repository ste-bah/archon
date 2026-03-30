/**
 * Monitoring Integration Tests
 * TASK-MON-004 - Phase 3 Integration Testing
 *
 * Tests cover:
 * - MemoryMonitor thresholds and alerts (RULE-040)
 * - EvictionManager automatic cache management (REQ-CONST-011)
 * - TokenTracker usage tracking and persistence (REQ-CONST-014)
 * - Integration between monitoring components
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MemoryMonitor,
  getMemoryMonitor,
  _resetMemoryMonitorForTesting,
  MEMORY_THRESHOLDS,
  EvictionManager,
  getEvictionManager,
  _resetEvictionManagerForTesting,
  TokenTracker,
  getTokenTracker,
  _resetTokenTrackerForTesting,
  type IMemoryAlert,
  type IDescServiceEvictable,
  type ITrajectoryTrackerEvictable
} from '../../../../src/god-agent/core/monitoring/index.js';

// ============================================================================
// Test Setup
// ============================================================================

describe('Monitoring Integration Tests', () => {
  beforeEach(() => {
    _resetMemoryMonitorForTesting();
    _resetEvictionManagerForTesting();
    _resetTokenTrackerForTesting();
  });

  afterEach(() => {
    _resetMemoryMonitorForTesting();
    _resetEvictionManagerForTesting();
    _resetTokenTrackerForTesting();
  });

  // ==========================================================================
  // MemoryMonitor Tests (RULE-040)
  // ==========================================================================

  describe('MemoryMonitor (RULE-040)', () => {
    it('should verify threshold constants match CONSTITUTION', () => {
      expect(MEMORY_THRESHOLDS.WARNING).toBe(0.75);  // 75% = 150MB warning
      expect(MEMORY_THRESHOLDS.ERROR).toBe(1.0);      // 100% = 200MB error
    });

    it('should create monitor with default budgets', () => {
      const monitor = new MemoryMonitor();
      const budgets = monitor.getBudgets();

      expect(budgets.episodeCache).toBe(1000);      // RULE-037
      expect(budgets.embeddingCache).toBe(100);     // RULE-038 (MB)
      expect(budgets.trajectoryCache).toBe(100);    // RULE-039
      expect(budgets.totalOverhead).toBe(200);      // RULE-040 (MB)
    });

    it('should accept custom budgets', () => {
      const monitor = new MemoryMonitor({
        budgets: {
          episodeCache: 500,
          totalOverhead: 150
        }
      });
      const budgets = monitor.getBudgets();

      expect(budgets.episodeCache).toBe(500);
      expect(budgets.totalOverhead).toBe(150);
      // Unchanged defaults
      expect(budgets.embeddingCache).toBe(100);
      expect(budgets.trajectoryCache).toBe(100);
    });

    it('should emit warning alert at 75% threshold', () => {
      const alerts: IMemoryAlert[] = [];
      const monitor = new MemoryMonitor();
      monitor.onAlert(alert => alerts.push(alert));

      // Mock heap usage at 155MB (77.5% of 200MB)
      vi.spyOn(process, 'memoryUsage').mockReturnValue({
        heapUsed: 155 * 1024 * 1024,
        heapTotal: 200 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
        rss: 256 * 1024 * 1024
      } as NodeJS.MemoryUsage);

      monitor.check();

      const warningAlert = alerts.find(
        a => a.component === 'totalOverhead' && a.level === 'warning'
      );
      expect(warningAlert).toBeDefined();
      expect(warningAlert?.message).toContain('approaching limit');
      expect(warningAlert?.ratio).toBeGreaterThanOrEqual(0.75);
    });

    it('should emit error alert at 100% threshold', () => {
      const alerts: IMemoryAlert[] = [];
      const monitor = new MemoryMonitor();
      monitor.onAlert(alert => alerts.push(alert));

      // Mock heap usage at 205MB (102.5% of 200MB)
      vi.spyOn(process, 'memoryUsage').mockReturnValue({
        heapUsed: 205 * 1024 * 1024,
        heapTotal: 256 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
        rss: 300 * 1024 * 1024
      } as NodeJS.MemoryUsage);

      monitor.check();

      const errorAlert = alerts.find(
        a => a.component === 'totalOverhead' && a.level === 'error'
      );
      expect(errorAlert).toBeDefined();
      expect(errorAlert?.message).toContain('VIOLATION');
      expect(errorAlert?.ratio).toBeGreaterThanOrEqual(1.0);
    });

    it('should not emit alerts below warning threshold', () => {
      const alerts: IMemoryAlert[] = [];
      const monitor = new MemoryMonitor();
      monitor.onAlert(alert => alerts.push(alert));

      // Mock heap usage at 100MB (50% of 200MB)
      vi.spyOn(process, 'memoryUsage').mockReturnValue({
        heapUsed: 100 * 1024 * 1024,
        heapTotal: 200 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
        rss: 256 * 1024 * 1024
      } as NodeJS.MemoryUsage);

      monitor.check();

      const totalOverheadAlerts = alerts.filter(a => a.component === 'totalOverhead');
      expect(totalOverheadAlerts).toHaveLength(0);
    });

    it('should collect usage from service providers', () => {
      const mockDescService = {
        getCacheSize: vi.fn().mockReturnValue(500),
        getEmbeddingCacheMB: vi.fn().mockReturnValue(50)
      };
      const mockTrajectoryTracker = {
        getActiveCount: vi.fn().mockReturnValue(25)
      };

      const monitor = new MemoryMonitor();
      monitor.setDescServiceProvider(() => mockDescService);
      monitor.setTrajectoryTrackerProvider(() => mockTrajectoryTracker);

      const usage = monitor.getUsage();

      expect(mockDescService.getCacheSize).toHaveBeenCalled();
      expect(mockDescService.getEmbeddingCacheMB).toHaveBeenCalled();
      expect(mockTrajectoryTracker.getActiveCount).toHaveBeenCalled();
      expect(usage.episodeCacheCount).toBe(500);
      expect(usage.embeddingCacheMB).toBe(50);
      expect(usage.trajectoryCacheCount).toBe(25);
    });

    it('should handle missing service providers gracefully', () => {
      const monitor = new MemoryMonitor();
      // Don't set providers

      const usage = monitor.getUsage();

      expect(usage.episodeCacheCount).toBe(0);
      expect(usage.embeddingCacheMB).toBe(0);
      expect(usage.trajectoryCacheCount).toBe(0);
    });

    it('should start and stop periodic monitoring', () => {
      const monitor = new MemoryMonitor({ checkIntervalMs: 100 });

      expect(monitor.isRunning()).toBe(false);

      monitor.start();
      expect(monitor.isRunning()).toBe(true);

      monitor.stop();
      expect(monitor.isRunning()).toBe(false);
    });

    it('should support multiple alert callbacks', () => {
      const callback1Results: IMemoryAlert[] = [];
      const callback2Results: IMemoryAlert[] = [];

      const monitor = new MemoryMonitor();
      monitor.onAlert(alert => callback1Results.push(alert));
      monitor.onAlert(alert => callback2Results.push(alert));

      // Mock high memory usage
      vi.spyOn(process, 'memoryUsage').mockReturnValue({
        heapUsed: 180 * 1024 * 1024,
        heapTotal: 256 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
        rss: 300 * 1024 * 1024
      } as NodeJS.MemoryUsage);

      monitor.check();

      expect(callback1Results.length).toBeGreaterThan(0);
      expect(callback2Results.length).toBeGreaterThan(0);
      expect(callback1Results.length).toBe(callback2Results.length);
    });
  });

  // ==========================================================================
  // EvictionManager Tests (REQ-CONST-011)
  // ==========================================================================

  describe('EvictionManager (REQ-CONST-011)', () => {
    it('should evict 20% on warning alert', async () => {
      const mockDescService: IDescServiceEvictable = {
        getCacheSize: vi.fn().mockReturnValue(1000),
        evictLRU: vi.fn().mockReturnValue(200)
      };

      const manager = new EvictionManager();
      manager.setDescServiceProvider(() => mockDescService);
      manager.initialize();

      const results = await manager.handleAlert({
        level: 'warning',
        component: 'episodeCache',
        current: 800,
        limit: 1000,
        ratio: 0.8,
        message: 'Episode cache at 80%',
        timestamp: Date.now()
      });

      expect(mockDescService.evictLRU).toHaveBeenCalledWith(200); // 20% of 1000
      expect(results).toHaveLength(1);
      expect(results[0].component).toBe('episodeCache');
      expect(results[0].requested).toBe(200);
    });

    it('should evict 40% on error alert', async () => {
      const mockDescService: IDescServiceEvictable = {
        getCacheSize: vi.fn().mockReturnValue(1000),
        evictLRU: vi.fn().mockReturnValue(400)
      };

      const manager = new EvictionManager();
      manager.setDescServiceProvider(() => mockDescService);
      manager.initialize();

      const results = await manager.handleAlert({
        level: 'error',
        component: 'episodeCache',
        current: 1000,
        limit: 1000,
        ratio: 1.0,
        message: 'Episode cache full - VIOLATION',
        timestamp: Date.now()
      });

      expect(mockDescService.evictLRU).toHaveBeenCalledWith(400); // 40% of 1000
      expect(results).toHaveLength(1);
      expect(results[0].requested).toBe(400);
    });

    it('should evict from embedding cache when triggered', async () => {
      const mockDescService: IDescServiceEvictable = {
        getCacheSize: vi.fn().mockReturnValue(100),
        evictLRU: vi.fn().mockReturnValue(20),
        evictEmbeddingCache: vi.fn().mockReturnValue(20)
      };

      const manager = new EvictionManager();
      manager.setDescServiceProvider(() => mockDescService);
      manager.initialize();

      const results = await manager.handleAlert({
        level: 'warning',
        component: 'embeddingCache',
        current: 80,
        limit: 100,
        ratio: 0.8,
        message: 'Embedding cache at 80%',
        timestamp: Date.now()
      });

      expect(mockDescService.evictEmbeddingCache).toHaveBeenCalledWith(0.2); // 20%
      expect(results).toHaveLength(1);
      expect(results[0].component).toBe('embeddingCache');
    });

    it('should evict trajectories with flush-first strategy', async () => {
      const mockTrajectoryTracker: ITrajectoryTrackerEvictable = {
        getActiveCount: vi.fn().mockReturnValue(100),
        flushCompleted: vi.fn().mockReturnValue(10),
        evictOldest: vi.fn().mockReturnValue(20)
      };

      const manager = new EvictionManager();
      manager.setTrajectoryTrackerProvider(() => mockTrajectoryTracker);
      manager.initialize();

      const results = await manager.handleAlert({
        level: 'warning',
        component: 'trajectoryCache',
        current: 80,
        limit: 100,
        ratio: 0.8,
        message: 'Trajectory cache at 80%',
        timestamp: Date.now()
      });

      // Should first flush completed, then evict oldest
      expect(mockTrajectoryTracker.flushCompleted).toHaveBeenCalled();
      expect(mockTrajectoryTracker.evictOldest).toHaveBeenCalledWith(20); // 20% of 100
      expect(results[0].evicted).toBe(30); // 10 flushed + 20 evicted
    });

    it('should evict from all caches on totalOverhead alert', async () => {
      const mockDescService: IDescServiceEvictable = {
        getCacheSize: vi.fn().mockReturnValue(500),
        evictLRU: vi.fn().mockReturnValue(100),
        evictEmbeddingCache: vi.fn().mockReturnValue(10)
      };
      const mockTrajectoryTracker: ITrajectoryTrackerEvictable = {
        getActiveCount: vi.fn().mockReturnValue(50),
        evictOldest: vi.fn().mockReturnValue(10)
      };

      const manager = new EvictionManager();
      manager.setDescServiceProvider(() => mockDescService);
      manager.setTrajectoryTrackerProvider(() => mockTrajectoryTracker);
      manager.initialize();

      const results = await manager.handleAlert({
        level: 'warning',
        component: 'totalOverhead',
        current: 160,
        limit: 200,
        ratio: 0.8,
        message: 'Total overhead at 80%',
        timestamp: Date.now()
      });

      // Should evict from all three caches
      expect(results).toHaveLength(3);
      expect(mockDescService.evictLRU).toHaveBeenCalled();
      expect(mockDescService.evictEmbeddingCache).toHaveBeenCalled();
      expect(mockTrajectoryTracker.evictOldest).toHaveBeenCalled();
    });

    it('should handle missing service gracefully', async () => {
      const manager = new EvictionManager();
      // Don't set providers
      manager.initialize();

      const results = await manager.handleAlert({
        level: 'warning',
        component: 'episodeCache',
        current: 800,
        limit: 1000,
        ratio: 0.8,
        message: 'Test alert',
        timestamp: Date.now()
      });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('not available');
    });

    it('should support custom eviction percentages', () => {
      const manager = new EvictionManager({
        warningEvictPercent: 0.15,
        errorEvictPercent: 0.50
      });

      const config = manager.getConfig();
      expect(config.warningEvictPercent).toBe(0.15);
      expect(config.errorEvictPercent).toBe(0.50);
    });

    it('should track eviction results with timing', async () => {
      const mockDescService: IDescServiceEvictable = {
        getCacheSize: vi.fn().mockReturnValue(1000),
        evictLRU: vi.fn().mockImplementation(async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 200;
        })
      };

      const manager = new EvictionManager();
      manager.setDescServiceProvider(() => mockDescService);
      manager.initialize();

      const results = await manager.handleAlert({
        level: 'warning',
        component: 'episodeCache',
        current: 800,
        limit: 1000,
        ratio: 0.8,
        message: 'Test alert',
        timestamp: Date.now()
      });

      expect(results[0].durationMs).toBeGreaterThanOrEqual(10);
      expect(results[0].success).toBe(true);
    });
  });

  // ==========================================================================
  // TokenTracker Tests (REQ-CONST-014)
  // ==========================================================================

  describe('TokenTracker (REQ-CONST-014)', () => {
    it('should record token usage', () => {
      const tracker = getTokenTracker();
      const uniqueSession = `sess-record-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      tracker.record({
        sessionId: uniqueSession,
        requestId: 'req-001',
        inputTokens: 100,
        outputTokens: 500,
        totalTokens: 600,
        taskType: 'code-generation',
        agentId: 'coder-agent'
      });

      // Force flush for testing
      tracker.flush();

      const stats = tracker.getStats({ sessionId: uniqueSession });
      expect(stats.totalTokens).toBe(600);
      expect(stats.requestCount).toBe(1);
    });

    it('should calculate statistics correctly', () => {
      const tracker = getTokenTracker();
      const uniqueSession = `sess-stats-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Record multiple usages
      tracker.record({
        sessionId: uniqueSession,
        requestId: 'req-1',
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        taskType: 'code',
        agentId: 'coder'
      });
      tracker.record({
        sessionId: uniqueSession,
        requestId: 'req-2',
        inputTokens: 200,
        outputTokens: 400,
        totalTokens: 600,
        taskType: 'code',
        agentId: 'coder'
      });
      tracker.record({
        sessionId: uniqueSession,
        requestId: 'req-3',
        inputTokens: 300,
        outputTokens: 600,
        totalTokens: 900,
        taskType: 'code',
        agentId: 'coder'
      });

      tracker.flush();
      const stats = tracker.getStats({ sessionId: uniqueSession });

      expect(stats.totalInputTokens).toBe(600);   // 100 + 200 + 300
      expect(stats.totalOutputTokens).toBe(1200); // 200 + 400 + 600
      expect(stats.totalTokens).toBe(1800);       // 300 + 600 + 900
      expect(stats.requestCount).toBe(3);
      expect(stats.averageTotalTokens).toBe(600);
    });

    it('should auto-flush when buffer is full', () => {
      const tracker = new TokenTracker({
        bufferLimit: 5,
        flushIntervalMs: 60000  // Long interval to avoid auto-flush by timer
      });

      // Record more than buffer limit
      for (let i = 0; i < 7; i++) {
        tracker.record({
          sessionId: 'sess-buffer',
          requestId: `req-${i}`,
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          taskType: 'test',
          agentId: 'tester'
        });
      }

      // Buffer should have been flushed at some point
      expect(tracker.getBufferSize()).toBeLessThan(7);

      tracker.close();
    });

    it('should filter stats by task type', () => {
      const tracker = getTokenTracker();
      const uniqueSession = `sess-filter-${Date.now()}`;
      const uniqueTaskCode = `code-gen-${Date.now()}`;
      const uniqueTaskTest = `testing-${Date.now()}`;

      tracker.record({
        sessionId: uniqueSession,
        requestId: 'req-code',
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        taskType: uniqueTaskCode,
        agentId: 'coder'
      });
      tracker.record({
        sessionId: uniqueSession,
        requestId: 'req-test',
        inputTokens: 50,
        outputTokens: 100,
        totalTokens: 150,
        taskType: uniqueTaskTest,
        agentId: 'tester'
      });

      tracker.flush();

      const codeStats = tracker.getStats({ taskType: uniqueTaskCode });
      expect(codeStats.totalTokens).toBe(300);
      expect(codeStats.requestCount).toBe(1);

      const testStats = tracker.getStats({ taskType: uniqueTaskTest });
      expect(testStats.totalTokens).toBe(150);
      expect(testStats.requestCount).toBe(1);
    });

    it('should filter stats by agent ID', () => {
      const tracker = getTokenTracker();
      const uniqueSession = `sess-agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const uniqueAgentA = `agent-a-${Date.now()}`;
      const uniqueAgentB = `agent-b-${Date.now()}`;

      tracker.record({
        sessionId: uniqueSession,
        requestId: 'req-1',
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        taskType: 'code',
        agentId: uniqueAgentA
      });
      tracker.record({
        sessionId: uniqueSession,
        requestId: 'req-2',
        inputTokens: 200,
        outputTokens: 400,
        totalTokens: 600,
        taskType: 'code',
        agentId: uniqueAgentB
      });

      tracker.flush();

      const agentAStats = tracker.getStats({ agentId: uniqueAgentA });
      expect(agentAStats.totalTokens).toBe(300);

      const agentBStats = tracker.getStats({ agentId: uniqueAgentB });
      expect(agentBStats.totalTokens).toBe(600);
    });

    it('should track trajectory associations', () => {
      const tracker = getTokenTracker();
      const uniqueSession = `sess-traj-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const uniqueTrajectory = `traj-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      tracker.record({
        sessionId: uniqueSession,
        requestId: 'req-1',
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        taskType: 'code',
        agentId: 'coder',
        trajectoryId: uniqueTrajectory
      });
      tracker.record({
        sessionId: uniqueSession,
        requestId: 'req-2',
        inputTokens: 150,
        outputTokens: 250,
        totalTokens: 400,
        taskType: 'code',
        agentId: 'coder',
        trajectoryId: uniqueTrajectory
      });

      tracker.flush();

      const trajectoryUsage = tracker.getUsageByTrajectory(uniqueTrajectory);
      expect(trajectoryUsage).toHaveLength(2);

      const totalForTrajectory = trajectoryUsage.reduce((sum, u) => sum + u.totalTokens, 0);
      expect(totalForTrajectory).toBe(700);
    });

    it('should return empty stats for no data', () => {
      const tracker = getTokenTracker();
      const stats = tracker.getStats({ sessionId: 'non-existent' });

      expect(stats.totalTokens).toBe(0);
      expect(stats.requestCount).toBe(0);
      expect(stats.averageTotalTokens).toBe(0);
    });

    it('should close cleanly and flush remaining buffer', () => {
      const tracker = new TokenTracker({ bufferLimit: 100 });

      tracker.record({
        sessionId: 'sess-close',
        requestId: 'req-1',
        inputTokens: 50,
        outputTokens: 100,
        totalTokens: 150,
        taskType: 'test',
        agentId: 'tester'
      });

      expect(tracker.getBufferSize()).toBe(1);

      tracker.close();

      // Buffer should be empty after close
      expect(tracker.getBufferSize()).toBe(0);
    });

    it('should provide stats aggregated by task type', () => {
      const tracker = getTokenTracker();
      const uniqueSession = `sess-agg-${Date.now()}`;
      const uniqueTaskCode = `code-agg-${Date.now()}`;
      const uniqueTaskTest = `test-agg-${Date.now()}`;

      tracker.record({
        sessionId: uniqueSession,
        requestId: 'req-1',
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        taskType: uniqueTaskCode,
        agentId: 'agent'
      });
      tracker.record({
        sessionId: uniqueSession,
        requestId: 'req-2',
        inputTokens: 50,
        outputTokens: 100,
        totalTokens: 150,
        taskType: uniqueTaskTest,
        agentId: 'agent'
      });
      tracker.record({
        sessionId: uniqueSession,
        requestId: 'req-3',
        inputTokens: 200,
        outputTokens: 300,
        totalTokens: 500,
        taskType: uniqueTaskCode,
        agentId: 'agent'
      });

      tracker.flush();

      const statsByTaskType = tracker.getStatsByTaskType();

      expect(statsByTaskType.has(uniqueTaskCode)).toBe(true);
      expect(statsByTaskType.has(uniqueTaskTest)).toBe(true);
      expect(statsByTaskType.get(uniqueTaskCode)?.totalTokens).toBe(800);
      expect(statsByTaskType.get(uniqueTaskTest)?.totalTokens).toBe(150);
    });

    it('should provide stats aggregated by agent', () => {
      const tracker = getTokenTracker();
      const uniqueSession = `sess-agent-agg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const uniqueAgentAlpha = `agent-alpha-${Date.now()}`;
      const uniqueAgentBeta = `agent-beta-${Date.now()}`;

      tracker.record({
        sessionId: uniqueSession,
        requestId: 'req-1',
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        taskType: 'code',
        agentId: uniqueAgentAlpha
      });
      tracker.record({
        sessionId: uniqueSession,
        requestId: 'req-2',
        inputTokens: 200,
        outputTokens: 400,
        totalTokens: 600,
        taskType: 'code',
        agentId: uniqueAgentBeta
      });

      tracker.flush();

      const statsByAgent = tracker.getStatsByAgent();

      expect(statsByAgent.has(uniqueAgentAlpha)).toBe(true);
      expect(statsByAgent.has(uniqueAgentBeta)).toBe(true);
      expect(statsByAgent.get(uniqueAgentAlpha)?.totalTokens).toBe(300);
      expect(statsByAgent.get(uniqueAgentBeta)?.totalTokens).toBe(600);
    });
  });

  // ==========================================================================
  // Integration Between Components
  // ==========================================================================

  describe('Component Integration', () => {
    it('should wire MemoryMonitor alerts to EvictionManager', async () => {
      const evictionResults: unknown[] = [];
      const mockDescService: IDescServiceEvictable = {
        getCacheSize: vi.fn().mockReturnValue(1000),
        evictLRU: vi.fn().mockImplementation((count) => {
          evictionResults.push({ evicted: count });
          return count;
        })
      };

      // Setup monitor
      const monitor = new MemoryMonitor();

      // Setup eviction manager and wire to monitor
      const evictionManager = new EvictionManager();
      evictionManager.setDescServiceProvider(() => mockDescService);
      evictionManager.initialize();

      // Wire monitor alerts to eviction manager
      monitor.onAlert((alert) => {
        evictionManager.handleAlert(alert);
      });

      // Mock high memory to trigger alert
      vi.spyOn(process, 'memoryUsage').mockReturnValue({
        heapUsed: 160 * 1024 * 1024,  // 80% of 200MB
        heapTotal: 256 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
        rss: 300 * 1024 * 1024
      } as NodeJS.MemoryUsage);

      // Trigger check
      monitor.check();

      // Wait for async eviction to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // Eviction should have been triggered
      expect(evictionResults.length).toBeGreaterThan(0);
    });

    it('should track token usage across multiple sessions', () => {
      const tracker = getTokenTracker();
      const uniqueSession1 = `session-multi-1-${Date.now()}`;
      const uniqueSession2 = `session-multi-2-${Date.now()}`;

      // Session 1
      tracker.record({
        sessionId: uniqueSession1,
        requestId: 'req-1',
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        taskType: 'code',
        agentId: 'agent-1'
      });

      // Session 2
      tracker.record({
        sessionId: uniqueSession2,
        requestId: 'req-2',
        inputTokens: 200,
        outputTokens: 400,
        totalTokens: 600,
        taskType: 'code',
        agentId: 'agent-2'
      });

      tracker.flush();

      // Each session should have independent stats
      const session1Stats = tracker.getStats({ sessionId: uniqueSession1 });
      const session2Stats = tracker.getStats({ sessionId: uniqueSession2 });

      expect(session1Stats.totalTokens).toBe(300);
      expect(session2Stats.totalTokens).toBe(600);

      // Combined stats for just these two sessions
      // Use a recent timestamp to filter out old data
      const recentTimestamp = Date.now() - 5000; // 5 seconds ago
      const combinedStats = tracker.getStats({ since: recentTimestamp });
      expect(combinedStats.totalTokens).toBeGreaterThanOrEqual(900);
    });

    it('should handle concurrent operations safely', async () => {
      const tracker = getTokenTracker();
      const uniqueSession = `concurrent-session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const recordPromises: Promise<void>[] = [];

      // Simulate concurrent recording
      for (let i = 0; i < 50; i++) {
        recordPromises.push(
          new Promise<void>((resolve) => {
            tracker.record({
              sessionId: uniqueSession,
              requestId: `req-${i}`,
              inputTokens: 10,
              outputTokens: 20,
              totalTokens: 30,
              taskType: 'test',
              agentId: 'test-agent'
            });
            resolve();
          })
        );
      }

      await Promise.all(recordPromises);
      tracker.flush();

      const stats = tracker.getStats({ sessionId: uniqueSession });
      expect(stats.requestCount).toBe(50);
      expect(stats.totalTokens).toBe(1500); // 50 * 30
    });
  });
});
