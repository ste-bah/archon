/**
 * Base Mock Attention Mechanism
 * ANTI-007: Test Fixtures - Mock classes moved from production to tests
 *
 * This file contains the base class for all mock attention mechanisms.
 * These are TEST-ONLY implementations that provide consistent, predictable
 * behavior for unit testing attention-related components.
 *
 * IMPORTANT: This file should NEVER be imported by production code.
 * Production code should use real implementations from:
 * - src/god-agent/core/attention/mechanisms/standard-attention.ts
 * - src/god-agent/core/attention/mechanisms/*.ts
 */

import type { IAttentionMechanism } from '../../../src/god-agent/core/attention/attention-types.js';

/**
 * Configuration for mock attention mechanisms
 * TASK-VEC-001-008: Updated default dimension to 1536
 */
export interface IMockAttentionConfig {
  /** Embedding dimension (default: 1536 per VECTOR_DIM) */
  dimension?: number;
  /** Number of attention heads (default: 12 per DEFAULT_NUM_HEADS) */
  numHeads?: number;
}

/**
 * Base class for mock attention mechanisms (TEST-ONLY)
 *
 * Provides a simple, deterministic implementation of attention for testing:
 * - Forward pass returns weighted average of query and value
 * - Parameter count calculation is simplified
 * - All derived classes inherit identical behavior
 *
 * @example
 * ```typescript
 * // In test files:
 * import { FlashAttention } from '../../mocks/attention/index.js';
 *
 * const mechanism = new FlashAttention({ dimension: 512 });
 * const output = mechanism.forward(query, key, value);
 * ```
 */
export abstract class BaseMockAttention implements IAttentionMechanism {
  /** Mechanism identifier - must be overridden by subclasses */
  abstract readonly name: string;

  /** Embedding dimension */
  protected readonly dimension: number;

  /** Number of attention heads */
  protected readonly numHeads: number;

  constructor(config?: IMockAttentionConfig) {
    // TASK-VEC-001-008: Updated default dimension to 1536, heads to 12
    this.dimension = config?.dimension ?? 1536;
    this.numHeads = config?.numHeads ?? 12;
  }

  /**
   * Mock forward pass - returns weighted combination of query and value
   *
   * This is a simplified mock that:
   * 1. Does NOT compute actual attention weights
   * 2. Returns a deterministic output for testing
   * 3. Ignores key and mask parameters
   *
   * @param query - Query vectors
   * @param _key - Key vectors (unused in mock)
   * @param value - Value vectors
   * @param _mask - Attention mask (unused in mock)
   * @returns Weighted average of query and value
   */
  forward(
    query: Float32Array,
    _key: Float32Array,
    value: Float32Array,
    _mask?: boolean[]
  ): Float32Array {
    const output = new Float32Array(query.length);
    for (let i = 0; i < query.length; i++) {
      output[i] = 0.5 * query[i] + 0.5 * value[i];
    }
    return output;
  }

  /**
   * Get estimated parameter count
   *
   * Assumes standard multi-head attention with:
   * - W_q: Query projection (dim x dim)
   * - W_k: Key projection (dim x dim)
   * - W_v: Value projection (dim x dim)
   * - W_o: Output projection (dim x dim)
   *
   * @returns Estimated parameter count
   */
  getParameterCount(): number {
    return 4 * this.dimension * this.dimension;
  }
}
