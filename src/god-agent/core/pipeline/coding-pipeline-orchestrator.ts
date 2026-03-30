/**
 * Coding Pipeline Orchestrator
 *
 * Executes the 40-agent, 7-phase coding pipeline with:
 * - DAG-based dependency resolution
 * - Checkpoint management for rollback
 * - XP tracking and aggregation
 * - ClaudeFlow subagent integration
 *
 * @module src/god-agent/core/pipeline/coding-pipeline-orchestrator
 * @see TASK-ORCH-004-pipeline-orchestration.md
 * @see SPEC-001-architecture.md
 */

// Pipeline coordination services
import { PipelineValidator } from './pipeline-validator.js';
import {
  PipelinePromptBuilder,
  type IPromptContext,
} from './pipeline-prompt-builder.js';
import { PipelineMemoryCoordinator } from './pipeline-memory-coordinator.js';
import type { ISemanticContext } from './leann-context-service.js';

// Sherlock-Quality Gate Integration (PRD Section 2.3)
import type { IntegratedValidator, IIntegratedValidationResult } from './sherlock-quality-gate-integration.js';

// Extracted modules [REQ-REFACTOR-001 through REQ-REFACTOR-004]
import {
  providePipelineFeedback as providePipelineFeedbackFn,
  provideStepFeedback as provideStepFeedbackFn,
  batchAgentsForExecution as batchAgentsForExecutionFn,
} from './coding-phase-executor.js';
import {
  storeMemory as storeMemoryFn,
  retrieveMemoryContext as retrieveMemoryContextFn,
} from './coding-memory-adapter.js';
import {
  executePhase as executePhaseFn,
  rollbackToLastCheckpoint as rollbackToLastCheckpointFn,
  type IAgentExecutorDependencies,
  type IAgentExecutorConfig,
  type IExecutionState,
  type ISherlockValidatorAdapter,
  type ICheckpointData,
} from './coding-agent-executor.js';
import { initializePipelineExecution } from './coding-pipeline-init.js';
import {
  finalizePipelineExecution,
  buildFinalPipelineState,
  buildCompletedMetadata,
  buildXPStorageObject,
  type IPipelineFinalizeInput,
} from './coding-pipeline-finalize.js';

// Observability
import { ObservabilityBus } from '../observability/bus.js';

import type {
  CodingPipelinePhase,
  CodingPipelineAgent,
  IAgentMapping,
  IPipelineDAG,
  IPipelineExecutionConfig,
  IAgentExecutionResult,
  IPhaseExecutionResult,
  IPipelineExecutionResult,
} from './types.js';

import {
  PHASE_ORDER,
  CHECKPOINT_PHASES,
  CRITICAL_AGENTS,
  CODING_MEMORY_NAMESPACE,
} from './types.js';

// Dynamic config loader replaces hardcoded CODING_PIPELINE_MAPPINGS
import {
  CodingPipelineConfigLoader,
  type CodingAgentConfig,
} from './coding-pipeline-config-loader.js';

// Backwards compatibility - import buildPipelineDAG for DAG structure
import { buildPipelineDAG } from './command-task-bridge.js';

// Extracted types and constants [REQ-REFACTOR-004]
import type {
  IStepExecutor,
  IOrchestratorDependencies,
  IOrchestratorConfig,
  IPipelineSession,
  ISessionBatchResponse,
  IBatchExecutionResult,
  IAgentBatchItem,
} from './coding-pipeline-types.js';
import { ReasoningMode } from '../reasoning/reasoning-types.js';
import { DEFAULT_ORCHESTRATOR_CONFIG } from './coding-pipeline-constants.js';

// Parallel agent awareness [PARALLEL-AWARE]
import { PipelineProgressStore } from './pipeline-progress-store.js';
import { PipelineFileClaims } from './pipeline-file-claims.js';
import { SituationalAwarenessBuilder } from './pipeline-situational-awareness.js';

// Extracted factory functions [REQ-REFACTOR-005]
import {
  createPipelineIntegratedValidator,
  validatePhaseWithSherlockAndStore,
  handleSherlockGuiltyVerdictAndStore,
  type ISherlockWrapperDependencies,
} from './coding-pipeline-factories.js';

// Session persistence (disk-based state management for CLI)
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

// Note: ICheckpointData imported from coding-agent-executor.ts

// ═══════════════════════════════════════════════════════════════════════════
// SESSION PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════════

// Session storage directory for disk-based persistence
const SESSION_DIR = join(process.cwd(), '.god-agent/coding-sessions');

// Ensure session directory exists
if (!existsSync(SESSION_DIR)) {
  mkdirSync(SESSION_DIR, { recursive: true });
}

// ═══════════════════════════════════════════════════════════════════════════
// CODING PIPELINE ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Orchestrates the 40-agent coding pipeline execution
 *
 * The orchestrator:
 * 1. Builds execution order from DAG
 * 2. Executes agents phase by phase
 * 3. Creates checkpoints for rollback
 * 4. Tracks XP and metrics
 * 5. Handles critical agent failures
 */
export class CodingPipelineOrchestrator {
  private config: IOrchestratorConfig;
  private dag: IPipelineDAG;
  private executionState: IExecutionState;

  // LEANN/RLM Integration - Pipeline coordination services
  private readonly validator: PipelineValidator;
  private readonly promptBuilder: PipelinePromptBuilder;
  private readonly memoryCoordinator: PipelineMemoryCoordinator;

  // Dynamic config loader [REQ-PIPE-047]
  private readonly configLoader: CodingPipelineConfigLoader;

  // Sherlock-Quality Gate Integration [PRD Section 2.3]
  // Connects forensic verdicts to learning system (RLM/LEANN)
  private readonly integratedValidator: IntegratedValidator | null;

  // Parallel agent awareness [PARALLEL-AWARE]
  private readonly progressStore: PipelineProgressStore;
  private readonly fileClaims: PipelineFileClaims;
  private readonly awarenessBuilder: SituationalAwarenessBuilder;

  /**
   * Create a new CodingPipelineOrchestrator with dependency injection.
   *
   * @param dependencies - Required services for LEANN/RLM/Learning integration
   * @param config - Optional orchestrator configuration
   */
  constructor(
    private readonly dependencies: IOrchestratorDependencies,
    config: Partial<IOrchestratorConfig> = {}
  ) {
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
    this.dag = buildPipelineDAG();

    // Initialize execution state
    this.executionState = {
      executionResults: new Map(),
      checkpoints: new Map(),
      totalXP: 0,
    };

    // Initialize dynamic config loader [REQ-PIPE-047]
    this.configLoader = new CodingPipelineConfigLoader();

    // Initialize internal coordinators (from PipelineExecutor pattern)
    this.validator = new PipelineValidator(dependencies.agentRegistry);
    this.promptBuilder = new PipelinePromptBuilder(dependencies.agentRegistry);
    this.memoryCoordinator = new PipelineMemoryCoordinator(dependencies.interactionStore, {
      verbose: this.config.verbose,
    });

    // Initialize Sherlock-Quality Gate Integration [PRD Section 2.3] via factory
    this.integratedValidator = createPipelineIntegratedValidator({
      memoryCoordinator: this.memoryCoordinator,
      memoryNamespace: this.config.memoryNamespace,
      verbose: this.config.verbose,
      enableLearning: this.config.enableLearning,
      sonaEngine: dependencies.sonaEngine,
      reasoningBank: dependencies.reasoningBank,
      log: this.log.bind(this),
    });

    // Initialize parallel agent awareness [PARALLEL-AWARE]
    this.progressStore = new PipelineProgressStore();
    this.fileClaims = new PipelineFileClaims();
    this.awarenessBuilder = new SituationalAwarenessBuilder(this.progressStore, this.fileClaims);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN EXECUTION METHOD
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute the full coding pipeline
   *
   * @param pipelineConfig - Pipeline configuration from prepareCodeTask()
   * @returns Complete pipeline execution result
   */
  async execute(pipelineConfig: IPipelineExecutionConfig): Promise<IPipelineExecutionResult> {
    const startTime = Date.now();
    const phaseResults: IPhaseExecutionResult[] = [];
    const completedPhases: CodingPipelinePhase[] = [];
    let failedPhase: CodingPipelinePhase | undefined;
    let rollbackApplied = false;
    let errorMessage: string | undefined;

    // [REQ-REFACTOR-003] Use extracted initialization function
    const initResult = initializePipelineExecution(pipelineConfig, this.validator, this.log.bind(this));
    const { pipelineId, totalAgentCount } = initResult;
    let trajectoryId = initResult.trajectoryId;

    // Persist trajectory to learning.db so feedback calls succeed (PRD Section 5.1)
    if (this.dependencies.embeddingProvider && this.dependencies.reasoningBank && pipelineConfig.taskText) {
      try {
        const embedding = await this.dependencies.embeddingProvider.embed(pipelineConfig.taskText);
        const response = await this.dependencies.reasoningBank.reason({
          query: embedding,
          type: ReasoningMode.PATTERN_MATCH,
          applyLearning: true,
          enhanceWithGNN: false,
          maxResults: 5,
          confidenceThreshold: 0.5,
          metadata: {
            source: 'coding-pipeline-orchestrator',
            pipelineId,
            queryText: pipelineConfig.taskText,
          },
        });
        trajectoryId = response.trajectoryId;
        this.log(`Embedding-backed trajectory created: ${trajectoryId}`);
      } catch (error) {
        this.log(`Warning: Embedding trajectory failed, falling back to simple: ${error}`);
        if (this.dependencies.sonaEngine) {
          try {
            this.dependencies.sonaEngine.createTrajectoryWithId(
              trajectoryId, 'reasoning.pattern', [], [`pipeline:${pipelineId}`]
            );
            this.log(`Simple trajectory created: ${trajectoryId}`);
          } catch (fallbackError) {
            this.log(`Warning: Simple trajectory also failed: ${fallbackError}`);
          }
        }
      }
    } else if (this.dependencies.sonaEngine) {
      try {
        this.dependencies.sonaEngine.createTrajectoryWithId(
          trajectoryId, 'reasoning.pattern', [], [`pipeline:${pipelineId}`]
        );
        this.log(`Pipeline trajectory created: ${trajectoryId}`);
      } catch (error) {
        this.log(`Warning: Pipeline trajectory creation failed: ${error}`);
      }
    }

    // Emit pipeline_started event (preserve in orchestrator for observability)
    ObservabilityBus.getInstance().emit({
      component: 'pipeline',
      operation: 'pipeline_started',
      status: 'running',
      metadata: { pipelineId, phases: pipelineConfig.phases, totalAgents: totalAgentCount },
    });

    // Initialize pipeline state in memory (preserve in orchestrator for memory coordination)
    storeMemoryFn(this.memoryCoordinator, this.config.memoryNamespace, 'pipeline/state', {
      status: 'running',
      startTime: new Date().toISOString(),
      phases: pipelineConfig.phases,
      currentPhase: 0,
      pipelineId,
    }, this.log.bind(this));

    // Execute phases
    try {
      for (const phase of pipelineConfig.phases) {
        this.log(`Executing phase: ${phase}`);

        // Update current phase in memory
        storeMemoryFn(this.memoryCoordinator, this.config.memoryNamespace, 'pipeline/state', {
          currentPhase: PHASE_ORDER.indexOf(phase) + 1,
          currentPhaseName: phase,
        }, this.log.bind(this));

        const phaseResult = await this.executePhaseWrapper(phase, pipelineConfig, pipelineId);
        phaseResults.push(phaseResult);

        if (phaseResult.success) {
          completedPhases.push(phase);
          this.executionState.totalXP += phaseResult.totalXP;

          // Store phase XP
          storeMemoryFn(this.memoryCoordinator, this.config.memoryNamespace, `xp/phase-${PHASE_ORDER.indexOf(phase) + 1}`, {
            phase,
            xp: phaseResult.totalXP,
            timestamp: new Date().toISOString(),
          }, this.log.bind(this));
        } else {
          failedPhase = phase;
          errorMessage = `Phase ${phase} failed`;
          this.log(`Phase ${phase} failed, checking for rollback...`);

          if (this.config.enableCheckpoints && this.executionState.checkpoints.size > 0) {
            rollbackApplied = rollbackToLastCheckpointFn(
              this.memoryCoordinator,
              this.config.memoryNamespace,
              this.executionState,
              this.log.bind(this)
            );
          }
          break;
        }
      }
    } catch (error) {
      this.log(`Pipeline execution error: ${error}`);
      failedPhase = pipelineConfig.phases[completedPhases.length];
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    // [REQ-REFACTOR-003] Use extracted finalization function
    const finalizeInput: IPipelineFinalizeInput = {
      success: !failedPhase,
      phaseResults,
      completedPhases,
      failedPhase,
      rollbackApplied,
      errorMessage,
      startTime,
      totalXP: this.executionState.totalXP,
      pipelineId,
      trajectoryId,
    };
    const finalizeResult = finalizePipelineExecution(finalizeInput);

    // Learning feedback (preserve in orchestrator)
    // Convert feedbackStatus to 'completed' | 'failed' (skip 'skipped' status)
    if (this.config.enableLearning && finalizeResult.feedbackStatus !== 'skipped') {
      await providePipelineFeedbackFn(
        { sonaEngine: this.dependencies.sonaEngine, reasoningBank: this.dependencies.reasoningBank },
        trajectoryId,
        finalizeResult.quality,
        finalizeResult.feedbackStatus as 'completed' | 'failed',
        errorMessage,
        this.log.bind(this)
      );
    }

    // Store final XP (preserve in orchestrator for memory coordination)
    storeMemoryFn(this.memoryCoordinator, this.config.memoryNamespace, 'xp/total',
      buildXPStorageObject(this.executionState.totalXP), this.log.bind(this));

    // Update final pipeline state (preserve in orchestrator for memory coordination)
    storeMemoryFn(this.memoryCoordinator, this.config.memoryNamespace, 'pipeline/state',
      buildFinalPipelineState(finalizeInput, finalizeResult.executionTimeMs), this.log.bind(this));

    // Emit pipeline_completed event (preserve in orchestrator for observability)
    ObservabilityBus.getInstance().emit({
      component: 'pipeline',
      operation: 'pipeline_completed',
      status: finalizeResult.result.success ? 'success' : 'error',
      durationMs: finalizeResult.executionTimeMs,
      metadata: { ...buildCompletedMetadata(finalizeInput) },
    });

    return finalizeResult.result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE EXECUTION WRAPPER
  // Delegates to extracted executePhase function in coding-agent-executor.ts
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute a single phase of the pipeline.
   * Wrapper that builds dependencies and delegates to extracted function.
   */
  private async executePhaseWrapper(
    phase: CodingPipelinePhase,
    config: IPipelineExecutionConfig,
    pipelineId: string
  ): Promise<IPhaseExecutionResult> {
    // Build dependencies for extracted function
    const deps: IAgentExecutorDependencies = {
      sonaEngine: this.dependencies.sonaEngine,
      reasoningBank: this.dependencies.reasoningBank,
      leannContextService: this.dependencies.leannContextService,
      memoryCoordinator: this.memoryCoordinator,
      promptBuilder: this.promptBuilder,
      stepExecutor: this.config.stepExecutor,
      // Parallel agent awareness [PARALLEL-AWARE]
      progressStore: this.progressStore,
      fileClaims: this.fileClaims,
      awarenessBuilder: this.awarenessBuilder,
      // PRD: LEANN Pattern Store — reusable pattern retrieval
      patternMatcher: this.dependencies.patternMatcher,
    };

    // Build config for extracted function
    const executorConfig: IAgentExecutorConfig = {
      agentTimeoutMs: this.config.agentTimeoutMs,
      memoryNamespace: this.config.memoryNamespace,
      agentMdPath: this.config.agentMdPath,
      enableLearning: this.config.enableLearning,
      verbose: this.config.verbose,
      enableParallelExecution: this.config.enableParallelExecution,
      maxParallelAgents: this.config.maxParallelAgents,
      enableCheckpoints: this.config.enableCheckpoints,
    };

    // Build Sherlock validator adapter
    const sherlockValidator: ISherlockValidatorAdapter | null = this.integratedValidator
      ? {
          validatePhase: async (p, result, retryCount) =>
            this.validatePhaseWithSherlockWrapper(p, result, retryCount),
          handleGuiltyVerdict: (result, p) =>
            this.handleSherlockGuiltyVerdictWrapper(result, p),
        }
      : null;

    // Delegate to extracted function
    return executePhaseFn(
      deps,
      executorConfig,
      phase,
      config,
      pipelineId,
      this.executionState,
      this.getAgentsForPhaseFromLoader.bind(this),
      sherlockValidator,
      this.log.bind(this)
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHERLOCK-QUALITY GATE VALIDATION [PRD Section 2.3]
  // Thin wrappers that delegate to extracted factory functions.
  // ═══════════════════════════════════════════════════════════════════════════

  /** Build Sherlock wrapper dependencies for extracted functions */
  private getSherlockDeps(): ISherlockWrapperDependencies {
    return {
      integratedValidator: this.integratedValidator,
      memoryCoordinator: this.memoryCoordinator,
      memoryNamespace: this.config.memoryNamespace,
      verbose: this.config.verbose,
      log: this.log.bind(this),
    };
  }

  /** Validate phase with Sherlock-Quality Gate (delegates to factory function) */
  private async validatePhaseWithSherlockWrapper(
    phase: CodingPipelinePhase,
    phaseResult: IPhaseExecutionResult,
    retryCount: number = 0
  ): Promise<IIntegratedValidationResult | null> {
    return validatePhaseWithSherlockAndStore(this.getSherlockDeps(), phase, phaseResult, retryCount);
  }

  /** Handle GUILTY verdict (delegates to factory function) */
  private handleSherlockGuiltyVerdictWrapper(
    validationResult: IIntegratedValidationResult,
    phase: CodingPipelinePhase
  ): string[] {
    return handleSherlockGuiltyVerdictAndStore(this.getSherlockDeps(), validationResult, phase);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DYNAMIC CONFIG LOADER METHODS [REQ-PIPE-047]
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get agents for a phase from the dynamic loader.
   * Converts CodingAgentConfig to IAgentMapping for orchestrator compatibility.
   */
  private async getAgentsForPhaseFromLoader(phase: CodingPipelinePhase): Promise<IAgentMapping[]> {
    const allMappings = await this.configLoader.getAgentMappings();
    return allMappings.filter(m => m.phase === phase);
  }

  /**
   * Get agent markdown content from loaded config.
   * Falls back to file read if not in cache.
   */
  private async getAgentMarkdownFromLoader(agentKey: string): Promise<string> {
    const agent = await this.configLoader.getAgentByKey(agentKey);
    return agent?.fullContent ?? '';
  }

  /** Log message if verbose mode enabled */
  private log(message: string): void {
    if (this.config.verbose) {
      console.log(`[CodingPipelineOrchestrator] ${message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC GETTERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get current total XP
   */
  getTotalXP(): number {
    return this.executionState.totalXP;
  }

  /**
   * Get all execution results
   */
  getExecutionResults(): Map<CodingPipelineAgent, IAgentExecutionResult> {
    return new Map(this.executionState.executionResults);
  }

  /**
   * Get all checkpoints
   */
  getCheckpoints(): Map<CodingPipelinePhase, ICheckpointData> {
    return new Map(this.executionState.checkpoints);
  }

  /**
   * Get the DAG
   */
  getDAG(): IPipelineDAG {
    return this.dag;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATEFUL CLI API (PhD Pipeline Pattern)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Save session to disk
   * Enables resumption after process restart (PRD: massive context handling)
   */
  private saveSessionToDisk(session: IPipelineSession): void {
    const sessionPath = join(SESSION_DIR, `${session.sessionId}.json`);
    writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf-8');
    this.log(`Session ${session.sessionId} saved to disk`);
  }

  /**
   * Load session from disk
   * Enables resumption after process restart
   */
  private loadSessionFromDisk(sessionId: string): IPipelineSession {
    const sessionPath = join(SESSION_DIR, `${sessionId}.json`);

    if (!existsSync(sessionPath)) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const data = readFileSync(sessionPath, 'utf-8');
    const session = JSON.parse(data) as IPipelineSession;
    this.log(`Session ${sessionId} loaded from disk`);
    return session;
  }

  /**
   * Check if session exists on disk
   */
  private sessionExists(sessionId: string): boolean {
    const sessionPath = join(SESSION_DIR, `${sessionId}.json`);
    return existsSync(sessionPath);
  }

  /**
   * Delete session from disk (cleanup after completion)
   */
  private deleteSession(sessionId: string): void {
    const sessionPath = join(SESSION_DIR, `${sessionId}.json`);
    if (existsSync(sessionPath)) {
      // Don't actually delete - keep for debugging
      // Just mark as complete in the file
      this.log(`Session ${sessionId} marked complete (file preserved)`);
    }
  }

  /**
   * Resume existing session from disk
   * Validates session integrity and returns current state
   *
   * @param sessionId - Session identifier to resume
   * @returns Session batch response for current position
   */
  async resumeSession(sessionId: string): Promise<ISessionBatchResponse> {
    if (!this.sessionExists(sessionId)) {
      throw new Error(`Cannot resume - session not found: ${sessionId}`);
    }

    const session = this.loadSessionFromDisk(sessionId);

    // Validate session integrity
    if (!session.batches || session.batches.length === 0) {
      throw new Error(`Session ${sessionId} corrupted - no batches found`);
    }

    if (session.status === 'complete') {
      this.log(`Session ${sessionId} already complete`);
      return {
        sessionId: session.sessionId,
        status: 'complete',
        batch: [],
        currentPhase: session.config.phases[session.currentPhaseIndex - 1] || session.config.phases[0],
        completedAgents: session.completedAgents.length,
        totalAgents: session.batches.flat(2).length,
      };
    }

    if (session.status === 'failed') {
      throw new Error(`Session ${sessionId} failed - cannot resume`);
    }

    this.log(`Resuming session ${sessionId} at phase ${session.currentPhaseIndex}, batch ${session.currentBatchIndex}`);

    // Return current batch
    return this.getBatchPrompts(session);
  }

  /**
   * List all sessions on disk
   * Useful for recovery and debugging
   */
  listSessions(): Array<{ sessionId: string; status: string; createdAt: number }> {
    if (!existsSync(SESSION_DIR)) {
      return [];
    }

    const files = readdirSync(SESSION_DIR);
    const sessions: Array<{ sessionId: string; status: string; createdAt: number }> = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const session = this.loadSessionFromDisk(file.replace('.json', ''));
          sessions.push({
            sessionId: session.sessionId,
            status: session.status,
            createdAt: session.createdAt,
          });
        } catch (error) {
          // Skip corrupted files
          this.log(`Skipping corrupted session file: ${file}`);
        }
      }
    }

    return sessions;
  }

  /**
   * Initialize a stateful pipeline session
   * Returns the first batch of agents with contextualized prompts
   *
   * @param sessionId - Unique session identifier
   * @param pipelineConfig - Pipeline configuration
   * @returns First batch of agents to execute
   */
  async initSession(
    sessionId: string,
    pipelineConfig: IPipelineExecutionConfig
  ): Promise<ISessionBatchResponse> {
    const startTime = Date.now();
    const pipelineId = `pipeline-${startTime}`;

    // Initialize trajectory for learning
    let trajectoryId = `traj_${startTime}_${Math.random().toString(36).slice(2, 10)}`;

    if (this.dependencies.embeddingProvider && this.dependencies.reasoningBank && pipelineConfig.taskText) {
      try {
        const embedding = await this.dependencies.embeddingProvider.embed(pipelineConfig.taskText);
        const response = await this.dependencies.reasoningBank.reason({
          query: embedding,
          type: ReasoningMode.PATTERN_MATCH,
          applyLearning: true,
          enhanceWithGNN: false,
          maxResults: 5,
          confidenceThreshold: 0.5,
          metadata: {
            source: 'coding-pipeline-cli',
            pipelineId,
            queryText: pipelineConfig.taskText,
          },
        });
        trajectoryId = response.trajectoryId;
        this.log(`Embedding-backed trajectory created: ${trajectoryId}`);
      } catch (error) {
        this.log(`Warning: Embedding trajectory failed: ${error}`);
      }
    }

    // Create session
    const session: IPipelineSession = {
      sessionId,
      pipelineId,
      trajectoryId,
      config: pipelineConfig,
      currentPhaseIndex: 0,
      currentBatchIndex: 0,
      completedAgents: [],
      status: 'running',
      createdAt: startTime,
      batches: await this.computeAllBatches(pipelineConfig),
    };

    // Save session to disk (CRITICAL: Persistence for massive context)
    this.saveSessionToDisk(session);

    // Store pipeline state in memory
    storeMemoryFn(this.memoryCoordinator, this.config.memoryNamespace, 'pipeline/state', {
      status: 'running',
      startTime: new Date().toISOString(),
      phases: pipelineConfig.phases,
      currentPhase: 0,
      pipelineId,
      sessionId,
    }, this.log.bind(this));

    // Get first batch
    return this.getBatchPrompts(session);
  }

  /**
   * Get next batch of agents with contextualized prompts
   * Loads session from disk (supports resumption after restart)
   *
   * @param sessionId - Session identifier
   * @returns Batch of agents to execute, or completion status
   */
  async getNextBatch(sessionId: string): Promise<ISessionBatchResponse> {
    // Load session from disk (CRITICAL: Enables resumption after restart)
    const session = this.loadSessionFromDisk(sessionId);

    return this.getBatchPrompts(session);
  }

  /**
   * Mark batch as complete and provide learning feedback
   * Loads session from disk, updates it, and saves back (checkpoint)
   *
   * @param sessionId - Session identifier
   * @param results - Execution results from batch
   */
  async markBatchComplete(
    sessionId: string,
    results: IBatchExecutionResult[]
  ): Promise<void> {
    // Load session from disk (CRITICAL: Supports resumption)
    const session = this.loadSessionFromDisk(sessionId);

    // Idempotent guard: if the batch pointer already advanced past the last
    // dispatched position, a previous (killed) call already did the advance.
    // Don't advance again — just return so getNextBatch returns the correct batch.
    if (session.lastDispatchedBatch) {
      const dispatched = session.lastDispatchedBatch;
      const atPhase = session.currentPhaseIndex;
      const atBatch = session.currentBatchIndex;
      if (atPhase > dispatched.phaseIndex ||
          (atPhase === dispatched.phaseIndex && atBatch > dispatched.batchIndex)) {
        this.log(`Idempotent skip: batch already advanced past dispatched (phase=${dispatched.phaseIndex},batch=${dispatched.batchIndex}) → current (phase=${atPhase},batch=${atBatch})`);
        return;
      }
    }

    // Store results and provide feedback
    for (const result of results) {
      const agentKey = result.agentKey as CodingPipelineAgent;

      // Skip if agent already completed (defense-in-depth against double-completion)
      if (session.completedAgents.includes(agentKey)) {
        this.log(`Idempotent skip: ${agentKey} already in completedAgents`);
        continue;
      }

      // Store in execution state
      this.executionState.executionResults.set(agentKey, {
        agentKey,
        success: result.success,
        output: result.output,
        xpEarned: Math.floor(result.quality * 100),
        memoryWrites: result.memoryWrites || [],
        executionTimeMs: result.duration,
      });

      // Mark as completed
      session.completedAgents.push(agentKey);

      // Provide learning feedback
      if (this.config.enableLearning && this.dependencies.sonaEngine) {
        const currentPhase = session.config.phases[session.currentPhaseIndex];
        const agentTrajectoryId = `${session.trajectoryId}-${agentKey}`;

        try {
          // Create agent trajectory
          this.dependencies.sonaEngine.createTrajectoryWithId(
            agentTrajectoryId,
            'reasoning.pattern',
            [],
            [`agent:${agentKey}`, `phase:${currentPhase}`, `pipeline:${session.pipelineId}`]
          );

          // Provide feedback
          await provideStepFeedbackFn(
            { sonaEngine: this.dependencies.sonaEngine, reasoningBank: this.dependencies.reasoningBank },
            agentTrajectoryId,
            result.quality,
            agentKey,
            currentPhase,
            undefined,
            this.log.bind(this)
          );
        } catch (error) {
          this.log(`Warning: Feedback provision failed for ${agentKey}: ${error}`);
        }
      }
    }

    // Advance to next batch
    session.currentBatchIndex++;

    // Check if phase complete
    const currentPhaseBatches = session.batches[session.currentPhaseIndex];
    if (session.currentBatchIndex >= currentPhaseBatches.length) {
      // Move to next phase
      session.currentPhaseIndex++;
      session.currentBatchIndex = 0;

      // Check if pipeline complete
      if (session.currentPhaseIndex >= session.config.phases.length) {
        session.status = 'complete';
        this.log(`Pipeline session ${sessionId} complete`);
      }
    }

    // Save updated session to disk (CRITICAL: Checkpoint for resumption)
    this.saveSessionToDisk(session);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS FOR STATEFUL CLI
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Compute all batches for all phases upfront
   */
  private async computeAllBatches(config: IPipelineExecutionConfig): Promise<IAgentMapping[][][]> {
    const allBatches: IAgentMapping[][][] = [];

    for (const phase of config.phases) {
      const agents = await this.getAgentsForPhaseFromLoader(phase);
      const phaseBatches = batchAgentsForExecutionFn(agents, {
        enableParallelExecution: this.config.enableParallelExecution,
        maxParallelAgents: this.config.maxParallelAgents,
      });
      allBatches.push(phaseBatches);
    }

    return allBatches;
  }

  /**
   * Get batch prompts with full RLM/LEANN context injection
   */
  private async getBatchPrompts(session: IPipelineSession): Promise<ISessionBatchResponse> {
    if (session.status === 'complete') {
      return {
        sessionId: session.sessionId,
        status: 'complete',
        batch: [],
        currentPhase: session.config.phases[session.currentPhaseIndex - 1],
        completedAgents: session.completedAgents.length,
        totalAgents: session.batches.flat(2).length,
      };
    }

    const currentPhase = session.config.phases[session.currentPhaseIndex];
    const phaseBatches = session.batches[session.currentPhaseIndex];
    const batch = phaseBatches[session.currentBatchIndex];

    // Track which batch was dispatched (for idempotent complete guard)
    session.lastDispatchedBatch = {
      phaseIndex: session.currentPhaseIndex,
      batchIndex: session.currentBatchIndex,
    };
    this.saveSessionToDisk(session);

    // Build contextualized prompts for each agent in batch
    const batchWithPrompts: IAgentBatchItem[] = await Promise.all(
      batch.map(async (agentMapping) => {
        const agentKey = agentMapping.agentKey as string;

        // 1. Retrieve RLM context from memory
        const memoryReads = agentMapping.memoryReads || [];
        const memoryContext = retrieveMemoryContextFn(
          this.memoryCoordinator,
          this.config.memoryNamespace,
          memoryReads
        );

        // 2. Retrieve LEANN semantic context
        let semanticContext: ISemanticContext = { codeContext: [], totalResults: 0, searchQuery: '' };
        if (this.dependencies.leannContextService) {
          try {
            const agentMd = await this.getAgentMarkdownFromLoader(agentKey);
            semanticContext = await this.dependencies.leannContextService.buildSemanticContext({
              taskDescription: agentMd || `Execute ${agentKey}`,
              phase: PHASE_ORDER.indexOf(currentPhase),
              previousOutput: memoryContext,
              maxResults: 5,
            });
          } catch (error) {
            this.log(`LEANN context retrieval failed for ${agentKey}: ${error}`);
          }
        }

        // 3. Load agent markdown
        const agentMd = await this.getAgentMarkdownFromLoader(agentKey);

        // 4. Build prompt with full context
        const algorithm = agentMapping.algorithm || 'ReAct';
        const memoryWrites = agentMapping.memoryWrites || [];

        const promptContext: IPromptContext = {
          step: {
            agentKey,
            task: agentMd || `Execute ${agentKey} agent with ${algorithm} algorithm`,
            inputDomain: memoryReads[0] || '',
            inputTags: [],
            outputDomain: memoryWrites[0] || `coding/${currentPhase}/${agentKey}`,
            outputTags: [agentKey, currentPhase, algorithm],
          },
          stepIndex: agentMapping.priority,
          pipeline: {
            name: 'coding-pipeline',
            description: `48-agent coding pipeline - Phase: ${currentPhase}`,
            agents: [],
            sequential: true,
          },
          pipelineId: session.pipelineId,
          previousOutput: memoryContext,
          semanticContext,
        };

        const builtPrompt = this.promptBuilder.buildPrompt(promptContext);

        return {
          key: agentKey,
          prompt: builtPrompt.prompt,
          type: this.mapAgentToType(agentKey),
          memoryWrites,
        };
      })
    );

    return {
      sessionId: session.sessionId,
      status: 'running',
      batch: batchWithPrompts,
      currentPhase,
      completedAgents: session.completedAgents.length,
      totalAgents: session.batches.flat(2).length,
    };
  }

  /**
   * Map agent key to Claude Code Task tool subagent_type
   *
   * Agent keys (task-analyzer, requirement-extractor, etc.) are registered
   * directly as subagent_types in Claude Code's Task tool. Return the key as-is.
   */
  private mapAgentToType(agentKey: string): string {
    return agentKey;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new CodingPipelineOrchestrator instance with dependency injection.
 *
 * @param dependencies - Required services for LEANN/RLM/Learning integration
 * @param config - Optional orchestrator configuration
 */
export function createOrchestrator(
  dependencies: IOrchestratorDependencies,
  config?: Partial<IOrchestratorConfig>
): CodingPipelineOrchestrator {
  return new CodingPipelineOrchestrator(dependencies, config);
}

/**
 * Execute a coding pipeline with dependency injection.
 *
 * @param pipelineConfig - Pipeline configuration from prepareCodeTask()
 * @param dependencies - Required services for LEANN/RLM/Learning integration
 * @param orchestratorConfig - Optional orchestrator configuration
 */
export async function executePipeline(
  pipelineConfig: IPipelineExecutionConfig,
  dependencies: IOrchestratorDependencies,
  orchestratorConfig?: Partial<IOrchestratorConfig>
): Promise<IPipelineExecutionResult> {
  const orchestrator = createOrchestrator(dependencies, orchestratorConfig);
  return orchestrator.execute(pipelineConfig);
}

// ═══════════════════════════════════════════════════════════════════════════
// RE-EXPORTS FOR BACKWARD COMPATIBILITY [REQ-REFACTOR-004]
// ═══════════════════════════════════════════════════════════════════════════

// Re-export types and constants so existing imports from this file continue to work
export type { IStepExecutor, IOrchestratorDependencies, IOrchestratorConfig };
export { DEFAULT_ORCHESTRATOR_CONFIG };
