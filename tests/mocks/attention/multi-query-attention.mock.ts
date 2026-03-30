/**
 * Multi-Query Attention Mock
 * Shared KV heads (MOCK - TEST ONLY)
 */
import { BaseMockAttention } from './base-mock-attention.js';

export class MultiQueryAttention extends BaseMockAttention {
  readonly name = 'multi-query';
}
