/**
 * Coding Pipeline Finalization
 *
 * Extracted finalization logic for the coding pipeline orchestrator.
 * Handles learning feedback, XP aggregation, and result building.
 *
 * @module src/god-agent/core/pipeline/coding-pipeline-finalize
 * @see coding-pipeline-orchestrator.ts
 */

import type {
  CodingPipelinePhase,
  IPhaseExecutionResult,
  IPipelineExecutionResult,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Input data for pipeline finalization
 */
export interface IPipelineFinalizeInput {
  /** Whether pipeline completed successfully */
  success: boolean;
  /** Results from all executed phases */
  phaseResults: IPhaseExecutionResult[];
  /** List of successfully completed phases */
  completedPhases: CodingPipelinePhase[];
  /** Phase that failed (if any) */
  failedPhase?: CodingPipelinePhase;
  /** Whether rollback was applied after failure */
  rollbackApplied: boolean;
  /** Error message if pipeline failed */
  errorMessage?: string;
  /** Pipeline start time (Date.now()) */
  startTime: number;
  /** Total XP accumulated */
  totalXP: number;
  /** Pipeline execution ID */
  pipelineId: string;
  /** Trajectory ID for learning */
  trajectoryId: string;
}

/**
 * Finalization result with computed metrics
 */
export interface IPipelineFinalizeResult {
  /** Final pipeline execution result */
  result: IPipelineExecutionResult;
  /** Execution time in milliseconds */
  executionTimeMs: number;
  /** Calculated pipeline quality (0-1) */
  quality: number;
  /** Learning feedback status */
  feedbackStatus: 'completed' | 'failed' | 'skipped';
}

/**
 * Memory state for final pipeline state storage
 */
export interface IFinalPipelineState {
  status: 'completed' | 'failed';
  endTime: string;
  executionTimeMs: number;
  totalXP: number;
  completedPhases: CodingPipelinePhase[];
  failedPhase?: CodingPipelinePhase;
  rollbackApplied: boolean;
}

/**
 * Observability event metadata for pipeline completion
 */
export interface IPipelineCompletedMetadata {
  pipelineId: string;
  success: boolean;
  totalXP: number;
  completedPhases: CodingPipelinePhase[];
  failedPhase?: CodingPipelinePhase;
  rollbackApplied: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// FINALIZATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate execution time from start time.
 *
 * @param startTime - Pipeline start time (Date.now())
 * @returns Execution time in milliseconds
 */
export function calculateExecutionTime(startTime: number): number {
  return Date.now() - startTime;
}

/**
 * Calculate overall pipeline quality from phase results.
 *
 * Quality is the ratio of successful agents to total agents.
 *
 * @param phaseResults - Results from all executed phases
 * @returns Quality score between 0 and 1
 */
export function calculatePipelineQuality(phaseResults: IPhaseExecutionResult[]): number {
  if (phaseResults.length === 0) return 0;

  const totalAgents = phaseResults.reduce(
    (sum, p) => sum + p.agentResults.length,
    0
  );
  const successfulAgents = phaseResults.reduce(
    (sum, p) => sum + p.agentResults.filter(a => a.success).length,
    0
  );

  return totalAgents > 0 ? successfulAgents / totalAgents : 0;
}

/**
 * Build final pipeline state for memory storage.
 *
 * @param input - Finalization input data
 * @param executionTimeMs - Calculated execution time
 * @returns Final pipeline state object
 */
export function buildFinalPipelineState(
  input: IPipelineFinalizeInput,
  executionTimeMs: number
): IFinalPipelineState {
  return {
    status: input.failedPhase ? 'failed' : 'completed',
    endTime: new Date().toISOString(),
    executionTimeMs,
    totalXP: input.totalXP,
    completedPhases: input.completedPhases,
    failedPhase: input.failedPhase,
    rollbackApplied: input.rollbackApplied,
  };
}

/**
 * Build observability metadata for pipeline completion event.
 *
 * @param input - Finalization input data
 * @returns Metadata object for ObservabilityBus event
 */
export function buildCompletedMetadata(
  input: IPipelineFinalizeInput
): IPipelineCompletedMetadata {
  return {
    pipelineId: input.pipelineId,
    success: input.success,
    totalXP: input.totalXP,
    completedPhases: input.completedPhases,
    failedPhase: input.failedPhase,
    rollbackApplied: input.rollbackApplied,
  };
}

/**
 * Build the final pipeline execution result.
 *
 * @param input - Finalization input data
 * @param executionTimeMs - Calculated execution time
 * @returns Complete pipeline execution result
 */
export function buildPipelineResult(
  input: IPipelineFinalizeInput,
  executionTimeMs: number
): IPipelineExecutionResult {
  return {
    success: input.success,
    phaseResults: input.phaseResults,
    totalXP: input.totalXP,
    executionTimeMs,
    completedPhases: input.completedPhases,
    failedPhase: input.failedPhase,
    rollbackApplied: input.rollbackApplied,
  };
}

/**
 * Build XP storage object for memory.
 *
 * @param totalXP - Total XP accumulated
 * @returns XP storage object with timestamp
 */
export function buildXPStorageObject(totalXP: number): { xp: number; timestamp: string } {
  return {
    xp: totalXP,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Finalize pipeline execution - computes metrics and builds result.
 *
 * This is the main entry point that combines all finalization steps.
 * Note: Memory storage and observability emissions are handled by the
 * orchestrator wrapper to preserve coordination in one place.
 *
 * @param input - Finalization input data
 * @returns Complete finalization result with all computed values
 */
export function finalizePipelineExecution(
  input: IPipelineFinalizeInput
): IPipelineFinalizeResult {
  const executionTimeMs = calculateExecutionTime(input.startTime);
  const quality = input.success
    ? calculatePipelineQuality(input.phaseResults)
    : 0;

  const result = buildPipelineResult(input, executionTimeMs);

  return {
    result,
    executionTimeMs,
    quality,
    feedbackStatus: input.success ? 'completed' : 'failed',
  };
}
