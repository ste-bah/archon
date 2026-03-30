/**
 * Hyperedge Module
 * TASK-HYPEREDGE-001, TASK-HYPEREDGE-002, TASK-HYPEREDGE-003
 *
 * Advanced knowledge representation through:
 * - Q&A Hyperedges (semantic question-answering)
 * - Causal Chains (cause-effect reasoning)
 * - Community Detection (graph clustering)
 * - Anomaly Detection (outlier identification)
 */

// Types (shared across Phase 4)
export type {
  // Q&A Types
  QAAnswer,
  QAHyperedge,
  QASearchResult,
  // Causal Types
  CausalNode,
  CausalEdge,
  CausalChain,
  CausalLoop,
  RootCauseResult,
  // Community Types
  Community,
  CommunityDetectionResult,
  // Anomaly Types
  AnomalyResult,
  AnomalyDetectionConfig,
  // Utility Types
  TraversalOptions,
  ValidationResult,
  HyperedgeCreateOptions,
} from './hyperedge-types.js';

// Q&A Store
export type { QAStoreConfig } from './qa/qa-store.js';
export { QAStore } from './qa/qa-store.js';

// Causal Store
export type { CausalStoreConfig } from './causal/causal-store.js';
export { CausalStore } from './causal/causal-store.js';

// Loop Detection
export { LoopDetector, validateNoCycles } from './causal/loop-detector.js';

// Community Detection
export {
  CommunityDetector,
  LouvainDetector,
  LabelPropagationDetector
} from './community/index.js';

// Anomaly Detection
export type {
  AnomalyAlert,
  AlertSeverity,
  BatchDetectionResult,
} from './anomaly/index.js';

export type { GraphStructure } from './anomaly/graph-anomaly-detector.js';

export {
  LOFDetector,
  GraphAnomalyDetector,
  AnomalyDetector,
  createAnomalyDetector,
} from './anomaly/index.js';
