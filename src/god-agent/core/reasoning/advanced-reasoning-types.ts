/**
 * Advanced Reasoning Type Definitions
 * RSN-002 Implementation - 8 Advanced Reasoning Modes
 *
 * This file defines types for the extended reasoning capabilities:
 * - Analogical: Cross-domain pattern transfer
 * - Abductive: Best explanation finding
 * - Counterfactual: Alternative world simulation
 * - Decomposition: Problem breakdown
 * - Adversarial: Critical argument testing
 * - Temporal: Time-based reasoning
 * - Constraint-based: Satisfaction solving
 * - First Principles: Axiomatic derivation
 *
 * Dependencies:
 * - reasoning-types.ts (base types)
 * - pattern-types.ts (Pattern, TaskType)
 * - causal-types.ts (NodeID, CausalNode)
 */

// Import base types
import type {
  IReasoningRequest,
  IReasoningResponse,
  ReasoningMode
} from './reasoning-types.js';
import type { Pattern, TaskType } from './pattern-types.js';
import type { NodeID } from './causal-types.js';

// Re-export for convenience
export type { IReasoningRequest, IReasoningResponse, Pattern, TaskType, NodeID };

// ============================================================================
// ADVANCED REASONING MODES ENUM
// ============================================================================

/**
 * Extended reasoning modes beyond base pattern-match, causal-inference, contextual, hybrid
 *
 * These modes provide specialized reasoning capabilities for complex tasks:
 * - Analogical: Transfer knowledge from source to target domain
 * - Abductive: Infer most likely explanations from observations
 * - Counterfactual: Explore "what if" scenarios
 * - Decomposition: Break down complex problems
 * - Adversarial: Test arguments with counter-arguments
 * - Temporal: Reason about time-dependent sequences
 * - Constraint-based: Solve problems with constraints
 * - First Principles: Derive from fundamental axioms
 */
export enum AdvancedReasoningMode {
  /** Cross-domain pattern transfer and mapping */
  ANALOGICAL = 'analogical',

  /** Best explanation inference from observations */
  ABDUCTIVE = 'abductive',

  /** Alternative world simulation and intervention analysis */
  COUNTERFACTUAL = 'counterfactual',

  /** Problem breakdown into subproblems */
  DECOMPOSITION = 'decomposition',

  /** Critical argument testing with counter-arguments */
  ADVERSARIAL = 'adversarial',

  /** Time-based sequential reasoning */
  TEMPORAL = 'temporal',

  /** Constraint satisfaction solving */
  CONSTRAINT_BASED = 'constraint-based',

  /** Axiomatic derivation from first principles */
  FIRST_PRINCIPLES = 'first-principles'
}

// ============================================================================
// EXTENDED MODE SELECTOR FEATURES
// ============================================================================

/**
 * Extended query features for advanced mode selection
 *
 * Includes scores for both base modes (pattern, causal, contextual) and
 * advanced modes for intelligent routing
 */
export interface ExtendedQueryFeatures {
  // === Base Mode Scores (from ModeSelector) ===
  /** Pattern matching score [0, 1] */
  patternMatch: number;

  /** Causal inference score [0, 1] */
  causalInference: number;

  /** Contextual search score [0, 1] */
  contextual: number;

  // === Advanced Mode Scores ===
  /** Analogical reasoning score [0, 1] */
  analogical: number;

  /** Abductive reasoning score [0, 1] */
  abductive: number;

  /** Counterfactual reasoning score [0, 1] */
  counterfactual: number;

  /** Decomposition reasoning score [0, 1] */
  decomposition: number;

  /** Adversarial reasoning score [0, 1] */
  adversarial: number;

  /** Temporal reasoning score [0, 1] */
  temporal: number;

  /** Constraint-based reasoning score [0, 1] */
  constraintBased: number;

  /** First principles reasoning score [0, 1] */
  firstPrinciples: number;
}

/**
 * Query features extracted for mode selection
 *
 * Analyzes query characteristics to determine best reasoning mode
 */
export interface QueryFeatures {
  /** Primary domain of the query */
  domain: string;

  /** Confidence in domain classification [0, 1] */
  domainConfidence: number;

  /** Whether query contains temporal markers */
  hasTemporal: boolean;

  /** Temporal markers found (e.g., "before", "after", "during") */
  temporalMarkers: string[];

  /** Whether query involves causal relationships */
  hasCausal: boolean;

  /** Direction of causal reasoning */
  causalDirection: 'forward' | 'backward' | 'both';

  /** Query complexity estimate [0, 1] */
  complexity: number;

  /** Whether query requires decomposition */
  hasDecomposition: boolean;

  /** Whether query has constraints */
  hasConstraints: boolean;

  /** Types of constraints identified */
  constraintTypes: string[];

  /** Whether query involves analogical reasoning */
  hasAnalogy: boolean;

  /** Source domain for analogy (if applicable) */
  sourceDomain?: string;

  /** Target domain for analogy (if applicable) */
  targetDomain?: string;

  /** Whether query contains contradictions */
  hasContradiction: boolean;

  /** Whether query requires critical analysis */
  hasCritique: boolean;

  /** Whether query mentions axioms or fundamentals */
  hasAxioms: boolean;

  /** Whether query requires proof or derivation */
  requiresProof: boolean;
}

// ============================================================================
// ADVANCED REASONING RESULT BASE
// ============================================================================

/**
 * Base interface for advanced reasoning results
 *
 * Extends IReasoningResponse with additional fields common to all advanced modes:
 * - mode: The advanced reasoning mode used
 * - answer: Human-readable text answer
 * - reasoningSteps: Step-by-step reasoning explanation
 * - latencyMs: Processing time in milliseconds
 */
export interface IAdvancedReasoningResult extends Omit<IReasoningResponse, 'query'> {
  /** The advanced reasoning mode used */
  mode: AdvancedReasoningMode;

  /** Human-readable text answer */
  answer: string;

  /** Step-by-step reasoning explanation */
  reasoningSteps: string[];

  /** Processing time in milliseconds */
  latencyMs: number;

  /** Original query (as text or reference, not embedding) */
  queryRef?: string;
}

// ============================================================================
// ANALOGICAL REASONING
// ============================================================================

/**
 * Configuration for analogical reasoning
 *
 * Enables cross-domain knowledge transfer by mapping structural similarities
 * between source and target domains
 */
export interface AnalogicalConfig {
  /** Source domain to transfer knowledge from */
  sourceDomain: string;

  /** Target domain to transfer knowledge to */
  targetDomain: string;

  /** Minimum structural similarity threshold [0, 1] (default: 0.7) */
  structuralMappingThreshold?: number;

  /** Maximum number of mappings to generate (default: 10) */
  maxMappings?: number;

  /** Prefer abstract vs. concrete mappings (default: 0.5) */
  abstractionLevel?: number;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Mapping between source and target domains
 */
export interface AnalogicalMapping {
  /** Source pattern being transferred */
  sourcePattern: Pattern;

  /** Target domain for transfer */
  targetDomain: string;

  /** Node-to-node mappings */
  mappings: Array<{
    /** Source node identifier */
    sourceNode: string;
    /** Target node identifier */
    targetNode: string;
    /** Confidence in this mapping [0, 1] */
    confidence: number;
  }>;

  /** Structural similarity score [0, 1] */
  structuralSimilarity: number;

  /** Transferability score [0, 1] */
  transferability: number;
}

/**
 * Result from analogical reasoning
 */
export interface IAnalogicalResult extends IAdvancedReasoningResult {
  /** Generated analogical mappings */
  analogicalMappings: AnalogicalMapping[];
}

// ============================================================================
// ABDUCTIVE REASONING
// ============================================================================

/**
 * Configuration for abductive reasoning
 *
 * Infers best explanations for observed effects using causal knowledge
 */
export interface AbductiveConfig {
  /** Observed effects to explain */
  observedEffects: NodeID[];

  /** Maximum causal depth to explore (default: 5) */
  maxCausalDepth?: number;

  /** Maximum number of hypotheses to generate (default: 10) */
  hypothesisLimit?: number;

  /** Weight for Occam's Razor [0, 1] (default: 0.5) - prefer simpler explanations */
  occamWeight?: number;

  /** Minimum plausibility threshold [0, 1] (default: 0.3) */
  minPlausibility?: number;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Abductive explanation hypothesis
 */
export interface AbductiveExplanation {
  /** Hypothesis statement */
  hypothesis: string;

  /** Causal chain of causes leading to observed effects */
  causes: NodeID[];

  /** Plausibility of this explanation [0, 1] */
  plausibility: number;

  /** Strength of supporting evidence [0, 1] */
  evidenceStrength: number;

  /** Number of alternative explanations considered */
  alternativeCount: number;

  /** L-Score for provenance [0, 1] */
  lScore: number;
}

/**
 * Result from abductive reasoning
 */
export interface IAbductiveResult extends IAdvancedReasoningResult {
  /** Ranked explanations for observed effects */
  explanations: AbductiveExplanation[];
}

// ============================================================================
// COUNTERFACTUAL REASONING
// ============================================================================

/**
 * Configuration for counterfactual reasoning
 *
 * Explores "what if" scenarios by simulating interventions in causal graph
 */
export interface CounterfactualConfig {
  /** Intervention to simulate */
  intervention: {
    /** Node to intervene on */
    nodeId: NodeID;
    /** Original value (baseline) */
    originalValue: unknown;
    /** Counterfactual value (intervention) */
    counterfactualValue: unknown;
  };

  /** Target outcome to analyze */
  targetOutcome?: NodeID;

  /** Maximum number of alternative worlds to explore (default: 5) */
  alternativeWorlds?: number;

  /** Maximum causal depth to propagate intervention (default: 5) */
  maxDepth?: number;

  /** Minimum divergence threshold to report [0, 1] (default: 0.1) */
  minDivergence?: number;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Counterfactual scenario result
 */
export interface CounterfactualScenario {
  /** Intervention applied */
  intervention: {
    /** Node intervened on */
    nodeId: NodeID;
    /** Original value */
    originalValue: unknown;
    /** Counterfactual value */
    counterfactualValue: unknown;
  };

  /** Baseline outcomes (without intervention) */
  baselineOutcomes: NodeID[];

  /** Counterfactual outcomes (with intervention) */
  counterfactualOutcomes: NodeID[];

  /** Divergence from baseline [0, 1] */
  divergence: number;

  /** Nodes impacted by intervention */
  impactedNodes: NodeID[];

  /** Confidence in this scenario [0, 1] */
  confidence: number;
}

/**
 * Result from counterfactual reasoning
 */
export interface ICounterfactualResult extends IAdvancedReasoningResult {
  /** Explored counterfactual scenarios */
  scenarios: CounterfactualScenario[];
}

// ============================================================================
// DECOMPOSITION REASONING
// ============================================================================

/**
 * Configuration for decomposition reasoning
 *
 * Breaks down complex problems into manageable subproblems
 */
export interface DecompositionConfig {
  /** Decomposition strategy */
  decompositionStrategy: 'hierarchical' | 'sequential' | 'parallel' | 'adaptive';

  /** Maximum number of subproblems to generate (default: 10) */
  maxSubproblems?: number;

  /** Maximum decomposition depth (default: 3) */
  maxDepth?: number;

  /** Aggregation method for combining subproblem results */
  aggregationMethod?: 'sum' | 'product' | 'max' | 'weighted' | 'custom';

  /** Minimum subproblem complexity to further decompose (default: 0.3) */
  minComplexity?: number;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Subproblem in decomposition plan
 */
export interface Subproblem {
  /** Unique subproblem identifier */
  id: string;

  /** Description of the subproblem */
  description: string;

  /** Dependencies on other subproblems (by ID) */
  dependencies: string[];

  /** Estimated complexity [0, 1] */
  estimatedComplexity: number;

  /** Task type for this subproblem */
  taskType: TaskType;

  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Decomposition execution plan
 */
export interface DecompositionPlan {
  /** All subproblems in the plan */
  subproblems: Subproblem[];

  /** Recommended execution order (topological sort) */
  executionOrder: string[];

  /** Groups of subproblems that can be parallelized */
  parallelizationGroups: string[][];

  /** Total estimated complexity */
  totalComplexity: number;
}

/**
 * Result from decomposition reasoning
 */
export interface IDecompositionResult extends IAdvancedReasoningResult {
  /** Generated decomposition plan */
  plan: DecompositionPlan;
}

// ============================================================================
// ADVERSARIAL REASONING
// ============================================================================

/**
 * Configuration for adversarial reasoning
 *
 * Tests arguments by generating counter-arguments and finding contradictions
 */
export interface AdversarialConfig {
  /** Attack vectors to consider */
  attackVectors?: Array<'logical' | 'empirical' | 'semantic' | 'ethical'>;

  /** Threat model for critical analysis */
  threatModel?: 'cooperative' | 'adversarial' | 'skeptical';

  /** Minimum severity threshold for contradictions [0, 1] (default: 0.3) */
  severityThreshold?: number;

  /** Include countermeasures in results (default: true) */
  includeCountermeasures?: boolean;

  /** Maximum contradictions to find (default: 10) */
  maxContradictions?: number;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Contradiction found during adversarial analysis
 */
export interface Contradiction {
  /** Claim identifier */
  claimId: string;

  /** Counter-claim identifier */
  counterClaimId: string;

  /** Type of conflict */
  conflictType: 'logical' | 'empirical' | 'semantic';

  /** Strength of contradiction [0, 1] */
  strength: number;

  /** Evidence for each side */
  evidence: {
    /** Evidence supporting the claim */
    supporting: string[];
    /** Evidence contradicting the claim */
    contradicting: string[];
  };

  /** Recommended resolution (if determinable) */
  resolution?: 'reject_claim' | 'reject_counter' | 'conditional' | 'unknown';

  /** Optional countermeasure suggestion */
  countermeasure?: string;
}

/**
 * Result from adversarial reasoning
 */
export interface IAdversarialResult extends IAdvancedReasoningResult {
  /** Identified contradictions */
  contradictions: Contradiction[];
}

// ============================================================================
// TEMPORAL REASONING
// ============================================================================

/**
 * Configuration for temporal reasoning
 *
 * Analyzes time-dependent sequences and temporal constraints
 */
export interface TemporalConfig {
  /** Time range for analysis */
  timeRange?: {
    /** Start time (timestamp or relative) */
    start: number | string;
    /** End time (timestamp or relative) */
    end: number | string;
  };

  /** Temporal granularity */
  granularity: 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

  /** Maximum chain length to explore (default: 10) */
  chainLength?: number;

  /** Track evolution over time (default: true) */
  evolutionTracking?: boolean;

  /** Minimum constraint confidence [0, 1] (default: 0.5) */
  minConstraintConfidence?: number;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Temporal constraint between events
 */
export interface TemporalConstraint {
  /** Type of temporal relationship */
  type: 'before' | 'after' | 'during' | 'concurrent';

  /** First event node */
  eventA: NodeID;

  /** Second event node */
  eventB: NodeID;

  /** Confidence in this constraint [0, 1] */
  confidence: number;
}

/**
 * Temporal event chain
 */
export interface TemporalChain {
  /** Events in temporal order */
  events: Array<{
    /** Event node ID */
    nodeId: NodeID;
    /** Timestamp */
    timestamp: number;
    /** Temporal granularity */
    granularity: TemporalConfig['granularity'];
  }>;

  /** Temporal constraints between events */
  constraints: TemporalConstraint[];

  /** Whether chain is temporally consistent */
  consistency: boolean;

  /** Total duration of the chain */
  duration: number;
}

/**
 * Result from temporal reasoning
 */
export interface ITemporalResult extends IAdvancedReasoningResult {
  /** Identified temporal chains */
  temporalChains: TemporalChain[];
}

// ============================================================================
// CONSTRAINT-BASED REASONING
// ============================================================================

/**
 * Configuration for constraint-based reasoning
 *
 * Solves problems with hard and soft constraints using CSP techniques
 */
export interface ConstraintConfig {
  /** Hard constraints that must be satisfied */
  hardConstraints: Constraint[];

  /** Soft constraints to optimize */
  softConstraints?: Constraint[];

  /** Weights for soft constraints (must match softConstraints length) */
  constraintWeights?: number[];

  /** Minimum satisfaction threshold [0, 1] (default: 0.8) */
  satisfactionThreshold?: number;

  /** Maximum iterations for solver (default: 1000) */
  maxIterations?: number;

  /** Solver strategy */
  solverStrategy?: 'backtracking' | 'local-search' | 'hybrid';

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Constraint definition
 */
export interface Constraint {
  /** Unique constraint identifier */
  id: string;

  /** Type of constraint */
  type: 'equality' | 'inequality' | 'membership' | 'custom';

  /** Variables involved in this constraint */
  variables: string[];

  /** Predicate function to test constraint satisfaction */
  predicate: (values: Map<string, unknown>) => boolean;

  /** Priority of this constraint [0, 1] (higher = more important) */
  priority: number;
}

/**
 * Solution to constraint satisfaction problem
 */
export interface ConstraintSolution {
  /** Variable assignments */
  variables: Map<string, unknown>;

  /** List of satisfied constraint IDs */
  satisfiedConstraints: string[];

  /** List of violated constraint IDs */
  violatedConstraints: string[];

  /** Consistency score [0, 1] */
  consistency: number;

  /** Whether solution is complete (all hard constraints satisfied) */
  isComplete: boolean;
}

/**
 * Result from constraint-based reasoning
 */
export interface IConstraintResult extends IAdvancedReasoningResult {
  /** Constraint satisfaction solution */
  solution: ConstraintSolution;
}

// ============================================================================
// FIRST PRINCIPLES REASONING
// ============================================================================

/**
 * Configuration for first principles reasoning
 *
 * Derives conclusions from fundamental axioms using logical inference
 */
export interface FirstPrinciplesConfig {
  /** Fundamental domain for axioms */
  fundamentalDomain: string;

  /** Maximum derivation depth (default: 5) */
  derivationDepth?: number;

  /** Validate each assumption (default: true) */
  assumptionValidation?: boolean;

  /** Minimum soundness threshold [0, 1] (default: 0.8) */
  minSoundness?: number;

  /** Include intermediate derivation steps (default: true) */
  includeIntermediateSteps?: boolean;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Fundamental axiom
 */
export interface Axiom {
  /** Unique axiom identifier */
  id: string;

  /** Axiom statement */
  statement: string;

  /** Domain this axiom applies to */
  domain: string;

  /** Confidence in axiom [0, 1] */
  confidence: number;

  /** Source of axiom (e.g., "mathematics", "physics", "logic") */
  source: string;
}

/**
 * Derivation step in proof
 */
export interface DerivationStep {
  /** Inference rule applied */
  rule: string;

  /** Premise statements (by ID or statement) */
  premises: string[];

  /** Conclusion statement */
  conclusion: string;

  /** Justification for this step */
  justification: string;
}

/**
 * First principles proof
 */
export interface FirstPrinciplesProof {
  /** Axioms used in the proof */
  axioms: Axiom[];

  /** Derivation steps from axioms to conclusion */
  derivationSteps: DerivationStep[];

  /** Final conclusion */
  conclusion: string;

  /** Soundness of the proof [0, 1] */
  soundness: number;

  /** Completeness of the proof [0, 1] */
  completeness: number;
}

/**
 * Result from first principles reasoning
 */
export interface IFirstPrinciplesResult extends IAdvancedReasoningResult {
  /** Generated proof from first principles */
  proof: FirstPrinciplesProof;
}

// ============================================================================
// COMMON REASONING ENGINE INTERFACE
// ============================================================================

/**
 * Generic reasoning engine interface
 *
 * All advanced reasoning engines implement this interface for consistency
 *
 * @template TConfig - Configuration type specific to the engine
 * @template TResult - Result type specific to the engine
 */
export interface IAdvancedReasoningEngine<TConfig, TResult> {
  /**
   * Execute reasoning with given request and configuration
   *
   * @param request - Base reasoning request with query embedding
   * @param config - Mode-specific configuration
   * @returns Promise resolving to mode-specific result
   */
  reason(request: IReasoningRequest, config: TConfig): Promise<TResult>;
}

// ============================================================================
// TYPE EXPORTS FOR EXTERNAL USE
// ============================================================================

/**
 * Union type of all advanced reasoning modes
 */
export type AnyAdvancedMode =
  | AdvancedReasoningMode.ANALOGICAL
  | AdvancedReasoningMode.ABDUCTIVE
  | AdvancedReasoningMode.COUNTERFACTUAL
  | AdvancedReasoningMode.DECOMPOSITION
  | AdvancedReasoningMode.ADVERSARIAL
  | AdvancedReasoningMode.TEMPORAL
  | AdvancedReasoningMode.CONSTRAINT_BASED
  | AdvancedReasoningMode.FIRST_PRINCIPLES;

/**
 * Union type of all advanced reasoning configs
 */
export type AnyAdvancedConfig =
  | AnalogicalConfig
  | AbductiveConfig
  | CounterfactualConfig
  | DecompositionConfig
  | AdversarialConfig
  | TemporalConfig
  | ConstraintConfig
  | FirstPrinciplesConfig;

/**
 * Union type of all advanced reasoning results
 */
export type AnyAdvancedResult =
  | IAnalogicalResult
  | IAbductiveResult
  | ICounterfactualResult
  | IDecompositionResult
  | IAdversarialResult
  | ITemporalResult
  | IConstraintResult
  | IFirstPrinciplesResult;

/**
 * Combined mode type (base + advanced)
 */
export type AllReasoningModes = ReasoningMode | AdvancedReasoningMode;
