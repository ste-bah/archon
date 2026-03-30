/**
 * God Agent Episode Store Type Definitions
 *
 * Implements: TASK-EPISODE-001
 * Referenced by: EpisodeStore, TimeIndex, EpisodeLinker
 *
 * Defines core types for episodic memory management.
 */

/**
 * Task outcome status for completed episodes
 */
export type TaskOutcome = 'success' | 'failure' | 'partial';

/**
 * Episode link type for relationship classification
 */
export type EpisodeLinkType = 'causal' | 'temporal' | 'semantic' | 'dependency';

/**
 * Episode metadata containing task context and execution information
 */
export interface EpisodeMetadata {
  /** Type of agent that executed this episode */
  agentType: string;
  /** Human-readable task description */
  taskDescription: string;
  /** Task execution outcome (optional for ongoing episodes) */
  outcome?: TaskOutcome;
  /** Custom tags for categorization and filtering */
  tags?: string[];
  /** Additional custom metadata fields */
  [key: string]: unknown;
}

/**
 * Core Episode interface representing a discrete memory unit
 *
 * Episodes capture temporal task execution with semantic embeddings
 * for similarity-based retrieval and relationship tracking.
 */
export interface Episode {
  /** Unique episode identifier (UUID v4) */
  id: string;
  /** Associated task identifier */
  taskId: string;
  /** Episode start timestamp (Unix ms) */
  startTime: number;
  /** Episode end timestamp (null for ongoing episodes) */
  endTime: number | null;
  /** 1536-dimensional semantic embedding for similarity search (VECTOR_DIM) */
  embedding: Float32Array;
  /** Episode metadata and context */
  metadata: EpisodeMetadata;
  /** IDs of linked/related episodes */
  linkedEpisodes: string[];
  /** Episode creation timestamp (Unix ms) */
  createdAt: number;
  /** Last update timestamp (Unix ms) */
  updatedAt: number;
}

/**
 * Partial episode data for updates
 * All fields optional except ID (specified separately)
 */
export interface EpisodeUpdateData {
  /** Update end time (e.g., to close an ongoing episode) */
  endTime?: number | null;
  /** Update embedding */
  embedding?: Float32Array;
  /** Update or merge metadata */
  metadata?: Partial<EpisodeMetadata>;
  /** Replace linked episodes */
  linkedEpisodes?: string[];
}

/**
 * Options for creating a new episode
 */
export interface CreateEpisodeOptions {
  /** Optional custom episode ID (UUID v4 generated if not provided) */
  id?: string;
  /** Task identifier */
  taskId: string;
  /** Start timestamp (defaults to Date.now()) */
  startTime?: number;
  /** End timestamp (null for ongoing) */
  endTime?: number | null;
  /** 1536-dim embedding vector (VECTOR_DIM) */
  embedding: Float32Array;
  /** Episode metadata */
  metadata: EpisodeMetadata;
  /** Initial linked episodes (defaults to []) */
  linkedEpisodes?: string[];
}

/**
 * Episode link relationship between source and target episodes
 */
export interface EpisodeLink {
  /** Source episode ID */
  sourceId: string;
  /** Target episode ID */
  targetId: string;
  /** Type of relationship */
  linkType: EpisodeLinkType;
  /** Link creation timestamp */
  createdAt: number;
}

/**
 * Time range query parameters
 */
export interface TimeRangeQuery {
  /** Start of time range (inclusive, Unix ms) */
  startTime: number;
  /** End of time range (inclusive, Unix ms) */
  endTime: number;
  /** Include ongoing episodes (endTime is null) */
  includeOngoing?: boolean;
  /** Optional limit on results */
  limit?: number;
}

/**
 * Similarity search query parameters
 */
export interface SimilarityQuery {
  /** Query embedding vector (1536-dim, VECTOR_DIM) */
  embedding: Float32Array;
  /** Number of top results to return */
  k: number;
  /** Optional minimum similarity threshold */
  minSimilarity?: number;
  /** Optional filter by task IDs */
  taskIds?: string[];
}

/**
 * Validation error for episode data
 */
export class EpisodeValidationError extends Error {
  constructor(message: string) {
    super(`Episode validation failed: ${message}`);
    this.name = 'EpisodeValidationError';
  }
}

/**
 * Storage error for episode operations
 */
export class EpisodeStorageError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(`Episode storage error: ${message}`);
    this.name = 'EpisodeStorageError';
  }
}

/**
 * Validator utilities for episode data
 */
export class EpisodeValidator {
  /** Expected embedding dimension (1536D per architecture diagram) */
  private static readonly EMBEDDING_DIM = 1536;
  /** Maximum linked episodes per episode */
  private static readonly MAX_LINKS = 100;
  /** Maximum content size (approximate, for metadata JSON) */
  private static readonly MAX_CONTENT_SIZE = 100 * 1024; // 100KB

  /**
   * Validate episode ID format (UUID v4)
   */
  static validateId(id: string): void {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      throw new EpisodeValidationError(`Invalid episode ID format: ${id} (must be UUID v4)`);
    }
  }

  /**
   * Validate embedding vector
   */
  static validateEmbedding(embedding: Float32Array): void {
    if (!(embedding instanceof Float32Array)) {
      throw new EpisodeValidationError('Embedding must be Float32Array');
    }
    if (embedding.length !== this.EMBEDDING_DIM) {
      throw new EpisodeValidationError(`Embedding must be ${this.EMBEDDING_DIM}-dimensional (got ${embedding.length})`);
    }
    // Check for valid values (not NaN/Infinity)
    for (let i = 0; i < embedding.length; i++) {
      if (!Number.isFinite(embedding[i])) {
        throw new EpisodeValidationError(`Embedding contains invalid value at index ${i}`);
      }
    }
  }

  /**
   * Validate timestamp
   */
  static validateTimestamp(timestamp: number, name: string): void {
    if (!Number.isInteger(timestamp) || timestamp < 0) {
      throw new EpisodeValidationError(`${name} must be a positive integer (got ${timestamp})`);
    }
    // Sanity check: not too far in the future (within 1 year)
    const maxFuture = Date.now() + 365 * 24 * 60 * 60 * 1000;
    if (timestamp > maxFuture) {
      throw new EpisodeValidationError(`${name} is too far in the future: ${timestamp}`);
    }
  }

  /**
   * Validate time range (startTime <= endTime)
   */
  static validateTimeRange(startTime: number, endTime: number | null): void {
    this.validateTimestamp(startTime, 'startTime');
    if (endTime !== null) {
      this.validateTimestamp(endTime, 'endTime');
      if (endTime < startTime) {
        throw new EpisodeValidationError(`endTime (${endTime}) cannot be before startTime (${startTime})`);
      }
    }
  }

  /**
   * Validate linked episodes array
   */
  static validateLinkedEpisodes(linkedEpisodes: string[]): void {
    if (!Array.isArray(linkedEpisodes)) {
      throw new EpisodeValidationError('linkedEpisodes must be an array');
    }
    if (linkedEpisodes.length > this.MAX_LINKS) {
      throw new EpisodeValidationError(`Too many linked episodes: ${linkedEpisodes.length} (max ${this.MAX_LINKS})`);
    }
    // Validate each ID
    for (const id of linkedEpisodes) {
      this.validateId(id);
    }
    // Check for duplicates
    const uniqueIds = new Set(linkedEpisodes);
    if (uniqueIds.size !== linkedEpisodes.length) {
      throw new EpisodeValidationError('linkedEpisodes contains duplicate IDs');
    }
  }

  /**
   * Validate metadata object
   */
  static validateMetadata(metadata: EpisodeMetadata): void {
    if (!metadata || typeof metadata !== 'object') {
      throw new EpisodeValidationError('metadata must be an object');
    }
    if (typeof metadata.agentType !== 'string' || metadata.agentType.length === 0) {
      throw new EpisodeValidationError('metadata.agentType must be a non-empty string');
    }
    if (typeof metadata.taskDescription !== 'string' || metadata.taskDescription.length === 0) {
      throw new EpisodeValidationError('metadata.taskDescription must be a non-empty string');
    }
    if (metadata.outcome !== undefined) {
      const validOutcomes: TaskOutcome[] = ['success', 'failure', 'partial'];
      if (!validOutcomes.includes(metadata.outcome)) {
        throw new EpisodeValidationError(`metadata.outcome must be one of: ${validOutcomes.join(', ')}`);
      }
    }
    if (metadata.tags !== undefined) {
      if (!Array.isArray(metadata.tags)) {
        throw new EpisodeValidationError('metadata.tags must be an array');
      }
      for (const tag of metadata.tags) {
        if (typeof tag !== 'string') {
          throw new EpisodeValidationError('metadata.tags must contain only strings');
        }
      }
    }
    // Check approximate content size
    const jsonSize = JSON.stringify(metadata).length;
    if (jsonSize > this.MAX_CONTENT_SIZE) {
      throw new EpisodeValidationError(`metadata too large: ${jsonSize} bytes (max ${this.MAX_CONTENT_SIZE})`);
    }
  }

  /**
   * Validate complete episode object
   */
  static validateEpisode(episode: Episode): void {
    this.validateId(episode.id);
    if (typeof episode.taskId !== 'string' || episode.taskId.length === 0) {
      throw new EpisodeValidationError('taskId must be a non-empty string');
    }
    this.validateTimeRange(episode.startTime, episode.endTime);
    this.validateEmbedding(episode.embedding);
    this.validateMetadata(episode.metadata);
    this.validateLinkedEpisodes(episode.linkedEpisodes);
    this.validateTimestamp(episode.createdAt, 'createdAt');
    this.validateTimestamp(episode.updatedAt, 'updatedAt');
  }

  /**
   * Validate create episode options
   */
  static validateCreateOptions(options: CreateEpisodeOptions): void {
    if (options.id !== undefined) {
      this.validateId(options.id);
    }
    if (typeof options.taskId !== 'string' || options.taskId.length === 0) {
      throw new EpisodeValidationError('taskId must be a non-empty string');
    }
    if (options.startTime !== undefined) {
      this.validateTimestamp(options.startTime, 'startTime');
    }
    if (options.endTime !== undefined && options.endTime !== null) {
      this.validateTimestamp(options.endTime, 'endTime');
      const startTime = options.startTime ?? Date.now();
      if (options.endTime < startTime) {
        throw new EpisodeValidationError('endTime cannot be before startTime');
      }
    }
    this.validateEmbedding(options.embedding);
    this.validateMetadata(options.metadata);
    if (options.linkedEpisodes !== undefined) {
      this.validateLinkedEpisodes(options.linkedEpisodes);
    }
  }
}
