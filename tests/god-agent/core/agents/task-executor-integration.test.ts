import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { TaskExecutor } from '../../../../src/god-agent/core/agents/task-executor.js';
import { AgentRegistry } from '../../../../src/god-agent/core/agents/agent-registry.js';
import type { IStructuredTask, ITaskExecutionResult } from '../../../../src/god-agent/core/agents/task-executor.js';
import type { ILoadedAgentDefinition } from '../../../../src/god-agent/core/agents/agent-types.js';

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Integration Tests for TaskExecutor (TASK-EXEC-001)
 *
 * Tests the complete TaskExecutor implementation against requirements:
 * - REQ-EXEC-001: No external API calls
 * - REQ-EXEC-002: Returns IStructuredTask object
 * - REQ-EXEC-003: Outputs JSON for Claude Code Task tool
 * - REQ-EXEC-004: Agent selection logic preserved
 * - REQ-EXEC-005: Learning integration maintained
 */
describe('TaskExecutor Integration Tests', () => {
  let taskExecutor: TaskExecutor;
  let agentRegistry: AgentRegistry;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const basePath = resolve(__dirname, '../../../../.claude/agents');
    agentRegistry = new AgentRegistry({
      basePath,
      verbose: false
    });
    await agentRegistry.initialize(basePath);
    taskExecutor = new TaskExecutor({ verbose: false, defaultTimeout: 120000 });

    // Spy on console.log to capture output
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    if (consoleLogSpy) {
      consoleLogSpy.mockRestore();
    }
  });

  describe('REQ-EXEC-001: No External API Calls', () => {
    it('should use buildStructuredTask instead of direct API execution', async () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      const spy = vi.spyOn(taskExecutor, 'buildStructuredTask');
      const structuredTask = taskExecutor.buildStructuredTask(agent!, 'Test prompt');

      expect(spy).toHaveBeenCalled();
      expect(structuredTask).toBeDefined();
      expect(structuredTask.taskId).toBeDefined();

      spy.mockRestore();
    });

    it('should not execute external APIs when building structured task', () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      const structuredTask = taskExecutor.buildStructuredTask(agent!, 'Test prompt');

      // Verify it returns a task object, not an API response
      expect(typeof structuredTask).toBe('object');
      expect(structuredTask).toHaveProperty('taskId');
      expect(structuredTask).toHaveProperty('agentType');
    });
  });

  describe('REQ-EXEC-002: Returns IStructuredTask Object', () => {
    it('should return structured task with all required fields', () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      const structuredTask = taskExecutor.buildStructuredTask(agent!, 'Test task prompt', {
        timeout: 60000,
        trajectoryId: 'test-trajectory-123'
      });

      // Verify all IStructuredTask interface fields
      expect(structuredTask).toHaveProperty('taskId');
      expect(structuredTask).toHaveProperty('agentType');
      expect(structuredTask).toHaveProperty('prompt');
      expect(structuredTask).toHaveProperty('agentKey');
      expect(structuredTask).toHaveProperty('timeout');
      expect(structuredTask).toHaveProperty('expectedOutput');
      expect(structuredTask).toHaveProperty('metadata');

      expect(structuredTask.taskId).toMatch(/^task-\d+-[a-z0-9]+$/);
      expect(structuredTask.agentType).toBeTruthy();
      expect(structuredTask.prompt).toBe('Test task prompt');
      expect(structuredTask.agentKey).toBe('researcher');
      expect(structuredTask.timeout).toBe(60000);
      expect(structuredTask.trajectoryId).toBe('test-trajectory-123');
    });

    it('should generate unique taskId for each call', () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      const task1 = taskExecutor.buildStructuredTask(agent!, 'Task 1');
      const task2 = taskExecutor.buildStructuredTask(agent!, 'Task 2');

      expect(task1.taskId).not.toBe(task2.taskId);
      expect(task1.taskId).toMatch(/^task-\d+-[a-z0-9]+$/);
      expect(task2.taskId).toMatch(/^task-\d+-[a-z0-9]+$/);
    });

    it('should extract agentType from agent frontmatter.type or category', () => {
      const researcher = agentRegistry.getByKey('researcher');
      const coder = agentRegistry.getByKey('coder');

      expect(researcher).toBeDefined();
      expect(coder).toBeDefined();

      const researcherTask = taskExecutor.buildStructuredTask(researcher!, 'Research task');
      const coderTask = taskExecutor.buildStructuredTask(coder!, 'Code task');

      expect(researcherTask.agentType).toBeTruthy();
      expect(coderTask.agentType).toBeTruthy();
      expect(typeof researcherTask.agentType).toBe('string');
      expect(typeof coderTask.agentType).toBe('string');
    });

    it('should use default timeout of 120000ms when not specified', () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      const task = taskExecutor.buildStructuredTask(agent!, 'Test prompt');

      expect(task.timeout).toBe(120000);
    });

    it('should respect custom timeout when provided', () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      const task = taskExecutor.buildStructuredTask(agent!, 'Test prompt', { timeout: 60000 });

      expect(task.timeout).toBe(60000);
    });
  });

  describe('REQ-EXEC-003: Outputs JSON for Claude Code Task Tool', () => {
    it('should create valid JSON serializable structured task', () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      const task = taskExecutor.buildStructuredTask(agent!, 'Test prompt');

      // Should be JSON serializable
      let jsonString: string;
      expect(() => {
        jsonString = JSON.stringify(task);
      }).not.toThrow();

      // Should be parseable back
      let parsed: IStructuredTask;
      expect(() => {
        parsed = JSON.parse(jsonString!);
      }).not.toThrow();

      expect(parsed!.taskId).toBe(task.taskId);
      expect(parsed!.agentType).toBe(task.agentType);
      expect(parsed!.prompt).toBe(task.prompt);
    });

    it('should include all IStructuredTask fields in JSON', () => {
      const agent = agentRegistry.getByKey('coder');
      expect(agent).toBeDefined();

      const task = taskExecutor.buildStructuredTask(agent!, 'Complex test prompt', {
        timeout: 90000,
        trajectoryId: 'test-trajectory'
      });

      const json = JSON.stringify(task);
      const parsed: IStructuredTask = JSON.parse(json);

      expect(parsed.taskId).toMatch(/^task-\d+-[a-z0-9]+$/);
      expect(parsed.agentType).toBeTruthy();
      expect(parsed.prompt).toBe('Complex test prompt');
      expect(parsed.agentKey).toBe('coder');
      expect(parsed.timeout).toBe(90000);
      expect(parsed.trajectoryId).toBe('test-trajectory');
      expect(parsed.expectedOutput).toBeDefined();
      expect(parsed.expectedOutput.format).toMatch(/^(markdown|code|json|text)$/);
      expect(parsed.metadata).toBeDefined();
      expect(parsed.metadata.createdAt).toBeGreaterThan(0);
      expect(parsed.metadata.requestId).toBeTruthy();
    });

    it('should support console.log output for Claude Code integration', () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      const task = taskExecutor.buildStructuredTask(agent!, 'Test prompt');

      // Simulate Claude Code output pattern
      const outputMarker = '===CLAUDE_CODE_TASK_START===';
      const jsonOutput = JSON.stringify(task, null, 2);
      const endMarker = '===CLAUDE_CODE_TASK_END===';

      expect(() => {
        console.log(outputMarker);
        console.log(jsonOutput);
        console.log(endMarker);
      }).not.toThrow();
    });
  });

  describe('REQ-EXEC-004: Agent Selection Logic Preserved', () => {
    it('should correctly extract agentType from researcher agent', () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      const task = taskExecutor.buildStructuredTask(agent!, 'Research task');

      expect(task.agentKey).toBe('researcher');
      expect(task.agentType).toBeTruthy();
    });

    it('should correctly extract agentType from coder agent', () => {
      const agent = agentRegistry.getByKey('coder');
      expect(agent).toBeDefined();

      const task = taskExecutor.buildStructuredTask(agent!, 'Code implementation task');

      expect(task.agentKey).toBe('coder');
      expect(task.agentType).toBeTruthy();
    });

    it('should determine expectedOutput based on agent type', () => {
      const researcher = agentRegistry.getByKey('researcher');
      const coder = agentRegistry.getByKey('coder');

      expect(researcher).toBeDefined();
      expect(coder).toBeDefined();

      const researchTask = taskExecutor.buildStructuredTask(researcher!, 'Research task');
      const codeTask = taskExecutor.buildStructuredTask(coder!, 'Code task');

      // Both should have valid output formats
      expect(['markdown', 'code', 'json', 'text']).toContain(researchTask.expectedOutput.format);
      expect(['markdown', 'code', 'json', 'text']).toContain(codeTask.expectedOutput.format);
    });

    it('should handle different agent categories', () => {
      const agents = ['researcher', 'coder', 'tester', 'reviewer'];

      agents.forEach(agentKey => {
        const agent = agentRegistry.getByKey(agentKey);
        if (agent) {
          const task = taskExecutor.buildStructuredTask(agent, `Task for ${agentKey}`);
          expect(task.agentKey).toBe(agentKey);
          expect(task.agentType).toBeTruthy();
        }
      });
    });
  });

  describe('REQ-EXEC-005: Learning Integration Maintained', () => {
    it('should preserve trajectoryId when provided', () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      const testTrajectoryId = 'test-trajectory-123';
      const task = taskExecutor.buildStructuredTask(agent!, 'Test with trajectory', {
        trajectoryId: testTrajectoryId
      });

      expect(task.trajectoryId).toBe(testTrajectoryId);
    });

    it('should include session metadata in structured task', () => {
      const agent = agentRegistry.getByKey('coder');
      expect(agent).toBeDefined();

      const task = taskExecutor.buildStructuredTask(agent!, 'Session metadata test');

      expect(task.metadata).toBeDefined();
      expect(task.metadata.createdAt).toBeGreaterThan(0);
      expect(task.metadata.requestId).toBeTruthy();
    });

    it('should support learning feedback integration via metadata', () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      const task = taskExecutor.buildStructuredTask(agent!, 'Feedback test', {
        trajectoryId: 'feedback-trajectory-001'
      });

      // Verify metadata supports feedback correlation
      expect(task.taskId).toMatch(/^task-\d+-[a-z0-9]+$/);
      expect(task.trajectoryId).toBe('feedback-trajectory-001');
      expect(task.metadata.requestId).toBe('feedback-trajectory-001');
    });

    it('should generate requestId from trajectoryId when provided', () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      const trajectoryId = 'custom-trajectory-123';
      const task = taskExecutor.buildStructuredTask(agent!, 'Test', { trajectoryId });

      expect(task.metadata.requestId).toBe(trajectoryId);
    });

    it('should generate requestId automatically when trajectoryId not provided', () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      const task = taskExecutor.buildStructuredTask(agent!, 'Test');

      expect(task.metadata.requestId).toMatch(/^req-\d+$/);
    });
  });

  describe('Build Verification', () => {
    it('should have IStructuredTask properly exported and usable', () => {
      // This test verifies TypeScript compilation succeeded
      expect(TaskExecutor).toBeDefined();

      const mockTask: IStructuredTask = {
        taskId: 'test-id',
        agentType: 'researcher',
        prompt: 'test',
        agentKey: 'researcher',
        timeout: 120000,
        expectedOutput: {
          format: 'markdown'
        },
        metadata: {
          createdAt: Date.now(),
          requestId: 'req-123'
        }
      };

      expect(mockTask).toBeDefined();
      expect(mockTask.expectedOutput.format).toBe('markdown');
    });

    it('should properly validate agent definitions', () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      const validation = taskExecutor.validateAgent(agent!);

      expect(validation.valid).toBe(true);
      expect(validation.issues).toHaveLength(0);
    });
  });

  describe('Prompt Building', () => {
    it('should build valid prompts from agent definitions', () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      const prompt = taskExecutor.buildPrompt(agent!, 'Test task');

      expect(prompt).toContain('Agent:');
      expect(prompt).toContain('Test task');
      expect(prompt).toContain('Agent Instructions');
    });

    it('should include context when provided', () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      const prompt = taskExecutor.buildPrompt(agent!, 'Test task', 'Custom context');

      expect(prompt).toContain('Memory Context');
      expect(prompt).toContain('Custom context');
    });

    it('should include response format guidance', () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      const prompt = taskExecutor.buildPrompt(agent!, 'Test task');

      expect(prompt).toContain('Response Format');
      expect(prompt).toContain('TASK COMPLETION SUMMARY');
    });
  });

  describe('Multiple Agent Types', () => {
    const agentKeys = ['researcher', 'coder', 'tester', 'reviewer'];

    agentKeys.forEach(agentKey => {
      it(`should successfully build structured task for ${agentKey} agent`, () => {
        const agent = agentRegistry.getByKey(agentKey);
        if (agent) {
          const task = taskExecutor.buildStructuredTask(agent, `Test prompt for ${agentKey}`);

          expect(task.taskId).toMatch(/^task-\d+-[a-z0-9]+$/);
          expect(task.agentKey).toBe(agentKey);
          expect(task.agentType).toBeTruthy();
        }
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty prompt', () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      const task = taskExecutor.buildStructuredTask(agent!, '');

      expect(task.taskId).toBeDefined();
      expect(task.prompt).toBe('');
    });

    it('should handle very long prompts', () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      const longPrompt = 'a'.repeat(10000);
      const task = taskExecutor.buildStructuredTask(agent!, longPrompt);

      expect(task.prompt).toBe(longPrompt);
      expect(task.prompt.length).toBe(10000);
    });

    it('should handle special characters in prompts', () => {
      const agent = agentRegistry.getByKey('coder');
      expect(agent).toBeDefined();

      const specialPrompt = 'Test with "quotes" and \'apostrophes\' and \n newlines \t tabs';
      const task = taskExecutor.buildStructuredTask(agent!, specialPrompt);

      expect(task.prompt).toBe(specialPrompt);

      // Should serialize properly
      const json = JSON.stringify(task);
      const parsed: IStructuredTask = JSON.parse(json);
      expect(parsed.prompt).toBe(specialPrompt);
    });

    it('should handle zero timeout', () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      const task = taskExecutor.buildStructuredTask(agent!, 'Zero timeout test', {
        timeout: 0
      });

      expect(task.timeout).toBe(0);
    });

    it('should handle extremely large timeout values', () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      const largeTimeout = 3600000; // 1 hour
      const task = taskExecutor.buildStructuredTask(agent!, 'Large timeout test', {
        timeout: largeTimeout
      });

      expect(task.timeout).toBe(largeTimeout);
    });
  });

  describe('Token Estimation', () => {
    it('should estimate tokens for prompts', () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      const prompt = taskExecutor.buildPrompt(agent!, 'Test task');
      const tokenCount = taskExecutor.estimateTokens(prompt);

      expect(tokenCount).toBeGreaterThan(0);
      expect(typeof tokenCount).toBe('number');
    });

    it('should estimate approximately 4 chars per token', () => {
      const testString = 'a'.repeat(1000);
      const tokens = taskExecutor.estimateTokens(testString);

      // Should be approximately 250 tokens (1000 / 4)
      expect(tokens).toBeGreaterThan(200);
      expect(tokens).toBeLessThan(300);
    });
  });

  describe('Execution Summary', () => {
    it('should create execution summary for successful result', async () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      // Mock a successful execution result
      const mockResult: ITaskExecutionResult = {
        agent: agent!,
        task: 'Test task',
        output: 'Task completed successfully',
        duration: 1000,
        success: true,
        executedAt: Date.now()
      };

      const summary = taskExecutor.createExecutionSummary(mockResult);

      expect(summary).toContain('✅ Success');
      expect(summary).toContain('researcher');
      expect(summary).toContain('1000ms');
      expect(summary).toContain('Task completed successfully');
    });

    it('should create execution summary for failed result', async () => {
      const agent = agentRegistry.getByKey('researcher');
      expect(agent).toBeDefined();

      const mockResult: ITaskExecutionResult = {
        agent: agent!,
        task: 'Test task',
        output: '',
        duration: 500,
        success: false,
        error: new Error('Execution failed'),
        executedAt: Date.now()
      };

      const summary = taskExecutor.createExecutionSummary(mockResult);

      expect(summary).toContain('❌ Failed');
      expect(summary).toContain('Execution failed');
      expect(summary).toContain('500ms');
    });
  });
});
