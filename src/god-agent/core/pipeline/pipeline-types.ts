/**
 * PhD Pipeline Type Definitions
 * TASK-PHD-001 - 48-Agent PhD Pipeline Configuration
 *
 * Provides types for systematic PhD-level research pipeline:
 * - 48 agents across 7 phases
 * - DAG-based dependency management
 * - Critical agent validation
 * - Integration with Relay Race and Shadow Vector
 */

// ==================== Core Types ====================

/**
 * Agent identifier
 */
export type AgentId = number;

/**
 * Agent key (human-readable identifier)
 */
export type AgentKey = string;

/**
 * Phase identifier (1-7)
 */
export type PhaseId = number;

// ==================== Agent Configuration ====================

/**
 * Single agent configuration
 */
export interface IAgentConfig {
  /** Unique numeric identifier (1-48) */
  id: AgentId;
  /** Human-readable key (e.g., "step-back-analyzer") */
  key: AgentKey;
  /** Display name */
  name: string;
  /** Phase number (1-7) */
  phase: PhaseId;
  /** Brief description of agent's purpose */
  description: string;
  /** List of agent IDs that must complete first */
  dependencies: AgentId[];
  /** Expected input types */
  inputs: string[];
  /** Produced output types */
  outputs: string[];
  /** Maximum execution time (seconds) */
  timeout: number;
  /** Whether pipeline should halt on failure */
  critical?: boolean;
}

// ==================== Phase Configuration ====================

/**
 * Phase configuration
 */
export interface IPhaseConfig {
  /** Phase identifier (1-7) */
  id: PhaseId;
  /** Phase name */
  name: string;
  /** Phase description */
  description: string;
  /** Agent IDs in this phase */
  agents: AgentId[];
  /** Phase objectives */
  objectives: string[];
}

// ==================== Pipeline Configuration ====================

/**
 * Pipeline metadata
 */
export interface IPipelineMetadata {
  /** Pipeline name */
  name: string;
  /** Version string */
  version: string;
  /** Pipeline description */
  description: string;
  /** Total number of agents */
  totalAgents: number;
  /** Number of phases */
  phases: number;
}

/**
 * Complete pipeline configuration
 */
export interface IPipelineConfig {
  /** Pipeline metadata */
  pipeline: IPipelineMetadata;
  /** Phase definitions */
  phases: IPhaseConfig[];
  /** Agent definitions */
  agents: IAgentConfig[];
}

// ==================== Execution State ====================

/**
 * Agent execution status
 */
export type AgentStatus = 'pending' | 'running' | 'success' | 'failed' | 'timeout' | 'skipped';

/**
 * Agent execution record
 */
export interface IAgentExecutionRecord {
  /** Agent ID */
  agentId: AgentId;
  /** Agent key */
  agentKey: AgentKey;
  /** Execution start timestamp */
  startTime: number;
  /** Execution end timestamp */
  endTime?: number;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Execution status */
  status: AgentStatus;
  /** Agent output (if successful) */
  output?: Record<string, unknown>;
  /** Error message (if failed) */
  error?: string;
  /** Dependencies that were satisfied */
  dependenciesSatisfied: AgentId[];
}

/**
 * Pipeline execution state
 */
export interface IPipelineState {
  /** Unique pipeline execution ID */
  pipelineId: string;
  /** Current phase being executed */
  currentPhase: PhaseId;
  /** Set of completed agent IDs */
  completedAgents: Set<AgentId>;
  /** Map of agent outputs by ID */
  agentOutputs: Map<AgentId, Record<string, unknown>>;
  /** Execution start timestamp */
  startTime: number;
  /** Execution end timestamp (if finished) */
  endTime?: number;
  /** Pipeline status */
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** Accumulated errors */
  errors: Array<{ agentId: AgentId; error: string }>;
  /** Execution records for all agents */
  executionRecords: Map<AgentId, IAgentExecutionRecord>;
}

// ==================== Progress Tracking ====================

/**
 * Pipeline progress info
 */
export interface IPipelineProgress {
  /** Number of completed agents */
  completed: number;
  /** Total number of agents */
  total: number;
  /** Completion percentage */
  percentage: number;
  /** Current phase number */
  currentPhase: PhaseId;
  /** Current phase name */
  currentPhaseName: string;
  /** Elapsed time in milliseconds */
  elapsedMs: number;
  /** Estimated remaining time (ms) */
  estimatedRemainingMs?: number;
}

// ==================== Configuration Defaults ====================

/**
 * Default agent timeout (seconds)
 */
export const DEFAULT_AGENT_TIMEOUT = 300;

/**
 * Critical agent keys
 */
export const CRITICAL_AGENT_KEYS = [
  'step-back-analyzer',
  'contradiction-analyzer',
  'adversarial-reviewer',
];

/**
 * Phase names
 */
export const PHASE_NAMES: Record<PhaseId, string> = {
  1: 'Foundation',
  2: 'Discovery',
  3: 'Architecture',
  4: 'Synthesis',
  5: 'Design',
  6: 'Writing',
  7: 'QA',
};

// ==================== Error Types ====================

/**
 * Error thrown during pipeline configuration
 */
export class PipelineConfigError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_AGENT_COUNT' | 'INVALID_PHASE_COUNT' | 'CIRCULAR_DEPENDENCY' | 'INVALID_AGENT_CONFIG' | 'PHASE_MISMATCH'
  ) {
    super(message);
    this.name = 'PipelineConfigError';
  }
}

/**
 * Error thrown during pipeline execution
 */
export class PipelineExecutionError extends Error {
  constructor(
    message: string,
    public readonly agentId: AgentId,
    public readonly agentKey: AgentKey,
    public readonly phase: PhaseId
  ) {
    super(message);
    this.name = 'PipelineExecutionError';
  }
}

/**
 * Error thrown when critical agent fails
 */
export class CriticalAgentError extends Error {
  constructor(
    public readonly agent: IAgentConfig,
    public readonly cause: Error | string
  ) {
    super(`Critical agent #${agent.id} (${agent.key}) failed: ${cause}`);
    this.name = 'CriticalAgentError';
  }
}

// ==================== Utility Functions ====================

/**
 * Create a default pipeline state
 */
export function createPipelineState(pipelineId: string): IPipelineState {
  return {
    pipelineId,
    currentPhase: 1,
    completedAgents: new Set(),
    agentOutputs: new Map(),
    startTime: Date.now(),
    status: 'pending',
    errors: [],
    executionRecords: new Map(),
  };
}

/**
 * Generate a unique pipeline ID
 */
export function generatePipelineId(): string {
  return `phd-pipeline-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Check if an agent is critical
 */
export function isCriticalAgent(agent: IAgentConfig): boolean {
  return agent.critical === true || CRITICAL_AGENT_KEYS.includes(agent.key);
}
