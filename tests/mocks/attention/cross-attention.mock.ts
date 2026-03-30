/**
 * Cross Attention Mock
 * For encoder-decoder (MOCK - TEST ONLY)
 */
import { BaseMockAttention } from './base-mock-attention.js';

export class CrossAttention extends BaseMockAttention {
  readonly name = 'cross';
}
