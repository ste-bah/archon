/**
 * God Agent Episode Linker Context Utilities
 *
 * Implements: TASK-EPISODE-003
 * Referenced by: EpisodeLinker
 *
 * Provides context retrieval methods for episode linking.
 * Split from episode-linker.ts to comply with 500-line limit.
 */

import { EpisodeStore } from './episode-store.js';
import { TimeIndex } from './time-index.js';
import { Episode } from './episode-types.js';

/**
 * Episode context for task-aware memory retrieval
 */
export interface EpisodeContext {
  /** Episodes with same taskId */
  direct: Episode[];
  /** Recent episodes (last 1 hour) */
  temporal: Episode[];
  /** Semantically similar episodes (top-10) */
  semantic: Episode[];
}

/**
 * Get direct context (same taskId)
 */
export async function getDirectContext(
  store: EpisodeStore,
  taskId: string
): Promise<Episode[]> {
  // Query all episodes with this taskId
  // Note: EpisodeStore doesn't have queryByTaskId method yet,
  // so we'll use a workaround with time range query and filtering
  const allEpisodes = await store.queryByTimeRange({
    startTime: 0,
    endTime: Date.now(),
    includeOngoing: true,
    limit: 1000, // Reasonable limit
  });

  return allEpisodes.filter(ep => ep.taskId === taskId).slice(0, 50);
}

/**
 * Get temporal context (recent episodes)
 */
export async function getTemporalContext(
  timeIndex: TimeIndex,
  startTime: number,
  endTime: number
): Promise<string[]> {
  // Use TimeIndex for efficient temporal queries
  return timeIndex.queryRange(startTime, endTime);
}

/**
 * Get semantic context (similar episodes)
 */
export async function getSemanticContext(
  store: EpisodeStore,
  taskId: string
): Promise<Episode[]> {
  // First, get a representative episode for this task
  const directEpisodes = await getDirectContext(store, taskId);
  if (directEpisodes.length === 0) {
    return [];
  }

  // Use the most recent episode's embedding for similarity search
  const latestEpisode = directEpisodes.reduce((latest, ep) =>
    ep.createdAt > latest.createdAt ? ep : latest
  );

  // Search for similar episodes
  const similar = await store.searchBySimilarity({
    embedding: latestEpisode.embedding,
    k: 10,
    minSimilarity: 0.7, // Only fairly similar episodes
  });

  // Filter out episodes from the same task (already in direct context)
  return similar.filter(ep => ep.taskId !== taskId);
}

/**
 * Helper: Convert episode IDs to episodes
 */
export async function getEpisodesByIds(
  store: EpisodeStore,
  ids: string[]
): Promise<Episode[]> {
  const episodes: Episode[] = [];

  // Retrieve episodes in parallel (batch of 20 at a time to avoid overwhelming)
  const batchSize = 20;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const batchEpisodes = await Promise.all(
      batch.map(id => store.getById(id))
    );

    episodes.push(...batchEpisodes.filter((ep): ep is Episode => ep !== null));
  }

  return episodes.slice(0, 20); // Limit to 20 temporal episodes
}

/**
 * Get episode context for task-aware memory retrieval
 *
 * Retrieves three types of context:
 * 1. Direct: Episodes with the same taskId
 * 2. Temporal: Recent episodes (last 1 hour)
 * 3. Semantic: Semantically similar episodes (top-10)
 *
 * @param store - EpisodeStore instance
 * @param timeIndex - TimeIndex instance
 * @param taskId - Task identifier
 * @returns Episode context with direct, temporal, and semantic episodes
 */
export async function getEpisodeContext(
  store: EpisodeStore,
  timeIndex: TimeIndex,
  taskId: string
): Promise<EpisodeContext> {
  const now = Date.now();
  const oneHourAgo = now - 3600000; // 1 hour in ms

  // Execute all three queries in parallel for performance
  const [directEpisodes, temporalIds, semanticEpisodes] = await Promise.all([
    // 1. Direct context: episodes with same taskId
    getDirectContext(store, taskId),

    // 2. Temporal context: recent episodes
    getTemporalContext(timeIndex, oneHourAgo, now),

    // 3. Semantic context: similar episodes
    getSemanticContext(store, taskId),
  ]);

  // Convert temporal IDs to episodes
  const temporal = await getEpisodesByIds(store, temporalIds);

  return {
    direct: directEpisodes,
    temporal,
    semantic: semanticEpisodes,
  };
}
