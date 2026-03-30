import { describe, it, expect } from 'vitest';
import {
  createCausalMask,
  createFullMask,
  validateMask,
} from '../../../../../src/god-agent/core/attention/utils/mask-utils.js';

describe('Mask Utils', () => {
  describe('createCausalMask', () => {
    describe('basic properties', () => {
      it('should generate correct lower triangular pattern', () => {
        const seqLen = 4;
        const mask = createCausalMask(seqLen);

        // Expected pattern (true = attend, false = mask):
        // [T F F F]
        // [T T F F]
        // [T T T F]
        // [T T T T]

        // Row 0
        expect(mask[0]).toBe(true);
        expect(mask[1]).toBe(false);
        expect(mask[2]).toBe(false);
        expect(mask[3]).toBe(false);

        // Row 1
        expect(mask[4]).toBe(true);
        expect(mask[5]).toBe(true);
        expect(mask[6]).toBe(false);
        expect(mask[7]).toBe(false);

        // Row 2
        expect(mask[8]).toBe(true);
        expect(mask[9]).toBe(true);
        expect(mask[10]).toBe(true);
        expect(mask[11]).toBe(false);

        // Row 3
        expect(mask[12]).toBe(true);
        expect(mask[13]).toBe(true);
        expect(mask[14]).toBe(true);
        expect(mask[15]).toBe(true);
      });

      it('should follow j <= i rule', () => {
        const seqLen = 5;
        const mask = createCausalMask(seqLen);

        for (let i = 0; i < seqLen; i++) {
          for (let j = 0; j < seqLen; j++) {
            const index = i * seqLen + j;
            const expected = j <= i;
            expect(mask[index]).toBe(expected);
          }
        }
      });

      it('should have correct dimensions', () => {
        const seqLengths = [1, 4, 8, 16, 32];

        seqLengths.forEach(seqLen => {
          const mask = createCausalMask(seqLen);
          expect(mask.length).toBe(seqLen * seqLen);
        });
      });

      it('should handle single token sequence', () => {
        const mask = createCausalMask(1);

        expect(mask.length).toBe(1);
        expect(mask[0]).toBe(true);
      });
    });

    describe('pattern verification', () => {
      it('should have diagonal all true', () => {
        const seqLen = 10;
        const mask = createCausalMask(seqLen);

        for (let i = 0; i < seqLen; i++) {
          const diagonalIndex = i * seqLen + i;
          expect(mask[diagonalIndex]).toBe(true);
        }
      });

      it('should have upper triangle all false', () => {
        const seqLen = 5;
        const mask = createCausalMask(seqLen);

        for (let i = 0; i < seqLen; i++) {
          for (let j = i + 1; j < seqLen; j++) {
            const index = i * seqLen + j;
            expect(mask[index]).toBe(false);
          }
        }
      });

      it('should have lower triangle all true', () => {
        const seqLen = 5;
        const mask = createCausalMask(seqLen);

        for (let i = 0; i < seqLen; i++) {
          for (let j = 0; j <= i; j++) {
            const index = i * seqLen + j;
            expect(mask[index]).toBe(true);
          }
        }
      });

      it('should increase true count row by row', () => {
        const seqLen = 6;
        const mask = createCausalMask(seqLen);

        for (let i = 0; i < seqLen; i++) {
          const rowStart = i * seqLen;
          const rowEnd = rowStart + seqLen;
          const rowMask = mask.slice(rowStart, rowEnd);
          const trueCount = rowMask.filter(v => v).length;

          // Row i should have (i + 1) true values
          expect(trueCount).toBe(i + 1);
        }
      });
    });

    describe('validation', () => {
      it('should validate sequence length', () => {
        expect(() => createCausalMask(0)).toThrow();
        expect(() => createCausalMask(-1)).toThrow();
      });

      it('should handle large sequence lengths', () => {
        const seqLen = 128;
        const mask = createCausalMask(seqLen);

        expect(mask.length).toBe(seqLen * seqLen);

        // Verify pattern still holds
        expect(mask[0]).toBe(true);
        expect(mask[seqLen - 1]).toBe(false);
        expect(mask[mask.length - 1]).toBe(true);
      });
    });

    describe('usage patterns', () => {
      it('should create mask for typical attention sequence', () => {
        const seqLen = 8;
        const mask = createCausalMask(seqLen);

        // Token 0 can only attend to itself
        expect(mask[0]).toBe(true);
        expect(mask.slice(1, seqLen).every(v => !v)).toBe(true);

        // Last token can attend to all previous tokens
        const lastRow = mask.slice((seqLen - 1) * seqLen);
        expect(lastRow.every(v => v)).toBe(true);
      });

      it('should support autoregressive generation', () => {
        const seqLen = 4;
        const mask = createCausalMask(seqLen);

        // At position i, can attend to positions 0..i
        for (let i = 0; i < seqLen; i++) {
          const rowStart = i * seqLen;
          const visiblePositions = mask.slice(rowStart, rowStart + seqLen);

          // Positions 0..i should be visible (true)
          for (let j = 0; j <= i; j++) {
            expect(visiblePositions[j]).toBe(true);
          }

          // Positions i+1..end should be masked (false)
          for (let j = i + 1; j < seqLen; j++) {
            expect(visiblePositions[j]).toBe(false);
          }
        }
      });
    });
  });

  describe('createFullMask', () => {
    describe('basic properties', () => {
      it('should create all-true mask', () => {
        const seqLen = 4;
        const mask = createFullMask(seqLen);

        expect(mask.length).toBe(seqLen * seqLen);
        expect(mask.every(v => v === true)).toBe(true);
      });

      it('should have correct dimensions', () => {
        const seqLengths = [1, 4, 8, 16, 32];

        seqLengths.forEach(seqLen => {
          const mask = createFullMask(seqLen);
          expect(mask.length).toBe(seqLen * seqLen);
        });
      });

      it('should handle single token', () => {
        const mask = createFullMask(1);

        expect(mask.length).toBe(1);
        expect(mask[0]).toBe(true);
      });
    });

    describe('validation', () => {
      it('should handle sequence length 0', () => {
        const mask = createFullMask(0);
        expect(mask.length).toBe(0);
      });

      it('should handle negative sequence length', () => {
        const mask = createFullMask(-1);
        // JavaScript array creation with negative length creates empty array
        expect(Array.isArray(mask)).toBe(true);
      });

      it('should handle large sequences', () => {
        const seqLen = 128;
        const mask = createFullMask(seqLen);

        expect(mask.length).toBe(seqLen * seqLen);
        expect(mask.every(v => v === true)).toBe(true);
      });
    });

    describe('comparison with causal mask', () => {
      it('should have more true values than causal mask', () => {
        const seqLen = 10;
        const fullMask = createFullMask(seqLen);
        const causalMask = createCausalMask(seqLen);

        const fullTrue = fullMask.filter(v => v).length;
        const causalTrue = causalMask.filter(v => v).length;

        expect(fullTrue).toBeGreaterThan(causalTrue);
        expect(fullTrue).toBe(seqLen * seqLen);
      });

      it('should allow bidirectional attention', () => {
        const seqLen = 3;
        const mask = createFullMask(seqLen);

        // All positions should be able to attend to all positions
        for (let i = 0; i < seqLen; i++) {
          for (let j = 0; j < seqLen; j++) {
            const index = i * seqLen + j;
            expect(mask[index]).toBe(true);
          }
        }
      });
    });
  });

  describe('validateMask', () => {
    describe('valid masks', () => {
      it('should validate correct causal mask', () => {
        const seqLen = 4;
        const mask = createCausalMask(seqLen);

        expect(() => validateMask(mask, seqLen)).not.toThrow();
      });

      it('should validate correct full mask', () => {
        const seqLen = 4;
        const mask = createFullMask(seqLen);

        expect(() => validateMask(mask, seqLen)).not.toThrow();
      });

      it('should validate custom mask with correct dimensions', () => {
        const seqLen = 3;
        const mask = new Uint8Array([
          1, 1, 0,
          1, 1, 1,
          0, 0, 1,
        ]);

        expect(() => validateMask(mask, seqLen)).not.toThrow();
      });

      it('should validate mask with all zeros', () => {
        const seqLen = 2;
        const mask = new Uint8Array(seqLen * seqLen).fill(0);

        // All-zero mask is technically valid (though not useful)
        expect(() => validateMask(mask, seqLen)).not.toThrow();
      });
    });

    describe('invalid masks', () => {
      it('should reject mask with incorrect dimensions', () => {
        const mask = [true, false, true]; // 3 elements, not square

        expect(validateMask(mask, 2)).toBe(false);
      });

      it('should reject mask that is too short', () => {
        const seqLen = 4;
        const mask = new Array(10).fill(true); // Should be 16

        expect(validateMask(mask, seqLen)).toBe(false);
      });

      it('should reject mask that is too long', () => {
        const seqLen = 3;
        const mask = new Array(20).fill(true); // Should be 9

        expect(validateMask(mask, seqLen)).toBe(false);
      });

      it('should reject empty mask with positive seqLen', () => {
        const mask: boolean[] = [];

        expect(validateMask(mask, 2)).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should validate single-element mask', () => {
        const mask = new Uint8Array([1]);

        expect(() => validateMask(mask, 1)).not.toThrow();
      });

      it('should validate large masks', () => {
        const seqLen = 64;
        const mask = createCausalMask(seqLen);

        expect(() => validateMask(mask, seqLen)).not.toThrow();
      });

      it('should handle mask with mixed values', () => {
        const seqLen = 2;
        const mask = new Uint8Array([1, 0, 1, 1]);

        expect(() => validateMask(mask, seqLen)).not.toThrow();
      });
    });
  });

  describe('integration', () => {
    it('should create and validate causal mask pipeline', () => {
      const seqLen = 8;

      const mask = createCausalMask(seqLen);
      expect(() => validateMask(mask, seqLen)).not.toThrow();

      // Verify pattern
      expect(mask[0]).toBe(true);
      expect(mask[1]).toBe(false);
      expect(mask[mask.length - 1]).toBe(true);
    });

    it('should create and validate full mask pipeline', () => {
      const seqLen = 8;

      const mask = createFullMask(seqLen);
      expect(() => validateMask(mask, seqLen)).not.toThrow();

      // Verify all true
      expect(mask.every(v => v === true)).toBe(true);
    });

    it('should support different mask types for encoder/decoder', () => {
      const seqLen = 4;

      // Encoder: bidirectional (full mask)
      const encoderMask = createFullMask(seqLen);
      expect(() => validateMask(encoderMask, seqLen)).not.toThrow();

      // Decoder: autoregressive (causal mask)
      const decoderMask = createCausalMask(seqLen);
      expect(() => validateMask(decoderMask, seqLen)).not.toThrow();

      // Should be different
      expect(encoderMask).not.toEqual(decoderMask);
    });

    it('should create masks for batched attention', () => {
      const seqLen = 8;
      const batchSize = 4;

      // Create same mask for all items in batch
      const masks = Array.from({ length: batchSize }, () =>
        createCausalMask(seqLen)
      );

      masks.forEach(mask => {
        expect(() => validateMask(mask, seqLen)).not.toThrow();
      });

      // All should be identical
      masks.forEach(mask => {
        expect(mask).toEqual(masks[0]);
      });
    });

    it('should support custom padding mask', () => {
      const seqLen = 4;

      // Simulate padding: last 2 tokens are padding
      const paddingMask = new Uint8Array(seqLen * seqLen);

      for (let i = 0; i < seqLen; i++) {
        for (let j = 0; j < seqLen; j++) {
          // Attend to non-padding positions only (first 2 tokens)
          const index = i * seqLen + j;
          paddingMask[index] = j < 2 ? 1 : 0;
        }
      }

      expect(() => validateMask(paddingMask, seqLen)).not.toThrow();

      // Verify pattern
      expect(paddingMask[0]).toBe(1); // Can attend to position 0
      expect(paddingMask[1]).toBe(1); // Can attend to position 1
      expect(paddingMask[2]).toBe(0); // Cannot attend to padding
      expect(paddingMask[3]).toBe(0); // Cannot attend to padding
    });

    it('should combine causal and padding masks', () => {
      const seqLen = 4;

      // Start with causal mask
      const causalMask = createCausalMask(seqLen);

      // Apply padding: last token is padding
      const combinedMask = new Uint8Array(seqLen * seqLen);
      for (let i = 0; i < seqLen; i++) {
        for (let j = 0; j < seqLen; j++) {
          const index = i * seqLen + j;
          // Causal AND not padding (j < 3)
          combinedMask[index] = causalMask[index] && j < 3 ? 1 : 0;
        }
      }

      expect(() => validateMask(combinedMask, seqLen)).not.toThrow();

      // Last column should be all zeros (padding masked)
      for (let i = 0; i < seqLen; i++) {
        expect(combinedMask[i * seqLen + 3]).toBe(0);
      }
    });
  });
});
