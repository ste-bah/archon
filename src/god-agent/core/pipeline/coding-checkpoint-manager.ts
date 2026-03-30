/**
 * Coding Pipeline Checkpoint Manager
 *
 * Manages checkpoint creation, rollback, and trimming for the /god-code coding pipeline.
 * Extracted from CodingPipelineOrchestrator for single-responsibility compliance.
 *
 * @module src/god-agent/core/pipeline/coding-checkpoint-manager
 * @see CONSTITUTION.md - CON-002 (< 500 lines), TS-004 (Zod), ERR-002 (typed errors)
 * @pipelineType coding
 */

import { z } from 'zod';
import type { CodingPipelinePhase, CodingPipelineAgent } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// ERR-002 COMPLIANCE: Typed Error with Error Code
// ═══════════════════════════════════════════════════════════════════════════

/** Error codes for checkpoint operations */
export type CheckpointErrorCode = 'CREATE_FAILED' | 'ROLLBACK_FAILED' | 'INVALID_CHECKPOINT';

/**
 * Typed error for checkpoint operations.
 * ERR-002 compliant with specific error codes.
 */
export class CheckpointError extends Error {
  constructor(
    public readonly code: CheckpointErrorCode,
    message: string,
    public readonly phase?: CodingPipelinePhase
  ) {
    super(message);
    this.name = 'CheckpointError';
    Object.setPrototypeOf(this, CheckpointError.prototype);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TS-004 COMPLIANCE: Zod Config Schema
// ═══════════════════════════════════════════════════════════════════════════

/** Zod schema for checkpoint configuration */
export const CheckpointConfigSchema = z.object({
  /** Enable verbose logging */
  verbose: z.boolean().optional().default(false),
  /** Maximum checkpoints to retain (1-100) */
  maxCheckpoints: z.number().min(1).max(100).optional().default(10),
});

/** Inferred type from Zod schema */
export type ICheckpointConfig = z.infer<typeof CheckpointConfigSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// CHECKPOINT INTERFACE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Represents a pipeline execution checkpoint for rollback support.
 */
export interface ICheckpoint {
  /** Phase at which checkpoint was created */
  phase: CodingPipelinePhase;
  /** Unix timestamp of checkpoint creation */
  timestamp: number;
  /** Execution results at checkpoint time */
  executionResults: Map<CodingPipelineAgent, unknown>;
  /** Agents completed at checkpoint time */
  completedAgents: Set<CodingPipelineAgent>;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECKPOINT FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Creates a checkpoint at the current pipeline state.
 *
 * @param phase - Current phase being checkpointed
 * @param executionResults - Map of agent results to snapshot
 * @param completedAgents - Set of completed agents to snapshot
 * @param log - Logging function for verbose output
 * @param config - Optional checkpoint configuration
 * @returns New checkpoint containing snapshotted state
 * @throws {CheckpointError} If checkpoint creation fails
 */
export function createCheckpoint(
  phase: CodingPipelinePhase,
  executionResults: Map<CodingPipelineAgent, unknown>,
  completedAgents: Set<CodingPipelineAgent>,
  log: (message: string) => void,
  config?: ICheckpointConfig
): ICheckpoint {
  const parsedConfig = CheckpointConfigSchema.parse(config ?? {});

  try {
    const checkpoint: ICheckpoint = {
      phase,
      timestamp: Date.now(),
      executionResults: new Map(executionResults),
      completedAgents: new Set(completedAgents),
    };

    if (parsedConfig.verbose) {
      log(`[Checkpoint] Created at phase '${phase}' with ${completedAgents.size} agents`);
    }

    return checkpoint;
  } catch (error) {
    throw new CheckpointError(
      'CREATE_FAILED',
      `Failed to create checkpoint at phase '${phase}': ${error instanceof Error ? error.message : String(error)}`,
      phase
    );
  }
}

/**
 * Rolls back to the last checkpoint in the stack.
 *
 * @param checkpoints - Array of checkpoints to roll back from
 * @param log - Logging function for verbose output
 * @param config - Optional checkpoint configuration
 * @returns Restored state or null if no checkpoints exist
 * @throws {CheckpointError} If rollback fails
 */
export function rollbackToLastCheckpoint(
  checkpoints: ICheckpoint[],
  log: (message: string) => void,
  config?: ICheckpointConfig
): {
  phase: CodingPipelinePhase;
  executionResults: Map<CodingPipelineAgent, unknown>;
  completedAgents: Set<CodingPipelineAgent>;
} | null {
  const parsedConfig = CheckpointConfigSchema.parse(config ?? {});

  if (checkpoints.length === 0) {
    if (parsedConfig.verbose) {
      log('[Checkpoint] No checkpoints available for rollback');
    }
    return null;
  }

  try {
    const lastCheckpoint = checkpoints[checkpoints.length - 1];

    if (parsedConfig.verbose) {
      log(`[Checkpoint] Rolling back to phase '${lastCheckpoint.phase}' (${lastCheckpoint.completedAgents.size} agents)`);
    }

    return {
      phase: lastCheckpoint.phase,
      executionResults: new Map(lastCheckpoint.executionResults),
      completedAgents: new Set(lastCheckpoint.completedAgents),
    };
  } catch (error) {
    throw new CheckpointError(
      'ROLLBACK_FAILED',
      `Failed to rollback to checkpoint: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Trims the checkpoint array to maintain maximum checkpoint limit.
 * Removes oldest checkpoints first (FIFO).
 *
 * @param checkpoints - Array of checkpoints to trim (mutated in place)
 * @param maxCheckpoints - Maximum number of checkpoints to retain
 * @param log - Logging function for verbose output
 */
export function trimCheckpoints(
  checkpoints: ICheckpoint[],
  maxCheckpoints: number,
  log: (message: string) => void
): void {
  const toRemove = checkpoints.length - maxCheckpoints;

  if (toRemove > 0) {
    checkpoints.splice(0, toRemove);
    log(`[Checkpoint] Trimmed ${toRemove} oldest checkpoint(s), ${checkpoints.length} remaining`);
  }
}
