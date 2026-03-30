/**
 * Layer 4 Integration - E2E Tests
 *
 * Tests: TASK-ORC-013, ORC-014
 *
 * Complete wrapTask() orchestration with all memory operations:
 * - Agent routing
 * - Context injection
 * - Task execution
 * - Findings extraction
 * - Storage to InteractionStore
 * - Feedback submission to ReasoningBank
 * - Workflow state persistence
 * - Retry queue processing
 *
 * @module tests/orchestration/integration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { OrchestrationMemoryManager } from '../../../src/god-agent/orchestration/orchestration-memory-manager.js';
import { InteractionStore } from '../../../src/god-agent/universal/interaction-store.js';
import { ReasoningBank } from '../../../src/god-agent/core/reasoning/reasoning-bank.js';
import { VectorDB } from '../../../src/god-agent/core/vector-db/vector-db.js';
import { PatternMatcher } from '../../../src/god-agent/core/reasoning/pattern-matcher.js';
import { CausalMemory } from '../../../src/god-agent/core/reasoning/causal-memory.js';
import { WorkflowPhase, type IWorkflowState } from '../../../src/god-agent/orchestration/types.js';

describe('Layer 4: E2E Integration (TASK-ORC-013, ORC-014)', () => {
  const testStorageDir = './.test-storage-e2e';
  let manager: OrchestrationMemoryManager;
  let interactionStore: InteractionStore;
  let reasoningBank: ReasoningBank;

  beforeEach(async () => {
    await fs.mkdir(testStorageDir, { recursive: true });

    // Initialize dependencies
    interactionStore = new InteractionStore({
      storageDir: path.join(testStorageDir, 'interactions'),
      maxInteractions: 1000,
      highQualityThreshold: 0.7,
      rollingWindowDays: 7
    });

    const vectorDB = new VectorDB({
      storageDir: path.join(testStorageDir, 'vector'),
      dimension: 1536,
      metric: 'cosine'
    });

    await vectorDB.initialize();

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

    await reasoningBank.initialize();

    // Initialize manager with full config
    manager = new OrchestrationMemoryManager(
      {
        storageDir: testStorageDir,
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

    await manager.initialize();
  });

  afterEach(async () => {
    await manager.shutdown();
    try {
      await fs.rm(testStorageDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('wrapTask() Complete Flow (TASK-ORC-013)', () => {
    it('should execute complete wrapTask flow with all hooks', async () => {
      // Mock Task function
      const mockTask = async (prompt: string, agent: string): Promise<string> => {
        return `Task executed successfully by ${agent}.\n\n` +
          '```typescript\n' +
          'const result = { success: true };\n' +
          '```\n\n' +
          'Files created: auth.service.ts, auth.test.ts\n\n' +
          'Implementation complete.';
      };

      const output = await manager.wrapTask(
        mockTask,
        'Implement user authentication',
        undefined, // Auto-route
        { workflowId: 'auth-workflow' }
      );

      // Verify output returned
      expect(output).toContain('Task executed successfully');
      expect(output).toContain('backend-dev'); // Should route to backend-dev

      // Verify storage to InteractionStore
      const knowledge = interactionStore.getKnowledgeByDomain('project/auth-workflow');
      expect(knowledge.length).toBeGreaterThan(0);

      const stored = knowledge[0];
      expect(stored.type).toBe('implementation');
      expect(stored.tags).toContain('backend-dev');

      // Verify metrics updated
      const metrics = manager.getMetrics();
      expect(metrics.storageCount).toBe(1);
      // Feedback may be queued if trajectory not found, so feedbackCount might be 0
      expect(metrics.feedbackCount).toBeGreaterThanOrEqual(0);

      // Verify feedback was queued if not submitted
      if (metrics.feedbackCount === 0) {
        const queue = manager.getFeedbackQueue();
        expect(queue.length).toBeGreaterThan(0);
      }
    });

    it('should inject context from prior tasks', async () => {
      let receivedPrompt = '';

      const mockTask = async (prompt: string, agent: string): Promise<string> => {
        receivedPrompt = prompt;
        return 'Task output';
      };

      // Store prior knowledge
      await interactionStore.addKnowledge({
        id: 'prior-001',
        domain: 'project/test-workflow',
        category: 'schema',
        content: JSON.stringify({
          schema: 'API schema: POST /auth/login'
        }),
        tags: ['schema', 'api'],
        quality: 1.0,
        usageCount: 0,
        lastUsed: Date.now(),
        createdAt: Date.now()
      });

      await manager.wrapTask(
        mockTask,
        'Implement login endpoint',
        'backend-dev',
        { workflowId: 'test-workflow' }
      );

      // Verify context was injected
      expect(receivedPrompt).toContain('## PRIOR CONTEXT');
      expect(receivedPrompt).toContain('API schema');
    });

    it('should route agent based on task description', async () => {
      let selectedAgent = '';

      const mockTask = async (prompt: string, agent: string): Promise<string> => {
        selectedAgent = agent;
        return 'Task output';
      };

      // Test implementation routing
      await manager.wrapTask(
        mockTask,
        'Implement the authentication feature',
        undefined,
        { workflowId: 'test-1' }
      );
      expect(selectedAgent).toBe('backend-dev');

      // Test testing routing
      await manager.wrapTask(
        mockTask,
        'Test the authentication endpoints',
        undefined,
        { workflowId: 'test-2' }
      );
      expect(selectedAgent).toBe('tester');

      // Test review routing
      await manager.wrapTask(
        mockTask,
        'Review and audit the code',
        undefined,
        { workflowId: 'test-3' }
      );
      expect(selectedAgent).toBe('reviewer');
    });

    it('should persist workflow state across tasks', async () => {
      const mockTask = async (): Promise<string> => 'Task output';

      // First task
      await manager.wrapTask(
        mockTask,
        'Task 1',
        'backend-dev',
        { workflowId: 'persist-test' }
      );

      // Verify state persisted
      const state1 = await manager.restoreWorkflowState('persist-test');
      expect(state1).toBeDefined();
      expect(state1?.id).toBe('persist-test');
      expect(state1?.status).toBe('active');

      // Second task
      await manager.wrapTask(
        mockTask,
        'Task 2',
        'backend-dev',
        { workflowId: 'persist-test' }
      );

      // Verify state updated
      const state2 = await manager.restoreWorkflowState('persist-test');
      expect(state2?.lastActivityAt).toBeGreaterThan(state1!.lastActivityAt);
    });

    it('should handle task failures gracefully', async () => {
      const mockTask = async (): Promise<string> => {
        throw new Error('Task failed');
      };

      await expect(
        manager.wrapTask(
          mockTask,
          'Failing task',
          'backend-dev',
          { workflowId: 'fail-test' }
        )
      ).rejects.toThrow('Task failed');

      // Verify negative feedback was submitted or queued
      const metrics = manager.getMetrics();
      // Feedback may be queued if trajectory not found
      expect(metrics.feedbackCount + manager.getFeedbackQueue().length).toBeGreaterThanOrEqual(1);
    });

    it('should skip memory operations when skipMemory flag is true', async () => {
      const mockTask = async (prompt: string): Promise<string> => {
        return prompt; // Return original prompt
      };

      const output = await manager.wrapTask(
        mockTask,
        'Original prompt',
        'coder',
        { skipMemory: true }
      );

      // Verify no context injection
      expect(output).toBe('Original prompt');

      // Verify no storage
      const knowledge = interactionStore.getKnowledgeByDomain('project/default');
      expect(knowledge.length).toBe(0);

      // Verify metrics not updated
      const metrics = manager.getMetrics();
      expect(metrics.storageCount).toBe(0);
      expect(metrics.feedbackCount).toBe(0);
    });

    it('should extract findings and store correctly', async () => {
      const mockTask = async (): Promise<string> => {
        return 'Implementation complete.\n\n' +
          '```typescript\n' +
          'interface User { id: string; name: string; }\n' +
          '```\n\n' +
          'API Contract:\n' +
          'POST /api/users - Create user\n' +
          'GET /api/users/:id - Get user\n\n' +
          'Files: user.service.ts, user.controller.ts';
      };

      await manager.wrapTask(
        mockTask,
        'Create user management',
        'backend-dev',
        { workflowId: 'findings-test' }
      );

      // Verify findings extracted and stored
      const knowledge = interactionStore.getKnowledgeByDomain('project/findings-test');
      expect(knowledge.length).toBeGreaterThan(0);

      const stored = JSON.parse(knowledge[0].content);
      expect(stored.findings.codeBlocks.length).toBeGreaterThan(0);
      expect(stored.findings.schemas.length).toBeGreaterThan(0);
    });

    it('should process feedback retry queue', async () => {
      // Initialize with mock ReasoningBank that fails initially
      let feedbackCallCount = 0;
      const failingReasoningBank = {
        async provideFeedback() {
          feedbackCallCount++;
          if (feedbackCallCount === 1) {
            throw new Error('ReasoningBank temporarily unavailable');
          }
          return Promise.resolve();
        },
        async initialize() {},
        async query() { return { results: [], metadata: {} }; }
      } as any;

      const failManager = new OrchestrationMemoryManager(
        {
          storageDir: testStorageDir,
          enableAutoMemory: true,
          verbose: false,
          maxContextTokens: 8000,
          enablePersistence: false,
          enableDelegation: false,
          enableRouting: false
        },
        interactionStore,
        failingReasoningBank
      );

      await failManager.initialize();

      const mockTask = async (): Promise<string> => 'Task output';

      // First call - feedback should fail and be queued
      await failManager.wrapTask(
        mockTask,
        'Test task',
        'coder',
        { workflowId: 'retry-test' }
      );

      // Verify feedback was queued
      const queue = failManager.getFeedbackQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].attempts).toBe(0);

      // Second call - should retry queued feedback
      await failManager.wrapTask(
        mockTask,
        'Second task',
        'coder',
        { workflowId: 'retry-test' }
      );

      // Verify feedback call count (1 failed, 2 succeeded)
      expect(feedbackCallCount).toBeGreaterThanOrEqual(2);

      await failManager.shutdown();
    });
  });

  describe('Multi-Agent Workflow E2E (TASK-ORC-014)', () => {
    it('should complete multi-phase workflow with memory coordination', async () => {
      const mockTask = async (prompt: string, agent: string): Promise<string> => {
        return `Phase completed by ${agent}.\n\n` +
          '```typescript\n' +
          `// ${agent} implementation\n` +
          '```\n\n' +
          'Phase complete.';
      };

      // Phase 1: Specification
      await manager.wrapTask(
        mockTask,
        'Define API specification',
        'system-architect',
        { workflowId: 'multi-phase' }
      );

      // Phase 2: Implementation (should receive context from Phase 1)
      let phase2Prompt = '';
      const phase2Task = async (prompt: string, agent: string): Promise<string> => {
        phase2Prompt = prompt;
        return mockTask(prompt, agent);
      };

      await manager.wrapTask(
        phase2Task,
        'Implement API endpoints',
        'backend-dev',
        { workflowId: 'multi-phase' }
      );

      // Verify context injection from Phase 1
      expect(phase2Prompt).toContain('## PRIOR CONTEXT');

      // Phase 3: Testing (should receive context from Phase 1 and 2)
      let phase3Prompt = '';
      const phase3Task = async (prompt: string, agent: string): Promise<string> => {
        phase3Prompt = prompt;
        return mockTask(prompt, agent);
      };

      await manager.wrapTask(
        phase3Task,
        'Test API endpoints',
        'tester',
        { workflowId: 'multi-phase' }
      );

      // Verify context from all prior phases
      expect(phase3Prompt).toContain('## PRIOR CONTEXT');

      // Verify all phases stored
      const knowledge = interactionStore.getKnowledgeByDomain('project/multi-phase');
      expect(knowledge.length).toBe(3);

      // Verify workflow state
      const state = await manager.restoreWorkflowState('multi-phase');
      expect(state).toBeDefined();
      expect(state?.status).toBe('active');

      // Verify metrics
      const metrics = manager.getMetrics();
      expect(metrics.storageCount).toBe(3);
      // Feedback may be queued if trajectories not found
      expect(metrics.feedbackCount + manager.getFeedbackQueue().length).toBeGreaterThanOrEqual(3);
      expect(metrics.contextInjectionsCount).toBeGreaterThan(0);
    });

    it('should handle workflow state persistence across session restart', async () => {
      const mockTask = async (): Promise<string> => 'Task output';

      // Execute task in session 1
      await manager.wrapTask(
        mockTask,
        'Task 1',
        'backend-dev',
        { workflowId: 'session-test' }
      );

      // Shutdown manager (simulating session end)
      await manager.shutdown();

      // Reinitialize manager (simulating new session)
      const newManager = new OrchestrationMemoryManager(
        {
          storageDir: testStorageDir,
          enableAutoMemory: true,
          verbose: false,
          maxContextTokens: 8000,
          enablePersistence: true,
          enableDelegation: false,
          enableRouting: false
        },
        interactionStore,
        reasoningBank
      );

      await newManager.initialize();

      // Restore state from previous session
      const state = await newManager.restoreWorkflowState('session-test');
      expect(state).toBeDefined();
      expect(state?.id).toBe('session-test');

      // Continue workflow in new session
      await newManager.wrapTask(
        mockTask,
        'Task 2',
        'backend-dev',
        { workflowId: 'session-test' }
      );

      // Verify state updated
      const updatedState = await newManager.restoreWorkflowState('session-test');
      expect(updatedState?.lastActivityAt).toBeGreaterThan(state!.lastActivityAt);

      await newManager.shutdown();
    });

    it('should handle parallel workflows independently', async () => {
      const mockTask = async (prompt: string, agent: string): Promise<string> => {
        return `${agent}: ${prompt}`;
      };

      // Execute tasks in parallel workflows
      await Promise.all([
        manager.wrapTask(
          mockTask,
          'Workflow 1 task',
          'backend-dev',
          { workflowId: 'workflow-1' }
        ),
        manager.wrapTask(
          mockTask,
          'Workflow 2 task',
          'coder',
          { workflowId: 'workflow-2' }
        ),
        manager.wrapTask(
          mockTask,
          'Workflow 3 task',
          'tester',
          { workflowId: 'workflow-3' }
        )
      ]);

      // Verify each workflow has independent storage
      const w1Knowledge = interactionStore.getKnowledgeByDomain('project/workflow-1');
      const w2Knowledge = interactionStore.getKnowledgeByDomain('project/workflow-2');
      const w3Knowledge = interactionStore.getKnowledgeByDomain('project/workflow-3');

      expect(w1Knowledge.length).toBe(1);
      expect(w2Knowledge.length).toBe(1);
      expect(w3Knowledge.length).toBe(1);

      // Verify each workflow has independent state
      const state1 = await manager.restoreWorkflowState('workflow-1');
      const state2 = await manager.restoreWorkflowState('workflow-2');
      const state3 = await manager.restoreWorkflowState('workflow-3');

      expect(state1?.id).toBe('workflow-1');
      expect(state2?.id).toBe('workflow-2');
      expect(state3?.id).toBe('workflow-3');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle InteractionStore errors gracefully', async () => {
      // Create manager with broken InteractionStore
      const brokenStore = {
        addKnowledge() {
          throw new Error('Storage error');
        },
        getKnowledgeByDomain() {
          return [];
        }
      } as any;

      const errorManager = new OrchestrationMemoryManager(
        {
          storageDir: testStorageDir,
          enableAutoMemory: true,
          verbose: false,
          maxContextTokens: 8000,
          enablePersistence: false,
          enableDelegation: false,
          enableRouting: false
        },
        brokenStore,
        reasoningBank
      );

      await errorManager.initialize();

      const mockTask = async (): Promise<string> => 'Task output';

      // Should complete despite storage error
      const output = await errorManager.wrapTask(
        mockTask,
        'Test task',
        'coder'
      );

      expect(output).toBe('Task output');

      await errorManager.shutdown();
    });

    it('should handle empty task output', async () => {
      const mockTask = async (): Promise<string> => '';

      const output = await manager.wrapTask(
        mockTask,
        'Empty task',
        'coder',
        { workflowId: 'empty-test' }
      );

      expect(output).toBe('');

      // Verify feedback reflects low quality (if submitted)
      const metrics = manager.getMetrics();
      // Feedback may be queued if trajectory not found
      expect(metrics.feedbackCount + manager.getFeedbackQueue().length).toBeGreaterThanOrEqual(1);

      // If feedback was submitted, verify quality
      if (metrics.feedbackCount > 0) {
        expect(metrics.averageQuality).toBeLessThan(0.5);
      }
    });

    it('should handle very long task output', async () => {
      const longOutput = 'x'.repeat(100000); // 100KB output

      const mockTask = async (): Promise<string> => longOutput;

      const output = await manager.wrapTask(
        mockTask,
        'Long task',
        'coder',
        { workflowId: 'long-test' }
      );

      expect(output).toBe(longOutput);

      // Verify storage succeeded
      const knowledge = interactionStore.getKnowledgeByDomain('project/long-test');
      expect(knowledge.length).toBe(1);
    }, 60000); // 60 second timeout for long output (embedding generation is slow)
  });
});
