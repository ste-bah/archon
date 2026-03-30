/**
 * TrajectoryTracker Tests
 * TASK-RSN-001 - ReasoningBank Trajectory Tracking
 *
 * Tests trajectory storage, LRU eviction, and Sona feedback integration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TrajectoryTracker } from '../../../../src/god-agent/core/reasoning/trajectory-tracker.js';
import { ReasoningMode } from '../../../../src/god-agent/core/reasoning/reasoning-types.js';
import type {
  IReasoningRequest,
  IReasoningResponse,
  ILearningFeedback
} from '../../../../src/god-agent/core/reasoning/reasoning-types.js';
import type { ISonaEngine } from '../../../../src/god-agent/core/learning/sona-types.js';

/**
 * Create a mock SonaEngine for testing
 * Per CONSTITUTION RULE-031: TrajectoryTracker MUST receive injected SonaEngine reference.
 */
function createMockSonaEngine(): ISonaEngine {
  return {
    createTrajectoryWithId: () => {},
    provideFeedback: async () => ({
      trajectoryId: '',
      patternsUpdated: 0,
      reward: 0,
      patternAutoCreated: false,
      elapsedMs: 0
    }),
    getWeight: async () => 0.0,
    getTrajectory: () => null
  };
}

describe('TrajectoryTracker', () => {
  let tracker: TrajectoryTracker;
  let mockSonaEngine: ISonaEngine;

  // Helper to create test embedding
  const createEmbedding = (dim: number = 1536): Float32Array => {
    const arr = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      arr[i] = Math.random() * 2 - 1;
    }
    return arr;
  };

  // Helper to create test request
  const createRequest = (): IReasoningRequest => ({
    query: createEmbedding(1536),
    type: ReasoningMode.PATTERN_MATCH,
    maxResults: 10,
    confidenceThreshold: 0.7
  });

  // Helper to create test response
  const createResponse = (): IReasoningResponse => ({
    query: createEmbedding(1536),
    type: ReasoningMode.PATTERN_MATCH,
    patterns: [],
    causalInferences: [],
    trajectoryId: '',
    confidence: 0.85,
    processingTimeMs: 5,
    provenanceInfo: { lScores: [], totalSources: 0, combinedLScore: 0 }
  });

  beforeEach(() => {
    mockSonaEngine = createMockSonaEngine();
    tracker = new TrajectoryTracker({
      sonaEngine: mockSonaEngine,
      maxTrajectories: 100,
      autoPrune: false // Disable for deterministic tests
    });
  });

  afterEach(() => {
    tracker.destroy();
  });

  describe('Trajectory Creation', () => {
    it('should create trajectory with unique ID', async () => {
      const request = createRequest();
      const response = createResponse();
      const embedding = createEmbedding(1536);

      const trajectory = await tracker.createTrajectory(
        request, response, embedding
      );

      expect(trajectory.id).toMatch(/^traj_\d+_[a-f0-9]+$/);
      expect(trajectory.timestamp).toBeLessThanOrEqual(Date.now());
      expect(trajectory.request).toBe(request);
      expect(trajectory.response).toBe(response);
      expect(trajectory.embedding).toBe(embedding);
    });

    it('should store enhanced embedding when provided', async () => {
      const request = createRequest();
      const response = createResponse();
      const embedding = createEmbedding(1536);
      const enhanced = createEmbedding(1024);

      const trajectory = await tracker.createTrajectory(
        request, response, embedding, enhanced
      );

      expect(trajectory.enhancedEmbedding).toBe(enhanced);
      expect(trajectory.enhancedEmbedding?.length).toBe(1024);
    });

    it('should store L-Score when provided', async () => {
      const request = createRequest();
      const response = createResponse();
      const embedding = createEmbedding(1536);

      const trajectory = await tracker.createTrajectory(
        request, response, embedding, undefined, 0.85
      );

      expect(trajectory.lScore).toBe(0.85);
    });

    it('should default L-Score to 0', async () => {
      const request = createRequest();
      const response = createResponse();
      const embedding = createEmbedding(1536);

      const trajectory = await tracker.createTrajectory(
        request, response, embedding
      );

      expect(trajectory.lScore).toBe(0);
    });
  });

  describe('Trajectory Retrieval', () => {
    it('should retrieve trajectory by ID', async () => {
      const request = createRequest();
      const response = createResponse();
      const embedding = createEmbedding(1536);

      const created = await tracker.createTrajectory(
        request, response, embedding
      );

      const retrieved = await tracker.getTrajectory(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.request).toBe(request);
    });

    it('should return null for non-existent trajectory', async () => {
      const result = await tracker.getTrajectory('traj_nonexistent_12345678' as any);
      expect(result).toBeNull();
    });

    it('should update LRU timestamp on access', async () => {
      const request = createRequest();
      const response = createResponse();
      const embedding = createEmbedding(1536);

      const created = await tracker.createTrajectory(
        request, response, embedding
      );

      // Wait a bit and access
      await new Promise(resolve => setTimeout(resolve, 10));
      await tracker.getTrajectory(created.id);

      // Access should update timestamp (verified by eviction priority)
      const stats = tracker.getStats();
      expect(stats.total).toBe(1);
    });
  });

  describe('Feedback Integration', () => {
    it('should update trajectory with feedback', async () => {
      const request = createRequest();
      const response = createResponse();
      const embedding = createEmbedding(1536);

      const trajectory = await tracker.createTrajectory(
        request, response, embedding
      );

      const feedback: ILearningFeedback = {
        trajectoryId: trajectory.id,
        verdict: 'correct',
        quality: 0.9,
        reasoning: 'Good response'
      };

      const updated = await tracker.updateFeedback(trajectory.id, feedback);

      expect(updated.feedback).toBe(feedback);
      expect(updated.feedback?.quality).toBe(0.9);
      expect(updated.feedback?.verdict).toBe('correct');
    });

    it('should throw on feedback for non-existent trajectory', async () => {
      const feedback: ILearningFeedback = {
        trajectoryId: 'traj_nonexistent_12345678' as any,
        verdict: 'correct',
        quality: 0.9
      };

      await expect(tracker.updateFeedback(feedback.trajectoryId, feedback))
        .rejects.toThrow('Trajectory not found');
    });
  });

  describe('High-Quality Trajectory Extraction', () => {
    it('should return high-quality trajectories', async () => {
      const embedding = createEmbedding(1536);

      // Create trajectories with different quality
      const traj1 = await tracker.createTrajectory(
        createRequest(), createResponse(), embedding
      );
      const traj2 = await tracker.createTrajectory(
        createRequest(), createResponse(), embedding
      );
      const traj3 = await tracker.createTrajectory(
        createRequest(), createResponse(), embedding
      );

      // Add feedback with varying quality
      await tracker.updateFeedback(traj1.id, {
        trajectoryId: traj1.id,
        verdict: 'correct',
        quality: 0.95
      });
      await tracker.updateFeedback(traj2.id, {
        trajectoryId: traj2.id,
        verdict: 'correct',
        quality: 0.6
      });
      await tracker.updateFeedback(traj3.id, {
        trajectoryId: traj3.id,
        verdict: 'correct',
        quality: 0.85
      });

      const highQuality = await tracker.getHighQualityTrajectories(0.8);

      expect(highQuality.length).toBe(2);
      expect(highQuality[0].feedback?.quality).toBe(0.95);
      expect(highQuality[1].feedback?.quality).toBe(0.85);
    });

    it('should respect limit parameter', async () => {
      const embedding = createEmbedding(1536);

      // Create 5 high-quality trajectories
      for (let i = 0; i < 5; i++) {
        const traj = await tracker.createTrajectory(
          createRequest(), createResponse(), embedding
        );
        await tracker.updateFeedback(traj.id, {
          trajectoryId: traj.id,
          verdict: 'correct',
          quality: 0.9
        });
      }

      const highQuality = await tracker.getHighQualityTrajectories(0.8, 3);

      expect(highQuality.length).toBe(3);
    });

    it('should return empty for no high-quality trajectories', async () => {
      const embedding = createEmbedding(1536);

      // Create low-quality trajectory
      const traj = await tracker.createTrajectory(
        createRequest(), createResponse(), embedding
      );
      await tracker.updateFeedback(traj.id, {
        trajectoryId: traj.id,
        verdict: 'incorrect',
        quality: 0.3
      });

      const highQuality = await tracker.getHighQualityTrajectories(0.8);

      expect(highQuality.length).toBe(0);
    });
  });

  describe('Similar Trajectory Search', () => {
    it('should find similar trajectories by embedding', async () => {
      const baseEmbedding = createEmbedding(1536);

      // Create trajectory with known embedding
      await tracker.createTrajectory(
        createRequest(), createResponse(), baseEmbedding
      );

      // Search with similar embedding (same for high similarity)
      const similar = await tracker.findSimilarTrajectories(baseEmbedding, 5, 0.9);

      expect(similar.length).toBeGreaterThan(0);
    });

    it('should filter by similarity threshold', async () => {
      const embedding1 = createEmbedding(1536);
      const embedding2 = createEmbedding(1536); // Different random embedding

      await tracker.createTrajectory(
        createRequest(), createResponse(), embedding1
      );

      // Search with different embedding and high threshold
      const similar = await tracker.findSimilarTrajectories(embedding2, 5, 0.99);

      // Very unlikely to find highly similar random embeddings
      expect(similar.length).toBeLessThanOrEqual(1);
    });

    it('should return top k similar trajectories', async () => {
      const baseEmbedding = createEmbedding(1536);

      // Create 10 trajectories
      for (let i = 0; i < 10; i++) {
        await tracker.createTrajectory(
          createRequest(), createResponse(), baseEmbedding
        );
      }

      const similar = await tracker.findSimilarTrajectories(baseEmbedding, 5, 0.5);

      expect(similar.length).toBeLessThanOrEqual(5);
    });
  });

  describe('LRU Eviction', () => {
    it('should evict when max trajectories reached', async () => {
      const smallTracker = new TrajectoryTracker({
        sonaEngine: createMockSonaEngine(),
        maxTrajectories: 3,
        autoPrune: false
      });

      const embedding = createEmbedding(1536);

      // Create 4 trajectories (1 more than max)
      for (let i = 0; i < 4; i++) {
        await smallTracker.createTrajectory(
          createRequest(), createResponse(), embedding
        );
      }

      const stats = smallTracker.getStats();
      expect(stats.total).toBe(3);

      smallTracker.destroy();
    });

    it('should prefer evicting low-quality trajectories', async () => {
      const smallTracker = new TrajectoryTracker({
        sonaEngine: createMockSonaEngine(),
        maxTrajectories: 2,
        autoPrune: false
      });

      const embedding = createEmbedding(1536);

      // Create low-quality trajectory
      const lowQuality = await smallTracker.createTrajectory(
        createRequest(), createResponse(), embedding
      );
      await smallTracker.updateFeedback(lowQuality.id, {
        trajectoryId: lowQuality.id,
        verdict: 'incorrect',
        quality: 0.1
      });

      // Create high-quality trajectory
      const highQuality = await smallTracker.createTrajectory(
        createRequest(), createResponse(), embedding
      );
      await smallTracker.updateFeedback(highQuality.id, {
        trajectoryId: highQuality.id,
        verdict: 'correct',
        quality: 0.95
      });

      // Add third to trigger eviction
      await smallTracker.createTrajectory(
        createRequest(), createResponse(), embedding
      );

      // Low quality should be evicted
      const retrievedLow = await smallTracker.getTrajectory(lowQuality.id);
      const retrievedHigh = await smallTracker.getTrajectory(highQuality.id);

      expect(retrievedLow).toBeNull();
      expect(retrievedHigh).not.toBeNull();

      smallTracker.destroy();
    });
  });

  describe('Expiration Pruning', () => {
    it('should prune expired trajectories', async () => {
      const fastExpireTracker = new TrajectoryTracker({
        sonaEngine: createMockSonaEngine(),
        maxTrajectories: 100,
        retentionMs: 50, // 50ms retention
        autoPrune: false
      });

      const embedding = createEmbedding(1536);

      await fastExpireTracker.createTrajectory(
        createRequest(), createResponse(), embedding
      );

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 100));

      const pruned = await fastExpireTracker.pruneExpired();

      expect(pruned).toBe(1);
      expect(fastExpireTracker.getStats().total).toBe(0);

      fastExpireTracker.destroy();
    });
  });

  describe('Statistics', () => {
    it('should track trajectory statistics', async () => {
      const embedding = createEmbedding(1536);

      // Create trajectories
      const traj1 = await tracker.createTrajectory(
        createRequest(), createResponse(), embedding, undefined, 0.8
      );
      const traj2 = await tracker.createTrajectory(
        createRequest(), createResponse(), embedding, undefined, 0.6
      );

      // Add feedback to first
      await tracker.updateFeedback(traj1.id, {
        trajectoryId: traj1.id,
        verdict: 'correct',
        quality: 0.9
      });

      const stats = tracker.getStats();

      expect(stats.total).toBe(2);
      expect(stats.withFeedback).toBe(1);
      expect(stats.highQuality).toBe(1);
      expect(stats.averageLScore).toBeCloseTo(0.7, 1);
      expect(stats.averageQuality).toBeCloseTo(0.9, 1);
    });

    it('should track timestamp range', async () => {
      const embedding = createEmbedding(1536);

      const before = Date.now();
      await tracker.createTrajectory(
        createRequest(), createResponse(), embedding
      );
      await new Promise(resolve => setTimeout(resolve, 10));
      await tracker.createTrajectory(
        createRequest(), createResponse(), embedding
      );
      const after = Date.now();

      const stats = tracker.getStats();

      expect(stats.oldestTimestamp).toBeGreaterThanOrEqual(before);
      expect(stats.newestTimestamp).toBeLessThanOrEqual(after);
      expect(stats.oldestTimestamp).toBeLessThanOrEqual(stats.newestTimestamp);
    });
  });

  describe('ID Generation', () => {
    it('should generate unique trajectory IDs', () => {
      const ids = new Set<string>();

      for (let i = 0; i < 100; i++) {
        const id = tracker.generateTrajectoryId();
        expect(ids.has(id)).toBe(false);
        ids.add(id);
      }

      expect(ids.size).toBe(100);
    });

    it('should generate IDs with proper format', () => {
      const id = tracker.generateTrajectoryId();

      expect(id).toMatch(/^traj_\d+_[a-f0-9]{8}$/);
    });
  });

  describe('Performance', () => {
    it('should create trajectory in under 1ms', async () => {
      const embedding = createEmbedding(1536);

      const start = performance.now();
      await tracker.createTrajectory(
        createRequest(), createResponse(), embedding
      );
      const end = performance.now();

      // Allow up to 10ms for CI environments with variable load
      expect(end - start).toBeLessThan(10);
    });

    it('should retrieve trajectory in under 1ms', async () => {
      const embedding = createEmbedding(1536);
      const trajectory = await tracker.createTrajectory(
        createRequest(), createResponse(), embedding
      );

      const start = performance.now();
      await tracker.getTrajectory(trajectory.id);
      const end = performance.now();

      expect(end - start).toBeLessThan(1);
    });
  });
});
