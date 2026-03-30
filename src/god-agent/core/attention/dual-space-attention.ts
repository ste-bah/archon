/**
 * DualSpace Attention
 * TASK-ATT-001 - Attention Factory Auto-Selection
 *
 * Combines hyperbolic + graph attention for mixed workloads:
 * - Hyperbolic attention for hierarchical structure
 * - GraphRoPe for graph connectivity
 * - Adaptive weighting based on data characteristics
 *
 * Used when: hierarchyDepth >2 AND hasGraphStructure = true
 */

import type { IAttentionMechanism } from './attention-types.js';
import { RealHyperbolicAttention } from './mechanisms/hyperbolic-attention.js';
import { RealGraphRoPeAttention } from './mechanisms/graph-rope-attention.js';

// ==================== DualSpace Attention ====================

/**
 * DualSpace attention: combines hyperbolic + graph attention
 */
export class DualSpaceAttention implements IAttentionMechanism {
  readonly name = 'dual-space';

  private hyperbolicAttention: IAttentionMechanism;
  private graphAttention: IAttentionMechanism;
  private alpha: number; // Mixing weight (0-1): 0=all graph, 1=all hyperbolic

  constructor(config?: {
    hyperbolicConfig?: Record<string, unknown>;
    graphConfig?: Record<string, unknown>;
    mixingWeight?: number;
  }) {
    // Create component mechanisms using Real* implementations
    this.hyperbolicAttention = new RealHyperbolicAttention(config?.hyperbolicConfig);
    this.graphAttention = new RealGraphRoPeAttention(config?.graphConfig);

    // Mixing weight: how much to weight hyperbolic vs graph
    // Default 0.5 = equal weight
    this.alpha = config?.mixingWeight ?? 0.5;

    // Validate mixing weight
    if (this.alpha < 0 || this.alpha > 1) {
      throw new Error(`Invalid mixing weight: ${this.alpha} (must be 0-1)`);
    }
  }

  /**
   * Forward pass: combine hyperbolic and graph attention outputs
   */
  forward(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    mask?: boolean[]
  ): Float32Array {
    // Run both attention mechanisms
    const hyperbolicOutput = this.hyperbolicAttention.forward(query, key, value, mask);
    const graphOutput = this.graphAttention.forward(query, key, value, mask);

    // Weighted combination
    const combined = new Float32Array(hyperbolicOutput.length);
    for (let i = 0; i < combined.length; i++) {
      combined[i] = this.alpha * hyperbolicOutput[i] + (1 - this.alpha) * graphOutput[i];
    }

    return combined;
  }

  /**
   * Get total parameter count from both mechanisms
   */
  getParameterCount(): number {
    return this.hyperbolicAttention.getParameterCount() +
           this.graphAttention.getParameterCount();
  }

  /**
   * Get current mixing weight
   */
  getMixingWeight(): number {
    return this.alpha;
  }

  /**
   * Set mixing weight
   * @param alpha Weight for hyperbolic attention (0-1)
   *              0 = all graph attention
   *              1 = all hyperbolic attention
   *              0.5 = equal mix
   */
  setMixingWeight(alpha: number): void {
    if (alpha < 0 || alpha > 1) {
      throw new Error(`Invalid mixing weight: ${alpha} (must be 0-1)`);
    }
    this.alpha = alpha;
  }

  /**
   * Adaptively adjust mixing weight based on data characteristics
   */
  adaptMixingWeight(hierarchyScore: number, graphScore: number): void {
    // Higher hierarchy score → more hyperbolic attention
    // Higher graph score → more graph attention
    const total = hierarchyScore + graphScore;
    if (total > 0) {
      this.alpha = hierarchyScore / total;
    } else {
      this.alpha = 0.5; // Default to equal if no scores
    }
  }

  /**
   * Get component mechanisms for inspection
   */
  getComponents(): { hyperbolic: IAttentionMechanism; graph: IAttentionMechanism } {
    return {
      hyperbolic: this.hyperbolicAttention,
      graph: this.graphAttention,
    };
  }
}
