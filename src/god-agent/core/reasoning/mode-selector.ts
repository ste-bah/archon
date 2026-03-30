/**
 * Mode Selector - Automatic Reasoning Mode Selection
 *
 * Analyzes request characteristics to select optimal reasoning mode:
 * - Pattern-Match: Template-like queries, well-defined tasks
 * - Causal-Inference: Cause-effect reasoning, multi-step logic
 * - Contextual: Open-ended queries, semantic similarity
 * - Hybrid: Complex queries needing multiple approaches
 *
 * Selection latency: <2ms
 *
 * @module god-agent/core/reasoning/mode-selector
 */

import {
  ReasoningMode,
  ModeSelectionResult,
  ModeScores
} from './reasoning-types.js';
import { TaskType } from './pattern-types.js';

/**
 * Extended reasoning request with string query for mode selection
 *
 * ModeSelector works with high-level string queries before embedding.
 * The query field here is a string that will be analyzed for keywords,
 * patterns, etc.
 */
export interface ModeSelectionRequest {
  /** Query string to analyze */
  query: string;

  /** Optional reasoning mode override */
  type?: ReasoningMode;

  /** Optional task type for filtering */
  taskType?: TaskType;

  /** Optional context data */
  context?: Record<string, any>;

  /** Optional context embeddings */
  contextEmbeddings?: Float32Array[];

  /** Optional metadata */
  metadata?: Record<string, any>;
}

/**
 * Default causal keywords for detecting causal-inference mode
 */
const DEFAULT_CAUSAL_KEYWORDS = [
  'because', 'causes', 'leads to', 'results in',
  'therefore', 'consequently', 'due to', 'as a result',
  'if...then', 'why', 'how does', 'what happens when',
  'effect of', 'impact of', 'reason for', 'caused by',
  'stems from', 'originates from', 'triggers', 'influences'
];

/**
 * Configuration for mode selector
 */
export interface ModeSelectorConfig {
  /** Threshold for pattern-match mode selection (default: 0.6) */
  patternMatchThreshold?: number;

  /** Threshold for causal-inference mode selection (default: 0.6) */
  causalInferenceThreshold?: number;

  /** Threshold for contextual mode selection (default: 0.6) */
  contextualThreshold?: number;

  /** Score gap threshold for hybrid mode (default: 0.15) */
  hybridThreshold?: number;

  /** Custom causal keywords for detection */
  causalKeywords?: string[];
}

/**
 * ModeSelector - Automatically selects optimal reasoning mode
 *
 * Analyzes request characteristics to determine which reasoning mode
 * will be most effective. Supports hybrid mode when multiple approaches
 * would be beneficial.
 */
export class ModeSelector {
  private config: Required<ModeSelectorConfig>;
  private causalKeywords: string[];

  constructor(config: ModeSelectorConfig = {}) {
    this.config = {
      patternMatchThreshold: config.patternMatchThreshold ?? 0.6,
      causalInferenceThreshold: config.causalInferenceThreshold ?? 0.6,
      contextualThreshold: config.contextualThreshold ?? 0.6,
      hybridThreshold: config.hybridThreshold ?? 0.15,
      causalKeywords: config.causalKeywords ?? DEFAULT_CAUSAL_KEYWORDS
    };

    this.causalKeywords = this.config.causalKeywords;
  }

  /**
   * Select optimal reasoning mode based on request characteristics
   *
   * @param request The reasoning request to analyze (with string query)
   * @returns ModeSelectionResult with selected mode and confidence
   */
  selectMode(request: ModeSelectionRequest): ModeSelectionResult {
    // If explicit mode requested, use it with full confidence
    if (request.type !== undefined) {
      return {
        mode: request.type,
        confidence: 1.0,
        scores: { patternMatch: 0, causalInference: 0, contextual: 0 },
        reasoning: 'Explicit mode specified in request'
      };
    }

    // Calculate scores for each mode
    const scores: ModeScores = {
      patternMatch: this.analyzeForPatternMatch(request),
      causalInference: this.analyzeForCausalInference(request),
      contextual: this.analyzeForContextual(request)
    };

    // Check if hybrid mode is beneficial
    if (this.shouldUseHybrid(scores)) {
      const avgScore = (scores.patternMatch + scores.causalInference + scores.contextual) / 3;
      return {
        mode: ReasoningMode.HYBRID,
        confidence: avgScore,
        scores,
        reasoning: `Multiple modes score similarly (gap < ${this.config.hybridThreshold}); using hybrid approach`
      };
    }

    // Select highest scoring mode
    const entries = Object.entries(scores) as [keyof ModeScores, number][];
    const [bestMode, bestScore] = entries.reduce((a, b) => a[1] > b[1] ? a : b);

    const modeMap: Record<keyof ModeScores, ReasoningMode> = {
      patternMatch: ReasoningMode.PATTERN_MATCH,
      causalInference: ReasoningMode.CAUSAL_INFERENCE,
      contextual: ReasoningMode.CONTEXTUAL
    };

    return {
      mode: modeMap[bestMode],
      confidence: bestScore,
      scores,
      reasoning: `Selected ${bestMode} mode with confidence ${bestScore.toFixed(2)}`
    };
  }

  /**
   * Analyze request for pattern-match mode suitability
   *
   * High score when:
   * - Query has template-like structure
   * - TaskType is well-defined
   * - Low context complexity
   *
   * @param request The reasoning request
   * @returns Score 0.0-1.0
   */
  private analyzeForPatternMatch(request: ModeSelectionRequest): number {
    let score = 0.0;

    // Check if taskType is specified and well-defined
    if (request.taskType) {
      score += 0.4;
    }

    // Check for template-like patterns in query
    const query = request.query.toLowerCase();
    const templatePatterns = [
      /^(write|create|generate|implement)\s+a\s+/,
      /^(fix|debug|resolve)\s+/,
      /^(refactor|optimize|improve)\s+/,
      /^(add|remove|update)\s+/,
      /\b(function|class|component|module)\b/,
      /\b(test|unit test|integration test)\b/
    ];

    const hasTemplatePattern = templatePatterns.some(pattern => pattern.test(query));
    if (hasTemplatePattern) {
      score += 0.3;
    }

    // Check query length - shorter queries often fit patterns better
    if (request.query.length < 100) {
      score += 0.2;
    } else if (request.query.length < 200) {
      score += 0.1;
    }

    // Penalize if context is very complex (indicates need for deeper reasoning)
    if (request.context && Object.keys(request.context).length > 5) {
      score -= 0.1;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Analyze request for causal-inference mode suitability
   *
   * High score when:
   * - Query contains causal keywords
   * - Need to understand cause-effect
   * - Multi-step reasoning required
   *
   * @param request The reasoning request
   * @returns Score 0.0-1.0
   */
  private analyzeForCausalInference(request: ModeSelectionRequest): number {
    let score = 0.0;
    const query = request.query.toLowerCase();

    // Check for causal keywords
    const causalKeywordCount = this.causalKeywords.filter(keyword =>
      query.includes(keyword.toLowerCase())
    ).length;

    if (causalKeywordCount > 0) {
      score += Math.min(0.5, causalKeywordCount * 0.15);
    }

    // Check for question words indicating causal reasoning
    const questionPatterns = [
      /\bwhy\b/,
      /\bhow does\b/,
      /\bwhat happens when\b/,
      /\bwhat causes\b/,
      /\bwhat leads to\b/
    ];

    const hasQuestionPattern = questionPatterns.some(pattern => pattern.test(query));
    if (hasQuestionPattern) {
      score += 0.3;
    }

    // Check for conditional or if-then structures
    if (/\b(if|when|then|given that)\b/.test(query)) {
      score += 0.2;
    }

    // Check for multi-step indicators
    const multiStepPatterns = [
      /\b(first|second|then|next|finally)\b/,
      /\b(step|stage|phase)\b/,
      /\d+\.\s+/  // Numbered lists
    ];

    const hasMultiStep = multiStepPatterns.some(pattern => pattern.test(query));
    if (hasMultiStep) {
      score += 0.2;
    }

    // Boost if context suggests causal structure
    if (request.context?.causalChain || request.context?.dependencies) {
      score += 0.15;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Analyze request for contextual mode suitability
   *
   * High score when:
   * - Context embeddings provided
   * - Open-ended query
   * - Semantic similarity needed
   *
   * @param request The reasoning request
   * @returns Score 0.0-1.0
   */
  private analyzeForContextual(request: ModeSelectionRequest): number {
    let score = 0.0;

    // Check if context embeddings are provided
    if (request.contextEmbeddings && request.contextEmbeddings.length > 0) {
      score += 0.4;
    }

    // Check if context object has significant data
    if (request.context && Object.keys(request.context).length > 3) {
      score += 0.2;
    }

    // Check for open-ended query patterns
    const query = request.query.toLowerCase();
    const openEndedPatterns = [
      /^(explain|describe|discuss|analyze)\b/,
      /^(what are|what is)\b/,
      /^(how can|how should)\b/,
      /\b(compare|contrast|evaluate)\b/,
      /\b(suggest|recommend|propose)\b/
    ];

    const hasOpenEndedPattern = openEndedPatterns.some(pattern => pattern.test(query));
    if (hasOpenEndedPattern) {
      score += 0.3;
    }

    // Longer queries often benefit from contextual understanding
    if (request.query.length > 150) {
      score += 0.2;
    }

    // Check if GNN enhancement would help (complex relational context)
    if (request.context?.nodes || request.context?.relationships || request.context?.graph) {
      score += 0.2;
    }

    // Boost if taskType is undefined (needs contextual understanding)
    if (!request.taskType) {
      score += 0.15;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Check if hybrid mode should be used
   *
   * Hybrid mode is beneficial when:
   * - Multiple modes score similarly (within threshold)
   * - Complex query needing multiple approaches
   * - Confidence is low in single mode
   *
   * @param scores Scores for all modes
   * @returns true if hybrid mode should be used
   */
  private shouldUseHybrid(scores: ModeScores): boolean {
    const scoreValues = Object.values(scores);
    const maxScore = Math.max(...scoreValues);
    const minScore = Math.min(...scoreValues);

    // If all scores are low, don't use hybrid (default to highest)
    if (maxScore < 0.4) {
      return false;
    }

    // Check if top scores are within threshold
    const sortedScores = scoreValues.sort((a, b) => b - a);
    const topScore = sortedScores[0];
    const secondScore = sortedScores[1];

    // If top two scores are close, use hybrid
    if (topScore - secondScore < this.config.hybridThreshold) {
      return true;
    }

    // If all three scores are relatively high and close, use hybrid
    const scoreRange = maxScore - minScore;
    if (minScore > 0.5 && scoreRange < this.config.hybridThreshold * 2) {
      return true;
    }

    return false;
  }

  /**
   * Get mode description
   *
   * @param mode Reasoning mode
   * @returns Human-readable description
   */
  getModeDescription(mode: ReasoningMode): string {
    switch (mode) {
      case ReasoningMode.PATTERN_MATCH:
        return 'Pattern matching using historical templates and successful examples';

      case ReasoningMode.CAUSAL_INFERENCE:
        return 'Causal inference using causal graph to predict consequences';

      case ReasoningMode.CONTEXTUAL:
        return 'Contextual reasoning using vector similarity and context embeddings';

      case ReasoningMode.HYBRID:
        return 'Hybrid approach combining pattern matching, causal inference, and contextual reasoning';

      default:
        return 'Unknown reasoning mode';
    }
  }
}
