/**
 * GNN Enhancer Test Fixtures
 * TASK-GNN-001 - Test Infrastructure for GNN Enhancement
 *
 * Provides real test data fixtures for GNN enhancer tests.
 * No inline mocks - all data is realistic and reusable.
 */

import type { TrajectoryGraph, TrajectoryNode, TrajectoryEdge } from '../../src/god-agent/core/reasoning/gnn-enhancer.js';

/**
 * Create a normalized embedding of specified dimension
 * Uses seeded random values for deterministic testing
 */
export function createNormalizedEmbedding(dim: number, seed = 0): Float32Array {
  const arr = new Float32Array(dim);
  let sumSq = 0;

  // Simple seeded random for reproducibility
  let x = Math.sin(seed + 1) * 10000;
  for (let i = 0; i < dim; i++) {
    x = Math.sin(x) * 10000;
    arr[i] = (x - Math.floor(x)) * 2 - 1; // Range [-1, 1]
    sumSq += arr[i] * arr[i];
  }

  // L2 normalize
  const norm = Math.sqrt(sumSq);
  for (let i = 0; i < dim; i++) {
    arr[i] /= norm;
  }

  return arr;
}

/**
 * Create a zero embedding
 */
export function createZeroEmbedding(dim: number): Float32Array {
  return new Float32Array(dim);
}

/**
 * Create an embedding with all same values
 */
export function createUniformEmbedding(dim: number, value: number): Float32Array {
  const arr = new Float32Array(dim);
  arr.fill(value);
  return arr;
}

/**
 * Create a batch of embeddings
 */
export function createEmbeddingBatch(count: number, dim: number): Float32Array[] {
  return Array.from({ length: count }, (_, i) => createNormalizedEmbedding(dim, i));
}

/**
 * Create a simple trajectory node
 */
export function createTrajectoryNode(id: string, embeddingSeed = 0): TrajectoryNode {
  return {
    id,
    embedding: createNormalizedEmbedding(1536, embeddingSeed),
    metadata: {
      created: Date.now(),
      type: 'trajectory_step'
    }
  };
}

/**
 * Create a trajectory graph with specified number of nodes
 */
export function createTrajectoryGraph(numNodes: number, fullyConnected = false): TrajectoryGraph {
  const nodes: TrajectoryNode[] = [];
  const edges: TrajectoryEdge[] = [];

  // Create nodes
  for (let i = 0; i < numNodes; i++) {
    nodes.push(createTrajectoryNode(`node_${i}`, i));
  }

  // Create edges
  if (fullyConnected) {
    // Fully connected graph with cosine similarity weights
    for (let i = 0; i < numNodes; i++) {
      for (let j = 0; j < numNodes; j++) {
        if (i !== j) {
          // Approximate weight based on node distance
          const weight = Math.max(0.1, 1.0 - Math.abs(i - j) * 0.1);
          edges.push({
            source: `node_${i}`,
            target: `node_${j}`,
            weight
          });
        }
      }
    }
  } else {
    // Chain graph (each node connects to next)
    for (let i = 0; i < numNodes - 1; i++) {
      edges.push({
        source: `node_${i}`,
        target: `node_${i + 1}`,
        weight: 0.8
      });
    }
  }

  return { nodes, edges };
}

/**
 * Create a sparse trajectory graph (fewer edges)
 */
export function createSparseTrajectoryGraph(numNodes: number): TrajectoryGraph {
  const nodes: TrajectoryNode[] = [];
  const edges: TrajectoryEdge[] = [];

  for (let i = 0; i < numNodes; i++) {
    nodes.push(createTrajectoryNode(`node_${i}`, i));
  }

  // Only connect every other node
  for (let i = 0; i < numNodes - 2; i += 2) {
    edges.push({
      source: `node_${i}`,
      target: `node_${i + 2}`,
      weight: 0.7
    });
  }

  return { nodes, edges };
}

/**
 * Performance test configurations
 */
export const PERFORMANCE_CONFIGS = {
  singleEnhancement: {
    name: 'Single Enhancement',
    embeddings: 1,
    expectedMaxTimeMs: 50,
    description: 'Single enhancement without cache (cold start)'
  },
  cachedQuery: {
    name: 'Cached Query',
    embeddings: 1,
    warmup: true,
    expectedMaxTimeMs: 5,
    description: 'Single enhancement with cache (warm start)'
  },
  batchOf64: {
    name: 'Batch of 64',
    embeddings: 64,
    expectedMaxTimeMs: 200,
    description: 'Batch enhancement for 64 embeddings'
  },
  graphWith50Nodes: {
    name: 'Graph with 50 nodes',
    embeddings: 1,
    graphNodes: 50,
    expectedMaxTimeMs: 100,
    description: 'Enhancement with 50-node trajectory graph'
  }
};

/**
 * Layer dimension test cases
 */
export const LAYER_DIMENSIONS = {
  input: 1536,
  layer1Output: 768,
  layer2Output: 1024,
  layer3Output: 1536
};

/**
 * Cache configuration constants
 */
export const CACHE_CONFIG = {
  maxSize: 1000,
  targetHitRate: 0.8,
  evictionPolicy: 'LRU'
};

/**
 * Test edge cases
 * TASK-VEC-001-008: Updated invalidDimensions to exclude 1536 (now valid)
 */
export const EDGE_CASES = {
  invalidDimensions: [0, 256, 768, 2048], // 768 is now invalid, 1536 is the correct dimension
  extremeValues: [1e10, -1e10, Number.MAX_VALUE, Number.MIN_VALUE],
  specialFloats: [NaN, Infinity, -Infinity],
  boundaryValues: [0, 1, -1, 0.5, -0.5]
};

/**
 * Expected attention normalization tolerance
 */
export const ATTENTION_TOLERANCE = 1e-6;

/**
 * Memory leak test configuration
 */
export const MEMORY_TEST_CONFIG = {
  iterations: 1000,
  batchSize: 100,
  maxMemoryIncreaseMB: 50
};
