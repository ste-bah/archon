/**
 * Flash Attention Mock
 * IO-aware exact attention (MOCK - TEST ONLY)
 */
import { BaseMockAttention } from './base-mock-attention.js';

export class FlashAttention extends BaseMockAttention {
  readonly name = 'flash';
}
