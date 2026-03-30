/**
 * GraphRoPe Attention Mock
 * Rotary position embeddings for graphs (MOCK - TEST ONLY)
 */
import { BaseMockAttention } from './base-mock-attention.js';

export class GraphRoPeAttention extends BaseMockAttention {
  readonly name = 'graph-rope';
}
