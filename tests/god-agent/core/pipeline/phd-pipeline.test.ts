/**
 * PhD Pipeline Tests
 * TASK-PHD-001 - 48-Agent PhD Pipeline
 *
 * Tests for:
 * - Configuration validation (48 agents, 7 phases)
 * - DAG validation (no circular dependencies)
 * - Critical agent validation
 * - Phase execution and topological sort
 * - Progress tracking
 * - Integration with mock executor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PhDPipelineOrchestrator,
  type IAgentExecutor,
  type IShadowTracker,
  PHD_PIPELINE_CONFIG,
  getPhDPipelineConfig,
  getAgentById,
  getAgentByKey,
  getAgentsByPhase,
  getCriticalAgents,
  DEFAULT_AGENT_TIMEOUT,
  CRITICAL_AGENT_KEYS,
  PHASE_NAMES,
  PipelineConfigError,
  PipelineExecutionError,
  CriticalAgentError,
  createPipelineState,
  generatePipelineId,
  isCriticalAgent,
  type IAgentConfig,
  type IPhaseConfig,
  type IPipelineConfig,
  type IPipelineState,
  type AgentId,
} from '../../../../src/god-agent/core/pipeline/index.js';

// ==================== Mock Executor ====================

class MockAgentExecutor implements IAgentExecutor {
  public executionLog: Array<{ agentKey: string; inputs: Record<string, unknown> }> = [];
  public outputs: Map<string, Record<string, unknown>> = new Map();
  public shouldFail: Set<string> = new Set();
  public failureError: string = 'Mock execution failure';

  async execute(
    agentKey: string,
    inputs: Record<string, unknown>,
    _timeout: number
  ): Promise<Record<string, unknown>> {
    this.executionLog.push({ agentKey, inputs });

    if (this.shouldFail.has(agentKey)) {
      throw new Error(this.failureError);
    }

    // Return configured output or default
    const output = this.outputs.get(agentKey) || this.getDefaultOutput(agentKey);
    return output;
  }

  private getDefaultOutput(agentKey: string): Record<string, unknown> {
    // Provide default outputs for critical agents
    switch (agentKey) {
      case 'step-back-analyzer':
        return {
          high_level_framing: 'Research framing analysis',
          key_questions: ['Q1', 'Q2', 'Q3'],
        };
      case 'contradiction-analyzer':
        return {
          contradictions: ['C1', 'C2'],
          inconsistencies: ['I1'],
        };
      case 'adversarial-reviewer':
        return {
          attack_vectors: ['A1', 'A2'],
          weaknesses: ['W1', 'W2', 'W3'],
        };
      default:
        return { result: `Output from ${agentKey}` };
    }
  }

  setOutput(agentKey: string, output: Record<string, unknown>): void {
    this.outputs.set(agentKey, output);
  }

  setFailure(agentKey: string, error?: string): void {
    this.shouldFail.add(agentKey);
    if (error) this.failureError = error;
  }

  clearFailures(): void {
    this.shouldFail.clear();
  }

  reset(): void {
    this.executionLog = [];
    this.outputs.clear();
    this.shouldFail.clear();
    this.failureError = 'Mock execution failure';
  }
}

// ==================== Mock Shadow Tracker ====================

class MockShadowTracker implements IShadowTracker {
  public records: Array<{ agentId: AgentId; status: string }> = [];

  async record(execution: { agentId: AgentId; status: string }): Promise<void> {
    this.records.push({ agentId: execution.agentId, status: execution.status });
  }

  reset(): void {
    this.records = [];
  }
}

// ==================== Configuration Tests ====================

describe('PhD Pipeline Configuration', () => {
  describe('PHD_PIPELINE_CONFIG', () => {
    it('should have exactly 48 agents', () => {
      expect(PHD_PIPELINE_CONFIG.agents.length).toBe(48);
    });

    it('should have exactly 7 phases', () => {
      expect(PHD_PIPELINE_CONFIG.phases.length).toBe(7);
    });

    it('should have correct pipeline metadata', () => {
      expect(PHD_PIPELINE_CONFIG.pipeline.name).toBe('PhD Research Pipeline');
      expect(PHD_PIPELINE_CONFIG.pipeline.version).toBe('1.0.0');
      expect(PHD_PIPELINE_CONFIG.pipeline.totalAgents).toBe(48);
      expect(PHD_PIPELINE_CONFIG.pipeline.phases).toBe(7);
    });

    it('should have agents numbered 1-48', () => {
      const ids = PHD_PIPELINE_CONFIG.agents.map(a => a.id).sort((a, b) => a - b);
      expect(ids).toEqual(Array.from({ length: 48 }, (_, i) => i + 1));
    });

    it('should have unique agent keys', () => {
      const keys = PHD_PIPELINE_CONFIG.agents.map(a => a.key);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(48);
    });

    it('should have valid phase assignments for all agents', () => {
      for (const agent of PHD_PIPELINE_CONFIG.agents) {
        expect(agent.phase).toBeGreaterThanOrEqual(1);
        expect(agent.phase).toBeLessThanOrEqual(7);
      }
    });

    it('should have consistent phase agent lists', () => {
      for (const phase of PHD_PIPELINE_CONFIG.phases) {
        for (const agentId of phase.agents) {
          const agent = PHD_PIPELINE_CONFIG.agents.find(a => a.id === agentId);
          expect(agent).toBeDefined();
          expect(agent!.phase).toBe(phase.id);
        }
      }
    });
  });

  describe('getPhDPipelineConfig', () => {
    it('should return the config', () => {
      const config = getPhDPipelineConfig();
      expect(config.pipeline.totalAgents).toBe(48);
      expect(config.pipeline.phases).toBe(7);
      expect(config.agents.length).toBe(48);
    });
  });

  describe('getAgentById', () => {
    it('should find agent by ID', () => {
      const agent = getAgentById(1);
      expect(agent).toBeDefined();
      expect(agent!.id).toBe(1);
      expect(agent!.key).toBe('step-back-analyzer');
    });

    it('should return undefined for invalid ID', () => {
      expect(getAgentById(0)).toBeUndefined();
      expect(getAgentById(49)).toBeUndefined();
      expect(getAgentById(-1)).toBeUndefined();
    });
  });

  describe('getAgentByKey', () => {
    it('should find agent by key', () => {
      const agent = getAgentByKey('contradiction-analyzer');
      expect(agent).toBeDefined();
      expect(agent!.id).toBe(14);
    });

    it('should return undefined for invalid key', () => {
      expect(getAgentByKey('nonexistent-agent')).toBeUndefined();
    });
  });

  describe('getAgentsByPhase', () => {
    it('should return agents for Phase 1 (Foundation)', () => {
      const agents = getAgentsByPhase(1);
      expect(agents.length).toBeGreaterThan(0);
      expect(agents.every(a => a.phase === 1)).toBe(true);
    });

    it('should return agents for Phase 7 (QA)', () => {
      const agents = getAgentsByPhase(7);
      expect(agents.length).toBeGreaterThan(0);
      expect(agents.every(a => a.phase === 7)).toBe(true);
    });

    it('should return empty array for invalid phase', () => {
      expect(getAgentsByPhase(0)).toEqual([]);
      expect(getAgentsByPhase(8)).toEqual([]);
    });
  });

  describe('getCriticalAgents', () => {
    it('should return critical agents', () => {
      const criticalAgents = getCriticalAgents();
      expect(criticalAgents.length).toBeGreaterThanOrEqual(3);

      const keys = criticalAgents.map(a => a.key);
      expect(keys).toContain('step-back-analyzer');
      expect(keys).toContain('contradiction-analyzer');
      expect(keys).toContain('adversarial-reviewer');
    });
  });
});

// ==================== Type & Utility Tests ====================

describe('Pipeline Types & Utilities', () => {
  describe('Constants', () => {
    it('should have correct DEFAULT_AGENT_TIMEOUT', () => {
      expect(DEFAULT_AGENT_TIMEOUT).toBe(300);
    });

    it('should have correct CRITICAL_AGENT_KEYS', () => {
      expect(CRITICAL_AGENT_KEYS).toContain('step-back-analyzer');
      expect(CRITICAL_AGENT_KEYS).toContain('contradiction-analyzer');
      expect(CRITICAL_AGENT_KEYS).toContain('adversarial-reviewer');
    });

    it('should have correct PHASE_NAMES', () => {
      expect(PHASE_NAMES[1]).toBe('Foundation');
      expect(PHASE_NAMES[2]).toBe('Discovery');
      expect(PHASE_NAMES[3]).toBe('Architecture');
      expect(PHASE_NAMES[4]).toBe('Synthesis');
      expect(PHASE_NAMES[5]).toBe('Design');
      expect(PHASE_NAMES[6]).toBe('Writing');
      expect(PHASE_NAMES[7]).toBe('QA');
    });
  });

  describe('createPipelineState', () => {
    it('should create valid pipeline state', () => {
      const state = createPipelineState('test-pipeline-123');

      expect(state.pipelineId).toBe('test-pipeline-123');
      expect(state.currentPhase).toBe(1);
      expect(state.completedAgents.size).toBe(0);
      expect(state.agentOutputs.size).toBe(0);
      expect(state.status).toBe('pending');
      expect(state.errors).toEqual([]);
      expect(state.executionRecords.size).toBe(0);
      expect(state.startTime).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('generatePipelineId', () => {
    it('should generate unique IDs', () => {
      const id1 = generatePipelineId();
      const id2 = generatePipelineId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^phd-pipeline-\d+-[a-z0-9]+$/);
    });

    it('should include timestamp', () => {
      const before = Date.now();
      const id = generatePipelineId();
      const after = Date.now();

      const timestamp = parseInt(id.split('-')[2], 10);
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('isCriticalAgent', () => {
    it('should identify critical agents by key', () => {
      const stepBack = getAgentByKey('step-back-analyzer')!;
      const contradiction = getAgentByKey('contradiction-analyzer')!;
      const adversarial = getAgentByKey('adversarial-reviewer')!;

      expect(isCriticalAgent(stepBack)).toBe(true);
      expect(isCriticalAgent(contradiction)).toBe(true);
      expect(isCriticalAgent(adversarial)).toBe(true);
    });

    it('should identify non-critical agents', () => {
      // Find a non-critical agent
      const nonCritical = PHD_PIPELINE_CONFIG.agents.find(
        a => !CRITICAL_AGENT_KEYS.includes(a.key) && !a.critical
      );
      expect(nonCritical).toBeDefined();
      expect(isCriticalAgent(nonCritical!)).toBe(false);
    });

    it('should respect explicit critical flag', () => {
      const agent: IAgentConfig = {
        id: 99,
        key: 'test-agent',
        name: 'Test Agent',
        phase: 1,
        description: 'Test',
        dependencies: [],
        inputs: [],
        outputs: [],
        timeout: 300,
        critical: true,
      };
      expect(isCriticalAgent(agent)).toBe(true);
    });
  });
});

// ==================== Error Classes Tests ====================

describe('Pipeline Error Classes', () => {
  describe('PipelineConfigError', () => {
    it('should create error with code', () => {
      const error = new PipelineConfigError('Test message', 'INVALID_AGENT_COUNT');

      expect(error.message).toBe('Test message');
      expect(error.code).toBe('INVALID_AGENT_COUNT');
      expect(error.name).toBe('PipelineConfigError');
    });

    it('should support all error codes', () => {
      const codes = [
        'INVALID_AGENT_COUNT',
        'INVALID_PHASE_COUNT',
        'CIRCULAR_DEPENDENCY',
        'INVALID_AGENT_CONFIG',
        'PHASE_MISMATCH',
      ] as const;

      for (const code of codes) {
        const error = new PipelineConfigError('Test', code);
        expect(error.code).toBe(code);
      }
    });
  });

  describe('PipelineExecutionError', () => {
    it('should create error with context', () => {
      const error = new PipelineExecutionError('Execution failed', 5, 'test-agent', 2);

      expect(error.message).toBe('Execution failed');
      expect(error.agentId).toBe(5);
      expect(error.agentKey).toBe('test-agent');
      expect(error.phase).toBe(2);
      expect(error.name).toBe('PipelineExecutionError');
    });
  });

  describe('CriticalAgentError', () => {
    it('should create error from Error cause', () => {
      const agent = getAgentByKey('step-back-analyzer')!;
      const cause = new Error('Original error');
      const error = new CriticalAgentError(agent, cause);

      expect(error.message).toContain('step-back-analyzer');
      expect(error.message).toContain('failed');
      expect(error.agent).toBe(agent);
      expect(error.cause).toBe(cause);
      expect(error.name).toBe('CriticalAgentError');
    });

    it('should create error from string cause', () => {
      const agent = getAgentByKey('step-back-analyzer')!;
      const error = new CriticalAgentError(agent, 'String error');

      expect(error.message).toContain('String error');
      expect(error.cause).toBe('String error');
    });
  });
});

// ==================== Orchestrator Tests ====================

describe('PhDPipelineOrchestrator', () => {
  let executor: MockAgentExecutor;
  let tracker: MockShadowTracker;

  beforeEach(() => {
    executor = new MockAgentExecutor();
    tracker = new MockShadowTracker();
  });

  describe('Constructor & Validation', () => {
    it('should create orchestrator with valid config', () => {
      const orchestrator = new PhDPipelineOrchestrator(
        PHD_PIPELINE_CONFIG,
        executor,
        { verbose: false }
      );

      expect(orchestrator.getConfig()).toBe(PHD_PIPELINE_CONFIG);
      expect(orchestrator.getState()).toBeNull();
    });

    it('should validate agent count', () => {
      const invalidConfig: IPipelineConfig = {
        ...PHD_PIPELINE_CONFIG,
        agents: PHD_PIPELINE_CONFIG.agents.slice(0, 10), // Only 10 agents
      };

      expect(() => new PhDPipelineOrchestrator(invalidConfig, executor)).toThrow(
        PipelineConfigError
      );
    });

    it('should validate phase count', () => {
      const invalidConfig: IPipelineConfig = {
        ...PHD_PIPELINE_CONFIG,
        phases: PHD_PIPELINE_CONFIG.phases.slice(0, 3), // Only 3 phases
      };

      expect(() => new PhDPipelineOrchestrator(invalidConfig, executor)).toThrow(
        PipelineConfigError
      );
    });

    it('should detect circular dependencies', () => {
      // Create a config with circular dependency: agent 1 depends on agent 2, agent 2 depends on agent 1
      const circularAgents: IAgentConfig[] = [
        {
          id: 1,
          key: 'agent-1',
          name: 'Agent 1',
          phase: 1,
          description: 'Test',
          dependencies: [2], // Depends on agent 2
          inputs: [],
          outputs: [],
          timeout: 300,
        },
        {
          id: 2,
          key: 'agent-2',
          name: 'Agent 2',
          phase: 1,
          description: 'Test',
          dependencies: [1], // Depends on agent 1 - CIRCULAR!
          inputs: [],
          outputs: [],
          timeout: 300,
        },
      ];

      const circularConfig: IPipelineConfig = {
        pipeline: {
          name: 'Test',
          version: '1.0.0',
          description: 'Test',
          totalAgents: 2,
          phases: 1,
        },
        phases: [
          {
            id: 1,
            name: 'Test Phase',
            description: 'Test',
            agents: [1, 2],
            objectives: [],
          },
        ],
        agents: circularAgents,
      };

      expect(() => new PhDPipelineOrchestrator(circularConfig, executor)).toThrow(
        /[Cc]ircular/
      );
    });

    it('should validate agent config fields', () => {
      const invalidAgent = {
        id: 1,
        key: '', // Invalid: empty key
        name: 'Test',
        phase: 1,
        description: 'Test',
        dependencies: [],
        inputs: [],
        outputs: [],
        timeout: 300,
      } as IAgentConfig;

      const invalidConfig: IPipelineConfig = {
        pipeline: {
          name: 'Test',
          version: '1.0.0',
          description: 'Test',
          totalAgents: 1,
          phases: 1,
        },
        phases: [
          {
            id: 1,
            name: 'Test Phase',
            description: 'Test',
            agents: [1],
            objectives: [],
          },
        ],
        agents: [invalidAgent],
      };

      expect(() => new PhDPipelineOrchestrator(invalidConfig, executor)).toThrow(
        PipelineConfigError
      );
    });

    it('should validate phase-agent consistency', () => {
      const mismatchedAgent: IAgentConfig = {
        id: 1,
        key: 'test-agent',
        name: 'Test',
        phase: 2, // Says phase 2
        description: 'Test',
        dependencies: [],
        inputs: [],
        outputs: [],
        timeout: 300,
      };

      const mismatchedConfig: IPipelineConfig = {
        pipeline: {
          name: 'Test',
          version: '1.0.0',
          description: 'Test',
          totalAgents: 1,
          phases: 1,
        },
        phases: [
          {
            id: 1,
            name: 'Test Phase',
            description: 'Test',
            agents: [1], // Lists agent 1, but agent says phase 2
            objectives: [],
          },
        ],
        agents: [mismatchedAgent],
      };

      expect(() => new PhDPipelineOrchestrator(mismatchedConfig, executor)).toThrow(
        /[Pp]hase/
      );
    });
  });

  describe('Configuration Access', () => {
    let orchestrator: PhDPipelineOrchestrator;

    beforeEach(() => {
      orchestrator = new PhDPipelineOrchestrator(PHD_PIPELINE_CONFIG, executor);
    });

    it('should get agent config by ID', () => {
      const agent = orchestrator.getAgentConfig(1);
      expect(agent).toBeDefined();
      expect(agent!.key).toBe('step-back-analyzer');
    });

    it('should get phase config by ID', () => {
      const phase = orchestrator.getPhaseConfig(1);
      expect(phase).toBeDefined();
      expect(phase!.name).toBe('Foundation');
    });

    it('should get critical agents', () => {
      const criticalAgents = orchestrator.getCriticalAgents();
      expect(criticalAgents.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Execution - Simple Pipeline', () => {
    it('should execute minimal valid pipeline', async () => {
      // Create minimal 2-agent pipeline
      const minimalConfig: IPipelineConfig = {
        pipeline: {
          name: 'Minimal Test',
          version: '1.0.0',
          description: 'Test',
          totalAgents: 2,
          phases: 1,
        },
        phases: [
          {
            id: 1,
            name: 'Test Phase',
            description: 'Test',
            agents: [1, 2],
            objectives: [],
          },
        ],
        agents: [
          {
            id: 1,
            key: 'agent-1',
            name: 'Agent 1',
            phase: 1,
            description: 'First agent',
            dependencies: [],
            inputs: ['problemStatement'],
            outputs: ['result1'],
            timeout: 300,
          },
          {
            id: 2,
            key: 'agent-2',
            name: 'Agent 2',
            phase: 1,
            description: 'Second agent',
            dependencies: [1],
            inputs: ['result1'],
            outputs: ['result2'],
            timeout: 300,
          },
        ],
      };

      const orchestrator = new PhDPipelineOrchestrator(minimalConfig, executor, { tracker });

      executor.setOutput('agent-1', { result1: 'output from agent 1' });
      executor.setOutput('agent-2', { result2: 'output from agent 2' });

      const state = await orchestrator.execute('Test problem');

      expect(state.status).toBe('completed');
      expect(state.completedAgents.size).toBe(2);
      expect(executor.executionLog.length).toBe(2);

      // Verify execution order (agent-1 before agent-2)
      expect(executor.executionLog[0].agentKey).toBe('agent-1');
      expect(executor.executionLog[1].agentKey).toBe('agent-2');

      // Verify inputs were passed
      expect(executor.executionLog[0].inputs).toHaveProperty('problemStatement', 'Test problem');
      expect(executor.executionLog[1].inputs).toHaveProperty('result1', 'output from agent 1');
    });

    it('should track execution in shadow tracker', async () => {
      const minimalConfig: IPipelineConfig = {
        pipeline: {
          name: 'Minimal Test',
          version: '1.0.0',
          description: 'Test',
          totalAgents: 1,
          phases: 1,
        },
        phases: [
          {
            id: 1,
            name: 'Test Phase',
            description: 'Test',
            agents: [1],
            objectives: [],
          },
        ],
        agents: [
          {
            id: 1,
            key: 'test-agent',
            name: 'Test Agent',
            phase: 1,
            description: 'Test',
            dependencies: [],
            inputs: [],
            outputs: [],
            timeout: 300,
          },
        ],
      };

      const orchestrator = new PhDPipelineOrchestrator(minimalConfig, executor, { tracker });
      await orchestrator.execute('Test');

      expect(tracker.records.length).toBe(1);
      expect(tracker.records[0].agentId).toBe(1);
      expect(tracker.records[0].status).toBe('success');
    });
  });

  describe('Execution - Error Handling', () => {
    it('should continue on non-critical agent failure', async () => {
      const config: IPipelineConfig = {
        pipeline: {
          name: 'Test',
          version: '1.0.0',
          description: 'Test',
          totalAgents: 2,
          phases: 1,
        },
        phases: [
          {
            id: 1,
            name: 'Test Phase',
            description: 'Test',
            agents: [1, 2],
            objectives: [],
          },
        ],
        agents: [
          {
            id: 1,
            key: 'non-critical-agent',
            name: 'Non-Critical',
            phase: 1,
            description: 'Test',
            dependencies: [],
            inputs: [],
            outputs: [],
            timeout: 300,
            critical: false,
          },
          {
            id: 2,
            key: 'second-agent',
            name: 'Second',
            phase: 1,
            description: 'Test',
            dependencies: [],
            inputs: [],
            outputs: [],
            timeout: 300,
          },
        ],
      };

      const orchestrator = new PhDPipelineOrchestrator(config, executor, { tracker });
      executor.setFailure('non-critical-agent', 'Non-critical failure');

      const state = await orchestrator.execute('Test');

      // Pipeline should complete despite failure
      expect(state.status).toBe('completed');
      expect(state.errors.length).toBe(1);
      expect(state.errors[0].agentId).toBe(1);

      // Second agent should still execute
      expect(executor.executionLog.some(e => e.agentKey === 'second-agent')).toBe(true);
    });

    it('should halt on critical agent failure', async () => {
      const config: IPipelineConfig = {
        pipeline: {
          name: 'Test',
          version: '1.0.0',
          description: 'Test',
          totalAgents: 2,
          phases: 1,
        },
        phases: [
          {
            id: 1,
            name: 'Test Phase',
            description: 'Test',
            agents: [1, 2],
            objectives: [],
          },
        ],
        agents: [
          {
            id: 1,
            key: 'step-back-analyzer', // Critical agent
            name: 'Critical',
            phase: 1,
            description: 'Test',
            dependencies: [],
            inputs: [],
            outputs: [],
            timeout: 300,
          },
          {
            id: 2,
            key: 'second-agent',
            name: 'Second',
            phase: 1,
            description: 'Test',
            dependencies: [1],
            inputs: [],
            outputs: [],
            timeout: 300,
          },
        ],
      };

      const orchestrator = new PhDPipelineOrchestrator(config, executor, { tracker });
      executor.setFailure('step-back-analyzer', 'Critical failure');

      await expect(orchestrator.execute('Test')).rejects.toThrow(CriticalAgentError);

      const state = orchestrator.getState();
      expect(state?.status).toBe('failed');
    });

    it('should validate critical agent outputs', async () => {
      const config: IPipelineConfig = {
        pipeline: {
          name: 'Test',
          version: '1.0.0',
          description: 'Test',
          totalAgents: 1,
          phases: 1,
        },
        phases: [
          {
            id: 1,
            name: 'Test Phase',
            description: 'Test',
            agents: [1],
            objectives: [],
          },
        ],
        agents: [
          {
            id: 1,
            key: 'step-back-analyzer',
            name: 'Step Back',
            phase: 1,
            description: 'Test',
            dependencies: [],
            inputs: [],
            outputs: [],
            timeout: 300,
          },
        ],
      };

      const orchestrator = new PhDPipelineOrchestrator(config, executor);

      // Set invalid output (missing required fields)
      executor.setOutput('step-back-analyzer', { invalid: 'output' });

      await expect(orchestrator.execute('Test')).rejects.toThrow(CriticalAgentError);
    });
  });

  describe('Progress Tracking', () => {
    it('should track progress during execution', async () => {
      const config: IPipelineConfig = {
        pipeline: {
          name: 'Test',
          version: '1.0.0',
          description: 'Test',
          totalAgents: 3,
          phases: 1,
        },
        phases: [
          {
            id: 1,
            name: 'Test Phase',
            description: 'Test',
            agents: [1, 2, 3],
            objectives: [],
          },
        ],
        agents: [
          {
            id: 1,
            key: 'agent-1',
            name: 'Agent 1',
            phase: 1,
            description: 'Test',
            dependencies: [],
            inputs: [],
            outputs: [],
            timeout: 300,
          },
          {
            id: 2,
            key: 'agent-2',
            name: 'Agent 2',
            phase: 1,
            description: 'Test',
            dependencies: [],
            inputs: [],
            outputs: [],
            timeout: 300,
          },
          {
            id: 3,
            key: 'agent-3',
            name: 'Agent 3',
            phase: 1,
            description: 'Test',
            dependencies: [],
            inputs: [],
            outputs: [],
            timeout: 300,
          },
        ],
      };

      const orchestrator = new PhDPipelineOrchestrator(config, executor);

      // Before execution
      expect(orchestrator.getProgress()).toBeNull();

      await orchestrator.execute('Test');

      // After execution
      const progress = orchestrator.getProgress();
      expect(progress).not.toBeNull();
      expect(progress!.completed).toBe(3);
      expect(progress!.total).toBe(3);
      expect(progress!.percentage).toBe(100);
      expect(progress!.currentPhaseName).toBeDefined();
    });

    it('should return null progress before execution', () => {
      const orchestrator = new PhDPipelineOrchestrator(PHD_PIPELINE_CONFIG, executor);
      expect(orchestrator.getProgress()).toBeNull();
    });
  });

  describe('State Access', () => {
    it('should return null state before execution', () => {
      const orchestrator = new PhDPipelineOrchestrator(PHD_PIPELINE_CONFIG, executor);
      expect(orchestrator.getState()).toBeNull();
    });

    it('should return state after execution starts', async () => {
      const config: IPipelineConfig = {
        pipeline: {
          name: 'Test',
          version: '1.0.0',
          description: 'Test',
          totalAgents: 1,
          phases: 1,
        },
        phases: [
          {
            id: 1,
            name: 'Test Phase',
            description: 'Test',
            agents: [1],
            objectives: [],
          },
        ],
        agents: [
          {
            id: 1,
            key: 'test-agent',
            name: 'Test',
            phase: 1,
            description: 'Test',
            dependencies: [],
            inputs: [],
            outputs: [],
            timeout: 300,
          },
        ],
      };

      const orchestrator = new PhDPipelineOrchestrator(config, executor);
      await orchestrator.execute('Test');

      const state = orchestrator.getState();
      expect(state).not.toBeNull();
      expect(state!.status).toBe('completed');
      expect(state!.pipelineId).toMatch(/^phd-pipeline-/);
    });

    it('should provide agent output access', async () => {
      const config: IPipelineConfig = {
        pipeline: {
          name: 'Test',
          version: '1.0.0',
          description: 'Test',
          totalAgents: 1,
          phases: 1,
        },
        phases: [
          {
            id: 1,
            name: 'Test Phase',
            description: 'Test',
            agents: [1],
            objectives: [],
          },
        ],
        agents: [
          {
            id: 1,
            key: 'test-agent',
            name: 'Test',
            phase: 1,
            description: 'Test',
            dependencies: [],
            inputs: [],
            outputs: [],
            timeout: 300,
          },
        ],
      };

      const orchestrator = new PhDPipelineOrchestrator(config, executor);
      executor.setOutput('test-agent', { testOutput: 'value' });

      await orchestrator.execute('Test');

      const output = orchestrator.getAgentOutput(1);
      expect(output).toEqual({ testOutput: 'value' });
    });

    it('should provide agent execution record', async () => {
      const config: IPipelineConfig = {
        pipeline: {
          name: 'Test',
          version: '1.0.0',
          description: 'Test',
          totalAgents: 1,
          phases: 1,
        },
        phases: [
          {
            id: 1,
            name: 'Test Phase',
            description: 'Test',
            agents: [1],
            objectives: [],
          },
        ],
        agents: [
          {
            id: 1,
            key: 'test-agent',
            name: 'Test',
            phase: 1,
            description: 'Test',
            dependencies: [],
            inputs: [],
            outputs: [],
            timeout: 300,
          },
        ],
      };

      const orchestrator = new PhDPipelineOrchestrator(config, executor);
      await orchestrator.execute('Test');

      const record = orchestrator.getAgentRecord(1);
      expect(record).toBeDefined();
      expect(record!.agentKey).toBe('test-agent');
      expect(record!.status).toBe('success');
      expect(record!.durationMs).toBeDefined();
    });

    it('should check agent completion status', async () => {
      const config: IPipelineConfig = {
        pipeline: {
          name: 'Test',
          version: '1.0.0',
          description: 'Test',
          totalAgents: 1,
          phases: 1,
        },
        phases: [
          {
            id: 1,
            name: 'Test Phase',
            description: 'Test',
            agents: [1],
            objectives: [],
          },
        ],
        agents: [
          {
            id: 1,
            key: 'test-agent',
            name: 'Test',
            phase: 1,
            description: 'Test',
            dependencies: [],
            inputs: [],
            outputs: [],
            timeout: 300,
          },
        ],
      };

      const orchestrator = new PhDPipelineOrchestrator(config, executor);

      // Before execution
      expect(orchestrator.isAgentCompleted(1)).toBe(false);

      await orchestrator.execute('Test');

      // After execution
      expect(orchestrator.isAgentCompleted(1)).toBe(true);
    });
  });

  describe('Topological Sorting', () => {
    it('should execute agents in dependency order', async () => {
      // Create a diamond dependency: 1 -> 2,3 -> 4
      const config: IPipelineConfig = {
        pipeline: {
          name: 'Diamond Test',
          version: '1.0.0',
          description: 'Test',
          totalAgents: 4,
          phases: 1,
        },
        phases: [
          {
            id: 1,
            name: 'Test Phase',
            description: 'Test',
            agents: [1, 2, 3, 4],
            objectives: [],
          },
        ],
        agents: [
          {
            id: 1,
            key: 'root',
            name: 'Root',
            phase: 1,
            description: 'Root agent',
            dependencies: [],
            inputs: [],
            outputs: ['rootOutput'],
            timeout: 300,
          },
          {
            id: 2,
            key: 'left',
            name: 'Left',
            phase: 1,
            description: 'Left branch',
            dependencies: [1],
            inputs: ['rootOutput'],
            outputs: ['leftOutput'],
            timeout: 300,
          },
          {
            id: 3,
            key: 'right',
            name: 'Right',
            phase: 1,
            description: 'Right branch',
            dependencies: [1],
            inputs: ['rootOutput'],
            outputs: ['rightOutput'],
            timeout: 300,
          },
          {
            id: 4,
            key: 'merge',
            name: 'Merge',
            phase: 1,
            description: 'Merge agent',
            dependencies: [2, 3],
            inputs: ['leftOutput', 'rightOutput'],
            outputs: ['finalOutput'],
            timeout: 300,
          },
        ],
      };

      const orchestrator = new PhDPipelineOrchestrator(config, executor);
      await orchestrator.execute('Test');

      // Verify root executed first
      expect(executor.executionLog[0].agentKey).toBe('root');

      // Verify merge executed last
      expect(executor.executionLog[3].agentKey).toBe('merge');

      // Verify left and right executed before merge
      const leftIndex = executor.executionLog.findIndex(e => e.agentKey === 'left');
      const rightIndex = executor.executionLog.findIndex(e => e.agentKey === 'right');
      const mergeIndex = executor.executionLog.findIndex(e => e.agentKey === 'merge');

      expect(leftIndex).toBeLessThan(mergeIndex);
      expect(rightIndex).toBeLessThan(mergeIndex);
    });
  });

  describe('Multi-Phase Execution', () => {
    it('should execute phases sequentially', async () => {
      const config: IPipelineConfig = {
        pipeline: {
          name: 'Multi-Phase Test',
          version: '1.0.0',
          description: 'Test',
          totalAgents: 3,
          phases: 3,
        },
        phases: [
          { id: 1, name: 'Phase 1', description: 'Test', agents: [1], objectives: [] },
          { id: 2, name: 'Phase 2', description: 'Test', agents: [2], objectives: [] },
          { id: 3, name: 'Phase 3', description: 'Test', agents: [3], objectives: [] },
        ],
        agents: [
          {
            id: 1,
            key: 'phase1-agent',
            name: 'Phase 1 Agent',
            phase: 1,
            description: 'Test',
            dependencies: [],
            inputs: [],
            outputs: [],
            timeout: 300,
          },
          {
            id: 2,
            key: 'phase2-agent',
            name: 'Phase 2 Agent',
            phase: 2,
            description: 'Test',
            dependencies: [],
            inputs: [],
            outputs: [],
            timeout: 300,
          },
          {
            id: 3,
            key: 'phase3-agent',
            name: 'Phase 3 Agent',
            phase: 3,
            description: 'Test',
            dependencies: [],
            inputs: [],
            outputs: [],
            timeout: 300,
          },
        ],
      };

      const orchestrator = new PhDPipelineOrchestrator(config, executor);
      await orchestrator.execute('Test');

      // Verify phase order
      expect(executor.executionLog[0].agentKey).toBe('phase1-agent');
      expect(executor.executionLog[1].agentKey).toBe('phase2-agent');
      expect(executor.executionLog[2].agentKey).toBe('phase3-agent');
    });
  });
});

// ==================== Integration Tests ====================

describe('PhD Pipeline Integration', () => {
  let executor: MockAgentExecutor;
  let tracker: MockShadowTracker;

  beforeEach(() => {
    executor = new MockAgentExecutor();
    tracker = new MockShadowTracker();
  });

  it('should validate full 48-agent configuration', () => {
    // This test verifies the actual config passes all validation
    expect(() => new PhDPipelineOrchestrator(PHD_PIPELINE_CONFIG, executor)).not.toThrow();
  });

  it('should have valid DAG with no cycles in production config', () => {
    // The constructor validates DAG - if this passes, no cycles exist
    const orchestrator = new PhDPipelineOrchestrator(PHD_PIPELINE_CONFIG, executor);
    expect(orchestrator).toBeDefined();
  });

  it('should have all critical agents configured correctly', () => {
    const criticalAgents = getCriticalAgents();

    for (const agent of criticalAgents) {
      expect(CRITICAL_AGENT_KEYS).toContain(agent.key);
    }

    // Verify we have all expected critical agents
    expect(criticalAgents.find(a => a.key === 'step-back-analyzer')).toBeDefined();
    expect(criticalAgents.find(a => a.key === 'contradiction-analyzer')).toBeDefined();
    expect(criticalAgents.find(a => a.key === 'adversarial-reviewer')).toBeDefined();
  });

  it('should have consistent agent IDs across phases', () => {
    const allPhaseAgentIds = new Set<number>();

    for (const phase of PHD_PIPELINE_CONFIG.phases) {
      for (const agentId of phase.agents) {
        // No duplicate agent IDs across phases
        expect(allPhaseAgentIds.has(agentId)).toBe(false);
        allPhaseAgentIds.add(agentId);
      }
    }

    // All 48 agents should be assigned to exactly one phase
    expect(allPhaseAgentIds.size).toBe(48);
  });

  it('should have valid dependency references', () => {
    const validIds = new Set(PHD_PIPELINE_CONFIG.agents.map(a => a.id));

    for (const agent of PHD_PIPELINE_CONFIG.agents) {
      for (const depId of agent.dependencies) {
        expect(validIds.has(depId)).toBe(true);
      }
    }
  });

  it('should have foundation agents with no external phase dependencies', () => {
    const phase1Agents = getAgentsByPhase(1);
    const phase1Ids = new Set(phase1Agents.map(a => a.id));

    for (const agent of phase1Agents) {
      // Phase 1 agents should only depend on other Phase 1 agents (or nothing)
      for (const depId of agent.dependencies) {
        expect(phase1Ids.has(depId)).toBe(true);
      }
    }
  });
});
