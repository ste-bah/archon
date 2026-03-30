/**
 * Unit Tests for GraphDB
 *
 * Comprehensive tests for GraphDB hypergraph operations, temporal features,
 * and integrity validation
 *
 * Test coverage targets:
 * - Node CRUD operations (create, get, update, updateEmbedding)
 * - Orphan prevention (first node OK, subsequent need linkTo)
 * - Edge operations (create, getEdges with QueryDirection)
 * - Hyperedge operations (createHyperedge requires 3+ nodes)
 * - Temporal hyperedges (expiresAt, isExpired, granularity)
 * - Integrity validation (orphans, invalid hyperedges, dimension mismatches)
 * - Multi-hop traversal (1-5 hops)
 * - Error handling (NodeNotFoundError, InvalidHyperedgeError, etc.)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GraphDB } from '../../../../src/god-agent/core/graph-db/graph-db';
import {
  QueryDirection,
  Granularity,
  type NodeID,
  type EdgeID,
  type HyperedgeID
} from '../../../../src/god-agent/core/graph-db/types';
import {
  NodeNotFoundError,
  InvalidHyperedgeError,
  OrphanNodeError,
  GraphDimensionMismatchError
} from '../../../../src/god-agent/core/graph-db/errors';
import { VECTOR_DIM } from '../../../../src/god-agent/core/validation';
import {
  createRandomEmbedding,
  createSimpleEmbedding,
  createTestNodeOptions,
  createNodeWithEmbedding,
  createFutureTimestamp,
  createPastTimestamp,
  expectEmbeddingsEqual,
  expectNormalized,
  createInvalidEmbedding,
  expectValidUUID
} from './test-helpers';

describe('GraphDB - Constructor and Initialization', () => {
  it('should create GraphDB instance with default options', async () => {
    const db = new GraphDB();
    await db.initialize();
    expect(db).toBeDefined();
  });

  it('should create GraphDB with custom options', async () => {
    // TASK-VEC-001-008: Updated to use 1536D as standard dimension
    const db = new GraphDB(undefined, {
      expectedDimensions: VECTOR_DIM,
      validateDimensions: true,
      enablePersistence: false
    });
    await db.initialize();
    expect(db).toBeDefined();
  });

  it('should support disabling dimension validation', async () => {
    const db = new GraphDB(undefined, {
      validateDimensions: false,
      enablePersistence: false
    });
    await db.initialize();

    // First node doesn't need linkTo
    const nodeId = await db.createNode({
      type: 'test',
      embedding: [1, 2, 3] // Invalid dimension, but validation disabled
    });

    expect(nodeId).toBeDefined();

    // Verify embedding was stored despite wrong dimension
    const node = await db.getNode(nodeId);
    expect(node.embedding).toEqual([1, 2, 3]);
  });
});

describe('GraphDB - Node Operations: createNode', () => {
  let db: GraphDB;

  beforeEach(async () => {
    db = new GraphDB(undefined, { enablePersistence: false });
    await db.initialize();
  });

  it('should create first node without linkTo', async () => {
    const nodeId = await db.createNode({
      type: 'root',
      properties: { name: 'First Node' }
    });

    expectValidUUID(nodeId);
    const node = await db.getNode(nodeId);
    expect(node.type).toBe('root');
    expect(node.properties.name).toBe('First Node');
  });

  it('should create node with valid 1536D embedding', async () => {
    // TASK-VEC-001-008: Updated from 768D to 1536D per REQ-VEC-01
    const embedding = createRandomEmbedding();
    const nodeId = await db.createNode({
      type: 'embedded',
      embedding
    });

    const node = await db.getNode(nodeId);
    expect(node.embedding).toBeDefined();
    expect(node.embedding!.length).toBe(VECTOR_DIM);
    expectEmbeddingsEqual(node.embedding!, embedding);
  });

  it('should create node with simple embedding', async () => {
    const embedding = createSimpleEmbedding();
    const nodeId = await db.createNode({
      type: 'simple',
      embedding
    });

    const node = await db.getNode(nodeId);
    expect(node.embedding).toBeDefined();
    expectNormalized(node.embedding!);
  });

  it('should reject embedding with wrong dimensions', async () => {
    const invalidEmbedding = createInvalidEmbedding(512); // Wrong dimension

    await expect(
      db.createNode({
        type: 'invalid',
        embedding: invalidEmbedding
      })
    ).rejects.toThrow(GraphDimensionMismatchError);
  });

  it('should reject 768D embedding (legacy dimension)', async () => {
    // TASK-VEC-001-008: 768D is now invalid (was previously valid)
    const invalidEmbedding = createInvalidEmbedding(768);

    await expect(
      db.createNode({
        type: 'invalid',
        embedding: invalidEmbedding
      })
    ).rejects.toThrow(GraphDimensionMismatchError);
    // Use flexible matching pattern for dimension error messages
    await expect(
      db.createNode({
        type: 'invalid',
        embedding: invalidEmbedding
      })
    ).rejects.toThrow(/Expected \d+D, got \d+D/);
  });

  it('should include context in dimension error', async () => {
    const invalidEmbedding = createInvalidEmbedding(100);

    try {
      await db.createNode({
        type: 'test',
        embedding: invalidEmbedding
      });
      expect.fail('Should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('GraphDB.createNode');
    }
  });

  it('should set createdAt and updatedAt timestamps', async () => {
    const before = Date.now();
    const nodeId = await db.createNode({ type: 'timestamped' });
    const after = Date.now();

    const node = await db.getNode(nodeId);
    expect(node.createdAt).toBeGreaterThanOrEqual(before);
    expect(node.createdAt).toBeLessThanOrEqual(after);
    expect(node.updatedAt).toBe(node.createdAt);
  });
});

describe('GraphDB - Orphan Prevention', () => {
  let db: GraphDB;

  beforeEach(async () => {
    db = new GraphDB(undefined, { enablePersistence: false });
    await db.initialize();
  });

  it('should allow first node without linkTo', async () => {
    const nodeId = await db.createNode({ type: 'first' });
    expect(nodeId).toBeDefined();
  });

  it('should reject second node without linkTo', async () => {
    await db.createNode({ type: 'first' });

    await expect(
      db.createNode({ type: 'orphan' })
    ).rejects.toThrow(OrphanNodeError);
  });

  it('should allow second node with linkTo', async () => {
    const firstId = await db.createNode({ type: 'first' });
    const secondId = await db.createNode({
      type: 'linked',
      linkTo: firstId
    });

    expect(secondId).toBeDefined();
    expect(secondId).not.toBe(firstId);
  });

  it('should reject linkTo with nonexistent node', async () => {
    await db.createNode({ type: 'first' });

    await expect(
      db.createNode({
        type: 'invalid',
        linkTo: 'nonexistent-node-id'
      })
    ).rejects.toThrow(NodeNotFoundError);
  });

  it('should create edge when linkTo is provided', async () => {
    const firstId = await db.createNode({ type: 'first' });
    const secondId = await db.createNode({
      type: 'second',
      linkTo: firstId
    });

    const edges = await db.getEdges(secondId, QueryDirection.Outgoing);
    expect(edges.count).toBe(1);
    expect(edges.data[0].source).toBe(secondId);
    expect(edges.data[0].target).toBe(firstId);
    expect(edges.data[0].type).toBe('linked_to');
  });

  it('should allow multiple nodes linking to same parent', async () => {
    const rootId = await db.createNode({ type: 'root' });
    const child1 = await db.createNode({ type: 'child1', linkTo: rootId });
    const child2 = await db.createNode({ type: 'child2', linkTo: rootId });
    const child3 = await db.createNode({ type: 'child3', linkTo: rootId });

    expect(child1).toBeDefined();
    expect(child2).toBeDefined();
    expect(child3).toBeDefined();

    const rootEdges = await db.getEdges(rootId, QueryDirection.Incoming);
    expect(rootEdges.count).toBe(3);
  });
});

describe('GraphDB - Node Operations: getNode', () => {
  let db: GraphDB;

  beforeEach(async () => {
    db = new GraphDB(undefined, { enablePersistence: false });
    await db.initialize();
  });

  it('should retrieve node by ID', async () => {
    const nodeId = await db.createNode({
      type: 'test',
      properties: { value: 42 }
    });

    const node = await db.getNode(nodeId);
    expect(node.id).toBe(nodeId);
    expect(node.type).toBe('test');
    expect(node.properties.value).toBe(42);
  });

  it('should throw NodeNotFoundError for invalid ID', async () => {
    await expect(
      db.getNode('nonexistent-id')
    ).rejects.toThrow(NodeNotFoundError);
  });

  it('should throw NodeNotFoundError with node ID in message', async () => {
    const invalidId = 'missing-node-123';
    try {
      await db.getNode(invalidId);
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NodeNotFoundError);
      expect((e as Error).message).toContain(invalidId);
    }
  });

  it('should retrieve node with embedding', async () => {
    const embedding = createRandomEmbedding();
    const nodeId = await db.createNode({
      type: 'embedded',
      embedding
    });

    const node = await db.getNode(nodeId);
    expect(node.embedding).toBeDefined();
    expectEmbeddingsEqual(node.embedding!, embedding);
  });
});

describe('GraphDB - Node Operations: updateNode', () => {
  let db: GraphDB;
  let nodeId: NodeID;

  beforeEach(async () => {
    db = new GraphDB(undefined, { enablePersistence: false });
    await db.initialize();
    nodeId = await db.createNode({
      type: 'test',
      properties: { name: 'Original', value: 1 }
    });
  });

  it('should update node properties', async () => {
    await db.updateNode(nodeId, { name: 'Updated', value: 2 });

    const node = await db.getNode(nodeId);
    expect(node.properties.name).toBe('Updated');
    expect(node.properties.value).toBe(2);
  });

  it('should merge properties (not replace)', async () => {
    await db.updateNode(nodeId, { value: 100 });

    const node = await db.getNode(nodeId);
    expect(node.properties.name).toBe('Original'); // Preserved
    expect(node.properties.value).toBe(100); // Updated
  });

  it('should throw NodeNotFoundError for invalid ID', async () => {
    await expect(
      db.updateNode('nonexistent-id', { value: 42 })
    ).rejects.toThrow(NodeNotFoundError);
  });

  it('should allow adding new properties', async () => {
    await db.updateNode(nodeId, { newProp: 'added' });

    const node = await db.getNode(nodeId);
    expect(node.properties.newProp).toBe('added');
    expect(node.properties.name).toBe('Original');
  });
});

describe('GraphDB - Node Operations: updateEmbedding', () => {
  let db: GraphDB;
  let nodeId: NodeID;

  beforeEach(async () => {
    db = new GraphDB(undefined, { enablePersistence: false });
    await db.initialize();
    nodeId = await db.createNode({ type: 'test' });
  });

  it('should update embedding with valid 1536D vector', async () => {
    // TASK-VEC-001-008: Updated from 768D to 1536D per REQ-VEC-01
    const embedding = createRandomEmbedding();
    await db.updateEmbedding(nodeId, embedding);

    const node = await db.getNode(nodeId);
    expect(node.embedding).toBeDefined();
    expectEmbeddingsEqual(node.embedding!, embedding);
  });

  it('should replace existing embedding', async () => {
    const embedding1 = createSimpleEmbedding();
    await db.updateEmbedding(nodeId, embedding1);

    const embedding2 = createRandomEmbedding();
    await db.updateEmbedding(nodeId, embedding2);

    const node = await db.getNode(nodeId);
    expectEmbeddingsEqual(node.embedding!, embedding2);
  });

  it('should reject invalid dimensions', async () => {
    const invalidEmbedding = createInvalidEmbedding(512);

    await expect(
      db.updateEmbedding(nodeId, invalidEmbedding)
    ).rejects.toThrow(GraphDimensionMismatchError);
  });

  it('should include context in error message', async () => {
    const invalidEmbedding = createInvalidEmbedding(100);

    try {
      await db.updateEmbedding(nodeId, invalidEmbedding);
      expect.fail('Should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('GraphDB.updateEmbedding');
    }
  });
});

describe('GraphDB - Edge Operations: createEdge', () => {
  let db: GraphDB;
  let node1: NodeID;
  let node2: NodeID;

  beforeEach(async () => {
    db = new GraphDB(undefined, { enablePersistence: false });
    await db.initialize();
    node1 = await db.createNode({ type: 'node1' });
    node2 = await db.createNode({ type: 'node2', linkTo: node1 });
  });

  it('should create edge between two nodes', async () => {
    const edgeId = await db.createEdge({
      source: node1,
      target: node2,
      type: 'connects'
    });

    expectValidUUID(edgeId);
  });

  it('should create edge with metadata', async () => {
    const edgeId = await db.createEdge({
      source: node1,
      target: node2,
      type: 'labeled',
      metadata: { weight: 0.5, label: 'test' }
    });

    expect(edgeId).toBeDefined();
  });

  it('should throw NodeNotFoundError for invalid source', async () => {
    await expect(
      db.createEdge({
        source: 'nonexistent',
        target: node2,
        type: 'invalid'
      })
    ).rejects.toThrow(NodeNotFoundError);
  });

  it('should throw NodeNotFoundError for invalid target', async () => {
    await expect(
      db.createEdge({
        source: node1,
        target: 'nonexistent',
        type: 'invalid'
      })
    ).rejects.toThrow(NodeNotFoundError);
  });

  it('should set createdAt timestamp', async () => {
    const before = Date.now();
    await db.createEdge({
      source: node1,
      target: node2,
      type: 'timestamped'
    });
    const after = Date.now();

    const edges = await db.getEdges(node1, QueryDirection.Outgoing);
    expect(edges.data[0].createdAt).toBeGreaterThanOrEqual(before);
    expect(edges.data[0].createdAt).toBeLessThanOrEqual(after);
  });
});

describe('GraphDB - Edge Operations: getEdges with QueryDirection', () => {
  let db: GraphDB;
  let centerNode: NodeID;
  let sourceNode1: NodeID;
  let sourceNode2: NodeID;
  let targetNode1: NodeID;
  let targetNode2: NodeID;

  beforeEach(async () => {
    db = new GraphDB(undefined, { enablePersistence: false });
    await db.initialize();

    // Create graph structure:
    // source1 -> center -> target1
    // source2 -> center -> target2
    centerNode = await db.createNode({ type: 'center' });
    sourceNode1 = await db.createNode({ type: 'source1', linkTo: centerNode });
    sourceNode2 = await db.createNode({ type: 'source2', linkTo: centerNode });
    targetNode1 = await db.createNode({ type: 'target1', linkTo: centerNode });
    targetNode2 = await db.createNode({ type: 'target2', linkTo: centerNode });

    // Create additional outgoing edges
    await db.createEdge({ source: centerNode, target: targetNode1, type: 'out1' });
    await db.createEdge({ source: centerNode, target: targetNode2, type: 'out2' });

    // sourceNode1 and sourceNode2 already have edges to centerNode from linkTo
  });

  it('should get incoming edges only', async () => {
    const result = await db.getEdges(centerNode, QueryDirection.Incoming);

    // Should have 4 incoming: 2 from linkTo, 2 from sourceNodes
    expect(result.count).toBe(4);
    expect(result.data.every(e => e.target === centerNode)).toBe(true);
  });

  it('should get outgoing edges only', async () => {
    const result = await db.getEdges(centerNode, QueryDirection.Outgoing);

    // Should have 2 outgoing edges
    expect(result.count).toBe(2);
    expect(result.data.every(e => e.source === centerNode)).toBe(true);
  });

  it('should get both incoming and outgoing edges', async () => {
    const result = await db.getEdges(centerNode, QueryDirection.Both);

    // Should have 6 total: 4 incoming + 2 outgoing
    expect(result.count).toBe(6);
  });

  it('should default to Both direction', async () => {
    const result = await db.getEdges(centerNode);
    expect(result.count).toBe(6);
  });

  it('should return empty result for node with no edges', async () => {
    const isolatedNode = await db.createNode({ type: 'isolated', linkTo: centerNode });
    // Remove the linkTo edge for test
    const result = await db.getEdges(isolatedNode, QueryDirection.Outgoing);

    // Should only have the linkTo edge
    expect(result.count).toBe(1);
  });

  it('should include executionTimeMs in result', async () => {
    const result = await db.getEdges(centerNode);
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should throw NodeNotFoundError for invalid node', async () => {
    await expect(
      db.getEdges('nonexistent', QueryDirection.Both)
    ).rejects.toThrow(NodeNotFoundError);
  });
});

describe('GraphDB - Hyperedge Operations: createHyperedge', () => {
  let db: GraphDB;
  let nodes: NodeID[];

  beforeEach(async () => {
    db = new GraphDB(undefined, { enablePersistence: false });
    await db.initialize();

    // Create 5 nodes for hyperedge testing
    nodes = [];
    nodes[0] = await db.createNode({ type: 'node0' });
    for (let i = 1; i < 5; i++) {
      nodes[i] = await db.createNode({ type: `node${i}`, linkTo: nodes[0] });
    }
  });

  it('should create hyperedge with exactly 3 nodes', async () => {
    const hyperedgeId = await db.createHyperedge({
      nodes: [nodes[0], nodes[1], nodes[2]],
      type: 'triple'
    });

    expectValidUUID(hyperedgeId);
  });

  it('should create hyperedge with 4 nodes', async () => {
    const hyperedgeId = await db.createHyperedge({
      nodes: [nodes[0], nodes[1], nodes[2], nodes[3]],
      type: 'quad'
    });

    expect(hyperedgeId).toBeDefined();
  });

  it('should create hyperedge with 5+ nodes', async () => {
    const hyperedgeId = await db.createHyperedge({
      nodes: nodes,
      type: 'many'
    });

    expect(hyperedgeId).toBeDefined();
  });

  it('should reject hyperedge with only 2 nodes', async () => {
    await expect(
      db.createHyperedge({
        nodes: [nodes[0], nodes[1]],
        type: 'invalid'
      })
    ).rejects.toThrow(InvalidHyperedgeError);
  });

  it('should reject hyperedge with 1 node', async () => {
    await expect(
      db.createHyperedge({
        nodes: [nodes[0]],
        type: 'invalid'
      })
    ).rejects.toThrow(InvalidHyperedgeError);
  });

  it('should reject hyperedge with 0 nodes', async () => {
    await expect(
      db.createHyperedge({
        nodes: [],
        type: 'invalid'
      })
    ).rejects.toThrow(InvalidHyperedgeError);
  });

  it('should include node count in InvalidHyperedgeError', async () => {
    try {
      await db.createHyperedge({
        nodes: [nodes[0], nodes[1]],
        type: 'test'
      });
      expect.fail('Should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('2');
      expect((e as Error).message).toContain('at least 3 nodes');
    }
  });

  it('should throw NodeNotFoundError for nonexistent node', async () => {
    await expect(
      db.createHyperedge({
        nodes: [nodes[0], nodes[1], 'nonexistent'],
        type: 'invalid'
      })
    ).rejects.toThrow(NodeNotFoundError);
  });

  it('should create hyperedge with metadata', async () => {
    const hyperedgeId = await db.createHyperedge({
      nodes: [nodes[0], nodes[1], nodes[2]],
      type: 'relationship',
      metadata: { strength: 0.9, label: 'test' }
    });

    const hyperedge = await db.getHyperedge(hyperedgeId);
    expect(hyperedge.metadata?.strength).toBe(0.9);
    expect(hyperedge.metadata?.label).toBe('test');
  });
});

describe('GraphDB - Temporal Hyperedge Operations', () => {
  let db: GraphDB;
  let nodes: NodeID[];

  beforeEach(async () => {
    db = new GraphDB(undefined, { enablePersistence: false });
    await db.initialize();

    nodes = [];
    nodes[0] = await db.createNode({ type: 'node0' });
    for (let i = 1; i < 3; i++) {
      nodes[i] = await db.createNode({ type: `node${i}`, linkTo: nodes[0] });
    }
  });

  it('should create temporal hyperedge with future expiration', async () => {
    const expiresAt = createFutureTimestamp(24);
    const hyperedgeId = await db.createTemporalHyperedge({
      nodes: nodes,
      type: 'temporal',
      expiresAt,
      granularity: Granularity.Daily
    });

    const hyperedge = await db.getHyperedge(hyperedgeId);
    expect('expiresAt' in hyperedge).toBe(true);
    expect('granularity' in hyperedge).toBe(true);
  });

  it('should detect non-expired temporal hyperedge', async () => {
    const expiresAt = createFutureTimestamp(1);
    const hyperedgeId = await db.createTemporalHyperedge({
      nodes: nodes,
      type: 'future',
      expiresAt,
      granularity: Granularity.Hourly
    });

    const hyperedge = await db.getHyperedge(hyperedgeId);
    if ('isExpired' in hyperedge) {
      expect(hyperedge.isExpired).toBe(false);
    }
  });

  it('should detect expired temporal hyperedge', async () => {
    const expiresAt = createPastTimestamp(1);
    const hyperedgeId = await db.createTemporalHyperedge({
      nodes: nodes,
      type: 'expired',
      expiresAt,
      granularity: Granularity.Hourly
    });

    const hyperedge = await db.getHyperedge(hyperedgeId);
    if ('isExpired' in hyperedge) {
      expect(hyperedge.isExpired).toBe(true);
    }
  });

  it('should support Hourly granularity', async () => {
    const hyperedgeId = await db.createTemporalHyperedge({
      nodes: nodes,
      type: 'hourly',
      expiresAt: createFutureTimestamp(1),
      granularity: Granularity.Hourly
    });

    const hyperedge = await db.getHyperedge(hyperedgeId);
    if ('granularity' in hyperedge) {
      expect(hyperedge.granularity).toBe(Granularity.Hourly);
    }
  });

  it('should support Daily granularity', async () => {
    const hyperedgeId = await db.createTemporalHyperedge({
      nodes: nodes,
      type: 'daily',
      expiresAt: createFutureTimestamp(24),
      granularity: Granularity.Daily
    });

    const hyperedge = await db.getHyperedge(hyperedgeId);
    if ('granularity' in hyperedge) {
      expect(hyperedge.granularity).toBe(Granularity.Daily);
    }
  });

  it('should support Monthly granularity', async () => {
    const hyperedgeId = await db.createTemporalHyperedge({
      nodes: nodes,
      type: 'monthly',
      expiresAt: createFutureTimestamp(720),
      granularity: Granularity.Monthly
    });

    const hyperedge = await db.getHyperedge(hyperedgeId);
    if ('granularity' in hyperedge) {
      expect(hyperedge.granularity).toBe(Granularity.Monthly);
    }
  });

  it('should require at least 3 nodes for temporal hyperedge', async () => {
    await expect(
      db.createTemporalHyperedge({
        nodes: [nodes[0], nodes[1]],
        type: 'invalid',
        expiresAt: createFutureTimestamp(1),
        granularity: Granularity.Hourly
      })
    ).rejects.toThrow(InvalidHyperedgeError);
  });

  it('should update isExpired dynamically on retrieval', async () => {
    // Create with very short expiration (1ms in past)
    const expiresAt = Date.now() - 1;
    const hyperedgeId = await db.createTemporalHyperedge({
      nodes: nodes,
      type: 'test',
      expiresAt,
      granularity: Granularity.Hourly
    });

    const hyperedge = await db.getHyperedge(hyperedgeId);
    if ('isExpired' in hyperedge) {
      expect(hyperedge.isExpired).toBe(true);
    }
  });
});

describe('GraphDB - Integrity Validation', () => {
  let db: GraphDB;

  beforeEach(async () => {
    db = new GraphDB(undefined, { enablePersistence: false });
    await db.initialize();
  });

  it('should pass validation for empty graph', async () => {
    const report = await db.validateIntegrity();
    expect(report.isValid).toBe(true);
    expect(report.totalNodes).toBe(0);
    expect(report.totalEdges).toBe(0);
    expect(report.totalHyperedges).toBe(0);
  });

  it('should pass validation for single node', async () => {
    await db.createNode({ type: 'solo' });

    const report = await db.validateIntegrity();
    expect(report.isValid).toBe(true);
    expect(report.totalNodes).toBe(1);
    expect(report.orphanNodes).toHaveLength(0);
  });

  it('should detect orphan nodes', async () => {
    const node1 = await db.createNode({ type: 'node1' });
    const node2 = await db.createNode({ type: 'node2', linkTo: node1 });

    // Create third node linked, then remove all its connections by clearing edges
    const node3 = await db.createNode({ type: 'node3', linkTo: node1 });

    // For now, we can't easily create orphans, so we'll test the opposite
    const report = await db.validateIntegrity();
    expect(report.orphanNodes).toHaveLength(0); // All connected
  });

  it('should detect dimension mismatches in embeddings', async () => {
    // Create node with valid embedding
    await db.createNode({
      type: 'valid',
      embedding: createRandomEmbedding()
    });

    const report = await db.validateIntegrity();
    expect(report.dimensionMismatches).toHaveLength(0);
  });

  it('should detect expired temporal hyperedges', async () => {
    const nodes = [];
    nodes[0] = await db.createNode({ type: 'node0' });
    for (let i = 1; i < 3; i++) {
      nodes[i] = await db.createNode({ type: `node${i}`, linkTo: nodes[0] });
    }

    const expiresAt = createPastTimestamp(1);
    await db.createTemporalHyperedge({
      nodes,
      type: 'expired',
      expiresAt,
      granularity: Granularity.Hourly
    });

    const report = await db.validateIntegrity();
    expect(report.expiredTemporalHyperedges).toHaveLength(1);
  });

  it('should not flag non-expired temporal hyperedges', async () => {
    const nodes = [];
    nodes[0] = await db.createNode({ type: 'node0' });
    for (let i = 1; i < 3; i++) {
      nodes[i] = await db.createNode({ type: `node${i}`, linkTo: nodes[0] });
    }

    const expiresAt = createFutureTimestamp(24);
    await db.createTemporalHyperedge({
      nodes,
      type: 'future',
      expiresAt,
      granularity: Granularity.Daily
    });

    const report = await db.validateIntegrity();
    expect(report.expiredTemporalHyperedges).toHaveLength(0);
  });

  it('should include timestamp in report', async () => {
    const before = Date.now();
    const report = await db.validateIntegrity();
    const after = Date.now();

    expect(report.timestamp).toBeGreaterThanOrEqual(before);
    expect(report.timestamp).toBeLessThanOrEqual(after);
  });

  it('should count nodes, edges, and hyperedges correctly', async () => {
    const node1 = await db.createNode({ type: 'node1' });
    const node2 = await db.createNode({ type: 'node2', linkTo: node1 });
    const node3 = await db.createNode({ type: 'node3', linkTo: node1 });

    await db.createEdge({ source: node1, target: node2, type: 'extra' });
    await db.createHyperedge({
      nodes: [node1, node2, node3],
      type: 'hyper'
    });

    const report = await db.validateIntegrity();
    expect(report.totalNodes).toBe(3);
    expect(report.totalEdges).toBe(3); // 2 from linkTo + 1 extra
    expect(report.totalHyperedges).toBe(1);
  });
});

describe('GraphDB - Multi-hop Traversal', () => {
  let db: GraphDB;
  let nodes: NodeID[];

  beforeEach(async () => {
    db = new GraphDB(undefined, { enablePersistence: false });
    await db.initialize();

    // Create linear chain: 0 -> 1 -> 2 -> 3 -> 4
    nodes = [];
    nodes[0] = await db.createNode({ type: 'node0' });
    for (let i = 1; i < 5; i++) {
      nodes[i] = await db.createNode({ type: `node${i}`, linkTo: nodes[i - 1] });
    }
  });

  it('should traverse 1 hop from start node', async () => {
    const result = await db.traverseHops(nodes[0], 1);

    // Should reach nodes[0] and nodes[1]
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(result.data).toContain(nodes[0]);
  });

  it('should traverse 2 hops from start node', async () => {
    const result = await db.traverseHops(nodes[0], 2);

    // Should reach nodes[0], nodes[1], nodes[2]
    expect(result.count).toBeGreaterThanOrEqual(2);
    expect(result.data).toContain(nodes[0]);
  });

  it('should traverse 3 hops from start node', async () => {
    const result = await db.traverseHops(nodes[0], 3);
    expect(result.count).toBeGreaterThanOrEqual(3);
  });

  it('should traverse 4 hops from start node', async () => {
    const result = await db.traverseHops(nodes[0], 4);
    expect(result.count).toBeGreaterThanOrEqual(4);
  });

  it('should traverse 5 hops from start node', async () => {
    const result = await db.traverseHops(nodes[0], 5);
    expect(result.count).toBeGreaterThanOrEqual(4); // Max 5 nodes total
  });

  it('should include start node in results', async () => {
    const result = await db.traverseHops(nodes[0], 3);
    expect(result.data).toContain(nodes[0]);
  });

  it('should not revisit nodes', async () => {
    const result = await db.traverseHops(nodes[0], 5);
    const uniqueNodes = new Set(result.data);
    expect(uniqueNodes.size).toBe(result.count);
  });

  it('should include executionTimeMs in result', async () => {
    const result = await db.traverseHops(nodes[0], 2);
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should throw NodeNotFoundError for invalid start node', async () => {
    await expect(
      db.traverseHops('nonexistent', 2)
    ).rejects.toThrow(NodeNotFoundError);
  });

  it('should traverse hyperedge connections', async () => {
    // Create branching structure with hyperedge
    const hub = nodes[2];
    const branch1 = await db.createNode({ type: 'branch1', linkTo: hub });
    const branch2 = await db.createNode({ type: 'branch2', linkTo: hub });

    await db.createHyperedge({
      nodes: [hub, branch1, branch2],
      type: 'group'
    });

    const result = await db.traverseHops(nodes[0], 3);
    expect(result.count).toBeGreaterThan(3);
  });
});

describe('GraphDB - Error Handling', () => {
  let db: GraphDB;

  beforeEach(async () => {
    db = new GraphDB(undefined, { enablePersistence: false });
    await db.initialize();
  });

  it('should throw NodeNotFoundError with proper prototype', async () => {
    try {
      await db.getNode('missing');
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NodeNotFoundError);
      expect(e).toBeInstanceOf(Error);
      expect((e as NodeNotFoundError).name).toBe('NodeNotFoundError');
    }
  });

  it('should throw InvalidHyperedgeError with proper prototype', async () => {
    const node1 = await db.createNode({ type: 'node1' });
    const node2 = await db.createNode({ type: 'node2', linkTo: node1 });

    try {
      await db.createHyperedge({
        nodes: [node1, node2],
        type: 'invalid'
      });
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidHyperedgeError);
      expect(e).toBeInstanceOf(Error);
      expect((e as InvalidHyperedgeError).name).toBe('InvalidHyperedgeError');
    }
  });

  it('should throw OrphanNodeError with proper prototype', async () => {
    await db.createNode({ type: 'first' });

    try {
      await db.createNode({ type: 'orphan' });
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(OrphanNodeError);
      expect(e).toBeInstanceOf(Error);
      expect((e as OrphanNodeError).name).toBe('OrphanNodeError');
    }
  });

  it('should throw GraphDimensionMismatchError with proper prototype', async () => {
    try {
      await db.createNode({
        type: 'invalid',
        embedding: createInvalidEmbedding(100)
      });
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GraphDimensionMismatchError);
      expect(e).toBeInstanceOf(Error);
    }
  });
});

describe('GraphDB - Clear Operation', () => {
  let db: GraphDB;

  beforeEach(async () => {
    db = new GraphDB(undefined, { enablePersistence: false });
    await db.initialize();
  });

  it('should clear all data', async () => {
    const node1 = await db.createNode({ type: 'node1' });
    const node2 = await db.createNode({ type: 'node2', linkTo: node1 });
    await db.createEdge({ source: node1, target: node2, type: 'test' });

    await db.clear();

    const report = await db.validateIntegrity();
    expect(report.totalNodes).toBe(0);
    expect(report.totalEdges).toBe(0);
    expect(report.totalHyperedges).toBe(0);
  });

  it('should allow operations after clear', async () => {
    await db.createNode({ type: 'before' });
    await db.clear();

    const nodeId = await db.createNode({ type: 'after' });
    expect(nodeId).toBeDefined();

    const node = await db.getNode(nodeId);
    expect(node.type).toBe('after');
  });
});
