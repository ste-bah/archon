/**
 * Tests for RealGlobalAttention
 *
 * Verifies:
 * - Correct global attention pattern (G positions attend to all, rest attend to G)
 * - Mathematical correctness (scaling, softmax, weighted sum)
 * - Numerical stability (no NaN/Inf)
 * - Edge cases (single global, multiple globals)
 * - Mask interaction
 */

import { describe, it, expect } from 'vitest';
import { RealGlobalAttention } from '../../../../../src/god-agent/core/attention/mechanisms/global-attention.js';

describe('RealGlobalAttention', () => {
  // ==================== Configuration Tests ====================

  it('should initialize with default configuration', () => {
    const attention = new RealGlobalAttention();

    expect(attention.name).toBe('global');
    expect(attention.getParameterCount()).toBe(4 * 1536 * 1536);
  });

  it('should initialize with custom configuration', () => {
    const attention = new RealGlobalAttention({
      dimension: 512,
      numHeads: 8,
      numGlobalTokens: 2,
      seed: 42,
    });

    expect(attention.getParameterCount()).toBe(4 * 512 * 512);
  });

  it('should reject dimension not divisible by numHeads', () => {
    expect(() => {
      new RealGlobalAttention({
        dimension: 768,
        numHeads: 13, // 768 not divisible by 13
      });
    }).toThrow('must be divisible by');
  });

  it('should reject numGlobalTokens < 1', () => {
    expect(() => {
      new RealGlobalAttention({
        dimension: 768,
        numHeads: 12,
        numGlobalTokens: 0,
      });
    }).toThrow('numGlobalTokens must be >= 1');
  });

  // ==================== Single Vector Tests ====================

  it('should process minimal sequence (1 global, 1 regular)', () => {
    const attention = new RealGlobalAttention({
      dimension: 64,
      numHeads: 4,
      numGlobalTokens: 1,
      seed: 42,
    });

    // Need at least 2 positions: 1 global, 1 regular
    const seqLen = 2;
    const query = new Float32Array(seqLen * 64);
    query[0] = 1.0;
    query[64] = 0.5;

    const output = attention.forward(query, query, query, undefined, seqLen);

    expect(output).toBeInstanceOf(Float32Array);
    expect(output.length).toBe(seqLen * 64);

    // Verify no NaN or Inf
    for (let i = 0; i < output.length; i++) {
      expect(isFinite(output[i])).toBe(true);
    }
  });

  // ==================== Global Pattern Tests ====================

  it('should apply correct global pattern (1 global token)', () => {
    const dim = 64;
    const numHeads = 4;
    const headDim = dim / numHeads;
    const seqLen = 4;

    const attention = new RealGlobalAttention({
      dimension: dim,
      numHeads: numHeads,
      numGlobalTokens: 1,
      seed: 42,
    });

    // Create distinct inputs
    const query = new Float32Array(seqLen * dim);
    const key = new Float32Array(seqLen * dim);
    const value = new Float32Array(seqLen * dim);

    for (let i = 0; i < seqLen; i++) {
      for (let j = 0; j < dim; j++) {
        query[i * dim + j] = i + 1;
        key[i * dim + j] = (i + 1) * 0.1;
        value[i * dim + j] = (i + 1) * 10;
      }
    }

    const output = attention.forward(query, key, value, undefined, seqLen);

    // Expected pattern:
    // Position 0 (global): attends to positions [0, 1, 2, 3]
    // Position 1 (regular): attends only to position [0]
    // Position 2 (regular): attends only to position [0]
    // Position 3 (regular): attends only to position [0]

    expect(output.length).toBe(seqLen * dim);

    // Position 0 should have influence from all positions
    const output0 = output.slice(0, dim);

    // Positions 1-3 should primarily reflect position 0's value
    // Since they only attend to global position 0
    const output1 = output.slice(dim, 2 * dim);
    const output2 = output.slice(2 * dim, 3 * dim);
    const output3 = output.slice(3 * dim, 4 * dim);

    // Verify output is finite
    for (let i = 0; i < output.length; i++) {
      expect(isFinite(output[i])).toBe(true);
    }

    // Outputs 1-3 should be similar (all attend to same global token)
    for (let i = 0; i < dim; i++) {
      const diff12 = Math.abs(output1[i] - output2[i]);
      const diff13 = Math.abs(output1[i] - output3[i]);
      expect(diff12).toBeLessThan(0.1);
      expect(diff13).toBeLessThan(0.1);
    }
  });

  it('should apply correct global pattern (2 global tokens)', () => {
    const dim = 64;
    const seqLen = 6;

    const attention = new RealGlobalAttention({
      dimension: dim,
      numHeads: 4,
      numGlobalTokens: 2,
      seed: 42,
    });

    const query = new Float32Array(seqLen * dim);
    const key = new Float32Array(seqLen * dim);
    const value = new Float32Array(seqLen * dim);

    for (let i = 0; i < seqLen; i++) {
      for (let j = 0; j < dim; j++) {
        query[i * dim + j] = i + 1;
        key[i * dim + j] = (i + 1) * 0.1;
        value[i * dim + j] = (i + 1) * 100;
      }
    }

    const output = attention.forward(query, key, value, undefined, seqLen);

    // Expected pattern:
    // Positions 0-1 (global): attend to all [0-5]
    // Positions 2-5 (regular): attend only to [0-1]

    expect(output.length).toBe(seqLen * dim);

    // All outputs should be finite
    for (let i = 0; i < output.length; i++) {
      expect(isFinite(output[i])).toBe(true);
    }

    // Regular positions (2-5) should have similar patterns since they
    // all attend to same global tokens [0, 1]
    const output2 = output.slice(2 * dim, 3 * dim);
    const output3 = output.slice(3 * dim, 4 * dim);

    let maxDiff = 0;
    for (let i = 0; i < dim; i++) {
      const diff = Math.abs(output2[i] - output3[i]);
      maxDiff = Math.max(maxDiff, diff);
    }

    // They should be similar but not identical due to different query vectors
    expect(maxDiff).toBeLessThan(50);
  });

  // ==================== Mask Interaction Tests ====================

  it('should combine global pattern with user mask', () => {
    const dim = 64;
    const seqLen = 4;

    const attention = new RealGlobalAttention({
      dimension: dim,
      numHeads: 4,
      numGlobalTokens: 1,
      seed: 42,
    });

    const query = new Float32Array(seqLen * dim).fill(1.0);
    const key = new Float32Array(seqLen * dim).fill(0.1);
    const value = new Float32Array(seqLen * dim).fill(10);

    // User mask: only allow position 0 to attend to positions 0, 1
    const mask = new Array(seqLen * seqLen).fill(false);
    mask[0] = true; // 0 -> 0
    mask[1] = true; // 0 -> 1
    // Positions 1-3 can only attend to 0 (global pattern)
    mask[4] = true; // 1 -> 0
    mask[8] = true; // 2 -> 0
    mask[12] = true; // 3 -> 0

    const output = attention.forward(query, key, value, mask, seqLen);

    expect(output.length).toBe(seqLen * dim);

    // All outputs should be finite
    for (let i = 0; i < output.length; i++) {
      expect(isFinite(output[i])).toBe(true);
    }
  });

  it('should handle all-masked positions gracefully', () => {
    const dim = 64;
    const seqLen = 4;

    const attention = new RealGlobalAttention({
      dimension: dim,
      numHeads: 4,
      numGlobalTokens: 1,
      seed: 42,
    });

    const query = new Float32Array(seqLen * dim).fill(1.0);

    // Mask that blocks all attention for position 1
    const mask = new Array(seqLen * seqLen).fill(true);
    mask[4] = false; // 1 -> 0 (only available position for regular token)

    const output = attention.forward(query, query, query, mask, seqLen);

    // Should produce uniform distribution fallback
    expect(output.length).toBe(seqLen * dim);

    for (let i = 0; i < output.length; i++) {
      expect(isFinite(output[i])).toBe(true);
    }
  });

  // ==================== Numerical Stability Tests ====================

  it('should handle large scores without overflow', () => {
    const dim = 64;
    const seqLen = 4;

    const attention = new RealGlobalAttention({
      dimension: dim,
      numHeads: 4,
      numGlobalTokens: 1,
      seed: 42,
    });

    // Create large values
    const query = new Float32Array(seqLen * dim).fill(1000);
    const key = new Float32Array(seqLen * dim).fill(1000);
    const value = new Float32Array(seqLen * dim).fill(100);

    const output = attention.forward(query, key, value, undefined, seqLen);

    // Verify no overflow (no Inf or NaN)
    for (let i = 0; i < output.length; i++) {
      expect(isFinite(output[i])).toBe(true);
      expect(isNaN(output[i])).toBe(false);
    }
  });

  it('should handle near-zero values without underflow', () => {
    const dim = 64;
    const seqLen = 4;

    const attention = new RealGlobalAttention({
      dimension: dim,
      numHeads: 4,
      numGlobalTokens: 1,
      seed: 42,
    });

    // Create very small values
    const query = new Float32Array(seqLen * dim).fill(1e-10);
    const key = new Float32Array(seqLen * dim).fill(1e-10);
    const value = new Float32Array(seqLen * dim).fill(1e-10);

    const output = attention.forward(query, key, value, undefined, seqLen);

    // Verify no underflow issues
    for (let i = 0; i < output.length; i++) {
      expect(isFinite(output[i])).toBe(true);
    }
  });

  // ==================== Edge Case Tests ====================

  it('should handle sequence with all global tokens (minimal case)', () => {
    const dim = 64;
    const seqLen = 2; // Minimal: 1 global, 1 regular

    const attention = new RealGlobalAttention({
      dimension: dim,
      numHeads: 4,
      numGlobalTokens: 1,
      seed: 42,
    });

    const query = new Float32Array(seqLen * dim).fill(1.0);

    const output = attention.forward(query, query, query, undefined, seqLen);

    expect(output.length).toBe(seqLen * dim);

    for (let i = 0; i < output.length; i++) {
      expect(isFinite(output[i])).toBe(true);
    }
  });

  it('should reject numGlobalTokens >= seqLen', () => {
    const dim = 64;
    const seqLen = 4;

    const attention = new RealGlobalAttention({
      dimension: dim,
      numHeads: 4,
      numGlobalTokens: 4, // Equal to seqLen
      seed: 42,
    });

    const query = new Float32Array(seqLen * dim).fill(1.0);

    expect(() => {
      attention.forward(query, query, query, undefined, seqLen);
    }).toThrow('must be < seqLen');
  });

  // ==================== Dimension Validation Tests ====================

  it('should reject mismatched query/key dimensions', () => {
    const attention = new RealGlobalAttention({
      dimension: 64,
      numHeads: 4,
      numGlobalTokens: 1,
    });

    const query = new Float32Array(128);
    const key = new Float32Array(64);
    const value = new Float32Array(64);

    // Use flexible matching pattern for dimension error messages
    expect(() => {
      attention.forward(query, key, value);
    }).toThrow(/[Dd]imension mismatch/);
  });

  it('should reject invalid mask dimensions', () => {
    const dim = 64;
    const seqLen = 4;

    const attention = new RealGlobalAttention({
      dimension: dim,
      numHeads: 4,
      numGlobalTokens: 1,
    });

    const query = new Float32Array(seqLen * dim);
    const mask = new Array(10); // Wrong size

    expect(() => {
      attention.forward(query, query, query, mask, seqLen);
    }).toThrow('Mask length');
  });

  it('should reject invalid query length', () => {
    const attention = new RealGlobalAttention({
      dimension: 64,
      numHeads: 4,
      numGlobalTokens: 1,
    });

    const query = new Float32Array(100); // Not divisible by 64

    expect(() => {
      attention.forward(query, query, query);
    }).toThrow('incompatible with seqLen');
  });

  // ==================== Determinism Tests ====================

  it('should produce deterministic output with seed', () => {
    const dim = 64;
    const seqLen = 4;

    const attention1 = new RealGlobalAttention({
      dimension: dim,
      numHeads: 4,
      numGlobalTokens: 1,
      seed: 42,
    });

    const attention2 = new RealGlobalAttention({
      dimension: dim,
      numHeads: 4,
      numGlobalTokens: 1,
      seed: 42,
    });

    const query = new Float32Array(seqLen * dim);
    for (let i = 0; i < query.length; i++) {
      query[i] = Math.sin(i);
    }

    const output1 = attention1.forward(query, query, query, undefined, seqLen);
    const output2 = attention2.forward(query, query, query, undefined, seqLen);

    // Should be identical
    for (let i = 0; i < output1.length; i++) {
      expect(output1[i]).toBe(output2[i]);
    }
  });

  // ==================== Parameter Count Test ====================

  it('should correctly report parameter count', () => {
    const dims = [64, 128, 256, 512, 768];

    for (const dim of dims) {
      const attention = new RealGlobalAttention({
        dimension: dim,
        numHeads: 4,
        numGlobalTokens: 1,
      });

      const expected = 4 * dim * dim; // 4 weight matrices
      expect(attention.getParameterCount()).toBe(expected);
    }
  });

  // ==================== Integration Test ====================

  it('should handle realistic document classification scenario', () => {
    // Simulate BERT-style [CLS] token for classification
    const dim = 768;
    const seqLen = 128; // Document length
    const numGlobalTokens = 1; // [CLS] token at position 0

    const attention = new RealGlobalAttention({
      dimension: dim,
      numHeads: 12,
      numGlobalTokens: numGlobalTokens,
      seed: 42,
    });

    // Create realistic-looking embeddings
    const query = new Float32Array(seqLen * dim);
    const key = new Float32Array(seqLen * dim);
    const value = new Float32Array(seqLen * dim);

    for (let i = 0; i < seqLen; i++) {
      for (let j = 0; j < dim; j++) {
        // Position 0 ([CLS]) has different distribution
        if (i === 0) {
          query[i * dim + j] = Math.sin(j * 0.1) * 0.5;
          key[i * dim + j] = Math.cos(j * 0.1) * 0.5;
          value[i * dim + j] = Math.sin(j * 0.2) * 10;
        } else {
          query[i * dim + j] = Math.sin(i * j * 0.01) * 0.1;
          key[i * dim + j] = Math.cos(i * j * 0.01) * 0.1;
          value[i * dim + j] = Math.sin(i * j * 0.02) * 5;
        }
      }
    }

    const output = attention.forward(query, key, value, undefined, seqLen);

    // Verify output properties
    expect(output.length).toBe(seqLen * dim);

    // All values should be finite
    for (let i = 0; i < output.length; i++) {
      expect(isFinite(output[i])).toBe(true);
    }

    // [CLS] output should incorporate information from entire sequence
    const clsOutput = output.slice(0, dim);
    let clsNorm = 0;
    for (let i = 0; i < dim; i++) {
      clsNorm += clsOutput[i] * clsOutput[i];
    }
    clsNorm = Math.sqrt(clsNorm);

    // [CLS] should have non-trivial output
    expect(clsNorm).toBeGreaterThan(0.1);

    // Regular tokens (position 1 onwards) should have IDENTICAL outputs
    // because they all attend ONLY to position 0 with 100% weight
    // This is the correct behavior for global attention!
    const token1 = output.slice(1 * dim, 2 * dim);
    const token10 = output.slice(10 * dim, 11 * dim);
    const token50 = output.slice(50 * dim, 51 * dim);

    // All regular tokens should be nearly identical (attend to same global token)
    let maxDiff1_10 = 0;
    let maxDiff1_50 = 0;
    for (let i = 0; i < dim; i++) {
      maxDiff1_10 = Math.max(maxDiff1_10, Math.abs(token1[i] - token10[i]));
      maxDiff1_50 = Math.max(maxDiff1_50, Math.abs(token1[i] - token50[i]));
    }

    // Should be essentially identical (small numerical differences only)
    expect(maxDiff1_10).toBeLessThan(1e-6);
    expect(maxDiff1_50).toBeLessThan(1e-6);

    // But [CLS] output should be different from regular tokens
    let maxDiffCls = 0;
    for (let i = 0; i < dim; i++) {
      maxDiffCls = Math.max(maxDiffCls, Math.abs(clsOutput[i] - token1[i]));
    }
    expect(maxDiffCls).toBeGreaterThan(0.01); // [CLS] sees all tokens, others only see [CLS]
  });
});
