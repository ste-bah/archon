/**
 * Task Executor
 * TASK-003: DAI-001 Core Layer
 *
 * Executes selected agent via Task() abstraction.
 * Handles prompt building, execution, and result handling.
 *
 * Per constitution.md:
 * - RULE-003: MUST throw AgentExecutionError with full context on failure
 * - RULE-005: MUST use agent definitions from AgentRegistry
 */

import type { ILoadedAgentDefinition } from './agent-types.js';
import { AgentExecutionError } from './agent-errors.js';
import { ObservabilityBus } from '../observability/bus.js';

// ==================== Types ====================

/**
 * Task execution options
 */
export interface ITaskExecutionOptions {
  /** Additional context to inject into prompt */
  context?: string;
  /** Timeout in milliseconds (default: 120000 - 2 minutes) */
  timeout?: number;
  /** Whether to store result in InteractionStore (default: true) */
  storeResult?: boolean;
  /** Memory domain for storage */
  memoryDomain?: string;
  /** Tags for memory storage */
  memoryTags?: string[];
}

/**
 * Structured task for Claude Code execution
 * Implements [REQ-EXEC-002]: Return Task for Claude Code Execution
 * Implements [REQ-EXEC-003]: Integrate with Claude Code Task Tool
 */
export interface IStructuredTask {
  /** Unique task identifier */
  taskId: string;
  /** Agent type for Claude Code Task tool subagent_type parameter */
  agentType: string;
  /** Full prompt for task execution */
  prompt: string;
  /** Agent key from registry */
  agentKey: string;
  /** Execution timeout in milliseconds */
  timeout: number;
  /** Trajectory ID for learning integration */
  trajectoryId?: string;
  /** Expected output format */
  expectedOutput: {
    format: 'markdown' | 'code' | 'json' | 'text';
  };
  /** Task metadata */
  metadata: {
    createdAt: number;
    requestId: string;
  };
}

/**
 * Task execution result
 */
export interface ITaskExecutionResult {
  /** Agent that executed the task */
  agent: ILoadedAgentDefinition;
  /** Original task */
  task: string;
  /** Task output */
  output: string;
  /** Execution duration in ms */
  duration: number;
  /** Whether execution succeeded */
  success: boolean;
  /** Error if execution failed */
  error?: Error;
  /** Timestamp of execution */
  executedAt: number;
}

/**
 * Task execution function type
 * This is the interface for the actual Task() execution
 */
export type TaskExecutionFunction = (
  agentType: string,
  prompt: string,
  options?: { timeout?: number }
) => Promise<string>;

// ==================== Task Executor ====================

/**
 * TaskExecutor
 *
 * Wraps Task() execution with prompt building and error handling.
 * This is an abstraction layer that doesn't directly call Claude Code's Task()
 * but provides the interface for UniversalAgent to do so.
 */
export class TaskExecutor {
  private verbose: boolean;
  private defaultTimeout: number;

  constructor(options?: { verbose?: boolean; defaultTimeout?: number }) {
    this.verbose = options?.verbose ?? false;
    this.defaultTimeout = options?.defaultTimeout ?? 120000; // 2 minutes
  }

  /**
   * Execute task with selected agent
   *
   * NOTE: This method builds the prompt and handles the result.
   * The actual Task() execution is delegated to the caller (UniversalAgent)
   * via the executeTask callback.
   *
   * @throws AgentExecutionError if execution fails
   */
  async execute(
    agent: ILoadedAgentDefinition,
    task: string,
    executeTask: TaskExecutionFunction,
    options?: ITaskExecutionOptions
  ): Promise<ITaskExecutionResult> {
    const startTime = Date.now();

    // Generate unique execution ID for correlating start/complete/fail events
    // Format: exec_{agentKey}_{timestamp}_{random}
    const executionId = `exec_${agent.key}_${startTime}_${Math.random().toString(36).substring(2, 8)}`;

    if (this.verbose) {
      console.log(
        `[TaskExecutor] Executing task with agent: ${agent.key} (${agent.category})`
      );
      console.log(`[TaskExecutor] Execution ID: ${executionId}`);
      console.log(`[TaskExecutor] Task: "${task.substring(0, 100)}${task.length > 100 ? '...' : ''}"`);
    }

    // Implements [REQ-OBS-13]: Emit agent_started event with executionId
    ObservabilityBus.getInstance().emit({
      component: 'agent',
      operation: 'agent_started',
      status: 'running',
      metadata: {
        executionId,
        agentKey: agent.key,
        agentName: agent.frontmatter.name || agent.key,
        agentCategory: agent.category,
        taskPreview: task.substring(0, 100),
        promptText: task,
      },
    });

    // Build the prompt
    const prompt = this.buildPrompt(agent, task, options?.context);

    if (this.verbose) {
      console.log(`[TaskExecutor] Prompt length: ${prompt.length} characters`);
    }

    try {
      // Execute the task
      const timeout = options?.timeout ?? this.defaultTimeout;
      const output = await executeTask(agent.frontmatter.type ?? agent.category, prompt, { timeout });

      const duration = Date.now() - startTime;

      if (this.verbose) {
        console.log(`[TaskExecutor] Execution completed in ${duration}ms`);
        console.log(`[TaskExecutor] Output length: ${output.length} characters`);
      }

      // Implements [REQ-OBS-14]: Emit agent_completed event with executionId
      ObservabilityBus.getInstance().emit({
        component: 'agent',
        operation: 'agent_completed',
        status: 'success',
        durationMs: duration,
        metadata: {
          executionId,
          agentKey: agent.key,
          agentName: agent.frontmatter.name || agent.key,
          agentCategory: agent.category,
          outputLength: output.length,
          outputPreview: output.substring(0, 200),
        },
      });

      return {
        agent,
        task,
        output,
        duration,
        success: true,
        executedAt: startTime,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const execError = error instanceof Error ? error : new Error(String(error));

      if (this.verbose) {
        console.error(`[TaskExecutor] Execution failed after ${duration}ms:`, execError.message);
      }

      // Implements [REQ-OBS-15]: Emit agent_failed event with executionId
      ObservabilityBus.getInstance().emit({
        component: 'agent',
        operation: 'agent_failed',
        status: 'error',
        durationMs: duration,
        metadata: {
          executionId,
          agentKey: agent.key,
          agentName: agent.frontmatter.name || agent.key,
          agentCategory: agent.category,
          error: execError.message,
        },
      });

      // Throw with full context per RULE-003
      throw new AgentExecutionError(
        agent.key,
        agent.category,
        task,
        execError,
        duration
      );
    }
  }

  /**
   * Build Task() prompt from agent definition and task
   *
   * The prompt structure:
   * 1. Agent prompt content (from .md file)
   * 2. Memory context (if provided)
   * 3. User task
   */
  buildPrompt(
    agent: ILoadedAgentDefinition,
    task: string,
    context?: string
  ): string {
    const sections: string[] = [];

    // Section 1: Agent system prompt
    sections.push(`## Agent: ${agent.frontmatter.name || agent.key}`);
    sections.push('');
    if (agent.frontmatter.description) {
      sections.push(`**Description:** ${agent.frontmatter.description}`);
      sections.push('');
    }
    sections.push('### Agent Instructions');
    sections.push('');
    sections.push(agent.promptContent);
    sections.push('');

    // Section 2: Memory context (if provided)
    if (context && context.trim().length > 0) {
      sections.push('### Memory Context');
      sections.push('');
      sections.push('The following context has been retrieved from prior knowledge:');
      sections.push('');
      sections.push(context);
      sections.push('');
    }

    // Section 3: User task
    sections.push('### Task');
    sections.push('');
    sections.push(task);
    sections.push('');

    // Section 4: Output format reminder
    sections.push('### Response Format');
    sections.push('');
    sections.push('Please respond with a TASK COMPLETION SUMMARY in the following format:');
    sections.push('');
    sections.push('```');
    sections.push('## TASK COMPLETION SUMMARY');
    sections.push('');
    sections.push('**What I Did**: [1-2 sentence summary]');
    sections.push('');
    sections.push('**Files Created/Modified**:');
    sections.push('- `[path]` - [Brief description]');
    sections.push('');
    sections.push('**InteractionStore Entries** (for orchestration):');
    sections.push('- Domain: `project/[area]`, Tags: `[tags]` - [What it contains]');
    sections.push('');
    sections.push('**Next Agent Guidance**: [Instructions for future agents]');
    sections.push('```');

    return sections.join('\n');
  }

  /**
   * Validate that an agent definition has the minimum required fields
   * for execution.
   */
  validateAgent(agent: ILoadedAgentDefinition): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    if (!agent.key) {
      issues.push('Agent key is missing');
    }

    if (!agent.category) {
      issues.push('Agent category is missing');
    }

    if (!agent.promptContent || agent.promptContent.trim().length === 0) {
      issues.push('Agent prompt content is empty');
    }

    if (!agent.frontmatter) {
      issues.push('Agent frontmatter is missing');
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Estimate token count for a prompt
   * (Rough estimate: ~4 characters per token)
   */
  estimateTokens(prompt: string): number {
    return Math.ceil(prompt.length / 4);
  }

  /**
   * Create a summary of the execution for logging/storage
   */
  createExecutionSummary(result: ITaskExecutionResult): string {
    const status = result.success ? '✅ Success' : '❌ Failed';
    const lines = [
      `## Execution Summary`,
      ``,
      `- **Status**: ${status}`,
      `- **Agent**: ${result.agent.key} (${result.agent.category})`,
      `- **Duration**: ${result.duration}ms`,
      `- **Executed At**: ${new Date(result.executedAt).toISOString()}`,
    ];

    if (!result.success && result.error) {
      lines.push(`- **Error**: ${result.error.message}`);
    }

    if (result.success) {
      const outputPreview = result.output.length > 200
        ? `${result.output.substring(0, 200)}...`
        : result.output;
      lines.push(``, `### Output Preview`, ``, outputPreview);
    }

    return lines.join('\n');
  }

  /**
   * Build a structured task for Claude Code execution
   * Implements [REQ-EXEC-002]: Return Task for Claude Code Execution
   * Implements [REQ-EXEC-003]: Integrate with Claude Code Task Tool
   * Implements [REQ-EXEC-001]: No external API calls - returns task for Claude Code
   */
  buildStructuredTask(
    agent: ILoadedAgentDefinition,
    prompt: string,
    options?: { timeout?: number; trajectoryId?: string }
  ): IStructuredTask {
    const agentType = agent.frontmatter.type ?? agent.category;

    return {
      taskId: `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      agentType,
      prompt,
      agentKey: agent.key,
      timeout: options?.timeout ?? this.defaultTimeout,
      trajectoryId: options?.trajectoryId,
      expectedOutput: {
        // Implements [REQ-EXEC-003]: Determine output format based on agent type
        format: agentType.includes('research') || agentType.includes('analyst')
          ? 'markdown'
          : agentType.includes('coder') || agentType.includes('dev')
            ? 'code'
            : 'text',
      },
      metadata: {
        createdAt: Date.now(),
        requestId: options?.trajectoryId || `req-${Date.now()}`,
      },
    };
  }
}
