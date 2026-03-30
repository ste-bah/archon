/**
 * DAI-002: Pipeline Prompt Builder
 * TASK-003: Builds forward-looking prompts for pipeline agents
 *
 * RULE-007: Forward-Looking Agent Prompts
 * - Every agent prompt MUST include workflow context
 * - Agents MUST know their position in pipeline
 * - Agents MUST know what previous agents produced
 * - Agents MUST know what next agents need
 *
 * This achieves 88% success rate vs 60% without context (per constitution)
 */

import type { AgentRegistry } from '../agents/agent-registry.js';
import type { IPipelineDefinition, IPipelineStep } from './dai-002-types.js';
import type { ISemanticContext } from './leann-context-service.js';
import { DEFAULT_MIN_QUALITY } from './dai-002-types.js';

// ==================== Constants ====================

/**
 * Maximum length for injected output in prompts.
 * Prevents prompt explosion with very large outputs.
 */
const MAX_INJECTED_OUTPUT_LENGTH = 10000;

// ==================== Prompt Context Interface ====================

/**
 * Context data used to build a pipeline prompt
 */
export interface IPromptContext {
  /** Current step being executed */
  step: IPipelineStep;
  /** Index of current step (0-based) */
  stepIndex: number;
  /** Full pipeline definition */
  pipeline: IPipelineDefinition;
  /** Unique pipeline execution ID */
  pipelineId: string;
  /** Optional initial input for first agent */
  initialInput?: unknown;
  /** Output retrieved from previous agent (injected by PipelineExecutor) */
  previousOutput?: unknown;
  /** Metadata about the previous step that produced the output */
  previousStepData?: {
    /** Agent key of the previous agent */
    agentKey: string;
    /** Step index of the previous step */
    stepIndex: number;
    /** Domain where the output was stored */
    domain: string;
  };
  /** Semantic context from LEANN code search (optional) */
  semanticContext?: ISemanticContext;
  /** Situational awareness section for parallel agent coordination (optional) */
  situationalAwareness?: string;
  /** Reflexion context: past failure lessons for self-correction (PRD: Reflexion) */
  reflexionContext?: IReflexionContext;
  /** Pattern context: reusable patterns from PatternStore (PRD: LEANN Pattern Store) */
  patternContext?: IPatternContext;
}

/**
 * Reflexion context containing past failure lessons for self-correction
 */
export interface IReflexionContext {
  /** Past failed trajectories for this agent */
  failures: Array<{
    /** Trajectory ID */
    trajectoryId: string;
    /** Quality score (0.0 = complete failure) */
    quality: number;
    /** When the failure occurred */
    createdAt: string;
    /** Pipeline ID where the failure occurred */
    pipelineId?: string;
  }>;
  /** Total number of past executions for this agent */
  totalExecutions: number;
  /** Success rate (0.0-1.0) */
  successRate: number;
}

/**
 * Pattern context containing reusable patterns relevant to the agent's task
 */
export interface IPatternContext {
  /** Matched patterns from PatternStore */
  patterns: Array<{
    /** Pattern ID */
    patternId: string;
    /** Pattern template/description */
    template: string;
    /** Task type this pattern applies to */
    taskType: string;
    /** Confidence score of the match */
    confidence: number;
  }>;
}

/**
 * Built prompt result
 */
export interface IBuiltPrompt {
  /** The complete prompt string */
  prompt: string;
  /** Agent key (resolved or from step) */
  agentKey: string | undefined;
  /** Agent description if available */
  agentDescription: string | undefined;
  /** Step number (1-based for display) */
  stepNumber: number;
  /** Total steps in pipeline */
  totalSteps: number;
}

// ==================== Pipeline Prompt Builder ====================

/**
 * Builds forward-looking prompts for pipeline agents.
 * Implements RULE-007: Every prompt includes workflow context.
 *
 * @example
 * ```typescript
 * const builder = new PipelinePromptBuilder(agentRegistry);
 * const prompt = builder.buildPrompt({
 *   step: pipelineStep,
 *   stepIndex: 0,
 *   pipeline: pipelineDefinition,
 *   pipelineId: 'pip_123'
 * });
 * ```
 */
export class PipelinePromptBuilder {
  /**
   * Create a new prompt builder
   * @param agentRegistry - Registry to look up agent descriptions
   */
  constructor(private readonly agentRegistry: AgentRegistry) {}

  /**
   * Build a forward-looking prompt for a pipeline step.
   * Includes workflow context, memory retrieval, task, and memory storage sections.
   *
   * @param context - Context containing step, pipeline, and execution info
   * @returns Built prompt with metadata
   */
  buildPrompt(context: IPromptContext): IBuiltPrompt {
    const {
      step,
      stepIndex,
      pipeline,
      pipelineId,
      initialInput,
      previousOutput,
      previousStepData,
      semanticContext,
    } = context;
    const totalSteps = pipeline.agents.length;
    const previousStep = stepIndex > 0 ? pipeline.agents[stepIndex - 1] : undefined;
    const nextStep = stepIndex < totalSteps - 1 ? pipeline.agents[stepIndex + 1] : undefined;

    // Look up agent definition if available
    const agentDef = step.agentKey
      ? this.agentRegistry.getByKey(step.agentKey)
      : undefined;

    const prompt = this.assemblePrompt({
      step,
      stepIndex,
      totalSteps,
      pipelineId,
      pipelineName: pipeline.name,
      agentDef,
      previousStep,
      nextStep,
      initialInput,
      previousOutput,
      previousStepData,
      semanticContext,
      situationalAwareness: context.situationalAwareness,
      reflexionContext: context.reflexionContext,
      patternContext: context.patternContext,
    });

    return {
      prompt,
      agentKey: step.agentKey,
      agentDescription: agentDef?.description,
      stepNumber: stepIndex + 1,
      totalSteps,
    };
  }

  /**
   * Assemble the full prompt from sections
   */
  private assemblePrompt(params: {
    step: IPipelineStep;
    stepIndex: number;
    totalSteps: number;
    pipelineId: string;
    pipelineName: string;
    agentDef?: { key: string; description?: string };
    previousStep?: IPipelineStep;
    nextStep?: IPipelineStep;
    initialInput?: unknown;
    /** Retrieved output from previous agent */
    previousOutput?: unknown;
    /** Metadata about the previous step */
    previousStepData?: { agentKey: string; stepIndex: number; domain: string };
    /** Semantic context from LEANN code search */
    semanticContext?: ISemanticContext;
    /** Situational awareness for parallel agents */
    situationalAwareness?: string;
    /** Reflexion context: past failure lessons */
    reflexionContext?: IReflexionContext;
    /** Pattern context: reusable patterns */
    patternContext?: IPatternContext;
  }): string {
    const {
      step,
      stepIndex,
      totalSteps,
      pipelineId,
      pipelineName,
      agentDef,
      previousStep,
      nextStep,
      initialInput,
      previousOutput,
      previousStepData,
      semanticContext,
      situationalAwareness,
      reflexionContext,
      patternContext,
    } = params;

    const sections: string[] = [];

    // 1. Agent Header
    sections.push(this.buildAgentHeader(step, agentDef));

    // 2. Workflow Context (RULE-007)
    sections.push(this.buildWorkflowContext(
      stepIndex,
      totalSteps,
      pipelineName,
      pipelineId,
      previousStep,
      nextStep
    ));

    // 2b. Situational Awareness (parallel agent coordination)
    if (situationalAwareness) {
      sections.push(situationalAwareness);
    }

    // 2c. Reflexion Context (past failure lessons for self-correction)
    if (reflexionContext && reflexionContext.failures.length > 0) {
      sections.push(this.buildReflexionSection(reflexionContext));
    }

    // 2d. Pattern Context (reusable patterns from PatternStore)
    if (patternContext && patternContext.patterns.length > 0) {
      sections.push(this.buildPatternSection(patternContext));
    }

    // 3. Memory Retrieval Section (with injected previous output when available)
    sections.push(this.buildMemoryRetrievalSection(
      step,
      pipelineId,
      initialInput,
      stepIndex,
      previousOutput,
      previousStepData
    ));

    // 3b. Semantic Context Section (from LEANN code search)
    if (semanticContext && semanticContext.codeContext.length > 0) {
      sections.push(this.buildSemanticContextSection(semanticContext));
    }

    // 4. Task Section
    sections.push(this.buildTaskSection(step));

    // 5. Memory Storage Section
    sections.push(this.buildMemoryStorageSection(step, stepIndex, pipelineId));

    // 6. Quality Requirements
    sections.push(this.buildQualitySection(step));

    // 7. Success Criteria
    sections.push(this.buildSuccessCriteria(step, nextStep));

    return sections.join('\n\n---\n\n');
  }

  /**
   * Build agent header section
   */
  private buildAgentHeader(
    step: IPipelineStep,
    agentDef?: { key: string; description?: string }
  ): string {
    const agentName = step.agentKey || 'TBD (DAI-001 Selection)';
    const descLine = agentDef?.description
      ? `\n**Description:** ${agentDef.description}`
      : '';

    return `## Agent: ${agentName}${descLine}`;
  }

  /**
   * Build workflow context section (RULE-007 core requirement)
   */
  private buildWorkflowContext(
    stepIndex: number,
    totalSteps: number,
    pipelineName: string,
    pipelineId: string,
    previousStep?: IPipelineStep,
    nextStep?: IPipelineStep
  ): string {
    return `## WORKFLOW CONTEXT
Agent #${stepIndex + 1} of ${totalSteps}
Pipeline: ${pipelineName} (ID: ${pipelineId})
Previous: ${this.formatPreviousContext(previousStep)}
Next: ${this.formatNextContext(nextStep)}`;
  }

  /**
   * Format previous agent context
   */
  formatPreviousContext(previousStep?: IPipelineStep): string {
    if (!previousStep) {
      return 'none (first agent)';
    }
    const agentName = previousStep.agentKey || 'previous-agent';
    return `${agentName} (${previousStep.outputDomain})`;
  }

  /**
   * Format next agent context
   */
  formatNextContext(nextStep?: IPipelineStep): string {
    if (!nextStep) {
      return 'none (FINAL agent)';
    }
    const agentName = nextStep.agentKey || 'next-agent';
    const needs = nextStep.inputDomain || 'your output';
    return `${agentName} (needs: ${needs})`;
  }

  /**
   * Build memory retrieval section.
   * When previousOutput is provided, injects the ACTUAL data from the previous agent.
   * Otherwise, shows fallback instructions for manual retrieval.
   *
   * @param step - Current pipeline step containing inputDomain and inputTags
   * @param pipelineId - Unique pipeline execution ID used for filtering stored knowledge
   * @param initialInput - Optional initial input for first agent (takes precedence at stepIndex=0)
   * @param stepIndex - Current step index (0-based); determines if this is the first agent
   * @param previousOutput - Actual output retrieved from previous agent; when provided, data is injected directly
   * @param previousStepData - Metadata about the previous step (agentKey, stepIndex, domain) for context
   * @returns Formatted markdown section for memory retrieval with either injected data,
   *          fallback retrieval instructions, or N/A message for first agent
   */
  buildMemoryRetrievalSection(
    step: IPipelineStep,
    pipelineId: string,
    initialInput?: unknown,
    stepIndex?: number,
    previousOutput?: unknown,
    previousStepData?: { agentKey: string; stepIndex: number; domain: string }
  ): string {
    // First agent with initial input
    if (stepIndex === 0 && initialInput !== undefined) {
      return `## MEMORY RETRIEVAL (initial input)
Initial input provided:
\`\`\`json
${JSON.stringify(initialInput, null, 2)}
\`\`\``;
    }

    // First agent without input domain
    if (!step.inputDomain) {
      return `## MEMORY RETRIEVAL (N/A - first agent)
No previous agent output to retrieve - you are the first agent.`;
    }

    // If previous output was successfully retrieved, inject the ACTUAL data
    if (previousOutput !== undefined && previousStepData) {
      return this.buildInjectedMemorySection(previousOutput, previousStepData);
    }

    // Fallback: show retrieval instructions (data could not be retrieved)
    return this.buildFallbackRetrievalSection(step, pipelineId);
  }

  /**
   * Build memory retrieval section with injected actual data.
   * This is the preferred path - agents receive real data from previous agent.
   */
  private buildInjectedMemorySection(
    previousOutput: unknown,
    previousStepData: { agentKey: string; stepIndex: number; domain: string }
  ): string {
    const serializedOutput = this.safeStringify(previousOutput, 2);
    // Truncate very large outputs to prevent prompt explosion
    const truncatedOutput = this.safeTruncate(serializedOutput, MAX_INJECTED_OUTPUT_LENGTH);
    // Escape backticks to prevent prompt injection / code block breakout
    const escapedOutput = truncatedOutput.replace(/```/g, '\\`\\`\\`');

    return `## MEMORY RETRIEVAL (INJECTED - data from previous agent)
**Source:** Agent "${previousStepData.agentKey}" (step ${previousStepData.stepIndex})
**Domain:** ${previousStepData.domain}

Previous agent's output:
\`\`\`json
${escapedOutput}
\`\`\`

Use this data as input for your task. It has been automatically retrieved from the pipeline memory.`;
  }

  /**
   * Safely stringify a value, handling circular references and BigInt.
   * Prevents JSON.stringify from throwing on circular structures.
   *
   * @param value - Value to serialize
   * @param indent - Indentation spaces (default 2)
   * @returns JSON string with circular references marked as [Circular Reference]
   */
  private safeStringify(value: unknown, indent = 2): string {
    const seen = new WeakSet();
    return JSON.stringify(value, (_key, val) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular Reference]';
        seen.add(val);
      }
      // Handle BigInt which JSON.stringify cannot serialize
      if (typeof val === 'bigint') return val.toString() + 'n';
      return val;
    }, indent);
  }

  /**
   * Safely truncate a string without splitting multibyte UTF-8 characters.
   * Uses code points instead of code units for proper Unicode handling.
   * Note: maxLength applies to the final string length (code units), not code points,
   * but we truncate at code point boundaries to avoid corrupting characters.
   *
   * @param str - String to truncate
   * @param maxLength - Maximum length in code units (bytes in output)
   * @returns Truncated string with indicator if truncated
   */
  private safeTruncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    // Use spread to get code points, not code units (handles emoji, etc.)
    const codePoints = [...str];
    // Find how many code points we can include while staying under maxLength
    let length = 0;
    let i = 0;
    while (i < codePoints.length && length + codePoints[i].length <= maxLength) {
      length += codePoints[i].length;
      i++;
    }
    return codePoints.slice(0, i).join('') + '\n... [truncated]';
  }

  /**
   * Build fallback retrieval section when data could not be pre-retrieved.
   * Shows instructions for manual retrieval.
   */
  private buildFallbackRetrievalSection(
    step: IPipelineStep,
    pipelineId: string
  ): string {
    const tagsFilter = step.inputTags?.length
      ? ` &&\n  k.tags?.some(t => ['${step.inputTags!.join("', '")}'].includes(t))`
      : '';

    return `## MEMORY RETRIEVAL (from previous agent)
**Note:** Previous agent's output could not be pre-retrieved. Use the following code to retrieve it:
\`\`\`typescript
const previousOutput = interactionStore.getKnowledgeByDomain('${step.inputDomain}');
const filtered = previousOutput.filter(k =>
  k.tags?.includes('${pipelineId}')${tagsFilter}
);
const data = JSON.parse(filtered[0]?.content || '{}');
\`\`\``;
  }

  /**
   * Build semantic context section from LEANN code search results.
   * Provides relevant code snippets to help the agent understand the codebase.
   *
   * @param context - Semantic context containing code search results
   * @returns Formatted markdown section with code context
   */
  private buildSemanticContextSection(context: ISemanticContext): string {
    if (context.codeContext.length === 0) {
      return '';
    }

    const maxContentLength = 2000; // Limit content length per result
    const contextBlocks = context.codeContext.map((c, i) => {
      const truncatedContent = c.content.length > maxContentLength
        ? c.content.substring(0, maxContentLength) + '\n... [truncated]'
        : c.content;

      // Escape backticks to prevent code block breakout
      const escapedContent = truncatedContent.replace(/```/g, '\\`\\`\\`');

      return `### Context ${i + 1}: ${c.filePath} (${(c.similarity * 100).toFixed(1)}% relevant)
\`\`\`${c.language ?? ''}
${escapedContent}
\`\`\``;
    }).join('\n\n');

    return `## SEMANTIC CONTEXT (from codebase search)
**Query:** "${context.searchQuery}"
**Found ${context.totalResults} relevant code sections:**

${contextBlocks}

**Note:** Use this context to understand existing patterns and conventions in the codebase.`;
  }

  /**
   * Build Reflexion section with past failure lessons for self-correction.
   * PRD: Agent 31 Reflexion — episodic memory of past failures.
   */
  private buildReflexionSection(context: IReflexionContext): string {
    const failureLines = context.failures.slice(0, 5).map((f, i) => {
      const pipelineNote = f.pipelineId ? ` (pipeline: ${f.pipelineId})` : '';
      return `${i + 1}. Quality ${f.quality.toFixed(2)} on ${f.createdAt}${pipelineNote}`;
    }).join('\n');

    return `## REFLEXION (lessons from past failures)
**History:** ${context.totalExecutions} past executions, ${(context.successRate * 100).toFixed(0)}% success rate
**Recent failures (${context.failures.length}):**
${failureLines}

**Action:** Learn from these failures. Avoid repeating the same mistakes. If quality was low, focus on completeness and correctness.`;
  }

  /**
   * Build Pattern section with reusable patterns from PatternStore.
   * PRD: LEANN Pattern Store — reusable patterns indexed by task type.
   */
  private buildPatternSection(context: IPatternContext): string {
    const patternLines = context.patterns.slice(0, 5).map((p, i) => {
      return `${i + 1}. **${p.taskType}** (${(p.confidence * 100).toFixed(0)}% match): ${p.template}`;
    }).join('\n');

    return `## REUSABLE PATTERNS (from pattern store)
**Found ${context.patterns.length} relevant patterns:**
${patternLines}

**Action:** Apply these proven patterns where applicable. They represent successful approaches from previous pipeline runs.`;
  }

  /**
   * Build task section
   */
  private buildTaskSection(step: IPipelineStep): string {
    return `## YOUR TASK
${step.task}`;
  }

  /**
   * Build memory storage section
   */
  buildMemoryStorageSection(
    step: IPipelineStep,
    stepIndex: number,
    pipelineId: string
  ): string {
    const agentKey = step.agentKey || 'selected-agent';
    const tagsArray = [...step.outputTags, pipelineId, `step-${stepIndex}`];
    const tagsStr = tagsArray.map(t => `'${t}'`).join(', ');

    return `## MEMORY STORAGE (REQUIRED)
After completing your task, store your output for the next agent:
\`\`\`typescript
await agent.storeKnowledge({
  content: JSON.stringify({
    stepIndex: ${stepIndex},
    agentKey: '${agentKey}',
    output: YOUR_OUTPUT_HERE,
    pipelineId: '${pipelineId}'
  }),
  category: 'pipeline-step',
  domain: '${step.outputDomain}',
  tags: [${tagsStr}]
});
\`\`\`

**CRITICAL:** Store your output BEFORE completing. The next agent depends on it.`;
  }

  /**
   * Build quality requirements section
   */
  private buildQualitySection(step: IPipelineStep): string {
    const minQuality = step.minQuality ?? DEFAULT_MIN_QUALITY;
    return `## QUALITY REQUIREMENTS
- Minimum quality threshold: ${minQuality}
- Provide feedback to ReasoningBank after completion`;
  }

  /**
   * Build success criteria section
   */
  private buildSuccessCriteria(step: IPipelineStep, nextStep?: IPipelineStep): string {
    const minQuality = step.minQuality ?? DEFAULT_MIN_QUALITY;
    const nextAgentNote = nextStep
      ? `5. Next agent (${nextStep.agentKey || 'next-agent'}) can retrieve your output`
      : '5. Pipeline completion (you are the final agent)';

    return `## SUCCESS CRITERIA
1. Task completed successfully
2. Output stored in InteractionStore with correct domain/tags
3. Quality >= ${minQuality}
4. Response follows TASK COMPLETION SUMMARY format
${nextAgentNote}`;
  }
}

// ==================== Factory Function ====================

/**
 * Create a PipelinePromptBuilder with a given agent registry
 * @param agentRegistry - Initialized agent registry
 * @returns PipelinePromptBuilder instance
 */
export function createPipelinePromptBuilder(
  agentRegistry: AgentRegistry
): PipelinePromptBuilder {
  return new PipelinePromptBuilder(agentRegistry);
}
