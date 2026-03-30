/**
 * Coding Pipeline Memory Adapter
 * Extracted from coding-pipeline-orchestrator.ts for constitution.xml compliance
 *
 * ONLY for /god-code coding pipeline - NOT for PhD pipeline.
 *
 * @module src/god-agent/core/pipeline/coding-memory-adapter
 */

import { z } from 'zod';
import type { PipelineMemoryCoordinator } from './pipeline-memory-coordinator.js';

// =============================================================================
// ERR-002: TYPED ERRORS WITH ERROR CODES
// =============================================================================

export type MemoryAdapterErrorCode = 'STORE_FAILED' | 'RETRIEVE_FAILED' | 'VALIDATION_FAILED';

export class MemoryAdapterError extends Error {
  constructor(
    public readonly code: MemoryAdapterErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'MemoryAdapterError';
    Object.setPrototypeOf(this, MemoryAdapterError.prototype);
  }
}

// =============================================================================
// TS-004: ZOD VALIDATION FOR CONFIGS
// =============================================================================

export const MemoryAdapterConfigSchema = z.object({
  verbose: z.boolean().optional().default(false),
  maxContextSize: z.number().min(1).optional().default(10000),
});

export type IMemoryAdapterConfig = z.infer<typeof MemoryAdapterConfigSchema>;

// =============================================================================
// INTERFACES
// =============================================================================

export interface IMemoryContext {
  patterns: string[];
  decisions: string[];
  constraints: string[];
}

export interface IMemoryService {
  store(key: string, value: unknown): Promise<void>;
  retrieve(key: string): Promise<unknown>;
}

// =============================================================================
// MEMORY STORAGE
// =============================================================================

export function storeMemory(
  memoryCoordinator: PipelineMemoryCoordinator,
  namespace: string,
  key: string,
  value: unknown,
  log: (message: string) => void
): void {
  const fullKey = createNamespacedKey(namespace, key);

  try {
    const step = {
      agentKey: 'orchestrator',
      task: 'pipeline-state-update',
      inputDomain: '',
      inputTags: [],
      outputDomain: namespace,
      outputTags: [fullKey],
    };

    memoryCoordinator.storeStepOutput(step, 0, `pipeline-${Date.now()}`, value, 'orchestrator');
  } catch (error) {
    throw new MemoryAdapterError('STORE_FAILED', `Failed to store ${fullKey}: ${(error as Error).message}`);
  }
}

// =============================================================================
// MEMORY RETRIEVAL
// =============================================================================

export function retrieveMemoryContext(
  memoryCoordinator: PipelineMemoryCoordinator,
  namespace: string,
  keys: string[]
): Record<string, unknown> {
  const context: Record<string, unknown> = {};

  for (const key of keys) {
    const fullKey = createNamespacedKey(namespace, key);
    try {
      const step = {
        agentKey: 'orchestrator',
        task: 'retrieve-context',
        inputDomain: fullKey,
        inputTags: [],
        outputDomain: '',
        outputTags: [],
      };
      const result = memoryCoordinator.retrievePreviousOutput(step, 'coding-pipeline');
      if (result.output !== undefined) {
        context[key] = result.output;
      }
    } catch {
      // Ignore retrieval errors - key may not exist yet
    }
  }
  return context;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

export function createNamespacedKey(namespace: string, key: string): string {
  return key.startsWith(namespace) ? key : `${namespace}/${key}`;
}
