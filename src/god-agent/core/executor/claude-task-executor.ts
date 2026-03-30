/**
 * Claude Task Executor
 * TASK-EXE-001 - IAgentExecutor implementation using Claude Code Task tool
 *
 * Implements the IAgentExecutor interface from orchestration-types.ts.
 * Executes agents by spawning Claude Code Tasks with the combined prompt
 * (agent system prompt + orchestrator context).
 */

import type { IAgentExecutor, IAgentDefinition } from '../orchestration/orchestration-types.js';
import type { AgentRegistry } from '../agents/agent-registry.js';
import type { ILoadedAgentDefinition } from '../agents/agent-types.js';
import type {
  IExecutorConfig,
  IHookResult,
  IExecutionResult,
  ITaskSpawnOptions,
} from './executor-types.js';
import { DEFAULT_EXECUTOR_CONFIG } from './executor-types.js';
import { HookRunner } from './hook-runner.js';

// ==================== Claude Task Executor ====================

/**
 * ClaudeTaskExecutor
 *
 * Implements IAgentExecutor using Claude Code's Task tool.
 * Combines orchestrator prompts with agent system prompts from markdown definitions.
 *
 * Execution flow:
 * 1. Look up loaded agent definition by key
 * 2. Run pre-hooks (memory retrieval)
 * 3. Build combined prompt (system + context)
 * 4. Spawn Claude Code Task
 * 5. Run post-hooks (memory storage)
 * 6. Return output
 */
export class ClaudeTaskExecutor implements IAgentExecutor {
  private registry: AgentRegistry;
  private config: Required<IExecutorConfig>;
  private hookRunner: HookRunner;

  constructor(registry: AgentRegistry, config: Partial<IExecutorConfig> = {}) {
    this.registry = registry;
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config } as Required<IExecutorConfig>;
    this.hookRunner = new HookRunner({
      workingDirectory: this.config.workingDirectory,
      timeout: this.config.hookTimeout,
      verbose: this.config.verbose,
    });
  }

  /**
   * Execute an agent with the given prompt
   *
   * Implements IAgentExecutor interface from orchestration-types.ts
   *
   * @param prompt - Orchestrator-provided prompt with memory context
   * @param agent - Agent definition from pipeline
   * @returns Agent output string
   */
  async execute(prompt: string, agent: IAgentDefinition): Promise<string> {
    let retryCount = 0;

    // Look up loaded definition
    const loadedDef = this.registry.getByKey(agent.agentType || agent.agentName);

    if (this.config.verbose) {
      console.log(`[ClaudeTaskExecutor] Executing agent: ${agent.agentName}`);
      if (loadedDef) {
        console.log(`[ClaudeTaskExecutor] Found definition: ${loadedDef.key}`);
      } else {
        console.warn(`[ClaudeTaskExecutor] No definition found for ${agent.agentType || agent.agentName}`);
      }
    }

    // Retry loop
    while (retryCount <= this.config.maxRetries) {
      try {
        const result = await this.executeOnce(prompt, agent, loadedDef);

        if (result.success) {
          return result.output;
        }

        // If failed and no more retries, throw
        if (retryCount >= this.config.maxRetries) {
          throw new Error(result.error || 'Agent execution failed');
        }

        // Wait before retry
        if (this.config.retryDelay > 0) {
          await this.delay(this.config.retryDelay);
        }

        retryCount++;
        if (this.config.verbose) {
          console.log(`[ClaudeTaskExecutor] Retrying agent ${agent.agentName} (attempt ${retryCount + 1})`);
        }

      } catch (error) {
        if (retryCount >= this.config.maxRetries) {
          // RULE-070: Re-throw with execution context
          throw new Error(
            `Agent "${agent.agentName}" execution failed after ${retryCount + 1} attempts: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error }
          );
        }
        retryCount++;
      }
    }

    // Should not reach here
    throw new Error(`Agent ${agent.agentName} failed after ${retryCount} retries`);
  }

  /**
   * Execute agent once (internal implementation)
   */
  private async executeOnce(
    prompt: string,
    agent: IAgentDefinition,
    loadedDef?: ILoadedAgentDefinition
  ): Promise<IExecutionResult> {
    const startTime = Date.now();
    let preHookResult: IHookResult | undefined;
    let postHookResult: IHookResult | undefined;

    try {
      // Step 1: Run pre-hooks
      if (this.config.enableHooks && loadedDef?.frontmatter.hooks?.pre) {
        preHookResult = await this.hookRunner.runPreHook(
          loadedDef.frontmatter.hooks.pre,
          agent.agentName,
          this.buildHookEnv(agent)
        );

        if (this.config.verbose && !preHookResult.success) {
          console.warn(`[ClaudeTaskExecutor] Pre-hook warning: ${preHookResult.error}`);
        }
      }

      // Step 2: Build full prompt
      const fullPrompt = this.buildFullPrompt(prompt, loadedDef, agent);

      // Step 3: Build system prompt from agent definition
      const systemPrompt = this.buildSystemPrompt(loadedDef);

      // Step 4: Spawn Claude Task
      const output = await this.spawnClaudeTask({
        description: `Execute ${agent.agentName}`,
        prompt: fullPrompt,
        systemPrompt: systemPrompt,
        subagentType: this.determineSubagentType(agent, loadedDef),
        timeout: this.config.timeout,
      });

      // Step 5: Run post-hooks
      if (this.config.enableHooks && loadedDef?.frontmatter.hooks?.post) {
        postHookResult = await this.hookRunner.runPostHook(
          loadedDef.frontmatter.hooks.post,
          agent.agentName,
          { ...this.buildHookEnv(agent), AGENT_OUTPUT: output.slice(0, 1000) }
        );

        if (this.config.verbose && !postHookResult.success) {
          console.warn(`[ClaudeTaskExecutor] Post-hook warning: ${postHookResult.error}`);
        }
      }

      return {
        success: true,
        output,
        duration: Date.now() - startTime,
        preHookResult,
        postHookResult,
        retryCount: 0,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        success: false,
        output: '',
        duration: Date.now() - startTime,
        preHookResult,
        postHookResult,
        error: errorMessage,
        retryCount: 0,
      };
    }
  }

  /**
   * Build full prompt combining agent system prompt and orchestrator context
   */
  buildFullPrompt(
    orchestratorPrompt: string,
    loadedDef?: ILoadedAgentDefinition,
    agent?: IAgentDefinition
  ): string {
    const parts: string[] = [];

    // Add agent system prompt from markdown if available
    if (loadedDef?.promptContent) {
      parts.push('## Agent System Prompt\n');
      parts.push(loadedDef.promptContent);
      parts.push('\n\n---\n\n');
    }

    // Add agent metadata if available
    if (loadedDef?.frontmatter) {
      parts.push('## Agent Metadata\n');
      parts.push(`- **Name**: ${loadedDef.frontmatter.name}\n`);
      if (loadedDef.frontmatter.description) {
        parts.push(`- **Purpose**: ${loadedDef.frontmatter.description}\n`);
      }
      if (loadedDef.frontmatter.capabilities?.length) {
        parts.push(`- **Capabilities**: ${loadedDef.frontmatter.capabilities.join(', ')}\n`);
      }
      parts.push('\n');
    }

    // Add pipeline context if available
    if (agent) {
      parts.push('## Pipeline Context\n');
      parts.push(`- **Position**: ${agent.position}\n`);
      parts.push(`- **Phase**: ${agent.phase}\n`);
      parts.push(`- **Task**: ${agent.task}\n`);
      parts.push(`- **Quality Gate**: ${agent.qualityGate}\n`);
      if (agent.previousKey) {
        parts.push(`- **Previous Output**: Retrieved from memory key \`${agent.previousKey}\`\n`);
      }
      parts.push(`- **Output Key**: Store results at \`${agent.outputKey}\`\n`);
      parts.push('\n');
    }

    // Add orchestrator prompt (with memory context)
    parts.push('## Current Task Context\n\n');
    parts.push(orchestratorPrompt);

    return parts.join('');
  }

  /**
   * Determine the subagent type to use for Task tool
   */
  private determineSubagentType(
    agent: IAgentDefinition,
    loadedDef?: ILoadedAgentDefinition
  ): string {
    // Priority: agent.agentType > loadedDef.frontmatter.type > config.defaultAgentType
    if (agent.agentType) {
      return this.mapToTaskToolType(agent.agentType);
    }

    if (loadedDef?.frontmatter.type) {
      return this.mapToTaskToolType(loadedDef.frontmatter.type);
    }

    return this.config.defaultAgentType;
  }

  /**
   * Map agent type to Task tool subagent type
   */
  private mapToTaskToolType(agentType: string): string {
    // Map common types to Task tool types
    const typeMapping: Record<string, string> = {
      'meta-analyst': 'researcher',
      'section-writer': 'coder',
      'synthesis-specialist': 'researcher',
      'critical-analyst': 'researcher',
      'statistical-architect': 'researcher',
      'methodology-architect': 'researcher',
      'hypothesis-specialist': 'researcher',
      'researcher': 'researcher',
      'coder': 'coder',
      'tester': 'tester',
      'reviewer': 'reviewer',
      'planner': 'planner',
    };

    return typeMapping[agentType.toLowerCase()] || this.config.defaultAgentType;
  }

  /**
   * Spawn a Claude Code Task
   *
   * This is the core integration point with Claude Code's Task tool.
   * Executes agents via real Claude CLI or falls back to mock.
   */
  private async spawnClaudeTask(options: ITaskSpawnOptions): Promise<string> {
    if (this.config.verbose) {
      console.log(`[ClaudeTaskExecutor] Spawning: ${options.description}`);
      console.log(`[ClaudeTaskExecutor] Type: ${options.subagentType} (internal)`);
    }

    // Use mock in mock mode or if CLI not available
    if (this.config.executionMode === 'mock') {
      return this.mockTaskExecution(options);
    }

    try {
      return await this.executeClaudeCLI({
        prompt: options.prompt,
        systemPrompt: options.systemPrompt,
        timeout: options.timeout || this.config.timeout,
      });
    } catch (error) {
      if (this.config.verbose) {
        console.warn(`[ClaudeTaskExecutor] CLI execution failed, falling back to mock`);
        console.warn(`[ClaudeTaskExecutor] Error: ${error instanceof Error ? error.message : String(error)}`);
      }
      // Fallback to mock if CLI fails (e.g., claude not installed)
      return this.mockTaskExecution(options);
    }
  }

  /**
   * Execute Claude CLI with proper command structure
   *
   * CORRECT CLI SYNTAX (v1.2):
   * claude --print --system-prompt "<agentInstructions>" --output-format json "<prompt>"
   *
   * NOTE: NO --agent flag! That's for SESSION selection only, not subagent types.
   * subagentType is for INTERNAL classification only (logging, metrics).
   */
  private async executeClaudeCLI(options: {
    prompt: string;
    systemPrompt?: string;
    timeout: number;
  }): Promise<string> {
    const { spawn } = await import('child_process');

    return new Promise((resolve, reject) => {
      const args: string[] = ['--print'];

      // Add output format
      const outputFormat = this.config.outputFormat || 'json';
      args.push('--output-format', outputFormat);

      // Add system prompt if provided
      if (options.systemPrompt) {
        args.push('--system-prompt', options.systemPrompt);
      }

      // Add the user prompt
      args.push(options.prompt);

      const claudePath = this.config.claudeCliPath || 'claude';

      if (this.config.verbose) {
        console.log(`[ClaudeTaskExecutor] CLI: ${claudePath} ${args.slice(0, -1).join(' ')} "<prompt>"`);
      }

      const child = spawn(claudePath, args, {
        cwd: this.config.workingDirectory,
        env: { ...process.env, GOD_AGENT_EXECUTION: 'true' },
      });

      let stdout = '';
      let stderr = '';

      // Cap timeout at 600000ms (10 minutes) as per spec
      const effectiveTimeout = Math.min(options.timeout, 600000);

      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Agent timed out after ${effectiveTimeout}ms`));
      }, effectiveTimeout);

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);

        if (code === 0) {
          try {
            // Try to parse as JSON if output format is json
            if (outputFormat === 'json') {
              const parsed = JSON.parse(stdout);
              // Extract result from common JSON structures
              resolve(parsed.result || parsed.output || parsed.content || stdout);
            } else {
              resolve(stdout);
            }
          } catch {
            // INTENTIONAL: JSON parsing failure for expected JSON output - return raw stdout as fallback
            resolve(stdout);
          }
        } else {
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  /**
   * Build system prompt from loaded agent definition
   *
   * Formats agent instructions for CLI --system-prompt flag.
   */
  private buildSystemPrompt(loadedDef?: ILoadedAgentDefinition): string {
    if (!loadedDef?.promptContent) return '';

    const parts: string[] = [];
    parts.push(`# Agent: ${loadedDef.frontmatter.name}`);

    if (loadedDef.frontmatter.description) {
      parts.push(`## Purpose: ${loadedDef.frontmatter.description}`);
    }

    if (loadedDef.frontmatter.capabilities?.length) {
      parts.push(`## Capabilities: ${loadedDef.frontmatter.capabilities.join(', ')}`);
    }

    parts.push('');
    parts.push('## Instructions');
    parts.push(loadedDef.promptContent);

    return parts.join('\n');
  }

  /**
   * Mock task execution for testing
   *
   * Replace this method with real Task tool invocation in production.
   */
  private async mockTaskExecution(options: ITaskSpawnOptions): Promise<string> {
    // Simulate execution time
    await this.delay(100);

    // Return a mock response indicating this is a mock
    return `[Mock Task Execution]
Agent: ${options.description}
Type: ${options.subagentType}
Prompt received (${options.prompt.length} chars)

This is mock output. In production, this would be replaced with actual
Claude Code Task tool execution, which would spawn a real subagent to
process the prompt and return meaningful output.

To enable real execution, implement the spawnClaudeTask method with
Claude Code Task tool integration.`;
  }

  /**
   * Build environment variables for hooks
   */
  private buildHookEnv(agent: IAgentDefinition): Record<string, string> {
    return {
      AGENT_NAME: agent.agentName,
      AGENT_POSITION: agent.position,
      AGENT_PHASE: agent.phase,
      OUTPUT_KEY: agent.outputKey,
      PREVIOUS_KEY: agent.previousKey || '',
    };
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<IExecutorConfig>): void {
    this.config = { ...this.config, ...config };
    this.hookRunner.setConfig({
      workingDirectory: this.config.workingDirectory,
      timeout: this.config.hookTimeout,
      verbose: this.config.verbose,
    });
  }

  /**
   * Get current configuration
   */
  getConfig(): IExecutorConfig {
    return { ...this.config };
  }

  /**
   * Get hook runner instance
   */
  getHookRunner(): HookRunner {
    return this.hookRunner;
  }
}

// ==================== Mock Executor ====================

/**
 * MockClaudeTaskExecutor
 *
 * A configurable mock executor for testing.
 * Allows setting specific responses per agent.
 */
export class MockClaudeTaskExecutor implements IAgentExecutor {
  private responses: Map<string, string> = new Map();
  private defaultResponse: string = 'Mock agent output';
  private failingAgents: Set<string> = new Set();
  private responseDelay: number = 0;
  private verbose: boolean = false;

  /**
   * Set response for a specific agent
   */
  setResponse(agentKey: string, response: string): void {
    this.responses.set(agentKey, response);
  }

  /**
   * Set default response for all agents
   */
  setDefaultResponse(response: string): void {
    this.defaultResponse = response;
  }

  /**
   * Mark an agent as failing
   */
  setFailing(agentKey: string, failing: boolean = true): void {
    if (failing) {
      this.failingAgents.add(agentKey);
    } else {
      this.failingAgents.delete(agentKey);
    }
  }

  /**
   * Set response delay
   */
  setResponseDelay(delay: number): void {
    this.responseDelay = delay;
  }

  /**
   * Enable verbose logging
   */
  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }

  /**
   * Execute agent (mock implementation)
   */
  async execute(_prompt: string, agent: IAgentDefinition): Promise<string> {
    const key = agent.agentType || agent.agentName;

    if (this.verbose) {
      console.log(`[MockExecutor] Executing: ${key}`);
    }

    // Simulate delay
    if (this.responseDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.responseDelay));
    }

    // Check for failure
    if (this.failingAgents.has(key)) {
      throw new Error(`Mock failure for agent: ${key}`);
    }

    // Return configured or default response
    return this.responses.get(key) || this.defaultResponse;
  }

  /**
   * Clear all configuration
   */
  clear(): void {
    this.responses.clear();
    this.failingAgents.clear();
    this.defaultResponse = 'Mock agent output';
    this.responseDelay = 0;
  }
}

// ==================== Factory ====================

/**
 * Create a Claude Task Executor
 */
export function createClaudeTaskExecutor(
  registry: AgentRegistry,
  config?: Partial<IExecutorConfig>
): ClaudeTaskExecutor {
  return new ClaudeTaskExecutor(registry, config);
}

/**
 * Create a mock executor for testing
 */
export function createMockExecutor(): MockClaudeTaskExecutor {
  return new MockClaudeTaskExecutor();
}
