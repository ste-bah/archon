/**
 * Central data store for the God Agent Observability Dashboard.
 * All tab modules read from and write to this shared state object.
 */

export const state = {
  activities: [],
  agents: new Map(),
  pipelines: new Map(),
  routingDecisions: [],
  learningMetrics: { trajectories: {}, patterns: {} },
  ucmMetrics: {},
  idescMetrics: {},
  episodeMetrics: {},
  hyperedgeMetrics: {},
  tokenMetrics: {},
  daemonMetrics: {},
  registryMetrics: { total: 280, categories: 39 },
  databases: {},
  leann: {},

  // Filter state
  componentFilter: '',
  statusFilter: '',

  // Memory inspector state
  memoryTab: 'interaction-store',
  domainSearchTerm: '',
  interactionStoreData: null,
  reasoningBankData: null,
  episodeStoreData: null,
  ucmContextData: null,
  hyperedgeStoreData: null,

  // Chart data history
  tokenHistory: [],
  qualityHistory: [],

  // SSE connection status
  sseStatus: 'connecting',
};
