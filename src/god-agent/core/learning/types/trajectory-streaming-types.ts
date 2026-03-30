/**
 * Trajectory Streaming Types
 * TECH-TRJ-001 - Trajectory Streaming to Disk
 *
 * Type definitions for streaming trajectory data to disk
 * with binary encoding, version migration, and rollback loop detection.
 */

import type { ITrajectory, TrajectoryID, Route, PatternID } from '../sona-types.js';

// ==================== Configuration ====================

/**
 * Trajectory streaming configuration
 */
export interface ITrajectoryStreamConfig {
  /** Storage directory for trajectory files */
  storageDir: string;
  /** Memory window size (hot cache, default: 1000) */
  memoryWindowSize: number;
  /** Batch write size (default: 10) */
  batchWriteSize: number;
  /** Batch write interval in ms (default: 5000) */
  batchWriteIntervalMs: number;
  /** Enable streaming to disk (default: false) */
  enabled: boolean;
  /** Max concurrent queries (default: 10) */
  maxConcurrentQueries: number;
  /** Heap pressure threshold (0-1, default: 0.8) */
  heapPressureThreshold: number;
  /** Format version (1 or 2, default: 2) */
  formatVersion: number;
  /** Enable LZ4 compression (default: true) */
  compressionEnabled: boolean;
  /** Read-only mode for concurrent readers (default: false) */
  readOnly: boolean;
  /** Auto-migrate on initialization (default: false) */
  autoMigrate: boolean;
}

// ==================== Metadata ====================

/**
 * Trajectory metadata for index
 */
export interface ITrajectoryMetadata {
  /** Trajectory ID */
  id: TrajectoryID;
  /** Route/task type */
  route: Route;
  /** Quality score (0-1) */
  quality?: number;
  /** Creation timestamp */
  createdAt: number;
  /** Data file index */
  fileIndex: number;
  /** Offset in data file */
  offset: number;
  /** Size in bytes */
  size: number;
  /** V2 fields */
  tags?: string[];
  isCheckpoint?: boolean;
  isBaseline?: boolean;
  wasRolledBackTo?: boolean;
}

/**
 * Data file information
 */
export interface IDataFileInfo {
  /** File index (e.g., 0 for data_000000.bin) */
  fileIndex: number;
  /** Number of trajectories in file */
  trajectoryCount: number;
  /** File size in bytes */
  sizeBytes: number;
  /** Oldest trajectory timestamp */
  oldestTimestamp: number;
  /** Newest trajectory timestamp */
  newestTimestamp: number;
}

/**
 * Index file structure
 */
export interface IIndexFile {
  /** Version string (e.g., "1.2.0") */
  version: string;
  /** Format version (1 or 2) */
  formatVersion: number;
  /** Total trajectories across all files */
  totalTrajectories: number;
  /** Data file information */
  dataFiles: IDataFileInfo[];
  /** Trajectory metadata */
  metadata: ITrajectoryMetadata[];
  /** Statistics */
  stats?: {
    oldestTrajectory: number;
    newestTrajectory: number;
  };
  /** Metadata chunks for large indexes (v1.2+) */
  metadataChunks?: string[];
}

// ==================== Statistics ====================

/**
 * Streaming statistics
 */
export interface IStreamStats {
  /** Trajectories in memory window */
  memoryCount: number;
  /** Trajectories on disk */
  diskCount: number;
  /** Total trajectories */
  totalCount: number;
  /** Pending writes to disk */
  pendingWrites: number;
  /** Total bytes on disk */
  bytesOnDisk: number;
  /** Current heap usage (bytes) */
  heapUsed: number;
  /** Heap limit (bytes) */
  heapLimit: number;
  /** Heap pressure (0-1) */
  heapPressure: number;
}

// ==================== Rollback State ====================

/**
 * Rollback state for loop detection (CRITICAL-004)
 */
export interface IRollbackState {
  /** Last checkpoint ID rolled back to */
  lastRollbackCheckpointId: string | null;
  /** Timestamp of last rollback */
  lastRollbackAt: number | null;
  /** Total rollback count */
  rollbackCount: number;
}

// ==================== Deletion API ====================

/**
 * Deletion result
 */
export interface IDeleteResult {
  /** Number of trajectories deleted */
  deletedCount: number;
  /** Number of bytes reclaimed */
  bytesReclaimed: number;
  /** Whether compaction was performed */
  compacted: boolean;
  /** Errors encountered (non-fatal) */
  errors: string[];
}

/**
 * Prune filter for bulk deletion
 */
export interface IPruneFilter {
  /** Delete trajectories older than timestamp */
  olderThan?: number;
  /** Delete trajectories with quality below threshold */
  qualityBelow?: number;
  /** Delete trajectories for specific route */
  route?: Route;
  /** Maximum trajectories to delete (safety limit) */
  maxDelete?: number;
  /** Preserve baseline checkpoints */
  preserveBaselines?: boolean;
}

// ==================== Migration API ====================

/**
 * Migration options
 */
export interface IMigrationOptions {
  /** Backup directory (creates backup before migration) */
  backupDir?: string;
  /** Dry run (don't modify files) */
  dryRun?: boolean;
  /** Progress callback (0-1) */
  onProgress?: (progress: number) => void;
}

/**
 * Migration result
 */
export interface IMigrationResult {
  /** Whether migration succeeded */
  success: boolean;
  /** Number of files processed */
  filesProcessed: number;
  /** Number of trajectories migrated */
  trajectoriesMigrated: number;
  /** Errors encountered */
  errors: Array<{ file: string; error: string }>;
  /** Time taken in ms */
  elapsedMs: number;
  /** Backup path (if created) */
  backupPath?: string;
}

/**
 * Migration error
 */
export interface IMigrationError {
  file: string;
  error: string;
}

// ==================== Error Classes ====================

/**
 * Error thrown when multiple processes access same storage directory
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
 * Error thrown when rollback loop is detected
 */
export class ERR_ROLLBACK_LOOP extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ERR_ROLLBACK_LOOP';
  }
}

/**
 * Error thrown when checkpoint is invalid
 */
export class ERR_INVALID_CHECKPOINT extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ERR_INVALID_CHECKPOINT';
  }
}

/**
 * Error thrown when migration fails
 */
export class ERR_MIGRATION_FAILED extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ERR_MIGRATION_FAILED';
  }
}

/**
 * Error thrown when deletion would violate safety constraints
 */
export class ERR_DELETE_BASELINE extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ERR_DELETE_BASELINE';
  }
}
