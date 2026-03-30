/**
 * TASK-CAPIDX-001: CapabilityIndex Hash-Based Caching
 * Agent 2: Implementation
 *
 * Constitution Compliance:
 * - RULE-008: Persist to disk (.agentdb/capability-cache/)
 * - RULE-009: Full state restore on restart
 * - RULE-015: Cache with eviction policy (hash mismatch)
 * - RULE-046: Atomic writes (temp file + rename)
 * - RULE-003: Requirement comments (REQ-CAPIDX-*)
 *
 * Performance Targets:
 * - Hash computation: < 500ms for 200 agents
 * - Cache hit load: < 100ms
 * - Cache save: < 1000ms
 *
 * @module src/god-agent/core/routing/capability-cache
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { TaskDomain } from './routing-types.js';

// ==================== Constants ====================

/** REQ-CAPIDX-002: Cache storage directory */
const CACHE_DIR = '.agentdb/capability-cache';

/** REQ-CAPIDX-005: Embedding dimension validation */
const EMBEDDING_DIMENSION = 1536;

/** REQ-CAPIDX-005: Cache format version for compatibility */
const CACHE_FORMAT_VERSION = 1;

/** REQ-CAPIDX-002: Cache file names */
const CACHE_FILES = {
  HASH: 'hash.txt',
  EMBEDDINGS: 'embeddings.json',
  METADATA: 'metadata.json',
} as const;

// ==================== Types ====================

/**
 * REQ-CAPIDX-007: Reasons why cache is invalid
 */
export type CacheInvalidReason =
  | 'CACHE_NOT_FOUND'
  | 'HASH_MISMATCH'
  | 'CORRUPTED_JSON'
  | 'DIMENSION_MISMATCH'
  | 'AGENT_COUNT_MISMATCH'
  | 'VERSION_MISMATCH'
  | 'METADATA_MISSING';

/**
 * REQ-CAPIDX-005: Cache validation result
 */
export interface CacheValidationResult {
  isValid: boolean;
  reason?: CacheInvalidReason;
  details?: string;
}

/**
 * REQ-CAPIDX-002: Cache metadata stored in metadata.json
 */
export interface ICacheMetadata {
  version: string;
  cacheFormatVersion: number;
  createdAt: number;
  lastValidatedAt: number;
  contentHash: string;
  agentCount: number;
  embeddingDimension: number;
  embeddingProvider: string;
  agentsPath: string;
  buildDurationMs: number;
  fileHashes: Record<string, string>;
}

/**
 * REQ-CAPIDX-002: Single cached embedding entry
 */
export interface ICachedEmbedding {
  agentKey: string;
  name: string;
  description: string;
  domains: TaskDomain[];
  keywords: string[];
  embedding: number[];
  successRate: number;
  taskCount: number;
  indexedAt: number;
}

/**
 * REQ-CAPIDX-002: Cached embeddings stored in embeddings.json
 */
export interface ICachedEmbeddings {
  version: string;
  generatedAt: number;
  embeddingDimension: number;
  agentCount: number;
  entries: Record<string, ICachedEmbedding>;
}

/**
 * REQ-CAPIDX-006: Cache statistics for monitoring
 */
export interface ICacheStats {
  exists: boolean;
  isValid: boolean;
  sizeBytes: number;
  agentCount: number;
  createdAt: number;
  currentHash: string;
  cachedHash: string | null;
  hashMatch: boolean;
}

/**
 * REQ-CAPIDX-003: Cache interface
 */
export interface ICapabilityIndexCache {
  computeContentHash(): Promise<string>;
  isValid(): Promise<boolean>;
  load(): Promise<ICachedEmbeddings | null>;
  save(embeddings: ICachedEmbeddings, hash: string): Promise<void>;
  invalidate(): Promise<void>;
  getStats(): Promise<ICacheStats | null>;
}

// ==================== Implementation ====================

/**
 * CapabilityIndexCache: Hash-based cache for agent embeddings
 *
 * REQ-CAPIDX-001: Computes SHA256 hash of all agent files
 * REQ-CAPIDX-002: Stores cache in .agentdb/capability-cache/
 * REQ-CAPIDX-003: Validates cache on load
 * REQ-CAPIDX-004: Atomic writes using temp files
 * REQ-CAPIDX-005: Validates embedding dimensions and agent count
 * REQ-CAPIDX-006: Performance targets enforced
 * REQ-CAPIDX-007: Comprehensive logging
 * REQ-CAPIDX-008: No breaking changes to public API
 */
export class CapabilityIndexCache implements ICapabilityIndexCache {
  private readonly projectRoot: string;
  private readonly cacheDir: string;
  private readonly agentsPath: string;

  /** REQ-CAPIDX-006: Cached hash to avoid recomputation within same operation */
  private cachedContentHash: string | null = null;
  private cachedHashTimestamp: number = 0;
  // 500ms TTL - enough for isValid()+load() sequence, short enough for tests
  private static readonly HASH_CACHE_TTL_MS = 500;

  /**
   * Initialize cache manager
   *
   * @param projectRoot - Project root directory (default: process.cwd())
   * @param agentsPath - Relative path to agents directory (default: .claude/agents)
   */
  constructor(projectRoot: string = process.cwd(), agentsPath: string = '.claude/agents') {
    this.projectRoot = projectRoot;
    this.cacheDir = path.join(projectRoot, CACHE_DIR);
    this.agentsPath = path.join(projectRoot, agentsPath);
  }

  /**
   * REQ-CAPIDX-001: Recursively find all .md files in a directory
   * Uses fs.readdir instead of glob for no external dependencies
   *
   * @param dirPath - Directory to search
   * @returns Array of absolute file paths
   */
  private async findMarkdownFiles(dirPath: string): Promise<string[]> {
    const results: string[] = [];

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Recursively search subdirectories
          const subFiles = await this.findMarkdownFiles(fullPath);
          results.push(...subFiles);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          results.push(fullPath);
        }
      }
    } catch (error) {
      // Directory doesn't exist or can't be read
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    return results;
  }

  /**
   * REQ-CAPIDX-001: Compute SHA256 hash of all agent files
   * REQ-CAPIDX-006: Target < 500ms for 200 agents
   *
   * Algorithm:
   * 1. Recursively find all .md files under .claude/agents/
   * 2. Sort file paths lexicographically for determinism
   * 3. Hash each file's path + content
   * 4. Return composite hash
   *
   * @returns SHA256 hash (64-character hex string)
   * @throws Error if agent directory doesn't exist or read fails
   */
  async computeContentHash(): Promise<string> {
    // REQ-CAPIDX-006: Return cached hash if still fresh (within TTL)
    const now = Date.now();
    if (
      this.cachedContentHash !== null &&
      now - this.cachedHashTimestamp < CapabilityIndexCache.HASH_CACHE_TTL_MS
    ) {
      return this.cachedContentHash;
    }

    const startTime = performance.now();

    try {
      // REQ-CAPIDX-001: Find all agent markdown files using recursive readdir
      const files = await this.findMarkdownFiles(this.agentsPath);

      // Sort for deterministic ordering
      files.sort();

      if (files.length === 0) {
        throw new Error(`No agent files found in ${this.agentsPath}`);
      }

      console.log(`[CapabilityCache] Computing content hash for ${files.length} files`);

      // Create hash context
      const hash = crypto.createHash('sha256');

      // Hash each file's path and content
      for (const file of files) {
        const absolutePath = path.isAbsolute(file) ? file : path.join(this.projectRoot, file);
        const relativePath = path.relative(this.projectRoot, absolutePath);
        const content = await fs.readFile(absolutePath, 'utf-8');

        // Include path to detect renames
        hash.update(relativePath);
        hash.update('\n');
        hash.update(content);
      }

      const result = hash.digest('hex');
      const duration = performance.now() - startTime;

      console.log(`[CapabilityCache] Hash computed in ${duration.toFixed(2)}ms: ${result.slice(0, 16)}...`);

      // REQ-CAPIDX-006: Warn if performance target exceeded
      if (duration > 500) {
        console.warn(`[CapabilityCache] Hash computation exceeded 500ms target: ${duration.toFixed(2)}ms`);
      }

      // REQ-CAPIDX-006: Cache the computed hash for performance
      this.cachedContentHash = result;
      this.cachedHashTimestamp = Date.now();

      return result;
    } catch (error) {
      throw new Error(`Failed to compute content hash: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * REQ-CAPIDX-003: Quick validation check
   * REQ-CAPIDX-005: Validates cache integrity
   *
   * Validation sequence (optimized for speed):
   * 1. Check hash.txt exists (~1ms)
   * 2. Compute current hash and compare (~100-500ms)
   * 3. If hash matches, assume cache is valid
   *
   * @returns true if cache is valid and can be loaded
   */
  async isValid(): Promise<boolean> {
    try {
      const result = await this.validateCache();
      return result.isValid;
    } catch (error) {
      return false;
    }
  }

  /**
   * REQ-CAPIDX-003: Load cached embeddings with validation
   * REQ-CAPIDX-005: Full validation of cache integrity
   * REQ-CAPIDX-006: Target < 100ms on cache hit
   * REQ-CAPIDX-007: Comprehensive logging
   *
   * @returns Cached embeddings if valid, null if invalid or missing
   */
  async load(): Promise<ICachedEmbeddings | null> {
    const startTime = performance.now();

    try {
      // REQ-CAPIDX-005: Validate cache
      const validation = await this.validateCache();
      if (!validation.isValid) {
        console.log(`[CapabilityCache] Cache MISS - ${validation.reason}: ${validation.details || ''}`);
        return null;
      }

      // Load embeddings
      const embeddingsPath = path.join(this.cacheDir, CACHE_FILES.EMBEDDINGS);
      const embeddingsData = await fs.readFile(embeddingsPath, 'utf-8');
      const embeddings: ICachedEmbeddings = JSON.parse(embeddingsData);

      const duration = performance.now() - startTime;

      // REQ-CAPIDX-007: Log successful cache hit
      console.log(`[CapabilityCache] Cache HIT - loaded ${embeddings.agentCount} agents in ${duration.toFixed(2)}ms`);

      // REQ-CAPIDX-006: Warn if performance target exceeded
      if (duration > 100) {
        console.warn(`[CapabilityCache] Cache load exceeded 100ms target: ${duration.toFixed(2)}ms`);
      }

      return embeddings;
    } catch (error) {
      console.log(`[CapabilityCache] Cache MISS - load failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * REQ-CAPIDX-005: Comprehensive cache validation
   *
   * Validation rules (in order):
   * 1. RULE-VAL-001: Hash file exists
   * 2. RULE-VAL-002: Hash matches
   * 3. RULE-VAL-006: Metadata exists
   * 4. RULE-VAL-007: Version compatibility
   * 5. RULE-VAL-003: Valid JSON
   * 6. RULE-VAL-004: Dimension check
   * 7. RULE-VAL-005: Agent count match
   *
   * @returns Validation result
   */
  private async validateCache(): Promise<CacheValidationResult> {
    try {
      // RULE-VAL-001: Check hash file exists
      const hashPath = path.join(this.cacheDir, CACHE_FILES.HASH);
      try {
        await fs.access(hashPath);
      } catch {
        return {
          isValid: false,
          reason: 'CACHE_NOT_FOUND',
          details: 'hash.txt not found',
        };
      }

      // RULE-VAL-002: Compare hashes
      const cachedHash = (await fs.readFile(hashPath, 'utf-8')).trim();
      const currentHash = await this.computeContentHash();

      if (cachedHash !== currentHash) {
        return {
          isValid: false,
          reason: 'HASH_MISMATCH',
          details: `cached=${cachedHash.slice(0, 8)}... current=${currentHash.slice(0, 8)}...`,
        };
      }

      // RULE-VAL-006: Check metadata exists
      const metadataPath = path.join(this.cacheDir, CACHE_FILES.METADATA);
      let metadata: ICacheMetadata;
      try {
        const metadataData = await fs.readFile(metadataPath, 'utf-8');
        metadata = JSON.parse(metadataData);
      } catch {
        return {
          isValid: false,
          reason: 'METADATA_MISSING',
          details: 'metadata.json not found or invalid',
        };
      }

      // RULE-VAL-007: Check version compatibility
      if (metadata.cacheFormatVersion !== CACHE_FORMAT_VERSION) {
        return {
          isValid: false,
          reason: 'VERSION_MISMATCH',
          details: `cache version ${metadata.cacheFormatVersion}, expected ${CACHE_FORMAT_VERSION}`,
        };
      }

      // RULE-VAL-003: Parse embeddings JSON
      const embeddingsPath = path.join(this.cacheDir, CACHE_FILES.EMBEDDINGS);
      let embeddings: ICachedEmbeddings;
      try {
        const embeddingsData = await fs.readFile(embeddingsPath, 'utf-8');
        embeddings = JSON.parse(embeddingsData);
      } catch {
        return {
          isValid: false,
          reason: 'CORRUPTED_JSON',
          details: 'embeddings.json not found or invalid JSON',
        };
      }

      // RULE-VAL-004: Validate embedding dimensions (sample check)
      const sampleKeys = Object.keys(embeddings.entries).slice(0, 5);
      for (const key of sampleKeys) {
        const entry = embeddings.entries[key];
        if (entry.embedding.length !== EMBEDDING_DIMENSION) {
          return {
            isValid: false,
            reason: 'DIMENSION_MISMATCH',
            details: `agent ${key} has ${entry.embedding.length}D, expected ${EMBEDDING_DIMENSION}D`,
          };
        }
      }

      // RULE-VAL-005: Validate agent count
      const entryCount = Object.keys(embeddings.entries).length;
      if (entryCount !== embeddings.agentCount) {
        return {
          isValid: false,
          reason: 'AGENT_COUNT_MISMATCH',
          details: `entries=${entryCount}, declared=${embeddings.agentCount}`,
        };
      }

      return { isValid: true };
    } catch (error) {
      return {
        isValid: false,
        reason: 'CORRUPTED_JSON',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * REQ-CAPIDX-004: Atomic cache write
   * REQ-CAPIDX-046: Temp file + rename pattern
   * REQ-CAPIDX-006: Target < 1000ms
   * REQ-CAPIDX-007: Logging
   *
   * Write sequence:
   * 1. Ensure cache directory exists
   * 2. Write all files to .tmp versions
   * 3. Atomic rename in order: embeddings -> metadata -> hash
   * 4. Clean up any orphaned .tmp files
   *
   * Rationale: hash.txt is sentinel - its presence indicates valid cache
   *
   * @param embeddings - Embeddings to cache
   * @param hash - Content hash
   */
  async save(embeddings: ICachedEmbeddings, hash: string): Promise<void> {
    const startTime = performance.now();
    const timestamp = Date.now();

    try {
      // 1. Ensure cache directory exists
      await fs.mkdir(this.cacheDir, { recursive: true });

      // 2. Clean up any orphaned temp files from previous crashes
      await this.cleanupTempFiles();

      // 3. Prepare metadata
      const metadata: ICacheMetadata = {
        version: embeddings.version,
        cacheFormatVersion: CACHE_FORMAT_VERSION,
        createdAt: timestamp,
        lastValidatedAt: timestamp,
        contentHash: hash,
        agentCount: embeddings.agentCount,
        embeddingDimension: EMBEDDING_DIMENSION,
        embeddingProvider: 'local',
        agentsPath: this.agentsPath,
        buildDurationMs: 0, // Will be set by caller if needed
        fileHashes: {},
      };

      // 4. Write to temporary files
      const embeddingsTempPath = path.join(this.cacheDir, `${CACHE_FILES.EMBEDDINGS}.${timestamp}.tmp`);
      const metadataTempPath = path.join(this.cacheDir, `${CACHE_FILES.METADATA}.${timestamp}.tmp`);
      const hashTempPath = path.join(this.cacheDir, `${CACHE_FILES.HASH}.${timestamp}.tmp`);

      await fs.writeFile(embeddingsTempPath, JSON.stringify(embeddings, null, 2), 'utf-8');
      await fs.writeFile(metadataTempPath, JSON.stringify(metadata, null, 2), 'utf-8');
      await fs.writeFile(hashTempPath, hash, 'utf-8');

      // 5. Atomic rename in order: embeddings -> metadata -> hash
      // hash.txt is last so it acts as sentinel
      const embeddingsPath = path.join(this.cacheDir, CACHE_FILES.EMBEDDINGS);
      const metadataPath = path.join(this.cacheDir, CACHE_FILES.METADATA);
      const hashPath = path.join(this.cacheDir, CACHE_FILES.HASH);

      await fs.rename(embeddingsTempPath, embeddingsPath);
      await fs.rename(metadataTempPath, metadataPath);
      await fs.rename(hashTempPath, hashPath);

      const duration = performance.now() - startTime;

      // Get file size
      const stats = await fs.stat(embeddingsPath);
      const sizeBytes = stats.size;

      // REQ-CAPIDX-007: Log successful save
      console.log(
        `[CapabilityCache] Saved cache: ${embeddings.agentCount} agents, ${(sizeBytes / 1024 / 1024).toFixed(2)}MB in ${duration.toFixed(2)}ms`
      );

      // REQ-CAPIDX-006: Warn if performance target exceeded
      if (duration > 1000) {
        console.warn(`[CapabilityCache] Cache save exceeded 1000ms target: ${duration.toFixed(2)}ms`);
      }
    } catch (error) {
      // Clean up temp files on failure
      await this.cleanupTempFiles();
      throw new Error(`Failed to save cache: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * REQ-CAPIDX-003: Invalidate and delete cache
   * REQ-CAPIDX-007: Logging
   *
   * Deletes all cache files to force rebuild on next load
   */
  /**
   * Clear the in-memory hash cache.
   * Useful for tests that modify files and need fresh hash computation.
   */
  clearHashCache(): void {
    this.cachedContentHash = null;
    this.cachedHashTimestamp = 0;
  }

  async invalidate(): Promise<void> {
    // Clear in-memory hash cache
    this.clearHashCache();

    try {
      const files = [
        path.join(this.cacheDir, CACHE_FILES.HASH),
        path.join(this.cacheDir, CACHE_FILES.EMBEDDINGS),
        path.join(this.cacheDir, CACHE_FILES.METADATA),
      ];

      for (const file of files) {
        try {
          await fs.unlink(file);
        } catch {
          // Ignore if file doesn't exist
        }
      }

      console.log('[CapabilityCache] Cache invalidated');
    } catch (error) {
      throw new Error(`Failed to invalidate cache: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * REQ-CAPIDX-006: Get cache statistics
   *
   * @returns Cache statistics or null if cache doesn't exist
   */
  async getStats(): Promise<ICacheStats | null> {
    try {
      const hashPath = path.join(this.cacheDir, CACHE_FILES.HASH);
      const embeddingsPath = path.join(this.cacheDir, CACHE_FILES.EMBEDDINGS);
      const metadataPath = path.join(this.cacheDir, CACHE_FILES.METADATA);

      // Check if cache exists
      let exists = true;
      try {
        await fs.access(hashPath);
      } catch {
        exists = false;
      }

      if (!exists) {
        return null;
      }

      // Get current and cached hashes
      const currentHash = await this.computeContentHash();
      const cachedHash = (await fs.readFile(hashPath, 'utf-8')).trim();

      // Get metadata
      const metadataData = await fs.readFile(metadataPath, 'utf-8');
      const metadata: ICacheMetadata = JSON.parse(metadataData);

      // Get file size
      const stats = await fs.stat(embeddingsPath);
      const sizeBytes = stats.size;

      // Validate
      const validation = await this.validateCache();

      return {
        exists: true,
        isValid: validation.isValid,
        sizeBytes,
        agentCount: metadata.agentCount,
        createdAt: metadata.createdAt,
        currentHash,
        cachedHash,
        hashMatch: currentHash === cachedHash,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * REQ-CAPIDX-004: Clean up orphaned temporary files
   * Called on startup and after failed writes
   */
  private async cleanupTempFiles(): Promise<void> {
    try {
      const files = await fs.readdir(this.cacheDir);
      const tempFiles = files.filter((f) => f.endsWith('.tmp'));

      for (const file of tempFiles) {
        try {
          await fs.unlink(path.join(this.cacheDir, file));
        } catch {
          // Ignore failures
        }
      }

      if (tempFiles.length > 0) {
        console.log(`[CapabilityCache] Cleaned up ${tempFiles.length} orphaned temp files`);
      }
    } catch {
      // Directory doesn't exist or can't be read - ignore
    }
  }
}
