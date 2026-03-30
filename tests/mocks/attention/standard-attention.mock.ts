/**
 * Standard Attention Mock
 * Multi-Head Attention (MOCK - TEST ONLY)
 *
 * NOTE: For production use, import RealStandardAttention from:
 * src/god-agent/core/attention/mechanisms/standard-attention.ts
 */
import { BaseMockAttention } from './base-mock-attention.js';

export class StandardAttention extends BaseMockAttention {
  readonly name = 'standard';
}
