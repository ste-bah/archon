/**
 * CodingPipelineInference - Agent dependency and reward inference functions
 *
 * Extracted from coding-pipeline-config-loader.ts for modularity.
 * Provides inference logic for agent dependencies, memory access patterns, and XP rewards.
 *
 * @module src/god-agent/core/pipeline/coding-pipeline-inference
 * @see TS-004 (Zod validation)
 * @see ERR-002 (Error handling)
 */

import { z } from 'zod';
import type { CodingPipelineAgent, CodingPipelinePhase } from './types.js';
import { CRITICAL_AGENT_KEYS } from './coding-pipeline-constants.js';

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMAS (TS-004)
// ═══════════════════════════════════════════════════════════════════════════

/** Schema for phase agent input */
const PhaseAgentSchema = z.object({
  key: z.string(),
  phase: z.string(),
  order: z.number(),
});

/** Schema for inference input */
export const InferenceInputSchema = z.object({
  agentKey: z.string(),
  phaseAgents: z.array(PhaseAgentSchema),
});

/** Minimal agent info needed for inference */
export interface PhaseAgentInfo {
  key: string;
  phase: CodingPipelinePhase;
  order: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// INTRA-PHASE DEPENDENCY MAP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Explicit intra-phase dependency map based on real data flow.
 * Agents not listed (or with empty arrays) have no intra-phase dependencies
 * and can run in parallel with other independent agents in the same phase.
 * Cross-phase ordering is handled by the orchestrator's phase loop.
 *
 * maxParallelAgents=3, so batches contain up to 3 parallel agents.
 * Critical agents (parallelizable=false) always run alone regardless.
 */
const INTRA_PHASE_DEPS: Record<string, string[]> = {
  // Phase 1: Understanding — task-analyzer, scope-definer, context-gatherer run in parallel
  // phase-1-reviewer gates progression to Phase 2
  'requirement-extractor': ['task-analyzer'],
  'requirement-prioritizer': ['requirement-extractor'],
  'feasibility-analyzer': ['requirement-prioritizer', 'scope-definer', 'context-gatherer'],
  'phase-1-reviewer': ['feasibility-analyzer'],

  // Phase 2: Exploration — pattern-explorer, technology-scout, codebase-analyzer run in parallel
  // phase-2-reviewer gates progression to Phase 3
  'research-planner': ['pattern-explorer', 'technology-scout', 'codebase-analyzer'],
  'phase-2-reviewer': ['research-planner'],

  // Phase 3: Architecture — system-designer runs first (critical, alone)
  // phase-3-reviewer gates progression to Phase 4
  'component-designer': ['system-designer'],
  'interface-designer': ['system-designer'],
  'data-architect': ['system-designer'],
  'integration-architect': ['component-designer', 'interface-designer', 'data-architect'],
  'phase-3-reviewer': ['integration-architect'],

  // Phase 4: Implementation — code-generator runs first (critical, alone)
  // phase-4-reviewer gates progression to Phase 5
  'type-implementer': ['code-generator'],
  'error-handler-implementer': ['code-generator'],
  'config-implementer': ['code-generator'],
  'logger-implementer': ['code-generator'],
  'unit-implementer': ['type-implementer'],
  'service-implementer': ['type-implementer'],
  'data-layer-implementer': ['type-implementer'],
  'api-implementer': ['service-implementer'],
  'frontend-implementer': ['api-implementer'],
  'dependency-manager': [
    'unit-implementer', 'frontend-implementer', 'data-layer-implementer',
    'error-handler-implementer', 'config-implementer', 'logger-implementer',
  ],
  'implementation-coordinator': ['dependency-manager'],
  'phase-4-reviewer': ['implementation-coordinator'],

  // Phase 5: Testing — test-generator runs first, then 3 testers in parallel
  // test-fixer fixes bugs found by quality-gate
  // phase-5-reviewer gates progression to Phase 6
  'test-runner': ['test-generator'],
  'integration-tester': ['test-runner'],
  'regression-tester': ['test-runner'],
  'security-tester': ['test-runner'],
  'coverage-analyzer': ['integration-tester', 'regression-tester', 'security-tester'],
  'quality-gate': ['coverage-analyzer'],
  'test-fixer': ['quality-gate'],
  'phase-5-reviewer': ['test-fixer'],

  // Phase 6: Optimization — first 3 run in parallel, then security-architect, then final
  // phase-6-reviewer gates progression to Phase 7
  'security-architect': ['performance-optimizer', 'performance-architect', 'code-quality-improver'],
  'final-refactorer': ['security-architect'],
  'phase-6-reviewer': ['final-refactorer'],

  // Phase 7: Delivery — recovery-agent reads all reviewer verdicts (cross-phase memory),
  // sign-off-approver is the final gate
  'sign-off-approver': ['recovery-agent'],
};

// ═══════════════════════════════════════════════════════════════════════════
// INFERENCE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Infer dependencies from explicit dependency map and phase position.
 *
 * Uses INTRA_PHASE_DEPS for real data-flow dependencies within phases.
 * Cross-phase: first agent in each phase depends on last agent of previous phase.
 * The batching code filters deps to intra-phase only, so cross-phase deps are metadata.
 *
 * @param agentKey - The agent key to infer dependencies for
 * @param phaseAgents - All agents in the pipeline sorted by order
 * @returns Array of dependent agent keys, or undefined if no dependencies
 */
export function inferDependencies(
  agentKey: string,
  phaseAgents: PhaseAgentInfo[]
): CodingPipelineAgent[] | undefined {
  const agent = phaseAgents.find(a => a.key === agentKey);
  if (!agent) {
    return undefined;
  }

  const deps: CodingPipelineAgent[] = [];

  // Cross-phase: first agent in phase depends on last agent of previous phase
  const samePhaseAgents = phaseAgents.filter(a => a.phase === agent.phase);
  const isFirstInPhase = samePhaseAgents.length > 0 && samePhaseAgents[0].key === agentKey;

  if (isFirstInPhase && agent.order > 1) {
    const prevAgent = phaseAgents.find(a => a.order === agent.order - 1);
    if (prevAgent) {
      deps.push(prevAgent.key as CodingPipelineAgent);
    }
  }

  // Intra-phase: explicit dependency map
  const intraDeps = INTRA_PHASE_DEPS[agentKey];
  if (intraDeps) {
    for (const dep of intraDeps) {
      deps.push(dep as CodingPipelineAgent);
    }
  }

  return deps.length > 0 ? deps : undefined;
}

/**
 * Infer memory read keys from agent phase
 *
 * Rules:
 * - Agents read from previous phase's memory namespace
 * - First agent (order=1) reads from input/task and context/project
 *
 * @param agentKey - The agent key
 * @param phaseAgents - All agents to determine phase
 * @returns Array of memory keys this agent should read
 */
export function inferMemoryReads(
  agentKey: string,
  phaseAgents: PhaseAgentInfo[]
): string[] {
  const agent = phaseAgents.find(a => a.key === agentKey);
  if (!agent) {
    return [];
  }

  const reads: string[] = [];
  const phaseOrder: CodingPipelinePhase[] = [
    'understanding', 'exploration', 'architecture',
    'implementation', 'testing', 'optimization', 'delivery'
  ];
  const currentIdx = phaseOrder.indexOf(agent.phase);

  // Read from previous phase
  if (currentIdx > 0) {
    reads.push(`coding/${phaseOrder[currentIdx - 1]}`);
  }

  // First agent reads from input/context
  if (agent.order === 1) {
    reads.push('coding/input/task');
    reads.push('coding/context/project');
  }

  return reads;
}

/**
 * Infer memory write keys from agent
 *
 * @param agentKey - The agent key
 * @returns Array of memory keys this agent writes to
 */
export function inferMemoryWrites(agentKey: string): string[] {
  // Extract phase from agent key pattern or use generic pattern
  // The orchestrator will provide the actual phase context
  return [`coding/agent/${agentKey}`];
}

/**
 * Calculate XP reward based on agent criticality and type
 *
 * Reward tiers:
 * - Base: 50 XP
 * - Critical agents: +50 XP
 * - Sherlock reviewers: +50 XP
 *
 * @param agentKey - The agent key
 * @param isCritical - Whether the agent is marked as critical
 * @returns XP reward value
 */
export function calculateXPReward(agentKey: string, isCritical: boolean): number {
  let baseXP = 50;

  // Critical agents get more XP
  if (isCritical || CRITICAL_AGENT_KEYS.has(agentKey)) {
    baseXP += 50;
  }

  // Sherlock reviewers get bonus XP
  if (agentKey.includes('reviewer') || agentKey === 'recovery-agent') {
    baseXP += 50;
  }

  return baseXP;
}
