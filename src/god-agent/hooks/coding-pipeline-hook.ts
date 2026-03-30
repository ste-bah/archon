/**
 * Coding Pipeline Hook Handler
 *
 * Intercepts /god-code command and routes to full 40-agent pipeline.
 * Provides pre-execution initialization and post-execution XP aggregation.
 *
 * @module src/god-agent/hooks/coding-pipeline-hook
 * @see TASK-HOOK-001-coding-hooks.md for specification
 */

import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Hook context passed to hook handlers.
 * Contains information about the triggering command/tool.
 */
export interface IHookContext {
  /** The command or tool name that triggered the hook */
  command: string;
  /** Arguments passed to the command */
  args: {
    task?: string;
    phase?: number;
    dryRun?: boolean;
    [key: string]: unknown;
  };
  /** Timestamp when the hook was triggered */
  timestamp: string;
  /** Session ID for tracking */
  sessionId?: string;
}

/**
 * Result returned from hook handlers.
 * Indicates success/failure and provides context for downstream processing.
 */
export interface IHookResult {
  /** Whether the hook executed successfully */
  success: boolean;
  /** Human-readable message about the result */
  message: string;
  /** Additional context for downstream processing */
  context?: {
    pipelineId?: string;
    startPhase?: number;
    endPhase?: number;
    [key: string]: unknown;
  };
  /** Metrics collected during hook execution */
  metrics?: {
    totalXP?: number;
    phasesCompleted?: number;
    phasesFailed?: number;
    [key: string]: unknown;
  };
  /** Error details if success is false */
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
}

/**
 * Options for configuring coding pipeline hook behavior.
 * Controls phase execution, checkpointing, and dry-run mode.
 */
export interface ICodingPipelineHookOptions {
  /** Start from specific phase (1-7). Default: 1 */
  startPhase?: number;
  /** End at specific phase (1-7). Default: 7 */
  endPhase?: number;
  /** Skip phases that have checkpoints. Default: false */
  resumeFromCheckpoint?: boolean;
  /** Dry run without execution. Default: false */
  dryRun?: boolean;
}

/**
 * Pipeline state stored in memory.
 * Tracks execution progress and enables checkpoint/resume.
 */
interface IPipelineState {
  /** Current phase being executed (1-7) */
  currentPhase: number;
  /** List of completed phase numbers */
  completedPhases: number[];
  /** List of failed phase numbers */
  failedPhases: number[];
  /** ISO timestamp when pipeline started */
  startTime: string;
  /** ISO timestamp when pipeline ended (set by post-hook) */
  endTime?: string;
  /** Checkpoint data for resume functionality */
  checkpoints: Array<{
    phase: number;
    timestamp: string;
    data: unknown;
  }>;
  /** Final status: 'initialized' | 'running' | 'completed' | 'failed' */
  status: 'initialized' | 'running' | 'completed' | 'failed';
  /** Total XP earned (set by post-hook) */
  totalXP?: number;
}

/**
 * File-based memory manager for hook operations.
 * Persists state to `.god-agent/memory/` directory as JSON files.
 *
 * NOTE: This is a lightweight adapter for hooks. For full memory operations
 * with vector search and graph relationships, use MemoryEngine from
 * ../core/memory/memory-engine.js
 */
class MemoryManager {
  private namespace: string;
  private basePath: string;

  constructor(namespace: string = 'coding') {
    this.namespace = namespace;
    // Store in .god-agent/memory/ directory relative to cwd
    this.basePath = join(process.cwd(), '.god-agent', 'memory', namespace);
    this.ensureDirectory();
  }

  /**
   * Ensure the memory directory exists
   */
  private ensureDirectory(): void {
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
  }

  /**
   * Convert a key to a safe filename
   * Replaces / with __ to avoid nested directories
   */
  private keyToFilename(key: string): string {
    return key.replace(/\//g, '__') + '.json';
  }

  /**
   * Get full file path for a key
   */
  private getFilePath(key: string): string {
    return join(this.basePath, this.keyToFilename(key));
  }

  /**
   * Store a value in persistent file storage
   * @param key - Memory key (e.g., 'context/task')
   * @param value - Value to store (will be JSON stringified)
   */
  async store(key: string, value: unknown): Promise<void> {
    this.ensureDirectory();
    const filePath = this.getFilePath(key);
    const jsonValue = JSON.stringify(value, null, 2);
    writeFileSync(filePath, jsonValue, 'utf-8');
  }

  /**
   * Retrieve a value from persistent file storage
   * @param key - Memory key to retrieve
   * @returns Parsed value or null if not found
   */
  async retrieve<T = unknown>(key: string): Promise<T | null> {
    const filePath = this.getFilePath(key);
    if (!existsSync(filePath)) {
      return null;
    }
    try {
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  /**
   * Delete a value from persistent storage
   * @param key - Memory key to delete
   */
  async delete(key: string): Promise<boolean> {
    const filePath = this.getFilePath(key);
    if (existsSync(filePath)) {
      const { unlinkSync } = await import('fs');
      unlinkSync(filePath);
      return true;
    }
    return false;
  }

  /**
   * List all keys in this namespace
   * @returns Array of stored keys
   */
  async list(): Promise<string[]> {
    if (!existsSync(this.basePath)) {
      return [];
    }
    const { readdirSync } = await import('fs');
    const files = readdirSync(this.basePath);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(/__/g, '/').replace(/\.json$/, ''));
  }
}

/**
 * Pre-execution hook for /god-code command.
 *
 * Initializes pipeline state and stores initial context in memory.
 * This hook runs BEFORE the coding pipeline begins execution.
 *
 * @param context - Hook context containing command info and args
 * @param options - Pipeline configuration options
 * @returns Hook result with pipeline ID and configuration
 *
 * @example
 * ```typescript
 * const result = await preCodeHook(
 *   { command: '/god-code', args: { task: 'Build REST API' }, timestamp: new Date().toISOString() },
 *   { startPhase: 1, endPhase: 7 }
 * );
 * console.log(result.context?.pipelineId); // e.g., '123e4567-e89b-12d3-a456-426614174000'
 * ```
 */
export async function preCodeHook(
  context: IHookContext,
  options: ICodingPipelineHookOptions = {}
): Promise<IHookResult> {
  const memory = new MemoryManager('coding');
  const pipelineId = randomUUID();
  const startPhase = options.startPhase ?? 1;
  const endPhase = options.endPhase ?? 7;

  try {
    // Validate phase range
    if (startPhase < 1 || startPhase > 7) {
      return {
        success: false,
        message: `Invalid startPhase: ${startPhase}. Must be between 1 and 7.`,
        error: {
          code: 'INVALID_PHASE',
          message: `startPhase must be between 1 and 7, got ${startPhase}`,
        },
      };
    }

    if (endPhase < 1 || endPhase > 7 || endPhase < startPhase) {
      return {
        success: false,
        message: `Invalid endPhase: ${endPhase}. Must be between ${startPhase} and 7.`,
        error: {
          code: 'INVALID_PHASE',
          message: `endPhase must be between ${startPhase} and 7, got ${endPhase}`,
        },
      };
    }

    // Store initial context
    await memory.store('context/task', {
      description: context.args.task ?? '',
      timestamp: context.timestamp || new Date().toISOString(),
      status: 'initialized',
      options: {
        startPhase,
        endPhase,
        resumeFromCheckpoint: options.resumeFromCheckpoint ?? false,
        dryRun: options.dryRun ?? false,
      },
      pipelineId,
      sessionId: context.sessionId,
    });

    // Store requirements placeholder (to be filled by Phase 1 agents)
    await memory.store('context/requirements', {
      functional: [],
      nonfunctional: [],
      constraints: [],
      extracted: false,
    });

    // Initialize pipeline state
    const initialState: IPipelineState = {
      currentPhase: startPhase,
      completedPhases: [],
      failedPhases: [],
      startTime: new Date().toISOString(),
      checkpoints: [],
      status: 'initialized',
    };
    await memory.store('pipeline/state', initialState);

    // Initialize XP tracking
    await memory.store('xp/total', { xp: 0, timestamp: new Date().toISOString() });

    // Log dry run mode
    if (options.dryRun) {
      console.log(`[HOOK] Dry run mode enabled - pipeline will simulate execution`);
    }

    console.log(`[HOOK] Coding pipeline initialized for task: ${context.args.task ?? '(no task)'}`);
    console.log(`[HOOK] Pipeline ID: ${pipelineId}, Phases: ${startPhase}-${endPhase}`);

    return {
      success: true,
      message: 'Coding pipeline initialized',
      context: {
        pipelineId,
        startPhase,
        endPhase,
        resumeFromCheckpoint: options.resumeFromCheckpoint ?? false,
        dryRun: options.dryRun ?? false,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[HOOK] Failed to initialize coding pipeline: ${errorMessage}`);

    return {
      success: false,
      message: `Failed to initialize coding pipeline: ${errorMessage}`,
      error: {
        code: 'INIT_FAILED',
        message: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      },
    };
  }
}

/**
 * Post-execution hook for /god-code command.
 *
 * Aggregates XP from all phases, updates final pipeline state, and stores metrics.
 * This hook runs AFTER the coding pipeline completes execution.
 *
 * @param context - Hook context containing command info and args
 * @param result - Result from the pipeline execution (unused but available for future use)
 * @returns Hook result with aggregated metrics
 *
 * @example
 * ```typescript
 * const result = await postCodeHook(
 *   { command: '/god-code', args: { task: 'Build REST API' }, timestamp: new Date().toISOString() },
 *   { success: true }
 * );
 * console.log(result.metrics?.totalXP); // e.g., 350
 * ```
 */
export async function postCodeHook(
  context: IHookContext,
  result: unknown
): Promise<IHookResult> {
  const memory = new MemoryManager('coding');

  try {
    // Retrieve current pipeline state
    const state = await memory.retrieve<IPipelineState>('pipeline/state');

    if (!state) {
      return {
        success: false,
        message: 'Pipeline state not found. Was preCodeHook called?',
        error: {
          code: 'STATE_NOT_FOUND',
          message: 'Could not retrieve pipeline state from memory',
        },
      };
    }

    // Calculate total XP from all phases
    let totalXP = 0;
    const phaseXPBreakdown: Record<number, number> = {};

    for (let phase = 1; phase <= 7; phase++) {
      const phaseXPData = await memory.retrieve<{ xp: number }>(`xp/phase-${phase}`);
      if (phaseXPData?.xp) {
        totalXP += phaseXPData.xp;
        phaseXPBreakdown[phase] = phaseXPData.xp;
      }
    }

    // Store final XP total
    await memory.store('xp/total', {
      xp: totalXP,
      timestamp: new Date().toISOString(),
      breakdown: phaseXPBreakdown,
    });

    // Determine final status based on failed phases
    const finalStatus: IPipelineState['status'] =
      state.failedPhases.length > 0 ? 'failed' : 'completed';

    // Update final pipeline state
    const finalState: IPipelineState = {
      ...state,
      status: finalStatus,
      endTime: new Date().toISOString(),
      totalXP,
    };
    await memory.store('pipeline/state', finalState);

    // Log completion
    console.log(`[HOOK] Coding pipeline ${finalStatus}. Total XP: ${totalXP}`);
    if (state.failedPhases.length > 0) {
      console.log(`[HOOK] Failed phases: ${state.failedPhases.join(', ')}`);
    }

    return {
      success: true,
      message: `Coding pipeline ${finalStatus}. Total XP: ${totalXP}`,
      metrics: {
        totalXP,
        phasesCompleted: state.completedPhases.length,
        phasesFailed: state.failedPhases.length,
        phaseXPBreakdown,
        durationMs: state.startTime
          ? Date.now() - new Date(state.startTime).getTime()
          : undefined,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[HOOK] Failed to finalize coding pipeline: ${errorMessage}`);

    return {
      success: false,
      message: `Failed to finalize coding pipeline: ${errorMessage}`,
      error: {
        code: 'FINALIZE_FAILED',
        message: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      },
    };
  }
}

/**
 * Update pipeline phase status during execution.
 * Called by the pipeline orchestrator as phases complete.
 *
 * @param phase - Phase number (1-7)
 * @param status - 'completed' or 'failed'
 * @param xpEarned - XP earned in this phase (if completed)
 */
export async function updatePhaseStatus(
  phase: number,
  status: 'completed' | 'failed',
  xpEarned?: number
): Promise<void> {
  const memory = new MemoryManager('coding');

  const state = await memory.retrieve<IPipelineState>('pipeline/state');
  if (!state) {
    throw new Error('Pipeline state not found');
  }

  if (status === 'completed') {
    state.completedPhases.push(phase);
    if (xpEarned !== undefined) {
      await memory.store(`xp/phase-${phase}`, { xp: xpEarned, timestamp: new Date().toISOString() });
    }
  } else {
    state.failedPhases.push(phase);
  }

  state.currentPhase = phase + 1;
  state.status = 'running';

  await memory.store('pipeline/state', state);
}

/**
 * Create a checkpoint for the current phase.
 * Enables resume functionality if pipeline is interrupted.
 *
 * @param phase - Phase number to checkpoint
 * @param data - Checkpoint data to store
 */
export async function createCheckpoint(
  phase: number,
  data: unknown
): Promise<void> {
  const memory = new MemoryManager('coding');

  const state = await memory.retrieve<IPipelineState>('pipeline/state');
  if (!state) {
    throw new Error('Pipeline state not found');
  }

  state.checkpoints.push({
    phase,
    timestamp: new Date().toISOString(),
    data,
  });

  await memory.store('pipeline/state', state);
  console.log(`[HOOK] Checkpoint created for phase ${phase}`);
}
