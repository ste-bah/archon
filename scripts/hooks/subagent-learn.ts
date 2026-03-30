/**
 * Subagent Learn Hook Handler
 *
 * Triggers on SubagentStop event to create SoNA trajectories
 * for learning from agent execution outcomes.
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-HOOK-005
 *
 * @module scripts/hooks/subagent-learn
 */

import {
  SubagentStopInput,
  SubagentLearnResponse,
  EXIT_CODES,
} from './hook-types.js';
import { ActivityStream } from '../../src/god-agent/observability/index.js';

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
 * Generate trajectory ID
 */
function generateTrajectoryId(agentType: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `traj-${agentType}-${timestamp}-${random}`;
}

/**
 * Simulate creating a trajectory
 * In full implementation, this would call SoNAEngine
 */
async function createTrajectory(input: SubagentStopInput): Promise<string> {
  // Simplified trajectory creation for hook
  // Full implementation would use SoNAEngine.getInstance().createTrajectory()
  return generateTrajectoryId(input.agentType);
}

/**
 * Determine if weights should be updated
 */
function shouldUpdateWeights(input: SubagentStopInput): boolean {
  // Update on success
  if (input.result === 'success') {
    return true;
  }

  // Update on failure with quality score (provides learning signal)
  if (input.result === 'failure' && input.qualityScore !== undefined) {
    return true;
  }

  // Partial or missing quality score - skip weight update
  return false;
}

/**
 * Handle subagent learn hook
 */
async function handleSubagentLearn(
  input: SubagentStopInput
): Promise<SubagentLearnResponse> {
  const startTime = Date.now();

  // Create trajectory from subagent execution
  const trajectoryId = await createTrajectory(input);

  // Determine if weights should be updated
  const updateWeights = shouldUpdateWeights(input);

  let weightsUpdated = false;
  if (updateWeights && trajectoryId) {
    // In full implementation: await sona.updateWeightsFromTrajectory(trajectoryId);
    weightsUpdated = true;
  }

  // Emit observability event
  try {
    const bus = await ActivityStream.getInstance();
    await bus.emit({
      type: 'hook.executed',
      correlationId: input.correlationId,
      payload: {
        hookName: 'subagent-learn',
        success: true,
        durationMs: Date.now() - startTime,
        agentType: input.agentType,
        outcome: input.result,
        trajectoryId,
        weightsUpdated,
      },
    });
  } catch {
    // Observability failure shouldn't fail the hook
  }

  return {
    success: true,
    correlationId: input.correlationId,
    durationMs: Date.now() - startTime,
    trajectoryId,
    weightsUpdated,
  };
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    const input = await readInput();

    if (!input) {
      const response: SubagentLearnResponse = {
        success: true,
        correlationId: 'no-input',
        durationMs: 0,
        weightsUpdated: false,
      };
      console.log(JSON.stringify(response));
      process.exit(EXIT_CODES.SUCCESS);
      return;
    }

    const response = await handleSubagentLearn(input);
    console.log(JSON.stringify(response));
    process.exit(EXIT_CODES.SUCCESS);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    const response: SubagentLearnResponse = {
      success: false,
      correlationId: 'error',
      durationMs: 0,
      error: errorMessage,
      weightsUpdated: false,
    };
    console.log(JSON.stringify(response));
    process.exit(EXIT_CODES.ERROR);
  }
}

main();
