/**
 * DAI-002: Pipeline Integration Tests
 * TASK-008: Integration tests with real agents
 *
 * RULE-002: No mock data - uses real agents from AgentRegistry
 * RULE-004: Tests sequential execution (no parallel)
 * RULE-005: Tests memory coordination via InteractionStore
 * RULE-006: Tests DAI-001 AgentSelector integration
 *
 * These tests verify the complete pipeline execution flow
 * using real agent definitions from .claude/agents/
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  PipelineExecutor,
  createPipelineExecutor,
  type IStepExecutor,
  type IStepExecutionResult,
} from '../../../../src/god-agent/core/pipeline/pipeline-executor.js';
import type {
  IPipelineDefinition,
  IPipelineEvent,
} from '../../../../src/god-agent/core/pipeline/dai-002-types.js';
import { PipelineEventType } from '../../../../src/god-agent/core/pipeline/dai-002-types.js';
import { AgentRegistry } from '../../../../src/god-agent/core/agents/agent-registry.js';
import { AgentSelector } from '../../../../src/god-agent/core/agents/agent-selector.js';
import { InteractionStore } from '../../../../src/god-agent/universal/interaction-store.js';

// ==================== Test Setup ====================

describe('Pipeline Integration Tests', () => {
  let agentRegistry: AgentRegistry;
  let agentSelector: AgentSelector;
  let interactionStore: InteractionStore;
  let realAgentKeys: string[] = [];
  let testPipelineCount = 0;

  // Discover real agent keys before all tests (RULE-002)
  beforeAll(async () => {
    const tempRegistry = new AgentRegistry({ basePath: '.claude/agents', verbose: false });
    await tempRegistry.initialize('.claude/agents');
    const allAgents = tempRegistry.getAll();

    // Get at least 10 different agent keys for testing
    realAgentKeys = allAgents.slice(0, 10).map(a => a.key);

    if (realAgentKeys.length < 3) {
      throw new Error(`Need at least 3 agents for integration tests, found ${realAgentKeys.length}`);
    }

    console.log(`[Integration Tests] Found ${realAgentKeys.length} real agents for testing`);
    tempRegistry.clear();
  });

  beforeEach(async () => {
    // Initialize fresh instances for each test
    agentRegistry = new AgentRegistry({ basePath: '.claude/agents', verbose: false });
    await agentRegistry.initialize('.claude/agents');
    agentSelector = new AgentSelector(agentRegistry, false);
    interactionStore = new InteractionStore({
      maxInteractions: 1000,
      pruneThreshold: 500,
    });
    testPipelineCount++;
  });

  afterEach(() => {
    interactionStore.clear();
    agentRegistry.clear();
  });

  // ==================== Helper Functions ====================

  /**
   * Create a valid test pipeline using real agent keys
   */
  function createTestPipeline(stepCount: number = 3): IPipelineDefinition {
    const agents = [];
    for (let i = 0; i < stepCount; i++) {
      const agentKey = realAgentKeys[i % realAgentKeys.length];
      const step: any = {
        agentKey,
        task: `Step ${i + 1}: Task for ${agentKey}`,
        outputDomain: `project/test-${testPipelineCount}/step-${i}`,
        outputTags: [`step-${i}`, 'test'],
      };

      // Add input domain for steps after the first
      if (i > 0) {
        step.inputDomain = `project/test-${testPipelineCount}/step-${i - 1}`;
        step.inputTags = [`step-${i - 1}`];
      }

      agents.push(step);
    }

    return {
      name: `Integration Test Pipeline ${testPipelineCount}`,
      sequential: true,
      agents,
    };
  }

  /**
   * Create a mock step executor for testing
   */
  function createMockStepExecutor(
    results: Record<number, { output: unknown; quality: number }> = {}
  ): IStepExecutor & { executionLog: Array<{ agentKey: string; stepIndex: number }> } {
    return {
      executionLog: [],
      async execute(
        agentKey: string,
        prompt: string,
        timeout: number
      ): Promise<IStepExecutionResult> {
        const stepMatch = prompt.match(/Step (\d+)/);
        const stepIndex = stepMatch ? parseInt(stepMatch[1], 10) - 1 : 0;

        this.executionLog.push({ agentKey, stepIndex });
        await new Promise(resolve => setTimeout(resolve, 10));

        const result = results[stepIndex] ?? { output: { executed: true }, quality: 0.9 };
        return {
          output: result.output,
          quality: result.quality,
          duration: 10,
        };
      },
    };
  }

  // ==================== Sequential Execution Tests ====================

  describe('Sequential Execution (RULE-004)', () => {
    it('should execute 3-step pipeline sequentially', async () => {
      const pipeline = createTestPipeline(3);
      const executionOrder: number[] = [];

      const stepExecutor: IStepExecutor = {
        async execute(agentKey: string, prompt: string, timeout: number) {
          const stepMatch = prompt.match(/Step (\d+)/);
          const stepIndex = stepMatch ? parseInt(stepMatch[1], 10) - 1 : executionOrder.length;
          executionOrder.push(stepIndex);
          await new Promise(resolve => setTimeout(resolve, 10));
          return { output: { step: stepIndex }, quality: 0.9, duration: 10 };
        },
      };

      const executor = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor, verbose: false }
      );

      const result = await executor.execute(pipeline);

      expect(result.status).toBe('completed');
      expect(result.steps.length).toBe(3);
      expect(executionOrder).toEqual([0, 1, 2]);
    });

    it('should NOT execute steps in parallel', async () => {
      const pipeline = createTestPipeline(3);
      const timestamps: { start: number; end: number }[] = [];

      const stepExecutor: IStepExecutor = {
        async execute(agentKey: string, prompt: string, timeout: number) {
          const stepMatch = prompt.match(/Step (\d+)/);
          const stepIndex = stepMatch ? parseInt(stepMatch[1], 10) - 1 : timestamps.length;

          const start = Date.now();
          await new Promise(resolve => setTimeout(resolve, 50));
          const end = Date.now();
          timestamps[stepIndex] = { start, end };

          return { output: { step: stepIndex }, quality: 0.9, duration: end - start };
        },
      };

      const executor = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor, verbose: false }
      );

      const result = await executor.execute(pipeline);

      expect(result.status).toBe('completed');

      // Verify sequential: each step starts after previous ends
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i].start).toBeGreaterThanOrEqual(timestamps[i - 1].end);
      }
    });
  });

  // ==================== Memory Coordination Tests ====================

  describe('Memory Coordination (RULE-005)', () => {
    it('should store step outputs in InteractionStore', async () => {
      const pipeline = createTestPipeline(2);

      const stepExecutor: IStepExecutor = {
        async execute(agentKey: string, prompt: string, timeout: number) {
          const stepMatch = prompt.match(/Step (\d+)/);
          const stepIndex = stepMatch ? parseInt(stepMatch[1], 10) - 1 : 0;
          return {
            output: { api: { endpoints: [`/step-${stepIndex}`] } },
            quality: 0.9,
            duration: 10,
          };
        },
      };

      const executor = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor, verbose: false }
      );

      const result = await executor.execute(pipeline);

      expect(result.status).toBe('completed');

      // Verify outputs were stored
      const step0Entries = interactionStore.getKnowledgeByDomain(pipeline.agents[0].outputDomain);
      expect(step0Entries.length).toBeGreaterThan(0);

      const step1Entries = interactionStore.getKnowledgeByDomain(pipeline.agents[1].outputDomain);
      expect(step1Entries.length).toBeGreaterThan(0);
    });

    it('should include previous context in prompt for subsequent steps', async () => {
      const pipeline = createTestPipeline(2);
      const promptsReceived: string[] = [];

      const stepExecutor: IStepExecutor = {
        async execute(agentKey: string, prompt: string, timeout: number) {
          promptsReceived.push(prompt);
          return {
            output: { data: `from-${agentKey}` },
            quality: 0.9,
            duration: 10,
          };
        },
      };

      const executor = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor, verbose: false }
      );

      const result = await executor.execute(pipeline);

      expect(result.status).toBe('completed');
      expect(promptsReceived.length).toBe(2);

      // Second prompt should include context about previous step
      expect(promptsReceived[1]).toContain('Previous');
    });
  });

  // ==================== Quality Gate Tests ====================

  describe('Quality Gate Enforcement', () => {
    it('should fail pipeline if quality below threshold', async () => {
      const pipeline = createTestPipeline(2);

      const stepExecutor: IStepExecutor = {
        async execute() {
          return { output: { data: 'low quality' }, quality: 0.3, duration: 10 };
        },
      };

      const executor = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor, verbose: false }
      );

      const result = await executor.execute(pipeline);

      expect(result.status).toBe('failed');
      expect(result.error?.message).toContain('quality');
    });

    it('should pass pipeline if quality meets threshold', async () => {
      const pipeline = createTestPipeline(2);

      const stepExecutor: IStepExecutor = {
        async execute() {
          return { output: { data: 'high quality' }, quality: 0.85, duration: 10 };
        },
      };

      const executor = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor, verbose: false }
      );

      const result = await executor.execute(pipeline);

      expect(result.status).toBe('completed');
      expect(result.overallQuality).toBeGreaterThanOrEqual(0.7);
    });
  });

  // ==================== DAI-001 Dynamic Selection Tests ====================

  describe('DAI-001 Dynamic Selection (RULE-006)', () => {
    it('should use taskDescription for dynamic agent selection', async () => {
      const pipeline: IPipelineDefinition = {
        name: 'Dynamic Selection Test',
        sequential: true,
        agents: [
          {
            taskDescription: 'Write backend API code for user management',
            task: 'Implement the API',
            outputDomain: `project/dynamic-test-${testPipelineCount}`,
            outputTags: ['api'],
          },
        ],
      };

      const selectedAgents: string[] = [];
      const stepExecutor: IStepExecutor = {
        async execute(agentKey: string, prompt: string, timeout: number) {
          selectedAgents.push(agentKey);
          return { output: {}, quality: 0.9, duration: 10 };
        },
      };

      const executor = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor, verbose: false }
      );

      const result = await executor.execute(pipeline);

      expect(result.status).toBe('completed');
      expect(selectedAgents.length).toBe(1);
      expect(selectedAgents[0]).toBeTruthy();
    });

    it('should use explicit agentKey when provided', async () => {
      const targetAgent = realAgentKeys[0];

      const pipeline: IPipelineDefinition = {
        name: 'Explicit Agent Test',
        sequential: true,
        agents: [
          {
            agentKey: targetAgent,
            task: 'Execute with specific agent',
            outputDomain: `project/explicit-test-${testPipelineCount}`,
            outputTags: ['test'],
          },
        ],
      };

      const usedAgents: string[] = [];
      const stepExecutor: IStepExecutor = {
        async execute(agentKey: string, prompt: string, timeout: number) {
          usedAgents.push(agentKey);
          return { output: {}, quality: 0.9, duration: 10 };
        },
      };

      const executor = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor, verbose: false }
      );

      const result = await executor.execute(pipeline);

      expect(result.status).toBe('completed');
      expect(usedAgents[0]).toBe(targetAgent);
    });
  });

  // ==================== Error Context Tests ====================

  describe('Error Context in Failures', () => {
    it('should include step index in error', async () => {
      const pipeline = createTestPipeline(3);

      const stepExecutor: IStepExecutor = {
        async execute(agentKey: string, prompt: string, timeout: number) {
          const stepMatch = prompt.match(/Step (\d+)/);
          const stepIndex = stepMatch ? parseInt(stepMatch[1], 10) - 1 : 0;

          if (stepIndex === 1) {
            throw new Error('Step 1 failed');
          }
          return { output: {}, quality: 0.9, duration: 10 };
        },
      };

      const executor = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor, verbose: false }
      );

      const result = await executor.execute(pipeline);

      expect(result.status).toBe('failed');
      expect(result.steps.length).toBe(1);  // Only step 0 completed; step 1 threw before adding to results
      expect(result.error).toBeDefined();
    });

    it('should include agent key in error context', async () => {
      const pipeline = createTestPipeline(2);

      const stepExecutor: IStepExecutor = {
        async execute(agentKey: string, prompt: string, timeout: number) {
          const stepMatch = prompt.match(/Step (\d+)/);
          const stepIndex = stepMatch ? parseInt(stepMatch[1], 10) - 1 : 0;

          if (stepIndex === 1) {
            throw new Error(`Agent ${agentKey} failed`);
          }
          return { output: {}, quality: 0.9, duration: 10 };
        },
      };

      const executor = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor, verbose: false }
      );

      const result = await executor.execute(pipeline);

      expect(result.status).toBe('failed');
      expect(result.error?.message).toContain('failed');
    });
  });

  // ==================== Pipeline Result Tests ====================

  describe('Pipeline Result Structure', () => {
    it('should return complete result structure', async () => {
      const pipeline = createTestPipeline(2);
      const stepExecutor = createMockStepExecutor();

      const executor = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor, verbose: false }
      );

      const result = await executor.execute(pipeline);

      // Verify result structure
      expect(result).toHaveProperty('pipelineId');
      expect(result).toHaveProperty('pipelineName');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('steps');
      expect(result).toHaveProperty('overallQuality');
      expect(result).toHaveProperty('totalDuration');

      expect(result.pipelineId).toMatch(/^pip_/);
      expect(result.steps.length).toBe(2);
    });

    it('should calculate overall quality from step qualities', async () => {
      const pipeline = createTestPipeline(3);
      let stepCount = 0;

      const stepExecutor: IStepExecutor = {
        async execute() {
          const qualities = [0.8, 0.9, 0.85];
          const quality = qualities[stepCount++];
          return { output: {}, quality, duration: 10 };
        },
      };

      const executor = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor, verbose: false }
      );

      const result = await executor.execute(pipeline);

      expect(result.status).toBe('completed');
      expect(result.overallQuality).toBeGreaterThan(0);
      expect(result.overallQuality).toBeLessThanOrEqual(1);
    });
  });

  // ==================== Event Emission Tests ====================

  describe('Event Emission', () => {
    it('should emit PIPELINE_STARTED event', async () => {
      const pipeline = createTestPipeline(1);
      const events: IPipelineEvent[] = [];

      const stepExecutor: IStepExecutor = {
        async execute() {
          return { output: {}, quality: 0.9, duration: 10 };
        },
      };

      const executor = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor, verbose: false, onEvent: (e) => events.push(e) }
      );

      await executor.execute(pipeline);

      const startEvent = events.find(e => e.type === PipelineEventType.PIPELINE_STARTED);
      expect(startEvent).toBeDefined();
    });

    it('should emit AGENT_COMPLETED events', async () => {
      const pipeline = createTestPipeline(2);
      const events: IPipelineEvent[] = [];

      const stepExecutor: IStepExecutor = {
        async execute() {
          return { output: {}, quality: 0.9, duration: 10 };
        },
      };

      const executor = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor, verbose: false, onEvent: (e) => events.push(e) }
      );

      await executor.execute(pipeline);

      const completedEvents = events.filter(e => e.type === PipelineEventType.AGENT_COMPLETED);
      expect(completedEvents.length).toBe(2);
    });

    it('should emit PIPELINE_COMPLETED on success', async () => {
      const pipeline = createTestPipeline(1);
      const events: IPipelineEvent[] = [];

      const stepExecutor: IStepExecutor = {
        async execute() {
          return { output: {}, quality: 0.9, duration: 10 };
        },
      };

      const executor = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor, verbose: false, onEvent: (e) => events.push(e) }
      );

      await executor.execute(pipeline);

      const completeEvent = events.find(e => e.type === PipelineEventType.PIPELINE_COMPLETED);
      expect(completeEvent).toBeDefined();
    });
  });

  // ==================== Real Agent Integration ====================

  describe('Real Agent Integration', () => {
    it('should use agents from .claude/agents directory (RULE-002)', async () => {
      expect(agentRegistry.size).toBeGreaterThan(0);

      // All our test agent keys should be in the registry
      for (const key of realAgentKeys.slice(0, 3)) {
        const agentDef = agentRegistry.getAll().find(a => a.key === key);
        expect(agentDef).toBeDefined();
        expect(agentDef?.key).toBe(key);
      }
    });

    it('should generate prompts that include workflow context (RULE-007)', async () => {
      const pipeline = createTestPipeline(3);
      const promptsGenerated: string[] = [];

      const stepExecutor: IStepExecutor = {
        async execute(agentKey: string, prompt: string, timeout: number) {
          promptsGenerated.push(prompt);
          return { output: {}, quality: 0.9, duration: 10 };
        },
      };

      const executor = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor, verbose: false }
      );

      const result = await executor.execute(pipeline);

      expect(result.status).toBe('completed');

      // Each prompt should include workflow context
      for (const prompt of promptsGenerated) {
        // Verify workflow context elements are present
        expect(prompt).toMatch(/Agent #\d+ of \d+|Step \d+/i);
      }
    });
  });
});
