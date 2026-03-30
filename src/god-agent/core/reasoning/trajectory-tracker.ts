/**
 * Trajectory Tracker for ReasoningBank
 *
 * Tracks reasoning trajectories for learning feedback loop integration.
 * Supports pattern creation from successful trajectories and performance analysis.
 *
 * Features:
 * - LRU eviction with quality preference
 * - Automatic pruning of expired trajectories
 * - VectorDB integration for semantic search
 * - Sona feedback integration
 * - High-quality trajectory extraction
 */

import { randomUUID } from 'crypto';
import {
  ReasoningMode,
  type TrajectoryRecord,
  type TrajectoryID,
  type IReasoningRequest,
  type IReasoningResponse,
  type ILearningFeedback
} from './reasoning-types.js';
import type { ISonaEngine } from '../learning/sona-types.js';
import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../observability/index.js';

const logger = createComponentLogger('TrajectoryTracker', {
  minLevel: LogLevel.WARN,
  handlers: [new ConsoleLogHandler()]
});

/**
 * VectorDB interface for optional persistence
 * Will be replaced with actual VectorDB import when available
 */
interface VectorDB {
  add(entry: {
    id: string;
    embedding: Float32Array;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

/**
 * Configuration for TrajectoryTracker
 *
 * Per CONSTITUTION RULE-031: TrajectoryTracker MUST receive injected SonaEngine reference.
 * Implements: RULE-031
 */
export interface TrajectoryTrackerConfig {
  /** SonaEngine instance for trajectory learning integration (REQUIRED per RULE-031) */
  sonaEngine: ISonaEngine;
  maxTrajectories?: number;     // Default: 10000
  retentionMs?: number;         // Default: 7 days
  vectorDB?: VectorDB;          // Optional for persistence
  autoPrune?: boolean;          // Default: true
  pruneIntervalMs?: number;     // Default: 1 hour
}

/**
 * Statistics about tracked trajectories
 */
export interface TrajectoryStats {
  total: number;
  withFeedback: number;
  highQuality: number;          // quality >= 0.8
  averageLScore: number;
  averageQuality: number;
  oldestTimestamp: number;
  newestTimestamp: number;
}

/**
 * Internal structure for LRU tracking
 */
interface TrajectoryNode {
  record: TrajectoryRecord;
  lastAccessed: number;
}

/**
 * TrajectoryTracker - Manages reasoning trajectory history
 *
 * Tracks all reasoning trajectories for:
 * 1. Sona feedback loop integration
 * 2. Pattern creation from successful paths
 * 3. Performance analysis and optimization
 *
 * Per CONSTITUTION RULE-031: TrajectoryTracker MUST receive injected SonaEngine reference.
 * Implements: RULE-031
 */
export class TrajectoryTracker {
  private trajectories: Map<string, TrajectoryNode>;
  private maxTrajectories: number;
  private retentionMs: number;
  private vectorDB?: VectorDB;
  private autoPrune: boolean;
  private pruneIntervalMs: number;
  private pruneTimer?: NodeJS.Timeout;

  /**
   * SonaEngine instance for trajectory learning integration
   * Per CONSTITUTION RULE-031: Systems MUST be connected, not independent.
   * Implements: RULE-031
   */
  private readonly sonaEngine: ISonaEngine;

  /**
   * Construct TrajectoryTracker with required dependencies
   *
   * @param config - Configuration including required SonaEngine
   * @throws Error if sonaEngine is not provided (RULE-031 violation)
   */
  constructor(config: TrajectoryTrackerConfig) {
    // Implements RULE-031: TrajectoryTracker MUST receive injected SonaEngine reference
    if (!config.sonaEngine) {
      throw new Error('SonaEngine injection required per Constitution RULE-031');
    }
    this.sonaEngine = config.sonaEngine;

    this.maxTrajectories = config.maxTrajectories ?? 10000;
    this.retentionMs = config.retentionMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days
    this.vectorDB = config.vectorDB;
    this.autoPrune = config.autoPrune ?? true;
    this.pruneIntervalMs = config.pruneIntervalMs ?? 60 * 60 * 1000; // 1 hour

    this.trajectories = new Map();

    if (this.autoPrune) {
      this.startAutoPruning();
    }
  }

  /**
   * Get the injected SonaEngine instance
   *
   * Implements: RULE-031 - provides access to connected learning system
   * @returns The SonaEngine instance
   */
  getSonaEngine(): ISonaEngine {
    return this.sonaEngine;
  }

  /**
   * Generate unique trajectory ID
   * Format: "traj_{timestamp}_{uuid}"
   */
  generateTrajectoryId(): TrajectoryID {
    const timestamp = Date.now();
    const uuid = randomUUID().substring(0, 8);
    return `traj_${timestamp}_${uuid}` as TrajectoryID;
  }

  /**
   * Create and store a new trajectory
   *
   * @param request - Original reasoning request
   * @param result - Reasoning result
   * @param embedding - Base embedding
   * @param enhancedEmbedding - Optional GNN-enhanced embedding
   * @param lScore - Optional L-score (defaults to 0 if not provided)
   * @returns Created trajectory record
   */
  async createTrajectory(
    request: IReasoningRequest,
    result: IReasoningResponse,
    embedding: Float32Array,
    enhancedEmbedding?: Float32Array,
    lScore?: number
  ): Promise<TrajectoryRecord> {
    // Enforce max trajectories limit
    if (this.trajectories.size >= this.maxTrajectories) {
      await this.evictLowestPriority();
    }

    const trajectoryId = this.generateTrajectoryId();
    const timestamp = Date.now();

    const trajectory: TrajectoryRecord = {
      id: trajectoryId,
      timestamp,
      request,
      response: result,
      embedding,
      enhancedEmbedding,
      lScore: lScore ?? 0
    };

    // Store in memory
    this.trajectories.set(trajectoryId, {
      record: trajectory,
      lastAccessed: timestamp
    });

    // Optionally persist to VectorDB
    if (this.vectorDB) {
      await this.persistToVectorDB(trajectory);
    }

    // CRITICAL: Forward trajectory to SonaEngine (RULE-025)
    // Per CONSTITUTION RULE-025: TrajectoryTracker MUST call SonaEngine.createTrajectoryWithId
    // This ensures learning system receives all trajectories for weight adaptation
    try {
      const route = this.inferRouteFromRequest(request);
      const patternIds = result.patterns.map(p => p.patternId);
      const contextIds = result.causalInferences?.map(c => c.nodeId) ?? [];

      this.sonaEngine.createTrajectoryWithId(
        trajectoryId,
        route,
        patternIds,
        contextIds
      );
    } catch (error) {
      // Log but don't fail trajectory creation if SonaEngine forwarding fails
      logger.warn('SonaEngine forwarding failed', { trajectoryId, error: String(error) });
    }

    return trajectory;
  }

  /**
   * Get trajectory by ID
   * Implements: REQ-TRAJ-005 (SQLite fallback for cross-session retrieval)
   * Constitution: RULE-008 (SQLite primary), RULE-069 (try/catch), RULE-070 (error logging)
   *
   * @param trajectoryId - Trajectory identifier
   * @returns Trajectory record or null if not found
   */
  async getTrajectory(trajectoryId: TrajectoryID): Promise<TrajectoryRecord | null> {
    let node = this.trajectories.get(trajectoryId);

    // Implements [REQ-TRAJ-005]: Check SQLite if not in memory (cross-session support)
    if (!node) {
      try {
        // Implements [RULE-069]: try/catch for SQLite operation
        if (this.sonaEngine.hasTrajectoryInStorage(trajectoryId)) {
          const storedTrajectory = this.sonaEngine.getTrajectoryFromStorage(trajectoryId);
          if (storedTrajectory) {
            // Create minimal TrajectoryRecord from stored trajectory
            const record: TrajectoryRecord = {
              id: storedTrajectory.id,
              timestamp: storedTrajectory.createdAt,
              request: {} as IReasoningRequest, // Minimal, not available from storage
              response: {} as IReasoningResponse, // Minimal, not available from storage
              embedding: new Float32Array(0), // Not available from storage
              lScore: 0,
            };
            node = {
              record,
              lastAccessed: Date.now(),
            };
            // Cache for future access
            this.trajectories.set(trajectoryId, node);
            logger.info('Loaded trajectory from SQLite', { trajectoryId });
          }
        }
      } catch (error) {
        // Implements [RULE-070]: Log error with context
        logger.warn('Failed to load trajectory from SQLite', { trajectoryId, error: String(error) });
      }
    }

    if (!node) {
      return null;
    }

    // Update LRU timestamp
    node.lastAccessed = Date.now();

    return node.record;
  }

  /**
   * Update trajectory with Sona feedback
   * Implements: REQ-TRAJ-004 (SQLite fallback for cross-session feedback)
   * Constitution: RULE-008 (SQLite primary), RULE-069 (try/catch), RULE-070 (error logging)
   *
   * @param trajectoryId - Trajectory to update
   * @param feedback - Learning feedback from Sona
   * @returns Updated trajectory record
   */
  async updateFeedback(
    trajectoryId: TrajectoryID,
    feedback: ILearningFeedback
  ): Promise<TrajectoryRecord> {
    let node = this.trajectories.get(trajectoryId);

    // Implements [REQ-TRAJ-004]: Check SQLite if not in memory (cross-session support)
    if (!node) {
      try {
        // Implements [RULE-069]: try/catch for SQLite operation
        if (this.sonaEngine.hasTrajectoryInStorage(trajectoryId)) {
          const storedTrajectory = this.sonaEngine.getTrajectoryFromStorage(trajectoryId);
          if (storedTrajectory) {
            // Create minimal TrajectoryRecord from stored trajectory
            const record: TrajectoryRecord = {
              id: storedTrajectory.id,
              timestamp: storedTrajectory.createdAt,
              request: {} as IReasoningRequest, // Minimal, not available from storage
              response: {} as IReasoningResponse, // Minimal, not available from storage
              embedding: new Float32Array(0), // Not available from storage
              lScore: 0,
            };
            node = {
              record,
              lastAccessed: Date.now(),
            };
            // Cache for future access
            this.trajectories.set(trajectoryId, node);
            logger.info('Loaded trajectory from SQLite for feedback', { trajectoryId });
          }
        }
      } catch (error) {
        // Implements [RULE-070]: Log error with context
        logger.warn('Failed to load trajectory from SQLite', { trajectoryId, error: String(error) });
      }
    }

    if (!node) {
      throw new Error(`Trajectory not found: ${trajectoryId}`);
    }

    // Update feedback
    node.record.feedback = feedback;
    node.lastAccessed = Date.now();

    // Update in VectorDB if available
    if (this.vectorDB) {
      await this.persistToVectorDB(node.record);
    }

    return node.record;
  }

  /**
   * Get high-quality trajectories for pattern creation
   * Returns trajectories with quality >= threshold
   *
   * @param minQuality - Minimum quality threshold (0-1)
   * @param limit - Maximum number of trajectories to return
   * @returns High-quality trajectory records
   */
  async getHighQualityTrajectories(
    minQuality: number = 0.8,
    limit?: number
  ): Promise<TrajectoryRecord[]> {
    const highQuality: TrajectoryRecord[] = [];

    for (const node of Array.from(this.trajectories.values())) {
      const record = node.record;

      // Check if has feedback with sufficient quality
      if (record.feedback && record.feedback.quality !== undefined && record.feedback.quality >= minQuality) {
        highQuality.push(record);
      }
    }

    // Sort by quality (descending)
    highQuality.sort((a, b) => {
      const qualityA = a.feedback?.quality ?? 0;
      const qualityB = b.feedback?.quality ?? 0;
      return qualityB - qualityA;
    });

    // Apply limit if specified
    if (limit !== undefined && limit > 0) {
      return highQuality.slice(0, limit);
    }

    return highQuality;
  }

  /**
   * Find similar trajectories using embedding search
   *
   * @param embedding - Query embedding
   * @param k - Number of similar trajectories to return
   * @param minSimilarity - Minimum cosine similarity threshold
   * @returns Similar trajectory records
   */
  async findSimilarTrajectories(
    embedding: Float32Array,
    k: number = 10,
    minSimilarity: number = 0.7
  ): Promise<TrajectoryRecord[]> {
    // Calculate cosine similarity for all trajectories
    const similarities: Array<{ record: TrajectoryRecord; similarity: number }> = [];

    for (const node of Array.from(this.trajectories.values())) {
      const record = node.record;
      const targetEmbedding = record.enhancedEmbedding ?? record.embedding;

      const similarity = this.cosineSimilarity(embedding, targetEmbedding);

      if (similarity >= minSimilarity) {
        similarities.push({ record, similarity });
      }
    }

    // Sort by similarity (descending)
    similarities.sort((a, b) => b.similarity - a.similarity);

    // Return top k
    return similarities.slice(0, k).map(s => s.record);
  }

  /**
   * Prune expired trajectories
   * Removes trajectories older than retentionMs
   *
   * @returns Number of trajectories pruned
   */
  async pruneExpired(): Promise<number> {
    const now = Date.now();
    const cutoff = now - this.retentionMs;
    const toDelete: string[] = [];

    for (const [id, node] of Array.from(this.trajectories.entries())) {
      if (node.record.timestamp < cutoff) {
        toDelete.push(id);
      }
    }

    // Remove expired trajectories
    for (const id of toDelete) {
      this.trajectories.delete(id);
    }

    return toDelete.length;
  }

  /**
   * Get trajectory statistics
   *
   * @returns Statistics summary
   */
  getStats(): TrajectoryStats {
    let withFeedback = 0;
    let highQuality = 0;
    let totalLScore = 0;
    let totalQuality = 0;
    let lScoreCount = 0;
    let qualityCount = 0;
    let oldestTimestamp = Date.now();
    let newestTimestamp = 0;

    for (const node of Array.from(this.trajectories.values())) {
      const record = node.record;

      // Count feedback
      if (record.feedback) {
        withFeedback++;
        const quality = record.feedback.quality ?? 0;
        totalQuality += quality;
        qualityCount++;

        if (quality >= 0.8) {
          highQuality++;
        }
      }

      // Accumulate L-scores
      if (record.lScore !== undefined && record.lScore !== null) {
        totalLScore += record.lScore;
        lScoreCount++;
      }

      // Track timestamp range
      if (record.timestamp < oldestTimestamp) {
        oldestTimestamp = record.timestamp;
      }
      if (record.timestamp > newestTimestamp) {
        newestTimestamp = record.timestamp;
      }
    }

    return {
      total: this.trajectories.size,
      withFeedback,
      highQuality,
      averageLScore: lScoreCount > 0 ? totalLScore / lScoreCount : 0,
      averageQuality: qualityCount > 0 ? totalQuality / qualityCount : 0,
      oldestTimestamp: this.trajectories.size > 0 ? oldestTimestamp : 0,
      newestTimestamp: this.trajectories.size > 0 ? newestTimestamp : 0
    };
  }

  /**
   * Stop auto-pruning and cleanup
   */
  destroy(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = undefined;
    }
  }

  /**
   * Persist trajectory to VectorDB (if available)
   *
   * @param trajectory - Trajectory to persist
   */
  private async persistToVectorDB(trajectory: TrajectoryRecord): Promise<void> {
    if (!this.vectorDB) {
      return;
    }

    try {
      const embedding = trajectory.enhancedEmbedding ?? trajectory.embedding;

      // Store trajectory with metadata
      await this.vectorDB.add({
        id: trajectory.id,
        embedding,
        metadata: {
          timestamp: trajectory.timestamp,
          mode: trajectory.request.type,
          lScore: trajectory.lScore,
          quality: trajectory.feedback?.quality,
          hasEnhancement: !!trajectory.enhancedEmbedding
        }
      });
    } catch (error) {
      // Log error but don't fail the operation
      logger.warn('Failed to persist trajectory to VectorDB', { trajectoryId: trajectory.id, error: String(error) });
    }
  }

  /**
   * Evict lowest priority trajectory to make room
   * Priority: low quality + old access time
   */
  private async evictLowestPriority(): Promise<void> {
    if (this.trajectories.size === 0) {
      return;
    }

    let lowestPriorityId: string | null = null;
    let lowestPriority = Infinity;

    for (const [id, node] of Array.from(this.trajectories.entries())) {
      // Calculate priority score (higher is better)
      const quality = node.record.feedback?.quality ?? 0.5;
      const ageMs = Date.now() - node.lastAccessed;
      const ageDays = ageMs / (24 * 60 * 60 * 1000);

      // Priority = quality / (age in days + 1)
      // Low quality + old = low priority (evict first)
      const priority = quality / (ageDays + 1);

      if (priority < lowestPriority) {
        lowestPriority = priority;
        lowestPriorityId = id;
      }
    }

    if (lowestPriorityId) {
      this.trajectories.delete(lowestPriorityId);
    }
  }

  /**
   * Start automatic pruning interval
   */
  private startAutoPruning(): void {
    this.pruneTimer = setInterval(() => {
      this.pruneExpired().catch(error => {
        logger.warn('Auto-prune failed', { error: String(error) });
      });
    }, this.pruneIntervalMs);
  }

  /**
   * Calculate cosine similarity between two embeddings
   *
   * @param a - First embedding
   * @param b - Second embedding
   * @returns Cosine similarity (0-1)
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error('Embedding dimensions must match');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);

    if (denominator === 0) {
      return 0;
    }

    return dotProduct / denominator;
  }

  /**
   * Infer route from reasoning request type
   *
   * Maps reasoning modes to route identifiers for SonaEngine.
   * Routes are used for per-task-type weight management.
   *
   * @param request - The reasoning request
   * @returns Route string (e.g., "reasoning.pattern", "reasoning.causal")
   */
  private inferRouteFromRequest(request: IReasoningRequest): string {
    // Map reasoning mode type to route string
    switch (request.type) {
      case ReasoningMode.PATTERN_MATCH:
        return 'reasoning.pattern';
      case ReasoningMode.CAUSAL_INFERENCE:
        return 'reasoning.causal';
      case ReasoningMode.CONTEXTUAL:
        return 'reasoning.contextual';
      case ReasoningMode.HYBRID:
        return 'reasoning.hybrid';
      default:
        return 'reasoning.general';
    }
  }
}
