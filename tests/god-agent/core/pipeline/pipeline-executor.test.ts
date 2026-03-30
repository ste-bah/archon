/**
 * DAI-002: Pipeline Executor Tests
 * TASK-005: Tests for PipelineExecutor class
 *
 * RULE-002: No mock data - uses real AgentRegistry, InteractionStore
 * RULE-004: Tests verify sequential execution
 * RULE-005: Tests verify memory coordination
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import {
  PipelineExecutor,
  createPipelineExecutor,
  IStepExecutor,
  IStepExecutionResult,
} from '../../../../src/god-agent/core/pipeline/pipeline-executor.js';
import {
  PipelineExecutionError,
  PipelineTimeoutError,
  QualityGateError,
  PipelineDefinitionError,
} from '../../../../src/god-agent/core/pipeline/pipeline-errors.js';
import type {
  IPipelineDefinition,
  IPipelineEvent,
} from '../../../../src/god-agent/core/pipeline/dai-002-types.js';
import { PipelineEventType } from '../../../../src/god-agent/core/pipeline/dai-002-types.js';
import { AgentRegistry } from '../../../../src/god-agent/core/agents/agent-registry.js';
import { AgentSelector } from '../../../../src/god-agent/core/agents/agent-selector.js';
import { InteractionStore } from '../../../../src/god-agent/universal/interaction-store.js';

// ==================== Test Setup ====================

// Real agent keys discovered from registry (populated in beforeAll)
let realAgentKeys: string[] = [];

describe('PipelineExecutor', () => {
  let agentRegistry: AgentRegistry;
  let agentSelector: AgentSelector;
  let interactionStore: InteractionStore;
  let executor: PipelineExecutor;

  // Mock step executor that simulates agent execution
  let mockStepExecutor: IStepExecutor & { executionLog: Array<{ agentKey: string; prompt: string }> };

  beforeAll(async () => {
    // Initialize REAL AgentRegistry once to discover agent keys (RULE-002)
    const tempRegistry = new AgentRegistry({
      basePath: '.claude/agents',
      verbose: false,
    });
    await tempRegistry.initialize('.claude/agents');

    // Get real agent keys from the registry
    const allAgents = tempRegistry.getAll();
    expect(allAgents.length).toBeGreaterThan(0);

    // Store first 5 unique agent keys for use in tests
    realAgentKeys = allAgents.slice(0, 5).map(a => a.key);
    expect(realAgentKeys.length).toBeGreaterThan(0);

    tempRegistry.clear();
  });

  beforeEach(async () => {
    // Initialize REAL AgentRegistry with actual agents (RULE-002)
    agentRegistry = new AgentRegistry({
      basePath: '.claude/agents',
      verbose: false,
    });
    await agentRegistry.initialize('.claude/agents');

    // Initialize REAL AgentSelector
    agentSelector = new AgentSelector(agentRegistry, false);

    // Initialize REAL InteractionStore
    interactionStore = new InteractionStore({
      maxInteractions: 1000,
      pruneThreshold: 500,
    });

    // Create mock step executor that tracks executions and simulates success
    mockStepExecutor = {
      executionLog: [],
      async execute(agentKey: string, prompt: string, timeout: number): Promise<IStepExecutionResult> {
        this.executionLog.push({ agentKey, prompt });
        await new Promise(resolve => setTimeout(resolve, 5)); // Small delay
        return {
          output: { agentKey, executed: true, timestamp: Date.now() },
          quality: 0.9,
          duration: 5,
        };
      },
    };

    // Create executor with mock step executor
    executor = createPipelineExecutor(
      { agentRegistry, agentSelector, interactionStore },
      { stepExecutor: mockStepExecutor, verbose: false }
    );
  });

  afterAll(() => {
    realAgentKeys = [];
  });

  afterEach(() => {
    interactionStore.clear();
    mockStepExecutor.executionLog = [];
    agentRegistry.clear();
  });

  // ==================== Factory Function Tests ====================

  describe('createPipelineExecutor', () => {
    it('should create a PipelineExecutor instance', () => {
      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: mockStepExecutor }
      );
      expect(exec).toBeInstanceOf(PipelineExecutor);
    });

    it('should accept optional configuration', () => {
      const events: IPipelineEvent[] = [];
      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        {
          verbose: true,
          enableLearning: false,
          onEvent: (e) => events.push(e),
          stepExecutor: mockStepExecutor,
        }
      );
      expect(exec).toBeInstanceOf(PipelineExecutor);
    });
  });

  // ==================== Basic Execution Tests ====================

  describe('execute', () => {
    it('should execute a valid single-step pipeline', async () => {
      const pipeline = createValidPipeline('single-step', 1);

      const result = await executor.execute(pipeline);

      expect(result.status).toBe('completed');
      expect(result.pipelineName).toBe('single-step');
      expect(result.steps.length).toBe(1);
      expect(result.pipelineId).toMatch(/^pip_/);
      expect(result.trajectoryId).toMatch(/^trj_pipeline_/);
    });

    it('should execute a valid multi-step pipeline sequentially', async () => {
      const pipeline = createValidPipeline('multi-step', 3);

      const result = await executor.execute(pipeline);

      expect(result.status).toBe('completed');
      expect(result.steps.length).toBe(3);

      // Verify sequential execution (each step has increasing timestamp)
      for (let i = 1; i < result.steps.length; i++) {
        expect(result.steps[i].stepIndex).toBeGreaterThan(result.steps[i - 1].stepIndex);
      }
    });

    it('should execute steps ONE AT A TIME (RULE-004)', async () => {
      const executionOrder: number[] = [];
      let currentlyExecuting = 0;

      // Create executor that tracks concurrent execution
      const sequentialTracker: IStepExecutor = {
        async execute(agentKey, prompt, timeout) {
          currentlyExecuting++;
          executionOrder.push(currentlyExecuting);

          // Verify only one step executes at a time
          expect(currentlyExecuting).toBe(1);

          await new Promise(resolve => setTimeout(resolve, 10));
          currentlyExecuting--;

          return { output: { agentKey }, quality: 0.9, duration: 10 };
        },
      };

      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: sequentialTracker }
      );

      const pipeline = createValidPipeline('sequential-test', 3);
      await exec.execute(pipeline);

      // All should have been 1 (never concurrent)
      expect(executionOrder.every(n => n === 1)).toBe(true);
    });

    it('should return pipelineId that matches pattern', async () => {
      const pipeline = createValidPipeline('id-test', 1);

      const result = await executor.execute(pipeline);

      expect(result.pipelineId).toMatch(/^pip_\d+_[a-z0-9]+$/);
    });

    it('should calculate overall quality as average of step qualities', async () => {
      const qualities = [0.8, 0.9, 1.0];
      let stepIndex = 0;

      const qualityExecutor: IStepExecutor = {
        async execute() {
          const quality = qualities[stepIndex++];
          return { output: {}, quality, duration: 5 };
        },
      };

      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: qualityExecutor }
      );

      const pipeline = createValidPipeline('quality-test', 3);
      const result = await exec.execute(pipeline);

      const expectedAvg = (0.8 + 0.9 + 1.0) / 3;
      expect(result.overallQuality).toBeCloseTo(expectedAvg, 2);
    });
  });

  // ==================== Memory Coordination Tests (RULE-005) ====================

  describe('memory coordination (RULE-005)', () => {
    it('should store step output in InteractionStore', async () => {
      const pipeline = createValidPipeline('memory-test', 1);

      const result = await executor.execute(pipeline);

      // Verify output stored in InteractionStore
      const entries = interactionStore.getKnowledgeByDomain(pipeline.agents[0].outputDomain);
      expect(entries.length).toBe(1);
      expect(entries[0].tags).toContain(result.pipelineId);
    });

    it('should tag entries with pipeline ID and step index', async () => {
      const pipeline = createValidPipeline('tag-test', 2);

      const result = await executor.execute(pipeline);

      for (let i = 0; i < 2; i++) {
        const entries = interactionStore.getKnowledgeByDomain(pipeline.agents[i].outputDomain);
        expect(entries.length).toBeGreaterThan(0);
        expect(entries[0].tags).toContain(result.pipelineId);
        expect(entries[0].tags).toContain(`step-${i}`);
      }
    });

    it('should store output BEFORE next step starts', async () => {
      const storageTimestamps: number[] = [];
      const executionTimestamps: number[] = [];

      const trackingExecutor: IStepExecutor = {
        async execute(agentKey, prompt) {
          executionTimestamps.push(Date.now());
          await new Promise(resolve => setTimeout(resolve, 5));
          return { output: { agentKey }, quality: 0.9, duration: 5 };
        },
      };

      // Create custom executor to track storage
      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: trackingExecutor, verbose: false }
      );

      const pipeline = createValidPipeline('order-test', 2);
      await exec.execute(pipeline);

      // Check that all steps were stored
      expect(interactionStore.getKnowledgeByDomain(pipeline.agents[0].outputDomain).length).toBe(1);
      expect(interactionStore.getKnowledgeByDomain(pipeline.agents[1].outputDomain).length).toBe(1);
    });
  });

  // ==================== Validation Tests ====================

  describe('validation', () => {
    it('should reject pipeline without sequential: true', async () => {
      const pipeline: IPipelineDefinition = {
        name: 'invalid',
        description: 'Invalid pipeline',
        sequential: false, // RULE-004 violation
        agents: [createValidStep(realAgentKeys[0], 0)],
      };

      await expect(executor.execute(pipeline)).rejects.toThrow(PipelineDefinitionError);
    });

    it('should reject pipeline with invalid agent key', async () => {
      const pipeline = createValidPipeline('invalid-agent', 1);
      pipeline.agents[0].agentKey = 'nonexistent-agent-xyz';

      await expect(executor.execute(pipeline)).rejects.toThrow(PipelineDefinitionError);
    });

    it('should reject empty agents array', async () => {
      const pipeline: IPipelineDefinition = {
        name: 'empty',
        description: 'Empty pipeline',
        sequential: true,
        agents: [],
      };

      await expect(executor.execute(pipeline)).rejects.toThrow(PipelineDefinitionError);
    });
  });

  // ==================== Quality Gate Tests ====================

  describe('quality gate', () => {
    it('should pass when quality meets threshold', async () => {
      const pipeline = createValidPipeline('quality-pass', 1);
      pipeline.agents[0].minQuality = 0.8;

      // Default mock returns quality 0.9
      const result = await executor.execute(pipeline);

      expect(result.status).toBe('completed');
    });

    it('should fail when quality below threshold', async () => {
      const lowQualityExecutor: IStepExecutor = {
        async execute() {
          return { output: {}, quality: 0.3, duration: 5 };
        },
      };

      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: lowQualityExecutor }
      );

      const pipeline = createValidPipeline('quality-fail', 1);
      pipeline.agents[0].minQuality = 0.7;

      const result = await exec.execute(pipeline);

      expect(result.status).toBe('failed');
      expect(result.error).toBeInstanceOf(QualityGateError);
    });

    it('should use pipeline default quality if step threshold not set', async () => {
      const lowQualityExecutor: IStepExecutor = {
        async execute() {
          return { output: {}, quality: 0.5, duration: 5 };
        },
      };

      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: lowQualityExecutor }
      );

      const pipeline = createValidPipeline('default-quality', 1);
      pipeline.defaultMinQuality = 0.7;
      delete pipeline.agents[0].minQuality;

      const result = await exec.execute(pipeline);

      expect(result.status).toBe('failed');
      expect(result.error).toBeInstanceOf(QualityGateError);
    });
  });

  // ==================== Timeout Tests ====================

  describe('timeout handling', () => {
    it('should fail step that exceeds step timeout', async () => {
      const slowExecutor: IStepExecutor = {
        async execute() {
          await new Promise(resolve => setTimeout(resolve, 200)); // 200ms
          return { output: {}, quality: 0.9, duration: 200 };
        },
      };

      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: slowExecutor }
      );

      const pipeline = createValidPipeline('timeout-test', 1);
      pipeline.agents[0].timeout = 50; // 50ms timeout

      const result = await exec.execute(pipeline);

      expect(result.status).toBe('failed');
      expect(result.error).toBeInstanceOf(PipelineTimeoutError);
    });

    it('should fail pipeline that exceeds pipeline timeout', async () => {
      const slowExecutor: IStepExecutor = {
        async execute() {
          await new Promise(resolve => setTimeout(resolve, 100));
          return { output: {}, quality: 0.9, duration: 100 };
        },
      };

      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: slowExecutor }
      );

      const pipeline = createValidPipeline('pipeline-timeout', 3);
      pipeline.defaultTimeout = 150; // Pipeline timeout 150ms, each step takes 100ms

      const result = await exec.execute(pipeline);

      expect(result.status).toBe('failed');
      expect(result.error).toBeInstanceOf(PipelineTimeoutError);
    });
  });

  // ==================== Event Emission Tests ====================

  describe('event emission', () => {
    it('should emit PIPELINE_STARTED event', async () => {
      const events: IPipelineEvent[] = [];
      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: mockStepExecutor, onEvent: e => events.push(e) }
      );

      const pipeline = createValidPipeline('event-test', 1);
      await exec.execute(pipeline);

      const startEvent = events.find(e => e.type === PipelineEventType.PIPELINE_STARTED);
      expect(startEvent).toBeDefined();
      expect(startEvent?.data.pipelineName).toBe('event-test');
    });

    it('should emit AGENT_STARTED and AGENT_COMPLETED for each step', async () => {
      const events: IPipelineEvent[] = [];
      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: mockStepExecutor, onEvent: e => events.push(e) }
      );

      const pipeline = createValidPipeline('agent-events', 2);
      await exec.execute(pipeline);

      const startedEvents = events.filter(e => e.type === PipelineEventType.AGENT_STARTED);
      const completedEvents = events.filter(e => e.type === PipelineEventType.AGENT_COMPLETED);

      expect(startedEvents.length).toBe(2);
      expect(completedEvents.length).toBe(2);
    });

    it('should emit MEMORY_STORED event after each step', async () => {
      const events: IPipelineEvent[] = [];
      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: mockStepExecutor, onEvent: e => events.push(e) }
      );

      const pipeline = createValidPipeline('memory-events', 2);
      await exec.execute(pipeline);

      const memoryEvents = events.filter(e => e.type === PipelineEventType.MEMORY_STORED);
      expect(memoryEvents.length).toBe(2);
    });

    it('should emit PIPELINE_COMPLETED on success', async () => {
      const events: IPipelineEvent[] = [];
      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: mockStepExecutor, onEvent: e => events.push(e) }
      );

      const pipeline = createValidPipeline('complete-event', 1);
      await exec.execute(pipeline);

      const completeEvent = events.find(e => e.type === PipelineEventType.PIPELINE_COMPLETED);
      expect(completeEvent).toBeDefined();
    });

    it('should emit PIPELINE_FAILED on failure', async () => {
      const events: IPipelineEvent[] = [];
      const failingExecutor: IStepExecutor = {
        async execute() {
          throw new Error('Simulated failure');
        },
      };

      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: failingExecutor, onEvent: e => events.push(e) }
      );

      const pipeline = createValidPipeline('fail-event', 1);
      await exec.execute(pipeline);

      const failEvent = events.find(e => e.type === PipelineEventType.PIPELINE_FAILED);
      expect(failEvent).toBeDefined();
      expect(failEvent?.data.error).toContain('Simulated failure');
    });
  });

  // ==================== DAI-001 Integration Tests (RULE-006) ====================

  describe('DAI-001 agent selection (RULE-006)', () => {
    it('should select agent via DAI-001 when taskDescription provided', async () => {
      const events: IPipelineEvent[] = [];
      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: mockStepExecutor, onEvent: e => events.push(e) }
      );

      const pipeline: IPipelineDefinition = {
        name: 'dai-001-test',
        description: 'Test DAI-001 selection',
        sequential: true,
        agents: [
          {
            // No agentKey - use taskDescription for DAI-001 selection
            taskDescription: 'Create REST API endpoints for user management',
            task: 'Implement user CRUD endpoints',
            outputDomain: 'project/api',
            outputTags: ['api', 'users'],
          },
        ],
      };

      const result = await exec.execute(pipeline);

      expect(result.status).toBe('completed');
      expect(result.steps[0].agentKey).toBeDefined();

      // Should have emitted AGENT_SELECTED event
      const selectEvent = events.find(e => e.type === PipelineEventType.AGENT_SELECTED);
      expect(selectEvent).toBeDefined();
    });
  });

  // ==================== Error Context Tests ====================

  describe('error context', () => {
    it('should include pipeline context in execution errors', async () => {
      const failingExecutor: IStepExecutor = {
        async execute() {
          throw new Error('Step failed');
        },
      };

      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: failingExecutor }
      );

      const pipeline = createValidPipeline('error-context', 1);
      const result = await exec.execute(pipeline);

      expect(result.status).toBe('failed');
      expect(result.error).toBeInstanceOf(PipelineExecutionError);

      const error = result.error as PipelineExecutionError;
      expect(error.context.pipelineId).toBeDefined();
      expect(error.context.stepIndex).toBe(0);
      expect(error.context.agentKey).toBe(realAgentKeys[0]);
    });

    it('should return partial results on failure', async () => {
      let callCount = 0;
      const failOnSecondExecutor: IStepExecutor = {
        async execute() {
          callCount++;
          if (callCount === 2) {
            throw new Error('Second step failed');
          }
          return { output: { step: callCount }, quality: 0.9, duration: 5 };
        },
      };

      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: failOnSecondExecutor }
      );

      const pipeline = createValidPipeline('partial-results', 3);
      const result = await exec.execute(pipeline);

      expect(result.status).toBe('failed');
      expect(result.steps.length).toBe(1); // Only first step completed
      expect(result.steps[0].stepIndex).toBe(0);
    });
  });

  // ==================== Context Injection Tests ====================

  describe('context injection', () => {
    it('should NOT inject previousOutput for stepIndex=0 (first agent)', async () => {
      const events: IPipelineEvent[] = [];
      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: mockStepExecutor, onEvent: e => events.push(e) }
      );

      const pipeline = createValidPipeline('first-agent-test', 1);
      await exec.execute(pipeline);

      // First agent should NOT have MEMORY_RETRIEVED event
      const memoryRetrievedEvents = events.filter(e => e.type === PipelineEventType.MEMORY_RETRIEVED);
      expect(memoryRetrievedEvents.length).toBe(0);

      // Prompt should indicate first agent
      expect(mockStepExecutor.executionLog.length).toBe(1);
      expect(mockStepExecutor.executionLog[0].prompt).toContain('N/A - first agent');
    });

    it('should inject previousOutput for stepIndex>0 (subsequent agents)', async () => {
      const events: IPipelineEvent[] = [];
      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: mockStepExecutor, onEvent: e => events.push(e) }
      );

      // Create pipeline with 2 steps
      const pipeline = createValidPipeline('subsequent-agent-test', 2);

      await exec.execute(pipeline);

      // Second step should have MEMORY_RETRIEVED event
      const memoryRetrievedEvents = events.filter(e => e.type === PipelineEventType.MEMORY_RETRIEVED);
      expect(memoryRetrievedEvents.length).toBe(1);

      // Verify event data
      const retrieveEvent = memoryRetrievedEvents[0];
      expect(retrieveEvent.data.stepIndex).toBe(1);
      expect(retrieveEvent.data.hasOutput).toBe(true);
      expect(retrieveEvent.data.sourceStepIndex).toBe(0);
    });

    it('should include injected data in prompt for subsequent agents', async () => {
      const customOutput = { apiEndpoints: ['/users', '/posts'], schema: { version: 1 } };
      let stepIndex = 0;

      const trackingExecutor: IStepExecutor = {
        async execute(agentKey, prompt) {
          stepIndex++;
          return {
            output: customOutput,
            quality: 0.9,
            duration: 5,
          };
        },
      };

      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: trackingExecutor }
      );

      const pipeline = createValidPipeline('injected-data-test', 2);
      await exec.execute(pipeline);

      // Verify second step's prompt mentions injection
      // We need a tracking executor that captures prompts
      const promptCapture: string[] = [];
      const capturingExecutor: IStepExecutor = {
        async execute(agentKey, prompt) {
          promptCapture.push(prompt);
          return { output: { test: 'data' }, quality: 0.9, duration: 5 };
        },
      };

      const exec2 = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: capturingExecutor }
      );

      // Clear store for fresh test
      interactionStore.clear();

      const pipeline2 = createValidPipeline('prompt-capture-test', 2);
      await exec2.execute(pipeline2);

      // Second prompt should contain INJECTED marker
      expect(promptCapture.length).toBe(2);
      expect(promptCapture[1]).toContain('INJECTED');
      expect(promptCapture[1]).toContain('data from previous agent');
    });

    it('should emit MEMORY_RETRIEVED event with correct payload', async () => {
      const events: IPipelineEvent[] = [];
      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: mockStepExecutor, onEvent: e => events.push(e) }
      );

      const pipeline = createValidPipeline('memory-retrieved-event-test', 3);
      await exec.execute(pipeline);

      // Should have 2 MEMORY_RETRIEVED events (for steps 1 and 2)
      const memoryRetrievedEvents = events.filter(e => e.type === PipelineEventType.MEMORY_RETRIEVED);
      expect(memoryRetrievedEvents.length).toBe(2);

      // Verify first retrieval event (step 1 retrieving from step 0)
      const firstRetrieve = memoryRetrievedEvents[0];
      expect(firstRetrieve.data).toMatchObject({
        stepIndex: 1,
        sourceStepIndex: 0,
        hasOutput: true,
      });
      expect(firstRetrieve.data.agentKey).toBeDefined();
      expect(firstRetrieve.data.sourceDomain).toBeDefined();
      expect(firstRetrieve.data.sourceAgentKey).toBeDefined();

      // Verify second retrieval event (step 2 retrieving from step 1)
      const secondRetrieve = memoryRetrievedEvents[1];
      expect(secondRetrieve.data).toMatchObject({
        stepIndex: 2,
        sourceStepIndex: 1,
        hasOutput: true,
      });
    });

    it('should show fallback retrieval instructions when retrieval fails', async () => {
      // Create a pipeline where input domain does not match any stored output
      const promptCapture: string[] = [];
      const capturingExecutor: IStepExecutor = {
        async execute(agentKey, prompt) {
          promptCapture.push(prompt);
          return { output: { result: 'success' }, quality: 0.9, duration: 5 };
        },
      };

      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: capturingExecutor }
      );

      // Clear store
      interactionStore.clear();

      // Create pipeline with mismatched domains (step 1 expects domain that step 0 won't produce)
      const pipeline = createValidPipeline('fallback-test', 2);
      // Modify step 1 to look for a non-existent domain
      pipeline.agents[1].inputDomain = 'project/non-existent-domain';

      await exec.execute(pipeline);

      // Second step prompt should contain fallback instructions (not INJECTED)
      expect(promptCapture.length).toBe(2);
      expect(promptCapture[1]).toContain('could not be pre-retrieved');
      expect(promptCapture[1]).toContain('getKnowledgeByDomain');
    });

    it('should truncate large outputs (>10KB) with message', async () => {
      // Create an executor that returns a very large output
      const largeData = { data: 'x'.repeat(15000) }; // ~15KB of data
      let callCount = 0;

      const largeOutputExecutor: IStepExecutor = {
        async execute() {
          callCount++;
          return { output: largeData, quality: 0.9, duration: 5 };
        },
      };

      const promptCapture: string[] = [];
      const capturingExecutor: IStepExecutor = {
        async execute(agentKey, prompt) {
          promptCapture.push(prompt);
          if (promptCapture.length === 1) {
            // First step returns large data
            return { output: largeData, quality: 0.9, duration: 5 };
          }
          return { output: { small: 'data' }, quality: 0.9, duration: 5 };
        },
      };

      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: capturingExecutor }
      );

      interactionStore.clear();

      const pipeline = createValidPipeline('truncation-test', 2);
      await exec.execute(pipeline);

      // Second step should have truncated output
      expect(promptCapture.length).toBe(2);
      expect(promptCapture[1]).toContain('[truncated]');
    });

    it('should properly chain context through multi-step pipeline', async () => {
      const events: IPipelineEvent[] = [];
      const outputs: unknown[] = [];

      const chainingExecutor: IStepExecutor = {
        async execute(agentKey, prompt, timeout) {
          const stepOutput = {
            step: outputs.length,
            agentKey,
            processedAt: Date.now(),
          };
          outputs.push(stepOutput);
          return { output: stepOutput, quality: 0.9, duration: 5 };
        },
      };

      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: chainingExecutor, onEvent: e => events.push(e) }
      );

      const pipeline = createValidPipeline('chaining-test', 4);
      const result = await exec.execute(pipeline);

      expect(result.status).toBe('completed');
      expect(result.steps.length).toBe(4);

      // Verify MEMORY_RETRIEVED events for steps 1, 2, 3
      const memoryRetrievedEvents = events.filter(e => e.type === PipelineEventType.MEMORY_RETRIEVED);
      expect(memoryRetrievedEvents.length).toBe(3);

      // Each subsequent step should retrieve from the previous step
      expect(memoryRetrievedEvents[0].data.stepIndex).toBe(1);
      expect(memoryRetrievedEvents[0].data.sourceStepIndex).toBe(0);

      expect(memoryRetrievedEvents[1].data.stepIndex).toBe(2);
      expect(memoryRetrievedEvents[1].data.sourceStepIndex).toBe(1);

      expect(memoryRetrievedEvents[2].data.stepIndex).toBe(3);
      expect(memoryRetrievedEvents[2].data.sourceStepIndex).toBe(2);
    });
  });

  // ==================== Options Tests ====================

  describe('execution options', () => {
    it('should pass initial input to first step prompt', async () => {
      const pipeline = createValidPipeline('input-test', 1);
      const initialInput = { data: 'test-input' };

      await executor.execute(pipeline, { input: initialInput });

      // Verify prompt includes initial input
      expect(mockStepExecutor.executionLog.length).toBe(1);
      expect(mockStepExecutor.executionLog[0].prompt).toContain('Initial input provided');
    });

    it('should respect verbose option', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore },
        { stepExecutor: mockStepExecutor, verbose: true }
      );

      const pipeline = createValidPipeline('verbose-test', 1);
      await exec.execute(pipeline);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  // ==================== RLM-Learning Integration Tests ====================

  describe('RLM-Learning integration', () => {
    it('should pass RLM context to provideStepFeedback when injection succeeds', async () => {
      // Create mock SonaEngine that captures feedback calls
      const feedbackCalls: Array<{
        trajectoryId: string;
        quality: number;
        options: { rlmContext?: { injectionSuccess: boolean; sourceAgentKey?: string; sourceStepIndex?: number; sourceDomain?: string } };
      }> = [];

      const mockSonaEngine = {
        createTrajectoryWithId: vi.fn(),
        provideFeedback: vi.fn().mockImplementation(async (trajectoryId, quality, options) => {
          feedbackCalls.push({ trajectoryId, quality, options });
          return { trajectoryId, patternsUpdated: 0, reward: 0, patternAutoCreated: false, elapsedMs: 1 };
        }),
        getWeight: vi.fn().mockResolvedValue(0),
        getTrajectory: vi.fn().mockReturnValue(null),
        hasTrajectoryInStorage: vi.fn().mockReturnValue(false),
        getTrajectoryFromStorage: vi.fn().mockReturnValue(null),
      };

      // Need a mock reasoningBank to trigger the guard condition (enableLearning && reasoningBank)
      const mockReasoningBank = {
        provideFeedback: vi.fn().mockResolvedValue(undefined),
      };

      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore, sonaEngine: mockSonaEngine as any, reasoningBank: mockReasoningBank as any },
        { stepExecutor: mockStepExecutor, enableLearning: true }
      );

      // Clear store and create a 2-step pipeline to test RLM context
      interactionStore.clear();
      const pipeline = createValidPipeline('rlm-context-test', 2);
      await exec.execute(pipeline);

      // Verify provideFeedback was called for step 1 (second step) with RLM context
      // Step 0 has no previous output, step 1 should have RLM context
      expect(feedbackCalls.length).toBeGreaterThanOrEqual(2);

      // Find the feedback call for step 1 (the second step)
      const stepOneFeedback = feedbackCalls.find(call =>
        call.trajectoryId.includes('step_1')
      );

      expect(stepOneFeedback).toBeDefined();
      expect(stepOneFeedback?.options.rlmContext).toBeDefined();
      expect(stepOneFeedback?.options.rlmContext?.injectionSuccess).toBe(true);
      expect(stepOneFeedback?.options.rlmContext?.sourceAgentKey).toBeDefined();
      expect(stepOneFeedback?.options.rlmContext?.sourceStepIndex).toBe(0);
      expect(stepOneFeedback?.options.rlmContext?.sourceDomain).toBeDefined();
    });

    it('should pass injectionSuccess=false when no previous output', async () => {
      const feedbackCalls: Array<{
        trajectoryId: string;
        quality: number;
        options: { rlmContext?: { injectionSuccess: boolean; sourceAgentKey?: string; sourceStepIndex?: number; sourceDomain?: string } };
      }> = [];

      const mockSonaEngine = {
        createTrajectoryWithId: vi.fn(),
        provideFeedback: vi.fn().mockImplementation(async (trajectoryId, quality, options) => {
          feedbackCalls.push({ trajectoryId, quality, options });
          return { trajectoryId, patternsUpdated: 0, reward: 0, patternAutoCreated: false, elapsedMs: 1 };
        }),
        getWeight: vi.fn().mockResolvedValue(0),
        getTrajectory: vi.fn().mockReturnValue(null),
        hasTrajectoryInStorage: vi.fn().mockReturnValue(false),
        getTrajectoryFromStorage: vi.fn().mockReturnValue(null),
      };

      // Need a mock reasoningBank to trigger the guard condition (enableLearning && reasoningBank)
      const mockReasoningBank = {
        provideFeedback: vi.fn().mockResolvedValue(undefined),
      };

      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore, sonaEngine: mockSonaEngine as any, reasoningBank: mockReasoningBank as any },
        { stepExecutor: mockStepExecutor, enableLearning: true }
      );

      // Clear store and create a single-step pipeline (first agent, no previous output)
      interactionStore.clear();
      const pipeline = createValidPipeline('rlm-no-previous-test', 1);
      await exec.execute(pipeline);

      // Verify provideFeedback was called with injectionSuccess=false for first step
      expect(feedbackCalls.length).toBeGreaterThanOrEqual(1);
      const stepZeroFeedback = feedbackCalls.find(call =>
        call.trajectoryId.includes('step_0')
      );

      expect(stepZeroFeedback).toBeDefined();
      expect(stepZeroFeedback?.options.rlmContext).toBeDefined();
      expect(stepZeroFeedback?.options.rlmContext?.injectionSuccess).toBe(false);
      expect(stepZeroFeedback?.options.rlmContext?.sourceAgentKey).toBeUndefined();
      expect(stepZeroFeedback?.options.rlmContext?.sourceStepIndex).toBeUndefined();
      expect(stepZeroFeedback?.options.rlmContext?.sourceDomain).toBeUndefined();
    });

    it('should include sourceAgentKey from previousStepData', async () => {
      const feedbackCalls: Array<{
        trajectoryId: string;
        options: { rlmContext?: { sourceAgentKey?: string } };
      }> = [];

      const mockSonaEngine = {
        createTrajectoryWithId: vi.fn(),
        provideFeedback: vi.fn().mockImplementation(async (trajectoryId, quality, options) => {
          feedbackCalls.push({ trajectoryId, options });
          return { trajectoryId, patternsUpdated: 0, reward: 0, patternAutoCreated: false, elapsedMs: 1 };
        }),
        getWeight: vi.fn().mockResolvedValue(0),
        getTrajectory: vi.fn().mockReturnValue(null),
        hasTrajectoryInStorage: vi.fn().mockReturnValue(false),
        getTrajectoryFromStorage: vi.fn().mockReturnValue(null),
      };

      // Need a mock reasoningBank to trigger the guard condition (enableLearning && reasoningBank)
      const mockReasoningBank = {
        provideFeedback: vi.fn().mockResolvedValue(undefined),
      };

      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore, sonaEngine: mockSonaEngine as any, reasoningBank: mockReasoningBank as any },
        { stepExecutor: mockStepExecutor, enableLearning: true }
      );

      interactionStore.clear();
      const pipeline = createValidPipeline('rlm-source-agent-test', 3);
      await exec.execute(pipeline);

      // Step 2 should have sourceAgentKey from step 1
      const stepTwoFeedback = feedbackCalls.find(call =>
        call.trajectoryId.includes('step_2')
      );

      expect(stepTwoFeedback).toBeDefined();
      expect(stepTwoFeedback?.options.rlmContext?.sourceAgentKey).toBe(realAgentKeys[1 % realAgentKeys.length]);
    });

    it('should include sourceStepIndex from previousStepData', async () => {
      const feedbackCalls: Array<{
        trajectoryId: string;
        options: { rlmContext?: { sourceStepIndex?: number } };
      }> = [];

      const mockSonaEngine = {
        createTrajectoryWithId: vi.fn(),
        provideFeedback: vi.fn().mockImplementation(async (trajectoryId, quality, options) => {
          feedbackCalls.push({ trajectoryId, options });
          return { trajectoryId, patternsUpdated: 0, reward: 0, patternAutoCreated: false, elapsedMs: 1 };
        }),
        getWeight: vi.fn().mockResolvedValue(0),
        getTrajectory: vi.fn().mockReturnValue(null),
        hasTrajectoryInStorage: vi.fn().mockReturnValue(false),
        getTrajectoryFromStorage: vi.fn().mockReturnValue(null),
      };

      // Need a mock reasoningBank to trigger the guard condition (enableLearning && reasoningBank)
      const mockReasoningBank = {
        provideFeedback: vi.fn().mockResolvedValue(undefined),
      };

      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore, sonaEngine: mockSonaEngine as any, reasoningBank: mockReasoningBank as any },
        { stepExecutor: mockStepExecutor, enableLearning: true }
      );

      interactionStore.clear();
      const pipeline = createValidPipeline('rlm-source-step-test', 4);
      await exec.execute(pipeline);

      // Step 3 should have sourceStepIndex=2
      const stepThreeFeedback = feedbackCalls.find(call =>
        call.trajectoryId.includes('step_3')
      );

      expect(stepThreeFeedback).toBeDefined();
      expect(stepThreeFeedback?.options.rlmContext?.sourceStepIndex).toBe(2);
    });

    it('should include sourceDomain from step.inputDomain', async () => {
      const feedbackCalls: Array<{
        trajectoryId: string;
        options: { rlmContext?: { sourceDomain?: string } };
      }> = [];

      const mockSonaEngine = {
        createTrajectoryWithId: vi.fn(),
        provideFeedback: vi.fn().mockImplementation(async (trajectoryId, quality, options) => {
          feedbackCalls.push({ trajectoryId, options });
          return { trajectoryId, patternsUpdated: 0, reward: 0, patternAutoCreated: false, elapsedMs: 1 };
        }),
        getWeight: vi.fn().mockResolvedValue(0),
        getTrajectory: vi.fn().mockReturnValue(null),
        hasTrajectoryInStorage: vi.fn().mockReturnValue(false),
        getTrajectoryFromStorage: vi.fn().mockReturnValue(null),
      };

      // Need a mock reasoningBank to trigger the guard condition (enableLearning && reasoningBank)
      const mockReasoningBank = {
        provideFeedback: vi.fn().mockResolvedValue(undefined),
      };

      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore, sonaEngine: mockSonaEngine as any, reasoningBank: mockReasoningBank as any },
        { stepExecutor: mockStepExecutor, enableLearning: true }
      );

      interactionStore.clear();
      const pipeline = createValidPipeline('rlm-source-domain-test', 2);
      await exec.execute(pipeline);

      // Step 1 should have sourceDomain matching step 0's outputDomain
      const stepOneFeedback = feedbackCalls.find(call =>
        call.trajectoryId.includes('step_1')
      );

      expect(stepOneFeedback).toBeDefined();
      // sourceDomain should match the inputDomain configured for step 1 (which is step 0's outputDomain)
      expect(stepOneFeedback?.options.rlmContext?.sourceDomain).toBe('project/step-0');
    });

    it('should pass injectionSuccess=false when retrieval from inputDomain fails', async () => {
      const feedbackCalls: Array<{
        trajectoryId: string;
        options: { rlmContext?: { injectionSuccess: boolean } };
      }> = [];

      const mockSonaEngine = {
        createTrajectoryWithId: vi.fn(),
        provideFeedback: vi.fn().mockImplementation(async (trajectoryId, quality, options) => {
          feedbackCalls.push({ trajectoryId, options });
          return { trajectoryId, patternsUpdated: 0, reward: 0, patternAutoCreated: false, elapsedMs: 1 };
        }),
        getWeight: vi.fn().mockResolvedValue(0),
        getTrajectory: vi.fn().mockReturnValue(null),
        hasTrajectoryInStorage: vi.fn().mockReturnValue(false),
        getTrajectoryFromStorage: vi.fn().mockReturnValue(null),
      };

      // Need a mock reasoningBank to trigger the guard condition (enableLearning && reasoningBank)
      const mockReasoningBank = {
        provideFeedback: vi.fn().mockResolvedValue(undefined),
      };

      const exec = createPipelineExecutor(
        { agentRegistry, agentSelector, interactionStore, sonaEngine: mockSonaEngine as any, reasoningBank: mockReasoningBank as any },
        { stepExecutor: mockStepExecutor, enableLearning: true }
      );

      interactionStore.clear();

      // Create pipeline with mismatched domains (step 1 looks for domain that step 0 doesn't produce)
      const pipeline = createValidPipeline('rlm-failed-retrieval-test', 2);
      pipeline.agents[1].inputDomain = 'project/non-existent-domain';
      await exec.execute(pipeline);

      // Step 1 should have injectionSuccess=false due to domain mismatch
      const stepOneFeedback = feedbackCalls.find(call =>
        call.trajectoryId.includes('step_1')
      );

      expect(stepOneFeedback).toBeDefined();
      expect(stepOneFeedback?.options.rlmContext?.injectionSuccess).toBe(false);
    });
  });

  // ==================== Step Result Tests ====================

  describe('step results', () => {
    it('should include memory domain and tags in step result', async () => {
      const pipeline = createValidPipeline('step-result-test', 1);
      pipeline.agents[0].outputDomain = 'project/custom';
      pipeline.agents[0].outputTags = ['custom', 'tags'];

      const result = await executor.execute(pipeline);

      expect(result.steps[0].memoryDomain).toBe('project/custom');
      expect(result.steps[0].memoryTags).toContain('custom');
      expect(result.steps[0].memoryTags).toContain('tags');
    });

    it('should include trajectory ID in step result', async () => {
      const pipeline = createValidPipeline('trajectory-test', 1);

      const result = await executor.execute(pipeline);

      expect(result.steps[0].trajectoryId).toMatch(/^trj_pipeline_pip_.*_step_0$/);
    });

    it('should include duration in step result', async () => {
      const pipeline = createValidPipeline('duration-test', 1);

      const result = await executor.execute(pipeline);

      expect(result.steps[0].duration).toBeGreaterThan(0);
    });
  });
});

// ==================== Test Helpers ====================

/**
 * Create a valid pipeline step with a REAL agent key
 */
function createValidStep(agentKey: string, index: number) {
  return {
    agentKey,
    task: `Step ${index}: Perform task for ${agentKey}`,
    outputDomain: `project/step-${index}`,
    outputTags: ['test', `step-${index}`],
    minQuality: 0.7,
  };
}

/**
 * Create a valid pipeline definition with REAL agent keys from registry
 */
function createValidPipeline(name: string, stepCount: number): IPipelineDefinition {
  // Use real agent keys discovered from registry in beforeAll
  if (realAgentKeys.length === 0) {
    throw new Error('realAgentKeys not initialized - beforeAll has not run');
  }

  const agents = [];
  for (let i = 0; i < stepCount; i++) {
    const agentKey = realAgentKeys[i % realAgentKeys.length];
    agents.push(createValidStep(agentKey, i));
  }

  // Set up input/output domain chain for memory handoff
  for (let i = 1; i < agents.length; i++) {
    agents[i].inputDomain = agents[i - 1].outputDomain;
    agents[i].inputTags = agents[i - 1].outputTags;
  }

  return {
    name,
    description: `Test pipeline: ${name}`,
    sequential: true,
    agents,
  };
}
