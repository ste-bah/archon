/**
 * Attention Mechanism Selector
 * TASK-ATT-001 - Attention Factory Auto-Selection
 *
 * Rule-based selection engine for optimal attention mechanism:
 * - Decision tree based on data profile
 * - <1ms selection overhead (p95)
 * - Fallback chain for reliability
 * - Confidence scoring
 */

import {
  type IDataProfile,
  type ISelectionResult,
  type ISelectionThresholds,
  type ISelectionMetrics,
  type IAttentionMechanism,
  DEFAULT_SELECTION_THRESHOLDS,
  AttentionError,
  hashDataProfile,
} from './attention-types.js';

import { AttentionMechanismRegistry } from './attention-registry.js';

// ==================== Selector Class ====================

/**
 * Rule-based attention mechanism selector
 */
export class AttentionSelector {
  private registry: AttentionMechanismRegistry;
  private thresholds: ISelectionThresholds;
  private verbose: boolean;
  private metricsCallback?: (metrics: ISelectionMetrics) => void;

  constructor(
    registry: AttentionMechanismRegistry,
    thresholds: Partial<ISelectionThresholds> = {},
    options: { verbose?: boolean; metricsCallback?: (metrics: ISelectionMetrics) => void } = {}
  ) {
    this.registry = registry;
    this.thresholds = { ...DEFAULT_SELECTION_THRESHOLDS, ...thresholds };
    this.verbose = options.verbose ?? false;
    this.metricsCallback = options.metricsCallback;
  }

  /**
   * Select optimal attention mechanism for given data profile
   */
  select(profile: IDataProfile): ISelectionResult {
    const startTime = performance.now();

    // Decision tree for mechanism selection
    let selected: ISelectionResult;

    // Rule 1: Very long sequences → Flash attention (for memory efficiency)
    if (profile.sequenceLength > this.thresholds.longSequenceThreshold) {
      selected = {
        mechanismName: 'flash',
        rationale: `Sequence length ${profile.sequenceLength} >${this.thresholds.longSequenceThreshold} → Flash attention for memory efficiency`,
        confidence: 0.95,
        fallbackChain: ['linear', 'standard'],
      };
    }
    // Rule 2: Hierarchy + Graph → DualSpace (check combined features before individual)
    else if (profile.hierarchyDepth > this.thresholds.dualSpaceHierarchyThreshold && profile.hasGraphStructure) {
      selected = {
        mechanismName: 'dual-space',
        rationale: `Hierarchy depth ${profile.hierarchyDepth} + graph structure → DualSpace for mixed encoding`,
        confidence: 0.88,
        fallbackChain: ['hyperbolic', 'graph-rope', 'standard'],
      };
    }
    // Rule 3: Deep hierarchy → Hyperbolic attention
    else if (profile.hierarchyDepth > this.thresholds.hierarchyDepthThreshold) {
      selected = {
        mechanismName: 'hyperbolic',
        rationale: `Hierarchy depth ${profile.hierarchyDepth} >${this.thresholds.hierarchyDepthThreshold} → Hyperbolic attention for tree structure`,
        confidence: 0.90,
        fallbackChain: ['standard'],
      };
    }
    // Rule 4: Graph structure → GraphRoPe
    else if (profile.hasGraphStructure) {
      selected = {
        mechanismName: 'graph-rope',
        rationale: 'Graph structure detected → GraphRoPe for connectivity encoding',
        confidence: 0.85,
        fallbackChain: ['standard'],
      };
    }
    // Rule 5: Strict latency budget → Linear attention
    else if (profile.latencyBudget < this.thresholds.strictLatencyThreshold) {
      selected = {
        mechanismName: 'linear',
        rationale: `Latency budget ${profile.latencyBudget}ms <${this.thresholds.strictLatencyThreshold}ms → Linear attention for speed`,
        confidence: 0.80,
        fallbackChain: ['standard'],
      };
    }
    // Rule 6: Medium-long sequences with sparsity → BigBird
    else if (
      profile.sequenceLength > this.thresholds.mediumSequenceThreshold &&
      (profile.sparsity ?? 0) > this.thresholds.sparsityThreshold
    ) {
      selected = {
        mechanismName: 'bigbird',
        rationale: `Sequence ${profile.sequenceLength} + sparsity ${profile.sparsity?.toFixed(2)} → BigBird for sparse attention`,
        confidence: 0.82,
        fallbackChain: ['longformer', 'linear', 'standard'],
      };
    }
    // Rule 7: Medium sequences → Longformer
    else if (profile.sequenceLength > this.thresholds.mediumSequenceThreshold) {
      selected = {
        mechanismName: 'longformer',
        rationale: `Sequence length ${profile.sequenceLength} >${this.thresholds.mediumSequenceThreshold} → Longformer for efficient long context`,
        confidence: 0.78,
        fallbackChain: ['linear', 'standard'],
      };
    }
    // Default: Standard attention
    else {
      selected = {
        mechanismName: 'standard',
        rationale: 'No special characteristics detected → Standard multi-head attention',
        confidence: 0.70,
        fallbackChain: [],
      };
    }

    const durationMs = performance.now() - startTime;

    // Performance warning
    if (durationMs > 1.0 && this.verbose) {
      console.warn(`[Selector] Selection took ${durationMs.toFixed(2)}ms (target: <1ms)`);
    }

    // Emit metrics
    this.emitMetrics({
      operation: 'select_mechanism',
      selected: selected.mechanismName,
      confidence: selected.confidence,
      durationMs,
      profileHash: hashDataProfile(profile),
      timestamp: Date.now(),
    });

    if (this.verbose) {
      console.log(`[Selector] Selected: ${selected.mechanismName} (${selected.rationale})`);
    }

    return selected;
  }

  /**
   * Attempt to create mechanism with fallback handling
   */
  createWithFallback(
    selection: ISelectionResult,
    config?: Record<string, unknown>
  ): IAttentionMechanism {
    const attemptChain = [selection.mechanismName, ...selection.fallbackChain];

    for (const mechanismName of attemptChain) {
      try {
        const descriptor = this.registry.get(mechanismName);
        if (!descriptor) {
          if (this.verbose) {
            console.warn(`[Selector] Unknown mechanism: ${mechanismName}`);
          }
          continue;
        }

        const mechanism = descriptor.factory(config);

        if (this.verbose) {
          console.log(`[Selector] Created mechanism: ${mechanismName}`);
        }

        // Emit fallback metric if not primary selection
        if (mechanismName !== selection.mechanismName) {
          this.emitMetrics({
            operation: 'fallback_used',
            selected: mechanismName,
            confidence: selection.confidence * 0.8, // Reduced confidence for fallback
            durationMs: 0,
            profileHash: '',
            timestamp: Date.now(),
          });
        }

        return mechanism;

      } catch (error) {
        if (this.verbose) {
          console.warn(`[Selector] Failed to create ${mechanismName}:`, error);
        }
        continue;
      }
    }

    // Ultimate fallback: standard attention (should never fail)
    if (this.verbose) {
      console.error('[Selector] All fallbacks failed, using standard attention');
    }

    const standardDescriptor = this.registry.get('standard');
    if (!standardDescriptor) {
      throw new AttentionError(
        'Critical: Standard attention mechanism not registered',
        'CREATION_FAILED'
      );
    }

    return standardDescriptor.factory(config);
  }

  /**
   * Emit metrics for observability
   */
  private emitMetrics(metrics: ISelectionMetrics): void {
    if (this.metricsCallback) {
      this.metricsCallback(metrics);
    }
  }

  /**
   * Get current selection thresholds
   */
  getThresholds(): ISelectionThresholds {
    return { ...this.thresholds };
  }

  /**
   * Update selection thresholds
   */
  setThresholds(thresholds: Partial<ISelectionThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }

  /**
   * Set metrics callback
   */
  setMetricsCallback(callback: (metrics: ISelectionMetrics) => void): void {
    this.metricsCallback = callback;
  }
}
