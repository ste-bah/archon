/**
 * Linear Attention Mock
 * O(N) complexity via kernel approximation (MOCK - TEST ONLY)
 */
import { BaseMockAttention } from './base-mock-attention.js';

export class LinearAttention extends BaseMockAttention {
  readonly name = 'linear';
}
