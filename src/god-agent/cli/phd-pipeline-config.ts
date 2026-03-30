/**
 * PhD Pipeline Configuration
 *
 * Complete TypeScript interfaces and configuration constants for the PhD Pipeline.
 * Implements Technical Spec Section 3 with 46 agents across 7 phases.
 *
 * @module phd-pipeline-config
 * @version 1.0.0
 *
 * Constitution Compliance:
 * - RULE-001: NO placeholder code - complete implementation only
 * - RULE-002: NO `as any` casts - explicit types only
 * - RULE-006: ALL functions must have explicit return types
 * - RULE-011: Backward compatible with existing session schema
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Configuration for an individual agent in the PhD Pipeline.
 * Each agent has a unique key, belongs to a phase, and produces specific outputs.
 */
export interface AgentConfig {
  /** Unique identifier key for the agent (kebab-case, e.g., "self-ask-decomposer") */
  readonly key: string;

  /** Human-readable display name for the agent */
  readonly displayName: string;

  /** Phase number (1-7) this agent belongs to */
  readonly phase: number;

  /** Filename of the agent markdown file (without path, e.g., "self-ask-decomposer.md") */
  readonly file: string;

  /** Memory keys this agent reads from or writes to */
  readonly memoryKeys: readonly string[];

  /** Output artifacts this agent produces */
  readonly outputArtifacts: readonly string[];
}

/**
 * Definition of a pipeline phase containing multiple agents.
 * Phases are executed sequentially, with agents within each phase
 * potentially having dependencies on previous agents.
 */
export interface PhaseDefinition {
  /** Unique phase identifier (1-7) */
  readonly id: number;

  /** Human-readable phase name */
  readonly name: string;

  /** Array of agent keys belonging to this phase */
  readonly agentKeys: readonly string[];

  /** Description of the phase's purpose and objectives */
  readonly description: string;
}

/**
 * Complete pipeline configuration containing all agents, phases,
 * and operational settings.
 */
export interface PipelineConfig {
  /** Array of all agent configurations */
  readonly agents: readonly AgentConfig[];

  /** Array of all phase definitions */
  readonly phases: readonly PhaseDefinition[];

  /** Namespace for memory operations */
  readonly memoryNamespace: string;

  /** Directory path containing agent markdown files */
  readonly agentsDirectory: string;
}

/**
 * Session state for tracking pipeline execution progress.
 * Backward compatible with existing PipelineSession schema.
 */
export interface SessionState {
  /** Unique session identifier (UUID v4) */
  readonly sessionId: string;

  /** Research topic or query being investigated */
  readonly topic: string;

  /** Current phase number (1-7) */
  readonly currentPhase: number;

  /** Index of current agent within the complete agent list */
  readonly currentAgentIndex: number;

  /** Array of completed agent keys */
  readonly completedAgents: readonly string[];

  /** ISO timestamp when session started */
  readonly startedAt: string;

  /** ISO timestamp of last activity */
  readonly lastActivityAt: string;

  /** Current session status
   * TASK-CLI-004: Added 'phase8' status for Phase 8 finalization tracking
   */
  readonly status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'phase8';
}

// ============================================================================
// AGENT DEFINITIONS - 46 AGENTS ACROSS 7 PHASES
// ============================================================================

/**
 * Complete array of all 46 PhD Pipeline agents.
 * Agents are ordered by phase and execution sequence.
 *
 * CANONICAL ORDER: Matches successful run from pipeline-loader.ts AGENT_ORDER
 * Phase counts: 7+4+4+5+9+6+11=46
 */
export const PHD_AGENTS: readonly AgentConfig[] = [
  // =========================================================================
  // PHASE 1: FOUNDATION (7 agents, indices 0-6)
  // Initial problem analysis, decomposition, and research planning
  // =========================================================================
  {
    key: 'step-back-analyzer',
    displayName: 'Step-Back Analyzer',
    phase: 1,
    file: 'step-back-analyzer.md',
    memoryKeys: ['research/foundation/framing', 'research/meta/perspective'],
    outputArtifacts: ['high-level-framing.md', 'abstraction-analysis.md'],
  },
  {
    key: 'self-ask-decomposer',
    displayName: 'Self-Ask Decomposer',
    phase: 1,
    file: 'self-ask-decomposer.md',
    memoryKeys: ['research/meta/questions', 'research/foundation/decomposition'],
    outputArtifacts: ['essential-questions.md', 'knowledge-gaps.md'],
  },
  {
    key: 'ambiguity-clarifier',
    displayName: 'Ambiguity Clarifier',
    phase: 1,
    file: 'ambiguity-clarifier.md',
    memoryKeys: ['research/foundation/definitions', 'research/meta/clarifications'],
    outputArtifacts: ['term-definitions.md', 'clarified-scope.md'],
  },
  {
    key: 'research-planner',
    displayName: 'Research Planner',
    phase: 1,
    file: 'research-planner.md',
    memoryKeys: ['research/foundation/plan', 'research/meta/strategy'],
    outputArtifacts: ['research-plan.md', 'timeline.md'],
  },
  {
    key: 'construct-definer',
    displayName: 'Construct Definer',
    phase: 1,
    file: 'construct-definer.md',
    memoryKeys: ['research/foundation/constructs', 'research/theory/definitions'],
    outputArtifacts: ['construct-definitions.md', 'operationalizations.md'],
  },
  {
    key: 'dissertation-architect',
    displayName: 'Dissertation Architect',
    phase: 1,
    file: 'dissertation-architect.md',
    memoryKeys: ['research/writing/structure', 'research/document/architecture'],
    outputArtifacts: ['dissertation-outline.md', 'chapter-structure.md'],
  },
  {
    key: 'chapter-synthesizer',
    displayName: 'Chapter Synthesizer',
    phase: 1,
    file: 'chapter-synthesizer.md',
    memoryKeys: ['research/quality/synthesis', 'research/document/final'],
    outputArtifacts: ['final-synthesis.md', 'dissertation-complete.md'],
  },

  // =========================================================================
  // PHASE 2: DISCOVERY (4 agents, indices 7-10)
  // Literature review, source classification, citation extraction
  // =========================================================================
  {
    key: 'literature-mapper',
    displayName: 'Literature Mapper',
    phase: 2,
    file: 'literature-mapper.md',
    memoryKeys: ['research/literature/map', 'research/sources/index'],
    outputArtifacts: ['literature-map.md', 'source-catalog.md'],
  },
  {
    key: 'source-tier-classifier',
    displayName: 'Source Tier Classifier',
    phase: 2,
    file: 'source-tier-classifier.md',
    memoryKeys: ['research/literature/tiers', 'research/quality/sources'],
    outputArtifacts: ['source-tiers.md', 'credibility-assessment.md'],
  },
  {
    key: 'citation-extractor',
    displayName: 'Citation Extractor',
    phase: 2,
    file: 'citation-extractor.md',
    memoryKeys: ['research/quality/extraction', 'research/sources/citations'],
    outputArtifacts: ['extracted-citations.md', 'reference-list.md'],
  },
  {
    key: 'context-tier-manager',
    displayName: 'Context Tier Manager',
    phase: 2,
    file: 'context-tier-manager.md',
    memoryKeys: ['research/literature/context', 'research/meta/tiers'],
    outputArtifacts: ['context-hierarchy.md', 'tier-mappings.md'],
  },

  // =========================================================================
  // PHASE 3: ARCHITECTURE (4 agents, indices 11-14)
  // Theoretical framework, contradiction analysis, gap hunting, risk analysis
  // =========================================================================
  {
    key: 'theoretical-framework-analyst',
    displayName: 'Theoretical Framework Analyst',
    phase: 3,
    file: 'theoretical-framework-analyst.md',
    memoryKeys: ['research/foundation/framework', 'research/theory/analysis'],
    outputArtifacts: ['theoretical-framework.md', 'framework-map.md'],
  },
  {
    key: 'contradiction-analyzer',
    displayName: 'Contradiction Analyzer',
    phase: 3,
    file: 'contradiction-analyzer.md',
    memoryKeys: ['research/analysis/contradictions', 'research/findings/conflicts'],
    outputArtifacts: ['contradictions-report.md', 'resolution-proposals.md'],
  },
  {
    key: 'gap-hunter',
    displayName: 'Gap Hunter',
    phase: 3,
    file: 'gap-hunter.md',
    memoryKeys: ['research/analysis/gaps', 'research/findings/gaps'],
    outputArtifacts: ['research-gaps.md', 'gap-priorities.md'],
  },
  {
    key: 'risk-analyst',
    displayName: 'Risk Analyst',
    phase: 3,
    file: 'risk-analyst.md',
    memoryKeys: ['research/analysis/risks', 'research/meta/risks'],
    outputArtifacts: ['risk-assessment.md', 'risk-mitigation.md'],
  },

  // =========================================================================
  // PHASE 4: SYNTHESIS (5 agents, indices 15-19)
  // Evidence synthesis, pattern analysis, theory building
  // =========================================================================
  {
    key: 'evidence-synthesizer',
    displayName: 'Evidence Synthesizer',
    phase: 4,
    file: 'evidence-synthesizer.md',
    memoryKeys: ['research/analysis/evidence', 'research/synthesis/evidence'],
    outputArtifacts: ['evidence-synthesis.md', 'evidence-matrix.md'],
  },
  {
    key: 'pattern-analyst',
    displayName: 'Pattern Analyst',
    phase: 4,
    file: 'pattern-analyst.md',
    memoryKeys: ['research/synthesis/patterns', 'research/findings/patterns'],
    outputArtifacts: ['pattern-analysis.md', 'pattern-catalog.md'],
  },
  {
    key: 'thematic-synthesizer',
    displayName: 'Thematic Synthesizer',
    phase: 4,
    file: 'thematic-synthesizer.md',
    memoryKeys: ['research/synthesis/themes', 'research/findings/themes'],
    outputArtifacts: ['thematic-synthesis.md', 'theme-hierarchy.md'],
  },
  {
    key: 'theory-builder',
    displayName: 'Theory Builder',
    phase: 4,
    file: 'theory-builder.md',
    memoryKeys: ['research/synthesis/theory', 'research/theory/construction'],
    outputArtifacts: ['theory-development.md', 'theoretical-model.md'],
  },
  {
    key: 'opportunity-identifier',
    displayName: 'Opportunity Identifier',
    phase: 4,
    file: 'opportunity-identifier.md',
    memoryKeys: ['research/synthesis/opportunities', 'research/findings/opportunities'],
    outputArtifacts: ['research-opportunities.md', 'opportunity-matrix.md'],
  },

  // =========================================================================
  // PHASE 5: DESIGN (9 agents, indices 20-28)
  // Research design, hypothesis, model architecture, methodology
  // =========================================================================
  {
    key: 'method-designer',
    displayName: 'Method Designer',
    phase: 5,
    file: 'method-designer.md',
    memoryKeys: ['research/methods/design', 'research/methodology/approach'],
    outputArtifacts: ['research-design.md', 'method-rationale.md'],
  },
  {
    key: 'hypothesis-generator',
    displayName: 'Hypothesis Generator',
    phase: 5,
    file: 'hypothesis-generator.md',
    memoryKeys: ['research/synthesis/hypotheses', 'research/theory/hypotheses'],
    outputArtifacts: ['hypotheses.md', 'testable-predictions.md'],
  },
  {
    key: 'model-architect',
    displayName: 'Model Architect',
    phase: 5,
    file: 'model-architect.md',
    memoryKeys: ['research/synthesis/models', 'research/theory/models'],
    outputArtifacts: ['conceptual-model.md', 'model-specifications.md'],
  },
  {
    key: 'analysis-planner',
    displayName: 'Analysis Planner',
    phase: 5,
    file: 'analysis-planner.md',
    memoryKeys: ['research/methods/analysis', 'research/methodology/analysis'],
    outputArtifacts: ['analysis-plan.md', 'statistical-approach.md'],
  },
  {
    key: 'sampling-strategist',
    displayName: 'Sampling Strategist',
    phase: 5,
    file: 'sampling-strategist.md',
    memoryKeys: ['research/methods/sampling', 'research/methodology/sampling'],
    outputArtifacts: ['sampling-strategy.md', 'sample-specifications.md'],
  },
  {
    key: 'instrument-developer',
    displayName: 'Instrument Developer',
    phase: 5,
    file: 'instrument-developer.md',
    memoryKeys: ['research/methods/instruments', 'research/methodology/instruments'],
    outputArtifacts: ['research-instruments.md', 'instrument-validation.md'],
  },
  {
    key: 'validity-guardian',
    displayName: 'Validity Guardian',
    phase: 5,
    file: 'validity-guardian.md',
    memoryKeys: ['research/methods/validity', 'research/quality/validity'],
    outputArtifacts: ['validity-assessment.md', 'threat-mitigation.md'],
  },
  {
    key: 'methodology-scanner',
    displayName: 'Methodology Scanner',
    phase: 5,
    file: 'methodology-scanner.md',
    memoryKeys: ['research/literature/methods', 'research/methodology/survey'],
    outputArtifacts: ['methodology-survey.md', 'method-comparison.md'],
  },
  {
    key: 'methodology-writer',
    displayName: 'Methodology Writer',
    phase: 5,
    file: 'methodology-writer.md',
    memoryKeys: ['research/writing/methodology', 'research/document/chapter3'],
    outputArtifacts: ['methodology-chapter.md', 'method-details.md'],
  },

  // =========================================================================
  // PHASE 6: WRITING (6 agents, indices 29-34)
  // Dissertation chapter writing
  // =========================================================================
  {
    key: 'introduction-writer',
    displayName: 'Introduction Writer',
    phase: 6,
    file: 'introduction-writer.md',
    memoryKeys: ['research/writing/introduction', 'research/document/chapter1'],
    outputArtifacts: ['introduction.md', 'problem-statement.md'],
  },
  {
    key: 'literature-review-writer',
    displayName: 'Literature Review Writer',
    phase: 6,
    file: 'literature-review-writer.md',
    memoryKeys: ['research/writing/literature', 'research/document/chapter2'],
    outputArtifacts: ['literature-review.md', 'synthesis-narrative.md'],
  },
  {
    key: 'results-writer',
    displayName: 'Results Writer',
    phase: 6,
    file: 'results-writer.md',
    memoryKeys: ['research/writing/results', 'research/document/chapter4'],
    outputArtifacts: ['results-chapter.md', 'findings-narrative.md'],
  },
  {
    key: 'discussion-writer',
    displayName: 'Discussion Writer',
    phase: 6,
    file: 'discussion-writer.md',
    memoryKeys: ['research/writing/discussion', 'research/document/chapter5'],
    outputArtifacts: ['discussion-chapter.md', 'implications.md'],
  },
  {
    key: 'conclusion-writer',
    displayName: 'Conclusion Writer',
    phase: 6,
    file: 'conclusion-writer.md',
    memoryKeys: ['research/writing/conclusion', 'research/document/chapter6'],
    outputArtifacts: ['conclusion-chapter.md', 'future-directions.md'],
  },
  {
    key: 'abstract-writer',
    displayName: 'Abstract Writer',
    phase: 6,
    file: 'abstract-writer.md',
    memoryKeys: ['research/writing/abstract', 'research/document/abstract'],
    outputArtifacts: ['abstract.md', 'executive-summary.md'],
  },

  // =========================================================================
  // PHASE 7: VALIDATION (11 agents, indices 35-45)
  // Systematic review, ethics, citation validation, quality assurance
  // =========================================================================
  {
    key: 'systematic-reviewer',
    displayName: 'Systematic Reviewer',
    phase: 7,
    file: 'systematic-reviewer.md',
    memoryKeys: ['research/literature/systematic', 'research/synthesis/systematic-review'],
    outputArtifacts: ['systematic-review.md', 'prisma-flowchart.md'],
  },
  {
    key: 'ethics-reviewer',
    displayName: 'Ethics Reviewer',
    phase: 7,
    file: 'ethics-reviewer.md',
    memoryKeys: ['research/methods/ethics', 'research/compliance/ethics'],
    outputArtifacts: ['ethics-review.md', 'irb-protocol.md'],
  },
  {
    key: 'adversarial-reviewer',
    displayName: 'Adversarial Reviewer',
    phase: 7,
    file: 'adversarial-reviewer.md',
    memoryKeys: ['research/quality/critique', 'research/review/adversarial'],
    outputArtifacts: ['adversarial-critique.md', 'weakness-report.md'],
  },
  {
    key: 'confidence-quantifier',
    displayName: 'Confidence Quantifier',
    phase: 7,
    file: 'confidence-quantifier.md',
    memoryKeys: ['research/quality/confidence', 'research/meta/certainty'],
    outputArtifacts: ['confidence-scores.md', 'uncertainty-analysis.md'],
  },
  {
    key: 'citation-validator',
    displayName: 'Citation Validator',
    phase: 7,
    file: 'citation-validator.md',
    memoryKeys: ['research/quality/validation', 'research/sources/verified'],
    outputArtifacts: ['citation-validation.md', 'source-verification.md'],
  },
  {
    key: 'reproducibility-checker',
    displayName: 'Reproducibility Checker',
    phase: 7,
    file: 'reproducibility-checker.md',
    memoryKeys: ['research/quality/reproducibility', 'research/meta/replication'],
    outputArtifacts: ['reproducibility-report.md', 'replication-guide.md'],
  },
  {
    key: 'apa-citation-specialist',
    displayName: 'APA Citation Specialist',
    phase: 7,
    file: 'apa-citation-specialist.md',
    memoryKeys: ['research/quality/citations', 'research/document/references'],
    outputArtifacts: ['citation-audit.md', 'apa-compliance.md'],
  },
  {
    key: 'consistency-validator',
    displayName: 'Consistency Validator',
    phase: 7,
    file: 'consistency-validator.md',
    memoryKeys: ['research/quality/consistency', 'research/document/coherence'],
    outputArtifacts: ['consistency-report.md', 'coherence-audit.md'],
  },
  {
    key: 'quality-assessor',
    displayName: 'Quality Assessor',
    phase: 7,
    file: 'quality-assessor.md',
    memoryKeys: ['research/analysis/quality', 'research/meta/assessment'],
    outputArtifacts: ['quality-assessment.md', 'quality-scores.md'],
  },
  {
    key: 'bias-detector',
    displayName: 'Bias Detector',
    phase: 7,
    file: 'bias-detector.md',
    memoryKeys: ['research/analysis/bias', 'research/quality/bias'],
    outputArtifacts: ['bias-analysis.md', 'bias-mitigation.md'],
  },
  {
    key: 'file-length-manager',
    displayName: 'File Length Manager',
    phase: 7,
    file: 'file-length-manager.md',
    memoryKeys: ['research/quality/structure', 'research/document/formatting'],
    outputArtifacts: ['structure-audit.md', 'length-compliance.md'],
  },
] as const;

// ============================================================================
// PHASE DEFINITIONS - 7 PHASES
// ============================================================================

/**
 * Complete array of all 7 PhD Pipeline phases.
 * Phases are executed sequentially with agents within each phase
 * following dependency ordering.
 */
export const PHD_PHASES: readonly PhaseDefinition[] = [
  // PHASE 1: FOUNDATION (7 agents, indices 0-6)
  // Establishes research direction, decomposes questions, and creates chapter structure
  {
    id: 1,
    name: 'Foundation',
    description: 'Initial problem analysis, step-back reasoning, question decomposition, ambiguity resolution, research planning, construct definition, dissertation architecture, and chapter synthesis framework.',
    agentKeys: [
      'step-back-analyzer',
      'self-ask-decomposer',
      'ambiguity-clarifier',
      'research-planner',
      'construct-definer',
      'dissertation-architect',
      'chapter-synthesizer',
    ],
  },
  // PHASE 2: DISCOVERY (4 agents, indices 7-10)
  // Literature mapping and source management
  {
    id: 2,
    name: 'Discovery',
    description: 'Comprehensive literature mapping, source classification by credibility tiers, citation extraction, and context tier management.',
    agentKeys: [
      'literature-mapper',
      'source-tier-classifier',
      'citation-extractor',
      'context-tier-manager',
    ],
  },
  // PHASE 3: ARCHITECTURE (4 agents, indices 11-14)
  // Theoretical framework and analysis structure
  {
    id: 3,
    name: 'Architecture',
    description: 'Theoretical framework analysis, contradiction detection, gap identification, and risk assessment.',
    agentKeys: [
      'theoretical-framework-analyst',
      'contradiction-analyzer',
      'gap-hunter',
      'risk-analyst',
    ],
  },
  // PHASE 4: SYNTHESIS (5 agents, indices 15-19)
  // Pattern recognition and theory building
  {
    id: 4,
    name: 'Synthesis',
    description: 'Evidence synthesis, pattern recognition, thematic synthesis, theory building, and opportunity identification.',
    agentKeys: [
      'evidence-synthesizer',
      'pattern-analyst',
      'thematic-synthesizer',
      'theory-builder',
      'opportunity-identifier',
    ],
  },
  // PHASE 5: DESIGN (9 agents, indices 20-28)
  // Research methodology and instrument development
  {
    id: 5,
    name: 'Design',
    description: 'Research methodology design, hypothesis generation, model architecture, analysis planning, sampling strategy, instrument development, validity assurance, methodology scanning, and methodology writing.',
    agentKeys: [
      'method-designer',
      'hypothesis-generator',
      'model-architect',
      'analysis-planner',
      'sampling-strategist',
      'instrument-developer',
      'validity-guardian',
      'methodology-scanner',
      'methodology-writer',
    ],
  },
  // PHASE 6: WRITING (6 agents, indices 29-34)
  // Document creation - all chapter writers
  {
    id: 6,
    name: 'Writing',
    description: 'Document creation including introduction, literature review, results, discussion, conclusion, and abstract chapters.',
    agentKeys: [
      'introduction-writer',
      'literature-review-writer',
      'results-writer',
      'discussion-writer',
      'conclusion-writer',
      'abstract-writer',
    ],
  },
  // PHASE 7: VALIDATION (11 agents, indices 35-45)
  // Quality assurance and final validation
  {
    id: 7,
    name: 'Validation',
    description: 'Final quality assurance including systematic review, ethics review, adversarial review, confidence quantification, citation validation, reproducibility checking, APA formatting, consistency validation, quality assessment, bias detection, and file length management.',
    agentKeys: [
      'systematic-reviewer',
      'ethics-reviewer',
      'adversarial-reviewer',
      'confidence-quantifier',
      'citation-validator',
      'reproducibility-checker',
      'apa-citation-specialist',
      'consistency-validator',
      'quality-assessor',
      'bias-detector',
      'file-length-manager',
    ],
  },
] as const;

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

/**
 * Default PhD Pipeline configuration with all 46 agents and 7 phases.
 * Memory namespace follows project/research convention for integration
 * with MemoryGraph and local file-based memory.
 */
export const DEFAULT_CONFIG: PipelineConfig = {
  agents: PHD_AGENTS,
  phases: PHD_PHASES,
  memoryNamespace: 'project/research',
  agentsDirectory: '.claude/agents/phdresearch',
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get an agent configuration by its key.
 * @param key - The agent key to look up
 * @returns The agent configuration or undefined if not found
 */
export function getAgentByKey(key: string): AgentConfig | undefined {
  return PHD_AGENTS.find((agent) => agent.key === key);
}

/**
 * Get all agents for a specific phase.
 * @param phaseId - The phase number (1-7)
 * @returns Array of agent configurations for the phase
 */
export function getAgentsByPhase(phaseId: number): readonly AgentConfig[] {
  return PHD_AGENTS.filter((agent) => agent.phase === phaseId);
}

/**
 * Get a phase definition by its ID.
 * @param phaseId - The phase number (1-7)
 * @returns The phase definition or undefined if not found
 */
export function getPhaseById(phaseId: number): PhaseDefinition | undefined {
  return PHD_PHASES.find((phase) => phase.id === phaseId);
}

/**
 * Get the phase name for a given phase ID.
 * @param phaseId - The phase number (1-7)
 * @returns The phase name or 'Unknown' if not found
 */
export function getPhaseName(phaseId: number): string {
  const phase = getPhaseById(phaseId);
  return phase ? phase.name : 'Unknown';
}

/**
 * Get the total number of agents in the pipeline.
 * @returns The total agent count (46)
 */
export function getTotalAgentCount(): number {
  return PHD_AGENTS.length;
}

/**
 * Get the total number of phases in the pipeline.
 * @returns The total phase count (7)
 */
export function getTotalPhaseCount(): number {
  return PHD_PHASES.length;
}

/**
 * Get the index of an agent by its key.
 * @param key - The agent key to look up
 * @returns The agent index (0-based) or -1 if not found
 */
export function getAgentIndex(key: string): number {
  return PHD_AGENTS.findIndex((agent) => agent.key === key);
}

/**
 * Get the agent at a specific index.
 * @param index - The agent index (0-based)
 * @returns The agent configuration or undefined if out of bounds
 */
export function getAgentByIndex(index: number): AgentConfig | undefined {
  if (index < 0 || index >= PHD_AGENTS.length) {
    return undefined;
  }
  return PHD_AGENTS[index];
}

/**
 * Validate that all phase agent keys match actual agent definitions.
 * @returns True if configuration is valid, throws Error otherwise
 */
export function validateConfiguration(): boolean {
  const agentKeys = new Set(PHD_AGENTS.map((agent) => agent.key));

  for (const phase of PHD_PHASES) {
    for (const agentKey of phase.agentKeys) {
      if (!agentKeys.has(agentKey)) {
        throw new Error(
          `Invalid configuration: Phase ${phase.id} (${phase.name}) references unknown agent "${agentKey}"`
        );
      }
    }
  }

  // Verify agent count matches phase agent counts
  const phaseAgentCount = PHD_PHASES.reduce(
    (sum, phase) => sum + phase.agentKeys.length,
    0
  );

  if (phaseAgentCount !== PHD_AGENTS.length) {
    throw new Error(
      `Invalid configuration: Phase agent count (${phaseAgentCount}) does not match total agents (${PHD_AGENTS.length})`
    );
  }

  return true;
}

/**
 * Create a new session state with initial values.
 * @param sessionId - UUID v4 session identifier
 * @param topic - Research topic or query
 * @returns Initial session state
 */
export function createInitialSessionState(
  sessionId: string,
  topic: string
): SessionState {
  const now = new Date().toISOString();

  return {
    sessionId,
    topic,
    currentPhase: 1,
    currentAgentIndex: 0,
    completedAgents: [],
    startedAt: now,
    lastActivityAt: now,
    status: 'pending',
  };
}

/**
 * Get the file path for an agent's markdown definition.
 * @param agentKey - The agent key
 * @param baseDir - Optional base directory (defaults to DEFAULT_CONFIG.agentsDirectory)
 * @returns The relative file path or undefined if agent not found
 */
export function getAgentFilePath(
  agentKey: string,
  baseDir: string = DEFAULT_CONFIG.agentsDirectory
): string | undefined {
  const agent = getAgentByKey(agentKey);
  if (!agent) {
    return undefined;
  }
  return `${baseDir}/${agent.file}`;
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if a value is a valid SessionState.
 * @param value - The value to check
 * @returns True if the value is a valid SessionState
 */
export function isSessionState(value: unknown): value is SessionState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const session = value as Record<string, unknown>;

  return (
    typeof session.sessionId === 'string' &&
    typeof session.topic === 'string' &&
    typeof session.currentPhase === 'number' &&
    typeof session.currentAgentIndex === 'number' &&
    Array.isArray(session.completedAgents) &&
    typeof session.startedAt === 'string' &&
    typeof session.lastActivityAt === 'string' &&
    typeof session.status === 'string' &&
    // TASK-CLI-004: Added 'phase8' to valid status values
    ['pending', 'running', 'paused', 'completed', 'failed', 'phase8'].includes(
      session.status as string
    )
  );
}

/**
 * Type guard to check if a value is a valid AgentConfig.
 * @param value - The value to check
 * @returns True if the value is a valid AgentConfig
 */
export function isAgentConfig(value: unknown): value is AgentConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const agent = value as Record<string, unknown>;

  return (
    typeof agent.key === 'string' &&
    typeof agent.displayName === 'string' &&
    typeof agent.phase === 'number' &&
    typeof agent.file === 'string' &&
    Array.isArray(agent.memoryKeys) &&
    Array.isArray(agent.outputArtifacts)
  );
}
