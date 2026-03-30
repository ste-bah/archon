/**
 * Agent Execution Types
 * SPEC-DEV-001 - Type definitions for development agent execution
 *
 * Provides types for:
 * - Single agent execution (runAgent)
 * - Agent listing and filtering (listAgents)
 * - Agent information retrieval (getAgentInfo)
 * - Sequential agent chains (runAgentChain)
 */

// ==================== Execution Options ====================

/**
 * Options for agent execution
 */
export interface IAgentExecutionOptions {
  /** Memory namespace for storing results (e.g., 'project/api') */
  namespace?: string;
  /** Timeout in milliseconds (default: 300000 = 5 min) */
  timeout?: number;
  /** Enable trajectory tracking via Sona Engine */
  trackTrajectory?: boolean;
  /** Additional context to inject into agent prompt */
  context?: string;
  /** Memory keys to retrieve before execution */
  retrieveKeys?: string[];
  /** Working directory for hooks */
  workingDirectory?: string;
  /** Verbose logging */
  verbose?: boolean;
}

// ==================== Execution Result ====================

/**
 * Result from a single agent execution
 */
export interface IAgentExecutionResult {
  /** Agent key that was executed */
  agentKey: string;
  /** Whether execution succeeded */
  success: boolean;
  /** Agent output text */
  output: string;
  /** Execution duration in milliseconds */
  duration: number;
  /** Error message if failed */
  error?: string;
  /** Memory key where output was stored (if namespace provided) */
  memoryKey?: string;
  /** Trajectory ID if tracking enabled */
  trajectoryId?: string;
  /** Agent category */
  category?: string;
}

// ==================== Agent Chain ====================

/**
 * A single step in an agent chain
 */
export interface IAgentChainStep {
  /** Agent key to execute (e.g., 'coder', 'tester') */
  agent: string;
  /** Task description for this step */
  task: string;
  /** Step-specific options (merged with chain options) */
  options?: Partial<IAgentExecutionOptions>;
}

/**
 * Result from executing an agent chain
 */
export interface IAgentChainResult {
  /** Overall success (true if all steps succeeded) */
  success: boolean;
  /** Total duration in milliseconds */
  duration: number;
  /** Results for each step in order */
  steps: IAgentExecutionResult[];
  /** Error message if chain failed */
  error?: string;
  /** Index of failed step (if any) */
  failedAtStep?: number;
}

// ==================== Agent Filtering ====================

/**
 * Filter options for listing agents
 */
export interface IAgentFilter {
  /** Filter by category (e.g., 'core', 'development', 'testing') */
  category?: string;
  /** Filter by capability (e.g., 'unit_testing', 'code_review') */
  capability?: string;
  /** Filter by priority level */
  priority?: 'critical' | 'high' | 'medium' | 'low';
  /** Search by name pattern (substring match) */
  namePattern?: string;
  /** Filter by agent type */
  type?: string;
}

// ==================== Agent Information ====================

/**
 * Detailed information about an agent
 */
export interface IAgentInfo {
  /** Agent key (unique identifier) */
  key: string;
  /** Display name */
  name: string;
  /** Agent description */
  description: string;
  /** Category (e.g., 'core', 'development') */
  category: string;
  /** List of capabilities */
  capabilities: string[];
  /** Priority level */
  priority: string;
  /** Agent type (e.g., 'developer', 'validator', 'analyst') */
  type?: string;
  /** Color for UI display */
  color?: string;
  /** Version */
  version?: string;
}

// ==================== Service Configuration ====================

/**
 * Configuration for AgentExecutionService
 */
export interface IAgentExecutionServiceConfig {
  /** Default timeout for agent execution (ms) */
  defaultTimeout?: number;
  /** Default namespace for memory storage */
  defaultNamespace?: string;
  /** Enable trajectory tracking by default */
  trackTrajectories?: boolean;
  /** Verbose logging */
  verbose?: boolean;
  /** Working directory for hooks */
  workingDirectory?: string;
}

// ==================== Default Values ====================

/** Default agent execution timeout (5 minutes) */
export const DEFAULT_AGENT_TIMEOUT = 300000;

/** Default memory namespace */
export const DEFAULT_NAMESPACE = 'agents';
