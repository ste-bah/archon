/**
 * Memory Budget Monitor
 * TASK-MON-001
 *
 * Monitors god-agent memory usage against Constitution limits.
 *
 * CONSTITUTION COMPLIANCE:
 * - RULE-037: Episode cache max 1000 items
 * - RULE-038: Embedding cache max 100MB
 * - RULE-039: Trajectory cache max 100 active
 * - RULE-040: Total overhead max 200MB, warning at 150MB
 */

import {
  IMemoryBudgets,
  IMemoryUsage,
  IMemoryAlert,
  MemoryAlertCallback,
  IMemoryUsageProvider
} from './types.js';
import { createComponentLogger } from '../observability/logger.js';

const logger = createComponentLogger('MemoryMonitor');

/** Default budgets per Constitution */
const DEFAULT_BUDGETS: IMemoryBudgets = {
  episodeCache: 1000,    // RULE-037
  embeddingCache: 100,   // RULE-038 (MB)
  trajectoryCache: 100,  // RULE-039
  totalOverhead: 200     // RULE-040 (MB)
};

/** Alert threshold ratios */
const THRESHOLDS = {
  WARNING: 0.75,  // 75% = 150MB for total
  ERROR: 1.0      // 100% = 200MB for total
} as const;

export class MemoryMonitor {
  private readonly budgets: IMemoryBudgets;
  private readonly alertCallbacks: MemoryAlertCallback[] = [];
  private intervalId: NodeJS.Timeout | null = null;
  private readonly checkIntervalMs: number;

  /** Service providers for usage collection (late binding) */
  private descServiceProvider: (() => IMemoryUsageProvider | null) | null = null;
  private trajectoryTrackerProvider: (() => IMemoryUsageProvider | null) | null = null;

  constructor(config: {
    budgets?: Partial<IMemoryBudgets>;
    checkIntervalMs?: number;
  } = {}) {
    this.budgets = { ...DEFAULT_BUDGETS, ...config.budgets };
    this.checkIntervalMs = config.checkIntervalMs ?? 60000; // 1 minute default
  }

  /** Set DESC service provider */
  setDescServiceProvider(provider: () => IMemoryUsageProvider | null): void {
    this.descServiceProvider = provider;
  }

  /** Set trajectory tracker provider */
  setTrajectoryTrackerProvider(provider: () => IMemoryUsageProvider | null): void {
    this.trajectoryTrackerProvider = provider;
  }

  /** Start periodic monitoring */
  start(): void {
    if (this.intervalId) {
      logger.warn('MemoryMonitor already running');
      return;
    }

    this.intervalId = setInterval(() => {
      this.check();
    }, this.checkIntervalMs);

    // Initial check
    this.check();

    logger.info('MemoryMonitor started', {
      checkIntervalMs: this.checkIntervalMs,
      budgets: this.budgets
    });
  }

  /** Stop monitoring */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('MemoryMonitor stopped');
    }
  }

  /** Register alert callback */
  onAlert(callback: MemoryAlertCallback): void {
    this.alertCallbacks.push(callback);
  }

  /** Perform memory check */
  check(): IMemoryUsage {
    const usage = this.collectUsage();

    // Check total overhead (RULE-040) - most critical
    this.checkThreshold('totalOverhead', usage.totalOverheadMB, this.budgets.totalOverhead);

    // Check episode cache (RULE-037)
    this.checkThreshold('episodeCache', usage.episodeCacheCount, this.budgets.episodeCache);

    // Check embedding cache (RULE-038)
    this.checkThreshold('embeddingCache', usage.embeddingCacheMB, this.budgets.embeddingCache);

    // Check trajectory cache (RULE-039)
    this.checkThreshold('trajectoryCache', usage.trajectoryCacheCount, this.budgets.trajectoryCache);

    return usage;
  }

  /** Collect current memory usage */
  private collectUsage(): IMemoryUsage {
    const memUsage = process.memoryUsage();

    const descService = this.descServiceProvider?.();
    const trajectoryTracker = this.trajectoryTrackerProvider?.();

    return {
      heapUsedMB: memUsage.heapUsed / (1024 * 1024),
      heapTotalMB: memUsage.heapTotal / (1024 * 1024),
      episodeCacheCount: descService?.getCacheSize?.() ?? 0,
      embeddingCacheMB: descService?.getEmbeddingCacheMB?.() ?? 0,
      trajectoryCacheCount: trajectoryTracker?.getActiveCount?.() ?? 0,
      totalOverheadMB: memUsage.heapUsed / (1024 * 1024),
      timestamp: Date.now()
    };
  }

  /** Check a threshold and emit alerts if exceeded */
  private checkThreshold(
    component: keyof IMemoryBudgets,
    current: number,
    limit: number
  ): void {
    const ratio = limit > 0 ? current / limit : 0;

    if (ratio >= THRESHOLDS.ERROR) {
      this.emitAlert({
        level: 'error',
        component,
        current,
        limit,
        ratio,
        message: `${component} at ${(ratio * 100).toFixed(1)}% - CONSTITUTION VIOLATION`,
        timestamp: Date.now()
      });
    } else if (ratio >= THRESHOLDS.WARNING) {
      this.emitAlert({
        level: 'warning',
        component,
        current,
        limit,
        ratio,
        message: `${component} at ${(ratio * 100).toFixed(1)}% - approaching limit`,
        timestamp: Date.now()
      });
    }
  }

  /** Emit alert to all callbacks */
  private emitAlert(alert: IMemoryAlert): void {
    const alertContext = {
      component: alert.component,
      current: alert.current,
      limit: alert.limit,
      ratio: alert.ratio,
      alertTimestamp: alert.timestamp
    };

    if (alert.level === 'error') {
      logger.error(alert.message, undefined, alertContext);
    } else {
      logger.warn(alert.message, alertContext);
    }

    for (const callback of this.alertCallbacks) {
      try {
        callback(alert);
      } catch (err) {
        logger.error('Alert callback failed', err);
      }
    }
  }

  /** Get current usage */
  getUsage(): IMemoryUsage {
    return this.collectUsage();
  }

  /** Get configured budgets */
  getBudgets(): IMemoryBudgets {
    return { ...this.budgets };
  }

  /** Check if monitoring is active */
  isRunning(): boolean {
    return this.intervalId !== null;
  }
}

// Singleton instance
let instance: MemoryMonitor | null = null;

export function getMemoryMonitor(): MemoryMonitor {
  if (!instance) {
    instance = new MemoryMonitor();
  }
  return instance;
}

export function _resetMemoryMonitorForTesting(): void {
  if (instance) {
    instance.stop();
  }
  instance = null;
}

// Re-export thresholds for use in eviction
export { THRESHOLDS as MEMORY_THRESHOLDS };
