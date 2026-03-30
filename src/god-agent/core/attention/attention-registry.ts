/**
 * Attention Mechanism Registry
 * TASK-ATT-001 - Attention Factory Auto-Selection
 *
 * Central registry of 39+ attention mechanisms with:
 * - Capability metadata
 * - Performance profiles
 * - Fallback chains
 * - Factory functions
 */

import {
  ComplexityClass,
  type IAttentionCapabilities,
  type IPerformanceProfile,
  type IAttentionMechanismDescriptor,
  type IAttentionMechanism,
} from './attention-types.js';

import { MECHANISM_CONSTRUCTORS } from './attention-mechanisms.js';

// ==================== Registry Class ====================

/**
 * Central registry of all available attention mechanisms
 */
export class AttentionMechanismRegistry {
  private mechanisms: Map<string, IAttentionMechanismDescriptor> = new Map();

  constructor() {
    this.registerBuiltInMechanisms();
  }

  /**
   * Register all built-in mechanisms (39+ total)
   */
  private registerBuiltInMechanisms(): void {
    // === EFFICIENCY MECHANISMS ===

    this.register({
      name: 'flash',
      displayName: 'Flash Attention',
      description: 'IO-aware exact attention with O(N) memory complexity',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.QUADRATIC,
        avgLatencyMs: 2.5,
        memoryUsageMB: 50,
        parallelizable: true,
      },
      fallbacks: ['linear', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['flash'](config),
    });

    this.register({
      name: 'linear',
      displayName: 'Linear Attention',
      description: 'Linear complexity attention via kernel approximation',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.LINEAR,
        avgLatencyMs: 0.8,
        memoryUsageMB: 30,
        parallelizable: true,
      },
      fallbacks: ['standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['linear'](config),
    });

    this.register({
      name: 'performer',
      displayName: 'Performer',
      description: 'FAVOR+ kernel method for linear attention',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.LINEAR,
        avgLatencyMs: 1.2,
        memoryUsageMB: 35,
        parallelizable: true,
      },
      fallbacks: ['linear', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['performer'](config),
    });

    this.register({
      name: 'linformer',
      displayName: 'Linformer',
      description: 'Low-rank self-attention with linear complexity',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: true,
      },
      performance: {
        complexity: ComplexityClass.LINEAR,
        avgLatencyMs: 1.0,
        memoryUsageMB: 32,
        parallelizable: true,
      },
      fallbacks: ['performer', 'linear', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['linformer'](config),
    });

    this.register({
      name: 'reformer',
      displayName: 'Reformer',
      description: 'Locality-sensitive hashing for efficient attention',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: true,
        requiresPrecomputation: true,
      },
      performance: {
        complexity: ComplexityClass.LINEARITHMIC,
        avgLatencyMs: 2.0,
        memoryUsageMB: 45,
        parallelizable: true,
      },
      fallbacks: ['performer', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['reformer'](config),
    });

    // === STRUCTURE-AWARE MECHANISMS ===

    this.register({
      name: 'hyperbolic',
      displayName: 'Hyperbolic Attention',
      description: 'Attention in hyperbolic space for hierarchical data',
      capabilities: {
        supportsLongContext: false,
        supportsHierarchy: true,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: true,
      },
      performance: {
        complexity: ComplexityClass.QUADRATIC,
        avgLatencyMs: 5.0,
        memoryUsageMB: 80,
        parallelizable: true,
      },
      fallbacks: ['standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['hyperbolic'](config),
    });

    this.register({
      name: 'graph-rope',
      displayName: 'GraphRoPe',
      description: 'Rotary position embeddings extended to graphs',
      capabilities: {
        supportsLongContext: false,
        supportsHierarchy: false,
        supportsGraphs: true,
        supportsSparsity: true,
        requiresPrecomputation: true,
      },
      performance: {
        complexity: ComplexityClass.QUADRATIC,
        avgLatencyMs: 4.2,
        memoryUsageMB: 70,
        parallelizable: true,
      },
      fallbacks: ['standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['graph-rope'](config),
    });

    // === SPARSE/STRUCTURED MECHANISMS ===

    this.register({
      name: 'bigbird',
      displayName: 'BigBird',
      description: 'Sparse attention with random, window, and global tokens',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: true,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.LINEAR,
        avgLatencyMs: 3.5,
        memoryUsageMB: 60,
        parallelizable: true,
      },
      fallbacks: ['linear', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['bigbird'](config),
    });

    this.register({
      name: 'longformer',
      displayName: 'Longformer',
      description: 'Sliding window + global attention for long documents',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: true,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.LINEAR,
        avgLatencyMs: 3.0,
        memoryUsageMB: 55,
        parallelizable: true,
      },
      fallbacks: ['bigbird', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['longformer'](config),
    });

    this.register({
      name: 'sparse-transformer',
      displayName: 'Sparse Transformer',
      description: 'Fixed sparse attention patterns',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: true,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.SUBQUADRATIC,
        avgLatencyMs: 2.8,
        memoryUsageMB: 50,
        parallelizable: true,
      },
      fallbacks: ['longformer', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['sparse-transformer'](config),
    });

    // === MEMORY-BASED MECHANISMS ===

    this.register({
      name: 'memory-compressed',
      displayName: 'Memory Compressed Attention',
      description: 'Attention with memory compression for efficiency',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: true,
      },
      performance: {
        complexity: ComplexityClass.LINEAR,
        avgLatencyMs: 2.2,
        memoryUsageMB: 40,
        parallelizable: true,
      },
      fallbacks: ['linear', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['memory-compressed'](config),
    });

    this.register({
      name: 'routing-transformer',
      displayName: 'Routing Transformer',
      description: 'Content-based routing for efficient attention',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: true,
        requiresPrecomputation: true,
      },
      performance: {
        complexity: ComplexityClass.SUBQUADRATIC,
        avgLatencyMs: 3.2,
        memoryUsageMB: 55,
        parallelizable: true,
      },
      fallbacks: ['reformer', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['routing-transformer'](config),
    });

    this.register({
      name: 'clustered',
      displayName: 'Clustered Attention',
      description: 'Cluster-based attention approximation',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: true,
        requiresPrecomputation: true,
      },
      performance: {
        complexity: ComplexityClass.LINEAR,
        avgLatencyMs: 2.5,
        memoryUsageMB: 45,
        parallelizable: true,
      },
      fallbacks: ['memory-compressed', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['clustered'](config),
    });

    this.register({
      name: 'set-transformer',
      displayName: 'Set Transformer',
      description: 'Attention for permutation-invariant sets',
      capabilities: {
        supportsLongContext: false,
        supportsHierarchy: false,
        supportsGraphs: true,
        supportsSparsity: false,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.QUADRATIC,
        avgLatencyMs: 3.0,
        memoryUsageMB: 60,
        parallelizable: true,
      },
      fallbacks: ['standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['set-transformer'](config),
    });

    // === DOMAIN-SPECIFIC MECHANISMS ===

    this.register({
      name: 'retentive',
      displayName: 'Retentive Network',
      description: 'Retention-based attention for recurrence',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.LINEAR,
        avgLatencyMs: 1.5,
        memoryUsageMB: 35,
        parallelizable: true,
      },
      fallbacks: ['linear', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['retentive'](config),
    });

    this.register({
      name: 'differential',
      displayName: 'Differential Transformer',
      description: 'Differential attention mechanism',
      capabilities: {
        supportsLongContext: false,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.QUADRATIC,
        avgLatencyMs: 3.5,
        memoryUsageMB: 65,
        parallelizable: true,
      },
      fallbacks: ['standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['differential'](config),
    });

    this.register({
      name: 'hyena',
      displayName: 'Hyena',
      description: 'Subquadratic attention via implicit convolutions',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: true,
      },
      performance: {
        complexity: ComplexityClass.SUBQUADRATIC,
        avgLatencyMs: 1.8,
        memoryUsageMB: 40,
        parallelizable: true,
      },
      fallbacks: ['linear', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['hyena'](config),
    });

    this.register({
      name: 'mamba',
      displayName: 'Mamba',
      description: 'State space model for sequence modeling',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.LINEAR,
        avgLatencyMs: 1.2,
        memoryUsageMB: 30,
        parallelizable: true,
      },
      fallbacks: ['linear', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['mamba'](config),
    });

    this.register({
      name: 'rwkv',
      displayName: 'RWKV',
      description: 'Receptance Weighted Key Value attention',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.LINEAR,
        avgLatencyMs: 1.0,
        memoryUsageMB: 28,
        parallelizable: true,
      },
      fallbacks: ['mamba', 'linear', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['rwkv'](config),
    });

    // === STANDARD BASELINE ===

    this.register({
      name: 'standard',
      displayName: 'Standard Multi-Head Attention',
      description: 'Classic scaled dot-product attention (Vaswani et al. 2017)',
      capabilities: {
        supportsLongContext: false,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.QUADRATIC,
        avgLatencyMs: 3.0,
        memoryUsageMB: 200,
        parallelizable: true,
      },
      fallbacks: [],
      factory: (config) => new MECHANISM_CONSTRUCTORS['standard'](config),
    });

    // Explicit alias for real implementation (ANTI-009)
    this.register({
      name: 'real-standard',
      displayName: 'Real Standard Multi-Head Attention',
      description: 'Real implementation of scaled dot-product attention (not placeholder)',
      capabilities: {
        supportsLongContext: false,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.QUADRATIC,
        avgLatencyMs: 3.0,
        memoryUsageMB: 200,
        parallelizable: true,
      },
      fallbacks: [],
      factory: (config) => new MECHANISM_CONSTRUCTORS['real-standard'](config),
    });

    // === SPECIALIZED MECHANISMS ===

    this.register({
      name: 'cross',
      displayName: 'Cross Attention',
      description: 'Cross-attention for encoder-decoder models',
      capabilities: {
        supportsLongContext: false,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.QUADRATIC,
        avgLatencyMs: 2.8,
        memoryUsageMB: 180,
        parallelizable: true,
      },
      fallbacks: ['standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['cross'](config),
    });

    this.register({
      name: 'local',
      displayName: 'Local Attention',
      description: 'Window-based local attention',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: true,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.LINEAR,
        avgLatencyMs: 1.5,
        memoryUsageMB: 40,
        parallelizable: true,
      },
      fallbacks: ['sliding-window', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['local'](config),
    });

    this.register({
      name: 'global',
      displayName: 'Global Attention',
      description: 'Global attention on selected tokens',
      capabilities: {
        supportsLongContext: false,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: true,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.QUADRATIC,
        avgLatencyMs: 2.5,
        memoryUsageMB: 100,
        parallelizable: true,
      },
      fallbacks: ['standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['global'](config),
    });

    this.register({
      name: 'axial',
      displayName: 'Axial Attention',
      description: 'Factored attention along axes',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.SUBQUADRATIC,
        avgLatencyMs: 2.0,
        memoryUsageMB: 50,
        parallelizable: true,
      },
      fallbacks: ['standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['axial'](config),
    });

    this.register({
      name: 'block-sparse',
      displayName: 'Block Sparse Attention',
      description: 'Block-wise sparse attention patterns',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: true,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.SUBQUADRATIC,
        avgLatencyMs: 2.3,
        memoryUsageMB: 55,
        parallelizable: true,
      },
      fallbacks: ['sparse-transformer', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['block-sparse'](config),
    });

    this.register({
      name: 'strided',
      displayName: 'Strided Attention',
      description: 'Strided sparse attention',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: true,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.SUBQUADRATIC,
        avgLatencyMs: 2.1,
        memoryUsageMB: 48,
        parallelizable: true,
      },
      fallbacks: ['sparse-transformer', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['strided'](config),
    });

    this.register({
      name: 'dilated',
      displayName: 'Dilated Attention',
      description: 'Dilated sliding window attention',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: true,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.LINEAR,
        avgLatencyMs: 1.8,
        memoryUsageMB: 42,
        parallelizable: true,
      },
      fallbacks: ['local', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['dilated'](config),
    });

    this.register({
      name: 'sliding-window',
      displayName: 'Sliding Window Attention',
      description: 'Fixed-size sliding window attention',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: true,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.LINEAR,
        avgLatencyMs: 1.4,
        memoryUsageMB: 38,
        parallelizable: true,
      },
      fallbacks: ['local', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['sliding-window'](config),
    });

    this.register({
      name: 'causal',
      displayName: 'Causal Attention',
      description: 'Left-to-right causal masking',
      capabilities: {
        supportsLongContext: false,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.QUADRATIC,
        avgLatencyMs: 2.8,
        memoryUsageMB: 180,
        parallelizable: true,
      },
      fallbacks: ['standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['causal'](config),
    });

    this.register({
      name: 'bidirectional',
      displayName: 'Bidirectional Attention',
      description: 'Full bidirectional attention',
      capabilities: {
        supportsLongContext: false,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.QUADRATIC,
        avgLatencyMs: 3.0,
        memoryUsageMB: 200,
        parallelizable: true,
      },
      fallbacks: ['standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['bidirectional'](config),
    });

    this.register({
      name: 'multi-query',
      displayName: 'Multi-Query Attention',
      description: 'Shared KV heads for efficiency',
      capabilities: {
        supportsLongContext: false,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.QUADRATIC,
        avgLatencyMs: 2.0,
        memoryUsageMB: 100,
        parallelizable: true,
      },
      fallbacks: ['grouped-query', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['multi-query'](config),
    });

    this.register({
      name: 'grouped-query',
      displayName: 'Grouped Query Attention',
      description: 'Grouped KV heads for balanced efficiency',
      capabilities: {
        supportsLongContext: false,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.QUADRATIC,
        avgLatencyMs: 2.2,
        memoryUsageMB: 120,
        parallelizable: true,
      },
      fallbacks: ['standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['grouped-query'](config),
    });

    this.register({
      name: 'multi-head-latent',
      displayName: 'Multi-Head Latent Attention',
      description: 'Latent attention with learned queries',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: true,
      },
      performance: {
        complexity: ComplexityClass.LINEAR,
        avgLatencyMs: 2.5,
        memoryUsageMB: 60,
        parallelizable: true,
      },
      fallbacks: ['memory-compressed', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['multi-head-latent'](config),
    });

    this.register({
      name: 'synthesizer',
      displayName: 'Synthesizer',
      description: 'Random feature attention',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: true,
      },
      performance: {
        complexity: ComplexityClass.LINEAR,
        avgLatencyMs: 1.8,
        memoryUsageMB: 45,
        parallelizable: true,
      },
      fallbacks: ['performer', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['synthesizer'](config),
    });

    this.register({
      name: 'luna',
      displayName: 'Luna',
      description: 'Linear Unified Nested Attention',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: true,
      },
      performance: {
        complexity: ComplexityClass.LINEAR,
        avgLatencyMs: 1.6,
        memoryUsageMB: 40,
        parallelizable: true,
      },
      fallbacks: ['linformer', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['luna'](config),
    });

    this.register({
      name: 'nystromformer',
      displayName: 'Nyströmformer',
      description: 'Nyström approximation for attention',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: true,
      },
      performance: {
        complexity: ComplexityClass.LINEAR,
        avgLatencyMs: 1.7,
        memoryUsageMB: 42,
        parallelizable: true,
      },
      fallbacks: ['performer', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['nystromformer'](config),
    });

    this.register({
      name: 'fnet',
      displayName: 'FNet',
      description: 'Fourier attention (no learned weights)',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.LINEARITHMIC,
        avgLatencyMs: 0.6,
        memoryUsageMB: 25,
        parallelizable: true,
      },
      fallbacks: ['linear', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['fnet'](config),
    });

    this.register({
      name: 'aft',
      displayName: 'AFT',
      description: 'Attention Free Transformer',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.LINEAR,
        avgLatencyMs: 0.9,
        memoryUsageMB: 28,
        parallelizable: true,
      },
      fallbacks: ['linear', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['aft'](config),
    });

    this.register({
      name: 'mega',
      displayName: 'Mega',
      description: 'Moving Average Equipped Gated Attention',
      capabilities: {
        supportsLongContext: true,
        supportsHierarchy: false,
        supportsGraphs: false,
        supportsSparsity: false,
        requiresPrecomputation: false,
      },
      performance: {
        complexity: ComplexityClass.LINEAR,
        avgLatencyMs: 1.1,
        memoryUsageMB: 32,
        parallelizable: true,
      },
      fallbacks: ['mamba', 'linear', 'standard'],
      factory: (config) => new MECHANISM_CONSTRUCTORS['mega'](config),
    });
  }

  // ==================== Public API ====================

  /**
   * Register a new attention mechanism
   */
  register(descriptor: IAttentionMechanismDescriptor): void {
    this.mechanisms.set(descriptor.name, descriptor);
  }

  /**
   * Get mechanism descriptor by name
   */
  get(name: string): IAttentionMechanismDescriptor | undefined {
    return this.mechanisms.get(name);
  }

  /**
   * Check if mechanism exists
   */
  has(name: string): boolean {
    return this.mechanisms.has(name);
  }

  /**
   * List all registered mechanism names
   */
  list(): string[] {
    return Array.from(this.mechanisms.keys());
  }

  /**
   * Get all mechanism descriptors
   */
  getAll(): IAttentionMechanismDescriptor[] {
    return Array.from(this.mechanisms.values());
  }

  /**
   * Get count of registered mechanisms
   */
  get size(): number {
    return this.mechanisms.size;
  }

  /**
   * Find mechanisms by capability
   */
  findByCapability(capability: keyof IAttentionCapabilities): IAttentionMechanismDescriptor[] {
    return Array.from(this.mechanisms.values()).filter(
      m => m.capabilities[capability]
    );
  }

  /**
   * Find mechanisms by complexity class
   */
  findByComplexity(complexity: ComplexityClass): IAttentionMechanismDescriptor[] {
    return Array.from(this.mechanisms.values()).filter(
      m => m.performance.complexity === complexity
    );
  }

  /**
   * Find mechanisms that support long context
   */
  findLongContextMechanisms(): IAttentionMechanismDescriptor[] {
    return this.findByCapability('supportsLongContext');
  }

  /**
   * Find mechanisms that support hierarchy
   */
  findHierarchyMechanisms(): IAttentionMechanismDescriptor[] {
    return this.findByCapability('supportsHierarchy');
  }

  /**
   * Find mechanisms that support graphs
   */
  findGraphMechanisms(): IAttentionMechanismDescriptor[] {
    return this.findByCapability('supportsGraphs');
  }

  /**
   * Create mechanism instance by name
   */
  createMechanism(name: string, config?: Record<string, unknown>): IAttentionMechanism {
    const descriptor = this.get(name);
    if (!descriptor) {
      throw new Error(`Unknown attention mechanism: ${name}`);
    }
    return descriptor.factory(config);
  }
}
