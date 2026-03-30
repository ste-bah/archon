/**
 * Grouped Query Attention Mock
 * Grouped KV heads (MOCK - TEST ONLY)
 */
import { BaseMockAttention } from './base-mock-attention.js';

export class GroupedQueryAttention extends BaseMockAttention {
  readonly name = 'grouped-query';
}
