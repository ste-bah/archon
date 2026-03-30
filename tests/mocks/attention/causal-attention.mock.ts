/**
 * Causal Attention Mock
 * Left-to-right only (MOCK - TEST ONLY)
 */
import { BaseMockAttention } from './base-mock-attention.js';

export class CausalAttention extends BaseMockAttention {
  readonly name = 'causal';
}
