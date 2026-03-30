/**
 * Concurrency Tracker Utilities
 * TASK-NFR-002 - Scalability Validation Suite
 *
 * Provides concurrency monitoring:
 * - Active operation counting
 * - Peak concurrency detection
 * - Contention event logging
 */

// ==================== Types ====================

/**
 * Contention event
 */
export interface ContentionEvent {
  /** Operation ID */
  operationId: string;
  /** Type of contention */
  type: 'lock' | 'queue' | 'resource' | 'timeout';
  /** Wait time in ms */
  waitTimeMs: number;
  /** Resource involved */
  resource?: string;
  /** Timestamp */
  timestamp: number;
}

/**
 * Concurrency statistics
 */
export interface ConcurrencyStats {
  /** Current active operations */
  current: number;
  /** Peak concurrent operations */
  peak: number;
  /** Total operations tracked */
  total: number;
  /** Average concurrency level */
  average: number;
  /** Contention event count */
  contentionCount: number;
  /** Total wait time from contention */
  totalWaitTimeMs: number;
}

// ==================== Concurrency Tracker ====================

/**
 * Tracks concurrent operations and detects contention
 *
 * @example
 * ```typescript
 * const tracker = new ConcurrencyTracker();
 *
 * // Track an operation
 * const handle = tracker.enter('operation_1');
 * try {
 *   await doWork();
 * } finally {
 *   handle.exit();
 * }
 *
 * // Check stats
 * const stats = tracker.getStats();
 * console.log(`Peak concurrency: ${stats.peak}`);
 * ```
 */
export class ConcurrencyTracker {
  private currentCount = 0;
  private peakCount = 0;
  private totalCount = 0;
  private concurrencySum = 0;
  private sampleCount = 0;
  private contentionEvents: ContentionEvent[] = [];
  private maxContentionHistory: number;
  private activeOperations: Map<string, { startTime: number; resource?: string }> = new Map();

  constructor(options: { maxContentionHistory?: number } = {}) {
    this.maxContentionHistory = options.maxContentionHistory ?? 1000;
  }

  /**
   * Get current concurrency level
   */
  get current(): number {
    return this.currentCount;
  }

  /**
   * Get peak concurrency level
   */
  get peak(): number {
    return this.peakCount;
  }

  /**
   * Enter a tracked operation
   *
   * @param operationId - Unique operation identifier
   * @param resource - Optional resource being accessed
   * @returns Handle to exit the operation
   */
  enter(operationId?: string, resource?: string): OperationHandle {
    const id = operationId ?? `op_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const startTime = Date.now();

    this.currentCount++;
    this.totalCount++;
    this.peakCount = Math.max(this.peakCount, this.currentCount);
    this.concurrencySum += this.currentCount;
    this.sampleCount++;

    this.activeOperations.set(id, { startTime, resource });

    return {
      operationId: id,
      startTime,
      exit: () => this.exit(id),
      reportContention: (type: ContentionEvent['type'], waitTimeMs: number) =>
        this.reportContention(id, type, waitTimeMs, resource),
    };
  }

  /**
   * Exit a tracked operation
   */
  exit(operationId: string): void {
    if (this.activeOperations.has(operationId)) {
      this.activeOperations.delete(operationId);
      this.currentCount = Math.max(0, this.currentCount - 1);
    }
  }

  /**
   * Report a contention event
   */
  reportContention(
    operationId: string,
    type: ContentionEvent['type'],
    waitTimeMs: number,
    resource?: string
  ): void {
    const event: ContentionEvent = {
      operationId,
      type,
      waitTimeMs,
      resource,
      timestamp: Date.now(),
    };

    this.contentionEvents.push(event);

    // Trim history if needed
    if (this.contentionEvents.length > this.maxContentionHistory) {
      this.contentionEvents.shift();
    }
  }

  /**
   * Get concurrency statistics
   */
  getStats(): ConcurrencyStats {
    const totalWaitTimeMs = this.contentionEvents.reduce((sum, e) => sum + e.waitTimeMs, 0);

    return {
      current: this.currentCount,
      peak: this.peakCount,
      total: this.totalCount,
      average: this.sampleCount > 0 ? this.concurrencySum / this.sampleCount : 0,
      contentionCount: this.contentionEvents.length,
      totalWaitTimeMs,
    };
  }

  /**
   * Get contention events
   */
  getContentionEvents(): ContentionEvent[] {
    return [...this.contentionEvents];
  }

  /**
   * Get active operations
   */
  getActiveOperations(): { operationId: string; startTime: number; resource?: string }[] {
    return Array.from(this.activeOperations.entries()).map(([operationId, info]) => ({
      operationId,
      ...info,
    }));
  }

  /**
   * Check for potential contention (high concurrency)
   */
  isContended(threshold: number = 10): boolean {
    return this.currentCount >= threshold;
  }

  /**
   * Reset all statistics
   */
  reset(): void {
    this.currentCount = 0;
    this.peakCount = 0;
    this.totalCount = 0;
    this.concurrencySum = 0;
    this.sampleCount = 0;
    this.contentionEvents = [];
    this.activeOperations.clear();
  }

  /**
   * Get formatted report
   */
  getReport(): string {
    const stats = this.getStats();

    return [
      `Concurrency Report:`,
      `  Current: ${stats.current}`,
      `  Peak: ${stats.peak}`,
      `  Total Operations: ${stats.total}`,
      `  Average Concurrency: ${stats.average.toFixed(2)}`,
      `  Contention Events: ${stats.contentionCount}`,
      `  Total Wait Time: ${stats.totalWaitTimeMs.toFixed(2)}ms`,
    ].join('\n');
  }
}

/**
 * Operation handle for tracking
 */
export interface OperationHandle {
  /** Operation ID */
  operationId: string;
  /** Start time */
  startTime: number;
  /** Exit the operation */
  exit: () => void;
  /** Report contention during operation */
  reportContention: (type: ContentionEvent['type'], waitTimeMs: number) => void;
}

// ==================== Semaphore ====================

/**
 * Async semaphore for limiting concurrency
 */
export class AsyncSemaphore {
  private permits: number;
  private maxPermits: number;
  private queue: Array<() => void> = [];

  constructor(maxPermits: number) {
    this.maxPermits = maxPermits;
    this.permits = maxPermits;
  }

  /**
   * Acquire a permit
   */
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>(resolve => {
      this.queue.push(resolve);
    });
  }

  /**
   * Release a permit
   */
  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits = Math.min(this.permits + 1, this.maxPermits);
    }
  }

  /**
   * Get available permits
   */
  available(): number {
    return this.permits;
  }

  /**
   * Get waiting count
   */
  waiting(): number {
    return this.queue.length;
  }

  /**
   * Run a function with semaphore protection
   */
  async withPermit<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// ==================== Rate Limiter ====================

/**
 * Token bucket rate limiter
 */
export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number; // tokens per second
  private lastRefill: number;

  constructor(maxTokens: number, refillRate: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  /**
   * Try to acquire a token
   */
  tryAcquire(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens--;
      return true;
    }
    return false;
  }

  /**
   * Wait to acquire a token
   */
  async acquire(): Promise<void> {
    while (!this.tryAcquire()) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  /**
   * Get current token count
   */
  available(): number {
    this.refill();
    return this.tokens;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

// ==================== Global Instance ====================

/**
 * Global concurrency tracker instance
 */
export const concurrencyTracker = new ConcurrencyTracker();
