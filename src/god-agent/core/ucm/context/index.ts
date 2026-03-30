/**
 * UCM Context Module
 * SPRINT 5: Context Composition
 *
 * Exports all context management components for Unified Context Management.
 * Implements four-tier context structure with budget-aware composition.
 */

export { RollingWindow } from './rolling-window.js';
export { DependencyTracker } from './dependency-tracker.js';
export { PinningManager, PinReason } from './pinning-manager.js';
export {
  ContextCompositionEngine,
  type IContextTier,
  type IContextAgent,
  type ICompositionOptions,
  type IComposedContext,
} from './context-composition-engine.js';
