/**
 * Relay Race Orchestrator Unit Tests
 * TASK-ORC-001 - Sequential Agent Orchestration
 *
 * Tests cover:
 * - Pipeline validation
 * - Sequential agent execution
 * - Memory key passing
 * - Wait gates (blocking until storage confirmed)
 * - Quality gate validation
 * - Event emission
 * - Error handling
 *
 * Validation Criteria from TASK-ORC-001:
 * - runPipeline() executes agents in sequence
 * - runPipeline() blocks next agent until current agent confirms storage
 * - spawnAgent() builds prompt with memory key injection
 * - validatePipelineDefinition() enforces sequential=true by default
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RelayRaceOrchestrator,
  MockAgentExecutor,
  PipelineValidationError,
  AgentExecutionError,
  MemoryKeyError,
  QualityGateError,
  generatePipelineID,
  isValidPipelineID,
  validatePipelineDefinition,
  validateAgentDefinition,
  validateMemoryKeyChain,
  buildAgentPrompt,
  formatAgentPosition,
  parseAgentPosition,
  validateQualityGate,
  serializeMap,
  deserializeMap,
  DEFAULT_NAMESPACE,
  DEFAULT_AGENT_TIMEOUT,
  MAX_PIPELINE_AGENTS,
} from '../../../../src/god-agent/core/orchestration/index.js';
import type {
  IAgentDefinition,
  IPipelineDefinition,
  IPipelineEvent,
} from '../../../../src/god-agent/core/orchestration/index.js';

// ==================== Test Fixtures ====================

function createTestAgent(overrides: Partial<IAgentDefinition> = {}): IAgentDefinition {
  return {
    agentName: 'Test Agent',
    position: 'Agent #1/1',
    phase: 'Test Phase',
    previousKey: null,
    outputKey: 'test-output',
    task: 'Perform test task',
    qualityGate: 'Must produce non-empty output',
    ...overrides,
  };
}

function createTestPipeline(agents: IAgentDefinition[], overrides: Partial<IPipelineDefinition> = {}): IPipelineDefinition {
  return {
    name: 'Test Pipeline',
    description: 'A test pipeline',
    agents,
    sequential: true,
    ...overrides,
  };
}

function createMockMemoryEngine() {
  const storage = new Map<string, string>();
  return {
    store: vi.fn(async (key: string, content: string) => {
      storage.set(key, content);
    }),
    retrieve: vi.fn(async (key: string) => {
      return storage.get(key) || null;
    }),
    _storage: storage,
  };
}

// ==================== ID Generation Tests ====================

describe('Pipeline ID Generation', () => {
  describe('generatePipelineID', () => {
    it('should generate unique IDs', () => {
      const id1 = generatePipelineID();
      const id2 = generatePipelineID();
      expect(id1).not.toBe(id2);
    });

    it('should match expected format', () => {
      const id = generatePipelineID();
      expect(isValidPipelineID(id)).toBe(true);
    });

    it('should include timestamp', () => {
      const before = Date.now();
      const id = generatePipelineID();
      const after = Date.now();

      const match = id.match(/^pipeline-(\d+)-[a-f0-9]{8}$/);
      expect(match).not.toBeNull();

      const timestamp = parseInt(match![1], 10);
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('isValidPipelineID', () => {
    it('should validate correct format', () => {
      expect(isValidPipelineID('pipeline-1234567890-abcd1234')).toBe(true);
      expect(isValidPipelineID('pipeline-1-00000000')).toBe(true);
    });

    it('should reject invalid formats', () => {
      expect(isValidPipelineID('')).toBe(false);
      expect(isValidPipelineID('pipeline')).toBe(false);
      expect(isValidPipelineID('pipeline-abc-12345678')).toBe(false);
      expect(isValidPipelineID('pipeline-123-abc')).toBe(false);
      expect(isValidPipelineID('pipeline-123-ABCD1234')).toBe(false); // uppercase
      expect(isValidPipelineID('invalid')).toBe(false);
    });
  });
});

// ==================== Pipeline Validation Tests ====================

describe('Pipeline Validation', () => {
  describe('validatePipelineDefinition', () => {
    it('should accept valid pipeline', () => {
      const agent = createTestAgent();
      const pipeline = createTestPipeline([agent]);
      expect(() => validatePipelineDefinition(pipeline)).not.toThrow();
    });

    it('should reject empty name', () => {
      const agent = createTestAgent();
      const pipeline = createTestPipeline([agent], { name: '' });
      expect(() => validatePipelineDefinition(pipeline)).toThrow(PipelineValidationError);
      // Empty string.trim() is length 0, so validation catches it in name check
    });

    it('should reject missing name', () => {
      const agent = createTestAgent();
      const pipeline = { ...createTestPipeline([agent]), name: undefined as any };
      expect(() => validatePipelineDefinition(pipeline)).toThrow(PipelineValidationError);
      expect(() => validatePipelineDefinition(pipeline)).toThrow('Pipeline name required');
    });

    it('should reject empty agents array', () => {
      const pipeline = createTestPipeline([]);
      expect(() => validatePipelineDefinition(pipeline)).toThrow(PipelineValidationError);
      expect(() => validatePipelineDefinition(pipeline)).toThrow('Pipeline must have at least 1 agent');
    });

    it('should reject too many agents', () => {
      const agents = Array.from({ length: MAX_PIPELINE_AGENTS + 1 }, (_, i) =>
        createTestAgent({
          agentName: `Agent ${i}`,
          position: `Agent #${i + 1}/${MAX_PIPELINE_AGENTS + 1}`,
          outputKey: `output-${i}`,
          previousKey: i > 0 ? `output-${i - 1}` : null,
        })
      );
      const pipeline = createTestPipeline(agents);
      expect(() => validatePipelineDefinition(pipeline)).toThrow(PipelineValidationError);
      expect(() => validatePipelineDefinition(pipeline)).toThrow(`Pipeline cannot exceed ${MAX_PIPELINE_AGENTS} agents`);
    });

    it('should enforce sequential rule: subsequent agents require previousKey', () => {
      const agent1 = createTestAgent({
        agentName: 'Agent 1',
        position: 'Agent #1/2',
        outputKey: 'output-1',
        previousKey: null,
      });
      const agent2 = createTestAgent({
        agentName: 'Agent 2',
        position: 'Agent #2/2',
        outputKey: 'output-2',
        previousKey: null, // Missing!
      });
      const pipeline = createTestPipeline([agent1, agent2]);

      expect(() => validatePipelineDefinition(pipeline)).toThrow(PipelineValidationError);
      expect(() => validatePipelineDefinition(pipeline)).toThrow('missing previousKey');
    });

    it('should reject duplicate output keys', () => {
      const agent1 = createTestAgent({
        agentName: 'Agent 1',
        position: 'Agent #1/2',
        outputKey: 'same-key',
        previousKey: null,
      });
      const agent2 = createTestAgent({
        agentName: 'Agent 2',
        position: 'Agent #2/2',
        outputKey: 'same-key', // Duplicate!
        previousKey: 'same-key',
      });
      const pipeline = createTestPipeline([agent1, agent2]);

      expect(() => validatePipelineDefinition(pipeline)).toThrow(PipelineValidationError);
      expect(() => validatePipelineDefinition(pipeline)).toThrow('duplicate outputKey');
    });
  });

  describe('validateAgentDefinition', () => {
    it('should accept valid agent', () => {
      const agent = createTestAgent();
      expect(() => validateAgentDefinition(agent, 0, true, new Set())).not.toThrow();
    });

    it('should reject missing agentName', () => {
      const agent = createTestAgent({ agentName: undefined as any });
      expect(() => validateAgentDefinition(agent, 0, true, new Set())).toThrow('missing agentName');
    });

    it('should reject missing position', () => {
      const agent = createTestAgent({ position: undefined as any });
      expect(() => validateAgentDefinition(agent, 0, true, new Set())).toThrow('missing position');
    });

    it('should reject missing phase', () => {
      const agent = createTestAgent({ phase: undefined as any });
      expect(() => validateAgentDefinition(agent, 0, true, new Set())).toThrow('missing phase');
    });

    it('should reject missing outputKey', () => {
      const agent = createTestAgent({ outputKey: undefined as any });
      expect(() => validateAgentDefinition(agent, 0, true, new Set())).toThrow('missing outputKey');
    });

    it('should reject missing task', () => {
      const agent = createTestAgent({ task: undefined as any });
      expect(() => validateAgentDefinition(agent, 0, true, new Set())).toThrow('missing task');
    });

    it('should reject missing qualityGate', () => {
      const agent = createTestAgent({ qualityGate: undefined as any });
      expect(() => validateAgentDefinition(agent, 0, true, new Set())).toThrow('missing qualityGate');
    });
  });

  describe('validateMemoryKeyChain', () => {
    it('should warn on key chain mismatch', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const agents = [
        createTestAgent({
          agentName: 'Agent 1',
          outputKey: 'output-1',
          previousKey: null,
        }),
        createTestAgent({
          agentName: 'Agent 2',
          outputKey: 'output-2',
          previousKey: 'wrong-key', // Should be 'output-1'
        }),
      ];

      validateMemoryKeyChain(agents);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Memory key chain mismatch')
      );

      consoleSpy.mockRestore();
    });

    it('should not warn on correct key chain', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const agents = [
        createTestAgent({
          agentName: 'Agent 1',
          outputKey: 'output-1',
          previousKey: null,
        }),
        createTestAgent({
          agentName: 'Agent 2',
          outputKey: 'output-2',
          previousKey: 'output-1',
        }),
      ];

      validateMemoryKeyChain(agents);

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});

// ==================== Prompt Building Tests ====================

describe('Prompt Building', () => {
  describe('buildAgentPrompt', () => {
    it('should include agent identity', () => {
      const agent = createTestAgent({
        agentName: 'Research Agent',
        position: 'Agent #1/3',
        phase: 'Research',
      });

      const prompt = buildAgentPrompt(agent, null, 'Test Pipeline');

      expect(prompt).toContain('## Agent Identity');
      expect(prompt).toContain('**Research Agent**');
      expect(prompt).toContain('Agent #1/3');
      expect(prompt).toContain('**Research** phase');
      expect(prompt).toContain('Pipeline: Test Pipeline');
    });

    it('should include task and quality gate', () => {
      const agent = createTestAgent({
        task: 'Research the topic thoroughly',
        qualityGate: 'Must cite 5+ sources',
      });

      const prompt = buildAgentPrompt(agent, null);

      expect(prompt).toContain('## Your Task');
      expect(prompt).toContain('Research the topic thoroughly');
      expect(prompt).toContain('## Quality Gate');
      expect(prompt).toContain('Must cite 5+ sources');
    });

    it('should include output storage instructions', () => {
      const agent = createTestAgent({ outputKey: 'research-output' });

      const prompt = buildAgentPrompt(agent, null);

      expect(prompt).toContain('## Output Storage');
      expect(prompt).toContain('`research-output`');
    });

    it('should include previous context when available', () => {
      const agent = createTestAgent({ previousKey: 'previous-output' });
      const previousContext = 'This is the previous agent output';

      const prompt = buildAgentPrompt(agent, previousContext);

      expect(prompt).toContain('## Previous Agent Output');
      expect(prompt).toContain('**Retrieved from memory key:** `previous-output`');
      expect(prompt).toContain('This is the previous agent output');
    });

    it('should note when previous output not found', () => {
      const agent = createTestAgent({ previousKey: 'previous-output' });

      const prompt = buildAgentPrompt(agent, null);

      expect(prompt).toContain('## Previous Agent Output');
      expect(prompt).toContain('**Expected from memory key:** `previous-output`');
      expect(prompt).toContain('Previous output was not found or is empty');
    });
  });
});

// ==================== Position Formatting Tests ====================

describe('Position Formatting', () => {
  describe('formatAgentPosition', () => {
    it('should format position correctly', () => {
      expect(formatAgentPosition(0, 48)).toBe('Agent #1/48');
      expect(formatAgentPosition(11, 48)).toBe('Agent #12/48');
      expect(formatAgentPosition(47, 48)).toBe('Agent #48/48');
    });
  });

  describe('parseAgentPosition', () => {
    it('should parse valid position', () => {
      expect(parseAgentPosition('Agent #1/48')).toEqual({ index: 0, total: 48 });
      expect(parseAgentPosition('Agent #12/48')).toEqual({ index: 11, total: 48 });
      expect(parseAgentPosition('Agent #48/48')).toEqual({ index: 47, total: 48 });
    });

    it('should return null for invalid format', () => {
      expect(parseAgentPosition('')).toBeNull();
      expect(parseAgentPosition('Agent 1/48')).toBeNull();
      expect(parseAgentPosition('Agent #/48')).toBeNull();
      expect(parseAgentPosition('invalid')).toBeNull();
    });
  });
});

// ==================== Quality Gate Tests ====================

describe('Quality Gate Validation', () => {
  describe('validateQualityGate', () => {
    it('should fail empty output', () => {
      expect(validateQualityGate('', 'Any gate')).toBe(false);
      expect(validateQualityGate('   ', 'Any gate')).toBe(false);
    });

    it('should pass non-empty output for basic gates', () => {
      expect(validateQualityGate('Some output', 'Must produce non-empty output')).toBe(true);
    });

    it('should validate citation count', () => {
      // Not enough citations
      expect(validateQualityGate('No citations here', 'Must cite 5+ sources')).toBe(false);
      expect(validateQualityGate('Only [1] and [2]', 'Must cite 5+ sources')).toBe(false);

      // Enough citations
      expect(validateQualityGate(
        'Research shows [1] that [2] results [3] indicate [4] furthermore [5]',
        'Must cite 5+ sources'
      )).toBe(true);
    });

    it('should validate minimum word count', () => {
      expect(validateQualityGate('one two', 'Minimum 10 words')).toBe(false);
      expect(validateQualityGate('one two three four five six seven eight nine ten eleven', 'Minimum 10 words')).toBe(true);
    });

    it('should validate must include pattern', () => {
      expect(validateQualityGate('No keyword here', 'Must include "CONCLUSION"')).toBe(false);
      expect(validateQualityGate('This is the CONCLUSION section', 'Must include "CONCLUSION"')).toBe(true);
      // Case insensitive
      expect(validateQualityGate('This is the conclusion section', 'Must include "CONCLUSION"')).toBe(true);
    });
  });
});

// ==================== Serialization Tests ====================

describe('Serialization', () => {
  describe('serializeMap', () => {
    it('should convert Map to array', () => {
      const map = new Map([
        ['key1', 'value1'],
        ['key2', 'value2'],
      ]);

      const arr = serializeMap(map);

      expect(arr).toEqual([
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2' },
      ]);
    });
  });

  describe('deserializeMap', () => {
    it('should convert array to Map', () => {
      const arr = [
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2' },
      ];

      const map = deserializeMap(arr);

      expect(map.get('key1')).toBe('value1');
      expect(map.get('key2')).toBe('value2');
    });
  });

  it('should round-trip correctly', () => {
    const original = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);

    const serialized = serializeMap(original);
    const deserialized = deserializeMap(serialized);

    expect(deserialized).toEqual(original);
  });
});

// ==================== Constants Tests ====================

describe('Constants', () => {
  it('should have correct defaults', () => {
    expect(DEFAULT_NAMESPACE).toBe('pipeline');
    expect(DEFAULT_AGENT_TIMEOUT).toBe(300000); // 5 minutes
    expect(MAX_PIPELINE_AGENTS).toBe(100);
  });
});

// ==================== MockAgentExecutor Tests ====================

describe('MockAgentExecutor', () => {
  let executor: MockAgentExecutor;

  beforeEach(() => {
    executor = new MockAgentExecutor();
  });

  it('should return default response', async () => {
    const agent = createTestAgent();
    const result = await executor.execute('prompt', agent);
    expect(result).toBe('Mock agent output');
  });

  it('should return configured response for agent', async () => {
    executor.setResponse('Test Agent', 'Custom response');
    const agent = createTestAgent();
    const result = await executor.execute('prompt', agent);
    expect(result).toBe('Custom response');
  });

  it('should allow custom default response', async () => {
    executor.setDefaultResponse('New default');
    const agent = createTestAgent({ agentName: 'Other Agent' });
    const result = await executor.execute('prompt', agent);
    expect(result).toBe('New default');
  });
});

// ==================== RelayRaceOrchestrator Tests ====================

describe('RelayRaceOrchestrator', () => {
  let orchestrator: RelayRaceOrchestrator;
  let executor: MockAgentExecutor;
  let memoryEngine: ReturnType<typeof createMockMemoryEngine>;

  beforeEach(() => {
    executor = new MockAgentExecutor();
    memoryEngine = createMockMemoryEngine();
    orchestrator = new RelayRaceOrchestrator(executor);
    orchestrator.setMemoryEngine(memoryEngine);
  });

  describe('runPipeline - Single Agent', () => {
    it('should execute single agent pipeline', async () => {
      const agent = createTestAgent();
      const pipeline = createTestPipeline([agent]);

      const result = await orchestrator.runPipeline(pipeline);

      expect(result.status).toBe('completed');
      expect(result.agentResults.size).toBe(1);
      expect(result.agentResults.get('Test Agent')?.success).toBe(true);
    });

    it('should store agent output in memory', async () => {
      executor.setDefaultResponse('Agent produced this output');
      const agent = createTestAgent({ outputKey: 'test-output-key' });
      const pipeline = createTestPipeline([agent]);

      await orchestrator.runPipeline(pipeline);

      expect(memoryEngine.store).toHaveBeenCalledWith(
        'test-output-key',
        'Agent produced this output',
        expect.objectContaining({
          namespace: DEFAULT_NAMESPACE,
        })
      );
    });

    it('should generate valid pipeline ID', async () => {
      const agent = createTestAgent();
      const pipeline = createTestPipeline([agent]);

      const result = await orchestrator.runPipeline(pipeline);

      expect(isValidPipelineID(result.pipelineId)).toBe(true);
    });
  });

  describe('runPipeline - Sequential Execution', () => {
    it('should execute agents in sequence', async () => {
      const executionOrder: string[] = [];

      const agent1 = createTestAgent({
        agentName: 'Agent 1',
        position: 'Agent #1/3',
        outputKey: 'output-1',
        previousKey: null,
      });
      const agent2 = createTestAgent({
        agentName: 'Agent 2',
        position: 'Agent #2/3',
        outputKey: 'output-2',
        previousKey: 'output-1',
      });
      const agent3 = createTestAgent({
        agentName: 'Agent 3',
        position: 'Agent #3/3',
        outputKey: 'output-3',
        previousKey: 'output-2',
      });

      // Track execution order
      executor.setResponse('Agent 1', 'Output 1');
      executor.setResponse('Agent 2', 'Output 2');
      executor.setResponse('Agent 3', 'Output 3');

      const originalExecute = executor.execute.bind(executor);
      executor.execute = async (prompt, agent) => {
        executionOrder.push(agent.agentName);
        return originalExecute(prompt, agent);
      };

      const pipeline = createTestPipeline([agent1, agent2, agent3]);
      await orchestrator.runPipeline(pipeline);

      expect(executionOrder).toEqual(['Agent 1', 'Agent 2', 'Agent 3']);
    });

    it('should pass memory keys between agents', async () => {
      const agent1 = createTestAgent({
        agentName: 'Agent 1',
        outputKey: 'output-1',
        previousKey: null,
      });
      const agent2 = createTestAgent({
        agentName: 'Agent 2',
        outputKey: 'output-2',
        previousKey: 'output-1',
      });

      executor.setResponse('Agent 1', 'First agent output');
      executor.setResponse('Agent 2', 'Second agent output');

      const pipeline = createTestPipeline([agent1, agent2]);
      await orchestrator.runPipeline(pipeline);

      // Agent 2 should have retrieved Agent 1's output
      expect(memoryEngine.retrieve).toHaveBeenCalledWith('output-1', expect.any(Object));
    });
  });

  describe('runPipeline - Wait Gates', () => {
    it('should block next agent until current confirms storage', async () => {
      const storeTimestamps: number[] = [];
      const retrieveTimestamps: number[] = [];

      memoryEngine.store = vi.fn(async (key, content) => {
        storeTimestamps.push(Date.now());
        memoryEngine._storage.set(key, content);
        // Simulate some storage delay
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      memoryEngine.retrieve = vi.fn(async (key) => {
        retrieveTimestamps.push(Date.now());
        return memoryEngine._storage.get(key) || null;
      });

      const agent1 = createTestAgent({
        agentName: 'Agent 1',
        outputKey: 'output-1',
        previousKey: null,
      });
      const agent2 = createTestAgent({
        agentName: 'Agent 2',
        outputKey: 'output-2',
        previousKey: 'output-1',
      });

      const pipeline = createTestPipeline([agent1, agent2]);
      await orchestrator.runPipeline(pipeline);

      // The retrieve for Agent 2 should happen after store for Agent 1
      expect(storeTimestamps[0]).toBeLessThan(retrieveTimestamps[0]);
    });
  });

  describe('runPipeline - Events', () => {
    it('should emit pipeline start event', async () => {
      const events: IPipelineEvent[] = [];
      orchestrator.addEventListener(event => events.push(event));

      const agent = createTestAgent();
      const pipeline = createTestPipeline([agent]);

      await orchestrator.runPipeline(pipeline);

      const startEvent = events.find(e => e.type === 'pipeline:start');
      expect(startEvent).toBeDefined();
      expect(startEvent?.data?.name).toBe('Test Pipeline');
    });

    it('should emit agent events', async () => {
      const events: IPipelineEvent[] = [];
      orchestrator.addEventListener(event => events.push(event));

      const agent = createTestAgent();
      const pipeline = createTestPipeline([agent]);

      await orchestrator.runPipeline(pipeline);

      expect(events.map(e => e.type)).toContain('agent:start');
      expect(events.map(e => e.type)).toContain('agent:store');
      expect(events.map(e => e.type)).toContain('agent:complete');
    });

    it('should emit pipeline complete event', async () => {
      const events: IPipelineEvent[] = [];
      orchestrator.addEventListener(event => events.push(event));

      const agent = createTestAgent();
      const pipeline = createTestPipeline([agent]);

      await orchestrator.runPipeline(pipeline);

      const completeEvent = events.find(e => e.type === 'pipeline:complete');
      expect(completeEvent).toBeDefined();
      expect(completeEvent?.data?.agentsCompleted).toBe(1);
    });

    it('should allow removing event listeners', async () => {
      const events: IPipelineEvent[] = [];
      const listener = (event: IPipelineEvent) => events.push(event);

      orchestrator.addEventListener(listener);
      orchestrator.removeEventListener(listener);

      const agent = createTestAgent();
      const pipeline = createTestPipeline([agent]);

      await orchestrator.runPipeline(pipeline);

      expect(events.length).toBe(0);
    });
  });

  describe('runPipeline - Error Handling', () => {
    it('should throw on invalid pipeline', async () => {
      const pipeline = createTestPipeline([]);

      await expect(orchestrator.runPipeline(pipeline)).rejects.toThrow(PipelineValidationError);
    });

    it('should throw on missing previous key data', async () => {
      // Track retrieval calls to differentiate validation vs previous key lookup
      let output1RetrieveCount = 0;

      memoryEngine.store = vi.fn(async (key: string, content: string) => {
        memoryEngine._storage.set(key, content);
      });
      memoryEngine.retrieve = vi.fn(async (key: string) => {
        if (key === 'output-1') {
          output1RetrieveCount++;
          // First retrieve is for Agent 1's output validation (should pass)
          // Second retrieve is for Agent 2's previous key lookup (should fail)
          if (output1RetrieveCount > 1) {
            return null; // Simulate Agent 2 not finding Agent 1's output
          }
        }
        return memoryEngine._storage.get(key) || null;
      });

      const agent1 = createTestAgent({
        agentName: 'Agent 1',
        outputKey: 'output-1',
        previousKey: null,
      });
      const agent2 = createTestAgent({
        agentName: 'Agent 2',
        outputKey: 'output-2',
        previousKey: 'output-1',
      });

      const pipeline = createTestPipeline([agent1, agent2]);

      await expect(orchestrator.runPipeline(pipeline)).rejects.toThrow(/Memory key.*failed|Previous agent output not found/);
    });

    it('should throw on quality gate failure', async () => {
      executor.setDefaultResponse(''); // Empty output fails quality gate

      const agent = createTestAgent({
        qualityGate: 'Must produce non-empty output',
      });
      const pipeline = createTestPipeline([agent]);

      await expect(orchestrator.runPipeline(pipeline)).rejects.toThrow(/Quality gate failed|Agent failed to store output/);
    });

    it('should emit fail events on error', async () => {
      const events: IPipelineEvent[] = [];
      orchestrator.addEventListener(event => events.push(event));

      executor.setDefaultResponse('');

      const agent = createTestAgent();
      const pipeline = createTestPipeline([agent]);

      try {
        await orchestrator.runPipeline(pipeline);
      } catch {
        // Expected
      }

      expect(events.map(e => e.type)).toContain('pipeline:fail');
    });
  });

  describe('Pipeline Management', () => {
    it('should track executions', async () => {
      const agent = createTestAgent();
      const pipeline = createTestPipeline([agent]);

      const result = await orchestrator.runPipeline(pipeline);

      const execution = orchestrator.getExecution(result.pipelineId);
      expect(execution).not.toBeNull();
      expect(execution?.status).toBe('completed');
    });

    it('should list all executions', async () => {
      const agent = createTestAgent();
      const pipeline = createTestPipeline([agent]);

      await orchestrator.runPipeline(pipeline);
      await orchestrator.runPipeline(pipeline);

      const executions = orchestrator.listExecutions();
      expect(executions.length).toBe(2);
    });

    it('should filter executions by status', async () => {
      executor.setDefaultResponse('valid output');
      const agent = createTestAgent();
      const pipeline = createTestPipeline([agent]);

      await orchestrator.runPipeline(pipeline);

      const completed = orchestrator.getExecutionsByStatus('completed');
      const failed = orchestrator.getExecutionsByStatus('failed');

      expect(completed.length).toBe(1);
      expect(failed.length).toBe(0);
    });

    it('should clear completed executions', async () => {
      const agent = createTestAgent();
      const pipeline = createTestPipeline([agent]);

      await orchestrator.runPipeline(pipeline);
      await orchestrator.runPipeline(pipeline);

      const cleared = orchestrator.clearCompletedExecutions();
      expect(cleared).toBe(2);

      const executions = orchestrator.listExecutions();
      expect(executions.length).toBe(0);
    });

    it('should provide statistics', async () => {
      const agent = createTestAgent();
      const pipeline = createTestPipeline([agent]);

      await orchestrator.runPipeline(pipeline);

      const stats = orchestrator.getStats();
      expect(stats.totalExecutions).toBe(1);
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(0);
      expect(stats.successRate).toBe(1);
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout slow agents', async () => {
      // Create orchestrator with short timeout
      const shortTimeoutOrchestrator = new RelayRaceOrchestrator(executor, {
        agentTimeout: 50, // 50ms timeout
      });
      shortTimeoutOrchestrator.setMemoryEngine(memoryEngine);

      // Create slow executor
      const slowExecutor = {
        execute: async () => {
          await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay
          return 'output';
        },
      };
      const orchestratorWithSlowExecutor = new RelayRaceOrchestrator(slowExecutor, {
        agentTimeout: 50,
      });
      orchestratorWithSlowExecutor.setMemoryEngine(memoryEngine);

      const agent = createTestAgent();
      const pipeline = createTestPipeline([agent]);

      await expect(orchestratorWithSlowExecutor.runPipeline(pipeline)).rejects.toThrow(/timed out/);
    });
  });
});

// ==================== Integration Tests ====================

describe('Integration Tests', () => {
  it('should execute complete 3-agent research pipeline', async () => {
    const executor = new MockAgentExecutor();
    const memoryEngine = createMockMemoryEngine();
    const orchestrator = new RelayRaceOrchestrator(executor);
    orchestrator.setMemoryEngine(memoryEngine);

    // Set up responses
    executor.setResponse('Literature Researcher', 'Found 10 relevant papers [1][2][3][4][5] on the topic.');
    executor.setResponse('Data Analyst', 'Analysis shows significant patterns. Building on [1][2][3][4][5] findings.');
    executor.setResponse('Report Writer', 'Executive Summary: The research [1][2][3][4][5] indicates...');

    const pipeline: IPipelineDefinition = {
      name: 'Research Pipeline',
      description: 'A 3-agent research workflow',
      sequential: true,
      agents: [
        {
          agentName: 'Literature Researcher',
          position: 'Agent #1/3',
          phase: 'Research',
          previousKey: null,
          outputKey: 'literature-review',
          task: 'Search and summarize relevant literature',
          qualityGate: 'Must cite 5+ sources',
        },
        {
          agentName: 'Data Analyst',
          position: 'Agent #2/3',
          phase: 'Analysis',
          previousKey: 'literature-review',
          outputKey: 'data-analysis',
          task: 'Analyze the literature and identify patterns',
          qualityGate: 'Must produce non-empty output',
        },
        {
          agentName: 'Report Writer',
          position: 'Agent #3/3',
          phase: 'Synthesis',
          previousKey: 'data-analysis',
          outputKey: 'final-report',
          task: 'Write the final research report',
          qualityGate: 'Must produce non-empty output',
        },
      ],
    };

    const result = await orchestrator.runPipeline(pipeline);

    expect(result.status).toBe('completed');
    expect(result.agentResults.size).toBe(3);
    expect(result.totalAgents).toBe(3);

    // Verify all agents succeeded
    for (const agentResult of result.agentResults.values()) {
      expect(agentResult.success).toBe(true);
    }

    // Verify memory keys
    expect(memoryEngine._storage.has('literature-review')).toBe(true);
    expect(memoryEngine._storage.has('data-analysis')).toBe(true);
    expect(memoryEngine._storage.has('final-report')).toBe(true);
  });
});
