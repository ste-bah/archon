/**
 * Extended Mode Selector - Advanced Reasoning Mode Selection
 *
 * Extends ModeSelector with 8 advanced reasoning modes:
 * - Analogical: Cross-domain pattern transfer
 * - Abductive: Best explanation finding
 * - Counterfactual: Alternative world simulation
 * - Decomposition: Problem breakdown
 * - Adversarial: Critical argument testing
 * - Temporal: Time-based reasoning
 * - Constraint-based: Satisfaction solving
 * - First Principles: Axiomatic derivation
 *
 * Selection latency: <5ms (including core mode scoring)
 *
 * @module god-agent/core/reasoning/extended-mode-selector
 */

import {
  ModeSelector,
  ModeSelectionRequest,
  ModeSelectorConfig
} from './mode-selector.js';
import {
  ReasoningMode
} from './reasoning-types.js';
import {
  AdvancedReasoningMode,
  ExtendedQueryFeatures,
  AllReasoningModes
} from './advanced-reasoning-types.js';

/**
 * Configuration for extended mode selector
 */
export interface ExtendedModeSelectorConfig extends ModeSelectorConfig {
  /** Threshold for analogical mode selection (default: 0.6) */
  analogicalThreshold?: number;

  /** Threshold for abductive mode selection (default: 0.6) */
  abductiveThreshold?: number;

  /** Threshold for counterfactual mode selection (default: 0.6) */
  counterfactualThreshold?: number;

  /** Threshold for decomposition mode selection (default: 0.6) */
  decompositionThreshold?: number;

  /** Threshold for adversarial mode selection (default: 0.6) */
  adversarialThreshold?: number;

  /** Threshold for temporal mode selection (default: 0.6) */
  temporalThreshold?: number;

  /** Threshold for constraint-based mode selection (default: 0.6) */
  constraintBasedThreshold?: number;

  /** Threshold for first-principles mode selection (default: 0.6) */
  firstPrinciplesThreshold?: number;
}

/**
 * Extended mode selection result
 */
export interface ExtendedModeSelectionResult {
  /** Selected reasoning mode (core or advanced) */
  mode: AllReasoningModes;

  /** Confidence in the selection [0, 1] */
  confidence: number;

  /** Human-readable reasoning for the selection */
  reasoning: string;

  /** Scores for all modes (core + advanced) */
  allScores: ExtendedQueryFeatures;
}

/**
 * ExtendedModeSelector - Automatically selects optimal reasoning mode
 *
 * Extends base ModeSelector with 8 advanced reasoning capabilities.
 * Analyzes query characteristics to determine which reasoning mode
 * will be most effective among 12 total modes.
 */
export class ExtendedModeSelector {
  private coreSelector: ModeSelector;
  private config: Required<ExtendedModeSelectorConfig>;

  constructor(config: ExtendedModeSelectorConfig = {}) {
    this.coreSelector = new ModeSelector(config);
    this.config = {
      // Core mode thresholds (from base config)
      patternMatchThreshold: config.patternMatchThreshold ?? 0.6,
      causalInferenceThreshold: config.causalInferenceThreshold ?? 0.6,
      contextualThreshold: config.contextualThreshold ?? 0.6,
      hybridThreshold: config.hybridThreshold ?? 0.15,
      causalKeywords: config.causalKeywords ?? [],

      // Advanced mode thresholds
      analogicalThreshold: config.analogicalThreshold ?? 0.6,
      abductiveThreshold: config.abductiveThreshold ?? 0.6,
      counterfactualThreshold: config.counterfactualThreshold ?? 0.6,
      decompositionThreshold: config.decompositionThreshold ?? 0.6,
      adversarialThreshold: config.adversarialThreshold ?? 0.6,
      temporalThreshold: config.temporalThreshold ?? 0.6,
      constraintBasedThreshold: config.constraintBasedThreshold ?? 0.6,
      firstPrinciplesThreshold: config.firstPrinciplesThreshold ?? 0.6
    };
  }

  /**
   * Select optimal reasoning mode based on request characteristics
   *
   * Considers all 12 modes (4 core + 8 advanced) and returns the
   * highest scoring mode with confidence and explanation.
   *
   * @param request The reasoning request to analyze
   * @returns Extended mode selection result
   */
  async selectMode(request: ModeSelectionRequest): Promise<ExtendedModeSelectionResult> {
    const query = request.query;

    // If explicit mode requested, use it with full confidence
    if (request.type !== undefined) {
      const features = await this.analyzeQuery(query);
      return {
        mode: request.type,
        confidence: 1.0,
        reasoning: 'Explicit mode specified in request',
        allScores: features
      };
    }

    // Analyze query to extract features
    const features = await this.analyzeQuery(query);

    // Score all advanced modes (pass query explicitly for thread safety)
    features.analogical = this.scoreAnalogical(query);
    features.abductive = this.scoreAbductive(query);
    features.counterfactual = this.scoreCounterfactual(query);
    features.decomposition = this.scoreDecomposition(query);
    features.adversarial = this.scoreAdversarial(query);
    features.temporal = this.scoreTemporal(query);
    features.constraintBased = this.scoreConstraintBased(query);
    features.firstPrinciples = this.scoreFirstPrinciples(query);

    // Combine all scores (core + advanced) using Enum values as keys
    const allScores: Record<AllReasoningModes, number> = {
      [ReasoningMode.PATTERN_MATCH]: features.patternMatch,
      [ReasoningMode.CAUSAL_INFERENCE]: features.causalInference,
      [ReasoningMode.CONTEXTUAL]: features.contextual,
      [ReasoningMode.HYBRID]: 0, // Hybrid is not directly scored
      [AdvancedReasoningMode.ANALOGICAL]: features.analogical,
      [AdvancedReasoningMode.ABDUCTIVE]: features.abductive,
      [AdvancedReasoningMode.COUNTERFACTUAL]: features.counterfactual,
      [AdvancedReasoningMode.DECOMPOSITION]: features.decomposition,
      [AdvancedReasoningMode.ADVERSARIAL]: features.adversarial,
      [AdvancedReasoningMode.TEMPORAL]: features.temporal,
      [AdvancedReasoningMode.CONSTRAINT_BASED]: features.constraintBased,
      [AdvancedReasoningMode.FIRST_PRINCIPLES]: features.firstPrinciples
    };

    // Find highest scoring mode
    const entries = (Object.entries(allScores) as [AllReasoningModes, number][])
      .filter(([mode]) => mode !== ReasoningMode.HYBRID);
    const [bestMode, bestScore] = entries.reduce((a, b) => a[1] > b[1] ? a : b);

    // Check if we should use hybrid mode (improved threshold logic)
    const sortedScores = entries.map(e => e[1]).sort((a, b) => b - a);
    const topScore = sortedScores[0];
    const secondScore = sortedScores[1];

    // More reasonable hybrid logic: require top score to be < 1.5x second score
    // AND gap to be small, to avoid triggering hybrid too frequently
    const scoreRatio = secondScore > 0 ? topScore / secondScore : Infinity;
    if (topScore > 0.4 && scoreRatio < 1.5 && topScore - secondScore < this.config.hybridThreshold) {
      return {
        mode: ReasoningMode.HYBRID,
        confidence: topScore,
        reasoning: `Multiple modes score similarly (ratio ${scoreRatio.toFixed(2)}, gap ${(topScore - secondScore).toFixed(2)} < ${this.config.hybridThreshold}); using hybrid approach`,
        allScores: features
      };
    }

    return {
      mode: bestMode,
      confidence: bestScore,
      reasoning: this.explainSelection(bestMode, bestScore),
      allScores: features
    };
  }

  /**
   * Analyze query to extract features for mode selection
   *
   * Extracts characteristics like keywords, patterns, complexity,
   * temporal markers, constraints, etc.
   *
   * @param query The query string to analyze
   * @returns Query features with core mode scores
   */
  private async analyzeQuery(query: string): Promise<ExtendedQueryFeatures> {
    // Use core selector to get base mode scores (FIXED: added await)
    const coreResult = await this.coreSelector.selectMode({ query });

    // Initialize features with core scores
    const features: ExtendedQueryFeatures = {
      // Core mode scores (from ModeSelector)
      patternMatch: coreResult.scores.patternMatch,
      causalInference: coreResult.scores.causalInference,
      contextual: coreResult.scores.contextual,

      // Advanced mode scores (initialized to 0, will be calculated)
      analogical: 0,
      abductive: 0,
      counterfactual: 0,
      decomposition: 0,
      adversarial: 0,
      temporal: 0,
      constraintBased: 0,
      firstPrinciples: 0
    };

    return features;
  }

  /**
   * Score query for analogical reasoning
   *
   * High score when:
   * - Query contains cross-domain keywords
   * - Query mentions different domains
   * - Query asks to transfer knowledge
   *
   * @param query Query string to analyze
   * @returns Score [0, 1]
   */
  private scoreAnalogical(query: string): number {
    let score = 0.0;
    const queryLower = query.toLowerCase();

    // Cross-domain keywords
    const analogyKeywords = ['like', 'similar to', 'analogous', 'reminds me of', 'just as', 'comparable to', 'resembles'];
    if (this.hasKeywords(queryLower, analogyKeywords)) {
      score += 0.5;
    }

    // Domain transfer patterns
    const domainPatterns = [
      /\b(domain|field|area)\b/i,
      /different (context|domain|field)/i,
      /apply .+ to/i
    ];
    if (domainPatterns.some(pattern => pattern.test(query))) {
      score += 0.35;
    }

    // "What can X teach us about Y" patterns
    if (/what can .+ teach .+ about/i.test(query)) {
      score += 0.65;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Score query for abductive reasoning
   *
   * High score when:
   * - Query asks "why" or seeks causes
   * - Query involves diagnosis/troubleshooting
   * - Query seeks explanations
   *
   * @param query Query string to analyze
   * @returns Score [0, 1]
   */
  private scoreAbductive(query: string): number {
    let score = 0.0;
    const queryLower = query.toLowerCase();

    // Why/cause keywords
    const causalKeywords = ['why', 'cause', 'reason', 'explain why', 'root cause', 'because'];
    if (this.hasKeywords(queryLower, causalKeywords)) {
      score += 0.55;
    }

    // Diagnostic patterns
    const diagnosticKeywords = ['diagnose', 'troubleshoot', 'debug', 'failing', 'investigate', 'identify the cause'];
    if (this.hasKeywords(queryLower, diagnosticKeywords)) {
      score += 0.7;
    }

    // Effect-to-cause structure (also simple "why?")
    if (/why (is|does|did|are|was)/i.test(query) || /^\s*why\s*\??\s*$/i.test(query)) {
      score += 0.5;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Score query for counterfactual reasoning
   *
   * High score when:
   * - Query contains "what if" scenarios
   * - Query explores alternatives
   * - Query compares different choices
   *
   * @param query Query string to analyze
   * @returns Score [0, 1]
   */
  private scoreCounterfactual(query: string): number {
    let score = 0.0;
    const queryLower = query.toLowerCase();

    // What-if keywords
    const whatIfKeywords = ['what if', 'would have', 'could have', 'instead', 'alternatively', 'suppose', 'imagine'];
    if (this.hasKeywords(queryLower, whatIfKeywords)) {
      score += 0.75;
    }

    // Hypothetical patterns (various forms of "if X then Y" or "would X if Y")
    if (/if .+ (then|would|could)/i.test(query) || /(would|could) .+ if/i.test(query)) {
      score += 0.65;
    }

    // Comparison indicators
    const comparisonKeywords = ['compare', 'versus', 'vs', 'difference', 'alternative'];
    if (this.hasKeywords(queryLower, comparisonKeywords)) {
      score += 0.35;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Score query for decomposition reasoning
   *
   * High score when:
   * - Query is complex/long
   * - Query has multiple subjects
   * - Query asks to break down
   *
   * @param query Query string to analyze
   * @returns Score [0, 1]
   */
  private scoreDecomposition(query: string): number {
    let score = 0.0;
    const queryLower = query.toLowerCase();

    // Complexity indicators (length)
    if (query.length > 200) {
      score += 0.25;
    }

    // Multiple subjects (detected by counting "and" or commas in lists)
    const andCount = (query.match(/\band\b/gi) || []).length;
    const commaCount = (query.match(/,/g) || []).length;
    const listItemCount = Math.max(andCount, commaCount);

    if (listItemCount >= 5) {
      score += 0.75;
    } else if (listItemCount >= 3) {
      score += 0.65;
    } else if (listItemCount >= 2) {
      score += 0.3;
    }

    // Breakdown keywords
    const breakdownKeywords = ['break down', 'step by step', 'components', 'parts', 'decompose', 'split', 'divide'];
    if (this.hasKeywords(queryLower, breakdownKeywords)) {
      score += 0.7;
    }

    // Multi-part task pattern
    if (/and .+ and .+ and/i.test(query) || commaCount >= 3) {
      score += 0.3;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Score query for adversarial reasoning
   *
   * High score when:
   * - Query mentions security/vulnerabilities
   * - Query asks about failure modes
   * - Query seeks edge cases
   *
   * @param query Query string to analyze
   * @returns Score [0, 1]
   */
  private scoreAdversarial(query: string): number {
    let score = 0.0;
    const queryLower = query.toLowerCase();

    // Security/vulnerability keywords
    const securityKeywords = ['security', 'vulnerability', 'vulnerabilities', 'attack', 'exploit', 'hack', 'threat', 'risk'];
    if (this.hasKeywords(queryLower, securityKeywords)) {
      score += 0.7;
    }

    // Failure mode keywords
    const failureKeywords = ['fail', 'failing', 'wrong', 'break', 'edge case', 'corner case', 'error', 'bug'];
    if (this.hasKeywords(queryLower, failureKeywords)) {
      score += 0.4;
    }

    // Challenge patterns
    if (/what could go wrong|how could .+ fail|find .+ vulnerabilit/i.test(query)) {
      score += 0.7;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Score query for temporal reasoning
   *
   * High score when:
   * - Query contains time keywords
   * - Query has date references
   * - Query asks about sequences/order
   *
   * @param query Query string to analyze
   * @returns Score [0, 1]
   */
  private scoreTemporal(query: string): number {
    let score = 0.0;
    const queryLower = query.toLowerCase();

    // Time keywords
    const timeKeywords = ['when', 'before', 'after', 'during', 'timeline', 'history', 'historical', 'time'];
    if (this.hasKeywords(queryLower, timeKeywords)) {
      score += 0.45;
    }

    // Date references (simple heuristic)
    const hasDateReferences = /\d{4}|\b(january|february|march|april|may|june|july|august|september|october|november|december)\b|last (week|month|year)|past \d+/i.test(query);
    if (hasDateReferences) {
      score += 0.5;
    }

    // Sequence keywords (avoid matching "first principles", use word boundaries for single words)
    const hasSequenceWords = /\bsequence\b|\border\b|\bthen\b|\bfinally\b|\bevolution\b|\bprogression\b/i.test(query) || queryLower.includes('over time');
    const hasFirstInSequence = /\bfirst\b/.test(queryLower) && !queryLower.includes('first principle');

    if (hasSequenceWords || hasFirstInSequence) {
      score += 0.55;
    }

    // Trend analysis (changed/change pattern)
    const trendKeywords = ['trend', 'change over time', 'evolve', 'develop'];
    const hasChangePattern = /chang(e|ed|ing)/i.test(query);

    if (this.hasKeywords(queryLower, trendKeywords) || hasChangePattern) {
      score += 0.65;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Score query for constraint-based reasoning
   *
   * High score when:
   * - Query has hard constraints
   * - Query mentions requirements/limitations
   * - Query has conditional constraints
   *
   * @param query Query string to analyze
   * @returns Score [0, 1]
   */
  private scoreConstraintBased(query: string): number {
    let score = 0.0;
    const queryLower = query.toLowerCase();

    // Constraint keywords
    const constraintKeywords = ['must', 'cannot', 'should not', 'without', 'only if', 'required', 'mandatory'];
    if (this.hasKeywords(queryLower, constraintKeywords)) {
      score += 0.65;
    }

    // Requirement patterns
    const requirementKeywords = ['requirement', 'constraint', 'limitation', 'restriction', 'condition'];
    if (this.hasKeywords(queryLower, requirementKeywords)) {
      score += 0.35;
    }

    // Conditional constraints
    if (/but .+ must|as long as|provided that|given that/i.test(query)) {
      score += 0.75;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Score query for first-principles reasoning
   *
   * High score when:
   * - Query mentions fundamentals
   * - Query asks for derivation/proof
   * - Query challenges assumptions
   *
   * @param query Query string to analyze
   * @returns Score [0, 1]
   */
  private scoreFirstPrinciples(query: string): number {
    let score = 0.0;
    const queryLower = query.toLowerCase();

    // Fundamental keywords
    const fundamentalKeywords = ['fundamental', 'basic', 'core', 'underlying', 'from scratch', 'foundational'];
    if (this.hasKeywords(queryLower, fundamentalKeywords)) {
      score += 0.65;
    }

    // Derivation keywords
    const derivationKeywords = ['derive', 'prove', 'why does', 'how does', 'explain from first principles'];
    if (this.hasKeywords(queryLower, derivationKeywords)) {
      score += 0.35;
    }

    // Challenge assumptions
    const assumptionKeywords = ['assumption', 'assume', 'ground truth', 'axiom', 'first principle'];
    if (this.hasKeywords(queryLower, assumptionKeywords)) {
      score += 0.35;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Check if query contains any of the specified keywords with word boundaries
   *
   * Uses regex with word boundaries for very short words to prevent false matches.
   * For example, searching for "is" will not match "this", "analysis", or "his".
   * For longer words, uses flexible matching to catch variations
   * like "fail" matching "failing", "failed", "fails" and vice versa.
   *
   * @param query Query string (lowercase)
   * @param keywords Keywords to search for
   * @returns true if any keyword found
   */
  private hasKeywords(query: string, keywords: string[]): boolean {
    return keywords.some(keyword => {
      // For multi-word phrases, check if phrase is in query OR query contains all words
      if (keyword.includes(' ')) {
        if (query.includes(keyword)) {
          return true;
        }
        // Also check for plural forms (e.g., "edge case" matches "edge cases")
        const words = keyword.split(' ');
        const pluralPhrase = keyword + 's';
        return query.includes(pluralPhrase) || words.every(w => query.includes(w));
      }
      // For very short words (<=2 chars), use word boundaries to avoid false positives
      // (e.g., "is" shouldn't match "this")
      if (keyword.length <= 2) {
        const regex = new RegExp(`\\b${keyword}\\b`, 'i');
        return regex.test(query);
      }
      // For longer words, use flexible matching to catch variations
      // Check both directions: keyword in query, or query word in keyword + variations
      if (query.includes(keyword)) {
        return true;
      }
      // Also check plural forms (e.g., "bug" matches "bugs", "error" matches "errors")
      return query.includes(keyword + 's') || query.includes(keyword + 'es');
    });
  }

  /**
   * Explain why a particular mode was selected
   *
   * @param mode Selected mode
   * @param score Mode score
   * @returns Human-readable explanation
   */
  private explainSelection(mode: AllReasoningModes, score: number): string {
    // Use Enum values directly (FIXED: Bug 4)
    const descriptions: Record<AllReasoningModes, string> = {
      [ReasoningMode.PATTERN_MATCH]: 'query matches known templates',
      [ReasoningMode.CAUSAL_INFERENCE]: 'query requires cause-effect reasoning',
      [ReasoningMode.CONTEXTUAL]: 'query benefits from semantic similarity',
      [ReasoningMode.HYBRID]: 'query requires multiple reasoning approaches',
      [AdvancedReasoningMode.ANALOGICAL]: 'query requires cross-domain pattern transfer',
      [AdvancedReasoningMode.ABDUCTIVE]: 'query seeks best explanation for observations',
      [AdvancedReasoningMode.COUNTERFACTUAL]: 'query explores alternative scenarios',
      [AdvancedReasoningMode.DECOMPOSITION]: 'query requires problem breakdown',
      [AdvancedReasoningMode.ADVERSARIAL]: 'query seeks vulnerabilities or failure modes',
      [AdvancedReasoningMode.TEMPORAL]: 'query involves time-based reasoning',
      [AdvancedReasoningMode.CONSTRAINT_BASED]: 'query has constraints to satisfy',
      [AdvancedReasoningMode.FIRST_PRINCIPLES]: 'query requires derivation from fundamentals'
    };

    const description = descriptions[mode] || 'unknown reasoning mode';
    return `Selected ${mode} mode (confidence ${score.toFixed(2)}) - ${description}`;
  }

  /**
   * Get mode description for any reasoning mode
   *
   * @param mode Reasoning mode
   * @returns Human-readable description
   */
  getModeDescription(mode: AllReasoningModes): string {
    switch (mode) {
      // Core modes
      case ReasoningMode.PATTERN_MATCH:
        return this.coreSelector.getModeDescription(mode);
      case ReasoningMode.CAUSAL_INFERENCE:
        return this.coreSelector.getModeDescription(mode);
      case ReasoningMode.CONTEXTUAL:
        return this.coreSelector.getModeDescription(mode);
      case ReasoningMode.HYBRID:
        return this.coreSelector.getModeDescription(mode);

      // Advanced modes
      case AdvancedReasoningMode.ANALOGICAL:
        return 'Analogical reasoning: Transfer knowledge across domains by mapping structural similarities';

      case AdvancedReasoningMode.ABDUCTIVE:
        return 'Abductive reasoning: Infer most likely explanations from observed effects';

      case AdvancedReasoningMode.COUNTERFACTUAL:
        return 'Counterfactual reasoning: Explore "what if" scenarios and alternative outcomes';

      case AdvancedReasoningMode.DECOMPOSITION:
        return 'Decomposition reasoning: Break complex problems into manageable sub-problems';

      case AdvancedReasoningMode.ADVERSARIAL:
        return 'Adversarial reasoning: Identify vulnerabilities, failures, and edge cases';

      case AdvancedReasoningMode.TEMPORAL:
        return 'Temporal reasoning: Analyze time-ordered sequences and temporal relationships';

      case AdvancedReasoningMode.CONSTRAINT_BASED:
        return 'Constraint-based reasoning: Solve problems with hard and soft constraints';

      case AdvancedReasoningMode.FIRST_PRINCIPLES:
        return 'First-principles reasoning: Derive solutions from fundamental axioms';

      default:
        return 'Unknown reasoning mode';
    }
  }
}

