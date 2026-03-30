/**
 * Memory Test Fixtures
 * ANTI-007: Centralized memory/engine test data factories
 *
 * Provides factory functions for creating test memory and engine mocks.
 */

import type { SonaEngine } from '../../src/god-agent/core/learning/sona-engine.js';
import type { IMemoryEngine } from '../../src/god-agent/core/pipeline/phd-pipeline-runner.js';
import { vi } from 'vitest';

// ==================== Memory Engine Fixtures ====================

/**
 * Create a test memory engine with configurable behavior
 */
export function createTestMemoryEngine(
  options?: {
    initialKnowledge?: Map<string, unknown>;
    shouldFail?: boolean;
  }
): IMemoryEngine {
  const { initialKnowledge = new Map(), shouldFail = false } = options ?? {};

  const storage = new Map(initialKnowledge);

  return {
    store: vi.fn(async (key: string, value: unknown) => {
      if (shouldFail) {
        throw new Error('Memory store failed');
      }
      storage.set(key, value);
    }),

    retrieve: vi.fn(async (key: string) => {
      if (shouldFail) {
        throw new Error('Memory retrieve failed');
      }
      return storage.get(key) ?? null;
    }),

    search: vi.fn(async (query: string, _limit?: number) => {
      if (shouldFail) {
        throw new Error('Memory search failed');
      }
      // Simple substring search
      const results: Array<{ key: string; value: unknown; score: number }> = [];
      for (const [key, value] of storage.entries()) {
        if (key.includes(query) || JSON.stringify(value).includes(query)) {
          results.push({ key, value, score: 0.8 });
        }
      }
      return results;
    }),

    delete: vi.fn(async (key: string) => {
      if (shouldFail) {
        throw new Error('Memory delete failed');
      }
      storage.delete(key);
    }),

    clear: vi.fn(async () => {
      if (shouldFail) {
        throw new Error('Memory clear failed');
      }
      storage.clear();
    }),

    // Test helpers (not part of interface)
    _getStorage: () => storage,
    _setStorage: (data: Map<string, unknown>) => {
      storage.clear();
      for (const [k, v] of data.entries()) {
        storage.set(k, v);
      }
    },
  } as unknown as IMemoryEngine;
}

// ==================== Sona Engine Fixtures ====================

/**
 * Create a test SonaEngine with configurable behavior
 */
export function createTestSonaEngine(
  options?: {
    patterns?: Map<string, unknown>;
    trajectories?: Map<string, unknown>;
    shouldFail?: boolean;
  }
): SonaEngine {
  const {
    patterns = new Map(),
    trajectories = new Map(),
    shouldFail = false,
  } = options ?? {};

  return {
    // Pattern operations
    queryPatterns: vi.fn(async (_query: string, _options?: unknown) => {
      if (shouldFail) {
        throw new Error('Pattern query failed');
      }
      return Array.from(patterns.values());
    }),

    storePattern: vi.fn(async (pattern: unknown) => {
      if (shouldFail) {
        throw new Error('Pattern store failed');
      }
      const id = `pat_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      patterns.set(id, pattern);
      return id;
    }),

    // Trajectory operations
    createTrajectory: vi.fn(async (domain: string, task: string) => {
      if (shouldFail) {
        throw new Error('Trajectory creation failed');
      }
      const id = `trj_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      trajectories.set(id, { id, domain, task, steps: [], createdAt: Date.now() });
      return id;
    }),

    addTrajectoryStep: vi.fn(async (trajectoryId: string, step: unknown) => {
      if (shouldFail) {
        throw new Error('Step addition failed');
      }
      const trajectory = trajectories.get(trajectoryId);
      if (trajectory && typeof trajectory === 'object' && 'steps' in trajectory) {
        (trajectory as { steps: unknown[] }).steps.push(step);
      }
    }),

    completeTrajectory: vi.fn(async (trajectoryId: string, outcome: string, quality: number) => {
      if (shouldFail) {
        throw new Error('Trajectory completion failed');
      }
      const trajectory = trajectories.get(trajectoryId);
      if (trajectory && typeof trajectory === 'object') {
        Object.assign(trajectory, { outcome, quality, completedAt: Date.now() });
      }
    }),

    // Feedback operations
    provideFeedback: vi.fn(async (_feedback: unknown) => {
      if (shouldFail) {
        throw new Error('Feedback submission failed');
      }
    }),

    // Status operations
    getStatus: vi.fn(() => ({
      patternCount: patterns.size,
      trajectoryCount: trajectories.size,
      initialized: true,
    })),

    // Initialization
    initialize: vi.fn(async () => {
      if (shouldFail) {
        throw new Error('Initialization failed');
      }
    }),

    // Test helpers
    _getPatterns: () => patterns,
    _getTrajectories: () => trajectories,
  } as unknown as SonaEngine;
}

// ==================== Knowledge Entry Fixtures ====================

/**
 * Default knowledge entry structure
 */
interface TestKnowledgeEntry {
  id: string;
  content: string;
  category: string;
  domain: string;
  tags: string[];
  quality: number;
  usageCount: number;
  lastUsed: number;
  createdAt: number;
}

/**
 * Create a test knowledge entry
 */
export function createTestKnowledgeEntry(
  overrides?: Partial<TestKnowledgeEntry>
): TestKnowledgeEntry {
  const now = Date.now();

  return {
    id: overrides?.id ?? `ke_${now}_${Math.random().toString(36).slice(2)}`,
    content: overrides?.content ?? 'Test knowledge content',
    category: overrides?.category ?? 'test',
    domain: overrides?.domain ?? 'project/test',
    tags: overrides?.tags ?? ['test'],
    quality: overrides?.quality ?? 1.0,
    usageCount: overrides?.usageCount ?? 0,
    lastUsed: overrides?.lastUsed ?? now,
    createdAt: overrides?.createdAt ?? now,
  };
}

/**
 * Create multiple knowledge entries
 */
export function createTestKnowledgeEntries(
  count: number,
  baseOverrides?: Partial<TestKnowledgeEntry>
): TestKnowledgeEntry[] {
  return Array.from({ length: count }, (_, i) =>
    createTestKnowledgeEntry({
      ...baseOverrides,
      id: `ke_test_${i}`,
      content: baseOverrides?.content ?? `Test knowledge ${i + 1}`,
    })
  );
}

// ==================== Pre-built Test Data ====================

/**
 * Pre-built memory configurations for common scenarios
 */
export const TEST_MEMORY_SCENARIOS = {
  /**
   * Empty memory engine
   */
  empty: () => createTestMemoryEngine(),

  /**
   * Memory engine with sample knowledge
   */
  withKnowledge: () =>
    createTestMemoryEngine({
      initialKnowledge: new Map([
        ['project/api/endpoints', { type: 'schema', endpoints: ['/users', '/posts'] }],
        ['project/events/user', { type: 'event', events: ['created', 'updated'] }],
      ]),
    }),

  /**
   * Failing memory engine for error testing
   */
  failing: () => createTestMemoryEngine({ shouldFail: true }),
};
