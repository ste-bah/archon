/**
 * Agent Execution Integration Tests
 * TASK-DEV-005 - Integration tests for GodAgent.runAgent/runAgentChain
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import {
  AgentExecutionService,
  createAgentExecutionService,
} from '../../../../src/god-agent/core/services/agent-execution-service.js';
import {
  AgentRegistry,
  createAgentRegistry,
} from '../../../../src/god-agent/core/agents/agent-registry.js';
import type {
  IAgentExecutor,
  IAgentDefinition,
} from '../../../../src/god-agent/core/orchestration/orchestration-types.js';
import type { IMemoryEngine } from '../../../../src/god-agent/core/pipeline/phd-pipeline-runner.js';

// ==================== Constants ====================

const AGENTS_BASE_PATH = join(process.cwd(), '.claude/agents');

// ==================== Mock Implementations ====================

/**
 * Mock executor that simulates successful agent execution
 */
class MockSuccessExecutor implements IAgentExecutor {
  public executionCount = 0;
  public executedAgents: string[] = [];
  public executedPrompts: string[] = [];

  async execute(prompt: string, agent: IAgentDefinition): Promise<string> {
    this.executionCount++;
    this.executedAgents.push(agent.agentType ?? agent.agentName);
    this.executedPrompts.push(prompt);

    // Simulate meaningful output
    return `## ${agent.agentName} Output

Task completed successfully.

### Summary
- Agent: ${agent.agentName}
- Phase: ${agent.phase}
- Position: ${agent.position}

### Details
Lorem ipsum dolor sit amet, consectetur adipiscing elit.
Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
`;
  }
}

/**
 * Mock executor that fails at specific agent
 */
class MockFailingExecutor implements IAgentExecutor {
  constructor(public failAtAgentKey: string) {}
  public executionCount = 0;

  async execute(prompt: string, agent: IAgentDefinition): Promise<string> {
    this.executionCount++;

    if (agent.agentType === this.failAtAgentKey) {
      throw new Error(`Simulated failure at ${agent.agentName}`);
    }

    return `Output for ${agent.agentName}`;
  }
}

/**
 * Mock memory engine for testing
 */
class MockMemoryEngine implements IMemoryEngine {
  private storage = new Map<string, string>();
  public storeCount = 0;
  public retrieveCount = 0;

  async store(
    key: string,
    content: string,
    options?: { namespace?: string; metadata?: Record<string, unknown> }
  ): Promise<void> {
    this.storeCount++;
    const fullKey = options?.namespace ? `${options.namespace}:${key}` : key;
    this.storage.set(fullKey, content);
  }

  async retrieve(key: string, options?: { namespace?: string }): Promise<string | null> {
    this.retrieveCount++;
    const fullKey = options?.namespace ? `${options.namespace}:${key}` : key;
    return this.storage.get(fullKey) ?? null;
  }

  getAll(): Map<string, string> {
    return new Map(this.storage);
  }

  clear(): void {
    this.storage.clear();
  }
}

/**
 * Mock Sona Engine for trajectory tracking
 */
class MockSonaEngine {
  public trajectories: Array<{ id: string; route: string; tags: string[] }> = [];
  public feedbacks: Array<{ trajectoryId: string; quality: number }> = [];

  createTrajectory(route: string, tags: string[], _contextIds: string[]): string {
    const id = `trajectory-${this.trajectories.length + 1}`;
    this.trajectories.push({ id, route, tags });
    return id;
  }

  async provideFeedback(trajectoryId: string, quality: number): Promise<void> {
    this.feedbacks.push({ trajectoryId, quality });
  }
}

// ==================== Integration Tests ====================

describe('Agent Execution Integration', () => {
  let registry: AgentRegistry;
  let executor: MockSuccessExecutor;
  let service: AgentExecutionService;

  beforeEach(async () => {
    // Use real agent registry with actual agent definitions
    registry = await createAgentRegistry(AGENTS_BASE_PATH, { verbose: false });
    executor = new MockSuccessExecutor();
    service = createAgentExecutionService(registry, executor);
  });

  describe('Real Agent Registry Integration', () => {
    it('should load agents from .claude/agents directory', () => {
      const agents = service.listAgents();

      expect(agents.length).toBeGreaterThan(0);
      console.log(`Loaded ${agents.length} agents from ${service.getCategories().length} categories`);
    });

    it('should have development-focused agents available', () => {
      // Check for core development agents
      const coder = service.getAgentInfo('coder');
      const tester = service.getAgentInfo('tester');
      const reviewer = service.getAgentInfo('reviewer');

      // At least some development agents should exist
      const devAgents = [coder, tester, reviewer].filter(a => a !== null);
      expect(devAgents.length).toBeGreaterThan(0);
    });

    it('should categorize agents correctly', () => {
      const categories = service.getCategories();

      // Should have multiple categories
      expect(categories.length).toBeGreaterThan(0);
      console.log('Categories:', categories);
    });

    it('should filter agents by category', () => {
      const categories = service.getCategories();

      for (const category of categories.slice(0, 3)) {
        const agents = service.listAgents({ category });
        expect(agents.every(a => a.category === category)).toBe(true);
        console.log(`${category}: ${agents.length} agents`);
      }
    });
  });

  describe('Single Agent Execution', () => {
    it('should execute an agent from the registry', async () => {
      // Find any available agent
      const agents = service.listAgents();
      expect(agents.length).toBeGreaterThan(0);

      const firstAgent = agents[0];
      const result = await service.executeAgent(firstAgent.key, 'Test task');

      expect(result.success).toBe(true);
      expect(result.agentKey).toBe(firstAgent.key);
      expect(result.output).toBeTruthy();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(executor.executionCount).toBe(1);
    });

    it('should include agent category in result', async () => {
      const agents = service.listAgents();
      const firstAgent = agents[0];

      const result = await service.executeAgent(firstAgent.key, 'Test task');

      expect(result.success).toBe(true);
      expect(result.category).toBe(firstAgent.category);
    });

    it('should handle additional context', async () => {
      const agents = service.listAgents();
      const firstAgent = agents[0];

      const result = await service.executeAgent(firstAgent.key, 'Test task', {
        context: 'Additional project context here',
      });

      expect(result.success).toBe(true);
      // Context should be included in the prompt
      expect(executor.executedPrompts[0]).toContain('Additional project context');
    });
  });

  describe('Agent Chain Execution', () => {
    it('should execute a chain of multiple agents', async () => {
      const agents = service.listAgents();
      expect(agents.length).toBeGreaterThanOrEqual(2);

      const chain = agents.slice(0, 2).map(a => ({
        agent: a.key,
        task: `Task for ${a.name}`,
      }));

      const result = await service.executeChain(chain);

      expect(result.success).toBe(true);
      expect(result.steps).toHaveLength(2);
      expect(result.steps.every(s => s.success)).toBe(true);
      expect(executor.executionCount).toBe(2);
    });

    it('should execute 3-step development workflow', async () => {
      const agents = service.listAgents();
      const agentKeys = agents.map(a => a.key);

      // Build a chain with available agents
      const chain = agentKeys.slice(0, 3).map(key => ({
        agent: key,
        task: `Development task step for ${key}`,
      }));

      const result = await service.executeChain(chain);

      expect(result.success).toBe(true);
      expect(result.steps).toHaveLength(3);
      expect(executor.executionCount).toBe(3);
    });

    it('should stop chain on failure', async () => {
      const agents = service.listAgents();
      expect(agents.length).toBeGreaterThanOrEqual(2);

      // Create executor that fails on second agent
      const failingExecutor = new MockFailingExecutor(agents[1].key);
      const failingService = createAgentExecutionService(registry, failingExecutor);

      const chain = agents.slice(0, 3).map(a => ({
        agent: a.key,
        task: `Task for ${a.name}`,
      }));

      const result = await failingService.executeChain(chain);

      expect(result.success).toBe(false);
      expect(result.failedAtStep).toBe(1);
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].success).toBe(true);
      expect(result.steps[1].success).toBe(false);
    });
  });

  describe('Memory Coordination', () => {
    let memoryEngine: MockMemoryEngine;
    let serviceWithMemory: AgentExecutionService;

    beforeEach(() => {
      memoryEngine = new MockMemoryEngine();
      serviceWithMemory = createAgentExecutionService(
        registry,
        executor,
        {},
        undefined,
        memoryEngine
      );
    });

    it('should store agent output in memory', async () => {
      const agents = serviceWithMemory.listAgents();
      const firstAgent = agents[0];

      const result = await serviceWithMemory.executeAgent(firstAgent.key, 'Test task', {
        namespace: 'test/integration',
      });

      expect(result.success).toBe(true);
      expect(result.memoryKey).toBeDefined();
      expect(memoryEngine.storeCount).toBe(1);

      const storedContent = memoryEngine.getAll();
      expect(storedContent.size).toBe(1);
    });

    it('should coordinate memory across chain steps', async () => {
      const agents = serviceWithMemory.listAgents();
      const chain = agents.slice(0, 2).map(a => ({
        agent: a.key,
        task: `Task for ${a.name}`,
      }));

      const result = await serviceWithMemory.executeChain(chain, {
        namespace: 'test/chain',
      });

      expect(result.success).toBe(true);
      // Should store output for each step
      expect(memoryEngine.storeCount).toBe(2);
      // Second step should retrieve from first step
      expect(memoryEngine.retrieveCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Trajectory Tracking', () => {
    let sonaEngine: MockSonaEngine;
    let serviceWithSona: AgentExecutionService;

    beforeEach(() => {
      sonaEngine = new MockSonaEngine();
      serviceWithSona = createAgentExecutionService(
        registry,
        executor,
        { trackTrajectories: true },
        sonaEngine as any
      );
    });

    it('should create trajectory for agent execution', async () => {
      const agents = serviceWithSona.listAgents();
      const firstAgent = agents[0];

      const result = await serviceWithSona.executeAgent(firstAgent.key, 'Test task');

      expect(result.success).toBe(true);
      expect(result.trajectoryId).toBe('trajectory-1');
      expect(sonaEngine.trajectories).toHaveLength(1);
      expect(sonaEngine.feedbacks).toHaveLength(1);
      expect(sonaEngine.feedbacks[0].quality).toBe(1.0);
    });

    it('should track trajectories for each chain step', async () => {
      const agents = serviceWithSona.listAgents();
      const chain = agents.slice(0, 2).map(a => ({
        agent: a.key,
        task: `Task for ${a.name}`,
      }));

      const result = await serviceWithSona.executeChain(chain);

      expect(result.success).toBe(true);
      expect(sonaEngine.trajectories).toHaveLength(2);
      expect(sonaEngine.feedbacks).toHaveLength(2);
    });

    it('should provide negative feedback on failure', async () => {
      const agents = serviceWithSona.listAgents();
      const failingExecutor = new MockFailingExecutor(agents[0].key);
      const failingSonaService = createAgentExecutionService(
        registry,
        failingExecutor,
        { trackTrajectories: true },
        sonaEngine as any
      );

      const result = await failingSonaService.executeAgent(agents[0].key, 'Test task');

      expect(result.success).toBe(false);
      expect(sonaEngine.feedbacks).toHaveLength(1);
      expect(sonaEngine.feedbacks[0].quality).toBe(0.0);
    });
  });

  describe('Agent Information Retrieval', () => {
    it('should retrieve complete agent info', () => {
      const agents = service.listAgents();
      expect(agents.length).toBeGreaterThan(0);

      const firstAgent = agents[0];
      const info = service.getAgentInfo(firstAgent.key);

      expect(info).not.toBeNull();
      expect(info?.key).toBe(firstAgent.key);
      expect(info?.name).toBeDefined();
      expect(info?.description).toBeDefined();
      expect(info?.category).toBeDefined();
      expect(info?.capabilities).toBeDefined();
      expect(info?.priority).toBeDefined();
    });

    it('should filter by multiple criteria', () => {
      const allAgents = service.listAgents();
      const categories = service.getCategories();

      if (categories.length > 0) {
        const filtered = service.listAgents({
          category: categories[0],
        });

        expect(filtered.length).toBeLessThanOrEqual(allAgents.length);
        expect(filtered.every(a => a.category === categories[0])).toBe(true);
      }
    });
  });
});

describe('Agent Execution Error Handling', () => {
  let registry: AgentRegistry;

  beforeEach(async () => {
    registry = await createAgentRegistry(AGENTS_BASE_PATH, { verbose: false });
  });

  it('should handle unknown agent gracefully', async () => {
    const executor = new MockSuccessExecutor();
    const service = createAgentExecutionService(registry, executor);

    const result = await service.executeAgent('nonexistent-agent-12345', 'Test task');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
    expect(executor.executionCount).toBe(0);
  });

  it('should handle executor timeout', async () => {
    const slowExecutor: IAgentExecutor = {
      execute: async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return 'Slow output';
      },
    } as IAgentExecutor;

    const service = createAgentExecutionService(registry, slowExecutor, {
      defaultTimeout: 50,
    });

    const agents = service.listAgents();
    const result = await service.executeAgent(agents[0].key, 'Test task');

    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });
});
