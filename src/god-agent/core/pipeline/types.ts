/**
 * God Agent Coding Pipeline Type Definitions
 *
 * Defines the 40-agent, 7-phase coding pipeline structure.
 * Used by CommandTaskBridge and CodingPipelineOrchestrator.
 *
 * @module src/god-agent/core/pipeline/types
 * @see SPEC-001-architecture.md
 * @see TASK-WIRING-002-agent-mappings.md
 */

// ═════════════════════════════════════════════════════════════════════════
// PHASE TYPES
// ═════════════════════════════════════════════════════════════════════════
/**
 * The 7 phases of the coding pipeline
 * Each phase contains specialized agents for that development stage
 */
export type CodingPipelinePhase =
  | 'understanding'    // Phase 1: Task analysis and requirements (5 agents)
  | 'exploration'      // Phase 2: Solution exploration (5 agents)
  | 'architecture'     // Phase 3: System design (6 agents)
  | 'implementation'   // Phase 4: Code generation (8 agents)
  | 'testing'          // Phase 5: Test creation and execution (8 agents)
  | 'optimization'     // Phase 6: Performance and quality (4 agents)
  | 'delivery';        // Phase 7: Documentation and release (4 agents)

// ═════════════════════════════════════════════════════════════════════════
// AGENT TYPES BY PHASE (Matches actual .claude/agents/coding-pipeline/*.md files)
// REQ-PIPE-048: 48 agents total
// ═════════════════════════════════════════════════════════════════════════
/** Phase 1: Understanding - 6 agents */
export type Phase1Agent =
  | 'task-analyzer'           // #1 - CRITICAL: Pipeline entry point
  | 'requirement-extractor'   // #2
  | 'requirement-prioritizer' // #3
  | 'scope-definer'           // #4
  | 'context-gatherer'        // #5
  | 'feasibility-analyzer';   // #6

/** Phase 2: Exploration - 4 agents */
export type Phase2Agent =
  | 'pattern-explorer'        // #7
  | 'technology-scout'        // #8
  | 'research-planner'        // #9
  | 'codebase-analyzer';      // #10

/** Phase 3: Architecture - 5 agents */
export type Phase3Agent =
  | 'system-designer'         // #11
  | 'component-designer'      // #12
  | 'interface-designer'      // #13
  | 'data-architect'          // #14
  | 'integration-architect';  // #15

/** Phase 4: Implementation - 12 agents */
export type Phase4Agent =
  | 'code-generator'           // #16
  | 'type-implementer'         // #17
  | 'unit-implementer'         // #18
  | 'service-implementer'      // #19
  | 'data-layer-implementer'   // #20
  | 'api-implementer'          // #21
  | 'frontend-implementer'     // #22
  | 'error-handler-implementer'// #23
  | 'config-implementer'       // #24
  | 'logger-implementer'       // #25
  | 'dependency-manager'       // #26
  | 'implementation-coordinator'; // #27

/** Phase 5: Testing - 8 agents */
export type Phase5Agent =
  | 'test-generator'          // #28
  | 'test-runner'             // #29
  | 'integration-tester'      // #30
  | 'regression-tester'       // #31
  | 'security-tester'         // #32
  | 'coverage-analyzer'       // #33
  | 'quality-gate'            // #34
  | 'test-fixer';             // #35 - Self-correction loop for test failures

/** Phase 6: Optimization - 5 agents */
export type Phase6Agent =
  | 'performance-optimizer'   // #36
  | 'performance-architect'   // #37
  | 'code-quality-improver'   // #38
  | 'security-architect'      // #39
  | 'final-refactorer';       // #40

/** Phase 7: Delivery - 1 core agent */
export type Phase7Agent =
  | 'sign-off-approver';      // #41 - CRITICAL: Must pass for pipeline completion

// ═════════════════════════════════════════════════════════════════════════
// SHERLOCK FORENSIC AGENTS (42-48)
// ═════════════════════════════════════════════════════════════════════════
/** Sherlock Forensic Review Agents - 7 agents (one per phase + recovery)
 * Verdicts: INNOCENT (passed), GUILTY (failed), INSUFFICIENT_EVIDENCE (needs more data)
 * All forensic reviewers are CRITICAL - they gate pipeline progression. */
export type SherlockForensicAgent =
  | 'phase-1-reviewer'    // #42 - CRITICAL: Phase 1 Understanding forensic review
  | 'phase-2-reviewer'    // #43 - CRITICAL: Phase 2 Exploration forensic review
  | 'phase-3-reviewer'    // #44 - CRITICAL: Phase 3 Architecture forensic review
  | 'phase-4-reviewer'    // #45 - CRITICAL: Phase 4 Implementation forensic review
  | 'phase-5-reviewer'    // #46 - CRITICAL: Phase 5 Testing forensic review
  | 'phase-6-reviewer'    // #47 - CRITICAL: Phase 6 Optimization forensic review
  | 'recovery-agent';     // #48 - CRITICAL: Phase 7 Forensic Review / Recovery orchestration

/** Union type of all 48 coding pipeline agents (41 core + 7 Sherlock) */
export type CodingPipelineAgent =
  | Phase1Agent
  | Phase2Agent
  | Phase3Agent
  | Phase4Agent
  | Phase5Agent
  | Phase6Agent
  | Phase7Agent
  | SherlockForensicAgent;

// ═════════════════════════════════════════════════════════════════════════
// ALGORITHM TYPES (USACF)
// ═════════════════════════════════════════════════════════════════════════
/**
 * USACF Algorithm types used by agents
 * From SPEC-003-algorithms.md
 */
export type AlgorithmType =
  | 'LATS'       // Language Agent Tree Search - Complex algorithmic tasks
  | 'ReAct'      // Reasoning + Acting - Tool-heavy tasks
  | 'Self-Debug' // Self-debugging - Test-driven tasks
  | 'Reflexion'  // Pattern learning - Error recovery
  | 'PoT'        // Program of Thought - Mathematical tasks
  | 'ToT';       // Tree of Thought - Design decisions

// ═════════════════════════════════════════════════════════════════════════
// AGENT MAPPING INTERFACE
// ═════════════════════════════════════════════════════════════════════════
/**
 * Complete mapping for a single agent in the pipeline
 */
export interface IAgentMapping {
  /** Which phase this agent belongs to */
  phase: CodingPipelinePhase;

  /** Unique agent identifier */
  agentKey: CodingPipelineAgent;

  /** Execution priority within phase (lower = higher priority) */
  priority: number;

  /** Agent category for grouping */
  category: string;

  /** Primary algorithm for this agent */
  algorithm: AlgorithmType;

  /** Fallback algorithm if primary fails */
  fallbackAlgorithm?: AlgorithmType;

  /** Agents that must complete before this one */
  dependsOn?: CodingPipelineAgent[];

  /** Memory keys this agent reads from */
  memoryReads: string[];

  /** Memory keys this agent writes to */
  memoryWrites: string[];

  /** XP reward for successful completion */
  xpReward: number;

  /** Can run in parallel with other agents in same phase */
  parallelizable: boolean;

  /** If true, pipeline halts on failure */
  critical?: boolean;

  /** Human-readable description */
  description?: string;
}

// ═════════════════════════════════════════════════════════════════════════
// DAG STRUCTURES
// ═════════════════════════════════════════════════════════════════════════
/**
 * A node in the pipeline DAG
 */
export interface IPipelineDAGNode {
  /** Agent this node represents */
  agentKey: CodingPipelineAgent;

  /** Phase this agent belongs to */
  phase: CodingPipelinePhase;

  /** Agents that must complete before this one */
  dependsOn: CodingPipelineAgent[];

  /** Agents that depend on this one */
  dependents: CodingPipelineAgent[];
}

/**
 * Complete Directed Acyclic Graph for pipeline execution
 */
export interface IPipelineDAG {
  /** All nodes in the DAG, indexed by agent key */
  nodes: Map<CodingPipelineAgent, IPipelineDAGNode>;

  /** Agents grouped by phase */
  phases: Map<CodingPipelinePhase, CodingPipelineAgent[]>;

  /** Agents in topologically sorted order for execution */
  topologicalOrder: CodingPipelineAgent[];

  /** Phases where checkpoints are created for rollback */
  checkpointPhases: CodingPipelinePhase[];
}

// ═════════════════════════════════════════════════════════════════════════
// PIPELINE EXECUTION CONFIG
// ═════════════════════════════════════════════════════════════════════════
/**
 * Configuration for pipeline execution
 * Used by prepareCodeTask() and CodingPipelineOrchestrator
 */
export interface IPipelineExecutionConfig {
  /** Phase execution order */
  phases: CodingPipelinePhase[];

  /** Agents organized by phase */
  agentsByPhase: Map<CodingPipelinePhase, IAgentMapping[]>;

  /** Full DAG for dependency resolution */
  dag: IPipelineDAG;

  /** Memory namespace for coordination */
  memoryNamespace: string;

  /** Checkpoints for rollback support */
  checkpoints: CodingPipelinePhase[];

  /** Start phase (for partial execution) */
  startPhase?: number;

  /** End phase (for partial execution) */
  endPhase?: number;

  /** Original user task text for embedding-backed trajectory creation */
  taskText?: string;
}

// ═════════════════════════════════════════════════════════════════════════
// PHASE RESULT INTERFACES
// ═════════════════════════════════════════════════════════════════════════
/**
 * Result from a single agent execution
 */
export interface IAgentExecutionResult {
  agentKey: CodingPipelineAgent;
  success: boolean;
  output: unknown;
  xpEarned: number;
  memoryWrites: string[];
  executionTimeMs: number;
  error?: string;
}

/**
 * Result from a complete phase execution
 */
export interface IPhaseExecutionResult {
  phase: CodingPipelinePhase;
  success: boolean;
  agentResults: IAgentExecutionResult[];
  totalXP: number;
  checkpointCreated: boolean;
  executionTimeMs: number;
}

/**
 * Final result from complete pipeline execution
 */
export interface IPipelineExecutionResult {
  success: boolean;
  phaseResults: IPhaseExecutionResult[];
  totalXP: number;
  executionTimeMs: number;
  completedPhases: CodingPipelinePhase[];
  failedPhase?: CodingPipelinePhase;
  rollbackApplied: boolean;
}

// ═════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═════════════════════════════════════════════════════════════════════════
/**
 * Phases in execution order
 */
export const PHASE_ORDER: CodingPipelinePhase[] = [
  'understanding',
  'exploration',
  'architecture',
  'implementation',
  'testing',
  'optimization',
  'delivery',
];

/**
 * Phases where checkpoints are created for rollback
 */
export const CHECKPOINT_PHASES: CodingPipelinePhase[] = [
  'understanding',
  'exploration',
  'architecture',
  'implementation',
  'testing',
];

/**
 * Number of agents per phase (includes Sherlock forensic reviewers in their respective phases)
 * Each phase-N-reviewer runs at the END of its phase, gating progression to the next phase.
 * recovery-agent + sign-off-approver are in delivery.
 * REQ-PIPE-047: Matches actual .claude/agents/coding-pipeline/*.md files
 */
export const PHASE_AGENT_COUNTS: Record<CodingPipelinePhase, number> = {
  understanding: 7,     // 6 core + phase-1-reviewer
  exploration: 5,       // 4 core + phase-2-reviewer
  architecture: 6,      // 5 core + phase-3-reviewer
  implementation: 13,   // 12 core + phase-4-reviewer
  testing: 9,           // 8 core (includes test-fixer) + phase-5-reviewer
  optimization: 6,      // 5 core (includes final-refactorer) + phase-6-reviewer
  delivery: 2,          // recovery-agent + sign-off-approver
};

/**
 * Total number of core pipeline agents
 * 6 + 4 + 5 + 12 + 7 + 5 + 1 = 40
 * REQ-PIPE-047: Verified against actual .claude/agents/coding-pipeline/*.md files
 */
export const CORE_AGENTS = 40;

/**
 * Number of Sherlock forensic review agents
 */
export const SHERLOCK_AGENT_COUNT = 7;

/**
 * Total number of agents in the pipeline
 * 41 core + 7 Sherlock = 48
 */
export const TOTAL_AGENTS = 48;

/**
 * Sherlock Forensic Review agents (42-48)
 * All are CRITICAL - they gate pipeline phase progression
 */
export const SHERLOCK_AGENTS: SherlockForensicAgent[] = [
  'phase-1-reviewer',    // #42 - Understanding review
  'phase-2-reviewer',    // #43 - Exploration review
  'phase-3-reviewer',    // #44 - Architecture review
  'phase-4-reviewer',    // #45 - Implementation review
  'phase-5-reviewer',    // #46 - Testing review
  'phase-6-reviewer',    // #47 - Optimization review
  'recovery-agent',      // #48 - Phase 7 / Recovery
];

/**
 * Critical agents that halt pipeline on failure
 * Includes core critical agents AND all Sherlock forensic reviewers
 * REQ-PIPE-048: Matches actual .claude/agents/coding-pipeline/*.md files
 */
export const CRITICAL_AGENTS: CodingPipelineAgent[] = [
  // Core critical agents
  'task-analyzer',       // #1 - Phase 1: Pipeline entry point (CRITICAL in frontmatter)
  'interface-designer',  // #13 - Phase 3: API contract validation
  'quality-gate',        // #34 - Phase 5: L-Score validation gateway
  'sign-off-approver',   // #41 - Phase 7: Final approval
  // Sherlock forensic reviewers (all critical - gate phase progression)
  'phase-1-reviewer',    // #42 - Understanding forensic review
  'phase-2-reviewer',    // #43 - Exploration forensic review
  'phase-3-reviewer',    // #44 - Architecture forensic review
  'phase-4-reviewer',    // #45 - Implementation forensic review
  'phase-5-reviewer',    // #46 - Testing forensic review
  'phase-6-reviewer',    // #47 - Optimization forensic review
  'recovery-agent',      // #48 - Phase 7 forensic review / Recovery
];

/**
 * Mapping of Sherlock forensic reviewers to their phases
 */
export const SHERLOCK_PHASE_MAP: Record<SherlockForensicAgent, CodingPipelinePhase> = {
  'phase-1-reviewer': 'understanding',
  'phase-2-reviewer': 'exploration',
  'phase-3-reviewer': 'architecture',
  'phase-4-reviewer': 'implementation',
  'phase-5-reviewer': 'testing',
  'phase-6-reviewer': 'optimization',
  'recovery-agent': 'delivery',
};

/**
 * Memory namespace for coding pipeline
 */
export const CODING_MEMORY_NAMESPACE = 'coding';

/**
 * Memory key prefixes by phase
 */
export const MEMORY_PREFIXES: Record<CodingPipelinePhase, string> = {
  understanding: 'coding/understanding',
  exploration: 'coding/exploration',
  architecture: 'coding/architecture',
  implementation: 'coding/implementation',
  testing: 'coding/testing',
  optimization: 'coding/optimization',
  delivery: 'coding/delivery',
};

// ═════════════════════════════════════════════════════════════════════════
// SHERLOCK FORENSIC VERIFICATION TYPES
// ═════════════════════════════════════════════════════════════════════════
/**
 * Sherlock forensic verification verdict values.
 * Used by agents 41-47 in Phase 6 for code review.
 */
export enum SherlockVerdict {
  /** Code passes all forensic checks */
  INNOCENT = 'INNOCENT',
  /** Code has critical issues requiring remediation */
  GUILTY = 'GUILTY',
  /** Not enough information to make determination */
  INSUFFICIENT_EVIDENCE = 'INSUFFICIENT_EVIDENCE',
}

/**
 * Confidence level for Sherlock verdicts.
 */
export type SherlockConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Evidence collected during forensic review.
 */
export interface ISherlockEvidence {
  /** Type of evidence (code_pattern, test_result, static_analysis, etc.) */
  type: string;
  /** File path where evidence was found */
  filePath?: string;
  /** Line numbers if applicable */
  lineRange?: { start: number; end: number };
  /** Description of the evidence */
  description: string;
  /** Raw data or code snippet */
  data?: unknown;
}

/**
 * Issue found during forensic review.
 */
export interface ISherlockIssue {
  /** Severity: critical, high, medium, low */
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** Category of issue */
  category: string;
  /** Description of the issue */
  description: string;
  /** File path where issue was found */
  filePath?: string;
  /** Suggested remediation */
  remediation?: string;
}

/**
 * Complete result from Sherlock forensic verification.
 */
export interface ISherlockResult {
  /** Overall verdict */
  verdict: SherlockVerdict;
  /** Confidence in the verdict */
  confidence: SherlockConfidence;
  /** Evidence supporting the verdict */
  evidence: ISherlockEvidence[];
  /** Issues found during review */
  issues: ISherlockIssue[];
  /** Agent that produced this result */
  agentKey: string;
  /** Timestamp of review */
  timestamp: string;
  /** Optional reasoning */
  reasoning?: string;
}

/**
 * Phase-level review result from Sherlock pipeline.
 */
export interface IPhaseReviewResult {
  /** Phase number reviewed */
  phase: number;
  /** Verdict for this phase */
  verdict: SherlockVerdict;
  /** Confidence level */
  confidence: SherlockConfidence;
  /** Remediation steps if GUILTY */
  remediations: string[];
  /** Number of retry attempts */
  retryCount: number;
  /** Individual agent results */
  agentResults?: ISherlockResult[];
}
