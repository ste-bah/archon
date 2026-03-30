/**
 * Episode Service - Real implementation delegating to EpisodeStore
 * TASK-DAEMON-001: Episode Service Implementation (GAP-ADV-001 fix)
 *
 * Provides IPC service layer for episodic memory operations via JSON-RPC 2.0.
 * All methods delegate to the injected EpisodeStore for actual storage operations.
 */

import { createServiceHandler, type ServiceHandler } from '../service-registry.js';
import { EpisodeStore } from '../../episode/episode-store.js';
import type {
  CreateEpisodeOptions,
  TimeRangeQuery,
  SimilarityQuery,
  EpisodeLinkType,
  EpisodeMetadata,
} from '../../episode/episode-types.js';

/**
 * Parameters for creating an episode via the service
 */
export interface CreateEpisodeParams {
  taskId: string;
  embedding: number[] | Float32Array;
  metadata: EpisodeMetadata;
  id?: string;
  startTime?: number;
  endTime?: number | null;
  linkedEpisodes?: string[];
}

/**
 * Parameters for querying episodes
 */
export interface QueryEpisodesParams {
  /** Query type: 'timeRange' or 'similarity' */
  queryType: 'timeRange' | 'similarity';
  /** Time range query parameters (required when queryType is 'timeRange') */
  timeRange?: {
    startTime: number;
    endTime: number;
    includeOngoing?: boolean;
    limit?: number;
  };
  /** Similarity query parameters (required when queryType is 'similarity') */
  similarity?: {
    embedding: number[] | Float32Array;
    k: number;
    minSimilarity?: number;
    taskIds?: string[];
  };
}

/**
 * Parameters for linking episodes
 */
export interface LinkEpisodesParams {
  sourceId: string;
  targetId: string;
  linkType: EpisodeLinkType;
}

/**
 * Response for episode creation
 */
export interface CreateEpisodeResponse {
  episodeId: string;
}

/**
 * Response for episode queries
 */
export interface QueryEpisodesResponse {
  episodes: Array<{
    id: string;
    taskId: string;
    startTime: number;
    endTime: number | null;
    metadata: EpisodeMetadata;
    linkedEpisodes: string[];
    createdAt: number;
    updatedAt: number;
  }>;
  count: number;
}

/**
 * Response for linking episodes
 */
export interface LinkEpisodesResponse {
  success: boolean;
  sourceId: string;
  targetId: string;
  linkType: EpisodeLinkType;
}

/**
 * Response for episode statistics
 */
export interface EpisodeStatsResponse {
  episodeCount: number;
  vectorCount: number;
  dbSizeBytes: number;
}

/**
 * Convert number array to Float32Array for embeddings
 */
function toFloat32Array(embedding: number[] | Float32Array): Float32Array {
  if (embedding instanceof Float32Array) {
    return embedding;
  }
  return new Float32Array(embedding);
}

/**
 * Create episode service handler with real EpisodeStore delegation
 *
 * @param episodeStore - Injected EpisodeStore instance for actual storage operations
 * @returns Service handler with methods for create, query, link, and stats
 */
export function createEpisodeService(episodeStore: EpisodeStore): ServiceHandler {
  return createServiceHandler({
    /**
     * Create a new episode
     * Delegates to episodeStore.createEpisode()
     */
    create: async (params: CreateEpisodeParams): Promise<CreateEpisodeResponse> => {
      const createOptions: CreateEpisodeOptions = {
        taskId: params.taskId,
        embedding: toFloat32Array(params.embedding),
        metadata: params.metadata,
        id: params.id,
        startTime: params.startTime,
        endTime: params.endTime,
        linkedEpisodes: params.linkedEpisodes,
      };

      const episodeId = await episodeStore.createEpisode(createOptions);
      return { episodeId };
    },

    /**
     * Query episodes by time range or similarity
     * Routes to episodeStore.queryByTimeRange() or episodeStore.searchBySimilarity()
     */
    query: async (params: QueryEpisodesParams): Promise<QueryEpisodesResponse> => {
      if (params.queryType === 'timeRange') {
        if (!params.timeRange) {
          throw new Error('timeRange parameters required for timeRange query');
        }

        const query: TimeRangeQuery = {
          startTime: params.timeRange.startTime,
          endTime: params.timeRange.endTime,
          includeOngoing: params.timeRange.includeOngoing,
          limit: params.timeRange.limit,
        };

        const episodes = await episodeStore.queryByTimeRange(query);

        return {
          episodes: episodes.map((ep) => ({
            id: ep.id,
            taskId: ep.taskId,
            startTime: ep.startTime,
            endTime: ep.endTime,
            metadata: ep.metadata,
            linkedEpisodes: ep.linkedEpisodes,
            createdAt: ep.createdAt,
            updatedAt: ep.updatedAt,
          })),
          count: episodes.length,
        };
      } else if (params.queryType === 'similarity') {
        if (!params.similarity) {
          throw new Error('similarity parameters required for similarity query');
        }

        const query: SimilarityQuery = {
          embedding: toFloat32Array(params.similarity.embedding),
          k: params.similarity.k,
          minSimilarity: params.similarity.minSimilarity,
          taskIds: params.similarity.taskIds,
        };

        const episodes = await episodeStore.searchBySimilarity(query);

        return {
          episodes: episodes.map((ep) => ({
            id: ep.id,
            taskId: ep.taskId,
            startTime: ep.startTime,
            endTime: ep.endTime,
            metadata: ep.metadata,
            linkedEpisodes: ep.linkedEpisodes,
            createdAt: ep.createdAt,
            updatedAt: ep.updatedAt,
          })),
          count: episodes.length,
        };
      } else {
        throw new Error(`Unknown queryType: ${params.queryType}. Use 'timeRange' or 'similarity'.`);
      }
    },

    /**
     * Link two episodes together
     * Uses episodeStore.update() to add linked episode reference
     */
    link: async (params: LinkEpisodesParams): Promise<LinkEpisodesResponse> => {
      const { sourceId, targetId, linkType } = params;

      // Get the source episode to retrieve current linked episodes
      const sourceEpisode = await episodeStore.getById(sourceId);
      if (!sourceEpisode) {
        throw new Error(`Source episode not found: ${sourceId}`);
      }

      // Verify target exists
      const targetEpisode = await episodeStore.getById(targetId);
      if (!targetEpisode) {
        throw new Error(`Target episode not found: ${targetId}`);
      }

      // Add target to source's linked episodes if not already present
      const currentLinks = sourceEpisode.linkedEpisodes || [];
      if (!currentLinks.includes(targetId)) {
        const updatedLinks = [...currentLinks, targetId];
        await episodeStore.update(sourceId, { linkedEpisodes: updatedLinks });
      }

      return {
        success: true,
        sourceId,
        targetId,
        linkType,
      };
    },

    /**
     * Get episode statistics
     * Delegates to episodeStore.getStats()
     */
    stats: async (): Promise<EpisodeStatsResponse> => {
      const stats = episodeStore.getStats();
      return {
        episodeCount: stats.episodeCount,
        vectorCount: stats.vectorCount,
        dbSizeBytes: stats.dbSizeBytes,
      };
    },

    /**
     * Get a single episode by ID
     * Delegates to episodeStore.getById()
     */
    get: async (params: { id: string }) => {
      const episode = await episodeStore.getById(params.id);
      if (!episode) {
        return { found: false, episode: null };
      }
      return {
        found: true,
        episode: {
          id: episode.id,
          taskId: episode.taskId,
          startTime: episode.startTime,
          endTime: episode.endTime,
          metadata: episode.metadata,
          linkedEpisodes: episode.linkedEpisodes,
          createdAt: episode.createdAt,
          updatedAt: episode.updatedAt,
        },
      };
    },

    /**
     * Delete an episode
     * Delegates to episodeStore.delete()
     */
    delete: async (params: { id: string }) => {
      await episodeStore.delete(params.id);
      return { success: true, id: params.id };
    },

    /**
     * Get links for an episode
     * Delegates to episodeStore.getLinks()
     */
    getLinks: async (params: { episodeId: string }) => {
      const links = await episodeStore.getLinks(params.episodeId);
      return {
        episodeId: params.episodeId,
        links: links.map((link) => ({
          sourceId: link.sourceId,
          targetId: link.targetId,
          linkType: link.linkType,
          createdAt: link.createdAt,
        })),
        count: links.length,
      };
    },

    /**
     * Update an existing episode
     * Delegates to episodeStore.update()
     */
    update: async (params: {
      id: string;
      endTime?: number | null;
      embedding?: number[] | Float32Array;
      metadata?: Partial<EpisodeMetadata>;
      linkedEpisodes?: string[];
    }) => {
      const updateData: {
        endTime?: number | null;
        embedding?: Float32Array;
        metadata?: Partial<EpisodeMetadata>;
        linkedEpisodes?: string[];
      } = {};

      if (params.endTime !== undefined) {
        updateData.endTime = params.endTime;
      }
      if (params.embedding !== undefined) {
        updateData.embedding = toFloat32Array(params.embedding);
      }
      if (params.metadata !== undefined) {
        updateData.metadata = params.metadata;
      }
      if (params.linkedEpisodes !== undefined) {
        updateData.linkedEpisodes = params.linkedEpisodes;
      }

      await episodeStore.update(params.id, updateData);
      return { success: true, id: params.id };
    },

    /**
     * Save episode store to disk
     * Delegates to episodeStore.save()
     */
    save: async () => {
      await episodeStore.save();
      return { success: true };
    },
  });
}
