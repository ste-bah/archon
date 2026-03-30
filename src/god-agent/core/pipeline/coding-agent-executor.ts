/**
 * Coding Pipeline Agent Executor
 * Extracted from coding-pipeline-orchestrator.ts for constitution.xml compliance
 *
 * Handles:
 * - Individual agent execution with LEANN/RLM integration
 * - Phase execution with batching and dependency ordering
 * - Memory coordination and observability
 *
 * ONLY for /god-code coding pipeline - NOT for PhD pipeline.
 *
 * @module src/god-agent/core/pipeline/coding-agent-executor
 * @see TASK-ORCH-004-pipeline-orchestration.md
 */

import { join } from 'path';
import { existsSync, readFileSync } from 'fs';

import type { SonaEngine } from '../learning/sona-engine.js';
import type { ReasoningBank } from '../reasoning/reasoning-bank.js';
import type { IRlmContext } from '../learning/sona-types.js';
import type { LeannContextService, ISemanticContext } from './leann-context-service.js';
import type { PatternMatcher } from '../reasoning/pattern-matcher.js';
import type { PipelineMemoryCoordinator } from './pipeline-memory-coordinator.js';
import type { PipelinePromptBuilder, IPromptContext, IReflexionContext, IPatternContext } from './pipeline-prompt-builder.js';
import { PipelineProgressStore, type IAgentOutputSummary } from './pipeline-progress-store.js';
import type { PipelineFileClaims } from './pipeline-file-claims.js';
import type { SituationalAwarenessBuilder } from './pipeline-situational-awareness.js';

import { ObservabilityBus } from '../observability/bus.js';

import type {
  CodingPipelinePhase,
  CodingPipelineAgent,
  IAgentMapping,
  IAgentExecutionResult,
  IPhaseExecutionResult,
  IPipelineExecutionConfig,
} from './types.js';

import { PHASE_ORDER, CHECKPOINT_PHASES, CRITICAL_AGENTS } from './types.js';

// Extracted helper functions
import {
  trimExecutionResults as trimExecutionResultsFn,
  executeWithStepExecutor as executeWithStepExecutorFn,
  resolveExecutionOrder as resolveExecutionOrderFn,
  batchAgentsForExecution as batchAgentsForExecutionFn,
  provideStepFeedback as provideStepFeedbackFn,
  type IStepExecutor,
  type IExecutionOrderConfig,
} from './coding-phase-executor.js';

import {
  storeMemory as storeMemoryFn,
  retrieveMemoryContext as retrieveMemoryContextFn,
} from './coding-memory-adapter.js';

// Sherlock integration
import type { IIntegratedValidationResult } from './sherlock-quality-gate-integration.js';

// =============================================================================
// DEPENDENCY INTERFACES
// =============================================================================

/**
 * Dependencies required for agent execution
 */
export interface IAgentExecutorDependencies {
  /** SonaEngine for learning feedback */
  sonaEngine?: SonaEngine;
  /** ReasoningBank for pattern storage */
  reasoningBank?: ReasoningBank;
  /** LEANN context service for semantic search */
  leannContextService?: LeannContextService;
  /** Pipeline memory coordinator */
  memoryCoordinator: PipelineMemoryCoordinator;
  /** Prompt builder for agent prompts */
  promptBuilder: PipelinePromptBuilder;
  /** Step executor for agent execution */
  stepExecutor?: IStepExecutor;
  /** Progress store for parallel agent awareness */
  progressStore?: PipelineProgressStore;
  /** File claims for parallel agent coordination */
  fileClaims?: PipelineFileClaims;
  /** Situational awareness builder for prompt injection */
  awarenessBuilder?: SituationalAwarenessBuilder;
  /** PatternMatcher for reusable pattern retrieval (PRD: LEANN Pattern Store) */
  patternMatcher?: PatternMatcher;
}

/**
 * Configuration for agent executor
 */
export interface IAgentExecutorConfig {
  /** Agent timeout in milliseconds */
  agentTimeoutMs: number;
  /** Memory namespace */
  memoryNamespace: string;
  /** Path to agent markdown files */
  agentMdPath: string;
  /** Enable learning feedback */
  enableLearning: boolean;
  /** Verbose logging */
  verbose: boolean;
  /** Enable parallel execution */
  enableParallelExecution: boolean;
  /** Maximum parallel agents */
  maxParallelAgents: number;
  /** Enable checkpoints */
  enableCheckpoints: boolean;
}

/**
 * State tracked during execution
 */
export interface IExecutionState {
  /** Results of executed agents */
  executionResults: Map<CodingPipelineAgent, IAgentExecutionResult>;
  /** Checkpoints for rollback */
  checkpoints: Map<CodingPipelinePhase, ICheckpointData>;
  /** Total XP earned */
  totalXP: number;
}

/**
 * Checkpoint data structure
 */
export interface ICheckpointData {
  phase: CodingPipelinePhase;
  timestamp: string;
  memorySnapshot: Record<string, unknown>;
  completedAgents: CodingPipelineAgent[];
  totalXP: number;
}

/**
 * Sherlock validator interface
 */
export interface ISherlockValidatorAdapter {
  validatePhase(
    phase: CodingPipelinePhase,
    phaseResult: IPhaseExecutionResult,
    retryCount: number
  ): Promise<IIntegratedValidationResult | null>;

  handleGuiltyVerdict(
    validationResult: IIntegratedValidationResult,
    phase: CodingPipelinePhase
  ): string[];
}

// =============================================================================
// AGENT EXECUTION
// =============================================================================

/**
 * Execute a single agent with LEANN semantic context and RLM memory handoffs.
 * Follows PipelineExecutor pattern for proper learning infrastructure integration.
 *
 * @param deps - Agent executor dependencies
 * @param config - Agent executor configuration
 * @param agentMapping - Agent mapping to execute
 * @param phase - Pipeline phase
 * @param pipelineId - Pipeline instance ID
 * @param state - Execution state (mutated)
 * @param log - Logging function
 * @returns Agent execution result
 */
export async function executeAgent(
  deps: IAgentExecutorDependencies,
  config: IAgentExecutorConfig,
  agentMapping: IAgentMapping,
  phase: CodingPipelinePhase,
  pipelineId: string,
  state: IExecutionState,
  log: (message: string) => void
): Promise<IAgentExecutionResult> {
  const startTime = Date.now();
  const { agentKey, algorithm, memoryReads, memoryWrites, xpReward, description } = agentMapping;
  const trajectoryId = `trajectory_coding_${pipelineId}_${agentKey}`;

  log(`Executing agent: ${agentKey} (algorithm: ${algorithm})`);

  // Emit step started event to ObservabilityBus
  ObservabilityBus.getInstance().emit({
    component: 'pipeline',
    operation: 'agent_started',
    status: 'running',
    metadata: {
      pipelineId,
      agentKey,
      algorithm,
      phase,
    },
  });

  // Mark agent as active in progress store (for parallel awareness)
  deps.progressStore?.markActive(agentMapping.agentKey);

  try {
    // 1. Retrieve memory context for this agent
    const memoryContext = retrieveMemoryContextFn(
      deps.memoryCoordinator,
      config.memoryNamespace,
      memoryReads
    );

    // 2. Get semantic context from LEANN if available
    let semanticContext: ISemanticContext | undefined;
    if (deps.leannContextService) {
      try {
        semanticContext = await deps.leannContextService.buildSemanticContext({
          taskDescription: description || agentKey,
          phase: PHASE_ORDER.indexOf(phase),
          previousOutput: memoryContext,
          maxResults: 5,
        });

        if (semanticContext.totalResults > 0 && config.verbose) {
          log(
            `Agent ${agentKey}: Found ${semanticContext.totalResults} ` +
            `relevant code contexts via LEANN`
          );
        }
      } catch (error) {
        log(
          `Agent ${agentKey}: LEANN context search failed: ` +
          `${(error as Error).message}`
        );
      }
    }

    // 3. Reflexion: Retrieve past failure trajectories for self-correction
    let reflexionContext: IReflexionContext | undefined;
    if (config.enableLearning && deps.sonaEngine) {
      try {
        const allTrajectories = deps.sonaEngine.listTrajectories('reasoning.pattern');
        const agentTag = `agent:${agentKey}`;
        const agentTrajectories = allTrajectories.filter(t =>
          t.context?.includes(agentTag) ?? false
        );
        const failures = agentTrajectories.filter(t =>
          (t.quality !== undefined && t.quality < 0.7) || t.context?.includes('failed')
        );

        if (failures.length > 0) {
          const totalExec = agentTrajectories.length;
          const successCount = agentTrajectories.filter(t =>
            t.quality !== undefined && t.quality >= 0.7
          ).length;

          reflexionContext = {
            failures: failures.slice(-5).map(f => ({
              trajectoryId: f.id,
              quality: f.quality ?? 0,
              createdAt: typeof f.createdAt === 'number'
                ? new Date(f.createdAt).toISOString()
                : String(f.createdAt),
              pipelineId: f.context?.find((c: string) => c.startsWith('pipeline:'))?.replace('pipeline:', ''),
            })),
            totalExecutions: totalExec,
            successRate: totalExec > 0 ? successCount / totalExec : 1,
          };

          if (config.verbose) {
            log(
              `Agent ${agentKey}: Reflexion found ${failures.length} past failures ` +
              `out of ${totalExec} executions (${(reflexionContext.successRate * 100).toFixed(0)}% success)`
            );
          }
        }
      } catch (error) {
        log(`Agent ${agentKey}: Reflexion retrieval failed: ${(error as Error).message}`);
      }
    }

    // 3b. PatternStore: Retrieve reusable patterns relevant to this agent's task
    let patternContext: IPatternContext | undefined;
    if (deps.patternMatcher) {
      try {
        // Map pipeline phase to PatternStore TaskType
        const phaseToTaskType: Record<string, string> = {
          understanding: 'analysis',
          exploration: 'analysis',
          architecture: 'planning',
          implementation: 'coding',
          testing: 'testing',
          optimization: 'optimization',
          delivery: 'coding',
        };
        const taskType = phaseToTaskType[phase] ?? 'coding';

        const patterns = deps.patternMatcher.getPatternsByTaskType(taskType as any);
        // Sort by success rate descending, take top 5
        const topPatterns = patterns
          .filter(p => p.successRate >= 0.5)
          .sort((a, b) => b.successRate - a.successRate)
          .slice(0, 5);

        if (topPatterns.length > 0) {
          patternContext = {
            patterns: topPatterns.map(p => ({
              patternId: p.id,
              template: p.template,
              taskType: String(p.taskType),
              confidence: p.successRate,
            })),
          };

          if (config.verbose) {
            log(
              `Agent ${agentKey}: Found ${topPatterns.length} reusable patterns ` +
              `from PatternStore for phase ${phase} (taskType: ${taskType})`
            );
          }
        }
      } catch (error) {
        log(`Agent ${agentKey}: PatternStore retrieval failed: ${(error as Error).message}`);
      }
    }

    // 4. Load agent markdown if exists
    const agentMd = loadAgentMarkdown(agentKey, config.agentMdPath);

    // 5. Build prompt with forward-looking context (RULE-007)
    const promptContext: IPromptContext = {
      step: {
        agentKey: agentKey as string,
        task: agentMd || `Execute ${agentKey} agent with ${algorithm} algorithm`,
        inputDomain: memoryReads[0] || '',
        inputTags: [],
        outputDomain: memoryWrites[0] || `coding/${phase}/${agentKey}`,
        outputTags: [agentKey, phase, algorithm],
      },
      stepIndex: agentMapping.priority,
      pipeline: {
        name: 'coding-pipeline',
        description: `40-agent coding pipeline - Phase: ${phase}`,
        agents: [],
        sequential: true,
      },
      pipelineId,
      previousOutput: memoryContext,
      semanticContext,
      reflexionContext,
      patternContext,
    };

    // Inject situational awareness for parallel agent coordination
    if (deps.awarenessBuilder) {
      promptContext.situationalAwareness = deps.awarenessBuilder.buildAwarenessSection(
        agentMapping.agentKey as string, phase
      );
    }

    const builtPrompt = deps.promptBuilder.buildPrompt(promptContext);

    // 5. Execute with stepExecutor
    const executionResult = await executeWithStepExecutorFn(
      deps.stepExecutor,
      agentKey,
      builtPrompt.prompt,
      config.agentTimeoutMs
    );

    // 6. Store agent outputs to memory
    const storeResult = deps.memoryCoordinator.storeStepOutput(
      promptContext.step,
      agentMapping.priority,
      pipelineId,
      executionResult.output,
      agentKey
    );

    // 7. Construct RLM context for relay-race memory handoff tracking
    const rlmContext: IRlmContext = {
      injectionSuccess: Object.keys(memoryContext).length > 0 ||
                       (semanticContext !== undefined && semanticContext.totalResults > 0),
      sourceAgentKey: undefined,
      sourceStepIndex: undefined,
      sourceDomain: memoryReads[0],
    };

    // 8. Persist agent trajectory so feedback succeeds (PRD Section 5.1)
    if (config.enableLearning && deps.sonaEngine) {
      try {
        deps.sonaEngine.createTrajectoryWithId(
          trajectoryId,
          'reasoning.pattern',
          [],
          [`agent:${agentKey}`, `phase:${phase}`, `pipeline:${pipelineId}`]
        );
      } catch (trajError) {
        log(`Warning: Agent trajectory creation failed for ${agentKey}: ${trajError}`);
      }
    }

    // 9. Provide feedback to SonaEngine if learning enabled
    if (config.enableLearning) {
      await provideStepFeedbackFn(
        { sonaEngine: deps.sonaEngine, reasoningBank: deps.reasoningBank },
        trajectoryId,
        executionResult.quality,
        agentKey,
        phase,
        rlmContext,
        log
      );
    }

    const executionTimeMs = Date.now() - startTime;

    // Emit step completed event to ObservabilityBus
    ObservabilityBus.getInstance().emit({
      component: 'pipeline',
      operation: 'agent_completed',
      status: 'success',
      durationMs: executionTimeMs,
      metadata: {
        pipelineId,
        agentKey,
        quality: executionResult.quality,
        memoryDomain: storeResult.domain,
        memoryTags: storeResult.tags,
      },
    });

    const agentResult: IAgentExecutionResult = {
      agentKey,
      success: true,
      output: executionResult.output,
      xpEarned: xpReward,
      memoryWrites,
      executionTimeMs,
    };

    // Update progress store and release file claims (parallel awareness)
    let outputSummary: IAgentOutputSummary | undefined;
    if (deps.progressStore) {
      const outputStr = typeof executionResult.output === 'string'
        ? executionResult.output
        : JSON.stringify(executionResult.output ?? '');
      outputSummary = PipelineProgressStore.extractOutputSummary(outputStr);
      deps.progressStore.markCompleted(agentMapping.agentKey, outputSummary);
    }
    deps.fileClaims?.releaseAll(agentMapping.agentKey);

    // Index generated/modified code into LEANN for semantic search
    if (deps.leannContextService && outputSummary) {
      const allFiles = [...outputSummary.filesCreated, ...outputSummary.filesModified];
      if (allFiles.length > 0) {
        await indexFilesIntoLeann(deps.leannContextService, allFiles, agentMapping.agentKey as string, log);
      }
    }

    state.executionResults.set(agentKey, agentResult);
    trimExecutionResultsFn(state.executionResults, log);
    return agentResult;
  } catch (error) {
    const executionTimeMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    log(`Agent ${agentKey} failed: ${errorMessage}`);

    // Emit error event to ObservabilityBus
    ObservabilityBus.getInstance().emit({
      component: 'pipeline',
      operation: 'agent_completed',
      status: 'error',
      durationMs: executionTimeMs,
      metadata: {
        pipelineId,
        agentKey,
        error: errorMessage,
      },
    });

    // Persist failure trajectory so feedback succeeds (PRD Section 5.1)
    const failTrajectoryId = `trajectory_coding_${pipelineId}_${agentKey}`;
    if (config.enableLearning && deps.sonaEngine) {
      try {
        deps.sonaEngine.createTrajectoryWithId(
          failTrajectoryId,
          'reasoning.pattern',
          [],
          [`agent:${agentKey}`, `phase:${phase}`, `pipeline:${pipelineId}`, 'failed']
        );
      } catch (trajError) {
        log(`Warning: Failed agent trajectory creation failed for ${agentKey}: ${trajError}`);
      }
    }

    // Provide failure feedback if learning enabled
    if (config.enableLearning) {
      await provideStepFeedbackFn(
        { sonaEngine: deps.sonaEngine, reasoningBank: deps.reasoningBank },
        failTrajectoryId,
        0,
        agentKey,
        phase,
        undefined,
        log
      );
    }

    // Update progress store and release file claims on failure (parallel awareness)
    deps.progressStore?.markFailed(agentMapping.agentKey, errorMessage);
    deps.fileClaims?.releaseAll(agentMapping.agentKey);

    const agentResult: IAgentExecutionResult = {
      agentKey,
      success: false,
      output: null,
      xpEarned: 0,
      memoryWrites: [],
      executionTimeMs,
      error: errorMessage,
    };

    state.executionResults.set(agentKey, agentResult);
    trimExecutionResultsFn(state.executionResults, log);
    return agentResult;
  }
}

// =============================================================================
// PHASE EXECUTION
// =============================================================================

/**
 * Execute a single phase of the pipeline.
 *
 * @param deps - Agent executor dependencies
 * @param config - Agent executor configuration
 * @param phase - Phase to execute
 * @param pipelineConfig - Pipeline configuration
 * @param pipelineId - Pipeline instance ID
 * @param state - Execution state (mutated)
 * @param getAgentsForPhase - Function to get agents for a phase
 * @param sherlockValidator - Optional Sherlock validator adapter
 * @param log - Logging function
 * @returns Phase execution result
 */
export async function executePhase(
  deps: IAgentExecutorDependencies,
  config: IAgentExecutorConfig,
  phase: CodingPipelinePhase,
  pipelineConfig: IPipelineExecutionConfig,
  pipelineId: string,
  state: IExecutionState,
  getAgentsForPhase: (phase: CodingPipelinePhase) => Promise<IAgentMapping[]>,
  sherlockValidator: ISherlockValidatorAdapter | null,
  log: (message: string) => void
): Promise<IPhaseExecutionResult> {
  const startTime = Date.now();
  const agentResults: IAgentExecutionResult[] = [];
  let phaseXP = 0;
  let checkpointCreated = false;

  // Get agents for this phase
  let phaseAgents = pipelineConfig.agentsByPhase.get(phase);

  // Fallback to dynamic loader if not in config
  if (!phaseAgents || phaseAgents.length === 0) {
    phaseAgents = await getAgentsForPhase(phase);
  }

  // Resolve execution order within phase (respecting dependencies)
  const executionOrder = resolveExecutionOrderFn(phaseAgents);

  log(`Phase ${phase}: ${executionOrder.length} agents to execute`);

  // Create checkpoint before phase if configured
  if (config.enableCheckpoints && CHECKPOINT_PHASES.includes(phase)) {
    createCheckpoint(deps.memoryCoordinator, config.memoryNamespace, phase, state, log);
    checkpointCreated = true;
  }

  // Register all agents in progress store for awareness tracking
  for (const agent of executionOrder) {
    deps.progressStore?.registerAgent(agent.agentKey, phase);
  }

  // Execute agents in batches (parallelizable agents can run together)
  const batches = batchAgentsForExecutionFn(executionOrder, {
    enableParallelExecution: config.enableParallelExecution,
    maxParallelAgents: config.maxParallelAgents,
  });

  for (const batch of batches) {
    const batchResults = await Promise.all(
      batch.map(agent => executeAgent(deps, config, agent, phase, pipelineId, state, log))
    );

    for (const result of batchResults) {
      agentResults.push(result);

      if (result.success) {
        phaseXP += result.xpEarned;
      } else if (isCriticalAgent(result.agentKey)) {
        // Critical agent failed - halt phase
        log(`Critical agent ${result.agentKey} failed, halting phase`);
        return {
          phase,
          success: false,
          agentResults,
          totalXP: phaseXP,
          checkpointCreated,
          executionTimeMs: Date.now() - startTime,
        };
      }
    }
  }

  // Build preliminary result for Sherlock validation
  const preliminaryResult: IPhaseExecutionResult = {
    phase,
    success: true,
    agentResults,
    totalXP: phaseXP,
    checkpointCreated,
    executionTimeMs: Date.now() - startTime,
  };

  // Sherlock-Quality Gate validation if available
  if (sherlockValidator) {
    const validationResult = await sherlockValidator.validatePhase(
      phase,
      preliminaryResult,
      0 // retryCount
    );

    if (validationResult) {
      if (!validationResult.canProceed) {
        // GUILTY verdict - phase failed validation
        const remediations = sherlockValidator.handleGuiltyVerdict(validationResult, phase);
        log(
          `Phase ${phase} FAILED Sherlock validation. ` +
          `Verdict: ${validationResult.sherlockResult?.verdict ?? 'REJECTED'}. ` +
          `Remediations: ${remediations.length}`
        );

        return {
          phase,
          success: false,
          agentResults,
          totalXP: phaseXP,
          checkpointCreated,
          executionTimeMs: Date.now() - startTime,
          validationResult: {
            verdict: validationResult.sherlockResult?.verdict,
            gateResult: validationResult.gateResult.result,
            remediations,
          },
        } as IPhaseExecutionResult;
      }

      // INNOCENT verdict - phase passed validation
      log(
        `Phase ${phase} PASSED Sherlock validation. ` +
        `Verdict: ${validationResult.sherlockResult?.verdict ?? 'PASSED'}. ` +
        `Investigation tier: ${validationResult.investigationTier ?? 'N/A'}`
      );
    }
  }

  return {
    phase,
    success: true,
    agentResults,
    totalXP: phaseXP,
    checkpointCreated,
    executionTimeMs: Date.now() - startTime,
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Load agent markdown file if it exists
 */
export function loadAgentMarkdown(
  agentKey: CodingPipelineAgent,
  agentMdPath: string
): string {
  const mdPath = join(process.cwd(), agentMdPath, `${agentKey}.md`);

  if (existsSync(mdPath)) {
    try {
      return readFileSync(mdPath, 'utf-8');
    } catch {
      return '';
    }
  }

  return '';
}

/**
 * Check if agent is critical (halts pipeline on failure)
 */
export function isCriticalAgent(agentKey: CodingPipelineAgent): boolean {
  return CRITICAL_AGENTS.includes(agentKey);
}

/**
 * Create a checkpoint at the current phase
 */
export function createCheckpoint(
  memoryCoordinator: PipelineMemoryCoordinator,
  memoryNamespace: string,
  phase: CodingPipelinePhase,
  state: IExecutionState,
  log: (message: string) => void
): void {
  log(`Creating checkpoint for phase: ${phase}`);

  // Retrieve current memory state
  const memorySnapshot = retrieveMemoryContextFn(memoryCoordinator, memoryNamespace, [
    `${memoryNamespace}/*`,
  ]);

  const checkpoint: ICheckpointData = {
    phase,
    timestamp: new Date().toISOString(),
    memorySnapshot,
    completedAgents: Array.from(state.executionResults.keys()),
    totalXP: state.totalXP,
  };

  state.checkpoints.set(phase, checkpoint);

  // Store checkpoint in memory
  storeMemoryFn(memoryCoordinator, memoryNamespace, `pipeline/checkpoints/${phase}`, checkpoint, log);
}

/**
 * Index generated/modified files into LEANN for semantic search.
 * Reads files from disk and adds them to the LEANN vector index.
 *
 * @param leannService - LEANN context service
 * @param filePaths - Array of file paths to index
 * @param agentKey - Agent key that generated the files
 * @param log - Logging function
 */
async function indexFilesIntoLeann(
  leannService: LeannContextService,
  filePaths: string[],
  agentKey: string,
  log: (msg: string) => void
): Promise<void> {
  const adapter = leannService.getAdapter();
  if (!adapter) {
    log('LEANN indexing skipped: adapter not initialized');
    return;
  }

  let indexedCount = 0;
  for (const filePath of filePaths) {
    try {
      // Check if file exists
      if (!existsSync(filePath)) {
        log(`LEANN indexing skipped: file not found: ${filePath}`);
        continue;
      }

      // Read file content
      const code = readFileSync(filePath, 'utf-8');

      // Skip empty files
      if (code.trim().length === 0) {
        continue;
      }

      // Index into LEANN with metadata
      await adapter.index(code, {
        filePath,
        source: agentKey,
        indexed_at: Date.now(),
      });

      indexedCount++;
    } catch (error) {
      log(`LEANN indexing failed for ${filePath}: ${(error as Error).message}`);
    }
  }

  if (indexedCount > 0) {
    log(`LEANN indexed ${indexedCount} files from ${agentKey}`);

    // Save updated LEANN index to persistent storage
    try {
      await leannService.save('vector_db_leann');
      log('LEANN index saved successfully');
    } catch (error) {
      log(`LEANN save failed: ${(error as Error).message}`);
    }
  }
}

/**
 * Rollback to the last successful checkpoint
 */
export function rollbackToLastCheckpoint(
  memoryCoordinator: PipelineMemoryCoordinator,
  memoryNamespace: string,
  state: IExecutionState,
  log: (message: string) => void
): boolean {
  if (state.checkpoints.size === 0) {
    log('No checkpoints available for rollback');
    return false;
  }

  // Get the most recent checkpoint
  const phases = Array.from(state.checkpoints.keys());
  const lastPhase = phases[phases.length - 1];
  const checkpoint = state.checkpoints.get(lastPhase);

  if (!checkpoint) {
    return false;
  }

  log(`Rolling back to checkpoint: ${lastPhase}`);

  // Restore memory state
  for (const [key, value] of Object.entries(checkpoint.memorySnapshot)) {
    storeMemoryFn(memoryCoordinator, memoryNamespace, key, value, log);
  }

  // Restore XP
  state.totalXP = checkpoint.totalXP;

  // Clear execution results after checkpoint
  const checkpointAgents = new Set(checkpoint.completedAgents);
  for (const agentKey of state.executionResults.keys()) {
    if (!checkpointAgents.has(agentKey)) {
      state.executionResults.delete(agentKey);
    }
  }

  return true;
}
