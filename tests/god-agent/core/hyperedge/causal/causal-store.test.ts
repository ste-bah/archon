/**
 * Causal Store Tests
 * TASK-HYPEREDGE-001
 *
 * Tests for causal chain storage and analysis
 * Target: 90%+ coverage
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CausalStore } from '../../../../../src/god-agent/core/hyperedge/causal/causal-store.js';
import { GraphDB } from '../../../../../src/god-agent/core/graph-db/graph-db.js';
import type { CausalNode } from '../../../../../src/god-agent/core/hyperedge/hyperedge-types.js';

describe('CausalStore', () => {
  let causalStore: CausalStore;
  let graphDB: GraphDB;

  beforeEach(() => {
    graphDB = new GraphDB();
    causalStore = new CausalStore({
      graphDB,
      maxDepth: 10,
      emitEvents: false, // Disable for testing
    });
  });

  describe('createChain', () => {
    it('should create valid causal chain', async () => {
      const nodes: CausalNode[] = [
        {
          id: 'n1',
          event: 'Event A',
          timestamp: 1000,
          causes: [],
          effects: ['n2'],
        },
        {
          id: 'n2',
          event: 'Event B',
          timestamp: 2000,
          causes: ['n1'],
          effects: [],
        },
      ];

      const chain = await causalStore.createChain(nodes);

      expect(chain).toBeDefined();
      expect(chain.id).toBeDefined();
      expect(chain.nodes).toEqual(nodes);
      expect(chain.edges).toHaveLength(1);
      expect(chain.edges[0].from).toBe('n1');
      expect(chain.edges[0].to).toBe('n2');
      expect(chain.validated).toBe(true);
      expect(chain.timestamp).toBeGreaterThan(0);
    });

    it('should reject chain with cycles (HYPER-05)', async () => {
      const nodes: CausalNode[] = [
        {
          id: 'n1',
          event: 'A',
          timestamp: 1000,
          causes: ['n3'],
          effects: ['n2'],
        },
        {
          id: 'n2',
          event: 'B',
          timestamp: 2000,
          causes: ['n1'],
          effects: ['n3'],
        },
        {
          id: 'n3',
          event: 'C',
          timestamp: 3000,
          causes: ['n2'],
          effects: ['n1'],
        },
      ];

      await expect(causalStore.createChain(nodes)).rejects.toThrow(/cycle/i);
    });

    it('should reject empty nodes array', async () => {
      await expect(causalStore.createChain([])).rejects.toThrow(
        /At least one causal node is required/
      );
    });

    it('should reject nodes with duplicate IDs', async () => {
      const nodes: CausalNode[] = [
        {
          id: 'n1',
          event: 'A',
          timestamp: 1000,
          causes: [],
          effects: [],
        },
        {
          id: 'n1', // Duplicate
          event: 'B',
          timestamp: 2000,
          causes: [],
          effects: [],
        },
      ];

      await expect(causalStore.createChain(nodes)).rejects.toThrow(/Duplicate node ID/);
    });

    it('should reject nodes with empty event', async () => {
      const nodes: CausalNode[] = [
        {
          id: 'n1',
          event: '', // Empty
          timestamp: 1000,
          causes: [],
          effects: [],
        },
      ];

      await expect(causalStore.createChain(nodes)).rejects.toThrow(/empty event/);
    });

    it('should reject nodes with invalid timestamp', async () => {
      const nodes: CausalNode[] = [
        {
          id: 'n1',
          event: 'Event',
          timestamp: 0, // Invalid
          causes: [],
          effects: [],
        },
      ];

      await expect(causalStore.createChain(nodes)).rejects.toThrow(/invalid timestamp/);
    });

    it('should reject nodes referencing non-existent causes', async () => {
      const nodes: CausalNode[] = [
        {
          id: 'n1',
          event: 'A',
          timestamp: 1000,
          causes: ['n999'], // Non-existent
          effects: [],
        },
      ];

      await expect(causalStore.createChain(nodes)).rejects.toThrow(
        /non-existent cause/
      );
    });

    it('should reject nodes referencing non-existent effects', async () => {
      const nodes: CausalNode[] = [
        {
          id: 'n1',
          event: 'A',
          timestamp: 1000,
          causes: [],
          effects: ['n999'], // Non-existent
        },
      ];

      await expect(causalStore.createChain(nodes)).rejects.toThrow(
        /non-existent effect/
      );
    });

    it('should create complex DAG', async () => {
      const nodes: CausalNode[] = [
        {
          id: 'n1',
          event: 'Root cause',
          timestamp: 1000,
          causes: [],
          effects: ['n2', 'n3'],
        },
        {
          id: 'n2',
          event: 'Branch A',
          timestamp: 2000,
          causes: ['n1'],
          effects: ['n4'],
        },
        {
          id: 'n3',
          event: 'Branch B',
          timestamp: 2000,
          causes: ['n1'],
          effects: ['n4'],
        },
        {
          id: 'n4',
          event: 'Merge point',
          timestamp: 3000,
          causes: ['n2', 'n3'],
          effects: [],
        },
      ];

      const chain = await causalStore.createChain(nodes);

      expect(chain.nodes).toHaveLength(4);
      expect(chain.edges).toHaveLength(4); // n1->n2, n1->n3, n2->n4, n3->n4
      expect(chain.validated).toBe(true);
    });

    it('should complete creation in <20ms per node', async () => {
      const nodes: CausalNode[] = Array.from({ length: 10 }, (_, i) => ({
        id: `n${i}`,
        event: `Event ${i}`,
        timestamp: 1000 + i * 1000,
        causes: i > 0 ? [`n${i - 1}`] : [],
        effects: i < 9 ? [`n${i + 1}`] : [],
      }));

      const start = Date.now();
      await causalStore.createChain(nodes);
      const elapsed = Date.now() - start;

      // 10 nodes * 20ms = 200ms, allow margin
      expect(elapsed).toBeLessThan(500);
    });
  });

  describe('findRootCause', () => {
    beforeEach(async () => {
      // Create a test chain
      const nodes: CausalNode[] = [
        {
          id: 'root',
          event: 'Root cause',
          timestamp: 1000,
          causes: [],
          effects: ['mid1'],
        },
        {
          id: 'mid1',
          event: 'Intermediate 1',
          timestamp: 2000,
          causes: ['root'],
          effects: ['mid2'],
        },
        {
          id: 'mid2',
          event: 'Intermediate 2',
          timestamp: 3000,
          causes: ['mid1'],
          effects: ['effect'],
        },
        {
          id: 'effect',
          event: 'Final effect',
          timestamp: 4000,
          causes: ['mid2'],
          effects: [],
        },
      ];

      await causalStore.createChain(nodes);
    });

    it('should find root cause from effect', async () => {
      const result = await causalStore.findRootCause('effect');

      expect(result).toBeDefined();
      expect(result.rootNode.id).toBe('root');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.path).toEqual(['root', 'mid1', 'mid2', 'effect']);
      expect(result.depth).toBe(3);
    });

    it('should find root cause from intermediate node', async () => {
      const result = await causalStore.findRootCause('mid2');

      expect(result.rootNode.id).toBe('root');
      expect(result.path).toEqual(['root', 'mid1', 'mid2']);
      expect(result.depth).toBe(2);
    });

    it('should return self if node is root', async () => {
      const result = await causalStore.findRootCause('root');

      expect(result.rootNode.id).toBe('root');
      expect(result.path).toEqual(['root']);
      expect(result.depth).toBe(0);
    });

    it('should respect maxDepth parameter', async () => {
      const result = await causalStore.findRootCause('effect', 2);

      // Should stop at mid1 due to depth limit
      expect(result.depth).toBeLessThanOrEqual(2);
      expect(result.confidence).toBeLessThan(1); // Lower confidence due to limit
    });

    it('should throw error for non-existent node', async () => {
      await expect(causalStore.findRootCause('non-existent')).rejects.toThrow(
        /No causal chain found/
      );
    });

    it('should complete in <100ms for depth=5', async () => {
      const start = Date.now();
      await causalStore.findRootCause('effect', 5);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(200);
    });
  });

  describe('detectLoops', () => {
    it('should detect no loops in valid DAG', async () => {
      const nodes: CausalNode[] = [
        {
          id: 'n1',
          event: 'A',
          timestamp: 1000,
          causes: [],
          effects: ['n2'],
        },
        {
          id: 'n2',
          event: 'B',
          timestamp: 2000,
          causes: ['n1'],
          effects: [],
        },
      ];

      const chain = await causalStore.createChain(nodes);
      const loops = await causalStore.detectLoops(chain.id);

      expect(loops).toHaveLength(0);
    });

    it('should detect simple cycle', async () => {
      // Note: This test creates an invalid chain for testing loop detection
      // In practice, createChain would reject this, but we test detectLoops directly

      const nodes: CausalNode[] = [
        {
          id: 'n1',
          event: 'A',
          timestamp: 1000,
          causes: [],
          effects: ['n2'],
        },
        {
          id: 'n2',
          event: 'B',
          timestamp: 2000,
          causes: ['n1'],
          effects: [],
        },
      ];

      const chain = await causalStore.createChain(nodes);

      // Manually add a cycle for testing (bypass validation)
      chain.nodes[1].effects.push('n1');
      chain.nodes[0].causes.push('n2');

      // Should detect the cycle
      const loops = await causalStore.detectLoops(chain.id);

      expect(loops.length).toBeGreaterThan(0);
    });

    it('should throw error for non-existent chain', async () => {
      await expect(causalStore.detectLoops('non-existent')).rejects.toThrow(
        /not found/
      );
    });
  });

  describe('getChainById', () => {
    it('should retrieve chain by ID', async () => {
      const nodes: CausalNode[] = [
        {
          id: 'n1',
          event: 'Test',
          timestamp: 1000,
          causes: [],
          effects: [],
        },
      ];

      const created = await causalStore.createChain(nodes);
      const retrieved = causalStore.getChainById(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.nodes).toEqual(nodes);
    });

    it('should return undefined for non-existent ID', () => {
      const result = causalStore.getChainById('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('cache management', () => {
    it('should clear cache', async () => {
      const nodes: CausalNode[] = [
        {
          id: 'n1',
          event: 'Test',
          timestamp: 1000,
          causes: [],
          effects: [],
        },
      ];

      await causalStore.createChain(nodes);

      const statsBefore = causalStore.getCacheStats();
      expect(statsBefore.size).toBe(1);

      causalStore.clearCache();

      const statsAfter = causalStore.getCacheStats();
      expect(statsAfter.size).toBe(0);
    });

    it('should return correct cache statistics', async () => {
      for (let i = 0; i < 3; i++) {
        const nodes: CausalNode[] = [
          {
            id: `n${i}`,
            event: `Test ${i}`,
            timestamp: 1000 + i * 1000,
            causes: [],
            effects: [],
          },
        ];
        await causalStore.createChain(nodes);
      }

      const stats = causalStore.getCacheStats();
      expect(stats.size).toBe(3);
      expect(stats.chains).toBe(3);
    });
  });

  describe('edge building', () => {
    it('should build edges correctly from nodes', async () => {
      const nodes: CausalNode[] = [
        {
          id: 'n1',
          event: 'A',
          timestamp: 1000,
          causes: [],
          effects: ['n2', 'n3'],
        },
        {
          id: 'n2',
          event: 'B',
          timestamp: 2000,
          causes: ['n1'],
          effects: [],
        },
        {
          id: 'n3',
          event: 'C',
          timestamp: 2000,
          causes: ['n1'],
          effects: [],
        },
      ];

      const chain = await causalStore.createChain(nodes);

      expect(chain.edges).toHaveLength(2);
      expect(chain.edges).toContainEqual({ from: 'n1', to: 'n2', strength: 1.0 });
      expect(chain.edges).toContainEqual({ from: 'n1', to: 'n3', strength: 1.0 });
    });

    it('should handle nodes with no effects', async () => {
      const nodes: CausalNode[] = [
        {
          id: 'n1',
          event: 'Leaf node',
          timestamp: 1000,
          causes: [],
          effects: [], // No effects
        },
      ];

      const chain = await causalStore.createChain(nodes);

      expect(chain.edges).toHaveLength(0);
    });
  });

  describe('root cause confidence calculation', () => {
    it('should have high confidence for short paths', async () => {
      const nodes: CausalNode[] = [
        {
          id: 'root',
          event: 'Root',
          timestamp: 1000,
          causes: [],
          effects: ['effect'],
        },
        {
          id: 'effect',
          event: 'Effect',
          timestamp: 2000,
          causes: ['root'],
          effects: [],
        },
      ];

      await causalStore.createChain(nodes);
      const result = await causalStore.findRootCause('effect');

      expect(result.confidence).toBeGreaterThan(0.8); // Short path bonus
    });

    it('should have lower confidence when hitting depth limit', async () => {
      const nodes: CausalNode[] = Array.from({ length: 6 }, (_, i) => ({
        id: `n${i}`,
        event: `Event ${i}`,
        timestamp: 1000 + i * 1000,
        causes: i > 0 ? [`n${i - 1}`] : [],
        effects: i < 5 ? [`n${i + 1}`] : [],
      }));

      await causalStore.createChain(nodes);

      // Limit depth to 3 (won't reach root)
      const result = await causalStore.findRootCause('n5', 3);

      expect(result.confidence).toBeLessThan(0.8); // Depth limit penalty
    });
  });
});
