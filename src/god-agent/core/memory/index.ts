/**
 * Memory Engine Module
 * Unified semantic memory with vector search and graph relationships
 */

// Core implementation
export { MemoryEngine } from './memory-engine.js';
export { LRUCache } from './lru-cache.js';

// Types
export type {
  IStoreOptions,
  IRetrieveOptions,
  ISearchOptions,
  MemorySearchResult,
  IEmbeddingProvider,
  RelationType
} from './types.js';

// Config aliases for compatibility (MemoryEngine constructor options)
export interface MemoryEngineConfig {
  vectorDB: any; // VectorDB instance
  graphDB: any; // GraphDB instance
  embeddingProvider: any; // IEmbeddingProvider
  cacheSize?: number;
  cacheMaxAge?: number;
}

// Errors
export {
  StorageTransactionError,
  NamespaceValidationError,
  OrphanNodeError
} from './errors.js';

// Validation utilities
export {
  validateNamespace,
  validateOrphanPrevention,
  isRootNamespace,
  ROOT_NAMESPACES
} from './validation.js';

// Encoding utilities
export {
  encodeValue,
  decodeValue
} from './encoding.js';

// Embedding provider
export {
  MockEmbeddingProvider
} from './embedding-provider.js';
