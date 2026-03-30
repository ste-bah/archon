/**
 * Pattern Storage with Indexing
 *
 * Implements: TASK-PAT-001 (Pattern Store)
 *
 * In-memory pattern storage with task type indexing and persistence.
 * Uses VectorDB for HNSW search and MemoryEngine for persistence.
 */

import { randomUUID } from 'crypto';
import { VectorDB } from '../vector-db/index.js';
import { MemoryEngine } from '../memory/index.js';
import { assertDimensions, cosineSimilarity, withRetry } from '../validation/index.js';
import { Pattern, TaskType, CreatePatternParams, PatternStats } from './pattern-types.js';
import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../observability/index.js';

const logger = createComponentLogger('PatternStore', {
  minLevel: LogLevel.WARN,
  handlers: [new ConsoleLogHandler()]
});

/**
 * Storage key for patterns in MemoryEngine
 */
const PATTERNS_STORAGE_KEY = 'patterns:all';
const PATTERNS_NAMESPACE = 'patterns';

/**
 * Similarity threshold for duplicate detection
 */
const DUPLICATE_SIMILARITY_THRESHOLD = 0.95;

/**
 * In-memory pattern store with indexing and persistence
 */
export class PatternStore {
  /** All patterns by ID */
  private patterns: Map<string, Pattern> = new Map();

  /** Index by task type */
  private indexByTaskType: Map<TaskType, Set<string>> = new Map();

  /** VectorDB for HNSW search */
  private vectorDB: VectorDB;

  /** MemoryEngine for persistence */
  private memoryEngine: MemoryEngine;

  /** Whether patterns have been loaded from storage */
  private initialized: boolean = false;

  constructor(vectorDB: VectorDB, memoryEngine: MemoryEngine) {
    this.vectorDB = vectorDB;
    this.memoryEngine = memoryEngine;

    // Initialize task type indexes
    for (const taskType of Object.values(TaskType)) {
      this.indexByTaskType.set(taskType as TaskType, new Set());
    }
  }

  /**
   * Initialize store by loading patterns from persistence
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Try to load patterns from MemoryEngine
      const result = await this.memoryEngine.retrieve(
        PATTERNS_STORAGE_KEY,
        { namespace: PATTERNS_NAMESPACE }
      );

      if (result) {
        const patternsData = JSON.parse(result) as Array<{
          id: string;
          taskType: TaskType;
          template: string;
          embedding: number[];
          successRate: number;
          sonaWeight: number;
          usageCount: number;
          createdAt: string;
          updatedAt: string;
          metadata?: Record<string, unknown>;
        }>;

        // Restore patterns
        for (const data of patternsData) {
          const pattern: Pattern = {
            id: data.id,
            taskType: data.taskType,
            template: data.template,
            embedding: new Float32Array(data.embedding),
            successRate: data.successRate,
            sonaWeight: data.sonaWeight,
            usageCount: data.usageCount,
            createdAt: new Date(data.createdAt),
            updatedAt: new Date(data.updatedAt),
            metadata: data.metadata
          };

          // Add to in-memory structures
          this.patterns.set(pattern.id, pattern);
          this.indexByTaskType.get(pattern.taskType)?.add(pattern.id);

          // Add to VectorDB with specific ID
          await this.vectorDB.insertWithId(pattern.id, pattern.embedding);
        }
      }
    } catch (error) {
      // If loading fails, start with empty store
      logger.warn('Failed to load patterns from storage', { error: String(error) });
    }

    this.initialized = true;
  }

  /**
   * Add a new pattern to the store
   *
   * @param params - Pattern creation parameters
   * @returns Created pattern
   * @throws Error if successRate < 0.1 (sanity floor) or duplicate detected
   */
  async addPattern(params: CreatePatternParams): Promise<Pattern> {
    // Validate success rate sanity floor (quality gate is in CLI at 0.30)
    if (params.successRate < 0.1) {
      throw new Error(`Pattern successRate ${params.successRate} is below sanity floor 0.1`);
    }

    // Validate embedding dimensions (1536D)
    assertDimensions(params.embedding, 1536, 'Pattern embedding');

    // Check for duplicates (same task type + high similarity)
    const duplicateId = await this.findDuplicate(params.taskType, params.embedding);
    if (duplicateId) {
      throw new Error(`Duplicate pattern detected: ${duplicateId}`);
    }

    // Create pattern
    const pattern: Pattern = {
      id: randomUUID(),
      taskType: params.taskType,
      template: params.template,
      embedding: params.embedding,
      successRate: params.successRate,
      sonaWeight: params.sonaWeight ?? 1.0,
      usageCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: params.metadata
    };

    // Add to in-memory structures
    this.patterns.set(pattern.id, pattern);
    this.indexByTaskType.get(pattern.taskType)?.add(pattern.id);

    // Add to VectorDB with specific ID, with retry (RULE-072: HNSW operations must retry)
    await withRetry(
      () => this.vectorDB.insertWithId(pattern.id, pattern.embedding),
      { operationName: 'PatternStore.addPattern.vectorInsert' }
    );

    // Persist changes
    await this.persist();

    return pattern;
  }

  /**
   * Update an existing pattern
   *
   * @param patternId - Pattern ID to update
   * @param updates - Fields to update
   * @returns Updated pattern
   * @throws Error if pattern not found
   */
  async updatePattern(
    patternId: string,
    updates: Partial<Omit<Pattern, 'id' | 'createdAt' | 'embedding'>>
  ): Promise<Pattern> {
    const pattern = this.patterns.get(patternId);
    if (!pattern) {
      throw new Error(`Pattern not found: ${patternId}`);
    }

    // Update task type index if changed
    if (updates.taskType && updates.taskType !== pattern.taskType) {
      this.indexByTaskType.get(pattern.taskType)?.delete(patternId);
      this.indexByTaskType.get(updates.taskType)?.add(patternId);
    }

    // Apply updates
    const updated: Pattern = {
      ...pattern,
      ...updates,
      updatedAt: new Date()
    };

    this.patterns.set(patternId, updated);

    // Persist changes
    await this.persist();

    return updated;
  }

  /**
   * Delete a pattern from the store
   *
   * @param patternId - Pattern ID to delete
   * @returns True if deleted, false if not found
   */
  async deletePattern(patternId: string): Promise<boolean> {
    const pattern = this.patterns.get(patternId);
    if (!pattern) {
      return false;
    }

    // Remove from in-memory structures
    this.patterns.delete(patternId);
    this.indexByTaskType.get(pattern.taskType)?.delete(patternId);

    // Remove from VectorDB
    await this.vectorDB.delete(patternId);

    // Persist changes
    await this.persist();

    return true;
  }

  /**
   * Get a pattern by ID
   *
   * @param patternId - Pattern ID
   * @returns Pattern or undefined if not found
   */
  getPattern(patternId: string): Pattern | undefined {
    return this.patterns.get(patternId);
  }

  /**
   * Get all patterns for a task type
   *
   * @param taskType - Task type to filter by
   * @returns Array of patterns
   */
  getPatternsByTaskType(taskType: TaskType): Pattern[] {
    const patternIds = this.indexByTaskType.get(taskType);
    if (!patternIds) {
      return [];
    }

    const patterns: Pattern[] = [];
    for (const id of patternIds) {
      const pattern = this.patterns.get(id);
      if (pattern) {
        patterns.push(pattern);
      }
    }

    return patterns;
  }

  /**
   * Get all patterns
   *
   * @returns Array of all patterns
   */
  getAllPatterns(): Pattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Get statistics about the pattern store
   *
   * @returns Pattern statistics
   */
  getStats(): PatternStats {
    const patterns = Array.from(this.patterns.values());

    // Calculate aggregates
    let totalSuccessRate = 0;
    let totalSonaWeight = 0;
    let totalUsageCount = 0;
    let highQualityCount = 0;
    let lowQualityCount = 0;
    let maxSuccessRate = 0;
    let mostUsedPatternId: string | undefined;
    let maxUsageCount = 0;

    const patternsByType = new Map<TaskType, number>();

    for (const pattern of patterns) {
      totalSuccessRate += pattern.successRate;
      totalSonaWeight += pattern.sonaWeight;
      totalUsageCount += pattern.usageCount;

      if (pattern.successRate >= 0.9) {
        highQualityCount++;
      }
      if (pattern.successRate < 0.8) {
        lowQualityCount++;
      }

      if (pattern.successRate > maxSuccessRate) {
        maxSuccessRate = pattern.successRate;
      }

      if (pattern.usageCount > maxUsageCount) {
        maxUsageCount = pattern.usageCount;
        mostUsedPatternId = pattern.id;
      }

      // Count by type
      const count = patternsByType.get(pattern.taskType) ?? 0;
      patternsByType.set(pattern.taskType, count + 1);
    }

    const totalPatterns = patterns.length;

    // Estimate storage size
    const storageSize = this.estimateStorageSize();

    return {
      totalPatterns,
      patternsByType,
      averageSuccessRate: totalPatterns > 0 ? totalSuccessRate / totalPatterns : 0,
      averageSonaWeight: totalPatterns > 0 ? totalSonaWeight / totalPatterns : 0,
      totalUsageCount,
      highQualityPatterns: highQualityCount,
      lowQualityPatterns: lowQualityCount,
      mostUsedPatternId,
      highestSuccessRate: maxSuccessRate,
      storageSize
    };
  }

  /**
   * Find duplicate pattern by task type and similarity
   *
   * @param taskType - Task type to check
   * @param embedding - Embedding to compare
   * @returns Pattern ID if duplicate found, undefined otherwise
   */
  private async findDuplicate(
    taskType: TaskType,
    embedding: Float32Array
  ): Promise<string | undefined> {
    const candidates = this.getPatternsByTaskType(taskType);

    for (const pattern of candidates) {
      const similarity = cosineSimilarity(embedding, pattern.embedding);
      if (similarity > DUPLICATE_SIMILARITY_THRESHOLD) {
        return pattern.id;
      }
    }

    return undefined;
  }

  /**
   * Persist patterns to MemoryEngine
   *
   * Implements: TASK-ERR-004, RULE-072 (database retry on failure)
   */
  private async persist(): Promise<void> {
    const patterns = Array.from(this.patterns.values());

    // Convert to serializable format
    const patternsData = patterns.map(pattern => ({
      id: pattern.id,
      taskType: pattern.taskType,
      template: pattern.template,
      embedding: Array.from(pattern.embedding),
      successRate: pattern.successRate,
      sonaWeight: pattern.sonaWeight,
      usageCount: pattern.usageCount,
      createdAt: pattern.createdAt.toISOString(),
      updatedAt: pattern.updatedAt.toISOString(),
      metadata: pattern.metadata
    }));

    // Store in MemoryEngine with retry (RULE-072)
    // Pass a sentinel unit-vector embedding to skip auto-embed of the large JSON blob.
    // Patterns are retrieved by exact key, not semantic search, so embedding value is irrelevant.
    // Must be L2-normalized (norm=1.0) to pass VectorDB's assertDimensions validation.
    const sentinel = new Float32Array(1536);
    sentinel[0] = 1.0;
    await withRetry(
      () => this.memoryEngine.store(
        PATTERNS_STORAGE_KEY,
        JSON.stringify(patternsData),
        { namespace: PATTERNS_NAMESPACE, embedding: sentinel }
      ),
      { operationName: 'PatternStore.persist' }
    );
  }

  /**
   * Estimate storage size in bytes
   */
  private estimateStorageSize(): number {
    let size = 0;

    for (const pattern of this.patterns.values()) {
      // Pattern object overhead
      size += 200; // Approximate object overhead

      // String fields
      size += pattern.id.length * 2;
      size += pattern.taskType.length * 2;
      size += pattern.template.length * 2;

      // Embedding (1536 * 4 bytes per float32)
      size += 1536 * 4;

      // Metadata
      if (pattern.metadata) {
        size += JSON.stringify(pattern.metadata).length * 2;
      }
    }

    return size;
  }
}
