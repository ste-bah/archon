/**
 * Coding Pipeline Types
 *
 * Extracted from coding-pipeline-orchestrator.ts for CON-002 compliance
 * (Single Responsibility Principle - interfaces in dedicated type file)
 *
 * Contains shared interface definitions used across the coding pipeline modules
 * to break circular dependencies and improve maintainability.
 *
 * @module src/god-agent/core/pipeline/coding-pipeline-types
 * @see TASK-ORCH-004-pipeline-orchestration.md
 * @see SPEC-001-architecture.md
 */

import type { AgentRegistry } from '../agents/agent-registry.js';
import type { AgentSelector } from '../agents/agent-selector.js';
import type { InteractionStore } from '../../universal/interaction-store.js';
import type { ReasoningBank } from '../reasoning/reasoning-bank.js';
import type { SonaEngine } from '../learning/sona-engine.js';
import type { LeannContextService } from './leann-context-service.js';
import type { IEmbeddingProvider } from '../memory/types.js';
import type { PatternMatcher } from '../reasoning/pattern-matcher.js';

// ═══════════════════════════════════════════════════════════════════════════
// STEP EXECUTOR INTERFACE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Interface for step execution function.
 * Allows injection of custom execution logic (e.g., for testing or Claude Code Task()).
 */
export interface IStepExecutor {
  execute(agentKey: string, prompt: string, timeout: number): Promise<{
    output: unknown;
    quality: number;
    duration: number;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR DEPENDENCIES INTERFACE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Dependencies required for CodingPipelineOrchestrator
 * Following PipelineExecutor dependency injection pattern
 */
export interface IOrchestratorDependencies {
  agentRegistry: AgentRegistry;
  agentSelector: AgentSelector;
  interactionStore: InteractionStore;
  reasoningBank?: ReasoningBank;
  sonaEngine?: SonaEngine;
  leannContextService?: LeannContextService;
  embeddingProvider?: IEmbeddingProvider;
  /** PatternMatcher for reusable pattern retrieval (PRD: LEANN Pattern Store) */
  patternMatcher?: PatternMatcher;
}

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR CONFIGURATION INTERFACE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Configuration for the pipeline orchestrator
 */
export interface IOrchestratorConfig {
  /** Maximum time for a single agent execution (ms) */
  agentTimeoutMs: number;

  /** Maximum time for a full phase execution (ms) */
  phaseTimeoutMs: number;

  /** Enable checkpoint creation for rollback */
  enableCheckpoints: boolean;

  /** Enable parallel execution of parallelizable agents */
  enableParallelExecution: boolean;

  /** Maximum agents to run in parallel within a phase */
  maxParallelAgents: number;

  /** Memory namespace for coordination */
  memoryNamespace: string;

  /** Path to agent markdown files */
  agentMdPath: string;

  /** Enable verbose logging */
  verbose: boolean;

  /** Step executor function for agent execution (required for production) */
  stepExecutor?: IStepExecutor;

  /** Enable learning feedback to SonaEngine/ReasoningBank */
  enableLearning: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// STATEFUL CLI TYPES (PhD Pipeline Pattern)
// ═══════════════════════════════════════════════════════════════════════════

import type { IAgentMapping, IPipelineExecutionConfig, CodingPipelinePhase, CodingPipelineAgent } from './types.js';

/**
 * Pipeline session state for stateful CLI execution
 */
export interface IPipelineSession {
  /** Unique session identifier */
  sessionId: string;
  /** Pipeline identifier */
  pipelineId: string;
  /** Learning trajectory identifier */
  trajectoryId: string;
  /** Pipeline configuration */
  config: IPipelineExecutionConfig;
  /** Current phase index (0-6 for 7 phases) */
  currentPhaseIndex: number;
  /** Current batch index within current phase */
  currentBatchIndex: number;
  /** List of completed agent keys */
  completedAgents: CodingPipelineAgent[];
  /** Session status */
  status: 'running' | 'complete' | 'failed';
  /** Creation timestamp */
  createdAt: number;
  /** Pre-computed batches for all phases */
  batches: IAgentMapping[][][]; // [phaseIndex][batchIndex][agents]
  /** Last batch dispatched to Claude Code (for idempotent complete) */
  lastDispatchedBatch?: { phaseIndex: number; batchIndex: number };
}

/**
 * Single agent in a batch with contextualized prompt
 */
export interface IAgentBatchItem {
  /** Agent key */
  key: string;
  /** Fully contextualized prompt with RLM + LEANN */
  prompt: string;
  /** Claude Code Task tool type */
  type: string;
  /** Memory domains this agent will write to */
  memoryWrites: string[];
}

/**
 * Response from getBatch methods
 */
export interface ISessionBatchResponse {
  /** Session identifier */
  sessionId: string;
  /** Session status */
  status: 'running' | 'complete' | 'failed';
  /** Batch of agents to execute (empty if complete) */
  batch: IAgentBatchItem[];
  /** Current phase name */
  currentPhase: CodingPipelinePhase;
  /** Number of completed agents */
  completedAgents: number;
  /** Total agents in pipeline */
  totalAgents: number;
}

/**
 * Execution result for a single agent in a batch
 */
export interface IBatchExecutionResult {
  /** Agent key */
  agentKey: string;
  /** Success status */
  success: boolean;
  /** Agent output */
  output: unknown;
  /** Quality score (0.0 - 1.0) */
  quality: number;
  /** Execution duration in milliseconds */
  duration: number;
  /** Memory domains written to */
  memoryWrites?: string[];
}
