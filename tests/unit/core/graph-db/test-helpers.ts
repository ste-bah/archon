/**
 * Test Helper Utilities for GraphDB Tests
 *
 * Shared utilities for generating test nodes, embeddings, and graph structures
 */

import { VECTOR_DIM } from '../../../../src/god-agent/core/validation';
import type { CreateNodeOptions, Granularity } from '../../../../src/god-agent/core/graph-db/types';

/**
 * Create a random 1536D embedding (number array)
 * TASK-VEC-001-008: Updated dimension from 768D to 1536D
 */
export function createRandomEmbedding(dim: number = VECTOR_DIM): number[] {
  const embedding: number[] = [];
  let sumOfSquares = 0;

  // Generate random values
  for (let i = 0; i < dim; i++) {
    const value = Math.random() - 0.5;
    embedding[i] = value;
    sumOfSquares += value * value;
  }

  // Normalize to L2 norm = 1
  const norm = Math.sqrt(sumOfSquares);
  for (let i = 0; i < dim; i++) {
    embedding[i] /= norm;
  }

  return embedding;
}

/**
 * Create a simple normalized embedding [1, 0, 0, ..., 0]
 */
export function createSimpleEmbedding(dim: number = VECTOR_DIM): number[] {
  const embedding = new Array(dim).fill(0);
  embedding[0] = 1.0;
  return embedding;
}

/**
 * Create test node options
 */
export function createTestNodeOptions(
  type: string = 'test',
  includeEmbedding: boolean = false
): CreateNodeOptions {
  return {
    type,
    properties: {
      name: `Node-${Date.now()}`,
      timestamp: Date.now()
    },
    embedding: includeEmbedding ? createRandomEmbedding() : undefined
  };
}

/**
 * Create test node options with specific embedding
 */
export function createNodeWithEmbedding(
  type: string = 'test',
  embedding?: number[]
): CreateNodeOptions {
  return {
    type,
    properties: { name: `Node-${type}` },
    embedding: embedding || createRandomEmbedding()
  };
}

/**
 * Create batch of test node IDs (UUIDs)
 */
export function createTestNodeIds(count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(`test-node-${i}-${Date.now()}-${Math.random().toString(36).substring(7)}`);
  }
  return ids;
}

/**
 * Create future timestamp (for temporal hyperedge expiration)
 */
export function createFutureTimestamp(hoursFromNow: number = 1): number {
  return Date.now() + (hoursFromNow * 60 * 60 * 1000);
}

/**
 * Create past timestamp (for expired temporal hyperedge)
 */
export function createPastTimestamp(hoursAgo: number = 1): number {
  return Date.now() - (hoursAgo * 60 * 60 * 1000);
}

/**
 * Assert embeddings are approximately equal
 */
export function expectEmbeddingsEqual(
  a: number[],
  b: number[],
  tolerance: number = 1e-6
): void {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    expect(Math.abs(a[i] - b[i])).toBeLessThan(tolerance);
  }
}

/**
 * Assert embedding is normalized (L2 norm = 1)
 */
export function expectNormalized(embedding: number[], tolerance: number = 1e-6): void {
  let sumOfSquares = 0;
  for (let i = 0; i < embedding.length; i++) {
    sumOfSquares += embedding[i] * embedding[i];
  }
  const norm = Math.sqrt(sumOfSquares);
  expect(Math.abs(norm - 1.0)).toBeLessThan(tolerance);
}

/**
 * Create invalid embedding with wrong dimensions
 */
export function createInvalidEmbedding(dim: number): number[] {
  return new Array(dim).fill(0.1);
}

/**
 * Verify UUID format
 */
export function expectValidUUID(id: string): void {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  expect(id).toMatch(uuidRegex);
}
