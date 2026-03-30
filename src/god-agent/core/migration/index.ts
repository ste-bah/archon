/**
 * Migration Module Exports
 *
 * Implements: TASK-VEC-001-009 (Data Migration Strategy)
 * Constitution: RULE-009 (zero data loss)
 *
 * Provides backward compatibility layer for 768D -> 1536D vector migration.
 */

export {
  // Main class
  BackwardCompatLayer,

  // Singleton
  getBackwardCompatLayer,
  resetBackwardCompatLayer,

  // Utility functions
  isLegacyVector,
  isCurrentVector,
  ensureVectorDimension,
  checkVectorsNeedMigration,

  // Type guards
  assertLegacyDimension,
  assertCurrentDimension,
  assertValidDimension,

  // Types
  type BackwardCompatStats,
  type BackwardCompatOptions,

  // Constants
  LEGACY_VECTOR_DIM,
} from './backward-compat.js';
