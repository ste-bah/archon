/**
 * Monitoring Module
 * TASK-MON-001, TASK-MON-002, TASK-MON-003
 */

export {
  type IMemoryBudgets,
  type IMemoryUsage,
  type IMemoryAlert,
  type MemoryAlertLevel,
  type MemoryAlertCallback,
  type IMemoryUsageProvider
} from './types.js';

export {
  MemoryMonitor,
  getMemoryMonitor,
  _resetMemoryMonitorForTesting,
  MEMORY_THRESHOLDS
} from './memory-monitor.js';

export {
  EvictionManager,
  getEvictionManager,
  _resetEvictionManagerForTesting,
  type IEvictionConfig,
  type IEvictionResult,
  type IDescServiceEvictable,
  type ITrajectoryTrackerEvictable
} from './eviction-manager.js';

export {
  TokenTracker,
  getTokenTracker,
  _resetTokenTrackerForTesting,
  type ITokenUsage,
  type ITokenUsageInput,
  type ITokenStats,
  type ITokenStatsFilter
} from './token-tracker.js';
