/**
 * UCM Adapter Registry
 *
 * Central registry for workflow adapters that manages adapter registration,
 * retrieval, and auto-detection based on task context.
 *
 * @module ucm/adapters/adapter-registry
 */

import type { IWorkflowAdapter, ITaskContext } from '../types.js';
import { PhdPipelineAdapter } from './phd-pipeline-adapter.js';
import { CodeReviewAdapter } from './code-review-adapter.js';
import { GeneralTaskAdapter } from './general-task-adapter.js';

/**
 * Registry for managing workflow adapters
 */
export class AdapterRegistry {
  private adapters: Map<string, IWorkflowAdapter> = new Map();
  private detectionOrder: IWorkflowAdapter[] = [];

  constructor() {
    this.registerDefaultAdapters();
  }

  /**
   * Register default adapters in detection order (most specific first)
   */
  private registerDefaultAdapters(): void {
    // Register adapters in order of specificity
    this.register('phd', new PhdPipelineAdapter());
    this.register('code-review', new CodeReviewAdapter());
    this.register('general', new GeneralTaskAdapter());
  }

  /**
   * Register a workflow adapter
   *
   * @param name - Unique name for the adapter
   * @param adapter - The adapter instance
   */
  register(name: string, adapter: IWorkflowAdapter): void {
    this.adapters.set(name, adapter);

    // Add to detection order if not already present
    if (!this.detectionOrder.includes(adapter)) {
      // Insert before the general adapter (which should always be last)
      const generalIndex = this.detectionOrder.findIndex(a => a instanceof GeneralTaskAdapter);
      if (generalIndex >= 0) {
        this.detectionOrder.splice(generalIndex, 0, adapter);
      } else {
        this.detectionOrder.push(adapter);
      }
    }
  }

  /**
   * Get adapter by name
   *
   * @param name - Adapter name
   * @returns The adapter instance or undefined
   */
  get(name: string): IWorkflowAdapter | undefined {
    return this.adapters.get(name);
  }

  /**
   * Auto-detect the appropriate adapter for a task context
   * Falls back to 'general' adapter if no specific match found
   *
   * @param context - Task context to analyze
   * @returns The detected adapter
   */
  detectAdapter(context: ITaskContext): IWorkflowAdapter {
    // Try each adapter in detection order
    for (const adapter of this.detectionOrder) {
      if (adapter.detect(context)) {
        return adapter;
      }
    }

    // Fallback to general adapter (should always match)
    const generalAdapter = this.adapters.get('general');
    if (!generalAdapter) {
      throw new Error('General adapter not registered - this should never happen');
    }

    return generalAdapter;
  }

  /**
   * Get all registered adapter names
   *
   * @returns Array of adapter names
   */
  getAdapterNames(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Clear all adapters (useful for testing)
   */
  clear(): void {
    this.adapters.clear();
    this.detectionOrder = [];
  }
}

/**
 * Singleton instance of the adapter registry
 */
export const adapterRegistry = new AdapterRegistry();
