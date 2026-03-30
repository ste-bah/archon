/**
 * DAI-002: Multi-Agent Sequential Pipeline Type Definitions
 *
 * Types for the multi-agent sequential pipeline orchestration system.
 * RULE-004: Synchronous Sequential Execution (99.9% Rule)
 * RULE-005: Mandatory Memory Coordination
 * RULE-006: DAI-001 Integration Required
 * RULE-007: Forward-Looking Agent Prompts
 */

// ==================== Pipeline Step Types ====================

/**
 * Single step in a DAI-002 multi-agent pipeline.
 *
 * Each step represents one agent's work in the sequential pipeline.
 * Agents execute one at a time, with memory handoff between steps.
 */
export interface IPipelineStep {
  /**
   * Explicit agent key from AgentRegistry.
   * If not provided, taskDescription MUST be provided for DAI-001 selection.
   * @example 'backend-dev', 'researcher', 'tester'
   */
  agentKey?: string;

  /**
   * Task description for DAI-001 dynamic agent selection.
   * Used when you want the best agent selected automatically.
   * @example 'Implement REST API endpoints for user authentication'
   */
  taskDescription?: string;

  /**
   * Actual task prompt for the agent.
   * This is the work the agent should perform.
   */
  task: string;

  /**
   * Domain to query for previous agent's output.
   * Used for MEMORY RETRIEVAL section in prompt.
   * First step typically has no inputDomain.
   * @example 'project/plans', 'project/api'
   */
  inputDomain?: string;

  /**
   * Tags to filter when retrieving previous agent's output.
   * @example ['schema', 'api-contract']
   */
  inputTags?: string[];

  /**
   * Domain to store this agent's output (REQUIRED).
   * Used for MEMORY STORAGE section in prompt.
   * @example 'project/implementations', 'project/tests'
   */
  outputDomain: string;

  /**
   * Tags for storing this agent's output (REQUIRED).
   * @example ['impl', 'feature-auth']
   */
  outputTags: string[];

  /**
   * Minimum quality threshold for this step.
   * If output quality is below this, QualityGateError is thrown.
   * @default 0.7
   */
  minQuality?: number;

  /**
   * Step timeout in milliseconds.
   * If agent takes longer, PipelineTimeoutError is thrown.
   * @default 300000 (5 minutes)
   */
  timeout?: number;
}

// ==================== Pipeline Definition Types ====================

/**
 * Complete DAI-002 multi-agent pipeline definition.
 *
 * Defines a sequence of agents that execute one at a time,
 * with memory handoff between each step.
 */
export interface IPipelineDefinition {
  /**
   * Pipeline name (for identification and logging).
   */
  name: string;

  /**
   * Pipeline description.
   */
  description: string;

  /**
   * Ordered list of pipeline steps.
   * Steps execute SEQUENTIALLY (RULE-004).
   */
  agents: IPipelineStep[];

  /**
   * Must be true (RULE-004: Sequential execution required).
   * @default true
   */
  sequential: boolean;

  /**
   * Custom metadata for the pipeline.
   */
  metadata?: Record<string, unknown>;

  /**
   * Overall pipeline timeout in milliseconds.
   * @default 1800000 (30 minutes)
   */
  defaultTimeout?: number;

  /**
   * Default quality threshold for all steps.
   * Individual steps can override this.
   * @default 0.7
   */
  defaultMinQuality?: number;
}

// ==================== Execution Result Types ====================

/**
 * Result from a single step execution.
 */
export interface IStepResult {
  /**
   * Step index (0-based).
   */
  stepIndex: number;

  /**
   * Agent key that executed (resolved from agentKey or DAI-001 selection).
   */
  agentKey: string;

  /**
   * Agent's output.
   */
  output: unknown;

  /**
   * Quality score (0-1).
   */
  quality: number;

  /**
   * Execution duration in milliseconds.
   */
  duration: number;

  /**
   * Domain where output was stored.
   */
  memoryDomain: string;

  /**
   * Tags used for storage.
   */
  memoryTags: string[];

  /**
   * Trajectory ID for this step (for learning feedback).
   */
  trajectoryId: string;
}

/**
 * Complete pipeline execution result.
 */
export interface IPipelineResult {
  /**
   * Unique pipeline execution ID.
   */
  pipelineId: string;

  /**
   * Pipeline name.
   */
  pipelineName: string;

  /**
   * Execution status.
   */
  status: 'completed' | 'failed';

  /**
   * Results from each step.
   */
  steps: IStepResult[];

  /**
   * Overall quality (average of step qualities).
   */
  overallQuality: number;

  /**
   * Total execution duration in milliseconds.
   */
  totalDuration: number;

  /**
   * Trajectory ID for the entire pipeline (for learning feedback).
   */
  trajectoryId: string;

  /**
   * Error if status is 'failed'.
   */
  error?: Error;
}

// ==================== Pipeline Options ====================

/**
 * Options for runPipeline() execution.
 */
export interface IPipelineOptions {
  /**
   * Override pipeline timeout (ms).
   */
  timeout?: number;

  /**
   * Override default quality threshold.
   */
  minQuality?: number;

  /**
   * Enable verbose logging.
   */
  verbose?: boolean;

  /**
   * Initial input for first agent.
   */
  input?: unknown;
}

// ==================== Pipeline Events ====================

/**
 * Pipeline lifecycle event types.
 * Used for monitoring and debugging.
 */
export enum PipelineEventType {
  /** Pipeline execution started */
  PIPELINE_STARTED = 'PIPELINE_STARTED',
  /** Agent step started */
  AGENT_STARTED = 'AGENT_STARTED',
  /** Agent step completed successfully */
  AGENT_COMPLETED = 'AGENT_COMPLETED',
  /** Agent output stored in memory */
  MEMORY_STORED = 'MEMORY_STORED',
  /** Quality gate checked */
  QUALITY_CHECKED = 'QUALITY_CHECKED',
  /** Pipeline completed successfully */
  PIPELINE_COMPLETED = 'PIPELINE_COMPLETED',
  /** Pipeline failed */
  PIPELINE_FAILED = 'PIPELINE_FAILED',
  /** Memory retrieval performed */
  MEMORY_RETRIEVED = 'MEMORY_RETRIEVED',
  /** DAI-001 agent selection performed */
  AGENT_SELECTED = 'AGENT_SELECTED',
  /** Feedback provided to ReasoningBank */
  FEEDBACK_PROVIDED = 'FEEDBACK_PROVIDED'
}

/**
 * Base pipeline event structure.
 */
export interface IPipelineEvent {
  /** Event type */
  type: PipelineEventType;
  /** Pipeline execution ID */
  pipelineId: string;
  /** Timestamp when event occurred */
  timestamp: number;
  /** Event-specific data */
  data: Record<string, unknown>;
}

/**
 * Event handler function type.
 */
export type PipelineEventHandler = (event: IPipelineEvent) => void;

// ==================== Memory Storage Types ====================

/**
 * Structure for storing pipeline step output in InteractionStore.
 */
export interface IPipelineStepStorage {
  /** Step index in pipeline */
  stepIndex: number;
  /** Agent key that executed */
  agentKey: string;
  /** Agent output */
  output: unknown;
  /** Pipeline execution ID */
  pipelineId: string;
  /** Timestamp when stored */
  timestamp: number;
}

// ==================== Constants ====================

/**
 * Default step timeout (5 minutes).
 */
export const DEFAULT_STEP_TIMEOUT = 300000;

/**
 * Default pipeline timeout (30 minutes).
 */
export const DEFAULT_PIPELINE_TIMEOUT = 1800000;

/**
 * Default quality threshold.
 */
export const DEFAULT_MIN_QUALITY = 0.7;

/**
 * Pipeline ID prefix.
 */
export const PIPELINE_ID_PREFIX = 'pip';

/**
 * Pipeline trajectory ID prefix.
 */
export const PIPELINE_TRAJECTORY_PREFIX = 'trj_pipeline';

// ==================== Utility Functions ====================

/**
 * Generate a unique pipeline execution ID.
 */
export function generatePipelineId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `${PIPELINE_ID_PREFIX}_${timestamp}_${random}`;
}

/**
 * Generate a trajectory ID for a pipeline.
 */
export function generatePipelineTrajectoryId(pipelineId: string): string {
  return `${PIPELINE_TRAJECTORY_PREFIX}_${pipelineId}`;
}

/**
 * Generate a trajectory ID for a pipeline step.
 */
export function generateStepTrajectoryId(pipelineTrajectoryId: string, stepIndex: number): string {
  return `${pipelineTrajectoryId}_step_${stepIndex}`;
}

/**
 * Calculate overall quality from step results.
 */
export function calculateOverallQuality(steps: IStepResult[]): number {
  if (steps.length === 0) return 0;
  const sum = steps.reduce((acc, step) => acc + step.quality, 0);
  return sum / steps.length;
}

/**
 * Validate that a pipeline definition has basic required fields.
 * Does NOT validate against AgentRegistry (that's PipelineValidator's job).
 */
export function hasRequiredFields(pipeline: IPipelineDefinition): boolean {
  if (!pipeline.name?.trim()) return false;
  if (!Array.isArray(pipeline.agents) || pipeline.agents.length === 0) return false;
  if (pipeline.sequential !== true) return false;

  for (const step of pipeline.agents) {
    if (!step.agentKey && !step.taskDescription) return false;
    if (!step.task?.trim()) return false;
    if (!step.outputDomain?.trim()) return false;
    if (!Array.isArray(step.outputTags) || step.outputTags.length === 0) return false;
  }

  return true;
}
