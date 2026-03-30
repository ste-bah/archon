/**
 * Unit Tests for VectorDB
 *
 * TASK-VDB-001: Comprehensive tests for VectorDB CRUD operations
 *
 * Test coverage targets:
 * - VectorDB.insert() validates dimensions and rejects 1536D vectors
 * - VectorDB.insert() returns unique VectorID for each insertion
 * - VectorDB.search() returns k nearest neighbors sorted by similarity
 * - VectorDB.search() validates query vector dimensions
 * - VectorDB.getVector() returns original vector for valid ID
 * - VectorDB.getVector() returns undefined for invalid ID
 * - VectorDB.delete() removes vector and returns true on success
 * - VectorDB.delete() returns false for invalid ID
 * - VectorDB.count() returns correct count
 * - VectorDB.batchInsert() for multiple vectors
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectorDB } from '../../../../src/god-agent/core/vector-db/vector-db';
import { DistanceMetric } from '../../../../src/god-agent/core/vector-db/types';
import {
  VECTOR_DIM,
  GraphDimensionMismatchError,
  NotNormalizedError,
  InvalidVectorValueError
} from '../../../../src/god-agent/core/validation';
import {
  createRandomNormalizedVector,
  createSimpleNormalizedVector,
  createBatchVectors,
  expectVectorsEqual
} from './test-helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('VectorDB - Constructor and Basic Setup', () => {
  let db: VectorDB;

  beforeEach(() => {
    db = new VectorDB();
  });

  it('should create VectorDB instance with default options', async () => {
    expect(db).toBeDefined();
    expect(await db.count()).toBe(0);
  });

  it('should create VectorDB with custom dimension', async () => {
    const customDb = new VectorDB({ dimension: 512 });
    expect(customDb).toBeDefined();
    expect(await customDb.count()).toBe(0);
  });

  it('should create VectorDB with custom distance metric', () => {
    const customDb = new VectorDB({ metric: DistanceMetric.EUCLIDEAN });
    expect(customDb).toBeDefined();
  });
});

describe('VectorDB - insert() Validation', () => {
  let db: VectorDB;

  beforeEach(() => {
    db = new VectorDB();
  });

  it('should accept valid 1536D L2-normalized vector', async () => {
    // TASK-VEC-001-008: Updated from 768D to 1536D per REQ-VEC-01
    const vector = createRandomNormalizedVector();
    const id = await db.insert(vector);

    expect(id).toBeDefined();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('should reject 768D vector (dimension mismatch - legacy dimension)', async () => {
    // TASK-VEC-001-008: 768D is now invalid (was previously valid)
    const vector = new Float32Array(768);
    vector[0] = 1.0;

    await expect(db.insert(vector)).rejects.toThrow(GraphDimensionMismatchError);
    // Use flexible matching pattern for dimension error messages
    await expect(db.insert(vector)).rejects.toThrow(/Expected \d+D, got \d+D/);
  });

  it('should reject 767D vector (dimension mismatch)', async () => {
    const vector = new Float32Array(767);
    vector[0] = 1.0;

    await expect(db.insert(vector)).rejects.toThrow(GraphDimensionMismatchError);
    // Use flexible matching pattern for dimension error messages
    await expect(db.insert(vector)).rejects.toThrow(/Expected \d+D, got \d+D/);
  });

  it('should reject non-normalized vector', async () => {
    const vector = new Float32Array(VECTOR_DIM);
    vector[0] = 2.0; // Not normalized

    await expect(db.insert(vector)).rejects.toThrow(NotNormalizedError);
    // Use partial matching for normalization errors
    await expect(db.insert(vector)).rejects.toThrow(/not L2-normalized|L2.*norm/i);
  });

  it('should reject vector with NaN values', async () => {
    const vector = createSimpleNormalizedVector();
    vector[100] = NaN;

    await expect(db.insert(vector)).rejects.toThrow(InvalidVectorValueError);
  });

  it('should reject vector with Infinity values', async () => {
    const vector = createSimpleNormalizedVector();
    vector[200] = Infinity;

    await expect(db.insert(vector)).rejects.toThrow(InvalidVectorValueError);
  });

  it('should include context in error message', async () => {
    const vector = new Float32Array(100);
    vector[0] = 1.0;

    try {
      await db.insert(vector);
      expect.fail('Should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('VectorDB.insert');
    }
  });
});

describe('VectorDB - insert() Return Values', () => {
  let db: VectorDB;

  beforeEach(() => {
    db = new VectorDB();
  });

  it('should return unique VectorID for each insertion', async () => {
    const vector1 = createRandomNormalizedVector();
    const vector2 = createRandomNormalizedVector();
    const vector3 = createRandomNormalizedVector();

    const id1 = await db.insert(vector1);
    const id2 = await db.insert(vector2);
    const id3 = await db.insert(vector3);

    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(id1).not.toBe(id3);
  });

  it('should return UUID-format strings', async () => {
    const vector = createRandomNormalizedVector();
    const id = await db.insert(vector);

    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(id).toMatch(uuidRegex);
  });

  it('should increment count after each insert', async () => {
    expect(await db.count()).toBe(0);

    await db.insert(createRandomNormalizedVector());
    expect(await db.count()).toBe(1);

    await db.insert(createRandomNormalizedVector());
    expect(await db.count()).toBe(2);

    await db.insert(createRandomNormalizedVector());
    expect(await db.count()).toBe(3);
  });
});

describe('VectorDB - search() Basic Functionality', () => {
  let db: VectorDB;
  let insertedVectors: Map<string, Float32Array>;

  beforeEach(async () => {
    db = new VectorDB();
    insertedVectors = new Map();

    // Insert 10 vectors
    for (let i = 0; i < 10; i++) {
      const vector = createRandomNormalizedVector();
      const id = await db.insert(vector);
      insertedVectors.set(id, vector);
    }
  });

  it('should return k nearest neighbors', async () => {
    const query = createRandomNormalizedVector();
    const results = await db.search(query, 5);

    expect(results).toHaveLength(5);
  });

  it('should return all vectors if k > count', async () => {
    const query = createRandomNormalizedVector();
    const results = await db.search(query, 100);

    expect(results).toHaveLength(10); // Only 10 vectors inserted
  });

  it('should return results sorted by similarity (best first)', async () => {
    const query = createRandomNormalizedVector();
    const results = await db.search(query, 10);

    // Verify descending order for cosine similarity (higher = better)
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].similarity).toBeGreaterThanOrEqual(results[i + 1].similarity);
    }
  });

  it('should return exact match as top result', async () => {
    // Insert a specific vector
    const exactVector = createSimpleNormalizedVector();
    const exactId = await db.insert(exactVector);

    // Search with the same vector
    const results = await db.search(exactVector, 1);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(exactId);
    expect(results[0].similarity).toBeCloseTo(1.0, 5); // Perfect match
  });

  it('should include vector data when includeVectors is true', async () => {
    const query = createRandomNormalizedVector();
    const results = await db.search(query, 5, true);

    expect(results).toHaveLength(5);
    for (const result of results) {
      expect(result.vector).toBeDefined();
      expect(result.vector).toBeInstanceOf(Float32Array);
      expect(result.vector!.length).toBe(VECTOR_DIM);
    }
  });

  it('should not include vector data when includeVectors is false', async () => {
    const query = createRandomNormalizedVector();
    const results = await db.search(query, 5, false);

    expect(results).toHaveLength(5);
    for (const result of results) {
      expect(result.vector).toBeUndefined();
    }
  });

  it('should return empty array when searching empty database', async () => {
    const emptyDb = new VectorDB();
    const query = createRandomNormalizedVector();
    const results = await emptyDb.search(query, 10);

    expect(results).toEqual([]);
  });
});

describe('VectorDB - search() Validation', () => {
  let db: VectorDB;

  beforeEach(async () => {
    db = new VectorDB();
    // Insert some vectors
    for (let i = 0; i < 5; i++) {
      await db.insert(createRandomNormalizedVector());
    }
  });

  it('should validate query vector dimensions', async () => {
    const invalidQuery = new Float32Array(512);
    invalidQuery[0] = 1.0;

    await expect(db.search(invalidQuery, 5)).rejects.toThrow(GraphDimensionMismatchError);
  });

  it('should reject 768D query vector (legacy dimension)', async () => {
    // TASK-VEC-001-008: 768D is now invalid
    const invalidQuery = new Float32Array(768);
    invalidQuery[0] = 1.0;

    await expect(db.search(invalidQuery, 5)).rejects.toThrow(GraphDimensionMismatchError);
    // Use flexible matching pattern for dimension error messages
    await expect(db.search(invalidQuery, 5)).rejects.toThrow(/Expected \d+D, got \d+D/);
  });

  it('should reject non-normalized query vector', async () => {
    const invalidQuery = new Float32Array(VECTOR_DIM);
    invalidQuery[0] = 2.0;

    await expect(db.search(invalidQuery, 5)).rejects.toThrow(NotNormalizedError);
  });

  it('should reject query with NaN values', async () => {
    const invalidQuery = createSimpleNormalizedVector();
    invalidQuery[50] = NaN;

    await expect(db.search(invalidQuery, 5)).rejects.toThrow(InvalidVectorValueError);
  });

  it('should include context in search error message', async () => {
    const invalidQuery = new Float32Array(100);
    invalidQuery[0] = 1.0;

    try {
      await db.search(invalidQuery, 5);
      expect.fail('Should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('VectorDB.search');
    }
  });
});

describe('VectorDB - getVector()', () => {
  let db: VectorDB;
  let testVectors: Map<string, Float32Array>;

  beforeEach(async () => {
    db = new VectorDB();
    testVectors = new Map();

    // Insert test vectors
    for (let i = 0; i < 5; i++) {
      const vector = createRandomNormalizedVector();
      const id = await db.insert(vector);
      testVectors.set(id, vector);
    }
  });

  it('should return original vector for valid ID', async () => {
    const [testId, originalVector] = Array.from(testVectors.entries())[0];
    const retrieved = await db.getVector(testId);

    expect(retrieved).toBeDefined();
    expect(retrieved).toBeInstanceOf(Float32Array);
    expectVectorsEqual(retrieved!, originalVector);
  });

  it('should return undefined for invalid ID', async () => {
    const invalidId = 'nonexistent-id-12345';
    const result = await db.getVector(invalidId);

    expect(result).toBeUndefined();
  });

  it('should return undefined for empty string ID', async () => {
    const result = await db.getVector('');
    expect(result).toBeUndefined();
  });

  it('should return a copy (not reference to internal storage)', async () => {
    const [testId, originalVector] = Array.from(testVectors.entries())[0];
    const retrieved1 = await db.getVector(testId);
    const retrieved2 = await db.getVector(testId);

    expect(retrieved1).not.toBe(retrieved2); // Different instances
    expectVectorsEqual(retrieved1!, retrieved2!); // Same values
  });

  it('should return correct vector for all inserted vectors', async () => {
    for (const [id, originalVector] of testVectors.entries()) {
      const retrieved = await db.getVector(id);
      expect(retrieved).toBeDefined();
      expectVectorsEqual(retrieved!, originalVector);
    }
  });
});

describe('VectorDB - delete()', () => {
  let db: VectorDB;
  let testIds: string[];

  beforeEach(async () => {
    db = new VectorDB();
    testIds = [];

    // Insert test vectors
    for (let i = 0; i < 5; i++) {
      const id = await db.insert(createRandomNormalizedVector());
      testIds.push(id);
    }
  });

  it('should remove vector and return true on success', async () => {
    const idToDelete = testIds[0];
    const initialCount = await db.count();

    const result = await db.delete(idToDelete);

    expect(result).toBe(true);
    expect(await db.count()).toBe(initialCount - 1);
    expect(await db.getVector(idToDelete)).toBeUndefined();
  });

  it('should return false for invalid ID', async () => {
    const invalidId = 'nonexistent-id-12345';
    const initialCount = await db.count();

    const result = await db.delete(invalidId);

    expect(result).toBe(false);
    expect(await db.count()).toBe(initialCount); // Count unchanged
  });

  it('should allow deleting multiple vectors', async () => {
    expect(await db.count()).toBe(5);

    await db.delete(testIds[0]);
    expect(await db.count()).toBe(4);

    await db.delete(testIds[1]);
    expect(await db.count()).toBe(3);

    await db.delete(testIds[2]);
    expect(await db.count()).toBe(2);
  });

  it('should not affect search results after deletion', async () => {
    const idToDelete = testIds[0];
    await db.delete(idToDelete);

    const query = createRandomNormalizedVector();
    const results = await db.search(query, 10);

    // Deleted ID should not appear in results
    expect(results.every(r => r.id !== idToDelete)).toBe(true);
    expect(results.length).toBe(4); // 4 remaining vectors
  });

  it('should handle deleting the same ID twice', async () => {
    const idToDelete = testIds[0];

    const result1 = await db.delete(idToDelete);
    expect(result1).toBe(true);

    const result2 = await db.delete(idToDelete);
    expect(result2).toBe(false); // Already deleted
  });
});

describe('VectorDB - count()', () => {
  let db: VectorDB;

  beforeEach(() => {
    db = new VectorDB();
  });

  it('should return 0 for empty database', async () => {
    expect(await db.count()).toBe(0);
  });

  it('should return correct count after insertions', async () => {
    await db.insert(createRandomNormalizedVector());
    expect(await db.count()).toBe(1);

    await db.insert(createRandomNormalizedVector());
    expect(await db.count()).toBe(2);

    await db.insert(createRandomNormalizedVector());
    expect(await db.count()).toBe(3);
  });

  it('should return correct count after deletions', async () => {
    const id1 = await db.insert(createRandomNormalizedVector());
    const id2 = await db.insert(createRandomNormalizedVector());
    const id3 = await db.insert(createRandomNormalizedVector());

    expect(await db.count()).toBe(3);

    await db.delete(id1);
    expect(await db.count()).toBe(2);

    await db.delete(id2);
    expect(await db.count()).toBe(1);

    await db.delete(id3);
    expect(await db.count()).toBe(0);
  });

  it('should return correct count after clear', async () => {
    await db.insert(createRandomNormalizedVector());
    await db.insert(createRandomNormalizedVector());
    expect(await db.count()).toBe(2);

    await db.clear();
    expect(await db.count()).toBe(0);
  });
});

describe('VectorDB - batchInsert()', () => {
  let db: VectorDB;

  beforeEach(() => {
    db = new VectorDB();
  });

  it('should insert multiple vectors and return unique IDs', async () => {
    const vectors = createBatchVectors(10);
    const ids = await db.batchInsert(vectors);

    expect(ids).toHaveLength(10);
    expect(await db.count()).toBe(10);

    // All IDs should be unique
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(10);
  });

  it('should validate all vectors before inserting any', async () => {
    const vectors = createBatchVectors(5);
    // Corrupt one vector
    vectors[2] = new Float32Array(512); // Wrong dimension
    vectors[2][0] = 1.0;

    await expect(db.batchInsert(vectors)).rejects.toThrow(GraphDimensionMismatchError);

    // No vectors should be inserted (atomic operation)
    expect(await db.count()).toBe(0);
  });

  it('should handle empty batch', async () => {
    const ids = await db.batchInsert([]);
    expect(ids).toEqual([]);
    expect(await db.count()).toBe(0);
  });

  it('should include batch index in error message', async () => {
    const vectors = createBatchVectors(3);
    vectors[1] = new Float32Array(100);
    vectors[1][0] = 1.0;

    try {
      await db.batchInsert(vectors);
      expect.fail('Should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('batchInsert[1]');
    }
  });

  it('should insert large batches efficiently', async () => {
    const vectors = createBatchVectors(100);
    const ids = await db.batchInsert(vectors);

    expect(ids).toHaveLength(100);
    expect(await db.count()).toBe(100);
  });
});

describe('VectorDB - insertWithId()', () => {
  let db: VectorDB;

  beforeEach(() => {
    db = new VectorDB();
  });

  it('should insert vector with custom ID', async () => {
    const customId = 'custom-vector-id-123';
    const vector = createRandomNormalizedVector();

    await db.insertWithId(customId, vector);

    expect(await db.count()).toBe(1);
    const retrieved = await db.getVector(customId);
    expect(retrieved).toBeDefined();
    expectVectorsEqual(retrieved!, vector);
  });

  it('should validate vector dimensions', async () => {
    const customId = 'test-id';
    const invalidVector = new Float32Array(512);
    invalidVector[0] = 1.0;

    await expect(db.insertWithId(customId, invalidVector))
      .rejects.toThrow(GraphDimensionMismatchError);
  });

  it('should allow overwriting existing ID', async () => {
    const customId = 'overwrite-test';
    const vector1 = createRandomNormalizedVector();
    const vector2 = createRandomNormalizedVector();

    await db.insertWithId(customId, vector1);
    await db.insertWithId(customId, vector2);

    expect(await db.count()).toBe(1); // Still only one vector
    const retrieved = await db.getVector(customId);
    expectVectorsEqual(retrieved!, vector2); // Second vector
  });
});

describe('VectorDB - clear()', () => {
  let db: VectorDB;

  beforeEach(async () => {
    db = new VectorDB();
    // Insert some vectors
    for (let i = 0; i < 5; i++) {
      await db.insert(createRandomNormalizedVector());
    }
  });

  it('should remove all vectors', async () => {
    expect(await db.count()).toBe(5);

    await db.clear();

    expect(await db.count()).toBe(0);
  });

  it('should allow inserting after clear', async () => {
    await db.clear();
    expect(await db.count()).toBe(0);

    const id = await db.insert(createRandomNormalizedVector());
    expect(await db.count()).toBe(1);
    expect(await db.getVector(id)).toBeDefined();
  });

  it('should handle clearing empty database', async () => {
    const emptyDb = new VectorDB();
    await expect(emptyDb.clear()).resolves.not.toThrow();
    expect(await emptyDb.count()).toBe(0);
  });
});
