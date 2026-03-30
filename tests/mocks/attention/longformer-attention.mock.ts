/**
 * Longformer Attention Mock
 * Sliding window + global attention (MOCK - TEST ONLY)
 */
import { BaseMockAttention } from './base-mock-attention.js';

export class LongformerAttention extends BaseMockAttention {
  readonly name = 'longformer';
}
