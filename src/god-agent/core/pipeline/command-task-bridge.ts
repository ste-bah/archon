/**
 * DAI-002: Command Task Bridge
 *
 * Bridges between Claude Code slash commands and Task() subagent spawning.
 * Implements RULE-008: Commands must spawn Task() subagents, never execute directly.
 *
 * US-014: /god-code Task() Spawning
 * US-015: /god-ask Task() Spawning
 * US-016: /god-research Task() Spawning
 * US-017: /god-write Task() Spawning
 * US-018: Complex Task Pipeline Triggering
 * FR-017: Task() Spawning Required
 * FR-018: Pipeline Detection
 * FR-019: Multi-Step Task Detection
 *
 * REFACTORED: Constitution compliance - split into 6 modules (< 500 lines each)
 */

import { type IPipelineDefinition, type IPipelineStep } from './dai-002-types.js';
import { PipelineDefinitionError } from './pipeline-errors.js';

// ==================== Type Re-exports ====================
export type {
  IComplexityAnalysis,
  IPipelineDecision,
  TaskType,
  IAgentMapping,
  ICommandTaskBridgeConfig,
} from './command-task-bridge-types.js';

// ==================== Constant Re-exports ====================
export {
  DEFAULT_PIPELINE_THRESHOLD,
  PHASE_KEYWORDS,
  DOCUMENT_KEYWORDS,
  MULTI_STEP_PATTERNS,
  CONNECTOR_WORDS,
  DEFAULT_PHASE_MAPPINGS,
  DOCUMENT_AGENT_MAPPING,
} from './command-task-bridge-constants.js';

// ==================== DAG Builder Re-exports ====================
export {
  CODING_PIPELINE_MAPPINGS,
  getAgentsForPhase,
  buildPipelineDAG,
  getCriticalAgents,
  getAgentByKey,
  getTotalPipelineXP,
  getPhaseXPTotals,
  validatePipelineDependencies,
  getAgentsByCategory,
  getForensicReviewAgents,
  getParallelizableAgents,
  getPhaseExecutionOrder,
} from './coding-pipeline-dag-builder.js';

// ==================== Internal Imports ====================
import type {
  IComplexityAnalysis,
  IPipelineDecision,
  TaskType,
  IAgentMapping,
  ICommandTaskBridgeConfig,
} from './command-task-bridge-types.js';

import {
  DEFAULT_PIPELINE_THRESHOLD,
  PHASE_KEYWORDS,
  DOCUMENT_KEYWORDS,
  MULTI_STEP_PATTERNS,
  CONNECTOR_WORDS,
  DEFAULT_PHASE_MAPPINGS,
  DOCUMENT_AGENT_MAPPING,
} from './command-task-bridge-constants.js';

// ==================== CommandTaskBridge Class ====================

/**
 * Bridges Claude Code commands to Task() subagent spawning.
 *
 * RULE-008: Commands must spawn Task() subagents, never execute directly.
 *
 * @example
 * ```typescript
 * const bridge = new CommandTaskBridge({ verbose: true });
 *
 * // Analyze complexity
 * const analysis = bridge.analyzeTaskComplexity("implement auth and test it");
 * console.log(analysis.score); // 0.7 (multi-step detected)
 *
 * // Check if pipeline needed
 * const decision = bridge.shouldUsePipeline("implement auth and test it");
 * if (decision.usePipeline) {
 *   const pipeline = bridge.buildPipelineDefinition("implement auth and test it");
 *   await agent.runPipeline(pipeline);
 * }
 * ```
 */
export class CommandTaskBridge {
  private readonly config: Required<ICommandTaskBridgeConfig>;
  private readonly phaseMappings: Map<string, IAgentMapping>;

  constructor(config: ICommandTaskBridgeConfig = {}) {
    this.config = {
      pipelineThreshold: config.pipelineThreshold ?? DEFAULT_PIPELINE_THRESHOLD,
      verbose: config.verbose ?? false,
      phaseMappings: config.phaseMappings ?? new Map()
    };

    // Initialize phase mappings with defaults + custom
    this.phaseMappings = new Map(
      DEFAULT_PHASE_MAPPINGS.map(m => [m.phase, m])
    );

    // Override with custom mappings
    if (config.phaseMappings) {
      for (const [phase, mapping] of config.phaseMappings) {
        this.phaseMappings.set(phase, mapping);
      }
    }
  }

  /**
   * Analyze task complexity to determine if pipeline is needed.
   *
   * Implements FR-019: Multi-Step Task Detection
   *
   * @param task - The task description to analyze
   * @returns Complexity analysis with score and detected patterns
   */
  analyzeTaskComplexity(task: string): IComplexityAnalysis {
    const normalizedTask = task.toLowerCase();
    let score = 0;
    const detectedPhases: string[] = [];
    const detectedDocuments: string[] = [];
    const detectedActions: string[] = [];
    const reasons: string[] = [];

    // 1. Check for phase keywords
    for (const phase of PHASE_KEYWORDS) {
      if (normalizedTask.includes(phase)) {
        detectedPhases.push(phase);
        score += 0.15;
        reasons.push(`Phase keyword "${phase}" detected`);
      }
    }

    // 2. Check for document creation keywords
    for (const doc of DOCUMENT_KEYWORDS) {
      if (normalizedTask.includes(doc)) {
        detectedDocuments.push(doc);
        score += 0.2;
        reasons.push(`Document type "${doc}" detected`);
      }
    }

    // 3. Check for multi-step patterns
    for (const pattern of MULTI_STEP_PATTERNS) {
      const matches = normalizedTask.match(pattern);
      if (matches) {
        for (const match of matches) {
          const words = match.split(/\s+/).filter(w =>
            !['and', 'then', 'create', 'first', 'step', 'phase'].includes(w.toLowerCase())
          );
          for (const word of words) {
            if (!detectedActions.includes(word)) {
              detectedActions.push(word);
            }
          }
        }
        score += 0.25;
        reasons.push(`Multi-step pattern detected: ${matches[0]}`);
      }
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;
    }

    // 4. Check for connector words (indicates sequential work)
    const connectorCount = CONNECTOR_WORDS.filter(c => normalizedTask.includes(c)).length;
    if (connectorCount > 0) {
      score += connectorCount * 0.1;
      reasons.push(`${connectorCount} connector word(s) indicating sequence`);
    }

    // 5. Count unique action verbs
    const actionVerbs = ['create', 'build', 'implement', 'write', 'design', 'test', 'review', 'deploy'];
    const verbCount = actionVerbs.filter(v => normalizedTask.includes(v)).length;
    if (verbCount >= 2) {
      score += (verbCount - 1) * 0.1;
      reasons.push(`${verbCount} distinct action verbs detected`);
    }

    // 6. Task length heuristic (longer = likely more complex)
    const wordCount = task.split(/\s+/).length;
    if (wordCount > 15) {
      score += 0.1;
      reasons.push(`Task length (${wordCount} words) suggests complexity`);
    }

    // Normalize score to 0-1 range
    score = Math.min(1, Math.max(0, score));

    // Determine if multi-step based on analysis
    const isMultiStep =
      detectedPhases.length >= 2 ||
      detectedDocuments.length >= 2 ||
      detectedActions.length >= 2 ||
      connectorCount >= 2;

    if (this.config.verbose) {
      console.log(`[CommandTaskBridge] Complexity analysis for: "${task.substring(0, 50)}..."`);
      console.log(`[CommandTaskBridge] Score: ${score.toFixed(2)}, Multi-step: ${isMultiStep}`);
    }

    return {
      score,
      isMultiStep,
      detectedPhases,
      detectedDocuments,
      detectedActions,
      reasoning: reasons.length > 0 ? reasons.join('; ') : 'Simple single-step task'
    };
  }

  /**
   * Determine if a pipeline should be used for the given task.
   *
   * Implements US-018: Complex Task Pipeline Triggering
   *
   * @param task - The task description
   * @returns Decision with reasoning and suggested steps
   */
  shouldUsePipeline(task: string): IPipelineDecision {
    const complexity = this.analyzeTaskComplexity(task);

    // Decision factors
    const exceedsThreshold = complexity.score >= this.config.pipelineThreshold;
    const isMultiStep = complexity.isMultiStep;
    const hasMultipleDocuments = complexity.detectedDocuments.length >= 2;
    const hasMultiplePhases = complexity.detectedPhases.length >= 2;

    // Determine if pipeline should be used
    const usePipeline = exceedsThreshold && (isMultiStep || hasMultipleDocuments || hasMultiplePhases);

    let reason: string;
    let suggestedSteps: string[] | undefined;

    if (usePipeline) {
      reason = `Complexity score ${complexity.score.toFixed(2)} >= ${this.config.pipelineThreshold} threshold`;

      // Build suggested steps from detected phases/documents
      suggestedSteps = [];

      // Add phases first
      for (const phase of complexity.detectedPhases) {
        if (!suggestedSteps.includes(phase)) {
          suggestedSteps.push(phase);
        }
      }

      // Add document creation steps
      for (const doc of complexity.detectedDocuments) {
        const step = `create ${doc}`;
        if (!suggestedSteps.includes(step)) {
          suggestedSteps.push(step);
        }
      }

      // Default to a basic pipeline if nothing detected but score is high
      if (suggestedSteps.length === 0) {
        suggestedSteps = ['analyze', 'implement', 'validate'];
        reason += '; Using default analyze-implement-validate pipeline';
      }

      if (this.config.verbose) {
        console.log(`[CommandTaskBridge] Pipeline recommended: ${suggestedSteps.join(' -> ')}`);
      }
    } else {
      reason = complexity.score < this.config.pipelineThreshold
        ? `Complexity score ${complexity.score.toFixed(2)} below ${this.config.pipelineThreshold} threshold`
        : 'Single-step task detected';

      if (this.config.verbose) {
        console.log(`[CommandTaskBridge] Single agent execution recommended`);
      }
    }

    return {
      usePipeline,
      reason,
      suggestedSteps,
      complexity
    };
  }

  /**
   * Build a pipeline definition from a complex task.
   *
   * Implements FR-017, FR-018, FR-019
   *
   * @param task - The task description
   * @param taskType - Type of task (code, ask, research, write)
   * @param baseName - Optional base name for the pipeline
   * @returns Pipeline definition ready for execution
   * @throws PipelineDefinitionError if pipeline cannot be built
   */
  buildPipelineDefinition(
    task: string,
    taskType: TaskType = 'code',
    baseName?: string
  ): IPipelineDefinition {
    const decision = this.shouldUsePipeline(task);

    if (!decision.usePipeline || !decision.suggestedSteps) {
      throw new PipelineDefinitionError(
        'Task does not require a pipeline. Use single agent execution.',
        {
          pipelineName: baseName ?? 'unknown',
          invalidField: 'task',
          details: {
            complexityScore: decision.complexity.score,
            threshold: this.config.pipelineThreshold
          }
        }
      );
    }

    const steps: IPipelineStep[] = [];
    const pipelineName = baseName ?? this.generatePipelineName(task, taskType);

    // Build steps from suggested phases
    for (let i = 0; i < decision.suggestedSteps.length; i++) {
      const step = decision.suggestedSteps[i];
      const phaseKey = this.extractPhaseKey(step);
      const mapping = this.phaseMappings.get(phaseKey) ?? this.getDefaultMapping(phaseKey, taskType);

      // Determine input domain (from previous step)
      const inputDomain = i > 0
        ? steps[i - 1].outputDomain
        : undefined;

      const inputTags = i > 0
        ? steps[i - 1].outputTags
        : undefined;

      // Build the step
      const pipelineStep: IPipelineStep = {
        agentKey: mapping.agentKey,
        task: mapping.taskTemplate.replace('{task}', task),
        inputDomain,
        inputTags,
        outputDomain: mapping.outputDomain,
        outputTags: [...mapping.outputTags, pipelineName.replace(/\s+/g, '-').toLowerCase()]
      };

      steps.push(pipelineStep);
    }

    if (steps.length === 0) {
      throw new PipelineDefinitionError(
        'Could not build any pipeline steps from task',
        {
          pipelineName,
          invalidField: 'agents',
          details: { task, suggestedSteps: decision.suggestedSteps }
        }
      );
    }

    const pipeline: IPipelineDefinition = {
      name: pipelineName,
      description: `Auto-generated pipeline for: ${task.substring(0, 100)}`,
      agents: steps,
      sequential: true,
      metadata: {
        taskType,
        originalTask: task,
        complexityScore: decision.complexity.score,
        generatedAt: new Date().toISOString()
      }
    };

    if (this.config.verbose) {
      console.log(`[CommandTaskBridge] Built pipeline "${pipelineName}" with ${steps.length} steps`);
      console.log(`[CommandTaskBridge] Agents: ${steps.map(s => s.agentKey).join(' -> ')}`);
    }

    return pipeline;
  }

  /**
   * Get the appropriate single agent for a simple task.
   *
   * Used when shouldUsePipeline() returns false.
   *
   * @param task - The task description
   * @param taskType - Type of task
   * @returns Agent key to use
   */
  getSingleAgent(task: string, taskType: TaskType): string {
    const normalizedTask = task.toLowerCase();

    // Check for specific document types first
    for (const [docType, agentKey] of Object.entries(DOCUMENT_AGENT_MAPPING)) {
      if (normalizedTask.includes(docType)) {
        return agentKey;
      }
    }

    // Check for phase keywords
    for (const phase of PHASE_KEYWORDS) {
      if (normalizedTask.includes(phase)) {
        const mapping = this.phaseMappings.get(phase);
        if (mapping) {
          return mapping.agentKey;
        }
      }
    }

    // Default based on task type
    switch (taskType) {
      case 'code':
        return 'backend-dev';
      case 'ask':
        return 'ambiguity-clarifier';
      case 'research':
        return 'researcher';
      case 'write':
        return 'documentation-specialist';
      default:
        return 'backend-dev';
    }
  }

  /**
   * Generate a descriptive pipeline name from task.
   */
  private generatePipelineName(task: string, taskType: TaskType): string {
    // Extract first few meaningful words
    const words = task
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !['that', 'this', 'with', 'from', 'into'].includes(w))
      .slice(0, 3);

    const base = words.length > 0 ? words.join('-') : taskType;
    return `${taskType}-${base}-pipeline`;
  }

  /**
   * Extract the phase key from a step description.
   */
  private extractPhaseKey(step: string): string {
    const normalizedStep = step.toLowerCase();

    // Direct match with phase keywords
    for (const phase of PHASE_KEYWORDS) {
      if (normalizedStep.includes(phase)) {
        return phase;
      }
    }

    // Check document types and map to phases
    for (const [docType, _] of Object.entries(DOCUMENT_AGENT_MAPPING)) {
      if (normalizedStep.includes(docType)) {
        return 'document';
      }
    }

    // Default to implement for unrecognized steps
    return 'implement';
  }

  /**
   * Get a default mapping for an unknown phase.
   */
  private getDefaultMapping(phaseKey: string, taskType: TaskType): IAgentMapping {
    // Try to get from existing mappings
    const existing = this.phaseMappings.get(phaseKey);
    if (existing) return existing;

    // Create a default based on task type
    const defaultAgents: Record<TaskType, string> = {
      code: 'backend-dev',
      ask: 'ambiguity-clarifier',
      research: 'researcher',
      write: 'documentation-specialist',
      unknown: 'backend-dev'
    };

    return {
      phase: phaseKey,
      agentKey: defaultAgents[taskType],
      outputDomain: `project/${phaseKey}`,
      outputTags: [phaseKey, taskType],
      taskTemplate: `Execute ${phaseKey} phase: {task}`
    };
  }

  /**
   * Get all available phase mappings.
   */
  getPhaseMappings(): Map<string, IAgentMapping> {
    return new Map(this.phaseMappings);
  }

  /**
   * Get the configured pipeline threshold.
   */
  getThreshold(): number {
    return this.config.pipelineThreshold;
  }
}

// ==================== Factory Function ====================

/**
 * Create a CommandTaskBridge instance.
 *
 * @param config - Configuration options
 * @returns Configured CommandTaskBridge instance
 */
export function createCommandTaskBridge(
  config: ICommandTaskBridgeConfig = {}
): CommandTaskBridge {
  return new CommandTaskBridge(config);
}
