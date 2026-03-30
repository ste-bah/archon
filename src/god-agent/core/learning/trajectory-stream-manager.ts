/**
 * Trajectory Stream Manager
 * TECH-TRJ-001 - Trajectory Streaming to Disk Implementation
 *
 * Manages streaming of trajectory data to disk with:
 * - Memory window (hot cache)
 * - Binary encoding with LZ4 compression
 * - Version migration (v1 -> v2)
 * - Rollback loop detection
 * - Multi-process safety
 * - Deletion API with safeguards
 */

import { writeFile, readFile, rename, mkdir } from 'fs/promises';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import * as lz4 from 'lz4';
import type { ITrajectory, TrajectoryID } from './sona-types.js';
import type {
  ITrajectoryStreamConfig,
  ITrajectoryMetadata,
  IDataFileInfo,
  IIndexFile,
  IStreamStats,
  IRollbackState,
  IDeleteResult,
  IPruneFilter,
  IMigrationOptions,
  IMigrationResult,
  IMigrationError,
} from '../types/trajectory-streaming-types.js';
import {
  // MEM-001: ERR_MULTI_PROCESS removed - multi-process access now handled by MemoryServer
  ERR_ROLLBACK_LOOP,
  ERR_DELETE_BASELINE,
  ERR_READ_ONLY,
} from '../types/trajectory-streaming-types.js';

/**
 * Simple mutex for preventing concurrent flushes
 */
class SimpleMutex {
  private locked = false;
  private queue: Array<() => void> = [];

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (!this.locked) {
          this.locked = true;
          resolve(() => this.release());
        } else {
          this.queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }

  private release(): void {
    this.locked = false;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }
}

/**
 * CRC32 checksum calculation
 * Returns an unsigned 32-bit integer
 */
function crc32(buffer: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) {
    crc = crc ^ buffer[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  // Convert to unsigned 32-bit integer
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// MEM-001: isProcessRunning function removed - multi-process access now handled by MemoryServer

/**
 * Trajectory Stream Manager
 *
 * Manages the lifecycle of trajectories from memory window to disk storage.
 */
export class TrajectoryStreamManager {
  private config: ITrajectoryStreamConfig;
  private memoryWindow: Map<TrajectoryID, ITrajectory> = new Map();
  private metadata: Map<TrajectoryID, ITrajectoryMetadata> = new Map();
  private rollbackState: IRollbackState = {
    lastRollbackCheckpointId: null,
    lastRollbackAt: null,
    rollbackCount: 0,
  };
  private flushMutex = new SimpleMutex();
  private pendingWrites: ITrajectory[] = [];
  private currentFileIndex = 0;
  private stats: IStreamStats = {
    memoryCount: 0,
    diskCount: 0,
    totalCount: 0,
    pendingWrites: 0,
    bytesOnDisk: 0,
    heapUsed: 0,
    heapLimit: 0,
    heapPressure: 0,
    rollbackCount: 0,
    lastRollbackCheckpointId: null,
    heapUsageRatio: 0,
    isMemoryPressureHigh: false,
    activeQueries: 0,
    queuedQueries: 0,
  };
  private queryQueue: Array<() => Promise<void>> = [];
  private activeQueries = 0;

  constructor(config: Partial<ITrajectoryStreamConfig>) {
    this.config = {
      storageDir: config.storageDir ?? '.agentdb/sona/trajectories',
      memoryWindowSize: config.memoryWindowSize ?? 1000,
      batchWriteSize: config.batchWriteSize ?? 10,
      batchWriteIntervalMs: config.batchWriteIntervalMs ?? 5000,
      enabled: config.enabled ?? true,  // FIX: Default to true since method is enableStreaming()
      maxConcurrentQueries: config.maxConcurrentQueries ?? 10,
      heapPressureThreshold: config.heapPressureThreshold ?? 0.8,
      formatVersion: config.formatVersion ?? 2,
      compressionEnabled: config.compressionEnabled ?? true,
      readOnly: config.readOnly ?? false,
      autoMigrate: config.autoMigrate ?? false,
      enableIndexing: config.enableIndexing ?? true,
      trajectoriesPerFile: config.trajectoriesPerFile ?? 10000,
      minCheckpoints: config.minCheckpoints ?? 2,
      queryQueueSize: config.queryQueueSize ?? 10,
      memoryPressureThreshold: config.memoryPressureThreshold ?? 0.85,
      maxMetadataEntries: config.maxMetadataEntries ?? 10000, // ANTI-005: Prevent unbounded growth
    };
  }

  /**
   * Initialize the stream manager
   * - Load index from disk
   * - Check for multi-process conflicts
   * - Auto-migrate if enabled
   */
  async initialize(): Promise<void> {
    // 1. Ensure directory exists
    if (!existsSync(this.config.storageDir)) {
      await mkdir(this.config.storageDir, { recursive: true });
    }

    // MEM-001: Multi-process detection removed - now handled by MemoryServer
    // The MemoryServer daemon owns all .agentdb/ file operations and handles
    // concurrent access from multiple processes via IPC.

    // 3. Load index
    await this.loadIndex();

    // 4. Detect version and auto-migrate if needed
    if (this.config.autoMigrate && this.config.formatVersion) {
      const currentVersion = await this.detectVersion();
      if (currentVersion < this.config.formatVersion) {
        console.log(`[TrajectoryStreamManager] Auto-migrating from v${currentVersion} to v${this.config.formatVersion}`);
        await this.migrateToVersion(this.config.formatVersion);
      }
    }

    // 5. Update stats
    this.updateMemoryStats();
  }

  // MEM-001: checkMultiProcess method removed - multi-process access now handled by MemoryServer
  // The cleanupRegistered property and PID file management have been removed since
  // the MemoryServer daemon now owns all .agentdb/ file operations.

  /**
   * Add trajectory to stream
   * - Add to memory window
   * - Trigger eviction if needed
   * - Auto-flush if batch size reached
   */
  async addTrajectory(trajectory: ITrajectory): Promise<void> {
    // Check for read-only mode
    if (this.config.readOnly) {
      throw new ERR_READ_ONLY('Cannot add trajectories in read-only mode');
    }

    // 1. Add to memory window
    this.memoryWindow.set(trajectory.id, trajectory);

    // 2. Create metadata
    const metadata: ITrajectoryMetadata = {
      id: trajectory.id,
      route: trajectory.route,
      quality: trajectory.quality,
      createdAt: trajectory.createdAt,
      fileIndex: -1, // Will be set when flushed
      offset: -1,
      size: -1,
    };
    this.metadata.set(trajectory.id, metadata);

    // 2.5. Prune metadata if limit exceeded (ANTI-005)
    this.pruneMetadata();

    // 3. Update stats
    this.stats.memoryCount = this.memoryWindow.size;
    this.stats.totalCount++;

    // 4. Check for eviction
    if (this.memoryWindow.size > this.config.memoryWindowSize) {
      await this.evictOldest();
    }

    // 5. Auto-flush if batch size reached
    if (this.pendingWrites.length >= this.config.batchWriteSize) {
      await this.flush();
    }

    // 6. Update pending writes stats
    this.stats.pendingWrites = this.pendingWrites.length;
  }

  /**
   * Get trajectory by ID
   * - Check memory window first
   * - Then check disk
   */
  async getTrajectory(id: TrajectoryID): Promise<ITrajectory | null> {
    // 1. Check memory window
    const memoryTrajectory = this.memoryWindow.get(id);
    if (memoryTrajectory) {
      return memoryTrajectory;
    }

    // 2. Check metadata for disk location
    const metadata = this.metadata.get(id);
    if (!metadata || metadata.fileIndex === -1) {
      return null;
    }

    // 3. Limit concurrent queries
    await this.acquireQuerySlot();

    try {
      // 4. Read from disk
      const trajectory = await this.readTrajectoryFromDisk(metadata);
      return trajectory;
    } finally {
      this.releaseQuerySlot();
    }
  }

  /**
   * Get current statistics
   */
  getStats(): IStreamStats {
    this.updateMemoryStats();

    // Recalculate counts from source of truth (metadata)
    this.stats.totalCount = this.metadata.size;
    this.stats.memoryCount = this.memoryWindow.size;
    this.stats.diskCount = Array.from(this.metadata.values()).filter(m => m.fileIndex !== -1).length;
    this.stats.pendingWrites = this.pendingWrites.length;

    return { ...this.stats };
  }

  /**
   * Flush pending writes to disk
   */
  async flush(): Promise<void> {
    // Check for read-only mode
    if (this.config.readOnly) {
      throw new ERR_READ_ONLY('Cannot flush writes in read-only mode');
    }

    // Move all memory window items to pending writes
    if (this.memoryWindow.size > 0) {
      for (const trajectory of this.memoryWindow.values()) {
        this.pendingWrites.push(trajectory);
      }
      this.memoryWindow.clear();
      this.stats.memoryCount = 0;
      this.stats.pendingWrites = this.pendingWrites.length;
    }

    if (this.pendingWrites.length === 0) {
      return;
    }

    // Acquire mutex to prevent concurrent flushes
    const release = await this.flushMutex.acquire();

    try {
      await this.flushPendingWrites();
    } finally {
      release();
    }
  }

  /**
   * Record a rollback (CRITICAL-004)
   */
  async recordRollback(checkpointId: string): Promise<void> {
    // Check if this is the same checkpoint as last rollback
    if (this.rollbackState.lastRollbackCheckpointId === checkpointId) {
      throw new ERR_ROLLBACK_LOOP(
        `Rollback loop detected: Attempting to roll back to checkpoint "${checkpointId}" ` +
        `which was already rolled back to at ${new Date(this.rollbackState.lastRollbackAt!).toISOString()}. ` +
        `No learning progress was made since last rollback.`
      );
    }

    // Record this rollback
    this.rollbackState = {
      lastRollbackCheckpointId: checkpointId,
      lastRollbackAt: Date.now(),
      rollbackCount: this.rollbackState.rollbackCount + 1,
    };

    // Save rollback state
    await this.saveRollbackState();
  }

  /**
   * Get current rollback state
   */
  getRollbackState(): IRollbackState {
    return { ...this.rollbackState };
  }

  /**
   * Delete a single trajectory (Deletion API)
   */
  async deleteTrajectory(id: TrajectoryID, force = false): Promise<IDeleteResult> {
    const result: IDeleteResult = {
      deletedCount: 0,
      bytesReclaimed: 0,
      compacted: false,
      errors: [],
    };

    // 1. Get metadata
    const metadata = this.metadata.get(id);
    if (!metadata) {
      result.errors.push(`Trajectory ${id} not found`);
      return result;
    }

    // 2. Check if baseline
    if (metadata.isBaseline && !force) {
      throw new ERR_DELETE_BASELINE(
        `Cannot delete baseline trajectory ${id}. Use force=true to override.`
      );
    }

    // 3. Remove from memory
    this.memoryWindow.delete(id);

    // 4. Remove from pending writes
    const pendingIndex = this.pendingWrites.findIndex(t => t.id === id);
    if (pendingIndex !== -1) {
      this.pendingWrites.splice(pendingIndex, 1);
    }

    // 5. Remove from metadata
    const size = metadata.size > 0 ? metadata.size : JSON.stringify(this.memoryWindow.get(id) || this.pendingWrites.find(t => t.id === id) || {}).length;
    this.metadata.delete(id);

    // 6. Update stats
    result.deletedCount = 1;
    result.bytesReclaimed = Math.max(1, size); // At least 1 byte
    this.stats.totalCount--;
    this.stats.memoryCount = this.memoryWindow.size;
    this.stats.pendingWrites = this.pendingWrites.length;
    this.stats.diskCount = Math.max(0, this.metadata.size - this.memoryWindow.size);

    // 6. Save index
    await this.saveIndex();

    return result;
  }

  /**
   * Prune trajectories in bulk (Deletion API)
   */
  async pruneTrajectories(filter: IPruneFilter): Promise<IDeleteResult> {
    const result: IDeleteResult = {
      deletedCount: 0,
      bytesReclaimed: 0,
      compacted: false,
      errors: [],
    };

    const toDelete: TrajectoryID[] = [];

    // 1. Find trajectories matching filter
    for (const [id, metadata] of this.metadata) {
      // Skip baselines unless explicitly allowed
      if (metadata.isBaseline && filter.preserveBaselines !== false) {
        continue;
      }

      // Check filters
      if (filter.olderThan && metadata.createdAt >= filter.olderThan) {
        continue;
      }

      if (filter.qualityBelow !== undefined && (metadata.quality ?? 1) >= filter.qualityBelow) {
        continue;
      }

      if (filter.route && metadata.route !== filter.route) {
        continue;
      }

      toDelete.push(id);

      // Respect max delete limit
      if (filter.maxDelete && toDelete.length >= filter.maxDelete) {
        break;
      }
    }

    // 2. Delete trajectories
    for (const id of toDelete) {
      try {
        const deleteResult = await this.deleteTrajectory(id, !filter.preserveBaselines);
        result.deletedCount += deleteResult.deletedCount;
        result.bytesReclaimed += deleteResult.bytesReclaimed;
      } catch (error: any) {
        result.errors.push(`Failed to delete ${id}: ${error.message}`);
      }
    }

    return result;
  }

  /**
   * Migrate data files to target version (CRITICAL-005)
   */
  async migrateToVersion(targetVersion: number, options?: IMigrationOptions): Promise<IMigrationResult> {
    const startTime = performance.now();
    const errors: IMigrationError[] = [];
    let trajectoriesMigrated = 0;
    let filesProcessed = 0;

    // 1. Detect current version
    const currentVersion = await this.detectVersion();
    if (currentVersion >= targetVersion) {
      return {
        success: false,
        filesProcessed: 0,
        trajectoriesMigrated: 0,
        errors: [{ file: 'index.json', error: `Already at version ${currentVersion}` }],
        elapsedMs: performance.now() - startTime,
      };
    }

    // 2. Create backup if requested
    let backupPath: string | undefined;
    if (options?.backupDir && !options?.dryRun) {
      backupPath = await this.createBackup(options.backupDir);
    }

    // 3. Load index
    const index = await this.loadIndexFile();

    // 4. Migrate each data file
    for (let i = 0; i < index.dataFiles.length; i++) {
      const fileInfo = index.dataFiles[i];

      try {
        // Read with current version decoder
        const trajectories = await this.readDataFile(fileInfo.fileIndex, currentVersion);

        // Migrate trajectories
        const migratedTrajectories = this.migrateTrajectories(trajectories, currentVersion, targetVersion);

        if (!options?.dryRun) {
          // Write with target version encoder
          await this.writeDataFile(fileInfo.fileIndex, migratedTrajectories, targetVersion);
        }

        trajectoriesMigrated += migratedTrajectories.length;
        filesProcessed++;

        options?.onProgress?.(filesProcessed / index.dataFiles.length);
      } catch (error: any) {
        errors.push({
          file: `data_${String(fileInfo.fileIndex).padStart(6, '0')}.bin`,
          error: error.message,
        });
      }
    }

    // 5. Update index format version
    if (!options?.dryRun && errors.length === 0) {
      index.formatVersion = targetVersion;
      await this.saveIndexFile(index);
    }

    return {
      success: errors.length === 0,
      filesProcessed,
      trajectoriesMigrated,
      errors,
      elapsedMs: performance.now() - startTime,
      backupPath,
    };
  }

  /**
   * Detect format version of data files
   */
  async detectVersion(): Promise<number> {
    const index = await this.loadIndexFile();
    return index.formatVersion ?? 1;
  }

  // ==================== Private Methods ====================

  /**
   * Evict oldest trajectory from memory window to pending writes
   */
  private async evictOldest(): Promise<void> {
    // Find oldest trajectory
    let oldestId: TrajectoryID | null = null;
    let oldestTime = Infinity;
    let oldestTrajectory: ITrajectory | null = null;

    for (const [id, trajectory] of this.memoryWindow) {
      if (trajectory.createdAt < oldestTime) {
        oldestTime = trajectory.createdAt;
        oldestId = id;
        oldestTrajectory = trajectory;
      }
    }

    if (!oldestId || !oldestTrajectory) {
      return;
    }

    // Add to pending writes BEFORE removing from memory
    this.pendingWrites.push(oldestTrajectory);

    // Remove from memory window
    this.memoryWindow.delete(oldestId);

    // Update stats
    this.stats.memoryCount = this.memoryWindow.size;
    this.stats.pendingWrites = this.pendingWrites.length;
  }

  /**
   * Prune oldest metadata entries when limit exceeded (ANTI-005)
   *
   * Uses LRU eviction: removes entries with oldest createdAt timestamps.
   * Only prunes metadata for trajectories that have been flushed to disk.
   */
  private pruneMetadata(): void {
    const maxEntries = this.config.maxMetadataEntries ?? 10000;

    // Skip if unlimited (0) or under limit
    if (maxEntries === 0 || this.metadata.size <= maxEntries) {
      return;
    }

    // Calculate how many to remove (prune 10% beyond limit to avoid frequent pruning)
    const targetSize = Math.floor(maxEntries * 0.9);
    const toRemove = this.metadata.size - targetSize;

    if (toRemove <= 0) {
      return;
    }

    // Sort by createdAt (oldest first), excluding in-memory trajectories
    const candidates: Array<{ id: TrajectoryID; createdAt: number }> = [];
    for (const [id, meta] of this.metadata.entries()) {
      // Only prune metadata for flushed trajectories (fileIndex >= 0)
      // and trajectories not in memory window
      if (meta.fileIndex >= 0 && !this.memoryWindow.has(id)) {
        candidates.push({ id, createdAt: meta.createdAt });
      }
    }

    // Sort by createdAt ascending (oldest first)
    candidates.sort((a, b) => a.createdAt - b.createdAt);

    // Remove oldest entries
    const removeCount = Math.min(toRemove, candidates.length);
    for (let i = 0; i < removeCount; i++) {
      this.metadata.delete(candidates[i].id);
    }

    // Log pruning activity
    if (removeCount > 0) {
      console.log(`[TrajectoryStreamManager] Pruned ${removeCount} metadata entries (limit: ${maxEntries})`);
    }
  }

  /**
   * Flush pending writes to disk
   */
  private async flushPendingWrites(): Promise<void> {
    if (this.pendingWrites.length === 0) {
      return;
    }

    // 1. Encode trajectories with correct version
    const version = this.config.formatVersion ?? 2;
    const encoded = version === 1 ? this.encodeV1(this.pendingWrites) : this.encodeV2(this.pendingWrites);

    // 2. Write to data file
    const filePath = join(this.config.storageDir, `data_${String(this.currentFileIndex).padStart(6, '0')}.bin`);
    const tempPath = `${filePath}.tmp`;

    await writeFile(tempPath, encoded);
    await rename(tempPath, filePath);

    // 3. Update metadata
    let offset = 0;
    for (const trajectory of this.pendingWrites) {
      const metadata = this.metadata.get(trajectory.id);
      if (metadata) {
        metadata.fileIndex = this.currentFileIndex;
        metadata.offset = offset;
        metadata.size = JSON.stringify(trajectory).length; // Approximate
        offset += metadata.size;
      }
    }

    // 4. Update stats - diskCount is based on metadata not memory
    const diskCount = Array.from(this.metadata.values()).filter(m => m.fileIndex !== -1).length;
    this.stats.diskCount = diskCount;
    this.stats.bytesOnDisk += encoded.length;

    // 5. Clear pending writes
    this.pendingWrites = [];
    this.stats.pendingWrites = 0;

    // 6. Increment file index
    this.currentFileIndex++;

    // 7. Save index
    await this.saveIndex();
  }

  /**
   * Read trajectory from disk
   */
  private async readTrajectoryFromDisk(metadata: ITrajectoryMetadata): Promise<ITrajectory | null> {
    const filePath = join(this.config.storageDir, `data_${String(metadata.fileIndex).padStart(6, '0')}.bin`);

    if (!existsSync(filePath)) {
      return null;
    }

    const buffer = await readFile(filePath);
    const trajectories = this.decodeV2(buffer);

    // Find trajectory by ID
    return trajectories.find(t => t.id === metadata.id) || null;
  }

  /**
   * Load index from disk
   */
  private async loadIndex(): Promise<void> {
    const indexPath = join(this.config.storageDir, 'index.json');

    if (!existsSync(indexPath)) {
      return;
    }

    const index = await this.loadIndexFile();

    // Reconstruct metadata map
    this.metadata.clear();
    for (const meta of index.metadata) {
      this.metadata.set(meta.id, meta);
    }

    // Restore baseline checkpoint IDs from persisted data
    if (index.baselineCheckpointIds) {
      for (const id of index.baselineCheckpointIds) {
        const meta = this.metadata.get(id);
        if (meta) {
          meta.isBaseline = true;
        }
      }
    }

    // Update stats
    this.stats.totalCount = index.totalTrajectories;
    this.stats.diskCount = index.totalTrajectories;
    this.currentFileIndex = index.dataFiles.length;
  }

  /**
   * Load index file
   */
  private async loadIndexFile(): Promise<IIndexFile> {
    const indexPath = join(this.config.storageDir, 'index.json');

    if (!existsSync(indexPath)) {
      return {
        version: '1.2.0',
        formatVersion: this.config.formatVersion ?? 2,
        totalTrajectories: 0,
        dataFiles: [],
        metadata: [],
      };
    }

    const content = await readFile(indexPath, 'utf-8');
    return JSON.parse(content);
  }

  /**
   * Save index to disk
   */
  private async saveIndex(): Promise<void> {
    // Extract baseline checkpoint IDs from metadata
    const baselineIds = Array.from(this.metadata.values())
      .filter(meta => meta.isBaseline)
      .map(meta => meta.id);

    const index: IIndexFile = {
      version: '1.2.0',
      formatVersion: this.config.formatVersion ?? 2,
      totalTrajectories: this.stats.totalCount,
      dataFiles: this.getDataFileInfo(),
      metadata: Array.from(this.metadata.values()),
      baselineCheckpointIds: baselineIds,
    };

    await this.saveIndexFile(index);
  }

  /**
   * Save index file
   */
  private async saveIndexFile(index: IIndexFile): Promise<void> {
    const indexPath = join(this.config.storageDir, 'index.json');
    const tempPath = `${indexPath}.tmp`;

    await writeFile(tempPath, JSON.stringify(index, null, 2));
    await rename(tempPath, indexPath);
  }

  /**
   * Get data file information
   */
  private getDataFileInfo(): IDataFileInfo[] {
    const fileMap = new Map<number, IDataFileInfo>();

    for (const metadata of this.metadata.values()) {
      if (metadata.fileIndex === -1) {
        continue;
      }

      let fileInfo = fileMap.get(metadata.fileIndex);
      if (!fileInfo) {
        fileInfo = {
          fileIndex: metadata.fileIndex,
          trajectoryCount: 0,
          sizeBytes: 0,
          oldestTimestamp: Infinity,
          newestTimestamp: 0,
        };
        fileMap.set(metadata.fileIndex, fileInfo);
      }

      fileInfo.trajectoryCount++;
      fileInfo.sizeBytes += metadata.size;
      fileInfo.oldestTimestamp = Math.min(fileInfo.oldestTimestamp, metadata.createdAt);
      fileInfo.newestTimestamp = Math.max(fileInfo.newestTimestamp, metadata.createdAt);
    }

    return Array.from(fileMap.values()).sort((a, b) => a.fileIndex - b.fileIndex);
  }

  /**
   * Update memory statistics
   */
  private updateMemoryStats(): void {
    const memUsage = process.memoryUsage();
    this.stats.heapUsed = memUsage.heapUsed;
    this.stats.heapLimit = memUsage.heapTotal;
    this.stats.heapPressure = memUsage.heapUsed / memUsage.heapTotal;
  }

  /**
   * Acquire query slot
   */
  private async acquireQuerySlot(): Promise<void> {
    const maxQueries = this.config.maxConcurrentQueries ?? 10;
    if (this.activeQueries < maxQueries) {
      this.activeQueries++;
      return;
    }

    // Wait for slot
    return new Promise((resolve) => {
      this.queryQueue.push(async () => {
        this.activeQueries++;
        resolve();
      });
    });
  }

  /**
   * Release query slot
   */
  private releaseQuerySlot(): void {
    this.activeQueries--;

    const next = this.queryQueue.shift();
    if (next) {
      next();
    }
  }

  /**
   * Encode v1 format (simple length-prefixed JSON records)
   */
  private encodeV1(trajectories: ITrajectory[]): Buffer {
    const records: Buffer[] = [];

    // Create 16-byte header (simple format)
    const header = Buffer.alloc(16);
    header.write('TRAJ', 0, 4, 'utf8');
    header.writeUInt32LE(1, 4); // Version 1
    header.writeUInt32LE(trajectories.length, 8);
    header.writeUInt32LE(0, 12); // Reserved
    records.push(header);

    // Encode each trajectory as length-prefixed record
    for (const trajectory of trajectories) {
      const json = JSON.stringify(trajectory);
      const data = this.config.compressionEnabled
        ? lz4.encode(Buffer.from(json))
        : Buffer.from(json);

      const lengthBuffer = Buffer.allocUnsafe(4);
      lengthBuffer.writeUInt32LE(data.length, 0);

      records.push(Buffer.concat([lengthBuffer, data]));
    }

    return Buffer.concat(records);
  }

  /**
   * Decode v1 format
   */
  private decodeV1(buffer: Buffer): ITrajectory[] {
    const trajectories: ITrajectory[] = [];
    let offset = 16; // Skip header

    while (offset < buffer.length) {
      const recordLength = buffer.readUInt32LE(offset);
      offset += 4;

      if (recordLength === 0 || offset + recordLength > buffer.length) {
        break;
      }

      const data = buffer.subarray(offset, offset + recordLength);
      offset += recordLength;

      try {
        let jsonStr: string;
        if (this.isLZ4Compressed(data)) {
          const decompressed = lz4.decode(data);
          jsonStr = decompressed.toString('utf8');
        } else {
          jsonStr = data.toString('utf8');
        }

        const parsed = JSON.parse(jsonStr);

        // V1 → V2 conversion: Add new fields with defaults
        const trajectory: ITrajectory = {
          id: parsed.id,
          route: parsed.route,
          patterns: parsed.patterns,
          context: parsed.context ?? [],
          createdAt: parsed.createdAt,
          quality: parsed.quality,
          reward: parsed.reward,
        };

        trajectories.push(trajectory);
      } catch (error) {
        console.warn('[decodeV1] Failed to parse record:', error);
      }
    }

    return trajectories;
  }

  /**
   * Decode v2 format
   */
  private decodeV2(buffer: Buffer): ITrajectory[] {
    const trajectories: ITrajectory[] = [];

    // Parse header
    const magic = buffer.toString('utf8', 0, 4);
    if (magic !== 'TRAJ') {
      throw new Error(`Invalid magic bytes: ${magic}`);
    }

    const version = buffer.readUInt32LE(4);
    if (version !== 2) {
      // Fall back to v1
      return this.decodeV1(buffer);
    }
    const checksum = buffer.readUInt32LE(12);
    const rollbackStateOffset = buffer.readUInt32LE(16);

    // Verify checksum
    const dataForChecksum = Buffer.concat([
      buffer.subarray(0, 12),
      buffer.subarray(16),
    ]);
    const calculatedChecksum = crc32(dataForChecksum);

    if (checksum !== calculatedChecksum) {
      console.warn(`[decodeV2] Checksum mismatch: expected ${checksum}, got ${calculatedChecksum}`);
    }

    // Read trajectory records
    let offset = 20;
    const endOffset = rollbackStateOffset > 0 ? rollbackStateOffset : buffer.length;

    while (offset < endOffset) {
      const recordLength = buffer.readUInt32LE(offset);
      offset += 4;

      if (recordLength === 0 || offset + recordLength > endOffset) {
        break;
      }

      const data = buffer.subarray(offset, offset + recordLength);
      offset += recordLength;

      try {
        let jsonStr: string;
        if (this.isLZ4Compressed(data)) {
          const decompressed = lz4.decode(data);
          jsonStr = decompressed.toString('utf8');
        } else {
          jsonStr = data.toString('utf8');
        }

        const parsed = JSON.parse(jsonStr);
        trajectories.push(parsed);
      } catch (error) {
        console.warn('[decodeV2] Failed to parse record:', error);
      }
    }

    return trajectories;
  }

  /**
   * Encode v2 format
   */
  private encodeV2(trajectories: ITrajectory[]): Buffer {
    const records: Buffer[] = [];

    // Encode each trajectory
    for (const trajectory of trajectories) {
      const json = JSON.stringify(trajectory);

      const data = this.config.compressionEnabled
        ? lz4.encode(Buffer.from(json))
        : Buffer.from(json);

      const lengthBuffer = Buffer.allocUnsafe(4);
      lengthBuffer.writeUInt32LE(data.length, 0);

      records.push(Buffer.concat([lengthBuffer, data]));
    }

    const recordsBuffer = Buffer.concat(records);

    // Create rollback state section
    const rollbackBuffer = Buffer.from(JSON.stringify(this.rollbackState));

    // Calculate offsets
    const headerSize = 20;
    const rollbackStateOffset = headerSize + recordsBuffer.length;

    // Create header
    const header = Buffer.allocUnsafe(20);
    header.write('TRAJ', 0, 4, 'utf8');
    header.writeUInt32LE(2, 4); // Version
    header.writeUInt32LE(trajectories.length, 8);
    header.writeUInt32LE(0, 12); // Checksum placeholder
    header.writeUInt32LE(rollbackStateOffset, 16);

    // Combine all parts
    const fullBuffer = Buffer.concat([header, recordsBuffer, rollbackBuffer]);

    // Calculate and insert checksum
    const dataForChecksum = Buffer.concat([
      fullBuffer.subarray(0, 12),
      fullBuffer.subarray(16),
    ]);
    const checksum = crc32(dataForChecksum);
    fullBuffer.writeUInt32LE(checksum, 12);

    return fullBuffer;
  }

  /**
   * Check if data is LZ4 compressed
   */
  private isLZ4Compressed(data: Buffer): boolean {
    return data.length >= 4 &&
      data[0] === 0x04 &&
      data[1] === 0x22 &&
      data[2] === 0x4D &&
      data[3] === 0x18;
  }

  /**
   * Migrate trajectories from one version to another
   */
  private migrateTrajectories(trajectories: ITrajectory[], fromVersion: number, toVersion: number): ITrajectory[] {
    if (fromVersion === toVersion) {
      return trajectories;
    }

    // V1 to V2: No field changes needed, just return as-is
    if (fromVersion === 1 && toVersion === 2) {
      return trajectories;
    }

    return trajectories;
  }


  /**
   * Read data file with version detection
   */
  private async readDataFile(fileIndex: number, version: number): Promise<ITrajectory[]> {
    const filePath = join(this.config.storageDir, `data_${String(fileIndex).padStart(6, '0')}.bin`);

    if (!existsSync(filePath)) {
      return [];
    }

    const buffer = await readFile(filePath);

    if (version === 1) {
      return this.decodeV1(buffer);
    } else {
      return this.decodeV2(buffer);
    }
  }

  /**
   * Write data file with version encoding
   */
  private async writeDataFile(fileIndex: number, trajectories: ITrajectory[], version: number): Promise<void> {
    const filePath = join(this.config.storageDir, `data_${String(fileIndex).padStart(6, '0')}.bin`);
    const tempPath = `${filePath}.tmp`;

    const encoded = version === 1 ? this.encodeV1(trajectories) : this.encodeV2(trajectories);

    await writeFile(tempPath, encoded);
    await rename(tempPath, filePath);
  }

  /**
   * Create backup of storage directory
   */
  private async createBackup(backupDir: string): Promise<string> {
    const timestamp = Date.now();
    const backupPath = join(backupDir, `trajectories-backup-${timestamp}`);

    await mkdir(backupPath, { recursive: true });

    // Copy index
    const indexPath = join(this.config.storageDir, 'index.json');
    if (existsSync(indexPath)) {
      const indexContent = await readFile(indexPath);
      await writeFile(join(backupPath, 'index.json'), indexContent);
    }

    // Copy data files
    const index = await this.loadIndexFile();
    for (const fileInfo of index.dataFiles) {
      const fileName = `data_${String(fileInfo.fileIndex).padStart(6, '0')}.bin`;
      const sourcePath = join(this.config.storageDir, fileName);
      const destPath = join(backupPath, fileName);

      if (existsSync(sourcePath)) {
        const content = await readFile(sourcePath);
        await writeFile(destPath, content);
      }
    }

    return backupPath;
  }

  /**
   * Save rollback state to disk
   */
  private async saveRollbackState(): Promise<void> {
    const statePath = join(this.config.storageDir, 'rollback-state.json');
    const tempPath = `${statePath}.tmp`;

    await writeFile(tempPath, JSON.stringify(this.rollbackState, null, 2));
    await rename(tempPath, statePath);
  }
}
