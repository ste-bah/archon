/**
 * Trajectory Streaming to Disk - Type Definitions
 *
 * @module trajectory-streaming-types
 * @version 1.2
 * @description Type definitions for trajectory streaming functionality implementing
 * SPEC-TRJ-001 v1.2. Provides interfaces for configuration, statistics, errors,
 * and binary format schemas.
 *
 * @since v1.0
 */

/**
 * Configuration interface for trajectory streaming to disk.
 *
 * Controls memory management, batch writing, compression, indexing, and
 * multi-process behavior. All fields have sensible defaults optimized for
 * production use.
 *
 * @interface ITrajectoryStreamConfig
 * @since v1.0
 */
export interface ITrajectoryStreamConfig {
  /**
   * Number of recent trajectories to keep in memory.
   * Older trajectories are streamed to disk automatically.
   *
   * @default 1000
   * @since v1.0
   */
  memoryWindowSize: number;

  /**
   * Number of trajectories per batch write operation.
   * Batching reduces disk I/O overhead.
   *
   * @default 10
   * @since v1.0
   */
  batchWriteSize: number;

  /**
   * Maximum interval between batch writes in milliseconds.
   * Ensures data is persisted even if batch size not reached.
   *
   * @default 5000
   * @since v1.0
   */
  batchWriteIntervalMs: number;

  /**
   * Directory path for trajectory storage on disk.
   * Created automatically if it doesn't exist.
   *
   * @default '.agentdb/sona/trajectories'
   * @since v1.0
   */
  storageDir: string;

  /**
   * Enable LZ4 compression for trajectory data files.
   * Reduces disk usage by ~60-70% with minimal CPU overhead.
   *
   * @default true
   * @since v1.0
   */
  compressionEnabled: boolean;

  /**
   * Build and maintain search index for fast queries.
   * Enables efficient querying by patterns, quality, and time ranges.
   *
   * @default true
   * @since v1.0
   */
  enableIndexing: boolean;

  /**
   * Maximum number of trajectories per data file.
   * Files are rotated automatically when this limit is reached.
   *
   * @default 10000
   * @since v1.0
   */
  trajectoriesPerFile: number;

  /**
   * Minimum number of checkpoints to preserve during pruning operations.
   * Prevents accidental deletion of all recovery points.
   *
   * @default 2
   * @since v1.1
   */
  minCheckpoints: number;

  /**
   * Maximum number of concurrent query operations.
   * Prevents memory pressure from large simultaneous queries.
   *
   * @default 10
   * @since v1.1
   */
  queryQueueSize: number;

  /**
   * Heap usage ratio threshold (0-1) for memory pressure detection.
   * When exceeded, triggers backpressure and aggressive eviction.
   *
   * @default 0.85
   * @since v1.1
   */
  memoryPressureThreshold: number;

  /**
   * Enable read-only mode for multi-process scenarios.
   * When true, prevents writes and allows concurrent read access.
   *
   * @default false
   * @since v1.2
   */
  readOnly: boolean;

  /**
   * Enable automatic migration to current format version on initialization.
   * When true, data files are migrated automatically if version mismatch detected.
   *
   * @default false
   * @since v1.2
   */
  autoMigrate?: boolean;

  /**
   * Binary format version for trajectory data files.
   * Version 1: Basic binary format
   * Version 2: Enhanced format with checksum and rollback state
   *
   * @default 2
   * @since v1.2
   */
  formatVersion?: number;

  /**
   * Heap pressure threshold (0-1) for aggressive eviction.
   * When heap usage exceeds this ratio, memory window is aggressively evicted.
   *
   * @default 0.8
   * @since v1.2
   */
  heapPressureThreshold?: number;

  /**
   * Maximum number of concurrent query operations.
   * Prevents memory pressure from large simultaneous queries.
   *
   * @default 10
   * @since v1.2
   */
  maxConcurrentQueries?: number;

  /**
   * Enable trajectory streaming to disk.
   * When false, all trajectories remain in memory.
   *
   * @default false
   * @since v1.2
   */
  enabled?: boolean;

  /**
   * Maximum number of metadata entries to keep in memory.
   * When exceeded, oldest entries are pruned (LRU eviction).
   * This prevents unbounded memory growth from metadata index.
   *
   * Recommended: 10x memoryWindowSize for good cache hit rate
   * Set to 0 for unlimited (not recommended for production)
   *
   * @default 10000
   * @since v1.3
   */
  maxMetadataEntries?: number;
}

/**
 * Default configuration values for trajectory streaming.
 * All fields use production-optimized defaults.
 *
 * @constant DEFAULT_STREAMING_CONFIG
 * @since v1.0
 */
export const DEFAULT_STREAMING_CONFIG: ITrajectoryStreamConfig = {
  memoryWindowSize: 1000,
  batchWriteSize: 10,
  batchWriteIntervalMs: 5000,
  storageDir: '.agentdb/sona/trajectories',
  compressionEnabled: true,
  enableIndexing: true,
  trajectoriesPerFile: 10000,
  minCheckpoints: 2,
  queryQueueSize: 10,
  memoryPressureThreshold: 0.85,
  readOnly: false,
  maxMetadataEntries: 10000, // 10x default memoryWindowSize
};

/**
 * Rollback tracking state for loop detection.
 *
 * Tracks the last rollback operation to detect and prevent rollback loops
 * (rolling back to the same checkpoint repeatedly without making progress).
 * Persisted with trajectory data.
 *
 * @interface IRollbackState
 * @since v1.1, COMPLETE in v1.2
 */
export interface IRollbackState {
  /**
   * ID of the last checkpoint rolled back to.
   * Used to detect duplicate rollbacks (loops).
   * Null if no rollback has occurred yet.
   *
   * @since v1.1
   */
  lastRollbackCheckpointId: string | null;

  /**
   * Timestamp of last rollback operation in milliseconds since epoch.
   * Used for "progress since rollback" calculation.
   * Null if no rollback has occurred yet.
   *
   * @since v1.1
   */
  lastRollbackAt: number | null;

  /**
   * Total count of rollbacks in current session.
   * Used for metrics and debugging.
   *
   * @since v1.1
   */
  rollbackCount: number;
}

/**
 * Enhanced checkpoint metadata with baseline and rollback tracking.
 *
 * Extends basic trajectory metadata with checkpoint-specific fields for
 * baseline protection and rollback loop detection.
 *
 * @interface ICheckpointMetadata
 * @since v1.1, ENHANCED in v1.2
 */
export interface ICheckpointMetadata {
  /**
   * Unique checkpoint identifier.
   *
   * @since v1.0
   */
  id: string;

  /**
   * Timestamp when checkpoint was created (milliseconds since epoch).
   *
   * @since v1.0
   */
  createdAt: number;

  /**
   * Number of trajectories included in this checkpoint.
   *
   * @since v1.0
   */
  trajectoryCount: number;

  /**
   * Is this a baseline checkpoint?
   *
   * Baseline checkpoints cannot be deleted without force flag.
   * Marked automatically when:
   * - First checkpoint created
   * - Every 10th checkpoint
   * - Manually via markCheckpointAsBaseline()
   *
   * @since v1.2
   */
  isBaseline: boolean;

  /**
   * Was this checkpoint previously rolled back to?
   * Used for rollback loop detection.
   *
   * @since v1.2
   */
  wasRolledBackTo: boolean;

  /**
   * Timestamp of last rollback to this checkpoint (milliseconds since epoch).
   * Null if never rolled back to.
   *
   * @since v1.2
   */
  lastRollbackAt: number | null;
}

/**
 * Metadata for a trajectory stored on disk.
 * Used for indexing and quick lookups without loading full trajectory.
 *
 * @interface ITrajectoryMetadata
 * @since v1.0
 */
export interface ITrajectoryMetadata {
  /**
   * Unique trajectory identifier.
   */
  id: string;

  /**
   * Reasoning route used.
   */
  route: string;

  /**
   * Quality score (0-1).
   */
  quality?: number;

  /**
   * Creation timestamp (milliseconds since epoch).
   */
  createdAt: number;

  /**
   * Index of data file containing this trajectory.
   * -1 if not yet flushed to disk.
   */
  fileIndex: number;

  /**
   * Byte offset within the data file.
   * -1 if not yet flushed to disk.
   */
  offset: number;

  /**
   * Size of trajectory data in bytes.
   * -1 if not yet flushed to disk.
   */
  size: number;

  /**
   * Is this trajectory a checkpoint?
   */
  isCheckpoint?: boolean;

  /**
   * Is this checkpoint marked as baseline?
   */
  isBaseline?: boolean;
}

/**
 * Information about a data file on disk.
 *
 * @interface IDataFileInfo
 * @since v1.0
 */
export interface IDataFileInfo {
  /**
   * Sequential file index number.
   */
  fileIndex: number;

  /**
   * Number of trajectories in this file.
   */
  trajectoryCount: number;

  /**
   * Total size of file in bytes.
   */
  sizeBytes: number;

  /**
   * Timestamp of oldest trajectory in file.
   */
  oldestTimestamp: number;

  /**
   * Timestamp of newest trajectory in file.
   */
  newestTimestamp: number;
}

/**
 * Index file structure for trajectory storage.
 *
 * @interface IIndexFile
 * @since v1.0
 */
export interface IIndexFile {
  /**
   * Version of the trajectory streaming system.
   */
  version: string;

  /**
   * Binary format version of data files.
   */
  formatVersion: number;

  /**
   * Total number of trajectories.
   */
  totalTrajectories: number;

  /**
   * Array of data file information.
   */
  dataFiles: IDataFileInfo[];

  /**
   * Array of trajectory metadata for indexing.
   */
  metadata: ITrajectoryMetadata[];

  /**
   * Set of baseline checkpoint IDs (for persistence).
   */
  baselineCheckpointIds?: string[];
}

/**
 * Statistics about trajectory streaming operations.
 *
 * Provides real-time metrics for monitoring memory usage, disk storage,
 * cache performance, and system health.
 *
 * @interface IStreamStats
 * @since v1.0
 */
export interface IStreamStats {
  /**
   * Number of trajectories currently in memory.
   *
   * @since v1.0
   */
  memoryCount: number;

  /**
   * Number of trajectories stored on disk.
   *
   * @since v1.0
   */
  diskCount: number;

  /**
   * Total number of trajectories (memory + disk - deleted).
   *
   * @since v1.0
   */
  totalCount: number;

  /**
   * Number of trajectories pending write to disk.
   *
   * @since v1.0
   */
  pendingWrites: number;

  /**
   * Total bytes stored on disk.
   *
   * @since v1.0
   */
  bytesOnDisk: number;

  /**
   * Current heap used in bytes.
   *
   * @since v1.1
   */
  heapUsed: number;

  /**
   * Heap limit in bytes.
   *
   * @since v1.1
   */
  heapLimit: number;

  /**
   * Heap pressure ratio (0-1).
   *
   * @since v1.1
   */
  heapPressure: number;

  /**
   * Total number of rollback operations performed.
   *
   * @since v1.1
   */
  rollbackCount: number;

  /**
   * ID of the last checkpoint rolled back to.
   * Null if no rollback has occurred yet.
   *
   * @since v1.1
   */
  lastRollbackCheckpointId: string | null;

  /**
   * Current heap usage ratio (0-1).
   * Calculated as (heapUsed / heapTotal).
   *
   * @since v1.1
   */
  heapUsageRatio: number;

  /**
   * Is memory pressure currently high?
   * True when heapUsageRatio exceeds memoryPressureThreshold.
   *
   * @since v1.1
   */
  isMemoryPressureHigh: boolean;

  /**
   * Number of queries currently being processed.
   *
   * @since v1.1
   */
  activeQueries: number;

  /**
   * Number of queries waiting in queue.
   *
   * @since v1.1
   */
  queuedQueries: number;
}

/**
 * Result of a trajectory deletion operation.
 *
 * Provides detailed feedback about deletion success, failures, and
 * disk space reclaimed.
 *
 * @interface IDeleteResult
 * @since v1.1
 */
export interface IDeleteResult {
  /**
   * Number of trajectories successfully deleted.
   *
   * @since v1.1
   */
  deletedCount: number;

  /**
   * Number of bytes reclaimed from disk.
   *
   * @since v1.1
   */
  bytesReclaimed: number;

  /**
   * Whether data files were compacted after deletion.
   *
   * @since v1.1
   */
  compacted: boolean;

  /**
   * Array of error messages if any deletions failed.
   *
   * @since v1.1
   */
  errors: string[];
}

/**
 * Filter criteria for bulk trajectory deletion (pruning).
 *
 * Allows flexible filtering by age, quality, and other criteria.
 * All criteria are optional; omitted criteria are not applied.
 *
 * @interface IPruneFilter
 * @since v1.1
 */
export interface IPruneFilter {
  /**
   * Delete trajectories older than this timestamp (milliseconds since epoch).
   * Optional - if omitted, age is not considered.
   *
   * @since v1.1
   */
  olderThan?: number;

  /**
   * Delete trajectories with quality score below this value (0-1).
   * Optional - if omitted, quality is not considered.
   *
   * @since v1.1
   */
  qualityBelow?: number;

  /**
   * Filter by specific reasoning route.
   * Optional - if omitted, all routes are considered.
   *
   * @since v1.1
   */
  route?: string;

  /**
   * Maximum number of trajectories to delete.
   * Optional - if omitted, all matching trajectories are deleted.
   *
   * @since v1.1
   */
  maxDelete?: number;

  /**
   * Preserve baseline checkpoints even if they match filter criteria.
   * Optional - defaults to true if omitted.
   *
   * @since v1.2
   */
  preserveBaselines?: boolean;
}

/**
 * Options for trajectory data migration.
 *
 * @interface IMigrationOptions
 * @since v1.2
 */
export interface IMigrationOptions {
  /**
   * Directory to store backup before migration.
   * If provided, a full backup is created before migration starts.
   */
  backupDir?: string;

  /**
   * If true, performs migration validation without modifying files.
   */
  dryRun?: boolean;

  /**
   * Callback for migration progress (0-1).
   */
  onProgress?: (progress: number) => void;
}

/**
 * Error information for failed migration operation.
 *
 * @interface IMigrationError
 * @since v1.2
 */
export interface IMigrationError {
  /**
   * Name of the file that failed to migrate.
   */
  file: string;

  /**
   * Error message describing the failure.
   */
  error: string;
}

/**
 * Result of a version migration operation.
 *
 * Provides detailed statistics about the migration process including
 * success status, files processed, errors encountered, and backup location.
 *
 * @interface IMigrationResult
 * @since v1.1, COMPLETE in v1.2
 */
export interface IMigrationResult {
  /**
   * Whether the migration completed successfully.
   * False if any critical errors occurred.
   *
   * @since v1.1
   */
  success: boolean;

  /**
   * Number of data files processed during migration.
   *
   * @since v1.1
   */
  filesProcessed: number;

  /**
   * Total number of individual trajectories migrated.
   *
   * @since v1.1
   */
  trajectoriesMigrated: number;

  /**
   * Array of errors encountered during migration.
   * Each error includes the file path and error message.
   * Empty array if no errors occurred.
   *
   * @since v1.1
   */
  errors: IMigrationError[];

  /**
   * Total elapsed time for migration in milliseconds.
   *
   * @since v1.1
   */
  elapsedMs: number;

  /**
   * Path to backup directory if backup was created.
   * Undefined if no backup was requested.
   *
   * @since v1.2
   */
  backupPath?: string;
}

/**
 * Error codes for trajectory streaming operations.
 *
 * Categorized by subsystem: storage, memory, deletion, rollback,
 * multi-process, and migration errors.
 *
 * @enum TrajectoryStreamError
 * @since v1.0
 */
export enum TrajectoryStreamError {
  // Base storage errors (v1.0)

  /**
   * Disk storage is full or quota exceeded.
   *
   * @since v1.0
   */
  ERR_STORAGE_FULL = 'ERR_STORAGE_FULL',

  /**
   * Search index is corrupted and needs rebuilding.
   *
   * @since v1.0
   */
  ERR_INDEX_CORRUPTED = 'ERR_INDEX_CORRUPTED',

  /**
   * Requested trajectory file not found on disk.
   *
   * @since v1.0
   */
  ERR_FILE_NOT_FOUND = 'ERR_FILE_NOT_FOUND',

  // Memory safety errors (v1.1)

  /**
   * Memory pressure is high; operation blocked to prevent OOM.
   *
   * @since v1.1
   */
  ERR_MEMORY_PRESSURE = 'ERR_MEMORY_PRESSURE',

  /**
   * Query result set too large for available memory.
   *
   * @since v1.1
   */
  ERR_QUERY_TOO_LARGE = 'ERR_QUERY_TOO_LARGE',

  /**
   * Query queue is full; too many concurrent queries.
   *
   * @since v1.1
   */
  ERR_QUERY_QUEUE_FULL = 'ERR_QUERY_QUEUE_FULL',

  // Deletion safety errors (v1.1)

  /**
   * Cannot delete baseline checkpoint without force flag.
   *
   * @since v1.1
   */
  ERR_DELETE_BASELINE = 'ERR_DELETE_BASELINE',

  /**
   * Cannot delete last checkpoint; at least one must remain.
   *
   * @since v1.1
   */
  ERR_DELETE_LAST_CHECKPOINT = 'ERR_DELETE_LAST_CHECKPOINT',

  /**
   * Prune operation would exceed configured limits.
   *
   * @since v1.1
   */
  ERR_PRUNE_LIMIT_EXCEEDED = 'ERR_PRUNE_LIMIT_EXCEEDED',

  // Rollback safety errors (v1.1, COMPLETE in v1.2)

  /**
   * Rollback loop detected: same checkpoint rolled back to without progress.
   *
   * @since v1.1
   */
  ERR_ROLLBACK_LOOP = 'ERR_ROLLBACK_LOOP',

  /**
   * Checkpoint not found or invalid.
   *
   * @since v1.1
   */
  ERR_INVALID_CHECKPOINT = 'ERR_INVALID_CHECKPOINT',

  // Multi-process safety errors (v1.2)

  /**
   * Another process is using this storage directory.
   *
   * @since v1.2
   * @deprecated MEM-001: Multi-process access now handled by MemoryServer
   */
  ERR_MULTI_PROCESS = 'ERR_MULTI_PROCESS',

  /**
   * Operation not allowed in read-only mode.
   *
   * @since v1.2
   */
  ERR_READ_ONLY = 'ERR_READ_ONLY',

  /**
   * Cannot unmark the last baseline checkpoint.
   *
   * @since v1.2
   */
  ERR_LAST_BASELINE = 'ERR_LAST_BASELINE',

  // Migration errors (v1.2)

  /**
   * Version migration failed.
   *
   * @since v1.2
   */
  ERR_MIGRATION_FAILED = 'ERR_MIGRATION_FAILED',

  /**
   * Unsupported or unknown file format version.
   *
   * @since v1.2
   */
  ERR_UNSUPPORTED_VERSION = 'ERR_UNSUPPORTED_VERSION',

  /**
   * Backup creation failed before migration.
   *
   * @since v1.2
   */
  ERR_BACKUP_FAILED = 'ERR_BACKUP_FAILED'
}

/**
 * V1 trajectory schema for binary format.
 *
 * Used in format version 1 data files. This schema represents the
 * original trajectory structure without rollback tracking.
 *
 * @interface ISerializedTrajectoryV1
 * @since v1.0
 */
export interface ISerializedTrajectoryV1 {
  /**
   * Unique trajectory identifier.
   *
   * @since v1.0
   */
  id: string;

  /**
   * Reasoning route used (e.g., "reasoning.causal", "reasoning.deductive").
   *
   * @since v1.0
   */
  route: string;

  /**
   * Array of pattern IDs used in this trajectory.
   *
   * @since v1.0
   */
  patterns: string[];

  /**
   * Optional context information for this trajectory.
   *
   * @since v1.0
   */
  context?: string[];

  /**
   * Timestamp when trajectory was created (milliseconds since epoch).
   *
   * @since v1.0
   */
  createdAt: number;

  /**
   * Optional quality score (0-1) for this trajectory.
   *
   * @since v1.0
   */
  quality?: number;

  /**
   * Optional reward value from reinforcement learning.
   *
   * @since v1.0
   */
  reward?: number;
}

/**
 * V2 trajectory schema for binary format.
 *
 * Used in format version 2 data files. Extends V1 schema with rollback
 * tracking, baseline marking, and tagging support.
 *
 * @interface ISerializedTrajectoryV2
 * @extends ISerializedTrajectoryV1
 * @since v1.2
 */
export interface ISerializedTrajectoryV2 extends ISerializedTrajectoryV1 {
  /**
   * Optional tags for categorization and filtering.
   * Defaults to empty array during migration from V1.
   *
   * @since v1.2
   */
  tags?: string[];

  /**
   * Is this trajectory a checkpoint?
   * Defaults to false during migration from V1.
   *
   * @since v1.2
   */
  isCheckpoint?: boolean;

  /**
   * Is this checkpoint marked as baseline?
   * Baseline checkpoints are protected from deletion.
   * Defaults to false during migration from V1.
   *
   * @since v1.2
   */
  isBaseline?: boolean;

  /**
   * Was this checkpoint previously rolled back to?
   * Used for rollback loop detection.
   * Defaults to false during migration from V1.
   *
   * @since v1.2
   */
  wasRolledBackTo?: boolean;
}

// ==================== Error Classes ====================

/**
 * Error thrown when multi-process conflict detected.
 * @deprecated MEM-001: Multi-process access now handled by MemoryServer.
 * Kept for backwards compatibility but no longer thrown.
 */
export class ERR_MULTI_PROCESS extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ERR_MULTI_PROCESS';
  }
}

/**
 * Error thrown when rollback loop detected.
 */
export class ERR_ROLLBACK_LOOP extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ERR_ROLLBACK_LOOP';
  }
}

/**
 * Error thrown when checkpoint is invalid.
 */
export class ERR_INVALID_CHECKPOINT extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ERR_INVALID_CHECKPOINT';
  }
}

/**
 * Error thrown when migration fails.
 */
export class ERR_MIGRATION_FAILED extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ERR_MIGRATION_FAILED';
  }
}

/**
 * Error thrown when attempting to delete baseline checkpoint.
 */
export class ERR_DELETE_BASELINE extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ERR_DELETE_BASELINE';
  }
}

/**
 * Error thrown when operation not allowed in read-only mode.
 */
export class ERR_READ_ONLY extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ERR_READ_ONLY';
  }
}
