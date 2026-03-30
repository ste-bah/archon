/**
 * Tests for InjectionFilter - DESC safety mechanisms
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InjectionFilter } from '../../../../../src/god-agent/core/ucm/desc/injection-filter.js';
import type {
  IStoredEpisode,
  ITaskContext,
  WorkflowCategory
} from '../../../../../src/god-agent/core/ucm/types.js';
import { WorkflowCategory as WC } from '../../../../../src/god-agent/core/ucm/types.js';

describe('InjectionFilter', () => {
  let filter: InjectionFilter;

  beforeEach(() => {
    filter = new InjectionFilter();
  });

  describe('detectWorkflowCategory', () => {
    it('should detect CODING workflow from agentId', () => {
      const context: ITaskContext = {
        agentId: 'coder',
        task: 'Implement authentication'
      };
      expect(filter.detectWorkflowCategory(context)).toBe(WC.CODING);
    });

    it('should detect CODING workflow from task keywords', () => {
      const context: ITaskContext = {
        task: 'Write code to implement the API endpoint'
      };
      expect(filter.detectWorkflowCategory(context)).toBe(WC.CODING);
    });

    it('should detect RESEARCH workflow from agentId', () => {
      const context: ITaskContext = {
        agentId: 'phd-researcher',
        task: 'Review literature on machine learning'
      };
      expect(filter.detectWorkflowCategory(context)).toBe(WC.RESEARCH);
    });

    it('should detect RESEARCH workflow from pipeline name', () => {
      const context: ITaskContext = {
        pipelineName: 'phd-literature-review',
        task: 'Analyze research papers'
      };
      expect(filter.detectWorkflowCategory(context)).toBe(WC.RESEARCH);
    });

    it('should default to GENERAL workflow', () => {
      const context: ITaskContext = {
        task: 'Update documentation'
      };
      expect(filter.detectWorkflowCategory(context)).toBe(WC.GENERAL);
    });
  });

  describe('applyRecencyDecay', () => {
    it('should apply no decay for recent episodes', () => {
      const episode: IStoredEpisode = {
        episodeId: 'test-1',
        queryText: 'test',
        answerText: 'test',
        queryChunkEmbeddings: [],
        answerChunkEmbeddings: [],
        queryChunkCount: 0,
        answerChunkCount: 0,
        createdAt: new Date(), // Now
        metadata: {}
      };

      const weight = filter.applyRecencyDecay(episode, WC.CODING);
      expect(weight).toBeCloseTo(1.0, 2); // ~100% weight
    });

    it('should apply 50% decay after half-life for CODING', () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const episode: IStoredEpisode = {
        episodeId: 'test-1',
        queryText: 'test',
        answerText: 'test',
        queryChunkEmbeddings: [],
        answerChunkEmbeddings: [],
        queryChunkCount: 0,
        answerChunkCount: 0,
        createdAt: thirtyDaysAgo,
        metadata: {}
      };

      const weight = filter.applyRecencyDecay(episode, WC.CODING);
      expect(weight).toBeCloseTo(0.5, 2); // ~50% weight
    });

    it('should apply 25% decay after 60 days for CODING', () => {
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      const episode: IStoredEpisode = {
        episodeId: 'test-1',
        queryText: 'test',
        answerText: 'test',
        queryChunkEmbeddings: [],
        answerChunkEmbeddings: [],
        queryChunkCount: 0,
        answerChunkCount: 0,
        createdAt: sixtyDaysAgo,
        metadata: {}
      };

      const weight = filter.applyRecencyDecay(episode, WC.CODING);
      expect(weight).toBeCloseTo(0.25, 2); // ~25% weight
    });

    it('should decay slower for RESEARCH (90-day half-life)', () => {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const episode: IStoredEpisode = {
        episodeId: 'test-1',
        queryText: 'test',
        answerText: 'test',
        queryChunkEmbeddings: [],
        answerChunkEmbeddings: [],
        queryChunkCount: 0,
        answerChunkCount: 0,
        createdAt: ninetyDaysAgo,
        metadata: {}
      };

      const weight = filter.applyRecencyDecay(episode, WC.RESEARCH);
      expect(weight).toBeCloseTo(0.5, 2); // ~50% weight at 90 days
    });
  });

  describe('isContentTypeMatch', () => {
    it('should match CODE episodes for CODING tasks', () => {
      const episodeMetadata = { contentType: 'code' };
      const taskContext: ITaskContext = {
        agentId: 'coder',
        task: 'Write function'
      };

      expect(filter.isContentTypeMatch(episodeMetadata, taskContext)).toBe(true);
    });

    it('should reject PROSE episodes for CODING tasks', () => {
      const episodeMetadata = { contentType: 'prose' };
      const taskContext: ITaskContext = {
        agentId: 'coder',
        task: 'Write function'
      };

      expect(filter.isContentTypeMatch(episodeMetadata, taskContext)).toBe(false);
    });

    it('should match PROSE episodes for RESEARCH tasks', () => {
      const episodeMetadata = { contentType: 'prose' };
      const taskContext: ITaskContext = {
        agentId: 'phd-researcher',
        task: 'Literature review'
      };

      expect(filter.isContentTypeMatch(episodeMetadata, taskContext)).toBe(true);
    });

    it('should accept any content type for GENERAL tasks', () => {
      const episodeMetadata = { contentType: 'code' };
      const taskContext: ITaskContext = {
        task: 'General task'
      };

      expect(filter.isContentTypeMatch(episodeMetadata, taskContext)).toBe(true);
    });

    it('should allow episodes without content type', () => {
      const episodeMetadata = {};
      const taskContext: ITaskContext = {
        agentId: 'coder',
        task: 'Write function'
      };

      // Backward compatibility - no content type specified
      expect(filter.isContentTypeMatch(episodeMetadata, taskContext)).toBe(true);
    });
  });

  describe('isFileContextRelevant', () => {
    it('should match same directory', () => {
      const episodeMetadata = { files: ['src/auth/login.ts'] };
      const taskContext: ITaskContext = {
        task: 'Update auth',
        metadata: { files: ['src/auth/logout.ts'] }
      };

      expect(filter.isFileContextRelevant(episodeMetadata, taskContext)).toBe(true);
    });

    it('should match same module (parent directory)', () => {
      const episodeMetadata = { files: ['src/auth/handlers/login.ts'] };
      const taskContext: ITaskContext = {
        task: 'Update auth',
        metadata: { files: ['src/auth/middleware/verify.ts'] }
      };

      expect(filter.isFileContextRelevant(episodeMetadata, taskContext)).toBe(true);
    });

    it('should match same file extension', () => {
      const episodeMetadata = { files: ['src/utils/helper.ts'] };
      const taskContext: ITaskContext = {
        task: 'Add utility',
        metadata: { files: ['src/services/api.ts'] }
      };

      expect(filter.isFileContextRelevant(episodeMetadata, taskContext)).toBe(true);
    });

    it('should reject completely different contexts', () => {
      const episodeMetadata = { files: ['backend/database/schema.sql'] };
      const taskContext: ITaskContext = {
        task: 'Update frontend',
        metadata: { files: ['frontend/components/Button.tsx'] }
      };

      expect(filter.isFileContextRelevant(episodeMetadata, taskContext)).toBe(false);
    });

    it('should allow when no file context present', () => {
      const episodeMetadata = {};
      const taskContext: ITaskContext = {
        task: 'General task'
      };

      expect(filter.isFileContextRelevant(episodeMetadata, taskContext)).toBe(true);
    });
  });

  describe('shouldInject - CODING tasks', () => {
    it('should reject low similarity for CODING tasks', () => {
      const episode: IStoredEpisode = {
        episodeId: 'test-1',
        queryText: 'test',
        answerText: 'test',
        queryChunkEmbeddings: [],
        answerChunkEmbeddings: [],
        queryChunkCount: 0,
        answerChunkCount: 0,
        createdAt: new Date(),
        metadata: { contentType: 'code', files: ['src/auth.ts'] }
      };

      const taskContext: ITaskContext = {
        agentId: 'coder',
        task: 'Implement auth',
        metadata: { files: ['src/auth.ts'] }
      };

      // 90% similarity - below 92% threshold for CODING
      const decision = filter.shouldInject(episode, 0.90, taskContext);
      expect(decision.inject).toBe(false);
      expect(decision.category).toBe(WC.CODING);
      expect(decision.reason).toContain('below threshold');
    });

    it('should accept high similarity for CODING tasks', () => {
      const episode: IStoredEpisode = {
        episodeId: 'test-1',
        queryText: 'test',
        answerText: 'test',
        queryChunkEmbeddings: [],
        answerChunkEmbeddings: [],
        queryChunkCount: 0,
        answerChunkCount: 0,
        createdAt: new Date(),
        metadata: { contentType: 'code', files: ['src/auth.ts'] }
      };

      const taskContext: ITaskContext = {
        agentId: 'coder',
        task: 'Implement auth',
        metadata: { files: ['src/auth.ts'] }
      };

      // 95% similarity - above 92% threshold
      const decision = filter.shouldInject(episode, 0.95, taskContext);
      expect(decision.inject).toBe(true);
      expect(decision.category).toBe(WC.CODING);
      expect(decision.adjustedScore).toBeCloseTo(0.95, 2);
    });

    it('should reject content type mismatch for CODING tasks', () => {
      const episode: IStoredEpisode = {
        episodeId: 'test-1',
        queryText: 'test',
        answerText: 'test',
        queryChunkEmbeddings: [],
        answerChunkEmbeddings: [],
        queryChunkCount: 0,
        answerChunkCount: 0,
        createdAt: new Date(),
        metadata: { contentType: 'prose' } // Wrong type
      };

      const taskContext: ITaskContext = {
        agentId: 'coder',
        task: 'Write code'
      };

      const decision = filter.shouldInject(episode, 0.95, taskContext);
      expect(decision.inject).toBe(false);
      expect(decision.reason).toContain('Content type mismatch');
    });

    it('should reject irrelevant file context for CODING tasks', () => {
      const episode: IStoredEpisode = {
        episodeId: 'test-1',
        queryText: 'test',
        answerText: 'test',
        queryChunkEmbeddings: [],
        answerChunkEmbeddings: [],
        queryChunkCount: 0,
        answerChunkCount: 0,
        createdAt: new Date(),
        metadata: { contentType: 'code', files: ['backend/logging.ts'] }
      };

      const taskContext: ITaskContext = {
        agentId: 'coder',
        task: 'Update auth',
        metadata: { files: ['frontend/auth.tsx'] }
      };

      const decision = filter.shouldInject(episode, 0.95, taskContext);
      expect(decision.inject).toBe(false);
      expect(decision.reason).toContain('File context not relevant');
    });

    it('should apply recency decay for old CODING solutions', () => {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const episode: IStoredEpisode = {
        episodeId: 'test-1',
        queryText: 'test',
        answerText: 'test',
        queryChunkEmbeddings: [],
        answerChunkEmbeddings: [],
        queryChunkCount: 0,
        answerChunkCount: 0,
        createdAt: ninetyDaysAgo, // 90 days old
        metadata: { contentType: 'code', files: ['src/auth.ts'] }
      };

      const taskContext: ITaskContext = {
        agentId: 'coder',
        task: 'Implement auth',
        metadata: { files: ['src/auth.ts'] }
      };

      // 95% similarity, but 90 days old = ~0.25 weight = ~0.2375 adjusted score
      const decision = filter.shouldInject(episode, 0.95, taskContext);
      expect(decision.inject).toBe(false); // Below 0.92 threshold after decay
      expect(decision.adjustedScore).toBeLessThan(0.92);
      expect(decision.reason).toContain('below threshold');
    });
  });

  describe('shouldInject - RESEARCH tasks', () => {
    it('should accept lower similarity for RESEARCH tasks', () => {
      const episode: IStoredEpisode = {
        episodeId: 'test-1',
        queryText: 'test',
        answerText: 'test',
        queryChunkEmbeddings: [],
        answerChunkEmbeddings: [],
        queryChunkCount: 0,
        answerChunkCount: 0,
        createdAt: new Date(),
        metadata: { contentType: 'prose' }
      };

      const taskContext: ITaskContext = {
        agentId: 'phd-researcher',
        task: 'Literature review'
      };

      // 85% similarity - above 80% threshold for RESEARCH
      const decision = filter.shouldInject(episode, 0.85, taskContext);
      expect(decision.inject).toBe(true);
      expect(decision.category).toBe(WC.RESEARCH);
    });

    it('should tolerate older research episodes', () => {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const episode: IStoredEpisode = {
        episodeId: 'test-1',
        queryText: 'test',
        answerText: 'test',
        queryChunkEmbeddings: [],
        answerChunkEmbeddings: [],
        queryChunkCount: 0,
        answerChunkCount: 0,
        createdAt: ninetyDaysAgo, // 90 days = half-life for research
        metadata: { contentType: 'prose' }
      };

      const taskContext: ITaskContext = {
        agentId: 'phd-researcher',
        task: 'Literature review'
      };

      // 90% similarity * 0.5 decay = 0.45 adjusted score (below 0.80 threshold)
      const decision = filter.shouldInject(episode, 0.90, taskContext);
      expect(decision.inject).toBe(false);
      expect(decision.adjustedScore).toBeCloseTo(0.45, 2);
    });
  });

  describe('shouldInject - GENERAL tasks', () => {
    it('should use medium threshold for GENERAL tasks', () => {
      const episode: IStoredEpisode = {
        episodeId: 'test-1',
        queryText: 'test',
        answerText: 'test',
        queryChunkEmbeddings: [],
        answerChunkEmbeddings: [],
        queryChunkCount: 0,
        answerChunkCount: 0,
        createdAt: new Date(),
        metadata: {}
      };

      const taskContext: ITaskContext = {
        task: 'General task'
      };

      // 87% similarity - above 85% threshold
      const decision = filter.shouldInject(episode, 0.87, taskContext);
      expect(decision.inject).toBe(true);
      expect(decision.category).toBe(WC.GENERAL);
    });
  });
});
