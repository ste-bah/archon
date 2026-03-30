/**
 * God Agent Attention Module
 * TASK-ATT-001 - Attention Factory Auto-Selection
 *
 * Provides automatic attention mechanism selection:
 * - IDataProfile analysis
 * - 39+ attention mechanisms registry
 * - Rule-based selection engine
 * - DualSpace attention for mixed workloads
 *
 * Performance target: <1ms selection overhead
 */

// ===== ATTENTION FACTORY =====

export { AttentionFactory } from './attention-factory.js';

// ===== REGISTRY & SELECTOR =====

export { AttentionMechanismRegistry } from './attention-registry.js';
export { AttentionMechanismRegistry as AttentionRegistry } from './attention-registry.js'; // Alias
export { AttentionSelector } from './attention-selector.js';

// ===== DUALSPACE ATTENTION =====

export { DualSpaceAttention } from './dual-space-attention.js';

// ===== REAL IMPLEMENTATIONS =====
// All implementations are now in mechanisms/ directory
// See: docs/god-agent-specs/anti-pattern-fixes/SPEC-ANTI-009-PLACEHOLDER-NEURAL-NETWORKS.md

// Phase 1
export { RealStandardAttention } from './mechanisms/standard-attention.js';
export { RealLinearAttention } from './mechanisms/linear-attention.js';
export { RealFlashAttention } from './mechanisms/flash-attention.js';
export { RealMultiQueryAttention } from './mechanisms/multi-query-attention.js';
export { RealGroupedQueryAttention } from './mechanisms/grouped-query-attention.js';

// Phase 2
export { RealLongformerAttention } from './mechanisms/longformer-attention.js';
export { RealBigBirdAttention } from './mechanisms/bigbird-attention.js';
export { RealSparseTransformerAttention } from './mechanisms/sparse-transformer-attention.js';

// Phase 3
export { RealHyperbolicAttention } from './mechanisms/hyperbolic-attention.js';
export { RealGraphRoPeAttention } from './mechanisms/graph-rope-attention.js';
export { RealMambaAttention } from './mechanisms/mamba-attention.js';
export { RealRWKVAttention } from './mechanisms/rwkv-attention.js';

// Phase 4
export { RealPerformerAttention } from './mechanisms/performer-attention.js';
export { RealLinformerAttention } from './mechanisms/linformer-attention.js';
export { RealReformerAttention } from './mechanisms/reformer-attention.js';
export { RealRetentiveAttention } from './mechanisms/retentive-attention.js';
export { RealHyenaAttention } from './mechanisms/hyena-attention.js';

// Phase 5
export { RealDifferentialAttention } from './mechanisms/differential-attention.js';
export { RealCrossAttention } from './mechanisms/cross-attention.js';
export { RealCausalAttention } from './mechanisms/causal-attention.js';
export { RealLocalAttention } from './mechanisms/local-attention.js';
export { RealBidirectionalAttention } from './mechanisms/bidirectional-attention.js';

// Phase 6
export { RealSlidingWindowAttention } from './mechanisms/sliding-window-attention.js';
export { RealGlobalAttention } from './mechanisms/global-attention.js';
export { RealDilatedAttention } from './mechanisms/dilated-attention.js';
export { RealStridedAttention } from './mechanisms/strided-attention.js';
export { RealAxialAttention } from './mechanisms/axial-attention.js';
export { RealBlockSparseAttention } from './mechanisms/block-sparse-attention.js';

// Phase 7
export { RealMemoryCompressedAttention } from './mechanisms/memory-compressed-attention.js';
export { RealRoutingTransformerAttention } from './mechanisms/routing-transformer-attention.js';
export { RealClusteredAttention } from './mechanisms/clustered-attention.js';
export { RealSetTransformerAttention } from './mechanisms/set-transformer-attention.js';
export { RealMultiHeadLatentAttention } from './mechanisms/multi-head-latent-attention.js';
export { RealSynthesizerAttention } from './mechanisms/synthesizer-attention.js';
export { RealLunaAttention } from './mechanisms/luna-attention.js';
export { RealNystromformerAttention } from './mechanisms/nystromformer-attention.js';
export { RealFNetAttention } from './mechanisms/fnet-attention.js';
export { RealAFTAttention } from './mechanisms/aft-attention.js';
export { RealMegaAttention } from './mechanisms/mega-attention.js';

// ===== FACTORY MAP =====

export { MECHANISM_CONSTRUCTORS } from './attention-mechanisms.js';

// ===== TYPE DEFINITIONS =====

export {
  ComplexityClass,
  DEFAULT_SELECTION_THRESHOLDS,
  DEFAULT_ATTENTION_CONFIG,
  AttentionError,
  createDefaultDataProfile,
  hashDataProfile,
} from './attention-types.js';

export type {
  IDataProfile,
  IAttentionCapabilities,
  IPerformanceProfile,
  IAttentionMechanism,
  AttentionMechanismFactory,
  IAttentionMechanismDescriptor,
  ISelectionResult,
  ISelectionThresholds,
  IAttentionConfig,
  IAttentionConfig as AttentionConfig, // Alias for compatibility
  ISelectionMetrics,
} from './attention-types.js';
