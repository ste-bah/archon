/**
 * Monitoring Type Definitions
 * TASK-MON-001
 */

/** Memory budget limits per Constitution */
export interface IMemoryBudgets {
  /** RULE-037: Maximum episodes in cache */
  episodeCache: number;
  /** RULE-038: Maximum embedding cache size in MB */
  embeddingCache: number;
  /** RULE-039: Maximum active trajectories */
  trajectoryCache: number;
  /** RULE-040: Total god-agent memory overhead in MB */
  totalOverhead: number;
}

/** Current memory usage snapshot */
export interface IMemoryUsage {
  heapUsedMB: number;
  heapTotalMB: number;
  episodeCacheCount: number;
  embeddingCacheMB: number;
  trajectoryCacheCount: number;
  totalOverheadMB: number;
  timestamp: number;
}

/** Memory alert levels */
export type MemoryAlertLevel = 'warning' | 'error';

/** Memory alert event */
export interface IMemoryAlert {
  level: MemoryAlertLevel;
  component: keyof IMemoryBudgets;
  current: number;
  limit: number;
  ratio: number;
  message: string;
  timestamp: number;
}

/** Alert callback type */
export type MemoryAlertCallback = (alert: IMemoryAlert) => void;

/** Service interfaces for usage collection */
export interface IMemoryUsageProvider {
  getCacheSize?(): number;
  getEmbeddingCacheMB?(): number;
  getActiveCount?(): number;
}
