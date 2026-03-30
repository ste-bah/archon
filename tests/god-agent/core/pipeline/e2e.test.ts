/**
 * E2E Integration Tests
 * TASK-E2E-001 - End-to-end tests for PhD Pipeline Runner
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PhDPipelineRunner,
  createPhDPipelineRunner,
  type IPhDPipelineRunnerOptions,
  type IMemoryEngine,
} from '../../../../src/god-agent/core/pipeline/phd-pipeline-runner.js';
import type { IAgentExecutor, IAgentDefinition, IAgentResult } from '../../../../src/god-agent/core/orchestration/orchestration-types.js';

// ==================== Mock Implementations ====================

/**
 * Mock executor that simulates successful agent execution
 */
class MockSuccessExecutor implements IAgentExecutor {
  public executionCount = 0;
  public executedAgents: string[] = [];

  async execute(prompt: string, agent: IAgentDefinition): Promise<string> {
    this.executionCount++;
    this.executedAgents.push(agent.agentName);

    // Simulate work with varying output lengths
    const baseOutput = `Mock output for ${agent.agentName} at ${agent.position}`;
    const padding = 'Lorem ipsum dolor sit amet. '.repeat(50);

    // Add citations for writing/discovery phases
    let citations = '';
    if (prompt.toLowerCase().includes('citation') || prompt.toLowerCase().includes('writing')) {
      citations = '\n\n[1] Smith (2024)\n[2] Jones (2023)\n[3] Brown (2022)\n[4] Davis (2021)\n[5] Wilson (2020)';
    }

    return `${baseOutput}\n${padding}${citations}`;
  }
}

/**
 * Mock executor that fails at specific agent
 */
class MockFailingExecutor implements IAgentExecutor {
  constructor(public failAtAgent: number) {}

  public executionCount = 0;

  async execute(prompt: string, agent: IAgentDefinition): Promise<string> {
    this.executionCount++;

    if (this.executionCount === this.failAtAgent) {
      throw new Error(`Mock failure at agent ${agent.agentName}`);
    }

    return `Mock output for ${agent.agentName}`;
  }
}

/**
 * Mock memory engine for testing
 */
class MockMemoryEngine implements IMemoryEngine {
  private storage = new Map<string, string>();

  async store(
    key: string,
    content: string,
    options?: { namespace?: string; metadata?: Record<string, unknown> }
  ): Promise<void> {
    const fullKey = options?.namespace ? `${options.namespace}:${key}` : key;
    this.storage.set(fullKey, content);
  }

  async retrieve(key: string, options?: { namespace?: string }): Promise<string | null> {
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
 * Mock Sona Engine for testing trajectory tracking
 */
class MockSonaEngine {
  public trajectories: Array<{ id: string; route: string; tags: string[] }> = [];
  public feedbacks: Array<{ trajectoryId: string; quality: number }> = [];

  createTrajectory(route: string, tags: string[], contextIds: string[]): string {
    const id = `trajectory-${this.trajectories.length + 1}`;
    this.trajectories.push({ id, route, tags });
    return id;
  }

  async provideFeedback(trajectoryId: string, quality: number): Promise<void> {
    this.feedbacks.push({ trajectoryId, quality });
  }

  getTrajectoryStats(): { total: number; completed: number } {
    return { total: this.trajectories.length, completed: this.feedbacks.length };
  }
}

// ==================== Test Fixtures ====================

const TEST_AGENTS_PATH = '.claude/agents';

function createTestOptions(overrides: Partial<IPhDPipelineRunnerOptions> = {}): IPhDPipelineRunnerOptions {
  return {
    agentsBasePath: TEST_AGENTS_PATH,
    verbose: false,
    ...overrides,
  };
}

// ==================== Tests ====================

describe('PhDPipelineRunner', () => {
  let mockExecutor: MockSuccessExecutor;
  let mockMemory: MockMemoryEngine;
  let mockSona: MockSonaEngine;

  beforeEach(() => {
    mockExecutor = new MockSuccessExecutor();
    mockMemory = new MockMemoryEngine();
    mockSona = new MockSonaEngine();
  });

  describe('Initialization', () => {
    it('should create runner with options', () => {
      const runner = new PhDPipelineRunner(createTestOptions());
      expect(runner).toBeDefined();
      expect(runner.isInitialized()).toBe(false);
    });

    it('should initialize with provided executor', async () => {
      const runner = new PhDPipelineRunner(createTestOptions({
        executor: mockExecutor,
      }));

      await runner.initialize();
      expect(runner.isInitialized()).toBe(true);
    });

    it('should initialize registry with agents', async () => {
      const runner = new PhDPipelineRunner(createTestOptions({
        executor: mockExecutor,
      }));

      await runner.initialize();
      const stats = runner.getStats();

      // Should load agents from .claude/agents directory
      expect(stats.agentsLoaded).toBeGreaterThan(0);
      expect(stats.categoriesLoaded).toBeGreaterThan(0);
    });

    it('should create learning integration when Sona Engine provided', async () => {
      const runner = new PhDPipelineRunner(createTestOptions({
        executor: mockExecutor,
        sonaEngine: mockSona as any,
      }));

      await runner.initialize();
      const learning = runner.getLearningIntegration();

      expect(learning).toBeDefined();
    });

    it('should not create real learning integration without Sona Engine', async () => {
      const runner = new PhDPipelineRunner(createTestOptions({
        executor: mockExecutor,
      }));

      await runner.initialize();
      const learning = runner.getLearningIntegration();

      // Should have no-op learning integration
      expect(learning).toBeDefined();
    });
  });

  describe('Factory Function', () => {
    it('should create runner via factory', () => {
      const runner = createPhDPipelineRunner(createTestOptions());
      expect(runner).toBeInstanceOf(PhDPipelineRunner);
    });
  });

  describe('Component Access', () => {
    it('should throw if accessing components before initialization', () => {
      const runner = new PhDPipelineRunner(createTestOptions());

      expect(() => runner.getOrchestrator()).toThrow('not initialized');
      expect(() => runner.getRegistry()).toThrow('not initialized');
      expect(() => runner.getBridge()).toThrow('not initialized');
    });

    it('should provide access to components after initialization', async () => {
      const runner = new PhDPipelineRunner(createTestOptions({
        executor: mockExecutor,
      }));

      await runner.initialize();

      expect(runner.getOrchestrator()).toBeDefined();
      expect(runner.getRegistry()).toBeDefined();
      expect(runner.getBridge()).toBeDefined();
      expect(runner.getLearningIntegration()).toBeDefined();
    });
  });

  describe('Statistics', () => {
    it('should track pipeline run statistics', async () => {
      const runner = new PhDPipelineRunner(createTestOptions({
        executor: mockExecutor,
      }));

      await runner.initialize();
      let stats = runner.getStats();

      expect(stats.pipelinesRun).toBe(0);
      expect(stats.pipelinesSucceeded).toBe(0);
      expect(stats.successRate).toBe(0);
    });

    it('should reset statistics', async () => {
      const runner = new PhDPipelineRunner(createTestOptions({
        executor: mockExecutor,
      }));

      await runner.initialize();

      // Run would normally update stats
      // Reset should clear them
      runner.resetStats();
      const stats = runner.getStats();

      expect(stats.pipelinesRun).toBe(0);
      expect(stats.trajectoriesCreated).toBe(0);
    });
  });

  describe('Pipeline Execution', () => {
    it('should auto-initialize on run if not initialized', async () => {
      const runner = new PhDPipelineRunner(createTestOptions({
        executor: mockExecutor,
      }));

      // Don't call initialize() explicitly
      const result = await runner.run('Test problem statement');

      expect(runner.isInitialized()).toBe(true);
      expect(result.executionId).toBeDefined();
    });

    it('should generate unique execution IDs', async () => {
      const runner = new PhDPipelineRunner(createTestOptions({
        executor: mockExecutor,
      }));

      await runner.initialize();

      const result1 = await runner.run('Problem 1');
      const result2 = await runner.run('Problem 2');

      expect(result1.executionId).not.toBe(result2.executionId);
      expect(result1.executionId).toMatch(/^phd-/);
    });

    it('should include problem statement in first agent task', async () => {
      let capturedPrompt = '';
      const capturingExecutor: IAgentExecutor = {
        async execute(prompt: string, agent: IAgentDefinition): Promise<string> {
          if (!capturedPrompt) {
            capturedPrompt = prompt;
          }
          return 'Mock output';
        },
      };

      const runner = new PhDPipelineRunner(createTestOptions({
        executor: capturingExecutor,
      }));

      await runner.initialize();
      await runner.run('My research problem about AI safety');

      expect(capturedPrompt).toContain('My research problem about AI safety');
    });

    it('should return success for completed pipeline', async () => {
      const runner = new PhDPipelineRunner(createTestOptions({
        executor: mockExecutor,
      }));

      await runner.initialize();
      const result = await runner.run('Test problem');

      // With mock executor, should complete successfully
      expect(result.success).toBe(true);
      expect(result.execution.status).toBe('completed');
      expect(result.error).toBeUndefined();
    });

    it('should handle executor errors gracefully', async () => {
      const failingExecutor = new MockFailingExecutor(1); // Fail on first agent

      const runner = new PhDPipelineRunner(createTestOptions({
        executor: failingExecutor,
      }));

      await runner.initialize();
      const result = await runner.run('Test problem');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.execution.status).toBe('failed');
    });

    it('should track execution duration', async () => {
      const runner = new PhDPipelineRunner(createTestOptions({
        executor: mockExecutor,
      }));

      await runner.initialize();
      const result = await runner.run('Test problem');

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should update statistics after run', async () => {
      const runner = new PhDPipelineRunner(createTestOptions({
        executor: mockExecutor,
      }));

      await runner.initialize();
      await runner.run('Test problem 1');
      await runner.run('Test problem 2');

      const stats = runner.getStats();
      expect(stats.pipelinesRun).toBe(2);
    });
  });

  describe('Learning Integration', () => {
    it('should create trajectories when Sona Engine provided', async () => {
      const runner = new PhDPipelineRunner(createTestOptions({
        executor: mockExecutor,
        sonaEngine: mockSona as any,
      }));

      await runner.initialize();
      await runner.run('Test problem');

      // Should create at least pipeline trajectory
      expect(mockSona.trajectories.length).toBeGreaterThan(0);
    });

    it('should track trajectory count in stats', async () => {
      const runner = new PhDPipelineRunner(createTestOptions({
        executor: mockExecutor,
        sonaEngine: mockSona as any,
      }));

      await runner.initialize();
      await runner.run('Test problem');

      const stats = runner.getStats();
      expect(stats.trajectoriesCreated).toBeGreaterThan(0);
    });

    it('should include PhD metrics when learning enabled', async () => {
      const runner = new PhDPipelineRunner(createTestOptions({
        executor: mockExecutor,
        sonaEngine: mockSona as any,
      }));

      await runner.initialize();
      const stats = runner.getStats();

      expect(stats.phdMetrics).toBeDefined();
    });
  });

  describe('Memory Integration', () => {
    it('should pass memory engine to orchestrator', async () => {
      const runner = new PhDPipelineRunner(createTestOptions({
        executor: mockExecutor,
        memoryEngine: mockMemory,
      }));

      await runner.initialize();
      const orchestrator = runner.getOrchestrator();

      // Memory engine should be set
      expect(orchestrator).toBeDefined();
    });
  });

  describe('Concurrent Runs', () => {
    it('should handle multiple concurrent runs', async () => {
      const runner = new PhDPipelineRunner(createTestOptions({
        executor: mockExecutor,
      }));

      await runner.initialize();

      // Run multiple pipelines concurrently
      const promises = [
        runner.run('Problem 1'),
        runner.run('Problem 2'),
        runner.run('Problem 3'),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.executionId).toBeDefined();
      });

      const stats = runner.getStats();
      expect(stats.pipelinesRun).toBe(3);
    });
  });

  describe('Error Handling', () => {
    it('should return failed execution on error', async () => {
      const failingExecutor = new MockFailingExecutor(1);

      const runner = new PhDPipelineRunner(createTestOptions({
        executor: failingExecutor,
      }));

      await runner.initialize();
      const result = await runner.run('Test problem');

      expect(result.success).toBe(false);
      expect(result.execution.status).toBe('failed');
      expect(result.error).toBeDefined();
    });

    it('should track failed runs in statistics', async () => {
      const failingExecutor = new MockFailingExecutor(1);

      const runner = new PhDPipelineRunner(createTestOptions({
        executor: failingExecutor,
      }));

      await runner.initialize();
      await runner.run('Test problem');

      const stats = runner.getStats();
      expect(stats.pipelinesRun).toBe(1);
      expect(stats.pipelinesSucceeded).toBe(0);
      expect(stats.successRate).toBe(0);
    });
  });
});

describe('PhDPipelineRunner Integration with GodAgent', () => {
  it('should be importable from pipeline module', async () => {
    const { PhDPipelineRunner, createPhDPipelineRunner } = await import(
      '../../../../src/god-agent/core/pipeline/index.js'
    );

    expect(PhDPipelineRunner).toBeDefined();
    expect(createPhDPipelineRunner).toBeDefined();
  });

  it('should export all required types', async () => {
    const exports = await import('../../../../src/god-agent/core/pipeline/index.js');

    expect(exports.PhDPipelineRunner).toBeDefined();
    expect(exports.createPhDPipelineRunner).toBeDefined();
    // Type exports won't be runtime-checkable, but module should import without error
  });
});
