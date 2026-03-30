/**
 * DAI-002: Pipeline Memory Coordinator Tests
 * TASK-004: Tests for PipelineMemoryCoordinator class
 *
 * RULE-002: No mock data - uses real InteractionStore
 * RULE-005: Tests memory coordination via InteractionStore
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  PipelineMemoryCoordinator,
  createPipelineMemoryCoordinator,
  IStoreResult,
  IRetrieveResult,
} from '../../../../src/god-agent/core/pipeline/pipeline-memory-coordinator.js';
import { MemoryCoordinationError } from '../../../../src/god-agent/core/pipeline/pipeline-errors.js';
import type { IPipelineStep } from '../../../../src/god-agent/core/pipeline/dai-002-types.js';
import { InteractionStore } from '../../../../src/god-agent/universal/interaction-store.js';

// ==================== Test Setup ====================

describe('PipelineMemoryCoordinator', () => {
  let interactionStore: InteractionStore;
  let coordinator: PipelineMemoryCoordinator;

  beforeEach(() => {
    // Create a fresh InteractionStore for each test
    interactionStore = new InteractionStore({
      maxInteractions: 1000,
      pruneThreshold: 500,
    });
    coordinator = createPipelineMemoryCoordinator(interactionStore);
  });

  afterEach(() => {
    // Clear the store after each test
    interactionStore.clear();
  });

  // ==================== Factory Function Tests ====================

  describe('createPipelineMemoryCoordinator', () => {
    it('should create a PipelineMemoryCoordinator instance', () => {
      const c = createPipelineMemoryCoordinator(interactionStore);
      expect(c).toBeInstanceOf(PipelineMemoryCoordinator);
    });

    it('should accept optional configuration', () => {
      const c = createPipelineMemoryCoordinator(interactionStore, {
        defaultQuality: 0.9,
        verbose: true,
      });
      expect(c).toBeInstanceOf(PipelineMemoryCoordinator);
    });
  });

  // ==================== storeStepOutput Tests ====================

  describe('storeStepOutput', () => {
    it('should store output and return result', () => {
      const step = createTestStep('project/test');
      const output = { code: 'console.log("test")' };

      const result = coordinator.storeStepOutput(
        step,
        0,
        'pip_123',
        output,
        'backend-dev'
      );

      expect(result.entryId).toMatch(/^pipeline-pip_123-step-0-/);
      expect(result.domain).toBe('project/test');
      expect(result.tags).toContain('pip_123');
      expect(result.tags).toContain('step-0');
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should include step output tags', () => {
      const step = createTestStep('project/api', ['schema', 'endpoints']);
      const output = { endpoints: ['/api/users'] };

      const result = coordinator.storeStepOutput(
        step,
        0,
        'pip_456',
        output,
        'api-designer'
      );

      expect(result.tags).toContain('schema');
      expect(result.tags).toContain('endpoints');
    });

    it('should store data retrievable by domain', () => {
      const step = createTestStep('project/output');
      const output = { data: 'test-data' };

      coordinator.storeStepOutput(step, 0, 'pip_789', output, 'agent-key');

      // Verify it's in the store
      const entries = interactionStore.getKnowledgeByDomain('project/output');
      expect(entries.length).toBe(1);
      expect(entries[0].tags).toContain('pip_789');
    });

    it('should store complex output as JSON', () => {
      const step = createTestStep('project/complex');
      const output = {
        nested: { array: [1, 2, 3], obj: { key: 'value' } },
        count: 42,
        flag: true,
      };

      coordinator.storeStepOutput(step, 0, 'pip_complex', output, 'agent');

      const entries = interactionStore.getKnowledgeByDomain('project/complex');
      const parsed = JSON.parse(entries[0].content);
      expect(parsed.output).toEqual(output);
    });

    it('should store pipeline step metadata', () => {
      const step = createTestStep('project/meta');
      const output = 'simple string output';

      coordinator.storeStepOutput(step, 2, 'pip_meta', output, 'my-agent');

      const entries = interactionStore.getKnowledgeByDomain('project/meta');
      const parsed = JSON.parse(entries[0].content);
      expect(parsed.stepIndex).toBe(2);
      expect(parsed.agentKey).toBe('my-agent');
      expect(parsed.pipelineId).toBe('pip_meta');
      expect(parsed.timestamp).toBeGreaterThan(0);
    });
  });

  // ==================== retrievePreviousOutput Tests ====================

  describe('retrievePreviousOutput', () => {
    it('should return empty for first agent (no inputDomain)', () => {
      const step: IPipelineStep = {
        agentKey: 'first-agent',
        task: 'First task',
        outputDomain: 'project/first',
        outputTags: ['first'],
        // No inputDomain - first agent
      };

      const result = coordinator.retrievePreviousOutput(step, 'pip_123');

      expect(result.entries).toEqual([]);
      expect(result.output).toBeUndefined();
    });

    it('should retrieve stored output by domain and pipeline ID', () => {
      // First store some output
      const step1 = createTestStep('project/output1');
      const output1 = { step1: 'data' };
      coordinator.storeStepOutput(step1, 0, 'pip_ret', output1, 'agent1');

      // Now retrieve it
      const step2: IPipelineStep = {
        agentKey: 'agent2',
        task: 'Second task',
        inputDomain: 'project/output1',
        outputDomain: 'project/output2',
        outputTags: ['test'],
      };

      const result = coordinator.retrievePreviousOutput(step2, 'pip_ret');

      expect(result.entries.length).toBe(1);
      expect(result.output).toEqual(output1);
      expect(result.stepData?.agentKey).toBe('agent1');
    });

    it('should filter by pipeline ID', () => {
      // Store outputs from two different pipelines
      const step = createTestStep('project/shared');
      coordinator.storeStepOutput(step, 0, 'pip_A', { from: 'A' }, 'agent');
      coordinator.storeStepOutput(step, 0, 'pip_B', { from: 'B' }, 'agent');

      // Retrieve for pipeline A only
      const retrieveStep: IPipelineStep = {
        agentKey: 'retriever',
        task: 'Retrieve',
        inputDomain: 'project/shared',
        outputDomain: 'project/out',
        outputTags: ['test'],
      };

      const result = coordinator.retrievePreviousOutput(retrieveStep, 'pip_A');

      expect(result.entries.length).toBe(1);
      expect(result.output).toEqual({ from: 'A' });
    });

    it('should filter by input tags when specified', () => {
      // Store outputs with different tags
      const step1 = createTestStep('project/tagged', ['schema']);
      const step2 = createTestStep('project/tagged', ['code']);
      coordinator.storeStepOutput(step1, 0, 'pip_tag', { type: 'schema' }, 'agent');
      coordinator.storeStepOutput(step2, 1, 'pip_tag', { type: 'code' }, 'agent');

      // Retrieve only schema-tagged entries
      const retrieveStep: IPipelineStep = {
        agentKey: 'retriever',
        task: 'Retrieve',
        inputDomain: 'project/tagged',
        inputTags: ['schema'],
        outputDomain: 'project/out',
        outputTags: ['test'],
      };

      const result = coordinator.retrievePreviousOutput(retrieveStep, 'pip_tag');

      expect(result.entries.length).toBe(1);
      expect(result.output).toEqual({ type: 'schema' });
    });

    it('should return most recent entry when multiple exist', () => {
      const step = createTestStep('project/multiple');

      // Store multiple outputs with delays to ensure different timestamps
      coordinator.storeStepOutput(step, 0, 'pip_multi', { version: 1 }, 'agent');

      // Small delay to ensure different timestamp
      const start = Date.now();
      while (Date.now() - start < 10) {
        // busy wait
      }

      coordinator.storeStepOutput(step, 1, 'pip_multi', { version: 2 }, 'agent');

      const retrieveStep: IPipelineStep = {
        agentKey: 'retriever',
        task: 'Retrieve',
        inputDomain: 'project/multiple',
        outputDomain: 'project/out',
        outputTags: ['test'],
      };

      const result = coordinator.retrievePreviousOutput(retrieveStep, 'pip_multi');

      // Should have 2 entries but output should be from the most recent
      expect(result.entries.length).toBe(2);
      expect(result.output).toEqual({ version: 2 });
    });
  });

  // ==================== retrieveStepOutput Tests ====================

  describe('retrieveStepOutput', () => {
    it('should retrieve output by step index', () => {
      const step = createTestStep('project/steps');

      // Store outputs for multiple steps
      coordinator.storeStepOutput(step, 0, 'pip_steps', { step: 0 }, 'agent');
      coordinator.storeStepOutput(step, 1, 'pip_steps', { step: 1 }, 'agent');
      coordinator.storeStepOutput(step, 2, 'pip_steps', { step: 2 }, 'agent');

      // Retrieve step 1 specifically
      const result = coordinator.retrieveStepOutput('pip_steps', 1, 'project/steps');

      expect(result.entries.length).toBe(1);
      expect(result.output).toEqual({ step: 1 });
      expect(result.stepData?.stepIndex).toBe(1);
    });

    it('should return empty for non-existent step', () => {
      const result = coordinator.retrieveStepOutput('pip_none', 99, 'project/none');

      expect(result.entries).toEqual([]);
      expect(result.output).toBeUndefined();
    });
  });

  // ==================== hasPreviousOutput Tests ====================

  describe('hasPreviousOutput', () => {
    it('should return false for first agent', () => {
      const step: IPipelineStep = {
        agentKey: 'first',
        task: 'Task',
        outputDomain: 'project/out',
        outputTags: ['test'],
      };

      expect(coordinator.hasPreviousOutput(step, 'pip_any')).toBe(false);
    });

    it('should return false when no matching output exists', () => {
      const step: IPipelineStep = {
        agentKey: 'retriever',
        task: 'Task',
        inputDomain: 'project/nonexistent',
        outputDomain: 'project/out',
        outputTags: ['test'],
      };

      expect(coordinator.hasPreviousOutput(step, 'pip_any')).toBe(false);
    });

    it('should return true when output exists', () => {
      // Store output
      const storeStep = createTestStep('project/exists');
      coordinator.storeStepOutput(storeStep, 0, 'pip_has', { data: 'yes' }, 'agent');

      // Check if it exists
      const retrieveStep: IPipelineStep = {
        agentKey: 'retriever',
        task: 'Task',
        inputDomain: 'project/exists',
        outputDomain: 'project/out',
        outputTags: ['test'],
      };

      expect(coordinator.hasPreviousOutput(retrieveStep, 'pip_has')).toBe(true);
    });
  });

  // ==================== getAllPipelineOutputs Tests ====================

  describe('getAllPipelineOutputs', () => {
    it('should return all outputs for a pipeline', () => {
      // Store outputs in different domains
      const step1 = createTestStep('project/plans');
      const step2 = createTestStep('project/implementations');

      coordinator.storeStepOutput(step1, 0, 'pip_all', { phase: 'plan' }, 'planner');
      coordinator.storeStepOutput(step2, 1, 'pip_all', { phase: 'impl' }, 'coder');

      const outputs = coordinator.getAllPipelineOutputs('pip_all');

      expect(outputs.length).toBe(2);
    });

    it('should not return outputs from other pipelines', () => {
      const step = createTestStep('project/plans');

      coordinator.storeStepOutput(step, 0, 'pip_X', { from: 'X' }, 'agent');
      coordinator.storeStepOutput(step, 0, 'pip_Y', { from: 'Y' }, 'agent');

      const outputs = coordinator.getAllPipelineOutputs('pip_X');

      expect(outputs.length).toBe(1);
      expect(JSON.parse(outputs[0].content).output).toEqual({ from: 'X' });
    });
  });

  // ==================== Error Handling ====================

  describe('error handling', () => {
    it('should throw MemoryCoordinationError with context on store failure', () => {
      // Create a coordinator with a store that will fail
      const badStore = {
        addKnowledge: () => {
          throw new Error('Storage failed');
        },
        getKnowledgeByDomain: () => [],
        getStats: () => ({ knowledgeCount: 0, totalInteractions: 0 }),
      } as unknown as InteractionStore;

      const badCoordinator = new PipelineMemoryCoordinator(badStore);
      const step = createTestStep('project/fail');

      expect(() =>
        badCoordinator.storeStepOutput(step, 0, 'pip_fail', {}, 'agent')
      ).toThrow(MemoryCoordinationError);
    });

    it('should include operation type in error', () => {
      const badStore = {
        addKnowledge: () => {
          throw new Error('Storage failed');
        },
      } as unknown as InteractionStore;

      const badCoordinator = new PipelineMemoryCoordinator(badStore);
      const step = createTestStep('project/fail');

      try {
        badCoordinator.storeStepOutput(step, 0, 'pip_fail', {}, 'agent');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(MemoryCoordinationError);
        expect((error as MemoryCoordinationError).context.operation).toBe('store');
      }
    });
  });

  // ==================== Verbose Mode Tests ====================

  describe('verbose mode', () => {
    it('should log when verbose is enabled', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const verboseCoordinator = new PipelineMemoryCoordinator(interactionStore, {
        verbose: true,
      });

      const step = createTestStep('project/verbose');
      verboseCoordinator.storeStepOutput(step, 0, 'pip_verb', {}, 'agent');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Pipeline pip_verb]')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Stored to domain')
      );

      consoleSpy.mockRestore();
    });
  });

  // ==================== RULE-005 Compliance Tests ====================

  describe('RULE-005 compliance (InteractionStore usage)', () => {
    it('should use InteractionStore (not claude-flow) for storage', () => {
      const step = createTestStep('project/rule5');
      const output = { compliance: 'RULE-005' };

      coordinator.storeStepOutput(step, 0, 'pip_rule5', output, 'agent');

      // Verify data is in InteractionStore
      const entries = interactionStore.getKnowledgeByDomain('project/rule5');
      expect(entries.length).toBe(1);

      // Verify format matches InteractionStore knowledge entry
      const entry = entries[0];
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('content');
      expect(entry).toHaveProperty('type');
      expect(entry).toHaveProperty('domain');
      expect(entry).toHaveProperty('tags');
      expect(entry).toHaveProperty('quality');
    });

    it('should preserve data integrity through store/retrieve cycle', () => {
      const step = createTestStep('project/integrity');
      const complexOutput = {
        api: {
          endpoints: ['/users', '/posts'],
          methods: ['GET', 'POST', 'PUT', 'DELETE'],
        },
        schema: {
          types: ['User', 'Post', 'Comment'],
          enums: ['Status', 'Role'],
        },
        count: 12345,
        active: true,
        nullable: null,
      };

      // Store
      coordinator.storeStepOutput(step, 0, 'pip_int', complexOutput, 'agent');

      // Retrieve
      const retrieveStep: IPipelineStep = {
        agentKey: 'retriever',
        task: 'Retrieve',
        inputDomain: 'project/integrity',
        outputDomain: 'project/out',
        outputTags: ['test'],
      };

      const result = coordinator.retrievePreviousOutput(retrieveStep, 'pip_int');

      // Verify integrity
      expect(result.output).toEqual(complexOutput);
    });
  });
});

// ==================== Test Helpers ====================

/**
 * Create a test pipeline step
 */
function createTestStep(outputDomain: string, outputTags: string[] = ['test']): IPipelineStep {
  return {
    agentKey: 'test-agent',
    task: 'Test task',
    outputDomain,
    outputTags,
  };
}

// Import vi for spying
import { vi } from 'vitest';
