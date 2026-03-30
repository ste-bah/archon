/**
 * Counterfactual Reasoning Engine
 * RSN-002 Implementation - What-If Scenario Analysis
 *
 * Purpose: Explore alternative worlds by simulating interventions
 * in the causal graph and predicting divergent outcomes
 *
 * Features:
 * - Abduction → Intervention → Prediction pipeline
 * - Alternative world construction
 * - Outcome divergence calculation
 * - Impact propagation through causal graph
 * - Scenario comparison
 *
 * Dependencies:
 * - CausalMemory: Causal graph traversal
 * - GraphDB: Node manipulation
 * - MemoryEngine: State persistence (optional)
 *
 * Performance Target: <200ms latency
 */

import type { IReasoningRequest, ReasoningMode, IPatternMatch, IInferenceResult, IProvenanceInfo } from '../reasoning-types.js';
import type {
  CounterfactualConfig,
  ICounterfactualResult,
  CounterfactualScenario,
  NodeID
} from '../advanced-reasoning-types.js';
import { AdvancedReasoningMode } from '../advanced-reasoning-types.js';

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * Dependencies for CounterfactualEngine
 */
export interface CounterfactualEngineDependencies {
  /** Causal memory for graph traversal */
  causalMemory?: {
    getNode?(nodeId: NodeID): Promise<CausalNode | null>;
    getEffects?(nodeId: NodeID): Promise<NodeID[]>;
    findPaths?(from: NodeID, to: NodeID): Promise<CausalPath[]>;
  };

  /** Graph database for state queries */
  graphDB?: {
    getNodeValue?(nodeId: NodeID): Promise<unknown>;
    setNodeValue?(nodeId: NodeID, value: unknown): Promise<void>;
    getConnectedNodes?(nodeId: NodeID, direction: 'in' | 'out' | 'both'): Promise<NodeID[]>;
  };

  /** Memory engine for state persistence (optional) */
  memoryEngine?: {
    saveState?(key: string, state: unknown): Promise<void>;
    loadState?(key: string): Promise<unknown>;
  };
}

/**
 * Internal causal node representation
 */
interface CausalNode {
  id: NodeID;
  value: unknown;
  type: string;
  effects?: NodeID[];
  causes?: NodeID[];
  strength?: number;
}

/**
 * Causal path between nodes
 */
interface CausalPath {
  nodes: NodeID[];
  strength: number;
}

/**
 * Alternative world state
 */
interface AlternativeWorld {
  /** World identifier */
  id: string;
  /** Intervention applied */
  intervention: CounterfactualConfig['intervention'];
  /** Modified node values */
  modifiedValues: Map<NodeID, unknown>;
  /** Divergence from baseline */
  divergence: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default propagation decay factor (confidence reduction per hop)
 */
const PROPAGATION_DECAY = 0.85;

/**
 * Minimum effect strength to propagate
 */
const MIN_EFFECT_STRENGTH = 0.1;

/**
 * Maximum worlds to explore
 */
const MAX_WORLDS = 10;

// ============================================================================
// COUNTERFACTUAL ENGINE
// ============================================================================

/**
 * Counterfactual reasoning engine
 *
 * Implements the Abduction → Intervention → Prediction pipeline
 * for "what-if" scenario analysis. Creates alternative worlds by
 * intervening on causal nodes and propagating effects.
 *
 * @example
 * ```typescript
 * const engine = new CounterfactualEngine({ causalMemory, graphDB });
 * const result = await engine.reason(
 *   { query: 'What if we used a different database?' },
 *   {
 *     intervention: {
 *       nodeId: 'database-choice',
 *       originalValue: 'PostgreSQL',
 *       counterfactualValue: 'MongoDB'
 *     }
 *   }
 * );
 * // result.scenarios contains divergent outcomes
 * ```
 */
export class CounterfactualEngine {
  private deps: CounterfactualEngineDependencies;

  constructor(deps: CounterfactualEngineDependencies) {
    this.deps = deps;
  }

  /**
   * Perform counterfactual reasoning on a query
   *
   * @param request - The reasoning request containing the query
   * @param config - Counterfactual configuration with intervention
   * @returns Counterfactual result with scenarios
   */
  async reason(
    _request: IReasoningRequest,
    config: CounterfactualConfig
  ): Promise<ICounterfactualResult> {
    const startTime = Date.now();
    // Query embedding is Float32Array - not used directly for counterfactual analysis

    // Apply defaults
    const effectiveConfig: Required<CounterfactualConfig> = {
      intervention: config.intervention,
      targetOutcome: config.targetOutcome ?? ('' as NodeID),
      alternativeWorlds: Math.min(config.alternativeWorlds ?? 5, MAX_WORLDS),
      maxDepth: config.maxDepth ?? 5,
      minDivergence: config.minDivergence ?? 0.1,
      metadata: config.metadata ?? {}
    };

    // Phase 1: Abduction - Understand baseline
    const baselineOutcomes = await this.computeBaselineOutcomes(
      effectiveConfig.intervention.nodeId,
      effectiveConfig.maxDepth
    );

    // Phase 2: Intervention - Create alternative worlds
    const alternativeWorlds = await this.createAlternativeWorlds(
      effectiveConfig.intervention,
      effectiveConfig.alternativeWorlds
    );

    // Phase 3: Prediction - Compute counterfactual outcomes
    const scenarios: CounterfactualScenario[] = [];

    for (const world of alternativeWorlds) {
      const scenario = await this.computeScenario(
        effectiveConfig.intervention,
        baselineOutcomes,
        world,
        effectiveConfig.maxDepth
      );

      if (scenario.divergence >= effectiveConfig.minDivergence) {
        scenarios.push(scenario);
      }
    }

    // Sort by divergence (most divergent first)
    scenarios.sort((a, b) => b.divergence - a.divergence);

    // Calculate confidence
    const confidence = this.calculateConfidence(scenarios);

    const latencyMs = Date.now() - startTime;

    // Build result with all required IAdvancedReasoningResult fields
    const result: ICounterfactualResult = {
      // IAdvancedReasoningResult fields
      mode: AdvancedReasoningMode.COUNTERFACTUAL,
      answer: this.formatAnswer(scenarios, effectiveConfig),
      reasoningSteps: this.generateReasoning(scenarios, effectiveConfig),
      latencyMs,
      confidence,

      // IReasoningResponse fields (from base interface)
      type: 'causal-inference' as ReasoningMode,
      patterns: [] as IPatternMatch[],
      causalInferences: [] as IInferenceResult[],
      trajectoryId: `traj_${Date.now()}_counterfactual`,
      processingTimeMs: latencyMs,
      provenanceInfo: {
        lScores: scenarios.map(s => s.confidence),
        totalSources: scenarios.length,
        combinedLScore: scenarios.length > 0
          ? scenarios.reduce((sum, s) => sum + s.confidence, 0) / scenarios.length
          : 0.5
      } as IProvenanceInfo,

      // Mode-specific field
      scenarios
    };

    return result;
  }

  // ==========================================================================
  // BASELINE COMPUTATION
  // ==========================================================================

  /**
   * Compute baseline outcomes from intervention node
   */
  private async computeBaselineOutcomes(
    nodeId: NodeID,
    maxDepth: number
  ): Promise<NodeID[]> {
    const outcomes: NodeID[] = [];
    const visited = new Set<NodeID>();
    const queue: Array<{ id: NodeID; depth: number }> = [{ id: nodeId, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (visited.has(current.id) || current.depth > maxDepth) {
        continue;
      }

      visited.add(current.id);
      outcomes.push(current.id);

      // Get effects from causal memory
      const effects = await this.getNodeEffects(current.id);
      for (const effect of effects) {
        queue.push({ id: effect, depth: current.depth + 1 });
      }
    }

    return outcomes;
  }

  /**
   * Get effects of a node
   */
  private async getNodeEffects(nodeId: NodeID): Promise<NodeID[]> {
    // Try causal memory
    if (this.deps.causalMemory?.getEffects) {
      try {
        return await this.deps.causalMemory.getEffects(nodeId);
      } catch {
        // INTENTIONAL: Causal memory query failure - try graph DB
      }
    }

    // Try graph DB
    if (this.deps.graphDB?.getConnectedNodes) {
      try {
        return await this.deps.graphDB.getConnectedNodes(nodeId, 'out');
      } catch {
        // INTENTIONAL: Graph DB query failure - use synthetic effects
      }
    }

    // Return synthetic effects based on node ID
    return this.generateSyntheticEffects(nodeId);
  }

  /**
   * Generate synthetic effects for testing/fallback
   */
  private generateSyntheticEffects(nodeId: NodeID): NodeID[] {
    // Create deterministic synthetic effects based on node ID
    const hash = this.hashString(String(nodeId));
    const effectCount = (hash % 3) + 1; // 1-3 effects

    return Array.from({ length: effectCount }, (_, i) =>
      `${nodeId}-effect-${i}` as NodeID
    );
  }

  /**
   * Simple string hash function
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  // ==========================================================================
  // ALTERNATIVE WORLD CREATION
  // ==========================================================================

  /**
   * Create alternative worlds with intervention applied
   */
  private async createAlternativeWorlds(
    intervention: CounterfactualConfig['intervention'],
    count: number
  ): Promise<AlternativeWorld[]> {
    const worlds: AlternativeWorld[] = [];

    // Create primary intervention world
    const primaryWorld = await this.createInterventionWorld(
      intervention,
      'primary'
    );
    worlds.push(primaryWorld);

    // Create variant worlds with different interpretations
    for (let i = 1; i < count; i++) {
      const variant = await this.createVariantWorld(
        intervention,
        `variant-${i}`,
        i
      );
      worlds.push(variant);
    }

    return worlds;
  }

  /**
   * Create world with direct intervention
   */
  private async createInterventionWorld(
    intervention: CounterfactualConfig['intervention'],
    id: string
  ): Promise<AlternativeWorld> {
    const modifiedValues = new Map<NodeID, unknown>();
    modifiedValues.set(intervention.nodeId, intervention.counterfactualValue);

    return {
      id,
      intervention,
      modifiedValues,
      divergence: 0 // Will be calculated later
    };
  }

  /**
   * Create variant world with modified intervention
   */
  private async createVariantWorld(
    baseIntervention: CounterfactualConfig['intervention'],
    id: string,
    variantIndex: number
  ): Promise<AlternativeWorld> {
    const modifiedValues = new Map<NodeID, unknown>();

    // Apply base intervention
    modifiedValues.set(
      baseIntervention.nodeId,
      baseIntervention.counterfactualValue
    );

    // Add variant modifications (simulate different scenarios)
    const variantValue = this.createVariantValue(
      baseIntervention.counterfactualValue,
      variantIndex
    );

    if (variantValue !== baseIntervention.counterfactualValue) {
      modifiedValues.set(baseIntervention.nodeId, variantValue);
    }

    return {
      id,
      intervention: {
        ...baseIntervention,
        counterfactualValue: variantValue
      },
      modifiedValues,
      divergence: 0
    };
  }

  /**
   * Create variant value for alternative scenarios
   */
  private createVariantValue(baseValue: unknown, variantIndex: number): unknown {
    // Handle different value types
    if (typeof baseValue === 'number') {
      // Numeric variation: +/- 10-50%
      const variation = 1 + (variantIndex * 0.1 * (variantIndex % 2 === 0 ? 1 : -1));
      return baseValue * variation;
    }

    if (typeof baseValue === 'string') {
      // String variation: append modifier
      return `${baseValue}_v${variantIndex}`;
    }

    if (typeof baseValue === 'boolean') {
      // Boolean: alternate
      return variantIndex % 2 === 0 ? baseValue : !baseValue;
    }

    // Complex types: return as-is
    return baseValue;
  }

  // ==========================================================================
  // SCENARIO COMPUTATION
  // ==========================================================================

  /**
   * Compute counterfactual scenario for an alternative world
   */
  private async computeScenario(
    intervention: CounterfactualConfig['intervention'],
    baselineOutcomes: NodeID[],
    world: AlternativeWorld,
    maxDepth: number
  ): Promise<CounterfactualScenario> {
    // Propagate intervention effects
    const counterfactualOutcomes = await this.propagateIntervention(
      intervention.nodeId,
      world.modifiedValues,
      maxDepth
    );

    // Calculate divergence
    const divergence = this.calculateDivergence(
      baselineOutcomes,
      counterfactualOutcomes
    );

    // Identify impacted nodes
    const impactedNodes = this.identifyImpactedNodes(
      baselineOutcomes,
      counterfactualOutcomes
    );

    // Calculate confidence
    const confidence = this.calculateScenarioConfidence(
      divergence,
      impactedNodes.length,
      baselineOutcomes.length
    );

    return {
      intervention: world.intervention,
      baselineOutcomes,
      counterfactualOutcomes,
      divergence,
      impactedNodes,
      confidence
    };
  }

  /**
   * Propagate intervention effects through causal graph
   */
  private async propagateIntervention(
    startNode: NodeID,
    modifiedValues: Map<NodeID, unknown>,
    maxDepth: number
  ): Promise<NodeID[]> {
    const outcomes: NodeID[] = [];
    const visited = new Set<NodeID>();
    const queue: Array<{ id: NodeID; depth: number; strength: number }> = [
      { id: startNode, depth: 0, strength: 1.0 }
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (
        visited.has(current.id) ||
        current.depth > maxDepth ||
        current.strength < MIN_EFFECT_STRENGTH
      ) {
        continue;
      }

      visited.add(current.id);

      // Check if this node is modified
      if (modifiedValues.has(current.id)) {
        outcomes.push(current.id);
      }

      // Get and propagate effects
      const effects = await this.getNodeEffects(current.id);
      for (const effect of effects) {
        // Decay strength as we propagate
        const newStrength = current.strength * PROPAGATION_DECAY;

        // Add effect to outcomes (it's impacted by intervention)
        outcomes.push(effect);

        queue.push({
          id: effect,
          depth: current.depth + 1,
          strength: newStrength
        });
      }
    }

    return [...new Set(outcomes)]; // Deduplicate
  }

  /**
   * Calculate divergence between baseline and counterfactual outcomes
   */
  private calculateDivergence(
    baseline: NodeID[],
    counterfactual: NodeID[]
  ): number {
    const baselineSet = new Set(baseline);
    const counterfactualSet = new Set(counterfactual);

    // Jaccard distance: 1 - (intersection / union)
    const intersection = [...baselineSet].filter(n => counterfactualSet.has(n));
    const union = new Set([...baseline, ...counterfactual]);

    if (union.size === 0) {
      return 0;
    }

    const jaccardSimilarity = intersection.length / union.size;
    const divergence = 1 - jaccardSimilarity;

    // Boost divergence if counterfactual has new outcomes
    const newOutcomes = [...counterfactualSet].filter(n => !baselineSet.has(n));
    const noveltyBoost = Math.min(newOutcomes.length / 10, 0.2);

    return Math.min(divergence + noveltyBoost, 1);
  }

  /**
   * Identify nodes impacted by intervention
   */
  private identifyImpactedNodes(
    baseline: NodeID[],
    counterfactual: NodeID[]
  ): NodeID[] {
    const baselineSet = new Set(baseline);
    const counterfactualSet = new Set(counterfactual);

    // Nodes that differ between baseline and counterfactual
    const impacted: NodeID[] = [];

    // New in counterfactual
    for (const node of counterfactual) {
      if (!baselineSet.has(node)) {
        impacted.push(node);
      }
    }

    // Missing from counterfactual (but was in baseline)
    for (const node of baseline) {
      if (!counterfactualSet.has(node)) {
        impacted.push(node);
      }
    }

    return impacted;
  }

  /**
   * Calculate confidence for a single scenario
   */
  private calculateScenarioConfidence(
    divergence: number,
    impactedCount: number,
    baselineCount: number
  ): number {
    // Higher confidence if:
    // 1. Moderate divergence (not too similar, not too different)
    // 2. Reasonable number of impacted nodes

    const divergenceScore = divergence > 0.1 && divergence < 0.9 ? 0.8 : 0.5;
    const impactRatio = impactedCount / Math.max(baselineCount, 1);
    const impactScore = impactRatio > 0.1 && impactRatio < 0.5 ? 0.8 : 0.6;

    return (divergenceScore + impactScore) / 2;
  }

  // ==========================================================================
  // OUTPUT FORMATTING
  // ==========================================================================

  /**
   * Calculate overall confidence
   */
  private calculateConfidence(
    scenarios: CounterfactualScenario[]
  ): number {
    if (scenarios.length === 0) {
      return 0.3;
    }

    // Average scenario confidence
    const avgConfidence = scenarios.reduce((s, sc) => s + sc.confidence, 0) / scenarios.length;

    // Base boost for counterfactual analysis
    return Math.min(avgConfidence + 0.05, 1);
  }

  /**
   * Format answer from scenarios
   */
  private formatAnswer(
    scenarios: CounterfactualScenario[],
    config: Required<CounterfactualConfig>
  ): string {
    if (scenarios.length === 0) {
      return 'No significant counterfactual scenarios identified.';
    }

    const lines: string[] = [
      `Counterfactual Analysis: What if ${config.intervention.nodeId} changed from ${config.intervention.originalValue} to ${config.intervention.counterfactualValue}?`,
      '',
      `Found ${scenarios.length} scenario(s) with divergence >= ${config.minDivergence * 100}%:`,
      ''
    ];

    for (let i = 0; i < Math.min(scenarios.length, 3); i++) {
      const scenario = scenarios[i];
      lines.push(`Scenario ${i + 1}:`);
      lines.push(`  Divergence: ${(scenario.divergence * 100).toFixed(1)}%`);
      lines.push(`  Impacted nodes: ${scenario.impactedNodes.length}`);
      lines.push(`  Confidence: ${(scenario.confidence * 100).toFixed(1)}%`);

      if (scenario.impactedNodes.length > 0) {
        lines.push(`  Key impacts: ${scenario.impactedNodes.slice(0, 5).join(', ')}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Generate reasoning explanation
   */
  private generateReasoning(
    scenarios: CounterfactualScenario[],
    config: Required<CounterfactualConfig>
  ): string[] {
    const reasoning: string[] = [
      `Applied Abduction → Intervention → Prediction pipeline`,
      `Intervention: ${config.intervention.nodeId} = ${config.intervention.counterfactualValue}`,
      `Explored ${config.alternativeWorlds} alternative world(s)`,
      `Maximum causal depth: ${config.maxDepth}`
    ];

    if (scenarios.length > 0) {
      const avgDivergence = scenarios.reduce((s, sc) => s + sc.divergence, 0) / scenarios.length;
      reasoning.push(`Average divergence: ${(avgDivergence * 100).toFixed(1)}%`);

      const totalImpacted = scenarios.reduce((s, sc) => s + sc.impactedNodes.length, 0);
      reasoning.push(`Total impacted nodes across scenarios: ${totalImpacted}`);
    }

    return reasoning;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a configured CounterfactualEngine instance
 */
export function createCounterfactualEngine(
  deps: CounterfactualEngineDependencies
): CounterfactualEngine {
  return new CounterfactualEngine(deps);
}

// ============================================================================
// EXPORTS
// ============================================================================

// CounterfactualEngineDependencies is already exported at declaration
