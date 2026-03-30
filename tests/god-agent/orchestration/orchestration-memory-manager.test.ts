/**
 * OrchestrationMemoryManager Tests
 *
 * Tests for TASK-ORC-002 (Manager Skeleton)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OrchestrationMemoryManager } from '../../../src/god-agent/orchestration/orchestration-memory-manager.js';
import { InteractionStore } from '../../../src/god-agent/universal/interaction-store.js';
import { ReasoningBank } from '../../../src/god-agent/core/reasoning/reasoning-bank.js';
import { VectorDB } from '../../../src/god-agent/core/vector-db/vector-db.js';
import { PatternMatcher } from '../../../src/god-agent/core/reasoning/pattern-matcher.js';
import { CausalMemory } from '../../../src/god-agent/core/reasoning/causal-memory.js';

describe('OrchestrationMemoryManager', () => {
  let manager: OrchestrationMemoryManager;
  let interactionStore: InteractionStore;
  let reasoningBank: ReasoningBank;

  beforeEach(async () => {
    // Setup InteractionStore
    interactionStore = new InteractionStore({
      storageDir: '.agentdb-test/orchestration',
      maxInteractions: 100,
      highQualityThreshold: 0.7,
      rollingWindowDays: 7
    });

    // Setup ReasoningBank dependencies
    const vectorDB = new VectorDB({
      dimensions: 1536,
      indexPath: '.agentdb-test/orchestration-vectors.idx',
      dataPath: '.agentdb-test/orchestration-vectors.dat',
      maxElements: 1000
    });

    const patternMatcher = new PatternMatcher(vectorDB);
    const causalMemory = new CausalMemory();

    reasoningBank = new ReasoningBank({
      patternMatcher,
      causalMemory,
      vectorDB,
      config: {
        enableGNN: false,
        defaultMaxResults: 10,
        defaultConfidenceThreshold: 0.7
      }
    });

    // Initialize ReasoningBank
    await reasoningBank.initialize();

    // Create manager
    manager = new OrchestrationMemoryManager(
      {
        storageDir: '.agentdb-test/workflows',
        enableAutoMemory: true,
        verbose: false,
        maxContextTokens: 8000,
        enablePersistence: true,
        enableDelegation: true,
        enableRouting: true
      },
      interactionStore,
      reasoningBank
    );
  });

  describe('Constructor', () => {
    it('should instantiate with valid dependencies', () => {
      expect(manager).toBeDefined();
      expect(manager).toBeInstanceOf(OrchestrationMemoryManager);
    });

    it('should throw on missing InteractionStore', () => {
      expect(() => {
        new OrchestrationMemoryManager(
          {
            storageDir: '.agentdb-test/workflows',
            enableAutoMemory: true,
            verbose: false,
            maxContextTokens: 8000,
            enablePersistence: true,
            enableDelegation: true,
            enableRouting: true
          },
          null as any,
          reasoningBank
        );
      }).toThrow('InteractionStore is required');
    });

    it('should throw on missing ReasoningBank', () => {
      expect(() => {
        new OrchestrationMemoryManager(
          {
            storageDir: '.agentdb-test/workflows',
            enableAutoMemory: true,
            verbose: false,
            maxContextTokens: 8000,
            enablePersistence: true,
            enableDelegation: true,
            enableRouting: true
          },
          interactionStore,
          null as any
        );
      }).toThrow('ReasoningBank is required');
    });
  });

  describe('getMetrics', () => {
    it('should return initial metrics', () => {
      const metrics = manager.getMetrics();
      expect(metrics).toBeDefined();
      expect(metrics.storageCount).toBe(0);
      expect(metrics.retrievalCount).toBe(0);
      expect(metrics.feedbackCount).toBe(0);
      expect(metrics.successRate).toBe(0);
      expect(metrics.averageQuality).toBe(0);
      expect(metrics.sessionStartedAt).toBeGreaterThan(0);
      expect(metrics.lastActivityAt).toBeGreaterThan(0);
    });
  });

  describe('resetMetrics', () => {
    it('should reset all metrics to initial state', () => {
      // Reset and verify
      manager.resetMetrics();
      const metrics = manager.getMetrics();
      expect(metrics.storageCount).toBe(0);
      expect(metrics.retrievalCount).toBe(0);
      expect(metrics.feedbackCount).toBe(0);
    });
  });

  describe('Implemented Methods (TASK-ORC-013, ORC-014)', () => {
    it('wrapTask should execute successfully', async () => {
      const output = await manager.wrapTask(
        async () => 'test output',
        'test prompt',
        'coder',
        { workflowId: 'test-001' }
      );

      expect(output).toBe('test output');
    });

    it('storeTaskOutput should store successfully', async () => {
      const result = await manager.storeTaskOutput('test output', {
        workflowId: 'test-001',
        taskId: 'task-1',
        agentType: 'coder',
        durationMs: 1000,
        success: true
      });

      expect(result.success).toBe(true);
      expect(result.domain).toBe('project/test-001');
    });

    it('injectContext should inject successfully', async () => {
      const result = await manager.injectContext('test prompt', 'project/test', ['tag']);

      expect(result.originalPrompt).toBe('test prompt');
      expect(result.enhancedPrompt).toBeDefined();
    });

    it('submitFeedback should submit successfully or queue for retry', async () => {
      const result = await manager.submitFeedback('test output', {
        trajectoryId: 'traj-001',
        agentType: 'coder',
        taskType: 'implementation',
        durationMs: 1000,
        success: true
      });

      expect(result.quality).toBeGreaterThanOrEqual(0);
      expect(result.quality).toBeLessThanOrEqual(1);
      expect(['positive', 'negative', 'neutral']).toContain(result.outcome);
    });

    it('persistWorkflowState should persist successfully', async () => {
      await manager.persistWorkflowState('test-001', {
        id: 'test-001',
        name: 'Test Workflow',
        completedPhases: [],
        pendingTasks: [],
        storedDomains: [],
        currentPhase: 'planning',
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
        status: 'active'
      });

      // Should not throw
      expect(true).toBe(true);
    });

    it('restoreWorkflowState should restore successfully', async () => {
      const state = {
        id: 'test-001',
        name: 'Test Workflow',
        completedPhases: [],
        pendingTasks: [],
        storedDomains: [],
        currentPhase: 'planning',
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
        status: 'active' as const
      };

      await manager.persistWorkflowState('test-001', state);
      const restored = await manager.restoreWorkflowState('test-001');

      expect(restored).toBeDefined();
      expect(restored?.id).toBe('test-001');
    });
  });
});
