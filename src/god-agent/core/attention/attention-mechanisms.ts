/**
 * Attention Mechanisms Registry
 * TASK-ATT-001 - Attention Factory Auto-Selection
 *
 * Maps attention mechanism names to their Real implementations.
 * All placeholder classes have been removed per ANTI-009.
 *
 * Real implementations available in mechanisms/ directory:
 * - Phase 1: Standard, Linear, Flash, MultiQuery, GroupedQuery
 * - Phase 2: Longformer, BigBird, SparseTransformer
 * - Phase 3: Hyperbolic, GraphRoPe, Mamba, RWKV
 * - Phase 4: Performer, Linformer, Reformer, Retentive, Hyena
 * - Phase 5: Differential, Cross, Causal, Local, Bidirectional
 * - Phase 6: SlidingWindow, Global, Dilated, Strided, Axial, BlockSparse
 * - Phase 7: MemoryCompressed, RoutingTransformer, Clustered, SetTransformer,
 *            MultiHeadLatent, Synthesizer, Luna, Nystromformer, FNet, AFT, Mega
 *
 * See: docs/god-agent-specs/anti-pattern-fixes/SPEC-ANTI-009-PLACEHOLDER-NEURAL-NETWORKS.md
 */

import type { IAttentionMechanism } from './attention-types.js';

// Phase 1 implementations
import { RealStandardAttention } from './mechanisms/standard-attention.js';
import { RealLinearAttention } from './mechanisms/linear-attention.js';
import { RealFlashAttention } from './mechanisms/flash-attention.js';
import { RealMultiQueryAttention } from './mechanisms/multi-query-attention.js';
import { RealGroupedQueryAttention } from './mechanisms/grouped-query-attention.js';

// Phase 2 implementations
import { RealLongformerAttention } from './mechanisms/longformer-attention.js';
import { RealBigBirdAttention } from './mechanisms/bigbird-attention.js';
import { RealSparseTransformerAttention } from './mechanisms/sparse-transformer-attention.js';

// Phase 3 implementations
import { RealHyperbolicAttention } from './mechanisms/hyperbolic-attention.js';
import { RealGraphRoPeAttention } from './mechanisms/graph-rope-attention.js';
import { RealMambaAttention } from './mechanisms/mamba-attention.js';
import { RealRWKVAttention } from './mechanisms/rwkv-attention.js';

// Phase 4 implementations
import { RealPerformerAttention } from './mechanisms/performer-attention.js';
import { RealLinformerAttention } from './mechanisms/linformer-attention.js';
import { RealReformerAttention } from './mechanisms/reformer-attention.js';
import { RealRetentiveAttention } from './mechanisms/retentive-attention.js';
import { RealHyenaAttention } from './mechanisms/hyena-attention.js';

// Phase 5 implementations
import { RealDifferentialAttention } from './mechanisms/differential-attention.js';
import { RealCrossAttention } from './mechanisms/cross-attention.js';
import { RealCausalAttention } from './mechanisms/causal-attention.js';
import { RealLocalAttention } from './mechanisms/local-attention.js';
import { RealBidirectionalAttention } from './mechanisms/bidirectional-attention.js';

// Phase 6 implementations
import { RealSlidingWindowAttention } from './mechanisms/sliding-window-attention.js';
import { RealGlobalAttention } from './mechanisms/global-attention.js';
import { RealDilatedAttention } from './mechanisms/dilated-attention.js';
import { RealStridedAttention } from './mechanisms/strided-attention.js';
import { RealAxialAttention } from './mechanisms/axial-attention.js';
import { RealBlockSparseAttention } from './mechanisms/block-sparse-attention.js';

// Phase 7 implementations
import { RealMemoryCompressedAttention } from './mechanisms/memory-compressed-attention.js';
import { RealRoutingTransformerAttention } from './mechanisms/routing-transformer-attention.js';
import { RealClusteredAttention } from './mechanisms/clustered-attention.js';
import { RealSetTransformerAttention } from './mechanisms/set-transformer-attention.js';
import { RealMultiHeadLatentAttention } from './mechanisms/multi-head-latent-attention.js';
import { RealSynthesizerAttention } from './mechanisms/synthesizer-attention.js';
import { RealLunaAttention } from './mechanisms/luna-attention.js';
import { RealNystromformerAttention } from './mechanisms/nystromformer-attention.js';
import { RealFNetAttention } from './mechanisms/fnet-attention.js';
import { RealAFTAttention } from './mechanisms/aft-attention.js';
import { RealMegaAttention } from './mechanisms/mega-attention.js';

// ==================== Re-exports for convenience ====================

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

// ==================== Factory Map ====================

/**
 * Map of mechanism names to their constructors.
 * All entries point to Real* implementations.
 */
export const MECHANISM_CONSTRUCTORS: Record<string, new (config?: Record<string, unknown>) => IAttentionMechanism> = {
  // === Phase 1: Core attention implementations ===
  'flash': RealFlashAttention,
  'linear': RealLinearAttention,
  'standard': RealStandardAttention,
  'real-standard': RealStandardAttention,  // Explicit alias
  'multi-query': RealMultiQueryAttention,
  'grouped-query': RealGroupedQueryAttention,

  // === Phase 2: Sparse/Long-Context implementations ===
  'longformer': RealLongformerAttention,
  'bigbird': RealBigBirdAttention,
  'sparse-transformer': RealSparseTransformerAttention,

  // === Phase 3: Structure-Aware and SSM implementations ===
  'hyperbolic': RealHyperbolicAttention,
  'graph-rope': RealGraphRoPeAttention,
  'mamba': RealMambaAttention,
  'rwkv': RealRWKVAttention,

  // === Phase 4: Linear attention variants ===
  'performer': RealPerformerAttention,
  'linformer': RealLinformerAttention,
  'reformer': RealReformerAttention,
  'retentive': RealRetentiveAttention,
  'hyena': RealHyenaAttention,

  // === Phase 5: Directional attention implementations ===
  'differential': RealDifferentialAttention,
  'cross': RealCrossAttention,
  'local': RealLocalAttention,
  'causal': RealCausalAttention,
  'bidirectional': RealBidirectionalAttention,

  // === Phase 6: Sparse/structured pattern implementations ===
  'sliding-window': RealSlidingWindowAttention,
  'global': RealGlobalAttention,
  'dilated': RealDilatedAttention,
  'strided': RealStridedAttention,
  'axial': RealAxialAttention,
  'block-sparse': RealBlockSparseAttention,

  // === Phase 7: Memory and specialized implementations ===
  'memory-compressed': RealMemoryCompressedAttention,
  'routing-transformer': RealRoutingTransformerAttention,
  'clustered': RealClusteredAttention,
  'set-transformer': RealSetTransformerAttention,
  'multi-head-latent': RealMultiHeadLatentAttention,
  'synthesizer': RealSynthesizerAttention,
  'luna': RealLunaAttention,
  'nystromformer': RealNystromformerAttention,
  'fnet': RealFNetAttention,
  'aft': RealAFTAttention,
  'mega': RealMegaAttention,
};
