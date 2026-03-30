/**
 * Agent Execution Service
 * TASK-DEV-002 - Service for executing individual development agents
 *
 * Provides simplified API for:
 * - Single agent execution
 * - Agent listing and filtering
 * - Agent information retrieval
 * - Sequential agent chains
 */

import type { AgentRegistry } from '../agents/agent-registry.js';
import type { ILoadedAgentDefinition } from '../agents/agent-types.js';
import type { IAgentExecutor, IAgentDefinition } from '../orchestration/orchestration-types.js';
import type { SonaEngine } from '../learning/sona-engine.js';
import type { IMemoryEngine } from '../pipeline/phd-pipeline-runner.js';
import type {
  IAgentExecutionOptions,
  IAgentExecutionResult,
  IAgentChainStep,
  IAgentChainResult,
  IAgentFilter,
  IAgentInfo,
  IAgentExecutionServiceConfig,
} from '../types/agent-execution-types.js';
import {
  DEFAULT_AGENT_TIMEOUT,
  DEFAULT_NAMESPACE,
} from '../types/agent-execution-types.js';

// ==================== Agent Execution Service ====================

/**
 * AgentExecutionService
 *
 * High-level service for executing individual development agents.
 * Wraps AgentRegistry and IAgentExecutor for simplified API.
 */
export class AgentExecutionService {
  private registry: AgentRegistry;
  private executor: IAgentExecutor;
  private sonaEngine?: SonaEngine;
  private memoryEngine?: IMemoryEngine;
  private config: IAgentExecutionServiceConfig;

  constructor(
    registry: AgentRegistry,
    executor: IAgentExecutor,
    config: IAgentExecutionServiceConfig = {},
    sonaEngine?: SonaEngine,
    memoryEngine?: IMemoryEngine
  ) {
    this.registry = registry;
    this.executor = executor;
    this.sonaEngine = sonaEngine;
    this.memoryEngine = memoryEngine;
    this.config = {
      defaultTimeout: DEFAULT_AGENT_TIMEOUT,
      defaultNamespace: DEFAULT_NAMESPACE,
      trackTrajectories: false,
      verbose: false,
      ...config,
    };
  }

  // ==================== Single Agent Execution ====================

  /**
   * Execute a single agent with a task
   *
   * @param agentKey - Agent key (e.g., 'coder', 'tester')
   * @param task - Task description
   * @param options - Execution options
   * @returns Execution result
   */
  async executeAgent(
    agentKey: string,
    task: string,
    options: IAgentExecutionOptions = {}
  ): Promise<IAgentExecutionResult> {
    const startTime = Date.now();

    // Merge options with defaults
    const opts: IAgentExecutionOptions = {
      timeout: this.config.defaultTimeout,
      namespace: this.config.defaultNamespace,
      trackTrajectory: this.config.trackTrajectories,
      verbose: this.config.verbose,
      ...options,
    };

    // Look up agent definition
    const loadedDef = this.registry.getByKey(agentKey);
    if (!loadedDef) {
      return this.createErrorResult(agentKey, `Agent '${agentKey}' not found`, startTime);
    }

    // Create trajectory if tracking enabled
    let trajectoryId: string | undefined;
    if (opts.trackTrajectory && this.sonaEngine) {
      trajectoryId = this.sonaEngine.createTrajectory(
        `agent/${agentKey}`,
        [agentKey, loadedDef.category],
        []
      );
    }

    try {
      // Retrieve previous context if specified
      let contextFromMemory = '';
      if (opts.retrieveKeys && opts.retrieveKeys.length > 0 && this.memoryEngine) {
        const retrievedParts: string[] = [];
        for (const key of opts.retrieveKeys) {
          const value = await this.memoryEngine.retrieve(key, { namespace: opts.namespace });
          if (value) {
            retrievedParts.push(`## Context from ${key}:\n${value}`);
          }
        }
        if (retrievedParts.length > 0) {
          contextFromMemory = '\n\n## Retrieved Context:\n' + retrievedParts.join('\n\n');
        }
      }

      // Build agent definition for executor
      const agentDef: IAgentDefinition = {
        agentName: loadedDef.frontmatter.name,
        position: 'Agent #1/1',
        phase: loadedDef.category,
        previousKey: null,
        outputKey: this.buildMemoryKey(agentKey, opts.namespace),
        task: task,
        qualityGate: 'Task completion',
        agentType: agentKey,
      };

      // Build full prompt
      const fullPrompt = this.buildPrompt(task, loadedDef, opts.context, contextFromMemory);

      // Execute with timeout
      const output = await Promise.race([
        this.executor.execute(fullPrompt, agentDef),
        this.createTimeoutPromise(opts.timeout || DEFAULT_AGENT_TIMEOUT, agentKey),
      ]);

      const duration = Date.now() - startTime;

      // Store result in memory if namespace provided
      let memoryKey: string | undefined;
      if (opts.namespace && this.memoryEngine) {
        memoryKey = this.buildMemoryKey(agentKey, opts.namespace);
        await this.memoryEngine.store(memoryKey, output, { namespace: opts.namespace });
      }

      // Provide trajectory feedback - ensure trajectoryId is valid string
      if (trajectoryId && typeof trajectoryId === 'string' && trajectoryId.trim() !== '' && this.sonaEngine) {
        await this.sonaEngine.provideFeedback(trajectoryId, 1.0, { skipAutoSave: false });
      }

      this.log(`Agent '${agentKey}' completed in ${duration}ms`, opts.verbose);

      return {
        agentKey,
        success: true,
        output,
        duration,
        memoryKey,
        trajectoryId,
        category: loadedDef.category,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Provide negative trajectory feedback - ensure trajectoryId is valid string
      if (trajectoryId && typeof trajectoryId === 'string' && trajectoryId.trim() !== '' && this.sonaEngine) {
        await this.sonaEngine.provideFeedback(trajectoryId, 0.0, { skipAutoSave: false });
      }

      this.log(`Agent '${agentKey}' failed: ${errorMessage}`, opts.verbose);

      return this.createErrorResult(agentKey, errorMessage, startTime, loadedDef.category);
    }
  }

  // ==================== Agent Chain Execution ====================

  /**
   * Execute a chain of agents sequentially
   *
   * @param steps - Array of agent steps to execute
   * @param options - Chain-level options
   * @returns Chain execution result
   */
  async executeChain(
    steps: IAgentChainStep[],
    options: IAgentExecutionOptions = {}
  ): Promise<IAgentChainResult> {
    const startTime = Date.now();
    const results: IAgentExecutionResult[] = [];

    // Merge options with defaults
    const chainOpts: IAgentExecutionOptions = {
      timeout: this.config.defaultTimeout,
      namespace: this.config.defaultNamespace,
      trackTrajectory: this.config.trackTrajectories,
      verbose: this.config.verbose,
      ...options,
    };

    this.log(`Starting agent chain with ${steps.length} steps`, chainOpts.verbose);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // Build step options (merge chain options with step options)
      const stepOpts: IAgentExecutionOptions = {
        ...chainOpts,
        ...step.options,
      };

      // Add previous outputs to retrieval keys
      if (i > 0 && results.length > 0) {
        const previousKeys = results
          .filter(r => r.success && r.memoryKey)
          .map(r => r.memoryKey!);
        stepOpts.retrieveKeys = [
          ...(stepOpts.retrieveKeys || []),
          ...previousKeys,
        ];
      }

      // Build task with chain context
      const chainContext = i > 0
        ? `\n\n## Chain Context:\nStep ${i + 1}/${steps.length}. Previous steps completed: ${results.filter(r => r.success).length}.`
        : '';
      const taskWithContext = step.task + chainContext;

      // Execute step
      const result = await this.executeAgent(step.agent, taskWithContext, stepOpts);
      results.push(result);

      // Stop on failure
      if (!result.success) {
        const duration = Date.now() - startTime;
        this.log(`Chain failed at step ${i + 1}: ${result.error}`, chainOpts.verbose);

        return {
          success: false,
          duration,
          steps: results,
          error: `Chain failed at step ${i + 1} (${step.agent}): ${result.error}`,
          failedAtStep: i,
        };
      }
    }

    const duration = Date.now() - startTime;
    this.log(`Chain completed: ${results.length} steps in ${duration}ms`, chainOpts.verbose);

    return {
      success: true,
      duration,
      steps: results,
    };
  }

  // ==================== Agent Listing ====================

  /**
   * List available agents with optional filtering
   *
   * @param filter - Filter options
   * @returns Array of agent info
   */
  listAgents(filter?: IAgentFilter): IAgentInfo[] {
    let agents = this.registry.getAll();

    // Apply filters
    if (filter) {
      if (filter.category) {
        agents = agents.filter(a => a.category === filter.category);
      }

      if (filter.capability) {
        const lowerCap = filter.capability.toLowerCase();
        agents = agents.filter(a =>
          a.frontmatter.capabilities?.some(c => c.toLowerCase().includes(lowerCap))
        );
      }

      if (filter.priority) {
        agents = agents.filter(a => a.frontmatter.priority === filter.priority);
      }

      if (filter.namePattern) {
        const lowerPattern = filter.namePattern.toLowerCase();
        agents = agents.filter(a =>
          a.key.toLowerCase().includes(lowerPattern) ||
          a.frontmatter.name.toLowerCase().includes(lowerPattern)
        );
      }

      if (filter.type) {
        agents = agents.filter(a => a.frontmatter.type === filter.type);
      }
    }

    // Map to IAgentInfo
    return agents.map(a => this.toAgentInfo(a));
  }

  /**
   * Get detailed info about a specific agent
   *
   * @param agentKey - Agent key
   * @returns Agent info or null if not found
   */
  getAgentInfo(agentKey: string): IAgentInfo | null {
    const def = this.registry.getByKey(agentKey);
    return def ? this.toAgentInfo(def) : null;
  }

  /**
   * Get all category names
   */
  getCategories(): string[] {
    return this.registry.getCategoryNames();
  }

  /**
   * Get agent count
   */
  getAgentCount(): number {
    return this.registry.size;
  }

  // ==================== Helper Methods ====================

  /**
   * Convert loaded definition to agent info
   */
  private toAgentInfo(def: ILoadedAgentDefinition): IAgentInfo {
    return {
      key: def.key,
      name: def.frontmatter.name,
      description: def.frontmatter.description,
      category: def.category,
      capabilities: def.frontmatter.capabilities || [],
      priority: def.frontmatter.priority || 'medium',
      type: def.frontmatter.type,
      color: def.frontmatter.color,
      version: def.frontmatter.version,
    };
  }

  /**
   * Build the full prompt for agent execution
   */
  private buildPrompt(
    task: string,
    def: ILoadedAgentDefinition,
    additionalContext?: string,
    memoryContext?: string
  ): string {
    const parts: string[] = [];

    // Agent system prompt from markdown body (use promptContent from ILoadedAgentDefinition)
    const agentPrompt = def.promptContent ?? '';
    if (agentPrompt.trim()) {
      parts.push(`## Agent Instructions:\n${agentPrompt}`);
    }

    // Additional context
    if (additionalContext) {
      parts.push(`## Additional Context:\n${additionalContext}`);
    }

    // Memory context
    if (memoryContext) {
      parts.push(memoryContext);
    }

    // Task
    parts.push(`## Task:\n${task}`);

    return parts.join('\n\n');
  }

  /**
   * Build memory key for storing agent output
   */
  private buildMemoryKey(agentKey: string, namespace?: string): string {
    const timestamp = Date.now().toString(36);
    return namespace
      ? `${namespace}/${agentKey}/${timestamp}`
      : `${agentKey}/${timestamp}`;
  }

  /**
   * Create timeout promise
   */
  private createTimeoutPromise(timeout: number, agentKey: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Agent '${agentKey}' timed out after ${timeout}ms`));
      }, timeout);
    });
  }

  /**
   * Create error result
   */
  private createErrorResult(
    agentKey: string,
    error: string,
    startTime: number,
    category?: string
  ): IAgentExecutionResult {
    return {
      agentKey,
      success: false,
      output: '',
      duration: Date.now() - startTime,
      error,
      category,
    };
  }

  /**
   * Log message if verbose
   */
  private log(message: string, verbose?: boolean): void {
    if (verbose ?? this.config.verbose) {
      console.log(`[AgentExecutionService] ${message}`);
    }
  }
}

// ==================== Factory ====================

/**
 * Create an AgentExecutionService
 */
export function createAgentExecutionService(
  registry: AgentRegistry,
  executor: IAgentExecutor,
  config?: IAgentExecutionServiceConfig,
  sonaEngine?: SonaEngine,
  memoryEngine?: IMemoryEngine
): AgentExecutionService {
  return new AgentExecutionService(registry, executor, config, sonaEngine, memoryEngine);
}
