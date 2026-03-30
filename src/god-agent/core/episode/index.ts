/**
 * God Agent Episode Store Module
 *
 * Implements: TASK-EPISODE-001, TASK-EPISODE-002, TASK-EPISODE-003
 * Referenced by: God Agent memory system
 *
 * Exports episode storage functionality for episodic memory management.
 */

// Types
export type {
  EpisodeStoreOptions,
} from './episode-store.js';

export type {
  IndexStats,
} from './time-index.js';

export type {
  LinkType,
  EpisodeContext,
  LinkDirection,
} from './episode-linker.js';

// Values
export {
  EpisodeStore,
} from './episode-store.js';

export {
  TimeIndex,
} from './time-index.js';

export {
  EpisodeLinker,
} from './episode-linker.js';

export {
  type Episode,
  type EpisodeMetadata,
  type EpisodeUpdateData,
  type CreateEpisodeOptions,
  type TimeRangeQuery,
  type SimilarityQuery,
  type EpisodeLink,
  type TaskOutcome,
  type EpisodeLinkType,
  EpisodeValidator,
  EpisodeValidationError,
  EpisodeStorageError,
} from './episode-types.js';

// Re-export utility types (not required for public API, but for internal use)
export type {
  BPlusNode,
  SerializedBPlusNode,
  PersistedIndexData,
  CollectedStats,
} from './time-index-utils.js';

export type {
  EpisodeRow,
} from './episode-store-queries.js';
