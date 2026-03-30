/**
 * DAI-002: Agent File Mapper
 *
 * Maps coding pipeline agent keys to their .md agent files and generates
 * ClaudeFlow-compliant Task() prompts for pipeline orchestration.
 *
 * This is the MISSING PIECE that connects:
 * - TypeScript agent definitions (CODING_PIPELINE_MAPPINGS)
 * - Actual .md agent files (.claude/agents/coding-pipeline/*.md)
 * - god-code.md pipeline execution
 *
 * @module src/god-agent/core/pipeline/agent-file-mapper
 * @see god-code.md
 * @see coding-pipeline-dag-builder.ts
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import type {
  CodingPipelineAgent,
  CodingPipelinePhase,
  IAgentMapping,
  IPipelineDAG,
} from './types.js';

import {
  PHASE_ORDER,
  SHERLOCK_AGENTS,
  MEMORY_PREFIXES,
  CRITICAL_AGENTS,
} from './types.js';

import {
  CODING_PIPELINE_MAPPINGS,
  buildPipelineDAG,
  getAgentByKey,
  getPhaseExecutionOrder,
} from './coding-pipeline-dag-builder.js';

// ═══════════════════════════════════════════════════════════════════════════
// PATH RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the project root directory.
 * Handles both ESM and CommonJS contexts.
 */
function getProjectRoot(): string {
  // Try multiple resolution strategies
  const strategies = [
    // From current file location (src/god-agent/core/pipeline/)
    () => {
      try {
        const currentDir = dirname(fileURLToPath(import.meta.url));
        return join(currentDir, '..', '..', '..', '..');
      } catch {
        return null;
      }
    },
    // From process.cwd()
    () => process.cwd(),
    // From __dirname if available
    () => {
      if (typeof __dirname !== 'undefined') {
        return join(__dirname, '..', '..', '..', '..');
      }
      return null;
    },
  ];

  for (const strategy of strategies) {
    const root = strategy();
    if (root && existsSync(join(root, '.claude', 'agents', 'coding-pipeline'))) {
      return root;
    }
  }

  // Fallback to cwd
  return process.cwd();
}

const PROJECT_ROOT = getProjectRoot();
const AGENTS_DIR = join(PROJECT_ROOT, '.claude', 'agents', 'coding-pipeline');

// ═══════════════════════════════════════════════════════════════════════════
// AGENT FILE MAPPING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the file path for an agent's .md definition file.
 *
 * @param agentKey - The agent key (e.g., 'task-analyzer')
 * @returns Absolute path to the agent's .md file
 */
export function getAgentFilePath(agentKey: CodingPipelineAgent): string {
  return join(AGENTS_DIR, `${agentKey}.md`);
}

/**
 * Check if an agent's .md file exists.
 *
 * @param agentKey - The agent key
 * @returns True if the file exists
 */
export function agentFileExists(agentKey: CodingPipelineAgent): boolean {
  return existsSync(getAgentFilePath(agentKey));
}

/**
 * Read an agent's .md file content.
 *
 * @param agentKey - The agent key
 * @returns Promise resolving to the file content
 * @throws Error if file doesn't exist
 */
export async function getAgentPromptContent(agentKey: CodingPipelineAgent): Promise<string> {
  const filePath = getAgentFilePath(agentKey);
  if (!existsSync(filePath)) {
    throw new Error(`Agent file not found: ${filePath}`);
  }
  return readFile(filePath, 'utf-8');
}

/**
 * Extract the agent instructions from the .md file (content after frontmatter).
 *
 * @param content - Full .md file content
 * @returns The instructions section (after YAML frontmatter)
 */
export function extractAgentInstructions(content: string): string {
  // Split by frontmatter delimiter
  const parts = content.split('---');
  if (parts.length >= 3) {
    // Return everything after the second '---'
    return parts.slice(2).join('---').trim();
  }
  return content;
}

// ═══════════════════════════════════════════════════════════════════════════
// PIPELINE EXECUTION PLAN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execution step for a single agent in the pipeline.
 */
export interface IPipelineExecutionStep {
  /** Step number (1-47) */
  stepNumber: number;
  /** Agent key */
  agentKey: CodingPipelineAgent;
  /** Phase this agent belongs to */
  phase: CodingPipelinePhase;
  /** Is this a Sherlock forensic reviewer? */
  isSherlockReviewer: boolean;
  /** Is this a critical agent that halts pipeline on failure? */
  isCritical: boolean;
  /** Agents that must complete before this one */
  dependsOn: CodingPipelineAgent[];
  /** Memory keys to read from previous agents */
  memoryReads: string[];
  /** Memory keys this agent will write */
  memoryWrites: string[];
  /** Path to agent .md file */
  filePath: string;
  /** Algorithm to use */
  algorithm: string;
  /** XP reward for completion */
  xpReward: number;
}

/**
 * Phase boundary marker in the execution plan.
 */
export interface IPhaseBoundary {
  /** Phase name */
  phase: CodingPipelinePhase;
  /** Phase number (1-7) */
  phaseNumber: number;
  /** First agent step in this phase */
  startStep: number;
  /** Last agent step in this phase (excluding Sherlock) */
  endStep: number;
  /** Sherlock reviewer step for this phase */
  sherlockStep: number;
  /** Total agents in phase (including Sherlock) */
  agentCount: number;
}

/**
 * Complete pipeline execution plan.
 */
export interface IPipelineExecutionPlan {
  /** All 47 agents in topological execution order */
  steps: IPipelineExecutionStep[];
  /** Phase boundaries for checkpointing */
  phaseBoundaries: IPhaseBoundary[];
  /** Total XP available in pipeline */
  totalXP: number;
  /** Total agents */
  totalAgents: number;
  /** DAG structure */
  dag: IPipelineDAG;
}

/**
 * Build the complete pipeline execution plan with all 47 agents in
 * topological order, phase boundaries, and Sherlock gates.
 *
 * @returns Complete execution plan
 */
export function buildPipelineExecutionPlan(): IPipelineExecutionPlan {
  const dag = buildPipelineDAG();
  const steps: IPipelineExecutionStep[] = [];
  const phaseBoundaries: IPhaseBoundary[] = [];

  let stepNumber = 0;
  let totalXP = 0;

  // Process phases in order
  for (let phaseIdx = 0; phaseIdx < PHASE_ORDER.length; phaseIdx++) {
    const phase = PHASE_ORDER[phaseIdx];
    const phaseAgents = getPhaseExecutionOrder(phase);
    const phaseStartStep = stepNumber + 1;
    let phaseEndStep = phaseStartStep;
    let sherlockStep = -1;

    for (const agentKey of phaseAgents) {
      stepNumber++;
      const mapping = getAgentByKey(agentKey);
      if (!mapping) continue;

      const isSherlockReviewer = SHERLOCK_AGENTS.includes(agentKey as any);
      const isCritical = CRITICAL_AGENTS.includes(agentKey);

      if (isSherlockReviewer) {
        sherlockStep = stepNumber;
      } else {
        phaseEndStep = stepNumber;
      }

      steps.push({
        stepNumber,
        agentKey,
        phase,
        isSherlockReviewer,
        isCritical,
        dependsOn: mapping.dependsOn ?? [],
        memoryReads: mapping.memoryReads,
        memoryWrites: mapping.memoryWrites,
        filePath: getAgentFilePath(agentKey),
        algorithm: mapping.algorithm,
        xpReward: mapping.xpReward,
      });

      totalXP += mapping.xpReward;
    }

    phaseBoundaries.push({
      phase,
      phaseNumber: phaseIdx + 1,
      startStep: phaseStartStep,
      endStep: phaseEndStep,
      sherlockStep,
      agentCount: phaseAgents.length,
    });
  }

  return {
    steps,
    phaseBoundaries,
    totalXP,
    totalAgents: steps.length,
    dag,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CLAUDE FLOW TASK PROMPT GENERATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Memory context passed to agents.
 */
export interface IMemoryContext {
  [key: string]: unknown;
}

/**
 * Generate a ClaudeFlow-compliant Task() prompt for an agent.
 *
 * @param agentKey - The agent to generate prompt for
 * @param taskDescription - The original user task
 * @param memoryContext - Retrieved memory from previous agents
 * @param stepInfo - Optional step information for WORKFLOW CONTEXT
 * @returns Complete prompt string for Task()
 */
export async function generateTaskPrompt(
  agentKey: CodingPipelineAgent,
  taskDescription: string,
  memoryContext: IMemoryContext = {},
  stepInfo?: {
    stepNumber: number;
    totalSteps: number;
    phase: CodingPipelinePhase;
    phaseNumber: number;
    previousAgents: string[];
    nextAgents: string[];
  }
): Promise<string> {
  const mapping = getAgentByKey(agentKey);
  if (!mapping) {
    throw new Error(`Unknown agent: ${agentKey}`);
  }

  // Read agent instructions from .md file
  let agentInstructions = '';
  try {
    const content = await getAgentPromptContent(agentKey);
    agentInstructions = extractAgentInstructions(content);
  } catch {
    agentInstructions = mapping.description ?? `Execute ${agentKey} task`;
  }

  // Build WORKFLOW CONTEXT
  const workflowContext = stepInfo
    ? `Agent #${stepInfo.stepNumber} of ${stepInfo.totalSteps} | Phase ${stepInfo.phaseNumber}: ${stepInfo.phase}
Previous: ${stepInfo.previousAgents.length > 0 ? stepInfo.previousAgents.join(', ') + ' ✓' : 'None (pipeline entry)'}
Next: ${stepInfo.nextAgents.length > 0 ? stepInfo.nextAgents.join(', ') : 'None (final agent)'}`
    : `Agent: ${agentKey} | Phase: ${mapping.phase}`;

  // Build MEMORY RETRIEVAL section
  const memoryRetrievalCommands = mapping.memoryReads
    .map(key => `mcp__memorygraph__recall_memories with query "${key}"`)
    .join('\n');

  const memoryContextStr = Object.keys(memoryContext).length > 0
    ? `\nRetrieved context:\n${JSON.stringify(memoryContext, null, 2)}`
    : '';

  // Build MEMORY STORAGE section
  const memoryStorageInstructions = mapping.memoryWrites
    .map((key, idx) => `${idx + 1}. Store to key "${key}" - [Your ${agentKey} output]`)
    .join('\n');

  // Build the complete prompt
  const prompt = `## YOUR TASK
${agentInstructions}

**Original Task:** ${taskDescription}

## WORKFLOW CONTEXT
${workflowContext}

## MEMORY RETRIEVAL
${memoryRetrievalCommands || 'No prior memories required (pipeline entry point)'}
${memoryContextStr}

## MEMORY STORAGE (For Next Agents)
${memoryStorageInstructions}

## STEPS
1. ${mapping.memoryReads.length > 0 ? 'Retrieve memories from previous agents' : 'Begin analysis (no prior memories)'}
2. Execute your specialized task using algorithm: ${mapping.algorithm}
3. Store output to memory for next agents
4. Verify storage: ${mapping.memoryWrites.map(k => `mcp__memorygraph__recall_memories with query "${k}"`).join(' && ')}

## SUCCESS CRITERIA
- Task complete per agent specification
- All outputs stored to memory keys: ${mapping.memoryWrites.join(', ')}
- Ready for next agent in sequence
${mapping.critical ? '\n**CRITICAL AGENT**: Pipeline halts on failure. Be thorough.' : ''}

## XP REWARD
${mapping.xpReward} XP on successful completion`;

  return prompt;
}

/**
 * Generate a Sherlock forensic review prompt for phase gate.
 *
 * @param reviewerKey - The Sherlock reviewer agent key
 * @param phase - The phase being reviewed
 * @param phaseNumber - Phase number (1-7)
 * @param taskDescription - Original task
 * @returns Complete Sherlock review prompt
 */
export async function generateSherlockPrompt(
  reviewerKey: CodingPipelineAgent,
  phase: CodingPipelinePhase,
  phaseNumber: number,
  taskDescription: string
): Promise<string> {
  const mapping = getAgentByKey(reviewerKey);
  if (!mapping) {
    throw new Error(`Unknown Sherlock agent: ${reviewerKey}`);
  }

  // Read agent instructions
  let agentInstructions = '';
  try {
    const content = await getAgentPromptContent(reviewerKey);
    agentInstructions = extractAgentInstructions(content);
  } catch {
    agentInstructions = `Forensic review of Phase ${phaseNumber}: ${phase}`;
  }

  const memoryReads = mapping.memoryReads
    .map(key => `mcp__memorygraph__recall_memories with query "${key}"`)
    .join('\n');

  return `## YOUR TASK
FORENSIC REVIEW of Phase ${phaseNumber} (${phase}) output.

${agentInstructions}

**Original Task:** ${taskDescription}

## WORKFLOW CONTEXT
Sherlock Forensic Reviewer | Phase ${phaseNumber} Gate | ALL CODE IS GUILTY UNTIL PROVEN INNOCENT

## MEMORY RETRIEVAL
Retrieve ALL Phase ${phaseNumber} agent outputs:
${memoryReads}

## VERDICT CRITERIA
Issue ONE of these verdicts:

- **INNOCENT**: Phase passed all quality gates. Evidence supports proceeding to Phase ${phaseNumber + 1}.
- **GUILTY**: Phase failed. Critical issues found. Pipeline MUST HALT for remediation.
- **INSUFFICIENT_EVIDENCE**: Cannot determine. Need more data before verdict.

## MEMORY STORAGE
Store verdict to: ${mapping.memoryWrites[0]}

Format:
\`\`\`json
{
  "verdict": "INNOCENT|GUILTY|INSUFFICIENT_EVIDENCE",
  "confidence": "HIGH|MEDIUM|LOW",
  "evidence": [...],
  "issues": [...],
  "reasoning": "...",
  "remediation": "..." // if GUILTY
}
\`\`\`

## ON GUILTY VERDICT
DO NOT proceed to next phase. Store detailed issues for recovery-agent intervention.

## CRITICAL GATE STATUS
This is a CRITICAL pipeline gate. Your verdict determines if the pipeline continues.
XP Reward: ${mapping.xpReward} XP`;
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate that all agent .md files exist.
 *
 * @returns Array of missing agent files
 */
export function validateAgentFiles(): string[] {
  const missing: string[] = [];
  for (const mapping of CODING_PIPELINE_MAPPINGS) {
    if (!agentFileExists(mapping.agentKey)) {
      missing.push(mapping.agentKey);
    }
  }
  return missing;
}

/**
 * Get validation summary for the pipeline.
 */
export function getPipelineValidationSummary(): {
  totalAgents: number;
  existingFiles: number;
  missingFiles: string[];
  valid: boolean;
} {
  const missing = validateAgentFiles();
  return {
    totalAgents: CODING_PIPELINE_MAPPINGS.length,
    existingFiles: CODING_PIPELINE_MAPPINGS.length - missing.length,
    missingFiles: missing,
    valid: missing.length === 0,
  };
}
