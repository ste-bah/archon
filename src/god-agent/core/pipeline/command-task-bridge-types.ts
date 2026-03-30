/**
 * DAI-002: Command Task Bridge Types
 *
 * Type definitions for the command-task-bridge module.
 * Extracted for constitution compliance (< 500 lines per file).
 *
 * @see command-task-bridge.ts
 */

/**
 * Result of task complexity analysis.
 */
export interface IComplexityAnalysis {
  /** Complexity score from 0 to 1 */
  score: number;
  /** Whether task requires multiple agents */
  isMultiStep: boolean;
  /** Detected phases in the task */
  detectedPhases: string[];
  /** Detected document types to create */
  detectedDocuments: string[];
  /** Detected action verbs indicating steps */
  detectedActions: string[];
  /** Reasoning for the complexity score */
  reasoning: string;
}

/**
 * Result of pipeline detection.
 */
export interface IPipelineDecision {
  /** Whether to use a pipeline */
  usePipeline: boolean;
  /** Reason for the decision */
  reason: string;
  /** Suggested pipeline steps if applicable */
  suggestedSteps?: string[];
  /** Complexity analysis details */
  complexity: IComplexityAnalysis;
}

/**
 * Task type mapping for agent selection.
 */
export type TaskType = 'code' | 'ask' | 'research' | 'write' | 'unknown';

/**
 * Agent mapping for different task types and phases.
 */
export interface IAgentMapping {
  /** Phase name (e.g., 'plan', 'implement', 'test') */
  phase: string;
  /** Recommended agent key */
  agentKey: string;
  /** Domain for output storage */
  outputDomain: string;
  /** Tags for output storage */
  outputTags: string[];
  /** Task template for this phase */
  taskTemplate: string;
}

/**
 * Configuration for CommandTaskBridge.
 */
export interface ICommandTaskBridgeConfig {
  /** Complexity threshold for triggering pipeline (default: 0.6) */
  pipelineThreshold?: number;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Custom phase mappings */
  phaseMappings?: Map<string, IAgentMapping>;
}
