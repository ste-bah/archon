/**
 * BigBird Attention Mock
 * Sparse attention with random, window, and global tokens (MOCK - TEST ONLY)
 */
import { BaseMockAttention } from './base-mock-attention.js';

export class BigBirdAttention extends BaseMockAttention {
  readonly name = 'bigbird';
}
