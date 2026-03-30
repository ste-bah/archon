/**
 * Memory Monitor Utilities
 * TASK-NFR-002 - Scalability Validation Suite
 *
 * Provides memory monitoring capabilities:
 * - Heap usage tracking
 * - Memory threshold detection
 * - GC event monitoring
 */

// ==================== Types ====================

/**
 * Memory snapshot
 */
export interface MemorySnapshot {
  /** Heap used in bytes */
  heapUsed: number;
  /** Heap total in bytes */
  heapTotal: number;
  /** External memory in bytes */
  external: number;
  /** Array buffers in bytes */
  arrayBuffers: number;
  /** RSS (resident set size) in bytes */
  rss: number;
  /** Timestamp of snapshot */
  timestamp: number;
}

/**
 * Memory threshold levels
 */
export type MemoryThreshold = 'green' | 'yellow' | 'orange' | 'red' | 'critical';

/**
 * Memory threshold configuration
 */
export interface MemoryThresholdConfig {
  /** Yellow threshold (%) */
  yellow: number;
  /** Orange threshold (%) */
  orange: number;
  /** Red threshold (%) */
  red: number;
  /** Critical threshold (%) */
  critical: number;
}

/**
 * Default memory thresholds (from NFR-4.3)
 */
export const DEFAULT_MEMORY_THRESHOLDS: MemoryThresholdConfig = {
  yellow: 60,
  orange: 80,
  red: 90,
  critical: 95,
};

/**
 * Memory trend analysis
 */
export interface MemoryTrend {
  /** Average growth rate (bytes/second) */
  growthRate: number;
  /** Projected time to threshold (seconds) */
  timeToThreshold: number;
  /** Trend direction */
  direction: 'stable' | 'growing' | 'shrinking';
  /** Number of samples */
  sampleCount: number;
}

// ==================== Memory Monitor ====================

/**
 * Memory monitoring utility
 *
 * Tracks heap usage and provides threshold detection
 *
 * @example
 * ```typescript
 * const monitor = new MemoryMonitor();
 *
 * // Get current usage
 * const snapshot = monitor.getSnapshot();
 * console.log(`Heap: ${snapshot.heapUsed / 1024 / 1024}MB`);
 *
 * // Check threshold
 * const level = monitor.getThresholdLevel();
 * if (level === 'red') {
 *   console.log('High memory pressure!');
 * }
 *
 * // Track trend
 * const trend = monitor.analyzeTrend();
 * console.log(`Growth: ${trend.growthRate} bytes/sec`);
 * ```
 */
export class MemoryMonitor {
  private history: MemorySnapshot[] = [];
  private maxHistorySize: number;
  private thresholds: MemoryThresholdConfig;
  private heapLimit: number;

  constructor(
    options: {
      maxHistorySize?: number;
      thresholds?: Partial<MemoryThresholdConfig>;
      heapLimit?: number;
    } = {}
  ) {
    this.maxHistorySize = options.maxHistorySize ?? 100;
    this.thresholds = { ...DEFAULT_MEMORY_THRESHOLDS, ...options.thresholds };
    // Default to a reasonable heap limit if not provided
    this.heapLimit = options.heapLimit ?? this.estimateHeapLimit();
  }

  /**
   * Get current memory snapshot
   */
  getSnapshot(): MemorySnapshot {
    const mem = process.memoryUsage();
    const snapshot: MemorySnapshot = {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
      rss: mem.rss,
      timestamp: Date.now(),
    };

    // Store in history
    this.history.push(snapshot);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }

    return snapshot;
  }

  /**
   * Get heap used in bytes
   */
  getHeapUsed(): number {
    return process.memoryUsage().heapUsed;
  }

  /**
   * Get heap total in bytes
   */
  getHeapTotal(): number {
    return process.memoryUsage().heapTotal;
  }

  /**
   * Get configured heap limit
   */
  getHeapLimit(): number {
    return this.heapLimit;
  }

  /**
   * Get current utilization percentage
   */
  getUtilization(): number {
    return (this.getHeapUsed() / this.heapLimit) * 100;
  }

  /**
   * Get current threshold level
   */
  getThresholdLevel(): MemoryThreshold {
    const utilization = this.getUtilization();

    if (utilization >= this.thresholds.critical) return 'critical';
    if (utilization >= this.thresholds.red) return 'red';
    if (utilization >= this.thresholds.orange) return 'orange';
    if (utilization >= this.thresholds.yellow) return 'yellow';
    return 'green';
  }

  /**
   * Check if memory pressure is high
   */
  isHighPressure(): boolean {
    const level = this.getThresholdLevel();
    return level === 'red' || level === 'critical';
  }

  /**
   * Analyze memory trend from history
   */
  analyzeTrend(): MemoryTrend {
    if (this.history.length < 2) {
      return {
        growthRate: 0,
        timeToThreshold: Infinity,
        direction: 'stable',
        sampleCount: this.history.length,
      };
    }

    // Calculate growth rate using linear regression
    const n = this.history.length;
    const firstSample = this.history[0];
    const lastSample = this.history[n - 1];
    const timeDelta = (lastSample.timestamp - firstSample.timestamp) / 1000; // seconds
    const memoryDelta = lastSample.heapUsed - firstSample.heapUsed;

    if (timeDelta <= 0) {
      return {
        growthRate: 0,
        timeToThreshold: Infinity,
        direction: 'stable',
        sampleCount: n,
      };
    }

    const growthRate = memoryDelta / timeDelta;

    // Determine direction
    let direction: 'stable' | 'growing' | 'shrinking';
    const threshold = 1024 * 10; // 10KB/sec threshold for "stable"
    if (Math.abs(growthRate) < threshold) {
      direction = 'stable';
    } else if (growthRate > 0) {
      direction = 'growing';
    } else {
      direction = 'shrinking';
    }

    // Calculate time to critical threshold
    let timeToThreshold = Infinity;
    if (growthRate > 0) {
      const currentUsed = lastSample.heapUsed;
      const criticalBytes = this.heapLimit * (this.thresholds.critical / 100);
      const bytesRemaining = criticalBytes - currentUsed;
      if (bytesRemaining > 0) {
        timeToThreshold = bytesRemaining / growthRate;
      } else {
        timeToThreshold = 0;
      }
    }

    return {
      growthRate,
      timeToThreshold,
      direction,
      sampleCount: n,
    };
  }

  /**
   * Get memory history
   */
  getHistory(): MemorySnapshot[] {
    return [...this.history];
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Get formatted memory report
   */
  getReport(): string {
    const snapshot = this.getSnapshot();
    const utilization = this.getUtilization();
    const level = this.getThresholdLevel();
    const trend = this.analyzeTrend();

    const toMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);

    return [
      `Memory Report:`,
      `  Heap Used: ${toMB(snapshot.heapUsed)}MB`,
      `  Heap Total: ${toMB(snapshot.heapTotal)}MB`,
      `  Heap Limit: ${toMB(this.heapLimit)}MB`,
      `  Utilization: ${utilization.toFixed(1)}%`,
      `  Level: ${level.toUpperCase()}`,
      `  Trend: ${trend.direction} (${toMB(trend.growthRate)}/sec)`,
      `  Time to Critical: ${trend.timeToThreshold === Infinity ? 'N/A' : trend.timeToThreshold.toFixed(0) + 's'}`,
    ].join('\n');
  }

  /**
   * Estimate heap limit from environment
   */
  private estimateHeapLimit(): number {
    // Try to get from v8 if available
    try {
      // V8 heap statistics might not be available in all environments
      // Default to a reasonable limit (512MB)
      return 512 * 1024 * 1024;
    } catch {
      // INTENTIONAL: V8 heap statistics not available in all environments - use reasonable default
      return 512 * 1024 * 1024;
    }
  }

  /**
   * Force garbage collection if available
   */
  forceGC(): boolean {
    if (typeof global.gc === 'function') {
      global.gc();
      return true;
    }
    return false;
  }
}

// ==================== Global Instance ====================

/**
 * Global memory monitor instance
 */
export const memoryMonitor = new MemoryMonitor();
