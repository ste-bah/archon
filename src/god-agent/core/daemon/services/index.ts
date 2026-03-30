/**
 * Service Adapters - Export all service factories
 * TASK-DAEMON-003: Service Registry & Integration
 */

export { createVectorService } from './vector-service.js';
export { createGraphService } from './graph-service.js';
export { createSearchService } from './search-service.js';
export { createSonaService } from './sona-service.js';
export { createReasoningService } from './reasoning-service.js';
export { createGNNService } from './gnn-service.js';
export { createEpisodeService } from './episode-service.js';
export { createHyperedgeService } from './hyperedge-service.js';
export { createDescService } from './desc-service.js';

// Re-export types
export type {
  IVectorAddParams,
  IVectorSearchParams,
  IVectorGetParams,
  IVectorDeleteParams,
  IVectorSearchResult,
  IVectorStatsResult,
} from './vector-service.js';

export type {
  IGraphAddNodeParams,
  IGraphGetNodeParams,
  IGraphAddEdgeParams,
  IGraphQueryParams,
  IGraphTraverseParams,
} from './graph-service.js';

export type {
  ISearchQueryParams,
  ISearchUpdateWeightsParams,
} from './search-service.js';

export type {
  ISonaCreateTrajectoryParams,
  ISonaProvideFeedbackParams,
  ISonaGetWeightParams,
  ISonaSetWeightParams,
} from './sona-service.js';

export type {
  IReasoningReasonParams,
  IReasoningFeedbackParams,
} from './reasoning-service.js';

export type {
  IGNNEnhanceParams,
} from './gnn-service.js';

export type {
  IDescMetricsParams,
  IDescSuccessRateParams,
  IDescFalsePositiveRateParams,
  IDescInjectionCountParams,
  IDescRecentFailuresParams,
  IDescTimeSeriesParams,
  IDescMetricsResponse,
  IDescSuccessRateResponse,
  IDescFalsePositiveRateResponse,
  IDescInjectionCountResponse,
  IDescAlertsResponse,
  IDescRecentFailuresResponse,
  IDescTimeSeriesResponse,
} from './desc-service.js';
