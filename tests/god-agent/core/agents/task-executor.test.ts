/**
 * Task Executor Test Suite
 * TASK-003: DAI-001 Core Layer Tests
 *
 * Per constitution.md RULE-002: NO mock data - use real agent definitions
 * Tests verify execution flow with actual agent structures.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  TaskExecutor,
  ITaskExecutionOptions,
  ITaskExecutionResult,
  TaskExecutionFunction,
} from '../../../../src/god-agent/core/agents/task-executor.js';
import { AgentRegistry } from '../../../../src/god-agent/core/agents/agent-registry.js';
import { AgentExecutionError } from '../../../../src/god-agent/core/agents/agent-errors.js';
import type { ILoadedAgentDefinition } from '../../../../src/god-agent/core/agents/agent-types.js';

describe('TaskExecutor', () => {
  let registry: AgentRegistry;
  let executor: TaskExecutor;
  let realAgent: ILoadedAgentDefinition;

  beforeAll(async () => {
    // Use REAL agent definitions - NO mocks per RULE-002
    registry = new AgentRegistry({ basePath: '.claude/agents', verbose: false });
    await registry.initialize('.claude/agents');
    executor = new TaskExecutor({ verbose: false });

    // Get a real agent for testing
    const agents = registry.getAll();
    realAgent = agents[0];
  });

  describe('Constructor', () => {
    it('should create executor with default options', () => {
      const exec = new TaskExecutor();
      expect(exec).toBeInstanceOf(TaskExecutor);
    });

    it('should accept verbose option', () => {
      const exec = new TaskExecutor({ verbose: true });
      expect(exec).toBeInstanceOf(TaskExecutor);
    });

    it('should accept custom timeout', () => {
      const exec = new TaskExecutor({ defaultTimeout: 60000 });
      expect(exec).toBeInstanceOf(TaskExecutor);
    });
  });

  describe('buildPrompt()', () => {
    it('should build prompt with agent name and instructions', () => {
      const prompt = executor.buildPrompt(realAgent, 'Test task');

      expect(prompt).toContain('## Agent:');
      expect(prompt).toContain('### Agent Instructions');
      expect(prompt).toContain('### Task');
      expect(prompt).toContain('Test task');
    });

    it('should include agent description when present', () => {
      const agentWithDesc = {
        ...realAgent,
        frontmatter: {
          ...realAgent.frontmatter,
          description: 'A test agent description',
        },
      };
      const prompt = executor.buildPrompt(agentWithDesc, 'Test task');

      expect(prompt).toContain('A test agent description');
    });

    it('should include memory context when provided', () => {
      const context = 'Previous knowledge: API schema includes user endpoints';
      const prompt = executor.buildPrompt(realAgent, 'Test task', context);

      expect(prompt).toContain('### Memory Context');
      expect(prompt).toContain('Previous knowledge: API schema');
      expect(prompt).toContain('prior knowledge');
    });

    it('should not include memory context section when context is empty', () => {
      const prompt = executor.buildPrompt(realAgent, 'Test task', '');

      expect(prompt).not.toContain('### Memory Context');
    });

    it('should include TASK COMPLETION SUMMARY template', () => {
      const prompt = executor.buildPrompt(realAgent, 'Test task');

      expect(prompt).toContain('TASK COMPLETION SUMMARY');
      expect(prompt).toContain('**What I Did**');
      expect(prompt).toContain('**Files Created/Modified**');
      expect(prompt).toContain('**InteractionStore Entries**');
      expect(prompt).toContain('**Next Agent Guidance**');
    });

    it('should include agent prompt content', () => {
      const prompt = executor.buildPrompt(realAgent, 'Test task');

      // The agent's prompt content should be included
      expect(prompt).toContain(realAgent.promptContent.substring(0, 50));
    });
  });

  describe('validateAgent()', () => {
    it('should pass validation for a real agent', () => {
      const result = executor.validateAgent(realAgent);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should fail validation for agent without key', () => {
      const invalidAgent = { ...realAgent, key: '' };
      const result = executor.validateAgent(invalidAgent);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Agent key is missing');
    });

    it('should fail validation for agent without category', () => {
      const invalidAgent = { ...realAgent, category: '' };
      const result = executor.validateAgent(invalidAgent);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Agent category is missing');
    });

    it('should fail validation for agent without prompt content', () => {
      const invalidAgent = { ...realAgent, promptContent: '' };
      const result = executor.validateAgent(invalidAgent);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Agent prompt content is empty');
    });

    it('should fail validation for agent without frontmatter', () => {
      const invalidAgent = { ...realAgent, frontmatter: undefined as unknown as typeof realAgent.frontmatter };
      const result = executor.validateAgent(invalidAgent);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Agent frontmatter is missing');
    });
  });

  describe('estimateTokens()', () => {
    it('should estimate tokens based on character count', () => {
      const prompt = 'A'.repeat(100);
      const tokens = executor.estimateTokens(prompt);

      // ~4 characters per token
      expect(tokens).toBe(25);
    });

    it('should handle empty prompt', () => {
      const tokens = executor.estimateTokens('');
      expect(tokens).toBe(0);
    });

    it('should round up token estimate', () => {
      const prompt = 'ABC'; // 3 chars
      const tokens = executor.estimateTokens(prompt);

      // ceil(3/4) = 1
      expect(tokens).toBe(1);
    });
  });

  describe('execute()', () => {
    it('should execute task and return result', async () => {
      const mockExecuteTask: TaskExecutionFunction = vi.fn().mockResolvedValue('Task completed successfully');

      const result = await executor.execute(
        realAgent,
        'Test task execution',
        mockExecuteTask
      );

      expect(result.success).toBe(true);
      expect(result.output).toBe('Task completed successfully');
      expect(result.agent).toBe(realAgent);
      expect(result.task).toBe('Test task execution');
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.executedAt).toBeLessThanOrEqual(Date.now());
    });

    it('should pass built prompt to execute function', async () => {
      const mockExecuteTask: TaskExecutionFunction = vi.fn().mockResolvedValue('Done');

      await executor.execute(realAgent, 'Build this feature', mockExecuteTask);

      expect(mockExecuteTask).toHaveBeenCalledTimes(1);
      const [agentType, prompt] = (mockExecuteTask as ReturnType<typeof vi.fn>).mock.calls[0];

      expect(prompt).toContain('Build this feature');
      expect(prompt).toContain('### Task');
    });

    it('should include context in prompt when provided', async () => {
      const mockExecuteTask: TaskExecutionFunction = vi.fn().mockResolvedValue('Done');

      await executor.execute(realAgent, 'Test task', mockExecuteTask, {
        context: 'Prior API schema: { users: [] }',
      });

      const [, prompt] = (mockExecuteTask as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(prompt).toContain('Prior API schema');
    });

    it('should use custom timeout when provided', async () => {
      const mockExecuteTask: TaskExecutionFunction = vi.fn().mockResolvedValue('Done');

      await executor.execute(realAgent, 'Test task', mockExecuteTask, {
        timeout: 60000,
      });

      const [, , options] = (mockExecuteTask as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(options.timeout).toBe(60000);
    });

    it('should throw AgentExecutionError on failure', async () => {
      const mockError = new Error('Task() execution failed');
      const mockExecuteTask: TaskExecutionFunction = vi.fn().mockRejectedValue(mockError);

      await expect(
        executor.execute(realAgent, 'Failing task', mockExecuteTask)
      ).rejects.toThrow(AgentExecutionError);
    });

    it('should include duration in AgentExecutionError', async () => {
      const mockError = new Error('Timeout');
      const mockExecuteTask: TaskExecutionFunction = vi.fn().mockRejectedValue(mockError);

      try {
        await executor.execute(realAgent, 'Timeout task', mockExecuteTask);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(AgentExecutionError);
        const error = e as AgentExecutionError;
        expect(error.duration).toBeGreaterThanOrEqual(0);
        expect(error.agentKey).toBe(realAgent.key);
        expect(error.agentCategory).toBe(realAgent.category);
      }
    });

    it('should handle non-Error thrown values', async () => {
      const mockExecuteTask: TaskExecutionFunction = vi.fn().mockRejectedValue('String error');

      await expect(
        executor.execute(realAgent, 'Test task', mockExecuteTask)
      ).rejects.toThrow(AgentExecutionError);
    });
  });

  describe('createExecutionSummary()', () => {
    it('should create summary for successful execution', () => {
      const result: ITaskExecutionResult = {
        agent: realAgent,
        task: 'Test task',
        output: 'Task completed with output',
        duration: 1500,
        success: true,
        executedAt: Date.now(),
      };

      const summary = executor.createExecutionSummary(result);

      expect(summary).toContain('✅ Success');
      expect(summary).toContain(realAgent.key);
      expect(summary).toContain('1500ms');
      expect(summary).toContain('Task completed with output');
    });

    it('should create summary for failed execution', () => {
      const result: ITaskExecutionResult = {
        agent: realAgent,
        task: 'Test task',
        output: '',
        duration: 500,
        success: false,
        error: new Error('Execution failed'),
        executedAt: Date.now(),
      };

      const summary = executor.createExecutionSummary(result);

      expect(summary).toContain('❌ Failed');
      expect(summary).toContain('Execution failed');
      expect(summary).not.toContain('### Output Preview');
    });

    it('should truncate long output in summary', () => {
      const longOutput = 'A'.repeat(300);
      const result: ITaskExecutionResult = {
        agent: realAgent,
        task: 'Test task',
        output: longOutput,
        duration: 1000,
        success: true,
        executedAt: Date.now(),
      };

      const summary = executor.createExecutionSummary(result);

      expect(summary).toContain('...');
      expect(summary.length).toBeLessThan(longOutput.length + 500);
    });

    it('should include ISO timestamp', () => {
      const now = Date.now();
      const result: ITaskExecutionResult = {
        agent: realAgent,
        task: 'Test task',
        output: 'Done',
        duration: 100,
        success: true,
        executedAt: now,
      };

      const summary = executor.createExecutionSummary(result);
      const expectedDate = new Date(now).toISOString();

      expect(summary).toContain(expectedDate);
    });
  });

  describe('Integration with REAL agents', () => {
    it('should build valid prompts for multiple real agents', async () => {
      const agents = registry.getAll().slice(0, 10); // Test first 10 agents

      for (const agent of agents) {
        const prompt = executor.buildPrompt(agent, 'Test task');

        // All prompts should have required sections
        expect(prompt).toContain('## Agent:');
        expect(prompt).toContain('### Task');
        expect(prompt).toContain('Test task');
        expect(prompt.length).toBeGreaterThan(100);
      }
    });

    it('should validate all real agents successfully', () => {
      const agents = registry.getAll();
      let validCount = 0;

      for (const agent of agents) {
        const result = executor.validateAgent(agent);
        if (result.valid) {
          validCount++;
        }
      }

      // All loaded agents should be valid
      expect(validCount).toBe(agents.length);
    });

    it('should estimate reasonable token counts for real agent prompts', () => {
      const agents = registry.getAll().slice(0, 5);

      for (const agent of agents) {
        const prompt = executor.buildPrompt(agent, 'Test task');
        const tokens = executor.estimateTokens(prompt);

        // Real agent prompts should be substantial
        expect(tokens).toBeGreaterThan(50);
        expect(tokens).toBeLessThan(50000); // Reasonable upper bound
      }
    });
  });
});
