/**
 * Orchestration Types
 * TASK-ORC-001 - Relay Race Protocol Type Definitions
 *
 * Defines types for agent orchestration, pipeline execution,
 * and memory key passing in sequential agent workflows.
 */

// ==================== Agent Definition ====================

/**
 * Definition for a single agent in a pipeline
 */
export interface IAgentDefinition {
  /** Human-readable agent name (e.g., "Literature Researcher") */
  agentName: string;
  /** Position in pipeline (e.g., "Agent #12/48") */
  position: string;
  /** Pipeline phase (e.g., "Research", "Architecture", "Implementation") */
  phase: string;
  /** Memory key to retrieve from previous agent (null for first agent) */
  previousKey: string | null;
  /** Memory key where this agent stores output */
  outputKey: string;
  /** Specific objective for this agent */
  task: string;
  /** Fail-fast condition (e.g., "Must cite 5+ sources") */
  qualityGate: string;
  /** Safe to parallelize with other parallel agents (default: false) */
  parallel?: boolean;
  /** Agent IDs this depends on (for parallel safety validation) */
  dependencies?: string[];
  /** Agent type for specialized handling */
  agentType?: string;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

// ==================== Pipeline Definition ====================

/**
 * Definition for a complete pipeline of agents
 */
export interface IPipelineDefinition {
  /** Pipeline name (e.g., "PhD Thesis Generation") */
  name: string;
  /** High-level description */
  description: string;
  /** Ordered list of agents */
  agents: IAgentDefinition[];
  /** Enforce 99.9% sequential rule (default: true) */
  sequential: boolean;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

// ==================== Pipeline Execution ====================

/** Pipeline execution status */
export type PipelineStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Runtime state of a pipeline execution
 */
export interface IPipelineExecution {
  /** Unique execution ID */
  pipelineId: string;
  /** Pipeline name */
  name: string;
  /** Current execution status */
  status: PipelineStatus;
  /** Index of current agent in agents array */
  currentAgentIndex: number;
  /** Results from each completed agent */
  agentResults: Map<string, IAgentResult>;
  /** Execution start timestamp (ms) */
  startedAt: number;
  /** Execution completion timestamp (ms) */
  completedAt?: number;
  /** Error message if failed */
  error?: string;
  /** Total agents in pipeline */
  totalAgents: number;
}

// ==================== Agent Result ====================

/**
 * Result from a single agent execution
 */
export interface IAgentResult {
  /** Agent name */
  agentName: string;
  /** Position in pipeline */
  position: string;
  /** Where agent stored output */
  outputKey: string;
  /** Timestamp when storage confirmed */
  storedAt: number;
  /** Execution time (ms) */
  duration: number;
  /** Quality gate passed */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Output content (optional, for validation) */
  output?: string;
}

// ==================== Agent Executor ====================

/**
 * Interface for agent execution backends
 * Allows different implementations (Claude API, local LLM, mock)
 */
export interface IAgentExecutor {
  /**
   * Execute an agent with the given prompt
   * @param prompt - Full prompt for the agent
   * @param agent - Agent definition
   * @returns Agent output string
   */
  execute(prompt: string, agent: IAgentDefinition): Promise<string>;
}

// ==================== Pipeline Events ====================

/** Event types for pipeline execution */
export type PipelineEventType =
  | 'pipeline:start'
  | 'pipeline:complete'
  | 'pipeline:fail'
  | 'agent:start'
  | 'agent:complete'
  | 'agent:fail'
  | 'agent:retrieve'
  | 'agent:store';

/**
 * Event emitted during pipeline execution
 */
export interface IPipelineEvent {
  /** Event type */
  type: PipelineEventType;
  /** Pipeline execution ID */
  pipelineId: string;
  /** Timestamp */
  timestamp: number;
  /** Agent name (for agent events) */
  agentName?: string;
  /** Agent position (for agent events) */
  position?: string;
  /** Memory key involved (for retrieve/store events) */
  memoryKey?: string;
  /** Error message (for fail events) */
  error?: string;
  /** Custom data */
  data?: Record<string, unknown>;
}

/**
 * Pipeline event listener
 */
export type PipelineEventListener = (event: IPipelineEvent) => void;

// ==================== Orchestrator Options ====================

/**
 * Options for RelayRaceOrchestrator
 */
export interface IOrchestratorOptions {
  /** Enable detailed logging */
  verbose?: boolean;
  /** Namespace for memory operations (default: 'pipeline') */
  namespace?: string;
  /** Timeout for agent execution (ms, default: 300000 = 5 min) */
  agentTimeout?: number;
  /** Maximum retry attempts per agent (default: 0 = no retry) */
  maxRetries?: number;
  /** Enable trajectory tracking with SonaEngine */
  trackTrajectories?: boolean;
}

// ==================== Error Types ====================

/**
 * Error thrown when pipeline validation fails
 */
export class PipelineValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PipelineValidationError';
  }
}

/**
 * Error thrown when agent execution fails
 */
export class AgentExecutionError extends Error {
  constructor(
    public readonly agentName: string,
    public readonly position: string,
    message: string
  ) {
    super(`Agent ${agentName} (${position}) failed: ${message}`);
    this.name = 'AgentExecutionError';
  }
}

/**
 * Error thrown when memory key validation fails
 */
export class MemoryKeyError extends Error {
  constructor(
    public readonly key: string,
    public readonly operation: 'retrieve' | 'store' | 'validate',
    message: string
  ) {
    super(`Memory key ${operation} failed for ${key}: ${message}`);
    this.name = 'MemoryKeyError';
  }
}

/**
 * Error thrown when quality gate fails
 */
export class QualityGateError extends Error {
  constructor(
    public readonly agentName: string,
    public readonly qualityGate: string,
    message: string
  ) {
    super(`Quality gate failed for ${agentName}: ${qualityGate}. ${message}`);
    this.name = 'QualityGateError';
  }
}

// ==================== Serialization ====================

/**
 * Serialized pipeline execution for persistence
 */
export interface ISerializedPipelineExecution {
  pipelineId: string;
  name: string;
  status: PipelineStatus;
  currentAgentIndex: number;
  agentResults: Array<{ key: string; result: IAgentResult }>;
  startedAt: number;
  completedAt?: number;
  error?: string;
  totalAgents: number;
}
