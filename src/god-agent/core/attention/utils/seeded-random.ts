/**
 * Seeded Random Number Generator
 * Uses Linear Congruential Generator (LCG) for deterministic sequences.
 *
 * Reference: Numerical Recipes in C (Press et al.)
 *
 * NOT cryptographically secure - for weight initialization testing only.
 */

/**
 * Simple Linear Congruential Generator for deterministic testing
 *
 * @example
 * ```typescript
 * const rng = new SeededRandom(42);
 * const value1 = rng.next(); // 0.388... (deterministic)
 * const value2 = rng.next(); // 0.776... (deterministic)
 * ```
 */
export class SeededRandom {
  private state: number;

  /**
   * Initialize with seed value
   * @param seed Integer seed (0 to 2^32-1)
   */
  constructor(seed: number) {
    // Ensure seed is positive integer
    this.state = Math.abs(Math.floor(seed)) % 4294967296;
  }

  /**
   * Generate next random number in [0, 1)
   *
   * LCG formula: X_{n+1} = (a * X_n + c) mod m
   * Parameters from Numerical Recipes:
   * - a = 1664525 (multiplier)
   * - c = 1013904223 (increment)
   * - m = 2^32 (modulus)
   *
   * @returns Pseudo-random number in [0, 1)
   */
  next(): number {
    // LCG: state = (1664525 * state + 1013904223) mod 2^32
    this.state = (this.state * 1664525 + 1013904223) % 4294967296;
    return this.state / 4294967296;
  }

  /**
   * Reset generator to initial seed state
   * @param seed New seed value
   */
  reset(seed: number): void {
    this.state = Math.abs(Math.floor(seed)) % 4294967296;
  }

  /**
   * Get current internal state (for debugging)
   */
  getState(): number {
    return this.state;
  }
}
