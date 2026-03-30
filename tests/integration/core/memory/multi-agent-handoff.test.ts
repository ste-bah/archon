/**
 * Integration Tests for Multi-Agent Memory Handoff
 * Tests memory sharing and coordination between agents
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryEngine } from '../../../../src/god-agent/core/memory/memory-engine.js';
import { VectorDB } from '../../../../src/god-agent/core/vector-db/index.js';
import { GraphDB } from '../../../../src/god-agent/core/graph-db/index.js';
import { MockEmbeddingProvider } from '../../../../src/god-agent/core/memory/embedding-provider.js';
import type { NodeID } from '../../../../src/god-agent/core/graph-db/index.js';

describe('Multi-Agent Memory Handoff', () => {
  let vectorDB: VectorDB;
  let graphDB: GraphDB;
  let embedder: MockEmbeddingProvider;

  // Simulate multiple agent memory engines sharing same databases
  let agentAMemory: MemoryEngine;
  let agentBMemory: MemoryEngine;
  let agentCMemory: MemoryEngine;

  beforeEach(async () => {
    // Shared infrastructure
    vectorDB = new VectorDB();
    graphDB = new GraphDB(undefined, { enablePersistence: false });
    embedder = new MockEmbeddingProvider();

    // Each agent has their own MemoryEngine instance but shares databases
    agentAMemory = new MemoryEngine(vectorDB, graphDB, embedder);
    agentBMemory = new MemoryEngine(vectorDB, graphDB, embedder);
    agentCMemory = new MemoryEngine(vectorDB, graphDB, embedder);
  });

  describe('basic handoff', () => {
    it('should allow Agent A to store and Agent B to retrieve', async () => {
      // Agent A stores memory
      await agentAMemory.store('shared-key', 'data from agent A', {
        namespace: 'project'
      });

      // Agent B retrieves it
      const value = await agentBMemory.retrieve('shared-key');
      expect(value).toBe('data from agent A');
    });

    it('should preserve data integrity across agents', async () => {
      const complexData = JSON.stringify({
        agent: 'A',
        task: 'analysis',
        results: [1, 2, 3, 4, 5],
        metadata: { timestamp: Date.now(), status: 'complete' }
      });

      await agentAMemory.store('complex-data', complexData, {
        namespace: 'project'
      });

      const retrieved = await agentBMemory.retrieve('complex-data');
      expect(retrieved).toBe(complexData);
      expect(JSON.parse(retrieved!)).toEqual(JSON.parse(complexData));
    });

    it('should handle Unicode and emojis across agents', async () => {
      const unicodeData = '你好 🚀 مرحبا Привет';

      await agentAMemory.store('unicode', unicodeData, {
        namespace: 'research'
      });

      const retrieved = await agentCMemory.retrieve('unicode');
      expect(retrieved).toBe(unicodeData);
    });
  });

  describe('memory linking across agents', () => {
    it('should allow Agent B to link to Agent A\'s memory', async () => {
      // Agent A creates root memory
      await agentAMemory.store('requirement', 'Build user authentication system', {
        namespace: 'project'
      });

      // Get the node ID
      const allNodes = await (graphDB as any).backend.getAllNodes();
      const reqNode = allNodes.find((n: any) => n.properties.key === 'requirement');
      const reqNodeId = reqNode.id as NodeID;

      // Agent B creates design linked to requirement
      await agentBMemory.store('design', 'JWT-based authentication with refresh tokens', {
        namespace: 'project/design',
        linkTo: reqNodeId,
        relation: 'derives_from'
      });

      // Both memories should be retrievable
      const requirement = await agentAMemory.retrieve('requirement');
      const design = await agentBMemory.retrieve('design');

      expect(requirement).toBe('Build user authentication system');
      expect(design).toBe('JWT-based authentication with refresh tokens');
    });

    it('should support multi-level agent handoffs', async () => {
      // Agent A: Requirements
      await agentAMemory.store('req', 'API endpoint requirements', {
        namespace: 'project'
      });

      const allNodes1 = await (graphDB as any).backend.getAllNodes();
      const reqNode = allNodes1.find((n: any) => n.properties.key === 'req');
      const reqId = reqNode.id as NodeID;

      // Agent B: Design
      await agentBMemory.store('design', 'REST API design', {
        namespace: 'project/design',
        linkTo: reqId,
        relation: 'derives_from'
      });

      const allNodes2 = await (graphDB as any).backend.getAllNodes();
      const designNode = allNodes2.find((n: any) => n.properties.key === 'design');
      const designId = designNode.id as NodeID;

      // Agent C: Implementation
      await agentCMemory.store('impl', 'Express.js implementation', {
        namespace: 'project/design/impl',
        linkTo: designId,
        relation: 'derives_from'
      });

      // All should be retrievable
      expect(await agentAMemory.retrieve('req')).toBe('API endpoint requirements');
      expect(await agentBMemory.retrieve('design')).toBe('REST API design');
      expect(await agentCMemory.retrieve('impl')).toBe('Express.js implementation');
    });

    it('should track different relation types', async () => {
      // Agent A creates base knowledge
      await agentAMemory.store('fact', 'JWT tokens expire after 1 hour', {
        namespace: 'research'
      });

      const allNodes = await (graphDB as any).backend.getAllNodes();
      const factNode = allNodes.find((n: any) => n.properties.key === 'fact');
      const factId = factNode.id as NodeID;

      // Agent B adds supporting evidence
      await agentBMemory.store('evidence', 'RFC 7519 recommends short-lived tokens', {
        namespace: 'research/evidence',
        linkTo: factId,
        relation: 'supports'
      });

      // Agent C adds contradicting info
      await agentCMemory.store('alt-view', 'Some systems use 24-hour tokens', {
        namespace: 'research/alternative',
        linkTo: factId,
        relation: 'contradicts'
      });

      // Verify all stored correctly
      expect(await agentAMemory.retrieve('fact')).toBeTruthy();
      expect(await agentBMemory.retrieve('evidence')).toBeTruthy();
      expect(await agentCMemory.retrieve('alt-view')).toBeTruthy();
    });
  });

  describe('namespace isolation', () => {
    it('should isolate memories by namespace', async () => {
      // Agent A stores in project namespace
      await agentAMemory.store('key1', 'project data', {
        namespace: 'project'
      });

      // Get first node to link the second
      const allNodes = await (graphDB as any).backend.getAllNodes();
      const firstNode = allNodes.find((n: any) => n.properties.key === 'key1');

      // Agent B stores in research namespace
      await agentBMemory.store('key1', 'research data', {
        namespace: 'research',
        linkTo: firstNode.id as NodeID
      });

      // Retrieve with namespace filter
      const projectData = await agentCMemory.retrieve('key1', {
        namespace: 'project'
      });

      const researchData = await agentCMemory.retrieve('key1', {
        namespace: 'research'
      });

      expect(projectData).toBe('project data');
      expect(researchData).toBe('research data');
    });

    it('should search within namespace boundaries', async () => {
      // Agent A stores project memories
      await agentAMemory.store('proj-task1', 'Build login page', {
        namespace: 'project'
      });

      const nodes1 = await (graphDB as any).backend.getAllNodes();
      const task1Node = nodes1.find((n: any) => n.properties.key === 'proj-task1');

      await agentAMemory.store('proj-task2', 'Create dashboard', {
        namespace: 'project',
        linkTo: task1Node.id as NodeID
      });

      const nodes2 = await (graphDB as any).backend.getAllNodes();
      const task2Node = nodes2.find((n: any) => n.properties.key === 'proj-task2');

      // Agent B stores research memories
      await agentBMemory.store('res-paper1', 'Authentication research', {
        namespace: 'research',
        linkTo: task2Node.id as NodeID
      });

      // Agent C searches only project namespace
      const projectResults = await agentCMemory.search('page dashboard', {
        namespace: 'project',
        limit: 10
      });

      expect(projectResults.every(r => r.namespace === 'project')).toBe(true);
      expect(projectResults.length).toBeGreaterThan(0);
    });
  });

  describe('concurrent access', () => {
    it('should handle concurrent stores from multiple agents', async () => {
      // First node (no linkTo required)
      await agentAMemory.store('agent-a-1', 'Data from A1', { namespace: 'project' });

      const nodes1 = await (graphDB as any).backend.getAllNodes();
      const a1Node = nodes1.find((n: any) => n.properties.key === 'agent-a-1');

      // All others must link
      await Promise.all([
        agentAMemory.store('agent-a-2', 'Data from A2', { namespace: 'project', linkTo: a1Node.id as NodeID }),
        agentBMemory.store('agent-b-1', 'Data from B1', { namespace: 'research', linkTo: a1Node.id as NodeID }),
        agentBMemory.store('agent-b-2', 'Data from B2', { namespace: 'research', linkTo: a1Node.id as NodeID }),
        agentCMemory.store('agent-c-1', 'Data from C1', { namespace: 'patterns', linkTo: a1Node.id as NodeID }),
        agentCMemory.store('agent-c-2', 'Data from C2', { namespace: 'patterns', linkTo: a1Node.id as NodeID })
      ]);

      // Verify all stored correctly
      expect(await agentAMemory.retrieve('agent-a-1')).toBe('Data from A1');
      expect(await agentBMemory.retrieve('agent-b-1')).toBe('Data from B1');
      expect(await agentCMemory.retrieve('agent-c-1')).toBe('Data from C1');
    });

    it('should handle concurrent searches', async () => {
      // Store test data
      await agentAMemory.store('doc1', 'machine learning concepts', {
        namespace: 'project'
      });

      const nodes = await (graphDB as any).backend.getAllNodes();
      const doc1Node = nodes.find((n: any) => n.properties.key === 'doc1');

      await agentBMemory.store('doc2', 'deep learning techniques', {
        namespace: 'research',
        linkTo: doc1Node.id as NodeID
      });

      // Concurrent searches
      const [resultsA, resultsB, resultsC] = await Promise.all([
        agentAMemory.search('learning', { limit: 5 }),
        agentBMemory.search('learning', { limit: 5 }),
        agentCMemory.search('learning', { limit: 5 })
      ]);

      // All should return results
      expect(resultsA.length).toBeGreaterThan(0);
      expect(resultsB.length).toBeGreaterThan(0);
      expect(resultsC.length).toBeGreaterThan(0);
    });
  });

  describe('workflow simulation', () => {
    it('should support planning → design → implementation → testing workflow', async () => {
      // Planning Agent: Define requirements
      await agentAMemory.store('requirements', 'User authentication with OAuth2', {
        namespace: 'project'
      });

      const nodes1 = await (graphDB as any).backend.getAllNodes();
      const reqNode = nodes1.find((n: any) => n.properties.key === 'requirements');
      const reqId = reqNode.id as NodeID;

      // Design Agent: Create technical design
      await agentBMemory.store('design', 'OAuth2 Authorization Code Flow with PKCE', {
        namespace: 'project/design',
        linkTo: reqId,
        relation: 'derives_from'
      });

      const nodes2 = await (graphDB as any).backend.getAllNodes();
      const designNode = nodes2.find((n: any) => n.properties.key === 'design');
      const designId = designNode.id as NodeID;

      // Implementation Agent: Write code reference
      await agentCMemory.store('implementation', 'Implemented using Passport.js library', {
        namespace: 'project/design/code',
        linkTo: designId,
        relation: 'derives_from'
      });

      const nodes3 = await (graphDB as any).backend.getAllNodes();
      const implNode = nodes3.find((n: any) => n.properties.key === 'implementation');
      const implId = implNode.id as NodeID;

      // Testing Agent: Document test results
      await agentAMemory.store('tests', 'All OAuth2 flows tested successfully', {
        namespace: 'project/design/code/tests',
        linkTo: implId,
        relation: 'supports'
      });

      // Verify complete chain
      expect(await agentAMemory.retrieve('requirements')).toBeTruthy();
      expect(await agentBMemory.retrieve('design')).toBeTruthy();
      expect(await agentCMemory.retrieve('implementation')).toBeTruthy();
      expect(await agentAMemory.retrieve('tests')).toBeTruthy();

      // Search should find related concepts
      const results = await agentBMemory.search('OAuth2 authentication', {
        limit: 10
      });
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('error handling across agents', () => {
    it('should prevent orphan nodes from any agent', async () => {
      // Any agent should fail to create orphan in non-root namespace
      await expect(
        agentAMemory.store('orphan1', 'data', {
          namespace: 'project/api'
        })
      ).rejects.toThrow();

      await expect(
        agentBMemory.store('orphan2', 'data', {
          namespace: 'research/papers'
        })
      ).rejects.toThrow();
    });

    it('should validate namespaces consistently across agents', async () => {
      const invalidNamespace = 'Invalid_Namespace';

      await expect(
        agentAMemory.store('key', 'value', {
          namespace: invalidNamespace
        })
      ).rejects.toThrow();

      await expect(
        agentBMemory.store('key', 'value', {
          namespace: invalidNamespace
        })
      ).rejects.toThrow();
    });
  });
});
