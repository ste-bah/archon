/**
 * DAI-003: Routing Engine Implementation
 *
 * TASK-007: Routing Engine
 * Constitution: RULE-DAI-003-001, RULE-DAI-003-003, RULE-DAI-003-005, RULE-DAI-003-006
 *
 * Core routing engine that:
 * - Selects agents based on task analysis and capability matching
 * - Provides explainable routing decisions with factors
 * - Handles cold start behavior with explicit phase indication
 * - Requires confirmation for low-confidence decisions (< 0.7)
 * - NO external LLM calls (pure deterministic routing)
 *
 * Performance target: < 150ms (P95) per RULE-DAI-003-005
 *
 * @module src/god-agent/core/routing/routing-engine
 */

import type {
  IRoutingEngine,
  IRoutingResult,
  ITaskAnalysis,
  IRoutingConfig,
  IRoutingFactor,
  IRoutingAlternative,
  ColdStartPhase,
  ICapabilityMatch,
} from './routing-types.js';
import { DEFAULT_ROUTING_CONFIG } from './routing-types.js';
import { RoutingError } from './routing-errors.js';
import { CapabilityIndex } from './capability-index.js';
import {
  getColdStartPhase,
  getColdStartWeights,
  formatColdStartIndicator,
} from './cold-start-config.js';
import { ObservabilityBus } from '../observability/bus.js';

// ==================== Configuration ====================

/**
 * Configuration for RoutingEngine
 */
export interface IRoutingEngineConfig {
  /** Capability index instance (optional, creates one if not provided) */
  capabilityIndex?: CapabilityIndex;

  /** Routing configuration (optional, uses defaults) */
  routingConfig?: IRoutingConfig;

  /** Enable verbose logging (default: false) */
  verbose?: boolean;
}

// ==================== Routing Engine Implementation ====================

/**
 * Routing engine for intelligent agent selection
 * Implements explainable, deterministic routing with cold start handling
 *
 * @implements IRoutingEngine
 */
export class RoutingEngine implements IRoutingEngine {
  private readonly capabilityIndex: CapabilityIndex;
  private readonly config: IRoutingConfig;
  private readonly verbose: boolean;
  private executionCount: number = 0;

  constructor(config: IRoutingEngineConfig = {}) {
    this.capabilityIndex = config.capabilityIndex ?? new CapabilityIndex({ verbose: config.verbose });
    this.config = config.routingConfig ?? DEFAULT_ROUTING_CONFIG;
    this.verbose = config.verbose ?? false;
  }

  /**
   * Route a task to an agent
   * Per RULE-DAI-003-001: Every routing result must include explanation
   * Per RULE-DAI-003-003: Low confidence (< 0.7) requires confirmation
   * Per RULE-DAI-003-005: NO external LLM calls
   * Per RULE-DAI-003-006: Cold start mode must be explicit
   *
   * @param analysis - Task analysis result
   * @returns Routing result with explanation, factors, and alternatives
   * @throws RoutingError if routing fails
   */
  async route(analysis: ITaskAnalysis): Promise<IRoutingResult> {
    const startTime = performance.now();

    // Implements [REQ-OBS-06]: Emit routing_started event
    ObservabilityBus.getInstance().emit({
      component: 'routing',
      operation: 'routing_started',
      status: 'running',
      metadata: {
        task: analysis.task.substring(0, 100),
        domain: analysis.domain,
        hasPreferredAgent: !!analysis.preferredAgent,
      },
    });

    try {
      // Check for explicit agent preference (bypass routing)
      if (analysis.preferredAgent) {
        return this.createPreferenceResult(analysis, startTime);
      }

      // Get cold start phase and weights
      const coldStartPhase = this.getColdStartPhase();
      const { keywordWeight, capabilityWeight } = getColdStartWeights(
        coldStartPhase,
        this.config.coldStart
      );

      // Search capability index by embedding
      const matches = await this.capabilityIndex.search(analysis.embedding, 10);

      if (matches.length === 0) {
        throw new RoutingError(
          'No matching agents found for task',
          { confidence: 0 }
        );
      }

      // Calculate scores for each match
      const scoredMatches = this.scoreAgents(
        matches,
        analysis,
        keywordWeight,
        capabilityWeight
      );

      // Sort by combined score (descending)
      scoredMatches.sort((a, b) => b.combinedScore - a.combinedScore);

      // Select top match
      const selectedMatch = scoredMatches[0];

      // Implements [REQ-OBS-07]: Emit agent_selected event
      ObservabilityBus.getInstance().emit({
        component: 'routing',
        operation: 'agent_selected',
        status: 'success',
        metadata: {
          selectedAgent: selectedMatch.agentKey,
          selectedAgentName: selectedMatch.name,
          score: selectedMatch.combinedScore,
          candidates: scoredMatches.slice(0, 3).map(m => ({
            agentKey: m.agentKey,
            name: m.name,
            score: m.combinedScore,
          })),
        },
      });

      // Calculate confidence (combined score)
      let confidence = selectedMatch.combinedScore;

      // Cap confidence in cold start mode per RULE-DAI-003-006
      const isColdStart = this.executionCount < this.config.coldStart.learnedThreshold;
      if (isColdStart && confidence > this.config.coldStart.maxColdStartConfidence) {
        confidence = this.config.coldStart.maxColdStartConfidence;
      }

      // Build factors array
      const factors = this.buildFactors(
        selectedMatch,
        keywordWeight,
        capabilityWeight,
        analysis
      );

      // Get primary factor (highest weighted score)
      const primaryFactor = this.getPrimaryFactor(factors);

      // Build explanation
      const explanation = this.buildExplanation(
        selectedMatch,
        confidence,
        primaryFactor,
        coldStartPhase,
        analysis
      );

      // Build alternatives (top 3 excluding selected)
      const alternatives = this.buildAlternatives(scoredMatches.slice(1, 4));

      // Determine confirmation level
      const { requiresConfirmation, confirmationLevel } = this.determineConfirmationLevel(
        confidence
      );

      // Increment execution count
      this.executionCount++;

      const routingTimeMs = performance.now() - startTime;

      // Generate unique routing ID
      const routingId = `route_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const result: IRoutingResult = {
        selectedAgent: selectedMatch.agentKey,
        selectedAgentName: selectedMatch.name,
        confidence,
        usedPreference: false,
        coldStartPhase,
        isColdStart,
        coldStartIndicator: isColdStart
          ? formatColdStartIndicator(coldStartPhase, this.executionCount - 1)
          : undefined,
        factors,
        explanation,
        alternatives,
        requiresConfirmation,
        confirmationLevel,
        routedAt: Date.now(),
        routingTimeMs,
        routingId,
      };

      if (this.verbose) {
        console.log(
          `[RoutingEngine] Routed to ${selectedMatch.name} (confidence: ${confidence.toFixed(2)}) in ${routingTimeMs.toFixed(2)}ms`
        );
      }

      // Implements [REQ-OBS-08]: Emit routing_completed event
      ObservabilityBus.getInstance().emit({
        component: 'routing',
        operation: 'routing_completed',
        status: 'success',
        durationMs: routingTimeMs,
        metadata: {
          routingId,
          selectedAgent: selectedMatch.agentKey,
          confidence,
          requiresConfirmation,
        },
      });

      return result;
    } catch (error) {
      // Implements [REQ-OBS-08]: Emit routing_completed event on error
      ObservabilityBus.getInstance().emit({
        component: 'routing',
        operation: 'routing_completed',
        status: 'error',
        durationMs: performance.now() - startTime,
        metadata: {
          error: (error as Error).message,
        },
      });

      throw new RoutingError(
        `Routing failed: ${error}`,
        { confidence: 0 },
        error as Error
      );
    }
  }

  /**
   * Get current execution count
   *
   * @returns Execution count
   */
  getExecutionCount(): number {
    return this.executionCount;
  }

  /**
   * Get current cold start phase
   *
   * @returns Cold start phase
   */
  getColdStartPhase(): ColdStartPhase {
    return getColdStartPhase(this.executionCount, this.config.coldStart);
  }

  // ==================== Private Helper Methods ====================

  /**
   * Create routing result for explicit agent preference
   * Bypasses normal routing logic when user specifies an agent
   *
   * @param analysis - Task analysis
   * @param startTime - Start time for performance tracking
   * @returns Routing result with preference flag
   */
  private createPreferenceResult(
    analysis: ITaskAnalysis,
    startTime: number
  ): IRoutingResult {
    const coldStartPhase = this.getColdStartPhase();
    const isColdStart = this.executionCount < this.config.coldStart.learnedThreshold;

    // Get agent capability for preferred agent
    const capability = this.capabilityIndex.getCapability(analysis.preferredAgent!);
    const agentName = capability?.name ?? analysis.preferredAgent!;

    const routingTimeMs = performance.now() - startTime;
    const routingId = `route_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Increment execution count
    this.executionCount++;

    const result: IRoutingResult = {
      selectedAgent: analysis.preferredAgent!,
      selectedAgentName: agentName,
      confidence: 1.0, // User preference is always high confidence
      usedPreference: true,
      coldStartPhase,
      isColdStart,
      coldStartIndicator: isColdStart
        ? formatColdStartIndicator(coldStartPhase, this.executionCount - 1)
        : undefined,
      factors: [
        {
          name: 'user_preference',
          weight: 1.0,
          score: 1.0,
          description: 'User explicitly specified this agent',
        },
      ],
      explanation: `Using ${agentName} as explicitly requested by user preference.`,
      alternatives: [],
      requiresConfirmation: false,
      confirmationLevel: 'auto',
      routedAt: Date.now(),
      routingTimeMs,
      routingId,
    };

    if (this.verbose) {
      console.log(
        `[RoutingEngine] Using preferred agent ${agentName} in ${routingTimeMs.toFixed(2)}ms`
      );
    }

    return result;
  }

  /**
   * Score agents by combining capability and keyword matching
   * Uses cold start weights to balance similarity vs keyword matching
   *
   * @param matches - Capability matches from index
   * @param analysis - Task analysis
   * @param keywordWeight - Weight for keyword matching
   * @param capabilityWeight - Weight for capability (embedding) matching
   * @returns Scored matches with combined scores
   */
  private scoreAgents(
    matches: ICapabilityMatch[],
    analysis: ITaskAnalysis,
    keywordWeight: number,
    capabilityWeight: number
  ): ICapabilityMatch[] {
    return matches.map(match => {
      // Calculate keyword score
      const keywordScore = this.calculateKeywordScore(
        match.capability.keywords,
        analysis.verbs,
        analysis.task
      );

      // Check domain match
      const domainMatch = match.capability.domains.includes(analysis.domain);

      // Calculate combined score
      let combinedScore =
        capabilityWeight * match.similarityScore + keywordWeight * keywordScore;

      // Apply domain match bonus (20% for matching domain)
      if (domainMatch) {
        combinedScore *= 1.20;
      }

      // Get historical score (if available)
      const historicalScore = this.getHistoricalScore(match.capability.agentKey);
      if (historicalScore > 0) {
        // Blend historical score (10% weight)
        combinedScore = 0.9 * combinedScore + 0.1 * historicalScore;
      }

      // Ensure score is in [0, 1] range
      combinedScore = Math.min(1.0, Math.max(0.0, combinedScore));

      return {
        ...match,
        keywordScore,
        domainMatch,
        combinedScore,
      };
    });
  }

  /**
   * Calculate keyword matching score
   * Compares task verbs and keywords with agent capabilities
   *
   * @param agentKeywords - Agent capability keywords
   * @param taskVerbs - Task verbs
   * @param taskText - Full task text
   * @returns Keyword score (0-1)
   */
  private calculateKeywordScore(
    agentKeywords: readonly string[],
    taskVerbs: readonly string[],
    taskText: string
  ): number {
    if (agentKeywords.length === 0) {
      return 0;
    }

    const taskWords = taskText
      .toLowerCase()
      .split(/\s+/)
      .map(w => w.replace(/[^a-z0-9]/g, ''))
      .filter(w => w.length >= 3);

    const taskWordSet = new Set([...taskWords, ...taskVerbs.map(v => v.toLowerCase())]);

    // Count keyword matches
    let matchCount = 0;
    for (const keyword of agentKeywords) {
      if (taskWordSet.has(keyword.toLowerCase())) {
        matchCount++;
      }
    }

    // Score is ratio of matched keywords to total task keywords
    // Capped at 1.0
    const score = Math.min(1.0, matchCount / Math.max(1, taskWordSet.size));

    return score;
  }

  /**
   * Get historical success score for agent
   * Placeholder for future learning integration
   *
   * @param _agentKey - Agent key (unused in placeholder)
   * @returns Historical score (0-1) or 0 if no history
   */
  private getHistoricalScore(_agentKey: string): number {
    // Placeholder: will integrate with RoutingLearner in TASK-009
    // For now, return 0 (no historical data)
    return 0;
  }

  /**
   * Build factors array for explanation
   * Per RULE-DAI-003-001: Explanation must include factors
   *
   * @param match - Selected match
   * @param keywordWeight - Keyword weight
   * @param capabilityWeight - Capability weight
   * @param analysis - Task analysis
   * @returns Array of routing factors
   */
  private buildFactors(
    match: ICapabilityMatch,
    keywordWeight: number,
    capabilityWeight: number,
    analysis: ITaskAnalysis
  ): IRoutingFactor[] {
    const factors: IRoutingFactor[] = [
      {
        name: 'capability_match',
        weight: capabilityWeight,
        score: match.similarityScore,
        description: `Semantic similarity between task and agent capabilities`,
      },
      {
        name: 'keyword_score',
        weight: keywordWeight,
        score: match.keywordScore,
        description: `Keyword overlap between task description and agent keywords`,
      },
    ];

    // Add domain match factor if applicable
    if (match.domainMatch) {
      factors.push({
        name: 'domain_match',
        weight: 0.05, // 5% bonus
        score: 1.0,
        description: `Agent specializes in ${analysis.domain} domain`,
      });
    }

    // Add historical factor if available
    const historicalScore = this.getHistoricalScore(match.agentKey);
    if (historicalScore > 0) {
      factors.push({
        name: 'historical_success',
        weight: 0.1,
        score: historicalScore,
        description: `Agent's historical success rate on similar tasks`,
      });
    }

    return factors;
  }

  /**
   * Get primary factor (highest weighted score contribution)
   *
   * @param factors - Routing factors
   * @returns Primary factor
   */
  private getPrimaryFactor(factors: readonly IRoutingFactor[]): IRoutingFactor {
    let primaryFactor = factors[0];
    let maxContribution = primaryFactor.weight * primaryFactor.score;

    for (const factor of factors.slice(1)) {
      const contribution = factor.weight * factor.score;
      if (contribution > maxContribution) {
        maxContribution = contribution;
        primaryFactor = factor;
      }
    }

    return primaryFactor;
  }

  /**
   * Build human-readable explanation of routing decision
   * Per RULE-DAI-003-001: Every result must include explanation
   *
   * @param match - Selected match
   * @param confidence - Final confidence score
   * @param primaryFactor - Primary contributing factor
   * @param coldStartPhase - Current cold start phase
   * @param analysis - Task analysis
   * @returns Explanation string
   */
  private buildExplanation(
    match: ICapabilityMatch,
    confidence: number,
    primaryFactor: IRoutingFactor,
    coldStartPhase: ColdStartPhase,
    analysis: ITaskAnalysis
  ): string {
    const parts: string[] = [];

    // Main routing decision
    parts.push(
      `Selected ${match.name} with ${(confidence * 100).toFixed(0)}% confidence for ${analysis.domain} task.`
    );

    // Primary factor
    parts.push(
      `Primary factor: ${primaryFactor.description} (score: ${(primaryFactor.score * 100).toFixed(0)}%).`
    );

    // Domain match
    if (match.domainMatch) {
      parts.push(`Agent specializes in ${analysis.domain} domain.`);
    }

    // Cold start indicator
    if (coldStartPhase !== 'learned') {
      if (coldStartPhase === 'keyword-only') {
        parts.push(
          `Using keyword-only matching (execution ${this.executionCount}/100 - learning phase).`
        );
      } else {
        parts.push(
          `Blending keyword and capability matching (execution ${this.executionCount}/100 - learning phase).`
        );
      }
    }

    return parts.join(' ');
  }

  /**
   * Build alternatives list
   * Shows up to 3 alternative agents with scores and reasons
   *
   * @param matches - Alternative matches (top 3)
   * @returns Array of routing alternatives
   */
  private buildAlternatives(matches: ICapabilityMatch[]): IRoutingAlternative[] {
    return matches.map(match => ({
      agentKey: match.agentKey,
      name: match.name,
      score: match.combinedScore,
      reason: `Score: ${(match.combinedScore * 100).toFixed(0)}% (capability: ${(match.similarityScore * 100).toFixed(0)}%, keywords: ${(match.keywordScore * 100).toFixed(0)}%)`,
    }));
  }

  /**
   * Determine confirmation level based on confidence
   * Per RULE-DAI-003-003: Low confidence (< 0.7) requires confirmation
   *
   * Thresholds:
   * - >= 0.9: auto (auto-execute)
   * - 0.7-0.9: show (show decision, proceed)
   * - 0.5-0.7: confirm (require confirmation)
   * - < 0.5: select (require selection from top 5)
   *
   * @param confidence - Routing confidence
   * @returns Confirmation level and flag
   */
  private determineConfirmationLevel(confidence: number): {
    requiresConfirmation: boolean;
    confirmationLevel: 'auto' | 'show' | 'confirm' | 'select';
  } {
    if (confidence >= this.config.autoExecuteThreshold) {
      return { requiresConfirmation: false, confirmationLevel: 'auto' };
    } else if (confidence >= this.config.showDecisionThreshold) {
      return { requiresConfirmation: false, confirmationLevel: 'show' };
    } else if (confidence >= this.config.confirmationThreshold) {
      return { requiresConfirmation: true, confirmationLevel: 'confirm' };
    } else {
      return { requiresConfirmation: true, confirmationLevel: 'select' };
    }
  }
}
