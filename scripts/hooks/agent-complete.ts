/**
 * Agent Complete Hook Handler
 *
 * Triggers on SubagentStop event to create GraphDB hyperedges
 * for high-quality agent completions (quality >= 0.7).
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-HOOK-006
 *
 * @module scripts/hooks/agent-complete
 */

import {
  SubagentStopInput,
  AgentCompleteResponse,
  EXIT_CODES,
} from './hook-types.js';
import { ActivityStream } from '../../src/god-agent/observability/index.js';

/** Quality threshold per constitution (HYPER-02) */
const QUALITY_THRESHOLD = 0.7;
/** Hyperedge expiration in hours (7 days) */
const HYPEREDGE_EXPIRATION_HOURS = 168;

/**
 * Parse input from stdin
 */
async function readInput(): Promise<SubagentStopInput | null> {
  const chunks: string[] = [];

  process.stdin.setEncoding('utf-8');

  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  const input = chunks.join('');
  if (!input || input.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(input) as SubagentStopInput;
  } catch {
    return null;
  }
}

/**
 * Hash task description for node ID
 */
function hashTaskDescription(description: string): string {
  let hash = 0;
  for (let i = 0; i < description.length; i++) {
    const char = description.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).substring(0, 8);
}

/**
 * Generate hyperedge ID
 */
function generateHyperedgeId(agentType: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `he-${agentType}-${timestamp}-${random}`;
}

/**
 * Simulate creating a hyperedge
 * In full implementation, this would call GraphDB
 */
async function createHyperedge(input: SubagentStopInput): Promise<string> {
  // Build hyperedge nodes from task context
  const _nodes = [
    `agent:${input.agentType}`,
    `task:${hashTaskDescription(input.taskDescription)}`,
    `outcome:success`,
    `quality:high`,
  ];

  // In full implementation:
  // const graphDb = await GraphDB.getInstance();
  // return await graphDb.createHyperedge({
  //   nodes,
  //   type: 'task_completion',
  //   metadata: { ... },
  //   qualityScore: input.qualityScore,
  //   expirationHours: HYPEREDGE_EXPIRATION_HOURS
  // });

  return generateHyperedgeId(input.agentType);
}

/**
 * Handle agent complete hook
 */
async function handleAgentComplete(
  input: SubagentStopInput
): Promise<AgentCompleteResponse> {
  const startTime = Date.now();

  // Check if quality threshold is met
  const qualityScore = input.qualityScore ?? 0;
  const qualityThresholdMet = qualityScore >= QUALITY_THRESHOLD;

  let hyperedgeId: string | undefined;

  // Only create hyperedge for high-quality success outcomes
  if (qualityThresholdMet && input.result === 'success') {
    hyperedgeId = await createHyperedge(input);
  }

  // Emit observability event
  try {
    const bus = await ActivityStream.getInstance();
    await bus.emit({
      type: 'hook.executed',
      correlationId: input.correlationId,
      payload: {
        hookName: 'agent-complete',
        success: true,
        durationMs: Date.now() - startTime,
        agentType: input.agentType,
        qualityScore,
        qualityThresholdMet,
        hyperedgeCreated: !!hyperedgeId,
      },
    });
  } catch {
    // Observability failure shouldn't fail the hook
  }

  return {
    success: true,
    correlationId: input.correlationId,
    durationMs: Date.now() - startTime,
    hyperedgeId,
    qualityThresholdMet,
  };
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    const input = await readInput();

    if (!input) {
      const response: AgentCompleteResponse = {
        success: true,
        correlationId: 'no-input',
        durationMs: 0,
        qualityThresholdMet: false,
      };
      console.log(JSON.stringify(response));
      process.exit(EXIT_CODES.SUCCESS);
      return;
    }

    const response = await handleAgentComplete(input);
    console.log(JSON.stringify(response));
    process.exit(EXIT_CODES.SUCCESS);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    const response: AgentCompleteResponse = {
      success: false,
      correlationId: 'error',
      durationMs: 0,
      error: errorMessage,
      qualityThresholdMet: false,
    };
    console.log(JSON.stringify(response));
    process.exit(EXIT_CODES.ERROR);
  }
}

main();
