/**
 * PhD Pipeline Orchestrator
 * TASK-PHD-001 - 48-Agent PhD Pipeline
 *
 * Orchestrates execution of 48-agent PhD research pipeline:
 * - Phase-by-phase sequential execution
 * - Topological sort for agent ordering within phases
 * - Dependency tracking and input gathering
 * - Critical agent validation
 * - Integration with Shadow Vector tracking
 */

import {
  type IPipelineConfig,
  type IAgentConfig,
  type IPhaseConfig,
  type IPipelineState,
  type IPipelineProgress,
  type IAgentExecutionRecord,
  type AgentId,
  PipelineConfigError,
  CriticalAgentError,
  createPipelineState,
  generatePipelineId,
  isCriticalAgent,
  PHASE_NAMES,
} from './pipeline-types.js';
import { SocketClient } from '../../observability/socket-client.js';
import type { IActivityEvent } from '../../observability/types.js';

// ==================== Agent Executor Interface ====================

/**
 * Interface for executing agents (allows mocking in tests)
 */
export interface IAgentExecutor {
  /**
   * Execute an agent with given inputs
   */
  execute(
    agentKey: string,
    inputs: Record<string, unknown>,
    timeout: number
  ): Promise<Record<string, unknown>>;
}

/**
 * Interface for shadow vector tracking
 */
export interface IShadowTracker {
  /**
   * Record agent execution
   */
  record(execution: IAgentExecutionRecord): Promise<void>;
}

// ==================== Orchestrator Class ====================

/**
 * PhD Pipeline Orchestrator - manages 48-agent research pipeline
 */
export class PhDPipelineOrchestrator {
  private config: IPipelineConfig;
  private executor: IAgentExecutor;
  private tracker?: IShadowTracker;
  private state: IPipelineState | null = null;
  private verbose: boolean;
  private socketClient: SocketClient | null = null;

  constructor(
    config: IPipelineConfig,
    executor: IAgentExecutor,
    options: { tracker?: IShadowTracker; verbose?: boolean } = {}
  ) {
    this.config = config;
    this.executor = executor;
    this.tracker = options.tracker;
    this.verbose = options.verbose ?? false;

    this.validateConfig();
    this.initSocketClient();
  }

  /**
   * Initialize socket client for observability events
   */
  private async initSocketClient(): Promise<void> {
    try {
      this.socketClient = new SocketClient({ verbose: false });
      await this.socketClient.connect();
    } catch {
      // INTENTIONAL: Non-blocking - observability is optional, pipeline works without it
      if (this.verbose) {
        console.debug('[PhD Pipeline] Socket client initialization failed (observability disabled)');
      }
    }
  }

  /**
   * Emit event to observability daemon
   */
  private emitEvent(event: Omit<IActivityEvent, 'id' | 'timestamp'>): void {
    if (!this.socketClient) return;

    try {
      const fullEvent: IActivityEvent = {
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        ...event,
      };
      this.socketClient.send(fullEvent);
    } catch {
      // INTENTIONAL: Non-blocking - event emission failures must not affect pipeline execution
    }
  }

  // ==================== Configuration Validation ====================

  /**
   * Validate pipeline configuration
   */
  private validateConfig(): void {
    if (this.verbose) {
      console.log('[PhD Pipeline] Validating configuration...');
    }

    // 1. Check agent count
    if (this.config.agents.length !== this.config.pipeline.totalAgents) {
      throw new PipelineConfigError(
        `Agent count mismatch: expected ${this.config.pipeline.totalAgents}, got ${this.config.agents.length}`,
        'INVALID_AGENT_COUNT'
      );
    }

    // 2. Check phase count
    if (this.config.phases.length !== this.config.pipeline.phases) {
      throw new PipelineConfigError(
        `Phase count mismatch: expected ${this.config.pipeline.phases}, got ${this.config.phases.length}`,
        'INVALID_PHASE_COUNT'
      );
    }

    // 3. Validate dependency graph (must be DAG)
    this.validateDAG();

    // 4. Check all agents have required fields
    for (const agent of this.config.agents) {
      if (!agent.id || !agent.key || !agent.name || !agent.phase) {
        throw new PipelineConfigError(
          `Invalid agent config missing required fields: id=${agent.id}`,
          'INVALID_AGENT_CONFIG'
        );
      }
    }

    // 5. Verify phase agent assignments match
    for (const phase of this.config.phases) {
      for (const agentId of phase.agents) {
        const agent = this.config.agents.find(a => a.id === agentId);
        if (!agent) {
          throw new PipelineConfigError(
            `Phase ${phase.id} references non-existent agent ${agentId}`,
            'PHASE_MISMATCH'
          );
        }
        if (agent.phase !== phase.id) {
          throw new PipelineConfigError(
            `Agent ${agentId} is in phase ${agent.phase} but listed in phase ${phase.id}`,
            'PHASE_MISMATCH'
          );
        }
      }
    }

    if (this.verbose) {
      console.log('[PhD Pipeline] Configuration valid ✓');
    }
  }

  /**
   * Validate dependency graph is a DAG (no cycles)
   */
  private validateDAG(): void {
    // Build adjacency list
    const graph = new Map<AgentId, AgentId[]>();
    for (const agent of this.config.agents) {
      graph.set(agent.id, agent.dependencies);
    }

    // DFS-based cycle detection
    const visited = new Set<AgentId>();
    const recStack = new Set<AgentId>();

    const hasCycle = (nodeId: AgentId, path: AgentId[]): AgentId[] | null => {
      visited.add(nodeId);
      recStack.add(nodeId);

      const deps = graph.get(nodeId) || [];
      for (const depId of deps) {
        if (!visited.has(depId)) {
          const cycle = hasCycle(depId, [...path, nodeId]);
          if (cycle) return cycle;
        } else if (recStack.has(depId)) {
          return [...path, nodeId, depId]; // Cycle found
        }
      }

      recStack.delete(nodeId);
      return null;
    };

    for (const agent of this.config.agents) {
      if (!visited.has(agent.id)) {
        const cycle = hasCycle(agent.id, []);
        if (cycle) {
          throw new PipelineConfigError(
            `Circular dependency detected: ${cycle.join(' → ')}`,
            'CIRCULAR_DEPENDENCY'
          );
        }
      }
    }

    if (this.verbose) {
      console.log('[PhD Pipeline] Dependency graph is acyclic (DAG) ✓');
    }
  }

  // ==================== Execution ====================

  /**
   * Execute the full pipeline
   */
  async execute(problemStatement: string): Promise<IPipelineState> {
    if (this.verbose) {
      console.log('[PhD Pipeline] Starting execution...');
    }

    this.state = createPipelineState(generatePipelineId());
    this.state.status = 'running';

    // Emit pipeline_started event
    this.emitEvent({
      component: 'pipeline',
      operation: 'pipeline_started',
      status: 'running',
      metadata: {
        pipelineId: this.state.pipelineId,
        name: this.config.pipeline.name,
        taskType: 'research',
        totalSteps: this.config.pipeline.totalAgents,
        steps: this.config.agents.map(a => a.key),
      },
    });

    try {
      // Execute each phase sequentially
      for (const phase of this.config.phases) {
        if (this.verbose) {
          console.log(`[PhD Pipeline] Executing Phase ${phase.id}: ${phase.name}`);
        }
        await this.executePhase(phase, problemStatement);
        this.state.currentPhase = phase.id + 1;
      }

      this.state.status = 'completed';
      this.state.endTime = Date.now();

      // Emit pipeline_completed event
      this.emitEvent({
        component: 'pipeline',
        operation: 'pipeline_completed',
        status: 'success',
        durationMs: this.state.endTime - this.state.startTime,
        metadata: {
          pipelineId: this.state.pipelineId,
          name: this.config.pipeline.name,
          totalSteps: this.config.pipeline.totalAgents,
          completedSteps: this.state.completedAgents.size,
          progress: 100,
        },
      });

      if (this.verbose) {
        console.log('[PhD Pipeline] Execution completed successfully');
      }

    } catch (error) {
      this.state.status = 'failed';
      this.state.endTime = Date.now();

      // Emit pipeline_failed event
      this.emitEvent({
        component: 'pipeline',
        operation: 'pipeline_failed',
        status: 'error',
        durationMs: this.state.endTime - this.state.startTime,
        metadata: {
          pipelineId: this.state.pipelineId,
          name: this.config.pipeline.name,
          error: error instanceof Error ? error.message : String(error),
        },
      });

      if (this.verbose) {
        console.error('[PhD Pipeline] Execution failed:', error);
      }

      // Preserve CriticalAgentError type for proper error handling chains
      if (error instanceof CriticalAgentError) {
        throw error;
      }

      // RULE-070: Re-throw with pipeline context (non-critical errors only)
      throw new Error(
        `PhD Pipeline "${this.config.pipeline.name}" (id: ${this.state.pipelineId}) failed at phase ${this.state.currentPhase}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }

    return this.state;
  }

  /**
   * Execute a single phase
   */
  private async executePhase(phase: IPhaseConfig, problemStatement: string): Promise<void> {
    const phaseAgents = this.config.agents.filter(a => phase.agents.includes(a.id));

    // Determine execution order using topological sort
    const executionOrder = this.topologicalSort(phaseAgents);

    if (this.verbose) {
      console.log(`[PhD Pipeline] Phase ${phase.id} execution order: ${executionOrder.map(a => a.key).join(' → ')}`);
    }

    // Execute agents in order
    for (const agent of executionOrder) {
      await this.executeAgent(agent, problemStatement);
    }
  }

  /**
   * Topological sort of agents within a phase
   */
  private topologicalSort(agents: IAgentConfig[]): IAgentConfig[] {
    const sorted: IAgentConfig[] = [];
    const visited = new Set<AgentId>();
    const agentMap = new Map(agents.map(a => [a.id, a]));

    const visit = (agentId: AgentId) => {
      if (visited.has(agentId)) return;
      visited.add(agentId);

      const agent = agentMap.get(agentId);
      if (!agent) return;

      // Visit dependencies first (but only within this phase)
      for (const depId of agent.dependencies) {
        if (agentMap.has(depId)) {
          visit(depId);
        }
      }

      sorted.push(agent);
    };

    for (const agent of agents) {
      visit(agent.id);
    }

    return sorted;
  }

  /**
   * Execute a single agent
   */
  private async executeAgent(agent: IAgentConfig, problemStatement: string): Promise<void> {
    if (this.verbose) {
      console.log(`[PhD Pipeline] Executing agent #${agent.id}: ${agent.key}`);
    }

    const stepId = `step_${this.state!.pipelineId}_${agent.id}_${Math.random().toString(36).slice(2, 8)}`;
    const phaseName = PHASE_NAMES[agent.phase] || `Phase ${agent.phase}`;

    // Create execution record
    const record: IAgentExecutionRecord = {
      agentId: agent.id,
      agentKey: agent.key,
      startTime: Date.now(),
      status: 'running',
      dependenciesSatisfied: agent.dependencies.filter(d => this.state!.completedAgents.has(d)),
    };

    this.state!.executionRecords.set(agent.id, record);

    // Emit step_started event
    this.emitEvent({
      component: 'pipeline',
      operation: 'step_started',
      status: 'running',
      metadata: {
        pipelineId: this.state!.pipelineId,
        stepId,
        stepName: agent.key,
        stepIndex: this.state!.completedAgents.size,
        agentType: agent.key,
        phase: phaseName,
        progress: (this.state!.completedAgents.size / this.config.pipeline.totalAgents) * 100,
      },
    });

    // Emit agent_started event for agent tracking
    this.emitEvent({
      component: 'agent',
      operation: 'agent_started',
      status: 'running',
      metadata: {
        executionId: `agent_${agent.key}_${stepId}`,
        agentKey: agent.key,
        agentName: agent.name,
        agentCategory: phaseName,
        pipelineId: this.state!.pipelineId,
        taskPreview: `Executing ${agent.name} for PhD research pipeline`,
        promptText: problemStatement,
      },
    });

    // Gather inputs from dependencies
    const inputs = this.gatherInputs(agent);
    inputs.problemStatement = problemStatement;

    try {
      // Execute agent
      const output = await this.executor.execute(agent.key, inputs, agent.timeout);

      // Update record
      record.endTime = Date.now();
      record.durationMs = record.endTime - record.startTime;
      record.status = 'success';
      record.output = output;

      // Store output
      this.state!.agentOutputs.set(agent.id, output);
      this.state!.completedAgents.add(agent.id);

      const completedCount = this.state!.completedAgents.size;
      const progress = (completedCount / this.config.pipeline.totalAgents) * 100;

      // Emit step_completed event
      this.emitEvent({
        component: 'pipeline',
        operation: 'step_completed',
        status: 'success',
        durationMs: record.durationMs,
        metadata: {
          pipelineId: this.state!.pipelineId,
          stepId,
          stepName: agent.key,
          progress,
          completedSteps: completedCount,
          totalSteps: this.config.pipeline.totalAgents,
        },
      });

      // Emit agent_completed event for agent tracking
      this.emitEvent({
        component: 'agent',
        operation: 'agent_completed',
        status: 'success',
        durationMs: record.durationMs,
        metadata: {
          executionId: `agent_${agent.key}_${stepId}`,
          agentKey: agent.key,
          agentName: agent.name,
          agentCategory: phaseName,
          pipelineId: this.state!.pipelineId,
          outputPreview: 'Agent completed successfully',
        },
      });

      // Track in Shadow Vector
      if (this.tracker) {
        await this.tracker.record(record);
      }

      if (this.verbose) {
        console.log(`[PhD Pipeline] Agent #${agent.id} completed in ${record.durationMs}ms`);
      }

      // Validate critical agent output
      if (isCriticalAgent(agent)) {
        this.validateCriticalAgent(agent, output);
      }

    } catch (error) {
      // Update record with failure
      record.endTime = Date.now();
      record.durationMs = record.endTime - record.startTime;
      record.status = 'failed';
      record.error = error instanceof Error ? error.message : String(error);

      // Emit step_failed event
      this.emitEvent({
        component: 'pipeline',
        operation: 'step_failed',
        status: 'error',
        durationMs: record.durationMs,
        metadata: {
          pipelineId: this.state!.pipelineId,
          stepId,
          stepName: agent.key,
          error: record.error,
        },
      });

      // Add to errors list
      this.state!.errors.push({
        agentId: agent.id,
        error: record.error,
      });

      // Track failure in Shadow Vector
      if (this.tracker) {
        await this.tracker.record(record);
      }

      // Critical agents halt the pipeline
      if (isCriticalAgent(agent)) {
        throw new CriticalAgentError(agent, error instanceof Error ? error : String(error));
      }

      if (this.verbose) {
        console.warn(`[PhD Pipeline] Agent #${agent.id} failed (non-critical): ${record.error}`);
      }
    }
  }

  /**
   * Gather inputs from completed dependencies
   */
  private gatherInputs(agent: IAgentConfig): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};

    for (const depId of agent.dependencies) {
      const depOutput = this.state!.agentOutputs.get(depId);
      if (depOutput) {
        // Merge dependency outputs into inputs
        Object.assign(inputs, depOutput);
      }
    }

    return inputs;
  }

  /**
   * Validate critical agent produced expected outputs
   */
  private validateCriticalAgent(agent: IAgentConfig, output: Record<string, unknown>): void {
    if (this.verbose) {
      console.log(`[PhD Pipeline] Validating critical agent #${agent.id}: ${agent.key}`);
    }

    // Agent-specific validation
    switch (agent.key) {
      case 'step-back-analyzer':
        if (!output.high_level_framing || !output.key_questions) {
          throw new CriticalAgentError(
            agent,
            'Must produce high_level_framing and key_questions'
          );
        }
        break;

      case 'contradiction-analyzer':
        if (!output.contradictions || !output.inconsistencies) {
          throw new CriticalAgentError(
            agent,
            'Must produce contradictions and inconsistencies'
          );
        }
        break;

      case 'adversarial-reviewer':
        if (!output.attack_vectors || !output.weaknesses) {
          throw new CriticalAgentError(
            agent,
            'Must produce attack_vectors and weaknesses'
          );
        }
        break;
    }

    if (this.verbose) {
      console.log(`[PhD Pipeline] Critical agent #${agent.id} validated ✓`);
    }
  }

  // ==================== State & Progress ====================

  /**
   * Get current pipeline state
   */
  getState(): IPipelineState | null {
    return this.state;
  }

  /**
   * Get pipeline progress
   */
  getProgress(): IPipelineProgress | null {
    if (!this.state) return null;

    const completed = this.state.completedAgents.size;
    const total = this.config.pipeline.totalAgents;
    const elapsedMs = Date.now() - this.state.startTime;

    // Estimate remaining time based on average agent time
    let estimatedRemainingMs: number | undefined;
    if (completed > 0) {
      const avgTimePerAgent = elapsedMs / completed;
      estimatedRemainingMs = avgTimePerAgent * (total - completed);
    }

    return {
      completed,
      total,
      percentage: (completed / total) * 100,
      currentPhase: this.state.currentPhase,
      currentPhaseName: PHASE_NAMES[this.state.currentPhase] || 'Unknown',
      elapsedMs,
      estimatedRemainingMs,
    };
  }

  /**
   * Get agent output by ID
   */
  getAgentOutput(agentId: AgentId): Record<string, unknown> | undefined {
    return this.state?.agentOutputs.get(agentId);
  }

  /**
   * Get agent execution record
   */
  getAgentRecord(agentId: AgentId): IAgentExecutionRecord | undefined {
    return this.state?.executionRecords.get(agentId);
  }

  /**
   * Check if agent completed
   */
  isAgentCompleted(agentId: AgentId): boolean {
    return this.state?.completedAgents.has(agentId) ?? false;
  }

  // ==================== Configuration Access ====================

  /**
   * Get pipeline configuration
   */
  getConfig(): IPipelineConfig {
    return this.config;
  }

  /**
   * Get agent configuration by ID
   */
  getAgentConfig(agentId: AgentId): IAgentConfig | undefined {
    return this.config.agents.find(a => a.id === agentId);
  }

  /**
   * Get phase configuration by ID
   */
  getPhaseConfig(phaseId: number): IPhaseConfig | undefined {
    return this.config.phases.find(p => p.id === phaseId);
  }

  /**
   * Get all critical agents
   */
  getCriticalAgents(): IAgentConfig[] {
    return this.config.agents.filter(a => isCriticalAgent(a));
  }
}
