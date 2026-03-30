/**
 * IDESC-001 Sprint 5 - Trajectory Linker Tests
 * TASK-IDESC-RB-004: Unit Tests for ReasoningBank Integration
 *
 * Tests for:
 * - TrajectoryLinker.linkEpisodeToTrajectory - Links episodes to trajectories
 * - TrajectoryLinker.getTrajectoryForEpisode - Retrieves trajectory ID
 * - TrajectoryLinker.getEpisodesForTrajectory - Queries episodes by trajectory
 * - TrajectoryLinker.unlinkEpisode - Removes trajectory links
 * - TrajectoryLinker.getTrajectoryLink - Retrieves full link information
 * - TrajectoryLinker.updateReasoningTrace - Updates reasoning traces
 *
 * Implements: REQ-IDESC-007 (trajectory linking)
 * Constitution: GUARD-IDESC-005 (graceful degradation)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TrajectoryLinker,
  createTrajectoryLinker,
  type ITrajectoryLinker
} from '../../../../../src/god-agent/core/ucm/desc/trajectory-linker.js';
import type { IDatabaseConnection } from '../../../../../src/god-agent/core/ucm/desc/outcome-tracker.js';
import type { ITrajectoryLink } from '../../../../../src/god-agent/core/ucm/types.js';
import {
  TrajectoryLinkError,
  TrajectoryNotFoundError,
  EpisodeNotFoundError
} from '../../../../../src/god-agent/core/ucm/desc/errors.js';

// ============================================================================
// Mock Database
// ============================================================================

interface MockEpisode {
  episode_id: string;
  trajectory_id: string | null;
  reasoning_trace: string | null;
  trajectory_linked_at: string | null;
}

function createMockDb() {
  const episodes = new Map<string, MockEpisode>();

  const mockDb = {
    async run(sql: string, params: unknown[] = []) {
      // Normalize SQL for matching (remove extra whitespace)
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();

      // Handle UPDATE operations for unlinking (check this first - most specific)
      if (normalizedSql.includes('trajectory_id = NULL') && normalizedSql.includes('reasoning_trace = NULL')) {
        const episodeId = params[0] as string;
        const episode = episodes.get(episodeId);
        if (episode) {
          episode.trajectory_id = null;
          episode.reasoning_trace = null;
          episode.trajectory_linked_at = null;
          return { lastInsertRowid: 1 };
        }
        return { lastInsertRowid: 0 };
      }

      // Handle UPDATE operations for reasoning trace only (not trajectory_id)
      if (normalizedSql.includes('UPDATE episodes SET reasoning_trace') && !normalizedSql.includes('trajectory_id')) {
        const [reasoningTrace, episodeId] = params as [string, string];
        const episode = episodes.get(episodeId);
        if (episode) {
          episode.reasoning_trace = reasoningTrace;
          return { lastInsertRowid: 1 };
        }
        return { lastInsertRowid: 0 };
      }

      // Handle UPDATE operations for linking (has both trajectory_id and reasoning_trace)
      if (normalizedSql.includes('UPDATE episodes SET trajectory_id') && normalizedSql.includes('reasoning_trace') && normalizedSql.includes('trajectory_linked_at')) {
        const [trajectoryId, reasoningTrace, linkedAt, episodeId] = params as [string, string | null, string, string];
        const episode = episodes.get(episodeId);
        if (episode) {
          episode.trajectory_id = trajectoryId;
          episode.reasoning_trace = reasoningTrace;
          episode.trajectory_linked_at = linkedAt;
          return { lastInsertRowid: 1 };
        }
        return { lastInsertRowid: 0 };
      }

      return { lastInsertRowid: 0 };
    },

    async get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
      const episodeId = params[0] as string;
      const episode = episodes.get(episodeId);

      // Handle existence check
      if (sql.includes('SELECT episode_id FROM episodes WHERE episode_id')) {
        return (episode ? { episode_id: episode.episode_id } : undefined) as T | undefined;
      }

      // Handle trajectory ID retrieval
      if (sql.includes('SELECT trajectory_id FROM episodes') && !sql.includes('reasoning_trace')) {
        return (episode ? { trajectory_id: episode.trajectory_id } : undefined) as T | undefined;
      }

      // Handle full link retrieval
      if (sql.includes('SELECT episode_id, trajectory_id, reasoning_trace, trajectory_linked_at')) {
        return (episode ? {
          episode_id: episode.episode_id,
          trajectory_id: episode.trajectory_id,
          reasoning_trace: episode.reasoning_trace,
          trajectory_linked_at: episode.trajectory_linked_at
        } : undefined) as T | undefined;
      }

      return undefined;
    },

    async all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
      if (sql.includes('SELECT episode_id FROM episodes WHERE trajectory_id')) {
        const trajectoryId = params[0] as string;
        return Array.from(episodes.values())
          .filter(e => e.trajectory_id === trajectoryId)
          .map(e => ({ episode_id: e.episode_id })) as T[];
      }
      return [];
    },

    // Helper method for test setup
    addEpisode: (episodeId: string) => {
      episodes.set(episodeId, {
        episode_id: episodeId,
        trajectory_id: null,
        reasoning_trace: null,
        trajectory_linked_at: null
      });
    },

    // Helper method to get episode for verification
    getEpisode: (episodeId: string) => {
      return episodes.get(episodeId);
    },

    // Helper method to clear all episodes
    clear: () => {
      episodes.clear();
    }
  };

  return mockDb;
}

// ============================================================================
// Test Suite
// ============================================================================

describe('TrajectoryLinker', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let linker: ITrajectoryLinker;

  beforeEach(() => {
    mockDb = createMockDb();
    linker = new TrajectoryLinker(mockDb as unknown as IDatabaseConnection);
  });

  // ==========================================================================
  // Constructor Tests
  // ==========================================================================

  describe('constructor', () => {
    it('should create instance with database connection', () => {
      const instance = new TrajectoryLinker(mockDb as unknown as IDatabaseConnection);
      expect(instance).toBeInstanceOf(TrajectoryLinker);
    });

    it('should implement ITrajectoryLinker interface', () => {
      expect(linker).toHaveProperty('linkEpisodeToTrajectory');
      expect(linker).toHaveProperty('getTrajectoryForEpisode');
      expect(linker).toHaveProperty('getEpisodesForTrajectory');
      expect(linker).toHaveProperty('unlinkEpisode');
      expect(linker).toHaveProperty('getTrajectoryLink');
      expect(linker).toHaveProperty('updateReasoningTrace');
    });
  });

  describe('createTrajectoryLinker factory', () => {
    it('should create TrajectoryLinker instance', () => {
      const instance = createTrajectoryLinker(mockDb as unknown as IDatabaseConnection);
      expect(instance).toBeInstanceOf(TrajectoryLinker);
    });

    it('should work correctly when used', async () => {
      const instance = createTrajectoryLinker(mockDb as unknown as IDatabaseConnection);
      mockDb.addEpisode('test-episode');

      await instance.linkEpisodeToTrajectory('test-episode', 'test-trajectory');
      const result = await instance.getTrajectoryForEpisode('test-episode');

      expect(result).toBe('test-trajectory');
    });
  });

  // ==========================================================================
  // linkEpisodeToTrajectory Tests
  // ==========================================================================

  describe('linkEpisodeToTrajectory', () => {
    it('should successfully link episode to trajectory', async () => {
      mockDb.addEpisode('episode-1');

      await linker.linkEpisodeToTrajectory('episode-1', 'trajectory-1');

      const episode = mockDb.getEpisode('episode-1');
      expect(episode?.trajectory_id).toBe('trajectory-1');
      expect(episode?.trajectory_linked_at).toBeTruthy();
    });

    it('should link with optional reasoning trace', async () => {
      mockDb.addEpisode('episode-2');
      const reasoningTrace = 'Decided: Use Redis for caching.';

      await linker.linkEpisodeToTrajectory('episode-2', 'trajectory-2', reasoningTrace);

      const episode = mockDb.getEpisode('episode-2');
      expect(episode?.trajectory_id).toBe('trajectory-2');
      expect(episode?.reasoning_trace).toBe(reasoningTrace);
    });

    it('should link without reasoning trace (null)', async () => {
      mockDb.addEpisode('episode-3');

      await linker.linkEpisodeToTrajectory('episode-3', 'trajectory-3');

      const episode = mockDb.getEpisode('episode-3');
      expect(episode?.trajectory_id).toBe('trajectory-3');
      expect(episode?.reasoning_trace).toBeNull();
    });

    it('should throw EpisodeNotFoundError when episode does not exist', async () => {
      await expect(
        linker.linkEpisodeToTrajectory('non-existent', 'trajectory-1')
      ).rejects.toThrow(EpisodeNotFoundError);

      await expect(
        linker.linkEpisodeToTrajectory('non-existent', 'trajectory-1')
      ).rejects.toThrow('Episode not found: non-existent');
    });

    it('should throw TrajectoryLinkError on database failure', async () => {
      mockDb.addEpisode('episode-4');

      // Temporarily replace run method to throw error
      const originalRun = mockDb.run;
      mockDb.run = vi.fn().mockRejectedValue(new Error('Database connection lost'));

      await expect(
        linker.linkEpisodeToTrajectory('episode-4', 'trajectory-4')
      ).rejects.toThrow(TrajectoryLinkError);

      await expect(
        linker.linkEpisodeToTrajectory('episode-4', 'trajectory-4')
      ).rejects.toThrow('Failed to link trajectory');

      // Restore original
      mockDb.run = originalRun;
    });

    it('should update existing link when called again (re-link)', async () => {
      mockDb.addEpisode('episode-5');

      // First link
      await linker.linkEpisodeToTrajectory('episode-5', 'trajectory-5a');
      expect(mockDb.getEpisode('episode-5')?.trajectory_id).toBe('trajectory-5a');

      // Re-link to different trajectory
      await linker.linkEpisodeToTrajectory('episode-5', 'trajectory-5b', 'Updated trace');
      const episode = mockDb.getEpisode('episode-5');

      expect(episode?.trajectory_id).toBe('trajectory-5b');
      expect(episode?.reasoning_trace).toBe('Updated trace');
    });

    it('should set trajectory_linked_at timestamp', async () => {
      mockDb.addEpisode('episode-6');
      const beforeLink = new Date();

      await linker.linkEpisodeToTrajectory('episode-6', 'trajectory-6');

      const episode = mockDb.getEpisode('episode-6');
      expect(episode?.trajectory_linked_at).toBeTruthy();

      const linkedAt = new Date(episode!.trajectory_linked_at!);
      expect(linkedAt.getTime()).toBeGreaterThanOrEqual(beforeLink.getTime());
      expect(linkedAt.getTime()).toBeLessThanOrEqual(new Date().getTime());
    });

    it('should handle empty reasoning trace string', async () => {
      mockDb.addEpisode('episode-7');

      await linker.linkEpisodeToTrajectory('episode-7', 'trajectory-7', '');

      const episode = mockDb.getEpisode('episode-7');
      expect(episode?.trajectory_id).toBe('trajectory-7');
      expect(episode?.reasoning_trace).toBe(null); // Empty string should become null
    });
  });

  // ==========================================================================
  // getTrajectoryForEpisode Tests
  // ==========================================================================

  describe('getTrajectoryForEpisode', () => {
    it('should return trajectory ID when episode is linked', async () => {
      mockDb.addEpisode('episode-1');
      await linker.linkEpisodeToTrajectory('episode-1', 'trajectory-1');

      const result = await linker.getTrajectoryForEpisode('episode-1');

      expect(result).toBe('trajectory-1');
    });

    it('should return null when episode is not linked', async () => {
      mockDb.addEpisode('episode-2');

      const result = await linker.getTrajectoryForEpisode('episode-2');

      expect(result).toBeNull();
    });

    it('should return null for non-existent episode', async () => {
      const result = await linker.getTrajectoryForEpisode('non-existent');

      expect(result).toBeNull();
    });

    it('should handle episodes unlinked after linking', async () => {
      mockDb.addEpisode('episode-3');
      await linker.linkEpisodeToTrajectory('episode-3', 'trajectory-3');
      await linker.unlinkEpisode('episode-3');

      const result = await linker.getTrajectoryForEpisode('episode-3');

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // getEpisodesForTrajectory Tests
  // ==========================================================================

  describe('getEpisodesForTrajectory', () => {
    it('should return array of episode IDs for trajectory', async () => {
      mockDb.addEpisode('episode-1');
      mockDb.addEpisode('episode-2');
      mockDb.addEpisode('episode-3');

      await linker.linkEpisodeToTrajectory('episode-1', 'trajectory-1');
      await linker.linkEpisodeToTrajectory('episode-2', 'trajectory-1');
      await linker.linkEpisodeToTrajectory('episode-3', 'trajectory-1');

      const result = await linker.getEpisodesForTrajectory('trajectory-1');

      expect(result).toHaveLength(3);
      expect(result).toContain('episode-1');
      expect(result).toContain('episode-2');
      expect(result).toContain('episode-3');
    });

    it('should return empty array for trajectory with no episodes', async () => {
      const result = await linker.getEpisodesForTrajectory('trajectory-empty');

      expect(result).toEqual([]);
    });

    it('should return empty array for non-existent trajectory', async () => {
      const result = await linker.getEpisodesForTrajectory('non-existent');

      expect(result).toEqual([]);
    });

    it('should only return episodes for specified trajectory', async () => {
      mockDb.addEpisode('episode-1');
      mockDb.addEpisode('episode-2');
      mockDb.addEpisode('episode-3');

      await linker.linkEpisodeToTrajectory('episode-1', 'trajectory-1');
      await linker.linkEpisodeToTrajectory('episode-2', 'trajectory-2');
      await linker.linkEpisodeToTrajectory('episode-3', 'trajectory-1');

      const result = await linker.getEpisodesForTrajectory('trajectory-1');

      expect(result).toHaveLength(2);
      expect(result).toContain('episode-1');
      expect(result).toContain('episode-3');
      expect(result).not.toContain('episode-2');
    });

    it('should handle large result sets', async () => {
      // Add 100 episodes
      for (let i = 0; i < 100; i++) {
        mockDb.addEpisode(`episode-${i}`);
        await linker.linkEpisodeToTrajectory(`episode-${i}`, 'trajectory-many');
      }

      const result = await linker.getEpisodesForTrajectory('trajectory-many');

      expect(result).toHaveLength(100);
    });

    it('should not include unlinked episodes', async () => {
      mockDb.addEpisode('episode-1');
      mockDb.addEpisode('episode-2');
      mockDb.addEpisode('episode-3');

      await linker.linkEpisodeToTrajectory('episode-1', 'trajectory-1');
      await linker.linkEpisodeToTrajectory('episode-2', 'trajectory-1');
      await linker.linkEpisodeToTrajectory('episode-3', 'trajectory-1');
      await linker.unlinkEpisode('episode-2');

      const result = await linker.getEpisodesForTrajectory('trajectory-1');

      expect(result).toHaveLength(2);
      expect(result).toContain('episode-1');
      expect(result).toContain('episode-3');
      expect(result).not.toContain('episode-2');
    });
  });

  // ==========================================================================
  // unlinkEpisode Tests
  // ==========================================================================

  describe('unlinkEpisode', () => {
    it('should successfully remove trajectory link', async () => {
      mockDb.addEpisode('episode-1');
      await linker.linkEpisodeToTrajectory('episode-1', 'trajectory-1', 'Some trace');

      await linker.unlinkEpisode('episode-1');

      const episode = mockDb.getEpisode('episode-1');
      expect(episode?.trajectory_id).toBeNull();
      expect(episode?.reasoning_trace).toBeNull();
      expect(episode?.trajectory_linked_at).toBeNull();
    });

    it('should throw EpisodeNotFoundError for non-existent episode', async () => {
      await expect(
        linker.unlinkEpisode('non-existent')
      ).rejects.toThrow(EpisodeNotFoundError);

      await expect(
        linker.unlinkEpisode('non-existent')
      ).rejects.toThrow('Episode not found: non-existent');
    });

    it('should be no-op for already unlinked episode', async () => {
      mockDb.addEpisode('episode-2');

      // Should not throw
      await expect(linker.unlinkEpisode('episode-2')).resolves.not.toThrow();

      const episode = mockDb.getEpisode('episode-2');
      expect(episode?.trajectory_id).toBeNull();
    });

    it('should verify link is removed', async () => {
      mockDb.addEpisode('episode-3');
      await linker.linkEpisodeToTrajectory('episode-3', 'trajectory-3');

      // Verify link exists
      expect(await linker.getTrajectoryForEpisode('episode-3')).toBe('trajectory-3');

      // Unlink
      await linker.unlinkEpisode('episode-3');

      // Verify link is removed
      expect(await linker.getTrajectoryForEpisode('episode-3')).toBeNull();
    });

    it('should throw TrajectoryLinkError on database failure', async () => {
      mockDb.addEpisode('episode-4');

      // Temporarily replace run method to throw error
      const originalRun = mockDb.run;
      mockDb.run = vi.fn().mockRejectedValue(new Error('Database error'));

      await expect(
        linker.unlinkEpisode('episode-4')
      ).rejects.toThrow(TrajectoryLinkError);

      await expect(
        linker.unlinkEpisode('episode-4')
      ).rejects.toThrow('Failed to unlink episode');

      // Restore original
      mockDb.run = originalRun;
    });

    it('should clear reasoning trace when unlinking', async () => {
      mockDb.addEpisode('episode-5');
      const trace = 'Decided: Use approach A.';
      await linker.linkEpisodeToTrajectory('episode-5', 'trajectory-5', trace);

      expect(mockDb.getEpisode('episode-5')?.reasoning_trace).toBe(trace);

      await linker.unlinkEpisode('episode-5');

      expect(mockDb.getEpisode('episode-5')?.reasoning_trace).toBeNull();
    });
  });

  // ==========================================================================
  // getTrajectoryLink Tests
  // ==========================================================================

  describe('getTrajectoryLink', () => {
    it('should return full ITrajectoryLink object when linked', async () => {
      mockDb.addEpisode('episode-1');
      const trace = 'Decided: Use Redis.';
      await linker.linkEpisodeToTrajectory('episode-1', 'trajectory-1', trace);

      const result = await linker.getTrajectoryLink('episode-1');

      expect(result).not.toBeNull();
      expect(result?.episodeId).toBe('episode-1');
      expect(result?.trajectoryId).toBe('trajectory-1');
      expect(result?.reasoningTrace).toBe(trace);
      expect(result?.linkedAt).toBeInstanceOf(Date);
    });

    it('should return null when episode is not linked', async () => {
      mockDb.addEpisode('episode-2');

      const result = await linker.getTrajectoryLink('episode-2');

      expect(result).toBeNull();
    });

    it('should return null for non-existent episode', async () => {
      const result = await linker.getTrajectoryLink('non-existent');

      expect(result).toBeNull();
    });

    it('should include empty reasoning trace as empty string', async () => {
      mockDb.addEpisode('episode-3');
      await linker.linkEpisodeToTrajectory('episode-3', 'trajectory-3');

      const result = await linker.getTrajectoryLink('episode-3');

      expect(result).not.toBeNull();
      expect(result?.reasoningTrace).toBe('');
    });

    it('should parse linkedAt timestamp correctly', async () => {
      mockDb.addEpisode('episode-4');
      const beforeLink = new Date();
      await linker.linkEpisodeToTrajectory('episode-4', 'trajectory-4');

      const result = await linker.getTrajectoryLink('episode-4');

      expect(result?.linkedAt).toBeInstanceOf(Date);
      expect(result?.linkedAt.getTime()).toBeGreaterThanOrEqual(beforeLink.getTime());
      expect(result?.linkedAt.getTime()).toBeLessThanOrEqual(new Date().getTime());
    });

    it('should return complete link after update', async () => {
      mockDb.addEpisode('episode-5');
      await linker.linkEpisodeToTrajectory('episode-5', 'trajectory-5a', 'Initial trace');
      await linker.linkEpisodeToTrajectory('episode-5', 'trajectory-5b', 'Updated trace');

      const result = await linker.getTrajectoryLink('episode-5');

      expect(result?.trajectoryId).toBe('trajectory-5b');
      expect(result?.reasoningTrace).toBe('Updated trace');
    });
  });

  // ==========================================================================
  // updateReasoningTrace Tests
  // ==========================================================================

  describe('updateReasoningTrace', () => {
    it('should update trace for existing link', async () => {
      mockDb.addEpisode('episode-1');
      await linker.linkEpisodeToTrajectory('episode-1', 'trajectory-1', 'Initial trace');

      await linker.updateReasoningTrace('episode-1', 'Updated trace');

      const episode = mockDb.getEpisode('episode-1');
      expect(episode?.reasoning_trace).toBe('Updated trace');
      expect(episode?.trajectory_id).toBe('trajectory-1'); // Should not change
    });

    it('should throw TrajectoryNotFoundError if episode is not linked', async () => {
      mockDb.addEpisode('episode-2');

      await expect(
        linker.updateReasoningTrace('episode-2', 'Some trace')
      ).rejects.toThrow(TrajectoryNotFoundError);

      await expect(
        linker.updateReasoningTrace('episode-2', 'Some trace')
      ).rejects.toThrow('Episode episode-2 is not linked to any trajectory');
    });

    it('should throw TrajectoryNotFoundError for non-existent episode', async () => {
      await expect(
        linker.updateReasoningTrace('non-existent', 'Some trace')
      ).rejects.toThrow(TrajectoryNotFoundError);
    });

    it('should handle empty trace update', async () => {
      mockDb.addEpisode('episode-3');
      await linker.linkEpisodeToTrajectory('episode-3', 'trajectory-3', 'Initial');

      await linker.updateReasoningTrace('episode-3', '');

      const episode = mockDb.getEpisode('episode-3');
      expect(episode?.reasoning_trace).toBe('');
    });

    it('should handle large trace update', async () => {
      mockDb.addEpisode('episode-4');
      await linker.linkEpisodeToTrajectory('episode-4', 'trajectory-4', 'Initial');

      const largeTrace = 'Reasoning: '.repeat(1000);
      await linker.updateReasoningTrace('episode-4', largeTrace);

      const episode = mockDb.getEpisode('episode-4');
      expect(episode?.reasoning_trace).toBe(largeTrace);
    });

    it('should throw TrajectoryLinkError on database failure', async () => {
      mockDb.addEpisode('episode-5');
      await linker.linkEpisodeToTrajectory('episode-5', 'trajectory-5');

      // Temporarily replace run method to throw error
      const originalRun = mockDb.run;
      mockDb.run = vi.fn().mockRejectedValue(new Error('Database error'));

      await expect(
        linker.updateReasoningTrace('episode-5', 'New trace')
      ).rejects.toThrow(TrajectoryLinkError);

      // Restore original
      mockDb.run = originalRun;
    });

    it('should allow multiple trace updates', async () => {
      mockDb.addEpisode('episode-6');
      await linker.linkEpisodeToTrajectory('episode-6', 'trajectory-6', 'Trace 1');

      await linker.updateReasoningTrace('episode-6', 'Trace 2');
      expect(mockDb.getEpisode('episode-6')?.reasoning_trace).toBe('Trace 2');

      await linker.updateReasoningTrace('episode-6', 'Trace 3');
      expect(mockDb.getEpisode('episode-6')?.reasoning_trace).toBe('Trace 3');
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('error handling', () => {
    it('should preserve error stack traces', async () => {
      mockDb.addEpisode('episode-1');
      const dbError = new Error('Database connection lost');

      const originalRun = mockDb.run;
      mockDb.run = vi.fn().mockRejectedValue(dbError);

      try {
        await linker.linkEpisodeToTrajectory('episode-1', 'trajectory-1');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TrajectoryLinkError);
        expect((error as TrajectoryLinkError).message).toContain('Database connection lost');
      }

      mockDb.run = originalRun;
    });

    it('should include trajectory ID in TrajectoryLinkError', async () => {
      mockDb.addEpisode('episode-2');

      const originalRun = mockDb.run;
      mockDb.run = vi.fn().mockRejectedValue(new Error('Test error'));

      try {
        await linker.linkEpisodeToTrajectory('episode-2', 'trajectory-xyz');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TrajectoryLinkError);
        expect((error as TrajectoryLinkError).trajectoryId).toBe('trajectory-xyz');
      }

      mockDb.run = originalRun;
    });

    it('should handle database returning undefined gracefully', async () => {
      // Test with episode that doesn't exist
      const result = await linker.getTrajectoryForEpisode('any-episode');

      expect(result).toBeNull();
    });

    it('should handle database returning empty array gracefully', async () => {
      // Test with trajectory that has no episodes
      const result = await linker.getEpisodesForTrajectory('any-trajectory');

      expect(result).toEqual([]);
    });

    it('should not throw on double unlink', async () => {
      mockDb.addEpisode('episode-3');
      await linker.linkEpisodeToTrajectory('episode-3', 'trajectory-3');

      await linker.unlinkEpisode('episode-3');
      await expect(linker.unlinkEpisode('episode-3')).resolves.not.toThrow();
    });
  });

  // ==========================================================================
  // Integration Tests
  // ==========================================================================

  describe('integration scenarios', () => {
    it('should handle complete link-update-unlink workflow', async () => {
      mockDb.addEpisode('episode-1');

      // Link
      await linker.linkEpisodeToTrajectory('episode-1', 'trajectory-1', 'Initial trace');
      expect(await linker.getTrajectoryForEpisode('episode-1')).toBe('trajectory-1');

      // Update trace
      await linker.updateReasoningTrace('episode-1', 'Updated trace');
      const link = await linker.getTrajectoryLink('episode-1');
      expect(link?.reasoningTrace).toBe('Updated trace');

      // Unlink
      await linker.unlinkEpisode('episode-1');
      expect(await linker.getTrajectoryForEpisode('episode-1')).toBeNull();
    });

    it('should handle multiple episodes to one trajectory', async () => {
      mockDb.addEpisode('episode-1');
      mockDb.addEpisode('episode-2');
      mockDb.addEpisode('episode-3');

      await linker.linkEpisodeToTrajectory('episode-1', 'shared-trajectory', 'Trace 1');
      await linker.linkEpisodeToTrajectory('episode-2', 'shared-trajectory', 'Trace 2');
      await linker.linkEpisodeToTrajectory('episode-3', 'shared-trajectory', 'Trace 3');

      const episodes = await linker.getEpisodesForTrajectory('shared-trajectory');
      expect(episodes).toHaveLength(3);

      // Unlink one
      await linker.unlinkEpisode('episode-2');

      const remainingEpisodes = await linker.getEpisodesForTrajectory('shared-trajectory');
      expect(remainingEpisodes).toHaveLength(2);
      expect(remainingEpisodes).not.toContain('episode-2');
    });

    it('should handle episode re-linking to different trajectories', async () => {
      mockDb.addEpisode('episode-1');

      // Link to first trajectory
      await linker.linkEpisodeToTrajectory('episode-1', 'trajectory-1');
      expect(await linker.getTrajectoryForEpisode('episode-1')).toBe('trajectory-1');

      // Re-link to second trajectory
      await linker.linkEpisodeToTrajectory('episode-1', 'trajectory-2');
      expect(await linker.getTrajectoryForEpisode('episode-1')).toBe('trajectory-2');

      // First trajectory should not have this episode
      const episodes1 = await linker.getEpisodesForTrajectory('trajectory-1');
      expect(episodes1).not.toContain('episode-1');

      // Second trajectory should have this episode
      const episodes2 = await linker.getEpisodesForTrajectory('trajectory-2');
      expect(episodes2).toContain('episode-1');
    });

    it('should handle concurrent operations correctly', async () => {
      mockDb.addEpisode('episode-1');
      mockDb.addEpisode('episode-2');
      mockDb.addEpisode('episode-3');

      // Perform multiple operations concurrently
      await Promise.all([
        linker.linkEpisodeToTrajectory('episode-1', 'trajectory-1', 'Trace 1'),
        linker.linkEpisodeToTrajectory('episode-2', 'trajectory-1', 'Trace 2'),
        linker.linkEpisodeToTrajectory('episode-3', 'trajectory-2', 'Trace 3')
      ]);

      const episodes1 = await linker.getEpisodesForTrajectory('trajectory-1');
      const episodes2 = await linker.getEpisodesForTrajectory('trajectory-2');

      expect(episodes1).toHaveLength(2);
      expect(episodes2).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Performance Tests
  // ==========================================================================

  describe('performance', () => {
    it('should handle rapid link operations', async () => {
      const episodeCount = 50;
      for (let i = 0; i < episodeCount; i++) {
        mockDb.addEpisode(`episode-${i}`);
      }

      const start = Date.now();

      for (let i = 0; i < episodeCount; i++) {
        await linker.linkEpisodeToTrajectory(`episode-${i}`, 'trajectory-1');
      }

      const duration = Date.now() - start;

      // Should complete in reasonable time (< 1 second for 50 episodes)
      expect(duration).toBeLessThan(1000);
    });

    it('should handle bulk retrieval efficiently', async () => {
      const episodeCount = 100;
      for (let i = 0; i < episodeCount; i++) {
        mockDb.addEpisode(`episode-${i}`);
        await linker.linkEpisodeToTrajectory(`episode-${i}`, 'bulk-trajectory');
      }

      const start = Date.now();
      const episodes = await linker.getEpisodesForTrajectory('bulk-trajectory');
      const duration = Date.now() - start;

      expect(episodes).toHaveLength(episodeCount);
      expect(duration).toBeLessThan(100); // Should be fast
    });
  });
});
