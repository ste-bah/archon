/**
 * Pattern Matcher - Template-based Pattern Retrieval
 *
 * Implements: TASK-PAT-001 (Pattern Matcher)
 *
 * Main PatternMatcher class providing pattern retrieval, creation, and management.
 * Performance targets:
 * - Pattern retrieval: <5ms for k=100
 * - Confidence scoring: <1ms per pattern
 */

import { VectorDB, SearchResult } from '../vector-db/index.js';
import { MemoryEngine } from '../memory/index.js';
import { assertDimensions } from '../validation/index.js';
import {
  Pattern,
  PatternQuery,
  PatternResult,
  PatternStats,
  CreatePatternParams,
  UpdateSuccessParams,
  PruneParams,
  PruneResult,
  TaskType
} from './pattern-types.js';
import {
  rankPatterns,
  filterPatterns,
  createPatternResult
} from './confidence-scorer.js';
import { PatternStore } from './pattern-store.js';

/**
 * Default values for pattern queries
 */
const DEFAULT_TOP_K = 10;
const DEFAULT_MIN_CONFIDENCE = 0.0;
const DEFAULT_MIN_SUCCESS_RATE = 0.8;
const DEFAULT_MIN_SONA_WEIGHT = 0.0;

/**
 * Exponential moving average alpha for success rate updates
 */
const EMA_ALPHA = 0.2;

/**
 * Main PatternMatcher class
 *
 * Provides template-based retrieval of successful reasoning patterns
 * using HNSW vector search and confidence scoring.
 */
export class PatternMatcher {
  private patternStore: PatternStore;
  private vectorDB: VectorDB;
  private initialized: boolean = false;

  /**
   * Create a new PatternMatcher instance
   *
   * @param vectorDB - VectorDB instance for HNSW search
   * @param memoryEngine - MemoryEngine instance for persistence
   */
  constructor(vectorDB: VectorDB, memoryEngine: MemoryEngine) {
    this.vectorDB = vectorDB;
    this.patternStore = new PatternStore(vectorDB, memoryEngine);
  }

  /**
   * Initialize the pattern matcher by loading patterns from storage
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.patternStore.initialize();
    this.initialized = true;
  }

  /**
   * Find patterns matching a query
   *
   * Performance target: <5ms for k=100
   *
   * @param query - Pattern query parameters
   * @returns Array of ranked pattern results
   */
  async findPatterns(query: PatternQuery): Promise<PatternResult[]> {
    this.ensureInitialized();

    // Validate and set defaults
    const topK = query.topK ?? DEFAULT_TOP_K;
    const minConfidence = query.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    const minSuccessRate = query.minSuccessRate ?? DEFAULT_MIN_SUCCESS_RATE;
    const minSonaWeight = query.minSonaWeight ?? DEFAULT_MIN_SONA_WEIGHT;

    // Get embedding from query
    let embedding: Float32Array;
    if (query.embedding) {
      assertDimensions(query.embedding, 1536, 'Query embedding');
      embedding = query.embedding;
    } else if (query.query) {
      // If only text query provided, would need embedding provider
      // For now, require embedding to be provided
      throw new Error('Query embedding must be provided');
    } else {
      throw new Error('Either query or embedding must be provided');
    }

    // Get candidates using VectorDB HNSW search
    let searchResults: SearchResult[];

    if (query.taskType) {
      // Filter by task type - get patterns for this type and search only those
      const taskPatterns = this.patternStore.getPatternsByTaskType(query.taskType);
      const taskPatternIds = new Set(taskPatterns.map(p => p.id));

      // Search all and filter by task type
      const allResults = await this.vectorDB.search(embedding, topK * 2); // Get extra for filtering
      searchResults = allResults.filter(r => taskPatternIds.has(r.id)).slice(0, topK);
    } else {
      // No task type filter - search all
      searchResults = await this.vectorDB.search(embedding, topK);
    }

    // Convert to PatternResults with confidence scores
    const patternResults: PatternResult[] = [];

    for (const result of searchResults) {
      const pattern = this.patternStore.getPattern(result.id);
      if (!pattern) {
        continue; // Pattern was deleted
      }

      // Create pattern result with confidence scoring
      const patternResult = createPatternResult(
        pattern,
        result.similarity,
        0, // Rank will be set later
        true // Calibrate confidence
      );

      patternResults.push(patternResult);
    }

    // Filter by thresholds
    const filtered = filterPatterns(
      patternResults,
      minConfidence,
      minSuccessRate,
      minSonaWeight
    );

    // Rank patterns
    const ranked = rankPatterns(filtered);

    return ranked;
  }

  /**
   * Create a new pattern
   *
   * Only creates patterns with successRate >= 0.1 (sanity floor)
   *
   * @param params - Pattern creation parameters
   * @returns Created pattern
   * @throws Error if successRate < 0.1 or duplicate detected
   */
  async createPattern(params: CreatePatternParams): Promise<Pattern> {
    this.ensureInitialized();

    // Validate success rate threshold
    if (params.successRate < 0.1) {
      throw new Error(
        `Cannot create pattern with successRate ${params.successRate} below threshold 0.1`
      );
    }

    // Create pattern through store
    const pattern = await this.patternStore.addPattern(params);

    return pattern;
  }

  /**
   * Update pattern success using exponential moving average
   *
   * Formula: newSuccessRate = alpha * newValue + (1 - alpha) * oldSuccessRate
   * where alpha = 0.2
   *
   * @param params - Update parameters
   * @returns Updated pattern
   * @throws Error if pattern not found
   */
  async updatePatternSuccess(params: UpdateSuccessParams): Promise<Pattern> {
    this.ensureInitialized();

    const pattern = this.patternStore.getPattern(params.patternId);
    if (!pattern) {
      throw new Error(`Pattern not found: ${params.patternId}`);
    }

    // Calculate new success rate using exponential moving average
    const newValue = params.success ? 1.0 : 0.0;
    const newSuccessRate = EMA_ALPHA * newValue + (1 - EMA_ALPHA) * pattern.successRate;

    // Increment usage count
    const newUsageCount = pattern.usageCount + 1;

    // Update pattern
    const updated = await this.patternStore.updatePattern(params.patternId, {
      successRate: newSuccessRate,
      usageCount: newUsageCount
    });

    return updated;
  }

  /**
   * Update pattern SONA weight
   *
   * @param patternId - Pattern ID to update
   * @param weight - New SONA weight [0, 1]
   * @returns Updated pattern
   * @throws Error if pattern not found or weight invalid
   */
  async updatePatternSonaWeight(patternId: string, weight: number): Promise<Pattern> {
    this.ensureInitialized();

    if (weight < 0 || weight > 1) {
      throw new Error(`Invalid SONA weight ${weight}, must be in [0, 1]`);
    }

    const pattern = this.patternStore.getPattern(patternId);
    if (!pattern) {
      throw new Error(`Pattern not found: ${patternId}`);
    }

    const updated = await this.patternStore.updatePattern(patternId, {
      sonaWeight: weight
    });

    return updated;
  }

  /**
   * Get a pattern by ID
   *
   * @param patternId - Pattern ID
   * @returns Pattern or undefined if not found
   */
  getPattern(patternId: string): Pattern | undefined {
    this.ensureInitialized();
    return this.patternStore.getPattern(patternId);
  }

  /**
   * Get all patterns for a task type
   *
   * @param taskType - Task type to filter by
   * @returns Array of patterns
   */
  getPatternsByTaskType(taskType: TaskType): Pattern[] {
    this.ensureInitialized();
    return this.patternStore.getPatternsByTaskType(taskType);
  }

  /**
   * Get statistics about the pattern database
   *
   * @returns Pattern statistics
   */
  getStats(): PatternStats {
    this.ensureInitialized();
    return this.patternStore.getStats();
  }

  /**
   * Prune low-quality patterns
   *
   * Removes patterns below minimum success rate and usage count thresholds.
   *
   * @param params - Pruning parameters
   * @returns Prune result with count and IDs
   */
  async pruneLowQualityPatterns(params?: PruneParams): Promise<PruneResult> {
    this.ensureInitialized();

    const minSuccessRate = params?.minSuccessRate ?? 0.20;
    const minUsageCount = params?.minUsageCount ?? 5;
    const dryRun = params?.dryRun ?? false;

    const allPatterns = this.patternStore.getAllPatterns();
    const toPrune: string[] = [];

    // Identify patterns to prune
    for (const pattern of allPatterns) {
      if (pattern.successRate < minSuccessRate && pattern.usageCount >= minUsageCount) {
        // Only prune if it has been used enough times to be statistically significant
        toPrune.push(pattern.id);
      }
    }

    // Delete patterns if not dry run
    if (!dryRun) {
      for (const patternId of toPrune) {
        await this.patternStore.deletePattern(patternId);
      }
    }

    const remainingCount = allPatterns.length - (dryRun ? 0 : toPrune.length);

    return {
      prunedCount: toPrune.length,
      prunedIds: toPrune,
      remainingCount
    };
  }

  /**
   * Delete a pattern by ID
   *
   * @param patternId - Pattern ID to delete
   * @returns True if deleted, false if not found
   */
  async deletePattern(patternId: string): Promise<boolean> {
    this.ensureInitialized();
    return await this.patternStore.deletePattern(patternId);
  }

  /**
   * Get all patterns
   *
   * @returns Array of all patterns
   */
  getAllPatterns(): Pattern[] {
    this.ensureInitialized();
    return this.patternStore.getAllPatterns();
  }

  /**
   * Ensure the matcher is initialized
   *
   * @throws Error if not initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('PatternMatcher not initialized. Call initialize() first.');
    }
  }
}
