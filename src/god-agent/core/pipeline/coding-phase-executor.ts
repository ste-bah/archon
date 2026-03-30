/**
 * Coding Pipeline Phase Executor
 * Extracted from coding-pipeline-orchestrator.ts for constitution.xml compliance
 *
 * Handles:
 * - Agent execution via IStepExecutor injection
 * - Timeout management for agent operations
 * - Learning feedback via SonaEngine/ReasoningBank
 * - Memory leak prevention (MEM-002 fix)
 */

import type { CodingPipelinePhase, CodingPipelineAgent, IAgentMapping } from './types.js';
import type { SonaEngine } from '../learning/sona-engine.js';
import type { IRlmContext } from '../learning/sona-types.js';
import type { ReasoningBank } from '../reasoning/reasoning-bank.js';
import { MAX_EXECUTION_RESULTS } from './coding-pipeline-constants.js';

// =============================================================================
// STEP EXECUTOR INTERFACE
// =============================================================================

/**
 * Interface for executing individual pipeline steps/agents
 * Must be injected via IOrchestratorConfig.stepExecutor
 */
export interface IStepExecutor {
  execute(
    agentKey: CodingPipelineAgent,
    prompt: string,
    timeoutMs: number
  ): Promise<{ output: unknown; quality: number; duration: number }>;
}

/**
 * Dependencies required for phase execution
 */
export interface IPhaseExecutorDependencies {
  sonaEngine?: SonaEngine;
  reasoningBank?: ReasoningBank;
}

/**
 * Configuration for execution order resolution
 */
export interface IExecutionOrderConfig {
  /** Enable parallel execution of independent agents */
  enableParallelExecution: boolean;
  /** Maximum agents to run in parallel (MEM-002 bounded) */
  maxParallelAgents: number;
}

// =============================================================================
// MEM-002 CRITICAL FIX - Memory Leak Prevention
// =============================================================================

/**
 * Trim execution results map to prevent unbounded memory growth
 * Uses FIFO (oldest entries removed first) pruning strategy
 *
 * CRITICAL: This function MUST be called after each agent execution
 * to prevent memory leaks in long-running pipelines
 *
 * @param executionResults - Map to trim (mutated in place)
 * @param log - Logging function
 */
export function trimExecutionResults(
  executionResults: Map<CodingPipelineAgent, unknown>,
  log: (message: string) => void
): void {
  if (executionResults.size > MAX_EXECUTION_RESULTS) {
    const entries = Array.from(executionResults.entries());
    const toRemove = entries.slice(0, entries.length - MAX_EXECUTION_RESULTS);
    for (const [key] of toRemove) {
      executionResults.delete(key);
    }
    log(`Trimmed executionResults to ${MAX_EXECUTION_RESULTS} entries (removed ${toRemove.length})`);
  }
}

// =============================================================================
// AGENT EXECUTION
// =============================================================================

/**
 * Execute an agent using the injected step executor with timeout protection
 *
 * @param stepExecutor - Injected executor (REQUIRED in production)
 * @param agentKey - Agent identifier
 * @param prompt - Prompt to execute
 * @param timeoutMs - Timeout in milliseconds
 * @returns Execution result with output, quality score, and duration
 * @throws Error if no stepExecutor provided (production safety guard)
 */
export async function executeWithStepExecutor(
  stepExecutor: IStepExecutor | undefined,
  agentKey: CodingPipelineAgent,
  prompt: string,
  timeoutMs: number
): Promise<{ output: unknown; quality: number; duration: number }> {
  if (stepExecutor) {
    return await Promise.race([
      stepExecutor.execute(agentKey, prompt, timeoutMs),
      createTimeoutPromise(agentKey, timeoutMs),
    ]);
  }

  // Production safety guard - stepExecutor is REQUIRED
  throw new Error(
    `No stepExecutor provided for agent "${agentKey}". ` +
    `You must inject a stepExecutor via IOrchestratorConfig.stepExecutor ` +
    `that implements the IStepExecutor interface. ` +
    `This is intentional - the orchestrator delegates actual agent execution ` +
    `to the caller (e.g., CommandTaskBridge).`
  );
}

/**
 * Create a timeout promise that rejects after the specified duration
 *
 * @param agentKey - Agent identifier for error message
 * @param timeout - Timeout duration in milliseconds
 * @returns Promise that always rejects with timeout error
 */
export function createTimeoutPromise(
  agentKey: CodingPipelineAgent,
  timeout: number
): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Agent ${agentKey} timed out after ${timeout}ms`));
    }, timeout);
  });
}

// =============================================================================
// LEARNING FEEDBACK
// =============================================================================

/**
 * Provide feedback for a single step/agent execution
 * Uses SonaEngine as primary, ReasoningBank as fallback
 *
 * @param dependencies - SonaEngine and ReasoningBank instances
 * @param trajectoryId - Learning trajectory identifier
 * @param quality - Quality score (0.0 - 1.0)
 * @param agentKey - Agent that was executed
 * @param phase - Pipeline phase
 * @param rlmContext - Optional RLM context for advanced learning
 * @param log - Logging function
 */
export async function provideStepFeedback(
  dependencies: IPhaseExecutorDependencies,
  trajectoryId: string,
  quality: number,
  agentKey: CodingPipelineAgent,
  phase: CodingPipelinePhase,
  rlmContext: IRlmContext | undefined,
  log: (message: string) => void
): Promise<void> {
  // Try SonaEngine first (primary learning system)
  if (dependencies.sonaEngine) {
    try {
      await dependencies.sonaEngine.provideFeedback(trajectoryId, quality, {
        skipAutoSave: false, // CRITICAL: Ensure persistence to SQLite
        rlmContext,
      });
      return;
    } catch (error) {
      log(`Warning: SonaEngine feedback failed: ${(error as Error).message}`);
      // Fall through to ReasoningBank
    }
  }

  // Fallback to ReasoningBank
  if (!dependencies.reasoningBank) {
    return;
  }

  try {
    await dependencies.reasoningBank.provideFeedback({
      trajectoryId,
      quality,
      feedback: `Coding pipeline agent ${agentKey} in phase ${phase}`,
      verdict: quality >= 0.7 ? 'correct' : 'incorrect',
    });
  } catch (error) {
    log(`Warning: Failed to provide step feedback: ${(error as Error).message}`);
  }
}

/**
 * Provide feedback for overall pipeline execution
 * Used at pipeline completion or failure
 *
 * @param dependencies - SonaEngine and ReasoningBank instances
 * @param trajectoryId - Learning trajectory identifier
 * @param quality - Overall quality score (0.0 - 1.0)
 * @param status - Pipeline completion status
 * @param errorMessage - Error message if status is 'failed'
 * @param log - Logging function
 */
export async function providePipelineFeedback(
  dependencies: IPhaseExecutorDependencies,
  trajectoryId: string,
  quality: number,
  status: 'completed' | 'failed',
  errorMessage: string | undefined,
  log: (message: string) => void
): Promise<void> {
  // Try SonaEngine first (primary learning system)
  if (dependencies.sonaEngine) {
    try {
      await dependencies.sonaEngine.provideFeedback(trajectoryId, quality, {
        skipAutoSave: false, // CRITICAL: Ensure persistence to SQLite
      });
      return;
    } catch (error) {
      log(`Warning: SonaEngine pipeline feedback failed: ${(error as Error).message}`);
      // Fall through to ReasoningBank
    }
  }

  // Fallback to ReasoningBank
  if (!dependencies.reasoningBank) {
    return;
  }

  try {
    const feedback = status === 'completed'
      ? 'Coding pipeline completed successfully'
      : `Coding pipeline failed: ${errorMessage}`;

    await dependencies.reasoningBank.provideFeedback({
      trajectoryId,
      quality,
      feedback,
      verdict: status === 'completed' ? 'correct' : 'incorrect',
    });
  } catch (error) {
    log(`Warning: Failed to provide pipeline feedback: ${(error as Error).message}`);
  }
}

// =============================================================================
// EXECUTION ORDER RESOLUTION
// =============================================================================

/**
 * Resolve execution order using topological sort based on agent dependencies
 *
 * Agents are sorted by:
 * 1. Dependency relationships (dependsOn field)
 * 2. Priority (lower number = higher priority)
 *
 * @param agents - Array of agent mappings to sort
 * @returns Agents in correct execution order (dependencies first)
 */
export function resolveExecutionOrder(agents: IAgentMapping[]): IAgentMapping[] {
  const agentMap = new Map(agents.map(a => [a.agentKey, a]));
  const visited = new Set<CodingPipelineAgent>();
  const result: IAgentMapping[] = [];

  const visit = (agentKey: CodingPipelineAgent): void => {
    if (visited.has(agentKey)) return;
    visited.add(agentKey);

    const agent = agentMap.get(agentKey);
    if (!agent) return;

    // Visit dependencies first (topological sort)
    for (const dep of agent.dependsOn ?? []) {
      if (agentMap.has(dep)) {
        visit(dep);
      }
    }

    result.push(agent);
  };

  // Sort by priority first, then apply topological sort
  const sortedByPriority = [...agents].sort((a, b) => a.priority - b.priority);
  for (const agent of sortedByPriority) {
    visit(agent.agentKey);
  }

  return result;
}

/**
 * Batch agents for parallel execution while respecting dependencies
 *
 * Creates batches where:
 * - Agents in the same batch have no dependencies on each other
 * - All dependencies are satisfied by previous batches
 * - Batch size is bounded by maxParallelAgents (MEM-002 compliance)
 *
 * @param agents - Pre-sorted agents (use resolveExecutionOrder first)
 * @param config - Execution configuration with parallel settings
 * @returns Array of batches, each containing agents that can run in parallel
 */
export function batchAgentsForExecution(
  agents: IAgentMapping[],
  config: IExecutionOrderConfig
): IAgentMapping[][] {
  // Sequential mode: each agent in its own batch
  if (!config.enableParallelExecution) {
    return agents.map(a => [a]);
  }

  const batches: IAgentMapping[][] = [];
  const executed = new Set<CodingPipelineAgent>();
  let remaining = [...agents];

  while (remaining.length > 0) {
    const batch: IAgentMapping[] = [];

    for (const agent of remaining) {
      // Check if dependencies within this phase are satisfied
      const depsInPhase = (agent.dependsOn ?? []).filter(dep =>
        agents.some(a => a.agentKey === dep)
      );
      const depsSatisfied = depsInPhase.every(dep => executed.has(dep));

      if (depsSatisfied && agent.parallelizable && batch.length < config.maxParallelAgents) {
        // Can run in parallel with current batch
        batch.push(agent);
      } else if (depsSatisfied && batch.length === 0) {
        // Non-parallelizable but deps satisfied - run alone
        batch.push(agent);
        break;
      }
    }

    // Safety: if no agents could be added, force the first remaining
    if (batch.length === 0) {
      batch.push(remaining[0]);
    }

    batches.push(batch);

    // Mark batch agents as executed
    for (const agent of batch) {
      executed.add(agent.agentKey);
    }

    // Remove executed agents from remaining
    remaining = remaining.filter(a => !executed.has(a.agentKey));
  }

  return batches;
}
