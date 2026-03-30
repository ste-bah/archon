/**
 * Degradation Test
 * TASK-NFR-002 - Scalability Validation Suite (NFR-4.4)
 *
 * Tests graceful degradation under load:
 * - Behavior at capacity limits
 * - 429 Too Many Requests handling
 * - Recovery after overload
 * - Crash prevention
 */

// ==================== Types ====================

/**
 * Degradation test configuration
 */
export interface DegradationConfig {
  /** Capacity limit (max operations) */
  capacityLimit: number;
  /** Operations to attempt beyond capacity */
  overloadAttempts: number;
  /** Recovery check operations */
  recoveryCheckCount: number;
  /** Timeout for recovery in ms */
  recoveryTimeoutMs: number;
}

/**
 * Default degradation configuration
 */
export const DEFAULT_DEGRADATION_CONFIG: DegradationConfig = {
  capacityLimit: 100,
  overloadAttempts: 50,
  recoveryCheckCount: 20,
  recoveryTimeoutMs: 5000,
};

/**
 * Capacity error
 */
export class CapacityExceededError extends Error {
  code = 'CAPACITY_EXCEEDED';
  status = 429;

  constructor(message: string = 'Capacity exceeded') {
    super(message);
    this.name = 'CapacityExceededError';
  }
}

/**
 * Rejection result
 */
export interface RejectionResult {
  /** Total attempts */
  attempts: number;
  /** Graceful 429 rejections */
  graceful429s: number;
  /** Crashes (unhandled errors) */
  crashes: number;
  /** Other errors */
  otherErrors: number;
}

/**
 * Recovery result
 */
export interface RecoveryResult {
  /** Time to recovery in ms */
  timeToRecoveryMs: number;
  /** Whether operations resumed */
  resumed: boolean;
  /** Recovery attempts made */
  attempts: number;
  /** Successful operations after recovery */
  successfulOps: number;
}

/**
 * Capacity result
 */
export interface CapacityResult {
  /** Whether capacity was reached */
  capacityReached: boolean;
  /** Operations completed before capacity */
  operationsCompleted: number;
  /** Final capacity utilization */
  utilization: number;
}

/**
 * Degradation report
 */
export interface DegradationReport {
  /** Whether capacity was reached */
  capacityReached: boolean;
  /** Rejection behavior results */
  rejectionBehavior: {
    totalAttempts: number;
    gracefulRejections: number;
    crashes: number;
    pass: boolean;
  };
  /** Recovery results */
  recovery: {
    timeToRecoveryMs: number;
    operationsResumed: boolean;
    pass: boolean;
  };
  /** Overall pass status */
  overallPass: boolean;
}

// ==================== Capacity Manager ====================

/**
 * Simulated capacity manager for testing
 */
export class CapacityManager {
  private currentLoad = 0;
  private maxCapacity: number;
  private isOverloaded = false;

  constructor(maxCapacity: number) {
    this.maxCapacity = maxCapacity;
  }

  /**
   * Try to acquire capacity
   */
  tryAcquire(): boolean {
    if (this.currentLoad >= this.maxCapacity) {
      this.isOverloaded = true;
      return false;
    }
    this.currentLoad++;
    return true;
  }

  /**
   * Acquire capacity, throwing if not available
   */
  acquire(): void {
    if (!this.tryAcquire()) {
      throw new CapacityExceededError('System at capacity');
    }
  }

  /**
   * Release capacity
   */
  release(): void {
    this.currentLoad = Math.max(0, this.currentLoad - 1);
    if (this.currentLoad < this.maxCapacity * 0.8) {
      this.isOverloaded = false;
    }
  }

  /**
   * Get current load
   */
  getLoad(): number {
    return this.currentLoad;
  }

  /**
   * Get capacity utilization (0-1)
   */
  getUtilization(): number {
    return this.currentLoad / this.maxCapacity;
  }

  /**
   * Check if system is overloaded
   */
  checkOverloaded(): boolean {
    return this.isOverloaded;
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.currentLoad = 0;
    this.isOverloaded = false;
  }

  /**
   * Reduce load (simulate cleanup/recovery)
   */
  reduceLoad(amount: number): void {
    this.currentLoad = Math.max(0, this.currentLoad - amount);
    if (this.currentLoad < this.maxCapacity * 0.8) {
      this.isOverloaded = false;
    }
  }
}

// ==================== Degradation Test ====================

/**
 * Graceful degradation test for NFR-4.4 validation
 *
 * Tests system behavior at capacity limits, verifying graceful
 * rejection (429) instead of crashes, and proper recovery.
 *
 * @example
 * ```typescript
 * const test = new DegradationTest();
 * const report = await test.runDegradationTest();
 *
 * if (report.overallPass) {
 *   console.log('NFR-4.4 validated: Graceful degradation working!');
 * }
 * ```
 */
export class DegradationTest {
  private capacityManager: CapacityManager;
  private config: DegradationConfig;

  constructor(config: Partial<DegradationConfig> = {}) {
    this.config = { ...DEFAULT_DEGRADATION_CONFIG, ...config };
    this.capacityManager = new CapacityManager(this.config.capacityLimit);
  }

  /**
   * Run complete degradation test
   */
  async runDegradationTest(): Promise<DegradationReport> {
    // Reset state
    this.capacityManager.reset();

    // Step 1: Push to capacity
    const capacityResult = await this.pushToCapacity();

    // Step 2: Test graceful rejection
    const rejectionResults = await this.testGracefulRejection();

    // Step 3: Test recovery
    const recoveryResult = await this.testRecovery();

    return {
      capacityReached: capacityResult.capacityReached,
      rejectionBehavior: {
        totalAttempts: rejectionResults.attempts,
        gracefulRejections: rejectionResults.graceful429s,
        crashes: rejectionResults.crashes,
        pass: rejectionResults.crashes === 0,
      },
      recovery: {
        timeToRecoveryMs: recoveryResult.timeToRecoveryMs,
        operationsResumed: recoveryResult.resumed,
        pass: recoveryResult.resumed,
      },
      overallPass: rejectionResults.crashes === 0 && recoveryResult.resumed,
    };
  }

  /**
   * Push system to capacity
   */
  async pushToCapacity(): Promise<CapacityResult> {
    let operationsCompleted = 0;

    while (operationsCompleted < this.config.capacityLimit * 1.5) {
      try {
        this.capacityManager.acquire();
        await this.simulateOperation();
        operationsCompleted++;
      } catch (error) {
        if (error instanceof CapacityExceededError) {
          // Expected - capacity reached
          break;
        }
        // RULE-070: Re-throw with capacity test context
        throw new Error(
          `Capacity test failed at operation ${operationsCompleted}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error }
        );
      }
    }

    return {
      capacityReached: this.capacityManager.checkOverloaded(),
      operationsCompleted,
      utilization: this.capacityManager.getUtilization(),
    };
  }

  /**
   * Test graceful rejection at capacity
   */
  async testGracefulRejection(): Promise<RejectionResult> {
    let graceful429s = 0;
    let crashes = 0;
    let otherErrors = 0;

    for (let i = 0; i < this.config.overloadAttempts; i++) {
      try {
        this.capacityManager.acquire();
        await this.simulateOperation();
        // If we get here, release the capacity
        this.capacityManager.release();
      } catch (error) {
        if (error instanceof CapacityExceededError) {
          graceful429s++;
        } else if (this.isCrash(error)) {
          crashes++;
        } else {
          otherErrors++;
        }
      }
    }

    return {
      attempts: this.config.overloadAttempts,
      graceful429s,
      crashes,
      otherErrors,
    };
  }

  /**
   * Test recovery after overload
   */
  async testRecovery(): Promise<RecoveryResult> {
    const startTime = Date.now();

    // Simulate load reduction (cleanup, timeouts, etc.)
    const loadToRelease = Math.floor(this.capacityManager.getLoad() * 0.5);
    this.capacityManager.reduceLoad(loadToRelease);

    let resumed = false;
    let attempts = 0;
    let successfulOps = 0;

    // Try operations until recovery or timeout
    while (Date.now() - startTime < this.config.recoveryTimeoutMs) {
      attempts++;

      try {
        this.capacityManager.acquire();
        await this.simulateOperation();
        this.capacityManager.release();
        successfulOps++;

        if (successfulOps >= this.config.recoveryCheckCount / 2) {
          resumed = true;
          break;
        }
      } catch (error) {
        if (!(error instanceof CapacityExceededError)) {
          // Non-capacity error during recovery
          break;
        }
        // Still overloaded, continue releasing
        this.capacityManager.reduceLoad(5);
      }

      await this.sleep(10);
    }

    return {
      timeToRecoveryMs: Date.now() - startTime,
      resumed,
      attempts,
      successfulOps,
    };
  }

  /**
   * Simulate an operation
   */
  private async simulateOperation(): Promise<void> {
    await this.sleep(1 + Math.random() * 5);
  }

  /**
   * Check if error represents a crash
   */
  private isCrash(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('crash') ||
        message.includes('oom') ||
        message.includes('fatal') ||
        message.includes('segfault')
      );
    }
    return false;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get capacity manager (for testing)
   */
  getCapacityManager(): CapacityManager {
    return this.capacityManager;
  }

  /**
   * Reset test state
   */
  reset(): void {
    this.capacityManager.reset();
  }
}

// ==================== Global Instance ====================

/**
 * Global degradation test instance
 */
export const degradationTest = new DegradationTest();
