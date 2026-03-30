/**
 * UCM Recovery Module
 *
 * Exports all recovery components for handling Claude Code compaction:
 * - CompactionDetector: Detects compaction events
 * - MemoryReconstructor: Reconstructs lost context
 * - TierBridge: Manages memory tier transitions
 */

// Compaction Detection
export {
  CompactionDetector,
  createCompactionDetector
} from './compaction-detector.js';

// Memory Reconstruction
export {
  MemoryReconstructor,
  createMemoryReconstructor
} from './memory-reconstructor.js';

// Tier Management
export {
  TierBridge,
  MemoryTier,
  createTierBridge,
  type ITierStats
} from './tier-bridge.js';

// Re-export recovery-related types from main types module
export type {
  ICompactionDetector,
  IMemoryReconstructor,
  IReconstructedContext,
  IRecoveryMetrics,
  IUnrecoverableItem
} from '../types.js';
