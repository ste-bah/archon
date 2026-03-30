import { describe, it, expect, beforeEach } from 'vitest';
import { SeededRandom } from '../../../../../src/god-agent/core/attention/utils/seeded-random.js';

describe('SeededRandom', () => {
  describe('deterministic behavior', () => {
    it('should produce identical sequences with same seed', () => {
      const rng1 = new SeededRandom(42);
      const rng2 = new SeededRandom(42);

      const sequence1 = Array.from({ length: 100 }, () => rng1.next());
      const sequence2 = Array.from({ length: 100 }, () => rng2.next());

      expect(sequence1).toEqual(sequence2);
    });

    it('should produce different sequences with different seeds', () => {
      const rng1 = new SeededRandom(42);
      const rng2 = new SeededRandom(123);

      const sequence1 = Array.from({ length: 100 }, () => rng1.next());
      const sequence2 = Array.from({ length: 100 }, () => rng2.next());

      expect(sequence1).not.toEqual(sequence2);
    });

    it('should restore initial state after reset', () => {
      const rng = new SeededRandom(42);
      const initial = Array.from({ length: 10 }, () => rng.next());

      // Generate more values
      Array.from({ length: 50 }, () => rng.next());

      // Reset and generate again
      rng.reset(42);
      const afterReset = Array.from({ length: 10 }, () => rng.next());

      expect(afterReset).toEqual(initial);
    });
  });

  describe('value range', () => {
    it('should generate values in range [0, 1)', () => {
      const rng = new SeededRandom(42);
      const values = Array.from({ length: 1000 }, () => rng.next());

      values.forEach(value => {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      });
    });

    it('should not generate exactly 0 or 1', () => {
      const rng = new SeededRandom(42);
      const values = Array.from({ length: 10000 }, () => rng.next());

      expect(values).not.toContain(0);
      expect(values).not.toContain(1);
    });
  });

  describe('edge case seeds', () => {
    it('should handle seed 0', () => {
      const rng = new SeededRandom(0);
      const values = Array.from({ length: 100 }, () => rng.next());

      values.forEach(value => {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      });
    });

    it('should handle negative seed', () => {
      const rng = new SeededRandom(-1);
      const values = Array.from({ length: 100 }, () => rng.next());

      values.forEach(value => {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      });
    });

    it('should handle MAX_SAFE_INTEGER seed', () => {
      const rng = new SeededRandom(Number.MAX_SAFE_INTEGER);
      const values = Array.from({ length: 100 }, () => rng.next());

      values.forEach(value => {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      });
    });

    it('should handle large negative seed', () => {
      const rng = new SeededRandom(-999999);
      const values = Array.from({ length: 100 }, () => rng.next());

      values.forEach(value => {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      });
    });
  });

  describe('state management', () => {
    it('should advance state with each call', () => {
      const rng = new SeededRandom(42);
      const values = Array.from({ length: 100 }, () => rng.next());

      // Check that consecutive values are different (no stuck state)
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).not.toBe(values[i - 1]);
      }
    });

    it('should maintain separate state for different instances', () => {
      const rng1 = new SeededRandom(42);
      const rng2 = new SeededRandom(42);

      // Advance rng1
      Array.from({ length: 50 }, () => rng1.next());

      // rng2 should still be at start
      const value1 = rng1.next();
      const value2 = rng2.next();

      expect(value1).not.toBe(value2);
    });
  });

  describe('statistical distribution', () => {
    it('should produce approximately uniform distribution', () => {
      const rng = new SeededRandom(42);
      const values = Array.from({ length: 10000 }, () => rng.next());

      // Check distribution across 10 buckets
      const buckets = new Array(10).fill(0);
      values.forEach(value => {
        const bucketIndex = Math.floor(value * 10);
        buckets[bucketIndex]++;
      });

      // Each bucket should have roughly 1000 values (±15%)
      buckets.forEach(count => {
        expect(count).toBeGreaterThan(850);
        expect(count).toBeLessThan(1150);
      });
    });

    it('should have mean approximately 0.5', () => {
      const rng = new SeededRandom(42);
      const values = Array.from({ length: 10000 }, () => rng.next());

      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      expect(mean).toBeGreaterThan(0.48);
      expect(mean).toBeLessThan(0.52);
    });
  });

  describe('reproducibility', () => {
    it('should produce same sequence after multiple resets', () => {
      const rng = new SeededRandom(42);

      const sequence1 = Array.from({ length: 10 }, () => rng.next());
      rng.reset(42);
      const sequence2 = Array.from({ length: 10 }, () => rng.next());
      rng.reset(42);
      const sequence3 = Array.from({ length: 10 }, () => rng.next());

      expect(sequence1).toEqual(sequence2);
      expect(sequence2).toEqual(sequence3);
    });

    it('should allow partial sequence replay', () => {
      const rng = new SeededRandom(42);

      const first5 = Array.from({ length: 5 }, () => rng.next());
      rng.reset(42);
      const replay = Array.from({ length: 5 }, () => rng.next());

      expect(replay).toEqual(first5);
    });
  });

  describe('getState', () => {
    it('should return current internal state', () => {
      const rng = new SeededRandom(42);
      const initialState = rng.getState();

      rng.next();
      const afterNext = rng.getState();

      expect(afterNext).not.toBe(initialState);
      expect(typeof afterNext).toBe('number');
      expect(afterNext).toBeGreaterThanOrEqual(0);
    });

    it('should return same state for same sequence of operations', () => {
      const rng1 = new SeededRandom(42);
      const rng2 = new SeededRandom(42);

      rng1.next();
      rng1.next();
      rng2.next();
      rng2.next();

      expect(rng1.getState()).toBe(rng2.getState());
    });
  });
});
