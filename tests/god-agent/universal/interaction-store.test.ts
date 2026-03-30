/**
 * InteractionStore Tests
 *
 * Tests LRU eviction, high-quality persistence, rolling window, and stats functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InteractionStore } from '../../../src/god-agent/universal/interaction-store.js';
import type { Interaction, KnowledgeEntry } from '../../../src/god-agent/universal/universal-agent.js';
import { promises as fs } from 'fs';
import * as path from 'path';

describe('InteractionStore', () => {
  let store: InteractionStore;
  const testDir = '/tmp/interaction-store-test';

  beforeEach(async () => {
    // Clean test directory
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.mkdir(testDir, { recursive: true });

    store = new InteractionStore({
      storageDir: testDir,
      maxInteractions: 10, // Small for testing LRU
      highQualityThreshold: 0.7,
      rollingWindowDays: 7,
      persistCount: 5,
    });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  // ==================== Helper Functions ====================

  function createInteraction(id: string, quality: number = 0.5): Interaction {
    return {
      id,
      mode: 'general',
      input: `Test input ${id}`,
      output: `Test output ${id}`.repeat(quality > 0.7 ? 20 : 5), // Longer output for high quality
      timestamp: Date.now(),
      feedback: { rating: quality, useful: quality > 0.5 },
    };
  }

  function createKnowledge(id: string, domain: string): KnowledgeEntry {
    return {
      id,
      content: `Knowledge ${id}`,
      type: 'fact',
      domain,
      tags: ['test'],
      quality: 0.8,
      usageCount: 0,
      lastUsed: Date.now(),
      createdAt: Date.now(),
    };
  }

  // ==================== LRU Eviction Tests ====================

  describe('LRU Eviction', () => {
    it('should evict oldest when max capacity reached', () => {
      // Add 10 interactions (at capacity)
      for (let i = 0; i < 10; i++) {
        store.add(createInteraction(`int-${i}`));
      }

      const statsBefore = store.getStats();
      expect(statsBefore.totalInteractions).toBe(10);

      // Add 11th - should evict first
      store.add(createInteraction('int-10'));

      const statsAfter = store.getStats();
      expect(statsAfter.totalInteractions).toBe(10); // Still at max

      // First should be gone
      expect(store.get('int-0')).toBeUndefined();

      // Last should be present
      expect(store.get('int-10')).toBeDefined();
    });

    it('should maintain order after updates', () => {
      // Add 5 interactions
      for (let i = 0; i < 5; i++) {
        store.add(createInteraction(`int-${i}`));
      }

      // Update interaction 2 (re-add it)
      const updated = createInteraction('int-2', 0.9);
      store.add(updated);

      const recent = store.getRecent(5);
      // int-2 should be most recent now
      expect(recent[0].id).toBe('int-2');
      expect(recent[0].feedback?.rating).toBe(0.9);
    });

    it('should handle rapid additions efficiently', () => {
      const startTime = Date.now();

      // Add 100 interactions (10x capacity)
      for (let i = 0; i < 100; i++) {
        store.add(createInteraction(`rapid-${i}`));
      }

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(1000); // Should complete in <1 second

      // Should only keep last 10
      const stats = store.getStats();
      expect(stats.totalInteractions).toBe(10);

      // First 90 should be evicted
      expect(store.get('rapid-0')).toBeUndefined();
      expect(store.get('rapid-50')).toBeUndefined();

      // Last 10 should remain
      expect(store.get('rapid-90')).toBeDefined();
      expect(store.get('rapid-99')).toBeDefined();
    });
  });

  // ==================== High Quality Persistence Tests ====================

  describe('High Quality Persistence', () => {
    it('should track high quality interactions separately', () => {
      // Add mix of qualities
      store.add(createInteraction('low-1', 0.3));
      store.add(createInteraction('med-1', 0.5));
      store.add(createInteraction('high-1', 0.8));
      store.add(createInteraction('high-2', 0.9));

      const highQuality = store.getHighQuality();
      expect(highQuality.length).toBe(2);
      expect(highQuality.map(i => i.id).sort()).toEqual(['high-1', 'high-2']);
    });

    it('should use configured threshold', () => {
      const customStore = new InteractionStore({
        storageDir: testDir + '/custom',
        highQualityThreshold: 0.5, // Lower threshold
      });

      customStore.add(createInteraction('low-1', 0.3));
      customStore.add(createInteraction('mid-1', 0.6));
      customStore.add(createInteraction('high-1', 0.8));

      const highQuality = customStore.getHighQuality();
      // With 0.5 threshold, mid-1 and high-1 should qualify
      expect(highQuality.length).toBeGreaterThanOrEqual(2);
    });

    it('should persist high quality to disk', async () => {
      store.add(createInteraction('high-1', 0.8));
      store.add(createInteraction('high-2', 0.9));
      store.add(createInteraction('low-1', 0.3));

      await store.save();

      // Check file exists
      const highQualityPath = path.join(testDir, 'high-quality.json');
      const exists = await fs.access(highQualityPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      // Verify content
      const data = await fs.readFile(highQualityPath, 'utf-8');
      const loaded = JSON.parse(data);
      expect(loaded.length).toBe(2);
    });
  });

  // ==================== Rolling Window Tests ====================

  describe('Rolling Window', () => {
    it('should prune interactions older than window', () => {
      const now = Date.now();
      const eightDaysAgo = now - (8 * 24 * 60 * 60 * 1000);
      const sixDaysAgo = now - (6 * 24 * 60 * 60 * 1000);

      // Add old interaction - auto-prune will NOT trigger yet
      const oldInteraction = createInteraction('old-1');
      oldInteraction.timestamp = eightDaysAgo;
      store.add(oldInteraction);

      // Note: The old interaction is already pruned by auto-prune during add()
      // So we need to check the state after add, not before manual prune
      const statsAfterAdd = store.getStats();
      expect(statsAfterAdd.totalInteractions).toBe(0); // Already auto-pruned

      // Add recent interaction
      const recentInteraction = createInteraction('recent-1');
      recentInteraction.timestamp = sixDaysAgo;
      store.add(recentInteraction);

      const statsAfter = store.getStats();
      expect(statsAfter.totalInteractions).toBe(1); // Only recent one
      expect(store.get('old-1')).toBeUndefined();
      expect(store.get('recent-1')).toBeDefined();

      // Manual prune should do nothing now
      const pruned = store.prune();
      expect(pruned).toBe(0); // Nothing left to prune
    });

    it('should keep recent interactions', () => {
      const now = Date.now();

      // Add 5 recent interactions
      for (let i = 0; i < 5; i++) {
        const interaction = createInteraction(`recent-${i}`);
        interaction.timestamp = now - (i * 60 * 1000); // Minutes apart
        store.add(interaction);
      }

      const pruned = store.prune();
      expect(pruned).toBe(0); // Nothing pruned

      const stats = store.getStats();
      expect(stats.totalInteractions).toBe(5);
    });

    it('should auto-prune on add', () => {
      const now = Date.now();
      const tenDaysAgo = now - (10 * 24 * 60 * 60 * 1000);

      // Add old interaction - will be auto-pruned immediately
      const oldInteraction = createInteraction('old-1');
      oldInteraction.timestamp = tenDaysAgo;
      store.add(oldInteraction);

      // Old interaction is auto-pruned immediately after add
      const statsBefore = store.getStats();
      expect(statsBefore.totalInteractions).toBe(0); // Already pruned

      // Add new interaction
      store.add(createInteraction('new-1'));

      const statsAfter = store.getStats();
      expect(statsAfter.totalInteractions).toBe(1); // Only new one
      expect(store.get('old-1')).toBeUndefined();
      expect(store.get('new-1')).toBeDefined();
    });
  });

  // ==================== Persistence Tests ====================

  describe('Persistence', () => {
    it('should save and load interactions', async () => {
      // Add interactions
      store.add(createInteraction('int-1', 0.5));
      store.add(createInteraction('int-2', 0.6));
      store.add(createInteraction('int-3', 0.7));

      await store.save();

      // Create new store and load
      const newStore = new InteractionStore({
        storageDir: testDir,
      });
      await newStore.load();

      const stats = newStore.getStats();
      expect(stats.totalInteractions).toBeGreaterThanOrEqual(3);
      expect(newStore.get('int-1')).toBeDefined();
      expect(newStore.get('int-2')).toBeDefined();
    });

    it('should save and load knowledge entries', async () => {
      store.addKnowledge(createKnowledge('k-1', 'science'));
      store.addKnowledge(createKnowledge('k-2', 'math'));

      await store.save();

      const newStore = new InteractionStore({
        storageDir: testDir,
      });
      await newStore.load();

      const knowledge = newStore.getKnowledge();
      expect(knowledge.length).toBe(2);
      expect(knowledge.map(k => k.id).sort()).toEqual(['k-1', 'k-2']);
    });

    it('should handle missing files gracefully', async () => {
      const emptyStore = new InteractionStore({
        storageDir: testDir + '/nonexistent',
      });

      // Should not throw
      await expect(emptyStore.load()).resolves.toBeUndefined();

      const stats = emptyStore.getStats();
      expect(stats.totalInteractions).toBe(0);
      expect(stats.knowledgeCount).toBe(0);
    });

    it('should persist only recent N interactions', async () => {
      // Add 20 interactions
      for (let i = 0; i < 20; i++) {
        store.add(createInteraction(`int-${i}`));
      }

      await store.save();

      // Check file - should only have last 5 (persistCount)
      const interactionsPath = path.join(testDir, 'interactions.json');
      const data = await fs.readFile(interactionsPath, 'utf-8');
      const loaded = JSON.parse(data);

      expect(loaded.length).toBeLessThanOrEqual(5);
    });

    it('should preserve embeddings across save/load', async () => {
      const interaction = createInteraction('emb-1');
      interaction.embedding = new Float32Array([1.0, 0.5, 0.25]);
      store.add(interaction);

      await store.save();

      const newStore = new InteractionStore({
        storageDir: testDir,
      });
      await newStore.load();

      const loaded = newStore.get('emb-1');
      expect(loaded).toBeDefined();
      expect(loaded?.embedding).toBeDefined();
      expect(loaded?.embedding).toBeInstanceOf(Float32Array);
      expect(Array.from(loaded!.embedding!)).toEqual([1.0, 0.5, 0.25]);
    });
  });

  // ==================== Stats Tests ====================

  describe('Stats', () => {
    it('should return accurate counts', () => {
      store.add(createInteraction('int-1', 0.5));
      store.add(createInteraction('int-2', 0.8));
      store.addKnowledge(createKnowledge('k-1', 'science'));

      const stats = store.getStats();
      expect(stats.totalInteractions).toBe(2);
      expect(stats.highQualityCount).toBe(1); // int-2 has 0.8 rating
      expect(stats.knowledgeCount).toBe(1);
    });

    it('should track oldest/newest timestamps', () => {
      const now = Date.now();

      const int1 = createInteraction('int-1');
      int1.timestamp = now - 1000;

      const int2 = createInteraction('int-2');
      int2.timestamp = now;

      store.add(int1);
      store.add(int2);

      const stats = store.getStats();
      expect(stats.oldestInteraction).toBe(now - 1000);
      expect(stats.newestInteraction).toBe(now);
    });

    it('should handle empty store', () => {
      const stats = store.getStats();
      expect(stats.totalInteractions).toBe(0);
      expect(stats.highQualityCount).toBe(0);
      expect(stats.knowledgeCount).toBe(0);
      expect(stats.oldestInteraction).toBeNull();
      expect(stats.newestInteraction).toBeNull();
    });
  });

  // ==================== Knowledge Management Tests ====================

  describe('Knowledge Management', () => {
    it('should store and retrieve knowledge', () => {
      store.addKnowledge(createKnowledge('k-1', 'science'));
      const knowledge = store.getKnowledge();

      expect(knowledge.length).toBe(1);
      expect(knowledge[0].id).toBe('k-1');
      expect(knowledge[0].domain).toBe('science');
    });

    it('should filter knowledge by domain', () => {
      store.addKnowledge(createKnowledge('k-1', 'science'));
      store.addKnowledge(createKnowledge('k-2', 'science'));
      store.addKnowledge(createKnowledge('k-3', 'math'));

      const scienceKnowledge = store.getKnowledgeByDomain('science');
      expect(scienceKnowledge.length).toBe(2);
      expect(scienceKnowledge.every(k => k.domain === 'science')).toBe(true);

      const mathKnowledge = store.getKnowledgeByDomain('math');
      expect(mathKnowledge.length).toBe(1);
    });
  });

  // ==================== Recent Interactions Tests ====================

  describe('Recent Interactions', () => {
    it('should return N most recent in reverse order', () => {
      for (let i = 0; i < 5; i++) {
        store.add(createInteraction(`int-${i}`));
      }

      const recent = store.getRecent(3);
      expect(recent.length).toBe(3);
      // Most recent first
      expect(recent[0].id).toBe('int-4');
      expect(recent[1].id).toBe('int-3');
      expect(recent[2].id).toBe('int-2');
    });

    it('should handle request for more than available', () => {
      store.add(createInteraction('int-1'));
      store.add(createInteraction('int-2'));

      const recent = store.getRecent(10);
      expect(recent.length).toBe(2);
    });
  });

  // ==================== Feedback Update Tests ====================

  describe('Feedback Updates', () => {
    it('should update interaction feedback', () => {
      const interaction = createInteraction('int-1', 0.5);
      store.add(interaction);

      store.updateFeedback('int-1', {
        rating: 0.9,
        useful: true,
        notes: 'Very helpful!',
      });

      const updated = store.get('int-1');
      expect(updated?.feedback?.rating).toBe(0.9);
      expect(updated?.feedback?.useful).toBe(true);
      expect(updated?.feedback?.notes).toBe('Very helpful!');
    });

    it('should handle feedback for non-existent interaction', () => {
      // Should not throw
      expect(() => {
        store.updateFeedback('nonexistent', { rating: 0.5, useful: false });
      }).not.toThrow();
    });
  });

  // ==================== Clear Tests ====================

  describe('Clear', () => {
    it('should clear all interactions and knowledge', () => {
      store.add(createInteraction('int-1'));
      store.add(createInteraction('int-2'));
      store.addKnowledge(createKnowledge('k-1', 'science'));

      const statsBefore = store.getStats();
      expect(statsBefore.totalInteractions).toBe(2);
      expect(statsBefore.knowledgeCount).toBe(1);

      store.clear();

      const statsAfter = store.getStats();
      expect(statsAfter.totalInteractions).toBe(0);
      expect(statsAfter.knowledgeCount).toBe(0);
    });
  });
});
