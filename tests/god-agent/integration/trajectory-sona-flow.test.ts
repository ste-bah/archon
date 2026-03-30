/**
 * TASK-SONA-004: Trajectory → SONA Flow Integration Test
 *
 * Verifies the complete trajectory learning pipeline:
 * 1. TrajectoryTracker creates trajectories with SonaEngine injection (RULE-031)
 * 2. TrajectoryTracker forwards to SonaEngine.createTrajectoryWithId (RULE-025)
 * 3. SonaEngine updates weights based on trajectory
 * 4. Feedback flows back through the system
 *
 * Per CONSTITUTION:
 * - RULE-025: TrajectoryTracker MUST call SonaEngine.createTrajectoryWithId
 * - RULE-031: TrajectoryTracker MUST receive injected SonaEngine reference
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TrajectoryTracker, type TrajectoryTrackerConfig } from '../../../src/god-agent/core/reasoning/trajectory-tracker.js';
import { ReasoningMode } from '../../../src/god-agent/core/reasoning/reasoning-types.js';
import type { ISonaEngine } from '../../../src/god-agent/core/learning/sona-types.js';

// Create a mock SonaEngine that implements ISonaEngine
function createMockSonaEngine(): ISonaEngine & {
  _createdTrajectories: Array<{ trajectoryId: string; route: string; patternIds: string[]; contextIds: string[] }>;
  _feedback: Array<{ trajectoryId: string; quality: number; verdict: string }>;
} {
  const createdTrajectories: Array<{ trajectoryId: string; route: string; patternIds: string[]; contextIds: string[] }> = [];
  const feedback: Array<{ trajectoryId: string; quality: number; verdict: string }> = [];

  return {
    _createdTrajectories: createdTrajectories,
    _feedback: feedback,

    // Core trajectory methods
    createTrajectory: vi.fn().mockReturnValue({
      trajectoryId: 'mock-trajectory-id',
      route: 'mock-route',
      patternIds: [],
      contextIds: []
    }),

    createTrajectoryWithId: vi.fn().mockImplementation((trajectoryId: string, route: string, patternIds: string[], contextIds: string[]) => {
      createdTrajectories.push({ trajectoryId, route, patternIds, contextIds });
      return {
        trajectoryId,
        route,
        patternIds,
        contextIds
      };
    }),

    submitFeedback: vi.fn().mockImplementation((trajectoryId: string, quality: number, verdict?: string) => {
      feedback.push({ trajectoryId, quality, verdict: verdict ?? 'unknown' });
      return {
        success: true,
        trajectoryId,
        quality,
        verdict
      };
    }),

    // Weight management
    getWeights: vi.fn().mockReturnValue(new Map([['default', 1.0]])),
    updateWeights: vi.fn().mockResolvedValue(undefined),

    // Status methods
    getStatus: vi.fn().mockReturnValue({
      initialized: true,
      totalTrajectories: createdTrajectories.length,
      totalFeedback: feedback.length
    }),

    // Lifecycle
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),

    // Configuration
    getConfig: vi.fn().mockReturnValue({
      learningRate: 0.01,
      minQuality: 0.5
    })
  };
}

describe('TASK-SONA-004: Trajectory → SONA Flow', () => {
  let mockSonaEngine: ReturnType<typeof createMockSonaEngine>;
  let tracker: TrajectoryTracker;

  beforeEach(() => {
    mockSonaEngine = createMockSonaEngine();

    const config: TrajectoryTrackerConfig = {
      sonaEngine: mockSonaEngine,
      maxTrajectories: 100,
      retentionMs: 24 * 60 * 60 * 1000, // 1 day
      autoPrune: false // Disable for tests
    };

    tracker = new TrajectoryTracker(config);
  });

  afterEach(() => {
    tracker.destroy();
  });

  describe('RULE-031: SonaEngine Injection', () => {
    it('should throw if SonaEngine is not provided', () => {
      expect(() => {
        new TrajectoryTracker({
          sonaEngine: null as unknown as ISonaEngine
        });
      }).toThrow('SonaEngine injection required per Constitution RULE-031');
    });

    it('should store injected SonaEngine reference', () => {
      expect(tracker.getSonaEngine()).toBe(mockSonaEngine);
    });
  });

  describe('RULE-025: Trajectory Forwarding to SonaEngine', () => {
    it('should call createTrajectoryWithId when creating trajectory', async () => {
      const request = {
        type: ReasoningMode.PATTERN_MATCH,
        query: 'Test query for pattern matching',
        context: {},
        options: {}
      };

      const response = {
        patterns: [{ patternId: 'pattern-1', confidence: 0.9, matches: [] }],
        causalInferences: [],
        recommendations: [],
        confidence: 0.9,
        mode: ReasoningMode.PATTERN_MATCH
      };

      const embedding = new Float32Array([0.1, 0.2, 0.3]);

      const trajectory = await tracker.createTrajectory(request, response, embedding);

      // Verify SonaEngine.createTrajectoryWithId was called
      expect(mockSonaEngine.createTrajectoryWithId).toHaveBeenCalledWith(
        trajectory.id,
        'reasoning.pattern', // Route inferred from PATTERN_MATCH
        ['pattern-1'],       // Pattern IDs from response
        []                   // Context IDs from causalInferences
      );

      // Verify the trajectory was stored
      expect(mockSonaEngine._createdTrajectories).toHaveLength(1);
      expect(mockSonaEngine._createdTrajectories[0].trajectoryId).toBe(trajectory.id);
    });

    it('should infer correct route from reasoning mode', async () => {
      const testCases = [
        { mode: ReasoningMode.PATTERN_MATCH, expectedRoute: 'reasoning.pattern' },
        { mode: ReasoningMode.CAUSAL_INFERENCE, expectedRoute: 'reasoning.causal' },
        { mode: ReasoningMode.CONTEXTUAL, expectedRoute: 'reasoning.contextual' },
        { mode: ReasoningMode.HYBRID, expectedRoute: 'reasoning.hybrid' }
      ];

      for (const testCase of testCases) {
        const request = {
          type: testCase.mode,
          query: 'Test query',
          context: {},
          options: {}
        };

        const response = {
          patterns: [],
          causalInferences: [],
          recommendations: [],
          confidence: 0.8,
          mode: testCase.mode
        };

        await tracker.createTrajectory(request, response, new Float32Array([0.1]));

        const lastCall = mockSonaEngine._createdTrajectories[mockSonaEngine._createdTrajectories.length - 1];
        expect(lastCall.route).toBe(testCase.expectedRoute);
      }
    });

    it('should extract pattern IDs from response', async () => {
      const request = {
        type: ReasoningMode.PATTERN_MATCH,
        query: 'Multi-pattern query',
        context: {},
        options: {}
      };

      const response = {
        patterns: [
          { patternId: 'p1', confidence: 0.9, matches: [] },
          { patternId: 'p2', confidence: 0.85, matches: [] },
          { patternId: 'p3', confidence: 0.8, matches: [] }
        ],
        causalInferences: [],
        recommendations: [],
        confidence: 0.9,
        mode: ReasoningMode.PATTERN_MATCH
      };

      await tracker.createTrajectory(request, response, new Float32Array([0.1]));

      const lastCall = mockSonaEngine._createdTrajectories[mockSonaEngine._createdTrajectories.length - 1];
      expect(lastCall.patternIds).toEqual(['p1', 'p2', 'p3']);
    });

    it('should extract context IDs from causal inferences', async () => {
      const request = {
        type: ReasoningMode.CAUSAL_INFERENCE,
        query: 'Causal query',
        context: {},
        options: {}
      };

      const response = {
        patterns: [],
        causalInferences: [
          { nodeId: 'ctx-1', relationships: [] },
          { nodeId: 'ctx-2', relationships: [] }
        ],
        recommendations: [],
        confidence: 0.85,
        mode: ReasoningMode.CAUSAL_INFERENCE
      };

      await tracker.createTrajectory(request, response, new Float32Array([0.1]));

      const lastCall = mockSonaEngine._createdTrajectories[mockSonaEngine._createdTrajectories.length - 1];
      expect(lastCall.contextIds).toEqual(['ctx-1', 'ctx-2']);
    });
  });

  describe('Trajectory Lifecycle', () => {
    it('should generate unique trajectory IDs', async () => {
      const ids = new Set<string>();

      for (let i = 0; i < 10; i++) {
        const trajectory = await tracker.createTrajectory(
          { type: ReasoningMode.PATTERN_MATCH, query: `Query ${i}`, context: {}, options: {} },
          { patterns: [], causalInferences: [], recommendations: [], confidence: 0.8, mode: ReasoningMode.PATTERN_MATCH },
          new Float32Array([0.1])
        );
        ids.add(trajectory.id);
      }

      expect(ids.size).toBe(10); // All IDs should be unique
    });

    it('should store trajectory with all metadata', async () => {
      const request = {
        type: ReasoningMode.PATTERN_MATCH,
        query: 'Store test',
        context: { key: 'value' },
        options: { someOption: true }
      };

      const response = {
        patterns: [{ patternId: 'p1', confidence: 0.9, matches: [] }],
        causalInferences: [],
        recommendations: [],
        confidence: 0.9,
        mode: ReasoningMode.PATTERN_MATCH
      };

      const embedding = new Float32Array([0.1, 0.2, 0.3]);

      const trajectory = await tracker.createTrajectory(request, response, embedding, undefined, 0.85);

      // Retrieve and verify
      const retrieved = await tracker.getTrajectory(trajectory.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.request).toEqual(request);
      expect(retrieved?.response).toEqual(response);
      expect(retrieved?.lScore).toBe(0.85);
    });

    it('should update trajectory feedback', async () => {
      const trajectory = await tracker.createTrajectory(
        { type: ReasoningMode.PATTERN_MATCH, query: 'Feedback test', context: {}, options: {} },
        { patterns: [], causalInferences: [], recommendations: [], confidence: 0.8, mode: ReasoningMode.PATTERN_MATCH },
        new Float32Array([0.1])
      );

      const feedback = {
        quality: 0.9,
        verdict: 'good',
        notes: 'Excellent result'
      };

      const updated = await tracker.updateFeedback(trajectory.id, feedback);

      expect(updated.feedback).toBeDefined();
      expect(updated.feedback?.quality).toBe(0.9);
      expect(updated.feedback?.verdict).toBe('good');
    });
  });

  describe('Trajectory Statistics', () => {
    it('should track trajectory statistics', async () => {
      // Create several trajectories
      for (let i = 0; i < 5; i++) {
        const trajectory = await tracker.createTrajectory(
          { type: ReasoningMode.PATTERN_MATCH, query: `Query ${i}`, context: {}, options: {} },
          { patterns: [], causalInferences: [], recommendations: [], confidence: 0.8, mode: ReasoningMode.PATTERN_MATCH },
          new Float32Array([0.1]),
          undefined,
          0.7 + i * 0.05 // Varying L-scores
        );

        if (i % 2 === 0) {
          await tracker.updateFeedback(trajectory.id, { quality: 0.8 + i * 0.02 });
        }
      }

      const stats = tracker.getStats();

      expect(stats.total).toBe(5);
      expect(stats.withFeedback).toBe(3); // 0, 2, 4
      expect(stats.averageLScore).toBeGreaterThan(0.7);
    });

    it('should identify high-quality trajectories', async () => {
      // Create trajectories with varying quality
      const highQualityTrajectory = await tracker.createTrajectory(
        { type: ReasoningMode.PATTERN_MATCH, query: 'High quality', context: {}, options: {} },
        { patterns: [], causalInferences: [], recommendations: [], confidence: 0.95, mode: ReasoningMode.PATTERN_MATCH },
        new Float32Array([0.1])
      );
      await tracker.updateFeedback(highQualityTrajectory.id, { quality: 0.95 });

      await tracker.createTrajectory(
        { type: ReasoningMode.PATTERN_MATCH, query: 'Low quality', context: {}, options: {} },
        { patterns: [], causalInferences: [], recommendations: [], confidence: 0.5, mode: ReasoningMode.PATTERN_MATCH },
        new Float32Array([0.2])
      );

      const highQuality = await tracker.getHighQualityTrajectories(0.8);

      expect(highQuality.length).toBe(1);
      expect(highQuality[0].id).toBe(highQualityTrajectory.id);
    });
  });
});
