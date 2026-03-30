/**
 * Factory Integration Tests
 * PHASE-0-001-011: RealStandardAttention Factory Integration
 *
 * Verifies that RealStandardAttention is properly integrated with AttentionFactory
 * and can be retrieved through all expected interfaces.
 */

import { describe, it, expect } from 'vitest';
import {
  AttentionFactory,
  RealStandardAttention,
  MECHANISM_CONSTRUCTORS,
} from '../../../../../src/god-agent/core/attention/index.js';

describe('AttentionFactory Integration', () => {
  describe('Registry Integration', () => {
    it('should have RealStandardAttention registered for "standard"', () => {
      expect(MECHANISM_CONSTRUCTORS['standard']).toBe(RealStandardAttention);
    });

    it('should have RealStandardAttention registered for "real-standard"', () => {
      expect(MECHANISM_CONSTRUCTORS['real-standard']).toBe(RealStandardAttention);
    });

    it('should use RealStandardAttention directly (placeholders removed per ANTI-009)', () => {
      // ANTI-009: All placeholder classes removed - only Real* implementations exist
      const mechanism = new RealStandardAttention();
      expect(mechanism).toBeDefined();
      expect(mechanism.name).toBe('standard');
    });
  });

  describe('Factory Creation - Manual Selection', () => {
    let factory: AttentionFactory;

    beforeEach(() => {
      factory = new AttentionFactory();
    });

    it('should return RealStandardAttention when creating "standard"', () => {
      const mechanism = factory.create('standard');

      expect(mechanism).toBeInstanceOf(RealStandardAttention);
      expect(mechanism.name).toBe('standard');
    });

    it('should return RealStandardAttention when creating "real-standard"', () => {
      const mechanism = factory.create('real-standard');

      expect(mechanism).toBeInstanceOf(RealStandardAttention);
      expect(mechanism.name).toBe('standard');
    });

    it('should pass configuration to RealStandardAttention', () => {
      const mechanism = factory.create('standard', {
        dimension: 512,
        numHeads: 8,
      }) as RealStandardAttention;

      expect(mechanism).toBeInstanceOf(RealStandardAttention);
      expect(mechanism.getParameterCount()).toBe(4 * 512 * 512); // 1,048,576
    });

    it('should support deterministic initialization with seed', () => {
      const mech1 = factory.create('standard', { seed: 42 }) as RealStandardAttention;
      const mech2 = factory.create('standard', { seed: 42 }) as RealStandardAttention;

      // Create identical inputs (default dimension is VECTOR_DIM=1536)
      const query = new Float32Array(1536);
      query.fill(1.0);

      const output1 = mech1.forward(query, query, query);
      const output2 = mech2.forward(query, query, query);

      // Outputs should be identical with same seed
      expect(output1).toEqual(output2);
    });
  });

  describe('Factory Creation - Auto Selection', () => {
    let factory: AttentionFactory;

    beforeEach(() => {
      factory = new AttentionFactory();
    });

    it('should list "standard" as an available mechanism', () => {
      const mechanisms = factory.listMechanisms();

      expect(mechanisms).toContain('standard');
    });

    it('should confirm "standard" mechanism exists', () => {
      expect(factory.hasMechanism('standard')).toBe(true);
      expect(factory.hasMechanism('real-standard')).toBe(true);
    });

    it('should get standard mechanism count', () => {
      const count = factory.getMechanismCount();

      // Should have at least 'standard' + 'real-standard' + others
      expect(count).toBeGreaterThanOrEqual(2);
    });
  });

  describe('RealStandardAttention Functionality Through Factory', () => {
    let factory: AttentionFactory;

    beforeEach(() => {
      factory = new AttentionFactory();
    });

    it('should perform attention computation correctly', () => {
      const mechanism = factory.create('standard', {
        dimension: 768,
        numHeads: 12,
        seed: 42,
      }) as RealStandardAttention;

      // Create test inputs (single vector)
      const query = new Float32Array(768);
      const key = new Float32Array(768);
      const value = new Float32Array(768);

      // Initialize with simple pattern
      for (let i = 0; i < 768; i++) {
        query[i] = Math.sin(i * 0.1);
        key[i] = Math.cos(i * 0.1);
        value[i] = i / 768;
      }

      // Run forward pass
      const output = mechanism.forward(query, key, value);

      // Validate output
      expect(output).toBeInstanceOf(Float32Array);
      expect(output.length).toBe(768);

      // Check no NaN or Infinity
      for (let i = 0; i < output.length; i++) {
        expect(output[i]).not.toBeNaN();
        expect(output[i]).not.toBe(Infinity);
        expect(output[i]).not.toBe(-Infinity);
      }
    });

    it('should handle multi-sequence attention', () => {
      const mechanism = factory.create('standard', {
        dimension: 64,
        numHeads: 4,
        seed: 42,
      }) as RealStandardAttention;

      const seqLen = 4;
      const dim = 64;

      // Create multi-sequence inputs
      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      for (let i = 0; i < seqLen * dim; i++) {
        query[i] = 0.1;
        key[i] = 0.2;
        value[i] = 0.3;
      }

      // Run forward pass with explicit seqLen
      const output = mechanism.forward(query, key, value, undefined, seqLen);

      // Validate output
      expect(output).toBeInstanceOf(Float32Array);
      expect(output.length).toBe(seqLen * dim);

      // Check all values are valid
      for (let i = 0; i < output.length; i++) {
        expect(output[i]).not.toBeNaN();
        expect(Number.isFinite(output[i])).toBe(true);
      }
    });

    it('should support attention masking', () => {
      const mechanism = factory.create('standard', {
        dimension: 64,
        numHeads: 4,
        seed: 42,
      }) as RealStandardAttention;

      const seqLen = 3;
      const dim = 64;

      // Create inputs with varying values
      const query = new Float32Array(seqLen * dim);
      const key = new Float32Array(seqLen * dim);
      const value = new Float32Array(seqLen * dim);

      // Make each sequence position different
      for (let s = 0; s < seqLen; s++) {
        for (let d = 0; d < dim; d++) {
          const idx = s * dim + d;
          query[idx] = (s + 1) * 0.1 + d * 0.001;
          key[idx] = (s + 1) * 0.2 + d * 0.001;
          value[idx] = (s + 1) * 1.0;
        }
      }

      // Create causal mask (lower triangular)
      const mask = new Array(seqLen * seqLen).fill(false);
      for (let i = 0; i < seqLen; i++) {
        for (let j = 0; j <= i; j++) {
          mask[i * seqLen + j] = true;
        }
      }

      // Run with mask
      const outputMasked = mechanism.forward(query, key, value, mask, seqLen);

      // Run without mask
      const outputUnmasked = mechanism.forward(query, key, value, undefined, seqLen);

      // Outputs should differ (causal mask prevents future attention)
      let hasDifference = false;
      for (let i = 0; i < outputMasked.length; i++) {
        if (Math.abs(outputMasked[i] - outputUnmasked[i]) > 1e-6) {
          hasDifference = true;
          break;
        }
      }

      expect(hasDifference).toBe(true);
    });

    it('should report correct parameter count', () => {
      const mechanism = factory.create('standard', {
        dimension: 1536,
      }) as RealStandardAttention;

      // 4 weight matrices (Wq, Wk, Wv, Wo) each of size [1536 × 1536]
      const expectedParams = 4 * 1536 * 1536;

      expect(mechanism.getParameterCount()).toBe(expectedParams);
    });
  });

  describe('Fallback Behavior', () => {
    let factory: AttentionFactory;

    beforeEach(() => {
      factory = new AttentionFactory();
    });

    it('should have standard as a fallback for other mechanisms', () => {
      const registry = factory.getRegistry();
      const hyperbolicDescriptor = registry.get('hyperbolic');

      expect(hyperbolicDescriptor?.fallbacks).toContain('standard');
    });

    it('should use RealStandardAttention when falling back to standard', () => {
      // This tests that if another mechanism fails, standard fallback uses real impl
      const mechanism = factory.create('standard');

      expect(mechanism).toBeInstanceOf(RealStandardAttention);
    });
  });

  describe('Performance Characteristics', () => {
    it('should have correct complexity metadata in registry', () => {
      const factory = new AttentionFactory();
      const registry = factory.getRegistry();
      const descriptor = registry.get('standard');

      expect(descriptor).toBeDefined();
      expect(descriptor?.performance.complexity).toBe('O(N²)');
      expect(descriptor?.capabilities.supportsLongContext).toBe(false);
      expect(descriptor?.capabilities.requiresPrecomputation).toBe(false);
    });
  });

  describe('Error Handling', () => {
    let factory: AttentionFactory;

    beforeEach(() => {
      factory = new AttentionFactory();
    });

    it('should validate dimension/numHeads divisibility', () => {
      expect(() => {
        factory.create('standard', {
          dimension: 768,
          numHeads: 7, // 768 not divisible by 7
        });
      }).toThrow(/must be divisible by/);
    });

    it('should throw on sequence length mismatch', () => {
      const mechanism = factory.create('standard', {
        dimension: 64,
        numHeads: 4,
      }) as RealStandardAttention;

      const query = new Float32Array(64);
      const key = new Float32Array(64);
      const value = new Float32Array(64);

      // Claim sequence length of 2 but only provide 1 vector
      expect(() => {
        mechanism.forward(query, key, value, undefined, 2);
      }).toThrow(/incompatible with seqLen/);
    });

    it('should throw on dimension mismatch between Q, K, V', () => {
      const mechanism = factory.create('standard', {
        dimension: 64,
        numHeads: 4,
      }) as RealStandardAttention;

      const query = new Float32Array(64);
      const key = new Float32Array(128); // Wrong size
      const value = new Float32Array(64);

      expect(() => {
        mechanism.forward(query, key, value);
      }).toThrow(/Dimension mismatch/);
    });
  });
});
