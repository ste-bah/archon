/**
 * AbductiveEngine - Backward Causal Inference for Best Explanation
 * SPEC-RSN-002 Section 2.2: Abductive Reasoning Mode
 *
 * Implements inference to best explanation by:
 * 1. Extracting observed effects from query
 * 2. Backward traversing causal graph to find potential causes
 * 3. Generating hypotheses (cause combinations)
 * 4. Scoring hypotheses by coverage, parsimony (Occam's Razor), and prior probability
 * 5. Returning best explanation with confidence
 *
 * Performance Target: <100ms for 3-hop backward traversal
 *
 * Algorithm:
 * - Uses VectorDB for semantic effect extraction
 * - Uses CausalMemory.findCauses() for backward graph traversal
 * - Implements Occam's Razor weighting for simpler explanations
 * - Evaluates 5-20 hypotheses per query
 */

import type { CausalMemory } from '../causal-memory.js';
import type { VectorDB } from '../../vector-db/vector-db.js';
import type {
  IReasoningRequest,
  ReasoningMode,
  IPatternMatch,
  IInferenceResult,
  IProvenanceInfo,
} from '../reasoning-types.js';
import type {
  AbductiveConfig,
  IAbductiveResult,
  AbductiveExplanation,
} from '../advanced-reasoning-types.js';
import { AdvancedReasoningMode } from '../advanced-reasoning-types.js';
import type { NodeID, CausalChain } from '../causal-types.js';
import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../../observability/index.js';

const logger = createComponentLogger('AbductiveEngine', {
  minLevel: LogLevel.WARN,
  handlers: [new ConsoleLogHandler()]
});

/**
 * Dependencies for AbductiveEngine
 */
export interface AbductiveEngineDependencies {
  /** Causal graph for backward traversal */
  causalMemory: CausalMemory;
  /** Vector database for semantic search */
  vectorDB: VectorDB;
}

/**
 * Hypothesis for abductive inference
 */
interface Hypothesis {
  /** Potential causes explaining the effects */
  causes: NodeID[];
  /** Causal chains supporting this hypothesis */
  chains: CausalChain[];
  /** Description of the hypothesis */
  description: string;
}

/**
 * Scored hypothesis with metrics
 */
interface ScoredHypothesis {
  /** The hypothesis being scored */
  hypothesis: Hypothesis;
  /** Combined score [0, 1] */
  score: number;
  /** Explanatory coverage [0, 1] */
  coverage: number;
  /** Parsimony score [0, 1] (simpler = higher) */
  parsimony: number;
  /** Prior probability [0, 1] */
  priorProbability: number;
}

/**
 * AbductiveEngine - Infer best explanation from observed effects
 *
 * Implementation of backward causal reasoning to find most likely causes
 * for observed effects using Occam's Razor and Bayesian priors.
 */
export class AbductiveEngine {
  private causalMemory: CausalMemory;
  private vectorDB: VectorDB;

  constructor(deps: AbductiveEngineDependencies) {
    this.causalMemory = deps.causalMemory;
    this.vectorDB = deps.vectorDB;
  }

  /**
   * Perform abductive reasoning to find best explanation for observed effects
   *
   * Algorithm:
   * 1. Parse observed effects from query embedding
   * 2. Backward traverse causal graph from effects to potential causes
   * 3. Generate hypotheses (cause combinations)
   * 4. Score hypotheses by:
   *    - Explanatory coverage (how many effects explained)
   *    - Parsimony (simpler = better, weighted by occamWeight)
   *    - Prior probability (from pattern frequency)
   * 5. Return best explanation with confidence
   *
   * @param request - Reasoning request with query embedding
   * @param config - Abductive configuration
   * @returns Abductive result with ranked explanations
   */
  async reason(
    request: IReasoningRequest,
    config: AbductiveConfig
  ): Promise<IAbductiveResult> {
    const startTime = performance.now();

    // Apply defaults to config
    const maxCausalDepth = config.maxCausalDepth ?? 5;
    const hypothesisLimit = config.hypothesisLimit ?? 10;
    const occamWeight = config.occamWeight ?? 0.5;
    const minPlausibility = config.minPlausibility ?? 0.3;

    // 1. Extract observed effects from query
    const observedEffects = await this.extractEffects(
      request.query,
      config.observedEffects.length || 5
    );

    // If config specifies effects, use those instead
    const effectNodes = config.observedEffects.length > 0
      ? config.observedEffects
      : observedEffects;

    if (effectNodes.length === 0) {
      // No effects found - return empty result
      return this.createEmptyResult(request, performance.now() - startTime);
    }

    // 2. Backward traverse causal graph for each effect
    const allChains: CausalChain[] = [];
    const allCauses = new Set<NodeID>();

    for (const effect of effectNodes) {
      const result = await this.causalMemory.findCauses(effect, maxCausalDepth);
      allChains.push(...result.chains);
      result.causes.forEach(cause => allCauses.add(cause));
    }

    if (allChains.length === 0) {
      // No causal chains found
      return this.createEmptyResult(request, performance.now() - startTime);
    }

    // 3. Generate hypotheses from causal chains
    const hypotheses = this.generateHypotheses(
      allChains,
      Array.from(allCauses),
      hypothesisLimit
    );

    // 4. Score hypotheses
    const scoredHypotheses = hypotheses.map(h =>
      this.scoreHypothesis(h, effectNodes, occamWeight)
    );

    // Sort by score descending
    scoredHypotheses.sort((a, b) => b.score - a.score);

    // Filter by minimum plausibility
    const plausibleHypotheses = scoredHypotheses.filter(
      sh => sh.score >= minPlausibility
    );

    // 5. Convert to explanations
    const explanations = plausibleHypotheses.map((sh, index) =>
      this.toExplanation(sh, plausibleHypotheses.length, index === 0)
    );

    const processingTimeMs = performance.now() - startTime;
    const latencyMs = Math.round(processingTimeMs);

    // Build result with all required IAdvancedReasoningResult fields
    const result: IAbductiveResult = {
      // IAdvancedReasoningResult fields
      mode: AdvancedReasoningMode.ABDUCTIVE,
      answer: this.formatAnswer(explanations),
      reasoningSteps: this.generateReasoningSteps(explanations, allChains),
      latencyMs,
      confidence: explanations.length > 0 ? explanations[0].plausibility : 0,

      // IReasoningResponse fields (from base interface)
      type: 'causal-inference' as ReasoningMode,
      patterns: [] as IPatternMatch[],
      causalInferences: [] as IInferenceResult[],
      trajectoryId: this.generateTrajectoryId(),
      processingTimeMs: latencyMs,
      provenanceInfo: {
        lScores: explanations.map(e => e.lScore),
        totalSources: allChains.length,
        combinedLScore: this.calculateCombinedLScore(explanations),
        sourceBreakdown: {
          causal: allChains.length,
        },
      } as IProvenanceInfo,

      // Mode-specific field
      explanations,
    };

    return result;
  }

  /**
   * Extract effects from query using VectorDB semantic search
   *
   * @param embedding - Query embedding vector
   * @param maxEffects - Maximum number of effects to extract
   * @returns Array of node IDs representing observed effects
   */
  private async extractEffects(
    embedding: Float32Array,
    maxEffects: number
  ): Promise<NodeID[]> {
    try {
      // Search for semantically related nodes in causal graph
      const results = await this.vectorDB.search(embedding, maxEffects);

      // Extract node IDs from results
      // Filter by similarity threshold and extract IDs
      const threshold = 0.6; // Reasonable similarity threshold
      return results
        .filter(r => r.similarity >= threshold)
        .map(r => r.id as NodeID)
        .slice(0, maxEffects);
    } catch (error) {
      logger.warn('Failed to extract effects from query', { error: String(error) });
      return [];
    }
  }

  /**
   * Generate hypotheses from causal chains
   *
   * Creates both single-cause and multi-cause hypotheses (up to 3 causes combined)
   *
   * @param chains - Causal chains from backward traversal
   * @param allCauses - All unique causes found
   * @param limit - Maximum number of hypotheses to generate
   * @returns Array of hypotheses
   */
  private generateHypotheses(
    chains: CausalChain[],
    allCauses: NodeID[],
    limit: number
  ): Hypothesis[] {
    const hypotheses: Hypothesis[] = [];
    const causeToChains = new Map<NodeID, CausalChain[]>();

    // Group chains by their root causes
    for (const chain of chains) {
      for (const cause of chain.startNodes) {
        if (!causeToChains.has(cause)) {
          causeToChains.set(cause, []);
        }
        causeToChains.get(cause)!.push(chain);
      }
    }

    // 1. Single-cause hypotheses
    for (const cause of allCauses) {
      const relatedChains = causeToChains.get(cause) || [];
      if (relatedChains.length > 0) {
        hypotheses.push({
          causes: [cause],
          chains: relatedChains,
          description: this.buildHypothesisDescription([cause]),
        });
      }
    }

    // 2. Multi-cause hypotheses (pairs)
    if (allCauses.length >= 2) {
      for (let i = 0; i < allCauses.length && hypotheses.length < limit; i++) {
        for (let j = i + 1; j < allCauses.length && hypotheses.length < limit; j++) {
          const cause1 = allCauses[i];
          const cause2 = allCauses[j];
          const chains1 = causeToChains.get(cause1) || [];
          const chains2 = causeToChains.get(cause2) || [];

          if (chains1.length > 0 || chains2.length > 0) {
            hypotheses.push({
              causes: [cause1, cause2],
              chains: [...chains1, ...chains2],
              description: this.buildHypothesisDescription([cause1, cause2]),
            });
          }
        }
      }
    }

    // 3. Triple-cause hypotheses (if needed and not at limit)
    if (allCauses.length >= 3 && hypotheses.length < limit) {
      for (let i = 0; i < allCauses.length && hypotheses.length < limit; i++) {
        for (let j = i + 1; j < allCauses.length && hypotheses.length < limit; j++) {
          for (let k = j + 1; k < allCauses.length && hypotheses.length < limit; k++) {
            const cause1 = allCauses[i];
            const cause2 = allCauses[j];
            const cause3 = allCauses[k];
            const chains1 = causeToChains.get(cause1) || [];
            const chains2 = causeToChains.get(cause2) || [];
            const chains3 = causeToChains.get(cause3) || [];

            if (chains1.length > 0 || chains2.length > 0 || chains3.length > 0) {
              hypotheses.push({
                causes: [cause1, cause2, cause3],
                chains: [...chains1, ...chains2, ...chains3],
                description: this.buildHypothesisDescription([cause1, cause2, cause3]),
              });
            }
          }
        }
      }
    }

    return hypotheses.slice(0, limit);
  }

  /**
   * Score a hypothesis using explanatory coverage, parsimony, and prior probability
   *
   * Score formula:
   * score = (coverage * (1 - occamWeight)) + (parsimony * occamWeight)
   *
   * Coverage: % of effects explained by this hypothesis
   * Parsimony: Inverse of hypothesis complexity (fewer causes = higher)
   *
   * @param hypothesis - Hypothesis to score
   * @param observedEffects - Observed effects to explain
   * @param occamWeight - Weight for Occam's Razor [0, 1]
   * @returns Scored hypothesis with metrics
   */
  private scoreHypothesis(
    hypothesis: Hypothesis,
    observedEffects: NodeID[],
    occamWeight: number
  ): ScoredHypothesis {
    // 1. Calculate coverage: what % of observed effects are explained
    const explainedEffects = new Set<NodeID>();
    for (const chain of hypothesis.chains) {
      chain.endNodes.forEach(e => explainedEffects.add(e));
    }

    const coverage = observedEffects.length > 0
      ? explainedEffects.size / observedEffects.length
      : 0;

    // 2. Calculate parsimony: prefer simpler explanations
    // Use logarithmic scale to penalize complexity
    const numCauses = hypothesis.causes.length;
    const parsimony = 1 / (1 + Math.log2(numCauses));

    // 3. Calculate prior probability from chain confidences
    const avgChainConfidence = hypothesis.chains.length > 0
      ? hypothesis.chains.reduce((sum, c) => sum + c.totalConfidence, 0) / hypothesis.chains.length
      : 0;

    const priorProbability = avgChainConfidence;

    // 4. Combine scores
    // Weighted combination of coverage and parsimony
    // Prior probability acts as a multiplier
    const baseScore = (coverage * (1 - occamWeight)) + (parsimony * occamWeight);
    const score = baseScore * (0.5 + 0.5 * priorProbability);

    return {
      hypothesis,
      score,
      coverage,
      parsimony,
      priorProbability,
    };
  }

  /**
   * Convert scored hypothesis to explanation
   *
   * @param scoredHypothesis - Scored hypothesis to convert
   * @param totalAlternatives - Total number of alternative explanations
   * @param isBest - Whether this is the best explanation
   * @returns Abductive explanation
   */
  private toExplanation(
    scoredHypothesis: ScoredHypothesis,
    totalAlternatives: number,
    _isBest: boolean
  ): AbductiveExplanation {
    const { hypothesis, score } = scoredHypothesis;
    void scoredHypothesis.coverage; // Acknowledge unused
    void scoredHypothesis.priorProbability; // Acknowledge unused

    // Calculate evidence strength from chains
    const evidenceStrength = hypothesis.chains.length > 0
      ? hypothesis.chains.reduce((max, c) => Math.max(max, c.totalConfidence), 0)
      : 0;

    // L-Score combines score and evidence strength
    const lScore = Math.sqrt(score * evidenceStrength);

    return {
      hypothesis: hypothesis.description,
      causes: hypothesis.causes,
      plausibility: score,
      evidenceStrength,
      alternativeCount: totalAlternatives - 1,
      lScore,
    };
  }

  /**
   * Build human-readable hypothesis description
   *
   * @param causes - Cause node IDs
   * @returns Description string
   */
  private buildHypothesisDescription(causes: NodeID[]): string {
    if (causes.length === 1) {
      return `Cause: ${this.getNodeLabel(causes[0])}`;
    } else if (causes.length === 2) {
      return `Causes: ${this.getNodeLabel(causes[0])} and ${this.getNodeLabel(causes[1])}`;
    } else {
      const labels = causes.map(c => this.getNodeLabel(c));
      const lastLabel = labels.pop();
      return `Causes: ${labels.join(', ')}, and ${lastLabel}`;
    }
  }

  /**
   * Get node label from causal memory
   *
   * @param nodeId - Node ID
   * @returns Node label or ID if not found
   */
  private getNodeLabel(nodeId: NodeID): string {
    const node = this.causalMemory.getNode(nodeId);
    return node?.label || nodeId;
  }

  /**
   * Calculate combined L-Score from explanations
   *
   * @param explanations - Array of explanations
   * @returns Combined L-Score (geometric mean)
   */
  private calculateCombinedLScore(explanations: AbductiveExplanation[]): number {
    if (explanations.length === 0) return 0;

    const product = explanations.reduce((prod, e) => prod * e.lScore, 1);
    return Math.pow(product, 1 / explanations.length);
  }

  /**
   * Generate trajectory ID for tracking
   *
   * @returns Trajectory ID
   */
  private generateTrajectoryId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `traj_${timestamp}_${random}`;
  }

  /**
   * Create empty result when no explanations found
   *
   * @param request - Original request
   * @param processingTimeMs - Processing time
   * @returns Empty abductive result
   */
  private createEmptyResult(
    _request: IReasoningRequest,
    processingTimeMs: number
  ): IAbductiveResult {
    const latencyMs = Math.round(processingTimeMs);
    return {
      // IAdvancedReasoningResult fields
      mode: AdvancedReasoningMode.ABDUCTIVE,
      answer: 'No explanations found for the observed effects.',
      reasoningSteps: ['No valid hypotheses could be generated.'],
      latencyMs,
      confidence: 0,

      // IReasoningResponse fields
      type: 'causal-inference' as ReasoningMode,
      patterns: [] as IPatternMatch[],
      causalInferences: [] as IInferenceResult[],
      trajectoryId: this.generateTrajectoryId(),
      processingTimeMs: latencyMs,
      provenanceInfo: {
        lScores: [],
        totalSources: 0,
        combinedLScore: 0,
        sourceBreakdown: {
          causal: 0,
        },
      } as IProvenanceInfo,

      // Mode-specific field
      explanations: [],
    };
  }

  /**
   * Format answer from explanations
   */
  private formatAnswer(explanations: AbductiveExplanation[]): string {
    if (explanations.length === 0) {
      return 'No explanations found for the observed effects.';
    }

    const best = explanations[0];
    const lines = [
      `Best explanation: ${best.hypothesis}`,
      `Plausibility: ${(best.plausibility * 100).toFixed(1)}%`,
      `Evidence strength: ${(best.evidenceStrength * 100).toFixed(1)}%`,
    ];

    if (explanations.length > 1) {
      lines.push(`Alternative explanations: ${explanations.length - 1}`);
    }

    return lines.join('\n');
  }

  /**
   * Generate reasoning steps from explanations
   */
  private generateReasoningSteps(
    explanations: AbductiveExplanation[],
    allChains: CausalChain[]
  ): string[] {
    return [
      `Identified ${allChains.length} potential causal chains`,
      `Generated ${explanations.length} plausible hypotheses`,
      `Applied Occam's Razor weighting for simpler explanations`,
      explanations.length > 0
        ? `Best explanation plausibility: ${(explanations[0].plausibility * 100).toFixed(1)}%`
        : 'No explanations met the plausibility threshold',
    ];
  }
}
