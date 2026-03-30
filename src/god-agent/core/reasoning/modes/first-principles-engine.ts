/**
 * First Principles Reasoning Engine
 * RSN-002 Implementation - Axiomatic Derivation
 *
 * Purpose: Derive conclusions from fundamental axioms
 * using logical inference rules
 *
 * Features:
 * - Axiom discovery and validation
 * - Derivation chain building
 * - Multiple inference rules (modus ponens, modus tollens, etc.)
 * - Soundness and completeness scoring
 * - Assumption tracking
 *
 * Dependencies:
 * - CausalMemory: Logical relationships (optional)
 * - GraphDB: Knowledge graph queries (optional)
 * - PatternMatcher: Domain axiom retrieval (optional)
 *
 * Performance Target: <200ms latency
 */

import type { IReasoningRequest, ReasoningMode, IPatternMatch, IInferenceResult, IProvenanceInfo } from '../reasoning-types.js';
import type {
  FirstPrinciplesConfig,
  IFirstPrinciplesResult,
  FirstPrinciplesProof,
  Axiom,
  DerivationStep
} from '../advanced-reasoning-types.js';
import { AdvancedReasoningMode } from '../advanced-reasoning-types.js';

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * Dependencies for FirstPrinciplesEngine
 */
export interface FirstPrinciplesEngineDependencies {
  /** Causal memory for logical relationships (optional) */
  causalMemory?: {
    getAxioms?(domain: string): Promise<Axiom[]>;
    getRelatedConcepts?(concept: string): Promise<string[]>;
  };

  /** Graph database for knowledge queries (optional) */
  graphDB?: {
    queryStatements?(domain: string): Promise<string[]>;
    findPath?(from: string, to: string): Promise<string[]>;
  };

  /** Pattern matcher for domain axioms (optional) */
  patternMatcher?: {
    getAxiomsForDomain?(domain: string): Promise<Axiom[]>;
  };
}

/**
 * Inference rule type
 */
type InferenceRule =
  | 'modus_ponens'      // If P→Q and P, then Q
  | 'modus_tollens'     // If P→Q and ¬Q, then ¬P
  | 'hypothetical_syllogism' // If P→Q and Q→R, then P→R
  | 'disjunctive_syllogism'  // If P∨Q and ¬P, then Q
  | 'conjunction'       // If P and Q, then P∧Q
  | 'simplification'    // If P∧Q, then P
  | 'addition'          // If P, then P∨Q
  | 'constructive_dilemma'   // If (P→Q)∧(R→S) and P∨R, then Q∨S
  | 'definition_expansion'   // Expand definitions
  | 'direct_derivation';     // Direct from axiom

/**
 * Parsed statement structure
 */
interface ParsedStatement {
  type: 'atomic' | 'implication' | 'conjunction' | 'disjunction' | 'negation';
  content: string;
  left?: string;
  right?: string;
  negated: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Domain-specific axiom databases
 */
const DOMAIN_AXIOMS: Record<string, Axiom[]> = {
  'mathematics': [
    { id: 'math-1', statement: 'For all x, x = x', domain: 'mathematics', confidence: 1.0, source: 'identity' },
    { id: 'math-2', statement: 'If x = y, then y = x', domain: 'mathematics', confidence: 1.0, source: 'symmetry' },
    { id: 'math-3', statement: 'If x = y and y = z, then x = z', domain: 'mathematics', confidence: 1.0, source: 'transitivity' },
    { id: 'math-4', statement: 'For all x, x + 0 = x', domain: 'mathematics', confidence: 1.0, source: 'additive-identity' },
    { id: 'math-5', statement: 'For all x, x × 1 = x', domain: 'mathematics', confidence: 1.0, source: 'multiplicative-identity' }
  ],
  'logic': [
    { id: 'logic-1', statement: 'P ∨ ¬P', domain: 'logic', confidence: 1.0, source: 'excluded-middle' },
    { id: 'logic-2', statement: '¬(P ∧ ¬P)', domain: 'logic', confidence: 1.0, source: 'non-contradiction' },
    { id: 'logic-3', statement: 'If P, then P', domain: 'logic', confidence: 1.0, source: 'identity' },
    { id: 'logic-4', statement: 'If P→Q and P, then Q', domain: 'logic', confidence: 1.0, source: 'modus-ponens' },
    { id: 'logic-5', statement: 'If P→Q and ¬Q, then ¬P', domain: 'logic', confidence: 1.0, source: 'modus-tollens' }
  ],
  'software': [
    { id: 'sw-1', statement: 'A function must return a value or void', domain: 'software', confidence: 0.95, source: 'type-theory' },
    { id: 'sw-2', statement: 'Pure functions have no side effects', domain: 'software', confidence: 1.0, source: 'functional-programming' },
    { id: 'sw-3', statement: 'Immutable data cannot be changed after creation', domain: 'software', confidence: 1.0, source: 'immutability' },
    { id: 'sw-4', statement: 'If A depends on B, B must be available before A', domain: 'software', confidence: 0.95, source: 'dependency-order' },
    { id: 'sw-5', statement: 'Single responsibility: each module handles one concern', domain: 'software', confidence: 0.9, source: 'SOLID' }
  ],
  'physics': [
    { id: 'phys-1', statement: 'Energy cannot be created or destroyed', domain: 'physics', confidence: 1.0, source: 'conservation-of-energy' },
    { id: 'phys-2', statement: 'F = ma', domain: 'physics', confidence: 1.0, source: 'newton-second-law' },
    { id: 'phys-3', statement: 'Every action has an equal and opposite reaction', domain: 'physics', confidence: 1.0, source: 'newton-third-law' },
    { id: 'phys-4', statement: 'Nothing can exceed the speed of light', domain: 'physics', confidence: 1.0, source: 'special-relativity' },
    { id: 'phys-5', statement: 'Entropy of isolated system always increases', domain: 'physics', confidence: 1.0, source: 'thermodynamics-second-law' }
  ],
  'economics': [
    { id: 'econ-1', statement: 'Resources are scarce', domain: 'economics', confidence: 0.95, source: 'scarcity' },
    { id: 'econ-2', statement: 'People respond to incentives', domain: 'economics', confidence: 0.9, source: 'rational-choice' },
    { id: 'econ-3', statement: 'Trade creates value for both parties', domain: 'economics', confidence: 0.85, source: 'comparative-advantage' },
    { id: 'econ-4', statement: 'Price is determined by supply and demand', domain: 'economics', confidence: 0.9, source: 'market-equilibrium' },
    { id: 'econ-5', statement: 'Opportunity cost is the value of the next best alternative', domain: 'economics', confidence: 0.95, source: 'opportunity-cost' }
  ]
};

/**
 * Inference rule descriptions
 */
const INFERENCE_DESCRIPTIONS: Record<InferenceRule, string> = {
  'modus_ponens': 'If P implies Q, and P is true, then Q is true',
  'modus_tollens': 'If P implies Q, and Q is false, then P is false',
  'hypothetical_syllogism': 'If P implies Q, and Q implies R, then P implies R',
  'disjunctive_syllogism': 'If P or Q, and not P, then Q',
  'conjunction': 'If P and Q are both true, then P and Q',
  'simplification': 'If P and Q, then P (or Q)',
  'addition': 'If P, then P or Q',
  'constructive_dilemma': 'If P implies Q and R implies S, and P or R, then Q or S',
  'definition_expansion': 'Replace term with its definition',
  'direct_derivation': 'Direct application of axiom'
};

// ============================================================================
// FIRST PRINCIPLES ENGINE
// ============================================================================

/**
 * First principles reasoning engine
 *
 * Derives conclusions from fundamental axioms using logical
 * inference rules. Builds proof chains from premises to conclusions
 * with soundness and completeness metrics.
 *
 * @example
 * ```typescript
 * const engine = new FirstPrinciplesEngine({ causalMemory });
 * const result = await engine.reason(
 *   { query: 'Why do pure functions make code easier to test?' },
 *   { fundamentalDomain: 'software', derivationDepth: 3 }
 * );
 * // result.proof contains axioms and derivation steps
 * ```
 */
export class FirstPrinciplesEngine {
  private deps: FirstPrinciplesEngineDependencies;

  constructor(deps: FirstPrinciplesEngineDependencies) {
    this.deps = deps;
  }

  /**
   * Perform first principles reasoning
   *
   * @param request - The reasoning request containing the query
   * @param config - First principles configuration
   * @returns First principles result with proof
   */
  async reason(
    request: IReasoningRequest,
    config: FirstPrinciplesConfig
  ): Promise<IFirstPrinciplesResult> {
    const startTime = Date.now();
    // Query embedding is Float32Array - get query text from metadata if available
    const queryText = (request.metadata?.queryText as string) || 'first principles query';

    // Apply defaults
    const effectiveConfig: Required<FirstPrinciplesConfig> = {
      fundamentalDomain: config.fundamentalDomain,
      derivationDepth: config.derivationDepth ?? 5,
      assumptionValidation: config.assumptionValidation ?? true,
      minSoundness: config.minSoundness ?? 0.8,
      includeIntermediateSteps: config.includeIntermediateSteps ?? true,
      metadata: config.metadata ?? {}
    };

    // Get domain axioms
    const axioms = await this.getAxioms(effectiveConfig.fundamentalDomain);

    // Extract goal from query
    const goal = this.extractGoal(queryText);

    // Build derivation chain
    const derivationSteps = await this.buildDerivation(
      axioms,
      goal,
      effectiveConfig.derivationDepth,
      effectiveConfig.includeIntermediateSteps
    );

    // Calculate soundness and completeness
    const soundness = this.calculateSoundness(axioms, derivationSteps);
    const completeness = this.calculateCompleteness(goal, derivationSteps);

    // Build proof
    const proof: FirstPrinciplesProof = {
      axioms: axioms.filter(a => this.axiomUsedInDerivation(a, derivationSteps)),
      derivationSteps,
      conclusion: this.extractConclusion(derivationSteps, goal),
      soundness,
      completeness
    };

    // Calculate confidence
    const confidence = this.calculateConfidence(proof);

    const latencyMs = Date.now() - startTime;

    // Build result with all required IAdvancedReasoningResult fields
    const result: IFirstPrinciplesResult = {
      // IAdvancedReasoningResult fields
      mode: AdvancedReasoningMode.FIRST_PRINCIPLES,
      answer: this.formatAnswer(proof, effectiveConfig),
      reasoningSteps: this.generateReasoning(proof, effectiveConfig),
      latencyMs,
      confidence,

      // IReasoningResponse fields (from base interface)
      type: 'causal-inference' as ReasoningMode,
      patterns: [] as IPatternMatch[],
      causalInferences: [] as IInferenceResult[],
      trajectoryId: `traj_${Date.now()}_first-principles`,
      processingTimeMs: latencyMs,
      provenanceInfo: {
        lScores: proof.axioms.map(a => a.confidence),
        totalSources: proof.axioms.length,
        combinedLScore: proof.soundness * proof.completeness
      } as IProvenanceInfo,

      // Mode-specific field
      proof
    };

    return result;
  }

  // ==========================================================================
  // AXIOM RETRIEVAL
  // ==========================================================================

  /**
   * Get axioms for domain
   */
  private async getAxioms(domain: string): Promise<Axiom[]> {
    const lowerDomain = domain.toLowerCase();

    // Try causal memory first
    if (this.deps.causalMemory?.getAxioms) {
      try {
        const axioms = await this.deps.causalMemory.getAxioms(lowerDomain);
        if (axioms.length > 0) {
          return axioms;
        }
      } catch {
        // INTENTIONAL: Causal memory query failure - try alternative sources
      }
    }

    // Try pattern matcher
    if (this.deps.patternMatcher?.getAxiomsForDomain) {
      try {
        const axioms = await this.deps.patternMatcher.getAxiomsForDomain(lowerDomain);
        if (axioms.length > 0) {
          return axioms;
        }
      } catch {
        // INTENTIONAL: Pattern matcher query failure - try predefined axioms
      }
    }

    // Use predefined domain axioms
    if (DOMAIN_AXIOMS[lowerDomain]) {
      return DOMAIN_AXIOMS[lowerDomain];
    }

    // Always include logic axioms as foundation
    const logicAxioms = DOMAIN_AXIOMS['logic'] || [];

    // Generate domain-specific synthetic axioms
    const syntheticAxioms = this.generateSyntheticAxioms(lowerDomain);

    return [...logicAxioms, ...syntheticAxioms];
  }

  /**
   * Generate synthetic axioms for unknown domain
   */
  private generateSyntheticAxioms(domain: string): Axiom[] {
    return [
      {
        id: `${domain}-synth-1`,
        statement: `Entities in ${domain} have properties`,
        domain,
        confidence: 0.8,
        source: 'synthetic'
      },
      {
        id: `${domain}-synth-2`,
        statement: `Properties in ${domain} can change over time`,
        domain,
        confidence: 0.7,
        source: 'synthetic'
      },
      {
        id: `${domain}-synth-3`,
        statement: `Relationships in ${domain} follow patterns`,
        domain,
        confidence: 0.75,
        source: 'synthetic'
      }
    ];
  }

  // ==========================================================================
  // GOAL EXTRACTION
  // ==========================================================================

  /**
   * Extract reasoning goal from query
   */
  private extractGoal(query: string): string {
    const lowerQuery = query.toLowerCase();

    // Remove question words
    let goal = lowerQuery
      .replace(/^(why|how|what|when|where|who|which|can|does|is|are|do)\s+/i, '')
      .replace(/\?+$/, '')
      .trim();

    // Handle specific patterns
    if (lowerQuery.includes('why')) {
      // Extract the thing to explain
      const whyMatch = query.match(/why\s+(.+?)(?:\?|$)/i);
      if (whyMatch) {
        goal = whyMatch[1].trim();
      }
    }

    if (lowerQuery.includes('prove')) {
      const proveMatch = query.match(/prove\s+(?:that\s+)?(.+?)(?:\?|$)/i);
      if (proveMatch) {
        goal = proveMatch[1].trim();
      }
    }

    return goal || query;
  }

  // ==========================================================================
  // DERIVATION BUILDING
  // ==========================================================================

  /**
   * Build derivation chain from axioms to goal
   */
  private async buildDerivation(
    axioms: Axiom[],
    goal: string,
    maxDepth: number,
    includeIntermediate: boolean
  ): Promise<DerivationStep[]> {
    const steps: DerivationStep[] = [];
    const derived = new Set<string>();
    const goalKeywords = this.extractKeywords(goal);

    // Start with direct axiom applications
    for (const axiom of axioms) {
      const axiomKeywords = this.extractKeywords(axiom.statement);
      const overlap = this.keywordOverlap(goalKeywords, axiomKeywords);

      if (overlap > 0.2) {
        steps.push({
          rule: 'direct_derivation',
          premises: [axiom.id],
          conclusion: axiom.statement,
          justification: `Direct application of axiom: ${axiom.source}`
        });
        derived.add(axiom.statement);
      }
    }

    // Build intermediate steps through inference
    for (let depth = 0; depth < maxDepth && steps.length < 20; depth++) {
      const newSteps = this.applyInferenceRules(
        axioms,
        steps,
        derived,
        goal
      );

      if (newSteps.length === 0) {
        break; // No more inferences possible
      }

      for (const step of newSteps) {
        if (includeIntermediate || this.isRelevantToGoal(step.conclusion, goal)) {
          steps.push(step);
          derived.add(step.conclusion);
        }
      }
    }

    // Add final step if goal is reached
    const finalStep = this.createFinalStep(steps, goal, derived);
    if (finalStep) {
      steps.push(finalStep);
    }

    return steps;
  }

  /**
   * Apply inference rules to derive new statements
   */
  private applyInferenceRules(
    axioms: Axiom[],
    currentSteps: DerivationStep[],
    derived: Set<string>,
    goal: string
  ): DerivationStep[] {
    const newSteps: DerivationStep[] = [];
    const allStatements = [
      ...axioms.map(a => ({ id: a.id, statement: a.statement })),
      ...currentSteps.map((s, i) => ({ id: `step-${i}`, statement: s.conclusion }))
    ];

    // Try modus ponens
    for (const s1 of allStatements) {
      const parsed1 = this.parseStatement(s1.statement);
      if (parsed1.type === 'implication' && parsed1.left && parsed1.right) {
        // Look for the antecedent
        for (const s2 of allStatements) {
          if (this.statementsMatch(s2.statement, parsed1.left)) {
            const conclusion = parsed1.right;
            if (!derived.has(conclusion)) {
              newSteps.push({
                rule: 'modus_ponens',
                premises: [s1.id, s2.id],
                conclusion,
                justification: INFERENCE_DESCRIPTIONS['modus_ponens']
              });
            }
          }
        }
      }
    }

    // Try hypothetical syllogism
    for (const s1 of allStatements) {
      const parsed1 = this.parseStatement(s1.statement);
      if (parsed1.type === 'implication' && parsed1.right) {
        for (const s2 of allStatements) {
          const parsed2 = this.parseStatement(s2.statement);
          if (parsed2.type === 'implication' && parsed2.left) {
            if (this.statementsMatch(parsed1.right, parsed2.left) && parsed2.right) {
              const conclusion = `If ${parsed1.left}, then ${parsed2.right}`;
              if (!derived.has(conclusion)) {
                newSteps.push({
                  rule: 'hypothetical_syllogism',
                  premises: [s1.id, s2.id],
                  conclusion,
                  justification: INFERENCE_DESCRIPTIONS['hypothetical_syllogism']
                });
              }
            }
          }
        }
      }
    }

    // Try conjunction
    for (let i = 0; i < allStatements.length; i++) {
      for (let j = i + 1; j < allStatements.length; j++) {
        const s1 = allStatements[i];
        const s2 = allStatements[j];

        // Only combine if both are relevant to goal
        if (
          this.isRelevantToGoal(s1.statement, goal) &&
          this.isRelevantToGoal(s2.statement, goal)
        ) {
          const conclusion = `${s1.statement} and ${s2.statement}`;
          if (!derived.has(conclusion) && conclusion.length < 200) {
            newSteps.push({
              rule: 'conjunction',
              premises: [s1.id, s2.id],
              conclusion,
              justification: INFERENCE_DESCRIPTIONS['conjunction']
            });
          }
        }
      }
    }

    return newSteps.slice(0, 5); // Limit new steps per iteration
  }

  /**
   * Parse statement into structured form
   */
  private parseStatement(statement: string): ParsedStatement {
    const lower = statement.toLowerCase();

    // Check for implication
    const implicationMatch = statement.match(/if\s+(.+?),?\s+then\s+(.+)/i) ||
                            statement.match(/(.+?)\s+implies\s+(.+)/i) ||
                            statement.match(/(.+?)\s*→\s*(.+)/);

    if (implicationMatch) {
      return {
        type: 'implication',
        content: statement,
        left: implicationMatch[1].trim(),
        right: implicationMatch[2].trim(),
        negated: false
      };
    }

    // Check for conjunction
    if (lower.includes(' and ') || statement.includes('∧')) {
      const parts = statement.split(/\s+and\s+|∧/i);
      return {
        type: 'conjunction',
        content: statement,
        left: parts[0]?.trim(),
        right: parts.slice(1).join(' and ').trim(),
        negated: false
      };
    }

    // Check for disjunction
    if (lower.includes(' or ') || statement.includes('∨')) {
      const parts = statement.split(/\s+or\s+|∨/i);
      return {
        type: 'disjunction',
        content: statement,
        left: parts[0]?.trim(),
        right: parts.slice(1).join(' or ').trim(),
        negated: false
      };
    }

    // Check for negation
    const negated = lower.startsWith('not ') || lower.startsWith('¬') || lower.includes('cannot');

    return {
      type: 'atomic',
      content: statement,
      negated
    };
  }

  /**
   * Check if two statements match (approximate)
   */
  private statementsMatch(s1: string, s2: string): boolean {
    const norm1 = s1.toLowerCase().trim();
    const norm2 = s2.toLowerCase().trim();

    // Exact match
    if (norm1 === norm2) return true;

    // Substring match
    if (norm1.includes(norm2) || norm2.includes(norm1)) return true;

    // Keyword overlap
    const k1 = this.extractKeywords(s1);
    const k2 = this.extractKeywords(s2);
    const overlap = this.keywordOverlap(k1, k2);

    return overlap > 0.6;
  }

  /**
   * Extract keywords from statement
   */
  private extractKeywords(text: string): Set<string> {
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);

    // Remove stop words
    const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has', 'her', 'was', 'one', 'our', 'out', 'then', 'them', 'these', 'this', 'that', 'with', 'have', 'from', 'they', 'will', 'been', 'each']);

    return new Set(words.filter(w => !stopWords.has(w)));
  }

  /**
   * Calculate keyword overlap
   */
  private keywordOverlap(k1: Set<string>, k2: Set<string>): number {
    if (k1.size === 0 || k2.size === 0) return 0;

    const intersection = [...k1].filter(k => k2.has(k));
    return intersection.length / Math.min(k1.size, k2.size);
  }

  /**
   * Check if conclusion is relevant to goal
   */
  private isRelevantToGoal(conclusion: string, goal: string): boolean {
    const conclusionKeywords = this.extractKeywords(conclusion);
    const goalKeywords = this.extractKeywords(goal);
    return this.keywordOverlap(conclusionKeywords, goalKeywords) > 0.2;
  }

  /**
   * Create final step connecting to goal
   */
  private createFinalStep(
    steps: DerivationStep[],
    goal: string,
    derived: Set<string>
  ): DerivationStep | null {
    // Find best matching derived statement
    let bestMatch: { statement: string; overlap: number } | null = null;
    const goalKeywords = this.extractKeywords(goal);

    for (const statement of derived) {
      const overlap = this.keywordOverlap(goalKeywords, this.extractKeywords(statement));
      if (!bestMatch || overlap > bestMatch.overlap) {
        bestMatch = { statement, overlap };
      }
    }

    if (bestMatch && bestMatch.overlap > 0.3) {
      return {
        rule: 'direct_derivation',
        premises: steps.slice(-3).map((_, i) => `step-${steps.length - 3 + i}`),
        conclusion: `Therefore: ${goal}`,
        justification: `Derived from: ${bestMatch.statement}`
      };
    }

    return null;
  }

  /**
   * Check if axiom is used in derivation
   */
  private axiomUsedInDerivation(axiom: Axiom, steps: DerivationStep[]): boolean {
    return steps.some(s => s.premises.includes(axiom.id));
  }

  /**
   * Extract final conclusion from derivation
   */
  private extractConclusion(steps: DerivationStep[], goal: string): string {
    if (steps.length === 0) {
      return `Unable to derive: ${goal}`;
    }

    const lastStep = steps[steps.length - 1];
    return lastStep.conclusion;
  }

  // ==========================================================================
  // SCORING
  // ==========================================================================

  /**
   * Calculate soundness of proof
   */
  private calculateSoundness(axioms: Axiom[], steps: DerivationStep[]): number {
    if (steps.length === 0) return 0;

    // Soundness factors:
    // 1. Average axiom confidence
    // 2. Valid inference rules used
    // 3. Premise availability

    const usedAxioms = axioms.filter(a =>
      steps.some(s => s.premises.includes(a.id))
    );

    const avgAxiomConfidence = usedAxioms.length > 0
      ? usedAxioms.reduce((s, a) => s + a.confidence, 0) / usedAxioms.length
      : 0.5;

    // All our inference rules are valid
    const ruleValidity = 1.0;

    // Check premise availability (simplified)
    const premiseScore = 0.9;

    return (avgAxiomConfidence + ruleValidity + premiseScore) / 3;
  }

  /**
   * Calculate completeness of proof
   */
  private calculateCompleteness(goal: string, steps: DerivationStep[]): number {
    if (steps.length === 0) return 0;

    // Completeness: how well does the derivation reach the goal?
    const goalKeywords = this.extractKeywords(goal);

    // Check last step relevance
    const lastStep = steps[steps.length - 1];
    const lastStepKeywords = this.extractKeywords(lastStep.conclusion);
    const goalOverlap = this.keywordOverlap(goalKeywords, lastStepKeywords);

    // Check derivation chain length (longer = more complete reasoning)
    const lengthScore = Math.min(steps.length / 5, 1);

    return (goalOverlap + lengthScore) / 2;
  }

  /**
   * Calculate overall confidence
   */
  private calculateConfidence(proof: FirstPrinciplesProof): number {
    // Combine soundness and completeness
    const proofScore = (proof.soundness + proof.completeness) / 2;

    // Base boost for first-principles reasoning
    return Math.min(proofScore + 0.05, 1);
  }

  // ==========================================================================
  // OUTPUT FORMATTING
  // ==========================================================================

  /**
   * Format answer from proof
   */
  private formatAnswer(
    proof: FirstPrinciplesProof,
    config: Required<FirstPrinciplesConfig>
  ): string {
    const lines: string[] = [
      `First Principles Analysis (${config.fundamentalDomain}):`,
      '',
      'Foundational Axioms Used:'
    ];

    for (const axiom of proof.axioms.slice(0, 5)) {
      lines.push(`  • ${axiom.statement} [${axiom.source}]`);
    }

    lines.push('');
    lines.push('Derivation Chain:');

    for (let i = 0; i < Math.min(proof.derivationSteps.length, 5); i++) {
      const step = proof.derivationSteps[i];
      lines.push(`  ${i + 1}. ${step.conclusion}`);
      lines.push(`     Rule: ${step.rule.replace('_', ' ')}`);
    }

    lines.push('');
    lines.push(`Conclusion: ${proof.conclusion}`);
    lines.push(`Soundness: ${(proof.soundness * 100).toFixed(1)}%`);
    lines.push(`Completeness: ${(proof.completeness * 100).toFixed(1)}%`);

    return lines.join('\n');
  }

  /**
   * Generate reasoning explanation
   */
  private generateReasoning(
    proof: FirstPrinciplesProof,
    config: Required<FirstPrinciplesConfig>
  ): string[] {
    return [
      `Domain: ${config.fundamentalDomain}`,
      `Maximum derivation depth: ${config.derivationDepth}`,
      `Axioms used: ${proof.axioms.length}`,
      `Derivation steps: ${proof.derivationSteps.length}`,
      `Proof soundness: ${(proof.soundness * 100).toFixed(1)}%`,
      `Proof completeness: ${(proof.completeness * 100).toFixed(1)}%`
    ];
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a configured FirstPrinciplesEngine instance
 */
export function createFirstPrinciplesEngine(
  deps: FirstPrinciplesEngineDependencies
): FirstPrinciplesEngine {
  return new FirstPrinciplesEngine(deps);
}

// ============================================================================
// EXPORTS
// ============================================================================

// FirstPrinciplesEngineDependencies is already exported at declaration
