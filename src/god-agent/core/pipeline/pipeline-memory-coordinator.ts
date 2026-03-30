/**
 * DAI-002: Pipeline Memory Coordinator
 * TASK-004: Handles memory operations for pipeline execution
 *
 * RULE-005: Mandatory Memory Coordination
 * - Every agent in a pipeline MUST coordinate through God Agent's memory systems
 * - Uses InteractionStore for storage/retrieval
 * - Outputs stored BEFORE next agent starts
 *
 * Memory Operations:
 * 1. storeStepOutput() - Store agent output after step completion
 * 2. retrievePreviousOutput() - Retrieve previous agent's output
 * 3. clearPipelineData() - Clean up after pipeline completion (optional)
 */

import type { InteractionStore } from '../../universal/interaction-store.js';
import type { KnowledgeEntry } from '../../universal/universal-agent.js';
import type { IPipelineStep, IPipelineStepStorage } from './dai-002-types.js';
import type { CodingPipelinePhase, IPipelineDAG } from './types.js';
import { MemoryCoordinationError } from './pipeline-errors.js';

// ==================== Coding Pipeline Namespace Constants ====================

/**
 * Memory namespace constants for the 40-agent coding pipeline.
 * Aligns with TASK-HOOK-001 specification.
 */
export const CODING_NAMESPACES = {
  /** Root namespace for all coding pipeline data */
  ROOT: 'coding',

  /** Context namespace - pre-pipeline initialization */
  CONTEXT: {
    ROOT: 'coding/context',
    TASK: 'coding/context/task',
    REQUIREMENTS: 'coding/context/requirements',
    CONSTRAINTS: 'coding/context/constraints',
  },

  /** Pipeline namespace - runtime state */
  PIPELINE: {
    ROOT: 'coding/pipeline',
    STATE: 'coding/pipeline/state',
    DAG: 'coding/pipeline/dag',
    CHECKPOINTS: 'coding/pipeline/checkpoints',
    CONFIG: 'coding/pipeline/config',
  },

  /** XP namespace - experience points tracking */
  XP: {
    ROOT: 'coding/xp',
    TOTAL: 'coding/xp/total',
    /** Generate phase-specific key */
    phase: (phase: CodingPipelinePhase): string => `coding/xp/phase-${phase}`,
  },

  /** Phase-specific output namespaces */
  PHASES: {
    understanding: 'coding/understanding',
    exploration: 'coding/exploration',
    architecture: 'coding/architecture',
    implementation: 'coding/implementation',
    testing: 'coding/testing',
    optimization: 'coding/optimization',
    delivery: 'coding/delivery',
  },
} as const;

// ==================== Context Types ====================

/**
 * Task context stored before pipeline execution
 */
export interface ITaskContext {
  /** User's task description */
  description: string;
  /** Timestamp of initialization */
  timestamp: string;
  /** Current status */
  status: 'initialized' | 'in_progress' | 'completed' | 'failed';
  /** Optional hook options */
  options?: {
    startPhase?: number;
    endPhase?: number;
    resumeFromCheckpoint?: boolean;
  };
}

/**
 * Extracted requirements from task analysis
 */
export interface IRequirementsContext {
  /** Functional requirements */
  functional: string[];
  /** Non-functional requirements */
  nonfunctional: string[];
  /** Identified constraints */
  constraints: string[];
  /** Whether extraction is complete */
  extracted: boolean;
  /** Timestamp of extraction */
  timestamp?: string;
}

/**
 * Pipeline execution state
 */
export interface IPipelineState {
  /** Current phase (1-7) */
  currentPhase: number;
  /** Completed phase names */
  completedPhases: CodingPipelinePhase[];
  /** Failed phase names (if any) */
  failedPhases: CodingPipelinePhase[];
  /** Pipeline start time */
  startTime: string;
  /** Pipeline end time (when completed) */
  endTime?: string;
  /** Current status */
  status?: 'running' | 'completed' | 'failed' | 'paused';
  /** Total XP earned */
  totalXP?: number;
  /** Checkpoint IDs created */
  checkpoints: string[];
}

/**
 * Checkpoint data for rollback support
 */
export interface ICheckpointData {
  /** Unique checkpoint ID */
  id: string;
  /** Phase at checkpoint */
  phase: CodingPipelinePhase;
  /** State snapshot */
  state: IPipelineState;
  /** Timestamp */
  timestamp: string;
  /** Memory keys preserved */
  preservedKeys: string[];
}

/**
 * XP tracking for a phase
 */
export interface IPhaseXP {
  /** Phase name */
  phase: CodingPipelinePhase;
  /** XP earned in this phase */
  xp: number;
  /** Agents that contributed */
  agentContributions: Array<{ agentKey: string; xp: number }>;
  /** Timestamp */
  timestamp: string;
}

// ==================== Memory Configuration ====================

/**
 * Configuration for memory operations
 */
export interface IMemoryCoordinatorConfig {
  /** Quality score for stored knowledge (0-1) */
  defaultQuality?: number;
  /** Whether to log memory operations */
  verbose?: boolean;
}

/**
 * Result of a storage operation
 */
export interface IStoreResult {
  /** Knowledge entry ID */
  entryId: string;
  /** Domain where stored */
  domain: string;
  /** Tags used */
  tags: string[];
  /** Timestamp of storage */
  timestamp: number;
}

/**
 * Result of a retrieval operation
 */
export interface IRetrieveResult {
  /** Found knowledge entries */
  entries: KnowledgeEntry[];
  /** Parsed output data if available */
  output?: unknown;
  /** Pipeline step storage metadata if available */
  stepData?: IPipelineStepStorage;
}

// ==================== Pipeline Memory Coordinator ====================

/**
 * Coordinates memory operations for pipeline execution.
 * Stores and retrieves agent outputs via InteractionStore.
 *
 * @example
 * ```typescript
 * const coordinator = new PipelineMemoryCoordinator(interactionStore);
 *
 * // Store output after agent completes
 * await coordinator.storeStepOutput(step, 0, 'pip_123', agentOutput, 'backend-dev');
 *
 * // Retrieve for next agent
 * const previous = coordinator.retrievePreviousOutput(nextStep, 'pip_123');
 * ```
 */
export class PipelineMemoryCoordinator {
  private readonly config: Required<IMemoryCoordinatorConfig>;

  /**
   * Create a new memory coordinator
   * @param interactionStore - The InteractionStore instance for storage
   * @param config - Optional configuration
   */
  constructor(
    private readonly interactionStore: InteractionStore,
    config: IMemoryCoordinatorConfig = {}
  ) {
    this.config = {
      defaultQuality: config.defaultQuality ?? 1.0,
      verbose: config.verbose ?? false,
    };
  }

  /**
   * Store agent output after step completion.
   *
   * CRITICAL: This MUST be called BEFORE the next agent starts (RULE-005).
   *
   * @param step - The pipeline step that completed
   * @param stepIndex - Index of the step (0-based)
   * @param pipelineId - Unique pipeline execution ID
   * @param output - Agent's output to store
   * @param agentKey - Key of the agent that executed
   * @returns Storage result with entry ID
   * @throws MemoryCoordinationError if storage fails
   */
  storeStepOutput(
    step: IPipelineStep,
    stepIndex: number,
    pipelineId: string,
    output: unknown,
    agentKey: string
  ): IStoreResult {
    const timestamp = Date.now();
    const entryId = this.generateEntryId(pipelineId, stepIndex, timestamp);

    // Prepare storage data following IPipelineStepStorage structure
    const storageData: IPipelineStepStorage = {
      stepIndex,
      agentKey,
      output,
      pipelineId,
      timestamp,
    };

    // Build tags: step's output tags + pipeline ID + step marker
    const tags = [
      ...step.outputTags,
      pipelineId,
      `step-${stepIndex}`,
    ];

    try {
      // Create knowledge entry
      const entry: KnowledgeEntry = {
        id: entryId,
        content: JSON.stringify(storageData),
        type: 'fact',  // Pipeline outputs are factual data
        domain: step.outputDomain,
        tags,
        quality: this.config.defaultQuality,
        usageCount: 0,
        lastUsed: timestamp,
        createdAt: timestamp,
      };

      // Store in InteractionStore
      this.interactionStore.addKnowledge(entry);

      if (this.config.verbose) {
        console.log(
          `[Pipeline ${pipelineId}] Stored to domain '${step.outputDomain}' ` +
          `(entry: ${entryId})`
        );
      }

      return {
        entryId,
        domain: step.outputDomain,
        tags,
        timestamp,
      };
    } catch (error) {
      throw new MemoryCoordinationError(
        `Failed to store step output: ${(error as Error).message}`,
        {
          pipelineId,
          stepIndex,
          domain: step.outputDomain,
          operation: 'store',
          cause: error instanceof Error ? error : new Error(String(error)),
        }
      );
    }
  }

  /**
   * Retrieve previous agent's output for a step.
   *
   * @param step - The current step that needs previous output
   * @param pipelineId - Unique pipeline execution ID
   * @returns Retrieved data (may be empty if first agent or no matches)
   * @throws MemoryCoordinationError if retrieval fails unexpectedly
   */
  retrievePreviousOutput(
    step: IPipelineStep,
    pipelineId: string
  ): IRetrieveResult {
    // First agent has no previous output
    if (!step.inputDomain) {
      return { entries: [] };
    }

    try {
      // Get all entries from the input domain
      const domainEntries = this.interactionStore.getKnowledgeByDomain(step.inputDomain);

      // Filter by pipeline ID to get only this pipeline's outputs
      let filtered = domainEntries.filter(entry =>
        entry.tags?.includes(pipelineId)
      );

      // If input tags specified, filter further
      if (step.inputTags?.length) {
        filtered = filtered.filter(entry =>
          step.inputTags!.some(tag => entry.tags?.includes(tag))
        );
      }

      // Sort by timestamp (most recent first)
      filtered.sort((a, b) => b.createdAt - a.createdAt);

      if (this.config.verbose && filtered.length > 0) {
        console.log(
          `[Pipeline ${pipelineId}] Retrieved ${filtered.length} entries from '${step.inputDomain}'`
        );
      }

      // Parse the most recent entry if available
      let output: unknown;
      let stepData: IPipelineStepStorage | undefined;

      if (filtered.length > 0) {
        try {
          stepData = JSON.parse(filtered[0].content) as IPipelineStepStorage;
          output = stepData.output;
        } catch {
          // INTENTIONAL: Content isn't valid JSON - return raw content as fallback
          output = filtered[0].content;
        }
      }

      return {
        entries: filtered,
        output,
        stepData,
      };
    } catch (error) {
      throw new MemoryCoordinationError(
        `Failed to retrieve previous output: ${(error as Error).message}`,
        {
          pipelineId,
          stepIndex: -1,  // Unknown step index during retrieval
          domain: step.inputDomain,
          operation: 'retrieve',
          cause: error instanceof Error ? error : new Error(String(error)),
        }
      );
    }
  }

  /**
   * Retrieve output from a specific step by index.
   *
   * @param pipelineId - Pipeline execution ID
   * @param stepIndex - Step index to retrieve
   * @param domain - Domain where output was stored
   * @returns Retrieved data
   */
  retrieveStepOutput(
    pipelineId: string,
    stepIndex: number,
    domain: string
  ): IRetrieveResult {
    try {
      const domainEntries = this.interactionStore.getKnowledgeByDomain(domain);

      // Filter by pipeline ID and step index
      const filtered = domainEntries.filter(entry =>
        entry.tags?.includes(pipelineId) &&
        entry.tags?.includes(`step-${stepIndex}`)
      );

      // Sort by timestamp (most recent first)
      filtered.sort((a, b) => b.createdAt - a.createdAt);

      let output: unknown;
      let stepData: IPipelineStepStorage | undefined;

      if (filtered.length > 0) {
        try {
          stepData = JSON.parse(filtered[0].content) as IPipelineStepStorage;
          output = stepData.output;
        } catch {
          // INTENTIONAL: JSON parse failure - return raw content as fallback
          output = filtered[0].content;
        }
      }

      return {
        entries: filtered,
        output,
        stepData,
      };
    } catch (error) {
      throw new MemoryCoordinationError(
        `Failed to retrieve step ${stepIndex} output: ${(error as Error).message}`,
        {
          pipelineId,
          stepIndex,
          domain,
          operation: 'retrieve',
          cause: error instanceof Error ? error : new Error(String(error)),
        }
      );
    }
  }

  /**
   * Get all outputs from a pipeline execution.
   *
   * @param pipelineId - Pipeline execution ID
   * @returns All stored outputs for this pipeline
   */
  getAllPipelineOutputs(pipelineId: string): KnowledgeEntry[] {
    // Get all knowledge entries and filter by pipeline ID
    // Note: stats is retrieved but not currently used for scanning
    // Could be enhanced to dynamically discover domains

    // We need to scan all domains - get unique domains from the store
    // This is a bit inefficient but necessary for retrieving all pipeline data
    const allEntries: KnowledgeEntry[] = [];

    // Access the knowledge map through getKnowledgeByDomain with wildcards
    // Since InteractionStore doesn't have a getAllKnowledge method,
    // we'll use getKnowledge with known IDs or scan known domains
    // For now, return based on common pipeline domains
    const commonDomains = [
      'project/plans',
      'project/specs',
      'project/implementations',
      'project/tests',
      'project/api',
      'project/events',
      'project/frontend',
    ];

    for (const domain of commonDomains) {
      const entries = this.interactionStore.getKnowledgeByDomain(domain);
      const pipelineEntries = entries.filter(e => e.tags?.includes(pipelineId));
      allEntries.push(...pipelineEntries);
    }

    return allEntries;
  }

  /**
   * Check if previous output exists for a step.
   *
   * @param step - The step to check
   * @param pipelineId - Pipeline execution ID
   * @returns True if previous output is available
   */
  hasPreviousOutput(step: IPipelineStep, pipelineId: string): boolean {
    if (!step.inputDomain) {
      return false;
    }

    const result = this.retrievePreviousOutput(step, pipelineId);
    return result.entries.length > 0;
  }

  /**
   * Generate a unique entry ID for a pipeline step output.
   */
  private generateEntryId(
    pipelineId: string,
    stepIndex: number,
    timestamp: number
  ): string {
    return `pipeline-${pipelineId}-step-${stepIndex}-${timestamp}`;
  }

  // ==================== Context Storage Methods ====================

  /**
   * Store initial task context from hook initialization.
   *
   * Called by pre-execution hook (TASK-HOOK-001) to store the task
   * description and options before pipeline execution begins.
   *
   * @param pipelineId - Unique pipeline execution ID
   * @param context - Task context from hook
   * @returns Storage result
   */
  storeTaskContext(pipelineId: string, context: ITaskContext): IStoreResult {
    const timestamp = Date.now();
    const entryId = `context-task-${pipelineId}-${timestamp}`;

    const entry: KnowledgeEntry = {
      id: entryId,
      content: JSON.stringify(context),
      type: 'fact',
      domain: CODING_NAMESPACES.CONTEXT.ROOT,
      tags: [pipelineId, 'task-context', 'hook-initialized'],
      quality: this.config.defaultQuality,
      usageCount: 0,
      lastUsed: timestamp,
      createdAt: timestamp,
    };

    try {
      this.interactionStore.addKnowledge(entry);

      if (this.config.verbose) {
        console.log(`[Pipeline ${pipelineId}] Stored task context`);
      }

      return {
        entryId,
        domain: CODING_NAMESPACES.CONTEXT.ROOT,
        tags: entry.tags!,
        timestamp,
      };
    } catch (error) {
      throw new MemoryCoordinationError(
        `Failed to store task context: ${(error as Error).message}`,
        {
          pipelineId,
          stepIndex: -1,
          domain: CODING_NAMESPACES.CONTEXT.TASK,
          operation: 'store',
          cause: error instanceof Error ? error : new Error(String(error)),
        }
      );
    }
  }

  /**
   * Retrieve task context for a pipeline.
   *
   * @param pipelineId - Pipeline execution ID
   * @returns Task context or undefined if not found
   */
  retrieveTaskContext(pipelineId: string): ITaskContext | undefined {
    const entries = this.interactionStore.getKnowledgeByDomain(
      CODING_NAMESPACES.CONTEXT.ROOT
    );

    const contextEntry = entries.find(
      (e) => e.tags?.includes(pipelineId) && e.tags?.includes('task-context')
    );

    if (!contextEntry) {
      return undefined;
    }

    try {
      return JSON.parse(contextEntry.content) as ITaskContext;
    } catch {
      return undefined;
    }
  }

  /**
   * Store extracted requirements from Phase 1 agents.
   *
   * @param pipelineId - Pipeline execution ID
   * @param requirements - Extracted requirements
   * @returns Storage result
   */
  storeRequirements(
    pipelineId: string,
    requirements: IRequirementsContext
  ): IStoreResult {
    const timestamp = Date.now();
    const entryId = `context-requirements-${pipelineId}-${timestamp}`;

    const entry: KnowledgeEntry = {
      id: entryId,
      content: JSON.stringify({
        ...requirements,
        timestamp: new Date(timestamp).toISOString(),
      }),
      type: 'fact',
      domain: CODING_NAMESPACES.CONTEXT.ROOT,
      tags: [pipelineId, 'requirements', 'phase-1'],
      quality: this.config.defaultQuality,
      usageCount: 0,
      lastUsed: timestamp,
      createdAt: timestamp,
    };

    try {
      this.interactionStore.addKnowledge(entry);
      return {
        entryId,
        domain: CODING_NAMESPACES.CONTEXT.ROOT,
        tags: entry.tags!,
        timestamp,
      };
    } catch (error) {
      throw new MemoryCoordinationError(
        `Failed to store requirements: ${(error as Error).message}`,
        {
          pipelineId,
          stepIndex: -1,
          domain: CODING_NAMESPACES.CONTEXT.REQUIREMENTS,
          operation: 'store',
          cause: error instanceof Error ? error : new Error(String(error)),
        }
      );
    }
  }

  // ==================== Pipeline State Methods ====================

  /**
   * Store or update pipeline execution state.
   *
   * Called by orchestrator to track current phase, completed phases,
   * and overall pipeline status.
   *
   * @param pipelineId - Pipeline execution ID
   * @param state - Current pipeline state
   * @returns Storage result
   */
  storePipelineState(pipelineId: string, state: IPipelineState): IStoreResult {
    const timestamp = Date.now();
    const entryId = `pipeline-state-${pipelineId}-${timestamp}`;

    const entry: KnowledgeEntry = {
      id: entryId,
      content: JSON.stringify(state),
      type: 'fact',
      domain: CODING_NAMESPACES.PIPELINE.ROOT,
      tags: [pipelineId, 'pipeline-state', `phase-${state.currentPhase}`],
      quality: this.config.defaultQuality,
      usageCount: 0,
      lastUsed: timestamp,
      createdAt: timestamp,
    };

    try {
      this.interactionStore.addKnowledge(entry);

      if (this.config.verbose) {
        console.log(
          `[Pipeline ${pipelineId}] Stored state: phase ${state.currentPhase}, ` +
            `status ${state.status ?? 'running'}`
        );
      }

      return {
        entryId,
        domain: CODING_NAMESPACES.PIPELINE.ROOT,
        tags: entry.tags!,
        timestamp,
      };
    } catch (error) {
      throw new MemoryCoordinationError(
        `Failed to store pipeline state: ${(error as Error).message}`,
        {
          pipelineId,
          stepIndex: state.currentPhase,
          domain: CODING_NAMESPACES.PIPELINE.STATE,
          operation: 'store',
          cause: error instanceof Error ? error : new Error(String(error)),
        }
      );
    }
  }

  /**
   * Retrieve latest pipeline state.
   *
   * @param pipelineId - Pipeline execution ID
   * @returns Latest pipeline state or undefined
   */
  retrievePipelineState(pipelineId: string): IPipelineState | undefined {
    const entries = this.interactionStore.getKnowledgeByDomain(
      CODING_NAMESPACES.PIPELINE.ROOT
    );

    const stateEntries = entries
      .filter(
        (e) => e.tags?.includes(pipelineId) && e.tags?.includes('pipeline-state')
      )
      .sort((a, b) => b.createdAt - a.createdAt);

    if (stateEntries.length === 0) {
      return undefined;
    }

    try {
      return JSON.parse(stateEntries[0].content) as IPipelineState;
    } catch {
      return undefined;
    }
  }

  /**
   * Store DAG configuration for a pipeline.
   *
   * @param pipelineId - Pipeline execution ID
   * @param dag - Pipeline DAG structure
   * @returns Storage result
   */
  storeDAG(pipelineId: string, dag: IPipelineDAG): IStoreResult {
    const timestamp = Date.now();
    const entryId = `pipeline-dag-${pipelineId}-${timestamp}`;

    // Serialize DAG with Map conversion for JSON compatibility
    const serializedDAG = {
      nodes: Object.fromEntries(dag.nodes),
      phases: Object.fromEntries(dag.phases),
      topologicalOrder: dag.topologicalOrder,
      checkpointPhases: dag.checkpointPhases,
    };

    const entry: KnowledgeEntry = {
      id: entryId,
      content: JSON.stringify(serializedDAG),
      type: 'fact',
      domain: CODING_NAMESPACES.PIPELINE.ROOT,
      tags: [pipelineId, 'pipeline-dag'],
      quality: this.config.defaultQuality,
      usageCount: 0,
      lastUsed: timestamp,
      createdAt: timestamp,
    };

    try {
      this.interactionStore.addKnowledge(entry);
      return {
        entryId,
        domain: CODING_NAMESPACES.PIPELINE.ROOT,
        tags: entry.tags!,
        timestamp,
      };
    } catch (error) {
      throw new MemoryCoordinationError(
        `Failed to store DAG: ${(error as Error).message}`,
        {
          pipelineId,
          stepIndex: -1,
          domain: CODING_NAMESPACES.PIPELINE.DAG,
          operation: 'store',
          cause: error instanceof Error ? error : new Error(String(error)),
        }
      );
    }
  }

  // ==================== Checkpoint Methods ====================

  /**
   * Create a checkpoint at the end of a phase.
   *
   * Checkpoints allow rollback if subsequent phases fail.
   * Per SPEC-001, checkpoints are created for phases 1-5.
   *
   * @param pipelineId - Pipeline execution ID
   * @param phase - Phase being checkpointed
   * @param state - Current pipeline state
   * @returns Checkpoint data with ID
   */
  createCheckpoint(
    pipelineId: string,
    phase: CodingPipelinePhase,
    state: IPipelineState
  ): ICheckpointData {
    const timestamp = Date.now();
    const checkpointId = `checkpoint-${pipelineId}-${phase}-${timestamp}`;

    // Collect all memory keys for this pipeline up to this phase
    const preservedKeys = this.collectPipelineKeys(pipelineId);

    const checkpoint: ICheckpointData = {
      id: checkpointId,
      phase,
      state: { ...state },
      timestamp: new Date(timestamp).toISOString(),
      preservedKeys,
    };

    const entry: KnowledgeEntry = {
      id: checkpointId,
      content: JSON.stringify(checkpoint),
      type: 'fact',
      domain: CODING_NAMESPACES.PIPELINE.ROOT,
      tags: [pipelineId, 'checkpoint', `checkpoint-${phase}`],
      quality: this.config.defaultQuality,
      usageCount: 0,
      lastUsed: timestamp,
      createdAt: timestamp,
    };

    try {
      this.interactionStore.addKnowledge(entry);

      if (this.config.verbose) {
        console.log(
          `[Pipeline ${pipelineId}] Created checkpoint for phase '${phase}' ` +
            `(${preservedKeys.length} keys preserved)`
        );
      }

      return checkpoint;
    } catch (error) {
      throw new MemoryCoordinationError(
        `Failed to create checkpoint: ${(error as Error).message}`,
        {
          pipelineId,
          stepIndex: -1,
          domain: CODING_NAMESPACES.PIPELINE.CHECKPOINTS,
          operation: 'store',
          cause: error instanceof Error ? error : new Error(String(error)),
        }
      );
    }
  }

  /**
   * Retrieve a checkpoint for potential rollback.
   *
   * @param pipelineId - Pipeline execution ID
   * @param phase - Phase to retrieve checkpoint for
   * @returns Checkpoint data or undefined
   */
  retrieveCheckpoint(
    pipelineId: string,
    phase: CodingPipelinePhase
  ): ICheckpointData | undefined {
    const entries = this.interactionStore.getKnowledgeByDomain(
      CODING_NAMESPACES.PIPELINE.ROOT
    );

    const checkpointEntry = entries.find(
      (e) =>
        e.tags?.includes(pipelineId) &&
        e.tags?.includes(`checkpoint-${phase}`)
    );

    if (!checkpointEntry) {
      return undefined;
    }

    try {
      return JSON.parse(checkpointEntry.content) as ICheckpointData;
    } catch {
      return undefined;
    }
  }

  /**
   * List all checkpoints for a pipeline.
   *
   * @param pipelineId - Pipeline execution ID
   * @returns Array of checkpoint data
   */
  listCheckpoints(pipelineId: string): ICheckpointData[] {
    const entries = this.interactionStore.getKnowledgeByDomain(
      CODING_NAMESPACES.PIPELINE.ROOT
    );

    const checkpointEntries = entries
      .filter(
        (e) => e.tags?.includes(pipelineId) && e.tags?.includes('checkpoint')
      )
      .sort((a, b) => a.createdAt - b.createdAt);

    return checkpointEntries
      .map((e) => {
        try {
          return JSON.parse(e.content) as ICheckpointData;
        } catch {
          return null;
        }
      })
      .filter((c): c is ICheckpointData => c !== null);
  }

  /**
   * Collect all memory keys associated with a pipeline.
   * Used for checkpoint preservation.
   */
  private collectPipelineKeys(pipelineId: string): string[] {
    const keys: string[] = [];
    const domains = [
      CODING_NAMESPACES.CONTEXT.ROOT,
      CODING_NAMESPACES.PIPELINE.ROOT,
      CODING_NAMESPACES.XP.ROOT,
      ...Object.values(CODING_NAMESPACES.PHASES),
    ];

    for (const domain of domains) {
      const entries = this.interactionStore.getKnowledgeByDomain(domain);
      const pipelineEntries = entries.filter((e) =>
        e.tags?.includes(pipelineId)
      );
      keys.push(...pipelineEntries.map((e) => e.id));
    }

    return keys;
  }

  // ==================== XP Tracking Methods ====================

  /**
   * Store XP earned for a phase.
   *
   * Called by orchestrator after phase completion to track
   * XP contributions from each agent.
   *
   * @param pipelineId - Pipeline execution ID
   * @param phaseXP - Phase XP data with agent contributions
   * @returns Storage result
   */
  storePhaseXP(pipelineId: string, phaseXP: IPhaseXP): IStoreResult {
    const timestamp = Date.now();
    const entryId = `xp-${pipelineId}-${phaseXP.phase}-${timestamp}`;

    const entry: KnowledgeEntry = {
      id: entryId,
      content: JSON.stringify({
        ...phaseXP,
        timestamp: new Date(timestamp).toISOString(),
      }),
      type: 'fact',
      domain: CODING_NAMESPACES.XP.ROOT,
      tags: [pipelineId, 'phase-xp', `xp-${phaseXP.phase}`],
      quality: this.config.defaultQuality,
      usageCount: 0,
      lastUsed: timestamp,
      createdAt: timestamp,
    };

    try {
      this.interactionStore.addKnowledge(entry);

      if (this.config.verbose) {
        console.log(
          `[Pipeline ${pipelineId}] Stored ${phaseXP.xp} XP for phase '${phaseXP.phase}'`
        );
      }

      return {
        entryId,
        domain: CODING_NAMESPACES.XP.ROOT,
        tags: entry.tags!,
        timestamp,
      };
    } catch (error) {
      throw new MemoryCoordinationError(
        `Failed to store phase XP: ${(error as Error).message}`,
        {
          pipelineId,
          stepIndex: -1,
          domain: CODING_NAMESPACES.XP.phase(phaseXP.phase),
          operation: 'store',
          cause: error instanceof Error ? error : new Error(String(error)),
        }
      );
    }
  }

  /**
   * Retrieve XP for a specific phase.
   *
   * @param pipelineId - Pipeline execution ID
   * @param phase - Phase to retrieve XP for
   * @returns Phase XP data or undefined
   */
  retrievePhaseXP(
    pipelineId: string,
    phase: CodingPipelinePhase
  ): IPhaseXP | undefined {
    const entries = this.interactionStore.getKnowledgeByDomain(
      CODING_NAMESPACES.XP.ROOT
    );

    const xpEntry = entries.find(
      (e) => e.tags?.includes(pipelineId) && e.tags?.includes(`xp-${phase}`)
    );

    if (!xpEntry) {
      return undefined;
    }

    try {
      return JSON.parse(xpEntry.content) as IPhaseXP;
    } catch {
      return undefined;
    }
  }

  /**
   * Aggregate and store total XP for a pipeline.
   *
   * Called by post-execution hook to calculate final XP.
   *
   * @param pipelineId - Pipeline execution ID
   * @returns Total XP across all phases
   */
  aggregateTotalXP(pipelineId: string): number {
    const entries = this.interactionStore.getKnowledgeByDomain(
      CODING_NAMESPACES.XP.ROOT
    );

    const xpEntries = entries.filter(
      (e) => e.tags?.includes(pipelineId) && e.tags?.includes('phase-xp')
    );

    let totalXP = 0;

    for (const entry of xpEntries) {
      try {
        const phaseXP = JSON.parse(entry.content) as IPhaseXP;
        totalXP += phaseXP.xp;
      } catch {
        // Skip malformed entries
      }
    }

    // Store the total
    const timestamp = Date.now();
    const totalEntry: KnowledgeEntry = {
      id: `xp-total-${pipelineId}-${timestamp}`,
      content: JSON.stringify({
        pipelineId,
        totalXP,
        timestamp: new Date(timestamp).toISOString(),
      }),
      type: 'fact',
      domain: CODING_NAMESPACES.XP.ROOT,
      tags: [pipelineId, 'total-xp'],
      quality: this.config.defaultQuality,
      usageCount: 0,
      lastUsed: timestamp,
      createdAt: timestamp,
    };

    try {
      this.interactionStore.addKnowledge(totalEntry);

      if (this.config.verbose) {
        console.log(`[Pipeline ${pipelineId}] Total XP: ${totalXP}`);
      }
    } catch {
      // Non-fatal - return calculated value even if storage fails
    }

    return totalXP;
  }

  /**
   * Retrieve total XP for a pipeline.
   *
   * @param pipelineId - Pipeline execution ID
   * @returns Total XP or 0 if not found
   */
  retrieveTotalXP(pipelineId: string): number {
    const entries = this.interactionStore.getKnowledgeByDomain(
      CODING_NAMESPACES.XP.ROOT
    );

    const totalEntry = entries.find(
      (e) => e.tags?.includes(pipelineId) && e.tags?.includes('total-xp')
    );

    if (!totalEntry) {
      return 0;
    }

    try {
      const data = JSON.parse(totalEntry.content) as { totalXP: number };
      return data.totalXP;
    } catch {
      return 0;
    }
  }
}

// ==================== Factory Function ====================

/**
 * Create a PipelineMemoryCoordinator with given InteractionStore
 * @param interactionStore - Initialized InteractionStore
 * @param config - Optional configuration
 * @returns PipelineMemoryCoordinator instance
 */
export function createPipelineMemoryCoordinator(
  interactionStore: InteractionStore,
  config?: IMemoryCoordinatorConfig
): PipelineMemoryCoordinator {
  return new PipelineMemoryCoordinator(interactionStore, config);
}
