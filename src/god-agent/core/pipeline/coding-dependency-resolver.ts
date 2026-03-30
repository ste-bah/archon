/**
 * Coding Pipeline Dependency Resolver
 * Extracted from coding-pipeline-orchestrator.ts for constitution.xml compliance
 *
 * Handles:
 * - Topological sort for agent execution ordering
 * - Parallel batching with dependency awareness
 */

import type { CodingPipelineAgent, IAgentMapping } from './types.js';

// =============================================================================
// DEPENDENCY RESOLUTION
// =============================================================================

/**
 * Resolve execution order for agents within a phase
 * Uses topological sort based on dependencies
 *
 * @param agents - Array of agent mappings to order
 * @returns Ordered array with dependencies resolved
 */
export function resolveExecutionOrder(agents: IAgentMapping[]): IAgentMapping[] {
  const agentMap = new Map(agents.map(a => [a.agentKey, a]));
  const visited = new Set<CodingPipelineAgent>();
  const result: IAgentMapping[] = [];

  const visit = (agentKey: CodingPipelineAgent) => {
    if (visited.has(agentKey)) return;
    visited.add(agentKey);

    const agent = agentMap.get(agentKey);
    if (!agent) return;

    // Visit dependencies first (within this phase only)
    for (const dep of agent.dependsOn ?? []) {
      if (agentMap.has(dep)) {
        visit(dep);
      }
    }
    result.push(agent);
  };

  // Sort by priority first, then visit
  const sortedByPriority = [...agents].sort((a, b) => a.priority - b.priority);
  for (const agent of sortedByPriority) {
    visit(agent.agentKey);
  }
  return result;
}

// =============================================================================
// PARALLEL BATCHING
// =============================================================================

/**
 * Batch agents for parallel execution where allowed
 * Groups agents whose dependencies are satisfied into batches
 *
 * @param agents - Ordered array of agent mappings
 * @param enableParallel - Whether parallel execution is enabled
 * @param maxParallelAgents - Maximum agents per batch
 * @returns Array of batches, each containing agents that can run in parallel
 */
export function batchAgentsForExecution(
  agents: IAgentMapping[],
  enableParallel: boolean,
  maxParallelAgents: number
): IAgentMapping[][] {
  // If parallel disabled, each agent runs sequentially
  if (!enableParallel) {
    return agents.map(a => [a]);
  }

  const batches: IAgentMapping[][] = [];
  const executed = new Set<CodingPipelineAgent>();
  let remaining = [...agents];

  while (remaining.length > 0) {
    const batch: IAgentMapping[] = [];

    for (const agent of remaining) {
      // Check if all dependencies within this phase are satisfied
      const depsInPhase = (agent.dependsOn ?? []).filter(dep =>
        agents.some(a => a.agentKey === dep)
      );
      const depsSatisfied = depsInPhase.every(dep => executed.has(dep));

      if (depsSatisfied && agent.parallelizable && batch.length < maxParallelAgents) {
        batch.push(agent);
      } else if (depsSatisfied && batch.length === 0) {
        // Non-parallelizable agent with satisfied deps - run alone
        batch.push(agent);
        break;
      }
    }

    // Fallback: if no agent could be added, take the first remaining
    if (batch.length === 0) {
      batch.push(remaining[0]);
    }

    batches.push(batch);
    for (const agent of batch) {
      executed.add(agent.agentKey);
    }
    remaining = remaining.filter(a => !executed.has(a.agentKey));
  }

  return batches;
}
