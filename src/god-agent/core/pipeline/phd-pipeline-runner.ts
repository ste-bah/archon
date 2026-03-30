/**
 * PhD Pipeline Runner
 * TASK-E2E-001 - High-level orchestrator for PhD research pipeline
 *
 * Wires together:
 * - AgentRegistry (agent loading from .claude/agents/)
 * - ClaudeTaskExecutor (agent execution via Task tool)
 * - PhDPipelineBridge (pipeline definition building)
 * - PhDLearningIntegration (Sona Engine trajectory tracking)
 * - RelayRaceOrchestrator (sequential agent execution)
 */

import { AgentRegistry } from '../agents/index.js';
// TODO: Fix ClaudeTaskExecutor types before re-enabling
// import { ClaudeTaskExecutor } from '../executor/index.js';
import { RelayRaceOrchestrator } from '../orchestration/relay-race-orchestrator.js';
import type {
  IAgentExecutor,
  IPipelineExecution,
  IPipelineEvent,
  IAgentResult,
} from '../orchestration/orchestration-types.js';
import { PhDPipelineBridge, getPhDPipelineConfig } from './index.js';
import {
  PhDLearningIntegration,
  createPhDLearningIntegration,
  type ILearningIntegrationConfig,
} from '../integration/index.js';
import type { SonaEngine } from '../learning/sona-engine.js';
import type { ReasoningBank } from '../reasoning/reasoning-bank.js';

// ==================== Types ====================

/**
 * Memory engine interface for cross-agent communication
 */
export interface IMemoryEngine {
  store(
    key: string,
    content: string,
    options?: { namespace?: string; metadata?: Record<string, unknown> }
  ): Promise<void>;
  retrieve(key: string, options?: { namespace?: string }): Promise<string | null>;
}

/**
 * Options for PhDPipelineRunner
 */
export interface IPhDPipelineRunnerOptions {
  /** Base path to agent definitions (e.g., '.claude/agents') */
  agentsBasePath: string;
  /** Optional custom executor (for testing) */
  executor?: IAgentExecutor;
  /** Sona Engine for trajectory tracking */
  sonaEngine?: SonaEngine;
  /** Memory engine for agent communication */
  memoryEngine?: IMemoryEngine;
  /** Reasoning bank for hyperedge creation */
  reasoningBank?: ReasoningBank | null;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Agent execution timeout (ms) */
  agentTimeout?: number;
  /** Learning integration configuration overrides */
  learningConfig?: Partial<ILearningIntegrationConfig>;
  /** Working directory for hooks */
  workingDirectory?: string;
  /** Optional style profile ID for Phase 6 (Writing) */
  styleProfileId?: string;
}

/**
 * Runner statistics
 */
export interface IRunnerStats {
  /** Number of agents loaded in registry */
  agentsLoaded: number;
  /** Number of categories discovered */
  categoriesLoaded: number;
  /** Number of pipeline runs */
  pipelinesRun: number;
  /** Number of successful pipelines */
  pipelinesSucceeded: number;
  /** Overall success rate */
  successRate: number;
  /** Number of trajectories created */
  trajectoriesCreated: number;
  /** PhD-specific metrics */
  phdMetrics?: {
    phaseStats: Map<string, { total: number; successful: number; rate: number }>;
    criticalAgentCount: number;
    criticalAgentSuccessRate: number;
    overallSuccessRate: number;
  };
}

/**
 * Pipeline run result
 */
export interface IRunResult {
  /** Pipeline execution state */
  execution: IPipelineExecution;
  /** Execution ID */
  executionId: string;
  /** Whether pipeline completed successfully */
  success: boolean;
  /** Duration in milliseconds */
  duration: number;
  /** Error message if failed */
  error?: string;
}

// ==================== PhD Pipeline Runner ====================

/**
 * High-Level PhD Pipeline Runner
 *
 * Orchestrates the full 48-agent PhD research pipeline with:
 * - Automatic agent loading from .claude/agents/phdresearch/
 * - Sequential execution via RelayRaceOrchestrator
 * - Continuous learning via PhDLearningIntegration
 * - Memory key passing between agents
 */
export class PhDPipelineRunner {
  private options: IPhDPipelineRunnerOptions;
  private initialized = false;

  // Core components
  private registry!: AgentRegistry;
  private executor!: IAgentExecutor;
  private orchestrator!: RelayRaceOrchestrator;
  private bridge!: PhDPipelineBridge;
  private learning!: PhDLearningIntegration;

  // Stats tracking
  private pipelinesRun = 0;
  private pipelinesSucceeded = 0;
  private trajectoriesCreated = 0;

  constructor(options: IPhDPipelineRunnerOptions) {
    this.options = {
      verbose: false,
      agentTimeout: 300000, // 5 minutes default
      ...options,
    };
  }

  // ==================== Initialization ====================

  /**
   * Initialize all components
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.log('Initializing PhD Pipeline Runner...');

    // 1. Create and initialize agent registry
    this.registry = new AgentRegistry({
      basePath: this.options.agentsBasePath,
      verbose: this.options.verbose,
    });
    await this.registry.initialize(this.options.agentsBasePath);

    const registryStats = this.registry.getStats();
    this.log(`Registry loaded: ${registryStats.totalAgents} agents across ${registryStats.categoriesScanned} categories`);

    // 2. Create executor (use provided or create default)
    if (this.options.executor) {
      this.executor = this.options.executor;
      this.log('Using provided executor');
    } else {
      // TODO: Fix ClaudeTaskExecutor types before re-enabling
      // this.executor = new ClaudeTaskExecutor(this.registry, {
      //   workingDirectory: this.options.workingDirectory ?? process.cwd(),
      //   verbose: this.options.verbose,
      // });
      // this.log('Created ClaudeTaskExecutor');
      throw new Error('ClaudeTaskExecutor temporarily disabled - provide executor via options');
    }

    // 3. Create orchestrator
    this.orchestrator = new RelayRaceOrchestrator(this.executor, {
      verbose: this.options.verbose,
      namespace: 'phd',
      agentTimeout: this.options.agentTimeout,
      trackTrajectories: !!this.options.sonaEngine,
    });

    // Set memory and sona engines if provided
    if (this.options.memoryEngine) {
      this.orchestrator.setMemoryEngine(this.options.memoryEngine);
      this.log('Memory engine attached to orchestrator');
    }

    if (this.options.sonaEngine) {
      this.orchestrator.setSonaEngine(this.options.sonaEngine);
      this.log('Sona engine attached to orchestrator');
    }

    // 4. Create pipeline bridge
    const phdConfig = getPhDPipelineConfig();
    this.bridge = new PhDPipelineBridge(phdConfig, this.registry, {
      styleProfileId: this.options.styleProfileId,
    });
    this.log('PhD Pipeline Bridge created');

    // 5. Create learning integration (if Sona Engine provided)
    if (this.options.sonaEngine) {
      this.learning = createPhDLearningIntegration(
        this.options.sonaEngine,
        this.options.reasoningBank ?? null,
        {
          verbose: this.options.verbose,
          ...this.options.learningConfig,
        }
      );
      this.log('PhD Learning Integration created');

      // Wire orchestrator events to learning integration
      this.wireOrchestrationEvents();
    } else {
      // Create a minimal learning integration for tracking
      this.learning = new PhDLearningIntegration(
        this.createNoOpSonaEngine(),
        { trackTrajectories: false },
        null
      );
    }

    this.initialized = true;
    this.log('PhD Pipeline Runner initialized successfully');
  }

  /**
   * Wire orchestrator events to learning integration
   */
  private wireOrchestrationEvents(): void {
    this.orchestrator.addEventListener((event: IPipelineEvent) => {
      switch (event.type) {
        case 'pipeline:start':
          const pipelineTrajectoryId = this.learning.onPipelineStart(
            event.pipelineId,
            'PhD Research Pipeline'
          );
          if (pipelineTrajectoryId) {
            this.trajectoriesCreated++;
          }
          break;

        case 'agent:start':
          if (event.agentName) {
            const phase = this.inferPhaseFromAgent(event.agentName);
            const trajectoryId = this.learning.onAgentStart(
              event.agentName,
              phase
            );
            if (trajectoryId) {
              this.trajectoriesCreated++;
            }
          }
          break;

        case 'agent:complete':
          if (event.agentName && event.data) {
            const result = event.data as unknown as IAgentResult;
            // Fire and forget - don't await in event handler
            this.learning.onAgentComplete(event.agentName, result).catch(err => {
              if (this.options.verbose) {
                console.error('[PhDPipelineRunner] Learning feedback error:', err);
              }
            });
          }
          break;

        case 'pipeline:complete':
          if (event.data) {
            const execution = event.data as unknown as IPipelineExecution;
            // Fire and forget
            this.learning.onPipelineComplete(execution).catch(err => {
              if (this.options.verbose) {
                console.error('[PhDPipelineRunner] Pipeline learning error:', err);
              }
            });
          }
          break;
      }
    });

    this.log('Orchestration events wired to learning integration');
  }

  // ==================== Pipeline Execution ====================

  /**
   * Run the PhD research pipeline
   * @param problemStatement - Research problem to investigate
   * @returns Pipeline execution result
   */
  async run(problemStatement: string): Promise<IRunResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = Date.now();
    const executionId = this.generateExecutionId();

    this.log(`Starting PhD pipeline run: ${executionId}`);
    this.log(`Problem: ${problemStatement.substring(0, 100)}...`);

    try {
      // Build pipeline definition from bridge
      const pipelineDefinition = this.bridge.buildPipelineDefinition(executionId);

      // Inject problem statement into first agent's task
      if (pipelineDefinition.agents.length > 0) {
        pipelineDefinition.agents[0].task = `${pipelineDefinition.agents[0].task}\n\nResearch Problem: ${problemStatement}`;
      }

      this.log(`Pipeline built: ${pipelineDefinition.agents.length} agents`);

      // Run pipeline through orchestrator
      const execution = await this.orchestrator.runPipeline(pipelineDefinition);

      const duration = Date.now() - startTime;
      this.pipelinesRun++;

      const success = execution.status === 'completed';
      if (success) {
        this.pipelinesSucceeded++;
        this.log(`Pipeline completed successfully in ${duration}ms`);
      } else {
        this.log(`Pipeline failed: ${execution.error}`);
      }

      return {
        execution,
        executionId,
        success,
        duration,
        error: execution.error,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.pipelinesRun++;

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log(`Pipeline error: ${errorMessage}`);

      // Create failed execution result
      const failedExecution: IPipelineExecution = {
        pipelineId: executionId,
        name: 'PhD Research Pipeline',
        status: 'failed',
        currentAgentIndex: 0,
        agentResults: new Map(),
        startedAt: startTime,
        completedAt: Date.now(),
        error: errorMessage,
        totalAgents: 48,
      };

      return {
        execution: failedExecution,
        executionId,
        success: false,
        duration,
        error: errorMessage,
      };
    }
  }

  // ==================== Statistics ====================

  /**
   * Get runner statistics
   */
  getStats(): IRunnerStats {
    const registryStats = this.initialized
      ? this.registry.getStats()
      : { totalAgents: 0, totalCategories: 0 };

    const stats: IRunnerStats = {
      agentsLoaded: registryStats.totalAgents,
      categoriesLoaded: registryStats.totalCategories,
      pipelinesRun: this.pipelinesRun,
      pipelinesSucceeded: this.pipelinesSucceeded,
      successRate: this.pipelinesRun > 0
        ? this.pipelinesSucceeded / this.pipelinesRun
        : 0,
      trajectoriesCreated: this.trajectoriesCreated,
    };

    // Add PhD-specific metrics if learning is initialized
    if (this.learning && this.options.sonaEngine) {
      stats.phdMetrics = this.learning.getPhdMetrics();
    }

    return stats;
  }

  /**
   * Get orchestrator for advanced usage
   */
  getOrchestrator(): RelayRaceOrchestrator {
    this.ensureInitialized();
    return this.orchestrator;
  }

  /**
   * Get learning integration for advanced usage
   */
  getLearningIntegration(): PhDLearningIntegration {
    this.ensureInitialized();
    return this.learning;
  }

  /**
   * Get bridge for advanced usage
   */
  getBridge(): PhDPipelineBridge {
    this.ensureInitialized();
    return this.bridge;
  }

  /**
   * Get registry for advanced usage
   */
  getRegistry(): AgentRegistry {
    this.ensureInitialized();
    return this.registry;
  }

  /**
   * Check if runner is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ==================== Helper Methods ====================

  /**
   * Generate unique execution ID
   */
  private generateExecutionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `phd-${timestamp}-${random}`;
  }

  /**
   * Infer phase from agent name
   */
  private inferPhaseFromAgent(agentName: string): string {
    const normalizedName = agentName.toLowerCase();

    // Phase inference based on agent naming patterns
    const phasePatterns: Array<[RegExp, string]> = [
      [/step-back|self-ask|construct-defin|ambiguity/i, 'Foundation'],
      [/literature|source|research-plan|search|systematic/i, 'Discovery'],
      [/thematic|theory|hypothesis|model/i, 'Architecture'],
      [/evidence|bias|quality|contradict/i, 'Synthesis'],
      [/method|sampling|instrument|analysis|validity/i, 'Design'],
      [/abstract|intro|literature-review|methodology|results|discussion|conclusion/i, 'Writing'],
      [/citation|file-length|consistency|reproducibility/i, 'QA'],
    ];

    for (const [pattern, phase] of phasePatterns) {
      if (pattern.test(normalizedName)) {
        return phase;
      }
    }

    return 'Unknown';
  }

  /**
   * Create no-op Sona Engine for when real one isn't provided
   */
  private createNoOpSonaEngine(): SonaEngine {
    return {
      createTrajectory: () => 'noop-trajectory',
      provideFeedback: async () => {},
      getTrajectoryStats: () => ({ total: 0, completed: 0 }),
      // Add other required methods as no-ops
    } as unknown as SonaEngine;
  }

  /**
   * Ensure runner is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('PhDPipelineRunner not initialized. Call initialize() first.');
    }
  }

  /**
   * Log message if verbose
   */
  private log(message: string): void {
    if (this.options.verbose) {
      console.log(`[PhDPipelineRunner] ${message}`);
    }
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.pipelinesRun = 0;
    this.pipelinesSucceeded = 0;
    this.trajectoriesCreated = 0;
    if (this.learning) {
      this.learning.clear();
    }
  }
}

// ==================== Factory ====================

/**
 * Create a PhD Pipeline Runner with default configuration
 */
export function createPhDPipelineRunner(
  options: IPhDPipelineRunnerOptions
): PhDPipelineRunner {
  return new PhDPipelineRunner(options);
}
