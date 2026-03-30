/**
 * CLI Type Definitions for PhD Pipeline Orchestration
 * Implements REQ-PIPE-021, REQ-PIPE-023
 */

import type { ChapterStructure } from './chapter-structure-loader.js';
import type { DynamicAgentDetails } from './dynamic-agent-generator.js';
import type { Phase8PrepareResult } from './final-stage/types.js';

/**
 * Options for the init command
 */
export interface InitOptions {
  styleProfile?: string;
  config?: string;
  verbose?: boolean;
  json?: boolean;
}

/**
 * Options for the next command
 */
export interface NextOptions {
  sessionId?: string;
  json?: boolean;
}

/**
 * Options for the complete command
 */
export interface CompleteOptions {
  output?: string;
  json?: boolean;
}

/**
 * Options for the status command
 */
export interface StatusOptions {
  sessionId?: string;
  verbose?: boolean;
  json?: boolean;
}

/**
 * Options for the list command
 */
export interface ListOptions {
  all?: boolean;
  status?: 'running' | 'paused' | 'completed' | 'failed';
  json?: boolean;
}

/**
 * Options for the resume command
 */
export interface ResumeOptions {
  json?: boolean;
}

/**
 * Options for the abort command
 */
export interface AbortOptions {
  force?: boolean;
  json?: boolean;
}

/**
 * Style profile summary in responses
 */
export interface StyleProfileSummary {
  id: string;
  name: string;
  languageVariant: string;
}

/**
 * Agent details returned by CLI commands
 * [REQ-PIPE-002, REQ-PIPE-004]
 */
export interface AgentDetails {
  index: number;
  key: string;
  name: string;
  phase: number;
  phaseName: string;
  prompt: string;
  dependencies: string[];
  timeout: number;
  critical: boolean;
  expectedOutputs: string[];
}

/**
 * Response from init command
 * [REQ-PIPE-001]
 */
export interface InitResponse {
  sessionId: string;
  pipelineId: string;
  query: string;
  styleProfile: StyleProfileSummary;
  totalAgents: number;
  agent: AgentDetails;
}

// Note: NextResponse and CompleteResponse are defined later in TASK-PIPE-004/005 sections

/**
 * Response from status command
 * [REQ-PIPE-004]
 */
export interface StatusResponse {
  sessionId: string;
  pipelineId: string;
  query: string;
  status: SessionStatus;
  currentPhase: number;
  phaseName: string;
  currentAgent: AgentDetails;
  progress: {
    completed: number;
    total: number;
    percentage: number;
  };
  startTime: number;
  lastActivityTime: number;
  elapsedTime: number;
  errors: SessionError[];
}

/**
 * Response from list command
 * [REQ-PIPE-005]
 */
export interface ListResponse {
  sessions: SessionListItem[];
  total: number;
}

/**
 * Session list item for list command
 */
export interface SessionListItem {
  sessionId: string;
  pipelineId: string;
  query: string;
  status: SessionStatus;
  progress: number;
  startTime: number;
  lastActivityTime: number;
}

/**
 * Response from resume command
 * [REQ-PIPE-006]
 */
export interface ResumeResponse {
  sessionId: string;
  resumed: boolean;
  agent: AgentDetails;
  progress: {
    completed: number;
    total: number;
    percentage: number;
  };
}

/**
 * Response from abort command
 * [REQ-PIPE-007]
 */
export interface AbortResponse {
  sessionId: string;
  aborted: boolean;
  finalStatus: SessionStatus;
  completedAgents: number;
}

/**
 * Session status enum
 * [REQ-PIPE-021]
 */
export type SessionStatus = 'running' | 'paused' | 'completed' | 'failed';

/**
 * Session error structure
 */
export interface SessionError {
  agentKey: string;
  error: string;
  timestamp: number;
}

/**
 * Pipeline session state
 * [REQ-PIPE-020, REQ-PIPE-021]
 */
export interface PipelineSession {
  sessionId: string;
  pipelineId: string;
  query: string;
  styleProfileId: string;
  status: SessionStatus;
  currentPhase: number;
  currentAgentIndex: number;
  completedAgents: string[];
  agentOutputs: Record<string, unknown>;
  startTime: number;
  lastActivityTime: number;
  errors: SessionError[];

  /** Research folder slug derived from query */
  slug?: string;

  /** Full path to research directory (docs/research/{slug}) */
  researchDir?: string;

  /** Locked chapter structure from dissertation-architect (Agent #6) */
  chapterStructure?: ChapterStructure;

  /** Dynamically generated Phase 6 agents based on chapter structure */
  dynamicPhase6Agents?: DynamicAgentDetails[];

  /** Recalculated total agents: 30 + N + 1 + 9 where N = chapters */
  dynamicTotalAgents?: number;
}

/**
 * CLI error response
 */
export interface ErrorResponse {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

/**
 * Phase names constant
 * 7 phases as defined in constitution.md
 */
export const PHASE_NAMES: readonly string[] = [
  'Foundation',
  'Discovery',
  'Architecture',
  'Synthesis',
  'Design',
  'Writing',
  'Validation'
] as const;

/**
 * Get phase name by number (1-indexed)
 */
export function getPhaseName(phase: number): string {
  if (phase < 1 || phase > PHASE_NAMES.length) {
    return 'Unknown';
  }
  return PHASE_NAMES[phase - 1];
}

/** Phase 1-5 agent count (indices 0-28) */
export const PHASE_1_5_AGENT_COUNT = 29;

/** Phase 6 starts at this index (introduction-writer is at index 29) */
export const PHASE_6_START_INDEX = 29;

/** Static Phase 7 agent count */
export const PHASE_7_AGENT_COUNT = 11;

/** Index where static Phase 7 agents start in PipelineConfigLoader (systematic-reviewer is at index 35) */
export const STATIC_PHASE_7_START_INDEX = 35;

// ============================================================================
// TASK-PIPE-004: Next Command Types
// ============================================================================

/**
 * Options for the next command
 * [REQ-PIPE-002]
 */
export interface NextOptions {
  json?: boolean;
  verbose?: boolean;
}

/**
 * Progress information for pipeline execution
 */
export interface ProgressInfo {
  completed: number;
  total: number;
  percentage: number;
  currentPhase: number;
  phaseName: string;
}

/**
 * Summary when pipeline is complete
 */
export interface CompletionSummary {
  duration: number;
  agentsCompleted: number;
  errors: number;
}

/**
 * Response from the next command
 * [REQ-PIPE-002]
 */
export interface NextResponse {
  sessionId: string;
  status: 'next' | 'complete';
  progress: ProgressInfo;
  agent?: AgentDetails;
  summary?: CompletionSummary;
  /** DESC episodic memory injection info */
  desc?: {
    episodesInjected: number;
    episodeIds: string[];
    /** Phase-aware window size used for retrieval (RULE-010 to RULE-014) */
    windowSize: number;
  };
  /** SonaEngine learned patterns injection info */
  patterns?: {
    patternsInjected: number;
    patternIds: string[];
    /** Combined weight of injected patterns */
    totalWeight: number;
  };
}

// ============================================================================
// TASK-PIPE-005: Complete Command Types
// ============================================================================

/**
 * Options for the complete command
 * [REQ-PIPE-003]
 * [BUG-FIX-001] Added force option for output verification bypass
 */
export interface CompleteOptions {
  result?: string;
  file?: string;
  force?: boolean;
  json?: boolean;
}

/**
 * Response from the complete command
 * [REQ-PIPE-003]
 * [PHASE-8-AUTO] Extended to include pipeline completion status
 */
export interface CompleteResponse {
  success: boolean;
  nextAgent?: string;
  /** True when all Phase 1-7 agents are complete */
  pipelineComplete?: boolean;
  /** True when Phase 8 finalize was automatically triggered */
  phase8Triggered?: boolean;
  /** True when Phase 8 prompts are ready for Claude Code Task tool */
  phase8Ready?: boolean;
  /** Phase 8 prompts with DYNAMIC agents per chapter for Claude Code execution */
  phase8Prompts?: Phase8PrepareResult;
  /** [PHASE-8-AUTO-FIX] True when Phase 8 completed automatically with final paper */
  phase8Completed?: boolean;
  /** [PHASE-8-AUTO-FIX] Phase 8 execution result with final paper path */
  phase8Result?: {
    outputPath: string | null;
    chaptersGenerated: number;
    totalWords: number;
    totalCitations: number;
  };
}

/**
 * Error when agent key doesn't match current agent
 * [REQ-PIPE-003]
 */
export class AgentMismatchError extends Error {
  public readonly expected: string;
  public readonly got: string;

  constructor(expected: string, got: string) {
    super(`Expected agent ${expected}, got ${got}`);
    this.name = 'AgentMismatchError';
    this.expected = expected;
    this.got = got;
  }
}
