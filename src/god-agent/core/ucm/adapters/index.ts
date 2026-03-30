/**
 * UCM Adapters Module
 *
 * Exports all workflow adapters and the adapter registry for
 * managing workflow-specific context and token management strategies.
 *
 * @module ucm/adapters
 */

export { AdapterRegistry, adapterRegistry } from './adapter-registry.js';
export { PhdPipelineAdapter, PhdPhase } from './phd-pipeline-adapter.js';
export { CodeReviewAdapter } from './code-review-adapter.js';
export { GeneralTaskAdapter } from './general-task-adapter.js';

// Re-export types from parent module for convenience
export type {
  IWorkflowAdapter,
  ITaskContext,
  ITokenConfig,
  IPinningStrategy,
  IPhaseSettings
} from '../types.js';
