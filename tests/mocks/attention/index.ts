/**
 * Mock Attention Mechanisms Index
 * ANTI-007: Test Fixtures - Barrel export for all mock attention mechanisms
 *
 * This file exports all mock attention mechanisms for use in tests.
 * IMPORTANT: Never import from this file in production code.
 *
 * @example
 * ```typescript
 * // In test files:
 * import { FlashAttention, MOCK_MECHANISM_CONSTRUCTORS } from '../../mocks/attention/index.js';
 *
 * const mechanism = new FlashAttention();
 * // Or via registry:
 * const MechClass = MOCK_MECHANISM_CONSTRUCTORS['flash'];
 * const instance = new MechClass();
 * ```
 */

// Base class
export { BaseMockAttention, type IMockAttentionConfig } from './base-mock-attention.js';

// Efficiency mechanisms
export { FlashAttention } from './flash-attention.mock.js';
export { LinearAttention } from './linear-attention.mock.js';
export { PerformerAttention } from './performer-attention.mock.js';
export { LinformerAttention } from './linformer-attention.mock.js';
export { ReformerAttention } from './reformer-attention.mock.js';

// Structure-aware mechanisms
export { HyperbolicAttention } from './hyperbolic-attention.mock.js';
export { GraphRoPeAttention } from './graph-rope-attention.mock.js';

// Sparse/structured mechanisms
export { BigBirdAttention } from './bigbird-attention.mock.js';
export { LongformerAttention } from './longformer-attention.mock.js';
export { SparseTransformerAttention } from './sparse-transformer-attention.mock.js';

// Memory-based mechanisms
export { MemoryCompressedAttention } from './memory-compressed-attention.mock.js';
export { RoutingTransformerAttention } from './routing-transformer-attention.mock.js';
export { ClusteredAttention } from './clustered-attention.mock.js';
export { SetTransformerAttention } from './set-transformer-attention.mock.js';

// Domain-specific mechanisms
export { RetentiveAttention } from './retentive-attention.mock.js';
export { DifferentialAttention } from './differential-attention.mock.js';
export { HyenaAttention } from './hyena-attention.mock.js';
export { MambaAttention } from './mamba-attention.mock.js';
export { RWKVAttention } from './rwkv-attention.mock.js';

// Standard attention
export { StandardAttention } from './standard-attention.mock.js';

// Specialized mechanisms
export { CrossAttention } from './cross-attention.mock.js';
export { LocalAttention } from './local-attention.mock.js';
export { GlobalAttention } from './global-attention.mock.js';
export { AxialAttention } from './axial-attention.mock.js';
export { BlockSparseAttention } from './block-sparse-attention.mock.js';
export { StridedAttention } from './strided-attention.mock.js';
export { DilatedAttention } from './dilated-attention.mock.js';
export { SlidingWindowAttention } from './sliding-window-attention.mock.js';
export { CausalAttention } from './causal-attention.mock.js';
export { BidirectionalAttention } from './bidirectional-attention.mock.js';
export { MultiQueryAttention } from './multi-query-attention.mock.js';
export { GroupedQueryAttention } from './grouped-query-attention.mock.js';
export { MultiHeadLatentAttention } from './multi-head-latent-attention.mock.js';
export { SynthesizerAttention } from './synthesizer-attention.mock.js';
export { LunaAttention } from './luna-attention.mock.js';
export { NystromformerAttention } from './nystromformer-attention.mock.js';
export { FNetAttention } from './fnet-attention.mock.js';
export { AFTAttention } from './aft-attention.mock.js';
export { MegaAttention } from './mega-attention.mock.js';

// Import for registry
import type { IAttentionMechanism } from '../../../src/god-agent/core/attention/attention-types.js';
import { RealStandardAttention } from '../../../src/god-agent/core/attention/mechanisms/standard-attention.js';
import { FlashAttention } from './flash-attention.mock.js';
import { LinearAttention } from './linear-attention.mock.js';
import { PerformerAttention } from './performer-attention.mock.js';
import { LinformerAttention } from './linformer-attention.mock.js';
import { ReformerAttention } from './reformer-attention.mock.js';
import { HyperbolicAttention } from './hyperbolic-attention.mock.js';
import { GraphRoPeAttention } from './graph-rope-attention.mock.js';
import { BigBirdAttention } from './bigbird-attention.mock.js';
import { LongformerAttention } from './longformer-attention.mock.js';
import { SparseTransformerAttention } from './sparse-transformer-attention.mock.js';
import { MemoryCompressedAttention } from './memory-compressed-attention.mock.js';
import { RoutingTransformerAttention } from './routing-transformer-attention.mock.js';
import { ClusteredAttention } from './clustered-attention.mock.js';
import { SetTransformerAttention } from './set-transformer-attention.mock.js';
import { RetentiveAttention } from './retentive-attention.mock.js';
import { DifferentialAttention } from './differential-attention.mock.js';
import { HyenaAttention } from './hyena-attention.mock.js';
import { MambaAttention } from './mamba-attention.mock.js';
import { RWKVAttention } from './rwkv-attention.mock.js';
import { CrossAttention } from './cross-attention.mock.js';
import { LocalAttention } from './local-attention.mock.js';
import { GlobalAttention } from './global-attention.mock.js';
import { AxialAttention } from './axial-attention.mock.js';
import { BlockSparseAttention } from './block-sparse-attention.mock.js';
import { StridedAttention } from './strided-attention.mock.js';
import { DilatedAttention } from './dilated-attention.mock.js';
import { SlidingWindowAttention } from './sliding-window-attention.mock.js';
import { CausalAttention } from './causal-attention.mock.js';
import { BidirectionalAttention } from './bidirectional-attention.mock.js';
import { MultiQueryAttention } from './multi-query-attention.mock.js';
import { GroupedQueryAttention } from './grouped-query-attention.mock.js';
import { MultiHeadLatentAttention } from './multi-head-latent-attention.mock.js';
import { SynthesizerAttention } from './synthesizer-attention.mock.js';
import { LunaAttention } from './luna-attention.mock.js';
import { NystromformerAttention } from './nystromformer-attention.mock.js';
import { FNetAttention } from './fnet-attention.mock.js';
import { AFTAttention } from './aft-attention.mock.js';
import { MegaAttention } from './mega-attention.mock.js';

/**
 * Mock mechanism constructors registry (TEST-ONLY)
 *
 * This registry mirrors MECHANISM_CONSTRUCTORS from production but uses mock classes.
 * Use this in tests to create attention mechanisms without real computation overhead.
 *
 * NOTE: 'standard' and 'real-standard' both point to RealStandardAttention since
 * that's the actual implementation. All other mechanisms use mocks.
 */
export const MOCK_MECHANISM_CONSTRUCTORS: Record<
  string,
  new (config?: Record<string, unknown>) => IAttentionMechanism
> = {
  flash: FlashAttention,
  linear: LinearAttention,
  performer: PerformerAttention,
  linformer: LinformerAttention,
  reformer: ReformerAttention,
  hyperbolic: HyperbolicAttention,
  'graph-rope': GraphRoPeAttention,
  bigbird: BigBirdAttention,
  longformer: LongformerAttention,
  'sparse-transformer': SparseTransformerAttention,
  'memory-compressed': MemoryCompressedAttention,
  'routing-transformer': RoutingTransformerAttention,
  clustered: ClusteredAttention,
  'set-transformer': SetTransformerAttention,
  retentive: RetentiveAttention,
  differential: DifferentialAttention,
  hyena: HyenaAttention,
  mamba: MambaAttention,
  rwkv: RWKVAttention,
  standard: RealStandardAttention,
  'real-standard': RealStandardAttention,
  cross: CrossAttention,
  local: LocalAttention,
  global: GlobalAttention,
  axial: AxialAttention,
  'block-sparse': BlockSparseAttention,
  strided: StridedAttention,
  dilated: DilatedAttention,
  'sliding-window': SlidingWindowAttention,
  causal: CausalAttention,
  bidirectional: BidirectionalAttention,
  'multi-query': MultiQueryAttention,
  'grouped-query': GroupedQueryAttention,
  'multi-head-latent': MultiHeadLatentAttention,
  synthesizer: SynthesizerAttention,
  luna: LunaAttention,
  nystromformer: NystromformerAttention,
  fnet: FNetAttention,
  aft: AFTAttention,
  mega: MegaAttention,
};

/**
 * Get list of all available mock mechanism names
 */
export function getMockMechanismNames(): string[] {
  return Object.keys(MOCK_MECHANISM_CONSTRUCTORS);
}

/**
 * Create a mock mechanism by name
 * @param name - Mechanism name (e.g., 'flash', 'linear')
 * @param config - Optional configuration
 * @returns The mechanism instance
 * @throws Error if mechanism name is unknown
 */
export function createMockMechanism(
  name: string,
  config?: Record<string, unknown>
): IAttentionMechanism {
  const Constructor = MOCK_MECHANISM_CONSTRUCTORS[name];
  if (!Constructor) {
    throw new Error(
      `Unknown mock attention mechanism: ${name}. Available: ${getMockMechanismNames().join(', ')}`
    );
  }
  return new Constructor(config);
}
