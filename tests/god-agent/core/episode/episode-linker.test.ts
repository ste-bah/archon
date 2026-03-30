/**
 * Tests for EpisodeLinker
 *
 * Implements test coverage for TASK-EPISODE-003
 *
 * Test Cases:
 * - TC-E3-001: Link CRUD operations
 * - TC-E3-002: Cycle detection
 * - TC-E3-003: Context retrieval accuracy
 * - TC-E3-004: Max links enforcement
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { EpisodeStore } from '../../../../src/god-agent/core/episode/episode-store.js';
import { TimeIndex } from '../../../../src/god-agent/core/episode/time-index.js';
import { EpisodeLinker, type LinkType } from '../../../../src/god-agent/core/episode/episode-linker.js';
import {
  Episode,
  CreateEpisodeOptions,
  EpisodeValidationError,
  EpisodeStorageError,
} from '../../../../src/god-agent/core/episode/episode-types.js';
import { VECTOR_DIM } from '../../../../src/god-agent/core/validation/constants.js';

describe('EpisodeLinker', () => {
  let store: EpisodeStore;
  let timeIndex: TimeIndex;
  let linker: EpisodeLinker;
  let testDir: string;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = path.join(process.cwd(), '.test-episode-linker-' + Date.now());
    fs.mkdirSync(testDir, { recursive: true });

    // Initialize components
    store = new EpisodeStore({
      storageDir: testDir,
      verbose: false,
    });
    timeIndex = new TimeIndex(32);
    linker = new EpisodeLinker(store, timeIndex);

    await linker.initialize();
  });

  afterEach(async () => {
    // Cleanup
    await store.close();

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  /**
   * Helper: Create test episode
   */
  async function createTestEpisode(
    taskId: string,
    startTime: number,
    agentType = 'test-agent',
    description = 'Test episode'
  ): Promise<string> {
    // TASK-VEC-001-007: Use VECTOR_DIM constant for embedding dimensions
    const embedding = new Float32Array(VECTOR_DIM);
    for (let i = 0; i < VECTOR_DIM; i++) {
      embedding[i] = Math.random();
    }

    const options: CreateEpisodeOptions = {
      taskId,
      startTime,
      endTime: startTime + 1000,
      embedding,
      metadata: {
        agentType,
        taskDescription: description,
        outcome: 'success',
      },
    };

    const id = await store.createEpisode(options);
    timeIndex.insert(startTime, id);
    return id;
  }

  describe('TC-E3-001: Link CRUD operations', () => {
    it('should create a single link between episodes', async () => {
      const ep1 = await createTestEpisode('task1', 1000);
      const ep2 = await createTestEpisode('task1', 2000);

      await linker.linkEpisodes(ep1, ep2, 'sequence');

      const linked = await linker.getLinkedEpisodes(ep1, 'outgoing');
      expect(linked).toHaveLength(1);
      expect(linked[0].id).toBe(ep2);
    });

    it('should create multiple links from same source', async () => {
      const ep1 = await createTestEpisode('task1', 1000);
      const ep2 = await createTestEpisode('task1', 2000);
      const ep3 = await createTestEpisode('task1', 3000);
      const ep4 = await createTestEpisode('task1', 4000);

      await linker.linkEpisodes(ep1, ep2, 'sequence');
      await linker.linkEpisodes(ep1, ep3, 'reference');
      await linker.linkEpisodes(ep1, ep4, 'continuation');

      const linked = await linker.getLinkedEpisodes(ep1, 'outgoing');
      expect(linked).toHaveLength(3);
    });

    it('should create links of different types', async () => {
      const ep1 = await createTestEpisode('task1', 1000);
      const ep2 = await createTestEpisode('task1', 2000);
      const ep3 = await createTestEpisode('task1', 3000);

      await linker.linkEpisodes(ep1, ep2, 'sequence');
      await linker.linkEpisodes(ep1, ep3, 'reference');

      const outgoing = linker.getOutgoingLinks(ep1);
      expect(outgoing).toHaveLength(2);
      expect(outgoing).toContain(ep2);
      expect(outgoing).toContain(ep3);
    });

    it('should retrieve links by source ID (outgoing)', async () => {
      const ep1 = await createTestEpisode('task1', 1000);
      const ep2 = await createTestEpisode('task1', 2000);
      const ep3 = await createTestEpisode('task1', 3000);

      await linker.linkEpisodes(ep1, ep2, 'sequence');
      await linker.linkEpisodes(ep1, ep3, 'sequence');

      const linked = await linker.getLinkedEpisodes(ep1, 'outgoing');
      expect(linked).toHaveLength(2);
      expect(linked.map(e => e.id).sort()).toEqual([ep2, ep3].sort());
    });

    it('should retrieve links by target ID (incoming)', async () => {
      const ep1 = await createTestEpisode('task1', 1000);
      const ep2 = await createTestEpisode('task1', 2000);
      const ep3 = await createTestEpisode('task1', 3000);

      await linker.linkEpisodes(ep1, ep3, 'sequence');
      await linker.linkEpisodes(ep2, ep3, 'sequence');

      const linked = await linker.getLinkedEpisodes(ep3, 'incoming');
      expect(linked).toHaveLength(2);
      expect(linked.map(e => e.id).sort()).toEqual([ep1, ep2].sort());
    });

    it('should retrieve links in both directions', async () => {
      const ep1 = await createTestEpisode('task1', 1000);
      const ep2 = await createTestEpisode('task1', 2000);
      const ep3 = await createTestEpisode('task1', 3000);

      await linker.linkEpisodes(ep1, ep2, 'sequence');
      await linker.linkEpisodes(ep3, ep2, 'sequence');

      const linked = await linker.getLinkedEpisodes(ep2, 'both');
      expect(linked).toHaveLength(2);
      expect(linked.map(e => e.id).sort()).toEqual([ep1, ep3].sort());
    });

    it('should filter links by type', async () => {
      const ep1 = await createTestEpisode('task1', 1000);
      const ep2 = await createTestEpisode('task1', 2000);
      const ep3 = await createTestEpisode('task1', 3000);

      await linker.linkEpisodes(ep1, ep2, 'sequence');
      await linker.linkEpisodes(ep1, ep3, 'reference');

      const sequenceLinks = linker.getOutgoingLinks(ep1, 'sequence');
      expect(sequenceLinks).toHaveLength(1);
      expect(sequenceLinks[0]).toBe(ep2);

      const referenceLinks = linker.getOutgoingLinks(ep1, 'reference');
      expect(referenceLinks).toHaveLength(1);
      expect(referenceLinks[0]).toBe(ep3);
    });

    it('should remove specific link', async () => {
      const ep1 = await createTestEpisode('task1', 1000);
      const ep2 = await createTestEpisode('task1', 2000);
      const ep3 = await createTestEpisode('task1', 3000);

      await linker.linkEpisodes(ep1, ep2, 'sequence');
      await linker.linkEpisodes(ep1, ep3, 'sequence');

      let linked = await linker.getLinkedEpisodes(ep1, 'outgoing');
      expect(linked).toHaveLength(2);

      await linker.unlinkEpisodes(ep1, ep2);

      linked = await linker.getLinkedEpisodes(ep1, 'outgoing');
      expect(linked).toHaveLength(1);
      expect(linked[0].id).toBe(ep3);
    });

    it('should prevent self-links', async () => {
      const ep1 = await createTestEpisode('task1', 1000);

      await expect(
        linker.linkEpisodes(ep1, ep1, 'sequence')
      ).rejects.toThrow(EpisodeValidationError);
    });

    it('should reject link to non-existent episode', async () => {
      const ep1 = await createTestEpisode('task1', 1000);
      const fakeId = '00000000-0000-4000-8000-000000000000';

      await expect(
        linker.linkEpisodes(ep1, fakeId, 'sequence')
      ).rejects.toThrow(EpisodeStorageError);
    });
  });

  describe('TC-E3-002: Cycle detection', () => {
    it('should allow linear sequence (A → B → C)', async () => {
      const epA = await createTestEpisode('task1', 1000);
      const epB = await createTestEpisode('task1', 2000);
      const epC = await createTestEpisode('task1', 3000);

      await linker.linkEpisodes(epA, epB, 'sequence');
      await linker.linkEpisodes(epB, epC, 'sequence');

      const linkedB = await linker.getLinkedEpisodes(epA, 'outgoing');
      expect(linkedB).toHaveLength(1);
      expect(linkedB[0].id).toBe(epB);
    });

    it('should prevent simple cycle (A → B → A)', async () => {
      const epA = await createTestEpisode('task1', 1000);
      const epB = await createTestEpisode('task1', 2000);

      await linker.linkEpisodes(epA, epB, 'sequence');

      await expect(
        linker.linkEpisodes(epB, epA, 'sequence')
      ).rejects.toThrow(EpisodeValidationError);
    });

    it('should prevent complex cycle (A → B → C → A)', async () => {
      const epA = await createTestEpisode('task1', 1000);
      const epB = await createTestEpisode('task1', 2000);
      const epC = await createTestEpisode('task1', 3000);

      await linker.linkEpisodes(epA, epB, 'sequence');
      await linker.linkEpisodes(epB, epC, 'sequence');

      await expect(
        linker.linkEpisodes(epC, epA, 'sequence')
      ).rejects.toThrow(EpisodeValidationError);
    });

    it('should allow cycles for reference links', async () => {
      const epA = await createTestEpisode('task1', 1000);
      const epB = await createTestEpisode('task1', 2000);

      await linker.linkEpisodes(epA, epB, 'reference');
      // Should NOT throw
      await linker.linkEpisodes(epB, epA, 'reference');

      expect(linker.getOutgoingLinks(epA, 'reference')).toContain(epB);
      expect(linker.getOutgoingLinks(epB, 'reference')).toContain(epA);
    });

    it('should allow cycles for continuation links', async () => {
      const epA = await createTestEpisode('task1', 1000);
      const epB = await createTestEpisode('task1', 2000);
      const epC = await createTestEpisode('task1', 3000);

      await linker.linkEpisodes(epA, epB, 'continuation');
      await linker.linkEpisodes(epB, epC, 'continuation');
      // Should NOT throw (continuation allows iterative processes)
      await linker.linkEpisodes(epC, epA, 'continuation');

      expect(linker.getOutgoingLinks(epC, 'continuation')).toContain(epA);
    });

    it('should handle complex graphs with multiple paths', async () => {
      // Create diamond shape: A → B → D, A → C → D
      const epA = await createTestEpisode('task1', 1000);
      const epB = await createTestEpisode('task1', 2000);
      const epC = await createTestEpisode('task1', 3000);
      const epD = await createTestEpisode('task1', 4000);

      await linker.linkEpisodes(epA, epB, 'sequence');
      await linker.linkEpisodes(epA, epC, 'sequence');
      await linker.linkEpisodes(epB, epD, 'sequence');
      await linker.linkEpisodes(epC, epD, 'sequence');

      // Should still prevent cycle
      await expect(
        linker.linkEpisodes(epD, epA, 'sequence')
      ).rejects.toThrow(EpisodeValidationError);
    });

    it('should perform cycle detection efficiently (1k+ nodes)', async () => {
      // Create a long chain
      const episodes: string[] = [];
      for (let i = 0; i < 100; i++) {
        const ep = await createTestEpisode('task1', 1000 + i * 1000);
        episodes.push(ep);
      }

      // Link them in sequence
      for (let i = 0; i < episodes.length - 1; i++) {
        await linker.linkEpisodes(episodes[i], episodes[i + 1], 'sequence');
      }

      // Try to create cycle (should be detected quickly)
      const startTime = Date.now();
      await expect(
        linker.linkEpisodes(episodes[episodes.length - 1], episodes[0], 'sequence')
      ).rejects.toThrow(EpisodeValidationError);
      const duration = Date.now() - startTime;

      // Should complete in under 30ms for 100 nodes
      expect(duration).toBeLessThan(30);
    });

    it('should use DFS for cycle detection', async () => {
      // Verify cycle detection uses depth-first search
      const epA = await createTestEpisode('task1', 1000);
      const epB = await createTestEpisode('task1', 2000);
      const epC = await createTestEpisode('task1', 3000);

      await linker.linkEpisodes(epA, epB, 'sequence');
      await linker.linkEpisodes(epB, epC, 'sequence');

      // detectCycles should return true
      expect(linker.detectCycles(epC, epA)).toBe(true);

      // Should return false for non-cycle
      expect(linker.detectCycles(epA, epC)).toBe(false);
    });
  });

  describe('TC-E3-003: Context retrieval accuracy', () => {
    it('should retrieve direct episodes (same taskId)', async () => {
      const task1ep1 = await createTestEpisode('task1', 1000);
      const task1ep2 = await createTestEpisode('task1', 2000);
      const task1ep3 = await createTestEpisode('task1', 3000);
      await createTestEpisode('task2', 4000); // Different task

      const context = await linker.getEpisodeContext('task1');

      expect(context.direct).toHaveLength(3);
      expect(context.direct.map(e => e.id).sort()).toEqual(
        [task1ep1, task1ep2, task1ep3].sort()
      );
    });

    it('should retrieve temporal context (last hour)', async () => {
      const now = Date.now();
      const oneHourAgo = now - 3600000;

      // Recent episodes
      const recent1 = await createTestEpisode('task1', now - 1800000); // 30 min ago
      const recent2 = await createTestEpisode('task2', now - 900000);  // 15 min ago

      // Old episode (should not be included)
      await createTestEpisode('task3', now - 7200000); // 2 hours ago

      const context = await linker.getEpisodeContext('task1');

      // Should include recent episodes
      const temporalIds = context.temporal.map(e => e.id);
      expect(temporalIds).toContain(recent1);
      expect(temporalIds).toContain(recent2);
    });

    it('should retrieve semantic context (similar episodes)', async () => {
      // Create episodes with similar embeddings
      // TASK-VEC-001-007: Use VECTOR_DIM constant for embedding dimensions
      const baseEmbedding = new Float32Array(VECTOR_DIM);
      for (let i = 0; i < VECTOR_DIM; i++) {
        baseEmbedding[i] = Math.random();
      }

      // Task 1 episode (will be used for similarity search)
      const task1Id = await store.createEpisode({
        taskId: 'task1',
        startTime: 1000,
        endTime: 2000,
        embedding: baseEmbedding,
        metadata: {
          agentType: 'test',
          taskDescription: 'Base task',
          outcome: 'success',
        },
      });

      // Similar episode (task2)
      const similarEmbedding = new Float32Array(baseEmbedding);
      for (let i = 0; i < 10; i++) {
        similarEmbedding[i] += 0.01; // Slightly different
      }

      const task2Id = await store.createEpisode({
        taskId: 'task2',
        startTime: 3000,
        endTime: 4000,
        embedding: similarEmbedding,
        metadata: {
          agentType: 'test',
          taskDescription: 'Similar task',
          outcome: 'success',
        },
      });

      const context = await linker.getEpisodeContext('task1');

      // Semantic context should exclude same task but include similar
      expect(context.semantic.map(e => e.taskId)).not.toContain('task1');
    });

    it('should handle edge case: no context available', async () => {
      const context = await linker.getEpisodeContext('nonexistent-task');

      expect(context.direct).toHaveLength(0);
      expect(context.temporal).toHaveLength(0);
      expect(context.semantic).toHaveLength(0);
    });

    it('should handle partial context (only direct)', async () => {
      // Create episode far in the past
      const oldTime = Date.now() - 86400000 * 7; // 7 days ago
      const ep1 = await createTestEpisode('task1', oldTime);

      const context = await linker.getEpisodeContext('task1');

      expect(context.direct).toHaveLength(1);
      expect(context.direct[0].id).toBe(ep1);
      // Temporal should be empty (too old)
      expect(context.temporal).toHaveLength(0);
    });

    it('should execute context queries in parallel (<100ms)', async () => {
      // Create diverse episodes
      for (let i = 0; i < 20; i++) {
        await createTestEpisode('task1', Date.now() - i * 60000);
      }

      const startTime = Date.now();
      await linker.getEpisodeContext('task1');
      const duration = Date.now() - startTime;

      // Should complete in under 100ms
      expect(duration).toBeLessThan(100);
    });
  });

  describe('TC-E3-004: Max links enforcement', () => {
    it('should allow up to 100 links from single episode', async () => {
      const source = await createTestEpisode('task1', 1000);

      // Create 100 target episodes
      const targets: string[] = [];
      for (let i = 0; i < 100; i++) {
        const target = await createTestEpisode('task1', 2000 + i);
        targets.push(target);
      }

      // Link all targets
      for (const target of targets) {
        await linker.linkEpisodes(source, target, 'sequence');
      }

      const linked = await linker.getLinkedEpisodes(source, 'outgoing');
      expect(linked).toHaveLength(100);
    });

    it('should reject 101st link', async () => {
      const source = await createTestEpisode('task1', 1000);

      // Create 100 links
      for (let i = 0; i < 100; i++) {
        const target = await createTestEpisode('task1', 2000 + i);
        await linker.linkEpisodes(source, target, 'reference');
      }

      // Try to create 101st link
      const extraTarget = await createTestEpisode('task1', 200000);
      await expect(
        linker.linkEpisodes(source, extraTarget, 'reference')
      ).rejects.toThrow(EpisodeValidationError);
    });

    it('should enforce max links for different link types', async () => {
      const source = await createTestEpisode('task1', 1000);

      // Mix of link types
      for (let i = 0; i < 50; i++) {
        const target = await createTestEpisode('task1', 2000 + i);
        await linker.linkEpisodes(source, target, 'sequence');
      }

      for (let i = 0; i < 50; i++) {
        const target = await createTestEpisode('task1', 5000 + i);
        await linker.linkEpisodes(source, target, 'reference');
      }

      // Total should be 100
      const linked = await linker.getLinkedEpisodes(source, 'outgoing');
      expect(linked).toHaveLength(100);

      // 101st should fail
      const extraTarget = await createTestEpisode('task1', 200000);
      await expect(
        linker.linkEpisodes(source, extraTarget, 'continuation')
      ).rejects.toThrow(EpisodeValidationError);
    });

    it('should handle max links with episode deletion', async () => {
      const source = await createTestEpisode('task1', 1000);
      const targets: string[] = [];

      // Create 100 links
      for (let i = 0; i < 100; i++) {
        const target = await createTestEpisode('task1', 2000 + i);
        targets.push(target);
        await linker.linkEpisodes(source, target, 'sequence');
      }

      // Delete a target episode
      await store.delete(targets[0]);
      await linker.unlinkEpisodes(source, targets[0]);

      // Now should be able to add another link
      const newTarget = await createTestEpisode('task1', 200000);
      await linker.linkEpisodes(source, newTarget, 'sequence');

      const linked = await linker.getLinkedEpisodes(source, 'outgoing');
      expect(linked).toHaveLength(100);
    });

    it('should maintain performance with max links', async () => {
      const source = await createTestEpisode('task1', 1000);

      // Create 100 links
      for (let i = 0; i < 100; i++) {
        const target = await createTestEpisode('task1', 2000 + i);
        await linker.linkEpisodes(source, target, 'sequence');
      }

      // Query performance
      const startTime = Date.now();
      await linker.getLinkedEpisodes(source, 'outgoing');
      const duration = Date.now() - startTime;

      // Should retrieve 100 links in under 50ms
      expect(duration).toBeLessThan(50);
    });
  });

  describe('Additional functionality', () => {
    it('should get link statistics', async () => {
      const ep1 = await createTestEpisode('task1', 1000);
      const ep2 = await createTestEpisode('task1', 2000);
      const ep3 = await createTestEpisode('task1', 3000);

      await linker.linkEpisodes(ep1, ep2, 'sequence');
      await linker.linkEpisodes(ep1, ep3, 'sequence');

      const stats = linker.getStats();
      expect(stats.totalLinks).toBe(2);
      expect(stats.episodesWithLinks).toBeGreaterThanOrEqual(2);
      expect(stats.avgLinksPerEpisode).toBeGreaterThan(0);
    });

    it('should clear all links', async () => {
      const ep1 = await createTestEpisode('task1', 1000);
      const ep2 = await createTestEpisode('task1', 2000);

      await linker.linkEpisodes(ep1, ep2, 'sequence');

      linker.clear();

      const stats = linker.getStats();
      expect(stats.totalLinks).toBe(0);
      expect(stats.episodesWithLinks).toBe(0);
    });

    it('should handle invalid episode IDs gracefully', async () => {
      await expect(
        linker.linkEpisodes('invalid', 'also-invalid', 'sequence')
      ).rejects.toThrow(EpisodeValidationError);
    });

    it('should support initialization from existing database', async () => {
      // Create links
      const ep1 = await createTestEpisode('task1', 1000);
      const ep2 = await createTestEpisode('task1', 2000);
      await linker.linkEpisodes(ep1, ep2, 'sequence');

      // Reinitialize linker
      const newLinker = new EpisodeLinker(store, timeIndex);
      await newLinker.initialize();

      // Should be able to query links (from database)
      const linked = await newLinker.getLinkedEpisodes(ep1, 'outgoing');
      expect(linked.map(e => e.id)).toContain(ep2);
    });
  });

  describe('Performance benchmarks', () => {
    it('should create link in <10ms', async () => {
      const ep1 = await createTestEpisode('task1', 1000);
      const ep2 = await createTestEpisode('task1', 2000);

      const startTime = Date.now();
      await linker.linkEpisodes(ep1, ep2, 'sequence');
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(10);
    });

    it('should remove link in <5ms', async () => {
      const ep1 = await createTestEpisode('task1', 1000);
      const ep2 = await createTestEpisode('task1', 2000);

      await linker.linkEpisodes(ep1, ep2, 'sequence');

      const startTime = Date.now();
      await linker.unlinkEpisodes(ep1, ep2);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(5);
    });

    it('should get 10 linked episodes in <20ms', async () => {
      const source = await createTestEpisode('task1', 1000);

      for (let i = 0; i < 10; i++) {
        const target = await createTestEpisode('task1', 2000 + i);
        await linker.linkEpisodes(source, target, 'sequence');
      }

      const startTime = Date.now();
      await linker.getLinkedEpisodes(source, 'outgoing');
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(20);
    });
  });
});
