/**
 * Unit Tests for MemoryEngine Core Implementation
 * Tests storage, retrieval, search, and atomic transactions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryEngine } from '../../../../src/god-agent/core/memory/memory-engine.js';
import { VectorDB } from '../../../../src/god-agent/core/vector-db/index.js';
import { GraphDB } from '../../../../src/god-agent/core/graph-db/index.js';
import { MockEmbeddingProvider } from '../../../../src/god-agent/core/memory/embedding-provider.js';
import {
  NamespaceValidationError,
  OrphanNodeError,
  StorageTransactionError
} from '../../../../src/god-agent/core/memory/errors.js';
import type { NodeID } from '../../../../src/god-agent/core/graph-db/index.js';

describe('MemoryEngine', () => {
  let memoryEngine: MemoryEngine;
  let vectorDB: VectorDB;
  let graphDB: GraphDB;
  let embedder: MockEmbeddingProvider;

  beforeEach(async () => {
    vectorDB = new VectorDB();
    graphDB = new GraphDB(undefined, { enablePersistence: false });
    embedder = new MockEmbeddingProvider();
    memoryEngine = new MemoryEngine(vectorDB, graphDB, embedder);
  });

  afterEach(async () => {
    // Cleanup if needed
  });

  describe('store', () => {
    describe('root namespace storage', () => {
      it('should store memory with root namespace (project)', async () => {
        await expect(
          memoryEngine.store('test-key', 'test value', {
            namespace: 'project'
          })
        ).resolves.not.toThrow();
      });

      it('should store memory with root namespace (research)', async () => {
        await expect(
          memoryEngine.store('research-key', 'research data', {
            namespace: 'research'
          })
        ).resolves.not.toThrow();
      });

      it('should store memory with root namespace (patterns)', async () => {
        await expect(
          memoryEngine.store('pattern-key', 'pattern data', {
            namespace: 'patterns'
          })
        ).resolves.not.toThrow();
      });

      it('should not require linkTo for root namespace', async () => {
        await expect(
          memoryEngine.store('key', 'value', {
            namespace: 'project'
            // No linkTo provided
          })
        ).resolves.not.toThrow();
      });
    });

    describe('non-root namespace storage', () => {
      it('should throw OrphanNodeError without linkTo', async () => {
        await expect(
          memoryEngine.store('key', 'value', {
            namespace: 'project/api'
            // Missing linkTo
          })
        ).rejects.toThrow(OrphanNodeError);
      });

      it('should store with linkTo for non-root namespace', async () => {
        // First create a root node
        await memoryEngine.store('root-key', 'root value', {
          namespace: 'project'
        });

        // Retrieve the node ID
        const allNodes = await (graphDB as any).backend.getAllNodes();
        const rootNode = allNodes.find((n: any) => n.properties.key === 'root-key');
        const rootNodeId = rootNode.id as NodeID;

        // Now store with linkTo
        await expect(
          memoryEngine.store('child-key', 'child value', {
            namespace: 'project/api',
            linkTo: rootNodeId
          })
        ).resolves.not.toThrow();
      });

      it('should create edge when linkTo is provided', async () => {
        // Create root node
        await memoryEngine.store('parent', 'parent value', {
          namespace: 'project'
        });

        const allNodes = await (graphDB as any).backend.getAllNodes();
        const parentNode = allNodes.find((n: any) => n.properties.key === 'parent');
        const parentId = parentNode.id as NodeID;

        // Create child with linkTo
        await memoryEngine.store('child', 'child value', {
          namespace: 'project/api',
          linkTo: parentId,
          relation: 'derives_from'
        });

        // Verify edge exists
        const { data: edges } = await graphDB.getEdges(parentId);
        expect(edges.length).toBeGreaterThan(0);
      });
    });

    describe('namespace validation', () => {
      it('should throw NamespaceValidationError for invalid namespace', async () => {
        await expect(
          memoryEngine.store('key', 'value', {
            namespace: 'Invalid_Namespace'
          })
        ).rejects.toThrow(NamespaceValidationError);
      });

      it('should throw for uppercase namespace', async () => {
        await expect(
          memoryEngine.store('key', 'value', {
            namespace: 'Project'
          })
        ).rejects.toThrow(NamespaceValidationError);
      });

      it('should throw for trailing slash', async () => {
        await expect(
          memoryEngine.store('key', 'value', {
            namespace: 'project/'
          })
        ).rejects.toThrow(NamespaceValidationError);
      });

      it('should throw for empty namespace', async () => {
        await expect(
          memoryEngine.store('key', 'value', {
            namespace: ''
          })
        ).rejects.toThrow(NamespaceValidationError);
      });
    });

    describe('linkTo validation', () => {
      it('should throw StorageTransactionError for non-existent linkTo', async () => {
        await expect(
          memoryEngine.store('key', 'value', {
            namespace: 'project/api',
            linkTo: 'non-existent-node-id' as NodeID
          })
        ).rejects.toThrow(StorageTransactionError);
      });

      it('should validate linkTo exists before storing', async () => {
        try {
          await memoryEngine.store('key', 'value', {
            namespace: 'project/api',
            linkTo: 'fake-id' as NodeID
          });
          expect.fail('Should have thrown error');
        } catch (error) {
          expect(error).toBeInstanceOf(StorageTransactionError);
          expect((error as Error).message).toContain('not found');
        }
      });
    });

    describe('value encoding', () => {
      it('should encode values as Base64', async () => {
        await memoryEngine.store('key', 'test value', {
          namespace: 'project'
        });

        const allNodes = await (graphDB as any).backend.getAllNodes();
        const node = allNodes.find((n: any) => n.properties.key === 'key');

        // Value should be Base64 encoded
        expect(node.properties.value).not.toBe('test value');
        expect(typeof node.properties.value).toBe('string');
      });

      it('should encode Unicode correctly', async () => {
        const unicodeValue = '你好世界 🚀';

        await memoryEngine.store('unicode-key', unicodeValue, {
          namespace: 'project'
        });

        // Should not throw and should encode properly
        const retrieved = await memoryEngine.retrieve('unicode-key');
        expect(retrieved).toBe(unicodeValue);
      });
    });

    describe('atomic rollback', () => {
      it('should rollback vector insert on graph failure', async () => {
        // TASK-VEC-001-008: Updated from 768D to 1536D
        // Create a valid search vector
        const searchVector = new Float32Array(1536).fill(1.0 / Math.sqrt(1536));

        // Get initial vector count
        const initialResults = await vectorDB.search(searchVector, 100);
        const initialCount = initialResults.length;

        // Try to store with invalid linkTo (will fail at graph stage)
        try {
          await memoryEngine.store('test', 'value', {
            namespace: 'project/api',
            linkTo: 'invalid-id' as NodeID
          });
        } catch (error) {
          // Expected to fail
        }

        // Vector should be rolled back
        const afterResults = await vectorDB.search(searchVector, 100);
        expect(afterResults.length).toBe(initialCount);
      });
    });

    describe('embedding handling', () => {
      it('should generate embedding if not provided', async () => {
        await memoryEngine.store('key', 'value', {
          namespace: 'project'
        });

        const allNodes = await (graphDB as any).backend.getAllNodes();
        const node = allNodes.find((n: any) => n.properties.key === 'key');

        expect(node.properties.vectorId).toBeTruthy();
      });

      it('should use provided embedding', async () => {
        // TASK-VEC-001-008: Updated from 768D to 1536D
        const customEmbedding = new Float32Array(1536).fill(0.1);
        // Normalize
        const norm = Math.sqrt(1536 * 0.1 * 0.1);
        for (let i = 0; i < 1536; i++) {
          customEmbedding[i] /= norm;
        }

        await memoryEngine.store('key', 'value', {
          namespace: 'project',
          embedding: customEmbedding
        });

        // Should not throw
        const allNodes = await (graphDB as any).backend.getAllNodes();
        const node = allNodes.find((n: any) => n.properties.key === 'key');
        expect(node).toBeTruthy();
      });
    });
  });

  describe('retrieve', () => {
    beforeEach(async () => {
      // Store some test data
      await memoryEngine.store('test-key', 'test value', {
        namespace: 'project'
      });

      // Get first node to link second one
      const allNodes = await (graphDB as any).backend.getAllNodes();
      const firstNode = allNodes.find((n: any) => n.properties.key === 'test-key');

      await memoryEngine.store('other-key', 'other value', {
        namespace: 'research',
        linkTo: firstNode.id as NodeID
      });
    });

    it('should retrieve stored value', async () => {
      const value = await memoryEngine.retrieve('test-key');
      expect(value).toBe('test value');
    });

    it('should return null for non-existent key', async () => {
      const value = await memoryEngine.retrieve('non-existent');
      expect(value).toBeNull();
    });

    it('should decode Base64 correctly', async () => {
      const originalValue = 'Hello, World! 🚀';

      // Get existing node to link to
      const allNodes = await (graphDB as any).backend.getAllNodes();
      const existingNode = allNodes.find((n: any) => n.properties.key === 'test-key');

      await memoryEngine.store('unicode-key', originalValue, {
        namespace: 'project',
        linkTo: existingNode.id as NodeID
      });

      const retrieved = await memoryEngine.retrieve('unicode-key');
      expect(retrieved).toBe(originalValue);
    });

    it('should filter by namespace', async () => {
      const value = await memoryEngine.retrieve('test-key', {
        namespace: 'project'
      });
      expect(value).toBe('test value');

      const wrongNamespace = await memoryEngine.retrieve('test-key', {
        namespace: 'research'
      });
      expect(wrongNamespace).toBeNull();
    });

    it('should retrieve without namespace filter', async () => {
      const value = await memoryEngine.retrieve('test-key', {});
      expect(value).toBe('test value');
    });

    it('should handle special characters in values', async () => {
      const specialValue = '!@#$%^&*()_+-=[]{}|;:",.<>?/~`';

      // Get existing node to link to
      const allNodes = await (graphDB as any).backend.getAllNodes();
      const existingNode = allNodes.find((n: any) => n.properties.key === 'test-key');

      await memoryEngine.store('special', specialValue, {
        namespace: 'project',
        linkTo: existingNode.id as NodeID
      });

      const retrieved = await memoryEngine.retrieve('special');
      expect(retrieved).toBe(specialValue);
    });

    it('should handle JSON strings', async () => {
      const jsonValue = JSON.stringify({ foo: 'bar', nested: { data: [1, 2, 3] } });

      // Get existing node to link to
      const allNodes = await (graphDB as any).backend.getAllNodes();
      const existingNode = allNodes.find((n: any) => n.properties.key === 'test-key');

      await memoryEngine.store('json-key', jsonValue, {
        namespace: 'project',
        linkTo: existingNode.id as NodeID
      });

      const retrieved = await memoryEngine.retrieve('json-key');
      expect(retrieved).toBe(jsonValue);
      expect(JSON.parse(retrieved!)).toEqual({ foo: 'bar', nested: { data: [1, 2, 3] } });
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      // Use deterministic embeddings for consistent testing
      const deterministicEmbedder = new MockEmbeddingProvider();
      memoryEngine = new MemoryEngine(vectorDB, graphDB, deterministicEmbedder);

      // Store test data with deterministic embeddings
      await memoryEngine.store('doc1', 'machine learning algorithms', {
        namespace: 'project',
        embedding: await deterministicEmbedder.embedDeterministic('machine learning algorithms')
      });

      // Get first node to link subsequent ones
      const nodes1 = await (graphDB as any).backend.getAllNodes();
      const doc1Node = nodes1.find((n: any) => n.properties.key === 'doc1');

      await memoryEngine.store('doc2', 'neural networks deep learning', {
        namespace: 'research',
        linkTo: doc1Node.id as NodeID,
        embedding: await deterministicEmbedder.embedDeterministic('neural networks deep learning')
      });

      const nodes2 = await (graphDB as any).backend.getAllNodes();
      const doc2Node = nodes2.find((n: any) => n.properties.key === 'doc2');

      await memoryEngine.store('doc3', 'database optimization techniques', {
        namespace: 'project',
        linkTo: doc2Node.id as NodeID,
        embedding: await deterministicEmbedder.embedDeterministic('database optimization techniques')
      });
    });

    it('should return results sorted by similarity', async () => {
      const results = await memoryEngine.search('machine learning', { limit: 10 });

      expect(results.length).toBeGreaterThan(0);

      // Verify descending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('should filter by namespace', async () => {
      const results = await memoryEngine.search('learning', {
        namespace: 'project',
        limit: 10
      });

      for (const result of results) {
        expect(result.namespace).toBe('project');
      }
    });

    it('should respect limit parameter', async () => {
      const results = await memoryEngine.search('machine learning', { limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should include all result fields', async () => {
      const results = await memoryEngine.search('learning', { limit: 1 });

      expect(results.length).toBeGreaterThan(0);
      const result = results[0];

      expect(result).toHaveProperty('key');
      expect(result).toHaveProperty('value');
      expect(result).toHaveProperty('namespace');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('nodeId');

      expect(typeof result.key).toBe('string');
      expect(typeof result.value).toBe('string');
      expect(typeof result.namespace).toBe('string');
      expect(typeof result.score).toBe('number');
    });

    it('should filter by minimum score', async () => {
      const results = await memoryEngine.search('learning', {
        minScore: 0.5,
        limit: 10
      });

      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0.5);
      }
    });

    it('should decode values in results', async () => {
      const results = await memoryEngine.search('machine learning', { limit: 1 });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].value).not.toMatch(/^[A-Za-z0-9+/]*={0,2}$/); // Not Base64
      expect(results[0].value).toBeTruthy();
    });

    it('should handle empty results', async () => {
      const results = await memoryEngine.search('completely unrelated query xyz123', {
        minScore: 0.99,
        limit: 10
      });

      expect(Array.isArray(results)).toBe(true);
    });

    it('should default limit to 10', async () => {
      const results = await memoryEngine.search('learning');
      expect(results.length).toBeLessThanOrEqual(10);
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete store-retrieve-search workflow', async () => {
      // Store
      await memoryEngine.store('workflow-key', 'workflow data', {
        namespace: 'project'
      });

      // Retrieve
      const retrieved = await memoryEngine.retrieve('workflow-key');
      expect(retrieved).toBe('workflow data');

      // Search
      const results = await memoryEngine.search('workflow', { limit: 5 });
      const found = results.find(r => r.key === 'workflow-key');
      expect(found).toBeTruthy();
      expect(found?.value).toBe('workflow data');
    });

    it('should handle multiple namespaces', async () => {
      await memoryEngine.store('proj1', 'project data', {
        namespace: 'project'
      });

      const nodes1 = await (graphDB as any).backend.getAllNodes();
      const proj1Node = nodes1.find((n: any) => n.properties.key === 'proj1');

      await memoryEngine.store('res1', 'research data', {
        namespace: 'research',
        linkTo: proj1Node.id as NodeID
      });

      const nodes2 = await (graphDB as any).backend.getAllNodes();
      const res1Node = nodes2.find((n: any) => n.properties.key === 'res1');

      await memoryEngine.store('pat1', 'pattern data', {
        namespace: 'patterns',
        linkTo: res1Node.id as NodeID
      });

      const projResults = await memoryEngine.search('data', {
        namespace: 'project',
        limit: 10
      });

      const resResults = await memoryEngine.search('data', {
        namespace: 'research',
        limit: 10
      });

      expect(projResults.every(r => r.namespace === 'project')).toBe(true);
      expect(resResults.every(r => r.namespace === 'research')).toBe(true);
    });

    it('should handle linked memories', async () => {
      // Create parent
      await memoryEngine.store('parent', 'parent value', {
        namespace: 'project'
      });

      // Get parent node ID
      const allNodes = await (graphDB as any).backend.getAllNodes();
      const parentNode = allNodes.find((n: any) => n.properties.key === 'parent');
      const parentId = parentNode.id as NodeID;

      // Create linked child
      await memoryEngine.store('child', 'child value', {
        namespace: 'project/api',
        linkTo: parentId,
        relation: 'derives_from'
      });

      // Both should be retrievable
      expect(await memoryEngine.retrieve('parent')).toBe('parent value');
      expect(await memoryEngine.retrieve('child')).toBe('child value');
    });
  });
});
