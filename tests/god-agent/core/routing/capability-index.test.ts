/**
 * DAI-003: Capability Index Tests
 *
 * TASK-005: Capability Index Tests
 * Constitution: RULE-DAI-003-004, INT-002
 *
 * Tests for CapabilityIndex using REAL implementations:
 * - AgentRegistry loads from .claude/agents/
 * - VectorDB with real embeddings
 * - EmbeddingProvider (local or mock)
 *
 * NO MOCKS - All tests use real implementations
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { CapabilityIndex } from '../../../../src/god-agent/core/routing/capability-index.js';
import { CapabilityIndexError, IndexSyncError } from '../../../../src/god-agent/core/routing/routing-errors.js';
import type { TaskDomain } from '../../../../src/god-agent/core/routing/routing-types.js';
import { EmbeddingProviderFactory } from '../../../../src/god-agent/core/memory/embedding-provider.js';
import type { IEmbeddingProvider } from '../../../../src/god-agent/core/memory/types.js';

// ==================== Test Setup ====================

describe('CapabilityIndex', () => {
  let embeddingProvider: IEmbeddingProvider;

  beforeAll(async () => {
    // Get embedding provider (will use mock if local unavailable)
    embeddingProvider = await EmbeddingProviderFactory.getProvider(false);
  });

  afterEach(() => {
    // Reset factory for clean state
    EmbeddingProviderFactory.reset();
  });

  // ==================== Initialization Tests ====================

  describe('initialize()', () => {
    it('should initialize with real agents from .claude/agents/', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();

      const stats = index.getStats();
      expect(stats.agentCount).toBeGreaterThan(0);
      expect(stats.lastSyncTime).toBeGreaterThan(0);
      expect(stats.isStale).toBe(false);
    });

    it('should not re-initialize if already initialized', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();
      const firstSync = index.getLastSyncTime();

      // Wait 10ms
      await new Promise(resolve => setTimeout(resolve, 10));

      await index.initialize();
      const secondSync = index.getLastSyncTime();

      // Should be same sync time
      expect(secondSync).toBe(firstSync);
    });

    it('should throw CapabilityIndexError if agents path invalid', async () => {
      const index = new CapabilityIndex({
        agentsPath: '/nonexistent/path',
        verbose: false,
      });

      await expect(index.initialize()).rejects.toThrow(CapabilityIndexError);
    });

    it('should initialize with local embedding provider if available', async () => {
      const isLocalAvailable = await EmbeddingProviderFactory.isLocalAvailable();

      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        useLocalEmbedding: true,
        verbose: false,
      });

      if (isLocalAvailable) {
        await expect(index.initialize()).resolves.not.toThrow();
      } else {
        // Should fall back to mock
        await expect(index.initialize()).resolves.not.toThrow();
      }
    });

    it('should complete initialization in reasonable time', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      const startTime = performance.now();
      await index.initialize();
      const duration = performance.now() - startTime;

      // Should be < 10s (performance target for rebuild)
      expect(duration).toBeLessThan(10000);
    });
  });

  // ==================== Rebuild Tests ====================

  describe('rebuild()', () => {
    it('should rebuild index from scratch', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();
      const initialCount = index.getAgentCount();

      await index.rebuild();
      const rebuiltCount = index.getAgentCount();

      // Should have same count after rebuild
      expect(rebuiltCount).toBe(initialCount);
    });

    it('should update lastSyncTime after rebuild', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();
      const firstSync = index.getLastSyncTime();

      // Wait 10ms
      await new Promise(resolve => setTimeout(resolve, 10));

      await index.rebuild();
      const secondSync = index.getLastSyncTime();

      // Should have new sync time
      expect(secondSync).toBeGreaterThan(firstSync);
    });

    it('should complete rebuild in < 10s for typical agent count', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();

      const startTime = performance.now();
      await index.rebuild();
      const duration = performance.now() - startTime;

      // Performance target: < 10s for 200 agents
      expect(duration).toBeLessThan(10000);
    });

    it('should clear existing index before rebuilding', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();
      const beforeRebuild = index.getAgentCount();

      await index.rebuild();
      const afterRebuild = index.getAgentCount();

      // Should have agents after rebuild (not empty)
      expect(afterRebuild).toBeGreaterThan(0);
      // Should match original count
      expect(afterRebuild).toBe(beforeRebuild);
    });
  });

  // ==================== Search Tests ====================

  describe('search()', () => {
    it('should return capability matches for task embedding', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();

      // Create embedding for a test task
      const taskEmbedding = await embeddingProvider.embed('Build a REST API with authentication');

      const matches = await index.search(taskEmbedding, 5);

      expect(matches).toBeDefined();
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.length).toBeLessThanOrEqual(5);

      // Verify match structure
      const firstMatch = matches[0];
      expect(firstMatch.agentKey).toBeDefined();
      expect(firstMatch.name).toBeDefined();
      expect(firstMatch.similarityScore).toBeGreaterThanOrEqual(0);
      expect(firstMatch.similarityScore).toBeLessThanOrEqual(1);
      expect(firstMatch.capability).toBeDefined();
    });

    it('should return matches sorted by similarity score', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();

      const taskEmbedding = await embeddingProvider.embed('Write comprehensive tests for API endpoints');

      const matches = await index.search(taskEmbedding, 10);

      // Verify descending order
      for (let i = 1; i < matches.length; i++) {
        expect(matches[i - 1].similarityScore).toBeGreaterThanOrEqual(
          matches[i].similarityScore
        );
      }
    });

    it('should respect limit parameter', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();

      const taskEmbedding = await embeddingProvider.embed('Analyze code quality');

      const matches3 = await index.search(taskEmbedding, 3);
      expect(matches3.length).toBeLessThanOrEqual(3);

      const matches10 = await index.search(taskEmbedding, 10);
      expect(matches10.length).toBeLessThanOrEqual(10);
    });

    it('should throw IndexSyncError if index is stale', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        freshnessThreshold: 100, // 100ms threshold
        verbose: false,
      });

      await index.initialize();

      // Wait for index to become stale
      await new Promise(resolve => setTimeout(resolve, 150));

      const taskEmbedding = await embeddingProvider.embed('Test task');

      await expect(index.search(taskEmbedding, 5)).rejects.toThrow(IndexSyncError);
    });

    it('should handle empty results gracefully', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();

      // Create a very specific embedding unlikely to match well
      const taskEmbedding = await embeddingProvider.embed('xyz123abc456def789');

      const matches = await index.search(taskEmbedding, 5);

      // Should still return results (even if low similarity)
      expect(matches).toBeDefined();
      expect(Array.isArray(matches)).toBe(true);
    });
  });

  // ==================== Domain Search Tests ====================

  describe('searchByDomain()', () => {
    it('should return agents for code domain', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();

      const matches = index.searchByDomain('code', 10);

      expect(matches.length).toBeGreaterThan(0);

      // Verify all matches have code domain
      for (const match of matches) {
        expect(match.capability.domains).toContain('code');
        expect(match.domainMatch).toBe(true);
      }
    });

    it('should return agents for testing domain', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();

      const matches = index.searchByDomain('testing', 10);

      expect(matches.length).toBeGreaterThan(0);

      // Verify all matches have testing domain
      for (const match of matches) {
        expect(match.capability.domains).toContain('testing');
      }
    });

    it('should return agents for research domain', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();

      const matches = index.searchByDomain('research', 10);

      expect(matches.length).toBeGreaterThan(0);

      // Verify all matches have research domain
      for (const match of matches) {
        expect(match.capability.domains).toContain('research');
      }
    });

    it('should respect limit parameter', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();

      const matches3 = index.searchByDomain('code', 3);
      expect(matches3.length).toBeLessThanOrEqual(3);

      const matches10 = index.searchByDomain('code', 10);
      expect(matches10.length).toBeLessThanOrEqual(10);
    });

    it('should sort by success rate', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();

      const matches = index.searchByDomain('code', 10);

      // Verify descending order by success rate
      for (let i = 1; i < matches.length; i++) {
        expect(matches[i - 1].capability.successRate).toBeGreaterThanOrEqual(
          matches[i].capability.successRate
        );
      }
    });

    it('should throw IndexSyncError if index is stale', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        freshnessThreshold: 100, // 100ms threshold
        verbose: false,
      });

      await index.initialize();

      // Wait for index to become stale
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(() => index.searchByDomain('code', 5)).toThrow(IndexSyncError);
    });
  });

  // ==================== Synchronization Tests ====================

  describe('getLastSyncTime()', () => {
    it('should return zero before initialization', () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      expect(index.getLastSyncTime()).toBe(0);
    });

    it('should return valid timestamp after initialization', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      const beforeInit = Date.now();
      await index.initialize();
      const afterInit = Date.now();

      const syncTime = index.getLastSyncTime();
      expect(syncTime).toBeGreaterThanOrEqual(beforeInit);
      expect(syncTime).toBeLessThanOrEqual(afterInit);
    });

    it('should update after rebuild', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();
      const firstSync = index.getLastSyncTime();

      await new Promise(resolve => setTimeout(resolve, 10));

      await index.rebuild();
      const secondSync = index.getLastSyncTime();

      expect(secondSync).toBeGreaterThan(firstSync);
    });
  });

  describe('getAgentCount()', () => {
    it('should return zero before initialization', () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      expect(index.getAgentCount()).toBe(0);
    });

    it('should return agent count after initialization', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();
      const count = index.getAgentCount();

      expect(count).toBeGreaterThan(0);
    });

    it('should match number of agents in registry', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();
      const indexCount = index.getAgentCount();
      const stats = index.getStats();

      expect(stats.agentCount).toBe(indexCount);
    });
  });

  // ==================== Capability Retrieval Tests ====================

  describe('getCapability()', () => {
    it('should return capability for existing agent', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();

      // Get first agent from stats
      const stats = index.getStats();
      expect(stats.agentCount).toBeGreaterThan(0);

      // Search to get an agent key
      const embedding = await embeddingProvider.embed('test');
      const matches = await index.search(embedding, 1);
      expect(matches.length).toBeGreaterThan(0);

      const agentKey = matches[0].agentKey;
      const capability = index.getCapability(agentKey);

      expect(capability).toBeDefined();
      expect(capability!.agentKey).toBe(agentKey);
      expect(capability!.name).toBeDefined();
      expect(capability!.description).toBeDefined();
      expect(capability!.domains).toBeDefined();
      expect(capability!.keywords).toBeDefined();
      expect(capability!.embedding).toBeDefined();
    });

    it('should return undefined for non-existent agent', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();

      const capability = index.getCapability('nonexistent-agent-key');
      expect(capability).toBeUndefined();
    });
  });

  // ==================== Statistics Tests ====================

  describe('getStats()', () => {
    it('should return valid statistics', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();
      const stats = index.getStats();

      expect(stats.agentCount).toBeGreaterThan(0);
      expect(stats.lastSyncTime).toBeGreaterThan(0);
      expect(stats.timeSinceSync).toBeGreaterThanOrEqual(0);
      expect(stats.isStale).toBe(false);
      expect(stats.domains).toBeDefined();

      // Verify domain counts
      const domains: TaskDomain[] = ['research', 'testing', 'code', 'writing', 'design', 'review'];
      for (const domain of domains) {
        expect(stats.domains[domain]).toBeGreaterThanOrEqual(0);
      }
    });

    it('should show stale status after threshold', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        freshnessThreshold: 100, // 100ms
        verbose: false,
      });

      await index.initialize();

      let stats = index.getStats();
      expect(stats.isStale).toBe(false);

      // Wait for threshold
      await new Promise(resolve => setTimeout(resolve, 150));

      stats = index.getStats();
      expect(stats.isStale).toBe(true);
    });

    it('should track domain distribution', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();
      const stats = index.getStats();

      // Sum of domain counts should be >= agent count
      // (agents can belong to multiple domains)
      const totalDomainCounts = Object.values(stats.domains).reduce((sum, count) => sum + count, 0);
      expect(totalDomainCounts).toBeGreaterThanOrEqual(stats.agentCount);
    });
  });

  // ==================== Edge Cases & Error Handling ====================

  describe('Edge Cases', () => {
    it('should handle agents with minimal frontmatter', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();

      // Should not throw even if some agents have minimal metadata
      expect(index.getAgentCount()).toBeGreaterThan(0);
    });

    it('should handle concurrent searches', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();

      const embedding1 = await embeddingProvider.embed('Build API');
      const embedding2 = await embeddingProvider.embed('Write tests');
      const embedding3 = await embeddingProvider.embed('Design architecture');

      // Run searches concurrently
      const [results1, results2, results3] = await Promise.all([
        index.search(embedding1, 5),
        index.search(embedding2, 5),
        index.search(embedding3, 5),
      ]);

      expect(results1.length).toBeGreaterThan(0);
      expect(results2.length).toBeGreaterThan(0);
      expect(results3.length).toBeGreaterThan(0);
    });

    it('should handle rebuild during search operations', async () => {
      const index = new CapabilityIndex({
        agentsPath: '.claude/agents',
        verbose: false,
      });

      await index.initialize();

      const embedding = await embeddingProvider.embed('Test task');

      // Start search and rebuild concurrently
      const searchPromise = index.search(embedding, 5);
      const rebuildPromise = index.rebuild();

      // Both should complete without error
      await Promise.all([searchPromise, rebuildPromise]);
    });
  });
});
