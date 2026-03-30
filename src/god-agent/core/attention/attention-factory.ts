/**
 * Attention Factory
 * TASK-ATT-001 - Attention Factory Auto-Selection
 *
 * Main public API for automatic attention mechanism selection:
 * - Auto-select based on IDataProfile
 * - Manual creation by name
 * - Registry inspection
 * - Performance tracking
 *
 * Target: <1ms selection overhead, 95%+ correct selection
 */

import {
  type IDataProfile,
  type IAttentionMechanism,
  type ISelectionResult,
  type ISelectionThresholds,
  type IAttentionConfig,
  type ISelectionMetrics,
  DEFAULT_ATTENTION_CONFIG,
  AttentionError,
} from './attention-types.js';

import { AttentionMechanismRegistry } from './attention-registry.js';
import { AttentionSelector } from './attention-selector.js';
import { DualSpaceAttention } from './dual-space-attention.js';

// ==================== Factory Class ====================

/**
 * Main attention factory - public API
 */
export class AttentionFactory {
  private registry: AttentionMechanismRegistry;
  private selector: AttentionSelector;
  private config: Required<IAttentionConfig>;

  constructor(config: IAttentionConfig = {}) {
    this.config = {
      ...DEFAULT_ATTENTION_CONFIG,
      ...config,
      thresholds: {
        ...DEFAULT_ATTENTION_CONFIG.thresholds,
        ...(config.thresholds ?? {}),
      },
    };

    this.registry = new AttentionMechanismRegistry();
    this.selector = new AttentionSelector(
      this.registry,
      this.config.thresholds,
      { verbose: this.config.verbose }
    );

    // Register DualSpace attention mechanism
    this.registerDualSpace();
  }

  /**
   * Register DualSpace attention in the registry
   */
  private registerDualSpace(): void {
    const mixingWeight = this.config.dualSpaceMixingWeight;

    this.registry.register({
      name: 'dual-space',
      displayName: 'DualSpace Attention',
      description: 'Combines hyperbolic + graph attention for mixed workloads',
      capabilities: {
        supportsLongContext: false,
        supportsHierarchy: true,
        supportsGraphs: true,
        supportsSparsity: false,
        requiresPrecomputation: true,
      },
      performance: {
        complexity: 'O(N²)' as any,
        avgLatencyMs: 8.0,
        memoryUsageMB: 150,
        parallelizable: true,
      },
      fallbacks: ['hyperbolic', 'graph-rope', 'standard'],
      factory: (config) => new DualSpaceAttention({
        ...config,
        mixingWeight: (config?.mixingWeight as number | undefined) ?? mixingWeight,
      }),
    });
  }

  // ==================== Auto-Selection API ====================

  /**
   * Auto-select and create attention mechanism from data profile
   */
  createFromProfile(
    profile: IDataProfile,
    config?: Record<string, unknown>
  ): IAttentionMechanism {
    const selection = this.selector.select(profile);

    if (this.config.verbose) {
      console.log(`[Factory] Selected: ${selection.mechanismName} (${selection.rationale})`);
    }

    return this.selector.createWithFallback(selection, config);
  }

  /**
   * Get selection result without creating mechanism
   */
  analyzeProfile(profile: IDataProfile): ISelectionResult {
    return this.selector.select(profile);
  }

  // ==================== Manual Selection API ====================

  /**
   * Create specific mechanism by name (manual selection)
   */
  create(name: string, config?: Record<string, unknown>): IAttentionMechanism {
    const descriptor = this.registry.get(name);
    if (!descriptor) {
      throw new AttentionError(`Unknown attention mechanism: ${name}`, 'UNKNOWN_MECHANISM');
    }
    return descriptor.factory(config);
  }

  /**
   * Check if mechanism exists
   */
  hasMechanism(name: string): boolean {
    return this.registry.has(name);
  }

  // ==================== Registry Inspection ====================

  /**
   * List all available mechanism names
   */
  listMechanisms(): string[] {
    return this.registry.list();
  }

  /**
   * Get mechanism count
   */
  getMechanismCount(): number {
    return this.registry.size;
  }

  /**
   * Get registry for advanced inspection
   */
  getRegistry(): AttentionMechanismRegistry {
    return this.registry;
  }

  /**
   * Get selector for testing/customization
   */
  getSelector(): AttentionSelector {
    return this.selector;
  }

  // ==================== Configuration ====================

  /**
   * Get current selection thresholds
   */
  getThresholds(): ISelectionThresholds {
    return this.selector.getThresholds();
  }

  /**
   * Update selection thresholds
   */
  setThresholds(thresholds: Partial<ISelectionThresholds>): void {
    this.selector.setThresholds(thresholds);
  }

  /**
   * Set metrics callback for observability
   */
  setMetricsCallback(callback: (metrics: ISelectionMetrics) => void): void {
    this.selector.setMetricsCallback(callback);
  }

  // ==================== Convenience Methods ====================

  /**
   * Find mechanisms that support long context
   */
  findLongContextMechanisms(): string[] {
    return this.registry.findLongContextMechanisms().map(m => m.name);
  }

  /**
   * Find mechanisms that support hierarchy
   */
  findHierarchyMechanisms(): string[] {
    return this.registry.findHierarchyMechanisms().map(m => m.name);
  }

  /**
   * Find mechanisms that support graphs
   */
  findGraphMechanisms(): string[] {
    return this.registry.findGraphMechanisms().map(m => m.name);
  }

  /**
   * Create DualSpace attention with specific mixing weight
   */
  createDualSpace(mixingWeight?: number, config?: Record<string, unknown>): DualSpaceAttention {
    return new DualSpaceAttention({
      ...config,
      mixingWeight: mixingWeight ?? this.config.dualSpaceMixingWeight,
    });
  }
}
