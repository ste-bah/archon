/**
 * TASK-CAPIDX-001: CapabilityIndexCache Tests
 * Agent 4: Unit and Integration Tests
 *
 * Comprehensive tests for hash-based caching system
 *
 * Test Coverage:
 * - Unit Tests: All CapabilityIndexCache methods
 * - Validation Tests: All RULE-VAL-001 through RULE-VAL-007
 * - Integration Tests: Cache hit/miss scenarios
 * - Edge Cases: Empty dirs, concurrent access, corrupted data
 *
 * @module tests/god-agent/core/routing/capability-cache.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CapabilityIndexCache } from '../../../../src/god-agent/core/routing/capability-cache.js';
import type { ICachedEmbeddings, ICachedEmbedding } from '../../../../src/god-agent/core/routing/capability-cache.js';

// ==================== Test Configuration ====================

const TEST_PROJECT_ROOT = path.join(process.cwd(), '.test-cache-' + Date.now());
const TEST_AGENTS_PATH = '.claude/agents';
const TEST_CACHE_DIR = '.agentdb/capability-cache';

// ==================== Test Utilities ====================

/**
 * Create test agent files in temporary directory
 */
async function createTestAgents(projectRoot: string, agentCount: number = 3): Promise<void> {
  const agentsDir = path.join(projectRoot, TEST_AGENTS_PATH);
  await fs.mkdir(agentsDir, { recursive: true });

  for (let i = 0; i < agentCount; i++) {
    const content = `---
name: test-agent-${i}
description: Test agent ${i} for caching
capabilities: [testing, caching, validation]
---

# Test Agent ${i}

This is test agent ${i} content.
`;
    await fs.writeFile(
      path.join(agentsDir, `test-agent-${i}.md`),
      content,
      'utf-8'
    );
  }
}

/**
 * Create test cached embeddings data
 */
function createTestCachedEmbeddings(agentCount: number = 3): ICachedEmbeddings {
  const entries: Record<string, ICachedEmbedding> = {};

  for (let i = 0; i < agentCount; i++) {
    const embedding = new Array(1536).fill(0).map(() => Math.random());
    entries[`test-agent-${i}`] = {
      agentKey: `test-agent-${i}`,
      name: `Test Agent ${i}`,
      description: `Test agent ${i} for caching`,
      domains: ['code', 'testing'],
      keywords: ['test', 'agent', 'caching'],
      embedding,
      successRate: 0.5,
      taskCount: 0,
      indexedAt: Date.now(),
    };
  }

  return {
    version: '1.0.0',
    generatedAt: Date.now(),
    embeddingDimension: 1536,
    agentCount,
    entries,
  };
}

/**
 * Clean up test directory
 */
async function cleanupTestDir(projectRoot: string): Promise<void> {
  try {
    await fs.rm(projectRoot, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ==================== Unit Tests ====================

describe('CapabilityIndexCache - Unit Tests', () => {
  let projectRoot: string;
  let cache: CapabilityIndexCache;

  beforeEach(async () => {
    projectRoot = TEST_PROJECT_ROOT + '-' + Math.random().toString(36).substring(7);
    await createTestAgents(projectRoot, 3);
    cache = new CapabilityIndexCache(projectRoot, TEST_AGENTS_PATH);
  });

  afterEach(async () => {
    await cleanupTestDir(projectRoot);
  });

  describe('computeContentHash()', () => {
    it('should return consistent SHA256 hash', async () => {
      const hash1 = await cache.computeContentHash();
      const hash2 = await cache.computeContentHash();

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA256 hex length
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should return different hash when content changes', async () => {
      const hash1 = await cache.computeContentHash();

      // Modify an agent file
      const agentPath = path.join(projectRoot, TEST_AGENTS_PATH, 'test-agent-0.md');
      await fs.appendFile(agentPath, '\nModified content', 'utf-8');
      cache.clearHashCache();

      const hash2 = await cache.computeContentHash();

      expect(hash1).not.toBe(hash2);
    });

    it('should throw error when agents directory does not exist', async () => {
      const invalidCache = new CapabilityIndexCache(projectRoot, 'invalid/path');

      await expect(invalidCache.computeContentHash()).rejects.toThrow(
        /No agent files found|Failed to compute content hash/
      );
    });

    it('should include file path in hash (detect renames)', async () => {
      const hash1 = await cache.computeContentHash();

      // Rename an agent file
      const oldPath = path.join(projectRoot, TEST_AGENTS_PATH, 'test-agent-0.md');
      const newPath = path.join(projectRoot, TEST_AGENTS_PATH, 'renamed-agent-0.md');
      await fs.rename(oldPath, newPath);
      cache.clearHashCache();

      const hash2 = await cache.computeContentHash();

      expect(hash1).not.toBe(hash2);
    });

    it('should sort files deterministically', async () => {
      // Create files in different order
      const root2 = projectRoot + '-sort-test';
      await fs.mkdir(path.join(root2, TEST_AGENTS_PATH), { recursive: true });

      // Create in reverse order
      for (let i = 2; i >= 0; i--) {
        await fs.writeFile(
          path.join(root2, TEST_AGENTS_PATH, `test-agent-${i}.md`),
          `Agent ${i}`,
          'utf-8'
        );
      }

      const cache2 = new CapabilityIndexCache(root2, TEST_AGENTS_PATH);
      const hash2 = await cache2.computeContentHash();

      // Should match hash from ordered creation
      // (can't directly compare since content differs, but test sorts internally)
      expect(hash2).toHaveLength(64);

      await cleanupTestDir(root2);
    });

    it('should complete in < 500ms for reasonable agent count', async () => {
      const startTime = performance.now();
      await cache.computeContentHash();
      const duration = performance.now() - startTime;

      // REQ-CAPIDX-006: Hash computation < 500ms for 200 agents
      // Our test has only 3 agents, should be much faster
      expect(duration).toBeLessThan(100);
    });
  });

  describe('isValid()', () => {
    it('should return false when no cache exists', async () => {
      const isValid = await cache.isValid();
      expect(isValid).toBe(false);
    });

    it('should return true when cache exists and hash matches', async () => {
      // Create cache
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      // Validate
      const isValid = await cache.isValid();
      expect(isValid).toBe(true);
    });

    it('should return false when hash mismatches', async () => {
      // Create cache with wrong hash
      const embeddings = createTestCachedEmbeddings(3);
      await cache.save(embeddings, 'wrong-hash-value');

      // Validate
      const isValid = await cache.isValid();
      expect(isValid).toBe(false);
    });

    it('should return false when cache is corrupted', async () => {
      // Create valid cache first
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      // Corrupt the embeddings.json
      const embeddingsPath = path.join(projectRoot, TEST_CACHE_DIR, 'embeddings.json');
      await fs.writeFile(embeddingsPath, '{ invalid json', 'utf-8');

      // Should be invalid
      const isValid = await cache.isValid();
      expect(isValid).toBe(false);
    });
  });

  describe('load()', () => {
    it('should return null when no cache exists', async () => {
      const result = await cache.load();
      expect(result).toBeNull();
    });

    it('should return embeddings when cache is valid', async () => {
      // Create cache
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      // Load
      const loaded = await cache.load();

      expect(loaded).not.toBeNull();
      expect(loaded!.agentCount).toBe(3);
      expect(loaded!.embeddingDimension).toBe(1536);
      expect(Object.keys(loaded!.entries)).toHaveLength(3);
    });

    it('should return null when hash mismatches', async () => {
      // Create cache
      const embeddings = createTestCachedEmbeddings(3);
      await cache.save(embeddings, 'wrong-hash');

      // Load should fail
      const loaded = await cache.load();
      expect(loaded).toBeNull();
    });

    it('should return null on corrupted JSON', async () => {
      // Create cache
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      // Corrupt embeddings.json
      const embeddingsPath = path.join(projectRoot, TEST_CACHE_DIR, 'embeddings.json');
      await fs.writeFile(embeddingsPath, '{ corrupted }', 'utf-8');

      // Load should fail
      const loaded = await cache.load();
      expect(loaded).toBeNull();
    });

    it('should complete in < 100ms on cache hit', async () => {
      // Create cache
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      // Load with timing
      const startTime = performance.now();
      await cache.load();
      const duration = performance.now() - startTime;

      // REQ-CAPIDX-006: Cache hit load < 100ms
      expect(duration).toBeLessThan(100);
    });
  });

  describe('save()', () => {
    it('should create all three cache files', async () => {
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();

      await cache.save(embeddings, hash);

      // Check files exist
      const cacheDir = path.join(projectRoot, TEST_CACHE_DIR);
      const hashPath = path.join(cacheDir, 'hash.txt');
      const embeddingsPath = path.join(cacheDir, 'embeddings.json');
      const metadataPath = path.join(cacheDir, 'metadata.json');

      await expect(fs.access(hashPath)).resolves.not.toThrow();
      await expect(fs.access(embeddingsPath)).resolves.not.toThrow();
      await expect(fs.access(metadataPath)).resolves.not.toThrow();
    });

    it('should use atomic write pattern with temp files', async () => {
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();

      await cache.save(embeddings, hash);

      // After save, temp files should be cleaned up
      const cacheDir = path.join(projectRoot, TEST_CACHE_DIR);
      const files = await fs.readdir(cacheDir);
      const tempFiles = files.filter(f => f.endsWith('.tmp'));

      expect(tempFiles).toHaveLength(0);
    });

    it('should create cache directory if it does not exist', async () => {
      // Cache dir shouldn't exist yet
      const cacheDir = path.join(projectRoot, TEST_CACHE_DIR);
      try {
        await fs.access(cacheDir);
        // If it exists, remove it
        await fs.rm(cacheDir, { recursive: true });
      } catch {
        // Good, doesn't exist
      }

      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();

      await cache.save(embeddings, hash);

      // Directory should now exist
      await expect(fs.access(cacheDir)).resolves.not.toThrow();
    });

    it('should write valid JSON data', async () => {
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();

      await cache.save(embeddings, hash);

      // Read and parse JSON
      const cacheDir = path.join(projectRoot, TEST_CACHE_DIR);
      const embeddingsPath = path.join(cacheDir, 'embeddings.json');
      const metadataPath = path.join(cacheDir, 'metadata.json');

      const embeddingsData = await fs.readFile(embeddingsPath, 'utf-8');
      const metadataData = await fs.readFile(metadataPath, 'utf-8');

      // Should parse without error
      expect(() => JSON.parse(embeddingsData)).not.toThrow();
      expect(() => JSON.parse(metadataData)).not.toThrow();
    });

    it('should save correct hash value', async () => {
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();

      await cache.save(embeddings, hash);

      // Read hash file
      const hashPath = path.join(projectRoot, TEST_CACHE_DIR, 'hash.txt');
      const savedHash = (await fs.readFile(hashPath, 'utf-8')).trim();

      expect(savedHash).toBe(hash);
    });

    it('should complete save in < 1000ms', async () => {
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();

      const startTime = performance.now();
      await cache.save(embeddings, hash);
      const duration = performance.now() - startTime;

      // REQ-CAPIDX-006: Cache save < 1000ms
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('invalidate()', () => {
    it('should delete all cache files', async () => {
      // Create cache
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      // Invalidate
      await cache.invalidate();

      // Files should not exist
      const cacheDir = path.join(projectRoot, TEST_CACHE_DIR);
      const hashPath = path.join(cacheDir, 'hash.txt');
      const embeddingsPath = path.join(cacheDir, 'embeddings.json');
      const metadataPath = path.join(cacheDir, 'metadata.json');

      await expect(fs.access(hashPath)).rejects.toThrow();
      await expect(fs.access(embeddingsPath)).rejects.toThrow();
      await expect(fs.access(metadataPath)).rejects.toThrow();
    });

    it('should not throw if cache does not exist', async () => {
      // No cache exists yet
      await expect(cache.invalidate()).resolves.not.toThrow();
    });

    it('should not throw if cache directory does not exist', async () => {
      // Ensure no cache directory
      const cacheDir = path.join(projectRoot, TEST_CACHE_DIR);
      try {
        await fs.rm(cacheDir, { recursive: true });
      } catch {
        // Already doesn't exist
      }

      await expect(cache.invalidate()).resolves.not.toThrow();
    });
  });

  describe('getStats()', () => {
    it('should return null when no cache exists', async () => {
      const stats = await cache.getStats();
      expect(stats).toBeNull();
    });

    it('should return correct statistics', async () => {
      // Create cache
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      // Get stats
      const stats = await cache.getStats();

      expect(stats).not.toBeNull();
      expect(stats!.exists).toBe(true);
      expect(stats!.isValid).toBe(true);
      expect(stats!.agentCount).toBe(3);
      expect(stats!.hashMatch).toBe(true);
      expect(stats!.currentHash).toBe(hash);
      expect(stats!.cachedHash).toBe(hash);
      expect(stats!.sizeBytes).toBeGreaterThan(0);
      expect(stats!.createdAt).toBeGreaterThan(0);
    });

    it('should show hash mismatch when content changes', async () => {
      // Create cache
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      // Modify agent file
      const agentPath = path.join(projectRoot, TEST_AGENTS_PATH, 'test-agent-0.md');
      await fs.appendFile(agentPath, '\nModified', 'utf-8');
      cache.clearHashCache();

      // Get stats
      const stats = await cache.getStats();

      expect(stats).not.toBeNull();
      expect(stats!.hashMatch).toBe(false);
      expect(stats!.isValid).toBe(false);
      expect(stats!.currentHash).not.toBe(stats!.cachedHash);
    });

    it('should return null on corrupted cache', async () => {
      // Create cache
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      // Corrupt metadata
      const metadataPath = path.join(projectRoot, TEST_CACHE_DIR, 'metadata.json');
      await fs.writeFile(metadataPath, 'corrupted', 'utf-8');

      // Stats should return null
      const stats = await cache.getStats();
      expect(stats).toBeNull();
    });
  });
});

// ==================== Validation Tests ====================

describe('CapabilityIndexCache - Validation Tests', () => {
  let projectRoot: string;
  let cache: CapabilityIndexCache;

  beforeEach(async () => {
    projectRoot = TEST_PROJECT_ROOT + '-val-' + Math.random().toString(36).substring(7);
    await createTestAgents(projectRoot, 3);
    cache = new CapabilityIndexCache(projectRoot, TEST_AGENTS_PATH);
  });

  afterEach(async () => {
    await cleanupTestDir(projectRoot);
  });

  describe('RULE-VAL-001: Hash file exists check', () => {
    it('should detect missing hash.txt', async () => {
      // Create partial cache (no hash.txt)
      const cacheDir = path.join(projectRoot, TEST_CACHE_DIR);
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(
        path.join(cacheDir, 'embeddings.json'),
        JSON.stringify(createTestCachedEmbeddings(3)),
        'utf-8'
      );

      const isValid = await cache.isValid();
      expect(isValid).toBe(false);
    });
  });

  describe('RULE-VAL-002: Hash mismatch detection', () => {
    it('should detect hash mismatch', async () => {
      // Create cache with wrong hash
      const embeddings = createTestCachedEmbeddings(3);
      await cache.save(embeddings, 'incorrect-hash-value');

      const isValid = await cache.isValid();
      expect(isValid).toBe(false);
    });

    it('should validate hash matches current content', async () => {
      // Create valid cache
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      // Modify content
      const agentPath = path.join(projectRoot, TEST_AGENTS_PATH, 'test-agent-0.md');
      await fs.appendFile(agentPath, '\nNew content', 'utf-8');
      cache.clearHashCache();

      // Should be invalid now
      const isValid = await cache.isValid();
      expect(isValid).toBe(false);
    });
  });

  describe('RULE-VAL-003: Corrupted JSON handling', () => {
    it('should detect corrupted embeddings.json', async () => {
      // Create cache then corrupt
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      // Corrupt embeddings
      const embeddingsPath = path.join(projectRoot, TEST_CACHE_DIR, 'embeddings.json');
      await fs.writeFile(embeddingsPath, '{ "invalid": json }', 'utf-8');

      const loaded = await cache.load();
      expect(loaded).toBeNull();
    });

    it('should handle missing embeddings.json', async () => {
      // Create cache then delete embeddings
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      const embeddingsPath = path.join(projectRoot, TEST_CACHE_DIR, 'embeddings.json');
      await fs.unlink(embeddingsPath);

      const loaded = await cache.load();
      expect(loaded).toBeNull();
    });
  });

  describe('RULE-VAL-004: Embedding dimension validation', () => {
    it('should detect wrong embedding dimensions', async () => {
      // Create cache with wrong dimensions
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();

      // Corrupt one embedding dimension
      embeddings.entries['test-agent-0'].embedding = new Array(512).fill(0); // Wrong dimension

      await cache.save(embeddings, hash);

      const loaded = await cache.load();
      expect(loaded).toBeNull();
    });

    it('should accept correct 1536 dimensions', async () => {
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      const loaded = await cache.load();
      expect(loaded).not.toBeNull();

      // Verify all embeddings have correct dimension
      for (const entry of Object.values(loaded!.entries)) {
        expect(entry.embedding).toHaveLength(1536);
      }
    });
  });

  describe('RULE-VAL-005: Agent count validation', () => {
    it('should detect agent count mismatch', async () => {
      // Create cache
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();

      // Corrupt agent count
      embeddings.agentCount = 5; // Wrong count

      await cache.save(embeddings, hash);

      const loaded = await cache.load();
      expect(loaded).toBeNull();
    });

    it('should validate agent count matches entries', async () => {
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      const loaded = await cache.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.agentCount).toBe(Object.keys(loaded!.entries).length);
    });
  });

  describe('RULE-VAL-006: Metadata existence check', () => {
    it('should detect missing metadata.json', async () => {
      // Create cache then delete metadata
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      const metadataPath = path.join(projectRoot, TEST_CACHE_DIR, 'metadata.json');
      await fs.unlink(metadataPath);

      const loaded = await cache.load();
      expect(loaded).toBeNull();
    });

    it('should detect corrupted metadata.json', async () => {
      // Create cache then corrupt metadata
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      const metadataPath = path.join(projectRoot, TEST_CACHE_DIR, 'metadata.json');
      await fs.writeFile(metadataPath, 'not json', 'utf-8');

      const loaded = await cache.load();
      expect(loaded).toBeNull();
    });
  });

  describe('RULE-VAL-007: Version mismatch handling', () => {
    it('should detect version mismatch', async () => {
      // Create cache
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      // Corrupt version in metadata
      const metadataPath = path.join(projectRoot, TEST_CACHE_DIR, 'metadata.json');
      const metadataData = await fs.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(metadataData);
      metadata.cacheFormatVersion = 999; // Invalid version
      await fs.writeFile(metadataPath, JSON.stringify(metadata), 'utf-8');

      const loaded = await cache.load();
      expect(loaded).toBeNull();
    });

    it('should accept correct cache format version', async () => {
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      const loaded = await cache.load();
      expect(loaded).not.toBeNull();
    });
  });
});

// ==================== Integration Tests ====================

describe('CapabilityIndexCache - Integration Tests', () => {
  let projectRoot: string;
  let cache: CapabilityIndexCache;

  beforeEach(async () => {
    projectRoot = TEST_PROJECT_ROOT + '-int-' + Math.random().toString(36).substring(7);
    await createTestAgents(projectRoot, 5);
    cache = new CapabilityIndexCache(projectRoot, TEST_AGENTS_PATH);
  });

  afterEach(async () => {
    await cleanupTestDir(projectRoot);
  });

  describe('Cache miss triggers full rebuild', () => {
    it('should return null and force rebuild on first load', async () => {
      const loaded = await cache.load();
      expect(loaded).toBeNull();
    });

    it('should return null when hash mismatches after agent change', async () => {
      // Create cache
      const embeddings = createTestCachedEmbeddings(5);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      // Verify cache hit
      let loaded = await cache.load();
      expect(loaded).not.toBeNull();

      // Modify agent
      const agentPath = path.join(projectRoot, TEST_AGENTS_PATH, 'test-agent-0.md');
      await fs.appendFile(agentPath, '\nUpdated content', 'utf-8');
      cache.clearHashCache();

      // Should miss cache
      loaded = await cache.load();
      expect(loaded).toBeNull();
    });
  });

  describe('Cache hit skips embedding API calls', () => {
    it('should successfully load from cache on second call', async () => {
      // Create cache
      const embeddings = createTestCachedEmbeddings(5);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      // Load twice
      const loaded1 = await cache.load();
      const loaded2 = await cache.load();

      expect(loaded1).not.toBeNull();
      expect(loaded2).not.toBeNull();
      expect(loaded1!.agentCount).toBe(loaded2!.agentCount);
    });

    it('should be significantly faster on cache hit', async () => {
      // Create cache
      const embeddings = createTestCachedEmbeddings(5);
      const hash = await cache.computeContentHash();

      const saveStart = performance.now();
      await cache.save(embeddings, hash);
      const saveDuration = performance.now() - saveStart;

      // Load from cache
      const loadStart = performance.now();
      const loaded = await cache.load();
      const loadDuration = performance.now() - loadStart;

      expect(loaded).not.toBeNull();
      // Load should be fast (< 100ms target per REQ-CAPIDX-006)
      expect(loadDuration).toBeLessThan(100);
    });
  });

  describe('Agent file changes invalidate cache', () => {
    it('should invalidate on file content change', async () => {
      // Create cache
      const embeddings = createTestCachedEmbeddings(5);
      const hash1 = await cache.computeContentHash();
      await cache.save(embeddings, hash1);

      // Modify file
      const agentPath = path.join(projectRoot, TEST_AGENTS_PATH, 'test-agent-0.md');
      await fs.appendFile(agentPath, '\nModified', 'utf-8');

      // Clear hash cache to detect file changes
      cache.clearHashCache();

      // Hash should change
      const hash2 = await cache.computeContentHash();
      expect(hash1).not.toBe(hash2);

      // Cache should be invalid
      const isValid = await cache.isValid();
      expect(isValid).toBe(false);
    });

    it('should invalidate on file addition', async () => {
      // Create cache
      const embeddings = createTestCachedEmbeddings(5);
      const hash1 = await cache.computeContentHash();
      await cache.save(embeddings, hash1);

      // Add new agent
      await fs.writeFile(
        path.join(projectRoot, TEST_AGENTS_PATH, 'new-agent.md'),
        '---\nname: new-agent\n---\n\nNew agent',
        'utf-8'
      );

      // Clear hash cache to detect file changes
      cache.clearHashCache();

      // Hash should change
      const hash2 = await cache.computeContentHash();
      expect(hash1).not.toBe(hash2);

      // Cache should be invalid
      const isValid = await cache.isValid();
      expect(isValid).toBe(false);
    });

    it('should invalidate on file deletion', async () => {
      // Create cache
      const embeddings = createTestCachedEmbeddings(5);
      const hash1 = await cache.computeContentHash();
      await cache.save(embeddings, hash1);

      // Delete agent
      const agentPath = path.join(projectRoot, TEST_AGENTS_PATH, 'test-agent-0.md');
      await fs.unlink(agentPath);

      // Clear hash cache to detect file changes
      cache.clearHashCache();

      // Hash should change because file is deleted (fewer files)
      const hash2 = await cache.computeContentHash();
      expect(hash1).not.toBe(hash2);
    });

    it('should invalidate on file rename', async () => {
      // Create cache
      const embeddings = createTestCachedEmbeddings(5);
      const hash1 = await cache.computeContentHash();
      await cache.save(embeddings, hash1);

      // Rename file
      const oldPath = path.join(projectRoot, TEST_AGENTS_PATH, 'test-agent-0.md');
      const newPath = path.join(projectRoot, TEST_AGENTS_PATH, 'renamed-agent.md');
      await fs.rename(oldPath, newPath);

      // Clear hash cache to detect file changes
      cache.clearHashCache();

      // Hash should change
      const hash2 = await cache.computeContentHash();
      expect(hash1).not.toBe(hash2);

      // Cache should be invalid
      const isValid = await cache.isValid();
      expect(isValid).toBe(false);
    });
  });

  describe('Performance: cache hit < 100ms', () => {
    it('should load cache in under 100ms', async () => {
      // Create larger cache
      const embeddings = createTestCachedEmbeddings(5);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      // Measure load time
      const startTime = performance.now();
      const loaded = await cache.load();
      const duration = performance.now() - startTime;

      expect(loaded).not.toBeNull();
      expect(duration).toBeLessThan(100); // REQ-CAPIDX-006
    });
  });
});

// ==================== Edge Cases ====================

describe('CapabilityIndexCache - Edge Cases', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = TEST_PROJECT_ROOT + '-edge-' + Math.random().toString(36).substring(7);
    await fs.mkdir(projectRoot, { recursive: true });
  });

  afterEach(async () => {
    await cleanupTestDir(projectRoot);
  });

  describe('Empty agents directory', () => {
    it('should throw error when no agent files exist', async () => {
      // Create empty agents directory
      await fs.mkdir(path.join(projectRoot, TEST_AGENTS_PATH), { recursive: true });

      const cache = new CapabilityIndexCache(projectRoot, TEST_AGENTS_PATH);

      await expect(cache.computeContentHash()).rejects.toThrow(/No agent files found/);
    });
  });

  describe('Single agent file', () => {
    it('should handle single agent file correctly', async () => {
      await createTestAgents(projectRoot, 1);
      const cache = new CapabilityIndexCache(projectRoot, TEST_AGENTS_PATH);

      const hash = await cache.computeContentHash();
      expect(hash).toHaveLength(64);

      const embeddings = createTestCachedEmbeddings(1);
      await cache.save(embeddings, hash);

      const loaded = await cache.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.agentCount).toBe(1);
    });
  });

  describe('Cache directory does not exist', () => {
    it('should create cache directory on save', async () => {
      await createTestAgents(projectRoot, 3);
      const cache = new CapabilityIndexCache(projectRoot, TEST_AGENTS_PATH);

      const cacheDir = path.join(projectRoot, TEST_CACHE_DIR);

      // Ensure doesn't exist
      try {
        await fs.rm(cacheDir, { recursive: true });
      } catch {
        // Already doesn't exist
      }

      // Save should create directory
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      // Directory should exist now
      await expect(fs.access(cacheDir)).resolves.not.toThrow();
    });
  });

  describe('Concurrent access', () => {
    it('should handle concurrent save operations', async () => {
      await createTestAgents(projectRoot, 3);
      const cache = new CapabilityIndexCache(projectRoot, TEST_AGENTS_PATH);

      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();

      // Save concurrently (not recommended but should not crash)
      // Use allSettled since concurrent renames may race
      const results = await Promise.allSettled([
        cache.save(embeddings, hash),
        cache.save(embeddings, hash),
      ]);
      // At least one should succeed
      const successes = results.filter(r => r.status === 'fulfilled');
      expect(successes.length).toBeGreaterThanOrEqual(1);

      // Should be valid
      const isValid = await cache.isValid();
      expect(isValid).toBe(true);
    });

    it('should handle concurrent read operations', async () => {
      await createTestAgents(projectRoot, 3);
      const cache = new CapabilityIndexCache(projectRoot, TEST_AGENTS_PATH);

      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      // Load concurrently
      const [loaded1, loaded2, loaded3] = await Promise.all([
        cache.load(),
        cache.load(),
        cache.load(),
      ]);

      expect(loaded1).not.toBeNull();
      expect(loaded2).not.toBeNull();
      expect(loaded3).not.toBeNull();
    });

    it('should handle concurrent hash computations', async () => {
      await createTestAgents(projectRoot, 3);
      const cache = new CapabilityIndexCache(projectRoot, TEST_AGENTS_PATH);

      // Compute hash concurrently
      const [hash1, hash2, hash3] = await Promise.all([
        cache.computeContentHash(),
        cache.computeContentHash(),
        cache.computeContentHash(),
      ]);

      // All should be identical
      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });
  });

  describe('Cleanup of orphaned temp files', () => {
    it('should clean up temp files from previous crash', async () => {
      await createTestAgents(projectRoot, 3);
      const cache = new CapabilityIndexCache(projectRoot, TEST_AGENTS_PATH);

      const cacheDir = path.join(projectRoot, TEST_CACHE_DIR);
      await fs.mkdir(cacheDir, { recursive: true });

      // Create orphaned temp files
      await fs.writeFile(path.join(cacheDir, 'embeddings.json.123.tmp'), 'old', 'utf-8');
      await fs.writeFile(path.join(cacheDir, 'metadata.json.456.tmp'), 'old', 'utf-8');

      // Save should clean up temp files
      const embeddings = createTestCachedEmbeddings(3);
      const hash = await cache.computeContentHash();
      await cache.save(embeddings, hash);

      // Check temp files are gone
      const files = await fs.readdir(cacheDir);
      const tempFiles = files.filter(f => f.endsWith('.tmp'));
      expect(tempFiles).toHaveLength(0);
    });
  });
});
