/**
 * Search Source Adapters
 * Exports all adapters for quad-fusion unified search
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-SEARCH-004
 *
 * @module src/god-agent/core/search/adapters
 */

export { VectorSourceAdapter } from './vector-adapter.js';
export { GraphSourceAdapter } from './graph-adapter.js';
export { MemorySourceAdapter } from './memory-adapter.js';
export { PatternSourceAdapter } from './pattern-adapter.js';
export {
  GNNSearchAdapter,
  type GNNEnhancementOptions,
  type GNNEnhancementPoint,
  type GNNEnhancementStats,
  DEFAULT_GNN_OPTIONS,
} from './gnn-adapter.js';
export {
  LEANNSourceAdapter,
  createLEANNAdapter,
  type LEANNAdapterConfig,
  type LEANNSearchOptions,
  type LEANNResultMetadata,
  DEFAULT_LEANN_ADAPTER_CONFIG,
} from './leann-adapter.js';
