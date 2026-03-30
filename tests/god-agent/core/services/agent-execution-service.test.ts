/**
 * Agent Execution Service Tests
 * TASK-DEV-004 - Unit tests for AgentExecutionService
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AgentExecutionService,
  createAgentExecutionService,
} from '../../../../src/god-agent/core/services/agent-execution-service.js';
import type { AgentRegistry } from '../../../../src/god-agent/core/agents/agent-registry.js';
import type { IAgentExecutor, IAgentDefinition } from '../../../../src/god-agent/core/orchestration/orchestration-types.js';
import type { SonaEngine } from '../../../../src/god-agent/core/learning/sona-engine.js';
import type { ILoadedAgentDefinition } from '../../../../src/god-agent/core/agents/agent-types.js';
import type { IMemoryEngine } from '../../../../src/god-agent/core/pipeline/phd-pipeline-runner.js';

// ==================== Mock Data ====================

const mockAgentDefinition: ILoadedAgentDefinition = {
  key: 'coder',
  category: 'core',
  filePath: '/mock/agents/core/coder.md',
  frontmatter: {
    name: 'Coder',
    description: 'Implementation specialist for writing clean, efficient code',
    priority: 'high',
    type: 'developer',
    capabilities: ['code_generation', 'refactoring'],
    tools: ['Read', 'Write', 'Edit'],
  },
  promptContent: '# Coder Agent\n\nImplement code...',
  filePath: '/mock/agents/core/coder.md',
  loadedAt: Date.now(),
};

const mockTesterDefinition: ILoadedAgentDefinition = {
  key: 'tester',
  category: 'core',
  filePath: '/mock/agents/core/tester.md',
  frontmatter: {
    name: 'Tester',
    description: 'Comprehensive testing and quality assurance specialist',
    priority: 'high',
    type: 'validator',
    capabilities: ['unit_testing', 'integration_testing'],
    tools: ['Read', 'Bash'],
  },
  promptContent: '# Tester Agent\n\nWrite tests...',
  loadedAt: Date.now(),
};

const mockReviewerDefinition: ILoadedAgentDefinition = {
  key: 'reviewer',
  category: 'core',
  filePath: '/mock/agents/core/reviewer.md',
  frontmatter: {
    name: 'Reviewer',
    description: 'Code review and quality assurance specialist',
    priority: 'medium',
    type: 'validator',
    capabilities: ['code_review', 'security_review'],
    tools: ['Read', 'Grep'],
  },
  promptContent: '# Reviewer Agent\n\nReview code...',
  loadedAt: Date.now(),
};

// ==================== Mock Implementations ====================

function createMockRegistry(agents: ILoadedAgentDefinition[] = [mockAgentDefinition]): AgentRegistry {
  const agentMap = new Map(agents.map(a => [a.key, a]));

  return {
    getByKey: vi.fn((key: string) => agentMap.get(key) ?? null),
    getAll: vi.fn(() => agents),
    getByCategory: vi.fn((category: string) => agents.filter(a => a.category === category)),
    getByCapability: vi.fn((cap: string) =>
      agents.filter(a => a.frontmatter.capabilities?.some(c => c.includes(cap)))
    ),
    getCategoryNames: vi.fn(() => [...new Set(agents.map(a => a.category))]),
    size: agents.length,
  } as unknown as AgentRegistry;
}

function createMockExecutor(
  response: string = 'Agent output',
  shouldFail: boolean = false
): IAgentExecutor {
  return {
    execute: vi.fn(async (_prompt: string, _agentDef: IAgentDefinition) => {
      if (shouldFail) {
        throw new Error('Execution failed');
      }
      return response;
    }),
  } as unknown as IAgentExecutor;
}

function createMockSonaEngine(): SonaEngine {
  return {
    createTrajectory: vi.fn(() => 'trajectory-123'),
    provideFeedback: vi.fn(async () => {}),
  } as unknown as SonaEngine;
}

function createMockMemoryEngine(): IMemoryEngine {
  const storage = new Map<string, string>();

  return {
    store: vi.fn(async (key: string, content: string) => {
      storage.set(key, content);
    }),
    retrieve: vi.fn(async (key: string) => {
      return storage.get(key) ?? null;
    }),
  };
}

// ==================== Tests ====================

describe('AgentExecutionService', () => {
  let service: AgentExecutionService;
  let mockRegistry: AgentRegistry;
  let mockExecutor: IAgentExecutor;

  beforeEach(() => {
    mockRegistry = createMockRegistry([mockAgentDefinition, mockTesterDefinition, mockReviewerDefinition]);
    mockExecutor = createMockExecutor('Test output');
    service = new AgentExecutionService(mockRegistry, mockExecutor);
  });

  describe('executeAgent', () => {
    it('should execute a single agent successfully', async () => {
      const result = await service.executeAgent('coder', 'Write a function');

      expect(result.success).toBe(true);
      expect(result.agentKey).toBe('coder');
      expect(result.output).toBe('Test output');
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.category).toBe('core');
    });

    it('should return error for unknown agent', async () => {
      const result = await service.executeAgent('unknown', 'Some task');

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
      expect(result.agentKey).toBe('unknown');
    });

    it('should handle execution failure', async () => {
      const failingExecutor = createMockExecutor('', true);
      const failingService = new AgentExecutionService(mockRegistry, failingExecutor);

      const result = await failingService.executeAgent('coder', 'Write code');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Execution failed');
    });

    it('should track trajectory when enabled', async () => {
      const mockSona = createMockSonaEngine();
      const serviceWithSona = new AgentExecutionService(
        mockRegistry,
        mockExecutor,
        { trackTrajectories: true },
        mockSona
      );

      const result = await serviceWithSona.executeAgent('coder', 'Write code');

      expect(result.success).toBe(true);
      expect(result.trajectoryId).toBe('trajectory-123');
      expect(mockSona.createTrajectory).toHaveBeenCalled();
      expect(mockSona.provideFeedback).toHaveBeenCalledWith('trajectory-123', 1.0, { skipAutoSave: false });
    });

    it('should provide negative feedback on failure', async () => {
      const mockSona = createMockSonaEngine();
      const failingExecutor = createMockExecutor('', true);
      const serviceWithSona = new AgentExecutionService(
        mockRegistry,
        failingExecutor,
        { trackTrajectories: true },
        mockSona
      );

      await serviceWithSona.executeAgent('coder', 'Write code');

      expect(mockSona.provideFeedback).toHaveBeenCalledWith('trajectory-123', 0.0, { skipAutoSave: false });
    });

    it('should store result in memory when namespace provided', async () => {
      const mockMemory = createMockMemoryEngine();
      const serviceWithMemory = new AgentExecutionService(
        mockRegistry,
        mockExecutor,
        {},
        undefined,
        mockMemory
      );

      const result = await serviceWithMemory.executeAgent('coder', 'Write code', {
        namespace: 'project/api',
      });

      expect(result.success).toBe(true);
      expect(result.memoryKey).toBeDefined();
      expect(mockMemory.store).toHaveBeenCalled();
    });

    it('should retrieve context from memory when retrieveKeys provided', async () => {
      const mockMemory = createMockMemoryEngine();
      await mockMemory.store('prev-step', 'Previous context', { namespace: 'test' });

      const serviceWithMemory = new AgentExecutionService(
        mockRegistry,
        mockExecutor,
        {},
        undefined,
        mockMemory
      );

      const result = await serviceWithMemory.executeAgent('coder', 'Write code', {
        retrieveKeys: ['prev-step'],
        namespace: 'test',
      });

      expect(result.success).toBe(true);
      expect(mockMemory.retrieve).toHaveBeenCalledWith('prev-step', { namespace: 'test' });
    });

    it('should respect custom timeout', async () => {
      const slowExecutor: IAgentExecutor = {
        execute: vi.fn(async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 'Done';
        }),
      } as unknown as IAgentExecutor;

      const serviceWithSlowExecutor = new AgentExecutionService(
        mockRegistry,
        slowExecutor,
        { defaultTimeout: 50 }
      );

      const result = await serviceWithSlowExecutor.executeAgent('coder', 'Write code');

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });
  });

  describe('executeChain', () => {
    it('should execute a chain of agents successfully', async () => {
      const result = await service.executeChain([
        { agent: 'coder', task: 'Write code' },
        { agent: 'tester', task: 'Write tests' },
        { agent: 'reviewer', task: 'Review code' },
      ]);

      expect(result.success).toBe(true);
      expect(result.steps).toHaveLength(3);
      expect(result.steps.every(s => s.success)).toBe(true);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should stop chain on first failure', async () => {
      // Make tester fail
      const selectiveExecutor: IAgentExecutor = {
        execute: vi.fn(async (_prompt: string, agentDef: IAgentDefinition) => {
          if (agentDef.agentType === 'tester') {
            throw new Error('Test failure');
          }
          return 'Success';
        }),
      } as unknown as IAgentExecutor;

      const serviceWithSelectiveExecutor = new AgentExecutionService(
        mockRegistry,
        selectiveExecutor
      );

      const result = await serviceWithSelectiveExecutor.executeChain([
        { agent: 'coder', task: 'Write code' },
        { agent: 'tester', task: 'Write tests' },
        { agent: 'reviewer', task: 'Review code' },
      ]);

      expect(result.success).toBe(false);
      expect(result.failedAtStep).toBe(1);
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].success).toBe(true);
      expect(result.steps[1].success).toBe(false);
    });

    it('should pass memory keys between steps', async () => {
      const mockMemory = createMockMemoryEngine();
      const serviceWithMemory = new AgentExecutionService(
        mockRegistry,
        mockExecutor,
        {},
        undefined,
        mockMemory
      );

      const result = await serviceWithMemory.executeChain([
        { agent: 'coder', task: 'Write code' },
        { agent: 'tester', task: 'Write tests' },
      ], {
        namespace: 'project/chain',
      });

      expect(result.success).toBe(true);
      // Second step should have retrieved from first step's memory key
      expect(mockMemory.retrieve).toHaveBeenCalled();
    });

    it('should handle empty chain', async () => {
      const result = await service.executeChain([]);

      expect(result.success).toBe(true);
      expect(result.steps).toHaveLength(0);
    });

    it('should handle single-step chain', async () => {
      const result = await service.executeChain([
        { agent: 'coder', task: 'Write code' },
      ]);

      expect(result.success).toBe(true);
      expect(result.steps).toHaveLength(1);
    });
  });

  describe('listAgents', () => {
    it('should list all agents without filter', () => {
      const agents = service.listAgents();

      expect(agents).toHaveLength(3);
      expect(agents.map(a => a.key)).toContain('coder');
      expect(agents.map(a => a.key)).toContain('tester');
      expect(agents.map(a => a.key)).toContain('reviewer');
    });

    it('should filter by category', () => {
      const agents = service.listAgents({ category: 'core' });

      expect(agents).toHaveLength(3);
      expect(agents.every(a => a.category === 'core')).toBe(true);
    });

    it('should filter by capability', () => {
      const agents = service.listAgents({ capability: 'unit_testing' });

      expect(agents.length).toBeGreaterThanOrEqual(1);
      expect(agents.some(a => a.capabilities.some(c => c.includes('unit_testing')))).toBe(true);
    });

    it('should filter by priority', () => {
      const agents = service.listAgents({ priority: 'high' });

      expect(agents.length).toBeGreaterThanOrEqual(1);
      expect(agents.every(a => a.priority === 'high')).toBe(true);
    });

    it('should filter by name pattern', () => {
      const agents = service.listAgents({ namePattern: 'cod' });

      expect(agents.length).toBe(1);
      expect(agents[0].key).toBe('coder');
    });

    it('should handle multiple filters', () => {
      const agents = service.listAgents({
        category: 'core',
        priority: 'high',
      });

      expect(agents.length).toBeGreaterThanOrEqual(1);
      expect(agents.every(a => a.category === 'core' && a.priority === 'high')).toBe(true);
    });

    it('should return empty array for non-matching filter', () => {
      const agents = service.listAgents({ category: 'nonexistent' });

      expect(agents).toHaveLength(0);
    });
  });

  describe('getAgentInfo', () => {
    it('should return info for existing agent', () => {
      const info = service.getAgentInfo('coder');

      expect(info).not.toBeNull();
      expect(info?.key).toBe('coder');
      expect(info?.name).toBe('Coder');
      expect(info?.description).toContain('Implementation');
      expect(info?.category).toBe('core');
      expect(info?.capabilities).toContain('code_generation');
      expect(info?.priority).toBe('high');
    });

    it('should return null for unknown agent', () => {
      const info = service.getAgentInfo('unknown');

      expect(info).toBeNull();
    });
  });

  describe('getCategories', () => {
    it('should return category names', () => {
      const categories = service.getCategories();

      expect(categories).toContain('core');
    });
  });

  describe('getAgentCount', () => {
    it('should return total agent count', () => {
      const count = service.getAgentCount();

      expect(count).toBe(3);
    });
  });
});

describe('createAgentExecutionService factory', () => {
  it('should create service with all dependencies', () => {
    const registry = createMockRegistry();
    const executor = createMockExecutor();
    const sona = createMockSonaEngine();
    const memory = createMockMemoryEngine();

    const service = createAgentExecutionService(
      registry,
      executor,
      { verbose: false, defaultTimeout: 60000 },
      sona,
      memory
    );

    expect(service).toBeInstanceOf(AgentExecutionService);
  });

  it('should create service with minimal dependencies', () => {
    const registry = createMockRegistry();
    const executor = createMockExecutor();

    const service = createAgentExecutionService(registry, executor);

    expect(service).toBeInstanceOf(AgentExecutionService);
  });
});
