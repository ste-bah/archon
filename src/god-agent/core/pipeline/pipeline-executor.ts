/**
 * DAI-002: Pipeline Executor
 * TASK-005: Core execution engine for multi-agent sequential pipelines
 *
 * RULE-004: Sequential Execution (99.9% Rule)
 * - Agents execute ONE AT A TIME
 * - NEVER use Promise.all() for agent execution
 * - Each step completes before next begins
 *
 * RULE-005: Mandatory Memory Coordination
 * - Every agent coordinates through InteractionStore
 * - Outputs stored BEFORE next agent starts
 *
 * RULE-006: DAI-001 Integration
 * - Use AgentSelector when taskDescription provided instead of agentKey
 *
 * RULE-007: Forward-Looking Prompts
 * - Each agent knows its position, previous, and next in pipeline
 */

import type { AgentRegistry } from '../agents/agent-registry.js';
import type { AgentSelector, IAgentSelectionResult } from '../agents/agent-selector.js';
import type { InteractionStore } from '../../universal/interaction-store.js';
import type { ReasoningBank } from '../reasoning/reasoning-bank.js';
import type { SonaEngine } from '../learning/sona-engine.js';
import type { IRlmContext } from '../learning/sona-types.js';
import type {
  IPipelineDefinition,
  IPipelineStep,
  IPipelineOptions,
  IPipelineResult,
  IStepResult,
  IPipelineEvent,
  PipelineEventHandler,
} from './dai-002-types.js';
import {
  PipelineEventType,
  DEFAULT_STEP_TIMEOUT,
  DEFAULT_PIPELINE_TIMEOUT,
  DEFAULT_MIN_QUALITY,
  generatePipelineId,
  generatePipelineTrajectoryId,
  generateStepTrajectoryId,
  calculateOverallQuality,
} from './dai-002-types.js';
import { PipelineValidator } from './pipeline-validator.js';
import { PipelinePromptBuilder, IPromptContext } from './pipeline-prompt-builder.js';
import { PipelineMemoryCoordinator } from './pipeline-memory-coordinator.js';
import type { LeannContextService, ISemanticContext } from './leann-context-service.js';
import {
  PipelineExecutionError,
  PipelineTimeoutError,
  QualityGateError,
  AgentSelectionError,
} from './pipeline-errors.js';
import { ObservabilityBus } from '../observability/bus.js';

// ==================== Executor Configuration ====================

/**
 * Configuration for PipelineExecutor
 */
export interface IPipelineExecutorConfig {
  /** Enable verbose logging */
  verbose?: boolean;
  /** Event handler for pipeline lifecycle events */
  onEvent?: PipelineEventHandler;
  /** Whether to provide feedback to ReasoningBank after steps */
  enableLearning?: boolean;
  /** Custom step executor function (for testing or custom execution) */
  stepExecutor?: IStepExecutor;
}

/**
 * Interface for step execution function.
 * This allows injection of custom execution logic (e.g., for testing).
 */
export interface IStepExecutor {
  execute(agentKey: string, prompt: string, timeout: number): Promise<IStepExecutionResult>;
}

/**
 * Result from step executor
 */
export interface IStepExecutionResult {
  output: unknown;
  quality: number;
  duration: number;
}

// ==================== Pipeline Executor ====================

/**
 * Executes multi-agent sequential pipelines.
 * Implements DAI-002 specification with RULE-004 sequential execution.
 *
 * @example
 * ```typescript
 * const executor = new PipelineExecutor({
 *   agentRegistry,
 *   agentSelector,
 *   interactionStore,
 *   reasoningBank,
 * });
 *
 * const result = await executor.execute(pipeline, {
 *   verbose: true,
 *   input: initialData,
 * });
 * ```
 */
export class PipelineExecutor {
  private readonly validator: PipelineValidator;
  private readonly promptBuilder: PipelinePromptBuilder;
  private readonly memoryCoordinator: PipelineMemoryCoordinator;
  private readonly config: Required<Omit<IPipelineExecutorConfig, 'onEvent' | 'stepExecutor'>> & {
    onEvent?: PipelineEventHandler;
    stepExecutor?: IStepExecutor;
  };

  /**
   * Create a new PipelineExecutor
   *
   * @param dependencies - Required dependencies
   * @param config - Optional configuration
   */
  constructor(
    private readonly dependencies: {
      agentRegistry: AgentRegistry;
      agentSelector: AgentSelector;
      interactionStore: InteractionStore;
      reasoningBank?: ReasoningBank;
      sonaEngine?: SonaEngine;
      leannContextService?: LeannContextService;
    },
    config: IPipelineExecutorConfig = {}
  ) {
    this.validator = new PipelineValidator(dependencies.agentRegistry);
    this.promptBuilder = new PipelinePromptBuilder(dependencies.agentRegistry);
    this.memoryCoordinator = new PipelineMemoryCoordinator(dependencies.interactionStore, {
      verbose: config.verbose,
    });

    this.config = {
      verbose: config.verbose ?? false,
      enableLearning: config.enableLearning ?? true,
      onEvent: config.onEvent,
      stepExecutor: config.stepExecutor,
    };
  }

  /**
   * Execute a pipeline sequentially.
   * CRITICAL: Steps execute ONE AT A TIME (RULE-004).
   *
   * @param pipeline - Pipeline definition to execute
   * @param options - Execution options
   * @returns Pipeline execution result
   * @throws PipelineDefinitionError if pipeline is invalid
   * @throws PipelineExecutionError if execution fails
   * @throws PipelineTimeoutError if timeout exceeded
   * @throws QualityGateError if quality threshold not met
   */
  async execute(
    pipeline: IPipelineDefinition,
    options: IPipelineOptions = {}
  ): Promise<IPipelineResult> {
    // 1. Validate pipeline first (fail fast per RULE-003)
    this.validator.validate(pipeline);

    // 2. Generate IDs for tracking
    const pipelineId = generatePipelineId();
    const trajectoryId = generatePipelineTrajectoryId(pipelineId);
    const startTime = Date.now();

    // 3. Calculate timeouts
    const pipelineTimeout = options.timeout ?? pipeline.defaultTimeout ?? DEFAULT_PIPELINE_TIMEOUT;
    const defaultMinQuality = options.minQuality ?? pipeline.defaultMinQuality ?? DEFAULT_MIN_QUALITY;

    // 4. Initialize result tracking
    const stepResults: IStepResult[] = [];
    let currentError: Error | undefined;

    // 5. Emit pipeline started event
    this.emitEvent({
      type: PipelineEventType.PIPELINE_STARTED,
      pipelineId,
      timestamp: startTime,
      data: {
        pipelineName: pipeline.name,
        stepCount: pipeline.agents.length,
        timeout: pipelineTimeout,
      },
    });

    // Implements [REQ-OBS-09]: Emit pipeline_started to ObservabilityBus
    ObservabilityBus.getInstance().emit({
      component: 'pipeline',
      operation: 'pipeline_started',
      status: 'running',
      metadata: {
        pipelineId,
        pipelineName: pipeline.name,
        stepCount: pipeline.agents.length,
        timeout: pipelineTimeout,
      },
    });

    this.log(`[Pipeline ${pipelineId}] Starting '${pipeline.name}' with ${pipeline.agents.length} steps`);

    try {
      // 6. Execute each step SEQUENTIALLY (RULE-004)
      for (let stepIndex = 0; stepIndex < pipeline.agents.length; stepIndex++) {
        // Check pipeline timeout
        const elapsed = Date.now() - startTime;
        if (elapsed > pipelineTimeout) {
          throw new PipelineTimeoutError({
            pipelineId,
            timeout: pipelineTimeout,
            elapsed,
            scope: 'pipeline',
            partialResults: stepResults,
          });
        }

        const step = pipeline.agents[stepIndex];
        const stepResult = await this.executeStep({
          step,
          stepIndex,
          pipeline,
          pipelineId,
          trajectoryId,
          defaultMinQuality,
          initialInput: stepIndex === 0 ? options.input : undefined,
          remainingTimeout: pipelineTimeout - elapsed,
        });

        stepResults.push(stepResult);
      }

      // 7. Calculate overall quality
      const overallQuality = calculateOverallQuality(stepResults);
      const totalDuration = Date.now() - startTime;

      // 8. Provide feedback if learning enabled
      if (this.config.enableLearning && this.dependencies.reasoningBank) {
        await this.providePipelineFeedback(
          trajectoryId,
          overallQuality,
          'completed',
          pipeline.name
        );
      }

      // 9. Emit pipeline completed event
      this.emitEvent({
        type: PipelineEventType.PIPELINE_COMPLETED,
        pipelineId,
        timestamp: Date.now(),
        data: {
          pipelineName: pipeline.name,
          stepCount: stepResults.length,
          overallQuality,
          totalDuration,
        },
      });

      // Implements [REQ-OBS-12]: Emit pipeline_completed to ObservabilityBus
      ObservabilityBus.getInstance().emit({
        component: 'pipeline',
        operation: 'pipeline_completed',
        status: 'success',
        durationMs: totalDuration,
        metadata: {
          pipelineId,
          pipelineName: pipeline.name,
          stepCount: stepResults.length,
          overallQuality,
        },
      });

      this.log(
        `[Pipeline ${pipelineId}] Completed '${pipeline.name}' in ${totalDuration}ms ` +
        `(quality: ${overallQuality.toFixed(2)})`
      );

      return {
        pipelineId,
        pipelineName: pipeline.name,
        status: 'completed',
        steps: stepResults,
        overallQuality,
        totalDuration,
        trajectoryId,
      };
    } catch (error) {
      currentError = error as Error;

      // Calculate partial results
      const overallQuality = stepResults.length > 0 ? calculateOverallQuality(stepResults) : 0;
      const totalDuration = Date.now() - startTime;

      // Provide failure feedback if learning enabled
      if (this.config.enableLearning && this.dependencies.reasoningBank) {
        await this.providePipelineFeedback(
          trajectoryId,
          overallQuality,
          'failed',
          pipeline.name,
          currentError.message
        );
      }

      // Emit pipeline failed event
      this.emitEvent({
        type: PipelineEventType.PIPELINE_FAILED,
        pipelineId,
        timestamp: Date.now(),
        data: {
          pipelineName: pipeline.name,
          completedSteps: stepResults.length,
          error: currentError.message,
          errorType: currentError.constructor.name,
        },
      });

      // Implements [REQ-OBS-12]: Emit pipeline_completed (error) to ObservabilityBus
      ObservabilityBus.getInstance().emit({
        component: 'pipeline',
        operation: 'pipeline_completed',
        status: 'error',
        durationMs: totalDuration,
        metadata: {
          pipelineId,
          pipelineName: pipeline.name,
          completedSteps: stepResults.length,
          error: currentError.message,
          errorType: currentError.constructor.name,
        },
      });

      this.log(
        `[Pipeline ${pipelineId}] FAILED '${pipeline.name}' after ${totalDuration}ms: ${currentError.message}`
      );

      return {
        pipelineId,
        pipelineName: pipeline.name,
        status: 'failed',
        steps: stepResults,
        overallQuality,
        totalDuration,
        trajectoryId,
        error: currentError,
      };
    }
  }

  /**
   * Execute a single pipeline step.
   * Private method - handles agent selection, execution, memory storage.
   */
  private async executeStep(params: {
    step: IPipelineStep;
    stepIndex: number;
    pipeline: IPipelineDefinition;
    pipelineId: string;
    trajectoryId: string;
    defaultMinQuality: number;
    initialInput?: unknown;
    remainingTimeout: number;
  }): Promise<IStepResult> {
    const {
      step,
      stepIndex,
      pipeline,
      pipelineId,
      trajectoryId,
      defaultMinQuality,
      initialInput,
      remainingTimeout,
    } = params;

    const stepTrajectoryId = generateStepTrajectoryId(trajectoryId, stepIndex);
    const stepStartTime = Date.now();

    // 1. Resolve agent key (explicit or DAI-001 selection)
    let agentKey: string;
    let selectionResult: IAgentSelectionResult | undefined;

    if (step.agentKey) {
      agentKey = step.agentKey;
    } else if (step.taskDescription) {
      // DAI-001 selection (RULE-006)
      try {
        selectionResult = this.dependencies.agentSelector.selectAgent(step.taskDescription);
        agentKey = selectionResult.selected.key;

        this.emitEvent({
          type: PipelineEventType.AGENT_SELECTED,
          pipelineId,
          timestamp: Date.now(),
          data: {
            stepIndex,
            taskDescription: step.taskDescription,
            selectedAgent: agentKey,
            score: selectionResult.candidates[0]?.score ?? 0,
          },
        });

        this.log(
          `[Pipeline ${pipelineId}] Step ${stepIndex}: DAI-001 selected '${agentKey}' ` +
          `for: "${step.taskDescription.substring(0, 50)}..."`
        );
      } catch (error) {
        throw new AgentSelectionError(
          'No suitable agent found for task',
          {
            pipelineId,
            stepIndex,
            taskDescription: step.taskDescription,
            searchedCategories: this.dependencies.agentRegistry.getAll().map(a => a.category),
            cause: error as Error,
          }
        );
      }
    } else {
      // Should never happen if validator ran, but be defensive
      throw new PipelineExecutionError(
        `Step ${stepIndex} has neither agentKey nor taskDescription`,
        {
          pipelineId,
          pipelineName: pipeline.name,
          stepIndex,
          agentKey: 'unknown',
          cause: new Error('Invalid step configuration'),
        }
      );
    }

    // 2. Retrieve previous agent's output for context injection (RULE-005)
    let previousOutput: unknown;
    let previousStepData: { agentKey: string; stepIndex: number; domain: string } | undefined;

    if (stepIndex > 0 && step.inputDomain) {
      const retrieveResult = this.memoryCoordinator.retrievePreviousOutput(
        { ...step, agentKey },
        pipelineId
      );

      if (retrieveResult.output !== undefined && retrieveResult.stepData) {
        previousOutput = retrieveResult.output;
        previousStepData = {
          agentKey: retrieveResult.stepData.agentKey,
          stepIndex: retrieveResult.stepData.stepIndex,
          domain: step.inputDomain,
        };

        // Emit MEMORY_RETRIEVED event for observability
        this.emitEvent({
          type: PipelineEventType.MEMORY_RETRIEVED,
          pipelineId,
          timestamp: Date.now(),
          data: {
            stepIndex,
            agentKey,
            sourceDomain: step.inputDomain,
            sourceAgentKey: previousStepData.agentKey,
            sourceStepIndex: previousStepData.stepIndex,
            hasOutput: true,
          },
        });

        this.log(
          `[Pipeline ${pipelineId}] Step ${stepIndex}: Retrieved output from ` +
          `agent '${previousStepData.agentKey}' (step ${previousStepData.stepIndex})`
        );
      } else {
        // Log warning if retrieval failed but continue with fallback
        this.log(
          `[Pipeline ${pipelineId}] Step ${stepIndex}: Warning - could not retrieve ` +
          `previous output from domain '${step.inputDomain}'. Agent will use fallback retrieval.`
        );
      }
    }

    // 2b. Get semantic context from LEANN if available
    // Use taskDescription (for DAI-001) or task (explicit) for semantic search
    const searchDescription = step.taskDescription || step.task;
    let semanticContext: ISemanticContext | undefined;
    if (this.dependencies.leannContextService && searchDescription) {
      try {
        semanticContext = await this.dependencies.leannContextService.buildSemanticContext({
          taskDescription: searchDescription,
          phase: stepIndex,
          previousOutput,
          maxResults: 5,
        });

        if (semanticContext.totalResults > 0) {
          this.log(
            `[Pipeline ${pipelineId}] Step ${stepIndex}: Found ${semanticContext.totalResults} ` +
            `relevant code contexts via LEANN`
          );
        }
      } catch (error) {
        // Log but don't fail - semantic context is optional enrichment
        this.log(
          `[Pipeline ${pipelineId}] Step ${stepIndex}: LEANN context search failed: ` +
          `${(error as Error).message}`
        );
      }
    }

    // 3. Build prompt with workflow context (RULE-007)
    const promptContext: IPromptContext = {
      step: { ...step, agentKey }, // Ensure agentKey is set
      stepIndex,
      pipeline,
      pipelineId,
      initialInput,
      previousOutput,
      previousStepData,
      semanticContext,
    };

    const builtPrompt = this.promptBuilder.buildPrompt(promptContext);

    this.emitEvent({
      type: PipelineEventType.AGENT_STARTED,
      pipelineId,
      timestamp: Date.now(),
      data: {
        stepIndex,
        agentKey,
        stepNumber: stepIndex + 1,
        totalSteps: pipeline.agents.length,
      },
    });

    // Implements [REQ-OBS-10]: Emit step_started to ObservabilityBus
    ObservabilityBus.getInstance().emit({
      component: 'pipeline',
      operation: 'step_started',
      status: 'running',
      metadata: {
        pipelineId,
        stepIndex,
        agentKey,
        stepNumber: stepIndex + 1,
        totalSteps: pipeline.agents.length,
      },
    });

    this.log(
      `[Pipeline ${pipelineId}] Step ${stepIndex}: Starting '${agentKey}' ` +
      `(${stepIndex + 1}/${pipeline.agents.length})`
    );

    // 3. Calculate step timeout
    const stepTimeout = Math.min(
      step.timeout ?? DEFAULT_STEP_TIMEOUT,
      remainingTimeout
    );

    // 4. Execute with timeout
    let executionResult: IStepExecutionResult;

    try {
      executionResult = await this.executeWithTimeout(
        agentKey,
        builtPrompt.prompt,
        stepTimeout,
        pipelineId,
        stepIndex
      );
    } catch (error) {
      if (error instanceof PipelineTimeoutError) {
        throw error;
      }
      throw new PipelineExecutionError(
        `Step ${stepIndex} (${agentKey}) failed: ${(error as Error).message}`,
        {
          pipelineId,
          pipelineName: pipeline.name,
          stepIndex,
          agentKey,
          cause: error as Error,
        }
      );
    }

    // 5. Store output in memory (RULE-005)
    const storeResult = this.memoryCoordinator.storeStepOutput(
      { ...step, agentKey },
      stepIndex,
      pipelineId,
      executionResult.output,
      agentKey
    );

    this.emitEvent({
      type: PipelineEventType.MEMORY_STORED,
      pipelineId,
      timestamp: Date.now(),
      data: {
        stepIndex,
        agentKey,
        domain: storeResult.domain,
        tags: storeResult.tags,
        entryId: storeResult.entryId,
      },
    });

    // 6. Assess quality
    const quality = this.assessQuality(executionResult.output, executionResult.quality);
    const minQuality = step.minQuality ?? defaultMinQuality;

    this.emitEvent({
      type: PipelineEventType.QUALITY_CHECKED,
      pipelineId,
      timestamp: Date.now(),
      data: {
        stepIndex,
        agentKey,
        quality,
        threshold: minQuality,
        passed: quality >= minQuality,
      },
    });

    // 7. Enforce quality gate
    if (quality < minQuality) {
      throw new QualityGateError({
        pipelineId,
        stepIndex,
        agentKey,
        actualQuality: quality,
        requiredQuality: minQuality,
      });
    }

    // 8. Provide step feedback if learning enabled
    if (this.config.enableLearning && (this.dependencies.sonaEngine || this.dependencies.reasoningBank)) {
      // Construct RLM context for relay-race memory handoff tracking
      const rlmContext: IRlmContext = {
        injectionSuccess: previousOutput !== undefined && previousStepData !== undefined,
        sourceAgentKey: previousStepData?.agentKey,
        sourceStepIndex: previousStepData?.stepIndex,
        sourceDomain: previousStepData?.domain,
      };
      await this.provideStepFeedback(stepTrajectoryId, quality, agentKey, stepIndex, rlmContext);
    }

    const stepDuration = Date.now() - stepStartTime;

    this.emitEvent({
      type: PipelineEventType.AGENT_COMPLETED,
      pipelineId,
      timestamp: Date.now(),
      data: {
        stepIndex,
        agentKey,
        quality,
        duration: stepDuration,
      },
    });

    // Implements [REQ-OBS-11]: Emit step_completed to ObservabilityBus
    ObservabilityBus.getInstance().emit({
      component: 'pipeline',
      operation: 'step_completed',
      status: 'success',
      durationMs: stepDuration,
      metadata: {
        pipelineId,
        stepIndex,
        agentKey,
        quality,
        memoryDomain: storeResult.domain,
        memoryTags: storeResult.tags,
      },
    });

    this.log(
      `[Pipeline ${pipelineId}] Step ${stepIndex}: Completed '${agentKey}' ` +
      `(quality: ${quality.toFixed(2)}, duration: ${stepDuration}ms)`
    );

    return {
      stepIndex,
      agentKey,
      output: executionResult.output,
      quality,
      duration: stepDuration,
      memoryDomain: storeResult.domain,
      memoryTags: storeResult.tags,
      trajectoryId: stepTrajectoryId,
    };
  }

  /**
   * Execute agent with timeout enforcement.
   */
  private async executeWithTimeout(
    agentKey: string,
    prompt: string,
    timeout: number,
    pipelineId: string,
    stepIndex: number
  ): Promise<IStepExecutionResult> {
    // If custom executor provided, use it
    if (this.config.stepExecutor) {
      return await Promise.race([
        this.config.stepExecutor.execute(agentKey, prompt, timeout),
        this.createTimeoutPromise(timeout, pipelineId, stepIndex, agentKey),
      ]);
    }

    // Default execution (placeholder - actual implementation would call Claude Code Task())
    // In production, this would spawn a Task() subagent
    return await Promise.race([
      this.defaultExecute(agentKey, prompt),
      this.createTimeoutPromise(timeout, pipelineId, stepIndex, agentKey),
    ]);
  }

  /**
   * Default execution implementation.
   * PRODUCTION-READY: Throws error requiring stepExecutor injection.
   *
   * This method is called when no stepExecutor is provided via config.
   * In production, you MUST provide a stepExecutor that integrates with
   * Claude Code's Task() tool or another agent execution mechanism.
   *
   * @throws PipelineExecutionError - Always throws, requiring explicit executor injection
   */
  private async defaultExecute(
    agentKey: string,
    _prompt: string
  ): Promise<IStepExecutionResult> {
    // PRODUCTION GUARD: Do not allow silent fake execution
    // The stepExecutor MUST be injected via config for real agent execution
    throw new PipelineExecutionError(
      `No stepExecutor provided for agent "${agentKey}". ` +
        `You must inject a stepExecutor via IPipelineExecutorConfig.stepExecutor ` +
        `that implements IStepExecutor.execute() to run real agents. ` +
        `See tests/god-agent/core/integration/agent-execution.test.ts for examples.`,
      {
        pipelineId: 'configuration-error',
        pipelineName: 'configuration-error',
        agentKey,
        stepIndex: -1,
      }
    );
  }

  /**
   * Create a timeout promise that rejects with PipelineTimeoutError.
   */
  private createTimeoutPromise(
    timeout: number,
    pipelineId: string,
    stepIndex: number,
    agentKey?: string
  ): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new PipelineTimeoutError({
          pipelineId,
          stepIndex,
          agentKey,
          timeout,
          elapsed: timeout,
          scope: 'step',
        }));
      }, timeout);
    });
  }

  /**
   * Assess output quality.
   * Uses provided quality or estimates based on output structure.
   */
  private assessQuality(output: unknown, providedQuality?: number): number {
    // If quality explicitly provided, use it
    if (providedQuality !== undefined) {
      return Math.max(0, Math.min(1, providedQuality));
    }

    // Basic quality estimation based on output
    if (output === null || output === undefined) {
      return 0;
    }

    if (typeof output === 'string') {
      // Longer, more detailed output tends to be higher quality
      const length = output.length;
      if (length < 10) return 0.3;
      if (length < 100) return 0.5;
      if (length < 500) return 0.7;
      return 0.8;
    }

    if (typeof output === 'object') {
      const keys = Object.keys(output as Record<string, unknown>);
      if (keys.length === 0) return 0.3;
      if (keys.length < 3) return 0.6;
      return 0.8;
    }

    return 0.5;
  }

  /**
   * Provide feedback to SonaEngine for a step (direct SQLite persistence).
   * Falls back to ReasoningBank if SonaEngine is not available.
   *
   * @param trajectoryId - The trajectory ID for this step
   * @param quality - Quality score (0-1)
   * @param agentKey - The agent key that executed the step
   * @param stepIndex - The step index in the pipeline
   * @param rlmContext - Optional RLM context for relay-race memory handoff tracking
   */
  private async provideStepFeedback(
    trajectoryId: string,
    quality: number,
    agentKey: string,
    stepIndex: number,
    rlmContext?: IRlmContext
  ): Promise<void> {
    // Prefer SonaEngine for direct SQLite persistence
    if (this.dependencies.sonaEngine) {
      try {
        await this.dependencies.sonaEngine.provideFeedback(trajectoryId, quality, {
          skipAutoSave: false, // CRITICAL: Ensure persistence to SQLite
          rlmContext, // Pass RLM context for relay-race memory tracking
        });

        this.emitEvent({
          type: PipelineEventType.FEEDBACK_PROVIDED,
          pipelineId: trajectoryId.split('_')[2] || 'unknown',
          timestamp: Date.now(),
          data: {
            trajectoryId,
            quality,
            agentKey,
            stepIndex,
            outcome: quality >= 0.7 ? 'positive' : 'negative',
          },
        });
        return;
      } catch (error) {
        this.log(`[Feedback] Warning: SonaEngine feedback failed, trying ReasoningBank: ${(error as Error).message}`);
      }
    }

    // Fallback to ReasoningBank
    if (!this.dependencies.reasoningBank) return;

    try {
      await this.dependencies.reasoningBank.provideFeedback({
        trajectoryId,
        quality,
        feedback: `Pipeline step ${stepIndex} by ${agentKey}`,
        verdict: quality >= 0.7 ? 'correct' : 'incorrect',
      });

      this.emitEvent({
        type: PipelineEventType.FEEDBACK_PROVIDED,
        pipelineId: trajectoryId.split('_')[2] || 'unknown',
        timestamp: Date.now(),
        data: {
          trajectoryId,
          quality,
          agentKey,
          stepIndex,
          outcome: quality >= 0.7 ? 'positive' : 'negative',
        },
      });
    } catch (error) {
      // Log but don't fail pipeline for feedback errors
      this.log(`[Feedback] Warning: Failed to provide step feedback: ${(error as Error).message}`);
    }
  }

  /**
   * Provide feedback to SonaEngine for the entire pipeline (direct SQLite persistence).
   * Falls back to ReasoningBank if SonaEngine is not available.
   */
  private async providePipelineFeedback(
    trajectoryId: string,
    quality: number,
    status: 'completed' | 'failed',
    pipelineName: string,
    errorMessage?: string
  ): Promise<void> {
    // Prefer SonaEngine for direct SQLite persistence
    if (this.dependencies.sonaEngine) {
      try {
        await this.dependencies.sonaEngine.provideFeedback(trajectoryId, quality, {
          skipAutoSave: false, // CRITICAL: Ensure persistence to SQLite
        });
        return;
      } catch (error) {
        this.log(`[Feedback] Warning: SonaEngine pipeline feedback failed, trying ReasoningBank: ${(error as Error).message}`);
      }
    }

    // Fallback to ReasoningBank
    if (!this.dependencies.reasoningBank) return;

    try {
      const feedback = status === 'completed'
        ? `Pipeline '${pipelineName}' completed successfully`
        : `Pipeline '${pipelineName}' failed: ${errorMessage}`;

      await this.dependencies.reasoningBank.provideFeedback({
        trajectoryId,
        quality,
        feedback,
        verdict: status === 'completed' ? 'correct' : 'incorrect',
      });
    } catch (error) {
      // Log but don't fail for feedback errors
      this.log(`[Feedback] Warning: Failed to provide pipeline feedback: ${(error as Error).message}`);
    }
  }

  /**
   * Emit a pipeline event if handler configured.
   */
  private emitEvent(event: IPipelineEvent): void {
    if (this.config.onEvent) {
      try {
        this.config.onEvent(event);
      } catch (error) {
        this.log(`[Event] Warning: Event handler error: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Log a message if verbose mode enabled.
   */
  private log(message: string): void {
    if (this.config.verbose) {
      console.log(message);
    }
  }
}

// ==================== Factory Function ====================

/**
 * Create a PipelineExecutor with required dependencies.
 *
 * @param dependencies - Required dependencies
 * @param config - Optional configuration
 * @returns PipelineExecutor instance
 */
export function createPipelineExecutor(
  dependencies: {
    agentRegistry: AgentRegistry;
    agentSelector: AgentSelector;
    interactionStore: InteractionStore;
    reasoningBank?: ReasoningBank;
    sonaEngine?: SonaEngine;
    leannContextService?: LeannContextService;
  },
  config?: IPipelineExecutorConfig
): PipelineExecutor {
  return new PipelineExecutor(dependencies, config);
}
